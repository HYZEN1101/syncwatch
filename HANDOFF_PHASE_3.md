# HANDOFF_PHASE_3.md — Event-Driven Sync

## Status: Complete and confirmed working on a real machine, including three real bugs found and fixed during manual testing (see "Bugs found during manual testing" below).

## What this phase covers
Phase 3 of the Electron migration: replacing `useSync.js`'s wall-clock-estimated sync (`estimatedTime()`, the `localTime`/`startedAt` timer, no visibility into whether a command actually landed) with real, pushed `<video>` events — `play`/`pause`/`seeking`/`seeked`/`waiting`/`playing`/`ended`/`timeupdate` — per `PHASE_3_event_driven_sync.md`, building on the IPC surface Phase 2 left stubbed (`playback:video-event`, `onVideoEvent`).

## The core problem this phase solves
Before this phase, on Electron, sync commands were fire-and-forget: `iframeCmd('play')` called `window.syncwatch.playback.command('play')` and just assumed it worked. There was no way to know if `video.play()` actually started playback, if it silently failed (autoplay block — genuinely common on unmuted media, and explicitly called out as a gap in the original migration doc), if the video was buffering, or if the tracked `currentTime` had drifted from reality. `estimatedTime()` was a pure wall-clock guess seeded by the last command issued, with no feedback loop.

## How events actually get from the video to the UI
This needed a new plumbing path, since `executeJavaScript` (what Phase 2 built) only gives one-shot results — it can't push a live event stream. The path built this phase:

1. **`electron/playback-preload.js`** (new file) — a *second*, separate preload attached to the `WebContentsView` itself (not the app's own window preload). Exposes `window.syncwatchInternal.reportEvent(payload)` into the loaded page's main world via `contextBridge`, which forwards to `ipcRenderer.send('playback:internal-video-event', payload)`.
2. **`electron/playback.js`** — `buildEventListenerScript()` is injected once per page load (via the same `waitForVideoAndRun` retry-budget helper Phase 2 built for commands, so a lazily-rendered player is handled the same way). It finds the video (same "largest visible `<video>`" heuristic as before, kept consistent with the old bridge and Phase 2's control script), attaches real listeners for all 8 event types, and calls `window.syncwatchInternal.reportEvent(...)` on each — with `timeupdate` throttled client-side to once per 300ms since it can fire dozens of times a second. An idempotency guard (`window.__syncwatchListenersInstalled`) means it's safe to trigger this from multiple load-related events without double-attaching.
3. Installation triggers from both `did-finish-load` (main frame) and `did-frame-finish-load` with `isMainFrame: false` (nested frames) — covers the aggregator/CDN-player case where the actual video lives in a child frame that finishes loading separately from the outer page.
4. `view.webContents.webPreferences` now also sets `nodeIntegrationInSubFrames: true` so the preload (and therefore `reportEvent`) is available inside nested iframes too, not just the top document.
5. Back in main process, `view.webContents.on('ipc-message', ...)` catches `'playback:internal-video-event'` and forwards the payload via `win.webContents.send('playback:video-event', payload)` — the exact channel `preload.js`'s `onVideoEvent` (built in Phase 2, unused until now) already listens on.

## What changed in `client-react/src/hooks/useSync.js`
- New refs: `playConfirmed` (was the last play-ish command actually confirmed by a real `'playing'` event?), `playConfirmTimeout`, `buffering`.
- New `refreshStatus()` helper — single source of truth for the status text, so a command-issued optimistic update and a later real-event correction don't fight each other.
- `iframeCmd()` now arms a 2.5s timer on `play`/`playfrom` commands (Electron only): if no `'playing'` event lands by then, status flips to `"⚠ Playback may be blocked — click the video"` — this is the autoplay-block detection the original migration doc explicitly asked for and was previously impossible. A `pause`/`pauseat` command disarms it (stops a stale timer from firing a false "blocked" message after the user already paused).
- New effect subscribing to `window.syncwatch.playback.onVideoEvent(...)` (Electron only, no-ops entirely on the browser/web build): updates `localTime`/`localPlaying`/`startedAt` from real event data on `playing`/`pause`/`seeked`, sets/clears `buffering` on `waiting`/`playing`, sets a terminal `'■ Ended'` status on `ended`, and silently ground-truth-corrects `localTime`/`startedAt` on `timeupdate` (deliberately does NOT call `setStatus` on every `timeupdate` — that fires several times a second and the status text doesn't actually change, so doing so would just be wasted re-renders).
- `loadUrl()` now resets `buffering`/`playConfirmed` when loading a new stream, so a stale "blocked" or "buffering" indicator from the previous video doesn't linger on screen before the new page's events start arriving.

## Deliberate design decision: Option A, no wire-protocol changes
Per the phase doc's own framing, this was a choice between (A) keep `VIDEO_STATE`/`server/messageTypes.js` exactly as-is and treat event-driven accuracy as a purely client-side improvement, or (B) extend the protocol so a host's real buffering/confirmation state broadcasts to peers too. **Chose Option A.** None of Phase 3's new event handling re-broadcasts anything over the WebSocket — it only corrects this client's own local tracking and status display. Reasoning: re-broadcasting native video events risked feedback loops (everyone's own video firing events back into the room) for a problem that doesn't have a demonstrated need yet, and the original spec explicitly prioritizes not touching the network protocol unless clearly necessary. `server/`, `server/messageTypes.js` — **untouched**.

## Known gaps, intentionally left for later phases
- **`'seeking'` event is received but currently a no-op** — deliberately, since `'seeked'` already confirms a landed seek; showing intermediate "seeking..." feedback for a slow seek on a poor connection would be reasonable future polish but wasn't required for this phase's acceptance bar.
- **No "confirmed vs pending" distinction for ordinary play/pause/seek commands** beyond the autoplay-block case — the phase doc explicitly said to add this only if cheap, and skip if it risked over-engineering. Skipped intentionally; if wanted later, `refreshStatus()` is the natural place to extend.
- Everything already flagged in `HANDOFF_PHASE_2.md`'s "Known gaps" section (fullscreen, DOM-overlay occlusion by the native view, position-only bounds-tracking gaps, real-aggregator nested-frame verification) is still open and untouched by this phase — none of it was in scope here.

## Bugs found and fixed during manual testing
Real-machine testing surfaced three genuine bugs — none were in the original phase plan, all confirmed fixed by the end of this phase:

### 1. `estimatedTime()` double-counted position on every play-after-pause
**Symptom:** pause/play cycles caused the video to jump forward by a large, compounding amount — roughly doubling each cycle (reported as "takes 4-5 pause/play cycles to skip an entire hour").

**Root cause:** `startedAt.current` is always computed as `Date.now() - correctedTime * 1000`, which already fully encodes the absolute playback position. `estimatedTime()` then added `localTime.current` on top of that while playing — double-counting. Invisible on the very first play ever (`localTime.current` starts at `0`), which is why it looked fine initially; became visible on every subsequent pause→play cycle once `localTime.current` held a real nonzero value.

**Fix:** `estimatedTime()` now returns `(Date.now() - startedAt.current) / 1000` directly while playing, no addition. Verified numerically with a standalone simulation before shipping: old formula produced `10s → 30s → 70s → 150s → 310s` over 5 cycles of 10s each; fixed formula produced the correct `10s → 20s → 30s → 40s → 50s`.

### 2. Pause command triggered a site auto-resume via unnecessary seeks
**Symptom:** clicking Pause caused a brief freeze/stutter, then the video resumed playing on its own.

**Root cause:** the pause command always forced an exact-`currentTime` seek alongside pausing (`pauseat`), even when drift was negligible. Some embed sites auto-resume playback after any seek (a "recovering from buffering" behavior).

**Fix:** `applyState`'s `'pause'` branch now only forces a seek when drift actually exceeds `DRIFT_THRESHOLD` (mirroring the same asymmetry already used for play/playfrom) — an ordinary pause no longer seeks at all. Also added defensive reassertion (`v.pause()` retried at 60ms/300ms) in `buildControlScript` for the cases where a seek genuinely is needed.

### 3. The real culprit: the site resumes video on hover, not on a timer
**Symptom:** after fix #2, pause still appeared to hold for "about 10 seconds" before resuming — investigated via a temporary diagnostic (`playback:debug-pause-test`, an isolated pause-and-poll script run directly through the existing `executeJavaScript` path, since opening a separate DevTools window for the `WebContentsView` itself turned out to be unreliable and was abandoned as a dead end). The diagnostic showed a raw, unforced `pause()` holding *perfectly* steady with zero drift for a full 10 seconds — which looked at first like a periodic site-side watchdog, but turned out to be coincidental: the real trigger, confirmed directly by the user, is that **cineby resumes playback whenever the mouse hovers back over the video**, regardless of elapsed time.

**Fix:** shadowed the video element's own `.play()` method directly (`buildControlScript`, guarded by `v.__syncwatchGuardInstalled` so it's only installed once per element) — any call to `.play()`, from anywhere, is refused while `window.__syncwatchPauseGuardActive` is true. Our own `pause`/`pauseat` commands set that flag true; `play`/`playfrom` set it false before calling the real `play()`. This intercepts the resume regardless of what triggers it (hover, a timer, or anything else that ultimately calls `.play()` on the same element), rather than reacting to one specific trigger. **Confirmed fixed by the user** — pause now holds through hover indefinitely.

**Note for later phases:** this guard is per-element (`v.__syncwatchGuardInstalled`). If a site ever replaces the `<video>` element itself (rather than just calling `.play()` on the existing one), the guard would need to be reinstalled on the new element — not currently handled, since it wasn't needed to fix the confirmed bug. Worth keeping in mind if a similar "resume" bug resurfaces on a different site with a different resume mechanism.

## A temporary diagnostic tool was added, kept in the codebase
`window.syncwatch.playback.debugPauseTest()` (callable from the main window's regular DevTools console) — calls `pause()` once, then samples `.paused`/`.currentTime` every 500ms for 10s, returning the full timeline. Left in place since it's harmless and cheap, and could be useful again if similar playback-interference bugs come up on other sites in the future. Not part of the app's normal UI.

## Manual test results (confirmed by the user on Windows, real Electron window, cineby.app as the test site)
1. Baseline playback (load, play, pause, seek, keyboard shortcuts) — **confirmed working**.
2. Pause/play cycle timing — **confirmed fixed** (bug #1 above).
3. Pause holding indefinitely, including through mouse hover — **confirmed fixed** (bugs #2 and #3 above).
4. Autoplay-block detection and buffering-status checks from the original test plan were not explicitly exercised — testing naturally focused on the pause bug that came up immediately. Not blocking; can be verified opportunistically later if either behavior is ever observed.
5. Regression check on the plain web/browser build was not explicitly re-run this phase (all testing happened in the Electron app) — worth a quick sanity check in Phase 4 if not done before then, though none of this phase's changes touch code paths the browser build executes (`isElectron`-gated throughout).

## Files changed/added this phase
- `electron/playback-preload.js` — new
- `electron/playback.js` — event-listener injection, ipc-message forwarding, updated `WebContentsView` webPreferences, pause-race defensive reassertion, `.play()` guard override, temporary `debugPauseTest` diagnostic
- `electron/preload.js` — `onVideoEvent` comment update, `debugPauseTest` binding exposed
- `electron/main.js` — captures the playback controller return value, registers `Ctrl+Shift+P` to open DevTools for the playback view (added during debugging; turned out unreliable for this purpose, kept as a harmless shortcut but the debug-pause-test path is what actually resolved the bug)
- `client-react/src/hooks/useSync.js` — event subscription, autoplay-block detection, buffering flag, `refreshStatus()`, `estimatedTime()` fix, pause branch's drift-gated seek
- No changes to `server/`, `Room.jsx`, `Player.jsx`, or anything else.

## Next step
Hand this file + the updated zip + `PHASE_4_legacy_cleanup_and_ux.md` to the next chat to harden layout/bounds tracking, retire the Tampermonkey path fully in Electron, add real error states, and tackle position-restore-on-reconnect. Worth doing the plain web/browser build regression check (item 5 above) early in that phase if it hasn't happened by then.

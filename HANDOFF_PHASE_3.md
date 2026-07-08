# HANDOFF_PHASE_3.md — Event-Driven Sync

## Status: Built and build-verified. Needs real-machine manual testing (this sandbox still can't launch a GUI — see HANDOFF_PHASE_1.md/2.md for why).

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

## Verification performed in the dev sandbox
- `npm run build` in `client-react/` succeeds with no errors after the `useSync.js` changes.
- `node --check` passes clean on `electron/playback.js`, `electron/playback-preload.js` (new), `electron/main.js`, `electron/preload.js`.
- Manual code review: event flow traced end-to-end (injected script → preload bridge → ipc-message → renderer channel → useSync subscription) for consistency; no dangling references to the old Phase-3-stub comments left in `preload.js`/`playback.js`.

**What genuinely needs a real run, on a real machine, before trusting this phase is done** (this sandbox still can't launch a GUI Electron window — see HANDOFF_PHASE_1.md):
1. `npm run electron:dev`, load a stream, confirm playback still works exactly as it did after Phase 2 (this phase shouldn't change baseline playback behavior, only sync accuracy/status feedback).
2. Watch the status text through a normal play → pause → seek → play cycle — should read `▶ In Sync` / `⏸ Paused at m:ss` / `⏩ m:ss` same as before, now backed by real events instead of pure estimation.
3. **Autoplay-block check**: find (or simulate) a case where `video.play()` gets rejected — e.g. an unmuted autoplay attempt some sites block — and confirm the status flips to `"⚠ Playback may be blocked — click the video"` after ~2.5s, then clears once the video actually starts (e.g. after a manual click makes it play).
4. **Buffering check**: throttle network (devtools or OS-level) or use a stream known to buffer, confirm `"⏳ Buffering…"` appears on a `waiting` event and clears on `playing`.
5. Load a second stream after the first — confirm no stale "blocked"/"buffering" text lingers momentarily from the previous one.
6. Regression: confirm the web/browser build (`localhost:3000` in a normal tab) is completely unaffected — no event subscription exists there, so behavior should be byte-for-byte the same as before this phase.

## Files changed/added this phase
- `electron/playback-preload.js` — new
- `electron/playback.js` — event-listener injection, ipc-message forwarding, updated `WebContentsView` webPreferences
- `electron/preload.js` — comment update only (onVideoEvent's channel is now actually fed)
- `client-react/src/hooks/useSync.js` — event subscription, autoplay-block detection, buffering flag, `refreshStatus()`
- No changes to `server/`, `Room.jsx`, `Player.jsx`, or anything else.

## Next step
Run the 6 manual checks above on a real machine. If they pass, hand this file + the updated zip + `PHASE_4_legacy_cleanup_and_ux.md` to the next chat to harden layout/bounds tracking, retire the Tampermonkey path fully in Electron, add real error states, and tackle position-restore-on-reconnect. If something fails, report back what broke — same caveat as the last two phases: this was built and reasoned through carefully but not run on a live window from this environment.

# HANDOFF_PHASE_4.md — Legacy Cleanup & UX Hardening

## Status: Complete and build-verified. Needs real-machine manual testing (this sandbox still can't launch a GUI — see HANDOFF_PHASE_1.md for why).

## What this phase covers
Phase 4 of the Electron migration, per `PHASE_4_legacy_cleanup_and_ux.md`: confirming Tampermonkey retirement, hardening layout/bounds tracking, adding real error states, and reconnect/position-restore.

## 1. Tampermonkey retirement — confirmed, no new work needed
This was already effectively true entering this phase (Phase 2/3 built the Electron path entirely on `WebContentsView` + direct `executeJavaScript`, never touching `client/syncwatch-bridge.user.js`). Verified this phase: `checkBridge()` in `Room.jsx` returns immediately when `sync.isElectron` is true, so the bridge-detection ping and its warning banner are structurally impossible to trigger on Electron. `client/syncwatch-bridge.user.js` remains in the repo untouched, serving only the browser/web fallback build, per the original migration spec.

## 2. Layout/bounds tracking hardened
**Problem (flagged in `HANDOFF_PHASE_2.md`):** the original bounds-tracking in `Player.jsx` used only a `ResizeObserver` + `window resize` listener — both fire on *size* changes, neither fires on a pure *position* change (e.g. a sidebar toggling in a way that shifts the player without resizing it).

**Fix:** replaced with a continuous `requestAnimationFrame` polling loop in `Player.jsx` that re-reads the real bounding rect every frame and only calls `setBounds()` when something actually changed (rounded to whole pixels, to avoid a stream of no-op IPC calls from sub-pixel layout jitter). This catches literally any layout change — position, size, a CSS transition, a window drag — rather than needing to enumerate every possible trigger. `ResizeObserver` and the resize listener are kept alongside it as harmless immediate triggers (they fire the same frame something happens, rather than waiting up to one animation frame for the loop to catch it), not because the loop needs help.

**Still open, deliberately not solved here:** any DOM element meant to visually overlay the video (e.g. `Room.jsx`'s "sync status" pill) still renders *behind* the native view once bounds are non-zero, since `WebContentsView` composites above regular page content within its bounds. This is a real, structural consequence of the architecture chosen in Phase 1, not a tracking bug — fixing it means either repositioning that UI outside the video area or insetting the view's bounds to leave a gap, which is a design decision for whoever picks it up next, not something this phase should decide unilaterally.

**Also still open:** fullscreen still doesn't work correctly on Electron (button calls `.requestFullscreen()` on the placeholder div, which doesn't affect the native view layered on top). Wasn't in this phase's explicit task list (`PHASE_4...md` doesn't mention it); left for Phase 5 or a dedicated pass, same as noted in `HANDOFF_PHASE_2.md`.

## 3. Real error states added
Two distinct failure modes, previously indistinguishable (or entirely invisible) on Electron:

- **`loadFailed` (Room.jsx, existing state, now actually wired for Electron too):** the page failed to load at all. `electron/playback.js`'s `playback:load-url` handler catches `loadURL()`'s own rejection and resolves with `{ok: false, error}` instead of throwing; `useSync.js`'s `loadUrl()` now returns that result as a promise (previously fire-and-forget, the failure was silently discarded); `Room.jsx`'s `applyStreamUrl()` checks it and sets `loadFailed` — same banner UI the browser path's iframe `onError` already used, now genuinely reachable from Electron too.
- **`videoNotFound` (new, `useSync.js`):** the page loaded fine, but no `<video>` element was ever found after the full ~10s retry budget (`waitForVideoAndRun` in `electron/playback.js`). Distinct because it's a different problem with a different likely fix (wrong page, needs a manual click, unsupported site) than a page that didn't load at all. Surfaced by reusing the existing `playback:video-event` channel with a synthetic `{type: 'no-video-found'}` message rather than adding a whole new IPC channel for one signal — any *real* event that arrives afterward (from a later frame loading, etc.) clears the flag automatically, since a real event is itself proof a video was found.

Both have their own dismissible banner in `Room.jsx` with a "Try again" button wired to the existing `reloadStream()`.

**Not built — a deliberate scope call, not an oversight:** a generic "commands time out with no event response" state, distinct from buffering. The original phase doc listed this as a nice-to-have. Phase 3's autoplay-block detection (`playConfirmed`/`refreshStatus`) already covers the one concrete instance of this that actually matters (a play command that never got confirmed) — building a fully generic timeout system for other commands wasn't justified without a demonstrated need.

## 4. Position-restore on reconnect
The original handoff (from before Phase 1) explicitly flagged this as unfinished: a refreshed/reconnected watcher didn't resume at the correct playback position. Implemented as a small, deliberately additive protocol extension — the one exception to "don't touch the server" in this whole migration, called out explicitly per the phase doc's own instructions:

- **`server/roomManager.js`:** rooms now track `lastVideoState: { state, currentTime, timestamp }`, updated via a new `setVideoState()` method. Included in both `join()` and `rejoinAsHost()`'s result objects, alongside the existing `streamUrl`/`chatHistory`.
- **`server/index.js`:** the `VIDEO_STATE` handler now calls `rooms.setVideoState(...)` alongside its existing broadcast (purely additive — doesn't change what's sent to already-connected peers, just remembers it for whoever joins next). `ROOM_CREATED` (host rejoin) and `ROOM_JOINED` (watcher join/rejoin) responses now include `lastVideoState`.
- **`client-react/src/pages/Lobby.jsx`:** persists `lastVideoState` to `sessionStorage` (`sw_initial_video_state`) alongside the existing `streamUrl`/`chatHistory`, for the "very first mount" recovery path.
- **`client-react/src/pages/Room.jsx`:** both recovery paths (`initialStreamUrl` from sessionStorage on first mount, `rejoinStreamUrl` from a live `ROOM_CREATED`/`ROOM_JOINED` while already mounted) now also call `sync.applyState(state, currentTime, timestamp)` ~800ms after loading the stream, if a `lastVideoState` was recovered. `applyState`'s existing drift-correction math handles this correctly with no special-casing needed: a large "drift" between a fresh `0` and the real remembered position naturally triggers its forced-seek path, and for a `'play'` state it already accounts for real time elapsed since the state was recorded (via the existing `age = (Date.now() - serverTimestamp) / 1000` calculation) — so a room that's been playing for 10 minutes since the last broadcast resumes 10 minutes further in, not frozen at the old timestamp.
- **`useSync.js`:** `applyState` is now exposed from the hook's return value so `Room.jsx` can call it directly for this purpose.

**Backward-compatible by construction:** `lastVideoState` is a new, optional field alongside existing ones — a room that never received a `VIDEO_STATE` message simply has it stay `null`, handled the same way `streamUrl` being `null` already was. The browser/web build receives this field too (nothing prevents it) but doesn't currently use it, which is fine and expected.

## Files changed this phase
- `client-react/src/components/Player.jsx` — rAF-based bounds tracking
- `client-react/src/hooks/useSync.js` — `videoNotFound` state, `loadUrl` returns a promise, `applyState` exposed
- `client-react/src/pages/Room.jsx` — `applyStreamUrl` checks load result, new `videoNotFound` banner, position-restore wiring in both recovery effects
- `client-react/src/pages/Lobby.jsx` — persists `lastVideoState` to sessionStorage
- `electron/playback.js` — sends synthetic `no-video-found` event when the retry budget is exhausted
- `electron/main.js` — corrected a comment about the (unreliable, per Phase 3) DevTools shortcut
- `server/roomManager.js` — `lastVideoState` tracking + `setVideoState()`
- `server/index.js` — records state on every `VIDEO_STATE` message, includes it in join/rejoin responses
- No changes to `client/syncwatch-bridge.user.js`, chat, voice, or the design system.

## Verification performed in the dev sandbox
- `npm run build` in `client-react/` succeeds with no errors after all changes.
- `node --check` passes clean on every changed file in `electron/` and `server/`.
- Manual code review: traced the full position-restore path end-to-end (VIDEO_STATE → roomManager → join/rejoin response → sessionStorage/live listener → Room.jsx recovery effect → applyState) for consistency.

**What genuinely needs a real run, on a real machine** (this sandbox still can't launch a GUI Electron window):
1. Load a stream, resize the window and toggle any UI panels while it's loaded — confirm the video area visually tracks correctly, including cases that only shift position without changing size.
2. Trigger a real load failure (e.g. an invalid/dead URL) — confirm the `loadFailed` banner appears with working Reload.
3. Trigger a real "no video found" case (e.g. a valid page with no video, or a site the control script's heuristic genuinely can't find a video on) — confirm the distinct `videoNotFound` banner appears, separately from `loadFailed`.
4. **Position restore, the main one to verify:** as host, load a stream, play for a bit, then refresh the Electron window (or have a watcher refresh their browser tab) — confirm playback resumes near the actual position, not from zero. Try this both paused and mid-playback (the latter should also roughly account for real time elapsed since the refresh).
5. Quick regression pass on the plain web/browser build — none of this phase's changes should affect it (all Electron-specific paths are `isElectron`-gated, and the new `lastVideoState` field is additive/optional), but worth a sanity check since it wasn't explicitly re-verified this phase either (noted as outstanding in `HANDOFF_PHASE_3.md` too).

## Next step
Run the 5 manual checks above on a real machine. If they pass, hand this file + the updated zip + `PHASE_5_packaging_and_polish.md` to the next chat for cross-platform packaging, a real app icon, and auto-update — the last phase in the original migration plan. If something fails, report back what broke, same as every prior phase in this migration.

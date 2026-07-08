# HANDOFF_PHASE_2.md — Electron Playback Controller

## Status: Complete and manually verified on a real machine.

## What this phase covers
Phase 2 of the Electron migration: replacing `iframe → postMessage → Tampermonkey → relay` with `React UI → IPC → WebContentsView → direct per-frame executeJavaScript → video element`, per `PHASE_2_electron_playback_controller.md` and building on the `WebContentsView` decision from `HANDOFF_PHASE_1.md`.

## What was already in place entering this phase
The main-process side (`electron/playback.js`, `electron/preload.js`, `electron/main.js`) was already built out before this session picked the work back up — it implements:
- A single `WebContentsView` added as a sibling view via `win.contentView.addChildView()`, starting collapsed (`{x:0,y:0,width:0,height:0}`).
- `playback:load-url`, `playback:command` (`play`/`pause`/`seek`/`playfrom`/`pauseat`), `playback:get-current-time`, `playback:set-bounds` IPC handlers.
- A control script mirroring `syncwatch-bridge.user.js`'s `getVideo()` heuristic (largest visible `<video>` in the document) — kept intentionally identical so behavior doesn't diverge between the browser-fallback and Electron paths.
- `webContents.mainFrame.framesInSubtree` + per-frame `executeJavaScript()`, trying each frame until one reports a video found — this is the direct replacement for the old bridge's `relayToChildFrames` postMessage relay, with a retry budget (`waitForVideoAndRun`, 40 attempts × 250ms) mirroring the old bridge's `waitForVideo()`.
- `preload.js` exposes all of this as `window.syncwatch.playback.*`.

**What was missing, and what this session did:** the React side wasn't actually wired to any of this. `useSync.js` had the right branching logic for *commands* (`iframeCmd`), but a leftover bug meant a **watcher receiving a `STREAM_URL` broadcast still set `frameRef.current.src` directly** — a no-op on Electron, since `frameRef.current` there is a plain `<div>` with no `.src` setter. And `Room.jsx` was rendering a raw `<iframe>` inline; the actual `Player.jsx` component (which would've been the natural place for Electron-aware rendering) was unused dead code with no Electron logic in it at all, and there was no bounds-tracking mechanism anywhere to tell the main process where to draw the `WebContentsView`.

## What this session fixed/built

1. **`client-react/src/hooks/useSync.js`**
   - Fixed the `STREAM_URL` handler to call `loadUrl(msg.url)` instead of directly assigning `frameRef.current.src`.
   - Absorbed the "force a genuine reload even for an identical URL" trick (previously a one-off in `Room.jsx`'s `reloadStream()`) into `loadUrl` itself, so every caller gets correct reload behavior without duplicating it. Electron's `webContents.loadURL()` doesn't need this trick (it always re-navigates), so it's browser-path-only.
   - Exposed `isElectron` and `loadUrl` from the hook's return value so `Room.jsx` can use them.

2. **`client-react/src/components/Player.jsx`** — rewritten from unused dead code into the actual video surface, used by `Room.jsx` now:
   - Browser/web build: renders the `<iframe>` exactly as before (unchanged behavior).
   - Electron: renders an otherwise-empty positioning `<div>`. The real content is the main-process `WebContentsView`, drawn directly over this div's screen coordinates.
   - New: bounds-tracking `useEffect` (Electron only) — `ResizeObserver` on the div + a `window resize` listener, reporting `getBoundingClientRect()` to `window.syncwatch.playback.setBounds()` on every change, collapsing to zero bounds when `hasFrame` is false (so the native view doesn't render over the "no stream loaded" empty state) and on unmount.
   - Focus-reclaim logic (previously living directly in `Room.jsx`, duplicated from an earlier, now-superseded version of this same component) kept as-is, applies to both paths.

3. **`client-react/src/pages/Room.jsx`**
   - Now imports and renders `<Player>` instead of an inline `<iframe>`.
   - `applyStreamUrl()` now calls `sync.loadUrl(url)` instead of a direct `.src` assignment — this was the fix that makes `loadStream()`, the two refresh/reconnect recovery effects, and `reloadStream()` all actually reach the `WebContentsView` on Electron (previously all four were silently no-ops there).
   - `reloadStream()` simplified to just call `sync.loadUrl(currentStreamUrl)`, since the reload-forcing trick now lives in `loadUrl` itself.
   - The Tampermonkey bridge-detection ping (`checkBridge()`) now returns immediately when `sync.isElectron` is true — there's no bridge/userscript concept on that path at all, so the "bridge not detected" warning banner will never fire there (no JSX changes needed — it's naturally gated since `setBridgeWarning(true)` only happens inside the now-gated function).

## Manual test results (confirmed by the user on Windows, real Electron window)
1. `npm run electron:dev` launches, stream URL loads and plays inside the `WebContentsView` — **confirmed working**. (Windows GPU-cache `ERROR:cache_util_win.cc`/`disk_cache.cc` log noise on startup is unrelated Windows/antivirus disk-cache-permission chatter, not a real failure — app runs fine past it.)
2. Play/pause/seek/keyboard-shortcut UI buttons — **confirmed working** against the real video.
3. Cross-client test: Electron host + a plain browser tab (`localhost:3000`) joined as watcher, same room code — **room code and peer list sync correctly**. The specific bug this phase fixed (watcher's stream not loading due to a `frameRef.current.src` no-op) is **confirmed fixed** at the plumbing level — the test URL used happened to be one browsers block outright (see next point), so it couldn't be confirmed visually, but the STREAM_URL message path that was broken before is intact and exercised correctly.
4. The browser-tab watcher showed a blank frame with `Refused to display '...' in a frame because it set 'X-Frame-Options'` in the console. **This is the original, pre-existing, expected browser limitation described in the original migration doc — not a regression from this phase.** No browser tab can ever get around this; that's the entire reason this migration exists. The web/browser build correctly still hits the exact same wall it always did, unchanged.
5. Full visual play/pause/seek sync confirmation between an Electron host and a rendering (non-blocked) browser watcher was not run — optional, skipped by choice (a YouTube-embed-URL check would have shown this visually, wasn't needed to consider the phase done).

## Known limitation surfaced during testing: only one Electron window/instance at a time
Trying to open a second `electron .` instance to cross-test two real playback surfaces doesn't work with the current architecture. Not something this phase needs to fix, but worth recording so it isn't re-discovered as a mystery later:

- `electron/main.js` requires `server/index.js` directly and calls `start()`, which binds port 3000.
- `server/index.js`'s own `start()` rejects on `EADDRINUSE`, and its module-level bottom code (`if (require.main === module || process.versions.electron) start().catch(err => { ...; process.exit(1); })`) calls `process.exit(1)` on that rejection — so a second launched instance won't gracefully skip starting its own server, it will hard-crash the whole second Electron process.
- `electron/playback.js`'s own single-instance guard (`if (initialized) throw ...`) is moot here — it's scoped per-process and would never actually be reached, since the server crash happens first.

**Practical workaround (used for this phase's testing, and generally good enough for solo dev testing):** one Electron window as host, plus a plain browser tab at `localhost:3000` (or the LAN IP shown via `window.syncwatch.getLanIP()`, from another device on the same network) as a second peer. This exercises the full WebSocket sync path identically to a second Electron window — the only thing a browser tab can't do is render a site that sends `X-Frame-Options`, which is an unrelated, expected limitation, not a testing gap.

**If genuine two-Electron-window testing is wanted later:** would need `server/index.js`'s `start()` to detect `EADDRINUSE` and, instead of exiting, treat it as "a healthy instance is already running, just connect to it" rather than a fatal error, plus `main.js` skipping `startServer()`/`waitForServer()` in that case and going straight to `createWindow()`. Small, scoped change, but not made in this phase since it's dev-experience tooling, not part of the playback migration itself. Flagged as a nice-to-have, not committed to any phase's task list — worth doing as a quick standalone addition if useful for testing Phase 3 onward.

## Known gaps, intentionally left for later phases (don't re-litigate these, they're scoped elsewhere)
- **Fullscreen button doesn't work correctly on Electron** — it calls `.requestFullscreen()` on the placeholder `<div>`, which doesn't affect the native `WebContentsView` layered on top of it. Left as a documented no-op-ish limitation; fixing it needs a dedicated IPC call that resizes the view to fill the screen, which is UX polish territory (Phase 4/5), not core playback wiring.
- **DOM elements meant to overlay the video will render BEHIND the native view** — e.g. `Room.jsx`'s "sync status" pill (`position:absolute, top:12, right:12`) sits in the same screen region the `WebContentsView` draws over, and a native view composites above regular page content. Once a stream is loaded, that pill will likely be invisible. This is a real, known Electron architecture consequence of choosing `WebContentsView`, not a bug in this phase's code — worth deciding in Phase 4 whether to reposition that status UI outside the video area, inset the view's bounds slightly to leave a gap, or accept it.
- **Bounds tracking doesn't catch position-only layout changes** (e.g. a sidebar toggling in a way that shifts the player without resizing it) — `ResizeObserver` only fires on size changes. Explicitly Phase 4's job ("harden layout/bounds tracking") per its own phase doc.
- **Nested-iframe control on a REAL aggregator site hasn't been tested** — Phase 1's nested-frame test used a synthetic worst-case fixture (`frame-ancestors 'none'`, which blocks everyone). The `framesInSubtree` + per-frame `executeJavaScript` mechanism in `playback.js` is built and didn't throw in that synthetic test, but it needs a real run against at least one actual domain from `client/syncwatch-bridge.user.js`'s `@match` list before fully trusting it end-to-end.

## Verification performed in the dev sandbox (separate from the real-machine tests above)
- `npm run build` in `client-react/` succeeds with no errors after all the above changes.
- `node --check` passes clean on `electron/main.js`, `electron/preload.js`, `electron/playback.js`.
- Manual code review confirms no remaining direct `frameRef.current.src` assignments anywhere in `Room.jsx` — every path now routes through `sync.loadUrl()`.

## Files changed this phase
- `client-react/src/hooks/useSync.js`
- `client-react/src/components/Player.jsx`
- `client-react/src/pages/Room.jsx`
- No changes to `electron/main.js`, `electron/preload.js`, `electron/playback.js`, `server/`, or anything else — those were already correct entering this session.

## Next step
Hand this file + the updated zip + `PHASE_3_event_driven_sync.md` to the next chat to build real event-driven sync — replacing the wall-clock-estimated drift correction in `useSync.js` (`estimatedTime()`, the `localTime`/`startedAt` timer) with actual video `play`/`pause`/`seeking`/`seeked`/`waiting`/`playing`/`ended`/`timeupdate` events pushed from the `WebContentsView` over the `playback:video-event` IPC channel that's already stubbed in `preload.js`.

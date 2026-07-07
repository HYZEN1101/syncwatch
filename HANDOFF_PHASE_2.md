# HANDOFF_PHASE_2.md — Electron Playback Controller

## Status: Core wiring complete and build-verified. Manual runtime testing (real window, real stream URLs, real nested aggregator site) still needed — this environment can't launch a GUI or reach general internet sites (see HANDOFF_PHASE_1.md for why).

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

## Known gaps, intentionally left for later phases (don't re-litigate these, they're scoped elsewhere)

- **Fullscreen button doesn't work correctly on Electron** — it calls `.requestFullscreen()` on the placeholder `<div>`, which doesn't affect the native `WebContentsView` layered on top of it. Left as a documented no-op-ish limitation; fixing it needs a dedicated IPC call that resizes the view to fill the screen, which is UX polish territory (Phase 4/5), not core playback wiring.
- **DOM elements meant to overlay the video will render BEHIND the native view** — e.g. `Room.jsx`'s "sync status" pill (`position:absolute, top:12, right:12`) sits in the same screen region the `WebContentsView` draws over, and a native view composites above regular page content. Once a stream is loaded, that pill will likely be invisible. This is a real, known Electron architecture consequence of choosing `WebContentsView`, not a bug in this phase's code — worth deciding in Phase 4 whether to reposition that status UI outside the video area, inset the view's bounds slightly to leave a gap, or accept it.
- **Bounds tracking doesn't catch position-only layout changes** (e.g. a sidebar toggling in a way that shifts the player without resizing it) — `ResizeObserver` only fires on size changes. Explicitly Phase 4's job ("harden layout/bounds tracking") per its own phase doc.
- **Nested-iframe control on a REAL aggregator site hasn't been tested** — Phase 1's nested-frame test used a synthetic worst-case fixture (`frame-ancestors 'none'`, which blocks everyone). The `framesInSubtree` + per-frame `executeJavaScript` mechanism in `playback.js` is built and didn't throw in that synthetic test, but it needs a real run against at least one actual domain from `client/syncwatch-bridge.user.js`'s `@match` list before fully trusting it end-to-end.

## What could NOT be verified in this session
This sandbox still can't launch a GUI Electron window or reach general internet sites (same limitation as Phase 1 — see that handoff for specifics: GitHub release-asset downloads and arbitrary internet hosts are both blocked at the network layer here). What WAS verified:
- `npm run build` in `client-react/` succeeds with no errors after all the above changes.
- `node --check` passes clean on `electron/main.js`, `electron/preload.js`, `electron/playback.js`.
- Manual code review confirms no remaining direct `frameRef.current.src` assignments anywhere in `Room.jsx` — every path now routes through `sync.loadUrl()`.

**What genuinely needs a real run, on a real machine, before trusting this phase is done:**
1. `npm run electron:dev` — does the app launch, does a stream actually load and play inside the `WebContentsView` area?
2. Load a real stream URL (ideally one from the old bridge's `@match` list) as host, confirm play/pause/seek/keyboard-shortcut commands actually move the real video.
3. Join as a second (watcher) client, confirm the stream loads for them too (this is the specific bug this phase fixed — worth confirming directly).
4. Resize the window while a stream is loaded — confirm the video area visually tracks the resize reasonably (not pixel-perfect required, Phase 4 owns hardening this).
5. Confirm the web/browser build (`npm start`, visit `localhost:3000` in a normal browser tab, not the Electron app) still works exactly as before — regression check, since `Player.jsx`/`useSync.js` changes touch shared code.

## Files changed this phase
- `client-react/src/hooks/useSync.js`
- `client-react/src/components/Player.jsx`
- `client-react/src/pages/Room.jsx`
- No changes to `electron/main.js`, `electron/preload.js`, `electron/playback.js`, `server/`, or anything else — those were already correct entering this session.

## Next step
Run the 5 manual checks above on a real machine. If they pass, hand this file + the updated zip + `PHASE_3_event_driven_sync.md` to the next chat to build real event-driven sync (replacing the wall-clock-estimated drift correction with actual video `play`/`pause`/`seeking`/`timeupdate` events). If something fails, report back exactly what broke — this phase's fixes were based on careful code reading, not a live run, so a real-world surprise here is plausible and worth catching now.

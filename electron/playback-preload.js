// electron/playback-preload.js
//
// This is a SEPARATE preload from electron/preload.js — that one is attached
// to the app's own main window (exposes window.syncwatch.* to the SyncWatch
// UI itself). This one is attached to the WebContentsView that loads
// third-party streaming sites (see createPlaybackController in playback.js).
//
// Phase 3 needs a way for a real, persistent <video> event listener —
// injected into the loaded page via executeJavaScript — to push events back
// to the main process as they happen. executeJavaScript alone can only
// return a one-shot result; it can't stream events. This preload bridges
// that gap: it runs in an isolated world but exposes a single function into
// the page's own main world via contextBridge, which the injected listener
// script (buildEventListenerScript in playback.js) calls on every video
// event. That call becomes a normal ipcRenderer.send, which the main process
// picks up via view.webContents.on('ipc-message', ...) in playback.js.
//
// nodeIntegrationInSubFrames must be true on the WebContentsView's
// webPreferences for this to also load in nested iframes (the aggregator/
// CDN-player case) — see playback.js.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('syncwatchInternal', {
  reportEvent: (payload) => ipcRenderer.send('playback:internal-video-event', payload),
});

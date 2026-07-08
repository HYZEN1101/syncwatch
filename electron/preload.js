const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('syncwatch', {
  getLanIP:     () => ipcRenderer.invoke('get-lan-ip'),
  getTunnelUrl: () => ipcRenderer.invoke('get-tunnel-url'),
  startTunnel:  () => ipcRenderer.invoke('start-tunnel'),
  version:      process.env.npm_package_version || '1.0.0',
  platform:     process.platform,

  // Phase 2 — replaces postMessage/iframe/Tampermonkey playback control.
  // client-react/src/hooks/useSync.js and client-react/src/components/
  // Player.jsx feature-detect this object's presence to decide whether to
  // use this path or fall back to the browser/iframe path.
  playback: {
    loadUrl:        (url)      => ipcRenderer.invoke('playback:load-url', url),
    command:        (action, seconds) => ipcRenderer.invoke('playback:command', { action, seconds }),
    getCurrentTime: ()         => ipcRenderer.invoke('playback:get-current-time'),
    // Temporary diagnostic — see electron/playback.js's
    // buildDebugPauseTestScript for what this actually does. Callable
    // directly from the MAIN window's regular DevTools console (which,
    // unlike opening a separate DevTools window for the video view itself,
    // works reliably): window.syncwatch.playback.debugPauseTest().then(r => console.log(r))
    debugPauseTest: ()         => ipcRenderer.invoke('playback:debug-pause-test'),
    setBounds:      (rect)     => ipcRenderer.invoke('playback:set-bounds', rect),
    // Phase 3: electron/playback.js forwards real <video> events here
    // (play/pause/seeking/seeked/waiting/playing/ended/timeupdate) as they
    // happen, via an injected listener script + a dedicated preload
    // (electron/playback-preload.js) attached to the WebContentsView itself.
    onVideoEvent: (callback) => {
      const wrapped = (_event, payload) => callback(payload);
      ipcRenderer.on('playback:video-event', wrapped);
      return () => ipcRenderer.removeListener('playback:video-event', wrapped);
    },
  },
});

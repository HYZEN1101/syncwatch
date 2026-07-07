// electron/playback.js
//
// Phase 2 of the Electron migration — replaces the old browser architecture:
//   React UI → postMessage → <iframe> → Tampermonkey → relay through nested
//   iframes → video element
// with:
//   React UI → IPC → WebContentsView → direct per-frame executeJavaScript →
//   video element
//
// Why WebContentsView and not <webview>: see HANDOFF_PHASE_1.md. Short
// version — both bypass X-Frame-Options for a top-level embed in this
// Electron version, but WebContentsView is Electron's currently-supported
// API (BrowserView, which it replaces, was deprecated in Electron 30 — the
// version this project is pinned to); <webview> is explicitly documented by
// Electron as unsupported with no guarantee its current behavior persists.
//
// Why no relay bridge: the old Tampermonkey script had to relay commands
// through nested iframes via postMessage because a normal page script can't
// reach into a cross-origin iframe's DOM (same-origin policy). This module
// uses `webContents.mainFrame.framesInSubtree`, a privileged main-process
// API, to call `executeJavaScript()` directly on any frame in the loaded
// page — including nested ones — without needing the target page to be
// running any injected script of its own. Confirmed working in Phase 1
// testing (frame discovery + per-frame executeJavaScript didn't throw, even
// against a frame whose navigation was itself blocked).
//
// Known open item carried from HANDOFF_PHASE_1.md: the nested-frame test
// used a synthetic worst-case fixture (frame-ancestors 'none'). Real
// aggregator/CDN-player nested iframes are typically more permissive (they
// allow their specific known parent) — this should still be verified
// against a couple of real domains from client/syncwatch-bridge.user.js's
// @match list during this phase's manual testing.

const { WebContentsView, ipcMain } = require('electron');

// ── The injected control script ─────────────────────────────────────────────
//
// Mirrors syncwatch-bridge.user.js's getVideo() heuristic exactly (largest
// visible <video> in the current document) so behavior stays consistent
// with whatever the browser/web build still does via the bridge. Built as a
// function so `action`/`seconds` can be safely embedded as JSON literals
// rather than string-concatenated (avoids injection bugs entirely).
function buildControlScript(action, seconds) {
  const actionLiteral  = JSON.stringify(action);
  const secondsLiteral = JSON.stringify(seconds ?? 0);
  return `
    (function () {
      function getVideo() {
        const videos = [...document.querySelectorAll('video')];
        if (!videos.length) return null;
        return videos.reduce((best, v) => {
          const area = v.offsetWidth * v.offsetHeight;
          const bestArea = best.offsetWidth * best.offsetHeight;
          return area > bestArea ? v : best;
        });
      }
      const v = getVideo();
      if (!v) return { found: false };
      switch (${actionLiteral}) {
        case 'play':     v.play().catch(() => {}); break;
        case 'pause':    v.pause(); break;
        case 'seek':     v.currentTime = ${secondsLiteral}; break;
        case 'playfrom': v.currentTime = ${secondsLiteral}; v.play().catch(() => {}); break;
        case 'pauseat':  v.currentTime = ${secondsLiteral}; v.pause(); break;
        // '__read__' (or any unrecognized action) falls through here on
        // purpose — used by getCurrentTime() below to read state without
        // touching playback.
      }
      return { found: true, currentTime: v.currentTime, paused: v.paused, duration: v.duration };
    })();
  `;
}

// Tries every frame in the loaded page (main frame first, matching the old
// bridge's "prefer the top frame's own video" behavior), running the given
// script in each until one reports a video was found. A frame throwing
// (e.g. torn down mid-call) is treated the same as "no video here" and we
// move on to the next one, rather than failing the whole command.
async function runOnFirstFrameWithVideo(webContents, script) {
  let frames;
  try {
    frames = webContents.mainFrame.framesInSubtree;
  } catch (e) {
    return null; // webContents may be mid-navigation/destroyed
  }
  for (const frame of frames) {
    try {
      const result = await frame.executeJavaScript(script);
      if (result && result.found) return result;
    } catch (e) {
      // Cross-origin/blocked/torn-down frame — try the next one.
    }
  }
  return null;
}

// Retries across all frames for a while — a lazily-rendered player (common
// on aggregator sites) may not have inserted its <video> tag yet right after
// navigation finishes. Mirrors the old bridge's waitForVideo() retry budget.
async function waitForVideoAndRun(webContents, script, attempts = 40, interval = 250) {
  for (let i = 0; i < attempts; i++) {
    const result = await runOnFirstFrameWithVideo(webContents, script);
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, interval));
  }
  return { found: false };
}

// One playback view per app (SyncWatch is single-window) — guards against
// double-registering the IPC handlers if this were ever called twice.
let initialized = false;

function createPlaybackController(win) {
  if (initialized) {
    throw new Error('createPlaybackController() called more than once — SyncWatch only expects one playback view per app.');
  }
  initialized = true;

  const view = new WebContentsView({
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  win.contentView.addChildView(view);
  // Starts collapsed — Player.jsx's ResizeObserver reports the real bounds
  // once the placeholder element it tracks actually mounts and has a size.
  view.setBounds({ x: 0, y: 0, width: 0, height: 0 });

  ipcMain.handle('playback:load-url', async (_event, url) => {
    if (typeof url !== 'string' || !url) return { ok: false, error: 'invalid url' };
    try {
      await view.webContents.loadURL(url);
      return { ok: true };
    } catch (e) {
      // Don't swallow this — Phase 4 owns turning this into a real "site
      // failed to load" UI state, but the signal needs to exist now.
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('playback:command', async (_event, { action, seconds } = {}) => {
    if (!action) return { found: false };
    const script = buildControlScript(action, seconds);
    return waitForVideoAndRun(view.webContents, script);
  });

  ipcMain.handle('playback:get-current-time', async () => {
    const script = buildControlScript('__read__', 0);
    // Single attempt, no retry budget — this is a poll, not a command that
    // must land; Phase 3 replaces this whole path with real pushed events.
    return runOnFirstFrameWithVideo(view.webContents, script) ?? { found: false };
  });

  ipcMain.handle('playback:set-bounds', (_event, rect) => {
    if (!rect) return false;
    view.setBounds({
      x: Math.round(rect.x || 0),
      y: Math.round(rect.y || 0),
      width: Math.max(0, Math.round(rect.width || 0)),
      height: Math.max(0, Math.round(rect.height || 0)),
    });
    return true;
  });

  // Phase 3 stub: the channel exists so the renderer can already register a
  // listener via preload's onVideoEvent(), but nothing pushes to it yet.
  // Real event capture (play/pause/seeking/seeked/waiting/playing/ended/
  // timeupdate) needs a persistent in-page listener forwarding through some
  // channel back to main — executeJavaScript alone only gives one-shot
  // results, it can't push a live event stream. Left for Phase 3 to design
  // properly (candidates: a preload attached to the view with
  // nodeIntegrationInSubFrames, or polling via getCurrentTime on an
  // interval as a simpler first cut).
  // ipcMain does NOT have a handler for 'playback:video-event' — it's a
  // send-channel (main → renderer), not invoke/handle.

  return view;
}

module.exports = { createPlaybackController };

const { app, BrowserWindow, shell, dialog, ipcMain, globalShortcut, Menu } = require('electron');
const path = require('path');
const fs   = require('fs');
const http = require('http');
const os   = require('os');
const { createPlaybackController } = require('./playback');
const { autoUpdater } = require('electron-updater');

const PORT = 3000;
let mainWindow = null;
let tunnelInst = null;

// ── LAN IP ─────────────────────────────────────────────────────────────────

function getLanIP() {
  const nets = os.networkInterfaces();
  for (const list of Object.values(nets)) {
    for (const iface of list) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return '127.0.0.1';
}

// ── Local config (currently just the ngrok authtoken) ──────────────────────
//
// A tiny JSON file in the app's userData folder — not localStorage/renderer
// storage, since this is read by startTunnel() here in the main process.
// The authtoken is a personal free-tier credential the HOST enters once;
// nothing about it is needed by anyone who just connects to the resulting
// tunnel URL (see chat history / HANDOFF notes for the reasoning on why
// ngrok replaced localtunnel as the default: localtunnel shows visitors a
// manual "confirm the host's IP" interstitial on first contact that a raw
// WebSocket client can't click through, which made it structurally unable
// to work for a friend's very first join).
function configPath() {
  return path.join(app.getPath('userData'), 'syncwatch-config.json');
}
function loadConfig() {
  try { return JSON.parse(fs.readFileSync(configPath(), 'utf8')); }
  catch { return {}; }
}
function saveConfig(cfg) {
  try { fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2)); }
  catch (e) { console.warn('[config] failed to save:', e.message); }
}

// ── Internet tunnel ────────────────────────────────────────────────────────
//
// Tries ngrok first if the user has configured an authtoken (free account,
// one-time setup — see Lobby.jsx's Tunnel Settings). Falls back to
// localtunnel otherwise, since that needs zero signup at all — but with an
// explicit warning attached, since it's known to fail for a friend's first
// connection attempt (the interstitial issue above). tunnelInfo is cached
// so repeated calls (or get-tunnel-url) don't spin up a second tunnel.
let tunnelInfo = null; // { url, provider, warning? }

async function startTunnel() {
  if (tunnelInfo) return tunnelInfo;

  const { ngrokAuthtoken } = loadConfig();
  if (ngrokAuthtoken) {
    try {
      const ngrok = require('@ngrok/ngrok');
      tunnelInst = await ngrok.forward({ addr: PORT, authtoken: ngrokAuthtoken });
      const url = tunnelInst.url();
      tunnelInfo = { url, provider: 'ngrok' };
      console.log(`🌐  ngrok tunnel → ${url}\n`);
      return tunnelInfo;
    } catch (e) {
      console.warn('[tunnel] ngrok failed, falling back to localtunnel:', e.message);
      // Falls through to localtunnel below rather than giving up entirely —
      // a bad/expired token shouldn't mean no tunnel at all.
    }
  }

  try {
    const localtunnel = require('localtunnel');
    tunnelInst = await localtunnel({ port: PORT });
    const url  = tunnelInst.url;
    tunnelInst.on('close', () => { tunnelInfo = null; tunnelInst = null; });
    tunnelInst.on('error', () => { tunnelInfo = null; tunnelInst = null; });
    tunnelInfo = {
      url,
      provider: 'localtunnel',
      warning: 'localtunnel shows new visitors a manual "confirm the host IP" page that a friend\'s first connection attempt can\'t get through automatically. Add a free ngrok authtoken in Tunnel Settings for a link that works immediately instead.',
    };
    console.log(`🌐  localtunnel → ${url}\n`);
    return tunnelInfo;
  } catch (e) {
    console.error('[tunnel] Failed to start (both ngrok and localtunnel unavailable):', e.message);
    return null;
  }
}

// ── IPC ────────────────────────────────────────────────────────────────────

ipcMain.handle('get-lan-ip',     ()  => getLanIP());
ipcMain.handle('get-tunnel-url', ()  => tunnelInfo);
ipcMain.handle('start-tunnel',   ()  => startTunnel());
ipcMain.handle('get-ngrok-token', () => loadConfig().ngrokAuthtoken || '');
ipcMain.handle('set-ngrok-token', (_event, token) => {
  const cfg = loadConfig();
  cfg.ngrokAuthtoken = (token || '').trim();
  saveConfig(cfg);
  return true;
});

// ── Embedded server ────────────────────────────────────────────────────────

function startServer() {
  // server/index.js checks (require.main === module || process.versions.electron)
  // so it will call server.listen() when required from Electron
  require('../server/index.js');
}

// ── Wait for server ────────────────────────────────────────────────────────

function waitForServer(retries = 30) {
  return new Promise((resolve, reject) => {
    function attempt(n) {
      http.get(`http://localhost:${PORT}`, () => resolve())
        .on('error', () => {
          if (n <= 0) reject(new Error('Server did not start — port 3000 may be in use.'));
          else setTimeout(() => attempt(n - 1), 200);
        });
    }
    attempt(retries);
  });
}

// ── Window ─────────────────────────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width:     1280,
    height:    800,
    minWidth:  900,
    minHeight: 600,
    title:     'SyncWatch',
    webPreferences: {
      nodeIntegration:  false,
      contextIsolation: true,
      preload:          path.join(__dirname, 'preload.js'),
    },
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#0d0d0d',
  });

  mainWindow.loadURL(`http://localhost:${PORT}`);

  // Open all target=_blank links in the system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });

  // Phase 2: the playback surface — a WebContentsView sitting alongside the
  // main window's own page, positioned by Player.jsx's ResizeObserver. See
  // electron/playback.js for the full rationale and HANDOFF_PHASE_1.md for
  // why this API was chosen over <webview>.
  const playback = createPlaybackController(mainWindow);

  // Diagnostic shortcut: attempts to open DevTools for the actual video
  // view (a WebContentsView is a fully separate webContents from the main
  // window, so the regular DevTools on Ctrl+Shift+I can't see into it at
  // all). Note from HANDOFF_PHASE_3.md: this turned out unreliable in
  // testing — opening it visibly broke the view's rendering — and the bug
  // that motivated adding it was actually solved via
  // window.syncwatch.playback.debugPauseTest() instead (callable from the
  // MAIN window's normal, working DevTools console). Kept registered since
  // it's harmless and occasionally still worth trying, but don't rely on it.
  globalShortcut.register('CommandOrControl+Shift+P', () => {
    playback.openDevTools();
  });

  // Menu.setApplicationMenu(null) above removes Electron's default menu
  // entirely, including the keyboard shortcuts that used to come along
  // with it for free (Ctrl+Shift+I for DevTools, Ctrl+R to reload) — worth
  // keeping those explicitly since they're genuinely useful for debugging,
  // same pattern as the playback-DevTools shortcut above.
  globalShortcut.register('CommandOrControl+Shift+I', () => {
    mainWindow?.webContents.toggleDevTools();
  });
  globalShortcut.register('CommandOrControl+R', () => {
    mainWindow?.webContents.reload();
  });
}

// ── Auto-update ────────────────────────────────────────────────────────────
//
// Phase 5. Uses electron-updater against whatever provider is configured in
// package.json's build.publish block — currently a GitHub Releases
// placeholder (see that file: owner/repo need to be filled in with a real
// GitHub repo before this does anything). Until that's configured and an
// actual release is published there, checkForUpdates() will just fail
// quietly (caught below) — this is expected, not a bug, for anyone running
// from source or before release infrastructure exists.
//
// Deliberately NOT run in dev (npm run electron:dev): autoUpdater expects a
// packaged app's structure (app-update.yml etc.) and errors out oddly
// against an unpackaged one — app.isPackaged is the standard guard for this.
function initAutoUpdate() {
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;

  autoUpdater.on('error', (err) => {
    // Deliberately quiet — the overwhelmingly common cause is "no
    // publish infrastructure configured yet" or "no internet," neither of
    // which the user can do anything about from an error dialog. Logged
    // for whoever's looking at the console, not surfaced as a popup.
    console.warn('[auto-update] check failed (expected until a release feed is configured):', err.message);
  });

  autoUpdater.on('update-downloaded', (info) => {
    dialog.showMessageBox({
      type: 'info',
      title: 'Update ready',
      message: `SyncWatch ${info.version} has been downloaded.`,
      detail: 'Restart now to install it, or continue and it\'ll install next time you quit.',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1,
    }).then(({ response }) => {
      if (response === 0) autoUpdater.quitAndInstall();
    });
  });

  autoUpdater.checkForUpdates().catch(() => {
    // Same reasoning as the 'error' handler above — checkForUpdates()
    // itself can also reject directly rather than only emitting 'error'.
  });
}

// ── App lifecycle ──────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  // The default Electron menu (File/Edit/View/Window/Help) is pure
  // leftover clutter here — nothing in this app wires up any custom menu
  // items, and it visually clashes with the app's own themed header row
  // right below it. Removing it entirely rather than trying to re-theme a
  // native OS menu bar (which isn't meaningfully stylable anyway).
  Menu.setApplicationMenu(null);

  try {
    startServer();
    await waitForServer();
    createWindow();
    initAutoUpdate();
  } catch (err) {
    dialog.showErrorBox('SyncWatch — startup failed', err.message);
    app.quit();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  globalShortcut.unregisterAll();
  // Close tunnel cleanly
  if (tunnelInst) { try { tunnelInst.close(); } catch {} }
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (tunnelInst) { try { tunnelInst.close(); } catch {} }
});

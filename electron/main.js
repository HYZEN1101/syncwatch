const { app, BrowserWindow, shell, dialog, ipcMain } = require('electron');
const path = require('path');
const http = require('http');
const os   = require('os');
const { createPlaybackController } = require('./playback');

const PORT = 3000;
let mainWindow = null;
let tunnelUrl  = null;
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

// ── Internet tunnel ────────────────────────────────────────────────────────

async function startTunnel() {
  if (tunnelUrl) return tunnelUrl;
  try {
    const localtunnel = require('localtunnel');
    tunnelInst = await localtunnel({ port: PORT });
    tunnelUrl  = tunnelInst.url;
    tunnelInst.on('close', () => { tunnelUrl = null; tunnelInst = null; });
    tunnelInst.on('error', () => { tunnelUrl = null; tunnelInst = null; });
    return tunnelUrl;
  } catch (e) {
    console.error('[tunnel] Failed to start:', e.message);
    return null;
  }
}

// ── IPC ────────────────────────────────────────────────────────────────────

ipcMain.handle('get-lan-ip',     ()  => getLanIP());
ipcMain.handle('get-tunnel-url', ()  => tunnelUrl);
ipcMain.handle('start-tunnel',   ()  => startTunnel());

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
  createPlaybackController(mainWindow);
}

// ── App lifecycle ──────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  try {
    startServer();
    await waitForServer();
    createWindow();
  } catch (err) {
    dialog.showErrorBox('SyncWatch — startup failed', err.message);
    app.quit();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  // Close tunnel cleanly
  if (tunnelInst) { try { tunnelInst.close(); } catch {} }
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (tunnelInst) { try { tunnelInst.close(); } catch {} }
});

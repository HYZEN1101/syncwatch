// Phase 1 experiment harness.
// Run with: npm start (from inside this folder, after `npm install`)
//
// Four checks, in one window:
//   Panel A — <webview> loading a top-level fixture confirmed to send
//             X-Frame-Options/frame-ancestors (github.com)
//   Panel B — WebContentsView (sibling view, not DOM-nested) loading the
//             same top-level fixture
//   Panel C — <webview> loading a LOCAL page that itself contains a nested
//             <iframe src="github.com"> — tests the real "aggregator embeds
//             a restricted CDN player in an inner iframe" scenario
//   Panel D — WebContentsView loading that same nested-iframe local page
//   (separate, invisible) — video control test: executeJavaScript against a
//             local page with a real <video> tag, to confirm injection can
//             actually drive playback, independent of the framing question
//
// Results print to the console AND get written to results.json next to this file.

const { app, BrowserWindow, WebContentsView, ipcMain } = require('electron');
const path = require('path');
const fsp = require('fs').promises;

// ── Fixtures ─────────────────────────────────────────────────────────────
// Verify any fixture's headers yourself before trusting it: `curl -I <url>`.
// github.com was verified this way to send:
//   x-frame-options: deny
//   content-security-policy: ... frame-ancestors 'none' ...
const FIXTURE_BLOCKED = process.env.FIXTURE_URL || 'https://github.com';
const FIXTURE_VIDEO   = process.env.FIXTURE_VIDEO_URL || path.join(__dirname, 'test-video.html');
const FIXTURE_NESTED  = path.join(__dirname, 'test-nested-iframe.html');

const results = {
  webview: null,
  webContentsView: null,
  webviewNested: null,
  webContentsViewNested: null,
  videoControlTest: null,
};

function classifyFailure(errorCode, errorDescription) {
  // -20 is Chromium's ERR_BLOCKED_BY_RESPONSE, which is what X-Frame-Options /
  // frame-ancestors rejections surface as. Other codes are unrelated network issues.
  if (errorCode === -20 || /BLOCKED_BY_RESPONSE/i.test(errorDescription || '')) {
    return 'BLOCKED_BY_FRAME_RESTRICTION';
  }
  return `OTHER_FAILURE (${errorCode} ${errorDescription})`;
}

async function inspectLoadedPage(webContents, label) {
  try {
    const info = await webContents.executeJavaScript(`
      ({
        title: document.title,
        bodySnippet: document.body ? document.body.innerText.slice(0, 200) : null,
        videoFound: !!document.querySelector('video'),
      })
    `);
    console.log(`[${label}] loaded OK. title="${info.title}"`);
    return { loaded: true, blocked: false, ...info };
  } catch (e) {
    console.log(`[${label}] executeJavaScript failed after load:`, e.message);
    return { loaded: true, blocked: false, error: e.message };
  }
}

// Inspects the NESTED iframe specifically (not the outer page) using the
// privileged main-process frame API, which can reach into a cross-origin
// nested frame directly — something a normal same-origin-policy-bound page
// script could never do. This is what actually answers "did the inner
// aggregator/CDN iframe get blocked."
async function inspectNestedFrame(webContents, label) {
  try {
    const frames = webContents.mainFrame.framesInSubtree;
    const inner = frames.find(f => f !== webContents.mainFrame);
    if (!inner) {
      console.log(`[${label}] no nested frame found in subtree yet`);
      return { nestedFrameFound: false, allFrameUrls: frames.map(f => f.url) };
    }
    const innerInfo = await inner.executeJavaScript(`
      ({ title: document.title, bodySnippet: document.body ? document.body.innerText.slice(0,150) : null })
    `).catch(e => ({ error: e.message }));
    console.log(`[${label}] nested frame url=${inner.url}`, innerInfo);
    return { nestedFrameFound: true, nestedFrameUrl: inner.url, nestedFrameContent: innerInfo };
  } catch (e) {
    return { error: e.message };
  }
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1200,
    height: 900,
    webPreferences: {
      webviewTag: true,          // required to use <webview> at all
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile('index.html');

  // ── Track the two <webview> guests by attach order ──────────────────────
  // Panel A's webview (top-level fixture) attaches first in DOM order,
  // Panel C's webview (nested-iframe fixture) attaches second.
  let webviewAttachCount = 0;
  win.webContents.on('did-attach-webview', (_event, guestWebContents) => {
    webviewAttachCount += 1;
    const isNestedPanel = webviewAttachCount === 2;
    const label = isNestedPanel ? 'webview (nested-iframe panel C)' : 'webview (panel A)';
    console.log(`[${label}] guest attached`);

    guestWebContents.on('did-fail-load', async (_e, errorCode, errorDescription, _url, isMainFrame) => {
      if (!isMainFrame) return; // only care about the guest's own top navigation here
      const reason = classifyFailure(errorCode, errorDescription);
      console.log(`[${label}] did-fail-load: ${reason}`);
      const entry = { loaded: false, blocked: reason === 'BLOCKED_BY_FRAME_RESTRICTION', reason };
      if (isNestedPanel) results.webviewNested = entry; else results.webview = entry;
      await writeResults();
    });

    guestWebContents.on('did-finish-load', async () => {
      const info = await inspectLoadedPage(guestWebContents, label);
      if (isNestedPanel) {
        results.webviewNested = { ...info, ...(await inspectNestedFrame(guestWebContents, label)) };
      } else {
        results.webview = info;
      }
      await writeResults();
    });
  });

  // ── Panel B: WebContentsView, top-level fixture ─────────────────────────
  const viewB = new WebContentsView({ webPreferences: { contextIsolation: true, nodeIntegration: false } });
  win.contentView.addChildView(viewB);
  viewB.setBounds({ x: 600, y: 60, width: 560, height: 300 }); // matches #slotB in index.html, fixed rect for this experiment

  viewB.webContents.on('did-fail-load', async (_e, errorCode, errorDescription, _url, isMainFrame) => {
    if (!isMainFrame) return;
    const reason = classifyFailure(errorCode, errorDescription);
    console.log(`[WebContentsView B] did-fail-load: ${reason}`);
    results.webContentsView = { loaded: false, blocked: reason === 'BLOCKED_BY_FRAME_RESTRICTION', reason };
    await writeResults();
  });

  viewB.webContents.on('did-finish-load', async () => {
    results.webContentsView = await inspectLoadedPage(viewB.webContents, 'WebContentsView B');
    try {
      results.webContentsView.framesInSubtree = viewB.webContents.mainFrame.framesInSubtree.map(f => f.url);
    } catch (e) { /* ignore */ }
    await writeResults();
  });

  console.log(`Loading top-level fixture into panels A/B: ${FIXTURE_BLOCKED}`);
  viewB.webContents.loadURL(FIXTURE_BLOCKED);

  // ── Panel D: WebContentsView, nested-iframe fixture ─────────────────────
  const viewD = new WebContentsView({ webPreferences: { contextIsolation: true, nodeIntegration: false } });
  win.contentView.addChildView(viewD);
  viewD.setBounds({ x: 600, y: 460, width: 560, height: 300 }); // matches #slotD in index.html

  viewD.webContents.on('did-finish-load', async () => {
    const info = await inspectLoadedPage(viewD.webContents, 'WebContentsView D (nested)');
    results.webContentsViewNested = { ...info, ...(await inspectNestedFrame(viewD.webContents, 'WebContentsView D (nested)')) };
    await writeResults();
  });

  console.log(`Loading nested-iframe fixture into panels C/D: ${FIXTURE_NESTED}`);
  viewD.webContents.loadFile(FIXTURE_NESTED);

  // ── Video control test (invisible, separate from the panels above) ─────
  const viewVideo = new WebContentsView({ webPreferences: { contextIsolation: true } });
  win.contentView.addChildView(viewVideo);
  viewVideo.setBounds({ x: 0, y: 0, width: 0, height: 0 }); // offscreen, we only care about control here

  viewVideo.webContents.on('did-finish-load', async () => {
    try {
      const playResult = await viewVideo.webContents.executeJavaScript(`
        (() => {
          const v = document.querySelector('video');
          if (!v) return null;
          v.muted = true;
          return v.play().then(() => 'played').catch(err => 'play_rejected:' + err.message);
        })()
      `);
      const currentTime = await viewVideo.webContents.executeJavaScript(`document.querySelector('video')?.currentTime`);
      results.videoControlTest = { playResult, currentTimeAfterPlay: currentTime };
      console.log('[video control test]', results.videoControlTest);
      await writeResults();
    } catch (e) {
      results.videoControlTest = { error: e.message };
      await writeResults();
    }
  });
  viewVideo.webContents.loadFile(FIXTURE_VIDEO);

  ipcMain.handle('get-results', () => results);
});

async function writeResults() {
  await fsp.writeFile(
    path.join(__dirname, 'results.json'),
    JSON.stringify(results, null, 2)
  );
}

app.on('window-all-closed', () => app.quit());

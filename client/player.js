// ── player.js — video sync logic ──────────────────────────────────────────
// Globals expected from room.html: ws, code, role

const DRIFT_THRESHOLD = 2; // seconds before forcing a hard resync

var localPlaying  = false;
var localTime     = 0;       // best-effort position in seconds
var startedAt     = null;    // Date.now() when play last began
var bridgeReady   = false;   // true once the userscript bridge pongs back

const frame  = document.getElementById('player-frame');
const status = document.getElementById('sync-status');

// ── Bridge detection ──────────────────────────────────────────────────────
// The userscript running inside the iframe posts SYNCWATCH_BRIDGE_READY when
// it loads, and SYNCWATCH_PONG in response to pings. If we never hear back,
// we show a warning so the user knows to install the userscript.

window.addEventListener('message', (e) => {
  if (!e.data || typeof e.data !== 'object') return;
  if (e.data.type === 'SYNCWATCH_BRIDGE_READY' || e.data.type === 'SYNCWATCH_PONG') {
    bridgeReady = true;
    document.getElementById('bridge-status').style.display = 'none';
  }
});

function pingBridge() {
  try { frame.contentWindow.postMessage({ action: 'ping' }, '*'); } catch (_) {}
}

function showBridgeWarning() {
  if (bridgeReady) return;
  const el = document.getElementById('bridge-status');
  if (el) el.style.display = 'block';
}

// ── Time helpers ──────────────────────────────────────────────────────────

function estimatedTime() {
  if (!localPlaying || startedAt === null) return localTime;
  return localTime + (Date.now() - startedAt) / 1000;
}

function fmtTime(s) {
  s = Math.max(0, s);
  const m   = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

// ── Send a command into the iframe via postMessage ────────────────────────

function iframeCmd(action, seconds) {
  try {
    const msg = seconds !== undefined ? { action, seconds } : { action };
    frame.contentWindow.postMessage(msg, '*');
  } catch (_) {}
}

// ── Apply a state update ──────────────────────────────────────────────────

function applyState(state, serverTime, serverTimestamp) {
  const age           = (Date.now() - serverTimestamp) / 1000;
  const correctedTime = (state === 'play') ? serverTime + age : serverTime;
  const drift         = Math.abs(estimatedTime() - correctedTime);

  if (state === 'play') {
    localPlaying = true;
    startedAt    = Date.now() - correctedTime * 1000;
    if (drift > DRIFT_THRESHOLD) {
      // Seek then play as a single atomic command
      iframeCmd('playfrom', correctedTime);
    } else {
      iframeCmd('play');
    }
    status.textContent = '▶ Playing — synced';

  } else if (state === 'pause') {
    localPlaying = false;
    localTime    = correctedTime;
    startedAt    = null;
    iframeCmd('pauseat', correctedTime);
    status.textContent = `⏸ Paused at ${fmtTime(correctedTime)}`;

  } else if (state === 'seek') {
    localTime = correctedTime;
    startedAt = localPlaying ? Date.now() - correctedTime * 1000 : null;
    iframeCmd('seek', correctedTime);
    if (localPlaying) iframeCmd('play');
    status.textContent = `⏩ Seeked to ${fmtTime(correctedTime)}`;
  }
}

// ── Host / controller actions ─────────────────────────────────────────────

function loadStream() {
  const url = document.getElementById('stream-url').value.trim();
  if (!url) return;
  frame.src = url;
  status.textContent = 'Stream loaded — press ▶ Play when everyone is ready';
  ws.send({ type: 'STREAM_URL', url, code });

  // Ping bridge after a short delay to let the embed page load
  setTimeout(() => {
    pingBridge();
    // If no pong within 3 s, show install warning
    setTimeout(showBridgeWarning, 3000);
  }, 1500);
}

function sendPlay() {
  const t = estimatedTime();
  ws.send({ type: 'VIDEO_STATE', state: 'play', currentTime: t, code });
  applyState('play', t, Date.now());
}

function sendPause() {
  const t = estimatedTime();
  ws.send({ type: 'VIDEO_STATE', state: 'pause', currentTime: t, code });
  applyState('pause', t, Date.now());
}

function sendSeek(delta) {
  const t = Math.max(0, estimatedTime() + delta);
  ws.send({ type: 'VIDEO_STATE', state: 'seek', currentTime: t, code });
  applyState('seek', t, Date.now());
}

function handleOverlayClick() {} // stub for Phase 4

// ── Incoming messages ─────────────────────────────────────────────────────

ws.on('VIDEO_STATE', (msg) => {
  applyState(msg.state, msg.currentTime, msg.timestamp);
});

ws.on('STREAM_URL', (msg) => {
  if (role === 'watcher') {
    frame.src = msg.url;
    status.textContent = 'Stream loaded by host — waiting for ▶ Play…';
    setTimeout(() => {
      pingBridge();
      setTimeout(showBridgeWarning, 3000);
    }, 1500);
  }
});

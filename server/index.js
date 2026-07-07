const express    = require('express');
const { WebSocketServer } = require('ws');
const http       = require('http');
const path       = require('path');
const { RoomManager } = require('./roomManager');
const MSG        = require('./messageTypes');

const app  = express();
app.use(express.static(path.join(__dirname, '../client-react/dist')));
app.use('/install-bridge.html',      (_req, res) => res.sendFile(path.join(__dirname, '../client/install-bridge.html')));
app.use('/syncwatch-bridge.user.js', (_req, res) => res.sendFile(path.join(__dirname, '../client/syncwatch-bridge.user.js')));

let publicConfig = { publicUrl: null, wsUrl: null };
app.get('/_syncwatch/config', (_req, res) => res.json(publicConfig));

// Debug endpoint — visit http://localhost:3000/_syncwatch/rooms in a browser
// to see exactly what the server thinks exists right now. If you open this
// from BOTH machines/windows and they show DIFFERENT room lists for what
// you believe is the same room, you have two separate server processes —
// not a code bug.
app.get('/_syncwatch/rooms', (_req, res) => {
  const snapshot = [...rooms.rooms.entries()].map(([code, room]) => ({
    code,
    peerCount: room.peers.size,
    peers: [...room.peers].map(p => ({ id: p.id, name: p.displayName, role: p.role })),
  }));
  res.json({ pid: process.pid, port: process.env.PORT || 3000, activeRooms: snapshot });
});

const server = http.createServer(app);
const wss    = new WebSocketServer({ server });
const rooms  = new RoomManager();

function send(ws, obj) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}

function broadcast(code, obj, except = null) {
  const room = rooms.get(code);
  if (!room) return;
  for (const peer of room.peers) {
    if (peer !== except) send(peer, obj);
  }
}

wss.on('connection', (ws) => {
  ws.roomCode = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    handle(ws, msg);
  });

  ws.on('close', () => {
    if (ws.roomCode) {
      broadcast(ws.roomCode, { type: MSG.PEER_LEFT, peerId: ws.id, displayName: ws.displayName }, ws);
      rooms.leave(ws.roomCode, ws);
    }
  });
});

function handle(ws, msg) {
  switch (msg.type) {

    case MSG.CREATE_ROOM: {
      // RECONNECT/REFRESH PATH: if this client previously hosted a room
      // and that room still exists (within its grace period — e.g. the
      // tab got paused in DevTools, or the page was simply refreshed),
      // put them back into the SAME room instead of creating a brand
      // new one with a different code. The client tells us which code
      // to try via msg.previousCode.
      if (msg.previousCode) {
        const existing = rooms.get(msg.previousCode);
        if (existing && existing.host.displayName === msg.displayName) {
          const result = rooms.rejoinAsHost(msg.previousCode, ws);
          if (result.ok) {
            send(ws, {
              type: MSG.ROOM_CREATED, code: msg.previousCode, peerId: ws.id, role: 'host', rejoined: true,
              streamUrl: result.streamUrl, chatHistory: result.chatHistory,
            });
            return;
          }
        }
      }

      if (ws.roomCode) rooms.leave(ws.roomCode, ws);
      const code = rooms.create(ws, msg.displayName);
      send(ws, { type: MSG.ROOM_CREATED, code, peerId: ws.id, role: 'host' });
      break;
    }

    case MSG.JOIN_ROOM: {
      const code = String(msg.code || '').trim().toUpperCase().slice(0, 6);
      if (!code) { send(ws, { type: MSG.ERROR, reason: 'Invalid room code.' }); return; }
      if (ws.roomCode) rooms.leave(ws.roomCode, ws);
      const result = rooms.join(code, ws, msg.displayName);
      if (!result.ok) { send(ws, { type: MSG.ERROR, reason: result.reason }); return; }
      send(ws, {
        type: MSG.ROOM_JOINED, code, peerId: ws.id, role: 'watcher', peers: result.peers,
        // Bring a (re)joining peer up to speed automatically — this is
        // what makes a watcher's page refresh actually recoverable: they
        // get the current movie URL and recent chat without the host
        // needing to do anything.
        streamUrl: result.streamUrl, chatHistory: result.chatHistory,
      });
      broadcast(code, { type: MSG.PEER_JOINED, peerId: ws.id, displayName: msg.displayName }, ws);
      break;
    }

    case MSG.LEAVE_ROOM: {
      if (ws.roomCode) {
        broadcast(ws.roomCode, { type: MSG.PEER_LEFT, peerId: ws.id, displayName: ws.displayName }, ws);
        rooms.leave(ws.roomCode, ws);
        ws.roomCode = null;
      }
      break;
    }

    case MSG.VIDEO_STATE: {
      if (!ws.roomCode) return;
      if (!['play','pause','seek'].includes(msg.state)) return;
      broadcast(ws.roomCode, {
        type:        MSG.VIDEO_STATE,
        state:       msg.state,
        currentTime: Number(msg.currentTime) || 0,
        timestamp:   Date.now(),
      }, ws);
      break;
    }

    case MSG.STREAM_URL: {
      if (!ws.roomCode || ws.role !== 'host') return;
      const url = String(msg.url || '').trim();
      if (!url.startsWith('http')) { send(ws, { type: MSG.ERROR, reason: 'Invalid stream URL.' }); return; }
      rooms.setStreamUrl(ws.roomCode, url); // remember it for future (re)joiners
      broadcast(ws.roomCode, { type: MSG.STREAM_URL, url }, ws);
      break;
    }

    case MSG.VOICE_SIGNAL: {
      if (!ws.roomCode) return;
      const room = rooms.get(ws.roomCode);
      if (!room) return;
      const target = [...room.peers].find(p => p.id === msg.targetId);
      if (target) send(target, {
        type:     MSG.VOICE_SIGNAL,
        signal:   msg.signal,
        fromId:   ws.id,
        fromName: ws.displayName,
      });
      break;
    }

    case MSG.CHAT_MSG: {
      if (!ws.roomCode) return;
      const text = String(msg.text || '').trim();
      if (!text) return;
      const payload = {
        type:     MSG.CHAT_MSG,
        text:     text.slice(0, 500),
        fromName: ws.displayName,
        fromId:   ws.id,
        ts:       Date.now(),
      };
      rooms.addChatMessage(ws.roomCode, payload); // remember it for future (re)joiners
      broadcast(ws.roomCode, payload, ws);
      send(ws, { ...payload, self: true });
      break;
    }

    case MSG.PERMISSION_GRANT: {
      if (!ws.roomCode || ws.role !== 'host') return;
      const room = rooms.get(ws.roomCode);
      if (!room) return;
      for (const peer of room.peers) {
        if (peer.hasControl && peer.id !== msg.targetId) {
          peer.hasControl = false;
          broadcast(ws.roomCode, { type: MSG.PERMISSION_REVOKE, peerId: peer.id }, null);
        }
      }
      const target = [...room.peers].find(p => p.id === msg.targetId);
      if (!target || target.role === 'host') return;
      target.hasControl = true;
      broadcast(ws.roomCode, { type: MSG.PERMISSION_GRANT, peerId: target.id, displayName: target.displayName }, null);
      break;
    }

    case MSG.PERMISSION_REVOKE: {
      if (!ws.roomCode || ws.role !== 'host') return;
      const room = rooms.get(ws.roomCode);
      if (!room) return;
      const target = [...room.peers].find(p => p.id === msg.targetId);
      if (target) target.hasControl = false;
      broadcast(ws.roomCode, { type: MSG.PERMISSION_REVOKE, peerId: msg.targetId }, null);
      break;
    }
  }
}

app.get('*', (_req, res) =>
  res.sendFile(path.join(__dirname, '../client-react/dist/index.html'))
);

async function start() {
  const PORT = process.env.PORT || 3000;
  await new Promise((resolve, reject) => {
    server.listen(PORT, '0.0.0.0', resolve);
    server.once('error', err => {
      if (err.code === 'EADDRINUSE') {
        console.error(`\n❌  Port ${PORT} is already in use by another process.`);
        console.error(`    This usually means a PREVIOUS "npm start" is still running`);
        console.error(`    in another terminal window (closing the window doesn't`);
        console.error(`    always kill it). Find and stop it before starting again:`);
        console.error(`    Windows:  netstat -ano | findstr :${PORT}   (then taskkill /PID <pid> /F)`);
        console.error(`    Mac/Linux: lsof -i :${PORT}                  (then kill -9 <pid>)\n`);
        reject(err);
      } else {
        reject(err);
      }
    });
  });
  console.log(`\n✅  SyncWatch server → http://localhost:${PORT}  (pid ${process.pid})`);
  console.log(`💡  Empty rooms are kept alive for 30s before deletion, so a`);
  console.log(`    brief disconnect (DevTools pause, tab switch, network blip)`);
  console.log(`    won't destroy your room.`);
  console.log(`    If two browser windows can't see each other despite the same`);
  console.log(`    room code, check you only have ONE of these server processes`);
  console.log(`    running — the pid above should be the only "node" process`);
  console.log(`    bound to port ${PORT}.\n`);

  const token = process.env.NGROK_AUTHTOKEN;
  if (token) {
    try {
      const ngrok    = require('@ngrok/ngrok');
      const listener = await ngrok.forward({ addr: PORT, authtoken: token });
      const pub      = listener.url();
      const wsUrl    = pub.replace('https://', 'wss://').replace('http://', 'ws://');
      publicConfig   = { publicUrl: pub, wsUrl };
      console.log(`🌐  ngrok tunnel → ${pub}\n`);
    } catch (err) {
      console.warn('⚠️   ngrok failed:', err.message);
    }
  }
}

if (require.main === module || process.versions.electron) {
  start().catch(err => { console.error('Server error:', err); process.exit(1); });
}

module.exports = { broadcast, send, server, rooms };

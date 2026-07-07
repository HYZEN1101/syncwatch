// Unambiguous alphabet — excludes 0/O and 1/I/L to avoid codes that are
// hard to read aloud or copy correctly between friends.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const GRACE_PERIOD_MS = 30000; // 30s — long enough to survive a debugger pause, tab switch, or brief network blip

function generateRoomCode(length = 6) {
  let code = '';
  for (let i = 0; i < length; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

const CHAT_HISTORY_LIMIT = 50; // cap how much chat we replay to a (re)joining peer

class RoomManager {
  constructor() {
    this.rooms = new Map(); // code → { host, peers, emptyTimer, streamUrl, chatHistory }
  }

  create(ws, displayName) {
    let code = generateRoomCode();
    while (this.rooms.has(code)) code = generateRoomCode();

    ws.id = require('crypto').randomUUID();
    ws.roomCode = code;
    ws.displayName = displayName;
    ws.role = 'host';
    ws.hasControl = false;

    this.rooms.set(code, {
      host: ws,
      peers: new Set([ws]),
      emptyTimer: null,
      streamUrl: null,       // current embed URL, so a refreshing/late-joining
                              // peer can be brought up to speed automatically
      chatHistory: [],       // recent messages, replayed to (re)joiners
    });
    return code;
  }

  join(code, ws, displayName) {
    const room = this.rooms.get(code);
    if (!room) return { ok: false, reason: 'Room not found' };
    if (room.peers.size >= 10) return { ok: false, reason: 'Room full' };

    // Someone is joining — cancel any pending deletion timer
    if (room.emptyTimer) {
      clearTimeout(room.emptyTimer);
      room.emptyTimer = null;
    }

    ws.id = require('crypto').randomUUID();
    ws.roomCode = code;
    ws.displayName = displayName;
    ws.role = 'watcher';
    ws.hasControl = false;
    room.peers.add(ws);

    const peers = [...room.peers]
      .filter(p => p !== ws)
      .map(p => ({ id: p.id, displayName: p.displayName, role: p.role }));
    return {
      ok: true,
      peers,
      streamUrl: room.streamUrl,         // let the caller resend STREAM_URL
      chatHistory: room.chatHistory,     // let the caller replay recent chat
    };
  }

  // Record the room's current stream URL so future (re)joiners can be
  // brought up to speed without the host needing to reload it manually.
  setStreamUrl(code, url) {
    const room = this.rooms.get(code);
    if (room) room.streamUrl = url;
  }

  // Append a chat message to the room's short replay buffer.
  addChatMessage(code, payload) {
    const room = this.rooms.get(code);
    if (!room) return;
    room.chatHistory.push(payload);
    if (room.chatHistory.length > CHAT_HISTORY_LIMIT) {
      room.chatHistory.shift();
    }
  }

  leave(code, ws) {
    const room = this.rooms.get(code);
    if (!room) return;
    room.peers.delete(ws);

    if (room.peers.size === 0) {
      // GRACE PERIOD FIX: don't delete the room immediately.
      // A lone host's WebSocket can drop for reasons that have nothing
      // to do with actually leaving — a Chrome DevTools "paused in
      // debugger" state freezes JS execution (so no ping/pong gets
      // answered and the socket times out), a backgrounded tab being
      // throttled, a brief Wi-Fi blip, or the page simply reloading.
      // In every one of those cases the SAME browser tab reconnects
      // moments later expecting its room to still exist.
      //
      // We keep the empty room alive for GRACE_PERIOD_MS. If nobody
      // reconnects in that window, only then do we actually delete it.
      if (room.emptyTimer) clearTimeout(room.emptyTimer); // safety, shouldn't happen
      room.emptyTimer = setTimeout(() => {
        const stillEmpty = this.rooms.get(code);
        if (stillEmpty && stillEmpty.peers.size === 0) {
          this.rooms.delete(code);
        }
      }, GRACE_PERIOD_MS);
      return;
    }

    // If host left but others remain, promote the next peer immediately
    if (room.host === ws) {
      room.host = [...room.peers][0];
      room.host.role = 'host';
    }
  }

  // Called when the ORIGINAL host's connection re-establishes
  // (e.g. same browser tab reconnecting after a debugger pause).
  // This lets the reconnecting client rejoin the SAME room+code
  // instead of being told "Room not found" or silently creating a
  // brand new one.
  rejoinAsHost(code, ws) {
    const room = this.rooms.get(code);
    if (!room) return { ok: false };
    if (room.emptyTimer) { clearTimeout(room.emptyTimer); room.emptyTimer = null; }
    ws.id = require('crypto').randomUUID();
    ws.roomCode = code;
    ws.role = 'host';
    ws.hasControl = false;
    room.host = ws;
    room.peers.add(ws);
    return { ok: true, streamUrl: room.streamUrl, chatHistory: room.chatHistory };
  }

  get(code) {
    return this.rooms.get(code);
  }
}

module.exports = { RoomManager };

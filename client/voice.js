// ── voice.js — WebRTC audio mesh ─────────────────────────────────────────
// Globals expected from room.html: ws, code, myId

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302'  },
  { urls: 'stun:stun1.l.google.com:19302' },
];

const peerConns = {};  // peerId → RTCPeerConnection
let localStream = null;
let micActive   = false;
let muted       = false;

// ── Mic acquisition ───────────────────────────────────────────────────────

async function ensureMic() {
  if (localStream) return true;
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    micActive   = true;
    setVoiceStatus('🟢 Mic active');
    return true;
  } catch (e) {
    setVoiceStatus('🔴 Mic denied');
    console.warn('[voice] Mic access denied:', e);
    return false;
  }
}

async function startVoice() {
  const ok = await ensureMic();
  if (!ok) return;
  document.getElementById('mic-btn').textContent = '🎙 Mute';
}

// ── Peer connection ───────────────────────────────────────────────────────

function createPeerConnection(peerId) {
  if (peerConns[peerId]) return peerConns[peerId];

  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  peerConns[peerId] = pc;

  // Add our local audio tracks
  if (localStream) {
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
  }

  // Attach incoming audio to a hidden <audio> element
  pc.ontrack = (e) => {
    let audio = document.getElementById(`audio-${peerId}`);
    if (!audio) {
      audio = Object.assign(document.createElement('audio'), {
        id: `audio-${peerId}`, autoplay: true,
      });
      document.body.appendChild(audio);
    }
    audio.srcObject = e.streams[0];
  };

  // Relay ICE candidates via signalling channel
  pc.onicecandidate = (e) => {
    if (e.candidate) {
      ws.send({ type: 'VOICE_SIGNAL', targetId: peerId, code,
                signal: { type: 'ice', candidate: e.candidate } });
    }
  };

  pc.onconnectionstatechange = () => {
    const state = pc.connectionState;
    if (state === 'connected')     setVoiceStatus('🟢 Voice connected');
    if (state === 'disconnected' ||
        state === 'failed')        setVoiceStatus('🔴 Voice dropped');
  };

  return pc;
}

// We initiate — send offer
async function callPeer(peerId) {
  if (!(await ensureMic())) return;
  const pc    = createPeerConnection(peerId);
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  ws.send({ type: 'VOICE_SIGNAL', targetId: peerId, code,
            signal: { type: 'offer', sdp: offer } });
}

// We received a signal — handle it
async function handleSignal(fromId, signal) {
  if (!(await ensureMic())) return;

  if (signal.type === 'offer') {
    const pc     = createPeerConnection(fromId);
    await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    ws.send({ type: 'VOICE_SIGNAL', targetId: fromId, code,
              signal: { type: 'answer', sdp: answer } });

  } else if (signal.type === 'answer') {
    const pc = peerConns[fromId];
    if (pc) await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));

  } else if (signal.type === 'ice') {
    const pc = peerConns[fromId];
    if (pc) {
      try { await pc.addIceCandidate(new RTCIceCandidate(signal.candidate)); }
      catch (e) { console.warn('[voice] ICE error:', e); }
    }
  }
}

function disconnectPeer(peerId) {
  const pc = peerConns[peerId];
  if (pc) { pc.close(); delete peerConns[peerId]; }
  const el = document.getElementById(`audio-${peerId}`);
  if (el) el.remove();
  setVoiceStatus(Object.keys(peerConns).length ? '🟢 Mic active' : '🟡 Waiting for peers');
}

// ── Mute toggle ───────────────────────────────────────────────────────────

function toggleMute() {
  if (!localStream) { startVoice(); return; }
  muted = !muted;
  localStream.getAudioTracks().forEach(t => (t.enabled = !muted));
  document.getElementById('mic-btn').textContent = muted ? '🔇 Unmute' : '🎙 Mute';
  setVoiceStatus(muted ? '🔇 Muted' : '🟢 Mic active');
}

function setVoiceStatus(text) {
  const el = document.getElementById('voice-status');
  if (el) el.textContent = text;
}

// ── WebSocket wiring ──────────────────────────────────────────────────────

ws.on('VOICE_SIGNAL', (msg) => handleSignal(msg.fromId, msg.signal));

// When a new peer joins, call them if we already have mic
ws.on('PEER_JOINED', (msg) => {
  if (micActive) callPeer(msg.peerId);
});

ws.on('PEER_LEFT', (msg) => disconnectPeer(msg.peerId));

// Rejoin signal — re-establish connections after reconnect
ws.on('ROOM_JOINED', (msg) => {
  if (!micActive) return;
  (msg.peers || []).forEach(p => callPeer(p.id));
});

import { useRef, useState, useEffect, useCallback } from 'react';

const ICE = [
  { urls: 'stun:stun.l.google.com:19302'  },
  { urls: 'stun:stun1.l.google.com:19302' },
];

export function useVoice(ws, code) {
  const pcs         = useRef({});        // peerId → RTCPeerConnection
  const streamRef   = useRef(null);
  const [micActive, setMicActive] = useState(false);
  const [muted,     setMuted]     = useState(false);
  const [status,    setStatus]    = useState('Click to join voice');

  // -- Mic -----------------------------------------------------------------
  async function ensureMic() {
    if (streamRef.current) return true;
    try {
      streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      setMicActive(true);
      setStatus('Mic active');
      return true;
    } catch {
      setStatus('Mic denied');
      return false;
    }
  }

  // -- Peer connection ------------------------------------------------------
  // Use a ref-wrapped factory so closures always see the latest stream
  const createPC = useCallback((peerId) => {
    if (pcs.current[peerId]) return pcs.current[peerId];
    const pc = new RTCPeerConnection({ iceServers: ICE });
    pcs.current[peerId] = pc;

    // Add local tracks
    streamRef.current?.getTracks().forEach(t => pc.addTrack(t, streamRef.current));

    // Remote audio — create element fresh, always clean up on track end
    pc.ontrack = (e) => {
      const audioId = `sw-audio-${peerId}`;
      let el = document.getElementById(audioId);
      if (!el) {
        el = document.createElement('audio');
        el.id = audioId;
        el.autoplay = true;
        document.body.appendChild(el);
      }
      el.srcObject = e.streams[0];
      // If the stream ends, remove the element
      e.streams[0].getTracks().forEach(t => {
        t.onended = () => { el.remove(); };
      });
    };

    pc.onicecandidate = (e) => {
      if (e.candidate)
        ws.send({ type: 'VOICE_SIGNAL', targetId: peerId, code, signal: { type: 'ice', candidate: e.candidate } });
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected')   setStatus('Voice connected');
      if (pc.connectionState === 'failed')       { setStatus('Voice failed — retrying…'); pc.restartIce(); }
      if (pc.connectionState === 'disconnected') setStatus('Peer disconnected');
    };

    return pc;
  }, [ws, code]);

  const callPeer = useCallback(async (peerId) => {
    if (!await ensureMic()) return;
    const pc    = createPC(peerId);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    ws.send({ type: 'VOICE_SIGNAL', targetId: peerId, code, signal: { type: 'offer', sdp: offer } });
  }, [ws, code, createPC]);

  const handleSignal = useCallback(async (fromId, signal) => {
    if (!await ensureMic()) return;
    if (signal.type === 'offer') {
      const pc     = createPC(fromId);
      await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      ws.send({ type: 'VOICE_SIGNAL', targetId: fromId, code, signal: { type: 'answer', sdp: answer } });
    } else if (signal.type === 'answer') {
      const pc = pcs.current[fromId];
      if (pc && pc.signalingState !== 'stable') {
        await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp)).catch(() => {});
      }
    } else if (signal.type === 'ice') {
      const pc = pcs.current[fromId];
      if (pc && pc.remoteDescription) {
        await pc.addIceCandidate(new RTCIceCandidate(signal.candidate)).catch(() => {});
      }
    }
  }, [ws, code, createPC]);

  function disconnectPeer(peerId) {
    const pc = pcs.current[peerId];
    if (pc) { try { pc.close(); } catch {} delete pcs.current[peerId]; }
    // Clean up audio element
    document.getElementById(`sw-audio-${peerId}`)?.remove();
  }

  const toggleMute = useCallback(async () => {
    if (!streamRef.current) { await ensureMic(); return; }
    const next = !muted;
    streamRef.current.getAudioTracks().forEach(t => (t.enabled = !next));
    setMuted(next);
    setStatus(next ? 'Muted' : 'Mic active');
  }, [muted]);

  const joinVoice = useCallback(async () => {
    await ensureMic();
  }, []);

  // Wire up WS events
  useEffect(() => {
    const offSig  = ws.on('VOICE_SIGNAL', msg => handleSignal(msg.fromId, msg.signal));
    const offJoin = ws.on('PEER_JOINED',  msg => { if (micActive) callPeer(msg.peerId); });
    const offLeft = ws.on('PEER_LEFT',    msg => disconnectPeer(msg.peerId));
    const offRoom = ws.on('ROOM_JOINED',  msg => { if (micActive) (msg.peers||[]).forEach(p => callPeer(p.id)); });
    return () => { offSig(); offJoin(); offLeft(); offRoom(); };
  }, [ws, micActive, callPeer, handleSignal]);

  // Cleanup all peers on unmount
  useEffect(() => () => {
    Object.keys(pcs.current).forEach(disconnectPeer);
    streamRef.current?.getTracks().forEach(t => t.stop());
  }, []);

  return { micActive, muted, status, toggleMute, joinVoice };
}

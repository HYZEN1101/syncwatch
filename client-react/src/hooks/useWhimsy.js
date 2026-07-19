import { useState, useEffect, useCallback, useRef } from 'react';
import { isWhimsyEnabled, persistWhimsyEnabled } from '../whimsy';

// Whimsy Mode, Phase 1: the toggle itself, floating reactions, and confetti
// (on peer join + a host "celebrate" trigger). Deliberately does NOT touch
// playback sync in any way — every event here is purely cosmetic and never
// affects VIDEO_STATE or timing, per the spec's own top-line principle.
//
// Both sending AND receiving are gated behind the LOCAL `enabled` flag —
// turning Whimsy off is meant to give a genuinely clean, distraction-free
// UI regardless of what other peers have it set to, similar in spirit to a
// reduced-motion opt-out rather than a global room setting.
export function useWhimsy(ws, code) {
  const [enabled, setEnabled] = useState(() => isWhimsyEnabled());
  const [bursts, setBursts] = useState([]); // [{ id, emoji, x }]
  const [confettiKey, setConfettiKey] = useState(0); // bump to trigger a new confetti run

  function toggle() {
    setEnabled(prev => {
      const next = !prev;
      persistWhimsyEnabled(next);
      return next;
    });
  }

  const spawnBurst = useCallback((emoji) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    // Random horizontal start position (as a % of the reaction layer's own
    // width) so a flurry of the same emoji doesn't stack in one column.
    const x = 8 + Math.random() * 78;
    setBursts(prev => [...prev, { id, emoji, x }]);
    // Matches FloatingReactions' own rise/fade animation duration — cleans
    // up state for a burst once it's no longer visible, not before.
    setTimeout(() => setBursts(prev => prev.filter(b => b.id !== id)), 2400);
  }, []);

  const sendReaction = useCallback((emoji) => {
    if (!enabled) return;
    ws.send({ type: 'REACTION_BURST', emoji, code });
    spawnBurst(emoji);
  }, [enabled, ws, code, spawnBurst]);

  const triggerConfetti = useCallback(() => {
    if (!enabled) return;
    ws.send({ type: 'CONFETTI', code });
    setConfettiKey(k => k + 1);
  }, [enabled, ws, code]);

  // Keep a ref mirror of `enabled` for the subscription effect below, so
  // that effect doesn't need to re-subscribe every time enabled flips —
  // same pattern already used elsewhere in this app (see useSync.js's
  // checkBridgeRef) for a value read inside a stable, mount-once effect.
  const enabledRef = useRef(enabled);
  useEffect(() => { enabledRef.current = enabled; }, [enabled]);

  useEffect(() => {
    const offReaction = ws.on('REACTION_BURST', (msg) => {
      if (!enabledRef.current) return;
      spawnBurst(msg.emoji);
    });
    const offConfetti = ws.on('CONFETTI', () => {
      if (!enabledRef.current) return;
      setConfettiKey(k => k + 1);
    });
    // Confetti on a new participant joining — each client detects this
    // independently from the same PEER_JOINED broadcast usePeers.js
    // already listens to (ws.on supports multiple independent
    // subscribers per message type), rather than needing its own
    // dedicated server round-trip.
    const offPeerJoined = ws.on('PEER_JOINED', () => {
      if (!enabledRef.current) return;
      setConfettiKey(k => k + 1);
    });
    return () => { offReaction(); offConfetti(); offPeerJoined(); };
  }, [ws, spawnBurst]);

  return { enabled, toggle, bursts, sendReaction, confettiKey, triggerConfetti };
}

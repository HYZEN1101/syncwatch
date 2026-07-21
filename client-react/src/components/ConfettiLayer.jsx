import { useEffect, useState } from 'react';

const COLORS = ['var(--color-primary)', 'var(--color-secondary)', 'var(--color-primary-shade)', '#ffd166', '#ffffff'];

// landingY is the Y coordinate (px) confetti should stop falling at —
// "land on top of the video box like a shoebox lid" rather than falling
// through/behind it. Each piece starts at top:-20px, so its actual travel
// distance is landingY + 20. A little per-piece jitter (±10px) keeps the
// landing line from looking perfectly flat/mechanical.
function makePieces(count, landingY) {
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    left: Math.random() * 100,           // vw%
    delay: Math.random() * 0.4,          // s
    duration: 2.6 + Math.random() * 1.4, // s
    rotate: Math.random() * 360,
    drift: (Math.random() - 0.5) * 160,  // px, horizontal sway by the time it lands
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    size: 6 + Math.random() * 6,
    fallDistance: landingY + 20 + (Math.random() - 0.5) * 20,
  }));
}

// Triggered by `confettiKey` changing (any increment, not the value itself)
// — on join, a host "celebrate" click, or a peer's own celebrate broadcast.
// Renders as a full-window overlay. `landingY` (from Room.jsx, read from
// the video placeholder's own bounding rect at the moment a burst starts)
// is where each piece's fall stops — pieces settle there briefly before
// fading out, rather than continuing down through/behind the video. Falls
// back to the full window height if landingY isn't available yet (e.g. an
// extremely early confetti trigger before the player has laid out at all).
export function ConfettiLayer({ confettiKey, landingY }) {
  const [pieces, setPieces] = useState([]);

  useEffect(() => {
    if (confettiKey === 0) return; // 0 is the initial/never-triggered value
    const effectiveLandingY = landingY ?? window.innerHeight;
    const fresh = makePieces(180, effectiveLandingY);
    setPieces(fresh);
    // Land-then-linger-then-fade (see the CSS keyframes) adds roughly 30%
    // more time on top of the fall itself before a piece is fully gone —
    // matched here so cleanup doesn't cut pieces off mid-fade.
    const longest = Math.max(...fresh.map(p => p.delay + p.duration));
    const t = setTimeout(() => setPieces([]), (longest + 0.2) * 1000);
    return () => clearTimeout(t);
  }, [confettiKey]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!pieces.length) return null;

  return (
    <div style={{ position: 'fixed', inset: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 2500 }}>
      {pieces.map(p => (
        <span
          key={p.id}
          className="whimsy-confetti-piece"
          style={{
            left: `${p.left}%`,
            width: p.size, height: p.size * 0.4,
            background: p.color,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
            '--rotate-start': `${p.rotate}deg`,
            '--drift': `${p.drift}px`,
            '--fall-distance': `${p.fallDistance}px`,
          }}
        />
      ))}
    </div>
  );
}

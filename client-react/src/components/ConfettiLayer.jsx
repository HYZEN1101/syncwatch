import { useEffect, useState } from 'react';

const COLORS = ['var(--color-primary)', 'var(--color-secondary)', 'var(--color-primary-shade)', '#ffd166', '#ffffff'];

function makePieces(count) {
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    left: Math.random() * 100,           // vw%
    delay: Math.random() * 0.4,          // s
    duration: 2.6 + Math.random() * 1.4, // s
    rotate: Math.random() * 360,
    drift: (Math.random() - 0.5) * 160,  // px, horizontal sway by the time it lands
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    size: 6 + Math.random() * 6,
  }));
}

// Triggered by `confettiKey` changing (any increment, not the value itself)
// — on join, a host "celebrate" click, or a peer's own celebrate broadcast.
// Renders as a full-window overlay: unlike FloatingReactions, this is brief
// enough (a few seconds) that being invisible while crossing the video's
// screen coordinates (see FloatingReactions' own comment on why) is an
// acceptable trade-off for a celebratory burst, rather than confining it to
// the sidebar the way sustained/frequent reactions need to be.
export function ConfettiLayer({ confettiKey }) {
  const [pieces, setPieces] = useState([]);

  useEffect(() => {
    if (confettiKey === 0) return; // 0 is the initial/never-triggered value
    const fresh = makePieces(180);
    setPieces(fresh);
    const longest = Math.max(...fresh.map(p => p.delay + p.duration));
    const t = setTimeout(() => setPieces([]), (longest + 0.2) * 1000);
    return () => clearTimeout(t);
  }, [confettiKey]);

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
          }}
        />
      ))}
    </div>
  );
}

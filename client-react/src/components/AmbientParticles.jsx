import { useMemo } from 'react';

// A vibrant, varicolored "polka dot" ambient background — Phase 1's
// ambient option from the spec's larger list (rain/snow/fireflies/stars/
// etc; the rest are deferred). Confined to whatever container renders it
// (the sidebar, in Room.jsx) for the same reason as FloatingReactions: the
// video itself is a native view Electron draws above regular page content,
// so this would render invisibly behind it if applied to the video area.
// Regenerated only once per mount (useMemo) — the particles themselves
// loop forever via CSS animation, no need to keep recreating them.
const DOT_COLORS = ['#ff6b9d', '#ffd166', '#06d6a0', '#4cc9f0', '#c77dff', '#ff9f1c', '#f72585'];

export function AmbientParticles({ count = 16 }) {
  const particles = useMemo(() => Array.from({ length: count }, (_, i) => ({
    id: i,
    left: Math.random() * 100,
    delay: Math.random() * 8,
    duration: 6 + Math.random() * 5,
    scale: 0.7 + Math.random() * 1.1,
    color: DOT_COLORS[Math.floor(Math.random() * DOT_COLORS.length)],
  })), [count]);

  return (
    <div className="whimsy-ambient" aria-hidden="true">
      {particles.map(p => (
        <span key={p.id} style={{
          left: `${p.left}%`,
          animationDelay: `${p.delay}s`,
          animationDuration: `${p.duration}s`,
          width: 14 * p.scale, height: 14 * p.scale,
          background: p.color,
          color: p.color,
        }} />
      ))}
    </div>
  );
}

import { useMemo } from 'react';

// A subtle floating-particle ambient background — Phase 1's single ambient
// option from the spec's larger list (rain/snow/fireflies/stars/etc; the
// rest are deferred). Confined to whatever container renders it (the
// sidebar, in Room.jsx) for the same reason as FloatingReactions: the
// video itself is a native view Electron draws above regular page content,
// so this would render invisibly behind it if applied to the video area.
// Regenerated only once per mount (useMemo) — the particles themselves
// loop forever via CSS animation, no need to keep recreating them.
export function AmbientParticles({ count = 14 }) {
  const particles = useMemo(() => Array.from({ length: count }, (_, i) => ({
    id: i,
    left: Math.random() * 100,
    delay: Math.random() * 8,
    duration: 7 + Math.random() * 6,
    scale: 0.6 + Math.random() * 0.8,
  })), [count]);

  return (
    <div className="whimsy-ambient" aria-hidden="true">
      {particles.map(p => (
        <span key={p.id} style={{
          left: `${p.left}%`,
          animationDelay: `${p.delay}s`,
          animationDuration: `${p.duration}s`,
          transform: `scale(${p.scale})`,
        }} />
      ))}
    </div>
  );
}

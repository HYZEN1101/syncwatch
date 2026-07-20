import { useMemo } from 'react';

// A vibrant, varicolored "polka dot" ambient background — Phase 1's
// ambient option from the spec's larger list (rain/snow/fireflies/stars/
// etc; the rest are deferred). Rendered at the Room page's root level so
// it spans the whole window, not confined to a smaller container — unlike
// FloatingReactions/WhimsySprites (which stay sidebar-scoped since they're
// frequent/sustained enough that flickering behind the video would be more
// noticeable), a low-key background layer like this naturally disappears
// wherever the video currently sits (a native view Electron composites
// above regular page content) without needing any manual exclusion logic.
const DOT_COLORS = ['#ff6b9d', '#ffd166', '#06d6a0', '#4cc9f0', '#c77dff', '#ff9f1c', '#f72585'];

export function AmbientParticles({ count = 30 }) {
  const particles = useMemo(() => Array.from({ length: count }, (_, i) => {
    const duration = 6 + Math.random() * 5;
    return {
      id: i,
      left: Math.random() * 100,
      // A NEGATIVE delay tells the browser to act as though the animation
      // had already been running for that long — i.e. start partway
      // through the rise-cycle immediately. With a positive delay (the
      // original approach), every particle starts stuck at the bottom
      // edge until its delay elapses, so right after Whimsy Mode is
      // toggled on, most of them are invisible for several seconds and
      // whatever few do have an elapsed delay are still just starting
      // out — which is exactly the "clustered at the bottom" look.
      delay: -(Math.random() * duration),
      duration,
      scale: 0.7 + Math.random() * 1.1,
      color: DOT_COLORS[Math.floor(Math.random() * DOT_COLORS.length)],
    };
  }), [count]);

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

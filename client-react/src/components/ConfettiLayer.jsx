import { useEffect, useRef, useState } from 'react';

const COLORS = ['var(--color-primary)', 'var(--color-secondary)', 'var(--color-primary-shade)', '#ffd166', '#ffffff'];

// Builds one batch of confetti pieces, each with a globally unique id
// (via idStartRef, passed in) — NOT reused per-batch indices. That
// uniqueness is what makes rapid re-triggering (spamming the celebrate
// button) work correctly: React only restarts a CSS animation from
// scratch when the underlying DOM node is freshly created, which only
// happens when its `key` hasn't been seen before. Reusing keys 0..N for
// every batch (the original approach) meant a second burst that started
// before the first one finished just mutated the EXISTING span elements'
// style props in place — an already-running CSS animation doesn't restart
// just because its inline style changed, so pieces would freeze, jump, or
// animate from the wrong position instead of starting a fresh, correct
// fall each time.
//
// `bounds` (from Room.jsx, read from the video placeholder's and sidebar's
// own bounding rects at the moment a burst starts) decides where each
// piece lands based on which column it's falling in: over the video, it
// stops at the video's top edge ("lands on the box lid"); over the
// sidebar, there's no video underneath, so it falls all the way to the
// bottom of the chat panel instead.
function makeBatch(count, idStart, bounds) {
  const windowWidth = window.innerWidth;
  const fallbackY = window.innerHeight;
  return Array.from({ length: count }, (_, i) => {
    const leftPct = Math.random() * 100;
    const pixelX = (leftPct / 100) * windowWidth;
    const overSidebar = bounds?.sidebarLeft != null && pixelX >= bounds.sidebarLeft;
    const baseLandingY = overSidebar
      ? (bounds?.sidebarBottom ?? fallbackY)
      : (bounds?.videoTop ?? fallbackY);
    return {
      id: idStart + i,
      left: leftPct,
      delay: Math.random() * 0.4,          // s
      duration: 2.6 + Math.random() * 1.4, // s
      rotate: Math.random() * 360,
      drift: (Math.random() - 0.5) * 160,  // px, horizontal sway by the time it lands
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      size: 6 + Math.random() * 6,
      // Each piece starts at top:-20px, so its actual travel distance is
      // landingY + 20. Small per-piece jitter (±10px) keeps the landing
      // line from looking perfectly flat/mechanical.
      fallDistance: baseLandingY + 20 + (Math.random() - 0.5) * 20,
    };
  });
}

// Triggered by `confettiKey` changing (any increment, not the value itself)
// — on join, a host "celebrate" click (which can be spammed — see above
// for why that now works correctly), or a peer's own celebrate broadcast.
export function ConfettiLayer({ confettiKey, bounds }) {
  const [pieces, setPieces] = useState([]);
  const idCounterRef = useRef(0);
  const prevKeyRef = useRef(confettiKey);

  useEffect(() => {
    if (confettiKey === prevKeyRef.current) return;
    prevKeyRef.current = confettiKey;
    if (confettiKey === 0) return; // 0 is the initial/never-triggered value

    const idStart = idCounterRef.current;
    const batch = makeBatch(180, idStart, bounds);
    idCounterRef.current += batch.length;

    // Append rather than replace — a second (or third, or tenth) rapid
    // trigger adds its own independent batch on top of whatever's already
    // falling, instead of interrupting it.
    setPieces(prev => [...prev, ...batch]);

    const batchIds = new Set(batch.map(p => p.id));
    const longest = Math.max(...batch.map(p => p.delay + p.duration));
    // Land-then-linger-then-fade (see the CSS keyframes) adds roughly 30%
    // more time on top of the fall itself — matched here so cleanup
    // doesn't cut this batch off mid-fade. Only removes THIS batch's own
    // pieces, so it doesn't clip a still-in-progress later batch.
    setTimeout(() => {
      setPieces(prev => prev.filter(p => !batchIds.has(p.id)));
    }, (longest + 0.2) * 1000);
  }, [confettiKey, bounds]);

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

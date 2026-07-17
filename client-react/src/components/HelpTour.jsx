import { useState, useEffect } from 'react';

// A lightweight "coach mark" tour: dims everything except one target element
// at a time (found via a CSS selector), with a small tooltip card next to it
// explaining what it's for, plus Back/Next/Skip controls and a step
// counter. Steps whose target isn't currently in the DOM (e.g. the LAN/
// tunnel boxes, which only exist in the Electron build, or only once a
// value is available) are skipped automatically rather than showing an
// empty/broken step.
//
// Deliberately has no "click the dark backdrop to dismiss" behavior — for a
// first-run tour, an accidental dismiss from a stray click is worse than
// requiring an explicit Skip/Escape. Escape and the Skip button both exit
// immediately; Next/Back navigate; the last step's button reads "Done".
//
// The overlay INTENTIONALLY captures all pointer events (including over the
// spotlighted element itself) rather than passing clicks/scroll through to
// the real page — an earlier version let the highlighted field stay
// interactive during the tour, which meant you could scroll or click things
// underneath and end up misaligned with what the tour was actually
// pointing at. The spotlight is now purely visual.
export function HelpTour({ steps, onClose }) {
  const [stepIndex, setStepIndex] = useState(0);
  const [rect, setRect] = useState(null);

  const activeSteps = steps.filter(s => document.querySelector(s.selector));

  useEffect(() => {
    function update() {
      const step = activeSteps[stepIndex];
      const el = step && document.querySelector(step.selector);
      if (el) {
        // Only relevant if the Lobby card itself ended up needing to
        // scroll (a very short window) — harmless no-op otherwise, since
        // an element already in view won't move when asked to scroll into
        // view again.
        el.scrollIntoView({ block: 'nearest' });
        setRect(el.getBoundingClientRect());
      } else {
        setRect(null);
      }
    }
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [stepIndex, activeSteps.length]); // eslint-disable-line react-hooks/exhaustive-deps

  function next() {
    if (stepIndex < activeSteps.length - 1) setStepIndex(i => i + 1);
    else onClose();
  }
  function back() { if (stepIndex > 0) setStepIndex(i => i - 1); }

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight' || e.key === 'Enter') next();
      else if (e.key === 'ArrowLeft') back();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }); // intentionally no deps — always wants the latest next/back/onClose

  if (!activeSteps.length) return null;
  const step = activeSteps[stepIndex];
  const pad = 8;

  // The "spotlight": a box exactly over the target (plus a little padding),
  // with a huge box-shadow that fills the rest of the viewport — the
  // classic CSS spotlight-cutout trick. pointerEvents:none throughout so
  // clicks always pass through to the real page underneath (the
  // highlighted field stays genuinely usable during the tour, and nothing
  // needs a separate "click to dismiss" layer).
  const spotlightStyle = rect
    ? {
        position: 'fixed', top: rect.top - pad, left: rect.left - pad,
        width: rect.width + pad * 2, height: rect.height + pad * 2,
        borderRadius: 12, border: '2px solid var(--color-primary)',
        boxShadow: '0 0 0 9999px rgba(10,5,15,0.72)',
        zIndex: 2000, pointerEvents: 'none', transition: 'all 0.25s ease',
      }
    : { position: 'fixed', inset: 0, background: 'rgba(10,5,15,0.72)', zIndex: 2000, pointerEvents: 'none' };

  // Prefer placing the tooltip below the target; flip above if there's not
  // enough room. Clamped horizontally so it never runs off-screen.
  const tooltipWidth = 280;
  const roomBelow = rect ? window.innerHeight - rect.bottom : 0;
  const top = rect
    ? (roomBelow > 190 ? rect.bottom + pad + 12 : Math.max(12, rect.top - pad - 12 - 170))
    : window.innerHeight / 2 - 90;
  const left = rect
    ? Math.min(Math.max(rect.left, 12), window.innerWidth - tooltipWidth - 12)
    : window.innerWidth / 2 - tooltipWidth / 2;

  return (
    <>
      {/* The actual interaction blocker — covers the full viewport and
          captures every pointer event, so nothing underneath (including
          the highlighted field itself) can be scrolled or clicked while
          the tour is open. Below the spotlight/tooltip in z-index but
          above everything else in the app. */}
      <div style={{ position: 'fixed', inset: 0, zIndex: 1999 }}
        onWheel={e => e.preventDefault()}
        onTouchMove={e => e.preventDefault()}
      />
      <div style={spotlightStyle} />
      <div className="glass-card" style={{
        position: 'fixed', top, left, width: tooltipWidth, zIndex: 2001,
        padding: 16, borderRadius: 14, display: 'flex', flexDirection: 'column', gap: 8,
      }}>
        <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--color-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          {stepIndex + 1} / {activeSteps.length}
        </div>
        <div className="font-page-title" style={{ fontSize: 14.5, color: 'var(--color-primary)' }}>{step.title}</div>
        <p style={{ margin: 0, fontSize: 12.5, color: 'var(--color-on-surface-variant)', lineHeight: 1.5 }}>{step.text}</p>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--color-outline)', fontSize: 11, cursor: 'pointer', padding: 0 }}>
            Skip tour
          </button>
          <div style={{ display: 'flex', gap: 6 }}>
            {stepIndex > 0 && (
              <button onClick={back} className="btn-secondary" style={{ padding: '6px 12px', fontSize: 12, width: 'auto' }}>Back</button>
            )}
            <button onClick={next} className="btn-primary" style={{ padding: '6px 14px', fontSize: 12, width: 'auto' }}>
              {stepIndex === activeSteps.length - 1 ? 'Done' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

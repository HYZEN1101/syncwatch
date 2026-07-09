import { useEffect } from 'react';

// Phase 2: feature-detect the Electron playback bridge (same check used in
// useSync.js — kept local here too since this component has no other
// dependency on that hook and shouldn't need to import it just for this flag).
const isElectron = typeof window !== 'undefined' && !!window.syncwatch?.playback;

// Renders the actual video surface: an <iframe> on the browser/web build
// (unchanged, still the Tampermonkey-bridge path), or — on Electron — an
// otherwise-empty positioning <div>. That div renders nothing itself; the
// real content is a native WebContentsView that electron/playback.js draws
// directly over this element's screen coordinates (see HANDOFF_PHASE_1.md
// for why WebContentsView, not <webview>, and HANDOFF_PHASE_2.md for the
// bounds-tracking approach below and its known gaps).
export function Player({ frameRef, canControl, hasFrame, onLoad, onError }) {
  // Focus reclaim — when the iframe/native view steals window focus, yank it
  // back so keyboard shortcuts and button clicks keep working. Applies to
  // both paths.
  useEffect(() => {
    function onBlur() {
      if (!canControl) return;
      setTimeout(() => { window.focus(); document.body.focus(); }, 50);
    }
    window.addEventListener('blur', onBlur);
    return () => window.removeEventListener('blur', onBlur);
  }, [canControl]);

  // Electron only: WebContentsView isn't part of the DOM and has no size or
  // position of its own — main process has to be told exactly where to draw
  // it, over IPC, every time this changes. Collapses to zero bounds
  // whenever hasFrame is false, so the native view doesn't render on top of
  // the "no stream loaded" empty state, and on unmount, so it doesn't
  // linger when navigating away.
  //
  // Phase 4: a ResizeObserver alone (Phase 2's original approach) only
  // fires on SIZE changes — a position-only shift (e.g. a sidebar toggling
  // in a way that moves this element without resizing it) never triggered
  // an update, which was an explicitly documented gap. Fixed here with a
  // continuous requestAnimationFrame loop that re-reads the real bounding
  // rect every frame and only calls setBounds when something actually
  // changed (rounded to whole pixels, since sub-pixel layout jitter would
  // otherwise cause a constant stream of no-op IPC calls with nothing
  // visibly different on screen) — this catches ANY layout change
  // (position or size, from a sidebar toggle, a CSS transition, a window
  // drag, anything) rather than needing to enumerate every possible
  // trigger. ResizeObserver + the window resize listener are kept as
  // harmless immediate triggers alongside it, not because the loop needs
  // help catching those cases, but because they fire the very same frame
  // something happens rather than waiting up to one animation frame.
  //
  // Remaining known gap: any DOM element meant to visually overlay the
  // video itself (e.g. Room.jsx's "sync status" pill) still renders BEHIND
  // the native view once bounds are non-zero, since WebContentsView
  // composites above regular page content within its bounds. That's a
  // separate, real UX rough edge this phase doesn't attempt to solve —
  // repositioning that UI outside the video area (or insetting the view's
  // bounds to leave a gap) is a deliberate design choice for whoever picks
  // that up, not a tracking bug.
  useEffect(() => {
    if (!isElectron) return;
    const el = frameRef.current;
    if (!el) return;

    let rafId = null;
    let last = null; // last bounds actually sent, to skip redundant IPC calls

    function reportBounds() {
      if (!hasFrame) {
        if (!last || last.width !== 0 || last.height !== 0) {
          last = { x: 0, y: 0, width: 0, height: 0 };
          window.syncwatch.playback.setBounds(last);
        }
        return;
      }
      const rect = el.getBoundingClientRect();
      const r = (v) => Math.round(v);
      const next = { x: r(rect.left), y: r(rect.top), width: r(rect.width), height: r(rect.height) };
      if (!last || last.x !== next.x || last.y !== next.y || last.width !== next.width || last.height !== next.height) {
        last = next;
        window.syncwatch.playback.setBounds(next);
      }
    }

    function loop() {
      reportBounds();
      rafId = requestAnimationFrame(loop);
    }
    loop();

    const ro = new ResizeObserver(reportBounds);
    ro.observe(el);
    window.addEventListener('resize', reportBounds);

    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
      window.removeEventListener('resize', reportBounds);
      window.syncwatch.playback.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    };
  }, [frameRef, hasFrame]);

  if (isElectron) {
    return (
      <div
        ref={frameRef}
        className="player-frame"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
      />
    );
  }

  return (
    <iframe
      ref={frameRef}
      className="player-frame"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 'none', display: hasFrame ? 'block' : 'none' }}
      allowFullScreen
      allow="autoplay; fullscreen"
      title="SyncWatch player"
      onLoad={onLoad}
      onError={onError}
    />
  );
}

export { isElectron };

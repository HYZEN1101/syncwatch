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
  // it, over IPC, every time this changes. Tracks the placeholder div's live
  // bounding rect via ResizeObserver (catches size changes) plus a window
  // resize listener (catches viewport changes even when this element's own
  // size doesn't). Collapses to zero bounds whenever hasFrame is false, so
  // the native view doesn't render on top of the "no stream loaded" empty
  // state, and on unmount, so it doesn't linger when navigating away.
  //
  // Known gap, left for Phase 4 ("harden layout/bounds tracking") to fully
  // close: a position-only change with no size change — e.g. a sidebar
  // toggling in a way that shifts this element without resizing it — won't
  // trigger either listener here. Also known: any DOM element meant to
  // visually overlay the video itself (e.g. Room.jsx's "sync status" pill)
  // will render BEHIND the native view once bounds are non-zero, since
  // WebContentsView composites above regular page content within its
  // bounds. That's a real UX rough edge, intentionally not solved in this
  // phase — Phase 2 owns making playback *work*, not full visual polish.
  useEffect(() => {
    if (!isElectron) return;
    const el = frameRef.current;
    if (!el) return;

    function reportBounds() {
      if (!hasFrame) {
        window.syncwatch.playback.setBounds({ x: 0, y: 0, width: 0, height: 0 });
        return;
      }
      const rect = el.getBoundingClientRect();
      window.syncwatch.playback.setBounds({
        x: rect.left, y: rect.top, width: rect.width, height: rect.height,
      });
    }

    reportBounds();
    const ro = new ResizeObserver(reportBounds);
    ro.observe(el);
    window.addEventListener('resize', reportBounds);
    return () => {
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

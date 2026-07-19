// Renders rising, fading emoji bursts. Deliberately meant to be mounted
// inside a `position: relative` container with a bounded size (the sidebar,
// in Room.jsx) rather than as a full-window overlay — the video itself is a
// native WebContentsView Electron draws directly over specific screen
// coordinates, sitting above regular page content, so anything meant to
// visually "float over the player" would actually render invisibly behind
// it. Confining this to the sidebar avoids that entirely rather than
// fighting it.
export function FloatingReactions({ bursts }) {
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 5 }}>
      {bursts.map(b => (
        <span key={b.id} className="whimsy-reaction-burst" style={{ left: `${b.x}%` }}>
          {b.emoji}
        </span>
      ))}
    </div>
  );
}

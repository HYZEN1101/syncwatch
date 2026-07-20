import { useState, useEffect, useRef } from 'react';

// Random little whimsical tidbits that appear and fade away on their own —
// fireworks, flowers, plushies, candy, food. Purely decorative for now;
// each sprite carries a stable `id` and this component accepts an optional
// `onSpriteClick` specifically so a future "tap these for points" minigame
// (mentioned as a later idea, not built yet) can hook in without needing
// to restructure how sprites are generated or rendered.
//
// Confined to whatever container renders it (the sidebar, in Room.jsx),
// same reasoning as FloatingReactions/AmbientParticles — the video is a
// native view Electron draws above regular page content, so this would be
// invisible over the video area.
const SPRITES = ['🎆', '🎇', '🌸', '🌺', '🌼', '🧸', '🍬', '🍭', '🍫', '🍕', '🍩', '🎈', '🍰', '🧁'];

export function WhimsySprites({ onSpriteClick }) {
  const [sprites, setSprites] = useState([]);
  const nextId = useRef(0);

  useEffect(() => {
    let cancelled = false;
    let timeoutId;

    function scheduleNext() {
      const delay = 2500 + Math.random() * 3000;
      timeoutId = setTimeout(() => {
        if (cancelled) return;
        const id = nextId.current++;
        const sprite = {
          id,
          emoji: SPRITES[Math.floor(Math.random() * SPRITES.length)],
          left: 6 + Math.random() * 82,
          top: 6 + Math.random() * 80,
          size: 20 + Math.random() * 16,
        };
        setSprites(prev => [...prev, sprite]);
        // Lifespan matches the CSS animation duration below (2.8s) — removed
        // from state once it's no longer visible, not before.
        setTimeout(() => setSprites(prev => prev.filter(s => s.id !== id)), 2800);
        scheduleNext();
      }, delay);
    }
    scheduleNext();

    return () => { cancelled = true; clearTimeout(timeoutId); };
  }, []);

  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 4 }} aria-hidden="true">
      {sprites.map(s => (
        <span
          key={s.id}
          className="whimsy-sprite"
          style={{ left: `${s.left}%`, top: `${s.top}%`, fontSize: s.size }}
          // onSpriteClick is unused today (the layer has pointerEvents:none
          // above so nothing is actually clickable yet) — kept wired
          // through as a no-op hook point for the future minigame idea,
          // rather than bolting it on later.
          onClick={() => onSpriteClick?.(s)}
        >
          {s.emoji}
        </span>
      ))}
    </div>
  );
}

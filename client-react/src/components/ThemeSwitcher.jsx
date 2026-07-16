import { useState, useRef, useEffect } from 'react';
import { THEMES, getInitialTheme, applyTheme, cycleTheme } from '../theme';

export function ThemeSwitcher() {
  const [themeId, setThemeId] = useState(() => getInitialTheme());
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  // Re-applies on mount so the DOM is guaranteed to match this component's
  // own state — matters when navigating between Lobby and Room, since each
  // mounts its own ThemeSwitcher instance rather than sharing one.
  useEffect(() => { applyTheme(themeId); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    function onDocClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    function onKey(e) { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function go(direction) {
    const next = cycleTheme(themeId, direction);
    setThemeId(next);
    applyTheme(next);
  }
  function select(id) {
    setThemeId(id);
    applyTheme(id);
    setOpen(false);
  }

  const current = THEMES.find(t => t.id === themeId) || THEMES[0];
  const arrowStyle = {
    background: 'none', border: 'none', cursor: 'pointer', display: 'flex',
    padding: 5, borderRadius: '50%', color: 'var(--color-on-surface-variant)', transition: 'all 0.15s',
  };

  return (
    <div ref={wrapRef} style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 2 }}>
      <button onClick={() => go(-1)} title="Previous theme" style={arrowStyle}
        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(167,46,74,0.08)'; e.currentTarget.style.color = 'var(--color-primary)'; }}
        onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'var(--color-on-surface-variant)'; }}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 16 }}>chevron_left</span>
      </button>

      <button onClick={() => setOpen(o => !o)} title="Choose a theme" className="font-button"
        style={{
          padding: '4px 12px', borderRadius: 999, border: 'none', cursor: 'pointer',
          background: 'var(--color-primary-fixed)', color: 'var(--color-on-primary-fixed)',
          fontSize: 11, whiteSpace: 'nowrap', transition: 'transform 0.15s',
        }}
        onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.04)'}
        onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
      >
        {current.label}
      </button>

      <button onClick={() => go(1)} title="Next theme" style={arrowStyle}
        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(167,46,74,0.08)'; e.currentTarget.style.color = 'var(--color-primary)'; }}
        onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'var(--color-on-surface-variant)'; }}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 16 }}>chevron_right</span>
      </button>

      {open && (
        <div className="glass-card" style={{
          position: 'absolute', top: 'calc(100% + 8px)', left: '50%', transform: 'translateX(-50%)',
          zIndex: 50, borderRadius: 12, padding: 6, minWidth: 168,
          display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 280, overflowY: 'auto',
        }}>
          {THEMES.map(t => (
            <button key={t.id} onClick={() => select(t.id)}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                padding: '7px 10px', borderRadius: 8, border: 'none', cursor: 'pointer',
                background: t.id === themeId ? 'rgba(167,46,74,0.10)' : 'transparent',
                color: 'var(--color-on-surface)', fontSize: 12.5, fontWeight: t.id === themeId ? 700 : 500,
                textAlign: 'left', transition: 'background 0.15s',
              }}
              onMouseEnter={e => { if (t.id !== themeId) e.currentTarget.style.background = 'rgba(167,46,74,0.06)'; }}
              onMouseLeave={e => { if (t.id !== themeId) e.currentTarget.style.background = 'transparent'; }}
            >
              {t.label}
              {t.id === themeId && <span className="material-symbols-outlined" style={{ fontSize: 15, color: 'var(--color-primary)' }}>check</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

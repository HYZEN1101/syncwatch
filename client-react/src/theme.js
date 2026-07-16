import { prefs } from './session';

// Central theme registry. "style" drives the .theme-dark class (see
// index.css's comment at the top of the Themes section) — everything else
// about a theme's actual colors lives in index.css's [data-theme="X"]
// blocks; this file only knows IDs, display labels, and light/dark style.
export const THEMES = [
  { id: 'legacy-light',   label: 'Legacy Light',   style: 'light' },
  { id: 'legacy-dark',    label: 'Legacy Dark',    style: 'dark'  },
  { id: 'rosewater-noir', label: 'Rosewater Noir', style: 'light' },
  { id: 'violet-dream',   label: 'Violet Dream',   style: 'light' },
  { id: 'midnight-mauve', label: 'Midnight Mauve', style: 'dark'  },
  { id: 'cotton-candy',   label: 'Cotton Candy',   style: 'light' },
  { id: 'lagoon-mist',    label: 'Lagoon Mist',    style: 'light' },
  { id: 'peach-sorbet',   label: 'Peach Sorbet',   style: 'light' },
  { id: 'blush-cream',    label: 'Blush Cream',    style: 'light' },
  { id: 'slate-teal',     label: 'Slate Teal',     style: 'dark'  },
];

const THEME_IDS = THEMES.map(t => t.id);

// Reads the stored theme, migrating old pre-multi-theme values ('dark'/
// 'light', from when this was a plain boolean toggle) to their renamed
// equivalents. Anything unrecognized (a future downgrade, corrupted
// storage, etc.) falls back to legacy-light rather than erroring. If
// nothing has ever been saved (a brand new user), falls back to the OS's
// prefers-color-scheme instead of always defaulting to light.
export function getInitialTheme() {
  const stored = prefs.get('sw-theme');
  if (stored === 'dark') return 'legacy-dark';
  if (stored === 'light') return 'legacy-light';
  if (stored && THEME_IDS.includes(stored)) return stored;
  if (!stored) {
    const prefersDark = typeof window !== 'undefined'
      && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    return prefersDark ? 'legacy-dark' : 'legacy-light';
  }
  return 'legacy-light';
}

// Applies a theme to the document and persists it. Called both on mount
// (so a theme picked on one page is already active when another page
// mounts) and whenever the user actually changes it.
export function applyTheme(themeId) {
  const theme = THEMES.find(t => t.id === themeId) || THEMES[0];
  document.documentElement.setAttribute('data-theme', theme.id);
  document.documentElement.classList.toggle('theme-dark', theme.style === 'dark');
  prefs.set('sw-theme', theme.id);
  return theme.id;
}

export function cycleTheme(currentId, direction) {
  const idx = Math.max(0, THEME_IDS.indexOf(currentId));
  const nextIdx = (idx + direction + THEME_IDS.length) % THEME_IDS.length;
  return THEME_IDS[nextIdx];
}

// ── session.js ──────────────────────────────────────────────────────────
// Room/identity state MUST be sessionStorage, not localStorage.
//
// Why: localStorage is shared across every tab on the same origin
// (http://localhost:3000). If you open two tabs to test SyncWatch with
// yourself, both tabs read/write the exact same keys — the second tab
// silently overwrites the first tab's room code, peer id, and role the
// moment it loads. This is what causes "Room not found" even when you
// just copied the code correctly: by the time you paste it, the other
// tab's localStorage write already clobbered the value.
//
// sessionStorage is scoped per-tab (technically per browsing-context),
// so each tab keeps its own independent copy and tabs never collide.
//
// Theme preference is the one exception — that should stay in
// localStorage since it's a genuine cross-tab user preference, not
// session state.

export const session = {
  get(key)        { return sessionStorage.getItem(key); },
  set(key, value) { sessionStorage.setItem(key, value); },
  remove(key)     { sessionStorage.removeItem(key); },
  clear() {
    ['sw_role','sw_code','sw_id','sw_name','sw_server','sw_initial_peers','sw_initial_stream_url','sw_initial_chat'].forEach(k => sessionStorage.removeItem(k));
  },
};

// Theme stays in localStorage — shared across tabs intentionally
export const prefs = {
  get(key)        { return localStorage.getItem(key); },
  set(key, value) { localStorage.setItem(key, value); },
};

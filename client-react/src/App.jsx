import { useState, useRef, useEffect } from 'react';
import { SyncWatchWS } from './ws';
import { Lobby } from './pages/Lobby';
import { Room  } from './pages/Room';
import { session, prefs } from './session';

// Derive the correct default WS URL — always ws://localhost:3000 in Electron
function defaultWsUrl() {
  const saved = session.get('sw_server');
  if (saved) return saved;
  // In Electron, location.protocol is 'http:' and host is 'localhost:3000'
  // In browser with ngrok, protocol is 'https:' so we use wss://
  const proto = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
  return proto + window.location.host;
}

export default function App() {
  // Logged on every load so you can confirm both browser windows are
  // running the EXACT same build. If they differ, one tab has stale JS —
  // close it completely and reopen, or hard-refresh with Ctrl+Shift+R.
  useEffect(() => {
    if (typeof __BUILD_TIME__ !== 'undefined') {
      console.log(`%cSyncWatch build: ${__BUILD_TIME__}`, 'color:#a72e4a;font-weight:bold;font-size:12px');
    }
  }, []);

  // Apply saved theme immediately — theme is the one thing that SHOULD
  // be shared across tabs, so it stays in localStorage via prefs.
  useEffect(() => {
    const saved = prefs.get('sw-theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.classList.toggle('dark', saved ? saved === 'dark' : prefersDark);
  }, []);

  // Room/session state uses sessionStorage — scoped to THIS tab only.
  // This is what makes multi-tab testing on the same machine actually work:
  // each tab keeps its own room code, role, and peer id independently.
  const [page, setPage] = useState(
    session.get('sw_code') ? 'room' : 'lobby'
  );

  // Single WS instance for app lifetime — stored in a ref so it never re-creates
  const wsRef = useRef(null);
  if (!wsRef.current) {
    wsRef.current = new SyncWatchWS(defaultWsUrl());
  }

  function handleJoined() { setPage('room'); }
  function handleLeave()  {
    session.clear();
    setPage('lobby');
  }

  return page === 'lobby'
    ? <Lobby ws={wsRef.current} onJoined={handleJoined} />
    : <Room  ws={wsRef.current} onLeave={handleLeave} />;
}

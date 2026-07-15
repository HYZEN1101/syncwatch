import { useState, useEffect, useRef, useCallback } from 'react';
import { session, prefs } from '../session';
import { ChatPanel } from '../components/ChatPanel';
import { VoiceBar  } from '../components/VoiceBar';
import { PeerList  } from '../components/PeerList';
import { Player    } from '../components/Player';
import { useSync   } from '../hooks/useSync';
import { useVoice  } from '../hooks/useVoice';
import { useChat   } from '../hooks/useChat';

// Auto-dismisses a one-off notification banner after a delay — used for
// the "something happened, here's what to do" banners below (load
// failures, bridge-not-detected, etc). Deliberately NOT used for anything
// reflecting a live, ongoing state (e.g. "connection lost" while actually
// still disconnected) or a blocking error the user needs to actively act
// on — auto-hiding either of those would be misleading, not helpful.
function useAutoDismiss(active, dismiss, ms = 10000) {
  useEffect(() => {
    if (!active) return;
    const t = setTimeout(dismiss, ms);
    return () => clearTimeout(t);
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps
}

function ThemeToggle() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  function toggle() {
    const next = !dark; setDark(next);
    document.documentElement.classList.toggle('dark', next);
    prefs.set('sw-theme', next ? 'dark' : 'light');
  }
  return (
    <button onClick={toggle} title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      style={{
        display:'flex', alignItems:'center', gap:6,
        padding:'5px 10px', border:'1px solid rgba(167,46,74,0.2)',
        borderRadius:20, background:'rgba(167,46,74,0.06)',
        cursor:'pointer', color:'var(--color-primary)',
        fontSize:11, fontWeight:600, transition:'all 0.2s',
      }}
      onMouseEnter={e => e.currentTarget.style.background='rgba(167,46,74,0.13)'}
      onMouseLeave={e => e.currentTarget.style.background='rgba(167,46,74,0.06)'}
    >
      <span className="material-symbols-outlined" style={{ fontSize:16 }}>
        {dark ? 'light_mode' : 'dark_mode'}
      </span>
      {dark ? 'Light' : 'Dark'}
    </button>
  );
}

/* Subtle floating decorations — same as lobby but lighter */
function FloralDeco() {
  const items = [
    { icon:'local_florist', style:{ top:'8%',  left:'1%',  fontSize:20, animationDelay:'0s',   animationDuration:'8s'  }},
    { icon:'auto_awesome',  style:{ top:'30%', left:'0.5%',fontSize:14, animationDelay:'2s',   animationDuration:'6s',  color:'var(--color-secondary)' }},
    { icon:'spa',           style:{ top:'65%', left:'1%',  fontSize:16, animationDelay:'4s',   animationDuration:'9s'  }},
    { icon:'local_florist', style:{ top:'85%', left:'2%',  fontSize:13, animationDelay:'1.5s', animationDuration:'7s',  color:'var(--color-secondary)' }},
    { icon:'auto_awesome',  style:{ top:'50%', left:'0.8%',fontSize:12, animationDelay:'3.5s', animationDuration:'10s' }},
  ];
  return (
    <>
      {items.map((it, i) => (
        <span key={i} className="material-symbols-outlined float-deco"
          style={{ position:'fixed', zIndex:1, pointerEvents:'none', opacity:0.18, ...it.style, color: it.style.color || 'var(--color-primary)' }}>
          {it.icon}
        </span>
      ))}
    </>
  );
}

export function Room({ ws, onLeave }) {
  const role   = session.get('sw_role');
  const myId   = session.get('sw_id');
  const myName = session.get('sw_name');

  // Room code is now LIVE STATE, not a one-time read from sessionStorage.
  // Why: if the server restarts (e.g. you ran `npm start` again while
  // testing), every in-memory room is wiped. The WebSocket auto-reconnects,
  // and the host's client re-sends CREATE_ROOM — but that produces a BRAND
  // NEW code. If we only ever read the code once on mount, the header
  // keeps showing the old, now-invalid code forever, and anyone you share
  // it with gets "Room not found" with no clue why.
  const [code, setCode] = useState(session.get('sw_code'));
  const [codeChanged, setCodeChanged] = useState(false);
  const [joinError, setJoinError] = useState('');

  // Captured by Lobby.jsx at the moment ROOM_JOINED genuinely fired (a
  // one-time event) and persisted to sessionStorage — read it directly
  // here on mount rather than trying to "catch" the same event again via
  // a new listener, which would always be too late. See the comment in
  // Lobby.jsx for the full explanation of why this can't work any other way.
  const [initialPeers, setInitialPeers] = useState(() => {
    try { return JSON.parse(session.get('sw_initial_peers') || '[]'); }
    catch { return []; }
  });
  const [initialStreamUrl] = useState(() => session.get('sw_initial_stream_url') || '');
  const [initialChat]      = useState(() => {
    try { return JSON.parse(session.get('sw_initial_chat') || '[]'); }
    catch { return []; }
  });
  const [initialVideoState] = useState(() => {
    try { return JSON.parse(session.get('sw_initial_video_state') || 'null'); }
    catch { return null; }
  });

  const [bridgeWarning, setBridgeWarning] = useState(false);
  // Tracks the domain of whatever's currently loaded in the iframe, so the
  // warning banner can tell the host exactly which site needs adding to
  // the bridge's match list — instead of a generic "not detected" message
  // that gives no clue which of the many possible embed sites is the
  // actual problem.
  const [streamHostname, setStreamHostname] = useState(null);
  // Tracks whatever URL is currently meant to be loaded, regardless of
  // whether the load actually succeeded — lets the Reload button retry
  // the exact same URL without anyone needing to retype it. This matters
  // because free embed aggregator sites are often genuinely flaky
  // (intermittent backend failures, rate limiting, DNS round-robin
  // hitting a dead node) — a quick reload frequently just works on the
  // next attempt with zero code-level fix needed.
  const [currentStreamUrl, setCurrentStreamUrl] = useState(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [connLost,      setConnLost]      = useState(false);
  // Custom fullscreen (CSS-driven, not the native Fullscreen API — see the
  // comment at the fullscreen toggle button below for why).
  const [isFullscreen, setIsFullscreen] = useState(false);
  // Populated only on a HOST rejoin (refresh/reconnect) via the
  // ROOM_CREATED listener above — applied once useSync/useChat exist,
  // in the effect further down.
  const [rejoinStreamUrl,    setRejoinStreamUrl]    = useState(null);
  const [rejoinChatHistory,  setRejoinChatHistory]  = useState(null);
  const [rejoinVideoState,   setRejoinVideoState]   = useState(null);
  const streamUrlRef   = useRef(null);
  const hasJoinedRef   = useRef(false); // ← prevents double-join
  const codeRef        = useRef(code);  // always-current code for doJoin's closure
  codeRef.current = code;

  // ── Join room ONCE, re-join only on genuine reconnect (or refresh) ────────
  //
  // IMPORTANT: Lobby.jsx already performs the real CREATE_ROOM/JOIN_ROOM
  // handshake for a normal "click Join" flow, and marks the WS INSTANCE
  // itself (ws._joinedOnThisConnection) once the server confirms it.
  //
  // We check that marker — NOT sessionStorage — to decide whether we
  // still need to join. This distinction matters because sessionStorage
  // survives a page REFRESH, but a refresh always creates a brand new
  // `ws` object (App.jsx remounts from scratch via a fresh WebSocket
  // connection). The OLD connection is gone server-side the moment the
  // browser tears down the page, taking us out of room.peers with it —
  // so a refreshed tab genuinely needs to send a fresh JOIN_ROOM/
  // CREATE_ROOM, even though sessionStorage still has old code/id values
  // sitting around from before the refresh.
  const alreadyConfirmed = ws._joinedOnThisConnection === true;

  const doJoin = useCallback(() => {
    if (role === 'host') ws.send({ type: 'CREATE_ROOM', displayName: myName, previousCode: codeRef.current });
    else                 ws.send({ type: 'JOIN_ROOM', code: codeRef.current, displayName: myName });
  }, [ws, role, myName]);

  // Track the server's response so the displayed code is always accurate,
  // and detect when a reconnect silently produced a different code.
  useEffect(() => {
    const offCreated = ws.on('ROOM_CREATED', msg => {
      if (hasJoinedRef.current && msg.code !== codeRef.current) {
        // This is a genuine restart-induced new room, not the first join
        setCodeChanged(true);
        setTimeout(() => setCodeChanged(false), 8000);
      }
      setCode(msg.code);
      session.set('sw_code', msg.code);
      session.set('sw_id', msg.peerId);
      ws._joinedOnThisConnection = true;
      // Host's own refresh/reconnect path: the server replays the
      // room's current stream + chat here too (msg.rejoined === true
      // when this is a genuine rejoin, but applying it unconditionally
      // is harmless — a brand-new room simply has null/[] for both).
      if (msg.streamUrl)    setRejoinStreamUrl(msg.streamUrl);
      if (msg.chatHistory)  setRejoinChatHistory(msg.chatHistory);
      if (msg.lastVideoState) setRejoinVideoState(msg.lastVideoState);
      setJoinError('');
    });
    const offJoined = ws.on('ROOM_JOINED', msg => {
      setCode(msg.code);
      setInitialPeers(msg.peers || []);
      session.set('sw_code', msg.code);
      session.set('sw_id', msg.peerId);
      ws._joinedOnThisConnection = true;
      // WATCHER refresh/reconnect path — mirrors the host's offCreated
      // handler above. This is the actual fix for chat history not
      // surviving a refresh: this listener (registered here, in
      // Room.jsx, while the component is genuinely mounted) is the one
      // that fires on a real rejoin. The sessionStorage-based
      // initialStreamUrl/initialChat values are only used for the FIRST
      // render before any network round trip completes — on a refresh,
      // Lobby.jsx never runs again to refresh those session values, so
      // we must apply the server's fresh reply directly here instead.
      if (msg.streamUrl)   setRejoinStreamUrl(msg.streamUrl);
      if (msg.chatHistory) setRejoinChatHistory(msg.chatHistory);
      if (msg.lastVideoState) setRejoinVideoState(msg.lastVideoState);
      setJoinError('');
    });
    const offError = ws.on('ERROR', msg => {
      // If we're a watcher and a reconnect-triggered re-join fails, the
      // room genuinely no longer exists (host hasn't reconnected yet, or
      // restarted with a different code). Surface this clearly instead
      // of leaving a blank/confusing room screen.
      if (role !== 'host') setJoinError(msg.reason || 'Room no longer available.');
    });
    return () => { offCreated(); offJoined(); offError(); };
  }, [ws, role]);

  useEffect(() => {
    if (alreadyConfirmed) {
      // Lobby already completed the handshake for this session — don't
      // send a redundant join. Just mark joined so future onStatus
      // 'open' events (genuine reconnects) correctly re-join instead of
      // being mistaken for the first join.
      hasJoinedRef.current = true;
    } else if (ws._ws?.readyState === WebSocket.OPEN && !hasJoinedRef.current) {
      // Defensive fallback: we got here without a confirmed join
      // (e.g. direct navigation with stale sessionStorage). Try to join.
      hasJoinedRef.current = true;
      doJoin();
    }

    // onStatus fires for FUTURE state changes only — this is what handles
    // genuine reconnects (network drop, server restart), not the initial join.
    const offStatus = ws.onStatus(s => {
      if (s === 'open') {
        if (hasJoinedRef.current) {
          doJoin(); // re-join after a real reconnect
        } else {
          hasJoinedRef.current = true;
          doJoin();
        }
        setConnLost(false);
      }
      if (s === 'closed') setConnLost(true);
    }, false); // false = don't fire immediately, prevents double-join on mount

    return offStatus;
  }, []); // empty deps — run once on mount only

  // ── Bridge detection ──────────────────────────────────────────────────────
  //
  // bridgeCheckTimerRef holds whichever "show the warning in N seconds"
  // timer is currently pending. This is the fix for the warning banner
  // appearing even when the bridge DID respond: previously the 4-second
  // "assume it's missing" timeout was unconditional — nothing cancelled
  // it just because SYNCWATCH_BRIDGE_READY/PONG arrived in time. Now the
  // message handler clears the pending timer the moment a real response
  // shows up, so a successful detection can never be overwritten by a
  // stale timeout firing afterward.
  const bridgeCheckTimerRef = useRef(null);

  useEffect(() => {
    function onMsg(e) {
      if (e.data?.type === 'SYNCWATCH_BRIDGE_READY' || e.data?.type === 'SYNCWATCH_PONG') {
        setBridgeWarning(false);
        if (bridgeCheckTimerRef.current) {
          clearTimeout(bridgeCheckTimerRef.current);
          bridgeCheckTimerRef.current = null;
        }
      }
    }
    window.addEventListener('message', onMsg);
    return () => {
      window.removeEventListener('message', onMsg);
      if (bridgeCheckTimerRef.current) clearTimeout(bridgeCheckTimerRef.current);
    };
  }, []);

  const sync  = useSync(ws, code, role, (url) => {
    if (url) { try { setStreamHostname(new URL(url).hostname); } catch {} }
    checkBridgeRef.current?.();
  });
  const voice = useVoice(ws, code);
  const chat  = useChat(ws, code, initialChat);

  // Pings the embed repeatedly for a few seconds (instead of once) and
  // schedules a single cancellable "assume missing" check. Repeated
  // pinging matters because the bridge userscript announces itself only
  // once, at DOMContentLoaded — if that announcement fires before our
  // own message listener has mounted (a real race when the iframe loads
  // fast), a single ping-and-wait can miss it entirely. Re-pinging a few
  // times during the detection window means the bridge gets multiple
  // chances to answer even if its first announcement was missed.
  //
  // The scheduled "assume missing" timeout is cancellable: the message
  // listener above clears it the moment a real PONG/READY arrives, so a
  // successful detection can never be clobbered by a stale timeout that
  // was already in flight when the response showed up.
  const checkBridgeRef = useRef(null);
  const checkBridge = useCallback(() => {
    if (sync.isElectron) return; // no bridge/Tampermonkey concept on the Electron path — nothing to detect
    if (bridgeCheckTimerRef.current) clearTimeout(bridgeCheckTimerRef.current);

    let attempts = 0;
    const pingInterval = setInterval(() => {
      attempts++;
      try { sync.frameRef.current?.contentWindow?.postMessage({ action: 'ping' }, '*'); } catch {}
      if (attempts >= 4) clearInterval(pingInterval); // ~4 pings over the detection window
    }, 700);

    bridgeCheckTimerRef.current = setTimeout(() => {
      clearInterval(pingInterval);
      setBridgeWarning(true);
    }, 4000);
  }, [sync]);

  // Keep the ref-indirection (used by useSync's onStreamLoaded callback,
  // which is created before checkBridge exists) pointed at the latest version.
  useEffect(() => { checkBridgeRef.current = checkBridge; }, [checkBridge]);

  // Small helper used everywhere we load a URL into the iframe, so the
  // bridge warning banner can always show which domain is actually loaded
  // (previously the warning said "not detected" with no way to tell WHICH
  // of the many possible embed sites was actually the problem).
  function applyStreamUrl(url) {
    setCurrentStreamUrl(url);
    setLoadFailed(false);
    try { setStreamHostname(new URL(url).hostname); } catch { setStreamHostname(null); }
    // Phase 4: loadUrl now resolves with { ok, error } on both paths — on
    // Electron this is a real "did the site actually fail to load at all"
    // signal (distinct from sync.videoNotFound, which means the page DID
    // load but no <video> was ever found on it). The browser path always
    // resolves ok:true here since Player.jsx's iframe onError already
    // covers that case separately.
    sync.loadUrl(url).then((result) => {
      if (result && result.ok === false) setLoadFailed(true);
    });
  }

  // Retries the same URL that's already loaded — for when an embed
  // aggregator's flaky backend fails on one attempt but works on the
  // next. No code or settings change needed; this is purely "try again".
  // sync.loadUrl already handles forcing a genuine reload of an identical
  // URL on both the browser and Electron paths, so this just re-invokes it.
  function reloadStream() {
    if (!currentStreamUrl) return;
    setLoadFailed(false);
    sync.loadUrl(currentStreamUrl).then((result) => {
      if (result && result.ok === false) setLoadFailed(true);
    });
    // A flaky embed almost always fails the same way for everyone in the
    // room (they're all loading the identical URL) — re-broadcasting it
    // tells watchers to reload too instead of staying stuck on a dead frame.
    if (isHost) ws.send({ type: 'STREAM_URL', url: currentStreamUrl, code });
  }

  // Restore the room's current movie automatically — this is the fix for
  // "refresh as a watcher and the stream disappears". The server replays
  // its remembered streamUrl in ROOM_JOINED/ROOM_CREATED (captured above
  // into initialStreamUrl by Lobby.jsx); we just need to actually apply
  // it to the iframe once the ref exists. Runs once on mount.
  useEffect(() => {
    if (initialStreamUrl && sync.frameRef.current) {
      applyStreamUrl(initialStreamUrl);
      sync.setHasFrame(true);
      setBridgeWarning(false);
      setTimeout(() => checkBridge(), 1500);
      // Position restore (Phase 4): resume near the actual last known
      // playback position/state instead of from zero. applyState's own
      // drift correction naturally does the right thing here — a large
      // "drift" between a fresh 0 and the real remembered position is
      // exactly what triggers its forced-seek path, and for a 'play'
      // state it also accounts for real time elapsed since the state was
      // recorded (see server/roomManager.js's setVideoState). A short
      // delay gives the freshly-loading page a moment before we also ask
      // it to seek — not strictly required (the command itself retries
      // for up to ~10s per electron/playback.js), but avoids piling every
      // command into the same instant on a slow-loading embed.
      if (initialVideoState) {
        setTimeout(() => {
          sync.applyState(initialVideoState.state, initialVideoState.currentTime, initialVideoState.timestamp);
        }, 800);
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // HOST refresh/reconnect path: applies streamUrl + chatHistory that
  // arrived via the ROOM_CREATED listener further up, a tick after
  // mount. (The watcher path above handles the equivalent case via
  // initialStreamUrl/initialChat, which are available synchronously on
  // mount because Lobby.jsx persisted them to sessionStorage already.)
  useEffect(() => {
    if (rejoinStreamUrl && sync.frameRef.current) {
      applyStreamUrl(rejoinStreamUrl);
      sync.setHasFrame(true);
      setBridgeWarning(false);
      setTimeout(() => checkBridge(), 1500);
      // Position restore (Phase 4) — mirrors the initialStreamUrl path
      // above; see its comment for why the drift-correction math and the
      // short delay both work out correctly here.
      if (rejoinVideoState) {
        setTimeout(() => {
          sync.applyState(rejoinVideoState.state, rejoinVideoState.currentTime, rejoinVideoState.timestamp);
        }, 800);
      }
    }
  }, [rejoinStreamUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (rejoinChatHistory) chat.restoreMessages(rejoinChatHistory);
  }, [rejoinChatHistory]);

  // ── URL normalization ──────────────────────────────────────────────────
  //
  // Some sites have TWO URL formats: a normal page (which sends
  // X-Frame-Options to block embedding — by design, e.g. youtube.com/watch)
  // and a dedicated embed format that's specifically built to work inside
  // an iframe (e.g. youtube.com/embed/VIDEO_ID). Pasting the normal-page
  // URL is an easy, common mistake — this rewrites it automatically so
  // people don't need to remember the embed format themselves.
  //
  // This does NOT help with sites that have no embed-friendly format at
  // all (e.g. a streaming aggregator that blocks framing outright) — for
  // those there's genuinely no URL rewrite that fixes it; see the bridge
  // warning banner for that explanation instead.
  function normalizeStreamUrl(rawUrl) {
    try {
      const u = new URL(rawUrl);
      const host = u.hostname.replace(/^www\./, '');

      // youtube.com/watch?v=ID[&t=Ns] → youtube.com/embed/ID[?start=N]
      if (host === 'youtube.com' && u.pathname === '/watch') {
        const videoId = u.searchParams.get('v');
        if (videoId) {
          const tParam = u.searchParams.get('t'); // e.g. "80s" or "80"
          const startSeconds = tParam ? parseInt(tParam.replace(/s$/, ''), 10) : null;
          let embedUrl = `https://www.youtube.com/embed/${videoId}`;
          if (startSeconds && !isNaN(startSeconds)) embedUrl += `?start=${startSeconds}`;
          return embedUrl;
        }
      }

      // youtu.be/ID[?t=Ns] → youtube.com/embed/ID[?start=N]
      if (host === 'youtu.be') {
        const videoId = u.pathname.slice(1);
        if (videoId) {
          const tParam = u.searchParams.get('t');
          const startSeconds = tParam ? parseInt(tParam.replace(/s$/, ''), 10) : null;
          let embedUrl = `https://www.youtube.com/embed/${videoId}`;
          if (startSeconds && !isNaN(startSeconds)) embedUrl += `?start=${startSeconds}`;
          return embedUrl;
        }
      }

      // Already an embed-format URL, or a site with no known alternate — leave as-is
      return rawUrl;
    } catch {
      return rawUrl; // not a valid URL at all — let the normal load-failure path handle it
    }
  }

  function loadStream() {
    const rawUrl = streamUrlRef.current?.value.trim();
    if (!rawUrl) return;
    const url = normalizeStreamUrl(rawUrl);
    if (url !== rawUrl && streamUrlRef.current) streamUrlRef.current.value = url; // show the rewritten URL
    applyStreamUrl(url);
    sync.setHasFrame(true);
    ws.send({ type: 'STREAM_URL', url, code });
    setBridgeWarning(false);
    setTimeout(() => checkBridge(), 1500);
  }

  // Focus reclaim — stop iframe eating keyboard shortcuts
  useEffect(() => {
    function onBlur() { setTimeout(() => { window.focus(); document.body.focus(); }, 50); }
    window.addEventListener('blur', onBlur);
    return () => window.removeEventListener('blur', onBlur);
  }, []);

  // Escape exits custom fullscreen — only registered while actually in it,
  // so it doesn't interfere with anything else Escape might be expected to
  // do elsewhere in the room.
  useEffect(() => {
    if (!isFullscreen) return;
    function onKey(e) { if (e.key === 'Escape') setIsFullscreen(false); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isFullscreen]);

  const isHost = role === 'host';

  // Auto-dismiss one-off notification banners after 10s — see
  // useAutoDismiss's own comment above for why connLost/joinError are
  // deliberately excluded.
  useAutoDismiss(codeChanged, () => setCodeChanged(false));
  useAutoDismiss(loadFailed, () => setLoadFailed(false));
  useAutoDismiss(sync.videoNotFound, () => sync.setVideoNotFound(false));
  useAutoDismiss(bridgeWarning, () => setBridgeWarning(false));

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100vh', overflow:'hidden', background:'var(--color-background)', position:'relative' }}>

      {/* Subtle ambient background */}
      <div className="floral-bg" style={{ opacity:0.4 }} />
      <FloralDeco />

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="app-header" style={{
        height:52, display:'flex', alignItems:'center', justifyContent:'space-between',
        padding:'0 16px', flexShrink:0, position:'relative', zIndex:10,
        backdropFilter:'blur(16px)',
      }}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <span className="font-logo" style={{ fontSize:16, color:'var(--color-primary)', letterSpacing:'-0.01em' }}>
            SyncWatch
          </span>
          <div className="font-room-name" style={{
            fontSize:11, padding:'3px 10px',
            background:'var(--color-primary-fixed)', color:'var(--color-on-primary-fixed)',
            borderRadius:6, letterSpacing:'0.07em',
            display:'flex', alignItems:'center', gap:5,
          }}>
            <span className="material-symbols-outlined" style={{ fontSize:13 }}>movie</span>
            {code}
          </div>
        </div>

        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          {/* Phase 4: on Electron, the WebContentsView composites above
              regular page content within its bounds — an overlay positioned
              on top of the video (the version further below) would render
              BEHIND it once a stream loads. Moved here instead, which is
              genuinely outside the video's bounding rect rather than trying
              to carve a gap out of it. Browser build is unaffected by this
              issue (no native view involved) and keeps the original
              on-video placement, so this is deliberately Electron-only. */}
          {sync.isElectron && (
            <div style={{ fontSize:11, fontWeight:500, padding:'4px 10px', borderRadius:9999, background:'rgba(0,0,0,0.06)', color:'var(--color-on-surface-variant, #555)', display:'flex', alignItems:'center', gap:6 }}>
              {sync.status}
            </div>
          )}
          <ThemeToggle />
          <button onClick={onLeave}
            style={{ fontSize:12, fontWeight:600, padding:'5px 12px', background:'rgba(186,26,26,0.07)', color:'var(--color-error)', border:'1px solid rgba(186,26,26,0.18)', borderRadius:20, cursor:'pointer', transition:'all 0.2s' }}
            onMouseEnter={e => e.currentTarget.style.background='rgba(186,26,26,0.13)'}
            onMouseLeave={e => e.currentTarget.style.background='rgba(186,26,26,0.07)'}
          >Leave</button>
        </div>
      </header>

      {/* ── Banners ─────────────────────────────────────────────────────────── */}
      {connLost && (
        <div style={{ padding:'7px 16px', background:'rgba(245,158,11,0.12)', borderBottom:'1px solid rgba(245,158,11,0.3)', fontSize:12, color:'#92400e', display:'flex', alignItems:'center', gap:8, flexShrink:0, zIndex:10, position:'relative' }}>
          <span className="material-symbols-outlined" style={{ fontSize:16 }}>wifi_off</span>
          Connection lost — reconnecting…
        </div>
      )}
      {codeChanged && isHost && (
        <div style={{ padding:'9px 16px', background:'rgba(167,46,74,0.12)', borderBottom:'1px solid rgba(167,46,74,0.3)', fontSize:12, color:'var(--color-primary)', display:'flex', alignItems:'center', gap:8, flexShrink:0, zIndex:10, position:'relative', fontWeight:600 }}>
          <span className="material-symbols-outlined" style={{ fontSize:16 }}>autorenew</span>
          The server restarted, so your room got a <strong>new code: {code}</strong> — re-share it with your friends.
          <button onClick={() => setCodeChanged(false)} style={{ marginLeft:'auto', background:'none', border:'none', cursor:'pointer', color:'var(--color-primary)', fontSize:16, padding:0 }}>✕</button>
        </div>
      )}
      {joinError && (
        <div style={{ padding:'9px 16px', background:'rgba(186,26,26,0.1)', borderBottom:'1px solid rgba(186,26,26,0.3)', fontSize:12, color:'#93000a', display:'flex', alignItems:'center', gap:8, flexShrink:0, zIndex:10, position:'relative', fontWeight:600 }}>
          <span className="material-symbols-outlined" style={{ fontSize:16 }}>error</span>
          {joinError} The host may have restarted their server — ask them for the new room code.
          <button onClick={onLeave} style={{ marginLeft:'auto', fontSize:11, fontWeight:700, padding:'3px 12px', background:'rgba(186,26,26,0.15)', border:'none', borderRadius:6, color:'#93000a', cursor:'pointer' }}>
            Back to lobby
          </button>
        </div>
      )}
      {loadFailed && isHost && (
        <div style={{ padding:'9px 16px', background:'rgba(245,158,11,0.12)', borderBottom:'1px solid rgba(245,158,11,0.3)', fontSize:12, color:'#92400e', display:'flex', alignItems:'center', gap:8, flexShrink:0, zIndex:10, position:'relative', flexWrap:'wrap' }}>
          <span className="material-symbols-outlined" style={{ fontSize:16 }}>wifi_off</span>
          <strong>This embed failed to load.</strong> Free embed/mirror sites are often genuinely
          unreliable — this is usually their server, not a SyncWatch problem. Worth trying:
          <strong>Reload</strong> (often just works on retry), a different mirror/source for the
          same movie, or disabling an ad blocker if you have one — some embeds break under
          aggressive blocking.
          <button onClick={reloadStream} style={{ fontSize:11, fontWeight:700, padding:'3px 12px', background:'rgba(245,158,11,0.18)', border:'none', borderRadius:6, color:'#92400e', cursor:'pointer' }}>
            Try again
          </button>
          <button onClick={() => setLoadFailed(false)} style={{ marginLeft:'auto', background:'none', border:'none', cursor:'pointer', color:'#92400e', fontSize:16, padding:0 }}>✕</button>
        </div>
      )}
      {sync.videoNotFound && isHost && (
        // Phase 4: distinct failure mode from loadFailed above — the page
        // itself loaded fine (no network/frame error), but no <video>
        // element was ever found on it after a ~10s search. Electron-only:
        // the browser/bridge path has its own separate detection for this
        // via checkBridge's ping/pong, covered by the bridgeWarning banner.
        <div style={{ padding:'9px 16px', background:'rgba(245,158,11,0.12)', borderBottom:'1px solid rgba(245,158,11,0.3)', fontSize:12, color:'#92400e', display:'flex', alignItems:'center', gap:8, flexShrink:0, zIndex:10, position:'relative', flexWrap:'wrap' }}>
          <span className="material-symbols-outlined" style={{ fontSize:16 }}>videocam_off</span>
          <strong>This page loaded, but no video was found on it.</strong> The site may need you to
          click play manually first, pick a different source/server on the page itself, or it's
          just not a supported embed. Worth trying <strong>Reload</strong>, or a different mirror.
          <button onClick={reloadStream} style={{ fontSize:11, fontWeight:700, padding:'3px 12px', background:'rgba(245,158,11,0.18)', border:'none', borderRadius:6, color:'#92400e', cursor:'pointer' }}>
            Try again
          </button>
          <button onClick={() => sync.setVideoNotFound(false)} style={{ marginLeft:'auto', background:'none', border:'none', cursor:'pointer', color:'#92400e', fontSize:16, padding:0 }}>✕</button>
        </div>
      )}
      {bridgeWarning && (
        <div style={{ padding:'7px 16px', background:'rgba(255,218,214,0.95)', borderBottom:'1px solid rgba(186,26,26,0.2)', fontSize:12, color:'#93000a', display:'flex', alignItems:'flex-start', gap:8, flexShrink:0, zIndex:10, position:'relative', flexWrap:'wrap' }}>
          <span className="material-symbols-outlined" style={{ fontSize:16, marginTop:1 }}>extension_off</span>
          <div>
            <div><strong>Bridge not detected</strong> — play/pause/seek won't control the video without it.</div>
            <div style={{ marginTop:4, fontWeight:500 }}>
              Two common causes: {streamHostname ? <>this site (<code style={{ background:'rgba(186,26,26,0.1)', padding:'1px 6px', borderRadius:4 }}>{streamHostname}</code>) isn't in the bridge's list yet — <a href="/install-bridge.html#add-domain" target="_blank" style={{ color:'#93000a', fontWeight:700 }}>add it in 30s</a> — </> : <>the embed domain isn't in the bridge's list — <a href="/install-bridge.html" target="_blank" style={{ color:'#93000a', fontWeight:700 }}>install guide</a> — </>}
              <strong>or</strong> the site itself blocks being shown in any iframe at all (a security setting called X-Frame-Options).
              If the screen shows a Chrome "refused to connect" page rather than a real video, it's the second one — that's the
              site's own deliberate choice, not something we can fix on our end. Try a different mirror or source for the same movie.
            </div>
          </div>
          <button onClick={() => setBridgeWarning(false)} style={{ marginLeft:'auto', background:'none', border:'none', cursor:'pointer', color:'#93000a', fontSize:16, padding:0 }}>✕</button>
        </div>
      )}

      {/* ── URL bar (host only) ─────────────────────────────────────────────── */}
      {isHost && (
        <div style={{
          display:'flex', gap:10, padding:'9px 14px', flexShrink:0, position:'relative', zIndex:10,
          background:'var(--color-surface-container-lowest)',
          borderBottom:'1px solid rgba(222,191,194,0.25)',
        }}>
          <div style={{ flex:1, position:'relative' }}>
            <span className="material-symbols-outlined" style={{ position:'absolute', left:11, top:'50%', transform:'translateY(-50%)', color:'var(--color-outline)', fontSize:17, pointerEvents:'none' }}>link</span>
            <input ref={streamUrlRef} className="sw-input"
              placeholder="Paste embed URL — e.g. https://vidsrc.to/embed/movie/tt0111161"
              style={{ paddingLeft:35, fontSize:13 }}
              onKeyDown={e => e.key === 'Enter' && loadStream()} />
          </div>
          <button onClick={loadStream}
            style={{ padding:'9px 20px', background:'linear-gradient(135deg,var(--color-primary),#c44060)', color:'#fff', border:'none', borderRadius:8, fontWeight:700, fontSize:13, cursor:'pointer', display:'flex', alignItems:'center', gap:6, whiteSpace:'nowrap', transition:'all 0.2s', boxShadow:'0 2px 10px rgba(167,46,74,0.25)' }}
            onMouseEnter={e => { e.currentTarget.style.opacity='0.88'; e.currentTarget.style.transform='translateY(-1px)'; }}
            onMouseLeave={e => { e.currentTarget.style.opacity='1'; e.currentTarget.style.transform='translateY(0)'; }}
          >
            Load <span className="material-symbols-outlined" style={{ fontSize:16 }}>play_arrow</span>
          </button>
          {currentStreamUrl && (
            <button onClick={reloadStream} title="Retry the same URL — embed sites are often just flaky"
              style={{ padding:'9px 14px', background:'var(--color-surface-container-high)', color:'var(--color-on-surface-variant)', border:'1px solid var(--color-outline-variant)', borderRadius:8, fontWeight:600, fontSize:13, cursor:'pointer', display:'flex', alignItems:'center', gap:5, whiteSpace:'nowrap', transition:'all 0.2s' }}
              onMouseEnter={e => e.currentTarget.style.background='var(--color-surface-container-highest)'}
              onMouseLeave={e => e.currentTarget.style.background='var(--color-surface-container-high)'}
            >
              <span className="material-symbols-outlined" style={{ fontSize:16 }}>refresh</span>
              Reload
            </button>
          )}
        </div>
      )}

      {/* ── Main layout ─────────────────────────────────────────────────────── */}
      <div style={{ display:'flex', flex:1, overflow:'hidden', position:'relative', zIndex:5 }}>

        {/* Player column */}
        <div style={
          isFullscreen
            ? { position:'fixed', inset:0, zIndex:1000, display:'flex', flexDirection:'column', background:'var(--color-background)' }
            : { flex:1, display:'flex', flexDirection:'column', minWidth:0 }
        }>

          <div style={{ flex:1, background:'#0a0a0f', position:'relative' }}>
            <Player
              frameRef={sync.frameRef}
              canControl={isHost}
              hasFrame={sync.hasFrame}
              onLoad={() => { if (sync.frameRef.current?.src) sync.setHasFrame(true); }}
              onError={() => setLoadFailed(true)}
            />

            {/* Empty state */}
            {!sync.hasFrame && (
              <div style={{ position:'absolute', inset:0, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:14 }}>
                <div style={{ position:'absolute', inset:0, overflow:'hidden', opacity:0.06 }}>
                  {[{t:'12%',l:'8%',s:70,r:0},{t:'65%',l:'78%',s:55,r:45},{t:'75%',l:'12%',s:50,r:20},{t:'10%',l:'72%',s:60,r:15},{t:'45%',l:'45%',s:40,r:30}].map((p,i) => (
                    <span key={i} className="material-symbols-outlined" style={{ position:'absolute', top:p.t, left:p.l, fontSize:p.s, color:'var(--color-primary)', transform:`rotate(${p.r}deg)` }}>local_florist</span>
                  ))}
                </div>
                <span className="material-symbols-outlined" style={{ fontSize:68, color:'rgba(255,255,255,0.18)' }}>movie_edit</span>
                <p style={{ color:'rgba(255,255,255,0.32)', fontSize:15, fontWeight:600, margin:0 }}>
                  {isHost ? 'Paste a movie URL above to begin ✦' : 'Waiting for host to load a movie…'}
                </p>
                {isHost && <p style={{ color:'rgba(255,255,255,0.18)', fontSize:12, margin:0 }}>Try: https://vidsrc.to/embed/movie/tt0111161</p>}
              </div>
            )}

            {/* Sync status — browser build only; see the header for the
                Electron equivalent (comment above explains why). */}
            {!sync.isElectron && (
              <div style={{ position:'absolute', top:12, right:12, padding:'5px 12px', borderRadius:9999, background:'rgba(0,0,0,0.55)', backdropFilter:'blur(8px)', display:'flex', alignItems:'center', gap:6, border:'1px solid rgba(255,255,255,0.12)', pointerEvents:'none' }}>
                <span className="sync-dot" style={{ width:7, height:7, borderRadius:'50%', background:'#4ade80', display:'block', flexShrink:0 }} />
                <span style={{ fontSize:11, fontWeight:500, color:'#fff' }}>{sync.status}</span>
              </div>
            )}
          </div>

          {/* Controls */}
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'9px 14px', flexShrink:0, background:'var(--color-surface-container-lowest)', borderTop:'1px solid rgba(222,191,194,0.2)', gap:8 }}>
            <div style={{ display:'flex', gap:2 }}>
              <button onClick={sync.isPlaying ? sync.sendPause : sync.sendPlay} title={sync.isPlaying ? 'Pause (Space)' : 'Play (Space)'}
                style={{ background:'none', border:'none', cursor:'pointer', padding:4, borderRadius:'50%', color:'var(--color-primary)', display:'flex', transition:'transform 0.15s' }}
                onMouseEnter={e=>e.currentTarget.style.transform='scale(1.12)'}
                onMouseLeave={e=>e.currentTarget.style.transform='scale(1)'}
              ><span className="material-symbols-outlined" style={{fontSize:34}}>{sync.isPlaying ? 'pause_circle' : 'play_circle'}</span></button>
            </div>
            <div style={{ display:'flex', gap:4 }}>
              {[{icon:'replay_30',d:-30,l:'-30s'},{icon:'replay_10',d:-10,l:'-10s'},{icon:'forward_10',d:+10,l:'+10s'},{icon:'forward_30',d:+30,l:'+30s'}].map(({icon,d,l})=>(
                <button key={icon} onClick={()=>sync.sendSeek(d)} title={l}
                  style={{ background:'none', border:'none', cursor:'pointer', display:'flex', flexDirection:'column', alignItems:'center', gap:1, padding:'4px 6px', borderRadius:8, color:'var(--color-on-surface-variant)', transition:'all 0.15s' }}
                  onMouseEnter={e=>{e.currentTarget.style.background='rgba(167,46,74,0.07)';e.currentTarget.style.color='var(--color-primary)';}}
                  onMouseLeave={e=>{e.currentTarget.style.background='none';e.currentTarget.style.color='var(--color-on-surface-variant)';}}
                >
                  <span className="material-symbols-outlined" style={{fontSize:22}}>{icon}</span>
                  <span style={{fontSize:9,fontWeight:600}}>{l}</span>
                </button>
              ))}
            </div>
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              <span style={{ fontSize:10, color:'var(--color-outline)', opacity:0.7 }}>Space · ←→ · Shift+←→</span>
              <span
                title={'Space — Play / Pause\n← / →  — Seek 10 seconds\nShift + ← / →  — Seek 30 seconds'}
                style={{ display:'flex', cursor:'help', color:'var(--color-on-surface-variant)', opacity:0.75 }}
              >
                <span className="material-symbols-outlined" style={{ fontSize:16 }}>info</span>
              </span>
              {/* Custom fullscreen (CSS-driven), not the native Fullscreen API.
                  requestFullscreen() used to be called on the placeholder
                  <div> that Player.jsx positions the real WebContentsView
                  over — the actual video (a separate native view, not part
                  of this DOM at all) never followed it into fullscreen, and
                  worse, entering/exiting native fullscreen on an unrelated
                  empty element left the whole renderer's layout in a broken
                  state until a manual window resize forced a relayout —
                  the exact "UI vanishes after exiting fullscreen" bug.
                  Toggling isFullscreen instead just changes real CSS layout
                  (see the player column's style above), which Player.jsx's
                  existing bounds-tracking loop picks up and reports to the
                  native view automatically — no separate fix needed there. */}
              <button title={isFullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen'} onClick={() => setIsFullscreen(f => !f)}
                style={{ background:'none', border:'none', cursor:'pointer', color:'var(--color-on-surface-variant)', display:'flex', padding:4, borderRadius:6, transition:'all 0.15s' }}
                onMouseEnter={e=>{e.currentTarget.style.background='rgba(167,46,74,0.07)';e.currentTarget.style.color='var(--color-primary)';}}
                onMouseLeave={e=>{e.currentTarget.style.background='none';e.currentTarget.style.color='var(--color-on-surface-variant)';}}
              ><span className="material-symbols-outlined" style={{fontSize:20}}>{isFullscreen ? 'fullscreen_exit' : 'fullscreen'}</span></button>
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <aside style={{ width:272, flexShrink:0, display:'flex', flexDirection:'column', overflow:'hidden', background:'var(--color-surface-container-low)', borderLeft:'1px solid rgba(222,191,194,0.25)' }}>
          <PeerList ws={ws} code={code} role={role} myId={myId} initialPeers={initialPeers} />
          <VoiceBar {...voice} />
          <ChatPanel messages={chat.messages} sendMessage={chat.sendMessage} />
        </aside>
      </div>
    </div>
  );
}

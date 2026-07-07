import { useRef, useState, useEffect, useCallback } from 'react';
import { session } from '../session';

const DRIFT_THRESHOLD = 2;

// Phase 2: feature-detect the Electron playback bridge exposed by
// electron/preload.js. When present, playback commands and stream loading
// go through window.syncwatch.playback.* (WebContentsView + direct
// per-frame executeJavaScript — see electron/playback.js and
// HANDOFF_PHASE_1.md) instead of postMessage into an <iframe>. The browser/
// web build (no window.syncwatch) keeps using the original iframe +
// Tampermonkey-bridge path unchanged — this is the "browser version
// continues as fallback" requirement from the original migration spec.
const isElectron = typeof window !== 'undefined' && !!window.syncwatch?.playback;

export function useSync(ws, code, role, onStreamLoaded) {
  const frameRef     = useRef(null);
  const localPlaying = useRef(false);
  const localTime    = useRef(0);
  const startedAt    = useRef(null);
  const [status, setStatus] = useState('Waiting for stream…');
  const [hasFrame, setHasFrame] = useState(false);

  function estimatedTime() {
    if (!localPlaying.current || !startedAt.current) return localTime.current;
    return localTime.current + (Date.now() - startedAt.current) / 1000;
  }

  function fmtTime(s) {
    s = Math.max(0, s);
    return `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;
  }

  function iframeCmd(action, seconds) {
    if (isElectron) {
      // Fire-and-forget from the caller's perspective, same as the old
      // postMessage call — errors are logged, not thrown, so a single
      // failed command (e.g. no <video> found yet) doesn't break sync flow.
      window.syncwatch.playback.command(action, seconds).catch(err => {
        console.warn('[useSync] Electron playback command failed:', action, err);
      });
      return;
    }
    try {
      const m = seconds !== undefined ? { action, seconds } : { action };
      frameRef.current?.contentWindow?.postMessage(m, '*');
    } catch {}
  }

  // Loads a stream URL through whichever path applies. Used both for the
  // local host action (Room.jsx's loadStream/reloadStream) and for a
  // watcher receiving STREAM_URL over the wire (below) — previously those
  // two cases each set frameRef.current.src directly; centralizing it here
  // means Room.jsx doesn't need its own Electron-vs-web branch.
  //
  // The browser path forces a genuine reload even when the URL is identical
  // to what's already loaded (setting the same iframe src twice in a row is
  // a no-op in most browsers) by clearing to about:blank first — this used
  // to live in Room.jsx's reloadStream() as a one-off; it's harmless to do
  // unconditionally (a different URL reloads correctly either way), so it's
  // absorbed here instead of duplicated. Electron's webContents.loadURL()
  // always performs a real navigation even for an identical URL, so no such
  // trick is needed on that path.
  const loadUrl = useCallback((url) => {
    if (isElectron) {
      window.syncwatch.playback.loadUrl(url).catch(err => {
        console.warn('[useSync] Electron loadUrl failed:', err);
      });
      return;
    }
    if (!frameRef.current) return;
    frameRef.current.src = 'about:blank';
    setTimeout(() => { if (frameRef.current) frameRef.current.src = url; }, 50);
  }, []);

  const applyState = useCallback((state, serverTime, serverTimestamp) => {
    const age           = (Date.now() - serverTimestamp) / 1000;
    const correctedTime = state === 'play' ? serverTime + age : serverTime;
    const drift         = Math.abs(estimatedTime() - correctedTime);

    if (state === 'play') {
      localPlaying.current = true;
      startedAt.current    = Date.now() - correctedTime * 1000;
      if (drift > DRIFT_THRESHOLD) { localTime.current = correctedTime; iframeCmd('playfrom', correctedTime); }
      else iframeCmd('play');
      setStatus('▶ In Sync');
    } else if (state === 'pause') {
      localPlaying.current = false;
      localTime.current    = correctedTime;
      startedAt.current    = null;
      iframeCmd('pauseat', correctedTime);
      setStatus(`⏸ Paused at ${fmtTime(correctedTime)}`);
    } else if (state === 'seek') {
      localTime.current = correctedTime;
      startedAt.current = localPlaying.current ? Date.now() - correctedTime * 1000 : null;
      iframeCmd('seek', correctedTime);
      if (localPlaying.current) iframeCmd('play');
      setStatus(`⏩ ${fmtTime(correctedTime)}`);
    }
  }, []);

  const sendPlay  = useCallback(() => { const t=estimatedTime(); ws.send({type:'VIDEO_STATE',state:'play',currentTime:t,code}); applyState('play',t,Date.now()); }, [ws,code,applyState]);
  const sendPause = useCallback(() => { const t=estimatedTime(); ws.send({type:'VIDEO_STATE',state:'pause',currentTime:t,code}); applyState('pause',t,Date.now()); }, [ws,code,applyState]);
  const sendSeek  = useCallback((delta) => { const t=Math.max(0,estimatedTime()+delta); ws.send({type:'VIDEO_STATE',state:'seek',currentTime:t,code}); applyState('seek',t,Date.now()); }, [ws,code,applyState]);

  // Incoming messages
  useEffect(() => {
    const offVS = ws.on('VIDEO_STATE', msg => applyState(msg.state, msg.currentTime, msg.timestamp));
    const offSU = ws.on('STREAM_URL',  msg => {
      if (role === 'watcher') {
        loadUrl(msg.url);
        setHasFrame(true);
        setStatus('Stream loaded — waiting for Play…');
        // Persist it so that if THIS tab refreshes later, the recovery
        // path on mount (Room.jsx's initialStreamUrl) has the up-to-date
        // URL rather than whatever was true back at the original join.
        // The server also remembers this room-side (rooms.setStreamUrl),
        // which is what makes a join AFTER this point work correctly too
        // — this sessionStorage copy specifically covers a refresh of
        // the SAME tab between join and any future reload.
        session.set('sw_initial_stream_url', msg.url);
        // Previously, only the HOST's own loadStream() ever triggered a
        // bridge check — a watcher receiving this same URL via broadcast
        // never got checked at all, so their bridge warning banner could
        // be stuck in whatever state it was in before. Now both sides
        // get the same detection pass.
        onStreamLoaded?.(msg.url);
      }
    });
    return () => { offVS(); offSU(); };
  }, [ws, role, applyState, onStreamLoaded, loadUrl]);

  // Keyboard shortcuts
  useEffect(() => {
    function onKey(e) {
      if (['INPUT','TEXTAREA'].includes(e.target.tagName)) return;
      if (e.code === 'Space')      { e.preventDefault(); localPlaying.current ? sendPause() : sendPlay(); }
      if (e.code === 'ArrowLeft')  { e.preventDefault(); sendSeek(e.shiftKey ? -30 : -10); }
      if (e.code === 'ArrowRight') { e.preventDefault(); sendSeek(e.shiftKey ? +30 : +10); }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [sendPlay, sendPause, sendSeek]);

  return { frameRef, status, hasFrame, setHasFrame, sendPlay, sendPause, sendSeek, loadUrl, isElectron };
}

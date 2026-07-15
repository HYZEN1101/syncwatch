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
  // Reactive mirror of localPlaying.current — the ref alone is enough for
  // the timing math (estimatedTime, etc.), but the UI (a single play/pause
  // toggle button, rather than two separate always-visible buttons) needs
  // an actual React value to know which icon/action to show. Kept in sync
  // at every point localPlaying.current itself changes, below.
  const [isPlaying, setIsPlaying] = useState(false);
  // Phase 4: distinct from the generic status text — true when a page
  // loaded successfully but no <video> element was ever found on it after
  // the full retry window (electron/playback.js's waitForVideoAndRun gives
  // up after ~10s). Separate from loadFailed (Room.jsx) which covers the
  // page not loading AT ALL — these are different failure modes with
  // different likely causes/fixes.
  const [videoNotFound, setVideoNotFound] = useState(false);

  // Phase 3: real video-event state, Electron only. `playConfirmed` tracks
  // whether the most recent play/playfrom command actually resulted in a
  // real 'playing' event — if it hasn't within playConfirmTimeout below,
  // that's exactly the "autoplay was blocked" case the original migration
  // doc calls out as previously undetectable (estimated sync had no way to
  // know a play() call silently failed). `buffering` is a separate flag so
  // a 'waiting' event doesn't get permanently overwritten by unrelated
  // status text — the browser/web (non-Electron) path never touches either
  // of these, since there's no event feed to drive them.
  const playConfirmed      = useRef(true);
  const playConfirmTimeout = useRef(null);
  const buffering          = useRef(false);

  // estimatedTime() while playing: startedAt.current is always set as
  // `Date.now() - correctedTime * 1000` (see applyState/onVideoEvent below),
  // which already fully encodes the absolute playback position — reading
  // back `(Date.now() - startedAt.current) / 1000` alone recovers exactly
  // that position plus real elapsed time since. localTime.current is only
  // meaningful as a resting value while PAUSED (returned directly below);
  // it must NOT also be added here. It used to be added unconditionally,
  // which double-counted the position on every play-after-pause/seek where
  // localTime.current was already non-zero — invisible on a very first play
  // (localTime.current starts at 0, so the bug added nothing), but on every
  // subsequent pause→play cycle it added the last known position on top of
  // an already-absolute value, roughly doubling the estimate each time and
  // compounding further on each further cycle.
  function estimatedTime() {
    if (!localPlaying.current || !startedAt.current) return localTime.current;
    return (Date.now() - startedAt.current) / 1000;
  }

  function fmtTime(s) {
    s = Math.max(0, s);
    return `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;
  }

  // Recomputes the human-readable status from current known state — used
  // both by applyState (issuing a command) and by the video-event handler
  // (confirming/correcting one), so the two don't fight over the status
  // text when a real event arrives shortly after a command was sent.
  function refreshStatus() {
    if (buffering.current) { setStatus('⏳ Buffering…'); return; }
    if (!playConfirmed.current) { setStatus('⚠ Playback may be blocked — click the video'); return; }
    setStatus(localPlaying.current ? '▶ In Sync' : `⏸ Paused at ${fmtTime(localTime.current)}`);
  }

  function iframeCmd(action, seconds) {
    if (isElectron) {
      // Arm the "did this actually start playing" check for play-ish
      // commands. Cleared either by a real 'playing' event (see the
      // video-event subscription below) or superseded by the next command.
      if (action === 'play' || action === 'playfrom') {
        playConfirmed.current = false;
        clearTimeout(playConfirmTimeout.current);
        playConfirmTimeout.current = setTimeout(() => {
          if (!playConfirmed.current) refreshStatus();
        }, 2500);
      } else if (action === 'pause' || action === 'pauseat') {
        // A pause makes the "is it playing yet" question moot — stop
        // waiting on it so a stale timeout can't fire a false "blocked"
        // status after the user has already paused.
        playConfirmed.current = true;
        clearTimeout(playConfirmTimeout.current);
      }
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
      // A fresh load means whatever the previous document's video was doing
      // is no longer relevant — clear buffering/blocked flags so they don't
      // linger on screen until the new page's events start arriving.
      buffering.current      = false;
      playConfirmed.current  = true;
      clearTimeout(playConfirmTimeout.current);
      setVideoNotFound(false);
      return window.syncwatch.playback.loadUrl(url).catch(err => {
        console.warn('[useSync] Electron loadUrl failed:', err);
        return { ok: false, error: err?.message || String(err) };
      });
    }
    if (!frameRef.current) return Promise.resolve({ ok: true });
    frameRef.current.src = 'about:blank';
    return new Promise((resolve) => {
      setTimeout(() => {
        if (frameRef.current) frameRef.current.src = url;
        // The browser path has no equivalent success/failure signal here —
        // Player.jsx's iframe onError prop already covers that case
        // separately (Room.jsx's loadFailed state) — so this just resolves
        // once the src swap has actually happened.
        resolve({ ok: true });
      }, 50);
    });
  }, []);

  const applyState = useCallback((state, serverTime, serverTimestamp) => {
    const age           = (Date.now() - serverTimestamp) / 1000;
    const correctedTime = state === 'play' ? serverTime + age : serverTime;
    const drift         = Math.abs(estimatedTime() - correctedTime);

    if (state === 'play') {
      localPlaying.current = true;
      setIsPlaying(true);
      startedAt.current    = Date.now() - correctedTime * 1000;
      if (drift > DRIFT_THRESHOLD) { localTime.current = correctedTime; iframeCmd('playfrom', correctedTime); }
      else iframeCmd('play');
      setStatus('▶ In Sync');
    } else if (state === 'pause') {
      localPlaying.current = false;
      setIsPlaying(false);
      localTime.current    = correctedTime;
      startedAt.current    = null;
      // Only force an exact-time seek if drift is large enough to matter —
      // same asymmetry already used above for play/playfrom. A forced seek
      // on every ordinary pause was the trigger for a real bug: some embed
      // sites auto-resume playback shortly after any seek, silently
      // overriding our pause a beat later. Skipping the seek when we're
      // already close enough avoids tripping that behavior in the first
      // place (see electron/playback.js's buildControlScript for the
      // defensive reassertion that also guards the case where a seek is
      // genuinely needed).
      if (drift > DRIFT_THRESHOLD) iframeCmd('pauseat', correctedTime);
      else iframeCmd('pause');
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

  // Phase 3: subscribe to real <video> events pushed from
  // electron/playback.js (see HANDOFF_PHASE_3.md for the full path this
  // takes — injected listener script → playback-preload.js →
  // 'playback:internal-video-event' → forwarded here as
  // 'playback:video-event'). This is what makes localTime/localPlaying
  // ground-truth-corrected instead of purely wall-clock-estimated, and is
  // the only thing that can detect buffering or a silently-blocked
  // autoplay — neither was previously visible to the app at all.
  //
  // Deliberately does NOT re-broadcast any of this over the WebSocket
  // (VIDEO_STATE stays exactly as it was, per the Option A decision in
  // HANDOFF_PHASE_3.md) — this only corrects this client's OWN local
  // tracking and status display. Re-broadcasting native events would risk
  // feedback loops (everyone's own video firing events back at the room)
  // for a problem that doesn't need solving yet.
  //
  // No-op entirely on the browser/web build — there's no event feed there,
  // onVideoEvent doesn't exist, and the estimated-time behavior from before
  // Phase 3 is unchanged for that path.
  useEffect(() => {
    if (!isElectron) return;

    const unsubscribe = window.syncwatch.playback.onVideoEvent((payload) => {
      const { type, currentTime, paused } = payload || {};

      // A real event of any kind proves a video WAS found on the current
      // page — clears a stale "couldn't find a video" flag left over from
      // an earlier frame/navigation, even though the message that sets it
      // (below) can't itself know when a later, successful frame arrives.
      if (type !== 'no-video-found') setVideoNotFound(false);

      if (type === 'no-video-found') {
        setVideoNotFound(true);
        return;
      }
      if (typeof currentTime !== 'number') return;

      switch (type) {
        case 'playing':
          buffering.current     = false;
          playConfirmed.current = true;
          clearTimeout(playConfirmTimeout.current);
          localPlaying.current  = true;
          setIsPlaying(true);
          localTime.current     = currentTime;
          startedAt.current     = Date.now() - currentTime * 1000;
          refreshStatus();
          break;
        case 'pause':
          buffering.current    = false;
          localPlaying.current = false;
          setIsPlaying(false);
          localTime.current    = currentTime;
          startedAt.current    = null;
          refreshStatus();
          break;
        case 'seeking':
          // Don't touch status yet — 'seeked' below confirms the seek
          // actually landed. A slow seek can sit in 'seeking' for a bit on
          // a poor connection; showing buffering-like feedback here would
          // be reasonable future polish but isn't required for this phase.
          break;
        case 'seeked':
          localTime.current = currentTime;
          startedAt.current = (paused === false) ? Date.now() - currentTime * 1000 : null;
          refreshStatus();
          break;
        case 'waiting':
          buffering.current = true;
          refreshStatus();
          break;
        case 'ended':
          buffering.current     = false;
          localPlaying.current  = false;
          setIsPlaying(false);
          startedAt.current     = null;
          setStatus('■ Ended');
          break;
        case 'timeupdate':
          // Ground-truth drift correction, silent — updating React state
          // here too (setStatus) would force a re-render several times a
          // second during normal playback for no visible benefit, since
          // the status text doesn't actually change between timeupdates.
          localTime.current = currentTime;
          if (localPlaying.current) startedAt.current = Date.now() - currentTime * 1000;
          break;
        default:
          break;
      }
    });

    return () => {
      unsubscribe?.();
      clearTimeout(playConfirmTimeout.current);
    };
    // refreshStatus/setStatus/fmtTime are stable across renders in
    // practice (no external deps of their own); omitting them here avoids
    // re-subscribing on every render while keeping the effect's actual
    // dependency (isElectron never changes at runtime) accurate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  return { frameRef, status, hasFrame, setHasFrame, isPlaying, sendPlay, sendPause, sendSeek, loadUrl, isElectron, applyState, videoNotFound, setVideoNotFound };
}

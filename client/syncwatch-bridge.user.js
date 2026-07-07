// ==UserScript==
// @name         SyncWatch Bridge
// @namespace    https://github.com/syncwatch
// @version      2.0.0
// @description  Bridges SyncWatch postMessage commands to the real video element, including ones nested in a child iframe
// @author       SyncWatch
// @match        *://streamimdb.ru/*
// @match        *://*.streamimdb.ru/*
// @match        *://playimdb.com/*
// @match        *://*.playimdb.com/*
// @match        *://vidsrc.to/*
// @match        *://*.vidsrc.to/*
// @match        *://vidsrc.me/*
// @match        *://*.vidsrc.me/*
// @match        *://vidsrc.cc/*
// @match        *://*.vidsrc.cc/*
// @match        *://vidsrc.in/*
// @match        *://*.vidsrc.in/*
// @match        *://embed.su/*
// @match        *://*.embed.su/*
// @match        *://multiembed.mov/*
// @match        *://*.multiembed.mov/*
// @match        *://superembed.stream/*
// @match        *://*.superembed.stream/*
// @match        *://2embed.cc/*
// @match        *://*.2embed.cc/*
// @match        *://2embed.to/*
// @match        *://*.2embed.to/*
// @match        *://moviesapi.club/*
// @match        *://*.moviesapi.club/*
// @match        *://player.vimeo.com/*
// @match        *://*.vimeo.com/*
// @match        *://www.youtube.com/embed/*
// @match        *://youtube.com/embed/*
// ── Common nested-player CDN domains ──────────────────────────────────────
// Many aggregator sites (playimdb.com included) don't host the actual
// <video> tag themselves — they embed a SECOND iframe from a separate
// player/CDN domain, and THAT inner frame holds the real video element.
// Tampermonkey only runs this script inside a frame whose domain matches
// one of these @match lines, so the inner player's domain needs its own
// entry too, or this script never even loads there to find the video.
// This list covers the most common player backends seen across these
// aggregator sites. If a specific site's inner player isn't covered here,
// see install-bridge.html#add-domain for how to add it.
// @match        *://*.rabbitstream.net/*
// @match        *://*.upcloud.*/*
// @match        *://*.dokicloud.one/*
// @match        *://*.streamtape.com/*
// @match        *://*.streamwish.com/*
// @match        *://*.filemoon.*/*
// @match        *://*.doodstream.com/*
// @match        *://*.mixdrop.*/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  const isTopFrame = (window === window.top);

  // ── Helpers ──────────────────────────────────────────────────────────────

  function getVideo() {
    // Prefer the largest visible video element IN THIS DOCUMENT ONLY.
    // (Reaching into a cross-origin nested iframe's DOM directly is
    // blocked by the browser regardless of Tampermonkey settings — the
    // relay system below is what actually solves nested players, not this.)
    const videos = [...document.querySelectorAll('video')];
    if (!videos.length) return null;
    return videos.reduce((best, v) => {
      const area = v.offsetWidth * v.offsetHeight;
      const bestArea = best.offsetWidth * best.offsetHeight;
      return area > bestArea ? v : best;
    });
  }

  function waitForVideo(cb, attempts = 40, interval = 250) {
    const v = getVideo();
    if (v) { cb(v); return; }
    if (attempts <= 0) {
      console.warn('[SyncWatch Bridge] No <video> in this frame:', location.hostname);
      return;
    }
    setTimeout(() => waitForVideo(cb, attempts - 1, interval), interval);
  }

  // ── Command handler — runs the actual control if THIS frame has the video ─

  function handleCommand(cmd) {
    waitForVideo((video) => {
      switch (cmd.action) {
        case 'play':     video.play().catch(() => {}); break;
        case 'pause':    video.pause(); break;
        case 'seek':     video.currentTime = cmd.seconds ?? cmd.value ?? 0; break;
        case 'playfrom': video.currentTime = cmd.seconds ?? 0; video.play().catch(() => {}); break;
        case 'pauseat':  video.currentTime = cmd.seconds ?? 0; video.pause(); break;
        case 'ping':
          window.parent.postMessage({
            type: 'SYNCWATCH_PONG',
            currentTime: video.currentTime, paused: video.paused, duration: video.duration,
            frame: location.hostname,
          }, '*');
          break;
      }
    }, 8); // shorter retry budget per relay hop (2s) — the top frame already
           // retried longer before relaying, so nested frames don't need to
           // wait as long individually.
  }

  // ── Relay: forward a command to every CHILD iframe this frame can see ────
  //
  // This is what actually solves the nested-player problem. Same-origin
  // policy blocks direct DOM access into a cross-origin iframe, but it does
  // NOT block postMessage — every frame, no matter whose domain it's on,
  // can receive a postMessage sent to it. So instead of trying to reach
  // into the nested frame's DOM, the top frame just re-sends the same
  // command DOWN into every iframe it contains. If that nested frame is
  // ALSO running this script (because its domain is in @match above), it
  // receives the relayed command and can control its own local <video>.
  function relayToChildFrames(cmd) {
    const iframes = document.querySelectorAll('iframe');
    iframes.forEach(f => {
      try { f.contentWindow?.postMessage({ ...cmd, __relayed: true }, '*'); } catch (_) {}
    });
  }

  // ── postMessage listener ──────────────────────────────────────────────────

  window.addEventListener('message', (e) => {
    const d = e.data;
    if (!d || typeof d !== 'object') return;

    if (d.action) {
      handleCommand(d);
      // Only relay further if this message came from ABOVE us (the
      // SyncWatch app or a parent frame relaying down) and we're not
      // already at the bottom — prevents infinite relay loops between
      // sibling/parent frames echoing the same message back and forth.
      if (!d.__relayed || isTopFrame === false) relayToChildFrames(d);
      return;
    }

    // Legacy / alternate formats
    if (d.method === 'seek')  { handleCommand({ action: 'seek',  seconds: d.value }); return; }
    if (d.method === 'play')  { handleCommand({ action: 'play'  }); return; }
    if (d.method === 'pause') { handleCommand({ action: 'pause' }); return; }
  });

  // ── Announce presence — bubble up through every parent frame ─────────────
  //
  // A nested player frame's announcement needs to reach the TOP-LEVEL
  // SyncWatch app, not just its immediate parent (which might itself be
  // another nested frame, not the app). We post to window.parent at every
  // level; each ancestor frame that's also running this script will see
  // the message arrive but won't re-announce on the nested frame's behalf
  // — instead each frame independently announces directly to whichever
  // window is listening for postMessage, and postMessage delivery to
  // window.parent naturally bubbles only one level, so the SyncWatch app
  // (which is the ACTUAL top window, two or more levels up in a nested
  // case) won't directly receive a deeply nested frame's message this way.
  //
  // To handle that, non-top frames post to window.top directly as well —
  // window.top always refers to the outermost window in the whole tab,
  // regardless of nesting depth, and postMessage to it is allowed even
  // cross-origin (delivery is allowed; only reading window.top's CONTENT
  // is blocked by same-origin policy, which we don't need to do).

  function announce() {
    const msg = { type: 'SYNCWATCH_BRIDGE_READY', frame: location.hostname, nested: !isTopFrame };
    try { window.parent.postMessage(msg, '*'); } catch (_) {}
    if (!isTopFrame) {
      try { window.top.postMessage(msg, '*'); } catch (_) {}
    }
  }

  function announceRepeatedly() {
    let count = 0;
    const interval = setInterval(() => {
      announce();
      count++;
      if (count >= 6) clearInterval(interval); // ~6 announcements over 3s
    }, 500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', announceRepeatedly);
  } else {
    announceRepeatedly();
  }

  console.log('[SyncWatch Bridge] Loaded on', location.hostname, isTopFrame ? '(top frame)' : '(nested frame)');
})();

import { useState, useEffect } from 'react';
import { session } from '../session';
import { HelpTour } from '../components/HelpTour';
import { ThemeSwitcher } from '../components/ThemeSwitcher';

function FloralDeco() {
  const items = [
    { icon:'local_florist', top:'12%', left:'8%',  size:28, delay:'0s',   cls:'float-deco' },
    { icon:'eco',           top:'70%', left:'5%',  size:22, delay:'2.5s', cls:'float-deco secondary' },
    { icon:'local_florist', top:'25%', right:'6%', size:24, delay:'1.2s', cls:'float-deco spin secondary' },
    { icon:'eco',           top:'80%', right:'8%', size:26, delay:'3.8s', cls:'float-deco' },
    { icon:'local_florist', top:'50%', left:'3%',  size:18, delay:'5s',   cls:'float-deco' },
    { icon:'spa',           top:'15%', right:'20%',size:20, delay:'0.8s', cls:'float-deco secondary' },
    { icon:'spa',           top:'85%', left:'25%', size:16, delay:'4.2s', cls:'float-deco spin' },
    { icon:'local_florist', top:'40%', right:'3%', size:20, delay:'6s',   cls:'float-deco' },
  ];
  return (
    <>
      {items.map((it, i) => (
        <span key={i} className={`material-symbols-outlined ${it.cls}`}
          style={{
            top: it.top, left: it.left, right: it.right,
            fontSize: it.size,
            animationDelay: it.delay,
            animationDuration: `${6 + i * 1.3}s`,
          }}
        >{it.icon}</span>
      ))}
    </>
  );
}

function ConnPill({ status, host }) {
  const map = {
    open:       { dot:'#22c55e', label:'Connected',    bg:'rgba(34,197,94,0.09)',  color:'#15803d', border:'rgba(34,197,94,0.25)' },
    connecting: { dot:'#f59e0b', label:'Connecting…',  bg:'rgba(245,158,11,0.09)', color:'#b45309', border:'rgba(245,158,11,0.25)' },
    closed:     { dot:'#ef4444', label:'Disconnected', bg:'rgba(239,68,68,0.09)',  color:'#b91c1c', border:'rgba(239,68,68,0.25)' },
  };
  const cfg = map[status] || map.connecting;
  return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center' }}>
      <div style={{ display:'flex', alignItems:'center', gap:7, padding:'5px 14px', borderRadius:9999, background:cfg.bg, border:`1px solid ${cfg.border}`, fontSize:11, fontWeight:700, color:cfg.color }}>
        <span style={{ width:7, height:7, borderRadius:'50%', background:cfg.dot, flexShrink:0, animation: status==='connecting' ? 'pulse-dot 1s ease-in-out infinite' : 'none', display:'block' }} />
        {cfg.label}
        {status==='open' && host && <span style={{ opacity:0.55, fontWeight:500, marginLeft:3 }}>· {host}</span>}
      </div>
    </div>
  );
}

function CopyBtn({ text, label='Copy' }) {
  const [copied, setCopied] = useState(false);
  function copy() { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }
  return (
    <button onClick={copy} style={{ fontSize:11, padding:'4px 10px', background:'rgba(167,46,74,0.10)', border:'1px solid rgba(167,46,74,0.18)', borderRadius:6, color:'var(--color-primary)', cursor:'pointer', fontWeight:700, transition:'all 0.15s', flexShrink:0 }}
      onMouseEnter={e => e.currentTarget.style.background='rgba(167,46,74,0.18)'}
      onMouseLeave={e => e.currentTarget.style.background='rgba(167,46,74,0.10)'}
    >{copied ? '✓ Copied!' : label}</button>
  );
}

export function Lobby({ ws, onJoined }) {
  const [name,       setName]       = useState('');
  const [code,       setCode]       = useState('');
  const [serverUrl,  setServerUrl]  = useState(ws._url);
  const [connStatus, setConnStatus] = useState(ws._status);
  const [error,      setError]      = useState('');
  const [shareUrl,   setShareUrl]   = useState(null);
  const [lanIP,      setLanIP]      = useState('');
  const [tunnelUrl,  setTunnelUrl]  = useState('');
  const [tunnelInfo, setTunnelInfo] = useState(null); // { provider, warning? } from the last startTunnel() call
  const [tunneling,  setTunneling]  = useState(false);
  const [showTunnelSettings, setShowTunnelSettings] = useState(false);
  const [showTour, setShowTour] = useState(false);
  const [ngrokToken, setNgrokTokenInput] = useState('');
  const [ngrokTokenSaved, setNgrokTokenSaved] = useState(false);

  // Sync conn status
  useEffect(() => ws.onStatus(s => setConnStatus(s)), [ws]);

  // Fetch tunnel/LAN config
  useEffect(() => {
    if (window.syncwatch) {
      window.syncwatch.getLanIP().then(ip => ip && setLanIP(ip));
      window.syncwatch.getTunnelUrl().then(info => {
        if (info && info.url) { setTunnelUrl(info.url); setTunnelInfo(info); }
      });
      window.syncwatch.getNgrokToken().then(t => t && setNgrokTokenInput(t));
    } else {
      fetch('/_syncwatch/config').then(r=>r.json()).then(cfg => { if (cfg.publicUrl) setShareUrl(cfg.publicUrl); }).catch(()=>{});
    }
  }, []);

  // Room handlers
  useEffect(() => {
    const offC = ws.on('ROOM_CREATED', msg => {
      session.set('sw_role','host'); session.set('sw_code',msg.code);
      session.set('sw_id',msg.peerId); session.set('sw_name',name.trim());
      session.set('sw_server',ws._url);
      // On a rejoin-as-host (e.g. refresh), the server replays the
      // room's current stream + recent chat — persist it the same way
      // we do for watchers below, so Room.jsx can restore it on mount.
      session.set('sw_initial_stream_url', msg.streamUrl || '');
      session.set('sw_initial_chat', JSON.stringify(msg.chatHistory || []));
      session.set('sw_initial_video_state', JSON.stringify(msg.lastVideoState || null));
      ws._joinedOnThisConnection = true; // see explanation in ROOM_JOINED handler below
      onJoined();
    });
    const offJ = ws.on('ROOM_JOINED', msg => {
      session.set('sw_role','watcher'); session.set('sw_code',msg.code);
      session.set('sw_id',msg.peerId); session.set('sw_name',name.trim());
      session.set('sw_server',ws._url);
      // CRITICAL: this is the ONLY place ROOM_JOINED ever genuinely fires.
      // It's a one-time event — by the time Room.jsx mounts (after we
      // navigate away from here), this exact message is gone forever and
      // no listener registered there can ever receive it. We persist the
      // peer snapshot, current stream URL, and recent chat here, in
      // sessionStorage, so Room.jsx can read them synchronously on its
      // very first render instead of racing to "catch" an event that has
      // already happened. This is what lets a refreshed watcher
      // automatically recover the movie and chat without the host doing
      // anything.
      session.set('sw_initial_peers', JSON.stringify(msg.peers || []));
      session.set('sw_initial_stream_url', msg.streamUrl || '');
      session.set('sw_initial_chat', JSON.stringify(msg.chatHistory || []));
      session.set('sw_initial_video_state', JSON.stringify(msg.lastVideoState || null));
      // Mark the WS INSTANCE itself (not sessionStorage) as having
      // completed a real handshake on THIS connection. This is the key
      // distinction from sessionStorage: a page refresh always creates a
      // brand new `ws` object (App.jsx re-mounts from scratch), so this
      // flag is naturally false again after a refresh — even though
      // sessionStorage's sw_code/sw_id are still sitting there from
      // before. Room.jsx uses ws._joinedOnThisConnection, NOT
      // sessionStorage presence, to decide whether it needs to (re)join.
      ws._joinedOnThisConnection = true;
      onJoined();
    });
    const offE = ws.on('ERROR', msg => setError(msg.reason));
    return () => { offC(); offJ(); offE(); };
  }, [ws, name, onJoined]);

  function handleReconnect() { ws.reconnect(serverUrl.trim()); setError(''); }
  async function handleTunnel() {
    if (!window.syncwatch) return;
    setTunneling(true);
    const info = await window.syncwatch.startTunnel();
    setTunneling(false);
    if (info && info.url) {
      setTunnelInfo(info);
      setTunnelUrl(info.url);
      const wu = info.url.replace('https://','wss://').replace('http://','ws://');
      setServerUrl(wu); ws.reconnect(wu);
    }
  }
  async function saveNgrokToken() {
    if (!window.syncwatch) return;
    await window.syncwatch.setNgrokToken(ngrokToken.trim());
    setNgrokTokenSaved(true);
    setTimeout(() => setNgrokTokenSaved(false), 2000);
  }
  function createRoom() {
    if (!name.trim()) { setError('Enter your name first.'); return; }
    if (connStatus !== 'open') { setError('Not connected — check server address and click ↺.'); return; }
    setError(''); ws.send({ type:'CREATE_ROOM', displayName:name.trim() });
  }
  function joinRoom() {
    if (!name.trim()) { setError('Enter your name first.'); return; }
    if (!code.trim()) { setError('Enter the room code.'); return; }
    if (connStatus !== 'open') { setError('Not connected — check server address and click ↺.'); return; }
    setError(''); ws.send({ type:'JOIN_ROOM', code:code.trim().toUpperCase(), displayName:name.trim() });
  }

  const hostPart = serverUrl.replace(/^wss?:\/\//,'').split('/')[0];
  const wssTunnel = tunnelUrl ? tunnelUrl.replace('https://','wss://').replace('http://','ws://') : '';

  return (
    <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', padding:'24px 16px', position:'relative', overflow:'hidden' }}>
      <div className="floral-bg" />
      <div className="blob-tl" /><div className="blob-br" /><div className="blob-tr" />
      <FloralDeco />

      <main style={{ position:'relative', zIndex:10, width:'100%', maxWidth:420 }}>
        <div className="glass-card" style={{ borderRadius:20, padding:28, display:'flex', flexDirection:'column', gap:16 }}>

          {/* Logo */}
          <header style={{ textAlign:'center', paddingBottom:4, position:'relative' }}>
            <button onClick={() => setShowTour(true)} title="Show me around"
              style={{ position:'absolute', top:-6, right:-6, background:'none', border:'none', cursor:'pointer', color:'var(--color-outline)', display:'flex', padding:6, borderRadius:'50%', transition:'all 0.15s' }}
              onMouseEnter={e=>{e.currentTarget.style.color='var(--color-primary)';e.currentTarget.style.background='rgba(167,46,74,0.08)';}}
              onMouseLeave={e=>{e.currentTarget.style.color='var(--color-outline)';e.currentTarget.style.background='none';}}
            >
              <span className="material-symbols-outlined" style={{ fontSize:20 }}>help</span>
            </button>
            <div className="font-logo" style={{ fontSize:28, color:'var(--color-primary)', display:'flex', alignItems:'center', justifyContent:'center', lineHeight:1 }}>
              SyncWatch
            </div>
            <p style={{ margin:'6px 0 0', fontSize:12, color:'var(--color-on-surface-variant)', letterSpacing:'0.01em' }}>Watch together, anywhere.</p>
          </header>

          {/* Conn status */}
          <div id="tour-conn-pill">
            <ConnPill status={connStatus} host={connStatus==='open' ? hostPart : null} />
          </div>

          {/* Share / LAN / Tunnel info */}
          {shareUrl && (
            <div className="info-box info-box-primary">
              <div style={{ fontWeight:700, color:'var(--color-primary)', marginBottom:7, display:'flex', alignItems:'center', gap:6 }}>
                <span className="material-symbols-outlined" style={{ fontSize:15 }}>public</span> Share with friends:
              </div>
              <div style={{ display:'flex', gap:6, alignItems:'center' }}>
                <input className="sw-input" readOnly value={shareUrl} onClick={e=>e.target.select()} style={{ fontSize:11, padding:'6px 10px' }} />
                <CopyBtn text={shareUrl} />
              </div>
            </div>
          )}

          {lanIP && (
            <div className="info-box info-box-primary" id="tour-lan-box">
              <div style={{ color:'var(--color-on-surface-variant)', fontSize:11, marginBottom:6, display:'flex', alignItems:'center', gap:5 }}>
                <span className="material-symbols-outlined" style={{ fontSize:14 }}>wifi</span> Same Wi-Fi — share with friends:
              </div>
              <div style={{ display:'flex', gap:6, alignItems:'center' }}>
                <code style={{ flex:1, fontSize:12, color:'var(--color-primary)', background:'rgba(167,46,74,0.08)', padding:'5px 9px', borderRadius:7 }}>ws://{lanIP}:3000</code>
                <CopyBtn text={`ws://${lanIP}:3000`} />
              </div>
            </div>
          )}

          {window.syncwatch && (
            <div className="info-box info-box-secondary" id="tour-tunnel-box">
              <div style={{ color:'var(--color-on-surface-variant)', fontSize:11, marginBottom:7, display:'flex', alignItems:'center', justifyContent:'space-between', gap:5 }}>
                <span style={{ display:'flex', alignItems:'center', gap:5 }}>
                  <span className="material-symbols-outlined" style={{ fontSize:14 }}>travel_explore</span> Internet tunnel (different cities):
                </span>
                <button onClick={() => setShowTunnelSettings(s => !s)} title="Tunnel settings"
                  style={{ background:'none', border:'none', cursor:'pointer', color:'var(--color-on-surface-variant)', display:'flex', padding:0 }}>
                  <span className="material-symbols-outlined" style={{ fontSize:15 }}>settings</span>
                </button>
              </div>

              {wssTunnel
                ? <>
                    <div style={{ display:'flex', gap:6, alignItems:'center' }}>
                      <code style={{ flex:1, fontSize:11, color:'var(--color-secondary)', background:'rgba(129,75,127,0.08)', padding:'5px 9px', borderRadius:7, wordBreak:'break-all' }}>{wssTunnel}</code>
                      <CopyBtn text={wssTunnel} />
                    </div>
                    <p style={{ margin:'6px 0 0', fontSize:10, color:'var(--color-on-surface-variant)' }}>
                      via {tunnelInfo?.provider === 'ngrok' ? 'ngrok' : 'localtunnel'}
                    </p>
                    {tunnelInfo?.warning && (
                      <p style={{ margin:'4px 0 0', fontSize:10, color:'#a15c00', background:'rgba(200,140,0,0.08)', padding:'6px 8px', borderRadius:6 }}>
                        ⚠ {tunnelInfo.warning}
                      </p>
                    )}
                  </>
                : <button onClick={handleTunnel} disabled={tunneling}
                    style={{ padding:'8px 16px', background:'linear-gradient(135deg, var(--color-secondary), #9e5f9c)', color:'#fff', border:'none', borderRadius:8, fontSize:12, fontWeight:700, cursor:tunneling?'not-allowed':'pointer', opacity:tunneling?0.6:1, transition:'all 0.2s', boxShadow:'0 2px 10px rgba(129,75,127,0.25)' }}>
                    {tunneling ? '⏳ Starting tunnel…' : '▶ Start internet tunnel'}
                  </button>
              }

              {showTunnelSettings && (
                <div style={{ marginTop:10, paddingTop:10, borderTop:'1px solid rgba(129,75,127,0.15)' }}>
                  <p style={{ margin:'0 0 6px', fontSize:10.5, color:'var(--color-on-surface-variant)', lineHeight:1.5 }}>
                    A free <a href="https://dashboard.ngrok.com/get-started/your-authtoken" target="_blank" rel="noreferrer" style={{ color:'var(--color-secondary)' }}>ngrok authtoken</a> gives
                    friends a link that works on their very first join — no code changes, one-time setup, and only you (the host) ever need it.
                  </p>
                  <div style={{ display:'flex', gap:6 }}>
                    <input className="sw-input" type="password" value={ngrokToken}
                      onChange={e => setNgrokTokenInput(e.target.value)}
                      placeholder="Paste your ngrok authtoken"
                      style={{ flex:1, padding:'7px 10px', fontSize:11, borderRadius:8 }} />
                    <button onClick={saveNgrokToken}
                      style={{ padding:'7px 12px', background:'rgba(129,75,127,0.12)', border:'1.5px solid rgba(129,75,127,0.25)', borderRadius:8, color:'var(--color-secondary)', cursor:'pointer', fontWeight:700, fontSize:11, flexShrink:0 }}>
                      {ngrokTokenSaved ? '✓ Saved' : 'Save'}
                    </button>
                  </div>
                  <p style={{ margin:'6px 0 0', fontSize:9.5, color:'var(--color-outline)' }}>
                    Takes effect next time you start a tunnel. Without a token, "Start internet tunnel" falls back to localtunnel — works, but friends may need an extra manual step on their first connection.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Server + reconnect */}
          <div style={{ display:'flex', flexDirection:'column', gap:5 }} id="tour-server-address">
            <div style={{ display:'flex', gap:6 }}>
              <input className="sw-input" value={serverUrl} onChange={e=>setServerUrl(e.target.value)}
                onKeyDown={e=>e.key==='Enter'&&handleReconnect()}
                placeholder="ws://localhost:3000"
                style={{ flex:1, padding:'8px 12px', fontSize:12, borderRadius:9 }} />
              <button onClick={handleReconnect} title="Reconnect"
                style={{ padding:'8px 14px', background:'rgba(167,46,74,0.09)', border:'1.5px solid rgba(167,46,74,0.2)', borderRadius:9, color:'var(--color-primary)', cursor:'pointer', fontWeight:800, fontSize:16, flexShrink:0, transition:'all 0.2s' }}
                onMouseEnter={e=>e.currentTarget.style.background='rgba(167,46,74,0.16)'}
                onMouseLeave={e=>e.currentTarget.style.background='rgba(167,46,74,0.09)'}
              >↺</button>
            </div>
            <p style={{ margin:0, fontSize:10, color:'var(--color-outline)', paddingLeft:2 }}>This is which SyncWatch server you're connected to — paste a friend's tunnel or LAN link here to join their room instead of your own.</p>
          </div>

          {/* Name */}
          <div style={{ display:'flex', flexDirection:'column', gap:6 }} id="tour-name-field">
            <label style={{ fontSize:13, fontWeight:700, color:'var(--color-on-surface-variant)', paddingLeft:2, display:'flex', alignItems:'center', gap:5 }}>
              <span className="material-symbols-outlined" style={{ fontSize:15 }}>person</span> Your name
            </label>
            <input className="sw-input" value={name} onChange={e=>setName(e.target.value)}
              placeholder="Enter your nickname" onKeyDown={e=>e.key==='Enter'&&createRoom()} />
          </div>

          <button className="btn-primary" onClick={createRoom} disabled={connStatus!=='open'} id="tour-create-btn">
            Create room <span style={{ fontSize:15 }}>✦</span>
          </button>

          {/* Divider */}
          <div className="petal-divider">
            <span className="material-symbols-outlined" style={{ color:'var(--color-outline-variant)', fontSize:16, animation:'floatUp 5s ease-in-out infinite' }}>local_florist</span>
          </div>

          {/* Join */}
          <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
            <div style={{ display:'flex', flexDirection:'column', gap:6 }} id="tour-code-field">
              <label style={{ fontSize:13, fontWeight:700, color:'var(--color-on-surface-variant)', paddingLeft:2, display:'flex', alignItems:'center', gap:5 }}>
                <span className="material-symbols-outlined" style={{ fontSize:15 }}>tag</span> Room code
              </label>
              <input className="sw-input room-code-input" value={code}
                onChange={e=>setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,''))}
                placeholder="ABCDEF" maxLength={6} onKeyDown={e=>e.key==='Enter'&&joinRoom()} />
            </div>
            <button className="btn-secondary" onClick={joinRoom} disabled={connStatus!=='open'} id="tour-join-btn">Join room</button>
          </div>

          {/* Error */}
          {error && (
            <p style={{ margin:0, textAlign:'center', fontSize:12, color:'var(--color-error)', fontWeight:600, background:'rgba(186,26,26,0.06)', padding:'9px 12px', borderRadius:9, border:'1px solid rgba(186,26,26,0.15)' }}>
              ⚠ {error}
            </p>
          )}

          {/* Theme switcher */}
          <div style={{ display:'flex', justifyContent:'center', paddingTop:4 }}>
            <ThemeSwitcher />
          </div>

          {/* Build watermark — if two open tabs show different times here,
              one of them is running a stale JS bundle. Hard refresh
              (Ctrl+Shift+R) the one with the older timestamp. */}
          <p style={{ margin:0, textAlign:'center', fontSize:9, color:'var(--color-outline-variant)', opacity:0.6 }}>
            build {typeof __BUILD_TIME__ !== 'undefined' ? new Date(__BUILD_TIME__).toLocaleTimeString() : 'dev'}
          </p>
        </div>
      </main>

      {showTour && (
        <HelpTour steps={tourSteps} onClose={() => setShowTour(false)} />
      )}
    </div>
  );
}

// Roughly top-to-bottom order of the Lobby card — steps whose target isn't
// currently in the DOM (e.g. the LAN/tunnel boxes only exist in the
// Electron build, and only once a value is actually available) are
// filtered out automatically by HelpTour itself.
const tourSteps = [
  {
    selector: '#tour-conn-pill',
    title: 'Connection status',
    text: 'Shows whether you\'re currently connected to a SyncWatch server — yours, or a friend\'s if you\'ve pointed this app at their link below.',
  },
  {
    selector: '#tour-lan-box',
    title: 'Same Wi-Fi as a friend?',
    text: 'Share this link with them — it works instantly over your local network, no internet or extra setup needed.',
  },
  {
    selector: '#tour-tunnel-box',
    title: 'Friend in a different place?',
    text: 'Start a tunnel here to get a link that works over the internet, then send it to them. Add a free ngrok token in the settings (gear icon) for a link that works on their very first try.',
  },
  {
    selector: '#tour-server-address',
    title: 'Which server you\'re on',
    text: 'This is which SyncWatch server you\'re connected to — normally your own. Paste a friend\'s tunnel or LAN link here (then hit ↺) to join their room instead.',
  },
  {
    selector: '#tour-name-field',
    title: 'Your name',
    text: 'This is what your friends will see next to your messages and in the viewer list once you\'re in a room.',
  },
  {
    selector: '#tour-create-btn',
    title: 'Start a room',
    text: 'Creates a new room and gives you a code to share with friends — you\'ll be the host.',
  },
  {
    selector: '#tour-code-field',
    title: 'Got a room code?',
    text: 'Type the 6-character code a friend sent you here to join their room.',
  },
  {
    selector: '#tour-join-btn',
    title: 'Join a room',
    text: 'Click here after entering a friend\'s room code above.',
  },
];

import { useState, useEffect } from 'react';
import { session } from '../session';

export function PeerList({ ws, code, role, myId, initialPeers = [] }) {
  // Seeded directly from the parent's captured ROOM_JOINED snapshot —
  // see the comment in Room.jsx for why this can't safely be captured
  // here via our own listener alone (mount-order race).
  const [peers, setPeers] = useState(initialPeers);
  const myName = session.get('sw_name') || 'You';

  // If the parent's snapshot updates (e.g. arrives a tick after this
  // component's first render), sync it in. Using the peers' identity
  // (ids) as a guard avoids clobbering state we may have already
  // updated via PEER_JOINED/PEER_LEFT in the meantime.
  useEffect(() => {
    if (initialPeers.length > 0) {
      setPeers(prev => {
        const prevIds = new Set(prev.map(p => p.id));
        const initialIds = new Set(initialPeers.map(p => p.id));
        const sameSet = prevIds.size === initialIds.size && [...prevIds].every(id => initialIds.has(id));
        return sameSet ? prev : initialPeers;
      });
    }
  }, [initialPeers]);

  useEffect(() => {
    // Defensive fallback only — in the normal flow Room.jsx already
    // captured this via its own earlier-mounted listener and passed it
    // down as initialPeers. Keeping this here costs nothing and covers
    // any future refactor that might reintroduce the race.
    const offJ  = ws.on('ROOM_JOINED',  msg => {
      if ((msg.peers || []).length > 0) setPeers((msg.peers || []).map(p => ({ ...p })));
    });
    const offPJ = ws.on('PEER_JOINED',  msg => setPeers(prev=>[...prev,{id:msg.peerId,displayName:msg.displayName,role:'member'}]));
    const offPL = ws.on('PEER_LEFT',    msg => setPeers(prev=>prev.filter(p=>p.id!==msg.peerId)));
    return () => { offJ(); offPJ(); offPL(); };
  }, [ws]);

  function Avatar({ name, isHost }) {
    const initials = (name||'?').slice(0,2).toUpperCase();
    return (
      <div className={`peer-avatar ${isHost?'host-avatar':'member-avatar'}`}>
        {initials}
        <span className="online-dot" />
      </div>
    );
  }

  const total = peers.length + 1;

  return (
    <div style={{ padding:'14px 14px 12px', borderBottom:'1px solid rgba(222,191,194,0.2)', flexShrink:0 }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12 }}>
        <h3 style={{ margin:0, fontSize:13, fontWeight:700, color:'var(--color-on-surface-variant)', display:'flex', alignItems:'center', gap:6, letterSpacing:'0.02em' }}>
          <span className="material-symbols-outlined" style={{ fontSize:16 }}>group</span>
          Viewers
        </h3>
        <span style={{ fontSize:11, fontWeight:800, padding:'2px 10px', background:'var(--color-primary-fixed)', color:'var(--color-on-primary-fixed)', borderRadius:9999 }}>
          {total}
        </span>
      </div>
      <div style={{ display:'flex', flexDirection:'column', gap:9 }}>
        {/* Self */}
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <Avatar name={myName} isHost={role==='host'} />
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:13, fontWeight:700, color:'var(--color-on-surface)', display:'flex', alignItems:'center', gap:5, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
              {myName}
              <span style={{ color:'var(--color-secondary)', fontSize:11 }}>✦</span>
            </div>
            {role==='host' && (
              <span style={{ fontSize:9, fontWeight:800, color:'var(--color-primary)', textTransform:'uppercase', letterSpacing:'0.08em' }}>Host</span>
            )}
          </div>
        </div>
        {peers.map(peer => (
          <div key={peer.id} style={{ display:'flex', alignItems:'center', gap:10 }}>
            <Avatar name={peer.displayName} isHost={peer.role==='host'} />
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:13, fontWeight:500, color:'var(--color-on-surface-variant)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{peer.displayName}</div>
              {peer.role==='host' && (
                <span style={{ fontSize:9, fontWeight:800, color:'var(--color-primary)', textTransform:'uppercase', letterSpacing:'0.08em' }}>Host</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

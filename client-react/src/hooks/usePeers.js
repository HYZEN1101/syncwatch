import { useState, useEffect, useCallback } from 'react';

export function usePeers(ws, code, myId) {
  const [peers,      setPeers]      = useState([]);  // { id, displayName, role, hasControl }
  const [controller, setController] = useState(null); // peerId of current controller

  useEffect(() => {
    // Populate initial peer list when we join as a watcher
    const offJoined = ws.on('ROOM_JOINED', (msg) => {
      setPeers((msg.peers || []).map(p => ({ ...p, hasControl: false })));
    });
    const offPeerJoined = ws.on('PEER_JOINED', (msg) => {
      setPeers(prev => [...prev, { id: msg.peerId, displayName: msg.displayName, role: 'watcher', hasControl: false }]);
    });
    const offPeerLeft = ws.on('PEER_LEFT', (msg) => {
      setPeers(prev => prev.filter(p => p.id !== msg.peerId));
      setController(c => c === msg.peerId ? null : c);
    });
    const offGrant = ws.on('PERMISSION_GRANT', (msg) => {
      setPeers(prev => prev.map(p => ({ ...p, hasControl: p.id === msg.peerId })));
      setController(msg.peerId);
    });
    const offRevoke = ws.on('PERMISSION_REVOKE', (msg) => {
      setPeers(prev => prev.map(p => p.id === msg.peerId ? { ...p, hasControl: false } : p));
      setController(c => c === msg.peerId ? null : c);
    });

    return () => { offJoined(); offPeerJoined(); offPeerLeft(); offGrant(); offRevoke(); };
  }, [ws]);

  const grantControl = useCallback((targetId) => {
    ws.send({ type: 'PERMISSION_GRANT', targetId, code });
  }, [ws, code]);

  const revokeControl = useCallback((targetId) => {
    ws.send({ type: 'PERMISSION_REVOKE', targetId, code });
  }, [ws, code]);

  return { peers, controller, grantControl, revokeControl };
}

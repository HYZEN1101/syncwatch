module.exports = {
  // Room lifecycle
  CREATE_ROOM:  'CREATE_ROOM',
  ROOM_CREATED: 'ROOM_CREATED',
  JOIN_ROOM:    'JOIN_ROOM',
  ROOM_JOINED:  'ROOM_JOINED',
  LEAVE_ROOM:   'LEAVE_ROOM',
  PEER_JOINED:  'PEER_JOINED',
  PEER_LEFT:    'PEER_LEFT',
  ERROR:        'ERROR',

  // Phase 2
  VIDEO_STATE:  'VIDEO_STATE',
  STREAM_URL:   'STREAM_URL',

  // Phase 3
  CHAT_MSG:     'CHAT_MSG',
  VOICE_SIGNAL: 'VOICE_SIGNAL',

  // Phase 4
  PERMISSION_GRANT:  'PERMISSION_GRANT',
  PERMISSION_REVOKE: 'PERMISSION_REVOKE',

  // Whimsy Mode — purely cosmetic, ephemeral (never persisted, never
  // affects playback timing/state). Relayed to the room the same way
  // CHAT_MSG is, just with no history kept.
  REACTION_BURST: 'REACTION_BURST',
  CONFETTI:       'CONFETTI',
};

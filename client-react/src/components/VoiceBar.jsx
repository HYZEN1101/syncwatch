export function VoiceBar({ micActive, muted, status, toggleMute, joinVoice }) {
  const isOff   = !micActive;
  const isMuted = micActive && muted;

  const btnBg    = isMuted ? 'var(--color-error)' : 'var(--color-primary)';
  const iconName = isMuted ? 'mic_off' : isOff ? 'mic' : 'mic';
  const label    = isOff ? 'JOIN VOICE' : isMuted ? 'MUTED' : 'VOICE ACTIVE';
  const labelColor = isMuted ? 'var(--color-error)' : isOff ? 'var(--color-outline)' : 'var(--color-primary)';

  return (
    <div style={{
      display:'flex', alignItems:'center', gap:10,
      padding:'10px 14px',
      borderBottom:'1px solid rgba(222,191,194,0.18)',
      background:'rgba(255,239,251,0.4)',
      flexShrink:0,
    }}>
      <button
        onClick={isOff ? joinVoice : toggleMute}
        title={isOff ? 'Join voice chat' : isMuted ? 'Unmute' : 'Mute'}
        style={{
          width:38, height:38, borderRadius:'50%', border:'none',
          background: btnBg,
          color:'#fff', cursor:'pointer', flexShrink:0,
          display:'flex', alignItems:'center', justifyContent:'center',
          boxShadow: isMuted ? '0 2px 8px rgba(186,26,26,0.3)' : '0 2px 8px rgba(167,46,74,0.25)',
          transition:'all 0.2s',
        }}
        onMouseEnter={e => e.currentTarget.style.transform='scale(1.1)'}
        onMouseLeave={e => e.currentTarget.style.transform='scale(1)'}
      >
        <span className="material-symbols-outlined" style={{ fontSize:19 }}>{iconName}</span>
      </button>

      <div style={{ lineHeight:1.3 }}>
        <div style={{ fontSize:10, fontWeight:800, letterSpacing:'0.07em', color:labelColor, textTransform:'uppercase' }}>
          {label}
        </div>
        <div style={{ fontSize:11, color:'var(--color-outline)', marginTop:2 }}>{status}</div>
      </div>
    </div>
  );
}

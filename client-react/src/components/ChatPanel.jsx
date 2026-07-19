import { useState, useRef, useEffect, useCallback } from 'react';

const REACTIONS = ['❤️','🔥','✨','😂','😮','👏'];

export function ChatPanel({ messages, sendMessage, onReact, whimsyEnabled }) {
  const [input, setInput] = useState('');
  const logRef = useRef(null);
  // Track last timestamp group to avoid re-computing on every render
  const lastMinRef = useRef(null);

  // Auto-scroll only when already at bottom
  useEffect(() => {
    const log = logRef.current;
    if (!log) return;
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
    if (atBottom) log.scrollTop = log.scrollHeight;
  }, [messages]);

  const submit = useCallback(() => {
    const text = input.trim();
    if (!text) return;
    sendMessage(text);
    setInput('');
  }, [input, sendMessage]);

  function escHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  // Build message groups with timestamps — computed from messages array, not per-render
  const grouped = [];
  let lastMin = null;
  for (const msg of messages) {
    const d = new Date(msg.ts);
    const mk = `${d.getHours()}:${String(d.getMinutes()).padStart(2,'0')}`;
    if (mk !== lastMin) { grouped.push({ type:'stamp', time: d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}) }); lastMin = mk; }
    grouped.push({ type:'msg', msg });
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', flex:1, overflow:'hidden', minHeight:0 }}>

      {/* Message log */}
      <div ref={logRef} style={{ flex:1, overflowY:'auto', padding:'10px 12px', display:'flex', flexDirection:'column', gap:8, minHeight:0 }}>
        {messages.length === 0 && (
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:'100%', gap:8, opacity:0.5 }}>
            <span className="material-symbols-outlined" style={{ fontSize:40, color:'var(--color-outline)' }}>chat_bubble</span>
            <span style={{ fontSize:12, color:'var(--color-outline)' }}>No messages yet</span>
            <span style={{ fontSize:11, color:'var(--color-outline-variant)' }}>Say hi! 🌸</span>
          </div>
        )}

        {grouped.map((item, i) => {
          if (item.type === 'stamp') return (
            <div key={`stamp-${i}`} style={{ textAlign:'center', margin:'4px 0' }}>
              <span style={{
                fontSize:10, fontWeight:600, color:'var(--color-outline)',
                background:'rgba(247,218,244,0.4)', padding:'3px 10px',
                borderRadius:9999, display:'inline-block',
              }}>{item.time}</span>
            </div>
          );

          const { msg } = item;
          return (
            <div key={i} style={{ display:'flex', flexDirection:'column', alignItems: msg.self ? 'flex-end' : 'flex-start', gap:3 }}>
              {!msg.self && (
                <span style={{ fontSize:10, fontWeight:600, color:'var(--color-outline)', marginLeft:4 }}
                  dangerouslySetInnerHTML={{ __html: escHtml(msg.fromName) }} />
              )}
              <div className={msg.self ? 'bubble-self' : 'bubble-peer'}
                dangerouslySetInnerHTML={{ __html: escHtml(msg.text) }} />
            </div>
          );
        })}
      </div>

      {/* Reaction bar */}
      <div style={{
        display:'flex', justifyContent:'space-around', padding:'6px 10px',
        borderTop:'1px solid rgba(222,191,194,0.15)',
        background:'rgba(255,239,251,0.3)',
        flexShrink:0,
      }}>
        {REACTIONS.map(emoji => (
          <button key={emoji} className="reaction-btn" onClick={() => { sendMessage(emoji); if (whimsyEnabled) onReact?.(emoji); }} title={emoji}>
            {emoji}
          </button>
        ))}
      </div>

      {/* Input */}
      <div style={{ padding:'8px 10px', borderTop:'1px solid rgba(222,191,194,0.15)', background:'var(--color-surface-container-lowest)', flexShrink:0 }}>
        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key==='Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
            placeholder="Type a message…"
            style={{
              flex:1, border:'1.5px solid var(--color-outline-variant)',
              borderRadius:22, padding:'9px 14px',
              background:'var(--color-surface-container-low)',
              fontSize:13, color:'var(--color-on-surface)',
              outline:'none', fontFamily:'var(--font-sans)',
              transition:'all 0.2s',
            }}
            onFocus={e => { e.target.style.borderColor='var(--color-primary)'; e.target.style.boxShadow='0 0 0 3px rgba(167,46,74,0.10)'; }}
            onBlur={e => { e.target.style.borderColor='var(--color-outline-variant)'; e.target.style.boxShadow='none'; }}
          />
          <button onClick={submit}
            style={{
              width:36, height:36, borderRadius:'50%', border:'none', flexShrink:0,
              background:'var(--color-primary)',
              color:'#fff', cursor:'pointer',
              display:'flex', alignItems:'center', justifyContent:'center',
              boxShadow:'0 2px 8px color-mix(in srgb, var(--color-primary) 30%, transparent)',
              transition:'all 0.2s',
            }}
            onMouseEnter={e => e.currentTarget.style.transform='scale(1.1)'}
            onMouseLeave={e => e.currentTarget.style.transform='scale(1)'}
          >
            <span className="material-symbols-outlined" style={{ fontSize:17 }}>send</span>
          </button>
        </div>
      </div>
    </div>
  );
}

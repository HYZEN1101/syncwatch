// ── chat.js — text messaging + emoji reactions ────────────────────────────
// Globals expected from room.html: ws, code

const MAX_MESSAGES = 200;
const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🔥', '👏', '🎉'];

function initChat() {
  // Render reaction buttons
  const bar = document.getElementById('reaction-bar');
  if (!bar) return;
  REACTIONS.forEach(emoji => {
    const btn = document.createElement('button');
    btn.textContent = emoji;
    btn.title = emoji;
    btn.onclick = () => sendChatMsg(emoji);
    bar.appendChild(btn);
  });
}

function sendChatMsg(text) {
  text = String(text).trim();
  if (!text) return;
  ws.send({ type: 'CHAT_MSG', text, code });
  // Clear the input field if it was the source
  const input = document.getElementById('chat-input');
  if (input && input.value.trim() === text) input.value = '';
}

function appendMessage(msg) {
  const log = document.getElementById('chat-log');
  if (!log) return;

  const div = document.createElement('div');
  div.className = 'chat-msg' + (msg.self ? ' self' : '');

  const time = new Date(msg.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  div.innerHTML =
    `<span class="chat-name">${escapeHtml(msg.fromName)}</span>` +
    `<span class="chat-text">${escapeHtml(msg.text)}</span>` +
    `<span class="chat-time">${time}</span>`;

  log.appendChild(div);

  // Trim oldest if over cap
  while (log.children.length > MAX_MESSAGES) log.removeChild(log.firstChild);

  // Auto-scroll only if already at the bottom (don't hijack manual scroll)
  const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 60;
  if (atBottom) log.scrollTop = log.scrollHeight;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

ws.on('CHAT_MSG', appendMessage);

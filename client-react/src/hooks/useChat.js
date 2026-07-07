import { useState, useEffect, useCallback } from 'react';

const MAX_MESSAGES = 200;
const REACTIONS    = ['👍','❤️','😂','😮','😢','🔥','👏','🎉'];

export function useChat(ws, code, initialMessages = []) {
  // Seeded from the server's chatHistory replay (captured in Room.jsx at
  // the moment ROOM_JOINED/ROOM_CREATED fired — see the comment there
  // for why this can't be caught here directly via our own listener).
  const [messages, setMessages] = useState(initialMessages);

  useEffect(() => {
    const off = ws.on('CHAT_MSG', (msg) => {
      setMessages(prev => {
        const next = [...prev, msg];
        return next.length > MAX_MESSAGES ? next.slice(-MAX_MESSAGES) : next;
      });
    });
    return off;
  }, [ws]);

  const sendMessage = useCallback((text) => {
    text = String(text).trim();
    if (!text) return;
    ws.send({ type: 'CHAT_MSG', text, code });
  }, [ws, code]);

  // Exposed so Room.jsx can hydrate chat history that arrives slightly
  // after mount — specifically the host-rejoin case (refresh), where the
  // ROOM_CREATED listener (which DOES fire correctly, since Room.jsx is
  // already mounted and listening for genuine reconnects) carries the
  // server's chat replay a tick after this hook's initial render.
  const restoreMessages = useCallback((history) => {
    if (history && history.length > 0) setMessages(history);
  }, []);

  return { messages, sendMessage, reactions: REACTIONS, restoreMessages };
}

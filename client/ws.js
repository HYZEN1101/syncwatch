class SyncWatchWS {
  constructor(url) {
    this._url = url;
    this._handlers = {};
    this._queue = [];
    this._ws = null;
    this._connect();
  }

  _connect() {
    this._ws = new WebSocket(this._url);

    this._ws.onopen = () => {
      this._queue.forEach(m => this._ws.send(m));
      this._queue = [];
    };

    this._ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      (this._handlers[msg.type] || []).forEach(fn => fn(msg));
    };

    // Reconnect after 2 s if connection drops
    this._ws.onclose = () => setTimeout(() => this._connect(), 2000);
  }

  // Register a handler. Returns an unsubscribe function.
  on(type, fn) {
    if (!this._handlers[type]) this._handlers[type] = [];
    this._handlers[type].push(fn);
    return () => {
      this._handlers[type] = this._handlers[type].filter(f => f !== fn);
    };
  }

  send(obj) {
    const str = JSON.stringify(obj);
    if (this._ws && this._ws.readyState === WebSocket.OPEN) {
      this._ws.send(str);
    } else {
      this._queue.push(str);
    }
  }
}

export class SyncWatchWS {
  constructor(url) {
    this._url       = url;
    this._handlers  = {};
    this._queue     = [];
    this._ws        = null;
    this._status    = 'connecting';
    this._statusCbs = [];
    this._connect();
  }

  _connect() {
    this._setStatus('connecting');
    try {
      this._ws = new WebSocket(this._url);
    } catch {
      setTimeout(() => this._connect(), 3000);
      return;
    }
    this._ws.onopen = () => {
      this._setStatus('open');
      this._queue.forEach(m => this._ws.send(m));
      this._queue = [];
    };
    this._ws.onmessage = (e) => {
      let msg; try { msg = JSON.parse(e.data); } catch { return; }
      (this._handlers[msg.type] || []).forEach(fn => fn(msg));
    };
    this._ws.onclose = () => { this._setStatus('closed'); setTimeout(() => this._connect(), 2000); };
    this._ws.onerror = () => {};
  }

  reconnect(newUrl) {
    if (newUrl) this._url = newUrl;
    try { this._ws?.close(); } catch {}
    this._connect();
  }

  _setStatus(s) {
    this._status = s;
    this._statusCbs.forEach(fn => fn(s));
  }

  /**
   * Subscribe to connection status changes.
   * @param fn       callback(status: 'connecting'|'open'|'closed')
   * @param immediate if true (default), call fn immediately with current status.
   *                  Pass false in Room so we don't double-trigger joins.
   */
  onStatus(fn, immediate = true) {
    this._statusCbs.push(fn);
    if (immediate) fn(this._status);
    return () => { this._statusCbs = this._statusCbs.filter(f => f !== fn); };
  }

  on(type, fn) {
    if (!this._handlers[type]) this._handlers[type] = [];
    this._handlers[type].push(fn);
    return () => { this._handlers[type] = this._handlers[type].filter(f => f !== fn); };
  }

  send(obj) {
    const str = JSON.stringify(obj);
    if (this._ws?.readyState === WebSocket.OPEN) this._ws.send(str);
    else this._queue.push(str);
  }

  get status() { return this._status; }
}

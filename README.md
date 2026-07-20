# SyncWatch

Watch movies together, perfectly in sync — with voice chat, text chat, and shared playback control.

---

## Download (for your friends)

Build the installer once on your machine, then send the file:

| Platform | Command | Output |
|---|---|---|
| Windows | `npm run electron:pack` | `dist/SyncWatch Setup 1.0.0.exe` |
| macOS   | `npm run electron:pack` | `dist/SyncWatch-1.0.0.dmg` |
| Linux   | `npm run electron:pack` | `dist/SyncWatch-1.0.0.AppImage` |

Friends **double-click the installer** — no Node.js, no terminal, nothing else required.

---

## How to watch together

### You are the host
1. Open SyncWatch.
2. Pick how friends connect:
   - **Same Wi-Fi** → share the `ws://192.168.x.x:3000` address shown in the app.
   - **Different city/network** → click **▶ Start internet tunnel** → share the `wss://...` URL.
3. Enter your name → **Create room** → share the 6-character room code.
4. Paste a streaming embed URL (e.g. `https://vidsrc.to/embed/movie/tt0111161`) → **Load**.
5. Press **▶ Play** when everyone is ready.

### You are joining
1. Open SyncWatch.
2. Paste the host's address into the server field → **↺** to connect.
3. Enter your name → paste the room code → **Join room**.

---

## One-time bridge setup (required for play/pause/seek)

The app needs a userscript to control the video player inside the embedded page.
Everyone installs it once:

1. Install [Tampermonkey](https://www.tampermonkey.net/) (Chrome/Edge) or [Violentmonkey](https://violentmonkey.github.io/) (Firefox).
2. Open the app and go to **install-bridge.html** (linked in the warning bar).
3. Click **Install SyncWatch Bridge** and confirm.
4. Reload the room.

---

## Run from source (development)

```bash
# 1. Install dependencies
npm install
cd client-react && npm install && cd ..

# 2a. Web mode (no Electron)
npm start              # server on http://localhost:3000
cd client-react && npm run dev   # UI on http://localhost:5173

# 2b. Electron dev mode
npm run electron:dev   # builds React + opens Electron window

# 2c. Build installer
npm run electron:pack  # output in dist/
```

---

## Internet tunnel notes

- Uses [localtunnel](https://github.com/localtunnel/localtunnel) — **free, no account needed**.
- Tunnel is active as long as the host's SyncWatch window is open.
- If localtunnel is slow or unreliable, alternatively set `NGROK_AUTHTOKEN=your_token` and run `npm start` in web mode for a more stable ngrok tunnel.

---

## Firewall note

Port **3000** must be reachable on the host machine. Most home networks allow this automatically. Corporate or university networks may block it — use the internet tunnel in that case.

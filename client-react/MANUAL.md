# SyncWatch — Tester's Manual

**Version:** Beta 1.0  
**Setup time:** ~5 minutes

---

## What is SyncWatch?

SyncWatch lets you and your friends watch the same movie at exactly the same time from different locations. **Everyone in the room can control playback** — any member can hit play, pause, or skip and it syncs for the whole group instantly. There's also voice chat and text chat so you can react while watching.

The only thing only the host can do is **load the movie URL** — this stops anyone from accidentally switching the film mid-watch.

---

## Step 1 — Install the app

You'll receive one of these files:

| File | Your platform |
|---|---|
| `SyncWatch Setup 1.0.0.exe` | Windows |
| `SyncWatch-1.0.0.dmg` | macOS |
| `SyncWatch-1.0.0.AppImage` | Linux |

**Windows:**
1. Double-click the `.exe` file
2. If you see **"Windows protected your PC"** → click **More info** → **Run anyway**
   *(This appears for unsigned beta apps — it's safe)*
3. Follow the installer and launch from the desktop shortcut

**macOS:**
1. Double-click the `.dmg` file
2. Drag SyncWatch into your **Applications** folder
3. Open it — if you see **"can't be opened because Apple cannot check it for malicious software"**:
   - Go to **System Settings → Privacy & Security**
   - Scroll down and click **Open Anyway**
   - Click **Open** on the confirmation

**Linux:**
1. Right-click the `.AppImage` → **Properties → Permissions** → tick **Allow executing as program**
2. Double-click to run

---

## Step 2 — Install the Bridge (everyone does this once)

The Bridge is a small browser script that lets SyncWatch actually control the video player. Without it the play/pause/seek buttons won't affect what's on screen.

### 2a — Install Tampermonkey

Tampermonkey is a free, widely-used browser extension (over 10 million users). It's how the Bridge gets loaded.

- **Chrome / Edge:** Go to [tampermonkey.net](https://www.tampermonkey.net), click the Chrome button → **Add to Chrome** → **Add extension**
- **Firefox:** Go to [tampermonkey.net](https://www.tampermonkey.net), click the Firefox button → **Add to Firefox** → **Add**

You'll see a small Tampermonkey icon appear in your browser toolbar. ✓

### 2b — Install the Bridge script

1. Open the SyncWatch app — it automatically opens a browser window
2. In the browser address bar, go to:
   ```
   http://localhost:3000/install-bridge.html
   ```
3. Click **Install SyncWatch Bridge**
4. A Tampermonkey tab opens asking to confirm — click **Install**
5. Close that tab

Done. You never have to do this again.

---

## Step 3 — Who is the host?

**One person needs to be the host.** The host is whoever runs the server that everyone connects to — usually the person who organised the watch party.

**What the host does exclusively:**
- Loads the movie URL

**What everyone can do equally:**
- Play, pause, seek — any member can control playback at any time
- Voice chat
- Text chat and reactions

---

## Step 4 — Connect with your friends

### Same Wi-Fi (same house/office)

**Host:**
1. Open SyncWatch — a browser window opens automatically
2. In the lobby, find the **📡 LAN address** shown — it looks like `ws://192.168.x.x:3000`
3. Copy it and share it with everyone

**Friends:**
1. Open SyncWatch
2. In the server field (shows `ws://localhost:3000`), replace it with the host's address
3. Click **↺** to connect

---

### Different locations (different cities/networks)

**Host:**
1. Open SyncWatch
2. In the lobby, click **▶ Start internet tunnel**
3. Wait a few seconds — a `wss://something.loca.lt` address appears
4. Share this address with everyone

**Friends (using the app):**
1. Open SyncWatch
2. Replace `ws://localhost:3000` in the server field with the `wss://` address
3. Click **↺** to connect

**Friends (no install needed — browser only):**
1. The host also gets an `https://` version of the address
2. Friends open that link directly in Chrome or Firefox — no app install required
3. They still need the Tampermonkey Bridge (Step 2 above)

---

## Step 5 — Create and join a room

**Host:**
1. Enter your name → click **Create room**
2. You'll see a **6-character room code** at the top (e.g. `AB12CD`)
3. Share that code with everyone

**Everyone else:**
1. Enter your name
2. Paste the room code → click **Join room**

You'll all land on the room screen and see each other's names in the **In room** list on the right.

---

## Step 6 — Load the movie and watch

**Host only — load the movie:**
1. Find the embed URL for what you want to watch. Easiest source:
   ```
   https://vidsrc.to/embed/movie/tt0111161
   ```
   Replace the `tt` number with any IMDb ID:
   - Go to [imdb.com](https://imdb.com), search your film
   - The ID is in the URL: `imdb.com/title/tt0468569/` → ID is `tt0468569`

2. Paste the URL into the bar at the top of the room → click **Load**
3. Everyone's video loads automatically — no one else has to do anything

**Anyone — start watching:**
- Once everyone is loaded, **anyone** can click **▶ Play** to start

From this point on, anyone in the room can pause, skip, or rewind at any time — it syncs for the whole group.

---

## Controls

### Playback buttons (available to everyone)

| Button | What it does |
|---|---|
| ▶ Play | Starts for everyone |
| ⏸ Pause | Pauses for everyone |
| ⏪ −10s | Rewinds 10 seconds for everyone |
| ⏩ +10s | Skips forward 10 seconds for everyone |
| ⏪ −30s | Rewinds 30 seconds |
| ⏩ +30s | Skips forward 30 seconds |

### Keyboard shortcuts (when the app window is focused)

| Key | Action |
|---|---|
| `Space` | Play / Pause |
| `←` arrow | Rewind 10 seconds |
| `→` arrow | Skip 10 seconds |
| `Shift + ←` | Rewind 30 seconds |
| `Shift + →` | Skip 30 seconds |

### Voice chat

1. Click **🎙 Join voice** in the right panel
2. Allow microphone access when the browser asks
3. You'll hear each other in real time while watching
4. Click **🎙 Mute** to mute yourself

### Text chat and reactions

- Type in the box at the bottom right and press **Enter**
- Click emoji buttons for quick reactions
- Your messages appear in purple, others in grey

---

## Troubleshooting

**Yellow bar says "Bridge not detected"**
Go to `http://localhost:3000/install-bridge.html` and install the Bridge (Step 2). After installing, reload the page. Also check the Tampermonkey icon in your toolbar is enabled.

**Play/pause buttons don't control the video**
Same issue — Bridge not installed or not active on this embed site. Follow Step 2.

**Friend can't connect**
- Check they're using the right address and it starts with `wss://` (not `ws://`) for internet connections
- If the tunnel went quiet, the host clicks **▶ Start internet tunnel** again to get a fresh address

**We're out of sync**
Anyone can hit **⏸ Pause** then **▶ Play** — this re-syncs everyone to the same position.

**No audio in voice chat**
Click **🎙 Join voice** and accept the microphone permission. Check your browser hasn't blocked it — look for a mic icon in the address bar.

**Windows says "Windows protected your PC"**
Click **More info** → **Run anyway**. Normal for unsigned beta apps.

**macOS won't open the app**
Go to **System Settings → Privacy & Security → Open Anyway**.

---

## Quick reference

```
INSTALL
  Run the .exe / .dmg / .AppImage — follow the installer

BRIDGE (everyone, once only)
  Open http://localhost:3000/install-bridge.html
  Click "Install SyncWatch Bridge" and confirm

SAME NETWORK
  Host shares the ws://192.168.x.x:3000 shown in the lobby
  Everyone pastes it into the server field → ↺

DIFFERENT CITIES
  Host clicks "▶ Start internet tunnel" → shares the wss:// address
  Everyone pastes it into the server field → ↺
  (or open the https:// link directly in a browser)

FIND A MOVIE
  https://vidsrc.to/embed/movie/tt[imdb-id]
  IMDb ID is in the movie's URL on imdb.com

IN THE ROOM
  Host: paste embed URL → Load
  Anyone: ▶ Play to start, pause/seek whenever you like
```

---

*SyncWatch Beta 1.0 — thanks for testing!*

# Cam2PC — Phone Camera → PC Streamer (Updated Plan)

## Overview

Two primary use cases drive the entire architecture:
1. 🎬 **Recording** — best-quality video saved to PC storage (not phone)
2. 📡 **OBS Integration** — phone camera becomes a live source in OBS for YouTube/Twitch streaming

---

## Quality Analysis — Can we hit YouTube-grade quality?

**Short answer: Yes.** Here's why and where the ceiling is:

| Factor | What happens | Impact |
|---|---|---|
| Phone captures | iPhone 11 → up to 4K 60fps natively | ✅ Excellent source |
| WebRTC transmits | Re-encodes using H.264/VP9 over LAN | ⚠️ One encode pass |
| LAN bitrate we set | Up to **50 Mbps** (we control this) | ✅ Very high |
| OBS receives + records | Re-encodes for YouTube format | ✅ OBS handles perfectly |

**At 20–50 Mbps on LAN, the WebRTC encode quality is visually lossless for YouTube content.** YouTube itself streams at 4.5–25 Mbps. We'll be feeding OBS at 2–4x that.

> [!IMPORTANT]
> There is **one fundamental limitation**: WebRTC re-encodes on send. It is not a raw passthrough. However, at the bitrates we configure (~20–50 Mbps on LAN), this is imperceptible and far exceeds YouTube's requirements.

---

## Architecture — Dual Path

```
                         ┌──────────────────────────────────────┐
                         │           iPhone (Safari)            │
                         │                                      │
                         │  getUserMedia() → [4K/1080p source]  │
                         │         │                            │
                         │   WebRTC Peer (Sender)               │
                         │   H.264 @ 20–50Mbps over LAN         │
                         └──────────────┬───────────────────────┘
                                        │ WebRTC (direct UDP, P2P)
                         ┌──────────────▼───────────────────────┐
                         │           PC Browser (Chrome)        │
                         │                                      │
                         │   WebRTC Peer (Receiver)             │
                         │      │              │                │
                         │  <video>         MediaRecorder       │
                         │  element         (recording mode)    │
                         └──────┬────────────────┬─────────────┘
                                │                │
                   ┌────────────▼─┐    ┌─────────▼──────────┐
                   │  OBS Studio  │    │   PC File System    │
                   │              │    │  (downloaded .webm  │
                   │ Browser      │    │   or .mp4 file)     │
                   │ Source       │    └────────────────────┘
                   │ (captures    │
                   │  our URL)    │
                   │      │       │
                   │ Records +   │
                   │ Streams     │
                   └─────────────┘
```

---

## Two Recording Modes

### Mode 1: Native In-App Recording (No OBS needed)
- PC browser uses **MediaRecorder API** to record the incoming WebRTC stream
- Saves directly to PC disk as `.webm` (VP9) or `.mp4` (H.264)
- Bitrate: we request **50 Mbps** (browser honours this well at high res)
- **Quality: Excellent for YouTube** (1080p 60fps @ 50Mbps >> YouTube's own bitrate)
- One-click start/stop recording, auto-downloads to PC when done
- Chunked recording (10s segments internally) to handle long sessions without memory issues

### Mode 2: OBS Integration (Recommended for streaming/pro recording)
- OBS uses **Browser Source** pointing to `https://localhost:3000/viewer`
- OBS sees our video as any other source — can overlay, composite, etc.
- OBS records using **its own encoder** (ProRes, H.264 High, HEVC — any format)
- OBS streams to YouTube/Twitch with all its built-in tools
- **This is the pro workflow** — phone becomes a professional camera input in OBS

> [!TIP]
> **For OBS Browser Source**, set the URL to `https://[YOUR-PC-LOCAL-IP]:3000` and set resolution to **1920×1080**. The viewer page will be a clean full-screen video with no UI chrome, optimized for OBS capture.

---

## UI Design — Two Modes

### PC Viewer Page
```
┌─────────────────────────────────────────────────────┐
│  [LIVE]  Cam2PC                    ● REC   ⬛ STOP  │
│                                                     │
│                                                     │
│              [Full screen video feed]               │
│                                                     │
│                                                     │
│  QR Code ┐    1920×1080  60fps  23.4 Mbps   ◉ OBS │
└──────────────────────────────────────────────────────┘
```

### Phone Sender Page
```
┌─────────────────┐
│  Cam2PC         │
│  ──────────────│
│  📡 Streaming   │
│  1080p · 60fps  │
│                 │
│  [Camera        │
│   Preview       │
│   (small)]      │
│                 │
│  ● Front / Back │
│  Flip Camera    │
└─────────────────┘
```

---

## File Structure

```
f:\Programming\Cam2PC\
├── server.js              # Node.js: HTTPS + WebSocket signaling + static serve
├── package.json
├── certs\                 # Auto-generated SSL cert (for LAN HTTPS)
│   ├── cert.pem
│   └── key.pem
└── public\
    ├── index.html         # Entry → redirects based on role
    ├── viewer.html        # PC viewer (full-screen video + recording controls)
    ├── sender.html        # Phone sender (camera UI)
    ├── style.css          # Shared premium dark UI
    ├── viewer.js          # WebRTC receiver + MediaRecorder logic
    └── sender.js          # WebRTC sender + camera constraints
```

---

## Key Technical Decisions

### SSL Certificate
- Auto-generated on first `node server.js` using `selfsigned` package
- Stored in `certs/` folder, reused on subsequent runs
- User must accept browser SSL warning once on both devices (standard for self-signed)

### WebRTC Codec & Bitrate
```js
// On sender (phone) — force high quality
const sender = peerConnection.getSenders().find(s => s.track.kind === 'video');
const params = sender.getParameters();
params.encodings[0].maxBitrate = 50_000_000; // 50 Mbps
params.encodings[0].maxFramerate = 60;
await sender.setParameters(params);
```

### OBS-Clean Viewer Mode
- URL param `?obs=1` removes all UI chrome → pure black background + video
- OBS Browser Source points to `https://YOUR_IP:3000?obs=1`
- No latency indicator, no controls — just the raw feed

### Recording (In-App)
```js
const recorder = new MediaRecorder(stream, {
  mimeType: 'video/webm;codecs=h264',  // H.264 for best compatibility
  videoBitsPerSecond: 50_000_000        // 50 Mbps request
});
```
Segments saved every 30s internally, merged and downloaded as single file on stop.

---

## Proposed Changes

### [NEW] package.json
Dependencies: `ws`, `selfsigned`

### [NEW] server.js
- Auto-generates SSL cert
- Serves static files over HTTPS
- WebSocket room-based signaling

### [NEW] public/viewer.html + viewer.js
- Full-screen video element
- Recording controls (start/stop, live duration, file size counter)
- QR code generation for phone to scan
- OBS-clean mode (`?obs=1`)
- Stats overlay (resolution, fps, bitrate)

### [NEW] public/sender.html + sender.js
- Camera access with high-quality constraints
- Front/back camera toggle
- Small preview + stream status
- Bandwidth indicator

### [NEW] public/style.css
- Premium dark glassmorphism design
- Animated live indicator
- Smooth transitions

---

## Setup & Usage (After Build)

```bash
# Install dependencies
npm install

# Start server
node server.js

# PC: open https://localhost:3000
# Phone: scan QR code that appears on PC screen
```

**For OBS:**
1. Add Source → Browser Source
2. URL: `https://192.168.x.x:3000?obs=1` (your PC's local IP)
3. Width: 1920, Height: 1080
4. ✅ Hardware acceleration
5. Phone scans QR → stream appears in OBS

---

## What OBS Gets

| Setting | Value |
|---|---|
| Input | Clean 1080p/4K WebRTC stream |
| Latency to OBS | ~20–80ms (LAN) |
| OBS recording format | Any — ProRes, H.264, HEVC (OBS controls this) |
| OBS streaming | YouTube, Twitch, etc. at whatever bitrate you set |
| Compositing | Full — overlays, scenes, transitions all work |

# Cam2PC

**Transform your smartphone into an ultra-low-latency, professional webcam for your PC over local Wi-Fi.**  
Record live sessions, stream seamlessly into OBS/vMix via NDI or Window Capture, and enjoy stutter-free video with zero subscriptions, zero cloud relay, and 100% privacy.

[![CI](https://github.com/MHThe1/cam2pc/actions/workflows/ci.yml/badge.svg)](https://github.com/MHThe1/cam2pc/actions/workflows/ci.yml)
[![Build Android APK](https://github.com/MHThe1/cam2pc/actions/workflows/build-android.yml/badge.svg)](https://github.com/MHThe1/cam2pc/actions/workflows/build-android.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20Android%20%7C%20iOS-0078d4)](https://github.com/MHThe1/cam2pc/releases)
[![Built with Tauri](https://img.shields.io/badge/Built%20with-Tauri%20v2-ffc131?logo=tauri)](https://tauri.app)

---

## Why Cam2PC?

Most phone-to-PC webcam tools either cost monthly subscriptions, force cloud routing, or suffer from severe frame latency. **Cam2PC** solves this with a modern, dual-engine architecture:

1. **Native Android App (Recommended)**: Uses silicon hardware encoding (`MediaCodec` H.264) and direct binary WebSocket streaming to achieve lag-free, sub-15ms transmission—ideal for streaming and gaming.
2. **Browser Sender (iOS & Android)**: Zero installation needed. Scan a QR code with your iPhone or Android camera, open Safari or Chrome, and stream peer-to-peer via WebRTC immediately.

---

## Key Features

- ⚡ **Near-Zero Latency (~15–30ms)**: Hardware-accelerated H.264 encoding on device + WebCodecs hardware decoding on PC.
- 📱 **Native Android Companion App**: CameraX integration with tap-to-focus, flashlight toggle, front/rear camera switching, and built-in QR scanner.
- 🍏 **Instant iOS / Safari Support**: Works out of the box in Safari with WebRTC and automatic local TLS certificates.
- 🖥️ **Lightweight Standalone PC Client**: Built with Rust & Tauri v2 (~6.5 MB). No heavy Electron bloat, no Node.js runtime required for end-users.
- 📡 **OBS & Studio Ready**:
  - **OBS Clean Mode**: Press `H` or double-click to hide all UI overlays for pristine Window Capture.
  - **NDI Bridge**: Broadcast natively over LAN as a network NDI camera source for OBS, vMix, and Wirecast.
  - **OBS Browser Source**: Add `http://localhost:3001/?obs=1` as a direct browser source.
- ⏺️ **Direct PC Recording**: One-click local recording saved straight to PC storage.
- 🔒 **100% Local & Private**: All streams stay inside your local Wi-Fi network. No accounts, no servers, no telemetry.

---

## Streaming Modes & Quality Presets

| Mode | Supported Devices | Latency | Key Benefits |
| :--- | :--- | :--- | :--- |
| **Native App (H.264)** | Android 7.0+ | **~15ms** | Direct GPU encoder, zero frame drops, ultra-smooth |
| **WebRTC Browser** | iOS (Safari) / Android (Chrome) | **~30–50ms** | No app installation needed; scan QR code and stream |

### Quality Presets
- **Smooth**: 720p @ 30fps (3 Mbps) — best for older devices or congested Wi-Fi networks.
- **Balanced**: 1080p @ 30fps (6 Mbps) — crisp full-HD webcam quality for everyday meetings and streaming.
- **Pro**: 1080p @ 60fps (12 Mbps) — ultra-fluid high-framerate capture for gaming facecams.

---

## Quick Start

### 1. Download the Apps
Grab the latest releases from the **[Releases Page](https://github.com/MHThe1/cam2pc/releases)**:
- **PC**: Download `Cam2PC-Setup.msi` or the portable `cam2pc-windows.exe`.
- **Phone**: Download `Cam2PC-Android.apk` (or use your mobile browser).

### 2. Connect Your Phone to Your PC
1. Launch **Cam2PC** on your Windows PC. The application window will open showing a QR code.
2. Connect your phone using either method:
   - **Using the Android App**: Open **Cam2PC**, tap **Scan QR Code**, point at the screen, and tap **Start Stream**.
   - **Using iPhone / Mobile Browser**: Scan the QR code with your phone's camera, open the link in Safari/Chrome, grant camera permissions, and tap **Start Camera**.
3. Your live camera feed will immediately appear in full resolution on your PC!

---

## OBS Studio Integration

### Option A: Window Capture (Easiest)
1. Add a **Window Capture** source in OBS.
2. Select `Cam2PC`.
3. Press **`H`** (or double-click anywhere inside the Cam2PC window) to hide the HUD and stats overlay.

### Option B: NDI Source (Native Broadcast)
1. Install [NDI Tools Runtime](https://ndi.video/tools/) (free).
2. Install the [DistroAV OBS Plugin](https://github.com/DistroAV/DistroAV) (free).
3. Click the **NDI** toggle button in the bottom right of the Cam2PC viewer.
4. In OBS, add **NDI™ Source** &rarr; select **"Cam2PC"**.

---

## Architecture Overview

```
                      ┌───────────────────────────────────────┐
                      │             Phone Sender              │
                      │                                       │
                      │  [Android App]        [Mobile Safari] │
                      │  CameraX + MediaCodec   getUserMedia  │
                      │  Binary H.264 NAL       WebRTC Video  │
                      └──────────┬──────────────────┬─────────┘
                                 │ ws://:3001       │ wss://:3000
                                 │ (Raw NAL)        │ (SDP / ICE)
                                 ▼                  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            Cam2PC Desktop Client                            │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │ Rust Backend (Axum + Tokio + rust-embed)                              │  │
│  │  • Port 3000: Auto-TLS HTTPS / WSS Server (WebRTC for iOS/Browsers)   │  │
│  │  • Port 3001: Plain LAN HTTP / WS Server (Hardware H.264 Streaming)   │  │
│  │  • NDI Bridge & System Tray Lifecycle Management                      │  │
│  └───────────────────────────────────┬───────────────────────────────────┘  │
│                                      │                                      │
│  ┌───────────────────────────────────▼───────────────────────────────────┐  │
│  │ Frontend UI (Tauri v2 + React 19 + TypeScript + WebCodecs)            │  │
│  │  • WebCodecs VideoDecoder ──> GPU HTML5 Canvas (Hardware H.264)       │  │
│  │  • HTML5 Video Element ─────> WebRTC PeerConnection (Browser Feed)    │  │
│  │  • Local MediaRecorder ─────> Direct PC Disk Recording (.mp4/.webm)   │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Building from Source

### Prerequisites
- **Node.js**: v18 or later ([nodejs.org](https://nodejs.org))
- **Rust**: Stable toolchain with `cargo` ([rustup.rs](https://rustup.rs))
- **Windows**: Microsoft C++ Build Tools (with "Desktop development with C++")
- **Android (Optional)**: JDK 17 & Android SDK Platform 34 (if compiling the mobile app)

### Desktop App (Windows)
```bash
# 1. Clone repository
git clone https://github.com/MHThe1/cam2pc.git
cd cam2pc

# 2. Install frontend dependencies
npm install

# 3. Run in development mode (hot reload)
npm run tauri:dev

# 4. Build standalone production executable
cargo build --release --manifest-path src-tauri/Cargo.toml
# Output binary: src-tauri/target/release/cam2pc.exe
```

### Android Companion App
```bash
cd android

# Build debug APK using the included Gradle wrapper
./gradlew assembleDebug

# Output APK: android/app/build/outputs/apk/debug/app-debug.apk
```

---

## Contributing

Contributions, bug reports, and feature requests are very welcome!
1. Fork the project and create a new feature branch (`git checkout -b feature/amazing-feature`).
2. Run validation checks before committing:
   ```bash
   npm run typecheck
   npm run lint
   cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
   ```
3. Commit your changes (`git commit -m 'Add amazing feature'`).
4. Push to the branch (`git push origin feature/amazing-feature`).
5. Open a Pull Request.

---

## License

Distributed under the MIT License. See [LICENSE](LICENSE) for more information.

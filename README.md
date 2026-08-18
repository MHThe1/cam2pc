# Cam2PC

**Stream your phone camera to PC with near-zero latency over local WiFi.**  
Record to PC storage. Feed OBS as a native NDI source. No cloud. No subscription.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Windows](https://img.shields.io/badge/Platform-Windows-0078d4?logo=windows)](https://github.com/MHThe1/cam2pc/releases)
[![Built with Tauri](https://img.shields.io/badge/Built%20with-Tauri-ffc131?logo=tauri)](https://tauri.app)

---

## Features

- 📱 **Phone → PC in ~20–80ms** — WebRTC peer-to-peer, no cloud relay
- 🎬 **Record to PC disk** — one-click, saves as `.mp4` directly to your PC
- 📡 **OBS Browser Source** — clean `?obs=1` URL mode, zero UI chrome
- 🎥 **OBS NDI Source** — toggle NDI output, OBS sees phone as a native camera
- 🔒 **LAN only, no internet** — self-signed cert auto-installed, iPhone trusts it
- ⚡ **Lightweight** — ~15MB installer, runs in system tray

---

## Download

Get the latest installer from [Releases](https://github.com/MHThe1/cam2pc/releases).

> **Requirements:** Windows 10/11 (WebView2 pre-installed on Win11; auto-installed on Win10)

---

## Usage

1. Install and launch **Cam2PC** — a tray icon appears
2. Click the tray icon → viewer window opens with a QR code
3. Scan the QR code with your iPhone/Android
4. Accept camera permission in Safari/Chrome
5. Video streams to your PC instantly

### OBS Integration

**Browser Source (easiest):**
```
Add Source → Browser Source
URL: https://192.168.x.x:3000?obs=1
Width: 1920  Height: 1080
✅ Hardware acceleration
```

**NDI Source (native, requires one-time setup):**
1. Install [NDI Tools Runtime](https://ndi.video/tools/) (free)
2. Install [DistroAV plugin](https://github.com/DistroAV/DistroAV) for OBS (free)
3. Toggle NDI in the Cam2PC viewer
4. Add Source → NDI Source → select **"Cam2PC"**

See [docs/ndi-setup.md](docs/ndi-setup.md) for a detailed guide.

---

## Build from Source

### Prerequisites

| Tool | Install |
|---|---|
| Node.js ≥ 18 | [nodejs.org](https://nodejs.org) |
| Rust (Windows) | [rustup.rs](https://rustup.rs) |
| VS C++ Build Tools | [aka.ms/vs/17/release/vs_BuildTools.exe](https://aka.ms/vs/17/release/vs_BuildTools.exe) — select "Desktop development with C++" |

### Steps

```bash
# Clone
git clone https://github.com/MHThe1/cam2pc.git
cd cam2pc

# Install frontend dependencies
npm install

# Development (hot-reload)
npm run tauri:dev

# Build installer
npm run tauri:build
# → src-tauri/target/release/bundle/msi/Cam2PC_x.x.x_x64_en-US.msi
```

---

## Architecture

See [docs/architecture.md](docs/architecture.md) for a full system design walkthrough.

```
Tauri App (Windows)
├── Rust backend
│   ├── Embedded axum HTTPS + WebSocket signaling server
│   ├── rcgen: auto TLS cert (trusted by Windows + LAN devices)
│   └── NDI sidecar lifecycle manager
└── React + TypeScript + Tailwind v4 frontend
    ├── ViewerPage — PC monitor + recording controls
    └── SenderPage — Phone camera sender (opens via QR)

Phone (Safari / Chrome)
└── SenderPage — getUserMedia → WebRTC → PC viewer
```

---

## Contributing

PRs are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

- Bug reports → [Issues](https://github.com/MHThe1/cam2pc/issues)
- Feature requests → [Discussions](https://github.com/MHThe1/cam2pc/discussions)

---

## License

[MIT](LICENSE) © Cam2PC Contributors

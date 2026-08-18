# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Initial release
- WebRTC peer-to-peer camera streaming (phone → PC, ~20–80ms latency)
- In-app recording to PC storage (`.mp4`, up to 50 Mbps)
- OBS Browser Source mode (`?obs=1`)
- NDI output via Node.js sidecar (requires NDI Tools + DistroAV)
- Self-signed TLS cert with auto-install into Windows certificate store
- QR code for easy phone connection
- System tray icon with open/quit menu
- Flip camera (front/back) on phone
- Audio toggle on phone
- Live stats overlay (resolution, FPS, bitrate)
- GitHub Actions CI (lint, typecheck, clippy) and Release workflow

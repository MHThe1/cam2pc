//! Cam2PC — Tauri desktop app entry point
//!
//! Manages the system tray, viewer window lifecycle, and the embedded
//! signaling server. The heavy lifting (cert generation, WebSocket rooms,
//! NDI sidecar) lives in the sibling modules.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    cam2pc_lib::run()
}

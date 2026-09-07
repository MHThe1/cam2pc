//! Cam2PC library crate.
//!
//! All application logic lives here so it can be referenced by both
//! `main.rs` (desktop) and future mobile entry points.

pub mod cert;
pub mod network;
pub mod ndi;
pub mod qr;
pub mod server;

use std::sync::Arc;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, RunEvent, WebviewWindowBuilder,
};
use tracing::info;

/// Application state shared across Tauri commands and the embedded server.
pub struct AppState {
    pub local_ip: String,
    pub port: u16,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    tauri::Builder::default()
        .setup(|app| {
            let handle = app.handle().clone();

            // ── Resolve local network IP ───────────────────────────────────
            let local_ip = network::local_ip().unwrap_or_else(|| "127.0.0.1".to_string());
            let port: u16 = 3000;

            info!("Local IP: {} | Port: {}", local_ip, port);

            // ── Generate / load TLS certificate ───────────────────────────
            let cert_dir = app
                .path()
                .app_data_dir()
                .expect("Failed to resolve app data dir")
                .join("certs");

            let tls_config = cert::ensure_cert(&cert_dir, &local_ip)
                .expect("Failed to generate TLS certificate");

            // ── Store app state ────────────────────────────────────────────
            let server_state = server::ServerState {
                local_ip: local_ip.clone(),
                port,
                rooms: Arc::new(dashmap::DashMap::new()),
            };

            app.manage(Arc::new(AppState {
                local_ip: local_ip.clone(),
                port,
            }));
            app.manage(server_state.clone());

            // ── Start embedded signaling server ────────────────────────────
            let tls = tls_config.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = server::start(server_state, tls).await {
                    tracing::error!("Signaling server error: {}", e);
                }
            });

            // ── System tray ────────────────────────────────────────────────
            build_tray(&handle)?;

            // ── Window navigation fallback ────────────────────────────────
            let handle_clone = handle.clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_millis(200)).await;
                if let Some(win) = handle_clone.get_webview_window("viewer") {
                    let dev_alive = tokio::net::TcpStream::connect("127.0.0.1:1420").await.is_ok();
                    if !dev_alive {
                        info!("Vite dev server not found on 1420 — routing to embedded server http://127.0.0.1:3001");
                        if let Ok(url) = "http://127.0.0.1:3001".parse() {
                            let _ = win.navigate(url);
                        }
                    }
                    let _ = win.show();
                    let _ = win.set_focus();
                }
            });

            info!("Cam2PC started — https://{}:{}", local_ip, port);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            cmd_get_server_info,
            cmd_create_room,
            cmd_open_viewer,
        ])
        .build(tauri::generate_context!())
        .expect("Error building Tauri application")
        .run(|_app_handle, event| {
            // Keep running after all windows are closed (tray app)
            if let RunEvent::ExitRequested { api, .. } = event {
                api.prevent_exit();
            }
        });
}

// ── Tray ──────────────────────────────────────────────────────────────────────

fn build_tray(handle: &AppHandle) -> tauri::Result<()> {
    let open_item = MenuItem::with_id(handle, "open", "Open Cam2PC", true, None::<&str>)?;
    let sep = tauri::menu::PredefinedMenuItem::separator(handle)?;
    let quit_item = MenuItem::with_id(handle, "quit", "Quit", true, None::<&str>)?;

    let menu = Menu::with_items(handle, &[&open_item, &sep, &quit_item])?;

    TrayIconBuilder::with_id("cam2pc-tray")
        .icon(handle.default_window_icon().cloned().unwrap())
        .tooltip("Cam2PC — Camera Streaming")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => open_viewer_window(app),
            "quit" => {
                info!("Quit requested via tray");
                std::process::exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                open_viewer_window(tray.app_handle());
            }
        })
        .build(handle)?;

    Ok(())
}

fn open_viewer_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("viewer") {
        let _ = window.show();
        let _ = window.set_focus();
    } else {
        let dev_alive = std::net::TcpStream::connect("127.0.0.1:1420").is_ok();
        let url = if dev_alive {
            tauri::WebviewUrl::App("/".into())
        } else {
            tauri::WebviewUrl::External("http://127.0.0.1:3001".parse().unwrap())
        };

        let _ = WebviewWindowBuilder::new(app, "viewer", url)
            .title("Cam2PC")
            .inner_size(1280.0, 800.0)
            .min_inner_size(900.0, 600.0)
            .center()
            .build();
    }
}

// ── Tauri Commands ────────────────────────────────────────────────────────────

/// Returns the local server address so the frontend can display connection info.
#[tauri::command]
fn cmd_get_server_info(state: tauri::State<'_, Arc<AppState>>) -> serde_json::Value {
    serde_json::json!({
        "ip": state.local_ip,
        "port": state.port,
        "localWsUrl": "ws://127.0.0.1:3001/ws",
        "url": format!("https://{}:{}", state.local_ip, state.port),
    })
}

/// Creates a new streaming room and returns room ID, sender URL, and QR code data URL.
#[tauri::command]
fn cmd_create_room(state: tauri::State<'_, server::ServerState>) -> serde_json::Value {
    let (id, sender_url, qr) = state.create_room();
    serde_json::json!({
        "type": "room-created",
        "roomId": id,
        "senderUrl": sender_url,
        "qrDataUrl": qr,
        "ndiAvailable": crate::ndi::is_running(),
    })
}

/// Programmatically opens (or focuses) the viewer window.
#[tauri::command]
fn cmd_open_viewer(app: AppHandle) {
    open_viewer_window(&app);
}

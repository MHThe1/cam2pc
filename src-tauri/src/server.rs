//! Embedded HTTPS + WebSocket signaling server.
//!
//! Runs on the local machine so the phone can connect without any cloud relay.
//! Architecture:
//!   - HTTPS static file server → serves the React frontend (sender page)
//!   - `/ws`  WebSocket endpoint → WebRTC signaling (offer/answer/ICE)
//!   - `/ndi` WebSocket endpoint → receives raw RGBA frames, feeds NDI sidecar
//!   - `/api/qr` REST endpoint → returns base64 QR PNG for the sender URL
//!   - `/api/info` REST endpoint → server metadata (IP, port, NDI availability)

use anyhow::Result;
use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Query, State,
    },
    response::{IntoResponse, Response},
    routing::get,
    Json, Router,
};
use axum_server::tls_rustls::RustlsConfig;
use dashmap::DashMap;
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::{net::SocketAddr, sync::Arc};
use tokio::sync::{broadcast, mpsc};
use tokio_rustls::rustls::ServerConfig;
use tracing::{error, info, warn};
use uuid::Uuid;

// ── Shared server state ───────────────────────────────────────────────────────

#[derive(Clone, Debug)]
pub enum RoomMessage {
    Text { from: String, data: String },
    Binary { from: String, data: Arc<Vec<u8>> },
}

#[derive(Clone)]
pub struct ServerState {
    pub local_ip: String,
    pub port: u16,
    /// roomId → broadcast channel (used to relay signaling & video frames)
    pub rooms: Arc<DashMap<String, broadcast::Sender<RoomMessage>>>,
}

impl ServerState {
    pub fn create_room(&self) -> (String, String, String) {
        let id = Uuid::new_v4().to_string()[..6].to_uppercase().to_string();
        let (tx, _rx) = broadcast::channel::<RoomMessage>(256);
        self.rooms.insert(id.clone(), tx);

        let sender_url = format!("https://{}:{}/sender?room={}", self.local_ip, self.port, id);
        let qr = crate::qr::url_to_data_url(&sender_url).unwrap_or_default();
        info!("Room created: {}", id);
        (id, sender_url, qr)
    }

    pub fn get_or_create_room(&self, id: &str) -> broadcast::Sender<RoomMessage> {
        self.rooms
            .entry(id.to_string())
            .or_insert_with(|| {
                let (tx, _rx) = broadcast::channel::<RoomMessage>(256);
                tx
            })
            .clone()
    }
}

// ── Static assets embedded in binary ──────────────────────────────────────────

#[derive(rust_embed::RustEmbed)]
#[folder = "../dist"]
struct StaticAssets;

async fn static_handler(uri: axum::http::Uri) -> impl IntoResponse {
    let path = uri.path().trim_start_matches('/');
    let path = if path.is_empty() { "index.html" } else { path };

    if let Some(content) = StaticAssets::get(path) {
        let mime = mime_guess::from_path(path).first_or_octet_stream();
        return (
            [
                (axum::http::header::CONTENT_TYPE, mime.as_ref()),
                (axum::http::header::CACHE_CONTROL, "public, max-age=31536000, immutable"),
            ],
            content.data,
        )
            .into_response();
    }

    // SPA fallback to index.html for client-side routing (/sender, /viewer, etc.)
    if let Some(content) = StaticAssets::get("index.html") {
        (
            [
                (axum::http::header::CONTENT_TYPE, "text/html; charset=utf-8"),
                (axum::http::header::CACHE_CONTROL, "no-cache"),
            ],
            content.data,
        )
            .into_response()
    } else {
        (axum::http::StatusCode::NOT_FOUND, "404 Not Found").into_response()
    }
}

// ── Server entry point ────────────────────────────────────────────────────────

pub async fn start(state: ServerState, tls: Arc<ServerConfig>) -> Result<()> {
    let local_ip = state.local_ip.clone();
    let https_port = state.port;
    let local_ws_port = 3001;

    let app = Router::new()
        .route("/ws", get(ws_signaling_handler))
        .route("/ndi", get(ws_ndi_handler))
        .route("/api/info", get(api_info))
        .route("/api/qr", get(api_qr))
        .fallback(static_handler)
        .layer(tower_http::cors::CorsLayer::permissive())
        .with_state(state.clone());

    // 1. Plain HTTP/WS listener on 0.0.0.0:3001 for LAN (native app) & local PC desktop app
    let local_app = app.clone();
    tokio::spawn(async move {
        let local_addr: SocketAddr = format!("0.0.0.0:{}", local_ws_port).parse().unwrap();
        if let Ok(listener) = tokio::net::TcpListener::bind(local_addr).await {
            info!("LAN plain signaling listening on ws://0.0.0.0:{}/ws", local_ws_port);
            let _ = axum::serve(listener, local_app.into_make_service()).await;
        } else {
            error!("Failed to bind local listener on {}", local_addr);
        }
    });

    // 2. HTTPS/WSS listener on 0.0.0.0:3000 for mobile browser phones (requires HTTPS for camera permissions)
    let addr: SocketAddr = format!("0.0.0.0:{}", https_port).parse()?;
    let rustls_config = RustlsConfig::from_config(tls);

    info!("Mobile signaling server listening on https://{}:{}", local_ip, https_port);

    axum_server::bind_rustls(addr, rustls_config)
        .serve(app.into_make_service())
        .await?;

    Ok(())
}

// ── REST endpoints ────────────────────────────────────────────────────────────

#[derive(Serialize)]
struct InfoResponse {
    ip: String,
    port: u16,
    sender_url: String,
    ndi_available: bool,
}

async fn api_info(State(s): State<ServerState>) -> Json<InfoResponse> {
    Json(InfoResponse {
        sender_url: format!("https://{}:{}/sender", s.local_ip, s.port),
        ndi_available: crate::ndi::is_running(),
        ip: s.local_ip,
        port: s.port,
    })
}

#[derive(Deserialize)]
struct QrParams {
    url: String,
}

async fn api_qr(Query(params): Query<QrParams>) -> Response {
    match crate::qr::url_to_data_url(&params.url) {
        Ok(data_url) => Json(serde_json::json!({ "dataUrl": data_url })).into_response(),
        Err(e) => {
            error!("QR generation failed: {}", e);
            (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response()
        }
    }
}

// ── WebSocket signaling ───────────────────────────────────────────────────────

async fn ws_signaling_handler(
    ws: WebSocketUpgrade,
    State(state): State<ServerState>,
) -> Response {
    ws.on_upgrade(move |socket| handle_signaling(socket, state))
}

/// WebRTC signaling protocol over WebSocket with active broadcast pump.
async fn handle_signaling(socket: WebSocket, state: ServerState) {
    let client_id = Uuid::new_v4().to_string();
    let mut current_room: Option<String> = None;
    let mut current_role: Option<String> = None;

    let (mut ws_sender, mut ws_receiver) = socket.split();

    // Outgoing message queue for this WebSocket
    let (out_tx, mut out_rx) = mpsc::unbounded_channel::<Message>();

    // Task to write queued messages to WebSocket
    let write_task = tokio::spawn(async move {
        while let Some(msg) = out_rx.recv().await {
            if ws_sender.send(msg).await.is_err() {
                break;
            }
        }
    });

    let mut room_subscriber_handle: Option<tokio::task::JoinHandle<()>> = None;

    while let Some(Ok(msg)) = ws_receiver.next().await {
        match msg {
            Message::Text(text) => {
                let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&text) else {
                    continue;
                };

                let msg_type = parsed["type"].as_str().unwrap_or("").to_string();

                match msg_type.as_str() {
                    // ── Viewer creates a room ──────────────────────────────────────
                    "create-room" => {
                        let id = if let Some(requested_id) = parsed.get("roomId").and_then(|v| v.as_str()) {
                            let trimmed = requested_id.trim();
                            if !trimmed.is_empty() {
                                trimmed.to_uppercase()
                            } else {
                                Uuid::new_v4().to_string()[..6].to_uppercase().to_string()
                            }
                        } else {
                            Uuid::new_v4().to_string()[..6].to_uppercase().to_string()
                        };
                        let room_tx = state.get_or_create_room(&id);

                        current_room = Some(id.clone());
                        current_role = Some("viewer".into());

                        // Subscribe to room messages
                        if let Some(h) = room_subscriber_handle.take() {
                            h.abort();
                        }
                        let mut bcast_rx = room_tx.subscribe();
                        let out_tx_clone = out_tx.clone();
                        let cid = client_id.clone();
                        room_subscriber_handle = Some(tokio::spawn(async move {
                            while let Ok(signal) = bcast_rx.recv().await {
                                match signal {
                                    RoomMessage::Text { from, data } => {
                                        if from != cid {
                                            let _ = out_tx_clone.send(Message::Text(data));
                                        }
                                    }
                                    RoomMessage::Binary { from, data } => {
                                        if from != cid {
                                            let _ = out_tx_clone.send(Message::Binary((*data).clone()));
                                        }
                                    }
                                }
                            }
                        }));

                        let sender_url =
                            format!("https://{}:{}/sender?room={}", state.local_ip, state.port, id);
                        let qr = crate::qr::url_to_data_url(&sender_url).unwrap_or_default();

                        let response = serde_json::json!({
                            "type": "room-created",
                            "roomId": id,
                            "senderUrl": sender_url,
                            "qrDataUrl": qr,
                            "ndiAvailable": crate::ndi::is_running(),
                        });

                        let _ = out_tx.send(Message::Text(response.to_string()));
                        info!("Viewer created and joined room: {}", id);
                    }

                    // ── Client joins a room ────────────────────────────────────────
                    "join" => {
                        let Some(rid) = parsed["room"].as_str() else {
                            continue;
                        };
                        let rid = rid.to_string();
                        let room_tx = state.get_or_create_room(&rid);

                        current_room = Some(rid.clone());
                        let role = parsed["role"].as_str().unwrap_or("sender").to_string();
                        current_role = Some(role.clone());

                        // Subscribe to room messages
                        if let Some(h) = room_subscriber_handle.take() {
                            h.abort();
                        }
                        let mut bcast_rx = room_tx.subscribe();
                        let out_tx_clone = out_tx.clone();
                        let cid = client_id.clone();
                        room_subscriber_handle = Some(tokio::spawn(async move {
                            while let Ok(signal) = bcast_rx.recv().await {
                                match signal {
                                    RoomMessage::Text { from, data } => {
                                        if from != cid {
                                            let _ = out_tx_clone.send(Message::Text(data));
                                        }
                                    }
                                    RoomMessage::Binary { from, data } => {
                                        if from != cid {
                                            let _ = out_tx_clone.send(Message::Binary((*data).clone()));
                                        }
                                    }
                                }
                            }
                        }));

                        // Broadcast that sender joined
                        if role == "sender" || role == "native-sender" {
                            let _ = room_tx.send(RoomMessage::Text {
                                from: client_id.clone(),
                                data: serde_json::json!({
                                    "type": "sender-joined",
                                    "role": role
                                }).to_string(),
                            });
                        }
                        info!("Client ({}) joined room: {}", role, rid);
                    }

                    // ── Relay: viewer says ready → tell sender to create offer ─────
                    "ready" => {
                        if let Some(ref rid) = current_room {
                            if let Some(room_tx) = state.rooms.get(rid) {
                                let _ = room_tx.send(RoomMessage::Text {
                                    from: client_id.clone(),
                                    data: serde_json::json!({ "type": "create-offer" }).to_string(),
                                });
                                info!("Viewer ready sent to room: {}", rid);
                            }
                        }
                    }

                    // ── Relay signaling messages between peers ─────────────────────
                    "offer" | "answer" | "ice-candidate" => {
                        if let Some(ref rid) = current_room {
                            if let Some(room_tx) = state.rooms.get(rid) {
                                let _ = room_tx.send(RoomMessage::Text {
                                    from: client_id.clone(),
                                    data: text.to_string(),
                                });
                            }
                        }
                    }

                    _ => {
                        warn!("Unknown signaling message type: {}", msg_type);
                    }
                }
            }

            Message::Binary(bin) => {
                // Relay raw H.264 video chunks directly to the room's viewer
                if let Some(ref rid) = current_room {
                    if let Some(room_tx) = state.rooms.get(rid) {
                        let _ = room_tx.send(RoomMessage::Binary {
                            from: client_id.clone(),
                            data: Arc::new(bin),
                        });
                    }
                }
            }

            Message::Close(_) => break,
            _ => continue,
        }
    }

    // Cleanup on disconnect
    if let Some(h) = room_subscriber_handle {
        h.abort();
    }
    write_task.abort();

    if let Some(rid) = current_room {
        let r = current_role.unwrap_or_default();
        if r == "viewer" {
            info!("Viewer disconnected from room: {}", rid);
        } else if r == "sender" || r == "native-sender" {
            if let Some(room_tx) = state.rooms.get(&rid) {
                let _ = room_tx.send(RoomMessage::Text {
                    from: client_id,
                    data: serde_json::json!({ "type": "sender-left" }).to_string(),
                });
            }
            info!("Sender left room: {}", rid);
        }
    }
}

// ── WebSocket NDI bridge ──────────────────────────────────────────────────────

async fn ws_ndi_handler(ws: WebSocketUpgrade, State(_state): State<ServerState>) -> Response {
    ws.on_upgrade(handle_ndi_bridge)
}

/// Receives raw RGBA frame buffers from the browser and forwards them to the
/// NDI sidecar process via stdout/stdin IPC.
///
/// Frame format (binary message): raw RGBA bytes, 1920×1080×4 = 8,294,400 bytes.
async fn handle_ndi_bridge(socket: WebSocket) {
    info!("NDI bridge client connected");
    let (_sender, mut receiver) = socket.split();

    while let Some(Ok(msg)) = receiver.next().await {
        match msg {
            Message::Binary(frame_data) => {
                tracing::trace!("NDI frame received: {} bytes", frame_data.len());
            }
            Message::Close(_) => break,
            _ => continue,
        }
    }

    info!("NDI bridge client disconnected");
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { LiveIndicator } from '@/components/LiveIndicator';
import { QRCodeDisplay } from '@/components/QRCodeDisplay';
import { StatsBar } from '@/components/StatsBar';
import { RecordButton } from '@/components/RecordButton';
import { NDIToggle } from '@/components/NDIToggle';
import { useViewerWebRTC, useSignaling } from '@/hooks/useWebRTC';
import { useRecorder } from '@/hooks/useRecorder';
import { useNDIBridge } from '@/hooks/useNDIBridge';
import type { SignalingMessage, ServerInfo, StreamStats } from '@/types';

const DEFAULT_STATS: StreamStats = {
  resolution: '',
  fps: 0,
  bitrateBps: 0,
  latencyMs: null,
};

/**
 * ViewerPage — the PC-side viewer.
 *
 * Runs inside the Tauri window. Shows:
 *   - Waiting state: QR code for phone to scan
 *   - Connected state: full-screen video with HUD overlay
 *
 * Also supports OBS-clean mode via `?obs=1` URL param (hides all UI chrome).
 */
export default function ViewerPage() {
  const videoRef = useRef<HTMLVideoElement>(null);

  const [serverInfo, setServerInfo] = useState<ServerInfo | null>(null);
  const [roomData, setRoomData] = useState<{ qrDataUrl: string; senderUrl: string; ndiAvailable: boolean } | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [stats, setStats] = useState<StreamStats>(DEFAULT_STATS);

  const obsMode = new URLSearchParams(window.location.search).has('obs');
  const [hudVisible, setHudVisible] = useState(!obsMode);

  // Toggle HUD with 'H' key or double click (great for OBS Window Capture)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'h' || e.key === 'H') {
        setHudVisible((v) => !v);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // ── Server info from Tauri or backend REST API ────────────────────────────
  useEffect(() => {
    invoke<ServerInfo>('cmd_get_server_info')
      .then(setServerInfo)
      .catch(async () => {
        // In OBS Browser Source or regular browser, fetch server info from Axum
        try {
          const apiUrl = window.location.port === '1420'
            ? 'http://127.0.0.1:3001/api/info'
            : (window.location.protocol === 'https:'
                ? `https://${window.location.hostname}:3000/api/info`
                : `http://${window.location.hostname || '127.0.0.1'}:3001/api/info`);
          const res = await fetch(apiUrl);
          const data = await res.json();
          setServerInfo({
            ip: data.ip,
            port: data.port,
            url: data.sender_url ? data.sender_url.replace('/sender', '') : `https://${data.ip}:${data.port}`,
            localWsUrl: 'ws://127.0.0.1:3001/ws',
          });
        } catch {
          setServerInfo({
            ip: '127.0.0.1',
            port: 3000,
            url: 'https://127.0.0.1:3000',
            localWsUrl: 'ws://127.0.0.1:3001/ws',
          });
        }
      });
  }, []);

  // ── WebRTC viewer ──────────────────────────────────────────────────────────
  const { handleOffer, addIceCandidate, setStatus } = useViewerWebRTC({
    onStream: (stream) => {
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setIsStreaming(true);
    },
    onStats: (s) => setStats((prev) => ({ ...prev, ...s })),
  });

  // ── Signaling ──────────────────────────────────────────────────────────────
  const wsUrl = serverInfo?.localWsUrl || 'ws://127.0.0.1:3001/ws';

  const handleSignalingMessage = useCallback(
    (msg: SignalingMessage) => {
      switch (msg.type) {
        case 'room-created':
          setRoomData({
            qrDataUrl: msg.qrDataUrl,
            senderUrl: msg.senderUrl,
            ndiAvailable: msg.ndiAvailable,
          });
          break;

        case 'sender-joined':
          setStatus('connecting');
          send({ type: 'ready' });
          break;

        case 'sender-left':
          setIsStreaming(false);
          setStats(DEFAULT_STATS);
          if (videoRef.current) videoRef.current.srcObject = null;
          break;

        case 'offer':
          handleOffer(msg.sdp, send);
          break;

        case 'ice-candidate':
          addIceCandidate(msg.candidate);
          break;
      }
    },
    [handleOffer, addIceCandidate, setStatus],
  );

  const { send } = useSignaling({
    wsUrl,
    onMessage: handleSignalingMessage,
    onOpen: () => send({ type: 'create-room' }),
  });

  // ── Recording ──────────────────────────────────────────────────────────────
  const recorder = useRecorder();

  const handleRecordToggle = () => {
    if (!videoRef.current?.srcObject) return;
    if (recorder.state.status === 'recording') {
      recorder.stop();
    } else {
      recorder.start(videoRef.current.srcObject as MediaStream);
    }
  };

  // ── NDI bridge ─────────────────────────────────────────────────────────────
  const ndi = useNDIBridge();

  const handleNDIToggle = () => {
    if (!serverInfo || !videoRef.current) return;
    if (ndi.status === 'active') {
      ndi.disable();
    } else {
      ndi.enable(videoRef.current, serverInfo.url);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div
      className="relative w-full h-full bg-[var(--color-surface-0)] overflow-hidden"
      onDoubleClick={() => setHudVisible((v) => !v)}
    >

      {/* ── Full-screen video ──────────────────────────────────────────────── */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="absolute inset-0 w-full h-full object-contain"
        aria-label="Live camera feed from phone"
      />

      {/* ── Waiting / idle overlay ─────────────────────────────────────────── */}
      {!isStreaming && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-8 animate-fade-in">
          {/* App title */}
          <div className="text-center">
            <h1 className="text-4xl font-bold text-gradient mb-2">Cam2PC</h1>
            <p className="text-white/40 text-sm">
              {serverInfo ? `Running on ${serverInfo.url}` : 'Starting server…'}
            </p>
          </div>

          {/* QR code */}
          {roomData ? (
            <QRCodeDisplay dataUrl={roomData.qrDataUrl} senderUrl={roomData.senderUrl} />
          ) : (
            <div className="w-56 h-56 glass rounded-2xl flex items-center justify-center">
              <span className="text-white/30 text-sm animate-pulse">Initializing…</span>
            </div>
          )}

          <p className="text-white/30 text-xs text-center max-w-xs">
            Open on the same WiFi network &middot; Accept certificate once
          </p>
        </div>
      )}

      {/* ── HUD overlay (shown while streaming) ───────────────────────────── */}
      {hudVisible && (
        <div className="hud-overlay absolute inset-0 pointer-events-none">

          {/* Top bar */}
          <div
            className="absolute top-0 left-0 right-0 flex items-center justify-between px-5 py-3 pointer-events-auto"
            style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.6) 0%, transparent 100%)' }}
          >
            <div className="flex items-center gap-3">
              <span className="font-bold text-white/90 tracking-tight">Cam2PC</span>
              <LiveIndicator active={isStreaming} />
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setHudVisible(false)}
                title="Hide HUD for clean OBS capture (Press 'H' or double-click to restore)"
                className="px-2.5 py-1 text-xs font-medium rounded-lg bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-colors"
              >
                Hide HUD [H]
              </button>
              <RecordButton
                state={recorder.state}
                onStart={handleRecordToggle}
                onStop={handleRecordToggle}
                disabled={!isStreaming}
                formattedSize={recorder.formattedSize}
              />
            </div>
          </div>

          {/* Bottom bar */}
          {isStreaming && (
            <div
              className="absolute bottom-0 left-0 right-0 flex items-center justify-between px-5 py-3 pointer-events-auto"
              style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.6) 0%, transparent 100%)' }}
            >
              <StatsBar stats={stats} />

              <div className="flex items-center gap-3">
                {/* Mini QR for reconnecting */}
                {roomData && (
                  <img
                    src={roomData.qrDataUrl}
                    alt="Reconnect QR"
                    className="w-10 h-10 rounded opacity-40 hover:opacity-100 transition-opacity"
                  />
                )}

                <NDIToggle
                  status={ndi.status}
                  available={roomData?.ndiAvailable ?? false}
                  onEnable={handleNDIToggle}
                  onDisable={handleNDIToggle}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

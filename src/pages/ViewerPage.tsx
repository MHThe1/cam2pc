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

  // ── Server info from Tauri ─────────────────────────────────────────────────
  useEffect(() => {
    invoke<ServerInfo>('cmd_get_server_info')
      .then(setServerInfo)
      .catch(() => {
        setServerInfo({ ip: window.location.hostname, port: 3000, url: `https://${window.location.hostname}:3000` });
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
  const wsUrl = serverInfo
    ? (serverInfo.localWsUrl || `ws://127.0.0.1:3001/ws`)
    : '';

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
    <div className="relative w-full h-full bg-[var(--color-surface-0)] overflow-hidden">

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
      {!isStreaming && !obsMode && (
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
      {!obsMode && (
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

            <RecordButton
              state={recorder.state}
              onStart={handleRecordToggle}
              onStop={handleRecordToggle}
              disabled={!isStreaming}
              formattedSize={recorder.formattedSize}
            />
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

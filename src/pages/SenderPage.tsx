import { useCallback, useEffect, useRef, useState } from 'react';
import { LiveIndicator } from '@/components/LiveIndicator';
import { useSignaling, useSenderWebRTC } from '@/hooks/useWebRTC';
import type { ConnectionStatus, SignalingMessage } from '@/types';

type FacingMode = 'environment' | 'user';

/**
 * SenderPage — the phone-side camera sender.
 *
 * Opened on the phone by scanning the QR code. Reads `?room=XXXX` from the URL
 * and joins that room on the signaling server to initiate the WebRTC stream.
 */
export default function SenderPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const sendRef = useRef<(msg: object) => void>(() => {});

  const roomId = new URLSearchParams(window.location.search).get('room') ?? '';
  const serverHost = window.location.host;

  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const [facingMode, setFacingMode] = useState<FacingMode>('environment');
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [streamStarted, setStreamStarted] = useState(false);

  const { startStream, handleAnswer, addIceCandidate, flipCamera, streamRef } =
    useSenderWebRTC({ onStatusChange: setStatus });

  // ── Signaling ──────────────────────────────────────────────────────────────
  const handleSignalingMessage = useCallback(
    async (msg: SignalingMessage) => {
      switch (msg.type) {
        case 'create-offer': {
          try {
            const stream = await startStream(facingMode, audioEnabled, sendRef.current);
            if (videoRef.current) videoRef.current.srcObject = stream;
            setStreamStarted(true);
            setError(null);
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Camera access denied');
            setStatus('error');
          }
          break;
        }

        case 'answer':
          await handleAnswer(msg.sdp);
          break;

        case 'ice-candidate':
          await addIceCandidate(msg.candidate);
          break;

        case 'sender-left':
        case 'sender-joined':
          break;
      }
    },
    [startStream, handleAnswer, addIceCandidate, facingMode, audioEnabled],
  );

  const wsUrl = roomId ? `wss://${serverHost}/ws` : '';

  const { send } = useSignaling({
    wsUrl,
    onMessage: handleSignalingMessage,
    onOpen: () => {
      if (!roomId) {
        setError('No room ID in URL. Please scan the QR code again.');
        return;
      }
      send({ type: 'join', room: roomId });
      setStatus('waiting');
    },
  });

  // Keep sendRef current so the callback in handleSignalingMessage always has latest
  useEffect(() => {
    sendRef.current = send;
  }, [send]);

  // ── Manual start trigger (essential for iOS Safari user activation) ──────
  const handleManualStart = async () => {
    try {
      setError(null);
      const stream = await startStream(facingMode, audioEnabled, sendRef.current);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(() => {});
      }
      setStreamStarted(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Camera access denied');
      setStatus('error');
    }
  };

  // ── Camera flip ────────────────────────────────────────────────────────────
  const handleFlip = async () => {
    const next: FacingMode = facingMode === 'environment' ? 'user' : 'environment';
    setFacingMode(next);

    if (streamStarted && streamRef.current) {
      const newStream = await flipCamera(next, audioEnabled).catch(() => null);
      if (newStream && videoRef.current) {
        videoRef.current.srcObject = newStream;
      }
    }
  };

  // ── Derived UI state ───────────────────────────────────────────────────────
  const statusLabel: Record<ConnectionStatus, string> = {
    idle: 'Connecting to PC…',
    waiting: 'Connected to PC — ready',
    connecting: 'Establishing stream…',
    connected: 'Streaming Live to PC',
    disconnected: 'Disconnected',
    error: 'Error',
  };

  const statusColor: Partial<Record<ConnectionStatus, string>> = {
    connected: 'text-[var(--color-ok)]',
    error: 'text-[var(--color-live)]',
    disconnected: 'text-[var(--color-live)]',
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div
      className="relative w-full h-dvh bg-[var(--color-surface-0)] flex flex-col overflow-hidden"
      style={{ userSelect: 'none' }}
    >
      {/* ── Camera preview ───────────────────────────────────────────────── */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="absolute inset-0 w-full h-full object-cover"
        aria-label="Camera preview"
      />

      {/* ── Tap to Start overlay if not streaming ────────────────────────── */}
      {!streamStarted && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center p-6 bg-black/60 backdrop-blur-sm">
          <button
            onClick={handleManualStart}
            className="flex flex-col items-center gap-3 px-8 py-6 rounded-3xl bg-[var(--color-accent)] text-black font-bold text-lg shadow-lg active:scale-95 transition-transform"
          >
            <span className="text-3xl">📷</span>
            <span>Tap to Start Camera</span>
          </button>
          <p className="text-white/60 text-xs mt-4 text-center max-w-xs">
            Tap to allow Safari to use your phone's camera for PC streaming
          </p>
        </div>
      )}

      {/* ── Dark gradient overlays ────────────────────────────────────────── */}
      <div
        className="absolute inset-x-0 top-0 h-32 pointer-events-none"
        style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.75) 0%, transparent 100%)' }}
      />
      <div
        className="absolute inset-x-0 bottom-0 h-48 pointer-events-none"
        style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.85) 0%, transparent 100%)' }}
      />

      {/* ── Top status bar ────────────────────────────────────────────────── */}
      <div className="relative z-10 flex items-center justify-between px-5 pt-safe-top pt-4">
        <span className="font-bold text-white tracking-tight">Cam2PC</span>
        <LiveIndicator active={status === 'connected'} />
      </div>

      {/* ── Bottom controls ───────────────────────────────────────────────── */}
      <div className="relative z-10 mt-auto px-6 pb-safe-bottom pb-8">

        {/* Status label */}
        <p
          className={`text-center text-sm font-medium mb-6 ${statusColor[status] ?? 'text-white/60'}`}
        >
          {error ?? statusLabel[status]}
        </p>

        {/* Controls row */}
        <div className="flex items-center justify-center gap-6">

          {/* Audio toggle */}
          <button
            id="audio-toggle"
            onClick={() => setAudioEnabled((v) => !v)}
            aria-label={audioEnabled ? 'Mute microphone' : 'Unmute microphone'}
            aria-pressed={audioEnabled}
            className="flex flex-col items-center gap-1.5 p-3 glass rounded-2xl min-w-[60px] transition-all active:scale-95"
          >
            <span className="text-xl" aria-hidden="true">
              {audioEnabled ? '🎙️' : '🔇'}
            </span>
            <span className="text-[10px] text-white/50 uppercase tracking-wider">
              {audioEnabled ? 'Audio' : 'Muted'}
            </span>
          </button>

          {/* Center Stream button */}
          <div className="flex flex-col items-center gap-1.5 p-3">
            <button
              onClick={handleManualStart}
              className="size-16 rounded-full border-4 border-white/20 flex items-center justify-center active:scale-95 transition-transform"
              aria-label="Stream status"
            >
              <div
                className={`size-10 rounded-full ${
                  status === 'connected'
                    ? 'bg-[var(--color-live)] animate-pulse'
                    : 'bg-[var(--color-accent)]'
                }`}
              />
            </button>
          </div>

          {/* Flip camera */}
          <button
            id="flip-camera"
            onClick={handleFlip}
            aria-label="Flip camera"
            className="flex flex-col items-center gap-1.5 p-3 glass rounded-2xl min-w-[60px] transition-all active:scale-95"
          >
            <span className="text-xl" aria-hidden="true">🔄</span>
            <span className="text-[10px] text-white/50 uppercase tracking-wider">Flip</span>
          </button>
        </div>
      </div>
    </div>
  );
}

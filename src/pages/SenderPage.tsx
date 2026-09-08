import { useCallback, useEffect, useRef, useState } from 'react';
import { LiveIndicator } from '@/components/LiveIndicator';
import { useSignaling, useSenderWebRTC } from '@/hooks/useWebRTC';
import type { ConnectionStatus, SignalingMessage, QualityPresetKey } from '@/types';
import { QUALITY_PRESETS } from '@/types';

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
  const [presetKey, setPresetKey] = useState<QualityPresetKey>('balanced');
  const [dimmed, setDimmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [streamStarted, setStreamStarted] = useState(false);

  const { startStream, handleAnswer, addIceCandidate, flipCamera, changePreset, streamRef } =
    useSenderWebRTC({ onStatusChange: setStatus });

  // ── Signaling ──────────────────────────────────────────────────────────────
  const handleSignalingMessage = useCallback(
    async (msg: SignalingMessage) => {
      switch (msg.type) {
        case 'create-offer': {
          try {
            const stream = await startStream(
              facingMode,
              audioEnabled,
              sendRef.current,
              QUALITY_PRESETS[presetKey],
            );
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
    [startStream, handleAnswer, addIceCandidate, facingMode, audioEnabled, presetKey],
  );

  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = roomId ? `${wsProtocol}//${serverHost}/ws` : '';

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

  // ── Manual start trigger (essential for mobile user activation) ───────────
  const handleManualStart = async () => {
    try {
      setError(null);
      const stream = await startStream(
        facingMode,
        audioEnabled,
        sendRef.current,
        QUALITY_PRESETS[presetKey],
      );
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

  // ── Dynamic preset change (swaps resolution & bitrate in real-time) ────────
  const handlePresetChange = async (newKey: QualityPresetKey) => {
    setPresetKey(newKey);
    if (streamStarted && streamRef.current) {
      try {
        const newStream = await changePreset(
          QUALITY_PRESETS[newKey],
          facingMode,
          audioEnabled,
        );
        if (newStream && videoRef.current) {
          videoRef.current.srcObject = newStream;
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to switch preset');
      }
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
      {/* ── Camera preview (hidden when dimmed to save GPU cycles & battery) ── */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${
          dimmed ? 'opacity-0 pointer-events-none' : 'opacity-100'
        }`}
        aria-label="Camera preview"
      />

      {/* ── Tap to Start overlay if not streaming ────────────────────────── */}
      {!streamStarted && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center p-6 bg-black/75 backdrop-blur-md animate-fade-in">
          <button
            onClick={handleManualStart}
            className="flex flex-col items-center gap-3 px-8 py-6 rounded-3xl bg-[var(--color-accent)] text-black font-bold text-lg shadow-xl active:scale-95 transition-transform"
          >
            <span className="text-3xl">📷</span>
            <span>Tap to Start Camera</span>
          </button>

          {/* Quality preset selector before start */}
          <div className="mt-6 flex flex-col items-center gap-2 max-w-xs w-full">
            <span className="text-white/40 text-[11px] uppercase tracking-wider font-medium">
              Select Quality Profile
            </span>
            <div className="grid grid-cols-3 gap-2 w-full">
              {(Object.keys(QUALITY_PRESETS) as QualityPresetKey[]).map((key) => {
                const p = QUALITY_PRESETS[key];
                const isActive = presetKey === key;
                return (
                  <button
                    key={key}
                    onClick={() => setPresetKey(key)}
                    className={`py-2 px-1 rounded-xl text-xs flex flex-col items-center gap-0.5 border transition-all ${
                      isActive
                        ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/15 text-white font-semibold'
                        : 'border-white/10 glass text-white/60 hover:text-white'
                    }`}
                  >
                    <span>{p.shortLabel}</span>
                    <span className="text-[9px] opacity-60">
                      {key === 'smooth' ? 'Older phones' : key === 'balanced' ? 'Standard' : 'Fast Wi-Fi'}
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="text-white/40 text-[11px] text-center mt-1">
              {QUALITY_PRESETS[presetKey].desc}
            </p>
          </div>
        </div>
      )}

      {/* ── Screen Dimmer / Performance Mode Overlay ─────────────────────── */}
      {dimmed && (
        <div
          onClick={() => setDimmed(false)}
          className="absolute inset-0 z-50 bg-black flex flex-col items-center justify-center p-6 text-center cursor-pointer select-none animate-fade-in"
        >
          <span className="text-4xl opacity-30 mb-3 animate-pulse">🌙</span>
          <h2 className="text-white/80 font-bold text-base">Performance Mode Active</h2>
          <p className="text-white/40 text-xs mt-1 max-w-xs leading-relaxed">
            Screen display suspended to keep phone cool, reduce battery drain, and eliminate lag.
          </p>
          <div className="mt-6 px-4 py-2 rounded-full border border-white/10 glass">
            <p className="text-[var(--color-accent)] text-xs font-semibold animate-pulse">
              Tap anywhere to wake screen
            </p>
          </div>
        </div>
      )}

      {/* ── Dark gradient overlays ────────────────────────────────────────── */}
      <div
        className="absolute inset-x-0 top-0 h-32 pointer-events-none"
        style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.75) 0%, transparent 100%)' }}
      />
      <div
        className="absolute inset-x-0 bottom-0 h-56 pointer-events-none"
        style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.9) 0%, transparent 100%)' }}
      />

      {/* ── Top status bar ────────────────────────────────────────────────── */}
      <div className="relative z-10 flex items-center justify-between px-5 pt-safe-top pt-4">
        <span className="font-bold text-white tracking-tight">Cam2PC</span>
        <div className="flex items-center gap-2">
          <span className="text-[10px] px-2 py-0.5 rounded-full glass text-white/60 font-mono">
            {QUALITY_PRESETS[presetKey].shortLabel} · H.264
          </span>
          <LiveIndicator active={status === 'connected'} />
        </div>
      </div>

      {/* ── Bottom controls ───────────────────────────────────────────────── */}
      <div className="relative z-10 mt-auto px-5 pb-safe-bottom pb-6">

        {/* Quality Preset Pills (Live switcher) */}
        <div className="flex items-center justify-center gap-1.5 mb-4">
          {(Object.keys(QUALITY_PRESETS) as QualityPresetKey[]).map((key) => {
            const p = QUALITY_PRESETS[key];
            const isActive = presetKey === key;
            return (
              <button
                key={key}
                onClick={() => handlePresetChange(key)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
                  isActive
                    ? 'bg-[var(--color-accent)] text-black font-semibold shadow-md scale-105'
                    : 'glass text-white/60 hover:text-white hover:bg-white/10'
                }`}
              >
                {p.shortLabel}
              </button>
            );
          })}
        </div>

        {/* Status label */}
        <p
          className={`text-center text-xs font-medium mb-5 ${statusColor[status] ?? 'text-white/60'}`}
        >
          {error ?? statusLabel[status]}
        </p>

        {/* Controls row */}
        <div className="flex items-center justify-around max-w-xs mx-auto">

          {/* Audio toggle */}
          <button
            id="audio-toggle"
            onClick={() => setAudioEnabled((v) => !v)}
            aria-label={audioEnabled ? 'Mute microphone' : 'Unmute microphone'}
            aria-pressed={audioEnabled}
            className="flex flex-col items-center gap-1 p-2.5 glass rounded-2xl min-w-[56px] transition-all active:scale-95"
          >
            <span className="text-lg" aria-hidden="true">
              {audioEnabled ? '🎙️' : '🔇'}
            </span>
            <span className="text-[9px] text-white/50 uppercase tracking-wider">
              {audioEnabled ? 'Audio' : 'Muted'}
            </span>
          </button>

          {/* Center Stream status / Start button */}
          <button
            onClick={handleManualStart}
            className="size-14 rounded-full border-4 border-white/20 flex items-center justify-center active:scale-95 transition-transform"
            aria-label="Stream status"
          >
            <div
              className={`size-9 rounded-full ${
                status === 'connected'
                  ? 'bg-[var(--color-live)] animate-pulse'
                  : 'bg-[var(--color-accent)]'
              }`}
            />
          </button>

          {/* Performance / Screen Dim toggle */}
          <button
            id="dim-toggle"
            onClick={() => setDimmed(true)}
            aria-label="Performance mode: dim screen"
            className="flex flex-col items-center gap-1 p-2.5 glass rounded-2xl min-w-[56px] transition-all active:scale-95"
          >
            <span className="text-lg" aria-hidden="true">🌙</span>
            <span className="text-[9px] text-white/50 uppercase tracking-wider">Dim</span>
          </button>

          {/* Flip camera */}
          <button
            id="flip-camera"
            onClick={handleFlip}
            aria-label="Flip camera"
            className="flex flex-col items-center gap-1 p-2.5 glass rounded-2xl min-w-[56px] transition-all active:scale-95"
          >
            <span className="text-lg" aria-hidden="true">🔄</span>
            <span className="text-[9px] text-white/50 uppercase tracking-wider">Flip</span>
          </button>
        </div>
      </div>
    </div>
  );
}

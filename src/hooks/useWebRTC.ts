import { useCallback, useEffect, useRef, useState } from 'react';
import type { ConnectionStatus, SignalingMessage, QualityPresetConfig } from '@/types';
import { QUALITY_PRESETS } from '@/types';

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

interface UseSignalingOptions {
  wsUrl: string;
  onMessage: (msg: SignalingMessage) => void;
  onBinary?: (data: ArrayBuffer) => void;
  onOpen?: () => void;
  onClose?: () => void;
}

/**
 * Manages the WebSocket connection to the signaling server.
 * Handles reconnection with exponential back-off.
 */
export function useSignaling({ wsUrl, onMessage, onBinary, onOpen, onClose }: UseSignalingOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryCount = useRef(0);
  const isDisposedRef = useRef(false);

  const onMessageRef = useRef(onMessage);
  const onBinaryRef = useRef(onBinary);
  const onOpenRef = useRef(onOpen);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onMessageRef.current = onMessage;
    onBinaryRef.current = onBinary;
    onOpenRef.current = onOpen;
    onCloseRef.current = onClose;
  }, [onMessage, onBinary, onOpen, onClose]);

  const send = useCallback((msg: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  useEffect(() => {
    if (!wsUrl) return;

    isDisposedRef.current = false;

    const connect = () => {
      if (isDisposedRef.current) return;

      // Don't reconnect if already connected or connecting
      if (
        wsRef.current &&
        (wsRef.current.readyState === WebSocket.OPEN ||
          wsRef.current.readyState === WebSocket.CONNECTING)
      ) {
        return;
      }

      try {
        const ws = new WebSocket(wsUrl);
        ws.binaryType = 'arraybuffer';
        wsRef.current = ws;

        ws.onopen = () => {
          if (isDisposedRef.current || wsRef.current !== ws) {
            ws.close();
            return;
          }
          retryCount.current = 0;
          onOpenRef.current?.();
        };

        ws.onmessage = (event) => {
          if (isDisposedRef.current || wsRef.current !== ws) return;
          if (event.data instanceof ArrayBuffer) {
            onBinaryRef.current?.(event.data);
            return;
          }
          try {
            const msg = JSON.parse(event.data as string) as SignalingMessage;
            onMessageRef.current?.(msg);
          } catch {
            // ignore malformed messages
          }
        };

        ws.onclose = () => {
          // If unmounted or this was an old socket, do not trigger reconnect
          if (isDisposedRef.current || wsRef.current !== ws) {
            return;
          }
          wsRef.current = null;
          onCloseRef.current?.();

          // Exponential back-off: 1s, 2s, 4s … max 16s
          const delay = Math.min(1000 * Math.pow(2, retryCount.current), 16_000);
          retryCount.current++;
          reconnectTimer.current = setTimeout(connect, delay);
        };

        ws.onerror = () => {
          if (wsRef.current === ws) {
            ws.close();
          }
        };
      } catch {
        if (!isDisposedRef.current) {
          const delay = Math.min(1000 * Math.pow(2, retryCount.current), 16_000);
          retryCount.current++;
          reconnectTimer.current = setTimeout(connect, delay);
        }
      }
    };

    connect();

    return () => {
      isDisposedRef.current = true;
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = null;
      }
      if (wsRef.current) {
        const ws = wsRef.current;
        wsRef.current = null;
        ws.onopen = null;
        ws.onmessage = null;
        ws.onclose = null;
        ws.onerror = null;
        ws.close();
      }
    };
  }, [wsUrl]);

  return { send };
}

// ── Viewer-side WebRTC hook ───────────────────────────────────────────────────

interface UseViewerWebRTCOptions {
  onStream: (stream: MediaStream) => void;
  onStats: (stats: { fps: number; bitrateBps: number; resolution: string }) => void;
}

export function useViewerWebRTC({ onStream, onStats }: UseViewerWebRTCOptions) {
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const statsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevBytesRef = useRef(0);
  const [status, setStatus] = useState<ConnectionStatus>('idle');

  const stopStats = useCallback(() => {
    if (statsIntervalRef.current) {
      clearInterval(statsIntervalRef.current);
      statsIntervalRef.current = null;
    }
    prevBytesRef.current = 0;
  }, []);

  const startStats = useCallback((pc: RTCPeerConnection) => {
    stopStats();
    statsIntervalRef.current = setInterval(async () => {
      const stats = await pc.getStats();
      stats.forEach((report) => {
        if (report.type === 'inbound-rtp' && report.kind === 'video') {
          const r = report as RTCInboundRtpStreamStats;
          const bytes = r.bytesReceived ?? 0;
          const fps = Math.round((r.framesPerSecond as number | undefined) ?? 0);
          const bitrateBps = (bytes - prevBytesRef.current) * 8; // per second
          prevBytesRef.current = bytes;

          const w = (r as { frameWidth?: number }).frameWidth ?? 0;
          const h = (r as { frameHeight?: number }).frameHeight ?? 0;
          const resolution = w && h ? `${w}×${h}` : '—';

          onStats({ fps, bitrateBps, resolution });
        }
      });
    }, 1000);
  }, [onStats, stopStats]);

  const createPeerConnection = useCallback(() => {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    pcRef.current = pc;

    pc.ontrack = (event) => {
      onStream(event.streams[0]);
      setStatus('connected');
      startStats(pc);
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      if (state === 'disconnected' || state === 'failed' || state === 'closed') {
        setStatus('disconnected');
        stopStats();
      }
    };

    return pc;
  }, [onStream, startStats, stopStats]);

  const handleOffer = useCallback(
    async (
      sdp: RTCSessionDescriptionInit,
      sendMsg: (msg: object) => void,
    ) => {
      if (pcRef.current) {
        try {
          pcRef.current.close();
        } catch {}
        pcRef.current = null;
      }
      const pc = createPeerConnection();
      setStatus('connecting');

      pc.onicecandidate = (e) => {
        if (e.candidate) {
          sendMsg({ type: 'ice-candidate', candidate: e.candidate });
        }
      };

      await pc.setRemoteDescription(sdp);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      sendMsg({ type: 'answer', sdp: pc.localDescription });
    },
    [createPeerConnection],
  );

  const addIceCandidate = useCallback(async (candidate: RTCIceCandidateInit) => {
    await pcRef.current?.addIceCandidate(candidate);
  }, []);

  const close = useCallback(() => {
    stopStats();
    pcRef.current?.close();
    pcRef.current = null;
    setStatus('idle');
  }, [stopStats]);

  return { status, setStatus, handleOffer, addIceCandidate, close, pcRef };
}

// ── Sender-side WebRTC hook ───────────────────────────────────────────────────

interface UseSenderWebRTCOptions {
  onStatusChange: (status: ConnectionStatus) => void;
}

export function useSenderWebRTC({ onStatusChange }: UseSenderWebRTCOptions) {
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const currentPresetRef = useRef<QualityPresetConfig>(QUALITY_PRESETS.balanced);

  const getCameraStream = useCallback(
    async (
      facingMode: 'environment' | 'user',
      audio: boolean,
      preset: QualityPresetConfig = QUALITY_PRESETS.balanced,
    ): Promise<MediaStream> => {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Camera API not available. Ensure page is loaded over HTTPS.');
      }

      try {
        return await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: facingMode },
            width: { ideal: preset.width },
            height: { ideal: preset.height },
            frameRate: { ideal: preset.fps },
          },
          audio,
        });
      } catch {
        // Fallback for devices with strict constraints
        return await navigator.mediaDevices.getUserMedia({
          video: { facingMode },
          audio,
        });
      }
    },
    [],
  );

  const startStream = useCallback(
    async (
      facingMode: 'environment' | 'user',
      audio: boolean,
      sendMsg: (msg: object) => void,
      preset: QualityPresetConfig = QUALITY_PRESETS.balanced,
    ) => {
      currentPresetRef.current = preset;

      // Reuse existing camera stream if tracks are still active (avoids iOS permission prompt & lag)
      const hasActiveTracks =
        streamRef.current &&
        streamRef.current.getTracks().some((t) => t.readyState === 'live');

      let stream: MediaStream;
      if (hasActiveTracks) {
        stream = streamRef.current!;
      } else {
        stream = await getCameraStream(facingMode, audio, preset);
        streamRef.current = stream;
      }

      // Close previous peer connection if any
      if (pcRef.current) {
        try {
          pcRef.current.close();
        } catch {}
        pcRef.current = null;
      }

      // Create peer connection
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      pcRef.current = pc;

      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      // Force hardware H.264 codec preference on transceivers
      preferH264(pc);

      pc.onicecandidate = (e) => {
        if (e.candidate) {
          sendMsg({ type: 'ice-candidate', candidate: e.candidate });
        }
      };

      pc.onconnectionstatechange = () => {
        const state = pc.connectionState as ConnectionStatus;
        onStatusChange(state);
        if (state === 'connected') {
          forceBitrate(pc, currentPresetRef.current.bitrateBps, currentPresetRef.current.fps);
        }
      };

      // Create offer and prioritize H.264 in SDP (fallback for browsers ignoring setCodecPreferences)
      const offer = await pc.createOffer();
      const prioritizedSdp = prioritizeH264InSdp(offer.sdp ?? '');
      await pc.setLocalDescription({ type: offer.type, sdp: prioritizedSdp });
      sendMsg({ type: 'offer', sdp: pc.localDescription });

      return stream;
    },
    [getCameraStream, onStatusChange],
  );

  const handleAnswer = useCallback(async (sdp: RTCSessionDescriptionInit) => {
    await pcRef.current?.setRemoteDescription(sdp);
  }, []);

  const addIceCandidate = useCallback(async (candidate: RTCIceCandidateInit) => {
    await pcRef.current?.addIceCandidate(candidate);
  }, []);

  const flipCamera = useCallback(
    async (facingMode: 'environment' | 'user', audio: boolean) => {
      if (!pcRef.current || !streamRef.current) return null;

      const preset = currentPresetRef.current;
      streamRef.current.getTracks().forEach((t) => t.stop());

      const newStream = await getCameraStream(facingMode, audio, preset);
      streamRef.current = newStream;

      const videoTrack = newStream.getVideoTracks()[0];
      const sender = pcRef.current.getSenders().find((s) => s.track?.kind === 'video');
      if (sender && videoTrack) {
        await sender.replaceTrack(videoTrack);
        await forceBitrate(pcRef.current, preset.bitrateBps, preset.fps);
      }

      return newStream;
    },
    [getCameraStream],
  );

  const changePreset = useCallback(
    async (
      newPreset: QualityPresetConfig,
      facingMode: 'environment' | 'user',
      audio: boolean,
    ) => {
      currentPresetRef.current = newPreset;
      if (!pcRef.current || !streamRef.current) return null;

      // Stop old tracks and request camera with new constraints
      streamRef.current.getTracks().forEach((t) => t.stop());

      const newStream = await getCameraStream(facingMode, audio, newPreset);
      streamRef.current = newStream;

      const videoTrack = newStream.getVideoTracks()[0];
      const sender = pcRef.current.getSenders().find((s) => s.track?.kind === 'video');
      if (sender && videoTrack) {
        await sender.replaceTrack(videoTrack);
        await forceBitrate(pcRef.current, newPreset.bitrateBps, newPreset.fps);
      }

      return newStream;
    },
    [getCameraStream],
  );

  const close = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    pcRef.current?.close();
    streamRef.current = null;
    pcRef.current = null;
  }, []);

  return { startStream, handleAnswer, addIceCandidate, flipCamera, changePreset, close, streamRef };
}

/** Configures RTCRtpTransceiver codec preferences to prioritize hardware H.264. */
function preferH264(pc: RTCPeerConnection) {
  if (typeof RTCRtpSender !== 'undefined' && 'getCapabilities' in RTCRtpSender) {
    const capabilities = RTCRtpSender.getCapabilities('video');
    if (capabilities?.codecs) {
      const h264 = capabilities.codecs.filter(
        (c) => c.mimeType.toLowerCase() === 'video/h264',
      );
      const others = capabilities.codecs.filter(
        (c) => c.mimeType.toLowerCase() !== 'video/h264',
      );
      const sorted = [...h264, ...others];

      for (const t of pc.getTransceivers()) {
        if (t.sender.track?.kind === 'video' && 'setCodecPreferences' in t) {
          try {
            t.setCodecPreferences(sorted);
          } catch {
            // Browser might reject specific codec list — ignore
          }
        }
      }
    }
  }
}

/**
 * Reorders SDP m=video payload types so H.264 payloads appear first.
 * Guarantees hardware H.264 negotiation on older Android devices where setCodecPreferences is ignored.
 */
function prioritizeH264InSdp(sdp: string): string {
  if (!sdp.includes('H264')) return sdp;

  const lines = sdp.split('\r\n');
  const mVideoIndex = lines.findIndex((l) => l.startsWith('m=video'));
  if (mVideoIndex === -1) return sdp;

  // Find all H.264 payload type IDs (e.g. a=rtpmap:96 H264/90000)
  const h264Payloads: string[] = [];
  for (const line of lines) {
    const match = line.match(/^a=rtpmap:(\d+)\s+H264\/90000/i);
    if (match) {
      h264Payloads.push(match[1]);
    }
  }

  if (h264Payloads.length === 0) return sdp;

  const mParts = lines[mVideoIndex].split(' ');
  const header = mParts.slice(0, 3);
  const existingPayloads = mParts.slice(3);

  const reordered = [
    ...h264Payloads,
    ...existingPayloads.filter((p) => !h264Payloads.includes(p)),
  ];

  lines[mVideoIndex] = [...header, ...reordered].join(' ');
  return lines.join('\r\n');
}

/** Sets the maximum encoding bitrate and framerate on the video sender. */
async function forceBitrate(pc: RTCPeerConnection, maxBitrateBps: number, maxFps: number) {
  const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
  if (!sender) return;

  const params = sender.getParameters();
  if (!params.encodings || params.encodings.length === 0) {
    params.encodings = [{}];
  }
  params.encodings[0].maxBitrate = maxBitrateBps;
  params.encodings[0].maxFramerate = maxFps;

  try {
    await sender.setParameters(params);
  } catch {
    // Some mobile browsers don't support setParameters — non-fatal
  }
}

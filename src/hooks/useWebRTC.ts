import { useCallback, useEffect, useRef, useState } from 'react';
import type { ConnectionStatus, SignalingMessage } from '@/types';

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

const MAX_VIDEO_BITRATE_BPS = 50_000_000; // 50 Mbps
const MAX_FRAMERATE = 60;

interface UseSignalingOptions {
  wsUrl: string;
  onMessage: (msg: SignalingMessage) => void;
  onOpen?: () => void;
  onClose?: () => void;
}

/**
 * Manages the WebSocket connection to the signaling server.
 * Handles reconnection with exponential back-off.
 */
export function useSignaling({ wsUrl, onMessage, onOpen, onClose }: UseSignalingOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryCount = useRef(0);

  const onMessageRef = useRef(onMessage);
  const onOpenRef = useRef(onOpen);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onMessageRef.current = onMessage;
    onOpenRef.current = onOpen;
    onCloseRef.current = onClose;
  }, [onMessage, onOpen, onClose]);

  const send = useCallback((msg: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  const connect = useCallback(() => {
    if (!wsUrl) return;

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        retryCount.current = 0;
        onOpenRef.current?.();
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string) as SignalingMessage;
          onMessageRef.current?.(msg);
        } catch {
          // ignore malformed messages
        }
      };

      ws.onclose = () => {
        onCloseRef.current?.();
        // Exponential back-off: 1s, 2s, 4s … max 16s
        const delay = Math.min(1000 * Math.pow(2, retryCount.current), 16_000);
        retryCount.current++;
        reconnectTimer.current = setTimeout(connect, delay);
      };

      ws.onerror = () => {
        ws.close();
      };
    } catch {
      // ignore connection initial error
    }
  }, [wsUrl]);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

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
  }, [onStream]);

  const startStats = (pc: RTCPeerConnection) => {
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
  };

  const stopStats = () => {
    if (statsIntervalRef.current) {
      clearInterval(statsIntervalRef.current);
      statsIntervalRef.current = null;
    }
    prevBytesRef.current = 0;
  };

  const handleOffer = useCallback(
    async (
      sdp: RTCSessionDescriptionInit,
      sendMsg: (msg: object) => void,
    ) => {
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
  }, []);

  return { status, setStatus, handleOffer, addIceCandidate, close, pcRef };
}

// ── Sender-side WebRTC hook ───────────────────────────────────────────────────

interface UseSenderWebRTCOptions {
  onStatusChange: (status: ConnectionStatus) => void;
}

export function useSenderWebRTC({ onStatusChange }: UseSenderWebRTCOptions) {
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const getCameraStream = useCallback(
    async (facingMode: 'environment' | 'user', audio: boolean): Promise<MediaStream> => {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Camera API not available. Ensure page is loaded over HTTPS.');
      }

      try {
        return await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: facingMode },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            frameRate: { ideal: 60 },
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
    ) => {
      // Get camera
      const stream = await getCameraStream(facingMode, audio);
      streamRef.current = stream;

      // Create peer connection
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      pcRef.current = pc;

      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      pc.onicecandidate = (e) => {
        if (e.candidate) {
          sendMsg({ type: 'ice-candidate', candidate: e.candidate });
        }
      };

      pc.onconnectionstatechange = () => {
        const state = pc.connectionState as ConnectionStatus;
        onStatusChange(state);
        if (state === 'connected') {
          forceBitrate(pc);
        }
      };

      // Create and send offer
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
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

      // Stop old tracks
      streamRef.current.getTracks().forEach((t) => t.stop());

      // Get new stream
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 60 } },
        audio,
      });
      streamRef.current = newStream;

      // Replace video track in peer connection
      const videoTrack = newStream.getVideoTracks()[0];
      const sender = pcRef.current.getSenders().find((s) => s.track?.kind === 'video');
      if (sender && videoTrack) {
        await sender.replaceTrack(videoTrack);
      }

      return newStream;
    },
    [],
  );

  const close = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    pcRef.current?.close();
    streamRef.current = null;
    pcRef.current = null;
  }, []);

  return { startStream, handleAnswer, addIceCandidate, flipCamera, close, streamRef };
}

/** Sets the maximum encoding bitrate and framerate on the video sender. */
async function forceBitrate(pc: RTCPeerConnection) {
  const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
  if (!sender) return;

  const params = sender.getParameters();
  if (!params.encodings || params.encodings.length === 0) {
    params.encodings = [{}];
  }
  params.encodings[0].maxBitrate = MAX_VIDEO_BITRATE_BPS;
  params.encodings[0].maxFramerate = MAX_FRAMERATE;

  try {
    await sender.setParameters(params);
  } catch {
    // Some browsers don't support setParameters — non-fatal
  }
}

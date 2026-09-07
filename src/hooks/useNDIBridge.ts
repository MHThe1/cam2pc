import { useCallback, useRef, useState } from 'react';

const NDI_WS_PATH = '/ndi';
const NDI_FPS = 30;
const NDI_FRAME_MS = 1000 / NDI_FPS;
const NDI_WIDTH = 1920;
const NDI_HEIGHT = 1080;

type NDIStatus = 'off' | 'connecting' | 'active' | 'error';

/**
 * Streams video frames from a <video> element to the local signaling server's
 * NDI bridge WebSocket endpoint. The server forwards RGBA pixel buffers to the
 * grandiose Node.js sidecar which outputs them as an NDI source named "Cam2PC".
 */
export function useNDIBridge() {
  const wsRef = useRef<WebSocket | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const loopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [status, setStatus] = useState<NDIStatus>('off');

  const enable = useCallback((sourceEl: HTMLVideoElement | HTMLCanvasElement, serverBaseUrl: string) => {
    if (wsRef.current) return; // Already active

    // Set up off-screen canvas for frame capture
    const canvas = document.createElement('canvas');
    canvas.width = NDI_WIDTH;
    canvas.height = NDI_HEIGHT;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      setStatus('error');
      return;
    }
    canvasRef.current = canvas;
    ctxRef.current = ctx;

    // Connect to NDI bridge WebSocket
    const wsUrl = serverBaseUrl.replace('https://', 'wss://') + NDI_WS_PATH;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    setStatus('connecting');

    ws.onopen = () => {
      setStatus('active');
      startLoop(sourceEl);
    };

    ws.onerror = () => setStatus('error');
    ws.onclose = () => {
      setStatus('off');
      stopLoop();
    };
  }, []);

  const disable = useCallback(() => {
    stopLoop();
    wsRef.current?.close();
    wsRef.current = null;
    canvasRef.current = null;
    ctxRef.current = null;
    setStatus('off');
  }, []);

  const startLoop = (sourceEl: HTMLVideoElement | HTMLCanvasElement) => {
    const loop = () => {
      const ws = wsRef.current;
      const ctx = ctxRef.current;
      const canvas = canvasRef.current;

      if (!ws || ws.readyState !== WebSocket.OPEN || !ctx || !canvas) return;

      const isReady = sourceEl instanceof HTMLVideoElement
        ? sourceEl.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
        : true;

      if (isReady) {
        ctx.drawImage(sourceEl, 0, 0, NDI_WIDTH, NDI_HEIGHT);
        const imageData = ctx.getImageData(0, 0, NDI_WIDTH, NDI_HEIGHT);
        // Send as binary (RGBA buffer)
        ws.send(imageData.data.buffer);
      }

      loopTimerRef.current = setTimeout(loop, NDI_FRAME_MS);
    };

    loop();
  };

  const stopLoop = () => {
    if (loopTimerRef.current) {
      clearTimeout(loopTimerRef.current);
      loopTimerRef.current = null;
    }
  };

  return { status, enable, disable };
}

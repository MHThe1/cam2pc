import { useCallback, useRef, useState } from 'react';
import type { RecordingState } from '@/types';
import { formatBytes } from '@/lib/utils';

const PREFERRED_MIME_TYPES = [
  'video/mp4;codecs=h264',
  'video/webm;codecs=h264',
  'video/webm;codecs=vp9',
  'video/webm',
];

const TARGET_BITRATE_BPS = 50_000_000; // 50 Mbps request
const CHUNK_INTERVAL_MS = 10_000;      // Save chunk every 10s

function getSupportedMimeType(): string {
  return (
    PREFERRED_MIME_TYPES.find((t) => MediaRecorder.isTypeSupported(t)) ?? 'video/webm'
  );
}

/**
 * Manages in-app recording via the MediaRecorder API.
 * Records the incoming WebRTC stream and downloads as a single file on stop.
 */
export function useRecorder() {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [state, setState] = useState<RecordingState>({
    status: 'idle',
    durationSeconds: 0,
    sizeBytes: 0,
  });

  const start = useCallback((stream: MediaStream) => {
    if (recorderRef.current) return;

    const mimeType = getSupportedMimeType();
    const recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: TARGET_BITRATE_BPS,
    });

    chunksRef.current = [];

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        chunksRef.current.push(e.data);
        const totalSize = chunksRef.current.reduce((acc, b) => acc + b.size, 0);
        setState((prev) => ({ ...prev, sizeBytes: totalSize }));
      }
    };

    recorder.onstop = () => {
      setState((prev) => ({ ...prev, status: 'saving' }));
      downloadRecording(chunksRef.current, mimeType);
      chunksRef.current = [];
      setState({ status: 'idle', durationSeconds: 0, sizeBytes: 0 });
    };

    recorder.start(CHUNK_INTERVAL_MS);
    recorderRef.current = recorder;

    // Duration counter
    const startTime = Date.now();
    timerRef.current = setInterval(() => {
      setState((prev) => ({
        ...prev,
        status: 'recording',
        durationSeconds: Math.floor((Date.now() - startTime) / 1000),
      }));
    }, 1000);

    setState({ status: 'recording', durationSeconds: 0, sizeBytes: 0 });
  }, []);

  const stop = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    recorderRef.current?.stop();
    recorderRef.current = null;
  }, []);

  return { state, start, stop, formattedSize: formatBytes(state.sizeBytes) };
}

function downloadRecording(chunks: Blob[], mimeType: string) {
  const blob = new Blob(chunks, { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
  const timestamp = new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-');
  a.download = `cam2pc-${timestamp}.${ext}`;
  a.href = url;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Utility: merge Tailwind classes safely. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Format bytes to human-readable string (e.g. "1.2 GB"). */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

/** Format seconds to HH:MM:SS. */
export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return [h, m, s].map((v) => String(v).padStart(2, '0')).join(':');
}

/** Format bits per second to Mbps string. */
export function formatBitrate(bps: number): string {
  return `${(bps / 1_000_000).toFixed(1)} Mbps`;
}

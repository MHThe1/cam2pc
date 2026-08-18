import { formatBitrate } from '@/lib/utils';
import type { StreamStats } from '@/types';

interface StatsBarProps {
  stats: StreamStats;
}

/**
 * Compact stats overlay shown at the bottom of the viewer during active stream.
 * Displays resolution, frame rate, and bitrate.
 */
export function StatsBar({ stats }: StatsBarProps) {
  const items = [
    { label: 'RES', value: stats.resolution || '—' },
    { label: 'FPS', value: stats.fps > 0 ? `${stats.fps}` : '—' },
    { label: 'BIT', value: stats.bitrateBps > 0 ? formatBitrate(stats.bitrateBps) : '—' },
  ];

  return (
    <div className="flex items-center gap-4">
      {items.map(({ label, value }) => (
        <div key={label} className="flex items-baseline gap-1.5">
          <span className="text-[10px] font-bold tracking-widest text-white/30 uppercase">
            {label}
          </span>
          <span className="text-xs font-mono text-white/70">{value}</span>
        </div>
      ))}
    </div>
  );
}

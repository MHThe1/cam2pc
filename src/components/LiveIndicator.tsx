import { cn } from '@/lib/utils';

interface LiveIndicatorProps {
  active: boolean;
  label?: string;
  className?: string;
}

/** Pulsing red dot with optional label — shown when stream is live. */
export function LiveIndicator({ active, label = 'LIVE', className }: LiveIndicatorProps) {
  if (!active) return null;

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <span
        className="size-2 rounded-full bg-[var(--color-live)] animate-pulse-ring"
        aria-hidden="true"
      />
      <span className="text-xs font-bold tracking-widest text-[var(--color-live)] uppercase">
        {label}
      </span>
    </div>
  );
}

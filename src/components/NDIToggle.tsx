import { cn } from '@/lib/utils';

type NDIStatus = 'off' | 'connecting' | 'active' | 'error';

interface NDIToggleProps {
  status: NDIStatus;
  available: boolean;
  onEnable: () => void;
  onDisable: () => void;
}

const STATUS_LABELS: Record<NDIStatus, string> = {
  off: 'NDI',
  connecting: 'NDI…',
  active: 'NDI',
  error: 'NDI ERR',
};

/**
 * Toggle button for the NDI output mode.
 * Shows green when active, dims when unavailable, red when error.
 */
export function NDIToggle({ status, available, onEnable, onDisable }: NDIToggleProps) {
  const isActive = status === 'active';
  const isConnecting = status === 'connecting';
  const isError = status === 'error';

  return (
    <button
      id="ndi-toggle"
      onClick={isActive ? onDisable : onEnable}
      disabled={!available || isConnecting}
      aria-pressed={isActive}
      aria-label={isActive ? 'Disable NDI output' : 'Enable NDI output'}
      title={
        !available
          ? 'NDI Tools not installed. See docs/ndi-setup.md'
          : isActive
            ? 'Click to disable NDI output'
            : 'Click to enable NDI output for OBS'
      }
      className={cn(
        'flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider',
        'border transition-all duration-200',
        isActive && 'bg-[var(--color-ok-dim)] border-[var(--color-ok)] text-[var(--color-ok)]',
        isConnecting && 'opacity-60 cursor-wait glass border-white/10 text-white/50',
        isError && 'bg-[var(--color-live-dim)] border-[var(--color-live)] text-[var(--color-live)]',
        !isActive && !isConnecting && !isError && 'glass border-white/10 text-white/40 hover:text-white/70 hover:border-white/20',
        !available && 'cursor-not-allowed',
      )}
    >
      {/* Status dot */}
      <span
        className={cn(
          'size-1.5 rounded-full',
          isActive && 'bg-[var(--color-ok)]',
          isConnecting && 'bg-white/40 animate-pulse',
          isError && 'bg-[var(--color-live)]',
          !isActive && !isConnecting && !isError && 'bg-white/20',
        )}
        aria-hidden="true"
      />
      {STATUS_LABELS[status]}
    </button>
  );
}

import { cn } from '@/lib/utils';
import { formatDuration } from '@/lib/utils';
import type { RecordingState } from '@/types';

interface RecordButtonProps {
  state: RecordingState;
  onStart: () => void;
  onStop: () => void;
  disabled?: boolean;
  formattedSize: string;
}

/**
 * Record / Stop button with live duration and file size counter.
 * Shows a pulsing red ring while recording.
 */
export function RecordButton({
  state,
  onStart,
  onStop,
  disabled,
  formattedSize,
}: RecordButtonProps) {
  const isRecording = state.status === 'recording';
  const isSaving = state.status === 'saving';

  return (
    <button
      id="record-button"
      onClick={isRecording ? onStop : onStart}
      disabled={disabled || isSaving}
      aria-label={isRecording ? 'Stop recording' : 'Start recording'}
      className={cn(
        'flex items-center gap-2.5 px-4 py-2 rounded-full text-sm font-semibold',
        'transition-all duration-200 select-none',
        'border',
        isRecording
          ? 'bg-[var(--color-live-dim)] border-[var(--color-live)] text-[var(--color-live)]'
          : 'glass border-white/10 text-white/70 hover:text-white hover:border-white/20',
        (disabled || isSaving) && 'opacity-40 cursor-not-allowed',
      )}
    >
      {/* Dot indicator */}
      <span
        className={cn(
          'size-2.5 rounded-full flex-shrink-0',
          isRecording
            ? 'bg-[var(--color-live)] animate-pulse'
            : 'bg-white/30',
        )}
        aria-hidden="true"
      />

      {isSaving ? (
        <span>Saving…</span>
      ) : isRecording ? (
        <span className="flex items-center gap-2">
          <span className="font-mono">{formatDuration(state.durationSeconds)}</span>
          {state.sizeBytes > 0 && (
            <span className="text-[var(--color-live)]/60 text-xs">{formattedSize}</span>
          )}
        </span>
      ) : (
        <span>Record</span>
      )}
    </button>
  );
}

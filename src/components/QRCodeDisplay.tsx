interface QRCodeDisplayProps {
  dataUrl: string;
  senderUrl: string;
}

/**
 * Renders the QR code PNG (base64 data URL from server) and the raw URL below.
 * Designed for the viewer's waiting/idle state.
 */
export function QRCodeDisplay({ dataUrl, senderUrl }: QRCodeDisplayProps) {
  return (
    <div className="flex flex-col items-center gap-4 animate-fade-in">
      <div className="glass glass-accent p-4 rounded-2xl">
        {dataUrl ? (
          <img
            src={dataUrl}
            alt="Scan to connect your phone camera"
            className="w-48 h-48 rounded-lg"
            style={{ imageRendering: 'pixelated' }}
          />
        ) : (
          <div className="w-48 h-48 rounded-lg bg-[var(--color-surface-2)] flex items-center justify-center">
            <span className="text-white/30 text-sm">Generating QR…</span>
          </div>
        )}
      </div>

      <div className="text-center">
        <p className="text-white/50 text-xs mb-1 uppercase tracking-wider">
          Scan with your phone camera
        </p>
        <p className="text-white/30 text-[10px] font-mono break-all max-w-xs">{senderUrl}</p>
      </div>
    </div>
  );
}

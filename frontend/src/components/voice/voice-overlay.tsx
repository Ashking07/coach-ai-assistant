export function VoiceOverlay({ transcript, ready, processing = false }: { transcript: string; ready: boolean; processing?: boolean }) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.65)',
        backdropFilter: 'blur(8px)',
        zIndex: 70,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 24,
        padding: 24,
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          width: 96,
          height: 96,
          borderRadius: 48,
          background: ready ? '#C2410C' : '#374151',
          animation: 'voicePulse 1.4s ease-in-out infinite',
        }}
      />
      <style>{`
        @keyframes voicePulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.15); opacity: 0.7; }
        }
      `}</style>
      <div
        style={{
          color: '#F7F3EC',
          fontFamily: 'Geist Mono, monospace',
          fontSize: 12,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
        }}
      >
        {processing ? 'Processing…' : ready ? 'Listening — release when done' : 'Connecting…'}
      </div>
      <div
        style={{
          color: '#F7F3EC',
          fontFamily: 'Inter Tight, sans-serif',
          fontSize: 18,
          maxWidth: 560,
          textAlign: 'center',
          minHeight: 24,
        }}
      >
        {transcript || ' '}
      </div>
    </div>
  );
}

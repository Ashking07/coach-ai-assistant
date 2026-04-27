import { X, Loader, MicOff } from 'lucide-react';

export function RecapRecorderOverlay({
  state,
  transcript,
  error,
  onStop,
  onClose,
}: {
  state: 'idle' | 'recording' | 'processing' | 'done' | 'error';
  transcript: string;
  error: string | null;
  onStop: () => void;
  onClose: () => void;
}) {
  if (state === 'idle') return null;

  const isRecording = state === 'recording';
  const isProcessing = state === 'processing';
  const isDone = state === 'done';
  const isError = state === 'error';

  return (
    <div
      className="fixed inset-0 flex items-center justify-center p-4 md:p-8"
      style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)', zIndex: 60 }}
      onClick={isError || isDone ? onClose : undefined}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative flex flex-col w-full rounded-3xl overflow-hidden"
        style={{
          background: '#0E0F0C',
          border: '1px solid #2A2B27',
          maxWidth: 420,
          maxHeight: 'min(600px, 92dvh)',
          boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
        }}
      >
        {/* Header */}
        <div
          className="sticky top-0 flex items-center justify-between px-5 py-4"
          style={{ background: 'rgba(14,15,12,0.92)', backdropFilter: 'blur(20px)', borderBottom: '1px solid #2A2B27' }}
        >
          <span style={{ fontFamily: 'Geist Mono, monospace', fontSize: 11, letterSpacing: '0.1em', color: '#A8A49B', textTransform: 'uppercase' }}>
            Session recap
          </span>
          {!isProcessing && (
            <button onClick={onClose} className="p-2 -mr-2 rounded-full" style={{ color: '#A8A49B', background: 'none', border: 'none', cursor: 'pointer' }}>
              <X size={18} />
            </button>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 md:px-6 py-6 flex flex-col gap-4">
          {isProcessing && (
            <div className="flex flex-col items-center gap-4 py-12">
              <Loader size={32} style={{ color: '#F7F3EC', animation: 'spin 1s linear infinite' }} />
              <div style={{ color: '#A8A49B', fontSize: 14 }}>Processing your recap…</div>
            </div>
          )}

          {isDone && (
            <div className="flex flex-col items-center gap-4 py-8">
              <div
                className="w-12 h-12 rounded-full flex items-center justify-center"
                style={{ background: '#4CAF50' }}
              >
                <span style={{ color: '#F7F3EC', fontSize: 24 }}>✓</span>
              </div>
              <div style={{ color: '#F7F3EC', fontSize: 16, fontWeight: 500 }}>Recap submitted!</div>
              <div style={{ color: '#A8A49B', fontSize: 14, textAlign: 'center' }}>
                You'll see it in your approval queue shortly.
              </div>
            </div>
          )}

          {isError && (
            <div className="flex flex-col items-center gap-4 py-8">
              <div
                className="w-12 h-12 rounded-full flex items-center justify-center"
                style={{ background: 'rgba(244, 67, 54, 0.1)', border: '1px solid rgba(244, 67, 54, 0.3)' }}
              >
                <span style={{ color: '#F44336', fontSize: 24 }}>!</span>
              </div>
              <div style={{ color: '#F7F3EC', fontSize: 16, fontWeight: 500 }}>Something went wrong</div>
              <div style={{ color: '#A8A49B', fontSize: 14, textAlign: 'center' }}>
                {error || 'Failed to submit recap'}
              </div>
            </div>
          )}

          {(isRecording || (isProcessing && transcript)) && (
            <div
              className="rounded-2xl px-4 py-4"
              style={{ background: 'rgba(247,243,236,0.04)', border: '1px solid #2A2B27', color: '#F7F3EC', fontSize: 14, lineHeight: 1.55, minHeight: 80 }}
            >
              {transcript || 'Listening…'}
            </div>
          )}

          {isRecording && (
            <button
              onClick={onStop}
              className="flex items-center justify-center gap-2 w-full rounded-2xl py-3"
              style={{ background: 'rgba(244,67,54,0.12)', border: '1px solid rgba(244,67,54,0.3)', color: '#F44336', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}
            >
              <MicOff size={16} />
              Stop &amp; Submit
            </button>
          )}
        </div>
      </div>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

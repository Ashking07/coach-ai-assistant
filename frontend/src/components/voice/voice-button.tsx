import { Mic } from 'lucide-react';
import { useRef } from 'react';
import { useVoiceSession } from '../../lib/voice/use-voice-session';
import { VoiceOverlay } from './voice-overlay';
import { VoiceConfirmationCard } from './voice-confirmation-card';

export function VoiceButton() {
  const v = useVoiceSession();
  const btnRef = useRef<HTMLButtonElement>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    // Capture pointer so onPointerLeave doesn't fire while holding
    (e.currentTarget as HTMLButtonElement).setPointerCapture(e.pointerId);
    v.startHold();
  };

  const onPointerUp = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLButtonElement).releasePointerCapture(e.pointerId);
    v.stopHold();
  };

  const onPointerCancel = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLButtonElement).releasePointerCapture(e.pointerId);
    v.stopHold();
  };

  return (
    <>
      <button
        ref={btnRef}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        aria-label="Hold to talk"
        style={{
          width: 44,
          height: 44,
          borderRadius: 22,
          background: v.isHolding ? '#C2410C' : '#1f2937',
          color: '#F7F3EC',
          border: 'none',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'background 120ms ease',
          touchAction: 'none',
          userSelect: 'none',
        }}
      >
        <Mic size={20} />
      </button>
      {(v.isHolding || v.isProcessing) && (
        <VoiceOverlay transcript={v.transcript} ready={v.isReady} processing={v.isProcessing} />
      )}
      {v.proposal && <VoiceConfirmationCard stored={v.proposal} onClose={v.clearProposal} />}
      {v.error && !v.proposal && (
        <div
          role="alert"
          onClick={v.clearError}
          style={{
            position: 'fixed',
            top: 16,
            right: 16,
            background: '#7f1d1d',
            color: 'white',
            padding: '12px 16px',
            borderRadius: 8,
            zIndex: 80,
            maxWidth: 320,
            cursor: 'pointer',
            fontSize: 14,
          }}
        >
          {v.error}
        </div>
      )}
    </>
  );
}

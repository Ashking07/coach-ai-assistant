import { Mic } from 'lucide-react';
import { useVoiceSession } from '../../lib/voice/use-voice-session';
import { VoiceOverlay } from './voice-overlay';
import { VoiceConfirmationCard } from './voice-confirmation-card';

export function VoiceButton() {
  const v = useVoiceSession();

  const onPointerDown = () => {
    void v.startHold();
  };
  const onPointerUp = () => {
    v.stopHold();
  };

  return (
    <>
      <button
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={onPointerUp}
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
        }}
      >
        <Mic size={20} />
      </button>
      {v.isHolding && <VoiceOverlay transcript={v.transcript} ready={v.isReady} />}
      {v.proposal && <VoiceConfirmationCard stored={v.proposal} onClose={v.clearProposal} />}
      {v.error && (
        <div
          style={{
            position: 'fixed',
            top: 16,
            right: 16,
            background: '#7f1d1d',
            color: 'white',
            padding: 12,
            borderRadius: 8,
            zIndex: 80,
          }}
        >
          {v.error}
        </div>
      )}
    </>
  );
}

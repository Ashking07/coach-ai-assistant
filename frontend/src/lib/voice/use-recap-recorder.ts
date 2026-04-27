import { useCallback, useRef, useState } from 'react';
import { api } from '../api';

export type RecapState = 'idle' | 'recording' | 'processing' | 'done' | 'error';

export interface UseRecapRecorderResult {
  state: RecapState;
  transcript: string;
  error: string | null;
  startRecording: () => void;
  stopRecording: () => void;
}

export function useRecapRecorder(sessionId: string): UseRecapRecorderResult {
  const [state, setState] = useState<RecapState>('idle');
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<any>(null);
  const finalTranscriptRef = useRef('');
  const interimTranscriptRef = useRef('');

  const startRecording = useCallback(() => {
    setError(null);
    setTranscript('');
    finalTranscriptRef.current = '';
    interimTranscriptRef.current = '';
    setState('recording');

    const SpeechRecognition = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
    if (!SpeechRecognition) {
      setError('Speech Recognition not supported in this browser');
      setState('error');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (event: any) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const chunk = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscriptRef.current += chunk + ' ';
        } else {
          interim += chunk;
        }
      }
      interimTranscriptRef.current = interim;
      setTranscript(finalTranscriptRef.current + interim);
    };

    recognition.onerror = (event: any) => {
      if (event.error === 'aborted') return; // fired by stop() — onend handles the rest
      setError(`Speech recognition error: ${event.error}`);
      setState('error');
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    recognition.start();
  }, []);

  const stopRecording = useCallback(() => {
    const recognition = recognitionRef.current;
    if (!recognition) return;

    recognition.onend = async () => {
      recognitionRef.current = null;
      const text = (finalTranscriptRef.current || interimTranscriptRef.current).trim();
      if (!text) {
        setError('No speech detected');
        setState('error');
        return;
      }
      setTranscript(text);
      setState('processing');
      try {
        await api.recapSession(sessionId, text);
        setState('done');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to submit recap');
        setState('error');
      }
    };

    recognition.stop();
  }, [sessionId]);

  return {
    state,
    transcript,
    error,
    startRecording,
    stopRecording,
  };
}

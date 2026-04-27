/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { StoredVoiceProposal } from '../api';

const apiUrl = (import.meta.env.VITE_API_URL as string) ?? 'http://localhost:3002';
const token = (import.meta.env.VITE_DASHBOARD_TOKEN as string) ?? '';

type ServerEvent =
  | { type: 'ready' }
  | { type: 'transcript'; text: string }
  | { type: 'proposal'; id: string; expiresAt: string; proposal: StoredVoiceProposal['proposal'] }
  | { type: 'processing' }
  | { type: 'try_again'; message: string }
  | { type: 'error'; message: string };

export interface VoiceSession {
  isHolding: boolean;
  isReady: boolean;
  isProcessing: boolean;
  transcript: string;
  proposal: StoredVoiceProposal | null;
  error: string | null;
  startHold: () => void;
  stopHold: () => void;
  clearProposal: () => void;
  clearError: () => void;
}

function wsUrl(): string {
  const u = new URL(apiUrl);
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  u.pathname = '/ws/coach-voice';
  u.searchParams.set('token', token);
  return u.toString();
}

function getSpeechRecognition(): any {
  return (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition ?? null;
}

export function useVoiceSession(): VoiceSession {
  const [isHolding, setIsHolding] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [proposal, setProposal] = useState<StoredVoiceProposal | null>(null);
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const recognitionRef = useRef<any>(null);
  const finalTranscriptRef = useRef('');
  const interimTranscriptRef = useRef('');
  // Prevents double-call from onPointerLeave + onPointerUp both firing
  const holdingRef = useRef(false);
  // Prevents the 10-second timeout from closing a WS that teardown already nulled
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const teardown = useCallback(() => {
    holdingRef.current = false;
    if (closeTimerRef.current) { clearTimeout(closeTimerRef.current); closeTimerRef.current = null; }
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    wsRef.current?.close();
    wsRef.current = null;
    finalTranscriptRef.current = '';
    interimTranscriptRef.current = '';
    setIsHolding(false);
    setIsReady(false);
    setIsProcessing(false);
  }, []);

  const sendTranscript = useCallback(() => {
    // Use final transcript, fall back to interim if browser didn't finalize in time
    const text = (finalTranscriptRef.current || interimTranscriptRef.current).trim();
    if (!text) {
      setError('No speech detected. Try holding longer and speaking clearly.');
      wsRef.current?.close();
      wsRef.current = null;
      return;
    }

    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      // WS might still be connecting — wait briefly then retry once
      if (ws && ws.readyState === WebSocket.CONNECTING) {
        const onOpen = () => {
          ws.removeEventListener('open', onOpen);
          ws.send(JSON.stringify({ type: 'transcript', text }));
          setTranscript(text);
          scheduleClose();
        };
        ws.addEventListener('open', onOpen);
        setIsProcessing(true);
        return;
      }
      setError('Connection lost. Try again.');
      return;
    }

    ws.send(JSON.stringify({ type: 'transcript', text }));
    setTranscript(text);
    setIsProcessing(true);
    scheduleClose();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scheduleClose = useCallback(() => {
    closeTimerRef.current = setTimeout(() => {
      wsRef.current?.close();
      wsRef.current = null;
      closeTimerRef.current = null;
    }, 15000);
  }, []);

  const startHold = useCallback(() => {
    if (holdingRef.current) return; // already holding

    setError(null);
    setTranscript('');
    setProposal(null);
    finalTranscriptRef.current = '';
    interimTranscriptRef.current = '';

    const SR = getSpeechRecognition();
    if (!SR) {
      setError('Voice recognition not supported. Please use Chrome or Edge.');
      return;
    }

    holdingRef.current = true;
    setIsHolding(true);

    // Open WS
    const ws = new WebSocket(wsUrl());
    wsRef.current = ws;

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as ServerEvent;
        if (msg.type === 'ready') {
          setIsReady(true);
        } else if (msg.type === 'proposal') {
          setProposal({ id: msg.id, expiresAt: msg.expiresAt, proposal: msg.proposal });
          teardown();
        } else if (msg.type === 'try_again') {
          setError(msg.message);
          teardown();
        } else if (msg.type === 'error') {
          setError(msg.message);
          teardown();
        }
        // 'processing' and 'transcript' (server echo) are silently ignored
      } catch {
        // ignore parse errors
      }
    };
    ws.onerror = () => {
      if (holdingRef.current || wsRef.current) {
        setError('Voice connection error. Check that the backend is running.');
      }
      teardown();
    };
    ws.onclose = () => {
      setIsHolding(false);
      setIsReady(false);
    };
    ws.onopen = () => setIsReady(true);

    // Start speech recognition
    let recognition: any;
    try {
      recognition = new SR();
    } catch {
      setError('Could not start speech recognition. Try Chrome.');
      teardown();
      return;
    }

    recognitionRef.current = recognition;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (e: any) => {
      let interim = '';
      let final = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) final += r[0].transcript;
        else interim += r[0].transcript;
      }
      if (final) finalTranscriptRef.current += final;
      interimTranscriptRef.current = interim;
      setTranscript(finalTranscriptRef.current + interim);
    };

    recognition.onerror = (e: any) => {
      if (e.error === 'not-allowed') {
        setError('Microphone access denied. Allow mic permission and try again.');
        teardown();
      } else if (e.error === 'no-speech') {
        // Ignored — user just hasn't spoken yet
      } else if (e.error !== 'aborted') {
        setError(`Speech error: ${e.error}`);
        teardown();
      }
    };

    // onend fires after stop() and after all onresult events — safe point to send transcript
    recognition.onend = () => {
      if (recognitionRef.current === recognition) {
        recognitionRef.current = null;
      }
    };

    try {
      recognition.start();
    } catch {
      setError('Could not access microphone. Check browser permissions.');
      teardown();
    }
  }, [teardown]);

  const stopHold = useCallback(() => {
    if (!holdingRef.current) return; // already stopped — prevents double-call
    holdingRef.current = false;
    setIsHolding(false);

    const rec = recognitionRef.current;
    if (rec) {
      recognitionRef.current = null;
      // Wait for browser to finalize speech results before sending
      rec.onend = () => sendTranscript();
      rec.stop();
    } else {
      sendTranscript();
    }
  }, [sendTranscript]);

  const clearProposal = useCallback(() => { setProposal(null); setTranscript(''); }, []);
  const clearError = useCallback(() => setError(null), []);

  useEffect(() => () => teardown(), [teardown]);

  return { isHolding, isReady, isProcessing, transcript, proposal, error, startHold, stopHold, clearProposal, clearError };
}

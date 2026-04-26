import { useCallback, useEffect, useRef, useState } from 'react';
import { createAudioCapture, type AudioCapture } from './audio-capture';
import type { StoredVoiceProposal } from '../api';

const apiUrl = (import.meta.env.VITE_API_URL as string) ?? 'http://localhost:3002';
const token = (import.meta.env.VITE_DASHBOARD_TOKEN as string) ?? '';

type ServerEvent =
  | { type: 'ready' }
  | { type: 'transcript'; text: string }
  | { type: 'proposal'; id: string; expiresAt: string; proposal: StoredVoiceProposal['proposal'] }
  | { type: 'try_again'; message: string }
  | { type: 'error'; message: string };

export interface VoiceSession {
  isHolding: boolean;
  isReady: boolean;
  transcript: string;
  proposal: StoredVoiceProposal | null;
  error: string | null;
  startHold: () => Promise<void>;
  stopHold: () => void;
  clearProposal: () => void;
}

function wsUrl(): string {
  const u = new URL(apiUrl);
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  u.pathname = '/ws/coach-voice';
  u.searchParams.set('token', token);
  return u.toString();
}

export function useVoiceSession(): VoiceSession {
  const [isHolding, setIsHolding] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [proposal, setProposal] = useState<StoredVoiceProposal | null>(null);
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const captureRef = useRef<AudioCapture | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const teardown = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    captureRef.current?.stop();
    captureRef.current = null;
    wsRef.current?.close();
    wsRef.current = null;
    setIsHolding(false);
    setIsReady(false);
  }, []);

  const startHold = useCallback(async () => {
    setError(null);
    setTranscript('');
    setProposal(null);

    const ws = new WebSocket(wsUrl());
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as ServerEvent;
        if (msg.type === 'ready') setIsReady(true);
        else if (msg.type === 'transcript') setTranscript((t) => t + msg.text);
        else if (msg.type === 'proposal') {
          if (closeTimerRef.current) {
            clearTimeout(closeTimerRef.current);
            closeTimerRef.current = null;
          }
          setProposal({ id: msg.id, expiresAt: msg.expiresAt, proposal: msg.proposal });
          teardown();
        } else if (msg.type === 'try_again') {
          setError(msg.message);
          teardown();
        } else if (msg.type === 'error') setError(msg.message);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'parse error');
      }
    };
    ws.onerror = () => setError('voice connection error');
    ws.onclose = () => {
      setIsHolding(false);
      setIsReady(false);
    };

    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      const timeout = setTimeout(() => reject(new Error('ws open timeout')), 5000);
      ws.addEventListener('open', () => clearTimeout(timeout));
    });

    const capture = createAudioCapture();
    await capture.start((buf) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(buf);
    });
    captureRef.current = capture;
    setIsHolding(true);
  }, [teardown]);

  const stopHold = useCallback(() => {
    captureRef.current?.stop();
    captureRef.current = null;
    setIsHolding(false);

    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
    }

    closeTimerRef.current = setTimeout(() => {
      wsRef.current?.close();
      closeTimerRef.current = null;
    }, 1500);
  }, []);
  const clearProposal = useCallback(() => setProposal(null), []);

  useEffect(() => () => teardown(), [teardown]);

  return { isHolding, isReady, transcript, proposal, error, startHold, stopHold, clearProposal };
}

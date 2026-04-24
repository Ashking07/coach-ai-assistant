import { useEffect, useRef, useState } from 'react';

export type SocketStatus = 'connecting' | 'open' | 'closed' | 'error';

export function useReconnectingWebSocket(
  url: string | null,
  onMessage?: (raw: string) => void,
) {
  const [status, setStatus] = useState<SocketStatus>('closed');
  const [messages, setMessages] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const retryCountRef = useRef(0);
  const socketRef = useRef<WebSocket | null>(null);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  useEffect(() => {
    if (!url) {
      setStatus('closed');
      return;
    }

    let cancelled = false;
    let retryTimer: number | null = null;

    const connect = () => {
      if (cancelled) return;

      setStatus('connecting');
      setError(null);

      const socket = new WebSocket(url);
      socketRef.current = socket;

      socket.onopen = () => {
        retryCountRef.current = 0;
        setStatus('open');
        setError(null);
      };

      socket.onmessage = (event) => {
        const payload = typeof event.data === 'string' ? event.data : '';
        setMessages((prev) => [payload, ...prev].slice(0, 50));
        onMessageRef.current?.(payload);
      };

      socket.onerror = () => {
        setStatus('error');
        setError('WebSocket error');
      };

      socket.onclose = () => {
        if (cancelled) return;
        setStatus('closed');
        retryCountRef.current += 1;
        const retryMs = Math.min(1000 * retryCountRef.current, 5000);
        retryTimer = window.setTimeout(connect, retryMs);
      };
    };

    connect();

    return () => {
      cancelled = true;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      socketRef.current?.close();
    };
  }, [url]);

  const send = (text: string) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(text);
    }
  };

  return { status, messages, error, send };
}

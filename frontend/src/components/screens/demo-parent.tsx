import { useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useReconnectingWebSocket } from '../../lib/use-reconnecting-websocket';

function wsBaseFromApi(apiBase: string): string {
  if (apiBase.startsWith('https://')) return apiBase.replace(/^https:/, 'wss:');
  if (apiBase.startsWith('http://')) return apiBase.replace(/^http:/, 'ws:');
  return apiBase;
}

type ChatMessage = { dir: 'sent' | 'received'; text: string; at: string };

function parseRawMessage(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as { content?: string };
    return parsed.content ?? raw;
  } catch {
    return raw;
  }
}

export function DemoParentScreen() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const providedWsUrl = searchParams.get('wsUrl');
  const [input, setInput] = useState('');
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  const wsUrl = useMemo(() => {
    if (providedWsUrl) return providedWsUrl;
    if (!token) return null;
    const apiBase = (import.meta.env.VITE_API_URL as string) ?? 'http://localhost:3002';
    return `${wsBaseFromApi(apiBase)}/ws/demo-parent?token=${encodeURIComponent(token)}`;
  }, [providedWsUrl, token]);

  const { status, error, send } = useReconnectingWebSocket(wsUrl, (raw) => {
    setChat((prev) => [
      ...prev,
      { dir: 'received', text: parseRawMessage(raw), at: new Date().toLocaleTimeString() },
    ]);
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
  });

  const handleSend = () => {
    const text = input.trim();
    if (!text || status !== 'open') return;
    send(text);
    setChat((prev) => [...prev, { dir: 'sent', text, at: new Date().toLocaleTimeString() }]);
    setInput('');
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
  };

  const statusColor: Record<string, string> = {
    open: '#4ade80',
    connecting: '#facc15',
    error: '#f87171',
    closed: '#9ca3af',
  };

  return (
    <div
      style={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        background: '#0d1117',
        color: '#e6edf3',
        fontFamily: 'Inter Tight, system-ui, sans-serif',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '16px 20px',
          borderBottom: '1px solid #21262d',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <span style={{ fontSize: 20 }}>💬</span>
        <div>
          <div style={{ fontWeight: 600, fontSize: 15 }}>Coach Demo Chat</div>
          <div style={{ fontSize: 12, color: statusColor[status] ?? '#9ca3af' }}>
            {status}
          </div>
        </div>
      </div>

      {!token && !providedWsUrl && (
        <div style={{ padding: 20, color: '#ffb86c' }}>
          Missing token. Open this page via a demo link from the coach dashboard.
        </div>
      )}
      {error && <div style={{ padding: '8px 20px', color: '#f87171', fontSize: 13 }}>{error}</div>}

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {chat.length === 0 && status === 'open' && (
          <div style={{ color: '#8b949e', fontSize: 14, textAlign: 'center', marginTop: 40 }}>
            Type a message below to start the demo.
          </div>
        )}
        {chat.map((m, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              justifyContent: m.dir === 'sent' ? 'flex-end' : 'flex-start',
            }}
          >
            <div
              style={{
                maxWidth: '78%',
                padding: '10px 14px',
                borderRadius: m.dir === 'sent' ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
                background: m.dir === 'sent' ? '#1f6feb' : '#161b22',
                border: m.dir === 'received' ? '1px solid #30363d' : 'none',
                fontSize: 14,
                lineHeight: 1.45,
              }}
            >
              <div>{m.text}</div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)', marginTop: 4, textAlign: 'right' }}>
                {m.at}
              </div>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div
        style={{
          padding: '12px 16px',
          borderTop: '1px solid #21262d',
          display: 'flex',
          gap: 10,
          background: '#0d1117',
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
          placeholder={status === 'open' ? 'Type a message…' : 'Waiting for connection…'}
          disabled={status !== 'open'}
          style={{
            flex: 1,
            background: '#161b22',
            border: '1px solid #30363d',
            borderRadius: 12,
            padding: '10px 14px',
            color: '#e6edf3',
            fontSize: 14,
            outline: 'none',
          }}
        />
        <button
          onClick={handleSend}
          disabled={status !== 'open' || !input.trim()}
          style={{
            background: status === 'open' && input.trim() ? '#1f6feb' : '#21262d',
            color: '#fff',
            border: 'none',
            borderRadius: 12,
            padding: '10px 18px',
            fontSize: 14,
            fontWeight: 600,
            cursor: status === 'open' && input.trim() ? 'pointer' : 'not-allowed',
            transition: 'background 0.15s',
          }}
        >
          Send
        </button>
      </div>
    </div>
  );
}

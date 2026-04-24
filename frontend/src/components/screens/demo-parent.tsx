import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useReconnectingWebSocket } from '../../lib/use-reconnecting-websocket';

function wsBaseFromApi(apiBase: string): string {
  if (apiBase.startsWith('https://')) {
    return apiBase.replace(/^https:/, 'wss:');
  }
  if (apiBase.startsWith('http://')) {
    return apiBase.replace(/^http:/, 'ws:');
  }
  return apiBase;
}

export function DemoParentScreen() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const providedWsUrl = searchParams.get('wsUrl');

  const wsUrl = useMemo(() => {
    if (providedWsUrl) {
      return providedWsUrl;
    }

    if (!token) {
      return null;
    }

    const apiBase =
      (import.meta.env.VITE_API_URL as string) ?? 'http://localhost:3002';
    return `${wsBaseFromApi(apiBase)}/ws/demo-parent?token=${encodeURIComponent(token)}`;
  }, [providedWsUrl, token]);

  const { status, messages, error } = useReconnectingWebSocket(wsUrl);

  return (
    <div
      style={{
        minHeight: '100dvh',
        padding: '24px',
        background: '#0d1117',
        color: '#e6edf3',
        fontFamily: 'Inter Tight, system-ui, sans-serif',
      }}
    >
      <h1 style={{ fontSize: 24, margin: '0 0 8px' }}>Coach Demo Chat</h1>
      <p style={{ margin: '0 0 16px', color: '#9da7b3' }}>
        Connection status: <strong>{status}</strong>
      </p>

      {!token && !providedWsUrl ? (
        <p style={{ color: '#ffb86c' }}>
          Missing token. Open this page using a demo link generated from the dashboard.
        </p>
      ) : null}

      {error ? <p style={{ color: '#ff6b6b' }}>{error}</p> : null}

      <section
        style={{
          border: '1px solid #30363d',
          borderRadius: 12,
          padding: 16,
          background: '#161b22',
        }}
      >
        <h2 style={{ marginTop: 0, fontSize: 16 }}>Incoming messages</h2>
        {messages.length === 0 ? (
          <p style={{ color: '#8b949e', marginBottom: 0 }}>No messages yet.</p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 16 }}>
            {messages.map((message, index) => (
              <li key={`${index}-${message}`} style={{ marginBottom: 8 }}>
                {message}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

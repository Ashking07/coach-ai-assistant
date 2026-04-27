import { useState, useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';

const apiUrl = (import.meta.env.VITE_API_URL as string) ?? 'http://localhost:3002';

type Parent = { id: string; name: string; kids: string[] };
type Claimed = { token: string; expiresAt: string; wsUrl: string };

function chatUrl(token: string): string {
  return `${window.location.origin}/demo/parent?token=${encodeURIComponent(token)}`;
}

function msLeft(expiresAt: string): number {
  return Math.max(0, new Date(expiresAt).getTime() - Date.now());
}

function formatMsLeft(ms: number): string {
  const min = Math.floor(ms / 60_000);
  const sec = Math.floor((ms % 60_000) / 1000);
  return `${min}:${sec.toString().padStart(2, '0')}`;
}

export function DemoPickerScreen() {
  const [parents, setParents] = useState<Parent[]>([]);
  const [availability, setAvailability] = useState<Record<string, number>>({});
  const [claimed, setClaimed] = useState<Record<string, Claimed>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  // Tick every second for countdown timers
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // Load parents once
  useEffect(() => {
    fetch(`${apiUrl}/api/demo/parents`)
      .then((r) => r.json())
      .then((data) => setParents(data as Parent[]))
      .catch(() => setError('Could not load parents — is DEMO_PARENT_CHAT_ENABLED set?'));
  }, []);

  // Poll availability every 8s
  useEffect(() => {
    function poll() {
      fetch(`${apiUrl}/api/demo/availability`)
        .then((r) => r.json())
        .then((data) => setAvailability(data as Record<string, number>))
        .catch(() => {});
    }
    poll();
    const t = setInterval(poll, 8_000);
    return () => clearInterval(t);
  }, []);

  async function claim(parentId: string) {
    setLoading((l) => ({ ...l, [parentId]: true }));
    try {
      const res = await fetch(`${apiUrl}/api/demo/claim/${parentId}`, { method: 'POST' });
      if (res.status === 409) {
        // Someone just grabbed it — refresh availability
        const avail = await fetch(`${apiUrl}/api/demo/availability`).then((r) => r.json());
        setAvailability(avail as Record<string, number>);
        return;
      }
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as Claimed;
      setClaimed((c) => ({ ...c, [parentId]: data }));
      setAvailability((a) => ({ ...a, [parentId]: new Date(data.expiresAt).getTime() }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to claim');
    } finally {
      setLoading((l) => ({ ...l, [parentId]: false }));
    }
  }

  const now = Date.now();

  return (
    <div
      style={{
        minHeight: '100dvh',
        background: '#0E0F0C',
        color: '#F7F3EC',
        fontFamily: 'Inter Tight, system-ui, sans-serif',
        padding: '32px 20px 48px',
      }}
    >
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        {/* Header */}
        <div style={{ marginBottom: 32 }}>
          <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontWeight: 500, fontSize: 30, margin: 0, lineHeight: 1.2 }}>
            Pick your parent.
          </h1>
          <p style={{ color: '#A8A49B', fontSize: 14, marginTop: 8 }}>
            Claim a parent, scan the QR with your phone, then start texting the coach.
          </p>
        </div>

        {error && (
          <div style={{ padding: '12px 16px', borderRadius: 12, background: 'rgba(244,67,54,0.1)', border: '1px solid rgba(244,67,54,0.3)', color: '#F44336', fontSize: 14, marginBottom: 24 }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {parents.length === 0 && !error && (
            <div style={{ color: '#A8A49B', fontSize: 14 }}>Loading…</div>
          )}
          {parents.map((p) => {
            const expMs = availability[p.id] ?? 0;
            const takenByOther = expMs > now && !claimed[p.id];
            const myClaim = claimed[p.id];
            const myMs = myClaim ? msLeft(myClaim.expiresAt) : 0;
            const expired = myClaim && myMs === 0;
            void tick; // read tick to trigger re-render for countdown

            return (
              <div
                key={p.id}
                style={{
                  borderRadius: 20,
                  border: `1px solid ${myClaim && !expired ? '#E26A2C55' : '#2A2B27'}`,
                  background: myClaim && !expired ? 'rgba(226,106,44,0.06)' : 'rgba(23,24,20,0.5)',
                  padding: '20px 20px',
                  transition: 'border-color 0.2s',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                  <div>
                    <div style={{ fontWeight: 500, fontSize: 16, color: '#F7F3EC' }}>{p.name}</div>
                    <div style={{ color: '#A8A49B', fontSize: 13, marginTop: 2 }}>
                      {p.kids.join(', ')}
                    </div>
                  </div>

                  {/* Status / action */}
                  {takenByOther ? (
                    <span
                      style={{
                        fontFamily: 'Geist Mono, monospace',
                        fontSize: 11,
                        letterSpacing: '0.08em',
                        color: '#A8A49B',
                        background: 'rgba(168,164,155,0.1)',
                        border: '1px solid #2A2B27',
                        borderRadius: 8,
                        padding: '4px 10px',
                        whiteSpace: 'nowrap',
                        flexShrink: 0,
                      }}
                    >
                      IN USE · {formatMsLeft(expMs - now)}
                    </span>
                  ) : myClaim && !expired ? (
                    <span
                      style={{
                        fontFamily: 'Geist Mono, monospace',
                        fontSize: 11,
                        letterSpacing: '0.08em',
                        color: '#E26A2C',
                        background: 'rgba(226,106,44,0.1)',
                        border: '1px solid rgba(226,106,44,0.3)',
                        borderRadius: 8,
                        padding: '4px 10px',
                        whiteSpace: 'nowrap',
                        flexShrink: 0,
                      }}
                    >
                      YOURS · {formatMsLeft(myMs)}
                    </span>
                  ) : (
                    <button
                      onClick={() => void claim(p.id)}
                      disabled={!!loading[p.id]}
                      style={{
                        padding: '8px 18px',
                        borderRadius: 12,
                        border: 'none',
                        background: '#E26A2C',
                        color: '#F7F3EC',
                        fontSize: 14,
                        fontWeight: 500,
                        cursor: loading[p.id] ? 'not-allowed' : 'pointer',
                        opacity: loading[p.id] ? 0.6 : 1,
                        flexShrink: 0,
                      }}
                    >
                      {loading[p.id] ? '…' : 'Claim'}
                    </button>
                  )}
                </div>

                {/* QR shown only to the person who claimed */}
                {myClaim && !expired && (
                  <div style={{ marginTop: 20, display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                    <div style={{ padding: 10, background: '#fff', borderRadius: 12, display: 'inline-flex', flexShrink: 0 }}>
                      <QRCodeSVG value={chatUrl(myClaim.token)} size={130} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, color: '#A8A49B', marginBottom: 8 }}>
                        Scan with your phone to open the chat as {p.name}.
                      </div>
                      <div
                        style={{
                          fontSize: 11,
                          fontFamily: 'Geist Mono, monospace',
                          color: '#A8A49B',
                          wordBreak: 'break-all',
                          background: 'rgba(247,243,236,0.04)',
                          border: '1px solid #2A2B27',
                          borderRadius: 8,
                          padding: '8px 10px',
                        }}
                      >
                        {chatUrl(myClaim.token)}
                      </div>
                    </div>
                  </div>
                )}

                {expired && (
                  <div style={{ marginTop: 12, fontSize: 13, color: '#A8A49B' }}>
                    Session expired. Claim again to get a new QR.
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

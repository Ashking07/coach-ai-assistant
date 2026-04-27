import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { QRCodeSVG } from 'qrcode.react';
import { api, type ParentEntry, type ParentSessionResponse } from '../lib/api';
import { T } from '../tokens';

function demoUrl(token: string): string {
  return `${window.location.origin}/demo/parent?token=${encodeURIComponent(token)}`;
}

function timeLeft(expiresAt: string): string {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return 'expired';
  const min = Math.floor(ms / 60_000);
  return `${min}m left`;
}

export function DemoQRCard() {
  const [selectedParentId, setSelectedParentId] = useState('');
  const [session, setSession] = useState<ParentSessionResponse | null>(null);
  const [copied, setCopied] = useState(false);

  const { data: parents, isLoading: parentsLoading } = useQuery<ParentEntry[]>({
    queryKey: ['parents'],
    queryFn: api.parents,
    staleTime: 60_000,
  });

  const mutation = useMutation({
    mutationFn: () => api.createParentSession(selectedParentId),
    onSuccess: (data) => {
      setSession(data);
      setCopied(false);
    },
  });

  const url = session ? demoUrl(session.token) : '';

  const handleCopy = async () => {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <section
      style={{
        margin: '0 16px 32px',
        padding: '20px',
        borderRadius: 16,
        border: `1px solid ${'var(--hairline)'}`,
        background: 'var(--card)',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <span style={{ fontSize: 20 }}>📱</span>
        <div>
          <div style={{ fontWeight: 600, fontSize: 15, color: 'var(--text)' }}>Live Demo</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 1 }}>
            Give a classmate a QR code to play parent
          </div>
        </div>
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <select
          value={selectedParentId}
          onChange={(e) => { setSelectedParentId(e.target.value); setSession(null); }}
          disabled={parentsLoading}
          style={{
            flex: 1,
            minWidth: 160,
            background: 'var(--bg)',
            border: `1px solid ${'var(--hairline)'}`,
            borderRadius: 10,
            padding: '9px 12px',
            color: 'var(--text)',
            fontSize: 14,
            cursor: 'pointer',
          }}
        >
          <option value="">— pick a parent —</option>
          {parents?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.kids.join(', ')})
            </option>
          ))}
        </select>

        <button
          onClick={() => mutation.mutate()}
          disabled={!selectedParentId || mutation.isPending}
          style={{
            padding: '9px 18px',
            borderRadius: 10,
            border: 'none',
            background: selectedParentId ? T.terracotta : 'var(--hairline)',
            color: '#fff',
            fontWeight: 600,
            fontSize: 14,
            cursor: selectedParentId ? 'pointer' : 'not-allowed',
            whiteSpace: 'nowrap',
          }}
        >
          {mutation.isPending ? 'Generating…' : 'Generate link'}
        </button>
      </div>

      {mutation.isError && (
        <div style={{ marginTop: 10, fontSize: 13, color: T.terracotta }}>
          Failed to generate session — is DEMO_PARENT_CHAT_ENABLED set on the server?
        </div>
      )}

      {/* QR + link */}
      {session && url && (
        <div style={{ marginTop: 20, display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div
            style={{
              padding: 12,
              background: '#fff',
              borderRadius: 12,
              display: 'inline-flex',
              flexShrink: 0,
            }}
          >
            <QRCodeSVG value={url} size={140} />
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>
              Scan to open parent chat · {timeLeft(session.expiresAt)}
            </div>

            <div
              style={{
                fontSize: 12,
                color: 'var(--muted)',
                wordBreak: 'break-all',
                fontFamily: 'Geist Mono, monospace',
                background: 'var(--bg)',
                border: `1px solid ${'var(--hairline)'}`,
                borderRadius: 8,
                padding: '8px 10px',
                marginBottom: 10,
              }}
            >
              {url}
            </div>

            <button
              onClick={() => void handleCopy()}
              style={{
                padding: '7px 14px',
                borderRadius: 8,
                border: `1px solid ${'var(--hairline)'}`,
                background: 'none',
                color: copied ? '#4ade80' : 'var(--muted)',
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              {copied ? '✓ Copied' : 'Copy link'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import { api } from '../../lib/api';
import { T } from '../../tokens';
import { KidAvatar } from '../avatar';

export function ParentsScreen() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['parents'],
    queryFn: api.parents,
  });

  const [search, setSearch] = useState('');

  const filtered = (data ?? []).filter(
    (p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.kids.some((k) => k.toLowerCase().includes(search.toLowerCase())),
  );

  const kidCount = (data ?? []).reduce((sum, p) => sum + p.kids.length, 0);

  return (
    <div className="pb-24 md:pb-10">
      <div className="px-4 pt-8 pb-4 md:px-8 md:pt-10">
        <h1 style={{ fontFamily: 'Fraunces, serif', fontWeight: 500, fontSize: 28, color: 'var(--text)', margin: 0 }}>
          Parents &amp; kids.
        </h1>
        <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 4 }}>
          {data ? `${data.length} families · ${kidCount} kids` : '—'}
        </div>
      </div>

      <div className="px-4 md:px-8 mb-4">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search parent or kid…"
          className="w-full px-4 py-2.5 rounded-xl outline-none"
          style={{
            background: 'var(--panel)',
            border: '1px solid var(--hairline)',
            color: 'var(--text)',
            fontSize: 14,
          }}
        />
      </div>

      {isLoading && (
        <div className="px-4 md:px-8 flex flex-col gap-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="animate-pulse rounded h-14" style={{ background: 'var(--surface-sub)' }} />
          ))}
        </div>
      )}

      {isError && (
        <div className="px-4 md:px-8">
          <button onClick={() => void refetch()} className="text-sm underline" style={{ color: T.terracotta }}>
            Failed to load — tap to retry
          </button>
        </div>
      )}

      <div className="md:px-8">
        {filtered.map((p) => (
          <div
            key={p.id}
            className="flex items-center gap-3 px-4 md:px-4 py-3.5"
            style={{ borderTop: '1px solid var(--hairline)' }}
          >
            <KidAvatar name={p.name} size={40} />
            <div className="flex-1 min-w-0">
              <div style={{ color: 'var(--text)', fontSize: 15 }}>{p.name}</div>
              <div style={{ color: 'var(--muted)', fontSize: 13 }} className="truncate">
                {p.kids.join(' · ') || '— (no kids)'}
              </div>
            </div>
            <div className="hidden sm:block text-right" style={{ fontFamily: 'Geist Mono, monospace', fontSize: 11, color: 'var(--muted)' }}>
              {p.lastMessage}
            </div>
            <ChevronRight size={16} style={{ color: 'var(--muted)' }} />
          </div>
        ))}
        <div style={{ borderTop: '1px solid var(--hairline)' }} />
      </div>
    </div>
  );
}

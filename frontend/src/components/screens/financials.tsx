import { useQuery } from '@tanstack/react-query';
import { api, type FinancialPayment } from '../../lib/api';
import { T } from '../../tokens';

function cents(n: number) {
  return `$${(n / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function toAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3_600_000);
  if (h < 1) return `${Math.floor(diff / 60_000)}m ago`;
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const METHOD_LABEL: Record<string, string> = {
  CASH: 'Cash',
  VENMO: 'Venmo',
  ZELLE: 'Zelle',
  CHECK: 'Check',
  STRIPE: 'Stripe',
  OTHER: 'Other',
};

function StatTile({
  label,
  amount,
  count,
  color,
  sub,
}: {
  label: string;
  amount: number;
  count: number;
  color: string;
  sub?: string;
}) {
  return (
    <div
      className="flex-1 rounded-2xl p-5 flex flex-col gap-1 min-w-0"
      style={{ background: 'var(--panel)', border: `1px solid var(--hairline)`, borderTop: `3px solid ${color}` }}
    >
      <div style={{ fontFamily: 'Geist Mono, monospace', fontSize: 10, letterSpacing: '0.1em', color: 'var(--muted)', textTransform: 'uppercase' }}>
        {label}
      </div>
      <div style={{ fontSize: 28, fontWeight: 600, color, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em' }}>
        {cents(amount)}
      </div>
      <div style={{ fontSize: 12, color: 'var(--muted)' }}>
        {count} session{count !== 1 ? 's' : ''}{sub ? ` · ${sub}` : ''}
      </div>
    </div>
  );
}

function PaymentRow({ p }: { p: FinancialPayment }) {
  const sessionDate = new Date(p.sessionAt).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  });
  return (
    <div
      className="flex items-center justify-between gap-4 px-5 py-4"
      style={{ borderBottom: '1px solid var(--hairline)' }}
    >
      <div className="flex flex-col gap-0.5 min-w-0">
        <div style={{ color: 'var(--text)', fontSize: 14, fontWeight: 500 }}>
          {p.kidName}
          <span style={{ color: 'var(--muted)', fontWeight: 400 }}> · {p.parentName.split(' ')[0]}</span>
        </div>
        <div style={{ fontFamily: 'Geist Mono, monospace', fontSize: 11, color: 'var(--muted)' }}>
          {sessionDate} · {METHOD_LABEL[p.method ?? ''] ?? p.method ?? '—'}
        </div>
      </div>
      <div className="flex flex-col items-end gap-0.5 shrink-0">
        <div style={{ fontSize: 15, fontWeight: 600, color: T.moss, fontVariantNumeric: 'tabular-nums' }}>
          {cents(p.amountCents)}
        </div>
        <div style={{ fontFamily: 'Geist Mono, monospace', fontSize: 11, color: 'var(--muted)' }}>
          {toAgo(p.paidAt)}
        </div>
      </div>
    </div>
  );
}

export function FinancialsScreen() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['financials'],
    queryFn: api.financials,
    refetchInterval: 60_000,
  });

  const monthLabel = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  return (
    <div className="pb-24 md:pb-10">
      <div className="px-4 pt-8 pb-4 md:px-8 md:pt-10">
        <h1 style={{ fontFamily: 'Fraunces, serif', fontWeight: 500, fontSize: 28, color: 'var(--text)', margin: 0 }}>
          Financials.
        </h1>
        <div style={{ fontFamily: 'Geist Mono, monospace', fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>
          Revenue collected and outstanding balances.
        </div>
      </div>

      {isLoading && (
        <div className="px-4 md:px-8 flex flex-col md:flex-row gap-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="rounded-2xl h-28 animate-pulse" style={{ background: 'var(--panel)' }} />
          ))}
        </div>
      )}

      {isError && (
        <div className="px-4 md:px-8">
          <button onClick={() => void refetch()} style={{ color: T.terracotta, fontSize: 14 }}>
            Failed to load — tap to retry
          </button>
        </div>
      )}

      {data && (
        <>
          {/* Stat tiles */}
          <div className="px-4 md:px-8 flex flex-col md:flex-row gap-3">
            <StatTile
              label={monthLabel}
              amount={data.thisMonth.amountCents}
              count={data.thisMonth.count}
              color={T.moss}
            />
            <StatTile
              label="This week"
              amount={data.thisWeek.amountCents}
              count={data.thisWeek.count}
              color={T.sunrise}
            />
            <StatTile
              label="Outstanding"
              amount={data.outstanding.amountCents}
              count={data.outstanding.count}
              color={T.terracotta}
              sub="unpaid"
            />
          </div>

          {/* Recent payments */}
          <div className="px-4 md:px-8 mt-8 mb-2">
            <div style={{ fontFamily: 'Geist Mono, monospace', fontSize: 10, letterSpacing: '0.1em', color: 'var(--muted)', textTransform: 'uppercase' }}>
              Recent payments
            </div>
          </div>

          {data.recentPayments.length === 0 ? (
            <div className="px-4 md:px-8 mt-4" style={{ color: 'var(--muted)', fontSize: 14 }}>
              No payments recorded yet.
            </div>
          ) : (
            <div
              className="mx-4 md:mx-8 rounded-2xl overflow-hidden"
              style={{ border: '1px solid var(--hairline)', background: 'var(--panel)' }}
            >
              {data.recentPayments.map((p) => (
                <PaymentRow key={p.id} p={p} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

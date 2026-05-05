import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { api, type SettingsResponse, type KidOption } from '../../lib/api';
import { T } from '../../tokens';

export function SettingsScreen() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['settings'],
    queryFn: api.settings,
  });

  const { data: kids = [] } = useQuery({
    queryKey: ['kids'],
    queryFn: api.getKids,
    enabled: Boolean(data),
  });

  const [rateInput, setRateInput] = useState('');
  const [rateError, setRateError] = useState<string | null>(null);
  const [kidRates, setKidRates] = useState<Record<string, string>>({});
  const [kidRateBusy, setKidRateBusy] = useState<Record<string, boolean>>({});
  useEffect(() => {
    if (data) {
      setRateInput((data.defaultRateCents / 100).toFixed(2));
    }
  }, [data]);
  useEffect(() => {
    if (!kids.length) return;
    const next: Record<string, string> = {};
    kids.forEach((k) => {
      next[k.id] = k.rateCentsOverride != null ? (k.rateCentsOverride / 100).toFixed(2) : '';
    });
    setKidRates(next);
  }, [kids]);

  const mutation = useMutation({
    mutationFn: (payload: { autonomyEnabled?: boolean; defaultRateCents?: number }) => api.updateSettings(payload),
    onMutate: async (payload) => {
      await queryClient.cancelQueries({ queryKey: ['settings'] });
      const prev = queryClient.getQueryData<SettingsResponse>(['settings']);
      queryClient.setQueryData<SettingsResponse>(['settings'], (old) =>
        old ? { ...old, ...payload } : old,
      );
      return { prev };
    },
    onError: (_err, _val, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(['settings'], ctx.prev);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['settings'] }),
  });

  const killSwitchMutation = useMutation({
    mutationFn: (paused: boolean) => (paused ? api.pauseAgent() : api.resumeAgent()),
    onMutate: async (paused) => {
      await queryClient.cancelQueries({ queryKey: ['settings'] });
      const prev = queryClient.getQueryData<SettingsResponse>(['settings']);
      queryClient.setQueryData<SettingsResponse>(['settings'], (old) =>
        old ? { ...old, agentPaused: paused } : old,
      );
      return { prev };
    },
    onError: (_err, _val, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(['settings'], ctx.prev);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['settings'] }),
  });

  const stripeRefreshMutation = useMutation({
    mutationFn: api.refreshStripe,
    onSuccess: (updated) => {
      queryClient.setQueryData(['settings'], updated);
    },
  });

  // Auto-sync Stripe status when returning from Connect onboarding
  const stripeRefreshRan = useRef(false);
  useEffect(() => {
    if (stripeRefreshRan.current) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('stripe_return') === '1') {
      stripeRefreshRan.current = true;
      stripeRefreshMutation.mutate();
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const autonomy = data?.autonomyEnabled ?? true;

  const profileRows = data
    ? [
        ['Coach profile', data.name],
        ['Phone', data.phone],
        ['Timezone', data.timezone],
        ['Stripe account', data.stripeAccountId ?? '—'],
      ]
    : [];

  return (
    <div className="pb-24 md:pb-10">
      <div className="px-4 pt-8 pb-4 md:px-8 md:pt-10">
        <h1 style={{ fontFamily: 'Fraunces, serif', fontWeight: 500, fontSize: 28, color: 'var(--text)', margin: 0 }}>
          Settings.
        </h1>
      </div>

      {isLoading && (
        <div className="px-4 md:px-8">
          <div className="animate-pulse rounded-2xl h-32" style={{ background: 'var(--surface-sub)' }} />
        </div>
      )}

      {isError && (
        <div className="px-4 md:px-8">
          <button onClick={() => void refetch()} className="text-sm underline" style={{ color: T.terracotta }}>
            Failed to load — tap to retry
          </button>
        </div>
      )}

      {data && (
        <div className="px-4 md:px-8">
          {/* Autonomy toggle */}
          <div
            className="rounded-2xl p-5"
            style={{ background: 'var(--panel)', border: '1px solid var(--hairline)' }}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <div style={{ color: 'var(--text)', fontSize: 17 }}>Agent autonomy</div>
                <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 6, maxWidth: 420 }}>
                  When on, routine messages are auto-answered within your policy. When off, every
                  message becomes an approval — nothing goes out without your tap.
                </div>
              </div>
              <button
                onClick={() => mutation.mutate({ autonomyEnabled: !autonomy })}
                disabled={mutation.isPending}
                className="shrink-0 rounded-full transition-colors"
                style={{
                  width: 52,
                  height: 30,
                  background: autonomy ? T.sunrise : 'var(--surface-sub)',
                  border: '1px solid var(--hairline)',
                  position: 'relative',
                  cursor: 'pointer',
                  opacity: mutation.isPending ? 0.6 : 1,
                }}
              >
                <span
                  style={{
                    position: 'absolute',
                    top: 3,
                    left: autonomy ? 24 : 3,
                    width: 22,
                    height: 22,
                    borderRadius: '50%',
                    background: '#F7F3EC',
                    transition: 'left 0.2s',
                  }}
                />
              </button>
            </div>
            <div
              style={{
                marginTop: 14,
                fontFamily: 'Geist Mono, monospace',
                fontSize: 11,
                color: autonomy ? T.moss : T.terracotta,
                letterSpacing: '0.08em',
              }}
            >
              STATUS · {autonomy ? 'ON · AGENT ACTIVE' : 'OFF · EVERYTHING QUEUED'}
            </div>
          </div>

          {/* Kill switch toggle */}
          <div
            className="rounded-2xl p-5 mt-6"
            style={{ background: 'var(--panel)', border: '1px solid var(--hairline)' }}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <div style={{ color: 'var(--text)', fontSize: 17 }}>Kill switch</div>
                <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 6, maxWidth: 420 }}>
                  Pause all agent processing instantly. Incoming messages are still logged but nothing is
                  classified or sent until you re-enable. Use during travel or off-hours.
                </div>
              </div>
              <button
                onClick={() => killSwitchMutation.mutate(!(data?.agentPaused ?? false))}
                disabled={killSwitchMutation.isPending}
                className="shrink-0 rounded-full transition-colors"
                style={{
                  width: 52,
                  height: 30,
                  background: (data?.agentPaused ?? false) ? T.terracotta : T.moss,
                  border: '1px solid var(--hairline)',
                  position: 'relative',
                  cursor: 'pointer',
                  opacity: killSwitchMutation.isPending ? 0.6 : 1,
                }}
              >
                <span
                  style={{
                    position: 'absolute',
                    top: 3,
                    left: (data?.agentPaused ?? false) ? 24 : 3,
                    width: 22,
                    height: 22,
                    borderRadius: '50%',
                    background: '#F7F3EC',
                    transition: 'left 0.2s',
                  }}
                />
              </button>
            </div>
            <div
              style={{
                marginTop: 14,
                fontFamily: 'Geist Mono, monospace',
                fontSize: 11,
                color: (data?.agentPaused ?? false) ? T.terracotta : T.moss,
                letterSpacing: '0.08em',
              }}
            >
              STATUS · {(data?.agentPaused ?? false) ? 'PAUSED · AGENT STOPPED' : 'ACTIVE · AGENT RUNNING'}
            </div>
          </div>

          {/* Payments */}
          <div
            className="rounded-2xl p-5 mt-6"
            style={{ background: 'var(--panel)', border: '1px solid var(--hairline)' }}
          >
            <div style={{ color: 'var(--text)', fontSize: 17 }}>Payments</div>
            <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 6, maxWidth: 420 }}>
              Set your default rate. Per-kid overrides can be added later.
            </div>
            <div className="flex items-center gap-3 mt-4">
              <div
                className="flex items-center gap-2 px-3 py-2 rounded-xl"
                style={{ background: 'var(--surface-sub)', border: '1px solid var(--hairline)' }}
              >
                <span style={{ color: 'var(--muted)' }}>$</span>
                <input
                  value={rateInput}
                  onChange={(e) => setRateInput(e.target.value)}
                  className="bg-transparent outline-none"
                  style={{ color: 'var(--text)', width: 88 }}
                  inputMode="decimal"
                />
              </div>
              <button
                onClick={() => {
                  const value = Number(rateInput);
                  const cents = Math.round(value * 100);
                  if (!Number.isFinite(cents)) {
                    setRateError('Enter a valid number.');
                    return;
                  }
                  if (cents < 0 || cents > 100000) {
                    setRateError('Rate must be between $0 and $1000.');
                    return;
                  }
                  setRateError(null);
                  mutation.mutate({ defaultRateCents: cents });
                }}
                className="px-4 py-2 rounded-xl"
                style={{ background: T.sunrise, color: '#F7F3EC', border: 'none', cursor: 'pointer' }}
              >
                Save rate
              </button>
            </div>
            {rateError && (
              <div
                className="rounded-xl px-3 py-2 mt-3"
                style={{ background: 'rgba(244,67,54,0.12)', border: '1px solid rgba(244,67,54,0.3)', color: '#F44336', fontSize: 13 }}
              >
                {rateError}
              </div>
            )}
            <div className="flex items-center gap-3 mt-3 flex-wrap">
              <div
                style={{
                  fontFamily: 'Geist Mono, monospace',
                  fontSize: 11,
                  color: data?.stripeOnboardingDone ? T.moss : 'var(--muted)',
                  letterSpacing: '0.08em',
                }}
              >
                STRIPE · {data?.stripeOnboardingDone ? 'CONNECTED' : 'NOT CONNECTED'}
              </div>
              <button
                onClick={async () => {
                  try {
                    const { url } = await api.startStripeOnboarding();
                    window.location.href = url;
                  } catch {
                    // intentionally empty — network errors surface in Stripe redirect
                  }
                }}
                className="px-3 py-1.5 rounded-xl"
                style={{
                  background: T.sunrise + '18',
                  border: `1px solid ${T.sunrise}55`,
                  color: T.sunrise,
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                {data?.stripeOnboardingDone ? 'Reconnect Stripe' : 'Connect Stripe'}
              </button>
              <button
                onClick={() => stripeRefreshMutation.mutate()}
                disabled={stripeRefreshMutation.isPending}
                className="px-3 py-1.5 rounded-xl"
                style={{
                  background: 'transparent',
                  border: '1px solid var(--hairline)',
                  color: 'var(--muted)',
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                {stripeRefreshMutation.isPending ? 'Syncing…' : 'Sync status'}
              </button>
            </div>
          </div>

          {/* Per-kid rates */}
          {kids.length > 0 && (
            <div
              className="rounded-2xl p-5 mt-6"
              style={{ background: 'var(--panel)', border: '1px solid var(--hairline)' }}
            >
              <div style={{ color: 'var(--text)', fontSize: 17 }}>Per-kid rates</div>
              <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 6, maxWidth: 420 }}>
                Optional overrides per kid. Leave blank to use the default rate.
              </div>
              <div
                className="mt-4 flex flex-col gap-3"
                style={{ maxHeight: 220, overflowY: 'auto', paddingRight: 4 }}
              >
                {kids.map((kid: KidOption) => (
                  <div
                    key={kid.id}
                    className="flex items-center justify-between gap-3"
                    style={{ borderTop: '1px solid var(--hairline)', paddingTop: 12 }}
                  >
                    <div>
                      <div style={{ color: 'var(--text)', fontSize: 14 }}>{kid.name}</div>
                      <div style={{ color: 'var(--muted)', fontSize: 12 }}>{kid.parentName}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div
                        className="flex items-center gap-2 px-3 py-2 rounded-xl"
                        style={{ background: 'var(--surface-sub)', border: '1px solid var(--hairline)' }}
                      >
                        <span style={{ color: 'var(--muted)' }}>$</span>
                        <input
                          value={kidRates[kid.id] ?? ''}
                          onChange={(e) =>
                            setKidRates((prev) => ({ ...prev, [kid.id]: e.target.value }))
                          }
                          className="bg-transparent outline-none"
                          style={{ color: 'var(--text)', width: 72 }}
                          inputMode="decimal"
                          placeholder="—"
                        />
                      </div>
                      <button
                        onClick={async () => {
                          const raw = kidRates[kid.id] ?? '';
                          const next = raw.trim() === '' ? null : Math.round(Number(raw) * 100);
                          if (next !== null && (!Number.isFinite(next) || next < 0 || next > 100000)) {
                            return;
                          }
                          setKidRateBusy((prev) => ({ ...prev, [kid.id]: true }));
                          try {
                            await api.updateKidRate(kid.id, next);
                            void queryClient.invalidateQueries({ queryKey: ['kids'] });
                          } finally {
                            setKidRateBusy((prev) => ({ ...prev, [kid.id]: false }));
                          }
                        }}
                        disabled={kidRateBusy[kid.id]}
                        className="px-3 py-2 rounded-xl"
                        style={{ background: T.sunrise, color: '#F7F3EC', border: 'none', cursor: 'pointer', fontSize: 12 }}
                      >
                        Save
                      </button>
                      <button
                        onClick={async () => {
                          setKidRateBusy((prev) => ({ ...prev, [kid.id]: true }));
                          try {
                            await api.updateKidRate(kid.id, null);
                            setKidRates((prev) => ({ ...prev, [kid.id]: '' }));
                            void queryClient.invalidateQueries({ queryKey: ['kids'] });
                          } finally {
                            setKidRateBusy((prev) => ({ ...prev, [kid.id]: false }));
                          }
                        }}
                        disabled={kidRateBusy[kid.id]}
                        className="px-3 py-2 rounded-xl"
                        style={{ background: 'transparent', color: 'var(--muted)', border: '1px solid var(--hairline)', cursor: 'pointer', fontSize: 12 }}
                      >
                        Reset
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Profile rows */}
          <div className="mt-6 flex flex-col">
            {profileRows.map(([label, value]) => (
              <div
                key={label}
                className="flex items-center justify-between py-3.5"
                style={{ borderTop: '1px solid var(--hairline)' }}
              >
                <span style={{ color: 'var(--text)', fontSize: 14 }}>{label}</span>
                <span style={{ color: 'var(--muted)', fontSize: 13, fontFamily: 'Geist Mono, monospace' }}>
                  {value}
                </span>
              </div>
            ))}
            <div style={{ borderTop: '1px solid var(--hairline)' }} />
          </div>
        </div>
      )}
    </div>
  );
}

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type SettingsResponse } from '../../lib/api';
import { T } from '../../tokens';

export function SettingsScreen() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['settings'],
    queryFn: api.settings,
  });

  const mutation = useMutation({
    mutationFn: (autonomyEnabled: boolean) => api.updateSettings({ autonomyEnabled }),
    onMutate: async (autonomyEnabled) => {
      await queryClient.cancelQueries({ queryKey: ['settings'] });
      const prev = queryClient.getQueryData<SettingsResponse>(['settings']);
      queryClient.setQueryData<SettingsResponse>(['settings'], (old) =>
        old ? { ...old, autonomyEnabled } : old,
      );
      return { prev };
    },
    onError: (_err, _val, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(['settings'], ctx.prev);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['settings'] }),
  });

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
                onClick={() => mutation.mutate(!autonomy)}
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

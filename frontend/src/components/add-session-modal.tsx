import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { api, type KidOption } from '../lib/api';
import { T } from '../tokens';

function formatDateInput(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(date);
}

function formatTimeInput(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function nextRoundHour(date: Date) {
  const d = new Date(date);
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return d;
}

function nowInTimeZone(timeZone: string) {
  const now = new Date();
  const offset = getTimeZoneOffset(timeZone, now);
  return new Date(now.getTime() + offset);
}

function getTimeZoneOffset(timeZone: string, date: Date) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = dtf.formatToParts(date);
  const value = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  const asUtc = Date.UTC(
    Number(value('year')),
    Number(value('month')) - 1,
    Number(value('day')),
    Number(value('hour')),
    Number(value('minute')),
    Number(value('second')),
  );
  return asUtc - date.getTime();
}

function toCoachIso(dateStr: string, timeStr: string, timeZone: string) {
  const [year, month, day] = dateStr.split('-').map((v) => Number(v));
  const [hour, minute] = timeStr.split(':').map((v) => Number(v));
  if (!year || !month || !day || hour == null || minute == null) {
    throw new Error('Invalid date or time');
  }
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  const offset = getTimeZoneOffset(timeZone, utcGuess);
  const utcDate = new Date(utcGuess.getTime() - offset);
  return utcDate.toISOString();
}

function normalizeError(error: unknown) {
  if (error instanceof Error) {
    if (error.message.includes('409')) {
      return 'That slot is taken — choose another time.';
    }
    return error.message;
  }
  return 'Something went wrong — please try again.';
}

export function AddSessionModal({
  open,
  defaultDate,
  coachTimezone,
  weekStartIso,
  onClose,
  onCreated,
}: {
  open: boolean;
  defaultDate: Date;
  coachTimezone?: string;
  weekStartIso: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const queryClient = useQueryClient();
  const tz = coachTimezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';

  const { data: kids = [], isLoading } = useQuery({
    queryKey: ['kids'],
    queryFn: api.getKids,
    enabled: open,
  });

  const defaultDateStr = useMemo(() => formatDateInput(defaultDate, tz), [defaultDate, tz]);
  const defaultTimeStr = useMemo(() => formatTimeInput(nextRoundHour(nowInTimeZone(tz)), tz), [tz]);

  const [kidId, setKidId] = useState('');
  const [dateStr, setDateStr] = useState(defaultDateStr);
  const [timeStr, setTimeStr] = useState(defaultTimeStr);
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [error, setError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: (input: { kidId: string; scheduledAt: string; durationMinutes: number }) =>
      api.createSession(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['week-sessions', weekStartIso] });
      void queryClient.invalidateQueries({ queryKey: ['availability', weekStartIso] });
      void queryClient.invalidateQueries({ queryKey: ['home'] });
      onCreated();
      onClose();
    },
    onError: (err) => setError(normalizeError(err)),
  });

  const durationOptions = useMemo(() => [30, 45, 60, 90], []);
  const effectiveKidId = kidId || kids[0]?.id || '';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!effectiveKidId) {
      setError('Select a kid to schedule.');
      return;
    }
    if (!dateStr || !timeStr) {
      setError('Choose a date and time.');
      return;
    }
    try {
      const scheduledAt = toCoachIso(dateStr, timeStr, tz);
      if (new Date(scheduledAt).getTime() <= Date.now()) {
        setError('Choose a future time.');
        return;
      }
      setError(null);
      createMutation.mutate({ kidId: effectiveKidId, scheduledAt, durationMinutes });
    } catch (err) {
      setError(normalizeError(err));
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 flex items-center justify-center p-4 md:p-8"
      style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)', zIndex: 70 }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative flex flex-col w-full rounded-3xl overflow-hidden"
        style={{
          background: '#0E0F0C',
          border: '1px solid #2A2B27',
          maxWidth: 480,
          boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
        }}
      >
        <div
          className="sticky top-0 flex items-center justify-between px-5 py-4"
          style={{ background: 'rgba(14,15,12,0.92)', backdropFilter: 'blur(20px)', borderBottom: '1px solid #2A2B27' }}
        >
          <span style={{ fontFamily: 'Geist Mono, monospace', fontSize: 11, letterSpacing: '0.1em', color: '#A8A49B', textTransform: 'uppercase' }}>
            Add session
          </span>
          <button onClick={onClose} className="p-2 -mr-2 rounded-full" style={{ color: '#A8A49B', background: 'none', border: 'none', cursor: 'pointer' }}>
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4 px-5 md:px-6 py-6">
          <label className="flex flex-col gap-2">
            <span style={{ fontFamily: 'Geist Mono, monospace', fontSize: 10, letterSpacing: '0.12em', color: '#A8A49B', textTransform: 'uppercase' }}>
              Kid
            </span>
            <select
              value={effectiveKidId}
              onChange={(e) => setKidId(e.target.value)}
              disabled={isLoading}
              className="rounded-xl px-3 py-2"
              style={{ background: '#12130F', border: '1px solid #2A2B27', color: '#F7F3EC' }}
            >
              {kids.length === 0 && <option value="">No kids found</option>}
              {kids.map((kid: KidOption) => (
                <option key={kid.id} value={kid.id}>
                  {kid.name} · {kid.parentName || 'Unknown parent'}
                </option>
              ))}
            </select>
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-2">
              <span style={{ fontFamily: 'Geist Mono, monospace', fontSize: 10, letterSpacing: '0.12em', color: '#A8A49B', textTransform: 'uppercase' }}>
                Date
              </span>
              <input
                type="date"
                value={dateStr}
                onChange={(e) => setDateStr(e.target.value)}
                className="rounded-xl px-3 py-2"
                style={{ background: '#12130F', border: '1px solid #2A2B27', color: '#F7F3EC' }}
              />
            </label>
            <label className="flex flex-col gap-2">
              <span style={{ fontFamily: 'Geist Mono, monospace', fontSize: 10, letterSpacing: '0.12em', color: '#A8A49B', textTransform: 'uppercase' }}>
                Time
              </span>
              <input
                type="time"
                value={timeStr}
                onChange={(e) => setTimeStr(e.target.value)}
                className="rounded-xl px-3 py-2"
                style={{ background: '#12130F', border: '1px solid #2A2B27', color: '#F7F3EC' }}
              />
            </label>
          </div>

          <div className="flex flex-col gap-2">
            <span style={{ fontFamily: 'Geist Mono, monospace', fontSize: 10, letterSpacing: '0.12em', color: '#A8A49B', textTransform: 'uppercase' }}>
              Duration
            </span>
            <div className="flex flex-wrap gap-2">
              {durationOptions.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setDurationMinutes(opt)}
                  className="px-3 py-2 rounded-xl"
                  style={{
                    background: durationMinutes === opt ? T.sunrise + '22' : 'transparent',
                    border: `1px solid ${durationMinutes === opt ? T.sunrise : '#2A2B27'}`,
                    color: durationMinutes === opt ? T.sunrise : '#F7F3EC',
                    fontSize: 13,
                    cursor: 'pointer',
                  }}
                >
                  {opt} min
                </button>
              ))}
            </div>
          </div>

          {error && (
            <div
              className="rounded-xl px-3 py-2"
              style={{ background: 'rgba(244,67,54,0.12)', border: '1px solid rgba(244,67,54,0.3)', color: '#F44336', fontSize: 13 }}
            >
              {error}
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3 rounded-2xl"
              style={{ background: 'transparent', border: '1px solid #2A2B27', color: '#F7F3EC', cursor: 'pointer' }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={createMutation.isPending}
              className="flex-1 py-3 rounded-2xl"
              style={{ background: T.sunrise, border: 'none', color: '#F7F3EC', cursor: 'pointer' }}
            >
              {createMutation.isPending ? 'Adding…' : 'Add session'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

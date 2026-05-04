import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { T } from '../tokens';
import { api, type AvailabilitySlot, type DashboardSession, type WeekSession } from '../lib/api';
import { SessionCard } from './cards';

const stone = '#8A857B';

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const HOUR_START = 7;
const HOUR_END = 21;

type Block = {
  day: number;
  start: number; // minutes from midnight (local time)
  end: number;
  kind: 'booked' | 'available' | 'blocked';
  kid?: string;
  reason?: string;
  dbId?: string; // set for DB-backed available blocks
};

// Static blocked-only blocks (personal calendar events, not sessions)
const staticBlocks: Block[] = [
  { day: 3, start: 18 * 60, end: 20 * 60, kind: 'blocked', reason: 'Family' },
  { day: 6, start: 10 * 60, end: 14 * 60, kind: 'blocked', reason: 'Travel' },
];

function fmtTime(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  const hh = h % 12 || 12;
  const suffix = h < 12 ? 'am' : 'pm';
  return m === 0 ? `${hh}${suffix}` : `${hh}:${m.toString().padStart(2, '0')}${suffix}`;
}

function hoursAvail(items: Block[]) {
  const mins = items.filter((b) => b.kind === 'available').reduce((a, b) => a + (b.end - b.start), 0);
  return mins / 60;
}

function getWeekInfo(offsetWeeks = 0) {
  const now = new Date();
  const dow = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((dow + 6) % 7) + offsetWeeks * 7);
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return { monday, dateRange: `${fmt(monday)} – ${fmt(sunday)}` };
}

function getDayDate(monday: Date, dayIndex: number) {
  const d = new Date(monday);
  d.setDate(monday.getDate() + dayIndex);
  return d.getDate();
}

// Convert a DB WeekSession → Block
function sessionToBlock(session: WeekSession, monday: Date): Block | null {
  const start = new Date(session.scheduledAt);
  const dayClean = new Date(start);
  dayClean.setHours(0, 0, 0, 0);
  const mondayClean = new Date(monday);
  mondayClean.setHours(0, 0, 0, 0);
  const dayIndex = Math.round((dayClean.getTime() - mondayClean.getTime()) / 86400000);
  if (dayIndex < 0 || dayIndex > 6) return null;
  const startMin = start.getHours() * 60 + start.getMinutes();
  return {
    day: dayIndex,
    start: startMin,
    end: startMin + session.durationMinutes,
    kind: 'booked',
    kid: session.kidName,
  };
}

// Convert a DB AvailabilitySlot → Block (day index + minutes from midnight)
function slotToBlock(slot: AvailabilitySlot, monday: Date): Block | null {
  const start = new Date(slot.startAt);
  const end = new Date(slot.endAt);
  const slotDay = new Date(start);
  slotDay.setHours(0, 0, 0, 0);
  const mondayClean = new Date(monday);
  mondayClean.setHours(0, 0, 0, 0);
  const dayIndex = Math.round((slotDay.getTime() - mondayClean.getTime()) / 86400000);
  if (dayIndex < 0 || dayIndex > 6) return null;
  return {
    day: dayIndex,
    start: start.getHours() * 60 + start.getMinutes(),
    end: end.getHours() * 60 + end.getMinutes(),
    kind: slot.isBlocked ? 'blocked' : 'available',
    reason: slot.reason || undefined,
    dbId: slot.id,
  };
}

// Convert a day index + slot-start-minutes → ISO datetime strings for the API (1-hour blocks)
function blockToDateRange(monday: Date, dayIndex: number, slotStart: number) {
  const d = new Date(monday);
  d.setDate(monday.getDate() + dayIndex);
  d.setHours(Math.floor(slotStart / 60), slotStart % 60, 0, 0);
  const startAt = d.toISOString();
  const endDate = new Date(d.getTime() + 60 * 60 * 1000);
  const endAt = endDate.toISOString();
  return { startAt, endAt };
}

export function WeekView({
  today,
  sessions = [],
  onOpenSession,
}: {
  today?: number;
  sessions?: DashboardSession[];
  onOpenSession?: (id: string) => void;
}) {
  const todayIndex = today ?? ((new Date().getDay() + 6) % 7);
  const [openDay, setOpenDay] = useState<number | null>(null);
  const [weekOffset, setWeekOffset] = useState(0);
  const { monday, dateRange } = getWeekInfo(weekOffset);
  const weekStartIso = monday.toISOString();
  const queryClient = useQueryClient();
  const isCurrentWeek = weekOffset === 0;

  const { data: dbSessions = [] } = useQuery({
    queryKey: ['week-sessions', weekStartIso],
    queryFn: () => api.getWeekSessions(weekStartIso),
    staleTime: 10_000,
    refetchInterval: isCurrentWeek ? 30_000 : false,
  });

  const { data: dbSlots = [] } = useQuery({
    queryKey: ['availability', weekStartIso],
    queryFn: () => api.getAvailability(weekStartIso),
    staleTime: 0,
    refetchInterval: isCurrentWeek ? 15_000 : false,
  });

  const availKey = ['availability', weekStartIso];

  const addMutation = useMutation({
    mutationFn: ({ startAt, endAt }: { startAt: string; endAt: string }) =>
      api.addAvailability(startAt, endAt),
    onMutate: async ({ startAt, endAt }) => {
      await queryClient.cancelQueries({ queryKey: availKey });
      const prev = queryClient.getQueryData<AvailabilitySlot[]>(availKey) ?? [];
      const optimistic: AvailabilitySlot = { id: `opt-${Date.now()}`, startAt, endAt, isBlocked: false, reason: '' };
      queryClient.setQueryData(availKey, [...prev, optimistic]);
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(availKey, ctx.prev);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: availKey }),
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => api.removeAvailability(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: availKey });
      const prev = queryClient.getQueryData<AvailabilitySlot[]>(availKey) ?? [];
      queryClient.setQueryData(availKey, prev.filter((s) => s.id !== id));
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(availKey, ctx.prev);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: availKey }),
  });

  const sessionsKey = ['week-sessions', weekStartIso];
  const cancelSessionMutation = useMutation({
    mutationFn: (id: string) => api.cancelSession(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: sessionsKey });
      const prev = queryClient.getQueryData<WeekSession[]>(sessionsKey) ?? [];
      queryClient.setQueryData(sessionsKey, prev.filter((s) => s.id !== id));
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(sessionsKey, ctx.prev);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: sessionsKey });
      queryClient.invalidateQueries({ queryKey: availKey });
      queryClient.invalidateQueries({ queryKey: ['home'] });
    },
  });

  // Merge static blocked + real DB sessions + DB available slots
  const sessionBlocks: Block[] = dbSessions
    .map((s) => sessionToBlock(s, monday))
    .filter((b): b is Block => b !== null);

  // Remove available slots that overlap with any booked session
  const availableBlocks: Block[] = dbSlots
    .map((s) => slotToBlock(s, monday))
    .filter((b): b is Block => b !== null)
    .filter((avail) =>
      !sessionBlocks.some(
        (sess) => sess.day === avail.day && sess.start < avail.end && sess.end > avail.start,
      ),
    );

  const blocks = [...staticBlocks, ...sessionBlocks, ...availableBlocks];

  const toggle = (day: number, slotStart: number) => {
    const existing = availableBlocks.find(
      (b) => b.day === day && b.start <= slotStart && b.end > slotStart,
    );
    if (existing?.dbId) {
      removeMutation.mutate(existing.dbId);
      return;
    }
    // Only add if the full 60-min window is free
    const slotEnd = slotStart + 60;
    const occupied = blocks.find(
      (b) => b.day === day && b.start < slotEnd && b.end > slotStart,
    );
    if (!occupied) {
      const { startAt, endAt } = blockToDateRange(monday, day, slotStart);
      addMutation.mutate({ startAt, endAt });
    }
  };

  return (
    <div className="px-4 md:px-8 mt-6">
      <div className="flex items-end justify-between mb-4">
        <div>
          <h2
            style={{
              fontFamily: 'Fraunces, serif',
              fontWeight: 500,
              fontSize: 22,
              color: 'var(--text)',
              lineHeight: 1.1,
              margin: 0,
            }}
          >
            This week.
          </h2>
          <div style={{ fontFamily: 'Geist Mono, monospace', fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
            {dateRange}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setWeekOffset((o) => o - 1)}
            className="p-2 rounded-lg"
            style={{ color: 'var(--muted)', border: '1px solid var(--hairline)', background: 'none', cursor: 'pointer' }}
          >
            <ChevronLeft size={14} />
          </button>
          <button
            onClick={() => setWeekOffset(0)}
            className="px-3 py-2 rounded-lg"
            style={{
              fontFamily: 'Geist Mono, monospace',
              fontSize: 11,
              color: isCurrentWeek ? T.sunrise : 'var(--muted)',
              border: `1px solid ${isCurrentWeek ? T.sunrise + '55' : 'var(--hairline)'}`,
              letterSpacing: '0.08em',
              background: 'none',
              cursor: 'pointer',
            }}
          >
            TODAY
          </button>
          <button
            onClick={() => setWeekOffset((o) => o + 1)}
            className="p-2 rounded-lg"
            style={{ color: 'var(--muted)', border: '1px solid var(--hairline)', background: 'none', cursor: 'pointer' }}
          >
            <ChevronRight size={14} />
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {DAY_NAMES.map((name, i) => {
          const dayItems = blocks.filter((b) => b.day === i).sort((a, b) => a.start - b.start);
          const bookedBlocks = dayItems.filter((b) => b.kind === 'booked');
          const availH = hoursAvail(dayItems);
          const isToday = i === todayIndex;
          const isWeekend = i >= 5;
          const dateNum = getDayDate(monday, i);

          if (isToday) {
            return (
              <div
                key={i}
                className="rounded-2xl overflow-hidden"
                style={{
                  background: T.sunrise + '10',
                  border: `1px solid ${T.sunrise}55`,
                  borderLeft: `3px solid ${T.sunrise}`,
                }}
              >
                <button
                  onClick={() => setOpenDay(i)}
                  className="w-full flex items-center justify-between px-4 pt-3.5 pb-3 text-left"
                  style={{ borderBottom: '1px solid var(--hairline)', background: 'none', cursor: 'pointer' }}
                >
                  <div className="flex items-baseline gap-3 flex-wrap">
                    <span style={{ fontFamily: 'Geist Mono, monospace', fontSize: 10, letterSpacing: '0.14em', color: T.sunrise }}>
                      TODAY · {DAY_SHORT[i].toUpperCase()} {dateNum}
                    </span>
                    <span style={{ fontFamily: 'Fraunces, serif', fontSize: 20, color: 'var(--text)', fontWeight: 500 }}>
                      {name}
                    </span>
                  </div>
                  <span style={{ fontFamily: 'Geist Mono, monospace', fontSize: 11, color: 'var(--muted)' }}>
                    {sessions.length} sessions
                    {availH > 0 && (
                      <>{' · '}<span style={{ color: T.moss }}>{availH}h free</span></>
                    )}
                  </span>
                </button>
                {sessions.length > 0 && (
                  <div className="p-3 flex gap-3 overflow-x-auto">
                    {sessions.map((s) => (
                      <SessionCard
                        key={s.id}
                        session={s}
                        onOpen={() => onOpenSession?.(s.id)}
                        onDelete={(id) => cancelSessionMutation.mutate(id)}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          }

          return (
            <button
              key={i}
              onClick={() => setOpenDay(i)}
              className="flex items-stretch rounded-2xl text-left transition-colors hover:opacity-90"
              style={{
                background: 'var(--panel)',
                border: '1px solid var(--hairline)',
                opacity: isWeekend && !bookedBlocks.length && !dayItems.length ? 0.7 : 1,
                cursor: 'pointer',
              }}
            >
              <div
                className="flex flex-col items-center justify-center px-4 py-3 shrink-0"
                style={{ width: 72, borderRight: '1px solid var(--hairline)' }}
              >
                <span style={{ fontFamily: 'Geist Mono, monospace', fontSize: 10, letterSpacing: '0.12em', color: 'var(--muted)', textTransform: 'uppercase' }}>
                  {DAY_SHORT[i]}
                </span>
                <span style={{ fontFamily: 'Fraunces, serif', fontSize: 26, fontWeight: 500, color: 'var(--text)', lineHeight: 1.1, marginTop: 2 }}>
                  {dateNum}
                </span>
              </div>

              <div className="flex-1 min-w-0 p-3 flex flex-col gap-1.5 justify-center">
                {dayItems.length === 0 ? (
                  <span style={{ color: 'var(--muted)', fontSize: 13, fontStyle: 'italic' }}>
                    No sessions · tap to add availability
                  </span>
                ) : (
                  <>
                    <div className="flex flex-wrap gap-1.5">
                      {bookedBlocks.map((b, k) => (
                        <span
                          key={k}
                          className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md"
                          style={{ background: T.sunrise, color: '#F7F3EC', fontSize: 12 }}
                        >
                          <span style={{ fontFamily: 'Geist Mono, monospace', fontSize: 10, opacity: 0.85 }}>
                            {fmtTime(b.start)}
                          </span>
                          {b.kid}
                        </span>
                      ))}
                      {dayItems.filter((b) => b.kind === 'blocked').map((b, k) => (
                        <span
                          key={'blk' + k}
                          className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md"
                          style={{
                            border: `1px solid ${stone}55`,
                            color: stone,
                            fontSize: 12,
                            backgroundImage: `repeating-linear-gradient(45deg, ${stone}15 0 4px, transparent 4px 8px)`,
                          }}
                        >
                          {fmtTime(b.start)} · {b.reason}
                        </span>
                      ))}
                    </div>
                    {availH > 0 && (
                      <div className="flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: T.moss }} />
                        <span style={{ color: T.moss, fontSize: 12 }}>
                          {availH.toFixed(availH % 1 ? 1 : 0)}h available
                        </span>
                      </div>
                    )}
                  </>
                )}
              </div>

              <div
                className="flex flex-col items-end justify-center pr-4 shrink-0"
                style={{ fontFamily: 'Geist Mono, monospace', fontSize: 11, color: 'var(--muted)', minWidth: 60, textAlign: 'right' }}
              >
                <span style={{ color: bookedBlocks.length ? 'var(--text)' : 'var(--muted)' }}>
                  {bookedBlocks.length} {bookedBlocks.length === 1 ? 'session' : 'sessions'}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {openDay !== null && (
        <DayDetailSheet
          day={openDay}
          dateNum={getDayDate(monday, openDay)}
          blocks={blocks}
          isToday={openDay === todayIndex && isCurrentWeek}
          isPast={openDay < todayIndex && isCurrentWeek}
          onClose={() => setOpenDay(null)}
          onToggle={(start) => toggle(openDay, start)}
        />
      )}
    </div>
  );
}

function DayDetailSheet({
  day,
  dateNum,
  blocks,
  isToday,
  isPast,
  onClose,
  onToggle,
}: {
  day: number;
  dateNum: number;
  blocks: Block[];
  isToday: boolean;
  isPast: boolean;
  onClose: () => void;
  onToggle: (slotStart: number) => void;
}) {
  const slots: number[] = [];
  for (let m = HOUR_START * 60; m < HOUR_END * 60; m += 30) slots.push(m);

  const nowMinutes = isToday
    ? new Date().getHours() * 60 + new Date().getMinutes()
    : isPast ? 24 * 60 : -1; // -1 = nothing grayed (future week)

  const findBlock = (slot: number) =>
    blocks.find((b) => b.day === day && b.start <= slot && b.end > slot);

  return (
    <div
      className="fixed inset-0 flex items-end md:items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)', zIndex: 60 }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full md:max-w-[460px] rounded-t-3xl md:rounded-3xl overflow-hidden flex flex-col"
        style={{ background: 'var(--bg)', border: '1px solid var(--hairline)', maxHeight: '88dvh' }}
      >
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ background: 'var(--panel-solid)', borderBottom: '1px solid var(--hairline)' }}
        >
          <div>
            <div style={{ fontFamily: 'Fraunces, serif', fontSize: 22, color: 'var(--text)', lineHeight: 1.1 }}>
              {DAY_NAMES[day]}
            </div>
            <div style={{ fontFamily: 'Geist Mono, monospace', fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
              {new Date().toLocaleDateString('en-US', { month: 'short' })} {dateNum} · tap empty slots to add availability
            </div>
          </div>
          <button onClick={onClose} className="p-2" style={{ color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer' }}>
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto py-1">
          {slots.map((s) => {
            const block = findBlock(s);
            const isHourStart = s % 60 === 0;
            const slotIsPast = nowMinutes > 0 && s < nowMinutes;
            const clickable = !slotIsPast && (!block || block.kind === 'available');

            let content: React.ReactNode = slotIsPast ? (
              <span style={{ color: 'var(--muted)', fontSize: 12, opacity: 0.5 }}>Past</span>
            ) : (
              <span style={{ color: 'var(--muted)', fontSize: 13, fontStyle: 'italic' }}>
                Empty · tap to mark available
              </span>
            );
            let bg = slotIsPast ? 'var(--surface-sub)' : 'transparent';
            let leftBorderColor = 'transparent';

            if (block?.kind === 'booked') {
              bg = slotIsPast ? stone + '10' : T.sunrise + '18';
              leftBorderColor = slotIsPast ? stone : T.sunrise;
              content = (
                <>
                  <span style={{ color: slotIsPast ? 'var(--muted)' : 'var(--text)', fontSize: 14 }}>{block.kid}</span>
                  <span style={{ fontFamily: 'Geist Mono, monospace', fontSize: 11, color: slotIsPast ? 'var(--muted)' : T.sunrise, marginLeft: 8 }}>
                    {slotIsPast ? 'PAST' : 'SESSION'}
                  </span>
                </>
              );
            } else if (block?.kind === 'available') {
              bg = slotIsPast ? stone + '10' : T.moss + '12';
              leftBorderColor = slotIsPast ? stone : T.moss;
              content = slotIsPast ? (
                <span style={{ color: 'var(--muted)', fontSize: 13, opacity: 0.6 }}>Expired slot</span>
              ) : (
                <>
                  <span style={{ color: T.moss, fontSize: 14 }}>Available</span>
                  <span style={{ fontFamily: 'Geist Mono, monospace', fontSize: 10, color: 'var(--muted)', marginLeft: 8 }}>
                    tap to remove
                  </span>
                </>
              );
            } else if (block?.kind === 'blocked') {
              bg = stone + '14';
              leftBorderColor = stone;
              content = (
                <>
                  <span style={{ color: stone, fontSize: 14 }}>Blocked</span>
                  <span style={{ fontFamily: 'Geist Mono, monospace', fontSize: 11, color: 'var(--muted)', marginLeft: 8 }}>
                    {block.reason}
                  </span>
                </>
              );
            }

            return (
              <button
                key={s}
                disabled={!clickable}
                onClick={() => clickable && onToggle(s)}
                className="w-full flex items-center gap-3 px-5 text-left"
                style={{
                  height: 52,
                  background: bg,
                  borderTop: isHourStart ? '1px solid var(--hairline)' : 'none',
                  borderLeft: `3px solid ${leftBorderColor}`,
                  borderRight: 'none',
                  borderBottom: 'none',
                  cursor: clickable ? 'pointer' : 'default',
                  opacity: slotIsPast && !block ? 0.55 : 1,
                }}
              >
                <span
                  style={{
                    fontFamily: 'Geist Mono, monospace',
                    fontSize: 11,
                    color: isHourStart ? 'var(--text)' : 'var(--muted)',
                    width: 56,
                    flexShrink: 0,
                  }}
                >
                  {fmtTime(s)}
                </span>
                <div className="flex-1 flex items-center">{content}</div>
              </button>
            );
          })}
        </div>

        <div
          className="px-5 py-4 flex gap-2"
          style={{
            background: 'var(--panel-solid)',
            borderTop: '1px solid var(--hairline)',
            paddingBottom: 'calc(16px + env(safe-area-inset-bottom))',
          }}
        >
          <button
            onClick={onClose}
            className="flex-1 py-3 rounded-xl"
            style={{ background: T.sunrise, color: '#F7F3EC', fontSize: 14, border: 'none', cursor: 'pointer' }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

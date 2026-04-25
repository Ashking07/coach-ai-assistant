import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useState } from 'react';
import { T } from '../tokens';
import type { DashboardSession } from '../lib/api';
import { SessionCard } from './cards';

const stone = '#8A857B';

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const HOUR_START = 7;
const HOUR_END = 21;

type Block = {
  day: number;
  start: number;
  end: number;
  kind: 'booked' | 'available' | 'blocked';
  kid?: string;
  reason?: string;
};

const seed: Block[] = [
  { day: 0, start: 9 * 60, end: 10 * 60, kind: 'booked', kid: 'Rhea T.' },
  { day: 0, start: 10 * 60 + 15, end: 11 * 60, kind: 'booked', kid: 'Eli B.' },
  { day: 0, start: 15 * 60 + 30, end: 17 * 60, kind: 'booked', kid: 'Kofi O.' },
  { day: 1, start: 8 * 60, end: 9 * 60, kind: 'booked', kid: 'Mira L.' },
  { day: 1, start: 14 * 60, end: 16 * 60, kind: 'available' },
  { day: 1, start: 17 * 60, end: 18 * 60, kind: 'booked', kid: 'Arjun S.' },
  { day: 2, start: 9 * 60, end: 10 * 60, kind: 'booked', kid: 'Ayo N.' },
  { day: 2, start: 17 * 60, end: 18 * 60, kind: 'booked', kid: 'Diego M.' },
  { day: 3, start: 15 * 60, end: 17 * 60, kind: 'available' },
  { day: 3, start: 18 * 60, end: 20 * 60, kind: 'blocked', reason: 'Family' },
  { day: 4, start: 8 * 60, end: 9 * 60, kind: 'booked', kid: 'Seo K.' },
  { day: 4, start: 12 * 60, end: 15 * 60, kind: 'available' },
  { day: 4, start: 17 * 60, end: 18 * 60, kind: 'booked', kid: 'Lina W.' },
  { day: 5, start: 9 * 60, end: 10 * 60 + 30, kind: 'booked', kid: 'Noor H.' },
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

function getWeekInfo() {
  const now = new Date();
  const dow = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((dow + 6) % 7));
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
  const [blocks, setBlocks] = useState<Block[]>(seed);
  const [openDay, setOpenDay] = useState<number | null>(null);
  const { monday, dateRange } = getWeekInfo();

  const toggle = (day: number, slotStart: number) => {
    const slotEnd = slotStart + 30;
    const existing = blocks.find(
      (b) => b.day === day && b.start <= slotStart && b.end >= slotEnd && b.kind === 'available',
    );
    if (existing) {
      setBlocks((bs) => bs.filter((b) => b !== existing));
    } else if (!blocks.find((b) => b.day === day && b.start <= slotStart && b.end > slotStart)) {
      setBlocks((bs) => [...bs, { day, start: slotStart, end: slotEnd, kind: 'available' }]);
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
          <div
            style={{
              fontFamily: 'Geist Mono, monospace',
              fontSize: 12,
              color: 'var(--muted)',
              marginTop: 4,
            }}
          >
            {dateRange}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            className="p-2 rounded-lg"
            style={{ color: 'var(--muted)', border: '1px solid var(--hairline)', background: 'none', cursor: 'pointer' }}
          >
            <ChevronLeft size={14} />
          </button>
          <button
            className="px-3 py-2 rounded-lg"
            style={{
              fontFamily: 'Geist Mono, monospace',
              fontSize: 11,
              color: T.sunrise,
              border: `1px solid ${T.sunrise}55`,
              letterSpacing: '0.08em',
              background: 'none',
              cursor: 'pointer',
            }}
          >
            TODAY
          </button>
          <button
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
                    <span
                      style={{
                        fontFamily: 'Geist Mono, monospace',
                        fontSize: 10,
                        letterSpacing: '0.14em',
                        color: T.sunrise,
                      }}
                    >
                      TODAY · {DAY_SHORT[i].toUpperCase()} {dateNum}
                    </span>
                    <span
                      style={{
                        fontFamily: 'Fraunces, serif',
                        fontSize: 20,
                        color: 'var(--text)',
                        fontWeight: 500,
                      }}
                    >
                      {name}
                    </span>
                  </div>
                  <span style={{ fontFamily: 'Geist Mono, monospace', fontSize: 11, color: 'var(--muted)' }}>
                    {sessions.length} sessions
                    {availH > 0 && (
                      <>
                        {' · '}
                        <span style={{ color: T.moss }}>{availH}h free</span>
                      </>
                    )}
                  </span>
                </button>
                {sessions.length > 0 && (
                  <div className="p-3 flex gap-3 overflow-x-auto">
                    {sessions.map((s) => (
                      <SessionCard key={s.id} session={s} onOpen={() => onOpenSession?.(s.id)} />
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
                <span
                  style={{
                    fontFamily: 'Geist Mono, monospace',
                    fontSize: 10,
                    letterSpacing: '0.12em',
                    color: 'var(--muted)',
                    textTransform: 'uppercase',
                  }}
                >
                  {DAY_SHORT[i]}
                </span>
                <span
                  style={{
                    fontFamily: 'Fraunces, serif',
                    fontSize: 26,
                    fontWeight: 500,
                    color: 'var(--text)',
                    lineHeight: 1.1,
                    marginTop: 2,
                  }}
                >
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
                      {dayItems
                        .filter((b) => b.kind === 'blocked')
                        .map((b, k) => (
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
                style={{
                  fontFamily: 'Geist Mono, monospace',
                  fontSize: 11,
                  color: 'var(--muted)',
                  minWidth: 60,
                  textAlign: 'right',
                }}
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
  onClose,
  onToggle,
}: {
  day: number;
  dateNum: number;
  blocks: Block[];
  onClose: () => void;
  onToggle: (slotStart: number) => void;
}) {
  const slots: number[] = [];
  for (let m = HOUR_START * 60; m < HOUR_END * 60; m += 30) slots.push(m);

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
        style={{
          background: 'var(--bg)',
          border: '1px solid var(--hairline)',
          maxHeight: '88dvh',
        }}
      >
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{
            background: 'var(--panel-solid)',
            borderBottom: '1px solid var(--hairline)',
          }}
        >
          <div>
            <div
              style={{
                fontFamily: 'Fraunces, serif',
                fontSize: 22,
                color: 'var(--text)',
                lineHeight: 1.1,
              }}
            >
              {DAY_NAMES[day]}
            </div>
            <div
              style={{
                fontFamily: 'Geist Mono, monospace',
                fontSize: 11,
                color: 'var(--muted)',
                marginTop: 2,
              }}
            >
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
            const clickable = !block || block.kind === 'available';

            let content: React.ReactNode = (
              <span style={{ color: 'var(--muted)', fontSize: 13, fontStyle: 'italic' }}>
                Empty · tap to mark available
              </span>
            );
            let bg = 'transparent';
            let leftBar = '3px solid transparent';

            if (block?.kind === 'booked') {
              bg = T.sunrise + '18';
              leftBar = `3px solid ${T.sunrise}`;
              content = (
                <>
                  <span style={{ color: 'var(--text)', fontSize: 14 }}>{block.kid}</span>
                  <span
                    style={{
                      fontFamily: 'Geist Mono, monospace',
                      fontSize: 11,
                      color: T.sunrise,
                      marginLeft: 8,
                    }}
                  >
                    SESSION
                  </span>
                </>
              );
            } else if (block?.kind === 'available') {
              bg = T.moss + '12';
              leftBar = `3px solid ${T.moss}`;
              content = (
                <>
                  <span style={{ color: T.moss, fontSize: 14 }}>Available</span>
                  <span
                    style={{
                      fontFamily: 'Geist Mono, monospace',
                      fontSize: 10,
                      color: 'var(--muted)',
                      marginLeft: 8,
                    }}
                  >
                    tap to remove
                  </span>
                </>
              );
            } else if (block?.kind === 'blocked') {
              bg = stone + '14';
              leftBar = `3px solid ${stone}`;
              content = (
                <>
                  <span style={{ color: stone, fontSize: 14 }}>Blocked</span>
                  <span
                    style={{
                      fontFamily: 'Geist Mono, monospace',
                      fontSize: 11,
                      color: 'var(--muted)',
                      marginLeft: 8,
                    }}
                  >
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
                  borderLeft: leftBar,
                  borderRight: 'none',
                  borderBottom: 'none',
                  cursor: clickable ? 'pointer' : 'default',
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

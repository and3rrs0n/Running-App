import { useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronLeft, ChevronRight, Lock, Plus, SlidersHorizontal } from 'lucide-react';
import type { ISODate, PlannedSession } from '../db/types';
import { addDays, cap, fmtShort, fromISO, isoWeekNumber, MONTHS, mondayOf, today, weekday, WEEKDAYS, WEEKDAYS_SHORT } from '../logic/dates';
import { ACTIVITY_COLOR, ACTIVITY_LABEL, RUN_KIND_LABEL, fmtDuration, fmtKm } from '../logic/format';
import { ghostSessions, useProjection, type GhostSession } from '../hooks';
import { useData, useUI } from '../store';
import { Badge, PageHeader, Segmented, cx } from '../components/ui';
import { SessionRow } from '../components/Sheets';

const KIND_LABEL: Record<string, string> = {
  start: 'Oppstart',
  build: 'Økning',
  hold: 'Samme nivå',
  recovery: 'Lett uke',
  reduce: 'Redusert',
  restart: 'Gjenopptak',
  manual: 'Manuelt satt',
};

export default function CalendarPage() {
  const data = useData();
  const { sessions, activities, weeks, settings } = data;
  const { open, toast } = useUI();
  const [view, setView] = useState<'week' | 'month'>('week');
  const [anchor, setAnchor] = useState<ISODate>(today());
  const [showWhy, setShowWhy] = useState(false);
  const proj = useProjection(data, 16);
  const ghosts = useMemo(() => ghostSessions(proj, data, 16), [proj, data.settings]); // eslint-disable-line react-hooks/exhaustive-deps

  const allSessions: (PlannedSession | GhostSession)[] = useMemo(() => [...sessions, ...ghosts], [sessions, ghosts]);
  const t = today();

  const monday = mondayOf(anchor);
  const week = weeks.find((w) => w.monday === monday);
  const projWeek = proj.find((p) => p.monday === monday);

  const openSession = (s: PlannedSession | GhostSession) => {
    if ('ghost' in s) toast('Foreløpig økt – fastsettes når uken nærmer seg, basert på treningen din.');
    else open({ kind: 'session', id: s.id });
  };

  return (
    <div className="pb-nav">
      <PageHeader
        title="Kalender"
        right={
          <button className="mb-1 flex h-10 w-10 items-center justify-center rounded-full bg-accent text-bg" aria-label="Ny økt" onClick={() => open({ kind: 'addSession', date: anchor >= t ? anchor : t })}>
            <Plus size={22} />
          </button>
        }
      />
      <div className="px-4">
        <Segmented
          value={view}
          onChange={setView}
          options={[
            { value: 'week', label: 'Uke' },
            { value: 'month', label: 'Måned' },
          ]}
        />

        {view === 'week' ? (
          <>
            <div className="mt-4 flex items-center justify-between">
              <NavBtn dir="left" onClick={() => setAnchor(addDays(monday, -7))} />
              <button className="text-center" onClick={() => setAnchor(t)}>
                <div className="text-[17px] font-semibold">Uke {isoWeekNumber(monday)}</div>
                <div className="text-[13px] text-muted">
                  {fmtShort(monday)} – {fmtShort(addDays(monday, 6))}
                  {monday !== mondayOf(t) && <span className="text-accent"> · til i dag</span>}
                </div>
              </button>
              <NavBtn dir="right" onClick={() => setAnchor(addDays(monday, 7))} />
            </div>

            <WeekSummary monday={monday} sessions={allSessions} />

            {(week || projWeek) && (
              <div className="mt-3 rounded-2xl border border-line bg-surface">
                <button className="flex w-full items-center justify-between px-3.5 py-3 text-left" onClick={() => setShowWhy(!showWhy)}>
                  <div className="flex items-center gap-2 text-[14px]">
                    {week ? (
                      <>
                        <Badge color={week.kind === 'reduce' ? '#ff6b6b' : week.kind === 'recovery' ? '#7aa8ff' : '#3ee0a1'}>{KIND_LABEL[week.kind]}</Badge>
                        <span className="num">
                          Plan {week.planWeekNo}: {fmtKm(week.targetKm)} km · {week.runCount} løp
                        </span>
                        {week.locked && <Lock size={13} className="text-dim" />}
                      </>
                    ) : (
                      <>
                        <Badge>Foreløpig</Badge>
                        <span className="num">
                          {fmtKm(projWeek!.targetKm)} km · {projWeek!.runCount} løp
                        </span>
                      </>
                    )}
                  </div>
                  <ChevronDown size={16} className={cx('text-dim transition', showWhy && 'rotate-180')} />
                </button>
                {showWhy && (
                  <div className="border-t border-line px-3.5 py-3">
                    <div className="label mb-1.5">Hvorfor denne uken ser slik ut</div>
                    <ul className="space-y-1 text-[13.5px] leading-relaxed text-muted">
                      {(week?.reasons ?? projWeek?.reasons ?? []).map((r, i) => (
                        <li key={i}>• {r}</li>
                      ))}
                      {!week && <li>• Foreløpig: beregnet som om alt går etter planen. Justeres etter hvert.</li>}
                    </ul>
                    {week && monday >= mondayOf(t) && (
                      <button className="mt-3 flex items-center gap-1.5 text-[14px] font-semibold text-accent" onClick={() => open({ kind: 'override', monday })}>
                        <SlidersHorizontal size={15} /> Juster uken manuelt
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="mt-4 space-y-4">
              {Array.from({ length: 7 }, (_, i) => {
                const d = addDays(monday, i);
                const ss = allSessions.filter((s) => s.date === d);
                const extra = activities.filter((a) => a.date === d && !a.plannedSessionId);
                const isToday = d === t;
                const rest = ss.length === 0 && extra.length === 0;
                return (
                  <div key={d}>
                    <button className="mb-1.5 flex w-full items-center gap-2 px-1 text-left" onClick={() => open({ kind: 'day', date: d })}>
                      <span className={cx('text-[13px] font-semibold capitalize', isToday ? 'text-accent' : 'text-muted')}>
                        {WEEKDAYS[i]} {fromISO(d).getDate()}.
                      </span>
                      {isToday && <span className="rounded bg-accent/15 px-1.5 text-[11px] font-semibold text-accent">I DAG</span>}
                      {rest && (
                        <span className="text-[12px] text-dim">· {settings.restDays.includes(i) ? 'Hviledag' : 'Fri'}</span>
                      )}
                    </button>
                    <div className="space-y-1.5">
                      {ss.map((s) =>
                        'ghost' in s ? (
                          <GhostRow key={s.id} s={s} onClick={() => openSession(s)} />
                        ) : (
                          <SessionRow key={s.id} s={s} compact onClick={() => openSession(s)} />
                        ),
                      )}
                      {extra.map((a) => (
                        <button key={a.id} onClick={() => open({ kind: 'register', activityId: a.id })} className="card flex w-full items-center gap-3 p-3 text-left">
                          <div className="h-9 w-1.5 rounded-full" style={{ background: ACTIVITY_COLOR[a.type] }} />
                          <div className="flex-1">
                            <div className="text-[15px] font-semibold">
                              {a.type === 'run' && a.runKind ? RUN_KIND_LABEL[a.runKind] : ACTIVITY_LABEL[a.type]}
                            </div>
                            <div className="num text-[13px] text-muted">
                              {a.distanceKm ? `${fmtKm(a.distanceKm)} km · ` : ''}
                              {fmtDuration(a.durationSec)} · utenfor plan
                            </div>
                          </div>
                          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent text-bg">
                            <Check size={16} strokeWidth={3} />
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <MonthView anchor={anchor} setAnchor={setAnchor} sessions={allSessions} />
        )}

        <div className="mt-6 flex flex-wrap gap-x-4 gap-y-1.5 px-1 text-[12px] text-muted">
          {(['run', 'walk', 'strength', 'bike'] as const).map((k) => (
            <span key={k} className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: ACTIVITY_COLOR[k] }} />
              {ACTIVITY_LABEL[k]}
            </span>
          ))}
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full border border-dashed border-muted" /> Foreløpig
          </span>
        </div>
      </div>
    </div>
  );
}

function NavBtn({ dir, onClick }: { dir: 'left' | 'right'; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex h-10 w-10 items-center justify-center rounded-full border border-line bg-surface active:bg-raised" aria-label={dir === 'left' ? 'Forrige' : 'Neste'}>
      {dir === 'left' ? <ChevronLeft size={20} /> : <ChevronRight size={20} />}
    </button>
  );
}

function WeekSummary({ monday, sessions }: { monday: ISODate; sessions: (PlannedSession | GhostSession)[] }) {
  const { activities } = useData();
  const end = addDays(monday, 6);
  const runs = sessions.filter((s) => s.type === 'run' && s.date >= monday && s.date <= end);
  const planned = runs.reduce((s, x) => s + (x.plannedDistanceKm ?? 0), 0);
  const done = activities.filter((a) => a.type === 'run' && a.date >= monday && a.date <= end).reduce((s, a) => s + (a.distanceKm ?? 0), 0);
  const elev = activities.filter((a) => a.type === 'run' && a.date >= monday && a.date <= end).reduce((s, a) => s + (a.elevationM ?? 0), 0);
  const t = today();
  const due = runs.filter((s) => s.date < t || s.status === 'completed').reduce((s, x) => s + (x.plannedDistanceKm ?? 0), 0);
  const pct = due > 0 ? done / due : 0;
  const status = due === 0 ? null : pct >= 1.15 ? 'Over plan' : pct >= 0.85 ? 'I rute' : 'Bak plan';
  return (
    <div className="mt-4 grid grid-cols-3 gap-2">
      <SumBox label="Planlagt" value={`${fmtKm(planned)} km`} />
      <SumBox label="Løpt" value={`${fmtKm(done)} km`} accent />
      <SumBox label={status ?? 'Høydemeter'} value={status ? `${Math.round(pct * 100)} %` : `${Math.round(elev)} m`} />
    </div>
  );
}

function SumBox({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-xl border border-line bg-surface px-3 py-2.5">
      <div className="text-[11px] font-medium uppercase tracking-wide text-dim">{label}</div>
      <div className={cx('num mt-0.5 text-[16px] font-semibold', accent && 'text-accent')}>{value}</div>
    </div>
  );
}

function GhostRow({ s, onClick }: { s: GhostSession; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-3 rounded-2xl border border-dashed border-line p-3 text-left opacity-60">
      <div className="h-9 w-1.5 shrink-0 rounded-full opacity-50" style={{ background: ACTIVITY_COLOR[s.type] }} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-medium">{s.title}</div>
        <div className="num text-[13px] text-muted">
          {s.plannedDistanceKm ? `${fmtKm(s.plannedDistanceKm)} km · ` : ''}foreløpig
        </div>
      </div>
    </button>
  );
}

function MonthView({ anchor, setAnchor, sessions }: { anchor: ISODate; setAnchor: (d: ISODate) => void; sessions: (PlannedSession | GhostSession)[] }) {
  const { activities, settings } = useData();
  const { open } = useUI();
  const d = fromISO(anchor);
  const first = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
  const gridStart = mondayOf(first);
  const nextMonth = new Date(d.getFullYear(), d.getMonth() + 1, 1, 12);
  const prevMonth = new Date(d.getFullYear(), d.getMonth() - 1, 1, 12);
  const toIso = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-01`;
  const t = today();
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const rows = days[35].slice(0, 7) === first.slice(0, 7) ? 6 : 5;
  const monthRuns = activities.filter((a) => a.type === 'run' && a.date.slice(0, 7) === first.slice(0, 7));
  const monthKm = monthRuns.reduce((s, a) => s + (a.distanceKm ?? 0), 0);
  const plannedKm = sessions.filter((s) => s.type === 'run' && s.date.slice(0, 7) === first.slice(0, 7)).reduce((s, x) => s + (x.plannedDistanceKm ?? 0), 0);

  return (
    <div>
      <div className="mt-4 flex items-center justify-between">
        <NavBtn dir="left" onClick={() => setAnchor(toIso(prevMonth))} />
        <button className="text-center" onClick={() => setAnchor(t)}>
          <div className="text-[17px] font-semibold">
            {cap(MONTHS[d.getMonth()])} {d.getFullYear()}
          </div>
          <div className="num text-[13px] text-muted">
            {fmtKm(monthKm)} km løpt · {fmtKm(plannedKm)} km planlagt
          </div>
        </button>
        <NavBtn dir="right" onClick={() => setAnchor(toIso(nextMonth))} />
      </div>
      <div className="mt-4 grid grid-cols-7 gap-1 text-center">
        {WEEKDAYS_SHORT.map((w) => (
          <div key={w} className="pb-1 text-[11px] font-semibold uppercase text-dim">
            {w}
          </div>
        ))}
        {days.slice(0, rows * 7).map((day) => {
          const inMonth = day.slice(0, 7) === first.slice(0, 7);
          const ss = sessions.filter((s) => s.date === day);
          const extra = activities.filter((a) => a.date === day && !a.plannedSessionId);
          const runKm = activities.filter((a) => a.date === day && a.type === 'run').reduce((s, a) => s + (a.distanceKm ?? 0), 0);
          const isToday = day === t;
          const rest = settings.restDays.includes(weekday(day)) && ss.length === 0;
          return (
            <button
              key={day}
              onClick={() => open({ kind: 'day', date: day })}
              className={cx(
                'flex aspect-[0.78] flex-col items-center rounded-xl border pt-1.5',
                inMonth ? 'border-line bg-surface' : 'border-transparent opacity-35',
                isToday && 'border-accent/70',
              )}
            >
              <span className={cx('num text-[13px] font-semibold', isToday ? 'text-accent' : 'text-ink')}>{fromISO(day).getDate()}</span>
              <div className="mt-1 flex flex-wrap justify-center gap-0.5 px-0.5">
                {ss.map((s) => {
                  const ghost = 'ghost' in s;
                  const done = s.status === 'completed';
                  return (
                    <span
                      key={s.id}
                      className="h-2 w-2 rounded-full"
                      style={{
                        background: done ? ACTIVITY_COLOR[s.type] : 'transparent',
                        border: `1.5px ${ghost ? 'dashed' : 'solid'} ${ACTIVITY_COLOR[s.type]}`,
                        opacity: ghost ? 0.5 : s.status === 'skipped' ? 0.3 : 1,
                      }}
                    />
                  );
                })}
                {extra.map((a) => (
                  <span key={a.id} className="h-2 w-2 rounded-full" style={{ background: ACTIVITY_COLOR[a.type] }} />
                ))}
              </div>
              {runKm > 0 && <span className="num mt-auto pb-1 text-[10px] font-medium text-accent">{fmtKm(runKm)}</span>}
              {rest && inMonth && runKm === 0 && <span className="mt-auto pb-1 text-[9px] text-dim">hvile</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

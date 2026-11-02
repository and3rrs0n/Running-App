import { useEffect, useState } from 'react';
import { CalendarClock, Check, Footprints, Minus, Pencil, Plus, SkipForward, Trash2, Undo2 } from 'lucide-react';
import { db } from '../db/db';
import type { ActivityType, ISODate, RecoveryStatus, RunKind } from '../db/types';
import { addDays, cap, fmtLong, fmtShort, mondayOf, today, weekday } from '../logic/dates';
import {
  ACTIVITY_COLOR, ACTIVITY_LABEL, RECOVERY_LABEL, RUN_KIND_LABEL, fmtDuration, fmtKm, fmtMinutes, fmtPace, paceSecPerKm, parseNum,
} from '../logic/format';
import {
  addManualSession, deleteSession, moveSession, overrideWeek, recommendFor, resumePlan, setReadiness, skipSession, suggestStartDate, syncPlan, unlockWeek, unskipSession, updateSession,
} from '../logic/plan';
import type { Recommendation } from '../logic/engine';
import { HOME_STRENGTH_PROGRAM, titleFor } from '../logic/scheduler';
import { useData, useUI } from '../store';
import { Badge, Chip, Field, Sheet, cx } from './ui';

// ------------------------------------------------------------------ Session detail

export function SessionSheet({ id }: { id: string }) {
  const { close, open, toast, ask } = useUI();
  const { sessions, activities } = useData();
  const s = sessions.find((x) => x.id === id);
  const [mode, setMode] = useState<'view' | 'move' | 'edit' | 'skip'>('view');
  const [moveDate, setMoveDate] = useState<ISODate>('');
  const [reason, setReason] = useState('');
  const [editKm, setEditKm] = useState('');
  const [editMin, setEditMin] = useState('');
  const [editTitle, setEditTitle] = useState('');
  const [editDesc, setEditDesc] = useState('');

  useEffect(() => {
    if (s) {
      setMoveDate(s.date);
      setEditKm(s.plannedDistanceKm ? String(s.plannedDistanceKm).replace('.', ',') : '');
      setEditMin(s.plannedDurationMin ? String(s.plannedDurationMin) : '');
      setEditTitle(s.title);
      setEditDesc(s.description ?? '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s?.id]);

  if (!s) return null;
  const act = s.activityId ? activities.find((a) => a.id === s.activityId) : undefined;
  const color = ACTIVITY_COLOR[s.type];
  const t = today();

  // Warn if moving a run next to another run / demanding session
  const moveWarning = (() => {
    if (mode !== 'move' || s.type !== 'run') return null;
    const neighbours = sessions.filter(
      (x) => x.id !== s.id && x.type === 'run' && x.status !== 'skipped' && (x.date === addDays(moveDate, -1) || x.date === addDays(moveDate, 1)),
    );
    const same = sessions.filter((x) => x.id !== s.id && x.date === moveDate && x.type === 'run');
    if (same.length) return 'Det ligger allerede en løpetur denne dagen. Ikke slå sammen økter for å ta igjen kilometer.';
    if (neighbours.length) return 'Merk: dette gir løpeturer to dager på rad. Med din skadehistorikk anbefales minst én dag mellom.';
    return null;
  })();

  async function doMove() {
    await moveSession(s!.id, moveDate);
    toast(`Flyttet til ${fmtLong(moveDate)}`);
    close();
  }
  async function doEdit() {
    await updateSession(s!.id, {
      plannedDistanceKm: parseNum(editKm),
      plannedDurationMin: parseNum(editMin),
      title: editTitle.trim() || s!.title,
      description: editDesc.trim() || undefined,
    });
    toast('Økten er oppdatert');
    setMode('view');
  }
  async function doSkip() {
    await skipSession(s!.id, reason.trim() || undefined);
    toast('Markert som hoppet over');
    close();
  }
  async function doDelete() {
    if (!(await ask({ title: 'Slette denne planlagte økten?', body: 'Registrerte økter påvirkes ikke.', confirmLabel: 'Slett', danger: true }))) return;
    await deleteSession(s!.id);
    toast('Planlagt økt slettet');
    close();
  }

  const footer =
    mode === 'view' ? (
      s.status === 'planned' ? (
        <button className="btn-primary w-full" onClick={() => open({ kind: 'register', sessionId: s.id })}>
          <Check size={18} /> Registrer gjennomført
        </button>
      ) : s.status === 'completed' && act ? (
        <button className="btn-secondary w-full" onClick={() => open({ kind: 'register', activityId: act.id })}>
          <Pencil size={16} /> Se / rediger registrering
        </button>
      ) : (
        <button className="btn-secondary w-full" onClick={() => unskipSession(s.id)}>
          <Undo2 size={16} /> Angre «hoppet over»
        </button>
      )
    ) : mode === 'move' ? (
      <div className="flex gap-2">
        <button className="btn-secondary flex-1" onClick={() => setMode('view')}>Avbryt</button>
        <button className="btn-primary flex-1" onClick={doMove} disabled={moveDate === s.date}>Flytt økt</button>
      </div>
    ) : mode === 'edit' ? (
      <div className="flex gap-2">
        <button className="btn-secondary flex-1" onClick={() => setMode('view')}>Avbryt</button>
        <button className="btn-primary flex-1" onClick={doEdit}>Lagre</button>
      </div>
    ) : (
      <div className="flex gap-2">
        <button className="btn-secondary flex-1" onClick={() => setMode('view')}>Avbryt</button>
        <button className="btn-primary flex-1" onClick={doSkip}>Hopp over</button>
      </div>
    );

  return (
    <Sheet open onClose={close} title={ACTIVITY_LABEL[s.type]} footer={footer}>
      <div className="pt-1">
        <div className="flex items-start gap-3">
          <div className="mt-1 h-10 w-1.5 shrink-0 rounded-full" style={{ background: color }} />
          <div className="min-w-0 flex-1">
            <div className="text-[20px] font-semibold leading-tight">{s.title}</div>
            <div className="mt-0.5 text-[14px] text-muted">{cap(fmtLong(s.date))}</div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {s.status === 'completed' && <Badge color="#3ee0a1">Gjennomført</Badge>}
              {s.status === 'skipped' && <Badge color="#8b93a1">Hoppet over</Badge>}
              {s.status === 'planned' && s.date < t && <Badge color="#f5b452">Ikke registrert</Badge>}
              {s.source === 'manual' && <Badge color="#7aa8ff">Lagt til manuelt</Badge>}
              {s.userEdited && s.source === 'plan' && <Badge color="#7aa8ff">Endret av deg</Badge>}
            </div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2">
          {s.plannedDistanceKm !== undefined && <Mini label="Distanse" value={`${fmtKm(s.plannedDistanceKm)} km`} />}
          {s.plannedDurationMin !== undefined && <Mini label="Ca. tid" value={fmtMinutes(s.plannedDurationMin)} />}
          {s.plannedElevationM !== undefined && <Mini label="Høyde" value={`${s.plannedElevationM} m`} />}
        </div>

        {mode === 'view' && (
          <>
            {s.description && <p className="mt-4 text-[15px] leading-relaxed text-ink/90">{s.description}</p>}
            {s.surfaceHint && (
              <div className="mt-3 rounded-xl bg-raised p-3 text-[13.5px] leading-relaxed text-muted">
                <span className="font-semibold text-ink">Underlag: </span>
                {s.surfaceHint}
              </div>
            )}
            {s.type === 'strength' && s.strengthMode !== 'gym' && (
              <div className="mt-4">
                <div className="label mb-2">Program (ca. 30 min)</div>
                <div className="divide-y divide-line rounded-2xl border border-line bg-surface">
                  {HOME_STRENGTH_PROGRAM.map((e) => (
                    <div key={e.name} className="px-3.5 py-2.5">
                      <div className="flex justify-between gap-2 text-[14px]">
                        <span>{e.name}</span>
                        <span className="num shrink-0 text-muted">
                          {e.sets} × {e.reps}
                        </span>
                      </div>
                      <div className="mt-0.5 text-[12.5px] text-dim">{e.note}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {s.skipReason && <p className="mt-3 text-[14px] text-muted">Begrunnelse: {s.skipReason}</p>}
            {act && (
              <div className="mt-4 rounded-2xl border border-line bg-surface p-3.5">
                <div className="label mb-2">Registrert</div>
                <div className="grid grid-cols-3 gap-2 text-[14px]">
                  {act.distanceKm !== undefined && <Mini label="Distanse" value={`${fmtKm(act.distanceKm, 2)} km`} />}
                  {act.durationSec !== undefined && <Mini label="Tid" value={fmtDuration(act.durationSec)} />}
                  {act.type === 'run' && <Mini label="Tempo" value={fmtPace(paceSecPerKm(act.distanceKm, act.durationSec))} />}
                </div>
              </div>
            )}
            {s.status === 'planned' && (
              <div className="mt-4 grid grid-cols-4 gap-2">
                <Action icon={<CalendarClock size={18} />} label="Flytt" onClick={() => setMode('move')} />
                <Action icon={<Pencil size={18} />} label="Endre" onClick={() => setMode('edit')} />
                <Action icon={<SkipForward size={18} />} label="Hopp over" onClick={() => setMode('skip')} />
                <Action icon={<Trash2 size={18} />} label="Slett" danger onClick={doDelete} />
              </div>
            )}
            {s.status !== 'planned' && s.status !== 'completed' && (
              <div className="mt-4">
                <Action icon={<Trash2 size={18} />} label="Slett" danger onClick={doDelete} />
              </div>
            )}
          </>
        )}

        {mode === 'move' && (
          <div className="mt-4 space-y-3">
            <Field label="Ny dato">
              <input type="date" className="input" value={moveDate} onChange={(e) => setMoveDate(e.target.value)} />
            </Field>
            <div className="flex flex-wrap gap-1.5">
              {[-1, 1, 2].map((d) => (
                <Chip key={d} active={moveDate === addDays(s.date, d)} onClick={() => setMoveDate(addDays(s.date, d))}>
                  {d > 0 ? `+${d}` : d} dag{Math.abs(d) > 1 ? 'er' : ''}
                </Chip>
              ))}
            </div>
            {moveWarning && <p className="rounded-xl bg-warn/10 p-3 text-[13.5px] text-warn">{moveWarning}</p>}
          </div>
        )}

        {mode === 'edit' && (
          <div className="mt-4 space-y-3">
            <Field label="Tittel">
              <input className="input" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
            </Field>
            {s.type !== 'strength' && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Distanse" hint="km">
                  <input className="input num" inputMode="decimal" value={editKm} onChange={(e) => setEditKm(e.target.value)} />
                </Field>
                <Field label="Varighet" hint="min">
                  <input className="input num" inputMode="numeric" value={editMin} onChange={(e) => setEditMin(e.target.value)} />
                </Field>
              </div>
            )}
            <Field label="Beskrivelse">
              <textarea className="input min-h-[90px]" value={editDesc} onChange={(e) => setEditDesc(e.target.value)} />
            </Field>
            <p className="text-[12.5px] text-dim">Endrede økter blir ikke overskrevet når planen justeres automatisk.</p>
          </div>
        )}

        {mode === 'skip' && (
          <div className="mt-4 space-y-3">
            <p className="text-[14px] leading-relaxed text-muted">
              Helt greit. Kilometerne flyttes ikke til andre økter – planen tilpasser seg det du faktisk gjør.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {['Sliten', 'Smerte / ubehag', 'Syk', 'Tidsklemme', 'Vær / føre'].map((r) => (
                <Chip key={r} active={reason === r} onClick={() => setReason(r)}>
                  {r}
                </Chip>
              ))}
            </div>
            <input className="input" placeholder="Annen grunn (valgfritt)" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
        )}
      </div>
    </Sheet>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-raised px-3 py-2.5">
      <div className="text-[11px] font-medium uppercase tracking-wide text-dim">{label}</div>
      <div className="num mt-0.5 text-[15px] font-semibold">{value}</div>
    </div>
  );
}

function Action({ icon, label, onClick, danger }: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={cx(
        'flex flex-col items-center gap-1 rounded-xl border border-line bg-raised px-2 py-3 text-[12px] font-medium active:bg-line',
        danger ? 'text-danger' : 'text-ink',
      )}
    >
      {icon}
      {label}
    </button>
  );
}

// ------------------------------------------------------------------ Add planned session

export function AddSessionSheet({ date }: { date?: ISODate }) {
  const { close, toast } = useUI();
  const { settings } = useData();
  const [type, setType] = useState<ActivityType>('run');
  const [d, setD] = useState<ISODate>(date ?? today());
  const [runKind, setRunKind] = useState<RunKind>('easy');
  const [km, setKm] = useState('');
  const [min, setMin] = useState('');
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');

  async function save() {
    const distance = parseNum(km);
    await addManualSession({
      date: d,
      type,
      runKind: type === 'run' ? runKind : undefined,
      title: title.trim() || (type === 'run' ? titleFor(runKind) : ACTIVITY_LABEL[type]),
      description: desc.trim() || undefined,
      plannedDistanceKm: type === 'strength' ? undefined : distance,
      plannedDurationMin:
        parseNum(min) ?? (type === 'run' && distance ? Math.round((distance * settings.easyPaceSecPerKm) / 60) : undefined),
      strengthMode: type === 'strength' ? (settings.gymMember ? 'gym' : 'home') : undefined,
    });
    toast('Økt lagt til i kalenderen');
    close();
  }

  return (
    <Sheet
      open
      onClose={close}
      title="Ny planlagt økt"
      footer={
        <button className="btn-primary w-full" onClick={save}>
          <Plus size={18} /> Legg til
        </button>
      }
    >
      <div className="space-y-4 pt-2">
        <div className="grid grid-cols-4 gap-1.5">
          {(['run', 'walk', 'strength', 'bike'] as ActivityType[]).map((t) => (
            <button
              key={t}
              onClick={() => setType(t)}
              className={cx('rounded-xl border py-2.5 text-[13px] font-semibold', type === t ? 'border-transparent text-bg' : 'border-line bg-raised text-muted')}
              style={type === t ? { background: ACTIVITY_COLOR[t] } : undefined}
            >
              {ACTIVITY_LABEL[t]}
            </button>
          ))}
        </div>
        <Field label="Dato">
          <input type="date" className="input" value={d} onChange={(e) => setD(e.target.value)} />
        </Field>
        {type === 'run' && (
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(RUN_KIND_LABEL) as RunKind[]).map((k) => (
              <Chip key={k} active={runKind === k} onClick={() => setRunKind(k)}>
                {RUN_KIND_LABEL[k]}
              </Chip>
            ))}
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          {type !== 'strength' && (
            <Field label="Distanse" hint="km">
              <input className="input num" inputMode="decimal" value={km} onChange={(e) => setKm(e.target.value)} />
            </Field>
          )}
          <Field label="Varighet" hint="min">
            <input className="input num" inputMode="numeric" value={min} onChange={(e) => setMin(e.target.value)} />
          </Field>
        </div>
        <Field label="Tittel (valgfritt)">
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Notat (valgfritt)">
          <textarea className="input min-h-[70px]" value={desc} onChange={(e) => setDesc(e.target.value)} />
        </Field>
        {type === 'run' && (
          <p className="text-[12.5px] leading-relaxed text-dim">
            Ekstra løpeturer utenfor planen øker belastningen. Planen øker ikke raskere av den grunn.
          </p>
        )}
      </div>
    </Sheet>
  );
}

// ------------------------------------------------------------------ Day sheet (calendar)

export function DaySheet({ date }: { date: ISODate }) {
  const { close, open } = useUI();
  const { sessions, activities, settings } = useData();
  const ss = sessions.filter((s) => s.date === date);
  const unplanned = activities.filter((a) => a.date === date && !a.plannedSessionId);
  const isRest = settings.restDays.includes(weekday(date));
  return (
    <Sheet open onClose={close} title={cap(fmtLong(date))}>
      <div className="space-y-2 pt-2">
        {ss.length === 0 && unplanned.length === 0 && (
          <div className="rounded-2xl border border-line bg-surface p-4 text-[14px] text-muted">
            {isRest ? 'Hviledag. Hvile er en del av treningen.' : 'Ingen økter planlagt. Fri / hvile.'}
          </div>
        )}
        {ss.map((s) => (
          <SessionRow key={s.id} s={s} onClick={() => open({ kind: 'session', id: s.id })} />
        ))}
        {unplanned.map((a) => (
          <button key={a.id} onClick={() => open({ kind: 'register', activityId: a.id })} className="card flex w-full items-center gap-3 p-3.5 text-left">
            <div className="h-9 w-1.5 rounded-full" style={{ background: ACTIVITY_COLOR[a.type] }} />
            <div className="flex-1">
              <div className="text-[15px] font-semibold">{ACTIVITY_LABEL[a.type]} (ikke planlagt)</div>
              <div className="num text-[13px] text-muted">
                {a.distanceKm ? `${fmtKm(a.distanceKm)} km · ` : ''}
                {fmtDuration(a.durationSec)}
              </div>
            </div>
            <Check size={18} className="text-accent" />
          </button>
        ))}
        <div className="grid grid-cols-2 gap-2 pt-2">
          <button className="btn-secondary" onClick={() => open({ kind: 'addSession', date })}>
            <Plus size={16} /> Planlegg økt
          </button>
          <button className="btn-secondary" onClick={() => open({ kind: 'register', date: date > today() ? today() : date })} disabled={date > today()}>
            <Footprints size={16} /> Registrer
          </button>
        </div>
      </div>
    </Sheet>
  );
}

export function SessionRow({ s, onClick, compact }: { s: import('../db/types').PlannedSession; onClick: () => void; compact?: boolean }) {
  const t = today();
  const missed = s.status === 'planned' && s.date < t;
  return (
    <button
      onClick={onClick}
      className={cx(
        'card flex w-full items-center gap-3 text-left transition active:bg-raised',
        compact ? 'p-3' : 'p-3.5',
        s.status === 'skipped' && 'opacity-50',
      )}
    >
      <div
        className="h-9 w-1.5 shrink-0 rounded-full"
        style={{ background: ACTIVITY_COLOR[s.type], opacity: s.status === 'completed' ? 1 : 0.55 }}
      />
      <div className="min-w-0 flex-1">
        <div className={cx('truncate text-[15px] font-semibold', s.status === 'skipped' && 'line-through')}>{s.title}</div>
        <div className="num truncate text-[13px] text-muted">
          {s.plannedDistanceKm ? `${fmtKm(s.plannedDistanceKm)} km` : ''}
          {s.plannedDistanceKm && s.plannedDurationMin ? ' · ' : ''}
          {s.plannedDurationMin ? `ca. ${fmtMinutes(s.plannedDurationMin)}` : ''}
          {s.type === 'walk' && ' · teller ikke som løping'}
        </div>
      </div>
      {s.status === 'completed' && (
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent text-bg">
          <Check size={16} strokeWidth={3} />
        </span>
      )}
      {missed && <Badge color="#f5b452">Ikke registrert</Badge>}
      {s.status === 'skipped' && <Badge>Hoppet over</Badge>}
    </button>
  );
}

// ------------------------------------------------------------------ Weekly check-in

const RECOVERY_COLORS: Record<RecoveryStatus, string> = {
  good: '#3ee0a1',
  normal: '#a6e36b',
  tired: '#f5b452',
  discomfort: '#ff9f5a',
  warning: '#ff6b6b',
};

export function CheckinSheet({ monday }: { monday: ISODate }) {
  const { close, toast } = useUI();
  const [status, setStatus] = useState<RecoveryStatus | null>(null);
  const [note, setNote] = useState('');
  useEffect(() => {
    db.checkins.get(monday).then((c) => {
      if (c) {
        setStatus(c.status);
        setNote(c.note ?? '');
      }
    });
  }, [monday]);
  async function save() {
    if (!status) return;
    await db.checkins.put({ id: monday, monday, status, note: note.trim() || undefined, createdAt: Date.now() });
    await syncPlan();
    toast('Ukevurdering lagret');
    close();
  }
  return (
    <Sheet
      open
      onClose={close}
      title={`Ukevurdering · uke fra ${fmtShort(monday)}`}
      footer={
        <button className="btn-primary w-full" disabled={!status} onClick={save}>
          Lagre
        </button>
      }
    >
      <div className="space-y-2 pt-2">
        <p className="mb-3 text-[14px] text-muted">Hvordan har kroppen respondert på treningen?</p>
        {(Object.keys(RECOVERY_LABEL) as RecoveryStatus[]).map((k) => (
          <button
            key={k}
            onClick={() => setStatus(k)}
            className={cx(
              'flex w-full items-center gap-3 rounded-2xl border px-4 py-3.5 text-left text-[15px] transition',
              status === k ? 'border-transparent bg-raised' : 'border-line bg-surface',
            )}
            style={status === k ? { boxShadow: `inset 0 0 0 2px ${RECOVERY_COLORS[k]}` } : undefined}
          >
            <span className="h-3 w-3 rounded-full" style={{ background: RECOVERY_COLORS[k] }} />
            {RECOVERY_LABEL[k]}
          </button>
        ))}
        {(status === 'discomfort' || status === 'warning') && (
          <p className="rounded-xl bg-danger/10 p-3 text-[13.5px] leading-relaxed text-danger">
            Neste uke holdes eller reduseres. Ved vedvarende smerte eller mistanke om skade bør du få det vurdert av fysioterapeut eller lege før du øker igjen.
          </p>
        )}
        <textarea className="input mt-2 min-h-[70px]" placeholder="Notat (valgfritt)" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
    </Sheet>
  );
}

// ------------------------------------------------------------------ Start / resume

export function StartSheet({ mode }: { mode: 'clear' | 'resume' }) {
  const { close, toast } = useUI();
  const { settings } = useData();
  const [date, setDate] = useState<ISODate>(suggestStartDate(settings.startDate));
  async function go() {
    if (mode === 'clear') await setReadiness(true, date);
    else await resumePlan(date);
    toast(date <= today() ? 'Planen er i gang' : `Planen starter ${fmtLong(date)}`);
    close();
  }
  return (
    <Sheet
      open
      onClose={close}
      title={mode === 'clear' ? 'Klar for å løpe' : 'Gjenoppta planen'}
      footer={
        <button className="btn-primary w-full" onClick={go}>
          {mode === 'clear' ? 'Bekreft og start planen' : 'Gjenoppta'}
        </button>
      }
    >
      <div className="space-y-4 pt-2">
        {mode === 'clear' ? (
          <p className="text-[15px] leading-relaxed text-ink/90">
            Bekreft bare dette når kirurgen har klarert deg for løping. Planen starter rolig med {fmtKm(settings.startWeeklyKm)} km i uken.
          </p>
        ) : (
          <p className="text-[15px] leading-relaxed text-ink/90">
            Velg når du vil starte igjen. Progresjonen fortsetter der du slapp, men etter et opphold på to uker eller mer starter planen litt lavere.
          </p>
        )}
        <Field label="Startdato">
          <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <div className="flex flex-wrap gap-1.5">
          <Chip active={date === today()} onClick={() => setDate(today())}>I dag</Chip>
          <Chip active={date === addDays(mondayOf(today()), 7)} onClick={() => setDate(addDays(mondayOf(today()), 7))}>Neste mandag</Chip>
          <Chip active={date === addDays(mondayOf(today()), 14)} onClick={() => setDate(addDays(mondayOf(today()), 14))}>Om to uker</Chip>
        </div>
        <p className="text-[12.5px] text-dim">Registrerte økter og historikk endres aldri.</p>
      </div>
    </Sheet>
  );
}

// ------------------------------------------------------------------ Week override

export function OverrideSheet({ monday }: { monday: ISODate }) {
  const { close, toast } = useUI();
  const { weeks, settings } = useData();
  const week = weeks.find((w) => w.monday === monday);
  const [rec, setRec] = useState<Recommendation | null>(null);
  const [km, setKm] = useState(week?.targetKm ?? settings.startWeeklyKm);
  const [runs, setRuns] = useState(week?.runCount ?? 2);
  useEffect(() => {
    recommendFor(monday).then(setRec);
  }, [monday]);

  async function save() {
    await overrideWeek(monday, km, runs);
    toast('Uken er oppdatert');
    close();
  }
  async function unlock() {
    await unlockWeek(monday);
    toast('Automatisk plan gjenopprettet');
    close();
  }
  const jump = week ? km - week.targetKm : 0;
  return (
    <Sheet
      open
      onClose={close}
      title={`Juster uke fra ${fmtShort(monday)}`}
      footer={
        <div className="flex gap-2">
          {week?.locked && (
            <button className="btn-secondary flex-1" onClick={unlock}>
              Bruk automatisk
            </button>
          )}
          <button className="btn-primary flex-1" onClick={save}>
            Lagre
          </button>
        </div>
      }
    >
      <div className="space-y-5 pt-2">
        {rec && (
          <div className="rounded-2xl border border-line bg-surface p-3.5">
            <div className="label mb-1">Appens forslag</div>
            <div className="num text-[17px] font-semibold">
              {fmtKm(rec.targetKm)} km · {rec.runCount} løpeøkter
            </div>
            <ul className="mt-2 space-y-1 text-[13.5px] leading-relaxed text-muted">
              {rec.reasons.map((r, i) => (
                <li key={i}>• {r}</li>
              ))}
            </ul>
          </div>
        )}
        <Stepper label="Løpevolum" unit="km" value={km} step={0.5} min={0} max={150} onChange={setKm} />
        <Stepper label="Antall løpeøkter" value={runs} step={1} min={1} max={7} onChange={setRuns} />
        {rec && km > rec.targetKm * 1.15 && (
          <p className="rounded-xl bg-warn/10 p-3 text-[13.5px] leading-relaxed text-warn">
            Dette er mer enn appen anbefaler{jump > 0 ? ` (+${fmtKm(jump)} km fra nåværende)` : ''}. Med din skadehistorikk er små steg tryggest. Valget er ditt.
          </p>
        )}
        <p className="text-[12.5px] text-dim">
          En manuelt satt uke låses og endres ikke automatisk. Eventuelle endringer du har gjort på enkeltøkter i uken beholdes.
        </p>
      </div>
    </Sheet>
  );
}

function Stepper({ label, value, onChange, step, min, max, unit }: { label: string; value: number; onChange: (v: number) => void; step: number; min: number; max: number; unit?: string }) {
  return (
    <div className="flex items-center justify-between">
      <div className="text-[15px]">{label}</div>
      <div className="flex items-center gap-3">
        <button className="flex h-10 w-10 items-center justify-center rounded-full border border-line bg-raised" onClick={() => onChange(Math.max(min, +(value - step).toFixed(1)))} aria-label="Mindre">
          <Minus size={18} />
        </button>
        <div className="num w-16 text-center text-[20px] font-semibold">
          {fmtKm(value)}
          {unit && <span className="ml-0.5 text-[12px] text-muted">{unit}</span>}
        </div>
        <button className="flex h-10 w-10 items-center justify-center rounded-full border border-line bg-raised" onClick={() => onChange(Math.min(max, +(value + step).toFixed(1)))} aria-label="Mer">
          <Plus size={18} />
        </button>
      </div>
    </div>
  );
}


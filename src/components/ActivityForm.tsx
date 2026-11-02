import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { db } from '../db/db';
import type {
  Activity, ActivityType, ISODate, PainLocation, PainTiming, PlannedSession, RunKind, StrengthExercise, StrengthMode, Surface,
} from '../db/types';
import { fmtDayShort, today } from '../logic/dates';
import {
  ACTIVITY_COLOR, ACTIVITY_LABEL, PAIN_LOCATION_LABEL, RUN_KIND_LABEL, SURFACE_LABEL, fmtKm, fmtPace, paceSecPerKm, parseNum,
} from '../logic/format';
import { deleteActivity, linkCandidates, saveActivity } from '../logic/plan';
import { HOME_STRENGTH_PROGRAM } from '../logic/scheduler';
import { useData, useUI } from '../store';
import { Chip, Field, ScaleInput, Segmented, Sheet, cx, painColor, rpeColor } from './ui';

const TYPES: ActivityType[] = ['run', 'walk', 'strength', 'bike'];

function splitDuration(sec?: number) {
  if (!sec) return { h: '', m: '', s: '' };
  return {
    h: Math.floor(sec / 3600) ? String(Math.floor(sec / 3600)) : '',
    m: String(Math.floor((sec % 3600) / 60)),
    s: String(Math.round(sec % 60)).padStart(2, '0'),
  };
}

export function ActivityFormSheet(props: { sessionId?: string; activityId?: string; type?: ActivityType; date?: ISODate }) {
  const { close, toast, ask } = useUI();
  const { settings } = useData();
  const [loaded, setLoaded] = useState(false);
  const [id, setId] = useState<string | undefined>();
  const [type, setType] = useState<ActivityType>(props.type ?? 'run');
  const [date, setDate] = useState<ISODate>(props.date ?? today());
  const [linkId, setLinkId] = useState<string>('');
  const [candidates, setCandidates] = useState<PlannedSession[]>([]);
  const [distance, setDistance] = useState('');
  const [dur, setDur] = useState({ h: '', m: '', s: '' });
  const [hr, setHr] = useState('');
  const [elev, setElev] = useState('');
  const [surface, setSurface] = useState<Surface>(settings.defaultSurface);
  const [runKind, setRunKind] = useState<RunKind>('easy');
  const [rpe, setRpe] = useState<number | undefined>();
  const [pain, setPain] = useState<number | undefined>();
  const [painLocs, setPainLocs] = useState<PainLocation[]>([]);
  const [painTiming, setPainTiming] = useState<PainTiming>('after');
  const [painDesc, setPainDesc] = useState('');
  const [comment, setComment] = useState('');
  const [strengthMode, setStrengthMode] = useState<StrengthMode>(settings.gymMember ? 'gym' : 'home');
  const [exercises, setExercises] = useState<StrengthExercise[]>([]);
  const [homeDone, setHomeDone] = useState<string[]>(HOME_STRENGTH_PROGRAM.map((e) => e.name));
  const [indoor, setIndoor] = useState(true);
  const [power, setPower] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Load existing activity or prefill from planned session
  useEffect(() => {
    (async () => {
      if (props.activityId) {
        const a = await db.activities.get(props.activityId);
        if (a) {
          setId(a.id);
          setType(a.type);
          setDate(a.date);
          setLinkId(a.plannedSessionId ?? '');
          setDistance(a.distanceKm !== undefined ? String(a.distanceKm).replace('.', ',') : '');
          setDur(splitDuration(a.durationSec));
          setHr(a.avgHr ? String(a.avgHr) : '');
          setElev(a.elevationM !== undefined ? String(a.elevationM) : '');
          if (a.surface) setSurface(a.surface);
          if (a.runKind) setRunKind(a.runKind);
          setRpe(a.rpe);
          setPain(a.pain?.score);
          setPainLocs(a.pain?.locations ?? []);
          if (a.pain?.timing) setPainTiming(a.pain.timing);
          setPainDesc(a.pain?.description ?? '');
          setComment(a.comment ?? '');
          if (a.strengthMode) setStrengthMode(a.strengthMode);
          if (a.strengthMode === 'home' && a.exercises) setHomeDone(a.exercises.map((e) => e.name));
          if (a.strengthMode === 'gym' && a.exercises) setExercises(a.exercises);
          setIndoor(a.indoor ?? true);
          setPower(a.avgPower ? String(a.avgPower) : '');
        }
      } else if (props.sessionId) {
        const s = await db.sessions.get(props.sessionId);
        if (s && s.type !== 'rest') {
          setType(s.type);
          setDate(s.date > today() ? today() : s.date);
          setLinkId(s.id);
          if (s.plannedDistanceKm && s.type !== 'strength') setDistance(String(s.plannedDistanceKm).replace('.', ','));
          if (s.plannedElevationM) setElev(String(s.plannedElevationM));
          if (s.runKind) setRunKind(s.runKind);
          if (s.strengthMode) setStrengthMode(s.strengthMode);
        }
      }
      setLoaded(true);
    })();
  }, [props.activityId, props.sessionId]);

  // Candidate planned sessions to link
  useEffect(() => {
    linkCandidates(type, date).then(async (c) => {
      let list = c;
      if (linkId && !c.some((s) => s.id === linkId)) {
        const cur = await db.sessions.get(linkId);
        if (cur) list = [cur, ...c];
      }
      setCandidates(list);
      if (loaded && !props.activityId && !props.sessionId && !linkId) {
        const same = list.find((s) => s.date === date);
        if (same) setLinkId(same.id);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, date, loaded]);

  const durationSec = useMemo(() => {
    const h = parseInt(dur.h || '0', 10);
    const m = parseInt(dur.m || '0', 10);
    const s = parseInt(dur.s || '0', 10);
    const total = (isNaN(h) ? 0 : h) * 3600 + (isNaN(m) ? 0 : m) * 60 + (isNaN(s) ? 0 : s);
    return total > 0 ? total : undefined;
  }, [dur]);
  const distanceKm = parseNum(distance);
  const pace = paceSecPerKm(distanceKm, durationSec);

  async function onSave() {
    setError(null);
    if (!date) return setError('Velg dato.');
    if (date > today()) return setError('Du kan ikke registrere en økt frem i tid.');
    if ((type === 'run' || type === 'walk') && (!distanceKm || distanceKm <= 0)) return setError('Skriv inn distanse.');
    if (type === 'run' && distanceKm && distanceKm > 120) return setError('Distansen virker urealistisk.');
    if (type === 'run' && pain === undefined) return setError('Registrer smertenivå (0 hvis ingen smerte).');
    if (type === 'run' && pain && pain > 0 && painLocs.length === 0) return setError('Velg hvor smerten satt.');
    const hrN = parseNum(hr);
    if (hrN !== undefined && (hrN < 60 || hrN > 230)) return setError('Puls må være mellom 60 og 230.');
    const a: Omit<Activity, 'createdAt' | 'updatedAt' | 'id'> & { id?: string } = {
      id,
      type,
      date,
      distanceKm: type === 'strength' ? undefined : distanceKm,
      durationSec,
      avgHr: hrN ? Math.round(hrN) : undefined,
      elevationM: type === 'strength' ? undefined : parseNum(elev),
      rpe,
      comment: comment.trim() || undefined,
      plannedSessionId: linkId || undefined,
    };
    if (type === 'run') {
      a.surface = surface;
      a.runKind = runKind;
      a.pain = {
        score: pain ?? 0,
        locations: pain ? painLocs : [],
        timing: pain ? painTiming : undefined,
        description: pain ? painDesc.trim() || undefined : undefined,
      };
    }
    if (type === 'strength') {
      a.strengthMode = strengthMode;
      a.exercises =
        strengthMode === 'home'
          ? HOME_STRENGTH_PROGRAM.filter((e) => homeDone.includes(e.name)).map(({ name, sets, reps }) => ({ name, sets, reps }))
          : exercises.filter((e) => e.name.trim());
    }
    if (type === 'bike') {
      a.indoor = indoor;
      a.avgPower = parseNum(power);
    }
    await saveActivity(a);
    toast(id ? 'Økten er oppdatert' : 'Økten er registrert');
    close();
  }

  async function onDelete() {
    if (!id) return;
    if (!(await ask({ title: 'Slette økten fra treningsloggen?', body: 'Dette kan ikke angres.', confirmLabel: 'Slett', danger: true }))) return;
    await deleteActivity(id);
    toast('Økten er slettet');
    close();
  }

  const footer = (
    <div className="flex gap-2">
      {id && (
        <button className="btn-danger px-4" onClick={onDelete} aria-label="Slett">
          <Trash2 size={18} />
        </button>
      )}
      <button className="btn-primary flex-1" onClick={onSave}>
        {id ? 'Lagre endringer' : 'Lagre økt'}
      </button>
    </div>
  );

  return (
    <Sheet open onClose={close} title={id ? 'Rediger økt' : 'Registrer økt'} footer={footer}>
      {!loaded ? null : (
        <div className="space-y-5 pt-2">
          {!id && (
            <div className="grid grid-cols-4 gap-1.5">
              {TYPES.map((t) => (
                <button
                  key={t}
                  onClick={() => {
                    setType(t);
                    setLinkId('');
                  }}
                  className={cx(
                    'rounded-xl border py-2.5 text-[13px] font-semibold transition',
                    type === t ? 'border-transparent text-bg' : 'border-line bg-raised text-muted',
                  )}
                  style={type === t ? { background: ACTIVITY_COLOR[t] } : undefined}
                >
                  {ACTIVITY_LABEL[t]}
                </button>
              ))}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label="Dato">
              <input type="date" className="input" value={date} max={today()} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="Planlagt økt">
              <select className="input appearance-none" value={linkId} onChange={(e) => setLinkId(e.target.value)}>
                <option value="">Ikke planlagt</option>
                {candidates.map((s) => (
                  <option key={s.id} value={s.id}>
                    {fmtDayShort(s.date)} · {s.title}
                    {s.plannedDistanceKm ? ` ${fmtKm(s.plannedDistanceKm)} km` : ''}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          {type !== 'strength' && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Distanse" hint="km">
                <input className="input num" inputMode="decimal" placeholder="0,0" value={distance} onChange={(e) => setDistance(e.target.value)} />
              </Field>
              <Field label={type === 'run' ? 'Snittempo' : 'Høydemeter'} hint={type === 'run' ? 'min/km' : 'm'}>
                {type === 'run' ? (
                  <div className="input num flex items-center text-muted">{pace ? <span className="text-ink">{fmtPace(pace)}</span> : 'Beregnes'}</div>
                ) : (
                  <input className="input num" inputMode="numeric" placeholder="0" value={elev} onChange={(e) => setElev(e.target.value)} />
                )}
              </Field>
            </div>
          )}

          <Field label="Varighet" hint="t : min : sek">
            <div className="flex items-center gap-1.5">
              <input className="input num text-center" inputMode="numeric" placeholder="t" value={dur.h} onChange={(e) => setDur({ ...dur, h: e.target.value.replace(/\D/g, '') })} />
              <span className="text-dim">:</span>
              <input className="input num text-center" inputMode="numeric" placeholder="min" value={dur.m} onChange={(e) => setDur({ ...dur, m: e.target.value.replace(/\D/g, '') })} />
              <span className="text-dim">:</span>
              <input className="input num text-center" inputMode="numeric" placeholder="sek" value={dur.s} onChange={(e) => setDur({ ...dur, s: e.target.value.replace(/\D/g, '') })} />
            </div>
          </Field>

          {type !== 'strength' && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Snittpuls" hint="slag/min">
                <input className="input num" inputMode="numeric" placeholder="–" value={hr} onChange={(e) => setHr(e.target.value)} />
              </Field>
              {type === 'run' || type === 'bike' ? (
                <Field label="Høydemeter" hint="m">
                  <input className="input num" inputMode="numeric" placeholder="0" value={elev} onChange={(e) => setElev(e.target.value)} />
                </Field>
              ) : (
                <div />
              )}
            </div>
          )}

          {type === 'run' && (
            <>
              <Field label="Underlag">
                <div className="flex flex-wrap gap-1.5">
                  {(Object.keys(SURFACE_LABEL) as Surface[]).map((s) => (
                    <Chip key={s} active={surface === s} onClick={() => setSurface(s)}>
                      {SURFACE_LABEL[s]}
                    </Chip>
                  ))}
                </div>
              </Field>
              <Field label="Type løpetur">
                <div className="flex flex-wrap gap-1.5">
                  {(Object.keys(RUN_KIND_LABEL) as RunKind[]).map((k) => (
                    <Chip key={k} active={runKind === k} onClick={() => setRunKind(k)}>
                      {RUN_KIND_LABEL[k]}
                    </Chip>
                  ))}
                </div>
              </Field>
            </>
          )}

          {type === 'bike' && (
            <div className="grid grid-cols-2 items-end gap-3">
              <Segmented
                value={indoor ? 'in' : 'out'}
                onChange={(v) => setIndoor(v === 'in')}
                options={[
                  { value: 'in', label: 'Innendørs' },
                  { value: 'out', label: 'Ute' },
                ]}
              />
              <Field label="Snittwatt" hint="W">
                <input className="input num" inputMode="numeric" placeholder="–" value={power} onChange={(e) => setPower(e.target.value)} />
              </Field>
            </div>
          )}

          {type === 'strength' && (
            <StrengthEditor
              mode={strengthMode}
              setMode={setStrengthMode}
              exercises={exercises}
              setExercises={setExercises}
              homeDone={homeDone}
              setHomeDone={setHomeDone}
            />
          )}

          <Field label="Opplevd anstrengelse" hint="1 = svært lett · 10 = maks">
            <ScaleInput value={rpe} onChange={setRpe} min={1} max={10} colorFor={rpeColor} />
          </Field>

          {type === 'run' && (
            <div className="rounded-2xl border border-line bg-surface p-3.5">
              <Field label="Smerte" hint="0 = ingen · 10 = verst">
                <ScaleInput value={pain} onChange={setPain} min={0} max={10} colorFor={painColor} />
              </Field>
              {pain !== undefined && pain > 0 && (
                <div className="mt-4 space-y-4">
                  <Field label="Hvor?">
                    <div className="flex flex-wrap gap-1.5">
                      {(Object.keys(PAIN_LOCATION_LABEL) as PainLocation[]).map((l) => (
                        <Chip
                          key={l}
                          active={painLocs.includes(l)}
                          onClick={() => setPainLocs(painLocs.includes(l) ? painLocs.filter((x) => x !== l) : [...painLocs, l])}
                        >
                          {PAIN_LOCATION_LABEL[l]}
                        </Chip>
                      ))}
                    </div>
                  </Field>
                  <Segmented
                    value={painTiming}
                    onChange={setPainTiming}
                    options={[
                      { value: 'during', label: 'Under' },
                      { value: 'after', label: 'Etter' },
                      { value: 'both', label: 'Begge' },
                    ]}
                  />
                  <textarea className="input min-h-[70px]" placeholder="Beskriv smerten (valgfritt)" value={painDesc} onChange={(e) => setPainDesc(e.target.value)} />
                  {pain >= 4 && (
                    <p className="rounded-xl bg-danger/10 p-3 text-[13px] leading-relaxed text-danger">
                      Ikke løp gjennom smerte. Vurder å hoppe over neste løpeøkt og følg med på utviklingen. Ved vedvarende smerte bør du få det vurdert av fysioterapeut eller lege.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          <Field label="Kommentar">
            <textarea className="input min-h-[70px]" placeholder="Hvordan gikk det? (valgfritt)" value={comment} onChange={(e) => setComment(e.target.value)} />
          </Field>

          {error && <p className="rounded-xl bg-danger/10 p-3 text-[14px] text-danger">{error}</p>}
        </div>
      )}
    </Sheet>
  );
}

function StrengthEditor({
  mode, setMode, exercises, setExercises, homeDone, setHomeDone,
}: {
  mode: StrengthMode;
  setMode: (m: StrengthMode) => void;
  exercises: StrengthExercise[];
  setExercises: (e: StrengthExercise[]) => void;
  homeDone: string[];
  setHomeDone: (n: string[]) => void;
}) {
  return (
    <div className="space-y-3">
      <Segmented
        value={mode}
        onChange={setMode}
        options={[
          { value: 'home', label: 'Hjemme' },
          { value: 'gym', label: 'Treningssenter' },
        ]}
      />
      {mode === 'home' ? (
        <div className="divide-y divide-line rounded-2xl border border-line bg-surface">
          {HOME_STRENGTH_PROGRAM.map((e) => {
            const on = homeDone.includes(e.name);
            return (
              <button
                key={e.name}
                type="button"
                className="flex w-full items-center gap-3 px-3.5 py-3 text-left"
                onClick={() => setHomeDone(on ? homeDone.filter((n) => n !== e.name) : [...homeDone, e.name])}
              >
                <span className={cx('flex h-5 w-5 shrink-0 items-center justify-center rounded-md border', on ? 'border-strength bg-strength text-bg' : 'border-line')}>
                  {on && '✓'}
                </span>
                <span className="flex-1 text-[14px]">{e.name}</span>
                <span className="num text-[12px] text-muted">
                  {e.sets}×{e.reps}
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="space-y-2">
          {exercises.map((ex, i) => (
            <div key={i} className="rounded-xl border border-line bg-surface p-2.5">
              <div className="flex gap-2">
                <input className="input flex-1 py-2" placeholder="Øvelse" value={ex.name} onChange={(e) => setExercises(exercises.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                <button className="px-2 text-dim" onClick={() => setExercises(exercises.filter((_, j) => j !== i))} aria-label="Fjern">
                  <Trash2 size={16} />
                </button>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2">
                <input className="input num py-2" inputMode="numeric" placeholder="Sett" value={ex.sets ?? ''} onChange={(e) => setExercises(exercises.map((x, j) => (j === i ? { ...x, sets: parseNum(e.target.value) } : x)))} />
                <input className="input num py-2" placeholder="Reps" value={ex.reps ?? ''} onChange={(e) => setExercises(exercises.map((x, j) => (j === i ? { ...x, reps: e.target.value } : x)))} />
                <input className="input num py-2" placeholder="Vekt" value={ex.load ?? ''} onChange={(e) => setExercises(exercises.map((x, j) => (j === i ? { ...x, load: e.target.value } : x)))} />
              </div>
            </div>
          ))}
          <button className="btn-secondary w-full" onClick={() => setExercises([...exercises, { name: '' }])}>
            <Plus size={16} /> Legg til øvelse
          </button>
        </div>
      )}
    </div>
  );
}

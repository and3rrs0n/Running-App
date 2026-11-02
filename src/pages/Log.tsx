import { useMemo, useState } from 'react';
import { Filter, NotebookPen, Plus } from 'lucide-react';
import type { Activity, ActivityType, Surface } from '../db/types';
import { fmtDayShort, fmtMonthKey, monthKey } from '../logic/dates';
import {
  ACTIVITY_COLOR, ACTIVITY_LABEL, PAIN_LOCATION_LABEL, RUN_KIND_LABEL, SURFACE_LABEL, fmtDuration, fmtKm, fmtPace, paceSecPerKm,
} from '../logic/format';
import { useData, useUI } from '../store';
import { Badge, Chip, Empty, Field, PageHeader, cx, painColor } from '../components/ui';

export default function LogPage() {
  const { activities } = useData();
  const { open } = useUI();
  const [type, setType] = useState<ActivityType | 'all'>('all');
  const [surface, setSurface] = useState<Surface | 'all'>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [showFilter, setShowFilter] = useState(false);

  const filtered = useMemo(
    () =>
      activities
        .filter((a) => (type === 'all' || a.type === type) && (surface === 'all' || a.surface === surface) && (!from || a.date >= from) && (!to || a.date <= to))
        .sort((a, b) => (a.date === b.date ? b.createdAt - a.createdAt : a.date < b.date ? 1 : -1)),
    [activities, type, surface, from, to],
  );

  const groups = useMemo(() => {
    const m = new Map<string, Activity[]>();
    for (const a of filtered) {
      const k = monthKey(a.date);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(a);
    }
    return [...m.entries()];
  }, [filtered]);

  const totalKm = filtered.filter((a) => a.type === 'run').reduce((s, a) => s + (a.distanceKm ?? 0), 0);
  const totalSec = filtered.reduce((s, a) => s + (a.durationSec ?? 0), 0);
  const filterActive = surface !== 'all' || from || to;

  return (
    <div className="pb-nav">
      <PageHeader
        title="Treningslogg"
        right={
          <button className="mb-1 flex h-10 w-10 items-center justify-center rounded-full bg-accent text-bg" aria-label="Registrer økt" onClick={() => open({ kind: 'register' })}>
            <Plus size={22} />
          </button>
        }
      />
      <div className="px-4">
        <div className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1">
          <Chip active={type === 'all'} onClick={() => setType('all')}>
            Alle
          </Chip>
          {(['run', 'walk', 'strength', 'bike'] as ActivityType[]).map((t) => (
            <Chip key={t} active={type === t} color={ACTIVITY_COLOR[t]} onClick={() => setType(t)}>
              {ACTIVITY_LABEL[t]}
            </Chip>
          ))}
          <Chip active={!!filterActive || showFilter} onClick={() => setShowFilter(!showFilter)}>
            <Filter size={13} /> Filter
          </Chip>
        </div>

        {showFilter && (
          <div className="card mt-3 space-y-3 p-3.5">
            <Field label="Underlag (løping)">
              <div className="flex flex-wrap gap-1.5">
                <Chip active={surface === 'all'} onClick={() => setSurface('all')}>
                  Alle
                </Chip>
                {(Object.keys(SURFACE_LABEL) as Surface[]).map((s) => (
                  <Chip key={s} active={surface === s} onClick={() => setSurface(s)}>
                    {SURFACE_LABEL[s]}
                  </Chip>
                ))}
              </div>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Fra">
                <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
              </Field>
              <Field label="Til">
                <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
              </Field>
            </div>
            {filterActive && (
              <button
                className="text-[14px] font-medium text-accent"
                onClick={() => {
                  setSurface('all');
                  setFrom('');
                  setTo('');
                }}
              >
                Nullstill filter
              </button>
            )}
          </div>
        )}

        {filtered.length > 0 && (
          <div className="num mt-3 px-1 text-[13px] text-muted">
            {filtered.length} økter · {fmtKm(totalKm)} km løping · {fmtDuration(totalSec)} total tid
          </div>
        )}

        {filtered.length === 0 ? (
          <Empty
            icon={<NotebookPen size={36} />}
            title={activities.length ? 'Ingen økter matcher filteret' : 'Ingen økter registrert ennå'}
            body={activities.length ? undefined : 'Registrer løpeturer, gåturer, styrke og sykling her. Alt lagres lokalt på telefonen.'}
            action={
              !activities.length && (
                <button className="btn-primary" onClick={() => open({ kind: 'register' })}>
                  Registrer første økt
                </button>
              )
            }
          />
        ) : (
          groups.map(([k, acts]) => {
            const km = acts.filter((a) => a.type === 'run').reduce((s, a) => s + (a.distanceKm ?? 0), 0);
            return (
              <div key={k}>
                <div className="mb-2 mt-6 flex items-baseline justify-between px-1">
                  <h2 className="label">{fmtMonthKey(k)}</h2>
                  <span className="num text-[12px] text-dim">{fmtKm(km)} km løping</span>
                </div>
                <div className="space-y-2">
                  {acts.map((a) => (
                    <ActivityCard key={a.id} a={a} onClick={() => open({ kind: 'register', activityId: a.id })} />
                  ))}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export function ActivityCard({ a, onClick }: { a: Activity; onClick: () => void }) {
  const pace = paceSecPerKm(a.distanceKm, a.durationSec);
  const title =
    a.type === 'run' ? (a.runKind ? RUN_KIND_LABEL[a.runKind] : 'Løpetur') : a.type === 'strength' ? (a.strengthMode === 'gym' ? 'Styrke – senter' : 'Styrke – hjemme') : a.type === 'bike' ? (a.indoor ? 'Sykling – inne' : 'Sykling – ute') : 'Gåtur';
  return (
    <button onClick={onClick} className="card flex w-full gap-3 p-3.5 text-left transition active:bg-raised">
      <div className="w-1.5 shrink-0 rounded-full" style={{ background: ACTIVITY_COLOR[a.type] }} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-[15px] font-semibold">{title}</div>
            <div className="text-[12.5px] capitalize text-muted">{fmtDayShort(a.date)}</div>
          </div>
          <div className="flex shrink-0 flex-wrap justify-end gap-1">
            {a.surface && <Badge>{SURFACE_LABEL[a.surface]}</Badge>}
            {a.pain && a.pain.score > 0 && (
              <Badge color={painColor(a.pain.score)}>
                Smerte {a.pain.score}
                {a.pain.locations[0] ? ` · ${PAIN_LOCATION_LABEL[a.pain.locations[0]].split(' ')[0].toLowerCase()}` : ''}
              </Badge>
            )}
          </div>
        </div>
        <div className={cx('num mt-2 grid gap-2 text-[14px]', a.type === 'strength' ? 'grid-cols-3' : 'grid-cols-4')}>
          {a.type !== 'strength' && <Cell label="km" value={fmtKm(a.distanceKm, 2)} />}
          <Cell label="tid" value={fmtDuration(a.durationSec)} />
          {a.type === 'run' && <Cell label="tempo" value={fmtPace(pace)} />}
          {a.type !== 'run' && a.type !== 'strength' && <Cell label="høyde" value={a.elevationM !== undefined ? `${a.elevationM}` : '–'} />}
          {a.type === 'strength' && <Cell label="øvelser" value={String(a.exercises?.length ?? 0)} />}
          <Cell label={a.type === 'run' ? 'puls' : 'RPE'} value={a.type === 'run' ? (a.avgHr ? String(a.avgHr) : '–') : a.rpe ? String(a.rpe) : '–'} />
        </div>
        {a.type === 'run' && (a.elevationM || a.rpe) ? (
          <div className="num mt-1.5 text-[12px] text-dim">
            {a.elevationM ? `${a.elevationM} hm` : ''}
            {a.elevationM && a.rpe ? ' · ' : ''}
            {a.rpe ? `anstrengelse ${a.rpe}/10` : ''}
          </div>
        ) : null}
        {a.comment && <p className="mt-1.5 line-clamp-2 text-[13px] text-muted">{a.comment}</p>}
      </div>
    </button>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-semibold">{value}</div>
      <div className="text-[11px] text-dim">{label}</div>
    </div>
  );
}

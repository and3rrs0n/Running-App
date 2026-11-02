import { useMemo, useState } from 'react';
import { Flag, Lock, Mountain, SlidersHorizontal, TrendingUp } from 'lucide-react';
import type { ISODate } from '../db/types';
import { addDays, fmtShort, isoWeekNumber, MONTHS_SHORT, mondayOf, today } from '../logic/dates';
import { PHASE_NAMES, SURFACE_LABEL, fmtKm, fmtPace, phaseFor } from '../logic/format';
import { activeWeekStreak, aggregateMonths, aggregateWeeks, efficiency, sum } from '../logic/stats';
import { useProjection } from '../hooks';
import { useData, useUI } from '../store';
import { BarChart, LineChart } from '../components/charts';
import { Badge, Card, Chip, PageHeader, ProgressBar, SectionTitle, Stat, cx } from '../components/ui';

type Section = 'volum' | 'hoyde' | 'konsistens' | 'prestasjon' | 'veikart';
type Period = '8' | '12' | '26' | '52' | 'all';

const SECTIONS: { v: Section; l: string }[] = [
  { v: 'veikart', l: 'Veikart' },
  { v: 'volum', l: 'Volum' },
  { v: 'hoyde', l: 'Høyde' },
  { v: 'konsistens', l: 'Kontinuitet' },
  { v: 'prestasjon', l: 'Prestasjon' },
];
const PERIODS: { v: Period; l: string }[] = [
  { v: '8', l: '8 uker' },
  { v: '12', l: '12 uker' },
  { v: '26', l: '6 mnd' },
  { v: '52', l: '1 år' },
  { v: 'all', l: 'Alt' },
];

const MILESTONES = [10, 15, 20, 30, 40, 50];

export default function ProgressPage() {
  const data = useData();
  const { activities, sessions, weeks, settings } = data;
  const [section, setSection] = useState<Section>('veikart');
  const [period, setPeriod] = useState<Period>('12');
  const t = today();

  const from: ISODate = useMemo(() => {
    if (period === 'all') {
      const firsts = [activities[0]?.date, weeks[0]?.monday].filter(Boolean) as string[];
      const f = firsts.sort()[0] ?? addDays(t, -7 * 8);
      return mondayOf(f < addDays(t, -7 * 8) ? f : addDays(t, -7 * 7));
    }
    return addDays(mondayOf(t), -7 * (Number(period) - 1));
  }, [period, activities, weeks, t]);

  const wk = useMemo(() => aggregateWeeks(from, t, activities, sessions, weeks), [from, t, activities, sessions, weeks]);
  const label = (m: string) => {
    const d = new Date(m + 'T12:00:00');
    return wk.length > 14 ? `${d.getDate()}.${d.getMonth() + 1}` : `u${isoWeekNumber(m)}`;
  };
  const months = useMemo(() => aggregateMonths(activities, sessions, from.slice(0, 7), t.slice(0, 7)), [activities, sessions, from, t]);

  return (
    <div className="pb-nav">
      <PageHeader title="Progresjon" />
      <div className="px-4">
        <div className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4">
          {SECTIONS.map((s) => (
            <Chip key={s.v} active={section === s.v} onClick={() => setSection(s.v)}>
              {s.l}
            </Chip>
          ))}
        </div>
        {section !== 'veikart' && (
          <div className="mt-3 flex gap-1 rounded-xl border border-line bg-surface p-1">
            {PERIODS.map((p) => (
              <button key={p.v} onClick={() => setPeriod(p.v)} className={cx('flex-1 rounded-lg py-1.5 text-[12.5px] font-semibold', period === p.v ? 'bg-raised text-ink' : 'text-muted')}>
                {p.l}
              </button>
            ))}
          </div>
        )}

        {section === 'veikart' && <Roadmap />}

        {section === 'volum' && (
          <>
            <VolumeTotals wk={wk} />
            <SectionTitle>Løpekilometer per uke</SectionTitle>
            <Card>
              <BarChart
                data={wk.map((w) => ({ label: label(w.monday), value: w.runKm, planned: w.plannedRunKm || undefined, highlight: w.monday === mondayOf(t) }))}
              />
              <Legend items={[['#3ee0a1', 'Løpt'], ['outline', 'Planlagt']]} />
            </Card>
            <SectionTitle>Per måned</SectionTitle>
            <Card>
              <BarChart data={months.map((m) => ({ label: MONTHS_SHORT[Number(m.key.slice(5)) - 1], value: m.runKm, planned: m.plannedRunKm || undefined }))} />
            </Card>
            <SectionTitle>Underlag</SectionTitle>
            <SurfaceBreakdown wk={wk} />
            <p className="mt-3 px-1 text-[12px] leading-relaxed text-dim">Gåturer og sykling teller ikke som løpekilometer.</p>
          </>
        )}

        {section === 'hoyde' && (
          <>
            <div className="mt-4 grid grid-cols-3 gap-2">
              <Card className="p-3">
                <Stat label="Totalt" value={Math.round(sum(wk.map((w) => w.elevation))).toLocaleString('nb-NO')} unit="m" />
              </Card>
              <Card className="p-3">
                <Stat label="Snitt/uke" value={Math.round(sum(wk.map((w) => w.elevation)) / Math.max(1, wk.length))} unit="m" />
              </Card>
              <Card className="p-3">
                <Stat label="Per km" value={(() => { const km = sum(wk.map((w) => w.runKm)); return km ? Math.round(sum(wk.map((w) => w.elevation)) / km) : '–'; })()} unit="m" />
              </Card>
            </div>
            <SectionTitle>Høydemeter per uke (løping)</SectionTitle>
            <Card>
              <BarChart color="#c9a7ff" unit="m" format={(v) => String(Math.round(v))} data={wk.map((w) => ({ label: label(w.monday), value: w.elevation }))} />
            </Card>
            <SectionTitle>Per måned</SectionTitle>
            <Card>
              <BarChart color="#c9a7ff" unit="m" format={(v) => String(Math.round(v))} data={months.map((m) => ({ label: MONTHS_SHORT[Number(m.key.slice(5)) - 1], value: m.elevation }))} />
            </Card>
            <p className="mt-3 px-1 text-[12px] leading-relaxed text-dim">
              Høydemeter bygges gradvis. Løp rolig oppover og gå gjerne ned bratte bakker for å skåne legger og knær. Tirsdagsturen teller ikke her.
            </p>
          </>
        )}

        {section === 'konsistens' && <Consistency wk={wk} label={label} />}

        {section === 'prestasjon' && <Performance from={from} label={label} wk={wk} />}

        <div className="h-4" />
      </div>
    </div>
  );

  function VolumeTotals({ wk }: { wk: ReturnType<typeof aggregateWeeks> }) {
    const total = sum(wk.map((w) => w.runKm));
    const planned = sum(wk.filter((w) => w.monday < mondayOf(t)).map((w) => w.plannedRunKm));
    const done = sum(wk.filter((w) => w.monday < mondayOf(t)).map((w) => w.runKm));
    return (
      <div className="mt-4 grid grid-cols-3 gap-2">
        <Card className="p-3">
          <Stat label="Totalt" value={fmtKm(total)} unit="km" />
        </Card>
        <Card className="p-3">
          <Stat label="Snitt/uke" value={fmtKm(total / Math.max(1, wk.length))} unit="km" />
        </Card>
        <Card className="p-3">
          <Stat label="Av plan" value={planned ? Math.round((done / planned) * 100) : '–'} unit={planned ? '%' : ''} sub="fullførte uker" />
        </Card>
      </div>
    );
  }

  function SurfaceBreakdown({ wk }: { wk: ReturnType<typeof aggregateWeeks> }) {
    const totals: Record<string, number> = {};
    for (const w of wk) for (const [k, v] of Object.entries(w.surfaces)) totals[k] = (totals[k] ?? 0) + (v ?? 0);
    const all = sum(Object.values(totals));
    const colors: Record<string, string> = { asphalt: '#8b93a1', gravel: '#e0c36b', trail: '#3ee0a1', treadmill: '#7aa8ff', other: '#c58bff' };
    if (!all) return <Card><div className="text-[14px] text-dim">Ingen løpeturer i perioden.</div></Card>;
    return (
      <Card>
        <div className="flex h-3 overflow-hidden rounded-full">
          {Object.entries(totals).map(([k, v]) => (
            <div key={k} style={{ width: `${(v / all) * 100}%`, background: colors[k] }} />
          ))}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-y-1.5 text-[13px]">
          {Object.entries(totals)
            .sort((a, b) => b[1] - a[1])
            .map(([k, v]) => (
              <div key={k} className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: colors[k] }} />
                <span className="text-muted">{SURFACE_LABEL[k as keyof typeof SURFACE_LABEL]}</span>
                <span className="num ml-auto pr-3">{Math.round((v / all) * 100)} %</span>
              </div>
            ))}
        </div>
        {(totals.asphalt ?? 0) / all > 0.7 && (
          <p className="mt-3 text-[12.5px] leading-relaxed text-warn">Over 70 % asfalt. Bytt inn grus eller sti der føret tillater det.</p>
        )}
      </Card>
    );
  }

  function Consistency({ wk, label }: { wk: ReturnType<typeof aggregateWeeks>; label: (m: string) => string }) {
    const streak = activeWeekStreak(activities);
    const done = wk.filter((w) => w.monday < mondayOf(t));
    const freq = sum(done.map((w) => w.runs)) / Math.max(1, done.length);
    const onPlan = done.filter((w) => w.plannedRuns > 0 && w.runs >= w.plannedRuns).length;
    const withPlan = done.filter((w) => w.plannedRuns > 0).length;
    return (
      <>
        <div className="mt-4 grid grid-cols-3 gap-2">
          <Card className="p-3">
            <Stat label="Aktive uker" value={streak} sub="på rad" />
          </Card>
          <Card className="p-3">
            <Stat label="Løp/uke" value={fmtKm(freq)} sub="snitt" />
          </Card>
          <Card className="p-3">
            <Stat label="Uker i rute" value={withPlan ? `${onPlan}/${withPlan}` : '–'} sub="alle løp gjort" />
          </Card>
        </div>
        <SectionTitle>Løpeøkter per uke</SectionTitle>
        <Card>
          <BarChart unit="økter" format={(v) => String(Math.round(v * 10) / 10)} data={wk.map((w) => ({ label: label(w.monday), value: w.runs, planned: w.plannedRuns || undefined }))} />
        </Card>
        <SectionTitle>Alle aktiviteter per uke</SectionTitle>
        <Card>
          <div className="space-y-1.5">
            {wk.slice(-8).map((w) => (
              <div key={w.monday} className="flex items-center gap-2 text-[12.5px]">
                <span className="num w-12 shrink-0 text-dim">{label(w.monday)}</span>
                <div className="flex flex-1 gap-1">
                  {Array.from({ length: w.runs }).map((_, i) => <span key={'r' + i} className="h-3 flex-1 max-w-[28px] rounded bg-run" />)}
                  {Array.from({ length: w.walks }).map((_, i) => <span key={'w' + i} className="h-3 flex-1 max-w-[28px] rounded bg-walk" />)}
                  {Array.from({ length: w.strength }).map((_, i) => <span key={'s' + i} className="h-3 flex-1 max-w-[28px] rounded bg-strength" />)}
                  {w.bikeMinutes > 0 && <span className="h-3 flex-1 max-w-[28px] rounded bg-bike" />}
                </div>
              </div>
            ))}
          </div>
          <Legend items={[['#3ee0a1', 'Løping'], ['#7aa8ff', 'Gåtur'], ['#f5b452', 'Styrke'], ['#c58bff', 'Sykling']]} />
        </Card>
        <SectionTitle>Total belastning</SectionTitle>
        <Card>
          <BarChart color="#f5b452" unit="poeng" format={(v) => String(Math.round(v))} data={wk.map((w) => ({ label: label(w.monday), value: w.load }))} />
          <p className="mt-2 text-[12px] leading-relaxed text-dim">
            Minutter × opplevd anstrengelse for alle aktiviteter, inkludert gåturer og styrke. Brå hopp i belastning er en vanlig årsak til overbelastning.
          </p>
        </Card>
      </>
    );
  }

  function Performance({ from, label, wk }: { from: ISODate; label: (m: string) => string; wk: ReturnType<typeof aggregateWeeks> }) {
    const runs = activities.filter((a) => a.type === 'run' && a.date >= from && a.distanceKm && a.durationSec && (!a.runKind || a.runKind === 'easy' || a.runKind === 'long'));
    const perRun = runs.length <= 30;
    const points = perRun
      ? runs.map((a) => ({ label: fmtShort(a.date), value: a.durationSec! / a.distanceKm!, value2: a.avgHr }))
      : wk.map((w) => ({ label: label(w.monday), value: w.avgPace, value2: w.avgHr }));
    const eff = perRun
      ? runs.map((a) => ({ label: fmtShort(a.date), value: efficiency(a) }))
      : wk.map((w) => {
          const rs = runs.filter((a) => a.date >= w.monday && a.date <= addDays(w.monday, 6));
          const e = rs.map(efficiency).filter((x): x is number => x !== undefined);
          return { label: label(w.monday), value: e.length ? sum(e) / e.length : undefined };
        });
    const dist = perRun ? runs.map((a) => ({ label: fmtShort(a.date), value: a.distanceKm })) : wk.map((w) => ({ label: label(w.monday), value: w.runs ? w.runKm / w.runs : undefined }));
    const avgPace = runs.length ? sum(runs.map((a) => a.durationSec!)) / sum(runs.map((a) => a.distanceKm!)) : undefined;
    const hrRuns = runs.filter((a) => a.avgHr);
    const avgHr = hrRuns.length ? sum(hrRuns.map((a) => a.avgHr!)) / hrRuns.length : undefined;
    return (
      <>
        <div className="mt-4 grid grid-cols-3 gap-2">
          <Card className="p-3">
            <Stat label="Snittempo" value={fmtPace(avgPace)} unit="/km" />
          </Card>
          <Card className="p-3">
            <Stat label="Snittpuls" value={avgHr ? Math.round(avgHr) : '–'} />
          </Card>
          <Card className="p-3">
            <Stat label="Turer" value={runs.length} />
          </Card>
        </div>
        <SectionTitle>Tempo og puls {perRun ? '(per tur)' : '(per uke)'}</SectionTitle>
        <Card>
          <LineChart data={points} invert format={fmtPace} name="Tempo" name2="Puls" format2={(v) => String(Math.round(v))} />
        </Card>
        <SectionTitle>Aerob effektivitet</SectionTitle>
        <Card>
          <LineChart data={eff} color="#7aa8ff" name="Meter per hjerteslag" format={(v) => v.toFixed(2)} />
          <p className="mt-2 text-[12px] leading-relaxed text-dim">
            Fart delt på puls. Stigende kurve over tid tyder på bedre aerob form. Raskere tempo alene betyr ikke bedre form – underlag, høydemeter, vær og dagsform påvirker tallene. Sammenlign turer under like forhold.
          </p>
        </Card>
        <SectionTitle>Distanse {perRun ? 'per tur' : '(snitt per tur)'}</SectionTitle>
        <Card>
          <LineChart data={dist} color="#3ee0a1" name="km" format={(v) => fmtKm(v)} />
        </Card>
      </>
    );
  }

  function Roadmap() {
    const { open } = useUI();
    const proj = useProjection(data, 52);
    const thisMonday = mondayOf(t);
    const cur = weeks.find((w) => w.monday === thisMonday);
    const next = weeks.find((w) => w.monday === addDays(thisMonday, 7));
    const hist = aggregateWeeks(addDays(thisMonday, -7 * 11), t, activities, sessions, weeks);
    const last4 = hist.slice(-5, -1);
    const avg4 = sum(last4.map((w) => w.runKm)) / 4;
    const level = cur?.targetKm ?? proj[0]?.targetKm ?? settings.startWeeklyKm;
    const phase = phaseFor(level);
    const goal = settings.longTermGoalKm;
    const milestones = Array.from(new Set([...MILESTONES.filter((m) => m < goal), goal]));
    const reachedIdx = milestones.filter((m) => avg4 >= m * 0.95).length - 1;
    const chart = [
      ...hist.map((w) => ({ label: `u${isoWeekNumber(w.monday)}`, value: w.runKm, planned: w.plannedRunKm || undefined, highlight: w.monday === thisMonday })),
      ...proj.slice(0, 12).map((p) => ({ label: `u${isoWeekNumber(p.monday)}`, value: p.targetKm, projected: true })),
    ];

    return (
      <>
        <Card className="mt-4 bg-gradient-to-br from-accent/10 via-surface to-surface">
          <div className="flex items-start justify-between">
            <div>
              <div className="label">Nåværende fase</div>
              <div className="mt-1 text-[22px] font-semibold tracking-tight">{PHASE_NAMES[phase]}</div>
              <div className="text-[13px] text-muted">Fase {phase} av 5</div>
            </div>
            <TrendingUp className="text-accent" size={26} />
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2">
            <Stat label="Denne uken" value={fmtKm(hist[hist.length - 1]?.runKm ?? 0)} unit="km" />
            <Stat label="Snitt 4 uker" value={fmtKm(avg4)} unit="km" />
            <Stat label="Ukemål" value={fmtKm(level)} unit="km" />
          </div>
          <div className="mt-4">
            <ProgressBar value={avg4} max={goal} marker={level} />
            <div className="mt-1 flex justify-between text-[11px] text-dim">
              <span>0</span>
              <span className="num">{goal} km/uke</span>
            </div>
          </div>
        </Card>

        <SectionTitle>Milepæler</SectionTitle>
        <Card className="p-0">
          {milestones.map((m, i) => {
            const reached = i <= reachedIdx;
            const isNext = i === reachedIdx + 1;
            return (
              <div key={m} className={cx('flex items-center gap-3 px-4 py-3', i > 0 && 'border-t border-line')}>
                <div
                  className={cx(
                    'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-[12px] font-bold',
                    reached ? 'border-transparent bg-accent text-bg' : isNext ? 'border-accent text-accent' : 'border-line text-dim',
                  )}
                >
                  {m === goal ? <Flag size={14} /> : reached ? '✓' : i + 1}
                </div>
                <div className="flex-1">
                  <div className={cx('num text-[15px] font-semibold', !reached && !isNext && 'text-muted')}>{m} km/uke</div>
                  <div className="text-[12.5px] text-dim">{milestoneText(m)}</div>
                </div>
                {reached && <Badge color="#3ee0a1">Nådd</Badge>}
                {isNext && <Badge color="#7aa8ff">Neste</Badge>}
              </div>
            );
          })}
        </Card>
        <p className="mt-2 px-1 text-[12px] leading-relaxed text-dim">
          Milepæler, ikke frister. En milepæl regnes som nådd når snittet over fire uker ligger der – uten smertevarsler.
        </p>

        <SectionTitle>Historikk og veien videre</SectionTitle>
        <Card>
          <BarChart data={chart} goal={goal} labelEvery={4} />
          <Legend items={[['#3ee0a1', 'Løpt'], ['outline', 'Planlagt'], ['rgba(62,224,161,0.3)', 'Foreløpig'], ['#7aa8ff', 'Langsiktig mål']]} />
          <p className="mt-2 text-[12px] leading-relaxed text-dim">
            Foreløpige uker forutsetter at alt går etter planen. De justeres ned eller holdes igjen ved smerte, tretthet eller tapte økter.
          </p>
        </Card>

        <SectionTitle>Planen</SectionTitle>
        <div className="space-y-2">
          {[cur, next].map((w, i) =>
            w ? (
              <Card key={w.monday}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="label">{i === 0 ? 'Denne uken' : 'Neste uke'} · plan-uke {w.planWeekNo}</div>
                    <div className="num mt-1 text-[18px] font-semibold">
                      {fmtKm(w.targetKm)} km · {w.runCount} løpeturer
                      {w.longRunKm ? <span className="text-[14px] font-normal text-muted"> · langtur {fmtKm(w.longRunKm)}</span> : null}
                    </div>
                  </div>
                  {w.locked && <Lock size={16} className="mt-1 text-dim" />}
                </div>
                <ul className="mt-2 space-y-1 text-[13.5px] leading-relaxed text-muted">
                  {w.reasons.map((r, j) => (
                    <li key={j}>• {r}</li>
                  ))}
                </ul>
                {(i === 1 || w.monday >= thisMonday) && (
                  <button className="mt-3 flex items-center gap-1.5 text-[14px] font-semibold text-accent" onClick={() => open({ kind: 'override', monday: w.monday })}>
                    <SlidersHorizontal size={15} /> Juster manuelt
                  </button>
                )}
              </Card>
            ) : null,
          )}
          {!cur && !next && (
            <Card>
              <div className="flex gap-3">
                <Mountain className="shrink-0 text-dim" size={20} />
                <p className="text-[14px] leading-relaxed text-muted">
                  Ingen aktive planuker ennå. {settings.readiness !== 'cleared' ? 'Planen starter når du er klarert for løping.' : 'Planen er på pause eller starter senere.'}
                </p>
              </div>
            </Card>
          )}
        </div>
      </>
    );
  }
}

function milestoneText(m: number): string {
  if (m <= 10) return 'Tilbake i gang. Rolige turer, to ganger i uken.';
  if (m <= 15) return 'Stabil rutine. Tredje løpedag kan komme inn.';
  if (m <= 20) return 'Grunnlag. Første lengre tur i uken.';
  if (m <= 30) return 'Utvidet base. Mer terreng og høydemeter.';
  if (m <= 40) return 'Solid base. Enkle intervaller ved god kontinuitet.';
  return 'Bærekraftig volum. Grunnlag for ultra.';
}

function Legend({ items }: { items: [string, string][] }) {
  return (
    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted">
      {items.map(([c, l]) => (
        <span key={l} className="flex items-center gap-1.5">
          {c === 'outline' ? <span className="h-2.5 w-2.5 rounded-sm border border-dashed border-muted" /> : <span className="h-2.5 w-2.5 rounded-sm" style={{ background: c }} />}
          {l}
        </span>
      ))}
    </div>
  );
}

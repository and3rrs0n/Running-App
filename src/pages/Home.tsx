import { AlertTriangle, ArrowRight, BellRing, CalendarCheck, ChevronRight, Info, PauseCircle, Plus, ShieldCheck, Sparkles, X } from 'lucide-react';
import { db } from '../db/db';
import { downloadBackup } from '../db/backup';
import { addDays, cap, diffDays, fmtLong, isoWeekNumber, mondayOf, relativeDay, today, weekday, WEEKDAYS_SHORT } from '../logic/dates';
import { computeAlerts, type Alert } from '../logic/alerts';
import { ACTIVITY_COLOR, PHASE_NAMES, fmtKm, fmtMinutes, phaseFor } from '../logic/format';
import { isOnHold } from '../logic/plan';
import { useProjection } from '../hooks';
import { useData, useUI } from '../store';
import { Card, PageHeader, ProgressBar, Ring, SectionTitle, cx } from '../components/ui';
import { SessionRow } from '../components/Sheets';

const MILESTONES = [10, 15, 20, 30, 40, 50];

export default function Home() {
  const data = useData();
  const { settings, sessions, activities, weeks } = data;
  const { open, go } = useUI();
  const proj = useProjection(data, 4);
  const t = today();
  const monday = mondayOf(t);
  const sunday = addDays(monday, 6);
  const hold = isOnHold(settings);

  const todays = sessions.filter((s) => s.date === t);
  const weekSessions = sessions.filter((s) => s.date >= monday && s.date <= sunday);
  const weekActs = activities.filter((a) => a.date >= monday && a.date <= sunday);
  const runSessions = weekSessions.filter((s) => s.type === 'run');
  const plannedKm = runSessions.reduce((s, x) => s + (x.plannedDistanceKm ?? 0), 0);
  const doneKm = weekActs.filter((a) => a.type === 'run').reduce((s, a) => s + (a.distanceKm ?? 0), 0);
  const doneSessions = weekSessions.filter((s) => s.status === 'completed').length;
  const remaining = weekSessions.filter((s) => s.status === 'planned' && s.date >= t).length;
  const walk = weekSessions.find((s) => s.type === 'walk');
  const walkDone = weekActs.some((a) => a.type === 'walk');
  const strengthPlanned = weekSessions.filter((s) => s.type === 'strength').length;
  const strengthDone = weekActs.filter((a) => a.type === 'strength').length;
  const currentWeek = weeks.find((w) => w.monday === monday);
  const upcoming = sessions.filter((s) => s.date > t && s.status === 'planned').slice(0, 3);

  // Long-term progress uses the average of the last 4 completed weeks (more honest than one week)
  const last4: number[] = [];
  for (let i = 1; i <= 4; i++) {
    const m = addDays(monday, -7 * i);
    last4.push(activities.filter((a) => a.type === 'run' && a.date >= m && a.date <= addDays(m, 6)).reduce((s, a) => s + (a.distanceKm ?? 0), 0));
  }
  const avg4 = last4.reduce((a, b) => a + b, 0) / 4;
  const level = currentWeek?.targetKm ?? proj[0]?.targetKm ?? settings.startWeeklyKm;
  const phase = currentWeek?.phase ?? phaseFor(level);
  const nextMilestone = MILESTONES.find((m) => m > Math.max(avg4, 0)) ?? settings.longTermGoalKm;

  const alerts = computeAlerts(data);

  return (
    <div className="pb-nav">
      <PageHeader subtitle={`${cap(fmtLong(t))} · uke ${isoWeekNumber(t)}`} title="I dag" />
      <div className="px-4">
        {/* Hold / status banner */}
        {settings.readiness !== 'cleared' && (
          <Card className="mb-3 border-warn/30 bg-gradient-to-br from-warn/10 to-transparent">
            <div className="flex gap-3">
              <ShieldCheck className="mt-0.5 shrink-0 text-warn" size={22} />
              <div className="flex-1">
                <div className="font-semibold">Venter på medisinsk klarering</div>
                <p className="mt-1 text-[14px] leading-relaxed text-muted">
                  Planen står på vent til kirurgen har klarert deg for løping. Foreløpig start: {fmtLong(settings.startDate)}.
                  Gåturer og registrering fungerer som normalt.
                </p>
                <button className="btn-primary mt-3 w-full" onClick={() => open({ kind: 'start', mode: 'clear' })}>
                  Jeg er klarert for løping
                </button>
              </div>
            </div>
          </Card>
        )}
        {settings.readiness === 'cleared' && settings.planStatus === 'paused' && (
          <Card className="mb-3">
            <div className="flex gap-3">
              <PauseCircle className="mt-0.5 shrink-0 text-muted" size={22} />
              <div className="flex-1">
                <div className="font-semibold">Planen er på pause</div>
                <p className="mt-1 text-[14px] text-muted">
                  {settings.pausedAt ? `Siden ${fmtLong(settings.pausedAt)}. ` : ''}Historikken din er urørt.
                </p>
                <button className="btn-secondary mt-3 w-full" onClick={() => open({ kind: 'start', mode: 'resume' })}>
                  Gjenoppta planen
                </button>
              </div>
            </div>
          </Card>
        )}
        {!hold && settings.startDate > t && (
          <Card className="mb-3">
            <div className="flex items-center gap-3">
              <CalendarCheck className="shrink-0 text-accent" size={22} />
              <div className="text-[14px]">
                Planen starter <span className="font-semibold">{fmtLong(settings.startDate)}</span> (om {diffDays(settings.startDate, t)} dager).
              </div>
            </div>
          </Card>
        )}

        {/* Today */}
        <SectionTitle>Dagens økt</SectionTitle>
        {todays.length > 0 ? (
          <div className="space-y-2">
            {todays.map((s) => (
              <div key={s.id} className="card overflow-hidden">
                <button className="block w-full p-4 text-left" onClick={() => open({ kind: 'session', id: s.id })}>
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: ACTIVITY_COLOR[s.type] }} />
                    <span className="label">{s.type === 'run' ? 'Løping' : s.type === 'walk' ? 'Gåtur' : s.type === 'strength' ? 'Styrke' : 'Sykling'}</span>
                  </div>
                  <div className="mt-2 text-[22px] font-semibold leading-tight tracking-tight">{s.title}</div>
                  <div className="num mt-1 text-[15px] text-muted">
                    {s.plannedDistanceKm ? `${fmtKm(s.plannedDistanceKm)} km` : ''}
                    {s.plannedDistanceKm && s.plannedDurationMin ? ' · ' : ''}
                    {s.plannedDurationMin ? `ca. ${fmtMinutes(s.plannedDurationMin)}` : ''}
                  </div>
                  {s.description && <p className="mt-2 line-clamp-2 text-[14px] leading-relaxed text-muted">{s.description}</p>}
                </button>
                <div className="border-t border-line p-3">
                  {s.status === 'planned' ? (
                    <button className="btn-primary w-full" onClick={() => open({ kind: 'register', sessionId: s.id })}>
                      Registrer gjennomført
                    </button>
                  ) : s.status === 'completed' ? (
                    <div className="flex items-center justify-center gap-2 py-2 text-[15px] font-semibold text-accent">
                      <Sparkles size={18} /> Gjennomført
                    </div>
                  ) : (
                    <div className="py-2 text-center text-[14px] text-muted">Hoppet over</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Card>
            <div className="font-semibold">{settings.restDays.includes(weekday(t)) ? 'Hviledag' : 'Ingen planlagt økt'}</div>
            <p className="mt-1 text-[14px] text-muted">
              {hold ? 'Planen står på vent.' : 'Hvile er der tilpasningen skjer. Rolig gåtur er alltid lov.'}
            </p>
            {upcoming[0] && (
              <button className="mt-3 flex w-full items-center justify-between rounded-xl bg-raised px-3 py-2.5 text-left text-[14px]" onClick={() => open({ kind: 'session', id: upcoming[0].id })}>
                <span>
                  <span className="text-muted">Neste: </span>
                  {upcoming[0].title} · {relativeDay(upcoming[0].date).toLowerCase()}
                </span>
                <ChevronRight size={16} className="text-dim" />
              </button>
            )}
          </Card>
        )}
        <button className="mt-2 flex w-full items-center justify-center gap-1.5 py-2 text-[14px] font-medium text-muted" onClick={() => open({ kind: 'register' })}>
          <Plus size={16} /> Registrer annen aktivitet
        </button>

        {/* Alerts */}
        {alerts.length > 0 && (
          <>
            <SectionTitle>Varsler</SectionTitle>
            <div className="space-y-2">
              {alerts.map((a) => (
                <AlertCard key={a.id} a={a} />
              ))}
            </div>
          </>
        )}

        {/* Week overview */}
        <SectionTitle right={<button className="text-[13px] font-medium text-accent" onClick={() => go('kalender')}>Kalender</button>}>
          Denne uken
        </SectionTitle>
        <Card>
          <div className="flex items-center gap-4">
            <Ring value={doneKm} max={plannedKm || 1} size={92}>
              <div className="num text-[22px] font-bold leading-none">{fmtKm(doneKm)}</div>
              <div className="num mt-0.5 text-[11px] text-muted">av {fmtKm(plannedKm)} km</div>
            </Ring>
            <div className="grid flex-1 grid-cols-2 gap-x-3 gap-y-3">
              <MiniStat label="Fullført" value={`${doneSessions}`} sub={`av ${weekSessions.length} økter`} />
              <MiniStat label="Gjenstår" value={`${remaining}`} sub="økter" />
              <MiniStat label="Tirsdagstur" value={walkDone ? 'Gått' : walk ? 'Planlagt' : '–'} accent={walkDone ? '#7aa8ff' : undefined} />
              <MiniStat label="Styrke" value={`${strengthDone}/${strengthPlanned || 1}`} accent={strengthDone ? '#f5b452' : undefined} />
            </div>
          </div>
          <WeekStrip monday={monday} />
          {currentWeek && (
            <div className="mt-3 border-t border-line pt-3 text-[13px] text-muted">
              <span className="text-ink">Ukemål {fmtKm(currentWeek.targetKm)} km</span> · {currentWeek.runCount} løpeturer
              {doneKm > plannedKm * 1.15 && plannedKm > 0 && <span className="text-warn"> · Over plan – ingen grunn til å presse mer</span>}
            </div>
          )}
        </Card>

        {/* Long-term progress */}
        <SectionTitle right={<button className="text-[13px] font-medium text-accent" onClick={() => go('progresjon')}>Progresjon</button>}>
          Mot {fmtKm(settings.longTermGoalKm)}+ km/uke
        </SectionTitle>
        <Card onClick={() => go('progresjon')}>
          <div className="flex items-start justify-between">
            <div>
              <div className="label">Fase {phase} av 5</div>
              <div className="mt-1 text-[19px] font-semibold">{PHASE_NAMES[phase]}</div>
            </div>
            <div className="text-right">
              <div className="label">Snitt 4 uker</div>
              <div className="num mt-1 text-[19px] font-semibold">
                {fmtKm(avg4)} <span className="text-[13px] text-muted">km</span>
              </div>
            </div>
          </div>
          <div className="relative mt-4">
            <ProgressBar value={avg4} max={settings.longTermGoalKm} marker={level} />
            <div className="relative mt-1.5 h-4 text-[11px] text-dim">
              {MILESTONES.filter((m) => m <= settings.longTermGoalKm).map((m) => (
                <span
                  key={m}
                  className={cx('num absolute -translate-x-1/2', avg4 >= m && 'text-accent')}
                  style={{ left: `${(m / settings.longTermGoalKm) * 100}%`, transform: m === settings.longTermGoalKm ? 'translateX(-100%)' : undefined }}
                >
                  {m}
                </span>
              ))}
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between text-[13px] text-muted">
            <span>
              Neste milepæl: <span className="text-ink">{nextMilestone} km/uke</span>
            </span>
            <ArrowRight size={16} className="text-dim" />
          </div>
          <div className="mt-1 text-[12px] text-dim">Milepæler, ikke frister. Kontinuitet slår volum.</div>
        </Card>

        {/* Upcoming */}
        {upcoming.length > 0 && (
          <>
            <SectionTitle>Kommende økter</SectionTitle>
            <div className="space-y-2">
              {upcoming.map((s) => (
                <div key={s.id}>
                  <div className="mb-1 ml-1 text-[12px] text-dim">{relativeDay(s.date)}</div>
                  <SessionRow s={s} compact onClick={() => open({ kind: 'session', id: s.id })} />
                </div>
              ))}
            </div>
          </>
        )}

        {hold && proj[0] && (
          <>
            <SectionTitle>Første uke (foreløpig)</SectionTitle>
            <Card>
              <div className="num text-[17px] font-semibold">
                {fmtKm(proj[0].targetKm)} km · {proj[0].runCount} rolige løpeturer
              </div>
              <ul className="mt-2 space-y-1 text-[14px] text-muted">
                {proj[0].reasons.map((r, i) => (
                  <li key={i}>• {r}</li>
                ))}
                <li>• Fast tirsdagstur og én styrkeøkt hjemme. Fredag er hviledag.</li>
              </ul>
            </Card>
          </>
        )}
        <p className="mt-8 px-2 text-center text-[11.5px] leading-relaxed text-dim">
          Appen gir treningsforslag, ikke medisinske råd. Ved smerte eller usikkerhet: kontakt fysioterapeut eller lege.
        </p>
      </div>
    </div>
  );
}

function MiniStat({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div>
      <div className="text-[11px] font-medium uppercase tracking-wide text-dim">{label}</div>
      <div className="num text-[16px] font-semibold" style={accent ? { color: accent } : undefined}>
        {value} {sub && <span className="text-[12px] font-normal text-muted">{sub}</span>}
      </div>
    </div>
  );
}

function WeekStrip({ monday }: { monday: string }) {
  const { sessions, activities, settings } = useData();
  const { open } = useUI();
  const t = today();
  return (
    <div className="mt-4 grid grid-cols-7 gap-1">
      {Array.from({ length: 7 }, (_, i) => {
        const d = addDays(monday, i);
        const ss = sessions.filter((s) => s.date === d);
        const extra = activities.filter((a) => a.date === d && !a.plannedSessionId);
        const isToday = d === t;
        const rest = settings.restDays.includes(i) && ss.length === 0;
        return (
          <button
            key={d}
            onClick={() => open({ kind: 'day', date: d })}
            className={cx('flex flex-col items-center gap-1.5 rounded-xl py-2', isToday ? 'bg-raised' : '')}
          >
            <span className={cx('text-[11px] font-medium', isToday ? 'text-ink' : 'text-dim')}>{WEEKDAYS_SHORT[i]}</span>
            <div className="flex h-3 items-center gap-0.5">
              {ss.map((s) => (
                <span
                  key={s.id}
                  className="h-2.5 w-2.5 rounded-full"
                  style={{
                    background: s.status === 'completed' ? ACTIVITY_COLOR[s.type] : 'transparent',
                    border: `1.5px solid ${ACTIVITY_COLOR[s.type]}`,
                    opacity: s.status === 'skipped' ? 0.3 : s.status === 'planned' && d < t ? 0.5 : 1,
                  }}
                />
              ))}
              {extra.map((a) => (
                <span key={a.id} className="h-2.5 w-2.5 rounded-full" style={{ background: ACTIVITY_COLOR[a.type] }} />
              ))}
              {rest && <span className="text-[10px] text-dim">hvile</span>}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function AlertCard({ a }: { a: Alert }) {
  const { open, go, toast } = useUI();
  const color = a.level === 'danger' ? '#ff6b6b' : a.level === 'warn' ? '#f5b452' : a.level === 'plan' ? '#3ee0a1' : '#7aa8ff';
  const Icon = a.level === 'danger' || a.level === 'warn' ? AlertTriangle : a.level === 'plan' ? BellRing : Info;
  return (
    <div className="card relative p-3.5" style={{ borderColor: color + '40' }}>
      <div className="flex gap-3">
        <Icon size={18} className="mt-0.5 shrink-0" style={{ color }} />
        <div className="min-w-0 flex-1 pr-5">
          <div className="text-[15px] font-semibold">{a.title}</div>
          <p className="mt-0.5 text-[13.5px] leading-relaxed text-muted">{a.body}</p>
          {a.action === 'checkin' && (
            <button
              className="mt-2 text-[14px] font-semibold"
              style={{ color }}
              onClick={() => {
                const wd = weekday(today());
                open({ kind: 'checkin', monday: wd === 6 ? mondayOf(today()) : addDays(mondayOf(today()), -7) });
              }}
            >
              Gjør ukevurdering →
            </button>
          )}
          {a.action === 'backup' && (
            <button
              className="mt-2 text-[14px] font-semibold"
              style={{ color }}
              onClick={async () => {
                await downloadBackup();
                toast('Sikkerhetskopi laget');
              }}
            >
              Eksporter nå →
            </button>
          )}
          {a.action === 'calendar' && (
            <button className="mt-2 text-[14px] font-semibold" style={{ color }} onClick={() => go('kalender')}>
              Gå til kalender →
            </button>
          )}
        </div>
      </div>
      {a.noticeId && (
        <button
          aria-label="Lukk varsel"
          className="absolute right-2 top-2 rounded-full p-1.5 text-dim active:bg-raised"
          onClick={() => db.notices.update(a.noticeId!, { dismissed: true })}
        >
          <X size={16} />
        </button>
      )}
    </div>
  );
}


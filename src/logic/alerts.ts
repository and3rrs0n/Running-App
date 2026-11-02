/** Live alerts for the dashboard, derived from current data. Pure. */
import type { Activity, Notice, PlannedSession, Settings, WeeklyCheckin } from '../db/types';
import { addDays, diffDays, fmtDayShort, mondayOf, today, weekday } from './dates';
import { PAIN_LOCATION_LABEL } from './format';

export type AlertLevel = 'danger' | 'warn' | 'info' | 'plan';

export interface Alert {
  id: string;
  level: AlertLevel;
  title: string;
  body: string;
  action?: 'checkin' | 'backup' | 'settings' | 'calendar';
  noticeId?: string;
}

export function computeAlerts(args: {
  settings: Settings;
  activities: Activity[];
  sessions: PlannedSession[];
  checkins: WeeklyCheckin[];
  notices: Notice[];
}): Alert[] {
  const { settings, activities, sessions, checkins, notices } = args;
  const t = today();
  const out: Alert[] = [];

  // Pain — last 14 days
  const since = addDays(t, -14);
  const painRuns = activities
    .filter((a) => a.type === 'run' && a.date >= since && (a.pain?.score ?? 0) >= 3)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  const highPain = painRuns.filter((a) => (a.pain?.score ?? 0) >= 5);
  const byLoc = new Map<string, number>();
  for (const a of painRuns) for (const l of a.pain!.locations) byLoc.set(l, (byLoc.get(l) ?? 0) + 1);
  const repeatedLoc = [...byLoc.entries()].filter(([, n]) => n >= 2).map(([l]) => l);
  // Rising trend: last three reports increasing
  const lastThree = activities
    .filter((a) => a.type === 'run' && a.date >= since && a.pain)
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .slice(-3)
    .map((a) => a.pain!.score);
  const rising = lastThree.length === 3 && lastThree[0] < lastThree[1] && lastThree[1] < lastThree[2] && lastThree[2] >= 3;

  if (painRuns.length >= 1) {
    const locs = repeatedLoc.length ? repeatedLoc : Array.from(byLoc.keys());
    const locText = locs.map((l) => PAIN_LOCATION_LABEL[l as keyof typeof PAIN_LOCATION_LABEL].toLowerCase()).join(', ');
    const shin = locs.includes('shin');
    out.push({
      id: 'pain',
      level: highPain.length || rising || repeatedLoc.length ? 'danger' : 'warn',
      title: rising ? 'Økende smerte' : repeatedLoc.length ? 'Gjentatt smerte' : highPain.length ? 'Smertevarsel' : painRuns.length >= 2 ? 'Smerte registrert flere ganger' : 'Smerte registrert',
      body:
        `${painRuns.length} løpeøkt${painRuns.length === 1 ? '' : 'er'} med smerte 3/10 eller mer siste 14 dager${locText ? ` (${locText})` : ''}. ` +
        (shin ? 'Du har historikk med plager i leggen – ta dette på alvor. ' : '') +
        'Hold igjen eller reduser, ikke løp gjennom smerte, og få det vurdert av fysioterapeut eller lege hvis det vedvarer. Appen stiller ingen diagnose.',
    });
  }

  // Missed sessions (this week and last week)
  const fromMissed = addDays(mondayOf(t), -7);
  const missed = sessions.filter(
    (s) => s.status === 'planned' && s.date < t && s.date >= fromMissed && s.type !== 'rest',
  );
  if (missed.length) {
    out.push({
      id: 'missed',
      level: 'warn',
      title: `${missed.length} økt${missed.length === 1 ? '' : 'er'} ikke registrert`,
      body:
        missed.map((s) => `${s.title} (${fmtDayShort(s.date)})`).join(', ') +
        '. Registrer hvis du gjennomførte, eller marker som hoppet over. Ikke ta igjen tapte kilometer – planen tilpasser seg.',
      action: 'calendar',
    });
  }

  // Weekly check-in prompt: Sunday for this week, or Mon–Wed for last week
  const wd = weekday(t);
  const ciMonday = wd === 6 ? mondayOf(t) : wd <= 2 ? addDays(mondayOf(t), -7) : null;
  if (ciMonday && !checkins.some((c) => c.monday === ciMonday)) {
    const hadTraining = activities.some((a) => a.date >= ciMonday && a.date <= addDays(ciMonday, 6));
    if (hadTraining) {
      out.push({
        id: 'checkin',
        level: 'info',
        title: 'Ukevurdering',
        body: 'Hvordan har kroppen respondert på treningen denne uken? Det tar fem sekunder og påvirker neste ukes plan.',
        action: 'checkin',
      });
    }
  }

  // Backup reminder
  if (activities.length >= 3) {
    const days = settings.lastBackupAt ? diffDays(t, new Date(settings.lastBackupAt).toISOString().slice(0, 10)) : 999;
    if (days >= 14) {
      out.push({
        id: 'backup',
        level: 'info',
        title: settings.lastBackupAt ? `Siste sikkerhetskopi: ${days} dager siden` : 'Ta en sikkerhetskopi',
        body: 'Dataene dine ligger kun på denne telefonen. Eksporter en sikkerhetskopi og lagre den i Filer eller iCloud.',
        action: 'backup',
      });
    }
  }

  // Plan notices (undismissed)
  for (const n of notices.filter((n) => !n.dismissed).sort((a, b) => b.createdAt - a.createdAt).slice(0, 3)) {
    out.push({
      id: 'notice-' + n.id,
      level: n.kind === 'pain' ? 'danger' : n.kind === 'warning' ? 'warn' : n.kind === 'plan' ? 'plan' : 'info',
      title: n.title,
      body: n.body,
      noticeId: n.id,
    });
  }

  return out;
}

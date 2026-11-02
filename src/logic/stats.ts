/** Aggregations for dashboard and progress charts. Pure. */
import type { Activity, ISODate, PlannedSession, PlanWeek, Surface } from '../db/types';
import { addDays, mondayOf, monthKey, today } from './dates';

export interface WeekAgg {
  monday: ISODate;
  runKm: number;
  plannedRunKm: number;
  targetKm?: number;
  runs: number;
  plannedRuns: number;
  elevation: number;
  runMinutes: number;
  walkKm: number;
  walks: number;
  strength: number;
  bikeMinutes: number;
  load: number; // session-RPE load: minutes × RPE, all activities
  avgPace?: number;
  avgHr?: number;
  maxPain: number;
  surfaces: Partial<Record<Surface, number>>;
}

const DEFAULT_RPE: Record<string, number> = { run: 4, walk: 3, strength: 5, bike: 4 };

export function activityLoad(a: Activity): number {
  const min = (a.durationSec ?? 0) / 60;
  return min * (a.rpe ?? DEFAULT_RPE[a.type] ?? 4);
}

export function aggregateWeeks(
  from: ISODate,
  to: ISODate,
  activities: Activity[],
  sessions: PlannedSession[],
  weeks: PlanWeek[],
): WeekAgg[] {
  const out: WeekAgg[] = [];
  const weekMap = new Map(weeks.map((w) => [w.monday, w]));
  for (let m = mondayOf(from); m <= to; m = addDays(m, 7)) {
    const end = addDays(m, 6);
    const acts = activities.filter((a) => a.date >= m && a.date <= end);
    const runs = acts.filter((a) => a.type === 'run');
    const ss = sessions.filter((s) => s.date >= m && s.date <= end && s.type === 'run');
    const runKm = sum(runs.map((a) => a.distanceKm ?? 0));
    const runSec = sum(runs.map((a) => a.durationSec ?? 0));
    const paced = runs.filter((a) => a.distanceKm && a.durationSec);
    const pacedKm = sum(paced.map((a) => a.distanceKm!));
    const hrRuns = runs.filter((a) => a.avgHr && a.durationSec);
    const surfaces: Partial<Record<Surface, number>> = {};
    for (const r of runs) {
      const k = r.surface ?? 'other';
      surfaces[k] = (surfaces[k] ?? 0) + (r.distanceKm ?? 0);
    }
    out.push({
      monday: m,
      runKm,
      plannedRunKm: sum(ss.map((s) => s.plannedDistanceKm ?? 0)),
      targetKm: weekMap.get(m)?.targetKm,
      runs: runs.length,
      plannedRuns: ss.length,
      elevation: sum(runs.map((a) => a.elevationM ?? 0)),
      runMinutes: runSec / 60,
      walkKm: sum(acts.filter((a) => a.type === 'walk').map((a) => a.distanceKm ?? 0)),
      walks: acts.filter((a) => a.type === 'walk').length,
      strength: acts.filter((a) => a.type === 'strength').length,
      bikeMinutes: sum(acts.filter((a) => a.type === 'bike').map((a) => (a.durationSec ?? 0) / 60)),
      load: sum(acts.map(activityLoad)),
      avgPace: pacedKm > 0 ? sum(paced.map((a) => a.durationSec!)) / pacedKm : undefined,
      avgHr: hrRuns.length
        ? sum(hrRuns.map((a) => a.avgHr! * a.durationSec!)) / sum(hrRuns.map((a) => a.durationSec!))
        : undefined,
      maxPain: Math.max(0, ...runs.map((a) => a.pain?.score ?? 0)),
      surfaces,
    });
  }
  return out;
}

export interface MonthAgg {
  key: string;
  runKm: number;
  plannedRunKm: number;
  elevation: number;
  runs: number;
}

export function aggregateMonths(activities: Activity[], sessions: PlannedSession[], fromKey: string, toKey: string): MonthAgg[] {
  const keys: string[] = [];
  let [y, m] = fromKey.split('-').map(Number);
  const [ty, tm] = toKey.split('-').map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    keys.push(`${y}-${String(m).padStart(2, '0')}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return keys.map((key) => {
    const runs = activities.filter((a) => a.type === 'run' && monthKey(a.date) === key);
    return {
      key,
      runKm: sum(runs.map((a) => a.distanceKm ?? 0)),
      plannedRunKm: sum(sessions.filter((s) => s.type === 'run' && monthKey(s.date) === key).map((s) => s.plannedDistanceKm ?? 0)),
      elevation: sum(runs.map((a) => a.elevationM ?? 0)),
      runs: runs.length,
    };
  });
}

/** Consecutive weeks (ending this or last week) with at least one run. */
export function activeWeekStreak(activities: Activity[]): number {
  const runWeeks = new Set(activities.filter((a) => a.type === 'run').map((a) => mondayOf(a.date)));
  let m = mondayOf(today());
  if (!runWeeks.has(m)) m = addDays(m, -7); // current week may still be in progress
  let n = 0;
  while (runWeeks.has(m)) {
    n++;
    m = addDays(m, -7);
  }
  return n;
}

/** Simple aerobic efficiency: metres per heartbeat (speed / HR). Only for easy runs with HR. */
export function efficiency(a: Activity): number | undefined {
  if (!a.distanceKm || !a.durationSec || !a.avgHr) return undefined;
  const speedMpm = (a.distanceKm * 1000) / (a.durationSec / 60);
  return speedMpm / a.avgHr;
}

export function sum(xs: number[]): number {
  return xs.reduce((s, x) => s + x, 0);
}

export function movingAvg(xs: (number | undefined)[], n: number): (number | undefined)[] {
  return xs.map((_, i) => {
    const win = xs.slice(Math.max(0, i - n + 1), i + 1).filter((v): v is number => v !== undefined);
    return win.length ? sum(win) / win.length : undefined;
  });
}

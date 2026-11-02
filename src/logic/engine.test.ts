import { describe, expect, it, beforeEach } from 'vitest';
import { decide, project, type HistWeek } from './engine';
import { buildWeekSessions, pickSpreadDays } from './scheduler';
import { DEFAULT_SETTINGS, db } from '../db/db';
import { addDays, setTodayOverride } from './dates';
import {
  syncPlan, saveActivity, pausePlan, resumePlan, setReadiness, rescheduleFrom, overrideWeek,
} from './plan';

const S = DEFAULT_SETTINGS;

function hw(monday: string, targetKm: number, kind: HistWeek['kind'], completion = 1, runs = 2): HistWeek {
  return {
    monday, targetKm, runCount: runs, kind,
    plannedKm: targetKm, completedKm: targetKm * completion, runsPlanned: runs, runsDone: runs,
  };
}

describe('engine', () => {
  it('starts at 10 km with 2 easy runs', () => {
    const r = decide({ settings: S, history: [], targetMonday: '2026-11-09', signals: { pain: [] } });
    expect(r.targetKm).toBe(10);
    expect(r.runCount).toBe(2);
    expect(r.kind).toBe('start');
    expect(r.qualitySession).toBeUndefined();
  });

  it('holds one more week before first increase', () => {
    const r = decide({
      settings: S, history: [hw('2026-11-09', 10, 'start')], targetMonday: '2026-11-16',
      signals: { pain: [], lastRunDate: '2026-11-14' },
    });
    expect(r.kind).toBe('hold');
    expect(r.targetKm).toBe(10);
  });

  it('increases after two good weeks by a fixed small step', () => {
    const r = decide({
      settings: S, history: [hw('2026-11-09', 10, 'start'), hw('2026-11-16', 10, 'hold')], targetMonday: '2026-11-23',
      signals: { pain: [], lastRunDate: '2026-11-21' },
    });
    expect(r.kind).toBe('build');
    expect(r.targetKm).toBe(12);
  });

  it('does not increase because of overshooting the plan', () => {
    const r = decide({
      settings: S, history: [hw('2026-11-09', 10, 'start'), hw('2026-11-16', 10, 'hold', 1.5)], targetMonday: '2026-11-23',
      signals: { pain: [], lastRunDate: '2026-11-21' },
    });
    expect(r.kind).toBe('hold');
    expect(r.targetKm).toBe(10);
  });

  it('holds on low completion and never adds missed km', () => {
    const r = decide({
      settings: S, history: [hw('2026-11-09', 10, 'start'), hw('2026-11-16', 10, 'hold', 0.7)], targetMonday: '2026-11-23',
      signals: { pain: [], lastRunDate: '2026-11-21' },
    });
    expect(r.kind).toBe('hold');
    expect(r.targetKm).toBe(10);
  });

  it('reduces on repeated pain and strongly on high pain', () => {
    const base = { settings: S, history: [hw('2026-11-09', 12, 'build'), hw('2026-11-16', 12, 'hold')], targetMonday: '2026-11-23' };
    const rep = decide({ ...base, signals: { lastRunDate: '2026-11-21', pain: [
      { date: '2026-11-12', score: 3, locations: ['shin'] }, { date: '2026-11-19', score: 3, locations: ['shin'] },
    ] } });
    expect(rep.kind).toBe('reduce');
    expect(rep.targetKm).toBe(9);
    const high = decide({ ...base, signals: { lastRunDate: '2026-11-21', pain: [{ date: '2026-11-20', score: 6, locations: ['knee'] }] } });
    expect(high.kind).toBe('reduce');
    expect(high.suggestPause).toBe(true);
    expect(high.targetKm).toBeLessThan(9);
  });

  it('restarts gently after a long pause', () => {
    const r = decide({
      settings: S, history: [hw('2026-11-09', 16, 'build', 1, 3)], targetMonday: '2026-12-14',
      signals: { pain: [], lastRunDate: '2026-11-14' },
    });
    expect(r.kind).toBe('restart');
    expect(r.targetKm).toBeLessThan(16);
  });

  it('projects a conservative path: never jumps more than 4 km, has recovery weeks, reaches 50 slowly', () => {
    const p = project(S, [], '2026-11-09', 80);
    let level = p[0].targetKm;
    for (let i = 1; i < p.length; i++) {
      if (p[i].kind === 'recovery') continue;
      expect(p[i].targetKm - level).toBeLessThanOrEqual(4);
      level = p[i].targetKm;
    }
    console.log(p.map((w, i) => `${i + 1}:${w.targetKm}/${w.runCount}${w.kind[0]}${w.qualitySession ? "*" : ""}`).join(" "));
    expect(p.some((w) => w.kind === 'recovery')).toBe(true);
    const first30 = p.findIndex((w) => w.targetKm >= 30);
    const first50 = p.findIndex((w) => w.targetKm >= 50);
    expect(first30).toBeGreaterThan(20);
    expect(first50).toBeGreaterThan(first30);
    // runs increase one at a time
    for (let i = 1; i < p.length; i++) expect(p[i].runCount - p[i - 1].runCount).toBeLessThanOrEqual(1);
    // no intervals in the first 20 weeks
    expect(p.slice(0, 20).some((w) => w.qualitySession === 'intervals4x4' || w.qualitySession === 'hillIntervals')).toBe(false);
    // eslint-disable-next-line no-console
    console.log(p.map((w, i) => `${i + 1}:${w.targetKm}/${w.runCount}${w.kind[0]}${w.qualitySession ? '*' : ''}`).join(' '));
  });
});

describe('scheduler', () => {
  it('spreads runs and avoids consecutive days', () => {
    expect(pickSpreadDays([0, 2, 5, 6], 2, 5)).toEqual([2, 5]);
    expect(pickSpreadDays([0, 2, 5, 6], 3, 5)).toEqual([0, 2, 5]);
  });
  it('builds a week: 2 runs, walk Tuesday, strength, Friday free, km sum = target', () => {
    const rec = decide({ settings: S, history: [], targetMonday: '2026-11-09', signals: { pain: [] } });
    const ss = buildWeekSessions(rec, '2026-11-09', '2026-11-09', S, '2026-11-09');
    const runs = ss.filter((s) => s.type === 'run');
    expect(runs.length).toBe(2);
    expect(runs.reduce((a, s) => a + (s.plannedDistanceKm ?? 0), 0)).toBe(10);
    expect(ss.find((s) => s.type === 'walk')?.date).toBe('2026-11-10');
    expect(ss.some((s) => s.date === '2026-11-13')).toBe(false); // Friday rest
    expect(ss.filter((s) => s.type === 'strength').length).toBe(1);
  });
});

describe('plan service (IndexedDB)', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
    setTodayOverride('2026-11-05');
  });

  it('does not create sessions while awaiting medical clearance', async () => {
    await syncPlan();
    expect(await db.sessions.count()).toBe(0);
  });

  it('creates first week once cleared; history survives start date change and pause', async () => {
    await setReadiness(true);
    expect(await db.weeks.count()).toBe(1); // only start week (next week) is within range
    setTodayOverride('2026-11-11');
    await syncPlan();
    const wk = await db.sessions.where('weekId').equals('2026-11-09').toArray();
    const run = wk.find((s) => s.type === 'run')!;
    await saveActivity({ type: 'run', date: run.date, distanceKm: 5, durationSec: 2200, plannedSessionId: run.id, rpe: 3 });
    expect((await db.sessions.get(run.id))!.status).toBe('completed');

    await pausePlan();
    const actsBefore = await db.activities.toArray();
    setTodayOverride('2026-11-25');
    await resumePlan('2026-11-30');
    const acts = await db.activities.toArray();
    expect(acts).toEqual(actsBefore); // history untouched
    expect((await db.sessions.get(run.id))!.status).toBe('completed');
    const nextWeek = await db.weeks.get('2026-11-30');
    expect(nextWeek).toBeTruthy();
    expect(nextWeek!.kind).toBe('restart');
    expect(nextWeek!.planWeekNo).toBe(2);
    // sessions only from the new date
    const future = await db.sessions.where('date').between('2026-11-12', '2026-11-29', true, true).toArray();
    expect(future.filter((s) => s.source === 'plan' && s.status === 'planned').length).toBe(0);
  });

  it('postponing the start shifts the planned sessions', async () => {
    await setReadiness(true);
    expect(await db.sessions.where('date').below('2026-11-16').count()).toBeGreaterThan(0);
    await rescheduleFrom('2026-11-23');
    expect(await db.sessions.where('date').below('2026-11-23').count()).toBe(0);
    setTodayOverride('2026-11-21');
    await syncPlan();
    expect((await db.weeks.get('2026-11-23'))!.planWeekNo).toBe(1);
    expect((await db.weeks.get('2026-11-23'))!.targetKm).toBe(10);
  });

  it('manual override locks the week', async () => {
    await setReadiness(true);
    await overrideWeek('2026-11-09', 8, 2);
    await syncPlan({ force: true });
    const w = await db.weeks.get('2026-11-09');
    expect(w!.targetKm).toBe(8);
    expect(w!.locked).toBe(true);
  });

  it('simulated 6 weeks of full compliance progresses', async () => {
    await setReadiness(true);
    let t = '2026-11-09';
    for (let d = 0; d < 42; d++) {
      setTodayOverride(t);
      await syncPlan();
      const todays = await db.sessions.where('date').equals(t).toArray();
      for (const s of todays.filter((x) => x.status === 'planned' && x.type === 'run')) {
        await saveActivity({ type: 'run', date: t, distanceKm: s.plannedDistanceKm, durationSec: (s.plannedDistanceKm ?? 5) * 430, plannedSessionId: s.id, rpe: 3, pain: { score: 0, locations: [] } });
      }
      t = addDays(t, 1);
    }
    const weeks = await db.weeks.orderBy('monday').toArray();
    // eslint-disable-next-line no-console
    console.log(weeks.map((w) => `${w.monday} ${w.targetKm}km ${w.kind}`).join('\n'));
    expect(weeks[0].targetKm).toBe(10);
    expect(weeks[weeks.length - 1].targetKm).toBeGreaterThan(10);
  });
});

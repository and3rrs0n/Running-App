/**
 * Plan service: connects the pure engine/scheduler with the database.
 *
 * Rolling plan: only the current and the next week are committed as real sessions.
 * A committed week may be regenerated while it has not started (or on its first two days
 * with nothing completed), unless the user locked it or edited one of its sessions.
 * Completed activities are separate records and are never touched by any of this.
 */
import { db, getSettings, saveSettings, uid } from '../db/db';
import type { Activity, ISODate, PlannedSession, PlanWeek, Settings, WeekKind } from '../db/types';
import { addDays, fmtShort, mondayOf, today, weekday } from './dates';
import { decide, project, type HistWeek, type Recommendation, type Signals } from './engine';
import { fmtKm } from './format';
import { buildWeekSessions } from './scheduler';

export function isOnHold(s: Settings): boolean {
  return s.readiness !== 'cleared' || s.planStatus === 'paused';
}

export function evalWeek(
  week: Pick<PlanWeek, 'monday' | 'targetKm' | 'runCount' | 'longRunKm' | 'kind'>,
  sessions: PlannedSession[],
  activities: Activity[],
  asOf: ISODate,
): HistWeek {
  const end = addDays(week.monday, 6);
  const runSessions = sessions.filter(
    (s) => s.type === 'run' && s.date >= week.monday && s.date <= end && s.source === 'plan',
  );
  const runs = activities.filter((a) => a.type === 'run' && a.date >= week.monday && a.date <= end);
  let completedKm = runs.reduce((sum, a) => sum + (a.distanceKm ?? 0), 0);
  let runsDone = runs.length;
  // For a week still in progress, assume remaining planned sessions get done (provisional estimate).
  for (const s of runSessions) {
    if (s.status === 'planned' && s.date >= asOf) {
      completedKm += s.plannedDistanceKm ?? 0;
      runsDone += 1;
    }
  }
  const plannedKm = runSessions.reduce((sum, s) => sum + (s.plannedDistanceKm ?? 0), 0);
  return {
    monday: week.monday,
    targetKm: week.targetKm,
    runCount: week.runCount,
    longRunKm: week.longRunKm,
    kind: week.kind,
    plannedKm,
    completedKm,
    runsPlanned: runSessions.length,
    runsDone: Math.min(runsDone, Math.max(runSessions.length, runsDone)),
  };
}

export async function loadHistory(beforeMonday: ISODate, asOf = today()): Promise<HistWeek[]> {
  const weeks = (await db.weeks.where('monday').below(beforeMonday).sortBy('monday')) as PlanWeek[];
  if (!weeks.length) return [];
  const from = weeks[0].monday;
  const sessions = await db.sessions.where('date').between(from, beforeMonday, true, false).toArray();
  const acts = await db.activities.where('date').between(from, beforeMonday, true, false).toArray();
  return weeks.map((w) => evalWeek(w, sessions, acts, asOf));
}

export async function loadSignals(targetMonday: ISODate): Promise<Signals> {
  const since = addDays(targetMonday, -35);
  const acts = await db.activities.where('date').between(since, targetMonday, true, false).toArray();
  const runs = acts.filter((a) => a.type === 'run').sort((a, b) => (a.date < b.date ? -1 : 1));
  const pain = runs
    .filter((a) => a.pain && a.pain.score > 0)
    .map((a) => ({ date: a.date, score: a.pain!.score, locations: a.pain!.locations }));
  const lastRunAll = await db.activities.where('type').equals('run').toArray();
  const lastRunDate = lastRunAll
    .map((a) => a.date)
    .filter((d) => d < targetMonday)
    .sort()
    .pop();
  const prevMonday = addDays(targetMonday, -7);
  const lastWeekEasy = runs.filter(
    (a) => a.date >= prevMonday && a.rpe && (!a.runKind || a.runKind === 'easy' || a.runKind === 'long' || a.runKind === 'hills'),
  );
  const avgEasyRpeLastWeek = lastWeekEasy.length
    ? lastWeekEasy.reduce((s, a) => s + (a.rpe ?? 0), 0) / lastWeekEasy.length
    : undefined;
  const ci = await db.checkins.get(prevMonday);
  return {
    pain,
    lastRunDate,
    lastCheckin: ci ? { monday: ci.monday, status: ci.status } : undefined,
    avgEasyRpeLastWeek,
  };
}

export async function recommendFor(monday: ISODate, settings?: Settings): Promise<Recommendation> {
  const s = settings ?? (await getSettings());
  const history = await loadHistory(monday);
  const signals = await loadSignals(monday);
  return decide({ settings: s, history, targetMonday: monday, signals });
}

async function weekHasUserState(weekId: string): Promise<boolean> {
  const ss = await db.sessions.where('weekId').equals(weekId).toArray();
  return ss.some((s) => s.status !== 'planned' || s.userEdited);
}

function canRegenerate(week: PlanWeek, t: ISODate): boolean {
  if (week.locked) return false;
  return week.monday > t || t <= addDays(week.monday, 1);
}

async function writeWeek(
  monday: ISODate,
  rec: Recommendation,
  settings: Settings,
  existing?: PlanWeek,
  kindOverride?: WeekKind,
): Promise<PlanWeek> {
  const now = Date.now();
  const planWeekNo = existing?.planWeekNo ?? (await db.weeks.where('monday').below(monday).count()) + 1;
  const week: PlanWeek = {
    id: monday,
    monday,
    planWeekNo,
    targetKm: rec.targetKm,
    runCount: rec.runCount,
    longRunKm: rec.longRunKm,
    kind: kindOverride ?? rec.kind,
    phase: rec.phase,
    reasons: rec.reasons,
    locked: existing?.locked ?? false,
    announced: !!existing?.announced && sameRec(existing, rec),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  const firstDate = settings.startDate > monday ? settings.startDate : monday;
  const drafts = buildWeekSessions(rec, monday, monday, settings, firstDate);
  await db.transaction('rw', db.weeks, db.sessions, async () => {
    // Remove only untouched plan sessions of this week.
    const old = await db.sessions.where('weekId').equals(monday).toArray();
    const removable = old.filter((s) => s.source === 'plan' && s.status === 'planned' && !s.userEdited);
    await db.sessions.bulkDelete(removable.map((s) => s.id));
    await db.weeks.put(week);
    await db.sessions.bulkAdd(drafts.map((d) => ({ ...d, id: uid(), createdAt: now, updatedAt: now })));
  });
  return week;
}

function sameRec(w: PlanWeek, r: Recommendation): boolean {
  return w.targetKm === r.targetKm && w.runCount === r.runCount && w.kind === r.kind && w.longRunKm === r.longRunKm;
}

async function addNotice(kind: 'plan' | 'warning' | 'info' | 'pain', title: string, body: string) {
  await db.notices.add({ id: uid(), date: today(), kind, title, body, dismissed: false, createdAt: Date.now() });
}

let syncing: Promise<void> | null = null;

/** Ensure the current and next week exist and are up to date. Safe to call often. */
export function syncPlan(opts: { force?: boolean } = {}): Promise<void> {
  if (syncing) return syncing.then(() => syncPlanInner(opts));
  syncing = syncPlanInner(opts).finally(() => {
    syncing = null;
  });
  return syncing;
}

async function syncPlanInner(opts: { force?: boolean }) {
  const settings = await getSettings();
  if (isOnHold(settings)) return;
  const t = today();
  const startMonday = mondayOf(settings.startDate);
  const thisMonday = mondayOf(t);
  const targets = [thisMonday, addDays(thisMonday, 7)].filter((m) => m >= startMonday);
  for (const monday of targets) {
    const existing = await db.weeks.get(monday);
    const rec = await recommendFor(monday, settings);
    if (!existing) {
      // Do not create a week that is already over half gone without the user having started it,
      // unless it is the start week.
      const w = await writeWeek(monday, rec, settings);
      if (monday <= t) await announce(w);
      continue;
    }
    if (!canRegenerate(existing, t) || (await weekHasUserState(existing.id))) {
      if (monday <= t && !existing.announced) await announce(existing);
      continue;
    }
    if (opts.force || !sameRec(existing, rec)) {
      const changed = !sameRec(existing, rec);
      const w = await writeWeek(monday, rec, settings, existing);
      if (changed && monday > t) {
        await addNotice(
          'plan',
          `Neste uke justert: ${fmtKm(existing.targetKm)} → ${fmtKm(rec.targetKm)} km`,
          rec.reasons.join(' '),
        );
      }
      if (monday <= t) await announce(w);
    } else if (monday <= t && !existing.announced) {
      await announce(existing);
    }
  }
}

const KIND_TITLE: Record<WeekKind, string> = {
  start: 'Planen starter',
  build: 'Ny uke: litt mer volum',
  hold: 'Ny uke: samme nivå',
  recovery: 'Ny uke: lettere uke',
  reduce: 'Ny uke: redusert volum',
  restart: 'Ny uke: forsiktig gjenopptak',
  manual: 'Ny uke: manuelt satt',
};

async function announce(w: PlanWeek) {
  if (w.announced) return;
  await db.weeks.update(w.id, { announced: true });
  // A new week supersedes earlier plan notices.
  const old = await db.notices.filter((n) => !n.dismissed && (n.kind === 'plan' || n.kind === 'warning')).toArray();
  await db.notices.bulkPut(old.map((n) => ({ ...n, dismissed: true })));
  await addNotice(
    w.kind === 'reduce' ? 'warning' : 'plan',
    `${KIND_TITLE[w.kind]} – ${fmtKm(w.targetKm)} km`,
    w.reasons.join(' '),
  );
}

/** Remove future, untouched plan content (used when pausing or moving the start date). */
export async function clearFuturePlan(fromDate: ISODate) {
  await db.transaction('rw', db.weeks, db.sessions, async () => {
    const future = await db.sessions.where('date').aboveOrEqual(fromDate).toArray();
    const removable = future.filter((s) => s.source === 'plan' && s.status === 'planned');
    await db.sessions.bulkDelete(removable.map((s) => s.id));
    const weeks = await db.weeks.where('monday').aboveOrEqual(mondayOf(fromDate)).toArray();
    for (const w of weeks) {
      const remaining = await db.sessions.where('weekId').equals(w.id).toArray();
      const hasHistory = remaining.some((s) => s.status !== 'planned');
      if (!hasHistory && (w.monday >= fromDate || remaining.length === 0)) await db.weeks.delete(w.id);
    }
  });
}

/** Move the plan (re)start to `date`. Future planned sessions are regenerated from that date;
 *  completed history is untouched; progression continues where it left off. */
export async function rescheduleFrom(date: ISODate) {
  const t = today();
  await clearFuturePlan(t < date ? t : date);
  await saveSettings({ startDate: date });
  await syncPlan({ force: true });
}

export async function pausePlan() {
  await saveSettings({ planStatus: 'paused', pausedAt: today() });
  await clearFuturePlan(today());
  await addNotice('info', 'Planen er satt på pause', 'Fremtidige planlagte økter er fjernet. Historikken din er urørt. Gjenoppta når du er klar.');
}

export async function resumePlan(fromDate: ISODate) {
  await saveSettings({ planStatus: 'active', pausedAt: undefined });
  await rescheduleFrom(fromDate);
}

export async function setReadiness(cleared: boolean, startDate?: ISODate) {
  if (!cleared) {
    await saveSettings({ readiness: 'awaiting' });
    await clearFuturePlan(today());
    return;
  }
  await saveSettings({ readiness: 'cleared' });
  if (startDate) await rescheduleFrom(startDate);
  else await syncPlan({ force: true });
}

/** Suggested (re)start: the given date if in the future, otherwise today if Monday, else next Monday. */
export function suggestStartDate(current: ISODate): ISODate {
  const t = today();
  if (current >= t) return current;
  return weekday(t) === 0 ? t : addDays(mondayOf(t), 7);
}

/** Manually set target for a week (locks it from automatic changes). */
export async function overrideWeek(monday: ISODate, targetKm: number, runCount: number) {
  const settings = await getSettings();
  const existing = await db.weeks.get(monday);
  const auto = await recommendFor(monday, settings);
  const rec: Recommendation = {
    ...auto,
    targetKm,
    runCount,
    longRunKm: runCount >= 3 ? Math.round(targetKm * (runCount === 3 ? 0.36 : runCount === 4 ? 0.32 : 0.28) * 2) / 2 : undefined,
    kind: 'manual',
    qualitySession: auto.qualitySession,
    reasons: [
      `Satt manuelt til ${fmtKm(targetKm)} km og ${runCount} løpeøkter.`,
      `Automatisk forslag var ${fmtKm(auto.targetKm)} km / ${auto.runCount} økter: ${auto.reasons.join(' ')}`,
    ],
  };
  const w = await writeWeek(monday, rec, settings, existing, 'manual');
  await db.weeks.update(w.id, { locked: true });
  await addNotice('plan', `Uke fra ${fmtShort(monday)} satt manuelt – ${fmtKm(targetKm)} km`, 'Uken endres ikke automatisk. Du kan låse den opp under Progresjon → Plan.');
}

export async function unlockWeek(monday: ISODate) {
  await db.weeks.update(monday, { locked: false });
  const ss = await db.sessions.where('weekId').equals(monday).toArray();
  await db.sessions.bulkPut(ss.map((s) => ({ ...s, userEdited: false })));
  await syncPlan({ force: true });
}

// ---------------------------------------------------------------- sessions

export async function moveSession(id: string, newDate: ISODate) {
  await db.sessions.update(id, { date: newDate, userEdited: true, updatedAt: Date.now() });
}

export async function updateSession(id: string, patch: Partial<PlannedSession>) {
  await db.sessions.update(id, { ...patch, userEdited: true, updatedAt: Date.now() });
}

export async function skipSession(id: string, reason?: string) {
  await db.sessions.update(id, { status: 'skipped', skipReason: reason, updatedAt: Date.now() });
}

export async function unskipSession(id: string) {
  await db.sessions.update(id, { status: 'planned', skipReason: undefined, updatedAt: Date.now() });
}

export async function deleteSession(id: string) {
  const s = await db.sessions.get(id);
  if (!s) return;
  if (s.activityId) await db.activities.update(s.activityId, { plannedSessionId: undefined });
  await db.sessions.delete(id);
}

export async function addManualSession(draft: Omit<PlannedSession, 'id' | 'createdAt' | 'updatedAt' | 'status' | 'source' | 'order'>) {
  const now = Date.now();
  const weekId = (await db.weeks.get(mondayOf(draft.date))) ? mondayOf(draft.date) : undefined;
  await db.sessions.add({
    ...draft,
    weekId,
    id: uid(),
    status: 'planned',
    source: 'manual',
    order: 5,
    createdAt: now,
    updatedAt: now,
  });
}

// ---------------------------------------------------------------- activities

export async function saveActivity(input: Omit<Activity, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }) {
  const now = Date.now();
  const existing = input.id ? await db.activities.get(input.id) : undefined;
  const act: Activity = {
    ...input,
    id: input.id ?? uid(),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  } as Activity;
  await db.transaction('rw', db.activities, db.sessions, async () => {
    // unlink previous session if link changed
    if (existing?.plannedSessionId && existing.plannedSessionId !== act.plannedSessionId) {
      await db.sessions.update(existing.plannedSessionId, { status: 'planned', activityId: undefined, updatedAt: now });
    }
    await db.activities.put(act);
    if (act.plannedSessionId) {
      await db.sessions.update(act.plannedSessionId, { status: 'completed', activityId: act.id, updatedAt: now });
    }
  });
  if (act.type === 'run' && act.pain && act.pain.score >= 5 && !existing) {
    await addNotice(
      'pain',
      `Smerte ${act.pain.score}/10 registrert`,
      'Ikke løp gjennom smerte. Vurder å hoppe over neste løpeøkt eller erstatte den med gåtur/sykling. Ved vedvarende smerte: få det vurdert av fysioterapeut eller lege.',
    );
  }
  await syncPlan();
  return act;
}

export async function deleteActivity(id: string) {
  const a = await db.activities.get(id);
  if (!a) return;
  await db.transaction('rw', db.activities, db.sessions, async () => {
    if (a.plannedSessionId) {
      await db.sessions.update(a.plannedSessionId, { status: 'planned', activityId: undefined, updatedAt: Date.now() });
    }
    await db.activities.delete(id);
  });
  await syncPlan();
}

/** Planned, open sessions of the same type close to `date` — candidates for linking a new activity. */
export async function linkCandidates(type: string, date: ISODate): Promise<PlannedSession[]> {
  const ss = await db.sessions.where('date').between(addDays(date, -3), addDays(date, 3), true, true).toArray();
  return ss
    .filter((s) => s.type === type && s.status === 'planned')
    .sort((a, b) => Math.abs(+new Date(a.date) - +new Date(date)) - Math.abs(+new Date(b.date) - +new Date(date)));
}

// ---------------------------------------------------------------- projection

export async function projectionFrom(weeks = 26) {
  const settings = await getSettings();
  const t = today();
  const all = (await db.weeks.orderBy('monday').toArray()) as PlanWeek[];
  let fromMonday: ISODate;
  if (all.length) fromMonday = addDays(all[all.length - 1].monday, 7);
  else fromMonday = mondayOf(settings.startDate > t ? settings.startDate : suggestStartDate(settings.startDate));
  const history = await loadHistory(fromMonday);
  return project(settings, history, fromMonday, weeks);
}

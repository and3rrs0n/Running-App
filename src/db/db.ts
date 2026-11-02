import Dexie, { type Table } from 'dexie';
import type { Activity, Notice, PlannedSession, PlanWeek, Settings, WeeklyCheckin } from './types';

export const SCHEMA_VERSION = 1;

export class LopeDB extends Dexie {
  activities!: Table<Activity, string>;
  sessions!: Table<PlannedSession, string>;
  weeks!: Table<PlanWeek, string>;
  checkins!: Table<WeeklyCheckin, string>;
  notices!: Table<Notice, string>;
  settings!: Table<Settings, string>;

  constructor(name = 'lopeplan') {
    super(name);
    // Versioned schema. Add new versions below with .upgrade() for migrations — never edit an old one.
    this.version(1).stores({
      activities: 'id, date, type, plannedSessionId',
      sessions: 'id, date, weekId, status, type',
      weeks: 'id, monday, planWeekNo',
      checkins: 'id, monday',
      notices: 'id, date, dismissed',
      settings: 'id',
    });
  }
}

export const db = new LopeDB();

export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export const DEFAULT_SETTINGS: Settings = {
  id: 'main',
  startDate: '2026-11-09',
  readiness: 'awaiting',
  planStatus: 'active',
  startWeeklyKm: 10,
  maxRunsPerWeek: 5,
  longTermGoalKm: 50,
  walkDay: 1,
  walkDistanceKm: 7,
  walkElevationM: 250,
  strengthDay: 3,
  restDays: [4],
  preferredRunDays: [0, 2, 5, 6],
  longRunDay: 5,
  defaultSurface: 'asphalt',
  easyPaceSecPerKm: 7 * 60 + 15,
  allowHills: true,
  allowIntervals: true,
  gymMember: false,
  schemaVersion: SCHEMA_VERSION,
};

export async function getSettings(): Promise<Settings> {
  const s = await db.settings.get('main');
  if (s) return { ...DEFAULT_SETTINGS, ...s };
  await db.settings.put(DEFAULT_SETTINGS);
  return DEFAULT_SETTINGS;
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await getSettings();
  const next = { ...current, ...patch, id: 'main' as const };
  await db.settings.put(next);
  return next;
}

/** Ask the browser to keep our data (reduces risk of eviction on iOS). */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (navigator.storage && navigator.storage.persist) {
      if (await navigator.storage.persisted()) return true;
      return await navigator.storage.persist();
    }
  } catch {
    /* ignore */
  }
  return false;
}

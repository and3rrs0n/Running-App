/** JSON export / import with validation and duplicate protection. */
import { db, DEFAULT_SETTINGS, SCHEMA_VERSION, saveSettings } from './db';
import type { Activity, Notice, PlannedSession, PlanWeek, Settings, WeeklyCheckin } from './types';

export const BACKUP_FORMAT = 'lopeplan-backup';

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  schemaVersion: number;
  exportedAt: string;
  data: {
    settings: Settings | null;
    activities: Activity[];
    sessions: PlannedSession[];
    weeks: PlanWeek[];
    checkins: WeeklyCheckin[];
    notices: Notice[];
  };
}

export async function exportData(): Promise<BackupFile> {
  const [settings, activities, sessions, weeks, checkins, notices] = await Promise.all([
    db.settings.get('main'),
    db.activities.toArray(),
    db.sessions.toArray(),
    db.weeks.toArray(),
    db.checkins.toArray(),
    db.notices.toArray(),
  ]);
  return {
    format: BACKUP_FORMAT,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    data: { settings: settings ?? null, activities, sessions, weeks, checkins, notices },
  };
}

export async function downloadBackup(): Promise<void> {
  const data = await exportData();
  const json = JSON.stringify(data, null, 2);
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `lopeplan-backup-${stamp}.json`;
  const blob = new Blob([json], { type: 'application/json' });
  const file = new File([blob], filename, { type: 'application/json' });
  // iOS: the share sheet is the most reliable way to save to Files/iCloud from a standalone PWA.
  const nav = navigator as Navigator & { canShare?: (d: unknown) => boolean };
  let done = false;
  if (nav.canShare && nav.canShare({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: 'Løpeplan sikkerhetskopi' });
      done = true;
    } catch (e) {
      if ((e as Error).name === 'AbortError') return; // user cancelled
    }
  }
  if (!done) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  await saveSettings({ lastBackupAt: Date.now() });
}

const isStr = (v: unknown) => typeof v === 'string';
const isDate = (v: unknown) => isStr(v) && /^\d{4}-\d{2}-\d{2}$/.test(v as string);

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  file?: BackupFile;
  summary?: { activities: number; sessions: number; weeks: number; checkins: number; exportedAt: string };
}

export function validateBackup(raw: unknown): ValidationResult {
  const errors: string[] = [];
  const f = raw as BackupFile;
  if (!f || typeof f !== 'object') return { ok: false, errors: ['Filen er ikke gyldig JSON.'] };
  if (f.format !== BACKUP_FORMAT) errors.push('Filen er ikke en sikkerhetskopi fra Løpeplan.');
  if (typeof f.schemaVersion !== 'number') errors.push('Mangler versjonsnummer.');
  else if (f.schemaVersion > SCHEMA_VERSION) errors.push('Sikkerhetskopien er fra en nyere versjon av appen. Oppdater appen først.');
  const d = f.data;
  if (!d || typeof d !== 'object') errors.push('Mangler data.');
  else {
    for (const k of ['activities', 'sessions', 'weeks', 'checkins', 'notices'] as const) {
      if (!Array.isArray(d[k])) errors.push(`Mangler liste: ${k}.`);
    }
    (d.activities ?? []).forEach((a, i) => {
      if (!isStr(a.id) || !isDate(a.date) || !['run', 'walk', 'strength', 'bike'].includes(a.type)) {
        errors.push(`Aktivitet nr. ${i + 1} er ugyldig.`);
      }
    });
    (d.sessions ?? []).forEach((s, i) => {
      if (!isStr(s.id) || !isDate(s.date)) errors.push(`Planlagt økt nr. ${i + 1} er ugyldig.`);
    });
    (d.weeks ?? []).forEach((w, i) => {
      if (!isDate(w.monday) || typeof w.targetKm !== 'number') errors.push(`Planuke nr. ${i + 1} er ugyldig.`);
    });
  }
  if (errors.length) return { ok: false, errors: errors.slice(0, 8) };
  return {
    ok: true,
    errors: [],
    file: f,
    summary: {
      activities: d.activities.length,
      sessions: d.sessions.length,
      weeks: d.weeks.length,
      checkins: d.checkins.length,
      exportedAt: f.exportedAt,
    },
  };
}

/** Natural key for duplicate detection between different devices / ids. */
function activityKey(a: Activity) {
  return [a.type, a.date, Math.round((a.distanceKm ?? 0) * 100), Math.round((a.durationSec ?? 0) / 10)].join('|');
}

export type ImportMode = 'replace' | 'merge';

export async function importBackup(file: BackupFile, mode: ImportMode) {
  const d = file.data;
  // Future migrations from older schemaVersion go here.
  let added = 0;
  let skipped = 0;
  await db.transaction('rw', [db.activities, db.sessions, db.weeks, db.checkins, db.notices, db.settings], async () => {
    if (mode === 'replace') {
      await Promise.all([
        db.activities.clear(),
        db.sessions.clear(),
        db.weeks.clear(),
        db.checkins.clear(),
        db.notices.clear(),
      ]);
      await db.activities.bulkPut(d.activities);
      await db.sessions.bulkPut(d.sessions);
      await db.weeks.bulkPut(d.weeks);
      await db.checkins.bulkPut(d.checkins);
      await db.notices.bulkPut(d.notices);
      await db.settings.put({ ...DEFAULT_SETTINGS, ...(d.settings ?? {}), id: 'main', schemaVersion: SCHEMA_VERSION });
      added = d.activities.length;
      return;
    }
    // merge: keep existing, add only what is new
    const existing = await db.activities.toArray();
    const ids = new Set(existing.map((a) => a.id));
    const keys = new Set(existing.map(activityKey));
    const fresh: Activity[] = [];
    for (const a of d.activities) {
      if (ids.has(a.id) || keys.has(activityKey(a))) {
        skipped++;
        continue;
      }
      fresh.push({ ...a, plannedSessionId: undefined });
      keys.add(activityKey(a));
    }
    await db.activities.bulkAdd(fresh);
    added = fresh.length;
    const existingCheckins = new Set((await db.checkins.toArray()).map((c) => c.id));
    await db.checkins.bulkAdd(d.checkins.filter((c) => !existingCheckins.has(c.id)));
  });
  return { added, skipped };
}

export async function wipeAll() {
  await db.transaction('rw', [db.activities, db.sessions, db.weeks, db.checkins, db.notices, db.settings], async () => {
    await Promise.all([
      db.activities.clear(),
      db.sessions.clear(),
      db.weeks.clear(),
      db.checkins.clear(),
      db.notices.clear(),
      db.settings.clear(),
    ]);
  });
}

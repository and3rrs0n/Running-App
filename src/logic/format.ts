import type { ActivityType, PainLocation, RecoveryStatus, RunKind, Surface } from '../db/types';

export function fmtKm(km: number | undefined, decimals = 1): string {
  if (km === undefined || km === null || isNaN(km)) return '–';
  const v = Math.round(km * 10 ** decimals) / 10 ** decimals;
  return v.toLocaleString('nb-NO', { minimumFractionDigits: 0, maximumFractionDigits: decimals });
}

export function fmtDuration(sec: number | undefined): string {
  if (!sec && sec !== 0) return '–';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.round(sec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function fmtMinutes(min: number | undefined): string {
  if (!min) return '–';
  if (min < 60) return `${Math.round(min)} min`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m ? `${h} t ${m} min` : `${h} t`;
}

export function paceSecPerKm(distanceKm?: number, durationSec?: number): number | undefined {
  if (!distanceKm || !durationSec || distanceKm <= 0) return undefined;
  return durationSec / distanceKm;
}

export function fmtPace(secPerKm: number | undefined): string {
  if (!secPerKm || !isFinite(secPerKm)) return '–';
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  if (s === 60) return `${m + 1}:00`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Parse "mm:ss", "h:mm:ss" or plain minutes into seconds. */
export function parseDuration(input: string): number | undefined {
  const t = input.trim().replace(',', '.');
  if (!t) return undefined;
  if (/^\d+(\.\d+)?$/.test(t)) return Math.round(parseFloat(t) * 60);
  const parts = t.split(':').map((p) => parseInt(p, 10));
  if (parts.some((p) => isNaN(p))) return undefined;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return undefined;
}

export function parseNum(input: string): number | undefined {
  const t = input.trim().replace(',', '.');
  if (!t) return undefined;
  const v = parseFloat(t);
  return isNaN(v) ? undefined : v;
}

export const ACTIVITY_LABEL: Record<ActivityType | 'rest', string> = {
  run: 'Løping',
  walk: 'Gåtur',
  strength: 'Styrke',
  bike: 'Sykling',
  rest: 'Hvile',
};

export const ACTIVITY_COLOR: Record<ActivityType | 'rest', string> = {
  run: '#3ee0a1',
  walk: '#7aa8ff',
  strength: '#f5b452',
  bike: '#c58bff',
  rest: '#5d6573',
};

export const RUN_KIND_LABEL: Record<RunKind, string> = {
  easy: 'Rolig tur',
  long: 'Langtur',
  hills: 'Rolig kupert',
  intervals4x4: '4×4 intervaller',
  hillIntervals: 'Bakkeintervaller',
};

export const SURFACE_LABEL: Record<Surface, string> = {
  asphalt: 'Asfalt',
  gravel: 'Grus',
  trail: 'Sti / skog',
  treadmill: 'Mølle',
  other: 'Annet',
};

export const PAIN_LOCATION_LABEL: Record<PainLocation, string> = {
  shin: 'Legg / skinneben',
  knee: 'Kne',
  foot: 'Fot / ankel',
  achilles: 'Akilles',
  hip: 'Hofte',
  other: 'Annet',
};

export const RECOVERY_LABEL: Record<RecoveryStatus, string> = {
  good: 'Føler meg bra',
  normal: 'Normal tretthet',
  tired: 'Uvanlig sliten',
  discomfort: 'Har ubehag',
  warning: 'Mulig skadevarsel',
};

export const PHASE_NAMES = ['', 'Gjenoppstart', 'Grunnlag', 'Utvidet base', 'Bærekraftig volum', 'Ultrabase'];

export function phaseFor(km: number): number {
  if (km < 15) return 1;
  if (km < 25) return 2;
  if (km < 40) return 3;
  if (km < 55) return 4;
  return 5;
}

export function round05(x: number): number {
  return Math.round(x * 2) / 2;
}

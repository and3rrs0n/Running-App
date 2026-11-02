import type { ISODate } from '../db/types';

const pad = (n: number) => String(n).padStart(2, '0');

export function toISO(d: Date): ISODate {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fromISO(s: ISODate): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0); // noon avoids DST edge cases
}

let fixedToday: ISODate | null = null;
/** Testing hook: freeze "today". */
export function setTodayOverride(d: ISODate | null) {
  fixedToday = d;
}
export function today(): ISODate {
  return fixedToday ?? toISO(new Date());
}

export function addDays(s: ISODate, n: number): ISODate {
  const d = fromISO(s);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

/** 0 = Monday … 6 = Sunday */
export function weekday(s: ISODate): number {
  return (fromISO(s).getDay() + 6) % 7;
}

export function mondayOf(s: ISODate): ISODate {
  return addDays(s, -weekday(s));
}

export function diffDays(a: ISODate, b: ISODate): number {
  return Math.round((fromISO(a).getTime() - fromISO(b).getTime()) / 86400000);
}

export function isoWeekNumber(s: ISODate): number {
  const d = fromISO(s);
  const target = new Date(d.valueOf());
  const dayNr = (d.getDay() + 6) % 7;
  target.setDate(target.getDate() - dayNr + 3);
  const firstThursday = new Date(target.getFullYear(), 0, 4);
  const diff = target.valueOf() - firstThursday.valueOf();
  return 1 + Math.round((diff / 86400000 - 3 + ((firstThursday.getDay() + 6) % 7)) / 7);
}

export const WEEKDAYS = ['mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag', 'søndag'];
export const WEEKDAYS_SHORT = ['man', 'tir', 'ons', 'tor', 'fre', 'lør', 'søn'];
export const MONTHS = [
  'januar', 'februar', 'mars', 'april', 'mai', 'juni',
  'juli', 'august', 'september', 'oktober', 'november', 'desember',
];
export const MONTHS_SHORT = ['jan', 'feb', 'mar', 'apr', 'mai', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'des'];

export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "onsdag 11. november" */
export function fmtLong(s: ISODate, withYear = false): string {
  const d = fromISO(s);
  return `${WEEKDAYS[weekday(s)]} ${d.getDate()}. ${MONTHS[d.getMonth()]}${withYear ? ' ' + d.getFullYear() : ''}`;
}

/** "11. nov" */
export function fmtShort(s: ISODate, withYear = false): string {
  const d = fromISO(s);
  return `${d.getDate()}. ${MONTHS_SHORT[d.getMonth()]}${withYear ? ' ' + d.getFullYear() : ''}`;
}

/** "ons 11.11" */
export function fmtDayShort(s: ISODate): string {
  const d = fromISO(s);
  return `${WEEKDAYS_SHORT[weekday(s)]} ${d.getDate()}.${d.getMonth() + 1}`;
}

export function monthKey(s: ISODate): string {
  return s.slice(0, 7);
}

export function fmtMonthKey(key: string, withYear = true): string {
  const [y, m] = key.split('-').map(Number);
  return `${cap(MONTHS[m - 1])}${withYear ? ' ' + y : ''}`;
}

export function rangeDays(from: ISODate, to: ISODate): ISODate[] {
  const out: ISODate[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export function relativeDay(s: ISODate): string {
  const n = diffDays(s, today());
  if (n === 0) return 'I dag';
  if (n === 1) return 'I morgen';
  if (n === -1) return 'I går';
  return cap(fmtLong(s));
}

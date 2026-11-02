/** Turns a weekly recommendation into concrete sessions on concrete days. Pure. */
import type { ISODate, PlannedSession, RunKind, Settings, StrengthExercise } from '../db/types';
import { addDays, fromISO } from './dates';
import { round05 } from './format';
import type { Recommendation } from './engine';

export const HOME_STRENGTH_PROGRAM: (StrengthExercise & { note: string })[] = [
  { name: 'Tåhev (begge bein)', sets: 3, reps: '15', note: 'Rolig opp, langsomt ned. Rett kne.' },
  { name: 'Ettbens tåhev med bøyd kne', sets: 2, reps: '10–12 per bein', note: 'Styrker soleus – viktig for legg og skinneben.' },
  { name: 'Tibialis-løft (tåløft mot vegg)', sets: 2, reps: '15–20', note: 'Rygg mot vegg, løft tærne. Avlaster fremsiden av leggen.' },
  { name: 'Seteløft (glute bridge)', sets: 3, reps: '12', note: 'Kan gjøres på ett bein når det blir lett.' },
  { name: 'Splittknebøy', sets: 2, reps: '8–10 per bein', note: 'Kontroller kneet over foten.' },
  { name: 'Step-down fra trappetrinn', sets: 2, reps: '8 per bein', note: 'Langsomt og kontrollert. Hofte og kne på linje.' },
  { name: 'Sideliggende hofteabduksjon', sets: 2, reps: '12–15 per side', note: 'Styrker hoftens sidemuskulatur.' },
  { name: 'Sideplanke', sets: 2, reps: '20–40 sek per side', note: 'Rett linje fra hode til fot.' },
  { name: 'Dead bug', sets: 2, reps: '8–10 per side', note: 'Korsrygg i gulvet hele veien.' },
  { name: 'Balanse på ett bein', sets: 2, reps: '30–45 sek per bein', note: 'Øk vanskelighet med lukkede øyne.' },
];

export const RUN_DESCRIPTIONS: Record<RunKind, string> = {
  easy:
    'Rolig og pratbart tempo, primært sone 2. Ingen tempopress – det er helt greit å gå i bratte motbakker. Gå gjerne ned bratte partier.',
  long:
    'Langtur i rolig tempo. Fokus på tid på beina, ikke fart. Gå ned bratte bakker. Ta med drikke på turer over 75 min.',
  hills:
    'Rolig tur i lett kupert terreng. Jogg rolig oppover med korte steg, gå ned bratte bakker for å skåne legger og knær. Fortsatt pratbart.',
  intervals4x4:
    '15 min rolig oppvarming. 4 × 4 min hardt men kontrollert (ca. 85–90 % av makspuls), 3 min rolig jogg/gange mellom. 10 min rolig nedjogg. Avbryt ved smerte.',
  hillIntervals:
    '15 min rolig oppvarming. 6–8 × 60–90 sek i motbakke med god innsats, gå rolig ned som pause. 10 min rolig nedjogg. Avbryt ved smerte.',
};

export function surfaceHint(date: ISODate): string {
  const m = fromISO(date).getMonth() + 1;
  if (m >= 11 || m <= 3) {
    return 'Vinter: asfalt eller mølle ved is og snø. Velg gang- og sykkelvei med grus der det er trygt, for å begrense asfalt.';
  }
  if (m === 4 || m === 10) {
    return 'Prøv grus eller skogsvei der underlaget tillater det. Bytt underlag gradvis.';
  }
  return 'Sommerhalvår: grus, skogsvei og sti når mulig. Øk mengden sti gradvis – mykt underlag fjerner ikke all skaderisiko.';
}

/** Choose `n` days from `candidates` maximising the minimum gap (circular week). */
export function pickSpreadDays(candidates: number[], n: number, prefer?: number): number[] {
  const c = Array.from(new Set(candidates)).sort((a, b) => a - b);
  if (n <= 0) return [];
  if (c.length <= n) return c;
  let best: number[] = [];
  let bestScore = -Infinity;
  const combos = (start: number, acc: number[]) => {
    if (acc.length === n) {
      let minGap = 7;
      let gapSum = 0;
      for (let i = 0; i < acc.length; i++) {
        const next = i + 1 < acc.length ? acc[i + 1] : acc[0] + 7;
        const g = next - acc[i];
        minGap = Math.min(minGap, g);
        gapSum += g === 1 ? 0 : 1;
      }
      let score = minGap * 100 + gapSum * 10;
      if (prefer !== undefined && acc.includes(prefer)) score += 5;
      if (score > bestScore) {
        bestScore = score;
        best = [...acc];
      }
      return;
    }
    for (let i = start; i < c.length; i++) combos(i + 1, [...acc, c[i]]);
  };
  combos(0, []);
  return best;
}

export function chooseRunDays(settings: Settings, n: number, availableDays: number[]): number[] {
  const avail = new Set(availableDays);
  const reserved = new Set<number>([...settings.restDays]);
  if (settings.walkDay !== null) reserved.add(settings.walkDay);
  if (settings.strengthDay !== null) reserved.add(settings.strengthDay);
  let candidates = settings.preferredRunDays.filter((d) => avail.has(d) && !reserved.has(d));
  if (candidates.length < n) {
    // Widen: any free non-rest day, then strength day, then walk day. Rest days are never used.
    const order = [0, 1, 2, 3, 4, 5, 6].filter((d) => avail.has(d) && !reserved.has(d));
    if (settings.strengthDay !== null && avail.has(settings.strengthDay)) order.push(settings.strengthDay);
    if (settings.walkDay !== null && avail.has(settings.walkDay)) order.push(settings.walkDay);
    for (const d of order) {
      if (candidates.length >= n) break;
      if (!candidates.includes(d)) candidates.push(d);
    }
  }
  return pickSpreadDays(candidates, n, settings.longRunDay);
}

export interface SessionDraft extends Omit<PlannedSession, 'id' | 'createdAt' | 'updatedAt'> {}

export function buildWeekSessions(
  rec: Recommendation,
  monday: ISODate,
  weekId: string,
  settings: Settings,
  firstDate: ISODate, // no sessions before this date (plan start)
): SessionDraft[] {
  const out: SessionDraft[] = [];
  const dayDate = (d: number) => addDays(monday, d);
  const available = [0, 1, 2, 3, 4, 5, 6].filter((d) => dayDate(d) >= firstDate);
  const base = { weekId, status: 'planned' as const, source: 'plan' as const };

  // Fixed walk
  if (settings.walkDay !== null && available.includes(settings.walkDay)) {
    out.push({
      ...base,
      date: dayDate(settings.walkDay),
      type: 'walk',
      title: 'Fast tirsdagstur',
      description:
        'Fast gåtur med venn. Teller som belastning og aktivitet, men ikke som løpekilometer. Gå gjerne rolig ned bratte bakker.',
      plannedDistanceKm: settings.walkDistanceKm,
      plannedElevationM: settings.walkElevationM,
      plannedDurationMin: Math.round(settings.walkDistanceKm * 13),
      order: 1,
    });
  }

  // Strength
  if (settings.strengthDay !== null && available.includes(settings.strengthDay)) {
    const date = dayDate(settings.strengthDay);
    const gym = settings.gymMember && (!settings.gymStartDate || date >= settings.gymStartDate);
    out.push({
      ...base,
      date,
      type: 'strength',
      strengthMode: gym ? 'gym' : 'home',
      title: gym ? 'Styrke – treningssenter' : 'Styrke og skadeforebygging',
      description: gym
        ? 'Følg programmet fra treningssenteret. Registrer øvelsene etterpå.'
        : 'Hjemmeøkt uten utstyr, ca. 30 min. Fokus på legg, fot, hofte og kjerne.',
      plannedDurationMin: 30,
      order: 2,
    });
  }

  // Runs
  const runDays = chooseRunDays(settings, rec.runCount, available);
  if (runDays.length) {
    const fullWeek = available.length === 7;
    // If the week is partial (plan starts mid-week), scale volume to the days we actually have.
    const totalKm = fullWeek ? rec.targetKm : round05((rec.targetKm * runDays.length) / Math.max(1, rec.runCount));
    let longDay: number | undefined;
    let longKm: number | undefined;
    if (rec.longRunKm && runDays.length >= 3) {
      longDay = runDays.includes(settings.longRunDay) ? settings.longRunDay : runDays[runDays.length - 1];
      longKm = rec.longRunKm;
    }
    const others = runDays.filter((d) => d !== longDay);
    const rest = totalKm - (longKm ?? 0);
    const each = Math.max(3, round05(rest / Math.max(1, others.length)));
    const kinds: Record<number, RunKind> = {};
    for (const d of runDays) kinds[d] = d === longDay ? 'long' : 'easy';
    if (rec.qualitySession && others.length >= 2) {
      // Put quality on an "other" day, as far from the long run as possible.
      const q = longDay === undefined ? others[0] : others.reduce((a, b) => (Math.abs(b - longDay!) > Math.abs(a - longDay!) ? b : a));
      kinds[q] = rec.qualitySession;
    }
    let assigned = 0;
    others.forEach((d, i) => {
      let km = i === others.length - 1 ? round05(rest - assigned) : each;
      km = Math.max(3, km);
      assigned += km;
      pushRun(d, kinds[d], km);
    });
    if (longDay !== undefined && longKm) pushRun(longDay, 'long', longKm);
  }

  function pushRun(day: number, kind: RunKind, km: number) {
    const date = dayDate(day);
    const pace = settings.easyPaceSecPerKm;
    const isQuality = kind === 'intervals4x4' || kind === 'hillIntervals';
    const distance = isQuality ? Math.max(km, 6) : km;
    out.push({
      ...base,
      date,
      type: 'run',
      runKind: kind,
      title: titleFor(kind),
      description: RUN_DESCRIPTIONS[kind],
      plannedDistanceKm: distance,
      plannedDurationMin: isQuality ? (kind === 'intervals4x4' ? 50 : 45) : Math.round((distance * pace) / 60),
      surfaceHint: surfaceHint(date),
      order: 0,
    });
  }

  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.order - b.order));
}

export function titleFor(kind: RunKind): string {
  switch (kind) {
    case 'easy':
      return 'Rolig løpetur';
    case 'long':
      return 'Langtur – rolig';
    case 'hills':
      return 'Rolig kupert tur';
    case 'intervals4x4':
      return '4 × 4 min intervaller';
    case 'hillIntervals':
      return 'Bakkeintervaller';
  }
}

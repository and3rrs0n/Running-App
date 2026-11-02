/**
 * Progression engine — pure functions, no database access.
 *
 * Philosophy (deliberately conservative, injury-aware):
 *  - Absolute step sizes, never a fixed weekly percentage.
 *  - A new volume level is held for at least 2 weeks before the next step.
 *  - Recovery week after 3 load weeks (once volume ≥ 15 km).
 *  - Pain, fatigue, hard-feeling easy runs, low completion or overshooting the plan → hold or reduce.
 *  - Missed km are never added to later sessions.
 *  - Extra run days are introduced one at a time, only after sustained consistency, and
 *    never in the same week as a volume increase.
 *  - Every decision carries human-readable reasons (Norwegian).
 */
import type { ISODate, PainLocation, RecoveryStatus, Settings, WeekKind } from '../db/types';
import { addDays, diffDays } from './dates';
import { PAIN_LOCATION_LABEL, fmtKm, phaseFor, round05 } from './format';

export interface HistWeek {
  monday: ISODate;
  targetKm: number;
  runCount: number;
  longRunKm?: number;
  kind: WeekKind;
  plannedKm: number;
  completedKm: number;
  runsPlanned: number;
  runsDone: number;
}

export interface PainEvent {
  date: ISODate;
  score: number;
  locations: PainLocation[];
}

export interface Signals {
  pain: PainEvent[]; // run pain reports (any score) — engine filters by date
  lastRunDate?: ISODate;
  lastCheckin?: { monday: ISODate; status: RecoveryStatus };
  avgEasyRpeLastWeek?: number;
}

export interface EngineInput {
  settings: Pick<Settings, 'startWeeklyKm' | 'maxRunsPerWeek' | 'longTermGoalKm' | 'allowHills' | 'allowIntervals'>;
  history: HistWeek[]; // committed weeks before targetMonday, ascending
  targetMonday: ISODate;
  signals: Signals;
}

export type Severity = 'none' | 'mild' | 'repeat' | 'high';

export interface Recommendation {
  targetKm: number;
  runCount: number;
  longRunKm?: number;
  kind: WeekKind;
  phase: number;
  reasons: string[];
  qualitySession?: 'hills' | 'intervals4x4' | 'hillIntervals';
  painSeverity: Severity;
  suggestPause: boolean;
}

export const MIN_WEEK_KM = 6;

export function stepFor(level: number): number {
  if (level < 20) return 2;
  if (level < 35) return 3;
  return 4;
}

export function recommendedRuns(km: number): number {
  if (km < 14) return 2;
  if (km < 26) return 3;
  if (km < 40) return 4;
  return 5;
}

export function completionOf(w: HistWeek): number {
  if (w.plannedKm <= 0) return 1;
  const kmRatio = w.completedKm / w.plannedKm;
  const runRatio = w.runsPlanned > 0 ? w.runsDone / w.runsPlanned : 1;
  return Math.min(kmRatio, runRatio);
}

export function kmRatioOf(w: HistWeek): number {
  return w.plannedKm > 0 ? w.completedKm / w.plannedKm : 1;
}

const LEVEL_KINDS: WeekKind[] = ['start', 'build', 'hold', 'manual', 'restart', 'reduce'];

/** The "working level": target of the most recent non-recovery week. */
export function currentLevel(history: HistWeek[], fallback: number): number {
  for (let i = history.length - 1; i >= 0; i--) {
    if (LEVEL_KINDS.includes(history[i].kind)) return history[i].targetKm;
  }
  return fallback;
}

/** Consecutive weeks (from most recent, skipping recovery weeks) at `level` with good completion. */
export function weeksAtLevel(history: HistWeek[], level: number): number {
  let n = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const w = history[i];
    if (w.kind === 'recovery') continue;
    if (Math.abs(w.targetKm - level) > 0.01) break;
    if (completionOf(w) < 0.85) break;
    n++;
  }
  return n;
}

export function loadWeeksSinceRecovery(history: HistWeek[]): number {
  let n = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const k = history[i].kind;
    if (k === 'recovery' || k === 'reduce' || k === 'restart') break;
    n++;
  }
  return n;
}

export function painSeverity(pain: PainEvent[], targetMonday: ISODate): { sev: Severity; text?: string } {
  const since14 = addDays(targetMonday, -14);
  const since7 = addDays(targetMonday, -7);
  const recent = pain.filter((p) => p.date >= since14 && p.date < targetMonday && p.score > 0);
  if (!recent.length) return { sev: 'none' };
  const max = Math.max(...recent.map((p) => p.score));
  const locText = (ps: PainEvent[]) => {
    const locs = Array.from(new Set(ps.flatMap((p) => p.locations)));
    return locs.length ? ` (${locs.map((l) => PAIN_LOCATION_LABEL[l].toLowerCase()).join(', ')})` : '';
  };
  if (max >= 5) {
    return { sev: 'high', text: `Smerte ${max}/10 registrert siste 14 dager${locText(recent.filter((p) => p.score >= 5))}.` };
  }
  const notable = recent.filter((p) => p.score >= 3);
  if (notable.length >= 2) {
    return { sev: 'repeat', text: `Gjentatt smerte (${notable.length} økter med 3/10 eller mer) siste 14 dager${locText(notable)}.` };
  }
  const recentWeek = notable.filter((p) => p.date >= since7);
  if (recentWeek.length) {
    return { sev: 'mild', text: `Smerte ${recentWeek[0].score}/10 registrert forrige uke${locText(recentWeek)}.` };
  }
  return { sev: 'none' };
}

export function decide(input: EngineInput): Recommendation {
  const { settings, history, targetMonday, signals } = input;
  const startKm = Math.max(MIN_WEEK_KM, settings.startWeeklyKm);
  const maxRuns = Math.max(1, settings.maxRunsPerWeek);
  const goal = Math.max(startKm, settings.longTermGoalKm);

  // ---- First week -------------------------------------------------------
  if (history.length === 0) {
    const runCount = Math.min(2, maxRuns);
    return finish({
      targetKm: startKm,
      runCount,
      kind: 'start',
      painSeverity: 'none',
      reasons: [
        `Forsiktig oppstart: ${fmtKm(startKm)} km fordelt på ${runCount} rolige turer.`,
        'Alt løping er rolig og pratbart. Ingen intervaller eller tempo i tilvenningsfasen.',
      ],
    });
  }

  const last = history[history.length - 1];
  const level = currentLevel(history, startKm);
  const lastCompletion = completionOf(last);
  const pain = painSeverity(signals.pain, targetMonday);
  let runCount = last.runCount;

  // ---- Gap / pause detection ------------------------------------------------
  const gapWeeks = Math.round(diffDays(targetMonday, last.monday) / 7) - 1;
  const daysSinceRun = signals.lastRunDate ? diffDays(targetMonday, signals.lastRunDate) : 999;

  // ---- High pain: reduce substantially, suggest pause & assessment ------------
  if (pain.sev === 'high') {
    const target = Math.max(MIN_WEEK_KM, round05(level * 0.6));
    return finish({
      targetKm: target,
      runCount: Math.min(runCount, 2),
      kind: 'reduce',
      painSeverity: 'high',
      suggestPause: true,
      reasons: [
        pain.text!,
        `Volumet reduseres til ${fmtKm(target)} km. Vurder å ta en pause fra løping til smerten har gitt seg.`,
        'Løp aldri gjennom smerte. Ved vedvarende eller økende smerte: få det vurdert av fysioterapeut eller lege.',
      ],
    });
  }

  // ---- Long gap → restart -----------------------------------------------------
  const noRunsSinceStart = !signals.lastRunDate && history.length >= 2;
  if (gapWeeks >= 2 || noRunsSinceStart || (signals.lastRunDate && daysSinceRun >= 14)) {
    const factor = gapWeeks >= 4 || daysSinceRun >= 28 ? 0.6 : 0.75;
    const target = Math.max(Math.min(startKm, level), round05(level * factor));
    const rc = Math.min(runCount, recommendedRuns(target), maxRuns);
    return finish({
      targetKm: target,
      runCount: Math.max(rc, Math.min(2, maxRuns)),
      kind: 'restart',
      reasons: [
        gapWeeks >= 2
          ? `Planen har stått på vent i ${gapWeeks} uker.`
          : noRunsSinceStart
            ? 'Ingen løpeturer registrert siden planen startet.'
            : `Ingen løpeturer registrert de siste ${daysSinceRun} dagene.`,
        `Gjenopptar forsiktig på ${fmtKm(target)} km (ca. ${Math.round(factor * 100)} % av tidligere nivå) og bygger opp igjen derfra.`,
      ],
    });
  }

  // ---- Repeated pain → reduce ---------------------------------------------------
  if (pain.sev === 'repeat') {
    const target = Math.max(MIN_WEEK_KM, round05(level * 0.75));
    return finish({
      targetKm: target,
      runCount: Math.min(runCount, recommendedRuns(target)),
      kind: 'reduce',
      painSeverity: 'repeat',
      suggestPause: false,
      reasons: [
        pain.text!,
        `Volumet reduseres til ${fmtKm(target)} km, og alle økter holdes rolige.`,
        'Gitt skadehistorikken din: hvis smerten fortsetter, ta en pause og få det vurdert.',
      ],
    });
  }

  // ---- Collect "hold" signals ---------------------------------------------------------
  const holdReasons: string[] = [];
  if (pain.sev === 'mild') holdReasons.push(`${pain.text} Volumet holdes uendret.`);
  const ci = signals.lastCheckin;
  if (ci && ci.monday === last.monday) {
    if (ci.status === 'warning') {
      const target = Math.max(MIN_WEEK_KM, round05(level * 0.7));
      return finish({
        targetKm: target,
        runCount: Math.min(runCount, 2),
        kind: 'reduce',
        painSeverity: 'high',
        suggestPause: true,
        reasons: [
          'Ukevurderingen din meldte mulig skadevarsel.',
          `Volumet reduseres til ${fmtKm(target)} km. Vurder pause og profesjonell vurdering før du øker igjen.`,
        ],
      });
    }
    if (ci.status === 'tired') holdReasons.push('Du meldte at du var uvanlig sliten forrige uke.');
    if (ci.status === 'discomfort') holdReasons.push('Du meldte ubehag forrige uke.');
  }
  if (signals.avgEasyRpeLastWeek !== undefined && signals.avgEasyRpeLastWeek >= 7) {
    holdReasons.push(
      `Rolige turer føltes tunge forrige uke (snitt anstrengelse ${fmtKm(signals.avgEasyRpeLastWeek)}/10). Senk tempoet før volumet økes.`,
    );
  }

  // Completion history
  if (last.kind !== 'recovery') {
    const prev = history.length >= 2 ? history[history.length - 2] : undefined;
    if (lastCompletion < 0.6 && prev && completionOf(prev) < 0.6 && prev.kind !== 'recovery') {
      // Two weak weeks in a row: adapt the plan to what is actually working.
      const avgDone = (last.completedKm + prev.completedKm) / 2;
      const target = Math.max(MIN_WEEK_KM, Math.min(level, round05(Math.max(avgDone * 1.1, level * 0.7))));
      return finish({
        targetKm: target,
        runCount: Math.min(runCount, recommendedRuns(target)),
        kind: 'reduce',
        reasons: [
          `De to siste ukene ble ca. ${Math.round(((completionOf(last) + completionOf(prev)) / 2) * 100)} % av planen gjennomført.`,
          `Planen justeres ned til ${fmtKm(target)} km så den passer hverdagen din. Tapte kilometer tas ikke igjen.`,
        ],
      });
    }
    if (lastCompletion < 0.85) {
      holdReasons.push(
        `Forrige uke ble ${Math.round(lastCompletion * 100)} % gjennomført. Nivået holdes til det sitter, og tapte kilometer tas ikke igjen.`,
      );
    }
  }
  if (kmRatioOf(last) > 1.2) {
    holdReasons.push(
      `Du løp ${fmtKm(last.completedKm)} km mot planlagt ${fmtKm(last.plannedKm)} km. Mer enn planen gir ikke raskere økning – det øker belastningen.`,
    );
  }

  if (holdReasons.length) {
    return finish({ targetKm: level, runCount, kind: 'hold', reasons: holdReasons, painSeverity: pain.sev });
  }

  // ---- Everything looks good ---------------------------------------------------------
  // Return from recovery week
  if (last.kind === 'recovery') {
    const heldBefore = weeksAtLevel(history, level);
    const step = stepFor(level);
    const target = heldBefore >= 2 ? Math.min(goal, level + step) : level;
    return finish({
      targetKm: target,
      runCount,
      kind: target > level ? 'build' : 'hold',
      reasons:
        target > level
          ? [
              'Lettere uke gjennomført uten varsler.',
              `Neste nivå: ${fmtKm(target)} km (+${fmtKm(target - level)} km fra nivået før den lette uken).`,
            ]
          : [`Lettere uke gjennomført. Tilbake på ${fmtKm(level)} km og befester nivået før neste økning.`],
    });
  }

  // Recovery week every 4th week once volume is meaningful
  const loadWeeks = loadWeeksSinceRecovery(history);
  if (level >= 15 && loadWeeks >= 3) {
    const target = Math.max(MIN_WEEK_KM, round05(level * 0.7));
    return finish({
      targetKm: target,
      runCount,
      kind: 'recovery',
      reasons: [
        `${loadWeeks} uker med belastning på rad. En lettere uke (${fmtKm(target)} km) gir kroppen tid til å tilpasse seg.`,
        'Senor, bein og ledd tilpasser seg tregere enn kondisjonen. Lette uker er en del av planen.',
      ],
    });
  }

  // Introduce an extra run day (keeps volume unchanged that week)
  const recRuns = Math.min(recommendedRuns(level), maxRuns);
  if (runCount < recRuns) {
    const recent = history.slice(-4);
    const consistent =
      recent.length >= 4 && recent.every((w) => w.kind === 'recovery' || completionOf(w) >= 0.85);
    if (consistent) {
      return finish({
        targetKm: level,
        runCount: runCount + 1,
        kind: 'hold',
        reasons: [
          `Fire stabile uker uten smertevarsler. Ny løpedag innføres: ${runCount + 1} økter i uken.`,
          'Samme totalvolum fordeles på flere økter, så hver tur blir kortere. Volumet økes ikke samme uke.',
        ],
      });
    }
  }
  if (runCount > maxRuns) runCount = maxRuns;

  if (level >= goal) {
    return finish({
      targetKm: goal,
      runCount,
      kind: 'hold',
      reasons: [`Du er på det langsiktige målet ditt (${fmtKm(goal)} km/uke). Fokus på å vedlikeholde og holde deg skadefri.`],
    });
  }

  const atLevel = weeksAtLevel(history, level);
  if (atLevel >= 2) {
    const step = stepFor(level);
    const target = Math.min(goal, level + step);
    return finish({
      targetKm: target,
      runCount,
      kind: 'build',
      reasons: [
        `${atLevel} gode uker på ${fmtKm(level)} km uten smerte- eller tretthetsvarsler.`,
        `Liten økning til ${fmtKm(target)} km (+${fmtKm(step)} km). Det nye nivået holdes minst to uker før neste steg.`,
      ],
    });
  }

  return finish({
    targetKm: level,
    runCount,
    kind: 'hold',
    reasons: [`Samme nivå (${fmtKm(level)} km) én uke til for å befeste før neste økning.`],
  });

  // ---- helpers ---------------------------------------------------------------------
  function finish(r: {
    targetKm: number;
    runCount: number;
    kind: WeekKind;
    reasons: string[];
    painSeverity?: Severity;
    suggestPause?: boolean;
  }): Recommendation {
    const targetKm = round05(r.targetKm);
    const rc = Math.max(1, Math.min(r.runCount, maxRuns));
    const phase = phaseFor(targetKm);
    let longRunKm: number | undefined;
    if (rc >= 3) {
      const share = rc === 3 ? 0.36 : rc === 4 ? 0.32 : 0.28;
      longRunKm = round05(targetKm * share);
    }
    let qualitySession: Recommendation['qualitySession'];
    const calm = r.kind === 'reduce' || r.kind === 'restart' || r.kind === 'recovery' || r.kind === 'start';
    const painFree28 = !signals.pain.some((p) => p.score >= 3 && p.date >= addDays(targetMonday, -28));
    const weekNo = history.length + 1;
    if (!calm && painFree28) {
      const goodWeeks = history.slice(-8).filter((w) => completionOf(w) >= 0.85 || w.kind === 'recovery').length;
      if (settings.allowIntervals && targetKm >= 30 && rc >= 4 && history.length >= 8 && goodWeeks >= 8) {
        qualitySession = weekNo % 2 === 0 ? 'intervals4x4' : 'hillIntervals';
      } else if (settings.allowHills && targetKm >= 15 && rc >= 3 && weekNo % 2 === 0) {
        qualitySession = 'hills';
      }
    }
    return {
      targetKm,
      runCount: rc,
      longRunKm,
      kind: r.kind,
      phase,
      reasons: r.reasons,
      qualitySession,
      painSeverity: r.painSeverity ?? pain.sev,
      suggestPause: r.suggestPause ?? false,
    };
  }
}

/** Simulate future weeks assuming the plan is followed without warnings (for roadmap / dimmed calendar). */
export function project(
  settings: EngineInput['settings'],
  history: HistWeek[],
  fromMonday: ISODate,
  weeks: number,
): (Recommendation & { monday: ISODate })[] {
  const hist = [...history];
  const out: (Recommendation & { monday: ISODate })[] = [];
  let monday = fromMonday;
  for (let i = 0; i < weeks; i++) {
    const rec = decide({
      settings,
      history: hist,
      targetMonday: monday,
      signals: { pain: [], lastRunDate: hist.length ? addDays(monday, -2) : undefined },
    });
    out.push({ ...rec, monday });
    hist.push({
      monday,
      targetKm: rec.targetKm,
      runCount: rec.runCount,
      longRunKm: rec.longRunKm,
      kind: rec.kind,
      plannedKm: rec.targetKm,
      completedKm: rec.targetKm,
      runsPlanned: rec.runCount,
      runsDone: rec.runCount,
    });
    monday = addDays(monday, 7);
  }
  return out;
}

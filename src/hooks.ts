import { useEffect, useState } from 'react';
import type { ISODate, PlannedSession } from './db/types';
import type { Recommendation } from './logic/engine';
import { projectionFrom } from './logic/plan';
import { buildWeekSessions } from './logic/scheduler';
import type { AppData } from './store';

export type ProjectedWeek = Recommendation & { monday: ISODate };
export interface GhostSession extends PlannedSession {
  ghost: true;
}

/** Projected (not yet committed) future weeks. Recomputed when underlying data changes. */
export function useProjection(data: AppData, weeks = 40): ProjectedWeek[] {
  const [proj, setProj] = useState<ProjectedWeek[]>([]);
  const key = [
    data.weeks.map((w) => w.monday + w.targetKm + w.kind).join(),
    data.activities.length,
    JSON.stringify(data.settings),
  ].join('|');
  useEffect(() => {
    let alive = true;
    projectionFrom(weeks).then((p) => alive && setProj(p));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, weeks]);
  return proj;
}

export function ghostSessions(proj: ProjectedWeek[], data: AppData, limitWeeks = 12): GhostSession[] {
  const out: GhostSession[] = [];
  for (const p of proj.slice(0, limitWeeks)) {
    const first = data.settings.startDate > p.monday ? data.settings.startDate : p.monday;
    const drafts = buildWeekSessions(p, p.monday, 'ghost-' + p.monday, data.settings, first);
    drafts.forEach((d, i) =>
      out.push({ ...d, id: `ghost-${p.monday}-${i}`, createdAt: 0, updatedAt: 0, ghost: true }),
    );
  }
  return out;
}

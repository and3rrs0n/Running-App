import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, DEFAULT_SETTINGS } from './db/db';
import type { Activity, ActivityType, ISODate, Notice, PlannedSession, PlanWeek, Settings, WeeklyCheckin } from './db/types';

export interface AppData {
  ready: boolean;
  settings: Settings;
  activities: Activity[];
  sessions: PlannedSession[];
  weeks: PlanWeek[];
  checkins: WeeklyCheckin[];
  notices: Notice[];
}

export function useData(): AppData {
  const settings = useLiveQuery(async () => {
    const s = await db.settings.get('main');
    return s ? { ...DEFAULT_SETTINGS, ...s } : DEFAULT_SETTINGS;
  });
  const activities = useLiveQuery(() => db.activities.orderBy('date').toArray());
  const sessions = useLiveQuery(() => db.sessions.orderBy('date').toArray());
  const weeks = useLiveQuery(() => db.weeks.orderBy('monday').toArray());
  const checkins = useLiveQuery(() => db.checkins.toArray());
  const notices = useLiveQuery(() => db.notices.toArray());
  const ready = !!(settings && activities && sessions && weeks && checkins && notices);
  return {
    ready,
    settings: settings ?? DEFAULT_SETTINGS,
    activities: activities ?? [],
    sessions: sessions ?? [],
    weeks: weeks ?? [],
    checkins: checkins ?? [],
    notices: notices ?? [],
  };
}

export type Tab = 'hjem' | 'kalender' | 'logg' | 'progresjon' | 'innstillinger';

export type SheetState =
  | { kind: 'register'; sessionId?: string; activityId?: string; type?: ActivityType; date?: ISODate }
  | { kind: 'session'; id: string }
  | { kind: 'addSession'; date?: ISODate }
  | { kind: 'checkin'; monday: ISODate }
  | { kind: 'start'; mode: 'clear' | 'resume' }
  | { kind: 'override'; monday: ISODate }
  | { kind: 'day'; date: ISODate }
  | null;

export interface ConfirmOpts {
  title: string;
  body?: string;
  confirmLabel?: string;
  danger?: boolean;
}

interface UICtx {
  ask: (o: ConfirmOpts) => Promise<boolean>;
  confirmState: (ConfirmOpts & { resolve: (v: boolean) => void }) | null;
  tab: Tab;
  go: (t: Tab) => void;
  sheet: SheetState;
  open: (s: SheetState) => void;
  close: () => void;
  toast: (msg: string) => void;
  toastMsg: string | null;
}

const Ctx = createContext<UICtx | null>(null);

const TABS: Tab[] = ['hjem', 'kalender', 'logg', 'progresjon', 'innstillinger'];

function tabFromHash(): Tab {
  const h = window.location.hash.replace(/^#\/?/, '');
  return (TABS as string[]).includes(h) ? (h as Tab) : 'hjem';
}

export function UIProvider({ children }: { children: ReactNode }) {
  const [tab, setTab] = useState<Tab>(tabFromHash());
  const [stack, setStack] = useState<SheetState[]>([]);
  const [toastMsg, setToast] = useState<string | null>(null);
  const [confirmState, setConfirm] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null);
  const ask = useCallback(
    (o: ConfirmOpts) =>
      new Promise<boolean>((resolve) =>
        setConfirm({
          ...o,
          resolve: (v) => {
            setConfirm(null);
            resolve(v);
          },
        }),
      ),
    [],
  );

  useEffect(() => {
    const onHash = () => setTab(tabFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const go = useCallback((t: Tab) => {
    try {
      history.replaceState(null, '', '#' + t);
    } catch {
      /* ignore */
    }
    setTab(t);
    window.scrollTo({ top: 0 });
  }, []);

  const open = useCallback((s: SheetState) => setStack((st) => [...st, s]), []);
  const close = useCallback(() => setStack((st) => st.slice(0, -1)), []);
  const toast = useCallback((m: string) => {
    setToast(m);
    window.setTimeout(() => setToast((cur) => (cur === m ? null : cur)), 2600);
  }, []);

  return (
    <Ctx.Provider value={{ ask, confirmState, tab, go, sheet: stack[stack.length - 1] ?? null, open, close, toast, toastMsg }}>
      {children}
    </Ctx.Provider>
  );
}

export function useUI(): UICtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('UIProvider missing');
  return c;
}

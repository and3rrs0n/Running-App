import { useEffect } from 'react';
import { CalendarDays, Home as HomeIcon, NotebookPen, Settings as SettingsIcon, TrendingUp } from 'lucide-react';
import { getSettings, requestPersistence } from './db/db';
import { syncPlan } from './logic/plan';
import { UIProvider, useData, useUI, type Tab } from './store';
import Home from './pages/Home';
import CalendarPage from './pages/Calendar';
import LogPage from './pages/Log';
import ProgressPage from './pages/Progress';
import SettingsPage from './pages/Settings';
import { ActivityFormSheet } from './components/ActivityForm';
import { AddSessionSheet, CheckinSheet, DaySheet, OverrideSheet, SessionSheet, StartSheet } from './components/Sheets';
import { cx } from './components/ui';

const NAV: { tab: Tab; label: string; icon: typeof HomeIcon }[] = [
  { tab: 'hjem', label: 'Hjem', icon: HomeIcon },
  { tab: 'kalender', label: 'Kalender', icon: CalendarDays },
  { tab: 'logg', label: 'Logg', icon: NotebookPen },
  { tab: 'progresjon', label: 'Progresjon', icon: TrendingUp },
  { tab: 'innstillinger', label: 'Innstillinger', icon: SettingsIcon },
];

function Shell() {
  const { tab, go, sheet, toastMsg, confirmState } = useUI();
  const { ready } = useData();

  useEffect(() => {
    getSettings().then(() => syncPlan());
    requestPersistence();
    const onVis = () => {
      if (document.visibilityState === 'visible') syncPlan();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  if (!ready) {
    return <div className="flex h-full items-center justify-center text-muted">Laster …</div>;
  }

  return (
    <div className="mx-auto min-h-full max-w-xl">
      <main key={tab} className="animate-fade">
        {tab === 'hjem' && <Home />}
        {tab === 'kalender' && <CalendarPage />}
        {tab === 'logg' && <LogPage />}
        {tab === 'progresjon' && <ProgressPage />}
        {tab === 'innstillinger' && <SettingsPage />}
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-bg/85 backdrop-blur-xl" style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 6px)' }}>
        <div className="mx-auto grid max-w-xl grid-cols-5">
          {NAV.map(({ tab: t, label, icon: Icon }) => (
            <button key={t} onClick={() => go(t)} className={cx('flex flex-col items-center gap-1 pb-1 pt-2.5 text-[10.5px] font-medium transition', tab === t ? 'text-accent' : 'text-dim')}>
              <Icon size={23} strokeWidth={tab === t ? 2.3 : 1.8} />
              {label}
            </button>
          ))}
        </div>
      </nav>

      {sheet?.kind === 'register' && <ActivityFormSheet key={JSON.stringify(sheet)} {...sheet} />}
      {sheet?.kind === 'session' && <SessionSheet key={sheet.id} id={sheet.id} />}
      {sheet?.kind === 'addSession' && <AddSessionSheet date={sheet.date} />}
      {sheet?.kind === 'checkin' && <CheckinSheet monday={sheet.monday} />}
      {sheet?.kind === 'start' && <StartSheet mode={sheet.mode} />}
      {sheet?.kind === 'override' && <OverrideSheet monday={sheet.monday} />}
      {sheet?.kind === 'day' && <DaySheet date={sheet.date} />}

      {confirmState && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center px-6">
          <div className="animate-fade absolute inset-0 bg-black/70" onClick={() => confirmState.resolve(false)} />
          <div role="alertdialog" aria-modal="true" className="animate-fade relative w-full max-w-sm rounded-3xl border border-line bg-[#14171c] p-5 shadow-2xl">
            <div className="text-[17px] font-semibold leading-snug">{confirmState.title}</div>
            {confirmState.body && <p className="mt-2 text-[14px] leading-relaxed text-muted">{confirmState.body}</p>}
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button className="btn-secondary" onClick={() => confirmState.resolve(false)}>
                Avbryt
              </button>
              <button className={confirmState.danger ? 'btn-danger' : 'btn-primary'} onClick={() => confirmState.resolve(true)} autoFocus>
                {confirmState.confirmLabel ?? 'OK'}
              </button>
            </div>
          </div>
        </div>
      )}

      {toastMsg && (
        <div className="pointer-events-none fixed inset-x-0 z-[60] flex justify-center px-4" style={{ top: 'calc(env(safe-area-inset-top) + 10px)' }}>
          <div className="animate-fade rounded-full border border-line bg-raised px-4 py-2.5 text-[14px] font-medium shadow-2xl">{toastMsg}</div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  return (
    <UIProvider>
      <Shell />
    </UIProvider>
  );
}

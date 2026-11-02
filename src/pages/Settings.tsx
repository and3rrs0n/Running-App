import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Download, HardDrive, Pause, Play, ShieldAlert, ShieldCheck, Trash2, Upload } from 'lucide-react';
import { saveSettings } from '../db/db';
import { downloadBackup, importBackup, validateBackup, wipeAll, type ValidationResult } from '../db/backup';
import type { Settings, Surface } from '../db/types';
import { addDays, fmtLong, mondayOf, today, WEEKDAYS, WEEKDAYS_SHORT } from '../logic/dates';
import { SURFACE_LABEL, fmtKm, fmtPace } from '../logic/format';
import { isOnHold, pausePlan, rescheduleFrom, setReadiness, syncPlan } from '../logic/plan';
import { useData, useUI } from '../store';
import { Chip, Field, PageHeader, SectionTitle, Toggle, cx } from '../components/ui';

export default function SettingsPage() {
  const { settings, weeks, activities } = useData();
  const { open, toast, ask } = useUI();
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [usage, setUsage] = useState<string>('');
  const [importState, setImportState] = useState<ValidationResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const t = today();
  const started = weeks.some((w) => w.monday <= t);
  const thisMonday = mondayOf(t);

  useEffect(() => {
    navigator.storage?.persisted?.().then(setPersisted).catch(() => setPersisted(null));
    navigator.storage?.estimate?.().then((e) => {
      if (e.usage !== undefined) setUsage(`${(e.usage / 1024).toFixed(0)} kB brukt`);
    });
  }, []);

  /** Save settings that affect the schedule, then regenerate weeks that have not started. */
  async function saveSchedule(patch: Partial<Settings>) {
    await saveSettings(patch);
    await syncPlan({ force: true });
    toast('Lagret – gjelder uker som ikke er startet');
  }

  async function onStartDate(v: string) {
    if (!v) return;
    if (settings.readiness !== 'cleared' || settings.planStatus === 'paused') {
      await saveSettings({ startDate: v });
      toast(`Foreløpig start: ${fmtLong(v)}`);
      return;
    }
    if (!(await ask({ title: `Flytte planen til ${fmtLong(v)}?`, body: 'Fremtidige planlagte økter flyttes. Registrert historikk endres ikke.', confirmLabel: 'Flytt planen' }))) return;
    await rescheduleFrom(v);
    toast('Planen er flyttet');
  }

  async function onReadiness(v: boolean) {
    if (v) open({ kind: 'start', mode: 'clear' });
    else {
      if (!(await ask({ title: 'Sette planen på vent?', body: 'Fremtidige planlagte økter fjernes til du er klarert igjen. Historikken beholdes.', confirmLabel: 'Sett på vent' }))) return;
      await setReadiness(false);
      toast('Planen står på vent');
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      const text = await f.text();
      setImportState(validateBackup(JSON.parse(text)));
    } catch {
      setImportState({ ok: false, errors: ['Kunne ikke lese filen. Er det en JSON-fil fra Løpeplan?'] });
    }
  }

  async function doImport(mode: 'replace' | 'merge') {
    if (!importState?.file) return;
    if (mode === 'replace' && !(await ask({ title: 'Erstatte alle data?', body: 'Alle nåværende data på denne enheten erstattes med sikkerhetskopien.', confirmLabel: 'Erstatt', danger: true }))) return;
    const res = await importBackup(importState.file, mode);
    setImportState(null);
    await syncPlan();
    toast(mode === 'replace' ? 'Data gjenopprettet' : `${res.added} økter lagt til, ${res.skipped} duplikater hoppet over`);
  }

  return (
    <div className="pb-nav">
      <PageHeader title="Innstillinger" />
      <div className="px-4">
        {/* ---------------- Plan status */}
        <SectionTitle>Oppstart og status</SectionTitle>
        <Group>
          <div className="flex items-center gap-3 py-3">
            {settings.readiness === 'cleared' ? <ShieldCheck className="text-accent" size={22} /> : <ShieldAlert className="text-warn" size={22} />}
            <div className="flex-1">
              <div className="text-[15px] font-semibold">
                {settings.readiness !== 'cleared' ? 'Venter på klarering' : settings.planStatus === 'paused' ? 'Planen er på pause' : 'Planen er aktiv'}
              </div>
              <div className="text-[12.5px] text-muted">
                {weeks.length ? `Plan-uke ${weeks[weeks.length - 1].planWeekNo} · startet ${fmtLong(weeks[0].monday)}` : `Foreløpig start ${fmtLong(settings.startDate)}`}
              </div>
            </div>
          </div>
          <Toggle
            checked={settings.readiness === 'cleared'}
            onChange={onReadiness}
            label="Medisinsk klarert for løping"
            sub="Slå på når kirurgen har godkjent løping. Til da står planen på vent."
          />
          <Row label={started ? 'Neste (gjen)start' : 'Startdato'} sub="Endring flytter fremtidige økter. Historikk flyttes aldri.">
            <input type="date" className="input w-[150px] py-2 text-[15px]" value={settings.startDate} onChange={(e) => onStartDate(e.target.value)} />
          </Row>
          {settings.readiness === 'cleared' && (
            <div className="py-3">
              {settings.planStatus === 'paused' ? (
                <button className="btn-primary w-full" onClick={() => open({ kind: 'start', mode: 'resume' })}>
                  <Play size={16} /> Gjenoppta planen
                </button>
              ) : (
                <button
                  className="btn-secondary w-full"
                  onClick={async () => {
                    if (!(await ask({ title: 'Pause planen?', body: 'Fremtidige planlagte økter fjernes, historikken beholdes. Du kan gjenoppta når som helst.', confirmLabel: 'Pause' }))) return;
                    await pausePlan();
                    toast('Planen er satt på pause');
                  }}
                >
                  <Pause size={16} /> Pause planen
                </button>
              )}
            </div>
          )}
        </Group>

        {/* ---------------- Volume */}
        <SectionTitle>Volum</SectionTitle>
        <Group>
          {!isOnHold(settings) && (
            <div className="grid grid-cols-2 gap-2 py-3">
              {weeks.find((w) => w.monday === thisMonday) && (
                <button className="btn-secondary py-2.5 text-[14px]" onClick={() => open({ kind: 'override', monday: thisMonday })}>
                  Juster ukemål nå
                </button>
              )}
              {weeks.find((w) => w.monday === addDays(thisMonday, 7)) && (
                <button className="btn-secondary py-2.5 text-[14px]" onClick={() => open({ kind: 'override', monday: addDays(thisMonday, 7) })}>
                  Juster neste uke
                </button>
              )}
            </div>
          )}
          <NumRow
            label="Startvolum"
            sub={started ? 'Brukes bare ved oppstart' : 'Løpekilometer i første uke'}
            unit="km"
            value={settings.startWeeklyKm}
            step={1}
            min={4}
            max={40}
            onChange={(v) => saveSchedule({ startWeeklyKm: v })}
          />
          <NumRow
            label="Maks løpeøkter per uke"
            sub="Appen legger til løpedager gradvis opp til dette"
            value={settings.maxRunsPerWeek}
            step={1}
            min={1}
            max={7}
            onChange={(v) => saveSchedule({ maxRunsPerWeek: v })}
          />
          <NumRow
            label="Langsiktig mål"
            sub="Volum appen bygger mot og vedlikeholder"
            unit="km/uke"
            value={settings.longTermGoalKm}
            step={5}
            min={15}
            max={150}
            onChange={(v) => saveSchedule({ longTermGoalKm: v })}
          />
        </Group>

        {/* ---------------- Week structure */}
        <SectionTitle>Ukestruktur</SectionTitle>
        <Group>
          <Row label="Fast gåtur">
            <DaySelect value={settings.walkDay} allowNone onChange={(v) => saveSchedule({ walkDay: v })} />
          </Row>
          {settings.walkDay !== null && (
            <div className="grid grid-cols-2 gap-3 pb-3">
              <Field label="Turdistanse" hint="km">
                <NumInput value={settings.walkDistanceKm} onCommit={(v) => saveSchedule({ walkDistanceKm: v })} />
              </Field>
              <Field label="Høydemeter" hint="m">
                <NumInput value={settings.walkElevationM} onCommit={(v) => saveSchedule({ walkElevationM: v })} />
              </Field>
            </div>
          )}
          <Row label="Styrkedag">
            <DaySelect value={settings.strengthDay} allowNone onChange={(v) => saveSchedule({ strengthDay: v })} />
          </Row>
          <Row label="Langturdag" sub="Brukes når langtur innføres">
            <DaySelect value={settings.longRunDay} onChange={(v) => saveSchedule({ longRunDay: v ?? 5 })} />
          </Row>
          <div className="py-3">
            <div className="text-[15px]">Hviledager</div>
            <div className="mb-2 text-[12.5px] text-muted">Det planlegges aldri økter disse dagene</div>
            <DayChips value={settings.restDays} onChange={(v) => saveSchedule({ restDays: v })} />
          </div>
          <div className="py-3">
            <div className="text-[15px]">Foretrukne løpedager</div>
            <div className="mb-2 text-[12.5px] text-muted">Appen sprer løpeturene og unngår to dager på rad</div>
            <DayChips value={settings.preferredRunDays} onChange={(v) => saveSchedule({ preferredRunDays: v })} />
          </div>
        </Group>

        {/* ---------------- Preferences */}
        <SectionTitle>Treningspreferanser</SectionTitle>
        <Group>
          <div className="py-3">
            <div className="mb-2 text-[15px]">Standard underlag</div>
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(SURFACE_LABEL) as Surface[]).map((s) => (
                <Chip key={s} active={settings.defaultSurface === s} onClick={() => saveSettings({ defaultSurface: s })}>
                  {SURFACE_LABEL[s]}
                </Chip>
              ))}
            </div>
          </div>
          <NumRow
            label="Rolig tempo (sone 2)"
            sub="Brukes til å anslå varighet"
            unit="/km"
            value={settings.easyPaceSecPerKm}
            display={fmtPace(settings.easyPaceSecPerKm)}
            step={5}
            min={240}
            max={600}
            onChange={(v) => saveSchedule({ easyPaceSecPerKm: v })}
          />
          <Toggle
            checked={settings.allowHills}
            onChange={(v) => saveSchedule({ allowHills: v })}
            label="Rolige kuperte turer"
            sub="Annenhver uke fra ca. 15 km/uke og tre løpedager"
          />
          <Toggle
            checked={settings.allowIntervals}
            onChange={(v) => saveSchedule({ allowIntervals: v })}
            label="Intervaller når klar"
            sub="4×4 eller bakkeintervaller, tidligst ved ca. 30 km/uke etter lang stabil periode"
          />
        </Group>

        {/* ---------------- Gym */}
        <SectionTitle>Treningssenter</SectionTitle>
        <Group>
          <Toggle
            checked={settings.gymMember}
            onChange={(v) => saveSchedule({ gymMember: v, gymStartDate: v ? settings.gymStartDate ?? t : settings.gymStartDate })}
            label="Medlem på treningssenter"
            sub="Styrkeøkten blir en senterøkt der du fører øvelsene selv"
          />
          {settings.gymMember && (
            <Row label="Fra dato">
              <input type="date" className="input w-[150px] py-2 text-[15px]" value={settings.gymStartDate ?? ''} onChange={(e) => saveSchedule({ gymStartDate: e.target.value || undefined })} />
            </Row>
          )}
        </Group>

        {/* ---------------- Data */}
        <SectionTitle>Data og sikkerhetskopi</SectionTitle>
        <Group>
          <div className="flex gap-3 py-3">
            <HardDrive className="mt-0.5 shrink-0 text-muted" size={20} />
            <p className="text-[13px] leading-relaxed text-muted">
              Alt lagres lokalt på denne telefonen (IndexedDB). Det er <span className="text-ink">ikke</span> en skybackup. Hvis du sletter appen eller nettstedsdata, forsvinner dataene. Eksporter jevnlig og lagre filen i Filer eller iCloud Drive.
            </p>
          </div>
          <div className="num py-2 text-[12.5px] text-dim">
            {activities.length} økter · {usage || '–'} · {persisted ? 'Vedvarende lagring aktivert' : 'Vedvarende lagring ikke bekreftet'}
            <br />
            Siste eksport: {settings.lastBackupAt ? new Date(settings.lastBackupAt).toLocaleString('nb-NO', { dateStyle: 'medium', timeStyle: 'short' }) : 'aldri'}
          </div>
          <div className="grid grid-cols-2 gap-2 py-3">
            <button
              className="btn-primary"
              onClick={async () => {
                await downloadBackup();
                toast('Sikkerhetskopi eksportert');
              }}
            >
              <Download size={16} /> Eksporter
            </button>
            <button className="btn-secondary" onClick={() => fileRef.current?.click()}>
              <Upload size={16} /> Importer
            </button>
            <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={onFile} />
          </div>
          {importState && (
            <div className={cx('mb-3 rounded-xl p-3 text-[13.5px]', importState.ok ? 'bg-raised' : 'bg-danger/10 text-danger')}>
              {importState.ok && importState.summary ? (
                <>
                  <div className="font-semibold text-ink">Gyldig sikkerhetskopi</div>
                  <div className="mt-1 text-muted">
                    Eksportert {new Date(importState.summary.exportedAt).toLocaleString('nb-NO', { dateStyle: 'medium', timeStyle: 'short' })} · {importState.summary.activities} økter · {importState.summary.weeks} planuker
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button className="btn-secondary py-2.5 text-[14px]" onClick={() => doImport('merge')}>
                      Slå sammen
                    </button>
                    <button className="btn-danger py-2.5 text-[14px]" onClick={() => doImport('replace')}>
                      Erstatt alt
                    </button>
                  </div>
                  <div className="mt-2 text-[12px] text-dim">
                    «Slå sammen» legger bare til økter du ikke har fra før (duplikater hoppes over). «Erstatt alt» gjenoppretter sikkerhetskopien nøyaktig.
                  </div>
                  <button className="mt-2 text-[13px] text-muted" onClick={() => setImportState(null)}>
                    Avbryt
                  </button>
                </>
              ) : (
                <>
                  <div className="font-semibold">Kan ikke importere</div>
                  <ul className="mt-1 list-disc pl-4">
                    {importState.errors.map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                  </ul>
                  <button className="mt-2 text-[13px] underline" onClick={() => setImportState(null)}>
                    Lukk
                  </button>
                </>
              )}
            </div>
          )}
          <div className="py-3">
            <button
              className="flex items-center gap-2 text-[14px] font-medium text-danger"
              onClick={async () => {
                if (!(await ask({ title: 'Slette alle data?', body: 'Alle økter, planer og innstillinger på denne enheten slettes. Ta en sikkerhetskopi først.', confirmLabel: 'Fortsett', danger: true }))) return;
                if (!(await ask({ title: 'Er du helt sikker?', body: 'Dette kan ikke angres.', confirmLabel: 'Slett alt', danger: true }))) return;
                await wipeAll();
                location.reload();
              }}
            >
              <Trash2 size={16} /> Slett alle data
            </button>
          </div>
        </Group>

        <SectionTitle>Om</SectionTitle>
        <Group>
          <p className="py-3 text-[13px] leading-relaxed text-muted">
            Løpeplan er et personlig treningsverktøy. Forslagene bygger på enkle, forsiktige regler og din egen registrerte trening. Appen stiller ingen diagnoser, gir ikke medisinske råd og kan ikke garantere at du unngår skader. Du bestemmer alltid selv. Ved smerte eller usikkerhet: kontakt fysioterapeut eller lege.
          </p>
          <div className="pb-3 text-[12px] text-dim">Versjon 1.0 · ingen konto, ingen sporing, ingen reklame</div>
        </Group>
      </div>
    </div>
  );
}

function Group({ children }: { children: ReactNode }) {
  return <div className="card divide-y divide-line px-4 py-0">{children}</div>;
}

function Row({ label, sub, children }: { label: string; sub?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <div className="text-[15px]">{label}</div>
        {sub && <div className="mt-0.5 text-[12.5px] leading-snug text-muted">{sub}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function NumRow({ label, sub, value, onChange, step, min, max, unit, display }: { label: string; sub?: string; value: number; onChange: (v: number) => void; step: number; min: number; max: number; unit?: string; display?: string }) {
  return (
    <Row label={label} sub={sub}>
      <div className="flex items-center gap-2">
        <button className="flex h-9 w-9 items-center justify-center rounded-full border border-line bg-raised text-[18px]" onClick={() => onChange(Math.max(min, value - step))} aria-label="Mindre">
          −
        </button>
        <div className="num min-w-[58px] text-center text-[16px] font-semibold">
          {display ?? fmtKm(value)}
          {unit && <div className="text-[10.5px] font-normal text-muted">{unit}</div>}
        </div>
        <button className="flex h-9 w-9 items-center justify-center rounded-full border border-line bg-raised text-[18px]" onClick={() => onChange(Math.min(max, value + step))} aria-label="Mer">
          +
        </button>
      </div>
    </Row>
  );
}

function DaySelect({ value, onChange, allowNone }: { value: number | null; onChange: (v: number | null) => void; allowNone?: boolean }) {
  return (
    <select className="input w-[150px] appearance-none py-2 text-[15px] capitalize" value={value === null ? '' : String(value)} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}>
      {allowNone && <option value="">Ingen</option>}
      {WEEKDAYS.map((d, i) => (
        <option key={i} value={i}>
          {d.charAt(0).toUpperCase() + d.slice(1)}
        </option>
      ))}
    </select>
  );
}

function DayChips({ value, onChange }: { value: number[]; onChange: (v: number[]) => void }) {
  return (
    <div className="grid grid-cols-7 gap-1">
      {WEEKDAYS_SHORT.map((d, i) => {
        const on = value.includes(i);
        return (
          <button
            key={i}
            onClick={() => onChange(on ? value.filter((x) => x !== i) : [...value, i].sort())}
            className={cx('rounded-lg border py-2 text-[12.5px] font-semibold capitalize', on ? 'border-transparent bg-ink text-bg' : 'border-line bg-raised text-muted')}
          >
            {d}
          </button>
        );
      })}
    </div>
  );
}

function NumInput({ value, onCommit }: { value: number; onCommit: (v: number) => void }) {
  const [v, setV] = useState(String(value));
  useEffect(() => setV(String(value)), [value]);
  return (
    <input
      className="input num py-2"
      inputMode="decimal"
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        const n = parseFloat(v.replace(',', '.'));
        if (!isNaN(n) && n !== value) onCommit(n);
      }}
    />
  );
}

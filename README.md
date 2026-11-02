# Løpeplan – personlig løpe- og ultratreningsapp (PWA)

En installerbar web-app for iPhone som bygger løpevolum forsiktig opp etter skade og operasjon, med mål om 50+ km/uke og ultradistanser på sikt. Alt lagres lokalt på telefonen. Ingen konto, ingen sky, ingen sporing.

## Kom i gang på iPhone (anbefalt: GitHub Pages, gratis)

1. Lag et nytt **offentlig** repo på GitHub, for eksempel `lopeplan`.
2. Last opp alle filene i denne mappen (ikke `node_modules` og `dist`).
3. I repoet: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
4. Workflowen i `.github/workflows/deploy.yml` bygger og publiserer automatisk ved hver push til `main`. Etter 1–2 minutter ligger appen på `https://<brukernavn>.github.io/lopeplan/`.
5. Åpne adressen i **Safari** på iPhone → Del-knappen → **Legg til på Hjem-skjerm**.
6. Åpne appen fra hjem-skjermen. Den kjører i fullskjerm og fungerer offline.

**Alternativ (Cloudflare Pages):** koble til repoet, build-kommando `npm run build`, output-mappe `dist`.

**Alternativ uten bygging:** last opp innholdet i ferdigbygd `dist/`-mappe til en hvilken som helst statisk hosting (HTTPS kreves for offline-støtte og installasjon).

## Viktig om data

- Data lagres i IndexedDB i Safari-profilen til den installerte appen. Det er **ikke** en skybackup.
- Bruk **Innstillinger → Eksporter** jevnlig og lagre JSON-filen i Filer/iCloud Drive. Appen minner deg på det hver 14. dag.
- **Importer** kan enten *slå sammen* (legger kun til nye økter, hopper over duplikater) eller *erstatte alt* (full gjenoppretting).
- Merk: Safari-fanen og den installerte hjemskjerm-appen har *separat* lagring på iOS. Registrer alltid i den installerte appen.

## Utvikling

```bash
npm install
npm run dev        # utviklingsserver
npm test           # enhetstester for planmotor og lagring
npm run build      # typesjekk + produksjonsbygg til dist/
npm run preview    # test produksjonsbygget lokalt
```

Stack: React 18, TypeScript, Vite 7, Tailwind CSS 3, Dexie 4 (IndexedDB), vite-plugin-pwa (Workbox). Diagrammer er egne lette SVG-komponenter.

## Arkitektur

```
src/
  db/
    types.ts       Domenetyper (Activity, PlannedSession, PlanWeek, Settings …)
    db.ts          Dexie-skjema (versjonert), standardinnstillinger
    backup.ts      Eksport/import med validering og duplikatsjekk
  logic/
    engine.ts      Ren progresjonsmotor – bestemmer neste ukes volum med begrunnelse
    scheduler.ts   Gjør en ukeanbefaling om til økter på konkrete dager
    plan.ts        Kobler motor/planlegger mot databasen (rullerende plan, pause, flytting)
    alerts.ts      Varsler (smerte, manglende registrering, ukevurdering, backup)
    stats.ts       Aggregering for grafer
    dates.ts, format.ts
  components/      UI-byggeklosser, grafer, skjemaer og ark (sheets)
  pages/           Hjem, Kalender, Logg, Progresjon, Innstillinger
```

### Rullerende plan

Bare **inneværende og neste uke** lagres som faktiske økter. Uker lenger frem vises som *foreløpige* (stiplet) og beregnes ved å simulere at planen følges. Neste uke kan regenereres frem til den starter (og de to første dagene hvis ingenting er gjort), med mindre du har låst uken eller endret en økt i den.

Dette gjør at:
- utsatt start, venting på klarering og pause aldri «hopper over» progresjon – neste uke fortsetter der du slapp,
- registrerte økter (egne `activities`-poster med fast dato) aldri flyttes, endres eller slettes av planendringer,
- planen alltid er basert på det du faktisk har gjort.

### Progresjonsregler (engine.ts)

| Situasjon | Beslutning |
|---|---|
| Første uke | Startvolum (10 km), 2 rolige turer |
| Nytt nivå holdt < 2 gode uker | Hold |
| 2 gode uker (≥ 85 % fullført, ingen varsler) | Øk med fast steg: +2 km (< 20), +3 km (< 35), ellers +4 km |
| 3 belastningsuker på rad (fra 15 km) | Lett uke (~70 %) |
| Etter lett uke | Øk bare hvis nivået var holdt i 2 uker før |
| Fullført < 85 % eller løpt > 120 % av plan | Hold (tapte km tas aldri igjen) |
| To uker på rad < 60 % | Juster ned til det som faktisk fungerer |
| Ukevurdering «sliten»/«ubehag», eller rolige turer med snitt-RPE ≥ 7 | Hold |
| Smerte 3–4 forrige uke | Hold |
| Gjentatt smerte (≥ 2 økter ≥ 3/10 siste 14 dager) | Reduser til ~75 % |
| Smerte ≥ 5 eller «mulig skadevarsel» | Reduser til ~60–70 %, foreslå pause og vurdering |
| Opphold ≥ 2 uker | Gjenoppta på 60–75 % av tidligere nivå |
| Ny løpedag | Bare etter 4 stabile uker, én om gangen, og aldri samme uke som volumøkning |
| Kuperte turer | Annenhver uke fra ~15 km og 3 løpedager |
| Intervaller (4×4 / bakke) | Fra ~30 km, 4+ løpedager, 8 gode uker og ingen smerte siste 28 dager |

Med full gjennomføring tar det ca. 20 uker til 30 km/uke og ca. 38 uker til 50 km/uke. Det er bevisst forsiktig. Alle beslutninger har en lesbar begrunnelse, og du kan alltid overstyre en uke manuelt (Kalender → «Hvorfor» → Juster, eller Progresjon → Planen).

### Videreutvikling

- Sykling og svømming: `ActivityType` og aggregeringen er klargjort; planlegging av sykkeløkter kan legges til i `scheduler.ts`.
- Garmin: aktivitetene har feltene som trengs (distanse, tid, puls, høyde). En fremtidig import (FIT/GPX/CSV) kan skrive direkte til `activities`.
- Databaseendringer: legg til ny `this.version(n)` i `db.ts` med `.upgrade()`, og øk `SCHEMA_VERSION`.

## Ansvarsfraskrivelse

Appen gir treningsforslag basert på enkle, forsiktige regler. Den stiller ingen diagnoser, gir ikke medisinske råd og kan ikke garantere at du unngår skader. Ved smerte eller usikkerhet: kontakt fysioterapeut eller lege.

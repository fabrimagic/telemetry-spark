## Obiettivo

Riorganizzare l'intera UI come griglia densa, in dark theme, con tutti i grafici e i testi leggibili e SENZA mai scrolling orizzontale (né a livello pagina, né dentro card/tabelle/grafici).

## Strategia in 4 fasi

### 1. Dark theme nel design system
Lavoro solo su `src/styles.css`, mantenendo i token semantici già esistenti (`--background`, `--card`, `--ink`, `--race-red`, `--hazard`, …). Sposto la palette "pit-wall" attuale (bone su ink) nella sua versione dark di default:

- `--background`: carbon scuro (oklch ~0.13)
- `--card`: leggermente più chiaro del background (~0.17), con `--border` ad alto contrasto
- `--foreground` / `--ink`: bone chiaro (~0.95) per testo principale
- `--muted-foreground` ricalibrato a contrasto WCAG AA (~0.72)
- Accenti race-red e hazard restano (sono già leggibili su scuro)
- Recharts: aggiorno i pochi colori hard-coded (es. `#1e6f8a`) verso varianti più luminose adatte allo scuro, mantenendo la semantica (cool-blue → race-red per i confronti)

Nessun componente nuovo: i pannelli usano già token semantici, quindi cambiano colore "gratis".

### 2. Anti-scroll orizzontale: regole strutturali
Applicate in modo uniforme a tutti i pannelli telemetry:

- `min-w-0` su ogni contenitore flex/grid che ospita testo o tabelle (oggi spesso mancante → causa overflow)
- `overflow-x-auto` SOSTITUITO da `overflow-x-hidden` + tabelle responsive: header sticky compatti, font ridotto (`text-[10px]`), colonne meno critiche nascoste sotto `xl:` con `hidden xl:table-cell`
- Tutti gli SVG custom (box plot, gauge, radar, heatmap brake) racchiusi in un wrapper `w-full` con `<svg viewBox=... preserveAspectRatio="xMidYMid meet" className="block w-full h-auto">` invece di width fissa: scalano dentro la cella della griglia senza creare overflow
- Recharts: già `ResponsiveContainer width="100%"`, ma riduco le altezze fisse (320 → 220) per migliorare densità

### 3. Layout a griglia delle pagine

**`/debrief`** — oggi i pannelli sono impilati verticali a tutta larghezza. Diventa una griglia bento responsive:

```text
┌─────────────────────────────────────────────────────┐
│  SessionBar (full)                                  │
├──────────────────┬──────────────────────────────────┤
│  ToolsetSummary  │  Session/Weather summary cards   │
│  (sticky)        ├──────────────┬───────────────────┤
│                  │ EngineUsage  │ EngineHealth      │
│                  ├──────────────┴───────────────────┤
│                  │ BrakingSignature (heatmap full)  │
│                  ├──────────────────────────────────┤
│                  │ DrivingConsistency               │
│                  ├──────────────┬───────────────────┤
│                  │ Thermal      │ TyreEvolution     │
│                  ├──────────────┴───────────────────┤
│                  │ WeatherEvolution                 │
│                  ├──────────────────────────────────┤
│                  │ BrakeManagement                  │
└──────────────────┴──────────────────────────────────┘
```

Implementazione: `grid grid-cols-12 gap-3` al top, ogni pannello dichiara la sua span (es. `col-span-12 xl:col-span-6` per i panel "metà", `col-span-12` per quelli larghi). Sidebar `ToolsetSummary` `col-span-12 lg:col-span-3 lg:sticky lg:top-4`. Niente container `max-w-7xl` che lascia spazio sprecato — uso tutta la viewport con `px-4`.

**`/`** (landing) — passa a hero + griglia 3-colonne di feature card sotto, compatta in una sola schermata su desktop.

**`/docs`** — layout a 2 colonne: TOC sticky a sinistra (`col-span-3`), contenuto a destra (`col-span-9`), tipografia ridotta e densa.

### 4. Densità testuale uniforme

- Font monospace per dati portato a `text-[11px]` baseline (oggi è misto 11/12)
- Padding card `p-3` invece di `p-4`/`p-5`
- Gap fra sezioni `gap-3` invece di `space-y-5`/`space-y-6`
- Header pannello in una riga: titolo + selettori metrica sulla stessa baseline, niente `mb-2` extra

## File toccati

- `src/styles.css` — dark theme: cambio i valori `:root` (oggi light) e tengo `.dark` come opzionale; il default diventa scuro. Rimappo anche pochi colori hard-coded.
- `src/routes/__root.tsx` — aggiungo `className="dark"` su `<html>` per attivare la classe se ancora referenziata da shadcn.
- `src/routes/debrief.tsx` — riorganizzo in grid 12-col responsive.
- `src/routes/index.tsx` — landing più densa, 3-col features.
- `src/routes/docs.tsx` — 2-col TOC + contenuto.
- Tutti i pannelli `src/components/telemetry/*.tsx` — solo modifiche LAYOUT (min-w-0, overflow hidden, riduzione padding, altezze grafici, SVG responsive). NESSUNA modifica a engine, parser, formule, tooltip, semantica.

## Vincoli che NON tocco

- Engine in `src/lib/ld/**`: invariati
- Numeri, statistiche, etichette, tooltip e disclaimer dei pannelli: invariati
- Logica dei gauge/box plot/radar/heatmap già implementati: solo wrapper SVG reso responsive
- Componenti shadcn: usati come sono, solo i token CSS cambiano

## Verifica finale

- `bunx tsgo --noEmit` deve passare
- Apro `/debrief`, `/`, `/docs` via Playwright a 1280×800 e 1920×1080 → screenshot, verifico zero scrollbar orizzontali e leggibilità contrasto dark

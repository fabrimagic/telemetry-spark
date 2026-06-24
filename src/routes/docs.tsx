import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/docs")({
  head: () => ({
    meta: [
      { title: "Documentazione — MoTeC Pit-Wall Analyzer" },
      {
        name: "description",
        content:
          "Guida d'uso e descrizione tecnica di ogni output della MoTeC Pit-Wall Analyzer: parser, engine di analisi, soglie data-driven, disclaimer.",
      },
      { property: "og:title", content: "Documentazione — MoTeC Pit-Wall Analyzer" },
      {
        property: "og:description",
        content:
          "Guida d'uso e descrizione tecnica di ogni output dell'app: parser, engine, soglie data-driven.",
      },
    ],
  }),
  component: DocsPage,
});

interface TocItem {
  id: string;
  label: string;
  children?: { id: string; label: string }[];
}

const TOC: TocItem[] = [
  { id: "intro", label: "Introduzione" },
  {
    id: "uso",
    label: "Come si usa",
    children: [
      { id: "uso-file", label: "Tipi di file supportati" },
      { id: "uso-flusso", label: "Flusso di lavoro" },
      { id: "uso-privacy", label: "Privacy & runtime" },
    ],
  },
  {
    id: "principi",
    label: "Principi di analisi",
    children: [
      { id: "principi-resolver", label: "Channel resolver logico" },
      { id: "principi-anti-halluc", label: "Anti-hallucination" },
      { id: "principi-validi", label: "Giri validi" },
    ],
  },
  {
    id: "overview",
    label: "Overview — Session",
    children: [
      { id: "overview-session", label: "Session Debrief" },
      { id: "overview-channels", label: "Channel Table" },
      { id: "overview-toolset", label: "Toolset Summary" },
      { id: "overview-pdf", label: "Export PDF" },
    ],
  },
  {
    id: "stint",
    label: "Stint Analysis",
    children: [
      { id: "stint-conditions", label: "Conditions" },
      { id: "stint-lap-table", label: "Lap Table" },
      { id: "stint-tyre", label: "Tyre Evolution" },
      { id: "stint-brake", label: "Brake Management" },
      { id: "stint-engine-health", label: "Engine Health" },
      { id: "stint-drilldown", label: "Lap Detail / Drill-down" },
      { id: "stint-compare", label: "Lap Comparison" },
      { id: "stint-signature", label: "Braking & Traction Signature" },
      { id: "stint-consistency", label: "Driving Consistency" },
      { id: "stint-thermal", label: "Thermal Balance" },
      { id: "stint-engine-usage", label: "Engine Usage" },
      { id: "stint-abs-setup", label: "ABS distribution & Setup timeline" },
    ],
  },
  { id: "limits", label: "Limiti noti & disclaimer" },
  { id: "glossary", label: "Glossario" },
];

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24 space-y-3">
      <h2 className="font-display text-3xl leading-none tracking-wider">
        <a href={`#${id}`} className="hover:text-race-red">{title}</a>
      </h2>
      <div className="space-y-3 text-sm leading-relaxed text-ink/90">{children}</div>
    </section>
  );
}

function Sub({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div id={id} className="scroll-mt-24 space-y-2 border-l-2 border-ink/15 pl-4">
      <h3 className="font-mono text-[11px] uppercase tracking-[0.25em] text-race-red">
        <a href={`#${id}`} className="hover:underline">{title}</a>
      </h3>
      <div className="space-y-2 text-sm leading-relaxed text-ink/90">{children}</div>
    </div>
  );
}

function Tech({ children }: { children: React.ReactNode }) {
  return (
    <div className="border border-ink/20 bg-muted/40 p-3 font-mono text-[11px] leading-relaxed">
      <div className="mb-1 text-[9px] uppercase tracking-[0.25em] text-race-red">
        ◉ Tech note
      </div>
      {children}
    </div>
  );
}

function DocsPage() {
  return (
    <div className="mx-auto w-full max-w-[1400px] min-w-0 px-4 py-5">
      <header className="border-b border-border pb-3 font-mono">
        <div className="text-[9px] uppercase tracking-[0.3em] text-race-red">◉ Documentation</div>
        <h1 className="font-display text-3xl leading-none tracking-wider">
          MoTeC Pit-Wall Analyzer · Manuale
        </h1>
        <p className="mt-2 max-w-3xl text-xs text-muted-foreground">
          Guida operativa e descrizione tecnica di ogni output prodotto dall'app.
          Naviga tramite l'indice a sinistra o usa gli hyperlink in ogni paragrafo.
        </p>
      </header>

      <div className="mt-4 grid grid-cols-12 gap-3">
        {/* ToC */}
        <aside className="col-span-12 min-w-0 lg:col-span-3">
          <nav className="lg:sticky lg:top-4 max-h-[calc(100vh-5rem)] overflow-auto border border-border bg-card p-2">
            <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
              Indice
            </div>
            <ol className="space-y-1 font-mono text-[11px]">
              {TOC.map((item) => (
                <li key={item.id}>
                  <a
                    href={`#${item.id}`}
                    className="block border-l-2 border-transparent px-2 py-1 uppercase tracking-widest text-ink/80 hover:border-race-red hover:bg-hazard/15 hover:text-ink"
                  >
                    {item.label}
                  </a>
                  {item.children && (
                    <ul className="ml-3 mt-1 space-y-0.5">
                      {item.children.map((c) => (
                        <li key={c.id}>
                          <a
                            href={`#${c.id}`}
                            className="block px-2 py-0.5 text-[10px] tracking-wider text-muted-foreground hover:text-race-red"
                          >
                            › {c.label}
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ol>
            <div className="mt-4 border-t border-ink/15 pt-3 text-[10px] font-mono uppercase tracking-widest">
              <Link to="/" className="block py-1 text-ink/70 hover:text-race-red">
                ← Overview
              </Link>
              <Link to="/debrief" className="block py-1 text-ink/70 hover:text-race-red">
                → Stint Analysis
              </Link>
            </div>
          </nav>
        </aside>

        {/* Content */}
        <main className="col-span-12 min-w-0 space-y-6 lg:col-span-9">
          {/* ---------- Intro ---------- */}
          <Section id="intro" title="Introduzione">
            <p>
              MoTeC Pit-Wall Analyzer è uno strumento di analisi di telemetria
              per file <code>.ld</code> / <code>.ldx</code> di MoTeC e
              configurazioni logger <code>.toolset</code>. Il parsing avviene
              interamente nel browser: nessun file lascia mai la macchina
              dell'utente. L'app è organizzata in due pagine principali —
              <Link to="/" className="px-1 text-race-red hover:underline">Overview</Link>
              per il riepilogo della sessione e
              <Link to="/debrief" className="px-1 text-race-red hover:underline">Stint Analysis</Link>
              per l'analisi dettagliata per giro e per zona.
            </p>
            <p>
              La filosofia di tutti gli output è la stessa: <strong>solo numeri
              misurati</strong>, soglie derivate dai dati stessi quando servono,
              degrado neutro quando un canale manca, e disclaimer espliciti
              quando un'osservazione è una stima e non una diagnosi.
            </p>
          </Section>

          {/* ---------- Uso ---------- */}
          <Section id="uso" title="Come si usa">
            <Sub id="uso-file" title="Tipi di file supportati">
              <ul className="list-disc pl-5">
                <li>
                  <code>.ld</code> — file binario MoTeC con i canali di
                  telemetria campionati nel tempo (descrittori in linked-list,
                  campioni <code>int16</code>/<code>int32</code> con fattore di
                  conversione).
                </li>
                <li>
                  <code>.ldx</code> — XML con i metadati di sessione: numero
                  totale di giri e <em>fastest lap</em> con tempo preciso al
                  millesimo. È l'unica fonte autoritativa del tempo veloce.
                </li>
                <li>
                  <code>.toolset</code> — archivio OPC del logger
                  Porsche/Cosworth (CAN, range, allarmi, mappatura I/O).
                  Quando presente, l'app riusa <strong>solo</strong> le sue
                  soglie d'allarme dichiarate; non inventa soglie nuove.
                </li>
              </ul>
            </Sub>

            <Sub id="uso-flusso" title="Flusso di lavoro">
              <ol className="list-decimal space-y-1 pl-5">
                <li>Trascina i file nella zona di drop dell'Overview (o usa <em>Add files</em> nella sidebar).</li>
                <li>L'app parsa in background con un Web Worker e popola la sezione Session.</li>
                <li>Passa a <strong>Stint Analysis</strong> per i pannelli per-giro e per-zona.</li>
                <li>Usa <em>Export PDF</em> per esportare il riepilogo della sessione.</li>
              </ol>
            </Sub>

            <Sub id="uso-privacy" title="Privacy & runtime">
              <p>
                Tutto il parsing è client-side: i file non vengono mai caricati
                su un server. Il parser è dimensionato per file MoTeC tipici
                (centinaia di canali, decine di giri). Il browser carica solo
                gli array di campioni necessari ai pannelli attivi.
              </p>
            </Sub>
          </Section>

          {/* ---------- Principi ---------- */}
          <Section id="principi" title="Principi di analisi">
            <Sub id="principi-resolver" title="Channel resolver logico">
              <p>
                Le feature dell'app non cercano mai nomi di canale per stringa
                esatta. Ogni feature richiede una <em>chiave logica</em>
                (esempi: <code>rpm</code>, <code>speed</code>, <code>throttle</code>,
                <code>brakePress.f</code>, <code>tyreTemp.fl</code>,
                <code>brakeDiscTemp.rr</code>, <code>lapDistance</code>) e il
                resolver la mappa al canale reale tramite una catalogo di
                varianti (uguaglianza normalizzata + inclusione). Se la chiave
                non si risolve la feature degrada con grazia (omessa o segnale
                singolo escluso) anziché rompersi.
              </p>
              <Tech>
                Il resolver vive in <code>src/lib/ld/channelResolver.ts</code>.
                I nomi sono normalizzati (lowercase, spazi compressi) prima
                del match; gli alias per file di team/firmware diversi si
                aggiungono in quel singolo catalogo.
              </Tech>
            </Sub>

            <Sub id="principi-anti-halluc" title="Anti-hallucination">
              <p>
                Nessun pannello inventa soglie o valori. Le uniche soglie
                <em>assolute</em> ammesse sono quelle dichiarate dal toolset
                quando esiste (<code>hasSignificantAlarmRange</code>). Tutte le
                altre soglie sono <strong>data-driven</strong>, derivate dai
                campioni dello stint stesso (percentili, frazioni del picco,
                dispersione tra ruote). Quando un Δ è parziale (es. un solo
                lato/asse a causa di sensori mancanti) viene mostrato ma
                escluso dalle letture interpretative.
              </p>
            </Sub>

            <Sub id="principi-validi" title="Giri validi vs non validi">
              <p>
                Un giro è <strong>valido</strong> se la sua durata è
                sufficiente, non è un frammento di out/in-lap, e i canali
                base sono coerenti. Tutte le metriche aggregate di stint
                considerano <em>solo</em> giri validi; i giri non validi
                restano ispezionabili nel drill-down ma non inquinano le
                statistiche.
              </p>
            </Sub>
          </Section>

          {/* ---------- Overview ---------- */}
          <Section id="overview" title="Overview — Session">
            <p>
              La pagina <Link to="/" className="text-race-red hover:underline">Overview</Link>
              {" "}mostra il riepilogo di alto livello: ribbon di sessione
              (vettura, pista, device, data, giro veloce dall'<code>.ldx</code>),
              tabella canali, debrief di sessione e — se caricato — un
              riepilogo del toolset.
            </p>

            <Sub id="overview-session" title="Session Debrief">
              <p>
                Riepilogo aggregato della sessione: numero giri, tempo veloce
                (sorgente: <code>.ldx</code>), media e dispersione dei
                principali canali. È pensato come "front page" prima
                dell'analisi dettagliata.
              </p>
            </Sub>

            <Sub id="overview-channels" title="Channel Table">
              <p>
                Tutti i canali presenti nel file con frequenza di
                campionamento, unità, range osservato e — quando il toolset è
                presente — la soglia di allarme dichiarata. Utile per capire
                cosa c'è davvero nel file prima di lanciare i pannelli a
                valle.
              </p>
            </Sub>

            <Sub id="overview-toolset" title="Toolset Summary">
              <p>
                Estratto leggibile della configurazione logger: CAN bus, range
                operativi, I/O, e in particolare le soglie d'allarme che gli
                engine a valle riusano <em>tali e quali</em>.
              </p>
            </Sub>

            <Sub id="overview-pdf" title="Export PDF">
              <p>
                Il pulsante <em>Export PDF</em> nella header dell'Overview
                genera un riepilogo a stampa del session debrief. Il rendering
                è statico (non include i grafici interattivi della Stint
                Analysis) e non modifica i dati.
              </p>
            </Sub>
          </Section>

          {/* ---------- Stint ---------- */}
          <Section id="stint" title="Stint Analysis">
            <p>
              La pagina <Link to="/debrief" className="text-race-red hover:underline">Stint Analysis</Link>
              {" "}è l'area di lavoro principale. Tutti i pannelli ricevono lo
              stesso file e la stessa lista di giri segmentati, e tutti
              usano il channel resolver. Sono ordinati dal più descrittivo al
              più interpretativo.
            </p>

            <Sub id="stint-conditions" title="Conditions">
              <p>
                Pioggia (% wet derivata dal canale logger <code>log b wet</code>
                quando presente), temperatura aria, umidità e pressione
                atmosferica medie sulla sessione. Pura aggregazione media
                campionaria; nessuna interpretazione.
              </p>
            </Sub>

            <Sub id="stint-lap-table" title="Lap Table">
              <p>
                Tabella per giro con tempo (a precisione "≈ 1 s" — l'unico
                tempo preciso al millesimo è quello dell'<code>.ldx</code>
                mostrato in Overview), velocità massima, RPM massimo, conteggio
                ABS e flag <em>fastest / invalid / out-lap / abs / alarm</em>.
                Filtrabile per giri validi/non validi e cliccabile per aprire
                il drill-down.
              </p>
              <Tech>
                Segmentazione giri da canale <code>lap number</code> quando
                disponibile, altrimenti euristica con <code>lapDistance</code>;
                tempo giro = differenza dei timestamp di transito. I
                millisecondi reali del giro veloce vengono dall'<code>.ldx</code>.
              </Tech>
            </Sub>

            <Sub id="stint-tyre" title="Tyre Evolution">
              <p>
                Evoluzione di temperatura e pressione gomme per giro valido,
                separatamente per ruota (FL/FR/RL/RR). Calcola warm-up come
                numero di giri iniziali con temperatura media in salita,
                <code>totalTempDelta</code> per ruota (ultimo − primo giro
                valido) e i Δ aggregati di asse e lato.
              </p>
              <Tech>
                Convenzione segni: <em>axleDelta = front − rear</em>,
                <em> sideDelta = left − right</em>. Δ asse calcolato da coppie
                omolaterali (FL-RL, FR-RR); Δ lato da coppie omoasse
                (FL-FR, RL-RR). Quando un sensore manca, il Δ viene calcolato
                solo sulla coppia disponibile e marcato come
                <code>partial</code>: il pannello lo segnala visivamente e gli
                engine a valle (Thermal Balance) lo escludono dalle letture.
              </Tech>
            </Sub>

            <Sub id="stint-brake" title="Brake Management">
              <p>
                Evoluzione delle temperature dei dischi freno per giro valido:
                massimo e medio nel giro per disco, Δ asse e Δ lato per giro,
                trend dei massimi (primo vs ultimo giro). La <em>unica</em>
                soglia mostrata è il range d'allarme del toolset quando
                <code>hasSignificantAlarmRange</code> è vero per quel canale;
                non viene dichiarata nessuna "finestra operativa ottimale".
              </p>
            </Sub>

            <Sub id="stint-engine-health" title="Engine Health">
              <p>
                Bande di salute motore (pressione olio, temperatura acqua/olio,
                tensione batteria, lambda quando disponibili) lette dai canali
                ECU. Soglie usate solo se dichiarate dal toolset; in assenza,
                il pannello mostra il range osservato senza giudizi.
              </p>
            </Sub>

            <Sub id="stint-drilldown" title="Lap Detail / Drill-down">
              <p>
                Cliccando un giro si aprono la <strong>track map</strong>
                (ricostruita da posizione lat/long o da heading × speed
                integrato), le tracce dei canali principali contro
                <code>lapDistance</code>, i marker degli eventi ABS e
                l'eventuale evidenziazione di un cambio assetto selezionato
                dalla timeline globale. Il cursore della mappa è
                bidirezionale: muove la mappa e la posizione campionata sui
                grafici.
              </p>
            </Sub>

            <Sub id="stint-compare" title="Lap Comparison">
              <p>
                Confronto <strong>spaziale</strong> (contro la distanza sul
                giro, non contro il tempo) del giro selezionato con il giro
                più veloce dello stint. I segnali vengono ricampionati su una
                griglia uniforme di 500 punti in distanza; per ogni
                zona-curva rilevata vengono calcolati Δv<sub>min</sub>, spostamento
                del punto di frenata (m) e una stima del Δt per zona derivata
                dall'integrazione di Δ(1/v)·ds.
              </p>
              <Tech>
                Zone-curva rilevate da soglia dinamica della pressione freno
                (18% del picco freno del giro di riferimento). In assenza dei
                canali freno si ricade su rilevamento di minimi locali della
                velocità. Coperture &lt; 70% della griglia generano un avviso
                esplicito.
              </Tech>
            </Sub>

            <Sub id="stint-signature" title="Braking & Traction Signature">
              <p>
                Aggregato di stint: per ogni zona-curva mostra picco di
                pressione freno, distanza del punto di frenata (al 18% del
                picco), lunghezza di rilascio (picco → soglia), distanza di
                riapertura gas (al 50% del picco) e gradiente di riapertura.
                Aggrega anche l'attività ABS per zona (hit totali, frequenza,
                durata media). Le zone con dispersione alta (σ &gt; 1) sono
                evidenziate come <em>variabili</em>, non come "errore di
                guida".
              </p>
            </Sub>

            <Sub id="stint-consistency" title="Driving Consistency">
              <p>
                Misura la ripetibilità della guida usando la firma per zona
                già calcolata da Braking Signature: <strong>dispersione
                spaziale</strong> (σ e coefficiente di variazione CV per
                v<sub>min</sub> e punto di frenata) e <strong>deriva
                temporale</strong> (prima metà vs seconda metà dello stint,
                con il giro centrale assegnato alla prima metà quando il
                numero è dispari). Cali di v<sub>min</sub> o anticipi del
                punto di frenata nella seconda metà sono evidenziati in rosso
                come segnale, non come diagnosi.
              </p>
            </Sub>

            <Sub id="stint-thermal" title="Thermal Balance">
              <p>
                Mette in relazione i segnali termici di gomme e dischi
                <em>già calcolati</em> da Tyre Evolution e Brake Management:
                Δ asse, Δ lato ed evoluzione tra primo e ultimo giro. Il
                pannello produce <strong>letture ingegneristiche come
                ipotesi condizionali</strong> (forma obbligata: "osservato X
                — compatibile con Y; verificare con Z") e mai diagnosi di
                setup. I Δ parziali vengono mostrati ma esclusi dalle letture.
              </p>
              <Tech>
                Convenzione segni: + = anteriore più caldo (asse), + = sinistra
                più calda (lato). Soglia di rilevanza derivata dalla deviazione
                standard dei delta termici per ruota dello stesso engine —
                non da un assoluto inventato. Sotto soglia il pannello
                dichiara <em>bilanciamento neutro</em> anziché forzare
                un'interpretazione.
              </Tech>
            </Sub>

            <Sub id="stint-engine-usage" title="Engine Usage">
              <p>
                Caratterizza l'uso motore a partire dal canale RPM:
                regime massimo per giro e di stint, regime medio in trazione
                (campioni con throttle ≥ 80% del picco throttle del giro),
                percentuale di tempo sopra una soglia alta di regime, eventi
                <strong>over-rev</strong> (picchi statistici sopra il quantile
                99.5% della distribuzione RPM dello stint) e
                <strong>cambiate stimate</strong> da drop di RPM (calo ≥ 10%
                del max in ≤ 1 s, con throttle in trazione se disponibile).
              </p>
              <Tech>
                Tutte le soglie sono derivate dai dati dello stint, non da
                limiti motore assoluti (non disponibili nel file). Gli
                over-rev sono picchi statistici, NON allarmi di danno motore;
                le cambiate sono stime in assenza di un canale marcia
                affidabile, e possono includere eventi spuri (chiusure gas,
                downshift).
              </Tech>
            </Sub>

            <Sub id="stint-abs-setup" title="ABS distribution & Setup change timeline">
              <p>
                Quando non c'è un giro selezionato, l'app mostra la
                distribuzione degli eventi ABS contro la distanza sul giro di
                riferimento e una timeline cronologica dei cambi assetto
                rilevati nei canali <code>brkbias</code>, <code>mappos</code>,
                <code>tc</code>. Cliccando un cambio assetto, l'app apre il
                giro corrispondente e posiziona il cursore sulla mappa al
                punto esatto del cambio.
              </p>
            </Sub>
          </Section>

          {/* ---------- Limits ---------- */}
          <Section id="limits" title="Limiti noti & disclaimer">
            <ul className="list-disc space-y-1 pl-5">
              <li>
                Il <strong>tempo giro preciso</strong> al millesimo è solo
                quello del <code>.ldx</code> per il fastest; i tempi degli
                altri giri visualizzati in tabella sono approssimati al
                secondo perché ricavati dalla segmentazione del canale
                <code>lap number</code>.
              </li>
              <li>
                Senza canale marcia affidabile, l'app <strong>non deduce le
                marce</strong>: le "cambiate" in Engine Usage sono stime da
                drop RPM con disclaimer esplicito.
              </li>
              <li>
                Le letture di Thermal Balance sono <strong>ipotesi
                condizionali</strong>: la temperatura dipende da aerodinamica,
                pesi, mescola e pressioni — fattori non osservabili nei soli
                dati di telemetria.
              </li>
              <li>
                Senza toolset, l'app non dichiara alcuna soglia d'allarme
                assoluta; le soglie restano data-driven e dichiarate
                testualmente con il criterio con cui sono derivate.
              </li>
              <li>
                In presenza di sensori TPMS mancanti per lato o asse, i Δ
                derivati vengono marcati <em>partial</em> e <strong>non</strong>
                vengono usati per le letture interpretative.
              </li>
            </ul>
          </Section>

          {/* ---------- Glossary ---------- */}
          <Section id="glossary" title="Glossario">
            <dl className="grid grid-cols-1 gap-x-6 gap-y-2 md:grid-cols-2">
              <div>
                <dt className="font-mono text-[11px] uppercase tracking-widest text-race-red">Δ asse</dt>
                <dd className="text-sm">Differenza fronte − retro per la grandezza considerata.</dd>
              </div>
              <div>
                <dt className="font-mono text-[11px] uppercase tracking-widest text-race-red">Δ lato</dt>
                <dd className="text-sm">Differenza sinistra − destra per la grandezza considerata.</dd>
              </div>
              <div>
                <dt className="font-mono text-[11px] uppercase tracking-widest text-race-red">Partial</dt>
                <dd className="text-sm">Δ calcolato su un solo lato/asse a causa di sensori mancanti; non rappresentativo.</dd>
              </div>
              <div>
                <dt className="font-mono text-[11px] uppercase tracking-widest text-race-red">CV</dt>
                <dd className="text-sm">Coefficiente di variazione: σ / |media|, adimensionale.</dd>
              </div>
              <div>
                <dt className="font-mono text-[11px] uppercase tracking-widest text-race-red">Over-rev</dt>
                <dd className="text-sm">Picco RPM sopra il quantile 99.5% dello stint; statistica, non allarme di danno.</dd>
              </div>
              <div>
                <dt className="font-mono text-[11px] uppercase tracking-widest text-race-red">Zona-curva</dt>
                <dd className="text-sm">Tratto di pista rilevato da una soglia dinamica della pressione freno (18% del picco) sul giro di riferimento.</dd>
              </div>
            </dl>
          </Section>

          <footer className="border-t border-ink/15 pt-6">
            <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Documentazione interna · ultimo aggiornamento generato dal codice corrente.
            </p>
          </footer>
        </main>
      </div>
    </div>
  );
}

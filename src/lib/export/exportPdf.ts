// Client-side PDF export of the dashboard summary.
// Uses jsPDF + autotable. Reads only data already parsed in the browser —
// no mocks, no recomputation, no network calls.

import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type { LdFile } from "@/lib/ld/types";
import type { ToolsetFile } from "@/lib/toolset/types";

const RED: [number, number, number] = [212, 0, 0];
const INK: [number, number, number] = [20, 20, 20];
const MUTED: [number, number, number] = [110, 110, 110];
const HAZARD: [number, number, number] = [255, 206, 0];
const MARGIN = 36;

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function fmtNum(n: number | undefined): string {
  if (n === undefined || n === null || !Number.isFinite(n)) return "—";
  if (Math.abs(n) > 9999 || (Math.abs(n) < 0.01 && n !== 0)) return n.toExponential(2);
  if (Math.abs(n) >= 1000 || Number.isInteger(n)) return String(n);
  return n.toFixed(3);
}

function fmtRange(min?: number, max?: number): string {
  if (min === undefined && max === undefined) return "—";
  return `${fmtNum(min)} – ${fmtNum(max)}`;
}

function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[_\s]+/g, " ").trim();
}

function getLastY(doc: jsPDF): number {
  // jspdf-autotable attaches lastAutoTable to the doc instance.
  const t = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable;
  return t?.finalY ?? MARGIN;
}

function ensureSpace(doc: jsPDF, neededFromCursor: number, cursorY: number): number {
  const ph = doc.internal.pageSize.getHeight();
  if (cursorY + neededFromCursor > ph - MARGIN) {
    doc.addPage();
    return MARGIN;
  }
  return cursorY;
}

function drawHeaderBand(doc: jsPDF) {
  const w = doc.internal.pageSize.getWidth();
  // Red brand block
  doc.setFillColor(...RED);
  doc.rect(0, 0, w, 22, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("MOTEC // PIT-WALL ANALYZER", MARGIN, 14);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  const ts = new Date().toLocaleString("it-IT");
  doc.text(`Export · ${ts}`, w - MARGIN, 14, { align: "right" });
  // hazard sliver
  doc.setFillColor(...HAZARD);
  doc.rect(0, 22, w, 2, "F");
}

function drawFooter(doc: jsPDF) {
  const pages = doc.getNumberOfPages();
  const w = doc.internal.pageSize.getWidth();
  const h = doc.internal.pageSize.getHeight();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setDrawColor(...INK);
    doc.setLineWidth(0.4);
    doc.line(MARGIN, h - 22, w - MARGIN, h - 22);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text("Riepilogo telemetria — dati parsing client-side, nessun upload.", MARGIN, h - 12);
    doc.text(`Pag. ${i} / ${pages}`, w - MARGIN, h - 12, { align: "right" });
  }
}

function sectionTitle(doc: jsPDF, eyebrow: string, title: string, y: number): number {
  y = ensureSpace(doc, 34, y);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.setTextColor(...RED);
  doc.text(`◉ ${eyebrow.toUpperCase()}`, MARGIN, y);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(...INK);
  doc.text(title, MARGIN, y + 14);
  doc.setDrawColor(...INK);
  doc.setLineWidth(0.6);
  const w = doc.internal.pageSize.getWidth();
  doc.line(MARGIN, y + 18, w - MARGIN, y + 18);
  return y + 26;
}

function metaLine(doc: jsPDF, pairs: Array<[string, string]>, y: number): number {
  y = ensureSpace(doc, 14, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...INK);
  const w = doc.internal.pageSize.getWidth() - MARGIN * 2;
  const colW = w / Math.max(pairs.length, 1);
  pairs.forEach(([k, v], i) => {
    const x = MARGIN + colW * i;
    doc.setTextColor(...MUTED);
    doc.setFontSize(7);
    doc.text(k.toUpperCase(), x, y);
    doc.setTextColor(...INK);
    doc.setFontSize(10);
    doc.text(v, x, y + 11);
  });
  return y + 22;
}

function table(
  doc: jsPDF,
  head: string[][],
  body: (string | number)[][],
  startY: number,
  opts: { colStyles?: Record<number, { halign?: "left" | "right" | "center"; cellWidth?: number }> } = {},
): number {
  autoTable(doc, {
    head,
    body,
    startY,
    margin: { left: MARGIN, right: MARGIN },
    styles: { fontSize: 7.5, cellPadding: 3, textColor: INK, lineColor: [200, 200, 200], lineWidth: 0.2 },
    headStyles: { fillColor: INK, textColor: [255, 255, 255], fontStyle: "bold", fontSize: 7 },
    alternateRowStyles: { fillColor: [245, 245, 245] },
    columnStyles: opts.colStyles,
    didDrawPage: () => {
      // Re-draw the header band on every page so pagination looks consistent.
      drawHeaderBand(doc);
    },
  });
  return getLastY(doc) + 14;
}

function bulletList(doc: jsPDF, items: string[], y: number, max = 40): number {
  if (items.length === 0) return y;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...INK);
  const w = doc.internal.pageSize.getWidth() - MARGIN * 2;
  const slice = items.slice(0, max);
  for (const it of slice) {
    const lines = doc.splitTextToSize(`· ${it}`, w);
    y = ensureSpace(doc, lines.length * 10 + 2, y);
    doc.text(lines, MARGIN, y);
    y += lines.length * 10;
  }
  if (items.length > max) {
    y = ensureSpace(doc, 12, y);
    doc.setTextColor(...MUTED);
    doc.text(`(+${items.length - max} altri elementi non mostrati)`, MARGIN, y);
    y += 12;
    doc.setTextColor(...INK);
  }
  return y + 6;
}

/* --------------------------- Sections --------------------------- */

function drawCover(
  doc: jsPDF,
  files: LdFile[],
  toolsets: ToolsetFile[],
): number {
  drawHeaderBand(doc);
  const primary = files[0];
  const totalChannels = files.reduce((a, f) => a + f.channels.length, 0);
  const totalLaps = files.reduce((a, f) => a + f.laps.length, 0);

  let y = MARGIN + 14;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(28);
  doc.setTextColor(...INK);
  doc.text(primary?.meta.car || "Vettura n/d", MARGIN, y);

  y += 8;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...MUTED);
  const parts = [
    primary?.meta.track || "Pista n/d",
    primary?.meta.device || "Device n/d",
    primary?.meta.date || "Data n/d",
    `Ora ${primary?.meta.time || "n/d"}`,
  ];
  doc.text(parts.join("  ·  "), MARGIN, y + 10);
  y += 28;

  y = metaLine(
    doc,
    [
      ["LD", String(files.length)],
      ["TOOLSET", String(toolsets.length)],
      ["CHN", String(totalChannels)],
      ["LAPS", String(totalLaps)],
    ],
    y,
  );

  if (primary?.meta.fastestTime || primary?.meta.fastestLap) {
    y = ensureSpace(doc, 30, y);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.setTextColor(...RED);
    doc.text("◉ GIRO VELOCE", MARGIN, y);
    doc.setFontSize(24);
    doc.setTextColor(...INK);
    doc.text(primary.meta.fastestTime || "n/d", MARGIN, y + 22);
    doc.setFontSize(9);
    doc.setTextColor(...MUTED);
    doc.text(primary.meta.fastestLap ? `Giro ${primary.meta.fastestLap}` : "—", MARGIN, y + 34);
    y += 44;
  }

  return y;
}

function drawLdFile(doc: jsPDF, file: LdFile, y: number): number {
  y = sectionTitle(doc, "Telemetry · .ld", file.fileName, y);

  y = metaLine(
    doc,
    [
      ["Channels", String(file.channels.length)],
      ["Laps", String(file.laps.length)],
      ["Size", fmtBytes(file.byteLength)],
      ["Device", file.meta.device || "n/d"],
    ],
    y,
  );

  doc.setFont("helvetica", "italic");
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  const note =
    "N = campioni totali del canale nel file" +
    (file.laps.length > 1 ? ` (intero file, ${file.laps.length} giri).` : ".") +
    " Sentinella −1 esclusa per distanze/tempi/contatori. Lap Distance: max = giro più lungo.";
  const lines = doc.splitTextToSize(note, doc.internal.pageSize.getWidth() - MARGIN * 2);
  y = ensureSpace(doc, lines.length * 10 + 4, y);
  doc.text(lines, MARGIN, y);
  y += lines.length * 10 + 4;
  doc.setFont("helvetica", "normal");

  const body = file.channels.map((c) => [
    c.name,
    c.unit || "—",
    String(c.freq),
    String(c.nSamples),
    fmtNum(c.min),
    fmtNum(c.max),
    fmtNum(c.avg),
    c.category,
    c.empty ? "empty" : c.badges.join(",") || "—",
  ]);
  y = table(
    doc,
    [["Channel", "Unit", "Hz", "N", "Min", "Max", "Avg", "Cat", "Flag"]],
    body,
    y,
    {
      colStyles: {
        2: { halign: "right" },
        3: { halign: "right" },
        4: { halign: "right" },
        5: { halign: "right" },
        6: { halign: "right" },
      },
    },
  );

  if (file.laps.length > 0) {
    y = sectionTitle(doc, "Telemetry · giri", "Segmentazione giri", y);
    const lapBody = file.laps.map((l) => [
      String(l.index),
      l.duration.toFixed(3),
      l.tStart.toFixed(3),
      l.tEnd.toFixed(3),
    ]);
    y = table(
      doc,
      [["#", "Durata (s)", "Start (s)", "End (s)"]],
      lapBody,
      y,
      { colStyles: { 0: { halign: "right" }, 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" } } },
    );
  }

  return y;
}

function drawToolset(doc: jsPDF, ts: ToolsetFile, ldFiles: LdFile[], y: number): number {
  y = sectionTitle(doc, "Vehicle config · .toolset", ts.fileName, y);

  const significantCount = ts.displayMeta.filter((m) => m.hasSignificantRange).length;
  const alarmEnabledCount = ts.displayMeta.filter((m) => m.alarmEnabled).length;

  // Counts overview
  y = metaLine(
    doc,
    [
      ["Size", fmtBytes(ts.byteLength)],
      ["Device", ts.deviceHint || "n/d"],
      ["CAN", String(ts.canBuses.length)],
      ["Channels", String(ts.channels.length)],
    ],
    y,
  );
  y = metaLine(
    doc,
    [
      ["Range/Alarm", String(ts.displayMeta.length)],
      ["Significativi", String(significantCount)],
      ["Alarm ON", String(alarmEnabledCount)],
      ["I/O", String(ts.ioSensors.length)],
    ],
    y,
  );
  y = metaLine(
    doc,
    [
      ["Calib hints", String(ts.calibrationHints.length)],
      ["FW/HW", String(ts.versions.length)],
      ["Alarms", String(ts.alarms.length)],
      ["Strings", String(ts.setupStringCount)],
    ],
    y,
  );

  // Cross-ref enrichable count
  if (ldFiles.length > 0) {
    const lookup = new Set<string>();
    for (const c of ts.channels) {
      lookup.add(normalizeName(c.name));
      if (c.description) lookup.add(normalizeName(c.description));
    }
    for (const m of ts.displayMeta) lookup.add(normalizeName(m.sourceName));
    const seen = new Set<string>();
    let count = 0;
    for (const f of ldFiles) {
      for (const ch of f.channels) {
        const k = normalizeName(ch.name);
        if (seen.has(k)) continue;
        seen.add(k);
        if (lookup.has(k)) count++;
      }
    }
    y = ensureSpace(doc, 14, y);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...INK);
    doc.text(`Cross-ref .ld ↔ .toolset: ${count} canali arricchibili`, MARGIN, y);
    y += 14;
  }

  // CAN buses
  if (ts.canBuses.length > 0) {
    y = sectionTitle(doc, "Network", "CAN bus topology", y);
    y = table(
      doc,
      [["Bus", "Label"]],
      ts.canBuses.map((b) => [`CAN${b.id}`, b.label || "—"]),
      y,
      { colStyles: { 0: { cellWidth: 60 } } },
    );
  }

  // Range/Alarm channels
  if (ts.displayMeta.length > 0) {
    y = sectionTitle(
      doc,
      "Telemetry · Range/Alarm",
      `Canali con range e allarmi (${ts.displayMeta.length})`,
      y,
    );
    const body = ts.displayMeta.map((m) => [
      m.sourceName,
      m.category,
      fmtRange(m.minimum, m.maximum) + (!m.hasSignificantRange && m.minimum !== undefined ? " (default)" : ""),
      (m.alarmEnabled ? "⚑ " : "") + fmtRange(m.alarmMinimum, m.alarmMaximum),
      m.userUnit || "—",
      m.decimalPlaces ?? "—",
    ]);
    y = table(
      doc,
      [["Name", "Cat", "Range", "Alarm", "Unit", "Dec"]],
      body,
      y,
      { colStyles: { 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "right" } } },
    );
  }

  // I/O sensors
  if (ts.ioSensors.length > 0) {
    y = sectionTitle(doc, "Hardware", `Sensori fisici · I/O (${ts.ioSensors.length})`, y);
    y = table(
      doc,
      [["Name", "Description", "Port", "Cat"]],
      ts.ioSensors.map((s) => [s.name, s.description, s.port, s.category]),
      y,
    );
  }

  // Calibration hints
  if (ts.calibrationHints.length > 0) {
    y = sectionTitle(
      doc,
      "Reference · raw",
      `Hint di calibrazione (${ts.calibrationHints.length})`,
      y,
    );
    y = bulletList(doc, ts.calibrationHints, y, 60);
  }

  // Firmware/Hardware
  if (ts.versions.length > 0) {
    y = sectionTitle(doc, "Firmware / Hardware", `Versioni (${ts.versions.length})`, y);
    y = bulletList(doc, ts.versions, y, 80);
  }

  // All channels (config)
  if (ts.channels.length > 0) {
    y = sectionTitle(
      doc,
      "Configuration",
      `Tutti i canali di configurazione (${ts.channels.length})`,
      y,
    );
    y = table(
      doc,
      [["Name", "Description", "Cat"]],
      ts.channels.map((c) => [c.name, c.description ?? "—", c.category]),
      y,
    );
  }

  // Alarms
  if (ts.alarms.length > 0) {
    y = sectionTitle(doc, "Diagnostica", `Allarmi / diagnostica (${ts.alarms.length})`, y);
    y = bulletList(doc, ts.alarms, y, 120);
  }

  // OPC parts
  if (ts.parts.length > 0) {
    y = sectionTitle(doc, "Package OPC", `Parti (${ts.parts.length})`, y);
    y = table(
      doc,
      [["Name", "Compr", "Size", "Status"]],
      ts.parts.map((p) => [
        p.name,
        p.methodLabel,
        fmtBytes(p.size),
        p.extracted ? "extracted" : "skipped",
      ]),
      y,
      { colStyles: { 2: { halign: "right" } } },
    );
  }

  // Not extracted
  if (ts.notExtracted.length > 0) {
    y = sectionTitle(doc, "Yellow flag", "Non estratto", y);
    y = bulletList(doc, ts.notExtracted, y, 50);
  }

  return y;
}

/* --------------------------- Entry point --------------------------- */

export function exportSummaryPdf(
  files: LdFile[],
  toolsets: ToolsetFile[],
  fileNameBase?: string,
): void {
  if (files.length === 0 && toolsets.length === 0) {
    throw new Error("Nessun file da esportare");
  }

  const doc = new jsPDF({ unit: "pt", format: "a4" });

  let y = drawCover(doc, files, toolsets);

  for (const f of files) {
    y = ensureSpace(doc, 60, y + 10);
    y = drawLdFile(doc, f, y);
  }
  for (const ts of toolsets) {
    y = ensureSpace(doc, 60, y + 10);
    y = drawToolset(doc, ts, files, y);
  }

  drawFooter(doc);

  const base =
    fileNameBase ||
    files[0]?.fileName?.replace(/\.[^.]+$/, "") ||
    toolsets[0]?.fileName?.replace(/\.[^.]+$/, "") ||
    "telemetry-summary";
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  doc.save(`${base}_riepilogo_${stamp}.pdf`);
}

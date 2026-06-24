// Thermal Balance — relates tyre and brake thermal signals already computed
// by buildTyreEvolution and buildBrakeManagement, with the explicit goal of
// PRESENTING the engineer with a single thermal picture (axle/side, evolution
// across the stint) WITHOUT issuing setup verdicts.
//
// Assumptions and interpretive constraints:
// - This engine NEVER recomputes thermal deltas from raw channels. It only
//   reads the summaries produced by the existing tyre/brake engines, so any
//   anti-hallucination guarantees those engines provide propagate here.
// - Sign convention (declared to the panel and shown to the user):
//     axle delta  = front - rear  (positive => front hotter)
//     side delta  = left  - right (positive => left  hotter)
//   This matches both buildTyreEvolution and buildBrakeManagement.
// - When a tyre delta is partial (single side / single axle, e.g. one TPMS
//   sensor missing) it is REPORTED as raw number but is NEVER fed to any
//   interpretive reading. Partial brake data follows the same rule.
// - Interpretive readings ("readings") are produced as CONDITIONAL HYPOTHESES
//   in the form "observation X — compatible with Y; verify with Z". They are
//   never categorical setup diagnoses; the engineer keeps the final word.
// - Relevance threshold for emitting a reading is derived from the data
//   itself (dispersion of the per-wheel deltas), not from an invented
//   absolute. If the observed delta is comparable to the per-wheel
//   dispersion the engine declares "balance substantially neutral".

import type { LdFile } from "@/lib/ld/types";
import type { LapRow } from "@/lib/ld/stintAnalysis";
import type { ToolsetDisplayMeta } from "@/lib/toolset/types";
import {
  buildTyreEvolution,
  type TyreEvolution,
  type WheelKey,
} from "@/lib/ld/tyreEvolution";
import {
  buildBrakeManagement,
  type BrakeManagement,
} from "@/lib/ld/brakeManagement";

const WHEELS: WheelKey[] = ["fl", "fr", "rl", "rr"];

export type ReadingKind = "tyre-axle" | "tyre-side" | "tyre-evo" | "brake-axle" | "brake-side" | "brake-evo";

export interface Reading {
  id: ReadingKind;
  text: string;
}

export interface ThermalAxisFigure {
  /** Raw delta as published by the source engine (front-rear or left-right). */
  value: number;
  /** True when the source engine flagged the delta as partial. */
  partial: boolean;
  /** Short human-readable note about WHY it is partial (sides/axles missing). */
  partialNote?: string;
}

export interface TyreThermalBlock {
  available: boolean;
  axle?: ThermalAxisFigure;
  side?: ThermalAxisFigure;
  /** Evolution of the axle imbalance across the stint, derived from per-wheel
   *  totalTempDelta (= last lap − first lap) on the wheels with sensor: it is
   *  the change in (front avg − rear avg) over the stint. Undefined when the
   *  required wheels are missing. */
  axleEvolution?: number;
  /** Pooled dispersion across per-wheel total deltas (std). Used as the
   *  data-driven relevance scale for axle/side magnitudes. */
  perWheelDeltaStd?: number;
  warmupLaps?: number;
}

export interface BrakeThermalBlock {
  available: boolean;
  axle?: ThermalAxisFigure; // mean across stint
  side?: ThermalAxisFigure;
  /** Difference between first and last per-lap axle delta. */
  axleEvolution?: number;
  perWheelDeltaStd?: number;
}

export interface ThermalBalance {
  kind: "ok" | "empty";
  message?: string;
  tyre: TyreThermalBlock;
  brake: BrakeThermalBlock;
  readings: Reading[];
}

function stdev(xs: number[]): number | undefined {
  if (xs.length < 2) return undefined;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) * (b - m), 0) / xs.length);
}

function sign(n: number): "+" | "-" | "" {
  if (!Number.isFinite(n)) return "";
  if (n > 0) return "+";
  if (n < 0) return "-";
  return "";
}

function fmt1(n: number): string {
  return `${sign(n) === "-" ? "-" : sign(n) === "+" ? "+" : ""}${Math.abs(n).toFixed(1)}`;
}

function tyrePartialNote(t: TyreEvolution["summary"], axis: "axle" | "side"): string | undefined {
  if (axis === "axle") {
    if (!t.axleDeltaPartial) return undefined;
    const s = t.axleDeltaSides;
    if (!s) return "calcolato su un solo lato";
    if (s.left && !s.right) return "calcolato solo sul lato sinistro (FL–RL)";
    if (s.right && !s.left) return "calcolato solo sul lato destro (FR–RR)";
    return "calcolato su un solo lato";
  }
  if (!t.sideDeltaPartial) return undefined;
  const a = t.sideDeltaAxles;
  if (!a) return "calcolato su un solo asse";
  if (a.front && !a.rear) return "calcolato solo sull'asse anteriore (FL–FR)";
  if (a.rear && !a.front) return "calcolato solo sull'asse posteriore (RL–RR)";
  return "calcolato su un solo asse";
}

function buildTyreBlock(tyre: TyreEvolution): TyreThermalBlock {
  if (!tyre.hasTpms || !tyre.temp.available) {
    return { available: false };
  }
  const s = tyre.summary;
  const block: TyreThermalBlock = { available: true, warmupLaps: s.warmupLaps };

  if (s.axleDeltaAvg !== undefined && Number.isFinite(s.axleDeltaAvg)) {
    block.axle = {
      value: s.axleDeltaAvg,
      partial: !!s.axleDeltaPartial,
      partialNote: tyrePartialNote(s, "axle"),
    };
  }
  if (s.sideDeltaAvg !== undefined && Number.isFinite(s.sideDeltaAvg)) {
    block.side = {
      value: s.sideDeltaAvg,
      partial: !!s.sideDeltaPartial,
      partialNote: tyrePartialNote(s, "side"),
    };
  }

  // Axle evolution from per-wheel totalTempDelta when both axles have at
  // least one homolateral pair available.
  const td = s.totalTempDelta;
  const front: number[] = [];
  const rear: number[] = [];
  for (const w of WHEELS) {
    const v = td[w];
    if (v === undefined || !Number.isFinite(v)) continue;
    if (w === "fl" || w === "fr") front.push(v);
    else rear.push(v);
  }
  if (front.length > 0 && rear.length > 0) {
    const fAvg = front.reduce((a, b) => a + b, 0) / front.length;
    const rAvg = rear.reduce((a, b) => a + b, 0) / rear.length;
    block.axleEvolution = fAvg - rAvg;
  }

  const allDeltas = WHEELS
    .map((w) => td[w])
    .filter((v): v is number => v !== undefined && Number.isFinite(v));
  block.perWheelDeltaStd = stdev(allDeltas);

  return block;
}

function buildBrakeBlock(brake: BrakeManagement): BrakeThermalBlock {
  if (!brake.hasAny) return { available: false };
  const s = brake.summary;
  const block: BrakeThermalBlock = { available: true };

  // Detect "partial" for brake axle/side from BrakeAvailability: brake engine
  // computes per-lap axleDelta/sideDelta only when both sides exist, but if
  // the stint has e.g. only one front + one rear, both contributions still
  // come from a single corner per side. Flag partial accordingly.
  const a = brake.available;
  const axleFullySymmetric = (a.fl && a.fr) && (a.rl && a.rr);
  const sideFullySymmetric = (a.fl && a.rl) && (a.fr && a.rr);

  if (s.axleDeltaAvg !== undefined && Number.isFinite(s.axleDeltaAvg)) {
    block.axle = {
      value: s.axleDeltaAvg,
      partial: !axleFullySymmetric,
      partialNote: axleFullySymmetric ? undefined : "non tutti i 4 dischi disponibili",
    };
  }
  if (s.sideDeltaAvg !== undefined && Number.isFinite(s.sideDeltaAvg)) {
    block.side = {
      value: s.sideDeltaAvg,
      partial: !sideFullySymmetric,
      partialNote: sideFullySymmetric ? undefined : "non tutti i 4 dischi disponibili",
    };
  }

  if (
    s.axleDeltaFirst !== undefined && Number.isFinite(s.axleDeltaFirst) &&
    s.axleDeltaLast !== undefined && Number.isFinite(s.axleDeltaLast)
  ) {
    block.axleEvolution = s.axleDeltaLast - s.axleDeltaFirst;
  }

  const td = s.totalMaxDelta;
  const allDeltas = WHEELS
    .map((w) => td[w])
    .filter((v): v is number => v !== undefined && Number.isFinite(v));
  block.perWheelDeltaStd = stdev(allDeltas);

  return block;
}

/** Decide whether |delta| is large enough to warrant a reading given the
 *  natural dispersion among per-wheel deltas. The rule: |delta| must exceed
 *  the dispersion scale (std). If the dispersion is not computable (≤1 wheel),
 *  we use a conservative fallback of 0 (treat any non-tiny value as
 *  significant ONLY when we have nothing better — but in practice "no
 *  dispersion" means we can't even compute axle/side). */
function isRelevant(delta: number | undefined, scale: number | undefined): boolean {
  if (delta === undefined || !Number.isFinite(delta)) return false;
  if (scale === undefined || !Number.isFinite(scale)) return Math.abs(delta) > 0;
  return Math.abs(delta) > scale;
}

function buildReadings(tyre: TyreThermalBlock, brake: BrakeThermalBlock): Reading[] {
  const out: Reading[] = [];

  // Tyre axle (only if not partial)
  if (tyre.axle && !tyre.axle.partial) {
    if (isRelevant(tyre.axle.value, tyre.perWheelDeltaStd)) {
      const v = tyre.axle.value;
      const side = v > 0 ? "Anteriore" : "Posteriore";
      const other = v > 0 ? "posteriore" : "anteriore";
      out.push({
        id: "tyre-axle",
        text: `${side} mediamente più caldo del ${other} di ${Math.abs(v).toFixed(1)} °C — compatibile con un asse che lavora di più o con maggiore energia su quell'asse; da incrociare con pressioni, carichi e feedback del pilota.`,
      });
    } else {
      out.push({
        id: "tyre-axle",
        text: `Bilancio termico d'asse gomme sostanzialmente neutro (|Δ| ≤ dispersione tra ruote).`,
      });
    }
  }

  // Tyre side (only if not partial)
  if (tyre.side && !tyre.side.partial) {
    if (isRelevant(tyre.side.value, tyre.perWheelDeltaStd)) {
      const v = tyre.side.value;
      const hot = v > 0 ? "sinistro" : "destro";
      out.push({
        id: "tyre-side",
        text: `Lato ${hot} più caldo di ${Math.abs(v).toFixed(1)} °C — può riflettere il layout del circuito (prevalenza di curve in una direzione) più che il setup; valutare nel contesto pista.`,
      });
    } else {
      out.push({
        id: "tyre-side",
        text: `Bilancio termico di lato gomme sostanzialmente neutro.`,
      });
    }
  }

  // Tyre evolution
  if (tyre.axleEvolution !== undefined && tyre.axle && !tyre.axle.partial) {
    if (isRelevant(tyre.axleEvolution, tyre.perWheelDeltaStd)) {
      const v = tyre.axleEvolution;
      const dir = v > 0 ? "verso l'anteriore" : "verso il posteriore";
      out.push({
        id: "tyre-evo",
        text: `Lo sbilanciamento termico d'asse gomme deriva di ${fmt1(v)} °C ${dir} dal primo all'ultimo giro — possibile evoluzione del bilanciamento con il degrado; verificare con i tempi e la guida.`,
      });
    }
  }

  // Brake axle (only if not partial)
  if (brake.axle && !brake.axle.partial) {
    if (isRelevant(brake.axle.value, brake.perWheelDeltaStd)) {
      const v = brake.axle.value;
      const hot = v > 0 ? "anteriori" : "posteriori";
      out.push({
        id: "brake-axle",
        text: `Dischi ${hot} mediamente più caldi di ${Math.abs(v).toFixed(1)} °C — compatibile con maggiore lavoro di frenata su quell'asse; da incrociare con ripartizione frenante, raffreddamento e stile di pedale.`,
      });
    } else {
      out.push({
        id: "brake-axle",
        text: `Bilancio termico d'asse freni sostanzialmente neutro.`,
      });
    }
  }

  // Brake side
  if (brake.side && !brake.side.partial) {
    if (isRelevant(brake.side.value, brake.perWheelDeltaStd)) {
      const v = brake.side.value;
      const hot = v > 0 ? "sinistro" : "destro";
      out.push({
        id: "brake-side",
        text: `Lato ${hot} dei freni più caldo di ${Math.abs(v).toFixed(1)} °C — spesso riconducibile al layout del circuito; verificare incrociando con la mappa pista.`,
      });
    }
  }

  // Brake evolution
  if (brake.axleEvolution !== undefined && brake.axle && !brake.axle.partial) {
    if (isRelevant(brake.axleEvolution, brake.perWheelDeltaStd)) {
      const v = brake.axleEvolution;
      const dir = v > 0 ? "verso l'anteriore" : "verso il posteriore";
      out.push({
        id: "brake-evo",
        text: `Il Δ termico d'asse dei dischi si sposta di ${fmt1(v)} °C ${dir} tra primo e ultimo giro — possibile deriva del bilanciamento di frenata; verificare con ripartizione e degrado.`,
      });
    }
  }

  return out;
}

export function buildThermalBalance(
  file: LdFile,
  laps: LapRow[],
  toolsetMeta: ToolsetDisplayMeta[] | undefined,
): ThermalBalance {
  const tyre = buildTyreEvolution(file, laps);
  const brake = buildBrakeManagement(file, laps, toolsetMeta);

  const tyreBlock = buildTyreBlock(tyre);
  const brakeBlock = buildBrakeBlock(brake);

  if (!tyreBlock.available && !brakeBlock.available) {
    return {
      kind: "empty",
      message: "Nessun canale termico disponibile (né gomme né dischi freno).",
      tyre: tyreBlock,
      brake: brakeBlock,
      readings: [],
    };
  }

  return {
    kind: "ok",
    tyre: tyreBlock,
    brake: brakeBlock,
    readings: buildReadings(tyreBlock, brakeBlock),
  };
}

// Single source of truth for the calculated traction-slip formula.
// Both the aggregate Traction Slip panel (via tractionSlip.ts) and the
// Lap Comparison engine (lapComparison.ts) consume this so the two views
// are numerically coherent. Anti-hallucination discipline:
//  - Slip is CALCULATED from wheel speeds: (vRear − vFront) / vFront · 100.
//  - It is NOT a TC-intervention flag (TC intervention is not logged).
//  - Below V_MIN_KMH the ratio is unstable → emit NaN, don't fabricate 0.
//  - The "in-corner" flag means LESS RELIABLE (geometric track-width
//    contamination), not "wrong" — surface it, never silently mix it.

/** Below this front-axle speed the slip ratio becomes numerically unstable. */
export const V_MIN_KMH = 30;
/** Slip percentage flagged as "significant" by downstream stats. */
export const SLIP_SIGNIFICANT_PCT = 2;

/** Compute slip from four already-resampled wheel-speed arrays on a common
 *  grid (typed-array friendly). Same formula and threshold as the time-domain
 *  path in tractionSlip.ts. Returns null if any wheel speed array is missing
 *  or shapes disagree (degrado neutro). NaN per sample where input is NaN
 *  or vFront < V_MIN_KMH. */
export function computeSlipOnGrid(
  vFL: Float32Array | undefined,
  vFR: Float32Array | undefined,
  vRL: Float32Array | undefined,
  vRR: Float32Array | undefined,
  cornerIndicatorThreshold: number,
): { slip: Float32Array; inCorner: Uint8Array } | null {
  if (!vFL || !vFR || !vRL || !vRR) return null;
  const n = vFL.length;
  if (vFR.length !== n || vRL.length !== n || vRR.length !== n) return null;
  const slip = new Float32Array(n);
  const inCorner = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const a = vFL[i], b = vFR[i], r1 = vRL[i], r2 = vRR[i];
    if (
      !Number.isFinite(a) || !Number.isFinite(b) ||
      !Number.isFinite(r1) || !Number.isFinite(r2)
    ) { slip[i] = NaN; inCorner[i] = 0; continue; }
    const vFront = (a + b) / 2;
    if (vFront < V_MIN_KMH) { slip[i] = NaN; inCorner[i] = 0; continue; }
    const vRear = (r1 + r2) / 2;
    slip[i] = ((vRear - vFront) / vFront) * 100;
    inCorner[i] = Math.abs(a - b) / vFront >= cornerIndicatorThreshold ? 1 : 0;
  }
  return { slip, inCorner };
}

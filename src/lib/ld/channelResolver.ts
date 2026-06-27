// Centralised logical-channel resolution.
//
// Each app feature should refer to channels by a LOGICAL KEY (e.g. "speed",
// "rpm", "tyreTemp.fl") instead of a hard-coded MoTeC channel name. For each
// logical key we keep an ordered list of patterns covering the conventions
// observed in this project's reference file plus reasonable variants from
// other constructors / firmwares. Patterns are tried in order of preference;
// the first match wins.
//
// The pattern list is intentionally EXTENSIBLE: when a new file format
// surfaces a new spelling, just add an alias / regex here. Features that
// depend on a logical channel MUST degrade gracefully (omit the section,
// show "dato non disponibile") when `resolveChannel` returns undefined —
// never fall back to fake zeros or sentinel values.

import type { Channel } from "@/lib/ld/types";

/** Normalisation shared with the rest of the app:
 *  trim + lowercase + collapse runs of `_` / whitespace into a single space. */
export function normName(s: string): string {
  return s.trim().toLowerCase().replace(/[_\s]+/g, " ");
}

export type ChannelPattern =
  | { kind: "exact"; value: string }
  | { kind: "includes"; value: string }
  | { kind: "regex"; value: RegExp };

/** Exact normalised match. */
const eq = (v: string): ChannelPattern => ({ kind: "exact", value: normName(v) });
/** Substring match on the normalised name (e.g. "speed" matches "ground speed"). */
const inc = (v: string): ChannelPattern => ({ kind: "includes", value: normName(v) });
/** Regex match on the normalised name. Use `i` flag freely. */
const re = (v: RegExp): ChannelPattern => ({ kind: "regex", value: v });

export type WheelKey = "fl" | "fr" | "rl" | "rr";

/** All logical keys the app reasons about. */
export type LogicalKey =
  // Vehicle dynamics
  | "speed"
  | "rpm"
  | "throttle"
  | "steeringAngle"
  | "yawRate"
  | "brakePressFront"
  | "brakePressRear"

  // IMU / chassis accelerations (G). Sign convention verified on the project
  // reference files: accLong < 0 = braking, > 0 = acceleration (asymmetric,
  // braking peaks larger in magnitude); accLat symmetric. NEVER use the
  // vertical axis (acc z) for the G-G diagram.
  | "accLong"
  | "accLat"

  // ABS / lap
  | "absActive"
  | "lapDistance"
  | "lapNumber"
  | "lapTimePrev"
  // GPS — high-resolution preferred, low-resolution as fallback
  | "gpsLatHi"
  | "gpsLonHi"
  | "gpsLatLo"
  | "gpsLonLo"
  // Setup-control channels
  | "brakeBias"
  | "engineMap"
  | "tcMap"
  | "tcLat"
  | "tcLon"
  | "tcWet"
  // Environment
  | "wet"
  | "airTemp"
  | "humidity"
  | "airPressure"
  // Engine extras (referenced loosely elsewhere)
  | "engineCoolantTemp"
  | "engineOilTemp"
  | "engineOilPressure"
  | "engineWaterPressure"
  | "engineRailPressure"
  | "fuelPressure"
  // Gearbox — engaged gear and paddle events
  | "gear"
  | "paddleUp"
  | "paddleDown"

  // Suspension travel — reliable (oscillates around zero, ±15-35 mm)
  | "suspTravel.fl" | "suspTravel.fr" | "suspTravel.rl" | "suspTravel.rr"
  // Ride height — RAW / not calibrated (non-physical range, zero zones)
  | "rideHeight.fl" | "rideHeight.fr" | "rideHeight.rl" | "rideHeight.rr"

  // Wheel speed (km/h, 100 Hz). Front wheels are non-driven (free-rolling) on
  // this RWD car and read true vehicle speed; rear wheels are driven and
  // can spin up under traction. Used by the traction-slip engine to COMPUTE
  // slip (no native slip channel — abs Slip * is null and unusable).
  | "wheelSpeedFL" | "wheelSpeedFR" | "wheelSpeedRL" | "wheelSpeedRR"

  // Per-wheel corner channels
  | "brakeDiscTemp.fl" | "brakeDiscTemp.fr" | "brakeDiscTemp.rl" | "brakeDiscTemp.rr"
  | "tyreTemp.fl"      | "tyreTemp.fr"      | "tyreTemp.rl"      | "tyreTemp.rr"
  | "tyrePress.fl"     | "tyrePress.fr"     | "tyrePress.rl"     | "tyrePress.rr";


/** Build the four-corner entries for a base logical key, expanding a list of
 *  base name patterns into the four wheels with all the position spellings
 *  commonly seen in the wild. */
function corners(baseAliases: string[]): Record<WheelKey, ChannelPattern[]> {
  const wheelTokens: Record<WheelKey, string[]> = {
    fl: ["fl", "lf", "front left", "frontleft", "f l", "fnt left", "fr l"],
    fr: ["fr", "rf", "front right", "frontright", "f r", "fnt right", "fr r"],
    rl: ["rl", "lr", "rear left", "rearleft", "r l", "rr l"],
    rr: ["rr", "rr", "rear right", "rearright", "r r"],
  };
  // Add a wheel-only fallback (no base) using a single combined regex per wheel.
  const result: Record<WheelKey, ChannelPattern[]> = { fl: [], fr: [], rl: [], rr: [] };
  for (const w of Object.keys(wheelTokens) as WheelKey[]) {
    const tokens = wheelTokens[w];
    for (const base of baseAliases) {
      for (const t of tokens) {
        result[w].push(eq(`${base} ${t}`));
      }
    }
    // Loose substring fallbacks: base + any wheel token anywhere in the name.
    for (const base of baseAliases) {
      for (const t of tokens) {
        result[w].push(inc(`${base} ${t}`));
      }
    }
  }
  return result;
}

const BRAKE_TEMP_CORNERS = corners(["log brkdisctemp", "brkdisctemp", "brake disc temp", "disc temp", "brake temp"]);
const TYRE_TEMP_CORNERS  = corners(["tpms temp", "tyre temp", "tire temp"]);
const TYRE_PRESS_CORNERS = corners(["tpms press", "tpms pressure", "tyre press", "tyre pressure", "tire pressure"]);

/** The pattern catalogue. Order matters: more specific / higher-quality
 *  variants come FIRST so that they win over loose substring fallbacks. */
const CATALOG: Record<LogicalKey, ChannelPattern[]> = {
  // ---- Vehicle dynamics ----
  speed: [
    eq("ground speed"), eq("groundspeed"),
    eq("vehicle speed"), eq("vcar"), eq("speed"),
    re(/^v\s*car$/i), inc("ground speed"), inc("vehicle speed"),
  ],
  rpm: [
    eq("ecu nmot"), eq("nmot"),
    eq("rpm"), eq("engine rpm"), eq("enginespeed"), eq("engine speed"),
    inc("engine rpm"), inc("nmot"),
  ],
  throttle: [
    eq("ecu aps"), eq("aps"), eq("ath"),
    eq("throttle"), eq("throttle pos"), eq("throttle position"),
    eq("tps"), inc("throttle"),
  ],
  steeringAngle: [
    eq("log asteer"), eq("asteer"),
    eq("steering angle"), eq("steering"), eq("steer"), eq("steer angle"),
    inc("steering angle"), inc("steer angle"),
  ],
  yawRate: [
    eq("sclu yaw rate"), eq("yaw rate"), eq("yaw"),
    eq("imu gyroz"), eq("imu gyro z"), eq("gyro z"),
    inc("yaw rate"),
  ],

  brakePressFront: [
    eq("log pbrake f"), eq("pbrake f"),
    eq("brake pressure front"), eq("brake press f"), eq("brake press front"),
    eq("pbrake front"), re(/^brake\s*press(ure)?\s*(f|fr|front)$/i),
  ],

  // ---- IMU / chassis accelerations (G) ----
  // Primary: 50 Hz "sclu acc x/y" (verified ranges: long ~−1.6…+0.9 G,
  // lat ~±1.5 G). Fallback: 100 Hz IMU "imu accx/accy". Do NOT include
  // "acc z" (vertical, gravity) — not used by the G-G diagram.
  accLong: [
    eq("sclu acc x"), eq("acc x"), eq("accel x"),
    eq("longitudinal acceleration"), eq("long acc"), eq("acc long"),
    eq("imu accx"), eq("imu acc x"),
  ],
  accLat: [
    eq("sclu acc y"), eq("acc y"), eq("accel y"),
    eq("lateral acceleration"), eq("lat acc"), eq("acc lat"),
    eq("imu accy"), eq("imu acc y"),
  ],

  brakePressRear: [
    eq("log pbrake r"), eq("pbrake r"),
    eq("brake pressure rear"), eq("brake press r"), eq("brake press rear"),
    eq("pbrake rear"), re(/^brake\s*press(ure)?\s*(r|rr|rear)$/i),
  ],

  // ---- ABS / lap ----
  absActive: [
    eq("abs active"), eq("abs act"),
    eq("abs"), inc("abs active"),
  ],
  lapDistance: [
    eq("lap distance"), eq("lap dist"), eq("distance lap"),
    eq("lapdist"), inc("lap distance"),
  ],
  lapNumber: [
    eq("lap number"), eq("lap"), eq("lap no"), eq("lap n"),
    eq("lapcount"), inc("lap number"),
  ],
  lapTimePrev: [
    eq("lap time prev"), eq("prev lap time"),
    eq("last lap time"), eq("lap time previous"),
    inc("lap time prev"), inc("previous lap time"),
  ],

  // ---- GPS (preference: high-resolution first) ----
  gpsLatHi: [
    eq("gps latitude"), eq("gps lat hi"),
    re(/^gps\s*latitude(\s|$)/i),
  ],
  gpsLonHi: [
    eq("gps longitude"), eq("gps lon hi"),
    re(/^gps\s*longitude(\s|$)/i),
  ],
  gpsLatLo: [
    eq("log gps lat"), eq("gps lat"),
    re(/(^|\s)gps\s*lat(\s|$)/i),
  ],
  gpsLonLo: [
    eq("log gps lon"), eq("gps lon"), eq("gps long"),
    re(/(^|\s)gps\s*lon(\s|$)/i),
  ],

  // ---- Setup-control channels ----
  brakeBias: [
    eq("log brkbias"), eq("brkbias"),
    eq("brake bias"), eq("brake balance"), eq("bbal"),
    inc("brake bias"),
  ],
  engineMap: [
    eq("ecu mappos"), eq("mappos"),
    eq("engine map"), eq("map position"), eq("map pos"),
    inc("engine map"),
  ],
  // Traction-control configuration channels.
  //
  // Verified against the project's reference .ld files: the only TC channels
  // that are actually logged AND usable are the two driver-selectable maps
  // ("stw rt01 tc lat" 50 Hz, "stw rt03 tc lon" 50 Hz) and the wet-mode flag
  // ("pcu state tc wet" 10 Hz). The intervention flag (ecu_B_tc_act) is NOT
  // logged, and the per-wheel "abs Slip *" channels are null for ~99.7 % of
  // samples — both are deliberately excluded everywhere in the app.
  tcLat: [
    eq("stw rt01 tc lat"), eq("tc lat"),
    eq("tc map"), eq("tc position"), eq("tc level"),
    eq("traction control"), inc("tc map"),
  ],
  tcLon: [
    eq("stw rt03 tc lon"), eq("tc lon"),
  ],
  tcWet: [
    eq("pcu state tc wet"), eq("tc wet"),
  ],
  // Backwards-compatible alias — points at the same patterns as tcLat so any
  // legacy caller still resolves the lateral selector.
  tcMap: [
    eq("stw rt01 tc lat"), eq("tc lat"),
    eq("tc map"), eq("tc position"), eq("tc level"),
    eq("traction control"), inc("tc map"),
  ],

  // ---- Environment ----
  wet: [
    eq("log b wet"), eq("b wet"), eq("wet"),
    eq("wet condition"), eq("wet flag"),
  ],
  airTemp: [
    eq("pth t air"), eq("t air"),
    eq("ambient temp"), eq("ambient temperature"),
    eq("air temp"), eq("air temperature"),
  ],
  humidity: [
    eq("pth r humidity"), eq("humidity"),
    eq("rel humidity"), eq("relative humidity"),
  ],
  airPressure: [
    eq("pth p air"), eq("p air"),
    eq("ambient pressure"), eq("air pressure"),
    eq("barometric pressure"), eq("baro pressure"),
  ],

  // ---- Engine extras ----
  engineCoolantTemp: [
    eq("ecu tmot"), eq("ecu tcool"), eq("tmot"), eq("tcool"), eq("twater"),
    eq("engine coolant t"), eq("engine coolant temp"),
    eq("coolant temp"), eq("coolant temperature"),
    eq("water temp"), eq("water temperature"),
    inc("coolant temp"), inc("water temp"),
  ],
  engineOilTemp: [
    eq("ecu toil"), eq("toil"),
    eq("engine oil temp"),
    eq("oil temp"), eq("oil temperature"),
    inc("oil temp"),
  ],
  engineOilPressure: [
    eq("ecu poil"), eq("poil"),
    eq("oil pressure"), eq("oil press"),
    inc("oil pressure"), inc("oil press"),
  ],
  engineWaterPressure: [
    eq("ecu pwat"), eq("pwat"), eq("pwater"),
    eq("water pressure"), eq("water press"), eq("coolant pressure"),
    inc("water pressure"),
  ],
  engineRailPressure: [
    eq("ecu prail"), eq("prail"),
    eq("rail pressure"), eq("fuel rail pressure"),
    inc("rail pressure"),
  ],
  fuelPressure: [
    eq("ecu pfuel"), eq("pfuel"),
    eq("fuel pressure"), eq("fuel press"),
    inc("fuel pressure"),
  ],

  // ---- Gearbox ----
  // Engaged gear (0..N, -1 = sentinel). Must NOT match gearbox temperature
  // channels (e.g. "ecu tgear", "gear temp"): use only exact matches and a
  // tightly-constrained regex.
  gear: [
    eq("ecu gear"), eq("gear"), eq("current gear"), eq("engaged gear"),
    re(/^(ecu\s+)?gear(\s+pos(ition)?)?$/i),
  ],
  paddleUp: [
    eq("ecu b padup"), eq("paddle up"), eq("padup"),
    eq("shift up"), eq("upshift"),
  ],
  paddleDown: [
    eq("ecu b paddn"), eq("paddle down"), eq("paddn"),
    eq("shift down"), eq("downshift"),
  ],


  // ---- Per-wheel corner channels ----
  "brakeDiscTemp.fl": BRAKE_TEMP_CORNERS.fl,
  "brakeDiscTemp.fr": BRAKE_TEMP_CORNERS.fr,
  "brakeDiscTemp.rl": BRAKE_TEMP_CORNERS.rl,
  "brakeDiscTemp.rr": BRAKE_TEMP_CORNERS.rr,
  "tyreTemp.fl": TYRE_TEMP_CORNERS.fl,
  "tyreTemp.fr": TYRE_TEMP_CORNERS.fr,
  "tyreTemp.rl": TYRE_TEMP_CORNERS.rl,
  "tyreTemp.rr": TYRE_TEMP_CORNERS.rr,

  // ---- Suspension travel (reliable, mm, ~100 Hz) ----
  "suspTravel.fl": [eq("log susp travel fl"), eq("susp travel fl"), eq("damper fl"), eq("shock travel fl")],
  "suspTravel.fr": [eq("log susp travel fr"), eq("susp travel fr"), eq("damper fr"), eq("shock travel fr")],
  "suspTravel.rl": [eq("log susp travel rl"), eq("susp travel rl"), eq("damper rl"), eq("shock travel rl")],
  "suspTravel.rr": [eq("log susp travel rr"), eq("susp travel rr"), eq("damper rr"), eq("shock travel rr")],

  // ---- Ride height (RAW / not calibrated — use as relative trend only) ----
  "rideHeight.fl": [eq("log rideheight fl"), eq("ride height fl"), eq("rideheight fl")],
  "rideHeight.fr": [eq("log rideheight fr"), eq("ride height fr"), eq("rideheight fr")],
  "rideHeight.rl": [eq("log rideheight rl"), eq("ride height rl"), eq("rideheight rl")],
  "rideHeight.rr": [eq("log rideheight rr"), eq("ride height rr"), eq("rideheight rr")],

  // ---- Wheel speed (100 Hz, km/h) ----
  "wheelSpeedFL": [eq("abs speed fl"), eq("wheel speed fl"), eq("speed fl"), eq("vwheel fl")],
  "wheelSpeedFR": [eq("abs speed fr"), eq("wheel speed fr"), eq("speed fr"), eq("vwheel fr")],
  "wheelSpeedRL": [eq("abs speed rl"), eq("wheel speed rl"), eq("speed rl"), eq("vwheel rl")],
  "wheelSpeedRR": [eq("abs speed rr"), eq("wheel speed rr"), eq("speed rr"), eq("vwheel rr")],

  "tyrePress.fl": TYRE_PRESS_CORNERS.fl,
  "tyrePress.fr": TYRE_PRESS_CORNERS.fr,
  "tyrePress.rl": TYRE_PRESS_CORNERS.rl,
  "tyrePress.rr": TYRE_PRESS_CORNERS.rr,
};

/** All logical keys known to the resolver, in declaration order. Exposed for
 *  diagnostic tooling (e.g. the Channel Mapping panel) that needs to iterate
 *  the catalogue without reimplementing it. */
export const ALL_LOGICAL_KEYS: LogicalKey[] =
  Object.keys(CATALOG) as LogicalKey[];

/** Human-readable view of the patterns associated with a logical key.
 *  `=` denotes exact (normalised) match, `~` substring, `re:` a regex.
 *  Read-only convenience for diagnostic UIs — does NOT drive matching. */
export function describePatterns(key: LogicalKey): string[] {
  const patterns = CATALOG[key];
  if (!patterns) return [];
  return patterns.map((p) => {
    switch (p.kind) {
      case "exact":    return `= ${p.value}`;
      case "includes": return `~ ${p.value}`;
      case "regex":    return `re: ${p.value.source}`;
    }
  });
}

function isUsable(c: Channel): boolean {
  return !c.empty && c.nSamples > 0;
}

/** Predicate variant of `isUsable` for external diagnostic tooling. Mirrors
 *  exactly the filter applied by `resolveChannel`. */
export function isChannelUsable(c: Channel): boolean {
  return isUsable(c);
}


function matches(name: string, p: ChannelPattern): boolean {
  switch (p.kind) {
    case "exact":    return name === p.value;
    case "includes": return name.includes(p.value);
    case "regex":    return p.value.test(name);
  }
}

/** Resolve a single logical channel. Returns undefined when nothing matches. */
export function resolveChannel(
  channels: Channel[],
  key: LogicalKey,
): Channel | undefined {
  const patterns = CATALOG[key];
  if (!patterns) return undefined;
  // Pre-compute normalised names once.
  const candidates = channels
    .filter(isUsable)
    .map((c) => ({ c, n: normName(c.name) }));
  for (const p of patterns) {
    for (const { c, n } of candidates) {
      if (matches(n, p)) return c;
    }
  }
  return undefined;
}

/** Convenience: resolve the four corners of a 4-wheel logical channel. */
export function resolveCorners(
  channels: Channel[],
  base: "brakeDiscTemp" | "tyreTemp" | "tyrePress",
): Record<WheelKey, Channel | undefined> {
  return {
    fl: resolveChannel(channels, `${base}.fl` as LogicalKey),
    fr: resolveChannel(channels, `${base}.fr` as LogicalKey),
    rl: resolveChannel(channels, `${base}.rl` as LogicalKey),
    rr: resolveChannel(channels, `${base}.rr` as LogicalKey),
  };
}

/** Convenience: at least one of the four corners is present. */
export function hasAnyCorner(
  channels: Channel[],
  base: "brakeDiscTemp" | "tyreTemp" | "tyrePress",
): boolean {
  const c = resolveCorners(channels, base);
  return !!(c.fl || c.fr || c.rl || c.rr);
}

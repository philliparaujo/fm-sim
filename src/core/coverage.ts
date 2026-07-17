import { yardsToPx } from "../utils/units";
import { Coverage, DefensiveCoverageType, Vector } from "./types";

/**
 * The five non-line defenders whose pre-snap alignment this module controls.
 * LE/DT/RE always rush the passer from a fixed spot on the line — they aren't
 * part of a coverage structure and are aligned directly in playbook.ts.
 */
export type CoverageLabel = "CB" | "NB" | "LB" | "FS" | "SS";
export const COVERAGE_LABELS: CoverageLabel[] = ["CB", "NB", "LB", "FS", "SS"];

/** Pre-snap shade relative to a man defender's matchup receiver. */
export type Leverage = "inside" | "outside" | "head-up";

/** How far downfield a zone defender lines up. The sim copies a defender's
 * snap alignment into their live zone anchor (see sim/assignments.ts), so
 * this also decides how deep they actually play during the down. */
export type ZoneDepth = "shallow" | "normal" | "deep";

/** A named spot-drop landmark for a zone defender. */
export type ZoneLandmark =
  | "flatLeft"
  | "flatRight"
  | "hookLeft"
  | "hookMiddle"
  | "hookRight"
  | "deepLeft"
  | "deepMiddle"
  | "deepRight";

/** The offensive labels a man defender can be locked onto pre-snap. Live
 * target acquisition (sim/assignments.ts) locks CB/NB/LB onto XR/ZR/TE by
 * label and falls back to proximity for anyone else in man — so a matchup
 * outside that trio still aligns correctly here but tracks its target more
 * loosely once the ball is snapped. */
export type ManMatchup = "XR" | "ZR" | "TE";

export type CoverageAssignment =
  | { kind: "blitz" }
  | { kind: "man"; matchup: ManMatchup; leverage: Leverage }
  | { kind: "zone"; landmark: ZoneLandmark; depth: ZoneDepth };

/**
 * A full defensive coverage call: one assignment per non-line defender. This
 * is the single source of truth for what the defense is doing — describing a
 * new coverage (a disguised pressure, a two-read shell, a blitz off any
 * label) is just a new value of this shape. Nothing else needs to change.
 */
export type CoverageStructure = {
  name: string;
  /** How many defenders play a deep "high" role. Informational only — not
   * consumed by the resolver, useful for UI/labeling/analytics. */
  safeties: 0 | 1 | 2;
  assignments: Record<CoverageLabel, CoverageAssignment>;
};

/** Field geometry + the offense's actual pre-snap alignment, needed to turn
 * an abstract assignment into real coordinates. */
export type CoverageContext = {
  los: number;
  centerY: number;
  fieldHeight: number;
  /** Actual Y of each catcher, if that label is fielded this play. */
  catcherY: Partial<Record<ManMatchup, number>>;
};

export type ResolvedCoverage = {
  role: "coverer" | "rusher";
  loc: Vector;
  coverage?: Coverage;
};

// ── Alignment tables ─────────────────────────────────────────────────────
// The only numbers in the whole module — everything above is just naming
// them. Add a landmark or depth tier here and every structure can use it.

const ZONE_DEPTH_YARDS: Record<ZoneDepth, number> = {
  shallow: 5,
  normal: 10,
  deep: 30,
};

// Y position as a fraction of field height (0 = top sideline, 1 = bottom).
const ZONE_LANDMARK_Y: Record<ZoneLandmark, number> = {
  flatLeft: 0.1,
  hookLeft: 0.25,
  hookMiddle: 0.5,
  hookRight: 0.75,
  flatRight: 0.9,
  deepLeft: 0.25,
  deepMiddle: 0.5,
  deepRight: 0.75,
};

// Fallback Y (as a fraction of field height, offset from center) used when a
// man matchup's receiver isn't actually fielded this play.
const MAN_DEFAULT_Y_OFFSET: Record<ManMatchup, number> = {
  XR: -0.375,
  ZR: 0.375,
  TE: 0,
};

const MAN_DEPTH_YARDS = 10;
const LEVERAGE_SHADE_FRACTION = 0.05; // 5% of field height

// The DL (LE/DT/RE — see playbook.ts) always lines up at LOS+3yd, straddling
// centerY at 0 and ±(1/7)*fieldHeight. Blitz lanes below are chosen to never
// land on those three fixed spots, or on each other.
const DL_GAP_Y = 1 / 14; // fraction of fieldHeight — halfway between DT and LE/RE

/** Blitz alignment per label: underneath defenders (CB/NB/LB) creep up from
 * their normal lane at a shallow depth; safeties come off depth from a
 * random hash, mirroring a disguised safety blitz. */
function blitzLoc(
  label: CoverageLabel,
  ctx: CoverageContext,
  safetyBlitzSide: 0 | 1,
): Vector {
  const { los, centerY, fieldHeight } = ctx;
  if (label === "FS" || label === "SS") {
    // When both safeties blitz (e.g. Cover 0), they must come off opposite
    // hashes — SS takes the chosen side, FS always takes the other one, so
    // the two can never land on the same spot.
    const side = label === "SS" ? safetyBlitzSide : 1 - safetyBlitzSide;
    const y = side === 0 ? fieldHeight * 0.25 : fieldHeight * 0.75;
    return { x: los + yardsToPx(6), y };
  }
  if (label === "LB") {
    // An A-gap blitz, not lined up on top of DT (which sits at centerY).
    const gapSide = Math.random() < 0.5 ? -1 : 1;
    return {
      x: los + yardsToPx(6),
      y: centerY + gapSide * DL_GAP_Y * fieldHeight,
    };
  }
  const laneY: Record<"CB" | "NB", number> = {
    CB: centerY - 0.35 * fieldHeight,
    NB: centerY + 0.35 * fieldHeight,
  };
  return { x: los + yardsToPx(3), y: laneY[label as "CB" | "NB"] };
}

function manLoc(
  assignment: Extract<CoverageAssignment, { kind: "man" }>,
  ctx: CoverageContext,
): Vector {
  const { los, centerY, fieldHeight, catcherY } = ctx;
  const baseY =
    catcherY[assignment.matchup] ??
    centerY + MAN_DEFAULT_Y_OFFSET[assignment.matchup] * fieldHeight;

  const shade = LEVERAGE_SHADE_FRACTION * fieldHeight;
  const towardCenter = baseY < centerY ? shade : -shade;
  const yOffset =
    assignment.leverage === "inside"
      ? towardCenter
      : assignment.leverage === "outside"
        ? -towardCenter
        : 0;

  return { x: los + yardsToPx(MAN_DEPTH_YARDS), y: baseY + yOffset };
}

function zoneLoc(
  assignment: Extract<CoverageAssignment, { kind: "zone" }>,
  ctx: CoverageContext,
): Vector {
  return {
    x: ctx.los + yardsToPx(ZONE_DEPTH_YARDS[assignment.depth]),
    y: ZONE_LANDMARK_Y[assignment.landmark] * ctx.fieldHeight,
  };
}

/** Turns one label's abstract assignment into a concrete alignment + role. */
function resolveAssignment(
  label: CoverageLabel,
  assignment: CoverageAssignment,
  ctx: CoverageContext,
  safetyBlitzSide: 0 | 1,
): ResolvedCoverage {
  switch (assignment.kind) {
    case "blitz":
      return { role: "rusher", loc: blitzLoc(label, ctx, safetyBlitzSide) };
    case "man":
      return { role: "coverer", coverage: "man", loc: manLoc(assignment, ctx) };
    case "zone":
      return {
        role: "coverer",
        coverage: "zone",
        loc: zoneLoc(assignment, ctx),
      };
  }
}

/** Resolves every label in a coverage structure into concrete pre-snap
 * alignment. This is the only function playbook.ts needs to call. */
export function resolveCoverage(
  structure: CoverageStructure,
  ctx: CoverageContext,
): Record<CoverageLabel, ResolvedCoverage> {
  const out = {} as Record<CoverageLabel, ResolvedCoverage>;
  // Chosen once per resolution so SS/FS blitzing on the same play always end
  // up on opposite hashes (see blitzLoc) instead of each independently
  // risking the same spot.
  const safetyBlitzSide: 0 | 1 = Math.random() < 0.5 ? 0 : 1;
  for (const label of COVERAGE_LABELS) {
    out[label] = resolveAssignment(
      label,
      structure.assignments[label],
      ctx,
      safetyBlitzSide,
    );
  }
  return out;
}

/** Coarse (man|zone) x (blitz|no-blitz) bucket for the existing stats/box
 * score infrastructure, which only knows about DefensiveCoverageType's four
 * values. Uses CB's assignment as a proxy for the underneath scheme. Custom
 * structures still classify sensibly under this; extend DefensiveCoverageType
 * itself if finer-grained stat buckets are ever needed. */
export function classifyStructure(
  structure: CoverageStructure,
): DefensiveCoverageType {
  const isBlitz = Object.values(structure.assignments).some(
    (a) => a.kind === "blitz",
  );
  const isMan = structure.assignments.CB.kind === "man";
  if (isBlitz) return isMan ? "manBlitz" : "zoneBlitz";
  return isMan ? "man" : "zone";
}

// ── Presets ──────────────────────────────────────────────────────────────
// A library of named coverage structures. Add new ones freely — nothing else
// in the codebase needs to change to support a new shape.

function man(
  matchup: ManMatchup,
  leverage: Leverage = "head-up",
): CoverageAssignment {
  return { kind: "man", matchup, leverage };
}
function zone(
  landmark: ZoneLandmark,
  depth: ZoneDepth = "normal",
): CoverageAssignment {
  return { kind: "zone", landmark, depth };
}
const BLITZ: CoverageAssignment = { kind: "blitz" };

/** 2 deep safeties, man coverage underneath, no extra pressure. */
export const COVER_2_MAN: CoverageStructure = {
  name: "Cover 2 Man",
  safeties: 2,
  assignments: {
    CB: man("XR"),
    NB: man("ZR"),
    LB: man("TE"),
    SS: zone("deepLeft", "deep"),
    FS: zone("deepRight", "deep"),
  },
};

/** 2 deep safeties, 3-defender zone shell underneath (2 flats + a hook/middle). */
export const COVER_2_ZONE: CoverageStructure = {
  name: "Cover 2 Zone",
  safeties: 2,
  assignments: {
    CB: zone("flatLeft"),
    NB: zone("flatRight"),
    LB: zone("hookMiddle"),
    SS: zone("deepLeft", "deep"),
    FS: zone("deepRight", "deep"),
  },
};

/** Single-high safety, man underneath, SS blitzes off depth. */
export const COVER_1_MAN_BLITZ: CoverageStructure = {
  name: "Cover 1 Man Blitz",
  safeties: 1,
  assignments: {
    CB: man("XR"),
    NB: man("ZR"),
    LB: man("TE"),
    SS: BLITZ,
    FS: zone("deepMiddle", "deep"),
  },
};

export const COVER_1_MAN: CoverageStructure = {
  name: "Cover 1 Man",
  safeties: 1,
  assignments: {
    CB: man("XR"),
    NB: man("ZR"),
    LB: zone("hookMiddle"),
    SS: man("TE"),
    FS: zone("deepMiddle", "deep"),
  },
};

/** Single-high safety, 3-defender zone shell underneath, SS blitzes. */
export const COVER_1_ZONE_BLITZ: CoverageStructure = {
  name: "Cover 1 Zone Blitz",
  safeties: 1,
  assignments: {
    CB: zone("flatLeft"),
    NB: zone("flatRight"),
    LB: zone("hookMiddle"),
    SS: BLITZ,
    FS: zone("deepMiddle", "deep"),
  },
};

/** No deep help, man everywhere, both safeties come down as extra rushers. */
export const COVER_0_SAFETY_BLITZ: CoverageStructure = {
  name: "Cover 0 Safety Blitz",
  safeties: 0,
  assignments: {
    CB: man("XR", "outside"),
    NB: man("ZR", "inside"),
    LB: man("TE"),
    SS: BLITZ,
    FS: BLITZ,
  },
};

export const COVER_0_LB_BLITZ: CoverageStructure = {
  name: "Cover 0 LB Blitz",
  safeties: 0,
  assignments: {
    CB: man("XR", "outside"),
    NB: man("ZR", "inside"),
    LB: BLITZ,
    SS: man("TE"),
    FS: BLITZ,
  },
};

/** Quarters: 2 deep safeties split wide, aggressive outside leverage from the
 * underneath defenders since they have deep help on top. */
export const COVER_4_QUARTERS: CoverageStructure = {
  name: "Quarters",
  safeties: 2,
  assignments: {
    CB: man("XR", "outside"),
    NB: man("ZR", "outside"),
    LB: zone("hookMiddle"),
    SS: zone("deepLeft", "deep"),
    FS: zone("deepRight", "deep"),
  },
};

/** Simulated pressure: the linebacker blitzes instead of a safety, while both
 * safeties stay deep to protect over the top. */
export const LB_FIRE_ZONE: CoverageStructure = {
  name: "LB Fire Zone",
  safeties: 2,
  assignments: {
    CB: zone("hookLeft"),
    NB: zone("hookRight"),
    LB: BLITZ,
    SS: zone("deepLeft", "deep"),
    FS: zone("deepRight", "deep"),
  },
};

export const COVERAGE_PRESETS = {
  cover0Safety: COVER_0_SAFETY_BLITZ,
  cover0Lb: COVER_0_LB_BLITZ,
  cover1ManBlitz: COVER_1_MAN_BLITZ,
  cover1ZoneBlitz: COVER_1_ZONE_BLITZ,
  cover1Man: COVER_1_MAN,
  cover2Man: COVER_2_MAN,
  cover2Zone: COVER_2_ZONE,
  cover4Quarters: COVER_4_QUARTERS,
  lbFireZone: LB_FIRE_ZONE,
} as const;

const ALL_PRESETS: CoverageStructure[] = Object.values(COVERAGE_PRESETS);

/** Display name of every registered coverage structure, e.g. for seeding a
 * per-structure stat record. Stays in sync with COVERAGE_PRESETS — add a
 * preset there and its name shows up here automatically. */
export const COVERAGE_STRUCTURE_NAMES: string[] = ALL_PRESETS.map(
  (p) => p.name,
);

export type CoverageStructureInfo = {
  scheme: "Man" | "Zone";
  pressure: "Blitz" | "Coverage";
};

/** Man/Zone + Blitz/Coverage at-a-glance classification for every registered
 * coverage structure, keyed by name. Splits classifyStructure's single
 * 4-value bucket into its two independent axes, for UI columns that want to
 * sort/scan by scheme and pressure separately. */
export const COVERAGE_STRUCTURE_INFO: Record<string, CoverageStructureInfo> =
  Object.fromEntries(
    ALL_PRESETS.map((p) => {
      const bucket = classifyStructure(p);
      return [
        p.name,
        {
          scheme: bucket === "man" || bucket === "manBlitz" ? "Man" : "Zone",
          pressure:
            bucket === "manBlitz" || bucket === "zoneBlitz"
              ? "Blitz"
              : "Coverage",
        },
      ];
    }),
  );

/** Every preset currently classified into a given legacy bucket. New presets
 * added to COVERAGE_PRESETS above are picked up automatically — nothing here
 * needs to change to add variety to what a team calls. */
function presetsInBucket(bucket: DefensiveCoverageType): CoverageStructure[] {
  return ALL_PRESETS.filter((p) => classifyStructure(p) === bucket);
}

/**
 * Picks a coverage structure using the team-tendency knobs (man vs zone
 * underneath, blitz vs no blitz) to choose a bucket exactly as the original
 * four-structure system did, then samples uniformly among every preset that
 * currently falls in that bucket — so a team calling "man, no blitz" might
 * show Cover 2 Man one snap and Quarters the next, instead of only ever the
 * one hardcoded structure per bucket.
 */
export function pickCoverageStructure(
  manPercent: number,
  blitzPercent: number,
): CoverageStructure {
  const isMan = Math.random() < manPercent;
  const isBlitz = Math.random() < blitzPercent;
  const bucket: DefensiveCoverageType = isBlitz
    ? isMan
      ? "manBlitz"
      : "zoneBlitz"
    : isMan
      ? "man"
      : "zone";

  const candidates = presetsInBucket(bucket);
  return candidates[Math.floor(Math.random() * candidates.length)];
}

import { Player } from "./types";
import { lerp } from "./util";

const gradesArray = [
  "S",
  "A+",
  "A",
  "A-",
  "B+",
  "B",
  "B-",
  "C+",
  "C",
  "C-",
  "D+",
  "D",
  "D-",
  "F",
] as const;
type Grades = (typeof gradesArray)[number];
const GRADE_MAP: Record<Grades, number> = {
  S: 1.0,
  "A+": 0.95,
  A: 0.9,
  "A-": 0.85,
  "B+": 0.8,
  B: 0.75,
  "B-": 0.7,
  "C+": 0.65,
  C: 0.6,
  "C-": 0.55,
  "D+": 0.5,
  D: 0.45,
  "D-": 0.4,
  F: 0.3,
};

export const ATTRIBUTE_CONFIG = {
  // All Positions
  speed: (r: number) => ({
    maxSpeed: lerp(r, 2.82, 4.13),
    acceleration: lerp(r, 0.18, 0.32),
  }),
  size: (r: number) => ({ radius: lerp(r, 22, 30) }),

  // Passers
  pocketPresence: (r: number) => ({
    passerLookAhead: lerp(r, 180, 300),
    passerAvoidStrength: lerp(r, 1.0, 2.4),
    passerSteerFactor: lerp(r, 0.1, 0.3),
  }),
  pressureFeel: (r: number) => ({
    panicRusherDist: lerp(r, 120, 60),
    panicThrowChance: lerp(r, 0.7, 0.94),
    qbAccuracyPanicChange: lerp(r, -0.2, 0),
  }),
  decisionMaking: (r: number) => ({
    minThrowStep: lerp(r, 60, 20),
    earlyThrowChance: lerp(r, 0.6, 1),
    earlyThrowSeparation: lerp(r, 100, 50),
  }),
  shortAccuracy: (r: number) => ({
    shortAccuracy: lerp(r, 0.8, 1),
  }),
  deepAccuracy: (r: number) => ({
    deepAccuracy: lerp(r, 0.6, 1),
  }),

  // Runners
  vision: (r: number) => ({
    lookAhead: lerp(r, 120, 200),
    avoidStrength: lerp(r, 1, 3),
    steerAvoidStrength: lerp(r, 0.4, 1.6),
    steerDuration: lerp(r, 90, 30),
  }),
  power: (r: number) => ({
    carrierPower: lerp(r, 0.5, 1.5),
    tacklePressureThreshold: lerp(r, 1, 2),
  }),
  changeOfDirection: (r: number) => ({
    runnerSteerFactor: lerp(r, 0.5, 1.5),
  }),

  // Catchers
  routeRunning: (r: number) => ({
    stopAfterBreakThreshold: lerp(r, 20, 0),
    routeStemDrift: lerp(r, 0.12, 0),
    routeCutSpeedRetained: lerp(r, 0.3, 1.1),
    reaccelerationDuration: lerp(r, 50, 10),
  }),
  catchAcceleration: (r: number) => ({
    catchSlowdownDuration: lerp(r, 60, 30),
    minCatchSpeedMultiplier: lerp(r, 0.6, 1),
  }),
  catchRadius: (r: number) => ({
    completionRadius: lerp(r, 162, 130),
  }),

  // Blockers
  passBlock: (r: number) => ({
    rusherDampingFactor: lerp(r, 1.2, 0.7),
  }),
  runBlock: (r: number) => ({
    runBlockDampingFactor: lerp(r, 0.7, 0.2),
    covererDampingFactor: lerp(r, 0.8, 0.4),
  }),

  // Rushers
  blockShedding: (r: number) => ({
    randomJitter: lerp(r, 0, 0),
  }),
  bend: (r: number) => ({
    lateralStrength: lerp(r, 0.5, 1.5),
    lateralFreq: lerp(r, 0.01, 0.05),
  }),

  // Coverers
  manCoverage: (r: number) => ({
    manStartDelay: lerp(r, 20, 0),
    reactionDelay: lerp(r, 60, 34),
    manCushion: lerp(r, 0, 0),
  }),
  zoneCoverage: (r: number) => ({
    zonePull: lerp(r, 0.4, 1),
    zoneStartDelay: lerp(r, 30, 10),
  }),
  pursuit: (r: number) => ({
    predictionFrames: lerp(r, 50, 10),
    pursuerHomingFactor: lerp(r, 0, 0.2),
    pursuerContainOffset: lerp(r, 0, 20),
    pursuitLateralStrength: lerp(r, 0.4, 0),
    pursuitLateralFreq: lerp(r, 0.01, 0.05),
  }),

  // Defenders
  tackling: (r: number) => ({
    defenderTackle: lerp(r, 0.4, 0.6),
    tackleAttemptChance: lerp(r, 0.05, 0.2),
  }),
} as const;

type Attribute = keyof typeof ATTRIBUTE_CONFIG;
type Ratings = Record<Attribute, number>;
const createBaseRatings = (overrides: Partial<Ratings> = {}): Ratings => ({
  speed: 0.75,
  size: 0.3,
  pocketPresence: 0.5,
  pressureFeel: 0.5,
  decisionMaking: 0.5,
  shortAccuracy: 0.5,
  deepAccuracy: 0.5,
  vision: 0.5,
  power: 0.5,
  changeOfDirection: 0.5,
  routeRunning: 0.5,
  catchAcceleration: 0.5,
  catchRadius: 0.5,
  passBlock: 0.5,
  runBlock: 0.5,
  blockShedding: 0.5,
  bend: 0.5,
  manCoverage: 0.5,
  zoneCoverage: 0.5,
  pursuit: 0.5,
  tackling: 0.5,
  ...overrides,
});

// Setup realistic weights/sizes per position using the 0.0 - 1.0 scale
const DEFAULT_RATINGS_BY_LABEL: Record<string, Ratings> = {
  // Passers
  QB: createBaseRatings({ speed: 0.75, size: 0.3 }),

  // Runners/Catchers
  RB: createBaseRatings({ speed: 0.81, size: 0.23 }),
  XR: createBaseRatings({ speed: 0.91, size: 0.13 }),
  ZR: createBaseRatings({ speed: 0.89, size: 0.1 }),
  TE: createBaseRatings({ speed: 0.7, size: 0.47 }),

  // Blockers
  LT: createBaseRatings({ speed: 0.45, size: 0.93 }),
  C: createBaseRatings({ speed: 0.43, size: 0.87 }),
  RT: createBaseRatings({ speed: 0.45, size: 0.96 }),

  // Rushers
  LE: createBaseRatings({ speed: 0.56, size: 0.6 }),
  DT: createBaseRatings({ speed: 0.43, size: 0.83 }),
  RE: createBaseRatings({ speed: 0.56, size: 0.57 }),

  // Coverers/Defenders
  CB: createBaseRatings({ speed: 0.9, size: 0.08 }),
  NB: createBaseRatings({ speed: 0.87, size: 0.07 }),
  LB: createBaseRatings({ speed: 0.7, size: 0.4 }),
  SS: createBaseRatings({ speed: 0.77, size: 0.2 }),
  FS: createBaseRatings({ speed: 0.83, size: 0.1 }),
};
function getDefaultRatingForLabel(label: string): Ratings {
  return DEFAULT_RATINGS_BY_LABEL[label] ?? createBaseRatings();
}

function getConstants<K extends Attribute>(
  attribute: K,
  player: Player,
): ReturnType<(typeof ATTRIBUTE_CONFIG)[K]> {
  const rating = player.ratings[attribute];
  const transformer = ATTRIBUTE_CONFIG[attribute] as (r: number) => any;
  return transformer(rating);
}

export {
  createBaseRatings,
  DEFAULT_RATINGS_BY_LABEL,
  getConstants,
  getDefaultRatingForLabel,
};
export type { Attribute, Ratings };

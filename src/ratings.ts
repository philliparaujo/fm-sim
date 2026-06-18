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
  /* All Positions */
  SPEED: (r: number) => ({
    maxSpeed: lerp(r, 2.82, 4.13),
    acceleration: lerp(r, 0.18, 0.32),
  }),
  SIZE: (r: number) => ({ radius: lerp(r, 22, 30) }),

  /* Passers */
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
    minThrowStep: lerp(r, 80, 40),
    earlyThrowChance: lerp(r, 0.6, 1),
    earlyThrowSeparation: lerp(r, 100, 50),
  }),
  shortAccuracy: (r: number) => ({
    shortAccuracy: lerp(r, 0.8, 1),
  }),
  deepAccuracy: (r: number) => ({
    deepAccuracy: lerp(r, 0.6, 1),
  }),
  throwPower: (r: number) => ({
    ballMetersPerSecond: lerp(r, 18, 30),
    // ballMetersPerSecond: lerp(r, 28, 40),
  }),

  /* Runners */
  // Best = ~0.50
  VISION: (r: number) => ({
    lookAhead: lerp(r, 100, 220),
    avoidStrength: lerp(r, 1, 3),
    steerAvoidStrength: lerp(r, 0.2, 1.6),
    steerDuration: lerp(r, 110, 50),
  }),
  POWER: (r: number) => ({
    carrierPower: lerp(r, 0.2, 1.2),
    tacklePressureThreshold: lerp(r, 0.05, 0.7),
  }),

  /* Catchers */
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
    completionRadius: lerp(r, 30, 80),
  }),

  /* Blockers */
  PASSBLOCK: (r: number) => ({
    rusherDampingFactor: lerp(r, 0.99, 0.89),
    antiBlockShed: lerp(r, 2.2, 2.6),
  }),
  RUNBLOCK: (r: number) => ({
    runBlockDampingFactor: lerp(r, 0.8, 0.4),
    covererDampingFactor: lerp(r, 0.7, 0.3),
    runBlockPushStrength: lerp(r, 0.6, 2.5),
    antiBlockShed: lerp(r, 0.9, 1.7),
  }),

  /* Rushers */
  BLOCKSHEDDING: (r: number) => ({
    blockShed: lerp(r, 0, 2),
    randomJitter: lerp(r, -0.5, 0.6),
  }),
  BEND: (r: number) => ({
    lateralStrength: lerp(r, 0.2, 1.4),
    lateralFreq: lerp(r, 0.01, 0.05),
  }),

  /* Coverers */
  manCoverage: (r: number) => ({
    manStartDelay: lerp(r, 20, 0),
    reactionDelay: lerp(r, 60, 34),
    manCushion: lerp(r, 0, 0),
  }),
  zoneCoverage: (r: number) => ({
    zonePull: lerp(r, 0.4, 1),
    zoneStartDelay: lerp(r, 30, 10),
  }),
  // Best = ~0.5
  PURSUIT: (r: number) => ({
    predictionFrames: lerp(r, 50, 10),
    pursuerHomingFactor: lerp(r, 0.01, 0.2),
    pursuerContainOffset: lerp(r, -5, 20),
    pursuitLateralStrength: lerp(r, 0.4, 0),
    pursuitLateralFreq: lerp(r, 0.01, 0.05),
  }),

  /* Defenders */
  TACKLING: (r: number) => ({
    defenderTackle: lerp(r, 0.7, 0.9),
    tackleAttemptChance: lerp(r, 0.1, 0.3),
  }),
} as const;

type Attribute = keyof typeof ATTRIBUTE_CONFIG;
type Ratings = Record<Attribute, number>;
const createBaseRatings = (overrides: Partial<Ratings> = {}): Ratings => ({
  SPEED: 0.75,
  SIZE: 0.3,
  pocketPresence: 0.5,
  pressureFeel: 0.5,
  decisionMaking: 0.5,
  shortAccuracy: 0.5,
  deepAccuracy: 0.5,
  throwPower: 0.5,
  VISION: 0.2,
  POWER: 0.1,
  routeRunning: 0.5,
  catchAcceleration: 0.5,
  catchRadius: 0.4,
  PASSBLOCK: 0.25,
  RUNBLOCK: 0.25,
  BLOCKSHEDDING: 0.3,
  BEND: 0.3,
  manCoverage: 0.5,
  zoneCoverage: 0.5,
  PURSUIT: 0.3,
  TACKLING: 0.5,
  ...overrides,
});

// Setup realistic weights/sizes per position using the 0.0 - 1.0 scale
const DEFAULT_RATINGS_BY_LABEL: Record<string, Ratings> = {
  // Passers
  QB: createBaseRatings({ SPEED: 0.75, SIZE: 0.3 }),

  // Runners/Catchers
  RB: createBaseRatings({
    SPEED: 0.81,
    SIZE: 0.23,
    VISION: 0.6,
    POWER: 0.5,
    catchRadius: 0.65,
  }),
  XR: createBaseRatings({ SPEED: 0.91, SIZE: 0.13, catchRadius: 0.87 }),
  ZR: createBaseRatings({ SPEED: 0.89, SIZE: 0.1, catchRadius: 0.77 }),
  TE: createBaseRatings({ SPEED: 0.7, SIZE: 0.47, catchRadius: 0.7 }),

  // Blockers
  LT: createBaseRatings({
    SPEED: 0.45,
    SIZE: 0.93,
    RUNBLOCK: 0.45,
    PASSBLOCK: 0.5,
  }),
  C: createBaseRatings({
    SPEED: 0.43,
    SIZE: 0.87,
    RUNBLOCK: 0.55,
    PASSBLOCK: 0.4,
  }),
  RT: createBaseRatings({
    SPEED: 0.45,
    SIZE: 0.96,
    RUNBLOCK: 0.5,
    PASSBLOCK: 0.45,
  }),

  // Rushers
  LE: createBaseRatings({ SPEED: 0.56, SIZE: 0.6, BEND: 0.55 }),
  DT: createBaseRatings({ SPEED: 0.43, SIZE: 0.83, BLOCKSHEDDING: 0.55 }),
  RE: createBaseRatings({ SPEED: 0.56, SIZE: 0.57, BEND: 0.55 }),

  // Coverers/Defenders
  CB: createBaseRatings({
    SPEED: 0.9,
    SIZE: 0.08,
    TACKLING: 0.3,
    catchRadius: 0.6,
  }),
  NB: createBaseRatings({
    SPEED: 0.87,
    SIZE: 0.07,
    TACKLING: 0.35,
    catchRadius: 0.6,
  }),
  LB: createBaseRatings({
    SPEED: 0.7,
    SIZE: 0.4,
    TACKLING: 0.7,
    catchRadius: 0.4,
  }),
  SS: createBaseRatings({
    SPEED: 0.77,
    SIZE: 0.2,
    PURSUIT: 0.7,
    BLOCKSHEDDING: 0.4,
    catchRadius: 0.65,
  }),
  FS: createBaseRatings({
    SPEED: 0.83,
    SIZE: 0.1,
    PURSUIT: 0.6,
    catchRadius: 0.7,
  }),
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

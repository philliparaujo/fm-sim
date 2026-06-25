import { Player } from "./types";
import { lerp } from "./util";

type GradeThreshold = {
  peak: number; // Optimal rating value
  spread: number; // Rating points away from peak before reaching F
};

const ATTR_GRADE_THRESHOLDS: Record<Attribute, GradeThreshold> = {
  // Linear: higher is always better
  SPEED: { peak: 100, spread: 60 },
  SIZE: { peak: 100, spread: 100 },
  throwPower: { peak: 100, spread: 100 },
  pocketPresence: { peak: 100, spread: 100 },
  pressureFeel: { peak: 100, spread: 100 },
  decisionMaking: { peak: 100, spread: 100 },
  shortAccuracy: { peak: 100, spread: 100 },
  deepAccuracy: { peak: 100, spread: 100 },
  ROUTERUNNING: { peak: 100, spread: 100 },
  CATCHACCELERATION: { peak: 100, spread: 100 },
  CATCHRADIUS: { peak: 100, spread: 85 },
  PASSBLOCK: { peak: 100, spread: 100 },
  RUNBLOCK: { peak: 100, spread: 100 },
  BLOCKSHEDDING: { peak: 100, spread: 100 },
  BEND: { peak: 100, spread: 100 },
  manCoverage: { peak: 100, spread: 100 },
  zoneCoverage: { peak: 100, spread: 100 },
  TACKLING: { peak: 100, spread: 100 },
  POWER: { peak: 100, spread: 100 },

  // Bell-curve: sweet spot is NOT at 100
  VISION: { peak: 60, spread: 60 },
  PURSUIT: { peak: 60, spread: 60 },
};

const GRADE_BREAKPOINTS = [
  { grade: "S", minProximity: 95 },
  { grade: "A+", minProximity: 88 },
  { grade: "A", minProximity: 80 },
  { grade: "A-", minProximity: 73 },
  { grade: "B+", minProximity: 65 },
  { grade: "B", minProximity: 55 },
  { grade: "B-", minProximity: 45 },
  { grade: "C+", minProximity: 35 },
  { grade: "C", minProximity: 25 },
  { grade: "C-", minProximity: 18 },
  { grade: "D+", minProximity: 12 },
  { grade: "D", minProximity: 6 },
  { grade: "D-", minProximity: 2 },
  { grade: "F", minProximity: 0 },
];

const GRADE_COLORS: Record<string, string> = {
  S: "#FF40FF", // purple
  "A+": "#4ade80", // bright green
  A: "#4ade80",
  "A-": "#86efac",
  "B+": "#a3e635",
  B: "#d9f99d",
  "B-": "#fde68a",
  "C+": "#fbbf24",
  C: "#f97316",
  "C-": "#fb923c",
  "D+": "#f87171",
  D: "#ef4444",
  "D-": "#dc2626",
  F: "#7f1d1d",
};

function getLetterGrade(
  attr: Attribute,
  ratingPercent: number,
): { grade: string; color: string } {
  const threshold = ATTR_GRADE_THRESHOLDS[attr] ?? { peak: 100, spread: 100 };
  const distFromPeak = Math.abs(ratingPercent - threshold.peak);
  const proximity = Math.max(0, 100 - (distFromPeak / threshold.spread) * 100);

  const match = GRADE_BREAKPOINTS.find((b) => proximity >= b.minProximity);
  const grade = match?.grade ?? "F";
  return { grade, color: GRADE_COLORS[grade] ?? "#888" };
}

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
    panicThrowChance: lerp(r, 0.05, 0.45),
    pressureSensitivity: lerp(r, 1.7, 0.4),
  }),
  decisionMaking: (r: number) => ({
    minThrowStep: lerp(r, 70, 30),
    earlyThrowChance: lerp(r, 0.6, 1),
    earlyThrowSeparation: lerp(r, 100, 50),
  }),
  shortAccuracy: (r: number) => ({
    shortError: lerp(r, 0.6, 0.2),
  }),
  deepAccuracy: (r: number) => ({
    deepError: lerp(r, 0.85, 0.2),
  }),
  throwPower: (r: number) => ({
    ballMetersPerSecond: lerp(r, 18, 30),
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
  ROUTERUNNING: (r: number) => ({
    stopAfterBreakThreshold: lerp(r, 20, 0),
    routeStemDrift: lerp(r, 0.12, 0),
    routeCutSpeedRetained: lerp(r, 0.1, 1.1),
    reaccelerationDuration: lerp(r, 100, 10),
  }),
  CATCHACCELERATION: (r: number) => ({
    catchSlowdownDuration: lerp(r, 60, 30),
    minCatchSpeedMultiplier: lerp(r, 0.6, 1),
  }),
  CATCHRADIUS: (r: number) => ({
    completionRadius: lerp(r, 30, 80),
  }),

  /* Blockers */
  PASSBLOCK: (r: number) => ({
    rusherDampingFactor: lerp(r, 0.99, 0.89),
    antiBlockShed: lerp(r, 2.2, 2.6),
  }),
  RUNBLOCK: (r: number) => ({
    runBlockDampingFactor: lerp(r, 0.85, 0.45),
    covererDampingFactor: lerp(r, 0.75, 0.35),
    runBlockPushStrength: lerp(r, 0.5, 2.2),
    antiBlockShed: lerp(r, 0.5, 1.7),
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
    reactionDelay: lerp(r, 49, 13),
    manCushion: lerp(r, 0, 0),
  }),
  zoneCoverage: (r: number) => ({
    zonePull: lerp(r, 0, 0.5),
    zoneStartDelay: lerp(r, 35, 15),
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
  ROUTERUNNING: 0.5,
  CATCHACCELERATION: 0.5,
  CATCHRADIUS: 0.4,
  PASSBLOCK: 0.25,
  RUNBLOCK: 0.25,
  BLOCKSHEDDING: 0.3,
  BEND: 0.3,
  manCoverage: 0.5,
  zoneCoverage: 0.5,
  PURSUIT: 0.3,
  TACKLING: 0.6,
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
    CATCHRADIUS: 0.45,
    PASSBLOCK: 0.1,
  }),
  XR: createBaseRatings({ SPEED: 0.91, SIZE: 0.13, CATCHRADIUS: 0.75 }),
  ZR: createBaseRatings({ SPEED: 0.89, SIZE: 0.1, CATCHRADIUS: 0.55 }),
  TE: createBaseRatings({ SPEED: 0.7, SIZE: 0.47, CATCHRADIUS: 0.66 }),

  // Blockers
  LT: createBaseRatings({
    SPEED: 0.45,
    SIZE: 0.93,
    RUNBLOCK: 0.42,
    PASSBLOCK: 0.5,
  }),
  C: createBaseRatings({
    SPEED: 0.43,
    SIZE: 0.87,
    RUNBLOCK: 0.52,
    PASSBLOCK: 0.4,
  }),
  RT: createBaseRatings({
    SPEED: 0.45,
    SIZE: 0.96,
    RUNBLOCK: 0.47,
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
    TACKLING: 0.4,
    CATCHRADIUS: 0.6,
    manCoverage: 0.7,
    zoneCoverage: 0.6,
  }),
  NB: createBaseRatings({
    SPEED: 0.87,
    SIZE: 0.07,
    TACKLING: 0.45,
    CATCHRADIUS: 0.6,
    manCoverage: 0.65,
    zoneCoverage: 0.6,
  }),
  LB: createBaseRatings({
    SPEED: 0.7,
    SIZE: 0.4,
    TACKLING: 0.75,
    CATCHRADIUS: 0.4,
    manCoverage: 0.5,
    zoneCoverage: 0.6,
  }),
  SS: createBaseRatings({
    SPEED: 0.77,
    SIZE: 0.2,
    TACKLING: 0.6,
    PURSUIT: 0.7,
    BLOCKSHEDDING: 0.45,
    BEND: 0.4,
    CATCHRADIUS: 0.65,
    manCoverage: 0.5,
    zoneCoverage: 0.5,
  }),
  FS: createBaseRatings({
    SPEED: 0.83,
    SIZE: 0.1,
    TACKLING: 0.6,
    PURSUIT: 0.6,
    CATCHRADIUS: 0.7,
    manCoverage: 0.6,
    zoneCoverage: 0.75,
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
  getLetterGrade,
};
export type { Attribute, Ratings };

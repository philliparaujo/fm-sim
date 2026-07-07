import { lerp } from "../utils/math";
import { Player } from "./types";

type GradeThreshold = {
  peak: number; // Optimal rating value
  spread: number; // Rating points away from peak before reaching F
};

const ATTR_GRADE_THRESHOLDS: Record<Attribute, GradeThreshold> = {
  // Linear: higher is always better
  SPEED: { peak: 100, spread: 60 },
  SIZE: { peak: 100, spread: 100 },
  THROWPOWER: { peak: 100, spread: 100 },
  POCKETPRESENCE: { peak: 100, spread: 100 },
  DECISIONMAKING: { peak: 100, spread: 100 },
  SHORTACCURACY: { peak: 100, spread: 100 },
  DEEPACCURACY: { peak: 100, spread: 100 },
  ROUTERUNNING: { peak: 100, spread: 100 },
  CATCHACCELERATION: { peak: 100, spread: 100 },
  CATCHRADIUS: { peak: 100, spread: 85 },
  PASSBLOCK: { peak: 100, spread: 100 },
  RUNBLOCK: { peak: 100, spread: 100 },
  BLOCKSHEDDING: { peak: 100, spread: 100 },
  BEND: { peak: 100, spread: 100 },
  MANCOVERAGE: { peak: 100, spread: 100 },
  ZONECOVERAGE: { peak: 100, spread: 100 },
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

/** Returns a 0–1 proximity score: 1 = at the attribute's peak, 0 = furthest possible from it. */
function getProximity(attr: Attribute, rating: number): number {
  const threshold = ATTR_GRADE_THRESHOLDS[attr] ?? { peak: 100, spread: 100 };
  const distFromPeak = Math.abs(rating * 100 - threshold.peak);
  return Math.max(0, 1 - distFromPeak / threshold.spread);
}

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

const ATTRIBUTE_CONFIG = {
  /* All Positions */
  SPEED: (r: number) => ({
    maxSpeed: lerp(r, 2.82, 4.13),
    acceleration: lerp(r, 0.18, 0.32),
  }),
  SIZE: (r: number) => ({ radius: lerp(r, 22, 30) }),

  /* Passers */
  POCKETPRESENCE: (r: number) => ({
    passerLookAhead: lerp(r, 180, 300),
    passerAvoidStrength: lerp(r, 1.0, 2.4),
    passerSteerFactor: lerp(r, 0.1, 0.3),
    pressureSensitivity: lerp(r, 1, 1),
  }),
  DECISIONMAKING: (r: number) => ({
    minThrowStep: lerp(r, 90, 40),
    minOpennessNeeded: lerp(r, 190, 230),
    panicOpennessNeeded: lerp(r, 105, 90),
  }),
  SHORTACCURACY: (r: number) => ({
    shortError: lerp(r, 0.6, 0),
  }),
  DEEPACCURACY: (r: number) => ({
    deepError: lerp(r, 0.85, 0),
  }),
  THROWPOWER: (r: number) => ({
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
    carrierPower: lerp(r, 0.2, 1),
    tacklePressureThreshold: lerp(r, 0.05, 0.6),
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
    catchInTraffic: lerp(r, 0.35, 0.75),
  }),

  /* Blockers */
  PASSBLOCK: (r: number) => ({
    rusherDampingFactor: lerp(r, 1, 0.88),
    antiBlockShed: lerp(r, 2, 2.5),
  }),
  RUNBLOCK: (r: number) => ({
    runBlockDampingFactor: lerp(r, 0.9, 0.55),
    covererDampingFactor: lerp(r, 0.75, 0.35),
    runBlockPushStrength: lerp(r, 0.5, 1.9),
    antiBlockShed: lerp(r, 0.3, 1.5),
  }),

  /* Rushers */
  BLOCKSHEDDING: (r: number) => ({
    blockShed: lerp(r, 0, 2),
    randomJitter: lerp(r, 0, 0.6),
  }),
  BEND: (r: number) => ({
    lateralStrength: lerp(r, 0.5, 1.1),
    lateralFreq: lerp(r, 0.05, 0.1),
  }),

  /* Coverers */
  MANCOVERAGE: (r: number) => ({
    manStartDelay: lerp(r, 20, 0),
    reactionDelay: lerp(r, 37, 10),
    manCushion: lerp(r, 0, 0),
  }),
  ZONECOVERAGE: (r: number) => ({
    zonePull: lerp(r, 0, 0.4),
    zoneReactionDelay: lerp(r, 25, 5),
    zoneStartDelay: lerp(r, 45, 25),
  }),
  // Best = ~0.5
  PURSUIT: (r: number) => ({
    predictionTicks: lerp(r, 50, 10),
    pursuerHomingFactor: lerp(r, 0.01, 0.2),
    pursuerContainOffset: lerp(r, -5, 20),
    pursuitLateralStrength: lerp(r, 0.4, 0),
    pursuitLateralFreq: lerp(r, 0.01, 0.05),
  }),

  /* Defenders */
  TACKLING: (r: number) => ({
    defenderTackle: lerp(r, 0.7, 0.95),
    tackleAttemptChance: lerp(r, 0.1, 0.4),
  }),
} as const;

type Attribute = keyof typeof ATTRIBUTE_CONFIG;
type Ratings = Record<Attribute, number>;
const createBaseRatings = (overrides: Partial<Ratings> = {}): Ratings => ({
  SPEED: 0.75,
  SIZE: 0.3,
  POCKETPRESENCE: 0.1,
  DECISIONMAKING: 0.1,
  SHORTACCURACY: 0.1,
  DEEPACCURACY: 0.1,
  THROWPOWER: 0.1,
  VISION: 0.2,
  POWER: 0.1,
  ROUTERUNNING: 0.5,
  CATCHACCELERATION: 0.5,
  CATCHRADIUS: 0.4,
  PASSBLOCK: 0.25,
  RUNBLOCK: 0.25,
  BLOCKSHEDDING: 0.15,
  BEND: 0.3,
  MANCOVERAGE: 0.48,
  ZONECOVERAGE: 0.48,
  PURSUIT: 0.3,
  TACKLING: 0.65,
  ...overrides,
});

// Setup realistic weights/sizes per position using the 0.0 - 1.0 scale
const DEFAULT_RATINGS_BY_LABEL: Record<string, Ratings> = {
  // Passers
  QB: createBaseRatings({
    SPEED: 0.75,
    SIZE: 0.3,
    POCKETPRESENCE: 0.5,
    DECISIONMAKING: 0.5,
    THROWPOWER: 0.5,
    SHORTACCURACY: 0.5,
    DEEPACCURACY: 0.5,
  }),

  // Runners/Catchers
  RB: createBaseRatings({
    SPEED: 0.81,
    SIZE: 0.23,
    VISION: 0.5,
    POWER: 0.52,
    ROUTERUNNING: 0.3,
    CATCHACCELERATION: 0.75,
    CATCHRADIUS: 0.45,
    PASSBLOCK: 0.1,
  }),
  XR: createBaseRatings({
    SPEED: 0.91,
    SIZE: 0.13,
    ROUTERUNNING: 0.5,
    CATCHACCELERATION: 0.45,
    CATCHRADIUS: 0.75,
  }),
  ZR: createBaseRatings({
    SPEED: 0.89,
    SIZE: 0.1,
    ROUTERUNNING: 0.65,
    CATCHACCELERATION: 0.65,
    CATCHRADIUS: 0.55,
  }),
  TE: createBaseRatings({
    SPEED: 0.7,
    SIZE: 0.47,
    CATCHACCELERATION: 0.5,
    ROUTERUNNING: 0.4,
    CATCHRADIUS: 0.66,
    RUNBLOCK: 0.3,
  }),

  // Blockers
  LT: createBaseRatings({
    SPEED: 0.45,
    SIZE: 0.93,
    RUNBLOCK: 0.43,
    PASSBLOCK: 0.5,
  }),
  C: createBaseRatings({
    SPEED: 0.43,
    SIZE: 0.87,
    RUNBLOCK: 0.48,
    PASSBLOCK: 0.4,
  }),
  RT: createBaseRatings({
    SPEED: 0.45,
    SIZE: 0.96,
    RUNBLOCK: 0.48,
    PASSBLOCK: 0.45,
  }),

  // Rushers
  LE: createBaseRatings({
    SPEED: 0.56,
    SIZE: 0.6,
    BEND: 0.55,
    BLOCKSHEDDING: 0.3,
  }),
  DT: createBaseRatings({ SPEED: 0.43, SIZE: 0.83, BLOCKSHEDDING: 0.55 }),
  RE: createBaseRatings({
    SPEED: 0.56,
    SIZE: 0.57,
    BEND: 0.55,
    BLOCKSHEDDING: 0.3,
  }),

  // Coverers/Defenders
  CB: createBaseRatings({
    SPEED: 0.9,
    SIZE: 0.08,
    TACKLING: 0.45,
    CATCHRADIUS: 0.6,
    MANCOVERAGE: 0.55,
    ZONECOVERAGE: 0.45,
  }),
  NB: createBaseRatings({
    SPEED: 0.87,
    SIZE: 0.07,
    TACKLING: 0.5,
    CATCHRADIUS: 0.6,
    MANCOVERAGE: 0.5,
    ZONECOVERAGE: 0.45,
  }),
  LB: createBaseRatings({
    SPEED: 0.7,
    SIZE: 0.4,
    TACKLING: 0.8,
    CATCHRADIUS: 0.4,
    MANCOVERAGE: 0.35,
    ZONECOVERAGE: 0.45,
    BLOCKSHEDDING: 0.3,
  }),
  SS: createBaseRatings({
    SPEED: 0.77,
    SIZE: 0.2,
    TACKLING: 0.65,
    PURSUIT: 0.7,
    BLOCKSHEDDING: 0.45,
    BEND: 0.4,
    CATCHRADIUS: 0.65,
    MANCOVERAGE: 0.35,
    ZONECOVERAGE: 0.35,
  }),
  FS: createBaseRatings({
    SPEED: 0.83,
    SIZE: 0.1,
    TACKLING: 0.65,
    PURSUIT: 0.6,
    CATCHRADIUS: 0.7,
    MANCOVERAGE: 0.45,
    ZONECOVERAGE: 0.5,
  }),
};
function getDefaultRatingForLabel(label: string): Ratings {
  return DEFAULT_RATINGS_BY_LABEL[label] ?? createBaseRatings();
}

function getConstants<K extends Attribute>(
  attribute: K,
  player: Player,
): ReturnType<(typeof ATTRIBUTE_CONFIG)[K]> {
  const rating = player.ratings[attribute] ?? 0.5;
  const transformer = ATTRIBUTE_CONFIG[attribute] as (r: number) => any;
  return transformer(rating);
}

export { getConstants, getDefaultRatingForLabel, getLetterGrade, getProximity };
export type { Attribute, Ratings };

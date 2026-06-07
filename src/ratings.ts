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
  speed: (r: number) => ({ maxSpeed: lerp(r, 2, 6) }),
  size: (r: number) => ({ radius: lerp(r, 18, 30) }),

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
    minThrowStep: lerp(r, 100, 50),
    earlyThrowChance: lerp(r, 0.6, 1),
    earlyThrowSeparation: lerp(r, 145, 85),
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
    completionRadius: lerp(r, 112, 80),
  }),

  // Blockers
  passBlock: (r: number) => ({
    rusherDampingFactor: lerp(r, 0.94, 0.6),
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
const defaultRatings = Object.fromEntries(
  Object.keys(ATTRIBUTE_CONFIG).map((attr) => [attr, 0.5]),
) as Ratings;

function getConstants<K extends Attribute>(
  attribute: K,
  player: Player,
): ReturnType<(typeof ATTRIBUTE_CONFIG)[K]> {
  const rating = player.ratings[attribute];
  const transformer = ATTRIBUTE_CONFIG[attribute] as (r: number) => any;
  return transformer(rating);
}

export { defaultRatings, getConstants };
export type { Attribute, Ratings };

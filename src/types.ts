import { Ratings } from "./ratings";

type Vector = {
  x: number;
  y: number;
};

interface Entity {
  type: "ball" | "player";
  loc: Vector;
  vel: Vector;
}

interface Ball extends Entity {
  type: "ball";
  strokeWidth: number;
  laceWidth: number;
  radius: number;
}

type Position = "offense" | "defense";
type Role = "blocker" | "runner" | "catcher" | "passer" | "rusher" | "coverer";

interface PartialPlayer extends Entity {
  type: "player";
  color: string;
  label: string;
  position: Position;
  role: Role;

  runAngle?: Vector; // For runners
  route?: Route; // For receivers
  coverage?: Coverage; // For coverers
}

interface Player extends PartialPlayer {
  ratings: Ratings;
  prevVel: Vector;

  // For passers
  decisionTicks: number;

  // For receivers
  path: Vector[];
  breakFrame: number | null;
  routeSideMultiplier: 1 | -1 | null;
  improvAngleRad: number | null;

  // For rushers
  playRushSeed?: number;
  rushSpeedVariance?: number;

  // Coverer state
  assignedTarget: Player | null;
  perceivedLoc: Vector | null;
  perceivedVel: Vector | null;
  reactionTimer: number;
  zone: Vector;

  // Tackle state
  tacklePressure?: number;
  tackleCooldownTicks?: number;
  burstFrames?: number;
  isBursting: boolean;
  contactedThisFrame: boolean;
}

type Route = {
  breakAngle: number;
  steps: number;
  stopAfterBreak: boolean;
};
type Coverage = "man" | "zone";

type OffensivePlayType = "run" | "pass";
type DefensiveCoverageType = "man" | "manBlitz" | "zone" | "zoneBlitz";
type PlayEndReason =
  | "tackle"
  | "touchdown"
  | "sack"
  | "incomplete"
  | "interception";

type CountYards = {
  count: number;
  yards: number;
  avg: number;
};

type PlaycallStats = {
  run: CountYards;
  pass: CountYards;
};

type PlaycallCoverageKey =
  | "runMan"
  | "runManBlitz"
  | "runZone"
  | "runZoneBlitz"
  | "passMan"
  | "passManBlitz"
  | "passZone"
  | "passZoneBlitz";

type PlaycallCoverageYards = Record<PlaycallCoverageKey, CountYards>;
type PlayCallCoverageStats = Record<PlaycallCoverageKey, QBStats | RBStats>;

type CoverageStats = {
  man: CountYards;
  manBlitz: CountYards;
  zone: CountYards;
  zoneBlitz: CountYards;
};

type QBStats = {
  attempts: number;
  completions: number;
  yards: number;
  ypa: number;
  cmp: number;
  tds: number;
  ints: number;
  sacks: number;
};

type RBStats = {
  rushes: number;
  yards: number;
  ypc: number;
  tds: number;
  tfls: number;
};

type PlayAdvancedData = {
  throwFrame?: number; // state.steps when throw occurred
  sackFrame?: number; // state.steps when sack occurred
  airYards?: number; // pixels from LOS to catcher at throw time
  wasOffTarget?: boolean; // throw was uncatchable
  wasUnderPressure: boolean; // at least one frame under pressure this play
  separationAtCatch?: number; // nearest defender dist in pixels at catch
  catchX?: number; // ball.loc.x when catcher caught the ball
  firstContactX?: number; // ball.loc.x on first tackle pressure frame
};

// Averaged advanced stats
type AdvancedStats = {
  intendedAirYards: number;
  completedAirYards: number;
  timeToThrow: number;
  timeToSack: number;
  offTargetThrowRate: number;
  pressureRate: number;
  rushYardsBeforeContact: number;
  rushYardsAfterContact: number;
  receiverSeparation: number;
  receiverYardsAfterCatch: number;
  sackRate: number;
};

type Stats = {
  playcalls: PlaycallStats;
  coverage: CoverageStats;
  playcallCoverage: PlaycallCoverageYards;
  playcallCoverageStats: PlayCallCoverageStats;
  qb: QBStats;
  rb: RBStats;
  runAngles: Record<string, CountYards>;
  routes: Record<string, CountYards>;
  advanced: AdvancedStats;
};

type CurrentPlay = {
  offense: OffensivePlayType;
  defense: DefensiveCoverageType;
  runAngle?: Vector;
  routes: Route[];
};

const streakRoute: Route = { breakAngle: 0, steps: 0, stopAfterBreak: false };
const postRoute: Route = { breakAngle: 45, steps: 10, stopAfterBreak: false };
const cornerRoute: Route = {
  breakAngle: -55,
  steps: 10,
  stopAfterBreak: false,
};
const inRoute: Route = { breakAngle: 90, steps: 8, stopAfterBreak: false };
const outRoute: Route = { breakAngle: -90, steps: 8, stopAfterBreak: false };
const curlRoute: Route = { breakAngle: 180, steps: 8, stopAfterBreak: true };
const slantRoute: Route = { breakAngle: 65, steps: 3, stopAfterBreak: false };
const dragRoute: Route = { breakAngle: 90, steps: 2, stopAfterBreak: false };
const flatRoute: Route = { breakAngle: -90, steps: 0, stopAfterBreak: false };

type ScoreboardTeam = {
  name: string;
  color: string;
  score: number;
  timeouts: 0 | 1 | 2 | 3;
  possessing: boolean;
};

type Scoreboard = {
  LOS: number;
  firstDownLine: number | null;
  time: number;
  quarter: "1st" | "2nd" | "3rd" | "4th";
  down: "1st" | "2nd" | "3rd" | "4th";
  distance: "goal" | number;
  teams: ScoreboardTeam[];
};

type ReplayFrame = {
  ballLoc: Vector;
  ballVel: Vector;
  players: Array<PartialPlayer>;
  scoreboard: Scoreboard;
};

type BallFlightState = {
  isInFlight: boolean;
  startLoc: Vector;
  endLoc: Vector;
  receiver: Player;
  totalFrames: number;
  framesElapsed: number;
};

type State = {
  ball: Ball;
  players: Player[];
  scoreboard: Scoreboard;
  currentPlay: CurrentPlay;

  stats: Stats;
  playAdvanced: PlayAdvancedData;

  pausedUntil: number;

  steps: number;
  ballGiven: boolean;
  ballGivenAtStep: number;
  ballFlight: BallFlightState | null;
  blockingAssignments: Map<Player, Player>;
};

export {
  cornerRoute,
  curlRoute,
  dragRoute,
  flatRoute,
  inRoute,
  outRoute,
  postRoute,
  slantRoute,
  streakRoute,
};
export type {
  AdvancedStats,
  Ball,
  BallFlightState,
  Coverage,
  CurrentPlay,
  DefensiveCoverageType,
  Entity,
  OffensivePlayType,
  PartialPlayer,
  PlayAdvancedData,
  PlaycallCoverageKey,
  PlayCallCoverageStats,
  PlaycallCoverageYards,
  PlayEndReason,
  Player,
  QBStats,
  RBStats,
  ReplayFrame,
  Role,
  Route,
  Scoreboard,
  State,
  Stats,
  Vector,
};

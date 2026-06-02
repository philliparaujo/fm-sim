import { Ratings } from "./ratings";

type Vector = {
  x: number;
  y: number;
};

interface Entity {
  type: "ball" | "player";
  loc: Vector;
  vel: Vector;
  radius: number;
}

interface Ball extends Entity {
  type: "ball";
  strokeWidth: number;
  laceWidth: number;
}

type Position = "offense" | "defense";
type Role = "blocker" | "runner" | "catcher" | "passer" | "rusher" | "coverer";

interface PartialPlayer extends Entity {
  type: "player";
  color: string;
  maxSpeed: number;
  position: Position;
  role: Role;

  runAngle?: Vector; // For runners
  route?: Route; // For receivers
  coverage?: Coverage; // For coverers
}

interface Player extends PartialPlayer {
  ratings: Ratings;

  // For receivers
  path: Vector[];
  breakFrame: number | null;

  // Coverer state
  assignedTarget: Player | null;
  perceivedLoc: Vector | null;
  perceivedVel: Vector | null;
  reactionTimer: number;
  zone: Vector;

  // Tackle state
  tacklePressure?: number;
  burstFrames?: number;
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
  | "turnover";

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

type PlaycallCoverageStats = Record<PlaycallCoverageKey, CountYards>;

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
  tds: number;
  sacks: number;
};

type RBStats = {
  rushes: number;
  yards: number;
  ypc: number;
  tds: number;
  tfls: number;
};

type Stats = {
  playcalls: PlaycallStats;
  coverage: CoverageStats;
  playcallCoverage: PlaycallCoverageStats;
  qb: QBStats;
  rb: RBStats;
  runAngles: Record<string, CountYards>;
  routes: Record<string, CountYards>;
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

type State = {
  ball: Ball;
  players: Player[];
  scoreboard: Scoreboard;
  stats: Stats;
  currentPlay: CurrentPlay;

  pausedUntil: number;

  steps: number;
  ballGiven: boolean;
  ballGivenAtStep: number;
  earlyThrowDecided: boolean;
  panicThrowDecided: boolean;
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
  Ball,
  Coverage,
  CurrentPlay,
  DefensiveCoverageType,
  Entity,
  OffensivePlayType,
  PartialPlayer,
  PlaycallCoverageKey,
  PlaycallCoverageStats,
  PlayEndReason,
  Player,
  Role,
  Route,
  Scoreboard,
  State,
  Stats,
  Vector,
};

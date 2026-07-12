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

const PLAYER_LABELS = [
  "LT",
  "C",
  "RT",
  "QB",
  "XR",
  "ZR",
  "TE",
  "RB",
  "LE",
  "DT",
  "RE",
  "CB",
  "NB",
  "LB",
  "FS",
  "SS",
] as const;
type Label = (typeof PLAYER_LABELS)[number];

type Side = "offense" | "defense";
type Role = "blocker" | "runner" | "catcher" | "passer" | "rusher" | "coverer";

interface RosterPlayer {
  color: string;
  label: Label;
  name: string;
  ratings: Ratings;
  starred?: boolean;
  /** Monotonic draft order across the whole league; higher = picked later. */
  pickOrder?: number;
}
type Roster = RosterPlayer[];

interface Player extends Entity, RosterPlayer {
  type: "player";
  role: Role;
  side: Side;
  runAngle?: Vector; // For runners
  route?: Route; // For receivers
  coverage?: Coverage; // For coverers

  prevVel: Vector;

  // For passers
  decisionTicks: number;
  cachedThrowEval: {
    catcher: Player;
    target: Vector;
    ticksUntil: number;
    projectedOpenness: number;
    throwDist: number;
  } | null;

  // For receivers
  path: Vector[];
  breakTick: number | null;
  routeSideMultiplier: 1 | -1 | null;
  improvAngleRad: number | null;
  predictedTargets: Vector[] | null;

  // For rushers
  playRushSeed?: number;
  rushSpeedVariance?: number;
  shedImmunityTicks: number;
  shedCooldown: number;

  // Coverer state
  assignedTarget: Player | null;
  perceivedLoc: Vector | null;
  perceivedVel: Vector | null;
  reactionTimer: number;
  zone: Vector;

  // Tackle state
  tacklePressure?: number;
  tackleCooldownTicks?: number;
  burstTicks?: number;
  isBursting: boolean;
  contactedThisTick: boolean;

  // For rendering
  contextRays: Ray[] | null;
  chosenRayDir: Vector | null;
}

type CachedPlayers = {
  passer: Player | undefined;
  rushers: Player[];
  coverers: Player[];
  catchers: Player[];
  blockers: Player[];
};

type Ray = {
  dir: Vector;
  interest: number;
  danger: number;
  score: number;
};

type Ellipse = {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
};

type Route = {
  /** 0 = up, 90 = in, 180 = down, -90 = out */
  breakAngle: number;
  yardsBeforeBreak: number;
  stopAfterBreak: boolean;
};
type Coverage = "man" | "zone";

type OffensivePlayType = "run" | "pass";
type DefensiveCoverageType = "man" | "manBlitz" | "zone" | "zoneBlitz";
type SpecialPlayType = "punt" | "fieldgoal" | null;
type PlaycallCoverageKey =
  | "runMan"
  | "runManBlitz"
  | "runZone"
  | "runZoneBlitz"
  | "passMan"
  | "passManBlitz"
  | "passZone"
  | "passZoneBlitz";

type PlayEndReason =
  | "tackle"
  | "touchdown"
  | "sack"
  | "incomplete"
  | "interception"
  | "fieldgoal"
  | "punt";

type CountYards = {
  count: number;
  yards: number;
  avg: number;
};

type PlaycallStats = Record<OffensivePlayType, CountYards>;
type PlaycallCoverageYards = Record<PlaycallCoverageKey, CountYards>;
type CoverageStats = Record<DefensiveCoverageType, CountYards>;

type PlayCallCoverageStats = Record<PlaycallCoverageKey, QBStats | RBStats>;

type QBStats = {
  attempts: number;
  completions: number;
  yards: number;
  ypa: number;
  cmp: number;
  tds: number;
  ints: number;
  sacks: number;
  /** Completed passing yards thrown to each route, keyed by route name. */
  routeYards: Record<string, number>;
};

type RBStats = {
  rushes: number;
  yards: number;
  ypc: number;
  tds: number;
  tfls: number;
};

// Receiving line for catchers (XR/ZR/TE).
type ReceivingStats = {
  targets: number;
  catches: number;
  yards: number;
  tds: number;
  /** Receiving yards earned on each route run, keyed by route name. */
  routeYards: Record<string, number>;
};

// Defensive line for rushers (LE/DT/RE) and coverers (CB/NB/LB/FS/SS).
type DefensiveStats = {
  tackles: number;
  tfls: number;
  sacks: number;
  interceptions: number;
  passBreakups: number;
};

/**
 * A single player's stat line. Only the blocks appropriate to the player's role
 * are populated: passing for QBs, rushing for RBs, receiving for pass catchers,
 * and defense for pass rushers and coverers.
 */
type PlayerStats = {
  passing?: QBStats;
  rushing?: RBStats;
  receiving?: ReceivingStats;
  defense?: DefensiveStats;
};

/** Per-team dictionary of roster label → that player's stat line. */
type PlayerStatsByLabel = Partial<Record<Label, PlayerStats>>;

type PlayAdvancedData = {
  throwTick?: number; // state.steps when throw occurred
  airYards?: number; // pixels from LOS to catcher at throw time
  wasOffTarget: boolean; // throw was uncatchable
  wasUnderPressure: boolean; // at least one tick under pressure this play
  wasThrowAway: boolean;
  separationAtCatch?: number; // nearest defender dist in pixels at catch
  catchX?: number; // ball.loc.x when catcher caught the ball
  firstContactX?: number; // ball.loc.x on first tackle pressure tick
  tackler?: Player; // defender credited with the tackle/sack that ended the play
  interceptor?: Player; // defender who intercepted the pass
  passDefender?: Player; // defender who broke up an incomplete pass
};

// Averaged advanced stats
type AdvancedStats = {
  intendedAirYards: number;
  completedAirYards: number;
  timeToThrow: number;
  timeToSack: number;
  offTargetThrowRate: number;
  throwAwayRate: number;
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
  players: PlayerStatsByLabel;
  routes: Record<string, CountYards>;
  advanced: AdvancedStats;
};

type CurrentPlay = {
  offense: OffensivePlayType;
  defense: DefensiveCoverageType;
  special: SpecialPlayType;
  runAngle?: Vector;
  routes: Route[];
};

type Team = {
  name: string;
  color: string;
  score: number;
  timeouts: 0 | 1 | 2 | 3;
  possessing: boolean;
  roster: Roster;
};

type Scoreboard = {
  LOS: number;
  firstDownLine: number | null;
  time: number;
  quarter: "1st" | "2nd" | "3rd" | "4th";
  twoMinuteWarning: boolean;
  down: "1st" | "2nd" | "3rd" | "4th";
  distance: "goal" | number;
  teams: Team[];
};

type ReplayFrame = {
  ballLoc: Vector;
  ballVel: Vector;
  players: Player[];
  scoreboard: Scoreboard;
};

type BallFlightState = {
  isInFlight: boolean;
  startLoc: Vector;
  endLoc: Vector;
  receiver: Player | null;
  totalTicks: number;
  ticksElapsed: number;
};

type State = {
  ball: Ball;
  players: Player[];
  scoreboard: Scoreboard;
  currentPlay: CurrentPlay;

  stats: Record<string, Stats>;
  playAdvanced: PlayAdvancedData;

  pausedUntil: number;

  steps: number;
  ballGiven: boolean;
  ballGivenAtStep: number;
  ballFlight: BallFlightState | null;
  blockingAssignments: Map<Player, Player>;
};

export { PLAYER_LABELS };
export type {
  AdvancedStats,
  Ball,
  CachedPlayers,
  CountYards,
  Coverage,
  CurrentPlay,
  DefensiveCoverageType,
  DefensiveStats,
  Ellipse,
  Entity,
  Label,
  OffensivePlayType,
  PlayAdvancedData,
  PlaycallCoverageKey,
  PlayCallCoverageStats,
  PlaycallCoverageYards,
  PlayEndReason,
  Player,
  PlayerStats,
  PlayerStatsByLabel,
  QBStats,
  Ray,
  RBStats,
  ReceivingStats,
  ReplayFrame,
  Role,
  Roster,
  RosterPlayer,
  Route,
  Scoreboard,
  Side,
  SpecialPlayType,
  State,
  Stats,
  Team,
  Vector,
};

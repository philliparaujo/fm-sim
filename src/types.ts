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

  route?: Route; // For receivers
  coverage?: Coverage; // For coverers
}

interface Player extends PartialPlayer {
  // For receivers
  path: Vector[];

  // Coverer state
  assignedTarget: Player | null;
  perceivedLoc: Vector | null;
  perceivedVel: Vector | null;
  reactionTimer: number;
  zone: Vector;
}

type Route = {
  breakAngle: number;
  steps: number;
  stopAfterBreak: boolean;
};
type Coverage = "man" | "zone";

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
const dragRoute: Route = { breakAngle: 90, steps: 3, stopAfterBreak: false };
const flatRoute: Route = { breakAngle: -90, steps: 0, stopAfterBreak: false };

type State = {
  ball: Ball;
  players: Player[];
  LOS: number;
  pausedUntil: number;

  steps: number;
  ballGiven: boolean;
  ballGivenAtStep: number;
  earlyThrowDecided: boolean;
  panicThrowDecided: boolean;
};

export type {
  Vector,
  Entity,
  Ball,
  PartialPlayer,
  Player,
  Route,
  Coverage,
  State,
};
export {
  streakRoute,
  postRoute,
  cornerRoute,
  inRoute,
  outRoute,
  curlRoute,
  slantRoute,
  dragRoute,
  flatRoute,
};

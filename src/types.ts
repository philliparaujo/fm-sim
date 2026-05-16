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
type Role = "blocker" | "rusher" | "runner" | "catcher";

interface Player extends Entity {
  type: "player";
  color: string;
  maxSpeed: number;

  position: Position;
  role: Role;

  // Receiver state
  route: Route | null;
  path: Vector[];
}

type Route = {
  breakAngle: number;
  steps: number;
  stopAfterBreak: boolean;
};

const streakRoute: Route = { breakAngle: 0, steps: 0, stopAfterBreak: false };
const postRoute: Route = { breakAngle: 45, steps: 10, stopAfterBreak: false };
const cornerRoute: Route = {
  breakAngle: -45,
  steps: 10,
  stopAfterBreak: false,
};
const inRoute: Route = { breakAngle: 90, steps: 8, stopAfterBreak: false };
const outRoute: Route = { breakAngle: -90, steps: 8, stopAfterBreak: false };
const curlRoute: Route = { breakAngle: 180, steps: 6, stopAfterBreak: true };
const slantRoute: Route = { breakAngle: 60, steps: 3, stopAfterBreak: false };
const dragRoute: Route = { breakAngle: 90, steps: 3, stopAfterBreak: false };
const flatRoute: Route = { breakAngle: -90, steps: 0, stopAfterBreak: false };

type State = {
  ball: Ball;
  players: Player[];

  steps: number;
  ballGiven: boolean;
};

export type { Vector, Entity, Ball, Player, State };
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

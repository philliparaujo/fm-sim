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
type Role = "blocker" | "rusher" | "runner";

interface Player extends Entity {
  type: "player";
  color: string;
  maxSpeed: number;

  position: Position;
  role: Role;
}

type State = {
  ball: Ball;
  players: Player[];
};

export type { Vector, Entity, Ball, Player, State };

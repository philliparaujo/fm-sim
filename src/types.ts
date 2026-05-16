type Vector = {
  x: number;
  y: number;
};

type Ball = {
  position: Vector;
  velocity: Vector;
  radius: number;
  strokeWidth: number;
  laceWidth: number;
};

type Player = {
  position: Vector;
  velocity: Vector;
  radius: number;
  color: string;
};

type State = {
  ball: Ball;
  players: Player[];
};

export type { Vector, Ball, Player, State };

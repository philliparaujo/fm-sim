import { ENDZONE_W, H, TOTAL_H, W } from "./render";
import {
  Ball,
  cornerRoute,
  Coverage,
  curlRoute,
  dragRoute,
  flatRoute,
  inRoute,
  outRoute,
  Player,
  postRoute,
  Route,
  slantRoute,
  streakRoute,
  Vector,
} from "./types";

export function length(vector: Vector): number {
  return Math.sqrt(vector.x * vector.x + vector.y * vector.y);
}

export function dist(a: Vector, b: Vector): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return length({ x: dx, y: dy });
}

// Finds nearest point on line segment AB to point P
export function closestPointOnSegment(p: Vector, a: Vector, b: Vector): Vector {
  const pax = p.x - a.x;
  const pay = p.y - a.y;
  const bax = b.x - a.x;
  const bay = b.y - a.y;

  // Calculate the projection "t" (0.0 to 1.0) along the line
  let t = (pax * bax + pay * bay) / (bax * bax + bay * bay);

  // Clamp t to the segment so the blocker doesn't go behind the rusher or ball
  t = Math.max(0, Math.min(1, t));

  return {
    x: a.x + t * bax,
    y: a.y + t * bay,
  };
}

// Slow down player's velocity (when in contact with blocker)
export function applyDamping(player: Player, factor: number, jitter: number) {
  // 1. Damping (Multiplicative): Slows the existing movement
  player.vel.x *= factor + (Math.random() * 2 - 1) * jitter;
  player.vel.y *= factor + (Math.random() * 2 - 1) * jitter;

  // 2. Jitter (Additive): Forces movement even if the axis was 0
  // This allows players to "slip" sideways during a head-on engagement
  player.vel.x += (Math.random() * 2 - 1) * jitter;
  player.vel.y += (Math.random() * 2 - 1) * jitter;
}

const BALL_SNAP_DIST = 8; // Maximum distance where a player will snap to the ball
export function isCarryingBall(player: Player, ball: Ball): boolean {
  return dist(player.loc, ball.loc) < BALL_SNAP_DIST;
}

export function randomRoute(): Route {
  const routes = [
    streakRoute,
    postRoute,
    cornerRoute,
    inRoute,
    outRoute,
    curlRoute,
    slantRoute,
    dragRoute,
    flatRoute,
  ];
  return routes[Math.floor(Math.random() * routes.length)];
}

export function randomCoverage(): Coverage {
  const coverages: Coverage[] = ["man", "zone"];
  return coverages[Math.floor(Math.random() * coverages.length)];
}

export function vectorToString(vector: Vector): string {
  return `${vector.x}|${vector.y}`;
}

export function emptyVector(): Vector {
  return { x: 0, y: 0 };
}

export function randomRunVector(speed: number): Vector {
  // 1. Generate a random angle between +80 and -80
  const MAX_ANGLE_DEGRESS = 60;
  const maxAngleRad = (MAX_ANGLE_DEGRESS * Math.PI) / 180;
  const angle = (Math.random() * 2 - 1) * maxAngleRad;

  return {
    x: Math.cos(angle) * speed,
    y: Math.sin(angle) * speed,
  };
}

export function LOSToString(LOS: number) {
  if (LOS <= ENDZONE_W) return "Safety";
  if (LOS >= W + ENDZONE_W) return "Touchdown";

  const adjLOS = LOS - ENDZONE_W;
  const yardsNumber = Math.round((adjLOS / W) * 100);

  if (yardsNumber < 50) {
    return `< ${yardsNumber}`;
  } else if (yardsNumber === 50) {
    return `${yardsNumber}`;
  } else {
    return `${100 - yardsNumber} >`;
  }
}

const POCKET_CY = H / 2;
const POCKET_RX = 30;
const POCKET_RY = 120;
export function getPocket(LOS: number) {
  return {
    cx: LOS - (W * 5) / 100,
    cy: POCKET_CY,
    rx: POCKET_RX,
    ry: POCKET_RY,
  };
}

export function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

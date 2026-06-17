import { ENDZONE_W, H, TOTAL_H, TOTAL_W, W } from "./constants";
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
  Scoreboard,
  slantRoute,
  Stats,
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

export function diff(a: Vector, b: Vector): Vector {
  return {
    x: a.x - b.x,
    y: a.y - b.y,
  };
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

const BALL_SNAP_DIST = 24; // Maximum distance where a player will snap to the ball
export function isCarryingBall(player: Player, ball: Ball): boolean {
  return dist(player.loc, ball.loc) < BALL_SNAP_DIST;
}

export function randomRoute(): Route {
  const routes = [
    streakRoute,
    postRoute,
    cornerRoute,
    // inRoute,
    // outRoute,
    // curlRoute,
    // slantRoute,
    // dragRoute,
    // flatRoute,
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

export function randomRunVector(): Vector {
  // 1. Generate a random angle between +80 and -80
  const MAX_ANGLE_DEGRESS = 60;
  const maxAngleRad = (MAX_ANGLE_DEGRESS * Math.PI) / 180;
  const angle = (Math.random() * 2 - 1) * maxAngleRad;

  return {
    x: Math.cos(angle),
    y: Math.sin(angle),
  };
}

export function computeFirstDownLine(
  LOS: number,
  distance: "goal" | number,
): number | null {
  if (distance === "goal") return null;
  return LOS + (distance * W) / 100;
}

const DOWNS = ["1st", "2nd", "3rd", "4th"] as const;

export function yardsFromPixels(pixels: number): number {
  return Math.round((pixels / W) * 100);
}

export function yardsToGoal(LOS: number): number {
  const goalLine = W + ENDZONE_W;
  return Math.max(0, yardsFromPixels(goalLine - LOS));
}

export function distanceAfterFirstDown(LOS: number): "goal" | number {
  return yardsToGoal(LOS) <= 10 ? "goal" : 10;
}

function nextDown(down: Scoreboard["down"]): Scoreboard["down"] {
  const idx = DOWNS.indexOf(down);
  return DOWNS[Math.min(idx + 1, DOWNS.length - 1)];
}

export function updateDownAndDistance(
  prev: Pick<Scoreboard, "LOS" | "firstDownLine" | "down" | "distance">,
  nextLOS: number,
): Pick<Scoreboard, "down" | "distance" | "firstDownLine"> {
  const gotFirstDown =
    prev.firstDownLine !== null && nextLOS >= prev.firstDownLine;

  if (gotFirstDown) {
    const distance = distanceAfterFirstDown(nextLOS);
    return {
      down: "1st",
      distance,
      firstDownLine: computeFirstDownLine(nextLOS, distance),
    };
  }

  const yardsGained = yardsFromPixels(nextLOS - prev.LOS);
  const distance: "goal" | number =
    prev.distance === "goal"
      ? "goal"
      : Math.max(1, prev.distance - yardsGained);
  const down = prev.down === "4th" ? "4th" : nextDown(prev.down);

  return {
    down,
    distance,
    firstDownLine: computeFirstDownLine(nextLOS, distance),
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
const POCKET_RX = 90;
const POCKET_RY = 360;
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

export function isNoBreakRoute(route: Route): boolean {
  return route.steps === 0 || route.breakAngle === 0;
}

export function lerp(rating: number, min: number, max: number): number {
  return min + (max - min) * rating;
}

export function numPlays(stats: Stats) {
  return (
    stats.coverage.man.count +
    stats.coverage.manBlitz.count +
    stats.coverage.zone.count +
    stats.coverage.zoneBlitz.count
  );
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function projectDefenderPosition(
  defender: Player,
  frames: number,
): Vector {
  return {
    x: defender.loc.x + defender.vel.x * frames,
    y: defender.loc.y + defender.vel.y * frames,
  };
}

export function hitSideline(loc: Vector): boolean {
  const BOUNDARY_MARGIN = W / 100;

  const MIN_PLAYABLE_X = BOUNDARY_MARGIN;
  const MAX_PLAYABLE_X = TOTAL_W - BOUNDARY_MARGIN;
  const MIN_PLAYABLE_Y = BOUNDARY_MARGIN;
  const MAX_PLAYABLE_Y = TOTAL_H - BOUNDARY_MARGIN;

  return (
    loc.x <= MIN_PLAYABLE_X ||
    loc.x >= MAX_PLAYABLE_X ||
    loc.y <= MIN_PLAYABLE_Y ||
    loc.y >= MAX_PLAYABLE_Y
  );
}

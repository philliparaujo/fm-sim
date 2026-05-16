import { Player, Vector } from "./types";

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

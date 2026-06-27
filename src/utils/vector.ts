import { Vector } from "../core/types";

/* Primitive functions */
/** Returns a zero vector `{ x: 0, y: 0 }`. */
export function nullVector(): Vector {
  return { x: 0, y: 0 };
}

/** Serializes a vector to a stable string key (`"x|y"`). */
export function vectorToString(vector: Vector): string {
  return `${vector.x}|${vector.y}`;
}

/* Geometry functions */
/** Returns the magnitude (length) of a vector. */
export function length(vector: Vector): number {
  return Math.sqrt(vector.x * vector.x + vector.y * vector.y);
}

/** Returns the Euclidean distance between two points. */
export function dist(a: Vector, b: Vector): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return length({ x: dx, y: dy });
}

/** Returns the vector from `b` to `a` (`a - b`). */
export function diff(a: Vector, b: Vector): Vector {
  return {
    x: a.x - b.x,
    y: a.y - b.y,
  };
}

/** Returns the nearest point on segment AB to point P, clamped to the segment. */
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

/** Returns the projected position of an entity after `ticks` ticks at its current velocity. */
export function predictFutureLocation(
  currentLoc: Vector,
  currentVel: Vector,
  ticks: number,
): Vector {
  return {
    x: currentLoc.x + currentVel.x * ticks,
    y: currentLoc.y + currentVel.y * ticks,
  };
}

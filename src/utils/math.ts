/** Returns a specific percentage of the way between min and max */
export function lerp(percent: number, min: number, max: number): number {
  return min + (max - min) * percent;
}

/** Rounds a number to two decimal places */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

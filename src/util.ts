import { Vector } from "./types";

export function length(vector: Vector): number {
  return Math.sqrt(vector.x * vector.x + vector.y * vector.y);
}

import { TOTAL_H, TOTAL_W } from "../utils/units";

const isWorker = typeof document === "undefined";

export const canvas = isWorker
  ? (null as unknown as HTMLCanvasElement)
  : (document.getElementById("field") as HTMLCanvasElement);

export const ctx = isWorker
  ? (null as unknown as CanvasRenderingContext2D)
  : (canvas.getContext("2d") as CanvasRenderingContext2D);

if (!isWorker) {
  canvas.width = TOTAL_W;
  canvas.height = TOTAL_H;
}

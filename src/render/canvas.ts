import { TOTAL_H, TOTAL_W } from "../utils/units";

export const canvas = document.getElementById("field") as HTMLCanvasElement;
export const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;

canvas.width = TOTAL_W;
canvas.height = TOTAL_H;

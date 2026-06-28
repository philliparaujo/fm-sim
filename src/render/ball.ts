import { Ball, Vector } from "../core/types";
import { ctx } from "./canvas";

const BALL_FILL = "#8B4513";
const BALL_STROKE = "#5a2d0c";
const BALL_LACE_STROKE = "rgba(255,255,255,0.8)";

const TARGET_FILL = "rgba(231, 76, 60, 0.25)";
const TARGET_RING_STROKE = "#E74C3C";
const TARGET_RING_WIDTH = 2.5;
const TARGET_INNER_RING_STROKE = "#FFFFFF";
const TARGET_INNER_RING_WIDTH = 2;
const TARGET_OUTER_RADIUS = 16;
const TARGET_INNER_RADIUS = 10;
const TARGET_DOT_RADIUS = 4;
const TARGET_CROSSHAIR_STROKE = "#E74C3C";
const TARGET_CROSSHAIR_WIDTH = 1.5;
const TARGET_CROSSHAIR_REACH = 22;
const TARGET_CROSSHAIR_GAP = 6;

function drawThrowTarget(location: Vector) {
  if (!location) return;

  ctx.save();
  ctx.translate(location.x, location.y);

  // 1. Outer Red Ring
  ctx.beginPath();
  ctx.arc(0, 0, TARGET_OUTER_RADIUS, 0, Math.PI * 2);
  ctx.fillStyle = TARGET_FILL;
  ctx.fill();
  ctx.strokeStyle = TARGET_RING_STROKE;
  ctx.lineWidth = TARGET_RING_WIDTH;
  ctx.stroke();

  // 2. Middle White Ring
  ctx.beginPath();
  ctx.arc(0, 0, TARGET_INNER_RADIUS, 0, Math.PI * 2);
  ctx.strokeStyle = TARGET_INNER_RING_STROKE;
  ctx.lineWidth = TARGET_INNER_RING_WIDTH;
  ctx.stroke();

  // 3. Center Red Bullseye Dot
  ctx.beginPath();
  ctx.arc(0, 0, TARGET_DOT_RADIUS, 0, Math.PI * 2);
  ctx.fillStyle = TARGET_RING_STROKE;
  ctx.fill();

  // 4. Tactical Crosshairs
  ctx.strokeStyle = TARGET_CROSSHAIR_STROKE;
  ctx.lineWidth = TARGET_CROSSHAIR_WIDTH;

  // Horizontal line (gap in center for clean look)
  ctx.beginPath();
  ctx.moveTo(-TARGET_CROSSHAIR_REACH, 0);
  ctx.lineTo(-TARGET_CROSSHAIR_GAP, 0);
  ctx.moveTo(TARGET_CROSSHAIR_GAP, 0);
  ctx.lineTo(TARGET_CROSSHAIR_REACH, 0);
  ctx.stroke();

  // Vertical line
  ctx.beginPath();
  ctx.moveTo(0, -TARGET_CROSSHAIR_REACH);
  ctx.lineTo(0, -TARGET_CROSSHAIR_GAP);
  ctx.moveTo(0, TARGET_CROSSHAIR_GAP);
  ctx.lineTo(0, TARGET_CROSSHAIR_REACH);
  ctx.stroke();

  ctx.restore();
}

function drawBall(ball: Ball) {
  ctx.beginPath();

  // Ball body (oval)
  ctx.save();
  ctx.translate(ball.loc.x, ball.loc.y);
  ctx.beginPath();
  ctx.ellipse(0, 0, ball.radius, ball.radius, 0, 0, Math.PI * 2);
  ctx.fillStyle = BALL_FILL;
  ctx.fill();
  ctx.strokeStyle = BALL_STROKE;
  ctx.lineWidth = ball.strokeWidth;
  ctx.stroke();

  // Lace
  ctx.strokeStyle = BALL_LACE_STROKE;
  ctx.lineWidth = ball.laceWidth;
  ctx.beginPath();
  ctx.moveTo(-ball.radius / 2, 0);
  ctx.lineTo(ball.radius / 2, 0);
  ctx.stroke();
  ctx.restore();
}

export default drawBall;
export { drawThrowTarget };

import { state } from "./simulate";
import { Player } from "./types";

const W = 720;
const H = 400;
const GRASS_COLOR = "#66aa22";
const BALL_COLOR = "#8B4513";
const BALL_STROKE_COLOR = "#5a2d0c";
const BALL_LACE_COLOR = "rgba(255,255,255,0.6)";

const canvas = document.getElementById("field") as HTMLCanvasElement;
const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;

canvas.width = W;
canvas.height = H;

function drawField() {
  ctx.fillStyle = GRASS_COLOR;
  ctx.fillRect(0, 0, W, H);
}

function drawBall() {
  ctx.beginPath();

  // Ball body (oval)
  ctx.save();
  ctx.translate(state.ball.loc.x, state.ball.loc.y);
  ctx.beginPath();
  ctx.ellipse(0, 0, state.ball.radius, state.ball.radius, 0, 0, Math.PI * 2);
  ctx.fillStyle = BALL_COLOR;
  ctx.fill();
  ctx.strokeStyle = BALL_STROKE_COLOR;
  ctx.lineWidth = state.ball.strokeWidth;
  ctx.stroke();

  // Lace
  ctx.strokeStyle = BALL_LACE_COLOR;
  ctx.lineWidth = state.ball.laceWidth;
  ctx.beginPath();
  ctx.moveTo(-state.ball.radius / 2, 0);
  ctx.lineTo(state.ball.radius / 2, 0);
  ctx.stroke();
  ctx.restore();
}

function drawPlayer(player: Player) {
  ctx.beginPath();
  ctx.ellipse(
    player.loc.x,
    player.loc.y,
    player.radius,
    player.radius,
    0,
    0,
    Math.PI * 2
  );
  ctx.fillStyle = player.color;
  ctx.fill();
}

/* High-level rendering functions */
function render() {
  drawField();
  for (const player of state.players) {
    drawPlayer(player);
  }
  drawBall();
}

export { H, render, W };

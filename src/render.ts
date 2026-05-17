import { state } from "./simulate";
import { Player } from "./types";

const W = 720;
const H = 400;
const GRASS_COLOR = "#66aa22";
const BALL_COLOR = "#8B4513";
const BALL_STROKE_COLOR = "#5a2d0c";
const BALL_LACE_COLOR = "rgba(255,255,255,0.6)";

const CATCHER_TRACE_ON = true;
const COVERER_ZONE_ON = true;
const RUNNER_PATH_ON = true;

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

function drawCatcherTrace(player: Player) {
  if (player.role !== "catcher" || player.path.length < 2) return;

  ctx.beginPath();
  ctx.setLineDash([5, 5]); // Optional: make it a dashed "playbook" line
  ctx.strokeStyle = "rgba(255, 255, 255, 0.5)"; // White semi-transparent
  ctx.lineWidth = 2;

  // Start at the beginning of the path
  ctx.moveTo(player.path[0].x, player.path[0].y);

  // Connect all points
  for (let i = 1; i < player.path.length; i++) {
    ctx.lineTo(player.path[i].x, player.path[i].y);
  }

  ctx.stroke();
  ctx.setLineDash([]); // Reset dash for other drawing operations
}

function drawCovererZone(player: Player) {
  // Only draw if it's a coverer in zone coverage
  if (player.role !== "coverer" || player.coverage !== "zone" || !player.zone)
    return;

  ctx.beginPath();
  // Use a light dashed line or a soft fill to represent the 'area'
  ctx.setLineDash([10, 10]);
  ctx.arc(player.zone.x, player.zone.y, 80, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(255, 255, 0, 0.7)";
  ctx.lineWidth = 1;
  ctx.stroke();

  // Optional: Draw a small cross or dot at the center (startLoc)
  ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
  ctx.fillRect(player.zone.x - 2, player.zone.y - 2, 4, 4);

  ctx.setLineDash([]); // Reset dash
}

function drawRunnerPath(player: Player) {
  if (player.role !== "runner" || player.path.length < 2) return;

  ctx.beginPath();
  ctx.setLineDash([3, 1]); // Optional: make it a dashed "playbook" line
  ctx.strokeStyle = "rgba(25, 25, 25, 0.5)"; // White semi-transparent
  ctx.lineWidth = 2;

  // Start at the beginning of the path
  ctx.moveTo(player.path[0].x, player.path[0].y);

  // Connect all points
  for (let i = 1; i < player.path.length; i++) {
    ctx.lineTo(player.path[i].x, player.path[i].y);
  }

  ctx.stroke();
  ctx.setLineDash([]); // Reset dash for other drawing operations
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
    Math.PI * 2,
  );
  ctx.fillStyle = player.color;
  ctx.fill();
}

/* High-level rendering functions */
function render() {
  drawField();

  // Draw traces first so they are under the players
  for (const player of state.players) {
    if (CATCHER_TRACE_ON) {
      drawCatcherTrace(player);
    }
    if (COVERER_ZONE_ON) {
      drawCovererZone(player);
    }
    if (RUNNER_PATH_ON) {
      drawRunnerPath(player);
    }
  }

  for (const player of state.players) {
    drawPlayer(player);
  }
  drawBall();
}

export { H, render, W };

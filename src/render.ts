import {
  calculatePerfectThrowTarget,
  predictReceiverRoute,
} from "./playerBehavior";
import { getConstants } from "./ratings";
import { ENDZONE_W, H, TOTAL_H, TOTAL_W, W } from "./constants";
import { Ball, Player, Scoreboard, State, Vector } from "./types";
import { getPocket, isCarryingBall } from "./util";

const GRASS_COLOR = "#66aa22";
const FIELD_HASH_COLOR = "rgba(255, 255, 255, 0.2)";
const FIELD_NUMBER_COLOR = "rgba(255, 255, 255, 0.3)";
const ENDZONE_COLOR = "rgba(140, 0, 255, 0.5)";
const LOS_COLOR = "rgba(0, 120, 255, 0.8)";
const FIRST_DOWN_COLOR = "rgba(255, 255, 0, 0.8)";
const FIRST_DOWN_4TH_COLOR = "rgba(255, 0, 0, 0.8)";

const BALL_COLOR = "#8B4513";
const BALL_STROKE_COLOR = "#5a2d0c";
const BALL_LACE_COLOR = "rgba(255,255,255,0.6)";

const CATCHER_TRACE_ON = true;
const COVERER_ZONE_ON = true;
const RUNNER_PATH_ON = true;
const PASSER_POCKET_ON = false;
const RUNNER_LOOK_AHEAD_ON = false;
const PREDICTED_ROUTE_ON = true;
const PREDICTED_TARGET_ON = true;
const ALL_PREDICTED_ROUTE_ON = PREDICTED_ROUTE_ON && false;
const ALL_PREDICTED_TARGET_ON = PREDICTED_TARGET_ON && false;

const ONLY_SIMULATE = false;

const canvas = document.getElementById("field") as HTMLCanvasElement;
const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
const scoreboard = document.getElementById("scoreboard") as HTMLDivElement;

canvas.width = TOTAL_W;
canvas.height = TOTAL_H;

scoreboard.style.width = `${TOTAL_W}px`;
scoreboard.style.visibility = "visible";

function drawVerticalLine(x: number, color: string) {
  ctx.lineWidth = 6;
  ctx.strokeStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, 5);
  ctx.lineTo(x, TOTAL_H - 5);
  ctx.stroke();
}

function drawField(
  scoreboard?: Pick<Scoreboard, "LOS" | "firstDownLine" | "down">,
) {
  // 1. Draw the Grass
  ctx.fillStyle = GRASS_COLOR;
  ctx.fillRect(0, 0, TOTAL_W, TOTAL_H);

  // 1.5. Draw the Endzones
  ctx.fillStyle = ENDZONE_COLOR;
  ctx.fillRect(0, 0, ENDZONE_W, TOTAL_H);
  ctx.fillRect(TOTAL_W - ENDZONE_W, 0, ENDZONE_W, TOTAL_H);

  // 2. Draw Sidelines and Endlines
  ctx.strokeStyle = FIELD_HASH_COLOR;
  ctx.lineWidth = 6;
  ctx.strokeRect(5, 5, TOTAL_W - 10, TOTAL_H - 10);

  // 3. Draw Yard Lines
  // We'll draw a line every 40 pixels to represent 10 yards
  const yardSpacing = W / 10;
  ctx.lineWidth = 3;

  for (let i = 0; i <= 10; i++) {
    const x = i * yardSpacing + ENDZONE_W;

    ctx.beginPath();
    ctx.moveTo(x, 5);
    ctx.lineTo(x, TOTAL_H - 5);
    ctx.stroke();

    if (i === 10) continue;

    // 4. Draw Hash Marks (Top and Bottom)
    // Small ticks between the main yard lines
    ctx.globalAlpha = 0.5;
    for (let j = 1; j < 5; j++) {
      const hashX = x - (yardSpacing / 5) * j;
      // Top hashes
      ctx.beginPath();
      ctx.moveTo(hashX, 5);
      ctx.lineTo(hashX, 15);
      ctx.stroke();
      // Bottom hashes
      ctx.beginPath();
      ctx.moveTo(hashX, TOTAL_H - 15);
      ctx.lineTo(hashX, TOTAL_H - 5);
      ctx.stroke();
    }
    ctx.globalAlpha = 1.0;

    // 5. Yard Numbers
    if (i > 0 && i < 10) {
      ctx.fillStyle = FIELD_NUMBER_COLOR;
      ctx.font = "bold 16px Arial";
      ctx.textAlign = "center";

      // Calculate yard number (e.g., 10, 20, 30, 40, 50, 40...)
      const yardNum = i <= 5 ? i * 10 : (10 - i) * 10;

      // Draw numbers near top and bottom sidelines
      ctx.fillText(yardNum.toString(), x, 40);
      ctx.fillText(yardNum.toString(), x, H - 30);
    }
  }

  if (scoreboard?.LOS) {
    drawVerticalLine(scoreboard.LOS, LOS_COLOR);
  }

  if (scoreboard?.firstDownLine != null) {
    const firstDownColor =
      scoreboard.down === "4th" ? FIRST_DOWN_4TH_COLOR : FIRST_DOWN_COLOR;
    drawVerticalLine(scoreboard.firstDownLine, firstDownColor);
  }
}

function drawBall(ball: Ball) {
  ctx.beginPath();

  // Ball body (oval)
  ctx.save();
  ctx.translate(ball.loc.x, ball.loc.y);
  ctx.beginPath();
  ctx.ellipse(0, 0, ball.radius, ball.radius, 0, 0, Math.PI * 2);
  ctx.fillStyle = BALL_COLOR;
  ctx.fill();
  ctx.strokeStyle = BALL_STROKE_COLOR;
  ctx.lineWidth = ball.strokeWidth;
  ctx.stroke();

  // Lace
  ctx.strokeStyle = BALL_LACE_COLOR;
  ctx.lineWidth = ball.laceWidth;
  ctx.beginPath();
  ctx.moveTo(-ball.radius / 2, 0);
  ctx.lineTo(ball.radius / 2, 0);
  ctx.stroke();
  ctx.restore();
}

function drawCatcherTrace(player: Player) {
  if (player.role !== "catcher" || player.path.length < 2) return;

  ctx.beginPath();
  ctx.setLineDash([15, 15]); // Optional: make it a dashed "playbook" line
  ctx.strokeStyle = "rgba(255, 255, 255, 0.5)"; // White semi-transparent
  ctx.lineWidth = 6;

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
  ctx.setLineDash([30, 30]);
  ctx.arc(player.zone.x, player.zone.y, 240, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(255, 255, 0, 0.7)";
  ctx.lineWidth = 3;
  ctx.stroke();

  // Optional: Draw a small cross or dot at the center (startLoc)
  ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
  ctx.fillRect(player.zone.x - 2, player.zone.y - 2, 4, 4);

  ctx.setLineDash([]); // Reset dash
}

function drawRunnerPath(player: Player, ctx: CanvasRenderingContext2D) {
  if (!player.path || player.path.length < 2) return;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(player.path[0].x, player.path[0].y);
  for (let i = 1; i < player.path.length; i++) {
    ctx.lineTo(player.path[i].x, player.path[i].y);
  }
  ctx.strokeStyle = "rgba(255, 255, 255, 0.6)";
  ctx.lineWidth = 3.5;
  ctx.setLineDash([6, 6]); // Football dash trail style
  ctx.stroke();
  ctx.restore();
}

function drawPasserPocket(
  player: Player,
  pocket: { cx: number; cy: number; rx: number; ry: number },
) {
  if (player.role !== "passer") return;

  const { cx, cy, rx, ry } = pocket;

  // Soft filled ellipse
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255, 255, 255, 0.04)";
  ctx.fill();

  // Dashed border
  ctx.beginPath();
  ctx.setLineDash([18, 18]);
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.setLineDash([]);

  // Line from passer to ellipse center so you can see where they are relative to it
  ctx.beginPath();
  ctx.setLineDash([6, 12]);
  ctx.moveTo(player.loc.x, player.loc.y);
  ctx.lineTo(cx, cy);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawContextSteeringRays(
  player: Player,
  ctx: CanvasRenderingContext2D,
) {
  const rays = (player as any).contextRays;
  if (!rays || rays.length === 0) return;

  ctx.save();
  const BASE_RAY_LENGTH = 55;

  for (const ray of rays) {
    const scoreVal = ray.score;
    // Scale line length visually with rating score
    const lengthScale = Math.max(0.15, scoreVal + 1.0);
    const currentLength = BASE_RAY_LENGTH * lengthScale;

    const targetX = player.loc.x + ray.dir.x * currentLength;
    const targetY = player.loc.y + ray.dir.y * currentLength;

    ctx.beginPath();
    ctx.moveTo(player.loc.x, player.loc.y);
    ctx.lineTo(targetX, targetY);

    if (scoreVal > 0) {
      // Clear lane: render bright translucent green lines
      const opacity = Math.min(1.0, 0.25 + scoreVal * 0.75);
      ctx.strokeStyle = `rgba(46, 204, 113, ${opacity})`;
      ctx.lineWidth = 2.5;
    } else {
      // Impeded lane: render fine faint red lines
      const opacity = Math.min(0.5, Math.abs(scoreVal) * 0.2);
      ctx.strokeStyle = `rgba(231, 76, 60, ${opacity})`;
      ctx.lineWidth = 1.0;
    }
    ctx.stroke();

    // Draw bullet dot over chosen target direction index
    const chosen = (player as any).chosenRayDir;
    if (chosen && chosen.x === ray.dir.x && chosen.y === ray.dir.y) {
      ctx.beginPath();
      ctx.arc(targetX, targetY, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = "#F1C40F"; // Gold bullet marker
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawThrowTarget(location: Vector) {
  if (!location) return;

  ctx.save();
  ctx.translate(location.x, location.y);

  // 1. Outer Red Ring
  ctx.beginPath();
  ctx.arc(0, 0, 16, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(231, 76, 60, 0.25)"; // Soft red fill
  ctx.fill();
  ctx.strokeStyle = "#E74C3C"; // Solid red border
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // 2. Middle White Ring
  ctx.beginPath();
  ctx.arc(0, 0, 10, 0, Math.PI * 2);
  ctx.strokeStyle = "#FFFFFF"; // Solid white ring
  ctx.lineWidth = 2;
  ctx.stroke();

  // 3. Center Red Bullseye Dot
  ctx.beginPath();
  ctx.arc(0, 0, 4, 0, Math.PI * 2);
  ctx.fillStyle = "#E74C3C";
  ctx.fill();

  // 4. Tactical Crosshairs
  ctx.strokeStyle = "#E74C3C";
  ctx.lineWidth = 1.5;

  // Horizontal line (with a small gap in the very center for clean looks)
  ctx.beginPath();
  ctx.moveTo(-22, 0);
  ctx.lineTo(-6, 0);
  ctx.moveTo(6, 0);
  ctx.lineTo(22, 0);
  ctx.stroke();

  // Vertical line
  ctx.beginPath();
  ctx.moveTo(0, -22);
  ctx.lineTo(0, -6);
  ctx.moveTo(0, 6);
  ctx.lineTo(0, 22);
  ctx.stroke();

  ctx.restore();
}

function drawReceiverPredictedRoute(
  passer: Player,
  receiver: Player,
  state: State,
) {
  const predictedRoute: Vector[] = predictReceiverRoute(
    passer,
    receiver,
    state,
  );

  if (predictedRoute.length < 2) return;

  ctx.save();
  ctx.beginPath();

  // Start the line structure at the receiver's actual current location
  ctx.moveTo(receiver.loc.x, receiver.loc.y);

  // Trace through all predicted coordinate steps
  for (const point of predictedRoute) {
    ctx.lineTo(point.x, point.y);
  }

  // Draw a clean, neon-translucent path representing the future footprint
  ctx.strokeStyle = "rgba(255, 160, 0, 1)"; // Soft translucent field green
  ctx.lineWidth = 3;
  ctx.setLineDash([4, 8]); // Short dashes to represent a "ghost path" projection
  ctx.stroke();
  ctx.restore();
}

function drawPlayer(player: Player) {
  const { radius } = getConstants("SIZE", player);

  // 2. Draw the Player (Original logic)
  ctx.beginPath();
  ctx.ellipse(player.loc.x, player.loc.y, radius, radius, 0, 0, Math.PI * 2);
  ctx.fillStyle = player.color;
  ctx.fill();

  if (player.label) {
    ctx.fillStyle = "#FFFFFF";

    const fontSize = Math.floor(radius * 0.7);
    ctx.font = `bold ${fontSize}px sans-serif`;

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    ctx.fillText(player.label.substring(0, 2), player.loc.x, player.loc.y);
  }
}

/* High-level rendering functions */
function render(state: State) {
  const pocket = getPocket(state.scoreboard.LOS);
  const scoreboard = state.scoreboard;

  if (ONLY_SIMULATE) return;
  drawField(scoreboard);

  // Draw traces first so they are under the players
  for (const player of state.players) {
    if (CATCHER_TRACE_ON) {
      drawCatcherTrace(player);
    }
    if (COVERER_ZONE_ON) {
      drawCovererZone(player);
    }
    if (RUNNER_PATH_ON) {
      drawRunnerPath(player, ctx);
    }
    if (PASSER_POCKET_ON) {
      drawPasserPocket(player, pocket);
    }
  }

  // Draw predicted throw routes/targets for all catchers
  const passer = state.players.find((p) => p.role === "passer");
  const catchers = state.players.filter((p) => p.role === "catcher" && p.route);

  if (passer && state.currentPlay.offense === "pass") {
    for (const catcher of catchers) {
      if (ALL_PREDICTED_ROUTE_ON) {
        drawReceiverPredictedRoute(passer, catcher, state);
      }
      if (ALL_PREDICTED_TARGET_ON && catcher.predictedTarget) {
        drawThrowTarget(catcher.predictedTarget);
      }
    }
  }

  // Draw predicted throw route/target for passer's choice when ball in air
  if (state.ballFlight && state.ballFlight.isInFlight) {
    const receiver = state.ballFlight.receiver;
    if (PREDICTED_TARGET_ON) {
      drawThrowTarget(state.ballFlight.endLoc);
    }
    if (PREDICTED_ROUTE_ON && passer && receiver) {
      drawReceiverPredictedRoute(passer, receiver, state);
    }
  }

  for (const player of state.players) {
    drawPlayer(player);

    if (isCarryingBall(player, state.ball) && RUNNER_LOOK_AHEAD_ON) {
      drawContextSteeringRays(player, ctx);
    }
  }

  if (!state.ballFlight || !state.ballFlight.isInFlight) {
    drawBall(state.ball);
  }
}

export { render };

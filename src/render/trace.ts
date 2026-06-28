import { Ellipse, Player, State } from "../core/types";
import { predictReceiverRoute } from "../playerBehavior";
import { ctx } from "./canvas";

const PREDICTED_ROUTE_STROKE = "rgba(255, 160, 0, 1)";
const PREDICTED_ROUTE_WIDTH = 3;
const PREDICTED_ROUTE_DASH = [4, 8];

const CATCHER_TRACE_STROKE = "rgba(255, 255, 255, 0.5)";
const CATCHER_TRACE_WIDTH = 6;
const CATCHER_TRACE_DASH = [15, 15];

const RUNNER_PATH_STROKE = "rgba(255, 255, 255, 0.6)";
const RUNNER_PATH_WIDTH = 3.5;
const RUNNER_PATH_DASH = [6, 6];

const ZONE_STROKE = "rgba(255, 255, 0, 0.7)";
const ZONE_WIDTH = 3;
const ZONE_DASH = [30, 30];
const ZONE_RADIUS = 240;
const ZONE_FILL_COLOR = "rgba(255, 255, 255, 0.7)";
const ZONE_FILL_RADIUS = 4;

const POCKET_ELLIPSE_STROKE = "rgba(255, 255, 255, 0.25)";
const POCKET_ELLIPSE_WIDTH = 3;
const POCKET_ELLIPSE_DASH = [18, 18];
const POCKET_ELLIPSE_FILL_COLOR = "rgba(255, 255, 255, 0.04)";
const POCKET_LINE_STROKE = "rgba(255, 255, 255, 0.25)";
const POCKET_LINE_WIDTH = 3;
const POCKET_LINE_DASH = [6, 12];

const RAY_LENGTH = 55;
const RAY_WIDTH = 2.5;
const RAY_STROKE = (opacity: number) => `rgba(46, 204, 113, ${opacity})`;
const RAY_DOT_RADIUS = 4.5;
const RAY_DOT_FILL = "#F1C40F";

function resetCtx() {
  ctx.setLineDash([]);
  ctx.restore();
}

function drawReceiverPredictedRoute(receiver: Player, state: State) {
  const { timeline: predictedRoute } = predictReceiverRoute(receiver, state);

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
  ctx.strokeStyle = PREDICTED_ROUTE_STROKE;
  ctx.lineWidth = PREDICTED_ROUTE_WIDTH;
  ctx.setLineDash(PREDICTED_ROUTE_DASH);
  ctx.stroke();

  resetCtx();
}

function drawCatcherTrace(player: Player) {
  if (player.role !== "catcher" || player.path.length < 2) return;

  ctx.beginPath();
  ctx.strokeStyle = CATCHER_TRACE_STROKE;
  ctx.lineWidth = CATCHER_TRACE_WIDTH;
  ctx.setLineDash(CATCHER_TRACE_DASH);

  // Start at the beginning of the path
  ctx.moveTo(player.path[0].x, player.path[0].y);

  // Connect all points
  for (let i = 1; i < player.path.length; i++) {
    ctx.lineTo(player.path[i].x, player.path[i].y);
  }

  ctx.stroke();

  resetCtx();
}

function drawRunnerPath(player: Player) {
  if (!player.path || player.path.length < 2) return;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(player.path[0].x, player.path[0].y);
  for (let i = 1; i < player.path.length; i++) {
    ctx.lineTo(player.path[i].x, player.path[i].y);
  }
  ctx.strokeStyle = RUNNER_PATH_STROKE;
  ctx.lineWidth = RUNNER_PATH_WIDTH;
  ctx.setLineDash(RUNNER_PATH_DASH);
  ctx.stroke();

  resetCtx();
}

function drawCovererZone(player: Player) {
  if (player.role !== "coverer" || player.coverage !== "zone" || !player.zone)
    return;

  ctx.beginPath();
  ctx.strokeStyle = ZONE_STROKE;
  ctx.lineWidth = ZONE_WIDTH;
  ctx.setLineDash(ZONE_DASH);
  ctx.arc(player.zone.x, player.zone.y, ZONE_RADIUS, 0, Math.PI * 2);
  ctx.stroke();

  // Draw a small dot at the center
  ctx.fillStyle = ZONE_FILL_COLOR;
  ctx.beginPath();
  ctx.arc(player.zone.x, player.zone.y, ZONE_FILL_RADIUS, 0, Math.PI * 2);
  ctx.fill();

  resetCtx();
}

function drawPasserPocket(player: Player, pocket: Ellipse) {
  if (player.role !== "passer") return;

  const { cx, cy, rx, ry } = pocket;

  // Ellipse fill
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = POCKET_ELLIPSE_FILL_COLOR;
  ctx.fill();

  // Ellipse border
  ctx.beginPath();
  ctx.strokeStyle = POCKET_ELLIPSE_STROKE;
  ctx.lineWidth = POCKET_ELLIPSE_WIDTH;
  ctx.setLineDash(POCKET_ELLIPSE_DASH);
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.stroke();

  // Line from passer to ellipse center
  ctx.beginPath();
  ctx.moveTo(player.loc.x, player.loc.y);
  ctx.lineTo(cx, cy);
  ctx.strokeStyle = POCKET_LINE_STROKE;
  ctx.lineWidth = POCKET_LINE_WIDTH;
  ctx.setLineDash(POCKET_LINE_DASH);
  ctx.stroke();

  resetCtx();
}

function drawContextSteeringRays(
  player: Player,
  ctx: CanvasRenderingContext2D,
) {
  const rays = player.contextRays;
  if (!rays || rays.length === 0) return;

  ctx.save();
  for (const ray of rays) {
    const scoreVal = ray.score;
    // Scale line length visually with rating score
    const lengthScale = Math.max(0.15, scoreVal + 1.0);
    const currentLength = RAY_LENGTH * lengthScale;

    const targetX = player.loc.x + ray.dir.x * currentLength;
    const targetY = player.loc.y + ray.dir.y * currentLength;

    ctx.beginPath();
    ctx.moveTo(player.loc.x, player.loc.y);
    ctx.lineTo(targetX, targetY);

    if (scoreVal > 0) {
      const opacity = Math.min(1.0, 0.25 + scoreVal * 0.75);
      ctx.strokeStyle = RAY_STROKE(opacity);
      ctx.lineWidth = RAY_WIDTH;
    }
    ctx.stroke();

    // Draw bullet dot over chosen target direction index
    const chosen = player.chosenRayDir;
    if (chosen && chosen.x === ray.dir.x && chosen.y === ray.dir.y) {
      ctx.beginPath();
      ctx.arc(targetX, targetY, RAY_DOT_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = RAY_DOT_FILL;
      ctx.fill();
    }
  }

  resetCtx();
}

export {
  drawCatcherTrace,
  drawContextSteeringRays,
  drawCovererZone,
  drawPasserPocket,
  drawReceiverPredictedRoute,
  drawRunnerPath,
};

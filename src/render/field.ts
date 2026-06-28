import { Scoreboard } from "../core/types";
import {
  ENDZONE_W,
  GOALPOST_CROSSBAR_WIDTH,
  H,
  TOTAL_H,
  TOTAL_W,
  yardsToPx,
} from "../utils/units";
import { ctx } from "./canvas";

const GRASS_FILL = "#66aa22";

const ENDZONE_FILL = "rgba(140, 0, 255, 0.5)";

const SIDELINE_STROKE = "rgba(255, 255, 255, 0.3)";
const SIDELINE_WIDTH = 6;
const SIDELINE_INSET = 2;

const YARD_LINE_STROKE = "rgba(255, 255, 255, 0.3)";
const YARD_LINE_WIDTH = 3;
const YARD_LINE_INTERVAL = 10;

const HASH_STROKE = "rgba(255, 255, 255, 0.3)";
const HASH_ALPHA = 0.5;
const HASH_LENGTH = 20;
const HASH_SUBDIVISIONS = 5;

const FIELD_NUMBER_FILL = "rgba(255, 255, 255, 0.5)";
const FIELD_NUMBER_FONT = "bold 20px Arial";

const GOALPOST_STROKE = "#FFD400";
const GOALPOST_WIDTH = 5;
const GOALPOST_POST_RADIUS = 6;
const GOALPOST_CENTER_HASH_LENGTH = 10;

const VERTICAL_LINE_WIDTH = 6; // Both LOS and FIRST_DOWN line
const LOS_STROKE = "rgba(0, 120, 255, 0.8)";
const FIRST_DOWN_STROKE = "rgba(255, 255, 0, 0.8)";
const FIRST_DOWN_4TH_STROKE = "rgba(255, 0, 0, 0.8)";

function drawVerticalLine(x: number, color: string) {
  ctx.lineWidth = VERTICAL_LINE_WIDTH;
  ctx.strokeStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, SIDELINE_INSET);
  ctx.lineTo(x, TOTAL_H - SIDELINE_INSET);
  ctx.stroke();
}

function drawFieldGoalPosts(x: number) {
  const centerY = TOTAL_H / 2;
  const halfCrossbar = GOALPOST_CROSSBAR_WIDTH / 2;

  ctx.save();
  ctx.strokeStyle = GOALPOST_STROKE;
  ctx.fillStyle = GOALPOST_STROKE;
  ctx.lineWidth = GOALPOST_WIDTH;
  ctx.lineCap = "round";

  // Crossbar — the only structural piece visible from directly above
  ctx.beginPath();
  ctx.moveTo(x, centerY - halfCrossbar);
  ctx.lineTo(x, centerY + halfCrossbar);
  ctx.stroke();

  // Upright posts — small dots marking where each post meets the ground
  ctx.beginPath();
  ctx.arc(x, centerY - halfCrossbar, GOALPOST_POST_RADIUS, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.arc(x, centerY + halfCrossbar, GOALPOST_POST_RADIUS, 0, Math.PI * 2);
  ctx.fill();

  // Center hash — small perpendicular mark at the midpoint for alignment reference
  ctx.beginPath();
  ctx.moveTo(x - GOALPOST_CENTER_HASH_LENGTH / 2, centerY);
  ctx.lineTo(x + GOALPOST_CENTER_HASH_LENGTH / 2, centerY);
  ctx.stroke();

  ctx.restore();
}

function drawField(scoreboard?: Scoreboard) {
  // 1. Draw the Grass
  ctx.fillStyle = GRASS_FILL;
  ctx.fillRect(0, 0, TOTAL_W, TOTAL_H);

  // 2. Draw the Endzones
  ctx.fillStyle = ENDZONE_FILL;
  ctx.fillRect(0, 0, ENDZONE_W, TOTAL_H);
  ctx.fillRect(TOTAL_W - ENDZONE_W, 0, ENDZONE_W, TOTAL_H);

  // 3. Draw Sidelines and Endlines
  ctx.strokeStyle = SIDELINE_STROKE;
  ctx.lineWidth = SIDELINE_WIDTH;
  ctx.strokeRect(
    SIDELINE_INSET,
    SIDELINE_INSET,
    TOTAL_W - SIDELINE_INSET * 2,
    TOTAL_H - SIDELINE_INSET * 2,
  );

  // 4. Draw Goal Posts
  drawFieldGoalPosts(10);
  drawFieldGoalPosts(TOTAL_W - 10);

  // 5. Draw Yard Lines and Hashes
  const yardSpacing = yardsToPx(YARD_LINE_INTERVAL);
  ctx.strokeStyle = YARD_LINE_STROKE;
  ctx.lineWidth = YARD_LINE_WIDTH;

  for (let i = 0; i <= 10; i++) {
    const x = i * yardSpacing + ENDZONE_W;

    ctx.beginPath();
    ctx.moveTo(x, SIDELINE_INSET);
    ctx.lineTo(x, TOTAL_H - SIDELINE_INSET);
    ctx.stroke();

    if (i === 10) continue;

    // Hash marks between major yard lines
    ctx.strokeStyle = HASH_STROKE;
    ctx.globalAlpha = HASH_ALPHA;
    for (let j = 1; j < HASH_SUBDIVISIONS; j++) {
      const hashX = x - (yardSpacing / HASH_SUBDIVISIONS) * j;
      ctx.beginPath();
      ctx.moveTo(hashX, SIDELINE_INSET);
      ctx.lineTo(hashX, SIDELINE_INSET + HASH_LENGTH);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(hashX, TOTAL_H - SIDELINE_INSET - HASH_LENGTH);
      ctx.lineTo(hashX, TOTAL_H - SIDELINE_INSET);
      ctx.stroke();
    }
    ctx.globalAlpha = 1.0;
    ctx.strokeStyle = YARD_LINE_STROKE;

    // Yard numbers near top and bottom sidelines
    if (i > 0 && i < 10) {
      ctx.fillStyle = FIELD_NUMBER_FILL;
      ctx.font = FIELD_NUMBER_FONT;
      ctx.textAlign = "center";
      const yardNum = i <= 5 ? i * 10 : (10 - i) * 10;
      ctx.fillText(yardNum.toString(), x, 40);
      ctx.fillText(yardNum.toString(), x, H - 30);
    }
  }

  if (scoreboard?.LOS) {
    drawVerticalLine(scoreboard.LOS, LOS_STROKE);
  }

  if (scoreboard?.firstDownLine != null) {
    const color =
      scoreboard.down === "4th" ? FIRST_DOWN_4TH_STROKE : FIRST_DOWN_STROKE;
    drawVerticalLine(scoreboard.firstDownLine, color);
  }
}

export default drawField;

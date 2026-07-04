import { getConstants } from "../core/ratings";
import { Player } from "../core/types";
import { ctx } from "./canvas";

const LABEL_COLOR = "#FFFFFF";
const LABEL_FONT_SIZE = (playerRadius: number) => playerRadius * 0.8;
const LABEL_FONT = (fontSize: number) => `bold ${fontSize}px sans-serif`;
const LABEL_CHAR_LENGTH = 2;

function drawPlayer(player: Player) {
  const { radius } = getConstants("SIZE", player);

  // 2. Draw the Player (Original logic)
  ctx.beginPath();
  ctx.ellipse(player.loc.x, player.loc.y, radius, radius, 0, 0, Math.PI * 2);
  ctx.fillStyle = player.color;
  ctx.fill();

  ctx.strokeStyle = "#000000";
  ctx.lineWidth = 0.5; // 1 pixel thick
  ctx.stroke();

  if (player.label) {
    ctx.fillStyle = LABEL_COLOR;

    const fontSize = LABEL_FONT_SIZE(radius);
    ctx.font = LABEL_FONT(fontSize);

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    ctx.fillText(
      player.label.substring(0, LABEL_CHAR_LENGTH),
      player.loc.x,
      player.loc.y,
    );
  }
}

export default drawPlayer;

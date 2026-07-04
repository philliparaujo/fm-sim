import { getConstants } from "../core/ratings";
import { Player, Role } from "../core/types";
import { ctx } from "./canvas";

const LABEL_COLOR = "#FFFFFF";
const LABEL_FONT_SIZE = (playerRadius: number) => playerRadius * 0.8;
const LABEL_FONT = (fontSize: number) => `bold ${fontSize}px sans-serif`;
const LABEL_CHAR_LENGTH = 2;

const NAME_COLOR = "rgba(255, 255, 255, 0.85)";
const NAME_FONT = (playerRadius: number) =>
  `${playerRadius * 0.7}px sans-serif`;
const NAME_GAP = 3; // px between the circle bottom and the name

// Only these skill/defender roles get an on-field name label
const NAMED_ROLES: Role[] = ["runner", "catcher", "coverer", "rusher"];

/** "Josh Manning" -> "J. Manning" */
function abbreviateName(name: string): string {
  const spaceIdx = name.indexOf(" ");
  if (spaceIdx <= 0) return name;
  return `${name[0]}. ${name.slice(spaceIdx + 1)}`;
}

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

  if (player.name && NAMED_ROLES.includes(player.role)) {
    ctx.fillStyle = NAME_COLOR;
    ctx.font = NAME_FONT(radius);
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(
      abbreviateName(player.name),
      player.loc.x,
      player.loc.y + radius + NAME_GAP,
    );
  }
}

export default drawPlayer;

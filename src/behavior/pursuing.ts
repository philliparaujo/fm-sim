import { PURSUER_STEER_FACTOR } from "../core/constants";
import { getConstants } from "../core/ratings";
import { CachedPlayers, Player, State } from "../core/types";
import { H } from "../utils/units";
import { closestPointOnSegment, diff, dist, length } from "../utils/vector";

function pursueBallCarrier(
  player: Player,
  state: State,
  _cachedPlayers: CachedPlayers,
) {
  const { maxSpeed } = getConstants("SPEED", player);
  const { manStartDelay } = getConstants("MANCOVERAGE", player);
  const { zoneStartDelay } = getConstants("ZONECOVERAGE", player);
  const startDelay = player.coverage === "man" ? manStartDelay : zoneStartDelay;

  // Carry over the same reaction delay used in coverage
  player.reactionTimer++;
  if (player.reactionTimer < startDelay) return;

  // 1. Fetch both pursuit and bend attributes simultaneously
  const {
    predictionTicks: predictionTicks,
    pursuerHomingFactor,
    pursuerContainOffset,
    pursuitLateralFreq,
    pursuitLateralStrength,
  } = getConstants("PURSUIT", player);

  const toBall = dist(player.loc, state.ball.loc);
  const timeToReach = toBall / maxSpeed;

  // Project where the ball will be
  const totalLookAhead = timeToReach + predictionTicks;
  const predX = state.ball.loc.x + state.ball.vel.x * totalLookAhead;
  const predY = state.ball.loc.y + state.ball.vel.y * totalLookAhead;

  // Intercept that line
  const pathStart = state.ball.loc;
  const pathEnd = { x: predX, y: predY };
  const interceptPoint = closestPointOnSegment(player.loc, pathStart, pathEnd);

  // Also slightly move towards the ball
  let targetX =
    interceptPoint.x * (1 - pursuerHomingFactor) +
    state.ball.loc.x * pursuerHomingFactor;
  let targetY =
    interceptPoint.y * (1 - pursuerHomingFactor) +
    state.ball.loc.y * pursuerHomingFactor;

  // Contain ball carriers slightly wide
  const middleOfField = H / 2;
  const containDirection = state.ball.loc.y < middleOfField ? -1 : 1;
  targetY += containDirection * pursuerContainOffset;

  // Calculate base vector to the final targeted space
  const toTarget = diff({ x: targetX, y: targetY }, player.loc);
  const d = length(toTarget);

  if (d > 0.5) {
    // 2. Extract unit vectors toward target
    const dirX = toTarget.x / d;
    const dirY = toTarget.y / d;

    // 3. Form a perpendicular vector for lateral swaying
    const perpX = -dirY;
    const perpY = dirX;

    // 4. Calculate slow, smooth lateral wave offset driven purely by simulation steps
    const phaseOffset = state.players.indexOf(player) * 2.1;
    const lateral =
      Math.sin(state.steps * 0.166 * pursuitLateralFreq + phaseOffset) *
      pursuitLateralStrength;

    // 5. Apply the lateral drift to the final velocity calculation
    const targetVelX = (dirX + perpX * lateral) * maxSpeed;
    const targetVelY = (dirY + perpY * lateral) * maxSpeed;

    player.vel.x += (targetVelX - player.vel.x) * PURSUER_STEER_FACTOR;
    player.vel.y += (targetVelY - player.vel.y) * PURSUER_STEER_FACTOR;
  }
}

export { pursueBallCarrier };

import { RUSHER_STEER_FACTOR } from "../core/constants";
import { getConstants } from "../core/ratings";
import { CachedPlayers, Player, State } from "../core/types";
import { isRunPlay } from "../utils/field";
import { FIELD_SCALE, yardsToPx } from "../utils/units";
import { diff, dist, length } from "../utils/vector";

function rushTowardsBall(
  player: Player,
  state: State,
  _cachedPlayers: CachedPlayers,
) {
  const { lateralStrength, lateralFreq } = getConstants("BEND", player);
  const { maxSpeed } = getConstants("SPEED", player);
  let targetLoc = { ...state.ball.loc };

  // Determine if this is an edge rusher by label
  const isEdgeRusher = player.label === "LE" || player.label === "RE";

  // Gap containment on run plays (existing logic)
  if (isRunPlay(state) && state.ball.loc.x < state.scoreboard.LOS) {
    const playerIndex = state.players.indexOf(player);
    const isOuterRusher = playerIndex === 0 || playerIndex === 2;
    if (isOuterRusher) {
      targetLoc.x = state.scoreboard.LOS + 10 * FIELD_SCALE;
    }
  }

  // EDGE BEND: push the target point outside on pass rush so the rusher
  // arcs around the tackle rather than running straight into them.
  // The bend collapses toward the ball as the rusher passes the LOS.
  if (isEdgeRusher && !isRunPlay(state)) {
    const EDGE_CONTAIN_OFFSET = 120 * FIELD_SCALE;
    const scaledOffset = EDGE_CONTAIN_OFFSET * lateralStrength;
    const outsideDir = player.label === "LE" ? -1 : 1;

    // Collapse based on distance TO the ball rather than distance past LOS —
    // this ensures the arc fully resolves before the rusher arrives, not after
    const distToBall = dist(player.loc, state.ball.loc);
    const COLLAPSE_START = yardsToPx(12); // start collapsing at 12 yards from ball
    const COLLAPSE_END = yardsToPx(4); // fully collapsed at 4 yards from ball

    const collapseT =
      distToBall < COLLAPSE_START
        ? Math.min(
            1,
            (COLLAPSE_START - distToBall) / (COLLAPSE_START - COLLAPSE_END),
          )
        : 0;

    const activeOffset = scaledOffset * (1 - collapseT);
    targetLoc.y += outsideDir * activeOffset;
  }

  // Initialize random play seeds
  if (player.playRushSeed === undefined || player.playRushSeed === null) {
    player.playRushSeed = (Math.random() - 0.5) * 10.0;
    player.rushSpeedVariance = 0.93 + Math.random() * 0.14;
  }

  const playSeed = player.playRushSeed;
  const uniqueSpeed = maxSpeed * (player.rushSpeedVariance ?? 1.0);

  let toTarget = diff(targetLoc, player.loc);

  if (!isRunPlay(state)) {
    toTarget.x += Math.sin(state.steps * 0.05 + playSeed) * 8 * FIELD_SCALE;
    toTarget.y += Math.cos(state.steps * 0.05 + playSeed) * 8 * FIELD_SCALE;
  }

  const d = length(toTarget);
  if (d === 0) return;

  const dirX = toTarget.x / d;
  const dirY = toTarget.y / d;

  let lateral = 0;
  if (!isRunPlay(state)) {
    const phaseOffset = state.players.indexOf(player) * 2.1 + playSeed;
    lateral =
      Math.sin(state.steps * 0.166 * lateralFreq + phaseOffset) *
      lateralStrength;
  }

  const perpX = -dirY;
  const perpY = dirX;
  const speedModifier = player.contactedThisTick ? 0.25 : 1.0;
  const targetVelX = (dirX + perpX * lateral) * uniqueSpeed * speedModifier;
  const targetVelY = (dirY + perpY * lateral) * uniqueSpeed * speedModifier;
  player.vel.x += (targetVelX - player.vel.x) * RUSHER_STEER_FACTOR;
  player.vel.y += (targetVelY - player.vel.y) * RUSHER_STEER_FACTOR;
}

export { rushTowardsBall };

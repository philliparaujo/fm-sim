import { CachedPlayers, Player, State } from "../core/types";
import { getReceiverVelocityAtTick, MAX_PATH_LENGTH } from "../utils/behavior";

function runRoute(player: Player, state: State, _cachedPlayers: CachedPlayers) {
  if (!player.route) return;
  if (!state.ballGiven) {
    if (!player.path) player.path = [];
    player.path.push({ x: player.loc.x, y: player.loc.y });
    if (player.path.length > MAX_PATH_LENGTH) player.path.shift();
  }

  // Fetch the shared velocity physics
  const res = getReceiverVelocityAtTick(player, state, {
    absoluteTick: state.steps,
    currentLocX: player.loc.x,
    currentLocY: player.loc.y,
    routeSideMultiplier: player.routeSideMultiplier,
    breakTick: player.breakTick,
    improvAngleRad: player.improvAngleRad,
  });

  // Persist properties exactly when entering the break state
  if (
    res.isBreaking &&
    (player.breakTick === undefined || player.breakTick === null)
  ) {
    player.breakTick = state.steps;
    player.routeSideMultiplier = res.sideMultiplier;
  }

  player.vel.x = res.velX;
  player.vel.y = res.velY;
}

export { runRoute };

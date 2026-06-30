import { getConstants } from "../core/ratings";
import { CachedPlayers, Player, State } from "../core/types";
import { resolveCollision } from "../sim/collision";
import { isCarryingBall, isPassPlay, isRunPlay } from "../utils/field";
import { blockNearestDefender } from "./blocking";
import { cover } from "./covering";
import { avoidBallCarrier, navigatePocket, throwingDecision } from "./passing";
import { pursueBallCarrier } from "./pursuing";
import { runRoute } from "./receiving";
import { runTowardsBall, runTowardsEndzone } from "./running";
import { rushTowardsBall } from "./rushing";

function stepAsPlayer(
  player: Player,
  state: State,
  cachedPlayers: CachedPlayers,
) {
  const isBlocking = !isCarryingBall(player, state.ball) && state.ballGiven;
  const ballInAir = state.ballFlight && state.ballFlight.isInFlight;
  const ballIntendedForMe =
    state.ballFlight && state.ballFlight.receiver === player;
  const { steerDuration } = getConstants("VISION", player);

  switch (player.role) {
    case "blocker": {
      blockNearestDefender(player, state, cachedPlayers);
      break;
    }
    case "rusher": {
      rushTowardsBall(player, state, cachedPlayers);
      break;
    }
    case "runner": {
      const isEarlyInRun =
        state.steps - state.ballGivenAtStep < steerDuration && player.runAngle;

      if (isBlocking || isPassPlay(state)) {
        blockNearestDefender(player, state, cachedPlayers);
      } else if (!isCarryingBall(player, state.ball)) {
        runTowardsBall(player, state, cachedPlayers, state.ball.loc);
      } else if (isEarlyInRun) {
        runTowardsEndzone(player, state, cachedPlayers, player.runAngle);
      } else {
        runTowardsEndzone(player, state, cachedPlayers);
      }
      break;
    }
    case "catcher": {
      if (isCarryingBall(player, state.ball)) {
        runTowardsEndzone(player, state, cachedPlayers);
      } else if (isBlocking || isRunPlay(state)) {
        blockNearestDefender(player, state, cachedPlayers);
      } else if (ballInAir && ballIntendedForMe) {
        runTowardsBall(player, state, cachedPlayers, state.ballFlight!.endLoc);
      } else {
        runRoute(player, state, cachedPlayers);
      }

      break;
    }
    case "coverer": {
      if (ballInAir && state.ballFlight!.ticksElapsed > 20) {
        runTowardsBall(player, state, cachedPlayers, state.ballFlight!.endLoc);
      } else if (!state.ballGiven && !ballInAir) {
        cover(player, state, cachedPlayers);
      } else {
        pursueBallCarrier(player, state, cachedPlayers);
      }
      break;
    }
    case "passer": {
      if (!state.ballGiven) {
        navigatePocket(player, state, cachedPlayers);
        throwingDecision(player, state, cachedPlayers);
      } else {
        avoidBallCarrier(player, state, cachedPlayers); // After handing off to a runner
      }
      break;
    }
  }

  if (state.ballGiven || player.role === "passer") {
    resolveCollision(player, state.ball);
  }
}

export { stepAsPlayer };

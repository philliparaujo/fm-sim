import { State } from "./core/types";
import drawBall, { drawThrowTarget } from "./render/ball";
import { ctx } from "./render/canvas";
import drawField from "./render/field";
import drawPlayer from "./render/player";
import {
  drawCatcherTrace,
  drawContextSteeringRays,
  drawCovererZone,
  drawPasserPocket,
  drawReceiverPredictedRoute,
  drawRunnerPath,
} from "./render/trace";
import { isCarryingBall, isPassPlay } from "./utils/field";
import { getPocket, TOTAL_W } from "./utils/units";

/* Determines whether to render anything at all */
const ONLY_SIMULATE = false;

/* Trace rendering constants */
const CATCHER_TRACE_ON = false;
const COVERER_ZONE_ON = false;
const RUNNER_PATH_ON = false;
const PASSER_POCKET_ON = false;
const RUNNER_LOOK_AHEAD_ON = false;
const BALL_IN_AIR_PREDICTED_ROUTE_ON = true;
const BALL_IN_AIR_TARGET_ON = true;
const ALL_PREDICTED_ROUTE_ON = BALL_IN_AIR_PREDICTED_ROUTE_ON && false;
const ALL_PREDICTED_TARGET_ON = BALL_IN_AIR_TARGET_ON && false;

const scoreboard = document.getElementById("scoreboard") as HTMLDivElement;
scoreboard.style.width = `${TOTAL_W}px`;
scoreboard.style.visibility = "visible";

/** Renders the current frame's full play and scoreboard */
function render(state: State) {
  const pocket = getPocket(state.scoreboard.LOS);
  const scoreboard = state.scoreboard;

  if (ONLY_SIMULATE) return;

  const passer = state.players.find((p) => p.role === "passer");
  const catchers = state.players.filter((p) => p.role === "catcher" && p.route);

  // 1) Draw the field behind everything
  drawField(scoreboard);

  // 2) Draw any traces underneath players
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
    if (PASSER_POCKET_ON) {
      drawPasserPocket(player, pocket);
    }
  }

  if (passer && isPassPlay(state)) {
    for (const catcher of catchers) {
      if (ALL_PREDICTED_ROUTE_ON) {
        drawReceiverPredictedRoute(catcher, state);
      }
      if (ALL_PREDICTED_TARGET_ON && catcher.predictedTargets != null) {
        for (const target of catcher.predictedTargets) {
          drawThrowTarget(target);
        }
      }
    }
  }

  for (const player of state.players) {
    if (isCarryingBall(player, state.ball) && RUNNER_LOOK_AHEAD_ON) {
      drawContextSteeringRays(player, ctx);
    }

    // 3) Draw all players
    drawPlayer(player);
  }

  // 4) Draw the ball or target of ball in the air
  if (state.ballFlight && state.ballFlight.isInFlight) {
    const receiver = state.ballFlight.receiver;
    if (BALL_IN_AIR_TARGET_ON) {
      drawThrowTarget(state.ballFlight.endLoc);
    }
    if (BALL_IN_AIR_PREDICTED_ROUTE_ON && receiver) {
      drawReceiverPredictedRoute(receiver, state);
    }
  } else {
    drawBall(state.ball);
  }
}

export { render };

import { State } from "../core/types";
import drawBall, { drawThrowTarget } from "./ball";
import { ctx } from "./canvas";
import drawField from "./field";
import drawPlayer from "./player";
import {
  drawCatcherTrace,
  drawContextSteeringRays,
  drawCovererZone,
  drawPasserPocket,
  drawReceiverPredictedRoute,
  drawRunnerPath,
} from "./trace";
import { isCarryingBall, isPassPlay } from "../utils/field";
import { getPocket, TOTAL_W } from "../utils/units";

/* Determines whether to render anything at all */
const ONLY_SIMULATE = false;

/* Trace rendering constants */
const CATCHER_TRACE_ON = false;
const COVERER_ZONE_ON = true;
const RUNNER_PATH_ON = false;
const PASSER_POCKET_ON = false;
const RUNNER_LOOK_AHEAD_ON = false;
const BALL_IN_AIR_PREDICTED_ROUTE_ON = false;
const BALL_IN_AIR_TARGET_ON = true;
/** Extra ball radius at mid-flight (fraction) to suggest the pass's loft. */
const BALL_AIR_LOFT = 0.6;
const ALL_PREDICTED_ROUTE_ON = BALL_IN_AIR_PREDICTED_ROUTE_ON && false;
const ALL_PREDICTED_TARGET_ON = BALL_IN_AIR_TARGET_ON && false;

if (typeof document !== "undefined") {
  const scoreboard = document.getElementById("scoreboard") as HTMLDivElement;
  if (scoreboard) {
    scoreboard.style.width = `${TOTAL_W}px`;
    scoreboard.style.visibility = "visible";
  }
}

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

  // 4) Draw the ball. While a pass is airborne, draw it traveling from the
  //    throw point toward its target reticle (interpolated by flight progress)
  //    with a slight mid-flight swell to read as loft — instead of leaving it
  //    frozen in the passer's hands. Otherwise draw it at its resting spot.
  const flight = state.ballFlight;
  if (flight && flight.isInFlight) {
    if (BALL_IN_AIR_TARGET_ON) {
      drawThrowTarget(flight.endLoc);
    }
    if (BALL_IN_AIR_PREDICTED_ROUTE_ON && flight.receiver) {
      drawReceiverPredictedRoute(flight.receiver, state);
    }
    const t =
      flight.totalTicks > 0
        ? Math.min(1, Math.max(0, flight.ticksElapsed / flight.totalTicks))
        : 1;
    const loft = 1 + BALL_AIR_LOFT * Math.sin(Math.PI * t);
    drawBall({
      ...state.ball,
      radius: state.ball.radius * loft,
      loc: {
        x: flight.startLoc.x + (flight.endLoc.x - flight.startLoc.x) * t,
        y: flight.startLoc.y + (flight.endLoc.y - flight.startLoc.y) * t,
      },
    });
  } else {
    drawBall(state.ball);
  }
}

export { render };

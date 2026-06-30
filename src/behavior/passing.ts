import {
  MAX_PREDICTION_TICKS,
  PANIC_RUSHER_DIST,
  PANIC_THROW_CHANCE,
  PASSER_HANDOFF_SEPARATION,
  THROW_EVAL_INTERVAL,
} from "../core/constants";
import { getConstants } from "../core/ratings";
import { CachedPlayers, Player, State, Vector } from "../core/types";
import { resetSimulation } from "../sim";
import { predictReceiverRoute } from "../utils/behavior";
import {
  clampPosInBounds,
  isCarryingBall,
  snapBallToPlayer,
} from "../utils/field";
import { lerp } from "../utils/math";
import {
  getPocket,
  H,
  metersToPx,
  perSecondToPerTick,
  TOTAL_H,
} from "../utils/units";
import { diff, dist, length, predictFutureLocation } from "../utils/vector";

function navigatePocket(
  player: Player,
  state: State,
  cachedPlayers: CachedPlayers,
) {
  const { maxSpeed } = getConstants("SPEED", player);
  const { passerLookAhead, passerAvoidStrength, passerSteerFactor } =
    getConstants("POCKETPRESENCE", player);

  const pocket = getPocket(state.scoreboard.LOS);
  const dx = (player.loc.x - pocket.cx) / pocket.rx;
  const dy = (player.loc.y - pocket.cy) / pocket.ry;
  const ellipseDist = length({ x: dx, y: dy });

  // Calculate the direction to travel in to stay within the pocket and avoid defenders
  let targetDir = { x: 0, y: 0 };

  if (ellipseDist > 1.0) {
    // Pull back if drift from the ellipse boundary
    const pullStrength = (ellipseDist - 1.0) * 0.5;
    targetDir.x = -dx * pullStrength;
    targetDir.y = -dy * pullStrength;
  } else {
    // Inside pocket, drift gently toward center
    targetDir.x = -dx * 0.05;
    targetDir.y = -dy * 0.05;
  }

  const rushers = cachedPlayers.rushers;
  rushers.forEach((rusher) => {
    const toRusher = diff(player.loc, rusher.loc);
    const d = length(toRusher);

    if (d < passerLookAhead) {
      const weight = Math.pow((passerLookAhead - d) / passerLookAhead, 2);
      targetDir.x += (toRusher.x / d) * weight * passerAvoidStrength;
      targetDir.y += (toRusher.y / d) * weight * passerAvoidStrength;
    }
  });

  // Anti-jitter
  const mag = length(targetDir);
  player.vel.x *= 0.92;
  player.vel.y *= 0.92;
  if (mag > 0.05) {
    const targetVelX = (targetDir.x / mag) * maxSpeed;
    const targetVelY = (targetDir.y / mag) * maxSpeed;

    const velDiff =
      Math.abs(targetVelX - player.vel.x) + Math.abs(targetVelY - player.vel.y);
    const smoothSteer =
      velDiff < 0.4 ? passerSteerFactor * 0.15 : passerSteerFactor;

    player.vel.x += (targetVelX - player.vel.x) * smoothSteer;
    player.vel.y += (targetVelY - player.vel.y) * smoothSteer;
  }

  // Ball sync
  if (isCarryingBall(player, state.ball)) {
    state.ball.vel.x = player.vel.x;
    state.ball.vel.y = player.vel.y;
  }
}

function throwingDecision(
  player: Player,
  state: State,
  cachedPlayers: CachedPlayers,
) {
  const rushers = cachedPlayers.rushers;
  const catchers = cachedPlayers.catchers;
  const { minThrowStep, minOpennessNeeded, panicOpennessNeeded } = getConstants(
    "DECISIONMAKING",
    player,
  );
  const nearestRusherDist =
    rushers.length > 0
      ? Math.min(...rushers.map((r) => dist(player.loc, r.loc)))
      : Infinity;
  const underPressure = nearestRusherDist < PANIC_RUSHER_DIST;

  resolveBallInAir(state, cachedPlayers);

  const thinkInterval = underPressure ? 3 : THROW_EVAL_INTERVAL;
  if (!player.cachedThrowEval || state.steps % thinkInterval === 0) {
    const evaluatedOptions = catchers.map((catcher: Player) => {
      const throwWindowRes = evaluateThrowWindow(
        player,
        catcher,
        state,
        cachedPlayers,
      );
      if (throwWindowRes === null) return null;

      const {
        target,
        ticksUntil: ticksUntil,
        defenderDistAtArrival,
      } = throwWindowRes;
      return {
        catcher,
        target,
        ticksUntil: ticksUntil,
        projectedOpenness: defenderDistAtArrival,
        throwDist: dist(player.loc, target),
      };
    });

    player.cachedThrowEval = evaluatedOptions
      .filter((a) => a !== null)
      .sort((a, b) => b.projectedOpenness - a.projectedOpenness)[0];
  }

  const bestOption = player.cachedThrowEval;
  if (!bestOption) return;
  if (state.steps <= minThrowStep || state.ballFlight !== null) return;
  bestOption.throwDist = dist(player.loc, bestOption.target);

  let shouldThrow = false;
  let throwAway = false;
  let opennessThreshold = minOpennessNeeded;

  if (underPressure) {
    const pressureIntensity = 1 - nearestRusherDist / PANIC_RUSHER_DIST;

    opennessThreshold = lerp(
      pressureIntensity,
      minOpennessNeeded,
      panicOpennessNeeded,
    );

    const forceThrowChance = PANIC_THROW_CHANCE * pressureIntensity * 0.4;

    // How long the QB has been holding the ball this play, in ticks since the snap
    const holdingTicks = state.steps;
    // Ramp 0→1 over a few seconds of holding under pressure — the longer he's
    // been in the pocket with a rusher closing, the more desperate he gets
    const HOLD_RAMP_TICKS = 150; // ~1.5s at 60fps to reach max desperation
    const holdFactor = Math.min(1, holdingTicks / HOLD_RAMP_TICKS);

    // Throw-away chance grows with both pressure intensity and how long he's held it
    const throwAwayChance = lerp(holdFactor, 0.05, 0.35) * pressureIntensity;

    if (Math.random() < forceThrowChance) {
      if (bestOption.projectedOpenness > opennessThreshold) {
        shouldThrow = true;
      } else {
        throwAway = true;
      }
    } else if (Math.random() < throwAwayChance) {
      // Separate, growing-over-time roll — bail even without the main panic
      // trigger firing, representing a QB who's simply held it too long
      throwAway = true;
    }
  }

  if (
    !shouldThrow &&
    !throwAway &&
    bestOption.projectedOpenness > opennessThreshold
  ) {
    shouldThrow = true;
  }

  if (throwAway) {
    const throwAwaySide = player.loc.y < H / 2 ? -1 : 1;
    const throwAwayTarget = {
      x: player.loc.x + 60,
      y: throwAwaySide < 0 ? -40 : TOTAL_H + 40,
    };
    const { ballMetersPerSecond } = getConstants("THROWPOWER", player);
    const ballPixelsPerTick = metersToPx(
      perSecondToPerTick(ballMetersPerSecond),
    );
    const flightTicks = Math.ceil(
      dist(player.loc, throwAwayTarget) / ballPixelsPerTick,
    );

    state.ballFlight = {
      startLoc: { ...state.ball.loc },
      endLoc: throwAwayTarget,
      isInFlight: true,
      ticksElapsed: 0,
      totalTicks: flightTicks,
      receiver: null,
    };

    state.playAdvanced.throwTick = state.steps;
    state.playAdvanced.airYards = throwAwayTarget.x - state.scoreboard.LOS;
    state.playAdvanced.wasUnderPressure = underPressure;
    state.playAdvanced.wasThrowAway = true;
    return;
  }

  state.playAdvanced.wasThrowAway = false;
  if (!shouldThrow) return;

  const { shortError } = getConstants("SHORTACCURACY", player);
  const { deepError } = getConstants("DEEPACCURACY", player);
  const { pressureSensitivity } = getConstants("POCKETPRESENCE", player);

  const rawPressure = underPressure
    ? 1 - nearestRusherDist / PANIC_RUSHER_DIST
    : 0;
  const pressureFactor = rawPressure * pressureSensitivity;

  const maxDistanceScale = 400;
  const distanceWeight = Math.min(1, bestOption.throwDist / maxDistanceScale);
  const baseErrorRate = lerp(distanceWeight, shortError, deepError);

  const totalErrorMagnitude =
    bestOption.throwDist * baseErrorRate * (1 + pressureFactor);

  const throwDriftAngle = Math.random() * Math.PI * 2;

  const physicalBallDestination = {
    x:
      bestOption.target.x +
      Math.cos(throwDriftAngle) * totalErrorMagnitude * 0.2,
    y:
      bestOption.target.y +
      Math.sin(throwDriftAngle) * totalErrorMagnitude * 0.2,
  };

  state.ballFlight = {
    startLoc: { ...state.ball.loc },
    endLoc: physicalBallDestination,
    isInFlight: true,
    ticksElapsed: 0,
    totalTicks: bestOption.ticksUntil,
    receiver: bestOption.catcher,
  };

  state.playAdvanced.throwTick = state.steps;
  state.playAdvanced.airYards =
    physicalBallDestination.x - state.scoreboard.LOS;
  state.playAdvanced.wasUnderPressure = underPressure;
}

function avoidBallCarrier(
  player: Player,
  state: State,
  _cachedPlayers: CachedPlayers,
) {
  const { maxSpeed } = getConstants("SPEED", player);
  const ballSpeed = Math.sqrt(state.ball.vel.x ** 2 + state.ball.vel.y ** 2);
  const runAngleY = state.currentPlay.runAngle?.y;

  if (
    ballSpeed > 0.1 &&
    runAngleY &&
    dist(player.loc, state.ball.loc) < PASSER_HANDOFF_SEPARATION
  ) {
    // Move out of the way
    const direction = runAngleY > 0 ? -1 : 1;
    player.vel.x = -1;
    player.vel.y = direction * maxSpeed;
  } else {
    // Stop moving if out of the way
    player.vel.x = 0;
    player.vel.y = 0;
  }
}

function evaluateThrowWindow(
  passer: Player,
  catcher: Player,
  state: State,
  cachedPlayers: CachedPlayers,
): {
  target: Vector;
  ticksUntil: number;
  defenderDistAtArrival: number;
} | null {
  const throwTargetRes = calculatePerfectThrowTarget(passer, catcher, state);
  if (throwTargetRes === null) return null;

  const { ticksUntilLand: ticksUntilLand, target } = throwTargetRes;

  // Project every relevant defender forward by flightTicks using simple linear extrapolation
  const defenders = [...cachedPlayers.rushers, ...cachedPlayers.coverers];
  const defenderDistAtArrival =
    defenders.length > 0
      ? Math.min(
          ...defenders.map((cov) => {
            const projected = predictFutureLocation(
              cov.loc,
              cov.vel,
              ticksUntilLand,
            );
            return dist(projected, target);
          }),
        )
      : Infinity;

  return { target, ticksUntil: ticksUntilLand, defenderDistAtArrival };
}

function resolveBallInAir(state: State, cachedPlayers: CachedPlayers) {
  const { ballFlight } = state;
  if (!ballFlight || !ballFlight.isInFlight) return;

  ballFlight.ticksElapsed++;

  if (ballFlight.ticksElapsed >= ballFlight.totalTicks) {
    const { receiver, endLoc } = ballFlight;
    const coverers = cachedPlayers.coverers;

    // Track state outcomes explicitly
    let isComplete = false;
    let isInterception = false;
    let isIncomplete = false;

    // For throw aways
    if (!receiver) {
      resetSimulation("incomplete");
      return;
    }

    const { completionRadius: receiverRadius, catchInTraffic } = getConstants(
      "CATCHRADIUS",
      receiver,
    );
    const receiverDist = dist(receiver.loc, endLoc);

    let closestDefender: Player | null = null;
    let minDefenderDist = Infinity;
    let defenderRadius = 0;

    coverers.forEach((c) => {
      const d = dist(c.loc, endLoc);
      if (d < minDefenderDist) {
        minDefenderDist = d;
        closestDefender = c;
        defenderRadius = getConstants("CATCHRADIUS", c).completionRadius;
      }
    });

    // 1. Determine who is in range of the ball
    const receiverInRadius = receiverDist <= receiverRadius;
    const defenderInRadius = closestDefender
      ? minDefenderDist <= defenderRadius
      : false;

    if (!receiverInRadius && defenderInRadius) {
      // Uncontested interception attempt
      const INTERCEPT_CHANCE = 0.35;
      if (Math.random() < INTERCEPT_CHANCE) {
        isInterception = true;
      } else {
        isIncomplete = true;
      }

      if (receiverDist > receiverRadius) {
        state.playAdvanced.wasOffTarget = true;
      }
    } else if (!receiverInRadius && !defenderInRadius) {
      // Pass is uncatchable
      isIncomplete = true;
      if (receiverDist > receiverRadius) {
        state.playAdvanced.wasOffTarget = true;
      }
    } else if (!defenderInRadius) {
      // Receiver is in range, defender is nowhere near it -> Uncontested Catch
      isComplete = true;
    } else {
      // ==========================================
      // CONTESTED CATCH RESOLUTION
      // ==========================================

      // Does the defender have clear position advantage?
      // (e.g. They are standing right over the ball while the receiver is reaching in)
      const defenderHasPosition =
        minDefenderDist - defenderRadius < receiverDist - receiverRadius;

      if (defenderHasPosition) {
        // Defender won the spot. But is it an INT or just a PBU?
        // In the NFL, defenders drop or break up far more passes than they intercept.
        // We add a probability roll to simulate this.
        const INTERCEPT_CHANCE_ON_CONTEST = 0.1; // Tune this: 20% of "lost" contests become INTs

        if (Math.random() < INTERCEPT_CHANCE_ON_CONTEST) {
          isInterception = true;
        } else {
          isIncomplete = true; // Pass Broken Up!
        }
      } else {
        // Receiver has equal or better position than the defender (e.g. receiver's body is between defender and ball)
        // Catch chance decreases the closer the defender is.
        const catchChance = catchInTraffic;
        if (Math.random() < catchChance) {
          isComplete = true;
        } else {
          isIncomplete = true; // Contested incompletion
        }
      }
    }

    // --- FINAL EVALUATION & METRIC TRACKING ---
    state.playAdvanced.wasOffTarget = false;
    if (isComplete) {
      completePass(state, receiver, cachedPlayers);
    } else if (isInterception) {
      if (receiverDist > receiverRadius) {
        state.playAdvanced.wasOffTarget = true;
      }
      resetSimulation("interception");
    } else if (isIncomplete) {
      // If the simulation is ending in an incompletion, check if the distance
      // between the landing spot and the receiver was uncatchable.
      if (receiverDist > receiverRadius) {
        state.playAdvanced.wasOffTarget = true;
      }
      resetSimulation("incomplete");
    }
  }
}

function calculatePerfectThrowTarget(
  passer: Player,
  receiver: Player,
  state: State,
): {
  ticksUntilLand: number;
  ticksUntilBreak: number;
  target: Vector;
} | null {
  const { ballMetersPerSecond } = getConstants("THROWPOWER", passer);
  const ballPixelsPerTick = metersToPx(perSecondToPerTick(ballMetersPerSecond));

  const { timeline: receiverTimeline, ticksUntilBreak: ticksUntilBreak } =
    predictReceiverRoute(receiver, state);

  // Fetch the receiver's catch radius so we know what "catchable" means
  const { completionRadius } = getConstants("CATCHRADIUS", receiver);

  // 1. COLLECT ALL CATCHABLE TARGETS
  const catchableTargets: {
    tick: number;
    target: Vector;
  }[] = [];

  for (let tick = 1; tick <= MAX_PREDICTION_TICKS; tick++) {
    const projectedSpot = receiverTimeline[tick - 1];
    if (!projectedSpot) break;

    // Clip target to field boundaries
    const clampedSpot: Vector = clampPosInBounds(projectedSpot);

    // Calculate how many ticks it takes the ball to reach this specific clamped spot
    const travelDistance = dist(passer.loc, clampedSpot);
    const ballTravelTicks = travelDistance / ballPixelsPerTick;
    const arrivalTick = Math.round(ballTravelTicks);

    // Ensure the ball's arrival time falls within our prediction timeline
    if (arrivalTick >= 1 && arrivalTick <= MAX_PREDICTION_TICKS) {
      // Look up where the receiver will ACTUALLY be at the exact tick the ball lands
      const actualReceiverSpotAtArrival = receiverTimeline[arrivalTick - 1];

      if (actualReceiverSpotAtArrival) {
        // The pass is only completable if the landing spot is within the
        // receiver's catch radius at the exact moment of ball arrival.
        const separation = dist(clampedSpot, actualReceiverSpotAtArrival);

        if (separation <= completionRadius) {
          catchableTargets.push({
            tick: arrivalTick, // The timeline index where this throw was targeted
            target: clampedSpot,
          });
        }
      }
    }
  }

  // 2. RETURN THE MIDDLE TICK TARGET
  if (catchableTargets.length > 10) {
    const index = Math.round(catchableTargets.length / 2);
    const middleTarget = catchableTargets[index];
    receiver.predictedTargets = catchableTargets.map((target) => target.target);

    return {
      ticksUntilLand: middleTarget.tick - 5,
      target: middleTarget.target,
      ticksUntilBreak: ticksUntilBreak,
    };
  }

  // 3. FALLBACK: If no catchable window was found, don't throw
  receiver.predictedTargets = null;
  return null;
}

// Helper to clean up state on a successful catch
function completePass(
  state: State,
  receiver: Player,
  cachedPlayers: CachedPlayers,
) {
  state.ballFlight!.isInFlight = false;
  snapBallToPlayer(receiver, state.ball);
  state.ballGiven = true;
  state.ballGivenAtStep = state.steps;
  state.playAdvanced.catchX = state.ball.loc.x;

  // Find all active defenders on the field
  const defenders = [...cachedPlayers.coverers, ...cachedPlayers.rushers];

  // Calculate the distance to the closest defender at the time of the catch
  if (defenders.length > 0) {
    const receiverRadius = getConstants("SIZE", receiver).radius;
    const minSeparation = Math.min(
      ...defenders.map((def) => {
        const centerDistance = dist(def.loc, receiver.loc);
        const defenderRadius = getConstants("SIZE", def).radius;

        // Subtract both radiuses to find the real space between their bodies.
        // Math.max(0, ...) ensures it doesn't drop below 0 if they are colliding.
        return Math.max(0, centerDistance - defenderRadius - receiverRadius);
      }),
    );
    state.playAdvanced.separationAtCatch = minSeparation;
  } else {
    state.playAdvanced.separationAtCatch = Infinity; // No defenders present
  }
}

export { avoidBallCarrier, navigatePocket, throwingDecision };

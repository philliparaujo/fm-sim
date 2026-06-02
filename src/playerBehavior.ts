import { getConstants } from "./ratings";
import { H } from "./render";
import {
  ANGLE_ENDZONE_INTENT,
  ARRIVAL_RADIUS,
  BALL_GIVEN_STEPS,
  BROKEN_TACKLE_BURST_DURATION,
  BROKEN_TACKLE_SPEED_BURST,
  CATCHER_AVOID_STRENGTH,
  LEAD_FRAMES,
  MIN_BLOCK_DISTANCE,
  PASSER_HANDOFF_SEPARATION,
  PIXELS_PER_STEP,
  PURSUER_STEER_FACTOR,
  resetSimulation,
  resolveCollision,
  ROUTE_BREAK_ANGLE_JITTER,
  RUSHER_STEER_FACTOR,
  SHORT_THROW_THRESHOLD_PX,
  SIM_SPEED,
  TACKLE_PRESSURE_PER_FRAME,
} from "./simulate";
import { Player, State, Vector } from "./types";
import {
  closestPointOnSegment,
  diff,
  dist,
  getPocket,
  isCarryingBall,
  isNoBreakRoute,
  length,
  lerp,
} from "./util";

function stepAsPlayer(player: Player, state: State) {
  const isBlocking = !isCarryingBall(player, state.ball) && state.ballGiven;

  switch (player.role) {
    case "blocker": {
      blockNearestDefender(player);
      break;
    }
    case "rusher": {
      rushTowardsBall(player);
      break;
    }
    case "runner": {
      const { avoidStrength, steerAvoidStrength, steerDuration } = getConstants(
        "vision",
        player,
      );
      const isEarlyInRun =
        state.steps - state.ballGivenAtStep < steerDuration && player.runAngle;

      if (isBlocking) {
        blockNearestDefender(player);
      } else if (!isCarryingBall(player, state.ball)) {
        runTowardsBall(player);
      } else if (isEarlyInRun) {
        runTowardsEndzone(player, steerAvoidStrength, player.runAngle);
      } else {
        runTowardsEndzone(player, avoidStrength);
      }
      break;
    }
    case "catcher": {
      if (isBlocking) {
        blockNearestDefender(player);
      } else if (!isCarryingBall(player, state.ball)) {
        runRoute(player);
      } else {
        runTowardsEndzone(player, CATCHER_AVOID_STRENGTH);
      }
      break;
    }
    case "coverer": {
      if (!state.ballGiven) {
        cover(player);
      } else {
        pursueBallCarrier(player);
      }
      break;
    }
    case "passer": {
      if (!state.ballGiven) {
        navigatePocket(player);
        throwingDecision(player);
      } else {
        avoidBallCarrier(player); // After handing off to a runner
      }
      break;
    }
  }

  resolveCollision(player, state.ball);

  /* Specific actions a player can perform */
  function blockNearestDefender(player: Player) {
    // Rank all defenders by good it is to block them, get the best one
    const defenders = state.players.filter(
      (p) => p.role === "rusher" || p.role === "coverer",
    );

    const potentialBlocks = defenders.map((defender) => {
      let interceptPoint = closestPointOnSegment(
        player.loc,
        defender.loc,
        state.ball.loc,
      );

      if (dist(interceptPoint, state.ball.loc) < MIN_BLOCK_DISTANCE) {
        const toDefender = diff(defender.loc, state.ball.loc);
        const d = length(toDefender);
        interceptPoint = {
          x: state.ball.loc.x + (toDefender.x / d) * MIN_BLOCK_DISTANCE,
          y: state.ball.loc.y + (toDefender.y / d) * MIN_BLOCK_DISTANCE,
        };
      }

      const distToIntercept = dist(player.loc, interceptPoint);
      const threatIndex =
        dist(defender.loc, state.ball.loc) * 0.2 + distToIntercept;

      return {
        interceptPoint,
        threatIndex,
        distToIntercept,
      };
    });

    potentialBlocks.sort((a, b) => a.threatIndex - b.threatIndex);
    const bestBlock = potentialBlocks[0];

    // Move to block their path with the ball
    if (bestBlock) {
      const { interceptPoint, distToIntercept } = bestBlock;
      if (distToIntercept < 2) {
        // Dead zone to prevent jittering when in position
        player.vel.x = 0;
        player.vel.y = 0;
      } else {
        const angle = Math.atan2(
          interceptPoint.y - player.loc.y,
          interceptPoint.x - player.loc.x,
        );
        player.vel.x = Math.cos(angle) * player.maxSpeed;
        player.vel.y = Math.sin(angle) * player.maxSpeed;
      }
    }
  }

  function runTowardsBall(player: Player) {
    const toBall = diff(state.ball.loc, player.loc);
    const d = length(toBall);
    player.vel.x = (toBall.x / d) * player.maxSpeed;
    player.vel.y = (toBall.y / d) * player.maxSpeed;
  }

  function runTowardsEndzone(
    player: Player,
    avoidStrength: number,
    targetDir: Vector = { x: 1.0, y: 0 },
  ) {
    const { lookAhead } = getConstants("vision", player);
    const { runnerSteerFactor } = getConstants("changeOfDirection", player);
    const { catchSlowdownDuration, minCatchSpeedMultiplier } = getConstants(
      "catchAcceleration",
      player,
    );

    // Calculate the direction to travel to avoid other defenders
    const defenders = state.players.filter(
      (p) => p.role === "rusher" || p.role === "coverer",
    );
    defenders.forEach((defender) => {
      const toPlayer = diff(player.loc, defender.loc);
      const d = length(toPlayer);

      if (d < lookAhead) {
        const weight = (lookAhead - d) / lookAhead;
        const pushX = (toPlayer.x / d) * weight * avoidStrength;
        const pushY = (toPlayer.y / d) * weight * avoidStrength;

        targetDir.x += pushX < 0 ? pushX * 0.3 : pushX;
        targetDir.y += pushY;
      }
    });
    targetDir.x = Math.max(ANGLE_ENDZONE_INTENT, targetDir.x);

    // If this player recently caught a ball, slow them down
    const framesSinceCatch = state.steps - state.ballGivenAtStep;
    let currentMaxSpeed = player.maxSpeed;
    if (
      framesSinceCatch < catchSlowdownDuration &&
      isCarryingBall(player, state.ball)
    ) {
      const progress = framesSinceCatch / catchSlowdownDuration;
      const multiplier = lerp(progress, minCatchSpeedMultiplier, 1);
      currentMaxSpeed *= multiplier;
    }

    // If this player recently broke a tackle, change their velocity
    if (player.burstFrames && player.burstFrames > 0) {
      currentMaxSpeed *= BROKEN_TACKLE_SPEED_BURST;
      player.burstFrames--;
    }

    // Apply this direction to the runner's velocity
    const d = length(targetDir);
    const targetVelX = (targetDir.x / d) * currentMaxSpeed;
    const targetVelY = (targetDir.y / d) * currentMaxSpeed;
    player.vel.x += (targetVelX - player.vel.x) * runnerSteerFactor;
    player.vel.y += (targetVelY - player.vel.y) * runnerSteerFactor;
    state.ball.vel.x = player.vel.x;
    state.ball.vel.y = player.vel.y;
  }

  function runRoute(player: Player) {
    const {
      stopAfterBreakThreshold,
      routeCutSpeedRetained,
      reaccelerationDuration,
    } = getConstants("routeRunning", player);

    // Ensure the player has a route, and save its path for rendering
    if (!player.route) return;
    if (!state.ballGiven) {
      player.path.push({ x: player.loc.x, y: player.loc.y });
    }

    const { angleOffset, stemDrift } = getCatcherRouteVariance(player);
    const routeBreakThreshold = Math.floor(
      (player.route.steps * PIXELS_PER_STEP) / player.maxSpeed,
    );

    if (state.steps < routeBreakThreshold) {
      // 1) Route stem
      player.vel.x = player.maxSpeed;
      player.vel.y = stemDrift;
    } else {
      // 2) Route break
      // Apply new direction, speed penalty from break
      if (state.steps === Math.max(1, routeBreakThreshold)) {
        const newAngleRad =
          (player.route.breakAngle + angleOffset) *
          (player.loc.y < H / 2 ? 1 : -1) *
          (Math.PI / 180);
        const newSpeed =
          player.maxSpeed *
          (isNoBreakRoute(player.route) ? 1.0 : routeCutSpeedRetained);
        player.vel.x = Math.cos(newAngleRad) * newSpeed;
        player.vel.y = Math.sin(newAngleRad) * newSpeed;

        player.breakFrame = state.steps;
      }

      // Accelerate following speed penalty
      if (player.breakFrame !== undefined) {
        const framesSinceBreak = player.breakFrame
          ? state.steps - player.breakFrame
          : 0;
        if (
          framesSinceBreak > 0 &&
          framesSinceBreak <= reaccelerationDuration
        ) {
          const progress = framesSinceBreak / reaccelerationDuration;
          const d = length(player.vel);
          if (d > 0) {
            const scale =
              (player.maxSpeed * lerp(progress, routeCutSpeedRetained, 1)) / d;
            player.vel.x *= scale;
            player.vel.y *= scale;
          }
        }
      }

      // Decelerates player if their route requires them to after the break
      if (
        player.route.stopAfterBreak &&
        state.steps > routeBreakThreshold + stopAfterBreakThreshold
      ) {
        player.vel.x *= 0.9;
        player.vel.y *= 0.9;
      }
    }
  }

  function navigatePocket(player: Player) {
    const { passerLookAhead, passerAvoidStrength, passerSteerFactor } =
      getConstants("pocketPresence", player);

    const pocket = getPocket(state.scoreboard.LOS);
    const dx = (player.loc.x - pocket.cx) / pocket.rx;
    const dy = (player.loc.y - pocket.cy) / pocket.ry;
    const distSq = dx * dx + dy * dy;

    // Calculate the direction to travel in to stay within the pocket and avoid defenders
    let targetDir = { x: 0, y: 0 };

    if (distSq > 1.0) {
      // Pull back if drift from the ellipse boundary
      const pullStrength = (distSq - 1.0) * 0.5;
      targetDir.x = -dx * pullStrength;
      targetDir.y = -dy * pullStrength;
    } else {
      // Inside pocket, drift gently toward center
      targetDir.x = -dx * 0.05;
      targetDir.y = -dy * 0.05;
    }

    const rushers = state.players.filter((p) => p.role === "rusher");
    rushers.forEach((rusher) => {
      const diff = {
        x: player.loc.x - rusher.loc.x,
        y: player.loc.y - rusher.loc.y,
      };
      const d = length(diff);

      if (d < passerLookAhead) {
        const weight = Math.pow((passerLookAhead - d) / passerLookAhead, 2);
        targetDir.x += (diff.x / d) * weight * passerAvoidStrength;
        targetDir.y += (diff.y / d) * weight * passerAvoidStrength;
      }
    });

    // Anti-jitter
    const mag = length(targetDir);
    player.vel.x *= 0.92;
    player.vel.y *= 0.92;
    if (mag > 0.05) {
      const targetVelX = (targetDir.x / mag) * player.maxSpeed;
      const targetVelY = (targetDir.y / mag) * player.maxSpeed;

      const velDiff =
        Math.abs(targetVelX - player.vel.x) +
        Math.abs(targetVelY - player.vel.y);
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

  function throwingDecision(player: Player) {
    const { minThrowStep, earlyThrowChance, earlyThrowSeparation } =
      getConstants("decisionMaking", player);
    const { panicRusherDist, panicThrowChance, qbAccuracyPanicChange } =
      getConstants("pressureFeel", player);
    const { shortAccuracy } = getConstants("shortAccuracy", player);
    const { deepAccuracy } = getConstants("deepAccuracy", player);

    // Find most open catcher, closest rusher
    if (state.ballGiven || state.steps < minThrowStep) return;
    const coverers = state.players.filter((p) => p.role === "coverer");
    const rushers = state.players.filter((p) => p.role === "rusher");
    const eligibleCatchers = state.players.filter(
      (p) => p.role === "catcher" && p.route,
    );
    if (eligibleCatchers.length === 0) return;

    const catchersWithSeparation = eligibleCatchers.map((catcher) => {
      const { completionRadius } = getConstants("catchRadius", catcher);
      const nearestDefDist =
        coverers.length > 0
          ? Math.min(...coverers.map((cov) => dist(catcher.loc, cov.loc)))
          : Infinity;
      const opennessScore = nearestDefDist - completionRadius;
      return { catcher, nearestDefDist, opennessScore };
    });
    catchersWithSeparation.sort((a, b) => b.opennessScore - a.opennessScore);
    const bestOption = catchersWithSeparation[0];
    const nearestRusherDist =
      rushers.length > 0
        ? Math.min(...rushers.map((r) => dist(player.loc, r.loc)))
        : Infinity;

    // Determine whether to throw based on openness, pressure, or internal clock
    let shouldThrow = false;
    let panicThrow = false;
    if (state.steps >= BALL_GIVEN_STEPS) {
      shouldThrow = true;
    } else if (
      !state.earlyThrowDecided &&
      bestOption.nearestDefDist > earlyThrowSeparation
    ) {
      state.earlyThrowDecided = true;
      if (Math.random() < earlyThrowChance) shouldThrow = true;
    } else if (
      !state.panicThrowDecided &&
      nearestRusherDist < panicRusherDist
    ) {
      state.panicThrowDecided = true;
      if (Math.random() < panicThrowChance) {
        shouldThrow = true;
        panicThrow = true;
      }
    }
    if (!shouldThrow) return;

    // Determine accuracy based on catcher distance, pressure
    const throwDistance = dist(player.loc, bestOption.catcher.loc);
    const isShortThrow = throwDistance < SHORT_THROW_THRESHOLD_PX;
    let accuracyThreshold = isShortThrow ? shortAccuracy : deepAccuracy;
    accuracyThreshold += panicThrow ? qbAccuracyPanicChange : 0;

    const isAccurate = Math.random() < accuracyThreshold;

    // End play if incomplete, transfer ball to receiver if complete
    if (!isAccurate || bestOption.opennessScore < 0) {
      state.ball.loc.x = state.scoreboard.LOS;
      state.ball.loc.y = H / 2;
      resetSimulation("incomplete");
    } else {
      state.ball.loc.x = bestOption.catcher.loc.x;
      state.ball.loc.y = bestOption.catcher.loc.y;
      state.ballGiven = true;
      state.ballGivenAtStep = state.steps;
    }
  }

  function avoidBallCarrier(player: Player) {
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
      player.vel.y = direction * player.maxSpeed;
    } else {
      // Stop moving if out of the way
      player.vel.x = 0;
      player.vel.y = 0;
    }
  }

  function rushTowardsBall(player: Player) {
    const { lateralStrength, lateralFreq } = getConstants("bend", player);

    const toBall = diff(state.ball.loc, player.loc);
    const d = length(toBall);

    // Get unit vectors toward ball, perpendicular from ball
    const dirX = toBall.x / d;
    const dirY = toBall.y / d;
    const perpX = -dirY;
    const perpY = dirX;

    // Slow, lateral drift
    const phaseOffset = state.players.indexOf(player) * 2.1;
    const lateral =
      Math.sin(Date.now() * lateralFreq * 0.01 * SIM_SPEED + phaseOffset) *
      lateralStrength;

    // Apply velocity
    const targetVelX = (dirX + perpX * lateral) * player.maxSpeed;
    const targetVelY = (dirY + perpY * lateral) * player.maxSpeed;

    player.vel.x += (targetVelX - player.vel.x) * RUSHER_STEER_FACTOR;
    player.vel.y += (targetVelY - player.vel.y) * RUSHER_STEER_FACTOR;
  }

  function pursueBallCarrier(player: Player) {
    // 1. Fetch both pursuit and bend attributes simultaneously
    const {
      predictionFrames,
      pursuerHomingFactor,
      pursuerContainOffset,
      pursuitLateralFreq,
      pursuitLateralStrength,
    } = getConstants("pursuit", player);

    const toBall = dist(player.loc, state.ball.loc);
    const timeToReach = toBall / player.maxSpeed;

    // Project where the ball will be
    const totalLookAhead = timeToReach + predictionFrames;
    const predX = state.ball.loc.x + state.ball.vel.x * totalLookAhead;
    const predY = state.ball.loc.y + state.ball.vel.y * totalLookAhead;

    // Intercept that line
    const pathStart = state.ball.loc;
    const pathEnd = { x: predX, y: predY };
    const interceptPoint = closestPointOnSegment(
      player.loc,
      pathStart,
      pathEnd,
    );

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

      // 4. Calculate slow, smooth lateral wave offset
      const phaseOffset = state.players.indexOf(player) * 2.1;
      const lateral =
        Math.sin(
          Date.now() * pursuitLateralFreq * 0.01 * SIM_SPEED + phaseOffset,
        ) * pursuitLateralStrength;

      // 5. Apply the lateral drift to the final velocity calculation
      const targetVelX = (dirX + perpX * lateral) * player.maxSpeed;
      const targetVelY = (dirY + perpY * lateral) * player.maxSpeed;

      player.vel.x += (targetVelX - player.vel.x) * PURSUER_STEER_FACTOR;
      player.vel.y += (targetVelY - player.vel.y) * PURSUER_STEER_FACTOR;
    }
  }

  function cover(player: Player) {
    const { startDelay, reactionDelay, manCushion } = getConstants(
      "manCoverage",
      player,
    );
    const { zonePull } = getConstants("zoneCoverage", player);

    // Update perceived catcher details after any start/reaction delays
    player.reactionTimer++;
    const targetCatcher = getCovererTargetCatcher(player, state.players);
    if (player.perceivedLoc === null) {
      if (player.reactionTimer < startDelay) {
        return;
      }
      updateCovererPerception(player, targetCatcher);
      player.reactionTimer = 0;
    } else if (player.reactionTimer >= reactionDelay) {
      player.reactionTimer = 0;
      updateCovererPerception(player, targetCatcher);
    }

    // Estimate where the catcher is going
    let targetPoint: Vector;
    if (targetCatcher) {
      if (player.coverage === "man") {
        const perceived = player.perceivedLoc ?? targetCatcher.loc;

        const toBallX = state.ball.loc.x - perceived.x;
        const toBallY = state.ball.loc.y - perceived.y;
        const toBallDist =
          Math.sqrt(toBallX * toBallX + toBallY * toBallY) || 1;

        targetPoint = {
          x: perceived.x + (toBallX / toBallDist) * manCushion,
          y: perceived.y + (toBallY / toBallDist) * manCushion,
        };
      } else {
        targetPoint = {
          x: player.zone!.x + (targetCatcher.loc.x - player.zone!.x) * zonePull,
          y: player.zone!.y + (targetCatcher.loc.y - player.zone!.y) * zonePull,
        };
      }

      targetPoint = {
        x: targetPoint.x + (player.perceivedVel?.x ?? 0) * LEAD_FRAMES,
        y: targetPoint.y + (player.perceivedVel?.y ?? 0) * LEAD_FRAMES,
      };
    } else {
      targetPoint = player.zone ?? { ...player.loc };
    }

    // Move towards the targetPoint unless sufficiently close
    const d = dist(player.loc, targetPoint);
    if (d < 0.5) {
      player.vel.x = 0;
      player.vel.y = 0;
      return;
    }

    const speedScale = Math.min(1, d / ARRIVAL_RADIUS);
    const angle = Math.atan2(
      targetPoint.y - player.loc.y,
      targetPoint.x - player.loc.x,
    );
    player.vel.x = Math.cos(angle) * player.maxSpeed * speedScale;
    player.vel.y = Math.sin(angle) * player.maxSpeed * speedScale;
  }
}

const catcherRouteVariance = new WeakMap<
  Player,
  { angleOffset: number; stemDrift: number }
>();

function getCatcherRouteVariance(player: Player) {
  const { routeStemDrift } = getConstants("routeRunning", player);

  let variance = catcherRouteVariance.get(player);
  if (!variance) {
    variance = {
      angleOffset: (Math.random() * 2 - 1) * ROUTE_BREAK_ANGLE_JITTER,
      stemDrift: (Math.random() * 2 - 1) * routeStemDrift * player.maxSpeed,
    };
    catcherRouteVariance.set(player, variance);
  }
  return variance;
}

function attemptTackle(defender: Player, carrier: Player) {
  const { carrierPower, tacklePressureThreshold } = getConstants(
    "power",
    carrier,
  );
  const { defenderTackle, tackleAttemptChance } = getConstants(
    "tackling",
    defender,
  );

  // Passer cannot break tackles
  if (carrier.role === "passer") {
    resetSimulation("sack");
    return;
  }

  // Tackle pressure slowly builds and guarantees a tackle
  carrier.contactedThisFrame = true;
  carrier.tacklePressure =
    (carrier.tacklePressure ?? 0) + TACKLE_PRESSURE_PER_FRAME;

  carrier.tacklePressure =
    (carrier.tacklePressure ?? 0) + TACKLE_PRESSURE_PER_FRAME;

  if (carrier.tacklePressure >= tacklePressureThreshold) {
    resetSimulation("tackle");
    return;
  }

  // Defenders individually try to tackle carriers
  if (Math.random() < tackleAttemptChance) {
    const tackleChance = defenderTackle / (defenderTackle + carrierPower);

    if (Math.random() < tackleChance) {
      resetSimulation("tackle");
    } else {
      // Broken tackle
      carrier.tacklePressure = 0;
      carrier.burstFrames = BROKEN_TACKLE_BURST_DURATION;

      const currentMag = Math.sqrt(carrier.vel.x ** 2 + carrier.vel.y ** 2);
      if (currentMag > 0) {
        carrier.vel.x =
          (carrier.vel.x / currentMag) *
          carrier.maxSpeed *
          BROKEN_TACKLE_SPEED_BURST;
        carrier.vel.y =
          (carrier.vel.y / currentMag) *
          carrier.maxSpeed *
          BROKEN_TACKLE_SPEED_BURST;
      }
    }
  }
}

function getCovererTargetCatcher(
  player: Player,
  players: Player[],
): Player | null {
  if (player.coverage === "man") {
    return player.assignedTarget || null;
  }

  if (player.coverage === "zone") {
    if (!player.zone) {
      console.warn("Zone defender has no zone?");
      return null;
    }
    const catchers = players.filter((p) => p.role === "catcher");
    if (catchers.length === 0) return null;
    catchers.sort(
      (a, b) => dist(player.zone!, a.loc) - dist(player.zone!, b.loc),
    );
    return catchers[0];
  }

  return null;
}

function updateCovererPerception(player: Player, targetCatcher: Player | null) {
  if (targetCatcher) {
    player.perceivedVel = { ...targetCatcher.vel };
    player.perceivedLoc = { ...targetCatcher.loc };
  } else {
    player.perceivedLoc = { ...player.loc };
    player.perceivedVel = { x: 0, y: 0 };
  }
}

export { attemptTackle, stepAsPlayer };

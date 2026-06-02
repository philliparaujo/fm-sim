import { H } from "./render";
import {
  ANGLE_ENDZONE_INTENT,
  ARRIVAL_RADIUS,
  BALL_GIVEN_STEPS,
  BROKEN_TACKLE_SPEED_BURST,
  CARRIER_POWER,
  CATCH_SLOWDOWN_DURATION,
  CATCHER_AVOID_STRENGTH,
  COMPLETION_RADIUS,
  DEFENDER_TACKLE,
  EARLY_THROW_CHANCE,
  EARLY_THROW_SEPARATION,
  LATERAL_FREQ,
  LATERAL_STRENGTH,
  LEAD_FRAMES,
  LOOK_AHEAD,
  MAN_CUSHION,
  MIN_BLOCK_DISTANCE,
  MIN_CATCH_SPEED_MULT,
  MIN_THROW_STEP,
  PANIC_RUSHER_DIST,
  PANIC_THROW_CHANCE,
  PASSER_AVOID_STRENGTH,
  PASSER_HANDOFF_SEPARATION,
  PASSER_LOOK_AHEAD,
  PASSER_STEER_FACTOR,
  PIXELS_PER_STEP,
  PREDICTION_FRAMES,
  PURSUER_CONTAIN_OFFSET,
  PURSUER_HOMING_FACTOR,
  PURSUER_STEER_FACTOR,
  QB_ACCURACY_DEEP,
  QB_ACCURACY_PANIC_CHANGE,
  QB_ACCURACY_SHORT,
  REACCELERATION_DURATION,
  REACTION_DELAY,
  resetSimulation,
  resolveCollision,
  ROUTE_BREAK_ANGLE_JITTER,
  ROUTE_CUT_SPEED_RETAINED,
  ROUTE_STEM_DRIFT,
  RUNNER_AVOID_STRENGTH,
  RUNNER_EARLY_AVOID_STRENGTH,
  RUNNER_INITIAL_STEER_DURATION,
  RUNNER_STEER_FACTOR,
  RUSHER_STEER_FACTOR,
  SHORT_THROW_THRESHOLD_PX,
  SIM_SPEED,
  START_DELAY,
  STOP_AFTER_BREAK_THRESHOLD,
  TACKLE_ATTEMPT_CHANCE,
  TACKLE_PRESSURE_PER_FRAME,
  TACKLE_PRESSURE_THRESHOLD,
  ZONE_PULL,
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
  const isEarlyInRun =
    state.steps - state.ballGivenAtStep < RUNNER_INITIAL_STEER_DURATION &&
    player.runAngle;

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
      if (isBlocking) {
        blockNearestDefender(player);
      } else if (!isCarryingBall(player, state.ball)) {
        runTowardsBall(player);
      } else if (isEarlyInRun) {
        runTowardsEndzone(player, RUNNER_EARLY_AVOID_STRENGTH, player.runAngle);
      } else {
        runTowardsEndzone(player, RUNNER_AVOID_STRENGTH);
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
    // Calculate the direction to travel to avoid other defenders
    const defenders = state.players.filter(
      (p) => p.role === "rusher" || p.role === "coverer",
    );
    defenders.forEach((defender) => {
      const toPlayer = diff(player.loc, defender.loc);
      const d = length(toPlayer);

      if (d < LOOK_AHEAD) {
        const weight = (LOOK_AHEAD - d) / LOOK_AHEAD;
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
      framesSinceCatch < CATCH_SLOWDOWN_DURATION &&
      isCarryingBall(player, state.ball)
    ) {
      const progress = framesSinceCatch / CATCH_SLOWDOWN_DURATION;
      const multiplier = lerp(progress, MIN_CATCH_SPEED_MULT, 1);
      currentMaxSpeed *= multiplier;
    }

    // Apply this direction to the runner's velocity
    const d = length(targetDir);
    const targetVelX = (targetDir.x / d) * currentMaxSpeed;
    const targetVelY = (targetDir.y / d) * currentMaxSpeed;
    player.vel.x += (targetVelX - player.vel.x) * RUNNER_STEER_FACTOR;
    player.vel.y += (targetVelY - player.vel.y) * RUNNER_STEER_FACTOR;
    state.ball.vel.x = player.vel.x;
    state.ball.vel.y = player.vel.y;
  }

  function runRoute(player: Player) {
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
          (isNoBreakRoute(player.route) ? 1.0 : ROUTE_CUT_SPEED_RETAINED);
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
          framesSinceBreak <= REACCELERATION_DURATION
        ) {
          const progress = framesSinceBreak / REACCELERATION_DURATION;
          const d = length(player.vel);
          if (d > 0) {
            const scale =
              (player.maxSpeed * lerp(progress, ROUTE_CUT_SPEED_RETAINED, 1)) /
              d;
            player.vel.x *= scale;
            player.vel.y *= scale;
          }
        }
      }

      // Decelerates player if their route requires them to after the break
      if (
        player.route.stopAfterBreak &&
        state.steps > routeBreakThreshold + STOP_AFTER_BREAK_THRESHOLD
      ) {
        player.vel.x *= 0.9;
        player.vel.y *= 0.9;
      }
    }
  }

  function navigatePocket(player: Player) {
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

      if (d < PASSER_LOOK_AHEAD) {
        const weight = Math.pow((PASSER_LOOK_AHEAD - d) / PASSER_LOOK_AHEAD, 2);
        targetDir.x += (diff.x / d) * weight * PASSER_AVOID_STRENGTH;
        targetDir.y += (diff.y / d) * weight * PASSER_AVOID_STRENGTH;
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
        velDiff < 0.4 ? PASSER_STEER_FACTOR * 0.15 : PASSER_STEER_FACTOR;

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
    // Find most open catcher, closest rusher
    if (state.ballGiven || state.steps < MIN_THROW_STEP) return;
    const coverers = state.players.filter((p) => p.role === "coverer");
    const rushers = state.players.filter((p) => p.role === "rusher");
    const eligibleCatchers = state.players.filter(
      (p) => p.role === "catcher" && p.route,
    );
    if (eligibleCatchers.length === 0) return;

    const catchersWithSeparation = eligibleCatchers.map((catcher) => {
      const nearestDefDist =
        coverers.length > 0
          ? Math.min(...coverers.map((cov) => dist(catcher.loc, cov.loc)))
          : Infinity;
      return { catcher, nearestDefDist };
    });
    catchersWithSeparation.sort((a, b) => b.nearestDefDist - a.nearestDefDist);
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
      bestOption.nearestDefDist > EARLY_THROW_SEPARATION
    ) {
      state.earlyThrowDecided = true;
      if (Math.random() < EARLY_THROW_CHANCE) shouldThrow = true;
    } else if (
      !state.panicThrowDecided &&
      nearestRusherDist < PANIC_RUSHER_DIST
    ) {
      state.panicThrowDecided = true;
      if (Math.random() < PANIC_THROW_CHANCE) {
        shouldThrow = true;
        panicThrow = true;
      }
    }
    if (!shouldThrow) return;

    // Determine accuracy based on catcher distance, pressure
    const throwDistance = dist(player.loc, bestOption.catcher.loc);
    const isShortThrow = throwDistance < SHORT_THROW_THRESHOLD_PX;
    let accuracyThreshold = isShortThrow ? QB_ACCURACY_SHORT : QB_ACCURACY_DEEP;
    accuracyThreshold += panicThrow ? QB_ACCURACY_PANIC_CHANGE : 0;

    const isAccurate = Math.random() < accuracyThreshold;

    // End play if incomplete, transfer ball to receiver if complete
    if (!isAccurate || bestOption.nearestDefDist < COMPLETION_RADIUS) {
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
      Math.sin(Date.now() * LATERAL_FREQ * 0.01 * SIM_SPEED + phaseOffset) *
      LATERAL_STRENGTH;

    // Apply velocity
    const targetVelX = (dirX + perpX * lateral) * player.maxSpeed;
    const targetVelY = (dirY + perpY * lateral) * player.maxSpeed;

    player.vel.x += (targetVelX - player.vel.x) * RUSHER_STEER_FACTOR;
    player.vel.y += (targetVelY - player.vel.y) * RUSHER_STEER_FACTOR;
  }

  function pursueBallCarrier(player: Player) {
    const toBall = dist(player.loc, state.ball.loc);
    const timeToReach = toBall / player.maxSpeed;

    // Project where the ball will be
    const totalLookAhead = timeToReach + PREDICTION_FRAMES;
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
      interceptPoint.x * (1 - PURSUER_HOMING_FACTOR) +
      state.ball.loc.x * PURSUER_HOMING_FACTOR;
    let targetY =
      interceptPoint.y * (1 - PURSUER_HOMING_FACTOR) +
      state.ball.loc.y * PURSUER_HOMING_FACTOR;

    // Contain ball carriers slightly wide
    const middleOfField = H / 2;
    const containDirection = state.ball.loc.y < middleOfField ? -1 : 1;
    targetY += containDirection * PURSUER_CONTAIN_OFFSET;

    // Calculate final velocity
    const toTarget = diff({ x: targetX, y: targetY }, player.loc);
    const d = length(toTarget);

    if (d > 0.5) {
      const targetVelX = (toTarget.x / d) * player.maxSpeed;
      const targetVelY = (toTarget.y / d) * player.maxSpeed;

      player.vel.x += (targetVelX - player.vel.x) * PURSUER_STEER_FACTOR;
      player.vel.y += (targetVelY - player.vel.y) * PURSUER_STEER_FACTOR;
    }
  }

  function cover(player: Player) {
    // Update perceived catcher details after any start/reaction delays
    player.reactionTimer++;
    const targetCatcher = getCovererTargetCatcher(player, state.players);
    if (player.perceivedLoc === null) {
      if (player.reactionTimer < START_DELAY) {
        return;
      }
      updateCovererPerception(player, targetCatcher);
      player.reactionTimer = 0;
    } else if (player.reactionTimer >= REACTION_DELAY) {
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
          x: perceived.x + (toBallX / toBallDist) * MAN_CUSHION,
          y: perceived.y + (toBallY / toBallDist) * MAN_CUSHION,
        };
      } else {
        targetPoint = {
          x:
            player.zone!.x + (targetCatcher.loc.x - player.zone!.x) * ZONE_PULL,
          y:
            player.zone!.y + (targetCatcher.loc.y - player.zone!.y) * ZONE_PULL,
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
  let variance = catcherRouteVariance.get(player);
  if (!variance) {
    variance = {
      angleOffset: (Math.random() * 2 - 1) * ROUTE_BREAK_ANGLE_JITTER,
      stemDrift: (Math.random() * 2 - 1) * ROUTE_STEM_DRIFT * player.maxSpeed,
    };
    catcherRouteVariance.set(player, variance);
  }
  return variance;
}

function attemptTackle(defender: Player, carrier: Player) {
  // Passergets sacked immediately — no contest
  if (carrier.role === "passer") {
    resetSimulation("sack");
    return;
  }

  carrier.contactedThisFrame = true; // mark contact before any pressure logic
  carrier.tacklePressure =
    (carrier.tacklePressure ?? 0) + TACKLE_PRESSURE_PER_FRAME;

  // Accumulate tackle pressure while in contact
  carrier.tacklePressure =
    (carrier.tacklePressure ?? 0) + TACKLE_PRESSURE_PER_FRAME;

  // Guaranteed bring-down once pressure maxes out
  if (carrier.tacklePressure >= TACKLE_PRESSURE_THRESHOLD) {
    resetSimulation("tackle");
    return;
  }

  // Per-frame probabilistic contest
  if (Math.random() < TACKLE_ATTEMPT_CHANCE) {
    const defTackle = DEFENDER_TACKLE;
    const carPower = CARRIER_POWER;
    const tackleChance = defTackle / (defTackle + carPower);

    if (Math.random() < tackleChance) {
      resetSimulation("tackle");
    } else {
      // Broken tackle — shed the pressure and burst forward
      carrier.tacklePressure = 0;
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

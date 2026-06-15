import { getConstants } from "./ratings";
import { H } from "./render";
import {
  ANGLE_ENDZONE_INTENT,
  ARRIVAL_RADIUS,
  BALL_GIVEN_STEPS,
  BROKEN_TACKLE_BURST_DURATION,
  BROKEN_TACKLE_SPEED_BURST,
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
  const isPassPlay = state.currentPlay.offense === "pass";
  const { maxSpeed } = getConstants("SPEED", player);
  const { avoidStrength, steerAvoidStrength, steerDuration } = getConstants(
    "VISION",
    player,
  );

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
      const isEarlyInRun =
        state.steps - state.ballGivenAtStep < steerDuration && player.runAngle;

      if (isBlocking || isPassPlay) {
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
      if (isBlocking || state.currentPlay.offense === "pass") {
        blockNearestDefender(player);
      } else if (!isCarryingBall(player, state.ball)) {
        runRoute(player);
      } else {
        runTowardsEndzone(player, avoidStrength);
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

  if (state.ballGiven || player.role === "passer") {
    resolveCollision(player, state.ball);
  }

  /* Specific actions a player can perform */
  function blockNearestDefender(player: Player) {
    const assignedDefender = state.blockingAssignments.get(player);
    const defenders = assignedDefender
      ? [assignedDefender]
      : state.players.filter(
          (p) => p.role === "rusher" || p.role === "coverer",
        );

    // 1. Identify the target defender
    let targetDefender: Player | null = assignedDefender || null;
    if (!targetDefender) {
      // If no hard assignment, find the absolute closest threat to the player
      let minD = Infinity;
      defenders.forEach((d) => {
        const distance = dist(player.loc, d.loc);
        if (distance < minD) {
          minD = distance;
          targetDefender = d;
        }
      });
    }

    if (targetDefender) {
      let targetLoc = { x: 0, y: 0 };
      const distanceToDefender = dist(player.loc, targetDefender.loc);

      // 2. THE FIX: If the player is a catcher or runner and hasn't engaged yet,
      // run directly AT the defender to establish contact/leverage, completely ignoring the ball position.
      if (
        (player.role === "catcher" || player.role === "runner") &&
        distanceToDefender > 30
      ) {
        // Dynamic Inside Leverage Logic:
        // Identify the horizontal centerline of the field
        const fieldCenterY = H / 2;

        // If defender is above the centerline, inside leverage means shading DOWN (+Y).
        // If defender is below the centerline, inside leverage means shading UP (-Y).
        const insideShadeDirection =
          targetDefender.loc.y < fieldCenterY ? 1 : -1;

        // LEVERAGE TUNING CONSTANTS
        const UPFIELD_SEAL_X = 15; // How many pixels ahead of the defender they aim (X-axis)
        const INSIDE_SEAL_Y = 50; // How wide of an inside wall they establish (Y-axis)

        targetLoc = {
          x: targetDefender.loc.x + UPFIELD_SEAL_X,
          y: targetDefender.loc.y + insideShadeDirection * INSIDE_SEAL_Y,
        };
      } else {
        // Traditional line-blocking/downfield-intercept behavior once close or for interior blockers
        let interceptPoint = closestPointOnSegment(
          player.loc,
          targetDefender.loc,
          state.ball.loc,
        );

        if (dist(interceptPoint, state.ball.loc) < MIN_BLOCK_DISTANCE) {
          const toDefender = diff(targetDefender.loc, state.ball.loc);
          const d = length(toDefender);
          interceptPoint = {
            x: state.ball.loc.x + (toDefender.x / d) * MIN_BLOCK_DISTANCE,
            y: state.ball.loc.y + (toDefender.y / d) * MIN_BLOCK_DISTANCE,
          };
        }
        targetLoc = interceptPoint;
      }

      // 3. Apply velocities toward the corrected target location
      const distToTarget = dist(player.loc, targetLoc);
      if (distToTarget < 2) {
        player.vel.x = 0;
        player.vel.y = 0;
      } else {
        const angle = Math.atan2(
          targetLoc.y - player.loc.y,
          targetLoc.x - player.loc.x,
        );
        player.vel.x = Math.cos(angle) * maxSpeed;
        player.vel.y = Math.sin(angle) * maxSpeed;
      }
    }
  }

  function runTowardsBall(player: Player) {
    const toBall = diff(state.ball.loc, player.loc);
    const d = length(toBall);
    player.vel.x = (toBall.x / d) * maxSpeed;
    player.vel.y = (toBall.y / d) * maxSpeed;
  }

  function runTowardsEndzone(
    player: Player,
    avoidStrength: number, // Intact for signature matching
    targetDir: Vector = { x: 1.0, y: 0 },
  ) {
    const { maxSpeed } = getConstants("SPEED", player);
    const { catchSlowdownDuration, minCatchSpeedMultiplier } = getConstants(
      "catchAcceleration",
      player,
    );

    // CRITICAL PATH FIX: Push a DEEP COPY of player position coordinates.
    // Pushing 'player.loc' passes an object reference, causing every point in the history
    // array to match current coordinates simultaneously, which blanks out the line!
    if (!player.path) player.path = [];
    player.path.push({ x: player.loc.x, y: player.loc.y });

    // 1. OVERRIDE TARGET DIRECTION VIA CONTEXT STEERING MAP
    const optimizedTargetDir = getContextSteering(player, state, targetDir);

    // 2. PRESERVE POST-CATCH SLOWDOWN MECHANICS
    const framesSinceCatch = state.steps - state.ballGivenAtStep;
    let currentSpeed = maxSpeed;
    if (
      framesSinceCatch < catchSlowdownDuration &&
      isCarryingBall(player, state.ball)
    ) {
      const progress = framesSinceCatch / catchSlowdownDuration;
      const multiplier = lerp(progress, minCatchSpeedMultiplier, 1);
      currentSpeed *= multiplier;
    }

    // 3. PRESERVE BROKEN TACKLE SPEED BURSTS
    if (player.burstFrames && player.burstFrames > 0) {
      currentSpeed *= BROKEN_TACKLE_SPEED_BURST;
      player.burstFrames--;
    }

    // 4. SMOOTH PHYSICS MODEL STEERING
    const choiceDiscrepancy = Math.abs(
      Math.atan2(optimizedTargetDir.y, optimizedTargetDir.x) -
        Math.atan2(targetDir.y, targetDir.x),
    );
    const dynamicSteerFactor = choiceDiscrepancy > 0.2 ? 3.5 : 1;

    const d = length(optimizedTargetDir);
    if (d > 0) {
      // Both axes utilize the correct optimized context steering elements
      const targetVelX = (optimizedTargetDir.x / d) * currentSpeed;
      const targetVelY = (optimizedTargetDir.y / d) * currentSpeed;

      player.vel.x += (targetVelX - player.vel.x) * dynamicSteerFactor;
      player.vel.y += (targetVelY - player.vel.y) * dynamicSteerFactor;
    }

    // 5. SYNC BALL POSITION TO CARRIER
    if (isCarryingBall(player, state.ball)) {
      state.ball.vel.x = player.vel.x;
      state.ball.vel.y = player.vel.y;
    }
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
      (player.route.steps * PIXELS_PER_STEP) / maxSpeed,
    );

    if (state.steps < routeBreakThreshold) {
      // 1) Route stem
      player.vel.x = maxSpeed;
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
          maxSpeed *
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
              (maxSpeed * lerp(progress, routeCutSpeedRetained, 1)) / d;
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
      const targetVelX = (targetDir.x / mag) * maxSpeed;
      const targetVelY = (targetDir.y / mag) * maxSpeed;

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
    const { minThrowStep, earlyThrowSeparation, earlyThrowChance } =
      getConstants("decisionMaking", player);
    const { panicRusherDist, panicThrowChance, qbAccuracyPanicChange } =
      getConstants("pressureFeel", player);
    const { shortAccuracy } = getConstants("shortAccuracy", player);
    const { deepAccuracy } = getConstants("deepAccuracy", player);

    if (state.ballGiven || state.steps < minThrowStep) return;

    const coverers = state.players.filter((p) => p.role === "coverer");
    const rushers = state.players.filter((p) => p.role === "rusher");
    const eligibleCatchers = state.players.filter(
      (p) => p.role === "catcher" && p.route,
    );
    if (eligibleCatchers.length === 0) return;

    const nearestRusherDist =
      rushers.length > 0
        ? Math.min(...rushers.map((r) => dist(player.loc, r.loc)))
        : Infinity;
    const underPressure = nearestRusherDist < panicRusherDist;

    // --- STEP 1: Score receivers with depth normalization ---
    const evaluatedOptions = eligibleCatchers.map((catcher) => {
      const { completionRadius } = getConstants("catchRadius", catcher);
      const throwDist = dist(player.loc, catcher.loc);

      const nearestDefDist =
        coverers.length > 0
          ? Math.min(...coverers.map((cov) => dist(catcher.loc, cov.loc)))
          : Infinity;

      const defenderClosingSpeed =
        coverers.length > 0
          ? Math.max(
              ...coverers.map((cov) => {
                const toCatcher = diff(catcher.loc, cov.loc);
                const d = length(toCatcher);
                if (d === 0) return 0;
                return (cov.vel.x * toCatcher.x + cov.vel.y * toCatcher.y) / d;
              }),
            )
          : 0;

      // FIX: Normalize openness relative to target depth.
      // This allows short/flat routes to score high even with tight coverage.
      const baseOpenness =
        nearestDefDist - completionRadius - defenderClosingSpeed * 6;
      const depthScalar = throwDist < SHORT_THROW_THRESHOLD_PX ? 1.8 : 1.0;
      const normalizedOpenness = baseOpenness * depthScalar;

      return { catcher, normalizedOpenness, throwDist, nearestDefDist };
    });

    // --- STEP 2: Smart Target Progression Selection ---
    let bestOption = evaluatedOptions[0];

    if (underPressure) {
      // Checkdown Priority: Filter for open, short targets first to dump the ball off safely
      const shortOutlets = evaluatedOptions
        .filter(
          (o) =>
            o.throwDist < SHORT_THROW_THRESHOLD_PX &&
            o.normalizedOpenness > earlyThrowSeparation * 0.7,
        )
        .sort((a, b) => b.normalizedOpenness - a.normalizedOpenness);

      if (shortOutlets.length > 0) {
        bestOption = shortOutlets[0];
      } else {
        // Panic situation: take the option with the highest absolute separation downfield
        evaluatedOptions.sort(
          (a, b) => b.normalizedOpenness - a.normalizedOpenness,
        );
        bestOption = evaluatedOptions[0];
      }
    } else {
      // Clean Pocket: Standard quarterback progression tree (highest open score)
      evaluatedOptions.sort(
        (a, b) => b.normalizedOpenness - a.normalizedOpenness,
      );
      bestOption = evaluatedOptions[0];
    }

    // --- STEP 3: Stateful Decision Processing (Eliminate Sack RNG Trap) ---
    let shouldThrow = false;

    // Initialize a stateful decision ticker on the player if it doesn't exist
    if (state.steps >= BALL_GIVEN_STEPS) {
      shouldThrow = true; // Clock ran out — must throw
    } else if (underPressure) {
      player.decisionTicks += panicThrowChance;
      if (player.decisionTicks >= 2.0 || Math.random() < 0.15) {
        shouldThrow = true;
      }
    } else if (bestOption.normalizedOpenness > earlyThrowSeparation) {
      // Accumulate ticks frame-over-frame based on their core rating
      player.decisionTicks += earlyThrowChance;
      if (player.decisionTicks >= 3.5) {
        shouldThrow = true;
      }
    } else {
      // If no one is open and there is no pressure, slowly decay the ticker
      player.decisionTicks = Math.max(0, player.decisionTicks - 0.05);
    }

    if (!shouldThrow) return;
    player.decisionTicks = 0; // Reset ticker once a choice is made

    // --- STEP 4: Accuracy & Misdirection Vector Engine ---
    const isShortThrow = bestOption.throwDist < SHORT_THROW_THRESHOLD_PX;
    const baseAccuracy = isShortThrow ? shortAccuracy : deepAccuracy;
    const panicPenalty = underPressure ? qbAccuracyPanicChange : 0;
    const effectiveAccuracy = Math.max(0, baseAccuracy + panicPenalty);

    const maxMissDistance = isShortThrow
      ? lerp(effectiveAccuracy, 100, 0)
      : lerp(effectiveAccuracy, 260, 0);

    const missDistance = Math.random() * maxMissDistance;
    const missAngle = Math.random() * Math.PI * 2;
    const throwTarget = {
      x: bestOption.catcher.loc.x + Math.cos(missAngle) * missDistance,
      y: bestOption.catcher.loc.y + Math.sin(missAngle) * missDistance,
    };

    // --- STEP 5: Catch Verification ---
    const catchableRadius = getConstants(
      "catchRadius",
      bestOption.catcher,
    ).completionRadius;
    const distToTarget = dist(throwTarget, bestOption.catcher.loc);
    const isCatchable = distToTarget < catchableRadius;

    const intercepted = coverers.some(
      (cov) => dist(throwTarget, cov.loc) < catchableRadius * 0.7,
    );

    state.playAdvanced.throwFrame = state.steps;
    state.playAdvanced.airYards =
      bestOption.catcher.loc.x - state.scoreboard.LOS;
    // state.playAdvanced.wasOffTarget = !isCatchable;
    state.playAdvanced.wasUnderPressure = underPressure;

    if (intercepted) {
      // resetSimulation("turnover");
    } else if (!isCatchable) {
      state.ball.loc.x = state.scoreboard.LOS;
      // state.ball.loc.y = throwTarget.y;
      resetSimulation("incomplete");
    } else {
      state.ball.loc.x = bestOption.catcher.loc.x;
      state.ball.loc.y = bestOption.catcher.loc.y;
      state.ballGiven = true;
      state.playAdvanced.catchX = bestOption.catcher.loc.x;
      state.ballGivenAtStep = state.steps;

      if (isFinite(bestOption.nearestDefDist)) {
        state.playAdvanced.separationAtCatch = bestOption.nearestDefDist;
      }
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
      player.vel.y = direction * maxSpeed;
    } else {
      // Stop moving if out of the way
      player.vel.x = 0;
      player.vel.y = 0;
    }
  }

  function rushTowardsBall(player: Player) {
    const { lateralStrength, lateralFreq } = getConstants("bend", player);
    const { maxSpeed } = getConstants("SPEED", player);

    const isRunPlay = state.currentPlay.offense === "run";
    let targetLoc = { ...state.ball.loc };

    // 1. GAP CONTAINMENT: If it's a run play and the ball hasn't crossed the line of scrimmage,
    // hold down containment vectors rather than diving backwards into a mosh pit.
    if (isRunPlay && state.ball.loc.x < state.scoreboard.LOS) {
      // Edge rushers (outermost indices) should guard their horizontal lanes
      const playerIndex = state.players.indexOf(player);
      const isOuterRusher = playerIndex === 0 || playerIndex === 2; // Adjust based on your lineup indices

      if (isOuterRusher) {
        // Force them to anchor near the Line of Scrimmage horizontally, protecting the outside edge
        targetLoc.x = state.scoreboard.LOS + 10;
      }
    }

    const toTarget = diff(targetLoc, player.loc);
    const d = length(toTarget);

    if (d === 0) return;

    const dirX = toTarget.x / d;
    const dirY = toTarget.y / d;

    // 2. BEND CONTEXT: Only apply the swaying 'bend' math on pass plays (pass rushing)
    let lateral = 0;
    if (!isRunPlay) {
      const phaseOffset = state.players.indexOf(player) * 2.1;
      lateral =
        Math.sin(state.steps * 0.166 * lateralFreq + phaseOffset) *
        lateralStrength;
    }

    const perpX = -dirY;
    const perpY = dirX;

    // 3. BLOCK DECAY OVERRIDE: Check if the player was blocked/contacted this frame.
    // If they are engaged in a block, scale down their maximum tracking velocity.
    const speedModifier = player.contactedThisFrame ? 0.25 : 1.0;

    const targetVelX = (dirX + perpX * lateral) * maxSpeed * speedModifier;
    const targetVelY = (dirY + perpY * lateral) * maxSpeed * speedModifier;

    player.vel.x += (targetVelX - player.vel.x) * RUSHER_STEER_FACTOR;
    player.vel.y += (targetVelY - player.vel.y) * RUSHER_STEER_FACTOR;
  }

  function pursueBallCarrier(player: Player) {
    const { manStartDelay } = getConstants("manCoverage", player);
    const { zoneStartDelay } = getConstants("zoneCoverage", player);
    const startDelay =
      player.coverage === "man" ? manStartDelay : zoneStartDelay;

    // Carry over the same reaction delay used in coverage
    player.reactionTimer++;
    if (player.reactionTimer < startDelay) return;

    // 1. Fetch both pursuit and bend attributes simultaneously
    const {
      predictionFrames,
      pursuerHomingFactor,
      pursuerContainOffset,
      pursuitLateralFreq,
      pursuitLateralStrength,
    } = getConstants("pursuit", player);

    const toBall = dist(player.loc, state.ball.loc);
    const timeToReach = toBall / maxSpeed;

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

  function cover(player: Player) {
    const { manStartDelay, reactionDelay, manCushion } = getConstants(
      "manCoverage",
      player,
    );
    const { zonePull, zoneStartDelay } = getConstants("zoneCoverage", player);
    const startDelay =
      player.coverage === "man" ? manStartDelay : zoneStartDelay;

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
    player.vel.x = Math.cos(angle) * maxSpeed * speedScale;
    player.vel.y = Math.sin(angle) * maxSpeed * speedScale;
  }
}

const catcherRouteVariance = new WeakMap<
  Player,
  { angleOffset: number; stemDrift: number }
>();

function getCatcherRouteVariance(player: Player) {
  const { routeStemDrift } = getConstants("routeRunning", player);
  const { maxSpeed } = getConstants("SPEED", player);

  let variance = catcherRouteVariance.get(player);
  if (!variance) {
    variance = {
      angleOffset: (Math.random() * 2 - 1) * ROUTE_BREAK_ANGLE_JITTER,
      stemDrift: (Math.random() * 2 - 1) * routeStemDrift * maxSpeed,
    };
    catcherRouteVariance.set(player, variance);
  }
  return variance;
}

function attemptTackle(defender: Player, carrier: Player) {
  const { carrierPower, tacklePressureThreshold } = getConstants(
    "POWER",
    carrier,
  );
  const { maxSpeed } = getConstants("SPEED", carrier);
  const { defenderTackle, tackleAttemptChance } = getConstants(
    "TACKLING",
    defender,
  );

  if (carrier.role === "passer") {
    resetSimulation("sack");
    return;
  }

  // 1. Structural Cooldown Guard (from the frame-rate fix)
  defender.tackleCooldownTicks = defender.tackleCooldownTicks ?? 0;
  if (defender.tackleCooldownTicks > 0) {
    defender.tackleCooldownTicks--;
    return;
  }

  // Attrition pressure accumulates on contact
  carrier.contactedThisFrame = true;
  carrier.tacklePressure =
    (carrier.tacklePressure ?? 0) + TACKLE_PRESSURE_PER_FRAME;

  if (carrier.tacklePressure >= tacklePressureThreshold) {
    resetSimulation("tackle");
    return;
  }

  // 2. Calculate the Approach Angle Factor
  let angleModifier = 1.0; // Default baseline (side tackle)

  const carrierMag = Math.sqrt(carrier.vel.x ** 2 + carrier.vel.y ** 2);
  if (carrierMag > 0) {
    // Normalized heading vector of the ball carrier
    const carrierHeading = {
      x: carrier.vel.x / carrierMag,
      y: carrier.vel.y / carrierMag,
    };

    // Vector pointing from the carrier to the defender, then normalized
    const toDefender = {
      x: defender.loc.x - carrier.loc.x,
      y: defender.loc.y - carrier.loc.y,
    };
    const distToDefender = Math.sqrt(toDefender.x ** 2 + toDefender.y ** 2);

    if (distToDefender > 0) {
      const dirToDefender = {
        x: toDefender.x / distToDefender,
        y: toDefender.y / distToDefender,
      };

      // Dot Product: 1 = Head-on, -1 = From Behind, 0 = Directly from the side
      const approachDot =
        carrierHeading.x * dirToDefender.x + carrierHeading.y * dirToDefender.y;

      if (approachDot > 0) {
        // HEAD-ON: Linearly scale up tackle effectiveness up to +25%
        // An approachDot of 1.0 means maximum leverage
        angleModifier = 1.0 + approachDot * 0.25;
      } else {
        // FROM BEHIND: Linearly scale down tackle effectiveness by up to -40%
        // An approachDot of -1.0 means trailing directly behind the heels
        angleModifier = 1.0 + approachDot * 0.4;
      }
    }
  }

  // 3. Roll for the Distinct Tackle Attempt
  if (Math.random() < tackleAttemptChance) {
    // Apply the angle modifier directly to the defender's physical rolling strength
    const adjustedDefenderTackle = defenderTackle * angleModifier;
    const tackleChance =
      adjustedDefenderTackle / (adjustedDefenderTackle + carrierPower);

    if (Math.random() < tackleChance) {
      resetSimulation("tackle");
    } else {
      // Broken tackle logic
      carrier.tacklePressure = 0;
      carrier.burstFrames = BROKEN_TACKLE_BURST_DURATION;
      carrier.isBursting = true;

      if (carrierMag > 0) {
        carrier.vel.x =
          (carrier.vel.x / carrierMag) * maxSpeed * BROKEN_TACKLE_SPEED_BURST;
        carrier.vel.y =
          (carrier.vel.y / carrierMag) * maxSpeed * BROKEN_TACKLE_SPEED_BURST;
      }

      defender.tackleCooldownTicks = 45; // Put defender on cooldown
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

function getContextSteering(
  player: Player,
  state: State,
  baseIntent: Vector,
): Vector {
  const { lookAhead } = getConstants("VISION", player);

  const NUM_RAYS = 64;
  const rays: {
    dir: Vector;
    interest: number;
    danger: number;
    score: number;
  }[] = [];

  // 1. Initialize rays and map baseline downfield Interest
  const intentLen = length(baseIntent) || 1;
  const normIntent = {
    x: baseIntent.x / intentLen,
    y: baseIntent.y / intentLen,
  };

  for (let i = 0; i < NUM_RAYS; i++) {
    const angle = (i / NUM_RAYS) * Math.PI * 2;
    const rayDir = { x: Math.cos(angle), y: Math.sin(angle) };

    // Baseline interest aligns with general heading towards endzone
    let interest = rayDir.x * normIntent.x + rayDir.y * normIntent.y;

    // Severely penalize running backwards toward our own endzone
    if (rayDir.x < -0.2) {
      interest *= 0.1;
    }
    // Give a minor acceleration bias for pushing straight downfield
    if (rayDir.x > 0.1) {
      interest += 0.2;
    }

    rays.push({
      dir: rayDir,
      interest: Math.max(0, interest),
      danger: 0,
      score: 0,
    });
  }

  // 2. Project Danger weights from defenders inside lookup distance
  const defenders = state.players.filter(
    (p) => p.role === "rusher" || p.role === "coverer",
  );

  for (const defender of defenders) {
    const toDef = diff(defender.loc, player.loc);
    const distance = length(toDef);

    if (distance < lookAhead && distance > 0) {
      const normToDef = { x: toDef.x / distance, y: toDef.y / distance };

      // Threat intensity scales up exponentially as defender gets closer
      const proximity = (lookAhead - distance) / lookAhead;
      const urgency = Math.pow(proximity, 2);

      for (const ray of rays) {
        const dot = ray.dir.x * normToDef.x + ray.dir.y * normToDef.y;
        if (dot > 0) {
          // Cubing the dot product focuses threat weight inside a tighter corridor
          ray.danger += Math.pow(dot, 3) * urgency * 3.5;
        }
      }
    }
  }

  // 3. Keep runner inside field geometry bounds (Sideline Danger mitigation)
  const SIDELINE_CUSHION = 110;
  if (player.loc.y < SIDELINE_CUSHION) {
    const scale = (SIDELINE_CUSHION - player.loc.y) / SIDELINE_CUSHION;
    for (const ray of rays) {
      if (ray.dir.y < 0) {
        ray.danger += Math.abs(ray.dir.y) * scale * 3.0;
      }
    }
  } else if (player.loc.y > H - SIDELINE_CUSHION) {
    const scale = (player.loc.y - (H - SIDELINE_CUSHION)) / SIDELINE_CUSHION;
    for (const ray of rays) {
      if (ray.dir.y > 0) {
        ray.danger += ray.dir.y * scale * 3.0;
      }
    }
  }

  // 4. Subtract danger from interest and select the winning vector
  let bestRay = rays[0];
  let maxScore = -Infinity;

  for (const ray of rays) {
    ray.score = ray.interest - ray.danger;
    if (ray.score > maxScore) {
      maxScore = ray.score;
      bestRay = ray;
    }
  }

  // Attach metadata dynamically to player object for render visualization
  (player as any).contextRays = rays;
  (player as any).chosenRayDir = bestRay.dir;

  return bestRay.dir;
}

export { attemptTackle, stepAsPlayer };

import {
  ARRIVAL_RADIUS,
  BROKEN_TACKLE_BURST_DURATION,
  BROKEN_TACKLE_SPEED_BURST,
  H,
  LEAD_FRAMES,
  MIN_BLOCK_DISTANCE,
  PASSER_HANDOFF_SEPARATION,
  PIXELS_PER_STEP,
  PURSUER_STEER_FACTOR,
  ROUTE_BREAK_ANGLE_JITTER,
  RUSHER_STEER_FACTOR,
  TACKLE_PRESSURE_PER_FRAME,
  TOTAL_H,
  TOTAL_W,
  W,
} from "./constants";
import { getConstants } from "./ratings";
import { resetSimulation, resolveCollision, state } from "./simulate";
import { Player, State, Vector } from "./types";
import {
  closestPointOnSegment,
  diff,
  dist,
  getPocket,
  hitSideline,
  isCarryingBall,
  length,
  lerp,
  projectDefenderPosition,
} from "./util";

function stepAsPlayer(player: Player, state: State) {
  const isBlocking = !isCarryingBall(player, state.ball) && state.ballGiven;
  const isPassPlay = state.currentPlay.offense === "pass";
  const ballInAir = state.ballFlight && state.ballFlight.isInFlight;
  const ballIntendedForMe =
    state.ballFlight && state.ballFlight.receiver === player;
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
        runTowardsBall(player, state.ball.loc);
      } else if (isEarlyInRun) {
        runTowardsEndzone(player, steerAvoidStrength, player.runAngle);
      } else {
        runTowardsEndzone(player, avoidStrength);
      }
      break;
    }
    case "catcher": {
      if (isCarryingBall(player, state.ball)) {
        runTowardsEndzone(player, avoidStrength);
      } else if (isBlocking || state.currentPlay.offense === "run") {
        blockNearestDefender(player);
      } else if (ballInAir && ballIntendedForMe) {
        runTowardsBall(player, state.ballFlight!.endLoc);
      } else {
        runRoute(player);
      }

      break;
    }
    case "coverer": {
      if (ballInAir && state.ballFlight!.framesElapsed > 20) {
        runTowardsBall(player, state.ballFlight!.endLoc);
      } else if (!state.ballGiven && !ballInAir) {
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
    const { maxSpeed } = getConstants("SPEED", player);
    const isPassPlay = state.currentPlay.offense === "pass";

    // 1. Identify valid targets based on dynamic engine assignments
    const assignedDefender = state.blockingAssignments.get(player);

    // Pass-blocking runners look exclusively at rushers threatening the pocket.
    // Downfield block-shifters or linemen evaluate rushers and coverers.
    const defenders = assignedDefender
      ? [assignedDefender]
      : state.players.filter((p) => {
          if (player.role === "runner" && isPassPlay) {
            return p.role === "rusher";
          }
          return p.role === "rusher" || p.role === "coverer";
        });

    let targetLoc: Vector | null = null;

    // 2. PATH A: Passer Protection Constraints (Runners on Pass Plays)
    if (player.role === "runner" && isPassPlay) {
      const passer = state.players.find((p) => p.role === "passer");
      const anchorLoc = passer ? passer.loc : state.ball.loc;

      // Checks if an immediate thread has breached the pocket edge
      const activeThreat =
        assignedDefender || defenders.find((d) => dist(d.loc, anchorLoc) < 180);

      if (activeThreat) {
        // Intercept path to protect the pocket anchor
        let interceptPoint = closestPointOnSegment(
          player.loc,
          activeThreat.loc,
          anchorLoc,
        );

        // Enforce pocket boundary buffer
        if (dist(interceptPoint, anchorLoc) < MIN_BLOCK_DISTANCE) {
          const toDefender = diff(activeThreat.loc, anchorLoc);
          const d = length(toDefender) || 1;
          interceptPoint = {
            x: anchorLoc.x + (toDefender.x / d) * MIN_BLOCK_DISTANCE,
            y: anchorLoc.y + (toDefender.y / d) * MIN_BLOCK_DISTANCE,
          };
        }
        targetLoc = interceptPoint;
      } else {
        // POCKET SCAN POSITION: Stationed 35 pixels upfield (East) of the passer to wait for blitzers
        targetLoc = {
          x: anchorLoc.x + 35,
          y: anchorLoc.y,
        };
      }

      // 3. PATH B: Downfield Sealing & Inside Leverage Logic (Catchers or Running Backs on Run Plays)
    } else if (
      (player.role === "catcher" || player.role === "runner") &&
      !isPassPlay
    ) {
      // Locate the primary target to seal
      let targetDefender: Player | null = assignedDefender || null;
      if (!targetDefender) {
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
        const distanceToDefender = dist(player.loc, targetDefender.loc);

        // If they haven't engaged yet, shade dynamically to seal inside paths
        if (distanceToDefender > 30) {
          const fieldCenterY = H / 2;

          // Above centerline: shade DOWN (+Y). Below centerline: shade UP (-Y)
          const insideShadeDirection =
            targetDefender.loc.y < fieldCenterY ? 1 : -1;

          const UPFIELD_SEAL_X = 15; // Positioning allowance downfield (Ahead of defender)
          const INSIDE_SEAL_Y = 50; // Lateral buffer size to establish an inside wall

          targetLoc = {
            x: targetDefender.loc.x + UPFIELD_SEAL_X,
            y: targetDefender.loc.y + insideShadeDirection * INSIDE_SEAL_Y,
          };
        } else {
          // Close quarters: snap directly to tracking them to maintain contact engagement
          targetLoc = closestPointOnSegment(
            player.loc,
            targetDefender.loc,
            state.ball.loc,
          );
        }
      }

      // 4. PATH C: Traditional Interior/Line-Blocking (Standard Linemen/Interior Blockers)
    } else {
      const potentialBlocks = defenders.map((defender) => {
        let interceptPoint = closestPointOnSegment(
          player.loc,
          defender.loc,
          state.ball.loc,
        );

        if (dist(interceptPoint, state.ball.loc) < MIN_BLOCK_DISTANCE) {
          const toDefender = diff(defender.loc, state.ball.loc);
          const d = length(toDefender) || 1;
          interceptPoint = {
            x: state.ball.loc.x + (toDefender.x / d) * MIN_BLOCK_DISTANCE,
            y: state.ball.loc.y + (toDefender.y / d) * MIN_BLOCK_DISTANCE,
          };
        }

        const distToIntercept = dist(player.loc, interceptPoint);
        const threatIndex =
          dist(defender.loc, state.ball.loc) * 0.2 + distToIntercept;

        return { interceptPoint, threatIndex };
      });

      if (potentialBlocks.length > 0) {
        potentialBlocks.sort((a, b) => a.threatIndex - b.threatIndex);
        targetLoc = potentialBlocks[0].interceptPoint;
      }
    }

    // 5. Apply velocities toward the targeted tracking coordinate
    if (targetLoc) {
      const distToTarget = dist(player.loc, targetLoc);

      if (distToTarget < 3) {
        // Dead zone threshold prevents micro-jittering oscillations when set
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

  function runTowardsBall(player: Player, ball: Vector) {
    const toBall = diff(ball, player.loc);
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
    if (!player.route) return;
    if (!state.ballGiven) {
      player.path.push({ x: player.loc.x, y: player.loc.y });
    }

    // Fetch the shared velocity physics
    const res = getReceiverVelocityAtFrame(player, {
      absoluteFrame: state.steps,
      currentLocX: player.loc.x,
      currentLocY: player.loc.y,
      routeSideMultiplier: player.routeSideMultiplier,
      breakFrame: player.breakFrame,
      improvAngleRad: player.improvAngleRad,
    });

    // Persist properties exactly when entering the break state
    if (
      res.isBreaking &&
      (player.breakFrame === undefined || player.breakFrame === null)
    ) {
      player.breakFrame = state.steps;
      player.routeSideMultiplier = res.sideMultiplier;
    }

    player.vel.x = res.velX;
    player.vel.y = res.velY;
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
    const coverers = state.players.filter((p) => p.role === "coverer");
    const rushers = state.players.filter((p) => p.role === "rusher");
    const catchers = state.players.filter((p) => p.role === "catcher");

    const { minThrowStep } = getConstants("decisionMaking", player);
    const MIN_OPENNESS_NEEDED = 250;
    const INTERCEPTION_RADIUS = 18;

    const { panicRusherDist } = getConstants("pressureFeel", player);
    const nearestRusherDist =
      rushers.length > 0
        ? Math.min(...rushers.map((r) => dist(player.loc, r.loc)))
        : Infinity;
    const underPressure = nearestRusherDist < panicRusherDist;

    // Handle ball in air
    if (state.ballFlight && state.ballFlight.isInFlight) {
      state.ballFlight.framesElapsed++;

      // Handle ball done being in air
      if (state.ballFlight.framesElapsed == state.ballFlight.totalFrames) {
        // Check for interception
        for (const c of coverers) {
          if (dist(c.loc, state.ballFlight.endLoc) < INTERCEPTION_RADIUS) {
            resetSimulation("interception");
            return;
          }
        }

        // Check for completion
        const { completionRadius } = getConstants(
          "catchRadius",
          state.ballFlight.receiver,
        );
        if (
          dist(state.ballFlight.receiver.loc, state.ballFlight.endLoc) <
          completionRadius
        ) {
          state.ballFlight.isInFlight = false;
          state.ball.loc = { ...state.ballFlight.endLoc };
          state.ballGiven = true;
          state.ballGivenAtStep = state.steps;
          state.playAdvanced.catchX = state.ball.loc.x;
          state.playAdvanced.separationAtCatch = 0; // TODO
          return;
        }

        // Otherwise, incompletion
        resetSimulation("incomplete");
        return;
      }
    }

    // Evaluate all catchers by how open they will be
    const evaluatedOptions = catchers.map((catcher) => {
      const { target, projected, framesUntil, defenderDistAtArrival } =
        evaluateThrowWindow(player, catcher, state);
      const projectedOpenness = defenderDistAtArrival;
      const throwDist = dist(player.loc, target);
      return {
        catcher,
        target,
        projected,
        framesUntil,
        projectedOpenness,
        throwDist,
      };
    });

    const bestOption = evaluatedOptions.sort(
      (a, b) => b.projectedOpenness - a.projectedOpenness,
    )[0];

    // If passer ready and catcher open enough, make the throw
    if (
      bestOption.projectedOpenness > MIN_OPENNESS_NEEDED &&
      state.steps > minThrowStep &&
      state.ballFlight === null
    ) {
      console.log(bestOption);

      state.ballFlight = {
        startLoc: { ...state.ball.loc },
        endLoc: { ...bestOption.target },
        isInFlight: true,
        framesElapsed: 0,
        totalFrames: bestOption.framesUntil,
        receiver: bestOption.catcher,
      };
      state.playAdvanced.throwFrame = state.steps;
      state.playAdvanced.airYards = bestOption.target.x - state.scoreboard.LOS;
      state.playAdvanced.wasUnderPressure = underPressure;
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
    const { lateralStrength, lateralFreq } = getConstants("BEND", player);
    const { maxSpeed } = getConstants("SPEED", player);

    const isRunPlay = state.currentPlay.offense === "run";
    let targetLoc = { ...state.ball.loc };

    // GAP CONTAINMENT
    if (isRunPlay && state.ball.loc.x < state.scoreboard.LOS) {
      const playerIndex = state.players.indexOf(player);
      const isOuterRusher = playerIndex === 0 || playerIndex === 2;

      if (isOuterRusher) {
        targetLoc.x = state.scoreboard.LOS + 10;
      }
    }

    // Initialize random play seeds with proper type safety
    if (player.playRushSeed === undefined || player.playRushSeed === null) {
      player.playRushSeed = (Math.random() - 0.5) * 10.0;
      player.rushSpeedVariance = 0.93 + Math.random() * 0.14;
    }

    const playSeed = player.playRushSeed;
    const uniqueSpeed = maxSpeed * (player.rushSpeedVariance ?? 1.0);

    let toTarget = diff(targetLoc, player.loc);

    if (!isRunPlay) {
      toTarget.x += Math.sin(state.steps * 0.05 + playSeed) * 8;
      toTarget.y += Math.cos(state.steps * 0.05 + playSeed) * 8;
    }

    const d = length(toTarget);
    if (d === 0) return;

    const dirX = toTarget.x / d;
    const dirY = toTarget.y / d;

    let lateral = 0;
    if (!isRunPlay) {
      const phaseOffset = state.players.indexOf(player) * 2.1 + playSeed;
      lateral =
        Math.sin(state.steps * 0.166 * lateralFreq + phaseOffset) *
        lateralStrength;
    }

    const perpX = -dirY;
    const perpY = dirX;

    const speedModifier = player.contactedThisFrame ? 0.25 : 1.0;

    const targetVelX = (dirX + perpX * lateral) * uniqueSpeed * speedModifier;
    const targetVelY = (dirY + perpY * lateral) * uniqueSpeed * speedModifier;

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
    } = getConstants("PURSUIT", player);

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

    player.reactionTimer++;

    // 1. Get default engine target catcher
    let targetCatcher = getCovererTargetCatcher(player, state.players, state);

    const DEEP_ZONE_THRESHOLD = (W * 30) / 100; // 30 yards
    const isDeepSafety =
      player.zone!.x > state.scoreboard.LOS + DEEP_ZONE_THRESHOLD;

    // FIX: Track if the deep safety has actively identified an overriding deep route
    let hasDeepThreat = false;

    // 2. LEAK-PROOF DEEP SAFETY OVERRIDE
    if (player.coverage !== "man") {
      if (isDeepSafety) {
        const isCentered = Math.abs(player.zone!.y - H / 2) < 50;
        const catchers = state.players.filter(
          (p) => p.role === "catcher" && p.route,
        );

        // Find the absolute deepest route belonging to their side of assignment
        const deepOverrideTarget = catchers.reduce(
          (deepest, current) => {
            if (!isCentered) {
              const safetyIsTop = player.zone!.y < H / 2;
              const catcherStartedTop = current.loc.y < H / 2;

              // If the catcher didn't start on this safety's half of the formation, ignore them
              if (safetyIsTop !== catcherStartedTop) {
                return deepest;
              }
            }
            return current.loc.x > (deepest?.loc.x ?? -1) ? current : deepest;
          },
          null as Player | null,
        );

        // Force target lock if the threat has crossed the line of scrimmage area
        if (
          deepOverrideTarget &&
          deepOverrideTarget.loc.x > state.scoreboard.LOS
        ) {
          targetCatcher = deepOverrideTarget;
          hasDeepThreat = true; // FIX: Lock tracking parameter changes down
        }
      }
    }

    // 3. Process Perception Delays on the CORRECT targeted player
    if (player.perceivedLoc === null || player.reactionTimer >= reactionDelay) {
      if (player.reactionTimer < startDelay && player.perceivedLoc === null)
        return;

      updateCovererPerception(player, targetCatcher);
      player.reactionTimer = 0;
    }

    // 4. Dead-reckoning smooth extrapolation
    const baseLoc = player.perceivedLoc ?? targetCatcher?.loc ?? player.loc;
    const baseVel = player.perceivedVel ?? targetCatcher?.vel ?? { x: 0, y: 0 };

    const framesSinceUpdate = player.reactionTimer;
    const extrapolatedLoc = {
      x: baseLoc.x + baseVel.x * framesSinceUpdate,
      y: baseLoc.y + baseVel.y * framesSinceUpdate,
    };

    let targetPoint: Vector;

    if (targetCatcher) {
      if (player.coverage === "man") {
        const toBallX = state.ball.loc.x - extrapolatedLoc.x;
        const toBallY = state.ball.loc.y - extrapolatedLoc.y;
        const toBallDist =
          Math.sqrt(toBallX * toBallX + toBallY * toBallY) || 1;

        targetPoint = {
          x: extrapolatedLoc.x + (toBallX / toBallDist) * manCushion,
          y: extrapolatedLoc.y + (toBallY / toBallDist) * manCushion,
        };
      } else {
        // FIX: Use 1.0 ONLY if this is a deep safety facing an active deep vertical route threat.
        // If no deep threat is active, use the standard baseline zonePull to hold depth.
        const operationalPull = isDeepSafety && hasDeepThreat ? 1.0 : zonePull;

        targetPoint = {
          x:
            player.zone!.x +
            (extrapolatedLoc.x - player.zone!.x) * operationalPull,
          y:
            player.zone!.y +
            (extrapolatedLoc.y - player.zone!.y) * operationalPull,
        };
      }

      targetPoint.x += baseVel.x * LEAD_FRAMES;
      targetPoint.y += baseVel.y * LEAD_FRAMES;
    } else {
      targetPoint = player.zone ?? { ...player.loc };
    }

    // 5. Apply smooth steering forces toward targetPoint
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

  if (carrier.role === "passer" && !state.ballFlight?.isInFlight) {
    resetSimulation("sack");
    return;
  } else if (carrier.role === "passer") {
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
  coverer: Player,
  players: Player[],
  state: State,
): Player | null {
  if (coverer.coverage === "man") {
    return coverer.assignedTarget || null;
  }
  if (coverer.coverage === "zone") {
    if (!coverer.zone) {
      console.warn("Zone defender has no zone?");
      return null;
    }
    const catchers = players.filter((p) => p.role === "catcher");
    if (catchers.length === 0) return null;

    const DEEP_ZONE_THRESHOLD = (W * 30) / 100;
    const isDeepSafety =
      coverer.zone.x > state.scoreboard.LOS + DEEP_ZONE_THRESHOLD;

    if (isDeepSafety) {
      const isCentered = Math.abs(coverer.zone.y - H / 2) < 50;
      const relevantCatchers = isCentered
        ? catchers
        : catchers.filter((c) =>
            coverer.zone!.y < H / 2 ? c.loc.y < H / 2 : c.loc.y >= H / 2,
          );
      const candidates =
        relevantCatchers.length > 0 ? relevantCatchers : catchers;

      // Deepest route takes priority, regardless of distance to zone center
      candidates.sort((a, b) => b.loc.x - a.loc.x);
      return candidates[0];
    }

    catchers.sort(
      (a, b) => dist(coverer.zone!, a.loc) - dist(coverer.zone!, b.loc),
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

function calculatePerfectThrowTarget(
  passer: Player,
  receiver: Player,
  state: State,
): { framesUntil: number; target: Vector; projected: Vector } {
  const PIXELS_PER_YARD = W / 100;
  const YARDS_PER_METER = 1.09361;
  const PIXELS_PER_METER = PIXELS_PER_YARD * YARDS_PER_METER;

  const { ballMetersPerSecond } = getConstants("throwPower", passer);
  const updatedBMPS = ballMetersPerSecond + 6;
  const ballPixelsPerFrame = (updatedBMPS * PIXELS_PER_METER) / 60;

  // 1. GENERATE THE RECEIVER'S FUTURE PATH TIMELINE
  const MAX_PREDICTION_FRAMES = 180;
  // TODO: Fix corner route from being underthrown
  const receiverTimeline = predictReceiverRoute(passer, receiver, state);

  // 2. DEFINE BOUNDARY LIMITS (With a ~1-yard safety margin away from lines)
  const BOUNDARY_MARGIN = PIXELS_PER_YARD;
  const MIN_PLAYABLE_X = BOUNDARY_MARGIN;
  const MAX_PLAYABLE_X = TOTAL_W - BOUNDARY_MARGIN;
  const MIN_PLAYABLE_Y = BOUNDARY_MARGIN;
  const MAX_PLAYABLE_Y = TOTAL_H - BOUNDARY_MARGIN;

  // 3. SCAN THE TIMELINE TO FIND THE ANTICIPATED INTERCEPTION SPOT
  for (let frame = 1; frame <= MAX_PREDICTION_FRAMES; frame++) {
    const projectedSpot = receiverTimeline[frame - 1]; // Array is 0-indexed
    if (!projectedSpot) break;

    const isOutOfBounds =
      projectedSpot.x < MIN_PLAYABLE_X ||
      projectedSpot.x > MAX_PLAYABLE_X ||
      projectedSpot.y < MIN_PLAYABLE_Y ||
      projectedSpot.y > MAX_PLAYABLE_Y;

    // If the path drifted out of bounds, clip this individual frame position to the bounds
    const clampedSpot: Vector = {
      x: Math.max(MIN_PLAYABLE_X, Math.min(MAX_PLAYABLE_X, projectedSpot.x)),
      y: Math.max(MIN_PLAYABLE_Y, Math.min(MAX_PLAYABLE_Y, projectedSpot.y)),
    };

    const travelDistance = dist(passer.loc, clampedSpot);
    const ballTravelFrames = travelDistance / ballPixelsPerFrame;

    // A mathematically valid interception point
    if (ballTravelFrames <= frame) {
      return {
        framesUntil: frame,
        target: clampedSpot,
        projected: projectedSpot,
      };
    }
  }

  // Fallback to the furthest predicted spot clamped cleanly inside bounds
  const rawFallback =
    receiverTimeline[receiverTimeline.length - 1] ?? receiver.loc;
  const clampedFallback: Vector = {
    x: Math.max(MIN_PLAYABLE_X, Math.min(MAX_PLAYABLE_X, rawFallback.x)),
    y: Math.max(MIN_PLAYABLE_Y, Math.min(MAX_PLAYABLE_Y, rawFallback.y)),
  };

  return {
    framesUntil: receiverTimeline.length,
    target: clampedFallback,
    projected: rawFallback,
  };
}

interface RouteVelocityContext {
  absoluteFrame: number;
  currentLocX: number; // Added to trace X-axis position safely
  currentLocY: number;
  routeSideMultiplier: 1 | -1 | null;
  breakFrame: number | null;
  improvAngleRad: number | null; // Added tracking field
}

function getReceiverVelocityAtFrame(
  receiver: Player,
  ctx: RouteVelocityContext,
): {
  velX: number;
  velY: number;
  sideMultiplier: 1 | -1 | null;
  isBreaking: boolean;
  improvAngleRad: number | null;
} {
  const { maxSpeed } = getConstants("SPEED", receiver);

  if (!receiver.route) {
    return {
      velX: 0,
      velY: 0,
      sideMultiplier: 1,
      isBreaking: false,
      improvAngleRad: null,
    };
  }

  // Ensure we compute currentLoc accurately for both phases
  const currentLoc = { x: ctx.currentLocX, y: ctx.currentLocY };

  const routeBreakThreshold = Math.floor(
    (receiver.route.steps * PIXELS_PER_STEP) / maxSpeed,
  );

  // 1) STEM PHASE
  if (ctx.absoluteFrame < routeBreakThreshold) {
    return {
      velX: maxSpeed,
      velY: getCatcherRouteVariance(receiver).stemDrift,
      sideMultiplier:
        ctx.routeSideMultiplier ?? (ctx.currentLocY < H / 2 ? 1 : -1),
      isBreaking: false,
      improvAngleRad: null,
    };
  }

  const sideMultiplier =
    ctx.routeSideMultiplier ?? (ctx.currentLocY < H / 2 ? 1 : -1);

  // --- FIX: Pass the moving currentLoc here instead of the live receiver object ---
  const isTriggeredByTime = state.steps > 300;
  const isTriggeredByWall =
    receiver.improvAngleRad ||
    ctx.improvAngleRad !== null ||
    hitSideline(currentLoc);

  if (isTriggeredByTime || isTriggeredByWall) {
    const baseVelX = receiver.vel.x || maxSpeed;
    const baseVelY = receiver.vel.y || 0;

    const improv = getImprovisedVelocity(
      receiver,
      currentLoc,
      state.scoreboard.LOS,
      baseVelX,
      baseVelY,
      maxSpeed,
    );

    return {
      velX: improv.velX,
      velY: improv.velY,
      sideMultiplier: sideMultiplier,
      isBreaking: false,
      improvAngleRad: ctx.improvAngleRad ?? improv.angleRad,
    };
  }

  // 2) BREAK PHASE
  const { angleOffset } = getCatcherRouteVariance(receiver);
  const finalBreakAngleRad =
    (receiver.route.breakAngle + angleOffset) *
    sideMultiplier *
    (Math.PI / 180);

  const activeBreakFrame = ctx.breakFrame ?? routeBreakThreshold;
  const framesSinceBreak = ctx.absoluteFrame - activeBreakFrame;
  let currentSpeed = maxSpeed;

  const {
    stopAfterBreakThreshold,
    routeCutSpeedRetained,
    reaccelerationDuration,
  } = getConstants("routeRunning", receiver);

  if (framesSinceBreak <= reaccelerationDuration) {
    const progress = framesSinceBreak / reaccelerationDuration;
    currentSpeed = maxSpeed * lerp(progress, routeCutSpeedRetained, 1.0);
  }

  let velX = Math.cos(finalBreakAngleRad) * currentSpeed;
  let velY = Math.sin(finalBreakAngleRad) * currentSpeed;

  if (
    receiver.route.stopAfterBreak &&
    ctx.absoluteFrame > routeBreakThreshold + stopAfterBreakThreshold
  ) {
    velX *= 0.3;
    velY *= 0.3;
  }

  return { velX, velY, sideMultiplier, isBreaking: true, improvAngleRad: null };
}

function getImprovisedVelocity(
  receiver: Player,
  currentLoc: Vector,
  LOS: number,
  incomingVelX: number,
  incomingVelY: number,
  currentSpeed: number,
): { velX: number; velY: number; angleRad: number } {
  const BOUNDARY_MARGIN = W / 100;
  const hitTop = currentLoc.y <= BOUNDARY_MARGIN;
  const hitBottom = currentLoc.y >= TOTAL_H - BOUNDARY_MARGIN;
  const hitLeft = currentLoc.x <= LOS;
  const hitRight = currentLoc.x >= TOTAL_W - BOUNDARY_MARGIN;

  let angleRad =
    receiver.improvAngleRad ?? Math.atan2(incomingVelY, incomingVelX);

  const SPREAD = 35 * (Math.PI / 180); // Slightly narrowed to prevent spinning back into the same wall
  const randomJitter = (Math.random() * 2 - 1) * SPREAD;

  // 1. CORNER DETECTIONS (Highest Priority Overrides)
  if (hitRight && hitTop) {
    // Back-Right Corner -> Escape diagonally down and left (135 degrees)
    angleRad = (135 * Math.PI) / 180 + randomJitter * 0.5;
  } else if (hitRight && hitBottom) {
    // Front-Right Corner -> Escape diagonally up and left (-135 degrees)
    angleRad = (-135 * Math.PI) / 180 + randomJitter * 0.5;
  } else if (hitLeft && hitTop) {
    // Back-Left Corner -> Escape diagonally down and right (45 degrees)
    angleRad = (45 * Math.PI) / 180 + randomJitter * 0.5;
  } else if (hitLeft && hitBottom) {
    // Front-Left Corner -> Escape diagonally up and right (-45 degrees)
    angleRad = (-45 * Math.PI) / 180 + randomJitter * 0.5;
  }
  // 2. STANDARD WALL DETECTIONS
  else if (hitRight) {
    angleRad = Math.PI + randomJitter; // back toward left
  } else if (hitLeft) {
    angleRad = 0 + randomJitter; // back toward right
  } else if (hitBottom) {
    angleRad = -Math.PI / 2 + randomJitter; // back toward top
  } else if (hitTop) {
    angleRad = Math.PI / 2 + randomJitter; // back toward bottom
  }

  return {
    velX: Math.cos(angleRad) * currentSpeed,
    velY: Math.sin(angleRad) * currentSpeed,
    angleRad,
  };
}

function predictReceiverRoute(
  passer: Player,
  receiver: Player,
  state: State,
): Vector[] {
  if (!receiver.route) return [];

  const MAX_PREDICTION_FRAMES = 300;
  const receiverTimeline: Vector[] = [];
  let currentSimulatedLoc = { ...receiver.loc };

  let simulatedBreakFrame = receiver.breakFrame;
  let simulatedSideMultiplier = receiver.routeSideMultiplier;
  let simulatedImprovAngle = receiver.improvAngleRad; // Track the heading look-ahead

  for (let frame = 1; frame <= MAX_PREDICTION_FRAMES; frame++) {
    const absoluteFrame = state.steps + frame;

    const res = getReceiverVelocityAtFrame(receiver, {
      absoluteFrame,
      currentLocX: currentSimulatedLoc.x,
      currentLocY: currentSimulatedLoc.y,
      routeSideMultiplier: simulatedSideMultiplier,
      breakFrame: simulatedBreakFrame,
      improvAngleRad: simulatedImprovAngle, // Persist across timeline iterations
    });

    if (res.improvAngleRad !== null && simulatedImprovAngle === null) {
      simulatedImprovAngle = res.improvAngleRad; // Lock simulation angle
    }

    if (
      res.isBreaking &&
      (simulatedBreakFrame === undefined || simulatedBreakFrame === null)
    ) {
      simulatedBreakFrame = absoluteFrame;
      simulatedSideMultiplier = res.sideMultiplier;
    }

    currentSimulatedLoc.x += res.velX;
    currentSimulatedLoc.y += res.velY;
    receiverTimeline.push({ ...currentSimulatedLoc });
  }

  return receiverTimeline;
}

function evaluateThrowWindow(
  passer: Player,
  catcher: Player,
  state: State,
): {
  target: Vector;
  projected: Vector;
  framesUntil: number;
  defenderDistAtArrival: number;
} {
  const { framesUntil, target, projected } = calculatePerfectThrowTarget(
    passer,
    catcher,
    state,
  );

  // Project every relevant defender forward by flightFrames using simple linear extrapolation
  const defenders = state.players.filter(
    (p) => p.role === "coverer" || p.role === "rusher",
  );
  const defenderDistAtArrival =
    defenders.length > 0
      ? Math.min(
          ...defenders.map((cov) => {
            const projected = projectDefenderPosition(cov, framesUntil);
            return dist(projected, target);
          }),
        )
      : Infinity;

  return { target, projected, framesUntil, defenderDistAtArrival };
}

export {
  attemptTackle,
  calculatePerfectThrowTarget,
  predictReceiverRoute,
  stepAsPlayer,
};

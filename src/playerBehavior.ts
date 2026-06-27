import {
  ARRIVAL_RADIUS,
  BROKEN_TACKLE_BURST_DURATION,
  BROKEN_TACKLE_SPEED_BURST,
  H,
  LEAD_FRAMES,
  MIN_BLOCK_DISTANCE,
  PANIC_RUSHER_DIST,
  PANIC_THROW_CHANCE,
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
import {
  cornerRoute,
  flatRoute,
  outRoute,
  Player,
  State,
  Vector,
} from "./types";
import {
  clampPosInBounds,
  closestPointOnSegment,
  diff,
  dist,
  getPocket,
  isCarryingBall,
  isPassPlay,
  isRunPlay,
  length,
  lerp,
  nearSideline,
  projectDefenderPosition,
} from "./util";

const MAX_PATH_LENGTH = 200; // Cap path arrays to prevent render bloat
const THROW_EVAL_INTERVAL = 6; // QB evaluates throws every 6 frames (~0.1s)
const MAX_PREDICTION_FRAMES = 120; // Reduced from 300. 2 seconds is plenty.

function stepAsPlayer(
  player: Player,
  state: State,
  cachedPlayers: {
    rushers: Player[];
    coverers: Player[];
    catchers: Player[];
    blockers: Player[];
  },
) {
  const isBlocking = !isCarryingBall(player, state.ball) && state.ballGiven;
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

      if (isBlocking || isPassPlay(state)) {
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
      } else if (isBlocking || isRunPlay(state)) {
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

    // 1. Identify valid targets based on dynamic engine assignments
    const assignedDefender = state.blockingAssignments.get(player);

    // Pass-blocking runners look exclusively at rushers threatening the pocket.
    // Downfield block-shifters or linemen evaluate rushers and coverers.
    const defenders = assignedDefender
      ? [assignedDefender]
      : player.role === "runner" && isPassPlay(state)
        ? cachedPlayers.rushers
        : [...cachedPlayers.rushers, ...cachedPlayers.coverers];

    let targetLoc: Vector | null = null;

    // 2. PATH A: Passer Protection Constraints (Runners on Pass Plays)
    if (player.role === "runner" && isPassPlay(state)) {
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
      "CATCHACCELERATION",
      player,
    );

    // CRITICAL PATH FIX: Push a DEEP COPY of player position coordinates.
    // Pushing 'player.loc' passes an object reference, causing every point in the history
    // array to match current coordinates simultaneously, which blanks out the line!
    if (!player.path) player.path = [];
    player.path.push({ x: player.loc.x, y: player.loc.y });
    if (player.path.length > MAX_PATH_LENGTH) player.path.shift();

    // 1. OVERRIDE TARGET DIRECTION VIA CONTEXT STEERING MAP
    const optimizedTargetDir = getContextSteering(
      player,
      state,
      targetDir,
      cachedPlayers,
    );

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
      if (!player.path) player.path = [];
      player.path.push({ x: player.loc.x, y: player.loc.y });
      if (player.path.length > MAX_PATH_LENGTH) player.path.shift();
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
      getConstants("POCKETPRESENCE", player);

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

    const rushers = cachedPlayers.rushers;
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
    const coverers = cachedPlayers.coverers;
    const rushers = cachedPlayers.rushers;
    const catchers = cachedPlayers.catchers;
    const { minThrowStep, minOpennessNeeded, panicOpennessNeeded } =
      getConstants("DECISIONMAKING", player);
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

        const { target, framesUntil, defenderDistAtArrival } = throwWindowRes;
        return {
          catcher,
          target,
          framesUntil,
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

      // How long the QB has been holding the ball this play, in frames since the snap
      const holdingFrames = state.steps;
      // Ramp 0→1 over a few seconds of holding under pressure — the longer he's
      // been in the pocket with a rusher closing, the more desperate he gets
      const HOLD_RAMP_FRAMES = 150; // ~1.5s at 60fps to reach max desperation
      const holdFactor = Math.min(1, holdingFrames / HOLD_RAMP_FRAMES);

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
      const PIXELS_PER_METER = (W / 100) * 1.09361;
      const ballPixelsPerFrame = (ballMetersPerSecond * PIXELS_PER_METER) / 60;
      const flightFrames = Math.ceil(
        dist(player.loc, throwAwayTarget) / ballPixelsPerFrame,
      );

      state.ballFlight = {
        startLoc: { ...state.ball.loc },
        endLoc: throwAwayTarget,
        isInFlight: true,
        framesElapsed: 0,
        totalFrames: flightFrames,
        receiver: null,
      };

      state.playAdvanced.throwFrame = state.steps;
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
      framesElapsed: 0,
      totalFrames: bestOption.framesUntil,
      receiver: bestOption.catcher,
    };

    state.playAdvanced.throwFrame = state.steps;
    state.playAdvanced.airYards =
      physicalBallDestination.x - state.scoreboard.LOS;
    state.playAdvanced.wasUnderPressure = underPressure;
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
    let targetLoc = { ...state.ball.loc };

    // Determine if this is an edge rusher by label
    const isEdgeRusher = player.label === "LE" || player.label === "RE";

    // Gap containment on run plays (existing logic)
    if (isRunPlay(state) && state.ball.loc.x < state.scoreboard.LOS) {
      const playerIndex = state.players.indexOf(player);
      const isOuterRusher = playerIndex === 0 || playerIndex === 2;
      if (isOuterRusher) {
        targetLoc.x = state.scoreboard.LOS + 10;
      }
    }

    // EDGE BEND: push the target point outside on pass rush so the rusher
    // arcs around the tackle rather than running straight into them.
    // The bend collapses toward the ball as the rusher passes the LOS.
    if (isEdgeRusher && !isRunPlay(state)) {
      const EDGE_CONTAIN_OFFSET = 120;
      const scaledOffset = EDGE_CONTAIN_OFFSET * lateralStrength;
      const outsideDir = player.label === "LE" ? -1 : 1;

      // Collapse based on distance TO the ball rather than distance past LOS —
      // this ensures the arc fully resolves before the rusher arrives, not after
      const distToBall = dist(player.loc, state.ball.loc);
      const COLLAPSE_START = (12 / 100) * W; // start collapsing at 12 yards from ball
      const COLLAPSE_END = (4 / 100) * W; // fully collapsed at 4 yards from ball

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
      toTarget.x += Math.sin(state.steps * 0.05 + playSeed) * 8;
      toTarget.y += Math.cos(state.steps * 0.05 + playSeed) * 8;
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
    const speedModifier = player.contactedThisFrame ? 0.25 : 1.0;
    const targetVelX = (dirX + perpX * lateral) * uniqueSpeed * speedModifier;
    const targetVelY = (dirY + perpY * lateral) * uniqueSpeed * speedModifier;
    player.vel.x += (targetVelX - player.vel.x) * RUSHER_STEER_FACTOR;
    player.vel.y += (targetVelY - player.vel.y) * RUSHER_STEER_FACTOR;
  }

  function pursueBallCarrier(player: Player) {
    const { manStartDelay } = getConstants("MANCOVERAGE", player);
    const { zoneStartDelay } = getConstants("ZONECOVERAGE", player);
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
    const { maxSpeed } = getConstants("SPEED", player);
    const { manStartDelay, reactionDelay, manCushion } = getConstants(
      "MANCOVERAGE",
      player,
    );
    const { zonePull, zoneStartDelay } = getConstants("ZONECOVERAGE", player);

    const startDelay =
      player.coverage === "man" ? manStartDelay : zoneStartDelay;
    player.reactionTimer++;

    // 1. TARGET ACQUISITION
    let targetCatcher: Player | null = null;
    const catchers = cachedPlayers.catchers;

    let isDeepOverrideActive = false;
    const DEEP_THRESHOLD = state.scoreboard.LOS + (W * 30) / 100; // 30 yards past LOS

    if (player.coverage === "man") {
      targetCatcher = catchers.find((p) => p === player.assignedTarget) || null;
    } else if (catchers.length > 0) {
      const deepThreats = catchers.filter((c) => c.loc.x > DEEP_THRESHOLD);

      if (deepThreats.length > 0) {
        // Someone is deeper than 30 yards -> Target the absolute deepest receiver
        targetCatcher = deepThreats.reduce((deepest, current) =>
          current.loc.x > deepest.loc.x ? current : deepest,
        );
        isDeepOverrideActive = true;
      } else {
        // Nobody past 30 yards -> Target the nearest receiver to the zone anchor point
        const anchor = player.zone ?? player.loc;
        targetCatcher = catchers.reduce((closest, current) =>
          dist(anchor, current.loc) < dist(anchor, closest.loc)
            ? current
            : closest,
        );
      }
    }

    // 2. PERCEPTION DELAY
    if (player.perceivedLoc === null || player.reactionTimer >= reactionDelay) {
      if (player.reactionTimer < startDelay && player.perceivedLoc === null)
        return;
      updateCovererPerception(player, targetCatcher);
      player.reactionTimer = 0;
    }

    // 3. EXTRAPOLATION
    const baseLoc = player.perceivedLoc ?? targetCatcher?.loc ?? player.loc;
    const baseVel = player.perceivedVel ?? targetCatcher?.vel ?? { x: 0, y: 0 };
    const extrapolatedLoc = {
      x: baseLoc.x + baseVel.x * player.reactionTimer,
      y: baseLoc.y + baseVel.y * player.reactionTimer,
    };

    // 4. POSITION TARGETING & CONSERVATIVE OVERRIDE
    let targetPoint: Vector = player.zone ?? { ...player.loc };

    if (targetCatcher) {
      if (player.coverage === "man") {
        // Left exactly the same as requested
        const toBallX = state.ball.loc.x - extrapolatedLoc.x;
        const toBallY = state.ball.loc.y - extrapolatedLoc.y;
        const toBallDist =
          Math.sqrt(toBallX * toBallX + toBallY * toBallY) || 1;
        targetPoint = {
          x:
            extrapolatedLoc.x +
            (toBallX / toBallDist) * manCushion +
            baseVel.x * LEAD_FRAMES,
          y:
            extrapolatedLoc.y +
            (toBallY / toBallDist) * manCushion +
            baseVel.y * LEAD_FRAMES,
        };
      } else {
        // ZONE COVERAGE ENHANCEMENT:
        // If the targeted catcher has a predicted throw location, blend their
        // extrapolated position with the throw target so the defender undercuts or fields the ball path.
        let coverageFocusX = extrapolatedLoc.x;
        let coverageFocusY = extrapolatedLoc.y;

        if (
          targetCatcher.predictedTargets !== null &&
          targetCatcher.predictedTargets.length > 0
        ) {
          const target =
            targetCatcher.predictedTargets[
              Math.floor(targetCatcher.predictedTargets.length / 2)
            ];
          // Shift focus halfway towards the anticipated throw spot to cheat toward the target
          coverageFocusX = (coverageFocusX + target.x) / 2;
          coverageFocusY = (coverageFocusY + target.y) / 2;
        }

        if (isDeepOverrideActive) {
          // EXTRA CONSERVATIVE DEEP ZONE MODE:
          // Position downfield/in front of the anticipated pass focus zone by a protective cushion
          const CONSERVATIVE_CUSHION = (W * 7) / 100;

          targetPoint = {
            x: coverageFocusX + CONSERVATIVE_CUSHION + baseVel.x * LEAD_FRAMES,
            y: coverageFocusY + baseVel.y * LEAD_FRAMES,
          };
        } else {
          // STANDARD UNDERNEATH/INTERMEDIATE ZONE MODE:
          // Pull towards the enhanced coverage tracking position relative to their zone marker
          targetPoint = {
            x:
              player.zone!.x +
              (coverageFocusX - player.zone!.x) * zonePull +
              baseVel.x * LEAD_FRAMES,
            y:
              player.zone!.y +
              (coverageFocusY - player.zone!.y) * zonePull +
              baseVel.y * LEAD_FRAMES,
          };
        }
      }
    }

    // 5. MOTOR/STEERING FORCES
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
  const { routeStemDrift } = getConstants("ROUTERUNNING", player);
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
  player: Player,
  players: Player[],
  state: State,
): Player | null {
  // 1. Man Coverage Target Resolution
  if (player.coverage === "man") {
    if (!player.assignedTarget) return null;
    return (
      players.find(
        (p) => p.role === "catcher" && p === player.assignedTarget,
      ) || null
    );
  }

  // 2. Zone Coverage Base Setup
  const catchers = players.filter((p) => p.role === "catcher" && p.route);
  if (catchers.length === 0) return null;

  const DEEP_ZONE_THRESHOLD = (W * 30) / 100; // 30 yards downfield
  const isDeepSafety =
    player.zone && player.zone.x > state.scoreboard.LOS + DEEP_ZONE_THRESHOLD;

  // 3. Deep Zone Specialty Target Acquisition
  if (isDeepSafety && player.zone) {
    const isCentered = Math.abs(player.zone.y - H / 2) < 50;
    const VERTICAL_THREAT_DEPTH = (W * 12) / 100; // 12 yards past line of scrimmage

    // Filter down to catchers who pose a genuine vertical threat to this safety's assignment area
    const validDeepThreats = catchers.filter((catcher) => {
      // Field half/third validation for non-center fielders
      if (!isCentered) {
        const safetyIsTop = player.zone!.y < H / 2;
        const catcherStartedTop = catcher.loc.y < H / 2;

        if (safetyIsTop !== catcherStartedTop) {
          return false;
        }
      }

      // The receiver must cross the minimum depth threshold to be treated as an active deep threat
      return catcher.loc.x > state.scoreboard.LOS + VERTICAL_THREAT_DEPTH;
    });

    // If no receivers have broken deep into their half of the field, return null.
    // This safely forces the cover loop to fall back to anchoring perfectly to their zone coordinates.
    if (validDeepThreats.length === 0) {
      return null;
    }

    // Out of all valid vertical threats, lock on to the deepest one
    return validDeepThreats.reduce((deepest, current) => {
      return current.loc.x > (deepest?.loc.x ?? -1) ? current : deepest;
    });
  }

  // 4. Standard Underneath/Intermediate Zone Target Acquisition
  // Finds the closest eligible catcher relative to the center of the assigned zone marker
  let closestCatcher: Player | null = null;
  let minDistance = Infinity;
  const anchorPoint = player.zone ?? player.loc;

  for (const catcher of catchers) {
    const d = dist(anchorPoint, catcher.loc);
    if (d < minDistance) {
      minDistance = d;
      closestCatcher = catcher;
    }
  }

  return closestCatcher;
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
  cachedPlayers: {
    rushers: Player[];
    coverers: Player[];
    catchers: Player[];
    blockers: Player[];
  },
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
  const checkDefender = (defender: Player) => {
    const toDef = diff(defender.loc, player.loc);
    const distance = length(toDef);
    if (distance < lookAhead && distance > 0) {
      const normToDef = { x: toDef.x / distance, y: toDef.y / distance };
      const proximity = (lookAhead - distance) / lookAhead;
      const urgency = Math.pow(proximity, 2);

      for (const ray of rays) {
        const dot = ray.dir.x * normToDef.x + ray.dir.y * normToDef.y;
        if (dot > 0) ray.danger += Math.pow(dot, 3) * urgency * 3.5;
      }
    }
  };

  for (const r of cachedPlayers.rushers) checkDefender(r);
  for (const c of cachedPlayers.coverers) checkDefender(c);

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
): {
  framesUntilLand: number;
  framesUntilBreak: number;
  target: Vector;
} | null {
  const PIXELS_PER_YARD = W / 100;
  const YARDS_PER_METER = 1.09361;
  const PIXELS_PER_METER = PIXELS_PER_YARD * YARDS_PER_METER;

  const { ballMetersPerSecond } = getConstants("THROWPOWER", passer);
  const updatedBMPS = ballMetersPerSecond;
  const ballPixelsPerFrame = (updatedBMPS * PIXELS_PER_METER) / 60;

  const MAX_PREDICTION_FRAMES = 180;
  const { timeline: receiverTimeline, framesUntilBreak } = predictReceiverRoute(
    passer,
    receiver,
    state,
  );

  const BOUNDARY_MARGIN = PIXELS_PER_YARD;
  const MIN_PLAYABLE_X = BOUNDARY_MARGIN;
  const MAX_PLAYABLE_X = TOTAL_W - BOUNDARY_MARGIN;
  const MIN_PLAYABLE_Y = BOUNDARY_MARGIN;
  const MAX_PLAYABLE_Y = TOTAL_H - BOUNDARY_MARGIN;

  // Fetch the receiver's catch radius so we know what "catchable" means
  const { completionRadius } = getConstants("CATCHRADIUS", receiver);

  // 1. COLLECT ALL CATCHABLE TARGETS
  const catchableTargets: {
    frame: number;
    target: Vector;
  }[] = [];

  for (let frame = 1; frame <= MAX_PREDICTION_FRAMES; frame++) {
    const projectedSpot = receiverTimeline[frame - 1];
    if (!projectedSpot) break;

    // Clip target to field boundaries
    const clampedSpot: Vector = clampPosInBounds(projectedSpot);

    // Calculate how many frames it takes the ball to reach this specific clamped spot
    const travelDistance = dist(passer.loc, clampedSpot);
    const ballTravelFrames = travelDistance / ballPixelsPerFrame;
    const arrivalFrame = Math.round(ballTravelFrames);

    // Ensure the ball's arrival time falls within our prediction timeline
    if (arrivalFrame >= 1 && arrivalFrame <= MAX_PREDICTION_FRAMES) {
      // Look up where the receiver will ACTUALLY be at the exact frame the ball lands
      const actualReceiverSpotAtArrival = receiverTimeline[arrivalFrame - 1];

      if (actualReceiverSpotAtArrival) {
        // The pass is only completable if the landing spot is within the
        // receiver's catch radius at the exact moment of ball arrival.
        const separation = dist(clampedSpot, actualReceiverSpotAtArrival);

        if (separation <= completionRadius) {
          catchableTargets.push({
            frame: arrivalFrame, // The timeline index where this throw was targeted
            target: clampedSpot,
          });
        }
      }
    }
  }

  // 2. RETURN THE MIDDLE FRAMED TARGET
  if (catchableTargets.length > 10) {
    const index = Math.round(catchableTargets.length / 2);
    const middleTarget = catchableTargets[index];
    receiver.predictedTargets = catchableTargets.map((target) => target.target);

    return {
      framesUntilLand: middleTarget.frame - 5,
      target: middleTarget.target,
      framesUntilBreak,
    };
  }

  // 3. FALLBACK: If no catchable window was found, don't throw
  receiver.predictedTargets = null;
  return null;
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

  const routeBreakThreshold =
    ctx.breakFrame ??
    Math.floor((receiver.route.steps * PIXELS_PER_STEP) / maxSpeed);

  // 1) STEM PHASE
  if (ctx.absoluteFrame < routeBreakThreshold) {
    if (nearSideline(receiver.loc)) {
      return {
        velX: 0,
        velY: 0,
        sideMultiplier:
          ctx.routeSideMultiplier ?? (ctx.currentLocY < H / 2 ? 1 : -1),
        isBreaking: false,
        improvAngleRad: null,
      };
    }

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
  const isTriggeredByTime = state.steps > 200;
  // const isTriggeredByWall =
  //   receiver.improvAngleRad ||
  //   ctx.improvAngleRad !== null ||
  //   hitSideline(currentLoc);

  if (isTriggeredByTime) {
    if (ctx.improvAngleRad !== null) {
      return {
        velX: Math.cos(ctx.improvAngleRad) * maxSpeed,
        velY: Math.sin(ctx.improvAngleRad) * maxSpeed,
        sideMultiplier: sideMultiplier,
        isBreaking: false,
        improvAngleRad: ctx.improvAngleRad,
      };
    }

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
  } = getConstants("ROUTERUNNING", receiver);

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
): { timeline: Vector[]; framesUntilBreak: number } {
  if (!receiver.route) return { timeline: [], framesUntilBreak: 0 };

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

    const clampedLoc = clampPosInBounds(currentSimulatedLoc);
    receiverTimeline.push({ ...clampedLoc });
  }

  return {
    timeline: receiverTimeline,
    framesUntilBreak: (simulatedBreakFrame ?? state.steps) - state.steps,
  };
}

function evaluateThrowWindow(
  passer: Player,
  catcher: Player,
  state: State,
  cachedPlayers: {
    rushers: Player[];
    coverers: Player[];
    catchers: Player[];
    blockers: Player[];
  },
): {
  target: Vector;
  framesUntil: number;
  defenderDistAtArrival: number;
} | null {
  const throwTargetRes = calculatePerfectThrowTarget(passer, catcher, state);
  if (throwTargetRes === null) return null;

  const { framesUntilLand, target, framesUntilBreak } = throwTargetRes;

  // Project every relevant defender forward by flightFrames using simple linear extrapolation
  const defenders = [...cachedPlayers.rushers, ...cachedPlayers.coverers];
  const defenderDistAtArrival =
    defenders.length > 0
      ? Math.min(
          ...defenders.map((cov) => {
            const projected = projectDefenderPosition(cov, framesUntilLand);
            return dist(projected, target);
          }),
        )
      : Infinity;

  return { target, framesUntil: framesUntilLand, defenderDistAtArrival };
}

function resolveBallInAir(
  state: State,
  cachedPlayers: {
    rushers: Player[];
    coverers: Player[];
    catchers: Player[];
    blockers: Player[];
  },
) {
  const { ballFlight } = state;
  if (!ballFlight || !ballFlight.isInFlight) return;

  ballFlight.framesElapsed++;

  if (ballFlight.framesElapsed >= ballFlight.totalFrames) {
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
      completePass(state, receiver, endLoc, cachedPlayers);
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

// Helper to clean up state on a successful catch
function completePass(
  state: State,
  receiver: Player,
  endLoc: Vector,
  cachedPlayers: {
    rushers: Player[];
    coverers: Player[];
    catchers: Player[];
    blockers: Player[];
  },
) {
  state.ballFlight!.isInFlight = false;
  state.ball.loc = { ...receiver.loc };
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

export {
  attemptTackle,
  calculatePerfectThrowTarget,
  predictReceiverRoute,
  stepAsPlayer,
};

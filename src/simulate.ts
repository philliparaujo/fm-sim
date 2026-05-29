import {
  fillOutPlayers,
  generateBall,
  generateDefensivePlaycall,
  generateOffensePlaycall,
} from "./playbook";
import { ENDZONE_W, H, render, TOTAL_H, TOTAL_W, W } from "./render";
import {
  Ball,
  cornerRoute,
  curlRoute,
  dragRoute,
  Entity,
  flatRoute,
  inRoute,
  outRoute,
  Player,
  postRoute,
  slantRoute,
  State,
  streakRoute,
  Vector,
} from "./types";
import {
  applyDamping,
  closestPointOnSegment,
  dist,
  getPocket,
  isCarryingBall,
  length,
  LOSToString,
  randomCoverage,
  randomRoute,
  vectorToString,
} from "./util";

const START_DRIVE = (25 * W) / 100 + ENDZONE_W;
const PAUSE_MS_AFTER_PLAY = 0;

const createInitialState = (startingLOS?: number): State => {
  const LOS = startingLOS ?? START_DRIVE;
  const ball = generateBall(LOS);
  const offensePartial = generateOffensePlaycall(LOS, ball, "red");
  const defensePartial = generateDefensivePlaycall(LOS, "blue", offensePartial);
  const players = fillOutPlayers([...offensePartial, ...defensePartial]);

  return {
    steps: 0,
    pausedUntil: 0,
    ballGiven: false,
    ballGivenAtStep: 0,
    earlyThrowDecided: false,
    panicThrowDecided: false,
    LOS: LOS,
    ball: ball,
    players: players,
  };
};

let state: State = createInitialState();
assignCoverageTargets();
let simStartTime = performance.now();
let runCount = 1;

function assignCoverageTargets() {
  const catchers = [...state.players].filter((p) => p.role === "catcher");
  // Only deal with defenders assigned to "man"
  const manCoverers = state.players.filter(
    (p) => p.role === "coverer" && p.coverage === "man",
  );
  const zoneCoverers = state.players.filter(
    (p) => p.role === "coverer" && p.coverage === "zone",
  );

  // 1. Sort both by Y-coordinate so assignments are "parallel" (top-to-bottom)
  manCoverers.sort((a, b) => a.loc.y - b.loc.y);
  // We don't sort the main catchers array to keep IDs consistent, but we sort a reference list
  const catchersByY = [...catchers].sort((a, b) => a.loc.y - b.loc.y);

  const assignedCatcherIds = new Set<string>(); // Use a unique ID or reference

  // 2. Assign primary man coverage
  manCoverers.forEach((coverer) => {
    // Find the closest catcher that hasn't been claimed yet
    const available = catchersByY.filter(
      (c) => !assignedCatcherIds.has(vectorToString(c.loc)),
    );

    if (available.length > 0) {
      // Find the one closest to the coverer's current Y-level
      available.sort(
        (a, b) =>
          Math.abs(a.loc.y - coverer.loc.y) - Math.abs(b.loc.y - coverer.loc.y),
      );

      const target = available[0];
      coverer.assignedTarget = target;
      assignedCatcherIds.add(vectorToString(target.loc));
    } else {
      // 3. DOUBLE UP: If no unassigned catchers left, find the closest catcher overall
      // This creates "Double Coverage" on the most dangerous/closest threat
      const closestOverall = [...catchers].sort(
        (a, b) => dist(coverer.loc, a.loc) - dist(coverer.loc, b.loc),
      )[0];

      coverer.assignedTarget = closestOverall || null;
    }
  });

  // 4. Initialize Zone Centers
  zoneCoverers.forEach((coverer) => {
    coverer.assignedTarget = null;
    coverer.zone = { ...coverer.loc };
  });
}

// Applies velocity and field constraints
function triggerMove(entity: Ball | Player) {
  entity.loc.x += entity.vel.x;
  entity.loc.y += entity.vel.y;

  const margin = entity.radius / 2;
  const leftBound = margin;
  const rightEndzone = W + ENDZONE_W;
  const rightBound = TOTAL_W - margin;
  const topBound = margin;
  const bottomBound = TOTAL_H - margin;

  if (
    entity.type === "player" &&
    isCarryingBall(entity, state.ball) &&
    entity.loc.x > rightEndzone
  ) {
    console.log("TOUCHDOWN!", entity);
    resetSimulation();
  }

  // CLAMP POSITION: If they go past the wall, snap them back to the edge
  if (entity.loc.x < leftBound) {
    entity.loc.x = leftBound;
    entity.vel.x = Math.abs(entity.vel.x) / 2; // Force velocity away from wall
  } else if (entity.loc.x > rightBound) {
    entity.loc.x = rightBound;
    entity.vel.x = -Math.abs(entity.vel.x) / 2;
  }

  if (entity.loc.y < topBound) {
    entity.loc.y = topBound;
    entity.vel.y = 0;
  } else if (entity.loc.y > bottomBound) {
    entity.loc.y = bottomBound;
    entity.vel.y = 0;
  }
}

/* Simulation constants */
const SIM_SPEED = 1;
const LOGIC_TICK_MS = 1000 / 60;

/* Blocker constants */
const RUSHER_DAMPING_FACTOR = 0.6; // Reduce velocity to 85%
const COVERER_DAMPING_FACTOR = 0.6;
const MIN_BLOCK_DISTANCE = 40;

/* Rusher constants */
const RANDOM_JITTER = 0.1; // 10% randomness
const INLINE_NUDGE = 1.4; // Nudges rusher if inline with blocker
const STEER_FACTOR = 1.5; // Rusher C.O.D amount
const LATERAL_STRENGTH = 0.8; // How wide the rusher oscillates
const LATERAL_FREQ = 0.03; // How fast the rusher oscillates

/* Runner constants */
const LOOK_AHEAD = 50; // How far ahead the runner scans for threats
const AVOID_STRENGTH = 1.3; // How aggressively the runner veers away

const RUNNER_INITIAL_STEER_DURATION = 70;
const INITIAL_STEER_AVOID_STRENGTH = 0.4;
const ANGLE_ENDZONE_INTENT = 0.7;

/* Receiver constants */
const PIXELS_PER_STEP = 15;
const STOP_AFTER_BREAK_THRESHOLD = 10;
const CATCHER_AVOID_STRENGTH = 0.6;

const CATCH_SLOWDOWN_DURATION = 60;
const MIN_CATCH_SPEED_MULT = 0.5;

/* Coverer constants */
const REACTION_DELAY = 30;
const LEAD_FRAMES = 45;
const ARRIVAL_RADIUS = 15;

const ZONE_PULL = 0.5;
const MAN_CUSHION = 0; // px behind the receiver toward the ball

/* Pursuer constants */
const PREDICTION_FRAMES = 60;
const PURSUER_STEER_FACTOR = 0.4;

/* Passer constants */
const PASSER_STEER_FACTOR = 0.2;

const PASSER_LOOK_AHEAD = 80; // Radius where passer starts noticing rushers
const PASSER_AVOID_STRENGTH = 1.7; // Strength of the "push" from rushers

const BALL_GIVEN_STEPS = 180;
const MIN_THROW_STEP = 60; // Never throw before this, regardless of condition
const COMPLETION_RADIUS = 50;
const EARLY_THROW_SEPARATION = 55; // px of separation that tempts an early throw
const EARLY_THROW_CHANCE = 0.7; // 40% chance to actually take the early throw
const PANIC_RUSHER_DIST = 40; // px at which passer feels pressure to throw
const PANIC_THROW_CHANCE = 0.55; // 55% chance to throw under pressure

function resolveCollision(a: Player, b: Entity) {
  // 1. Calculate the distance between centers
  const dx = b.loc.x - a.loc.x;
  const dy = b.loc.y - a.loc.y;
  const distance = Math.sqrt(dx * dx + dy * dy);
  const minDistance = a.radius + b.radius;

  if (distance < minDistance) {
    if (b.type === "ball") {
      if (isCarryingBall(a, b as Ball)) {
        ballCollideBehavior(a);
      }
    } else if (b.type === "player") {
      const playerB = b as Player;

      // Apply damping if rusher colliding with blocker
      if (a.role === "rusher" && playerB.role === "blocker") {
        applyDamping(a, RUSHER_DAMPING_FACTOR, RANDOM_JITTER);
      } else if (playerB.role === "rusher" && a.role === "blocker") {
        applyDamping(playerB, RUSHER_DAMPING_FACTOR, RANDOM_JITTER);
      }

      if (a.role === "coverer") {
        applyDamping(a, COVERER_DAMPING_FACTOR, RANDOM_JITTER);
      } else if (playerB.role === "coverer") {
        applyDamping(playerB, COVERER_DAMPING_FACTOR, RANDOM_JITTER);
      }

      // End simulation if ball carrier gets tackled
      if (playerB.role === "rusher" || playerB.role === "coverer") {
        if (isCarryingBall(a, state.ball)) {
          resetSimulation();
        }
      } else if (a.role === "rusher" || a.role === "coverer") {
        if (isCarryingBall(playerB, state.ball)) {
          resetSimulation();
        }
      }

      if (
        a.role === "passer" &&
        playerB.role === "runner" &&
        !state.ballGiven
      ) {
        state.ball.loc.x = playerB.loc.x;
        state.ball.loc.y = playerB.loc.y;
        state.ballGiven = true;
      }

      if (
        playerB.role === "passer" &&
        a.role === "runner" &&
        !state.ballGiven
      ) {
        state.ball.loc.x = a.loc.x;
        state.ball.loc.y = a.loc.y;
        state.ball.vel.x = a.vel.x;
        state.ball.vel.y = a.vel.y;
        state.ballGiven = true;
      }

      // Static resolution
      const overlap = minDistance - distance;
      const nx = dx / distance;
      const ny =
        dy / distance + (Math.random() * INLINE_NUDGE - INLINE_NUDGE / 2);

      const moveX = nx * (overlap / 2);
      const moveY = ny * (overlap / 2);

      a.loc.x -= moveX;
      a.loc.y -= moveY;
      playerB.loc.x += moveX;
      playerB.loc.y += moveY;
    }
  }
}

function ballCollideBehavior(player: Player) {
  switch (player.role) {
    case "blocker": {
      // If blocker collides with ball, simulation ends
      // console.log("SACK");
      resetSimulation();
      break;
    }
    case "rusher": {
      // If rusher collides with ball, simulation ends
      // console.log("SACK");
      resetSimulation();
      break;
    }
    case "runner": {
      // If runner collides with ball, runner carries ball
      state.ballGiven = true;
      state.ball.vel.x = player.vel.x;
      state.ball.vel.y = player.vel.y;
      state.ball.loc.x = player.loc.x;
      state.ball.loc.y = player.loc.y;
      break;
    }
    case "catcher": {
      // If catcher collides with ball, catcher carries ball
      state.ballGiven = true;
      state.ball.vel.x = player.vel.x;
      state.ball.vel.y = player.vel.y;
      state.ball.loc.x = player.loc.x;
      state.ball.loc.y = player.loc.y;
      break;
    }
    case "coverer": {
      // If coverer collides with ball, simulation ends (turnover)
      resetSimulation();
      console.warn("COVERER TURNED THE BALL OVER!!");
      break;
    }
    case "passer": {
      // If passer collides with ball, passer holds it
      if (!state.ballGiven) {
        state.ball.vel.x = player.vel.x;
        state.ball.vel.y = player.vel.y;
        state.ball.loc.x = player.loc.x;
        state.ball.loc.y = player.loc.y;
      }
      break;
    }
  }
}

function stepAsRusher(player: Player) {
  const toBallX = state.ball.loc.x - player.loc.x;
  const toBallY = state.ball.loc.y - player.loc.y;
  const toBallDist = Math.sqrt(toBallX * toBallX + toBallY * toBallY);

  // Unit vector toward ball
  const dirX = toBallX / toBallDist;
  const dirY = toBallY / toBallDist;

  // Perpendicular unit vector (rotate 90°)
  const perpX = -dirY;
  const perpY = dirX;

  // Slow sinusoidal lateral drift — phase offset per player avoids sync
  const phaseOffset = state.players.indexOf(player) * 2.1;
  const lateral =
    Math.sin(Date.now() * LATERAL_FREQ * 0.01 * SIM_SPEED + phaseOffset) *
    LATERAL_STRENGTH;

  // Target velocity: mostly toward ball, with lateral component
  const targetVelX = (dirX + perpX * lateral) * player.maxSpeed;
  const targetVelY = (dirY + perpY * lateral) * player.maxSpeed;

  // Blend current velocity toward target (steering inertia)
  player.vel.x += (targetVelX - player.vel.x) * STEER_FACTOR;
  player.vel.y += (targetVelY - player.vel.y) * STEER_FACTOR;
}

function stepAsPursuer(player: Player) {
  // 1. Calculate the current distance to the ball
  const distToBall = dist(player.loc, state.ball.loc);

  // 2. DYNAMIC PREDICTION:
  // Instead of a constant (like 80), we calculate how many frames it would
  // take the player to reach the ball at max speed. This is the "Look Ahead" window.
  // We add a small floor (e.g., 5 frames) to prevent division by zero.
  const dynamicLookAhead = Math.max(5, distToBall / player.maxSpeed);

  // 3. Define the predicted path of the ball carrier
  const pathStart = state.ball.loc;
  const pathEnd = {
    x:
      state.ball.loc.x +
      state.ball.vel.x * dynamicLookAhead * 1.5 +
      PREDICTION_FRAMES,
    y:
      state.ball.loc.y +
      state.ball.vel.y * dynamicLookAhead * 1.5 +
      PREDICTION_FRAMES,
  };

  // 4. Find the Intercept Point on that predicted path
  const interceptPoint = closestPointOnSegment(player.loc, pathStart, pathEnd);

  // 5. Determine the target
  const toTargetX = interceptPoint.x - player.loc.x;
  const toTargetY = interceptPoint.y - player.loc.y;
  const d = Math.sqrt(toTargetX * toTargetX + toTargetY * toTargetY);

  if (d > 0.5) {
    // 6. Calculate Velocity
    const targetVelX = (toTargetX / d) * player.maxSpeed;
    const targetVelY = (toTargetY / d) * player.maxSpeed;

    player.vel.x += (targetVelX - player.vel.x) * PURSUER_STEER_FACTOR;
    player.vel.y += (targetVelY - player.vel.y) * PURSUER_STEER_FACTOR;
  } else {
    player.vel.x = 0;
    player.vel.y = 0;
  }
}

function stepAsBlocker(player: Player) {
  const enemies = state.players.filter(
    (p) => p.role === "rusher" || p.role === "coverer",
  );

  const potentialBlocks = enemies.map((enemy) => {
    // 1. Calculate the ideal intercept point (direct line to ball)
    let interceptPoint = closestPointOnSegment(
      player.loc,
      enemy.loc,
      state.ball.loc,
    );

    // 2. SAFETY BUFFER LOGIC:
    // Check if this intercept point is too close to the ball
    const distFromBall = dist(interceptPoint, state.ball.loc);

    if (distFromBall < MIN_BLOCK_DISTANCE) {
      // Find the direction from the ball toward the enemy
      const toEnemyX = enemy.loc.x - state.ball.loc.x;
      const toEnemyY = enemy.loc.y - state.ball.loc.y;
      const d = Math.sqrt(toEnemyX * toEnemyX + toEnemyY * toEnemyY) || 1;

      // Push the intercept point out along that line to the edge of the buffer
      interceptPoint = {
        x: state.ball.loc.x + (toEnemyX / d) * MIN_BLOCK_DISTANCE,
        y: state.ball.loc.y + (toEnemyY / d) * MIN_BLOCK_DISTANCE,
      };
    }

    const distToIntercept = dist(player.loc, interceptPoint);
    const enemyDistToBall = dist(enemy.loc, state.ball.loc);

    const threatIndex = enemyDistToBall * 0.2 + distToIntercept;

    return {
      rusher: enemy,
      interceptPoint,
      threatIndex,
      distToIntercept,
    };
  });

  potentialBlocks.sort((a, b) => a.threatIndex - b.threatIndex);
  const bestBlock = potentialBlocks[0];

  if (bestBlock) {
    const { interceptPoint, distToIntercept } = bestBlock;

    // Use a small dead-zone (2px) to prevent vibrating once in position
    if (distToIntercept > 2) {
      const angle = Math.atan2(
        interceptPoint.y - player.loc.y,
        interceptPoint.x - player.loc.x,
      );
      player.vel.x = Math.cos(angle) * player.maxSpeed;
      player.vel.y = Math.sin(angle) * player.maxSpeed;
    } else {
      player.vel.x = 0;
      player.vel.y = 0;
    }
  }
}

function stepAsBallCarrier(
  player: Player,
  avoidStrength: number,
  targetDir: Vector = { x: 1.0, y: 0 },
) {
  const framesSinceCatch = state.steps - state.ballGivenAtStep;
  let currentMaxSpeed = player.maxSpeed;

  // 1. Acceleration ramp (unchanged)
  if (
    framesSinceCatch < CATCH_SLOWDOWN_DURATION &&
    isCarryingBall(player, state.ball)
  ) {
    const progress = framesSinceCatch / CATCH_SLOWDOWN_DURATION;
    const multiplier =
      MIN_CATCH_SPEED_MULT + (1 - MIN_CATCH_SPEED_MULT) * progress;
    currentMaxSpeed *= multiplier;
  }

  // 2. Steering Avoidance Logic
  const enemies = state.players.filter(
    (p) => p.role === "rusher" || p.role === "coverer",
  );

  enemies.forEach((enemy) => {
    const diff = {
      x: player.loc.x - enemy.loc.x,
      y: player.loc.y - enemy.loc.y,
    };
    const d = length(diff);

    if (d < LOOK_AHEAD) {
      const weight = (LOOK_AHEAD - d) / LOOK_AHEAD;

      // FIX A: Asymmetric Repulsion
      // We scale the X-repulsion down so defenders mostly force the runner to "Juke"
      // up or down rather than turning around and running away.
      const BACKWARD_PUNISH_MULT = 0.3;

      const pushX = (diff.x / d) * weight * avoidStrength;
      const pushY = (diff.y / d) * weight * avoidStrength;

      // Only damp the push if it's trying to push us backwards (negative X)
      targetDir.x += pushX < 0 ? pushX * BACKWARD_PUNISH_MULT : pushX;
      targetDir.y += pushY;
    }
  });

  // FIX B: The Forward Intent Clamp
  // This ensures that after all fears are calculated, the runner's "Will"
  // to reach the endzone is at least 10% of their total intent.
  targetDir.x = Math.max(ANGLE_ENDZONE_INTENT, targetDir.x);

  // 3. Normalize and Apply (unchanged)
  const finalMag = length(targetDir);
  const targetVelX = (targetDir.x / finalMag) * currentMaxSpeed;
  const targetVelY = (targetDir.y / finalMag) * currentMaxSpeed;

  player.vel.x += (targetVelX - player.vel.x) * STEER_FACTOR;
  player.vel.y += (targetVelY - player.vel.y) * STEER_FACTOR;

  state.ball.vel.x = player.vel.x;
  state.ball.vel.y = player.vel.y;
}

function stepAsCoverer(player: Player) {
  // Tick timer and flag the exact frame a reaction fires
  player.reactionTimer++;
  const justReacted = player.reactionTimer >= REACTION_DELAY;

  // Determine target catcher
  let targetCatcher: Player | null = null;
  if (player.coverage === "man") {
    targetCatcher = player.assignedTarget || null;
  } else if (player.coverage === "zone") {
    if (!player.zone) {
      console.warn("Zone defender has no zone?");
    } else {
      const catchers = state.players.filter((p) => p.role === "catcher");
      if (catchers.length > 0) {
        catchers.sort(
          (a, b) => dist(player.zone!, a.loc) - dist(player.zone!, b.loc),
        );
        targetCatcher = catchers[0];
      }
    }
  }

  if (justReacted) {
    player.reactionTimer = 0;
    if (targetCatcher) {
      player.perceivedVel = { ...targetCatcher.vel };
      player.perceivedLoc = { ...targetCatcher.loc };
    }
  }

  if (player.perceivedLoc === null) {
    return;
  }

  // Determine base target point
  let targetPoint: Vector;
  if (targetCatcher) {
    if (player.coverage === "man") {
      // Use perceivedLoc so both position AND velocity are delayed
      const perceived = player.perceivedLoc ?? targetCatcher.loc;

      // Cushion: offset the defender behind the receiver relative to the ball
      const toBallX = state.ball.loc.x - perceived.x;
      const toBallY = state.ball.loc.y - perceived.y;
      const toBallDist = Math.sqrt(toBallX * toBallX + toBallY * toBallY) || 1;

      targetPoint = {
        x: perceived.x + (toBallX / toBallDist) * MAN_CUSHION,
        y: perceived.y + (toBallY / toBallDist) * MAN_CUSHION,
      };
    } else {
      targetPoint = {
        x: player.zone!.x + (targetCatcher.loc.x - player.zone!.x) * ZONE_PULL,
        y: player.zone!.y + (targetCatcher.loc.y - player.zone!.y) * ZONE_PULL,
      };
    }

    targetPoint = {
      x: targetPoint.x + (player.perceivedVel?.x ?? 0) * LEAD_FRAMES,
      y: targetPoint.y + (player.perceivedVel?.y ?? 0) * LEAD_FRAMES,
    };
  } else {
    targetPoint = player.zone ?? { ...player.loc };
  }

  // Arrival: scale speed by distance so defenders don't overshoot and jiggle
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

function stepAsPasser(player: Player) {
  // 1. ELLIPSOIDAL POCKET LOGIC
  // Calculate the player's position relative to the ellipse center, normalized by radii
  const pocket = getPocket(state.LOS);
  const dx = (player.loc.x - pocket.cx) / pocket.rx;
  const dy = (player.loc.y - pocket.cy) / pocket.ry;

  // distSq > 1 means the player is outside the ellipse boundary
  const distSq = dx * dx + dy * dy;

  let targetDir = { x: 0, y: 0 };

  if (distSq > 1.0) {
    // Restorative force: Pull back harder the further they drift from the ellipse boundary
    const pullStrength = (distSq - 1.0) * 0.5;
    targetDir.x = -dx * pullStrength;
    targetDir.y = -dy * pullStrength;
  } else {
    // "Lazy" drift: If inside the pocket, move very gently toward the center
    // This allows the passer to "settle" without snapping
    targetDir.x = -dx * 0.05;
    targetDir.y = -dy * 0.05;
  }

  // 2. AVOIDANCE: Repel from rushers
  const rushers = state.players.filter((p) => p.role === "rusher");
  rushers.forEach((rusher) => {
    const diff = {
      x: player.loc.x - rusher.loc.x,
      y: player.loc.y - rusher.loc.y,
    };
    const d = length(diff);

    if (d < PASSER_LOOK_AHEAD) {
      // Squared weight prevents "flicker" at the edge of the radius
      const weight = Math.pow((PASSER_LOOK_AHEAD - d) / PASSER_LOOK_AHEAD, 2);

      targetDir.x += (diff.x / d) * weight * PASSER_AVOID_STRENGTH;
      targetDir.y += (diff.y / d) * weight * PASSER_AVOID_STRENGTH;
    }
  });

  // 3. SMOOTHING & ANTI-JITTER
  const mag = length(targetDir);

  // Velocity Damping: Actively bleed off speed to prevent oscillation (The "Shock Absorber")
  player.vel.x *= 0.92;
  player.vel.y *= 0.92;

  if (mag > 0.05) {
    const targetVelX = (targetDir.x / mag) * player.maxSpeed;
    const targetVelY = (targetDir.y / mag) * player.maxSpeed;

    // Use a much lower steer factor for small movements to filter out micro-jitters
    const velDiff =
      Math.abs(targetVelX - player.vel.x) + Math.abs(targetVelY - player.vel.y);
    const smoothSteer =
      velDiff < 0.4 ? PASSER_STEER_FACTOR * 0.15 : PASSER_STEER_FACTOR;

    player.vel.x += (targetVelX - player.vel.x) * smoothSteer;
    player.vel.y += (targetVelY - player.vel.y) * smoothSteer;
  }

  // 4. BALL SYNC
  if (isCarryingBall(player, state.ball)) {
    state.ball.vel.x = player.vel.x;
    state.ball.vel.y = player.vel.y;
  }

  // 6. THROW DECISION (unchanged)
  if (state.ballGiven || state.steps < MIN_THROW_STEP) return;
  const eligibleCatchers = state.players.filter(
    (p) => p.role === "catcher" && p.route,
  );
  const defenders = state.players.filter((p) => p.role === "coverer");
  if (eligibleCatchers.length === 0) return;

  const catchersWithSeparation = eligibleCatchers.map((catcher) => {
    const nearestDefDist =
      defenders.length > 0
        ? Math.min(...defenders.map((def) => dist(catcher.loc, def.loc)))
        : Infinity;
    return { catcher, nearestDefDist };
  });
  catchersWithSeparation.sort((a, b) => b.nearestDefDist - a.nearestDefDist);
  const bestOption = catchersWithSeparation[0];

  const nearestRusherDist =
    rushers.length > 0
      ? Math.min(...rushers.map((r) => dist(player.loc, r.loc)))
      : Infinity;

  let shouldThrow = false;
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
    if (Math.random() < PANIC_THROW_CHANCE) shouldThrow = true;
  }

  if (!shouldThrow) return;
  if (bestOption.nearestDefDist < COMPLETION_RADIUS) {
    state.ball.loc.x = state.LOS;
    state.ball.loc.y = H / 2;
    resetSimulation();
  } else {
    state.ball.loc.x = bestOption.catcher.loc.x;
    state.ball.loc.y = bestOption.catcher.loc.y;
    state.ballGiven = true;
    state.ballGivenAtStep = state.steps;
  }
}

function stepSimulation() {
  // Player behavior
  state.steps++;

  for (const player of state.players) {
    switch (player.role) {
      // Finds nearest rusher and moves in line to block
      case "blocker": {
        stepAsBlocker(player);
        resolveCollision(player, state.ball);
        break;
      }
      // Moves towards ball in a roughly straight line
      case "rusher": {
        stepAsRusher(player);

        resolveCollision(player, state.ball);
        break;
      }
      // Tries to get ball, then tries to score a touchdown
      case "runner": {
        if (!isCarryingBall(player, state.ball) && state.ballGiven) {
          stepAsBlocker(player);
        } else if (!isCarryingBall(player, state.ball)) {
          // Phase 1: Go get the ball (unchanged)
          const toBall = {
            x: state.ball.loc.x - player.loc.x,
            y: state.ball.loc.y - player.loc.y,
          };
          const d = length(toBall);
          player.vel.x = (toBall.x / d) * player.maxSpeed;
          player.vel.y = (toBall.y / d) * player.maxSpeed;
        } else {
          // Phase 2: Ball Carrier Logic
          const framesSinceHandover = state.steps - state.ballGivenAtStep;

          if (
            framesSinceHandover < RUNNER_INITIAL_STEER_DURATION &&
            player.runAngle
          ) {
            stepAsBallCarrier(
              player,
              INITIAL_STEER_AVOID_STRENGTH,
              player.runAngle,
            );
          } else {
            stepAsBallCarrier(player, AVOID_STRENGTH);
          }

          player.path.push({ x: player.loc.x, y: player.loc.y });
        }

        resolveCollision(player, state.ball);
        break;
      }
      // Runs predefined route then turns into ball carrier
      case "catcher": {
        if (!player.route) {
          console.log("Catcher does not have a route?");
          break;
        }

        if (!state.ballGiven) {
          player.path.push({ x: player.loc.x, y: player.loc.y });
        }

        if (!isCarryingBall(player, state.ball) && state.ballGiven) {
          stepAsBlocker(player);
        } else if (!isCarryingBall(player, state.ball)) {
          // 1. SCALED THRESHOLD: Time (frames) = Distance / Speed
          // This ensures all players break at the same pixel depth.
          const threshold = Math.floor(
            (player.route.steps * PIXELS_PER_STEP) / player.maxSpeed,
          );

          if (state.steps < threshold) {
            // PHASE 1: The Stem
            player.vel.x = player.maxSpeed;
            player.vel.y = 0;
          } else {
            // PHASE 2: The Break
            // Only calculate the angle once at the transition frame.
            // This prevents the player from "flipping" if they cross the H/2 line later.
            if (state.steps === Math.max(1, threshold)) {
              const sideMultiplier = player.loc.y < H / 2 ? 1 : -1;
              const angleRad =
                player.route.breakAngle * sideMultiplier * (Math.PI / 180);

              player.vel.x = Math.cos(angleRad) * player.maxSpeed;
              player.vel.y = Math.sin(angleRad) * player.maxSpeed;
            }

            // Phase 3: Optional stop for curl routes
            if (
              player.route.stopAfterBreak &&
              state.steps > threshold + STOP_AFTER_BREAK_THRESHOLD
            ) {
              player.vel.x *= 0.9;
              player.vel.y *= 0.9;
            }
          }
        } else {
          stepAsBallCarrier(player, CATCHER_AVOID_STRENGTH);
        }

        resolveCollision(player, state.ball);
        break;
      }
      // Marks nearest catcher until ball given
      case "coverer": {
        if (!state.ballGiven) {
          stepAsCoverer(player);
        } else {
          stepAsPursuer(player);
        }
        resolveCollision(player, state.ball);
        break;
      }
      case "passer": {
        if (!state.ballGiven) {
          stepAsPasser(player);
        } else {
          player.vel.x = 0;
          player.vel.y = 0;
        }
        resolveCollision(player, state.ball);
        break;
      }
    }
  }

  // Resolve player collisions
  for (let i = 0; i < state.players.length; i++) {
    for (let j = i + 1; j < state.players.length; j++) {
      resolveCollision(state.players[i], state.players[j]);
    }
  }

  // TEMP: Give ball to a catcher
  if (state.steps > BALL_GIVEN_STEPS && !state.ballGiven) {
    const eligibleCatchers = state.players.filter(
      (p) => p.role === "catcher" && p.route,
    );
    const defenders = state.players.filter((p) => ["coverer"].includes(p.role));

    if (eligibleCatchers.length > 0 && defenders.length > 0) {
      // 1. For each catcher, find the distance to their nearest defender
      const catchersWithSeparation = eligibleCatchers.map((catcher) => {
        const nearestDefDist = Math.min(
          ...defenders.map((def) => dist(catcher.loc, def.loc)),
        );
        return { catcher, nearestDefDist };
      });

      // 2. Sort to find the catcher with the HIGHEST "nearest defender distance"
      catchersWithSeparation.sort(
        (a, b) => b.nearestDefDist - a.nearestDefDist,
      );

      const bestOption = catchersWithSeparation[0];
      const target = bestOption.catcher;
      const maxSeparation = bestOption.nearestDefDist;

      // 3. Completion Logic based on the "Best" catcher's separation
      if (maxSeparation < COMPLETION_RADIUS) {
        // console.log(`INCOMPLETE: ${maxSeparation.toFixed(1)}px separation`);
        state.ball.loc.x = W / 4;
        state.ball.loc.y = H / 2;
        resetSimulation();
      } else {
        // Snap the ball to the most open receiver
        state.ball.loc.x = target.loc.x;
        state.ball.loc.y = target.loc.y;

        state.ballGiven = true;
        state.ballGivenAtStep = state.steps;
        // console.log("BALL CAUGHT:", maxSeparation.toFixed(1), "px separation");
      }
    }
  }

  // Move entities
  triggerMove(state.ball);
  for (const player of state.players) {
    triggerMove(player);
  }
}

let lastTime = 0;
let timeAccumulator = 0;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function tick(currentTime: number) {
  if (currentTime < state.pausedUntil) {
    lastTime = currentTime;
    render(getPocket(state.LOS), state.LOS);
    requestAnimationFrame(tick);
    return;
  }

  if (lastTime === 0) {
    lastTime = currentTime;
    simStartTime = currentTime;
    console.log("--- Simulation Run #1 Started ---");
  }

  const deltaTime = currentTime - lastTime;
  lastTime = currentTime;

  timeAccumulator += deltaTime * SIM_SPEED;

  while (timeAccumulator >= LOGIC_TICK_MS) {
    stepSimulation();
    timeAccumulator -= LOGIC_TICK_MS;
  }

  render(getPocket(state.LOS), state.LOS);
  requestAnimationFrame(tick);
}

function resetSimulation() {
  let nextLOS = state.ball.loc.x;
  if (nextLOS > W + ENDZONE_W) {
    nextLOS = START_DRIVE;
  }
  // Log simulation stats
  console.log(`Play Ended. New LOS: ${LOSToString(nextLOS)}`);

  // Reset state
  state = createInitialState(nextLOS);
  state.pausedUntil = performance.now() + PAUSE_MS_AFTER_PLAY;
  assignCoverageTargets();

  // Reset timing logic
  simStartTime = state.pausedUntil;
  timeAccumulator = 0; // Reset the bucket to avoid logic jumps
  runCount++;
}

export { state, tick };

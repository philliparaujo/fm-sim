import { H, render, W } from "./render";
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
  isCarryingBall,
  length,
  randomCoverage,
  randomRoute,
  vectorToString,
} from "./util";

const createInitialState = (): State => {
  const randCoverage = randomCoverage();

  return {
    steps: 0,
    ballGiven: false,
    ballGivenAtStep: 0,
    ball: {
      type: "ball" as const,
      loc: { x: W / 6, y: H / 2 },
      vel: { x: 0, y: 0 },
      radius: 6,
      strokeWidth: 0.8,
      laceWidth: 2,
    },
    players: [
      {
        type: "player" as const,
        loc: { x: W / 4, y: (1.7 * H) / 4 },
        vel: { x: 0, y: 0 },
        radius: 8,
        color: "red",
        maxSpeed: 1,
        position: "offense",
        role: "blocker",
        route: null,
        path: [],
        coverage: null,
        assignedTarget: null,
        perceivedVel: { x: 0, y: 0 },
        reactionTimer: 0,
        perceivedLoc: null,
        zone: { x: 0, y: 0 },
      },
      {
        type: "player" as const,
        loc: { x: W / 4, y: (2 * H) / 4 },
        vel: { x: 0, y: 0 },
        radius: 8,
        color: "red",
        maxSpeed: 1,
        position: "offense",
        role: "blocker",
        route: null,
        path: [],
        coverage: null,
        assignedTarget: null,
        perceivedVel: { x: 0, y: 0 },
        reactionTimer: 0,
        perceivedLoc: null,
        zone: { x: 0, y: 0 },
      },
      {
        type: "player" as const,
        loc: { x: W / 4, y: (2.3 * H) / 4 },
        vel: { x: 0, y: 0 },
        radius: 8,
        color: "red",
        maxSpeed: 1,
        position: "offense",
        role: "blocker",
        route: null,
        path: [],
        coverage: null,
        assignedTarget: null,
        perceivedVel: { x: 0, y: 0 },
        reactionTimer: 0,
        perceivedLoc: null,
        zone: { x: 0, y: 0 },
      },
      {
        type: "player" as const,
        loc: { x: W / 3.5, y: (1.5 * H) / 4 },
        vel: { x: 0, y: 0 },
        radius: 8,
        color: "blue",
        maxSpeed: 1.5,
        position: "defense",
        role: "rusher",
        route: null,
        path: [],
        coverage: null,
        assignedTarget: null,
        perceivedVel: { x: 0, y: 0 },
        reactionTimer: 0,
        perceivedLoc: null,
        zone: { x: 0, y: 0 },
      },
      {
        type: "player" as const,
        loc: { x: W / 3.5, y: (2 * H) / 4 },
        vel: { x: 0, y: 0 },
        radius: 8,
        color: "blue",
        maxSpeed: 1.5,
        position: "defense",
        role: "rusher",
        route: null,
        path: [],
        coverage: null,
        assignedTarget: null,
        perceivedVel: { x: 0, y: 0 },
        reactionTimer: 0,
        perceivedLoc: null,
        zone: { x: 0, y: 0 },
      },
      {
        type: "player" as const,
        loc: { x: W / 3.5, y: (2.5 * H) / 4 },
        vel: { x: 0, y: 0 },
        radius: 8,
        color: "blue",
        maxSpeed: 1.5,
        position: "defense",
        role: "rusher",
        route: null,
        path: [],
        coverage: null,
        assignedTarget: null,
        perceivedVel: { x: 0, y: 0 },
        reactionTimer: 0,
        perceivedLoc: null,
        zone: { x: 0, y: 0 },
      },
      {
        type: "player" as const,
        loc: { x: W / 4.1, y: (1.2 * H) / 4 },
        vel: { x: 0, y: 0 },
        radius: 8,
        color: "red",
        maxSpeed: 1.6,
        position: "offense",
        role: "catcher",
        route: randomRoute(),
        path: [],
        coverage: null,
        assignedTarget: null,
        perceivedVel: { x: 0, y: 0 },
        perceivedLoc: null,
        reactionTimer: 0,
      },
      {
        type: "player" as const,
        loc: { x: W / 4.1, y: (0.8 * H) / 4 },
        vel: { x: 0, y: 0 },
        radius: 8,
        color: "red",
        maxSpeed: 1.6,
        position: "offense",
        role: "catcher",
        route: randomRoute(),
        path: [],
        coverage: null,
        assignedTarget: null,
        perceivedVel: { x: 0, y: 0 },
        perceivedLoc: null,
        reactionTimer: 0,
      },
      {
        type: "player" as const,
        loc: { x: W / 4.1, y: (3.2 * H) / 4 },
        vel: { x: 0, y: 0 },
        radius: 8,
        color: "red",
        maxSpeed: 1.6,
        position: "offense",
        role: "catcher",
        route: randomRoute(),
        path: [],
        coverage: null,
        assignedTarget: null,
        perceivedVel: { x: 0, y: 0 },
        perceivedLoc: null,
        reactionTimer: 0,
      },
      {
        type: "player" as const,
        loc: { x: W / 3, y: (0.7 * H) / 4 },
        vel: { x: 0, y: 0 },
        radius: 8,
        color: "blue",
        maxSpeed: 1.5,
        position: "defense",
        role: "coverer",
        route: null,
        path: [],
        coverage: randCoverage,
        assignedTarget: null,
        perceivedVel: { x: 0, y: 0 },
        perceivedLoc: null,
        reactionTimer: 0,
      },
      {
        type: "player" as const,
        loc: { x: W / 2.5, y: (1.6 * H) / 4 },
        vel: { x: 0, y: 0 },
        radius: 8,
        color: "blue",
        maxSpeed: 1.5,
        position: "defense",
        role: "coverer",
        route: null,
        path: [],
        coverage: randCoverage,
        assignedTarget: null,
        perceivedVel: { x: 0, y: 0 },
        perceivedLoc: null,
        reactionTimer: 0,
      },
      {
        type: "player" as const,
        loc: { x: W / 1.8, y: (2 * H) / 4 },
        vel: { x: 0, y: 0 },
        radius: 8,
        color: "lightblue",
        maxSpeed: 1.5,
        position: "defense",
        role: "coverer",
        route: null,
        path: [],
        coverage: "zone",
        assignedTarget: null,
        perceivedVel: { x: 0, y: 0 },
        perceivedLoc: null,
        reactionTimer: 0,
      },
      {
        type: "player" as const,
        loc: { x: W / 2.7, y: (2 * H) / 4 },
        vel: { x: 0, y: 0 },
        radius: 8,
        color: "lightblue",
        maxSpeed: 1.5,
        position: "defense",
        role: "coverer",
        route: null,
        path: [],
        coverage: "zone",
        assignedTarget: null,
        perceivedVel: { x: 0, y: 0 },
        perceivedLoc: null,
        reactionTimer: 0,
      },
      {
        type: "player" as const,
        loc: { x: W / 3, y: (3.2 * H) / 4 },
        vel: { x: 0, y: 0 },
        radius: 8,
        color: "blue",
        maxSpeed: 1.5,
        position: "defense",
        role: "coverer",
        route: null,
        path: [],
        coverage: randCoverage,
        assignedTarget: null,
        perceivedVel: { x: 0, y: 0 },
        perceivedLoc: null,
        reactionTimer: 0,
      },
      {
        type: "player" as const,
        loc: { x: W / 6, y: (1.5 * H) / 4 },
        vel: { x: 0, y: 0 },
        radius: 8,
        color: "red",
        maxSpeed: 1.9,
        position: "offense",
        role: "blocker",
        route: null,
        path: [],
        coverage: null,
        assignedTarget: null,
        perceivedVel: { x: 0, y: 0 },
        perceivedLoc: null,
        reactionTimer: 0,
      },
      {
        type: "player" as const,
        loc: { x: W / 6, y: (2 * H) / 4 },
        vel: { x: 0, y: 0 },
        radius: 8,
        color: "orange",
        maxSpeed: 1,
        position: "offense",
        role: "passer",
        route: null,
        path: [],
        coverage: null,
        assignedTarget: null,
        perceivedVel: { x: 0, y: 0 },
        perceivedLoc: null,
        reactionTimer: 0,
      },
    ],
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
  const rightBound = W - margin;
  const topBound = margin;
  const bottomBound = H - margin;

  if (
    (entity.type === "player" && isCarryingBall(entity, state.ball),
    entity.loc.x > rightBound)
  ) {
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
const LOOK_AHEAD = 90; // How far ahead the runner scans for threats
const AVOID_STRENGTH = 0.85; // How aggressively the runner veers away

/* Receiver constants */
const PIXELS_PER_STEP = 15;
const STOP_AFTER_BREAK_THRESHOLD = 10;
const COMPLETION_RADIUS = 45;

const CATCH_SLOWDOWN_DURATION = 40;
const MIN_CATCH_SPEED_MULT = 0.5;

/* Coverer constants */
const REACTION_DELAY = 35;
const LEAD_FRAMES = 15;
const ARRIVAL_RADIUS = 15;

const ZONE_PULL = 0.5;
const MAN_CUSHION = -8; // px behind the receiver toward the ball

/* Pursuer constants */
const PREDICTION_FRAMES = 40;
const PURSUER_STEER_FACTOR = 0.2;

/* Passer constants */
const PASSER_AVOID_STRENGTH = 0.2;
const IDEAL_POCKET_DEPTH = -10;
const BALL_GIVEN_STEPS = 100 * 1.2;
const PASSER_LOOK_AHEAD = 90;

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
      state.ball.vel.x * dynamicLookAhead +
      PREDICTION_FRAMES,
    y:
      state.ball.loc.y +
      state.ball.vel.y * dynamicLookAhead +
      PREDICTION_FRAMES,
  };

  // 4. Find the Intercept Point on that predicted path
  const interceptPoint = closestPointOnSegment(player.loc, pathStart, pathEnd);

  // 5. Determine the target
  // If we are very close to the ball, head directly for it to finish the tackle;
  // otherwise, head for the intercept point to cut off the angle.
  const target = distToBall < 30 ? state.ball.loc : interceptPoint;

  const toTargetX = target.x - player.loc.x;
  const toTargetY = target.y - player.loc.y;
  const d = Math.sqrt(toTargetX * toTargetX + toTargetY * toTargetY);

  if (d > 0.5) {
    // 6. Calculate Velocity
    const targetVelX = (toTargetX / d) * player.maxSpeed;
    const targetVelY = (toTargetY / d) * player.maxSpeed;

    // Use a slightly higher steer factor when close to the target to improve "closing" behavior
    const currentSteer = distToBall < 50 ? 0.4 : PURSUER_STEER_FACTOR;

    player.vel.x += (targetVelX - player.vel.x) * currentSteer;
    player.vel.y += (targetVelY - player.vel.y) * currentSteer;
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

function stepAsBallCarrier(player: Player) {
  // 1. Calculate speed multiplier if ball caught
  const framesSinceCatch = state.steps - state.ballGivenAtStep;
  let currentMaxSpeed = player.maxSpeed;

  if (
    framesSinceCatch < CATCH_SLOWDOWN_DURATION &&
    isCarryingBall(player, state.ball)
  ) {
    // Linear ramp: starts slow and accelerates back to player.maxSpeed
    const progress = framesSinceCatch / CATCH_SLOWDOWN_DURATION;
    const multiplier =
      MIN_CATCH_SPEED_MULT + (1 - MIN_CATCH_SPEED_MULT) * progress;
    currentMaxSpeed *= multiplier;
  }

  // Phase 2: Carry the ball with Steering Avoidance
  // Start with a strong base urge to move downfield (Right)
  let targetDir = { x: 1.0, y: 0 };

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
      // Linear Weight: The closer the rusher, the stronger the push
      const weight = (LOOK_AHEAD - d) / LOOK_AHEAD;

      // Add a "Repulsion Force" vector away from the rusher
      targetDir.x += (diff.x / d) * weight * AVOID_STRENGTH;
      targetDir.y += (diff.y / d) * weight * AVOID_STRENGTH;
    }
  });

  // Normalize the final vector to maintain consistent maxSpeed
  const finalMag = length(targetDir);
  const targetVelX = (targetDir.x / finalMag) * currentMaxSpeed;
  const targetVelY = (targetDir.y / finalMag) * currentMaxSpeed;

  // Use STEER_FACTOR for smooth weight shifts (Inertia)
  player.vel.x += (targetVelX - player.vel.x) * STEER_FACTOR;
  player.vel.y += (targetVelY - player.vel.y) * STEER_FACTOR;

  state.ball.vel.x = player.vel.x;
  state.ball.vel.y = player.vel.y;
}

function stepAsCoverer(player: Player) {
  // Tick timer and flag the exact frame a reaction fires
  player.reactionTimer++;
  const justReacted = player.reactionTimer >= REACTION_DELAY;
  if (justReacted) player.reactionTimer = 0;

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

  // Sample perceived velocity only when the reaction fires
  if (justReacted && targetCatcher) {
    player.perceivedVel = { ...targetCatcher.vel };
    player.perceivedLoc = { ...targetCatcher.loc }; // <-- needs to be added to Player type
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
      x: targetPoint.x + player.perceivedVel.x * LEAD_FRAMES,
      y: targetPoint.y + player.perceivedVel.y * LEAD_FRAMES,
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
  // Stay near center / blockers, but slightly drift from rushers
  // 1. APPROACH LOGIC: Identify the "Pocket"
  // The passer wants to stay behind the offensive line (blockers).
  const blockers = state.players.filter((p) => p.role === "blocker");

  let pocketX = W / 6; // Default fallback depth
  let pocketY = H / 2; // Default fallback center

  // if (blockers.length > 0) {
  //   // Target the center of the offensive line, but offset 50px back
  //   const avgX =
  //     blockers.reduce((sum, b) => sum + b.loc.x, 0) / blockers.length;
  //   const avgY =
  //     blockers.reduce((sum, b) => sum + b.loc.y, 0) / blockers.length;
  //   pocketX = avgX;
  //   pocketY = avgY;
  // }

  // Base urge: move toward the ideal pocket position
  let targetDir = {
    x: pocketX - player.loc.x - IDEAL_POCKET_DEPTH,
    y: pocketY - player.loc.y,
  };

  // Normalize base urge so it doesn't overpower the avoidance math
  const homeDist = length(targetDir);
  if (homeDist > 1) {
    targetDir.x /= homeDist;
    targetDir.y /= homeDist;
  }

  // 2. AVOIDANCE LOGIC: Repel from rushers (similar to stepAsBallCarrier)
  const rushers = state.players.filter((p) => p.role === "rusher");
  rushers.forEach((rusher) => {
    const diff = {
      x: player.loc.x - rusher.loc.x,
      y: player.loc.y - rusher.loc.y,
    };
    const d = length(diff);

    // If a rusher enters the scan radius
    if (d < PASSER_LOOK_AHEAD) {
      // Linear Weight: The closer the rusher, the stronger the push
      const weight = (PASSER_LOOK_AHEAD - d) / PASSER_LOOK_AHEAD;

      // Add a "Repulsion Force" vector; we multiply AVOID_STRENGTH by a
      // higher factor (e.g. 5.0) to prioritize survival over the pocket spot.
      targetDir.x += (diff.x / d) * weight * PASSER_AVOID_STRENGTH * 5.0;
      targetDir.y += (diff.y / d) * weight * PASSER_AVOID_STRENGTH * 5.0;
    }
  });

  // 3. STEERING: Finalize movement with inertia
  const finalMag = length(targetDir) || 1;
  const targetVelX = (targetDir.x / finalMag) * player.maxSpeed;
  const targetVelY = (targetDir.y / finalMag) * player.maxSpeed;

  player.vel.x += (targetVelX - player.vel.x) * STEER_FACTOR;
  player.vel.y += (targetVelY - player.vel.y) * STEER_FACTOR;

  // 4. BALL SYNC: Lock ball velocity to the passer if they have it
  if (isCarryingBall(player, state.ball)) {
    state.ball.vel.x = player.vel.x;
    state.ball.vel.y = player.vel.y;
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
          // Phase 1: Go get the ball (Direct Path)
          const toBall = {
            x: state.ball.loc.x - player.loc.x,
            y: state.ball.loc.y - player.loc.y,
          };
          const d = length(toBall);
          player.vel.x = (toBall.x / d) * player.maxSpeed;
          player.vel.y = (toBall.y / d) * player.maxSpeed;
        } else {
          // Phase 2: become a ball carrier
          stepAsBallCarrier(player);
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
          stepAsBallCarrier(player);
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

function tick(currentTime: number) {
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

  render();
  requestAnimationFrame(tick);
}

function resetSimulation() {
  // Log simulation stats
  const timeTaken = (performance.now() - simStartTime) / 1000;
  console.log(`Time: ${timeTaken.toFixed(3)}s, Ball: ${state.ball.loc.x / W}`);

  // Reset state
  const fresh = createInitialState();
  Object.assign(state.ball, fresh.ball);
  state.players.forEach((p, i) => Object.assign(p, fresh.players[i]));
  state.steps = fresh.steps;
  state.ballGiven = fresh.ballGiven;
  assignCoverageTargets();

  // Reset timing logic
  simStartTime = performance.now();
  timeAccumulator = 0; // Reset the bucket to avoid logic jumps
  runCount++;
}

export { state, tick };

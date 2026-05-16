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
} from "./types";
import { applyDamping, closestPointOnSegment, dist, length } from "./util";

const createInitialState = (): State => ({
  steps: 0,
  ballGiven: false,
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
      loc: { x: W / 3, y: (1.7 * H) / 4 },
      vel: { x: 0, y: 0 },
      radius: 8,
      color: "red",
      maxSpeed: 1,
      position: "offense",
      role: "blocker",
      route: null,
      path: [],
    },
    {
      type: "player" as const,
      loc: { x: W / 3, y: (2 * H) / 4 },
      vel: { x: 0, y: 0 },
      radius: 8,
      color: "red",
      maxSpeed: 1,
      position: "offense",
      role: "blocker",
      route: null,
      path: [],
    },
    {
      type: "player" as const,
      loc: { x: W / 3, y: (2.3 * H) / 4 },
      vel: { x: 0, y: 0 },
      radius: 8,
      color: "red",
      maxSpeed: 1,
      position: "offense",
      role: "blocker",
      route: null,
      path: [],
    },
    {
      type: "player" as const,
      loc: { x: W / 2.5, y: (1.5 * H) / 4 },
      vel: { x: 0, y: 0 },
      radius: 8,
      color: "blue",
      maxSpeed: 1.5,
      position: "defense",
      role: "rusher",
      route: null,
      path: [],
    },
    {
      type: "player" as const,
      loc: { x: W / 2.5, y: (2 * H) / 4 },
      vel: { x: 0, y: 0 },
      radius: 8,
      color: "blue",
      maxSpeed: 1.5,
      position: "defense",
      role: "rusher",
      route: null,
      path: [],
    },
    {
      type: "player" as const,
      loc: { x: W / 2.5, y: (2.5 * H) / 4 },
      vel: { x: 0, y: 0 },
      radius: 8,
      color: "blue",
      maxSpeed: 1.5,
      position: "defense",
      role: "rusher",
      route: null,
      path: [],
    },
    {
      type: "player" as const,
      loc: { x: W / 3.1, y: (1.2 * H) / 4 },
      vel: { x: 0, y: 0 },
      radius: 8,
      color: "orange",
      maxSpeed: 1.5,
      position: "offense",
      role: "catcher",
      route: streakRoute,
      path: [],
    },
    {
      type: "player" as const,
      loc: { x: W / 3.1, y: (0.8 * H) / 4 },
      vel: { x: 0, y: 0 },
      radius: 8,
      color: "orange",
      maxSpeed: 1.5,
      position: "offense",
      role: "catcher",
      route: slantRoute,
      path: [],
    },
    {
      type: "player" as const,
      loc: { x: W / 3.1, y: (3.2 * H) / 4 },
      vel: { x: 0, y: 0 },
      radius: 8,
      color: "orange",
      maxSpeed: 1.5,
      position: "offense",
      role: "catcher",
      route: curlRoute,
      path: [],
    },
    {
      type: "player" as const,
      loc: { x: W, y: (2.5 * H) / 4 },
      vel: { x: 0, y: 0 },
      radius: 8,
      color: "orange",
      maxSpeed: 1.5,
      position: "offense",
      role: "runner",
      route: null,
      path: [],
    },
  ],
});

let state: State = createInitialState();
let simStartTime = performance.now();
let runCount = 1;

// Applies velocity and field constraints
function triggerMove(entity: Ball | Player) {
  entity.loc.x += entity.vel.x;
  entity.loc.y += entity.vel.y;

  const margin = entity.radius / 2;
  const leftBound = margin;
  const rightBound = W - margin;
  const topBound = margin;
  const bottomBound = H - margin;

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
    entity.vel.y = Math.abs(entity.vel.y) / 2;
  } else if (entity.loc.y > bottomBound) {
    entity.loc.y = bottomBound;
    entity.vel.y = -Math.abs(entity.vel.y) / 2;
  }
}

/* Simulation constants */
const SIM_SPEED = 1;
const LOGIC_TICK_MS = 1000 / 60;

/* General constants */
const BALL_SNAP_DIST = 8; // Maximum distance where a player will snap to the ball

/* Blocker constants */
const DAMPING_FACTOR = 0.65; // Reduce velocity to 85%

/* Rusher constants */
const RANDOM_JITTER = 0.1; // 10% randomness
const INLINE_NUDGE = 1.4; // Nudges rusher if inline with blocker
const STEER_FACTOR = 1.5; // Rusher C.O.D amount
const LATERAL_STRENGTH = 0.8; // How wide the rusher oscillates
const LATERAL_FREQ = 0.03; // How fast the rusher oscillates

/* Runner constants */
const LOOK_AHEAD = 120; // How far ahead the runner scans for threats
const AVOID_STRENGTH = 0.5; // How aggressively the runner veers away

/* Receiver constants */
const PIXELS_PER_STEP = 15;
const STOP_AFTER_BREAK_THRESHOLD = 6;
const BALL_GIVEN_STEPS = 80;

function resolveCollision(a: Player, b: Entity) {
  // 1. Calculate the distance between centers
  const dx = b.loc.x - a.loc.x;
  const dy = b.loc.y - a.loc.y;
  const distance = Math.sqrt(dx * dx + dy * dy);
  const minDistance = a.radius + b.radius;

  if (distance < minDistance) {
    if (b.type === "ball") {
      if (distance < BALL_SNAP_DIST) {
        ballCollideBehavior(a);
      }
    } else if (b.type === "player") {
      const playerB = b as Player;

      // Apply damping if rusher colliding with blocker
      if (a.role === "rusher" && playerB.role === "blocker") {
        applyDamping(a, DAMPING_FACTOR, RANDOM_JITTER);
      } else if (playerB.role === "rusher" && a.role === "blocker") {
        applyDamping(playerB, DAMPING_FACTOR, RANDOM_JITTER);
      }

      // End simulation if ball carrier gets tackled
      if (playerB.role === "rusher") {
        const isCarryingBall = dist(a.loc, state.ball.loc) < BALL_SNAP_DIST;
        if (isCarryingBall) {
          resetSimulation();
        }
      } else if (a.role === "rusher") {
        const isCarryingBall =
          dist(playerB.loc, state.ball.loc) < BALL_SNAP_DIST;
        if (isCarryingBall) {
          resetSimulation();
        }
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
      resetSimulation();
      break;
    }
    case "rusher": {
      // If rusher collides with ball, simulation ends
      resetSimulation();
      break;
    }
    case "runner": {
      // If runner collides with ball, runner carries ball
      state.ball.vel.x = player.vel.x;
      state.ball.vel.y = player.vel.y;
      state.ball.loc.x = player.loc.x;
      state.ball.loc.y = player.loc.y;
      break;
    }
    case "catcher": {
      // If catcher collides with ball, catcher carries ball
      state.ball.vel.x = player.vel.x;
      state.ball.vel.y = player.vel.y;
      state.ball.loc.x = player.loc.x;
      state.ball.loc.y = player.loc.y;
      break;
    }
  }
}

function stepAsBlocker(player: Player) {
  const rushers = state.players.filter((p) => p.role === "rusher");

  const potentialBlocks = rushers.map((rusher) => {
    // The point the blocker needs to reach to be between rusher and ball
    const interceptPoint = closestPointOnSegment(
      player.loc,
      rusher.loc,
      state.ball.loc,
    );

    const distToIntercept = dist(player.loc, interceptPoint);
    const rusherDistToBall = dist(rusher.loc, state.ball.loc);

    // QUANTIFICATION: Threat Index
    // Priority = (How far is rusher from ball?) + (How much must I move?)
    // We multiply rusherDistToBall by a weight to prioritize
    // "closeness to ball" over "ease of blocking".
    const threatIndex = rusherDistToBall + distToIntercept;

    return {
      rusher,
      interceptPoint,
      threatIndex,
      distToIntercept,
    };
  });

  // Sort by the quantified threat
  potentialBlocks.sort((a, b) => a.threatIndex - b.threatIndex);
  const bestBlock = potentialBlocks[0];

  if (bestBlock) {
    const { interceptPoint, distToIntercept } = bestBlock;

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
  // Phase 2: Carry the ball with Steering Avoidance
  // Start with a strong base urge to move downfield (Right)
  let targetDir = { x: 1.0, y: 0 };

  const rushers = state.players.filter((p) => p.role === "rusher");

  rushers.forEach((rusher) => {
    const diff = {
      x: player.loc.x - rusher.loc.x,
      y: player.loc.y - rusher.loc.y,
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
  const targetVelX = (targetDir.x / finalMag) * player.maxSpeed;
  const targetVelY = (targetDir.y / finalMag) * player.maxSpeed;

  // Use STEER_FACTOR for smooth weight shifts (Inertia)
  player.vel.x += (targetVelX - player.vel.x) * STEER_FACTOR;
  player.vel.y += (targetVelY - player.vel.y) * STEER_FACTOR;
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

        resolveCollision(player, state.ball);
        break;
      }
      // Tries to get ball, then tries to score a touchdown
      case "runner": {
        const isCarryingBall =
          dist(player.loc, state.ball.loc) < BALL_SNAP_DIST;

        if (!isCarryingBall && state.ballGiven) {
          stepAsBlocker(player);
        } else if (!isCarryingBall) {
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
        }

        resolveCollision(player, state.ball);
        break;
      }
      // Runs predefined route then turns into ball carrier
      case "catcher":
        {
          if (!player.route) {
            console.log("Catcher does not have a route?");
            break;
          }

          if (!state.ballGiven) {
            player.path.push({ x: player.loc.x, y: player.loc.y });
          }

          const isCarryingBall =
            dist(player.loc, state.ball.loc) < BALL_SNAP_DIST;

          if (!isCarryingBall && state.ballGiven) {
            stepAsBlocker(player);
          } else if (!isCarryingBall) {
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
        }
        resolveCollision(player, state.ball);
        break;
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
    // Choose a random catcher
    const eligibleCatchers = state.players.filter((p) => {
      if (p.role !== "catcher" || !p.route) return false;
      return true;
    });

    // Move ball to that catcher
    if (eligibleCatchers.length > 0) {
      // Pick a random eligible receiver
      const target =
        eligibleCatchers[Math.floor(Math.random() * eligibleCatchers.length)];

      // Snap the ball to the receiver
      state.ball.loc.x = target.loc.x;
      state.ball.loc.y = target.loc.y;

      state.ballGiven = true;
      console.log("BALL CAUGHT by receiver at", target.loc);
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

  // Reset timing logic
  simStartTime = performance.now();
  timeAccumulator = 0; // Reset the bucket to avoid logic jumps
  runCount++;
}

export { state, tick };

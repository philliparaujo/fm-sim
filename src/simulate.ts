import { H, render, W } from "./render";
import { Ball, Entity, Player, State } from "./types";
import { applyDamping, closestPointOnSegment, dist, length } from "./util";

const createInitialState = (): State => ({
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
      loc: { x: W / 3, y: (1.5 * H) / 4 },
      vel: { x: 0, y: 0 },
      radius: 8,
      color: "red",
      maxSpeed: 1,
      position: "offense",
      role: "blocker",
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
    },
    {
      type: "player" as const,
      loc: { x: W / 3, y: (2.5 * H) / 4 },
      vel: { x: 0, y: 0 },
      radius: 8,
      color: "red",
      maxSpeed: 1,
      position: "offense",
      role: "blocker",
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

  const leftBound = 0 + entity.radius / 2;
  const rightBound = W - entity.radius / 2;
  const topBound = 0 + entity.radius / 2;
  const bottomBound = H - entity.radius / 2;

  if (entity.loc.x < leftBound || entity.loc.x > rightBound) {
    entity.vel.x = -entity.vel.x;
  }
  if (entity.loc.y < topBound || entity.loc.y > bottomBound) {
    entity.vel.y = -entity.vel.y;
  }
}

const SIM_SPEED = 1.0;
const LOGIC_TICK_MS = 1000 / 60;

const BALL_SNAP_DIST = 8; // Maximum distance where a player will snap to the ball
const DAMPING_FACTOR = 0.65; // Reduce velocity to 85%
const RANDOM_JITTER = 0.1; // 10% randomness
const INLINE_NUDGE = 1.4; // Nudges rusher if inline with blocker

const STEER_FACTOR = 1.5; // Rusher C.O.D amount
const LATERAL_STRENGTH = 0.8; // How wide the rusher oscillates
const LATERAL_FREQ = 0.03; // How fast the rusher oscillates

function resolveCollision(a: Player, b: Entity) {
  // 1. Calculate the distance between centers
  const dx = b.loc.x - a.loc.x;
  const dy = b.loc.y - a.loc.y;
  const distance = Math.sqrt(dx * dx + dy * dy);
  // Sum of radii (the minimum distance they should be apart)
  const minDistance = a.radius + b.radius;
  if (distance < minDistance) {
    // If player colliding with ball, make them move in sync
    if (b.type === "ball") {
      if (distance < BALL_SNAP_DIST) {
        const timeTaken = (performance.now() - simStartTime) / 1000;
        console.log(`Rusher reached: ${timeTaken.toFixed(3)}s`);

        resetSimulation();
        return; // Stop processing this frame immediately
      }
    } else if (b.type === "player") {
      const playerB = b as Player;

      // Apply damping if rusher colliding with blocker
      if (a.role === "rusher" && playerB.role === "blocker") {
        applyDamping(a, DAMPING_FACTOR, RANDOM_JITTER);
      } else if (playerB.role === "rusher" && a.role === "blocker") {
        applyDamping(playerB, DAMPING_FACTOR, RANDOM_JITTER);
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

function stepSimulation() {
  // Change all players' velocity direction to follow ball
  for (const player of state.players) {
    switch (player.role) {
      case "blocker": {
        const rushers = state.players.filter((p) => p.role === "rusher");

        // Create a list of potential interceptions
        const potentialBlocks = rushers.map((rusher) => {
          const interceptPoint = closestPointOnSegment(
            player.loc,
            rusher.loc,
            state.ball.loc,
          );
          return {
            rusher,
            interceptPoint,
            distanceToPoint: dist(player.loc, interceptPoint),
          };
        });

        // Sort by the least movement required (distanceToPoint)
        potentialBlocks.sort((a, b) => a.distanceToPoint - b.distanceToPoint);

        const bestBlock = potentialBlocks[0];

        if (bestBlock) {
          const { interceptPoint, distanceToPoint } = bestBlock;

          // Only move if we aren't already "in the way" (e.g., within 2 pixels)
          if (distanceToPoint > 2) {
            const angle = Math.atan2(
              interceptPoint.y - player.loc.y,
              interceptPoint.x - player.loc.x,
            );
            player.vel.x = Math.cos(angle) * player.maxSpeed;
            player.vel.y = Math.sin(angle) * player.maxSpeed;
          } else {
            // Hold the line
            player.vel.x = 0;
            player.vel.y = 0;
          }
        }
        resolveCollision(player, state.ball);
        break;
      }
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
    }
  }

  // Resolve player collisions
  for (let i = 0; i < state.players.length; i++) {
    for (let j = i + 1; j < state.players.length; j++) {
      resolveCollision(state.players[i], state.players[j]);
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
  // Initialize lastTime on first frame to prevent huge jumps
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
  const fresh = createInitialState();

  // Deeply reset the state object properties
  Object.assign(state.ball, fresh.ball);
  state.players.forEach((p, i) => Object.assign(p, fresh.players[i]));

  // Reset timing logic
  simStartTime = performance.now();
  timeAccumulator = 0; // Reset the bucket to avoid logic jumps
  runCount++;
}

export { state, tick };

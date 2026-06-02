import {
  fillOutPlayers,
  generateBall,
  generateDefensivePlaycall,
  generateOffensePlaycall,
} from "./playbook";
import { attemptTackle, stepAsPlayer } from "./playerBehavior";
import { ENDZONE_W, H, render, TOTAL_H, TOTAL_W, W } from "./render";
import { updateScoreboardUI } from "./scoreboard";
import { createEmptyStats, updateStatsAfterPlay } from "./stats";
import {
  Ball,
  Entity,
  PlayEndReason,
  Player,
  Scoreboard,
  State,
  Vector,
} from "./types";
import {
  applyDamping,
  closestPointOnSegment,
  computeFirstDownLine,
  dist,
  distanceAfterFirstDown,
  getPocket,
  isCarryingBall,
  isNoBreakRoute,
  length,
  updateDownAndDistance,
  vectorToString,
  yardsFromPixels,
} from "./util";

const START_DRIVE = (25 * W) / 100 + ENDZONE_W;
const PAUSE_MS_AFTER_PLAY = 0;

const createInitialState = (startingLOS?: number): State => {
  const LOS = startingLOS ?? START_DRIVE;
  const ball = generateBall(LOS);
  const offensePlay = generateOffensePlaycall(LOS, ball, "red");
  const defensePlay = generateDefensivePlaycall(
    LOS,
    "blue",
    offensePlay.players,
  );
  const players = fillOutPlayers([
    ...offensePlay.players,
    ...defensePlay.players,
  ]);

  const scoreboard: Scoreboard = {
    distance: 10,
    down: "1st",
    LOS: LOS,
    firstDownLine: computeFirstDownLine(LOS, 10),
    quarter: "1st",
    teams: [
      { color: "red", name: "RED", score: 0, timeouts: 3, possessing: true },
      { color: "blue", name: "BLU", score: 0, timeouts: 3, possessing: false },
    ],
    time: 900,
  };

  return {
    steps: 0,
    pausedUntil: 0,
    ballGiven: false,
    ballGivenAtStep: 0,
    earlyThrowDecided: false,
    panicThrowDecided: false,
    scoreboard: scoreboard,
    stats: createEmptyStats(),
    currentPlay: {
      offense: offensePlay.playType,
      defense: defensePlay.coverage,
      runAngle: offensePlay.runAngle,
      routes: offensePlay.routes,
    },
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
    resetSimulation("touchdown");
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
export const SIM_SPEED = 1;
const LOGIC_TICK_MS = 1000 / 60;

/* Blocker constants */
const RUSHER_DAMPING_FACTOR = 0.77; // Reduce velocity to 85%
const COVERER_DAMPING_FACTOR = 0.6;
const RUN_BLOCK_DAMPING_FACTOR = 0.45;
export const MIN_BLOCK_DISTANCE = 120;

/* Rusher constants */
const RANDOM_JITTER = 0.1; // 10% randomness
const INLINE_NUDGE = 2.1; // Nudges rusher if inline with blocker
export const RUSHER_STEER_FACTOR = 1; // Rusher C.O.D amount
export const LATERAL_STRENGTH = 1; // How wide the rusher oscillates
export const LATERAL_FREQ = 0.03; // How fast the rusher oscillates

/* Runner constants */
export const LOOK_AHEAD = 160; // How far ahead the runner scans for threats
export const RUNNER_EARLY_AVOID_STRENGTH = 1.3;
export const RUNNER_AVOID_STRENGTH = 2; // How aggressively the runner veers away

export const RUNNER_INITIAL_STEER_DURATION = 60;
export const ANGLE_ENDZONE_INTENT = 1;
export const RUNNER_STEER_FACTOR = 1.5;

/* Receiver constants */
export const PIXELS_PER_STEP = 45;
export const STOP_AFTER_BREAK_THRESHOLD = 10;
export const CATCHER_AVOID_STRENGTH = 0.6;
export const ROUTE_BREAK_ANGLE_JITTER = 3;
export const ROUTE_STEM_DRIFT = 0.06;
export const ROUTE_CUT_SPEED_RETAINED = 0.7;
export const REACCELERATION_DURATION = 30;

export const CATCH_SLOWDOWN_DURATION = 45;
export const MIN_CATCH_SPEED_MULT = 0.8;

/* Coverer constants */
export const START_DELAY = 5; // Snap read — shorter so defenders aren't frozen at the LOS
export const REACTION_DELAY = 47; // Route break reaction — longer lag on receiver changes
export const LEAD_FRAMES = 28;
export const ARRIVAL_RADIUS = 45;

export const ZONE_PULL = 0.8;
export const MAN_CUSHION = 0; // px behind the receiver toward the ball

/* Pursuer constants */
export const PREDICTION_FRAMES = 30;
export const PURSUER_STEER_FACTOR = 0.5;
export const PURSUER_HOMING_FACTOR = 0.1; // Blends the intercept with the direct chase
export const PURSUER_CONTAIN_OFFSET = 10; // 90 if using 3x scale

/* Passer constants */
export const PASSER_STEER_FACTOR = 0.2;

export const PASSER_LOOK_AHEAD = 240; // Radius where passer starts noticing rushers
export const PASSER_AVOID_STRENGTH = 1.7; // Strength of the "push" from rushers

export const BALL_GIVEN_STEPS = 250;
export const MIN_THROW_STEP = 75; // Never throw before this, regardless of condition
export const COMPLETION_RADIUS = 96;
export const EARLY_THROW_SEPARATION = 115; // px of separation that tempts an early throw
export const EARLY_THROW_CHANCE = 0.8; // 40% chance to actually take the early throw
export const PANIC_RUSHER_DIST = 90; // px at which passer feels pressure to throw
export const PANIC_THROW_CHANCE = 0.82; // 55% chance to throw under pressure

export const PASSER_HANDOFF_SEPARATION = 80;

export const QB_ACCURACY_SHORT = 0.9; // 95% completion chance under 15 yards
export const QB_ACCURACY_DEEP = 0.8; // 65% completion chance over 15 yards
export const QB_ACCURACY_PANIC_CHANGE = -0.1;
export const SHORT_THROW_THRESHOLD_PX = 15 * (W / 100); // 15 yards in pixels

/* Tackle / Power constants */
export const TACKLE_PRESSURE_PER_FRAME = 0.05; // How fast pressure builds while in contact (0–1 scale)
export const TACKLE_PRESSURE_THRESHOLD = 1.0; // Pressure at which tackle is guaranteed regardless of power
export const CARRIER_POWER = 0.5; // Ball carrier break-tackle strength (0–1). Tune per player later
export const DEFENDER_TACKLE = 0.5; // Defender tackle strength (0–1). Tune per player later
export const TACKLE_ATTEMPT_CHANCE = 0.3; // Per-frame probability of a tackle attempt while in contact
export const BROKEN_TACKLE_SPEED_BURST = 1.15; // Speed multiplier when carrier breaks a tackle

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
      const currentDamping =
        state.currentPlay.offense === "run"
          ? RUN_BLOCK_DAMPING_FACTOR
          : RUSHER_DAMPING_FACTOR;

      if (a.role === "rusher" && playerB.role === "blocker") {
        applyDamping(a, currentDamping, RANDOM_JITTER);
      } else if (playerB.role === "rusher" && a.role === "blocker") {
        applyDamping(playerB, currentDamping, RANDOM_JITTER);
      }

      if (a.role === "coverer") {
        applyDamping(a, COVERER_DAMPING_FACTOR, RANDOM_JITTER);
      } else if (playerB.role === "coverer") {
        applyDamping(playerB, COVERER_DAMPING_FACTOR, RANDOM_JITTER);
      }

      // Contested tackle system
      const defenderA = a.role === "rusher" || a.role === "coverer" ? a : null;
      const defenderB =
        playerB.role === "rusher" || playerB.role === "coverer"
          ? playerB
          : null;
      const carrierA = isCarryingBall(a, state.ball) ? a : null;
      const carrierB = isCarryingBall(playerB, state.ball) ? playerB : null;

      const defender = defenderA ?? (carrierA ? defenderB : null);
      const carrier = carrierA ?? (defenderB ? carrierB : null);

      if (defender && carrier) {
        attemptTackle(defender, carrier);
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
      resetSimulation("sack");
      break;
    }
    case "rusher": {
      // If rusher collides with ball, simulation ends
      // console.log("SACK");
      resetSimulation("sack");
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
      resetSimulation("turnover");
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

function stepSimulation() {
  // Player behavior
  state.steps++;

  for (const player of state.players) {
    player.contactedThisFrame = false;
    stepAsPlayer(player, state);
  }

  // Resolve player collisions
  for (let i = 0; i < state.players.length; i++) {
    for (let j = i + 1; j < state.players.length; j++) {
      resolveCollision(state.players[i], state.players[j]);
    }
  }

  for (const player of state.players) {
    if (isCarryingBall(player, state.ball) && !player.contactedThisFrame) {
      player.tacklePressure = 0; // reset fully — they're in the clear
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

async function tick(currentTime: number) {
  if (currentTime < state.pausedUntil) {
    lastTime = currentTime;
    render(getPocket(state.scoreboard.LOS), state.scoreboard);
    requestAnimationFrame(tick);
    return;
  }

  if (lastTime === 0) {
    lastTime = currentTime;
    simStartTime = currentTime;
    console.log("--- Simulation Run #1 Started ---");
    updateScoreboardUI(state.scoreboard);
  }

  const deltaTime = currentTime - lastTime;
  lastTime = currentTime;

  timeAccumulator += deltaTime * SIM_SPEED;

  while (timeAccumulator >= LOGIC_TICK_MS) {
    stepSimulation();
    timeAccumulator -= LOGIC_TICK_MS;
  }

  render(getPocket(state.scoreboard.LOS), state.scoreboard);
  requestAnimationFrame(tick);
}

function resetSimulation(reason: PlayEndReason) {
  const prevScoreboard = state.scoreboard;
  const prevStats = state.stats;
  const currentPlay = state.currentPlay;
  const ballGiven = state.ballGiven;
  const ballCarrier = state.players.find((p) => isCarryingBall(p, state.ball));

  const endBallX = state.ball.loc.x;
  const isTouchdown = endBallX >= W + ENDZONE_W;
  const isSafety = endBallX <= ENDZONE_W;
  const yards = yardsFromPixels(
    (isTouchdown ? W + ENDZONE_W : endBallX) - prevScoreboard.LOS,
  );
  const nextLOS = isTouchdown || isSafety ? START_DRIVE : endBallX;

  const updatedStats = updateStatsAfterPlay(
    prevStats,
    currentPlay,
    yards,
    isTouchdown,
    reason,
    ballGiven,
    ballCarrier?.role,
    ballCarrier?.route,
  );

  // Log simulation stats
  // console.log(`Play Ended. New LOS: ${LOSToString(nextLOS)}`);
  console.log(updatedStats);

  let downDistance: Pick<Scoreboard, "down" | "distance" | "firstDownLine">;
  if (isTouchdown) {
    const distance = distanceAfterFirstDown(nextLOS);
    downDistance = {
      down: "1st",
      distance,
      firstDownLine: computeFirstDownLine(nextLOS, distance),
    };
  } else {
    downDistance = updateDownAndDistance(prevScoreboard, nextLOS);
  }

  // Reset state
  state = createInitialState(nextLOS);
  state.stats = updatedStats;
  state.scoreboard = {
    ...prevScoreboard,
    LOS: nextLOS,
    ...downDistance,
  };
  state.pausedUntil = performance.now() + PAUSE_MS_AFTER_PLAY;
  assignCoverageTargets();

  // Reset timing logic
  simStartTime = state.pausedUntil;
  timeAccumulator = 0; // Reset the bucket to avoid logic jumps
  runCount++;

  // Draw scoreboard
  updateScoreboardUI(state.scoreboard);
}

export { resetSimulation, resolveCollision, state, tick };

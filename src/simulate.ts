import {
  ENDZONE_W,
  INLINE_NUDGE,
  LOGIC_TICK_MS,
  PAUSE_MS_AFTER_PLAY,
  simSpeed,
  START_DRIVE,
  TOTAL_H,
  TOTAL_W,
  W,
} from "./constants";
import {
  generateBall,
  generateDefensivePlaycall2,
  generateOffensePlaycall2,
  generateSpecialPlaycall,
} from "./playbook";
import { attemptTackle, stepAsPlayer } from "./playerBehavior";
import { getConstants } from "./ratings";
import { render } from "./render";
import { updateScoreboardUI } from "./scoreboard";
import { createEmptyStats, updateStatsAfterPlay } from "./stats";
import {
  Ball,
  Entity,
  PlayEndReason,
  Player,
  ReplayFrame,
  Roster,
  Scoreboard,
  State,
  Team,
} from "./types";
import {
  applyDamping,
  buildDefaultRoster,
  closestPointOnSegment,
  computeFirstDownLine,
  diff,
  dist,
  distanceAfterFirstDown,
  getLOSAfterPunt,
  getPossessingTeam,
  isCarryingBall,
  isPassPlay,
  isRunPlay,
  length,
  numPlays,
  teamId,
  updateDownAndDistance,
  vectorToString,
  yardsFromPixels,
} from "./util";

const createInitialState = (
  offenseTeam: Team,
  defenseTeam: Team,
  startingLOS?: number,
): State => {
  const LOS = startingLOS ?? START_DRIVE;
  const ball = generateBall(LOS);
  const offensePlay = generateOffensePlaycall2(LOS, ball, offenseTeam);
  const defensePlay = generateDefensivePlaycall2(
    LOS,
    defenseTeam,
    offensePlay.players,
  );

  const scoreboard: Scoreboard = {
    distance: 10,
    down: "1st",
    LOS: LOS,
    firstDownLine: computeFirstDownLine(LOS, 10),
    quarter: "1st",
    teams: [
      { ...offenseTeam, possessing: true },
      { ...defenseTeam, possessing: false },
    ],
    time: 900,
  };

  const specialPlay = generateSpecialPlaycall(scoreboard);

  return {
    steps: 0,
    pausedUntil: 0,
    ballGiven: false,
    ballGivenAtStep: 0,
    blockingAssignments: new Map<Player, Player>(),
    scoreboard: scoreboard,
    stats: createEmptyStats(),
    playAdvanced: {
      wasOffTarget: false,
      wasThrowAway: false,
      wasUnderPressure: false,
    },
    currentPlay: {
      offense: offensePlay.playType,
      defense: defensePlay.coverage,
      special: specialPlay,
      runAngle: offensePlay.runAngle,
      routes: offensePlay.routes,
    },
    ball: ball,
    ballFlight: null,
    players: [...offensePlay.players, ...defensePlay.players],
  };
};

const teams: Team[] = [
  {
    color: "red",
    name: "RED",
    score: 0,
    timeouts: 3,
    possessing: true,
    roster: buildDefaultRoster("red"),
  },
  {
    color: "blue",
    name: "BLU",
    score: 0,
    timeouts: 3,
    possessing: false,
    roster: buildDefaultRoster("blue"),
  },
];

let state: State = createInitialState(teams[0], teams[1]);
assignCoverageTargets();
let simStartTime = performance.now();
let runCount = 1;
let onPlayResetCallback: (() => void) | null = null;

let currentPlayFrames: ReplayFrame[] = [];
let completedPlays: ReplayFrame[][] = []; // Stores up to 3 plays. [0] = 1 play ago, [1] = 2 ago, [2] = 3 ago
export let replayMode: "live" | 0 | 1 | 2 = "live";
let replayFrameIndex = 0;

function setReplayMode(mode: "live" | 0 | 1 | 2) {
  replayMode = mode;
  replayFrameIndex = 0; // Reset animation playhead on switch
}

function getCompletedPlaysCount(): number {
  return completedPlays.length;
}

function captureReplayFrame() {
  currentPlayFrames.push({
    ballLoc: { x: state.ball.loc.x, y: state.ball.loc.y },
    ballVel: { x: state.ball.vel.x, y: state.ball.vel.y },
    players: state.players.map((p) => ({
      ...p,
      loc: { x: p.loc.x, y: p.loc.y },
      vel: { x: p.vel.x, y: p.vel.y },
      prevVel: { x: p.prevVel.x, y: p.prevVel.y },
      assignedTarget: null,
    })),
    // Create a deep value copy of the scoreboard state
    scoreboard: JSON.parse(JSON.stringify(state.scoreboard)),
  });
}

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

function assignBlockingTargets(cachedPlayers: {
  rushers: Player[];
  coverers: Player[];
  catchers: Player[];
  blockers: Player[];
}) {
  // --- Step 1: Assign OL blockers to rushers (1-on-1, no double teams) ---
  const olBlockers = cachedPlayers.blockers;
  const rushers = cachedPlayers.rushers;

  // Release stale OL assignments
  for (const [blocker, defender] of state.blockingAssignments) {
    if (blocker.role === "blocker" && dist(blocker.loc, defender.loc) > 80) {
      state.blockingAssignments.delete(blocker);
    }
  }

  const assignedRushers = new Set(
    [...state.blockingAssignments.entries()]
      .filter(([blocker]) => blocker.role !== "runner")
      .map(([, defender]) => defender),
  );
  const freeRushers = rushers.filter((r) => !assignedRushers.has(r));
  const freeOL = olBlockers.filter((b) => !state.blockingAssignments.has(b));

  freeRushers.sort(
    (a, b) => dist(a.loc, state.ball.loc) - dist(b.loc, state.ball.loc),
  );

  for (const rusher of freeRushers) {
    if (freeOL.length === 0) break;
    freeOL.sort(
      (a, b) =>
        dist(a.loc, closestPointOnSegment(a.loc, rusher.loc, state.ball.loc)) -
        dist(b.loc, closestPointOnSegment(b.loc, rusher.loc, state.ball.loc)),
    );
    const assigned = freeOL.shift()!;
    state.blockingAssignments.set(assigned, rusher);
  }

  // --- Step 2: Assign runner ---
  const runner = state.players.find((p) => p.role === "runner");
  if (runner && !isCarryingBall(runner, state.ball)) {
    const runnerAssignment = state.blockingAssignments.get(runner);
    if (runnerAssignment && dist(runner.loc, runnerAssignment.loc) > 200) {
      state.blockingAssignments.delete(runner);
    }
    if (!state.blockingAssignments.has(runner)) {
      if (!isRunPlay(state)) {
        // First, check for any free rusher not already covered by OL
        const allAssignedRushers = new Set(state.blockingAssignments.values());
        const freeRusher = rushers
          .filter((r) => !allAssignedRushers.has(r))
          .sort(
            (a, b) => dist(a.loc, state.ball.loc) - dist(b.loc, state.ball.loc),
          )[0];

        // Fall back to double-teaming the most dangerous rusher
        const target =
          freeRusher ??
          rushers.sort(
            (a, b) => dist(a.loc, state.ball.loc) - dist(b.loc, state.ball.loc),
          )[0];

        if (target) {
          state.blockingAssignments.set(runner, target);
        }
      }
    }
  }

  // --- Step 3: On run plays, assign catchers to their man coverer ---
  if (isRunPlay(state)) {
    const catchers = cachedPlayers.catchers.filter(
      (p) => !isCarryingBall(p, state.ball),
    );

    // Release stale catcher assignments
    for (const catcher of catchers) {
      const assignment = state.blockingAssignments.get(catcher);
      if (assignment && dist(catcher.loc, assignment.loc) > 120) {
        state.blockingAssignments.delete(catcher);
      }
    }

    for (const coverer of state.players) {
      if (coverer.role !== "coverer" || !coverer.assignedTarget) continue;
      const catcher = catchers.find((c) => c === coverer.assignedTarget);
      if (catcher && !state.blockingAssignments.has(catcher)) {
        state.blockingAssignments.set(catcher, coverer);
      }
    }
  }
}

// Applies velocity and field constraints
function triggerMove(entity: Ball | Player) {
  entity.loc.x += entity.vel.x;
  entity.loc.y += entity.vel.y;

  const radius =
    entity.type === "ball"
      ? entity.radius
      : getConstants("SIZE", entity).radius;
  const margin = radius / 2;
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
    // console.log("TOUCHDOWN!", entity);
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

function resolveCollision(a: Player, b: Entity) {
  // 1. Calculate the distance between centers
  const dx = b.loc.x - a.loc.x;
  const dy = b.loc.y - a.loc.y;
  const distance = Math.sqrt(dx * dx + dy * dy);
  const aRadius = getConstants("SIZE", a).radius;
  const bRadius =
    b.type === "ball"
      ? (b as Ball).radius
      : getConstants("SIZE", b as Player).radius;
  const minDistance = aRadius + bRadius;

  if (distance < minDistance) {
    if (b.type === "ball") {
      if (isCarryingBall(a, b as Ball)) {
        ballCollideBehavior(a);
      }
    } else if (b.type === "player") {
      const playerB = b as Player;

      const blocker =
        a.role === "blocker" ? a : playerB.role === "blocker" ? playerB : null;
      const passer =
        a.role === "passer" ? a : playerB.role === "passer" ? playerB : null;
      const runner =
        a.role === "runner" ? a : playerB.role === "runner" ? playerB : null;

      const defender =
        a.role === "rusher" || a.role === "coverer"
          ? a
          : playerB.role === "rusher" || playerB.role === "coverer"
            ? playerB
            : null;

      const carrier = isCarryingBall(a, state.ball)
        ? a
        : isCarryingBall(playerB, state.ball)
          ? playerB
          : null;

      // ==========================================
      // NEW: RUN DEFENSE BLOCK-SHEDDING ENGINE
      // ==========================================
      if (blocker && defender) {
        // Initialize persistent properties safely if they aren't typed in fillOutPlayer
        if ((defender as any).shedImmunityFrames === undefined)
          (defender as any).shedImmunityFrames = 0;
        if ((defender as any).shedCooldown === undefined)
          (defender as any).shedCooldown = 0;

        // If the defender is currently in a successful shed burst, bypass block penalties entirely
        if ((defender as any).shedImmunityFrames > 0) {
          (defender as any).shedImmunityFrames--;
          return; // Skip standard collision/damping so they can run free
        }

        if ((defender as any).shedCooldown > 0) {
          (defender as any).shedCooldown--;
        }

        // Only roll for a shed if they are actively colliding and not on cooldown
        if ((defender as any).shedCooldown === 0) {
          // Fetch raw ratings from 0.0 to 1.0
          // const shedderRating = defender.ratings?.blockShedding ?? 0.5;
          // const blockerRating = blocker.ratings?.RUNBLOCK ?? 0.5;
          const shedderRating = getConstants(
            "BLOCKSHEDDING",
            defender,
          ).blockShed;
          const blockerRating = isPassPlay(state)
            ? getConstants("PASSBLOCK", blocker).antiBlockShed
            : getConstants("RUNBLOCK", blocker).antiBlockShed;

          // Per-frame base probability (~2% chance per frame baseline at 60 FPS)
          const BASE_SHED_CHANCE = 0.006;
          // Scale chance: high block-shedding vs low run-blocking increases the odds drastically
          const shedChance =
            BASE_SHED_CHANCE * (shedderRating / Math.max(0.1, blockerRating));

          if (Math.random() < shedChance) {
            // SUCCESSFUL SHED!
            (defender as any).shedImmunityFrames = 10; // 20 frames (~0.33s) of block immunity
            (defender as any).shedCooldown = 90; // Cooldown before getting locked in another block

            // PHYSICAL BYPASS NUDGE: Teleport the defender slightly past the blocker toward the ball
            const toBall = diff(state.ball.loc, defender.loc);
            const ballDist = length(toBall);
            if (ballDist > 0) {
              // Nudge them 25 pixels toward the ball to clear the blocker's bounding circle immediately
              defender.loc.x += (toBall.x / ballDist) * 25;
              defender.loc.y += (toBall.y / ballDist) * 25;
            }
            return; // Exit early to avoid damping this frame
          }
        }
      }

      // Initiate blocking (Standard fallback if block isn't shed)
      if (blocker && defender) {
        // Track engagement flag safely since contactedThisFrame is cleared prematurely
        (defender as any).isPhysicallyEngaged = true;

        const { rusherDampingFactor } = getConstants("PASSBLOCK", blocker);
        const {
          runBlockDampingFactor,
          covererDampingFactor,
          runBlockPushStrength,
        } = getConstants("RUNBLOCK", blocker);
        const { randomJitter } = getConstants("BLOCKSHEDDING", defender);

        const damping =
          defender.role === "rusher"
            ? isRunPlay(state)
              ? runBlockDampingFactor
              : rusherDampingFactor
            : covererDampingFactor;

        applyDamping(defender, damping, randomJitter);

        // On run plays, good blockers drive defenders forward
        if (isRunPlay(state) && defender.role === "rusher") {
          const pushStrength =
            (1 - runBlockDampingFactor) * runBlockPushStrength;
          const blockerSpeed = length(blocker.vel);
          if (blockerSpeed > 0.1) {
            defender.vel.x += (blocker.vel.x / blockerSpeed) * pushStrength;
            defender.vel.y += (blocker.vel.y / blockerSpeed) * pushStrength;
          }
        }
      }

      // Initiate tackle attempt
      if (defender && carrier) {
        if (
          carrier.role !== "passer" &&
          state.playAdvanced.firstContactX === undefined
        ) {
          state.playAdvanced.firstContactX = carrier.loc.x;
        }
        attemptTackle(defender, carrier);
      }

      // Initiate handoff
      if (passer && runner && isRunPlay(state) && !state.ballGiven) {
        state.ball.loc.x = runner.loc.x;
        state.ball.loc.y = runner.loc.y;
        state.ballGiven = true;
      }

      // Resolve regular collision
      const overlap = minDistance - distance;
      const nx = dx / distance;
      const ny =
        dy / distance + (Math.random() * INLINE_NUDGE - INLINE_NUDGE / 2);

      const moveX = nx * (overlap / 2);
      const moveY = ny * (overlap / 2);

      a.loc.x -= moveX;
      a.loc.y -= moveY;
      if (isCarryingBall(a, state.ball)) {
        state.ball.loc.x -= moveX;
        state.ball.loc.y -= moveY;
      }

      playerB.loc.x += moveX;
      playerB.loc.y += moveY;
      if (isCarryingBall(playerB, state.ball)) {
        state.ball.loc.x += moveX;
        state.ball.loc.y += moveY;
      }
    }
  }
}

function ballCollideBehavior(player: Player) {
  switch (player.role) {
    case "blocker": {
      // If blocker collides with ball, simulation ends
      // resetSimulation("sack");
      break;
    }
    case "rusher": {
      // If rusher collides with ball, simulation ends
      if (!state.ballFlight?.isInFlight) {
        resetSimulation("sack");
      }
      break;
    }
    case "runner": {
      // If runner collides with ball on running play, runner carries ball
      if (isPassPlay(state) && !state.ballGiven) return;

      state.ball.loc.x = player.loc.x;
      state.ball.loc.y = player.loc.y;
      break;
    }
    case "catcher": {
      // If catcher collides with ball, catcher carries ball
      state.ball.loc.x = player.loc.x;
      state.ball.loc.y = player.loc.y;
      break;
    }
    case "coverer": {
      // If coverer collides with ball, simulation ends (turnover)
      resetSimulation("interception");
      break;
    }
    case "passer": {
      // If passer collides with ball, passer holds it
      if (!state.ballGiven) {
        state.ball.loc.x = player.loc.x;
        state.ball.loc.y = player.loc.y;
      }
      break;
    }
  }
}

function stepSimulation() {
  if (state.currentPlay.special === "fieldgoal") {
    resetSimulation("fieldgoal");
    return;
  } else if (state.currentPlay.special === "punt") {
    resetSimulation("punt");
  }

  // Player behavior
  state.steps++;
  const cachedPlayers = {
    rushers: state.players.filter((p) => p.role === "rusher"),
    coverers: state.players.filter((p) => p.role === "coverer"),
    catchers: state.players.filter((p) => p.role === "catcher"),
    blockers: state.players.filter((p) => p.role === "blocker"),
  };
  assignBlockingTargets(cachedPlayers);

  for (const player of state.players) {
    player.prevVel = { x: player.vel.x, y: player.vel.y };
    player.contactedThisFrame = false;
    stepAsPlayer(player, state, cachedPlayers);
  }

  for (const player of state.players) {
    const { acceleration } = getConstants("SPEED", player);
    const dvx = player.vel.x - player.prevVel.x;
    const dvy = player.vel.y - player.prevVel.y;
    const dvMag = Math.sqrt(dvx * dvx + dvy * dvy);
    if (dvMag > acceleration) {
      const scale = acceleration / dvMag;
      player.vel.x = player.prevVel.x + dvx * scale;
      player.vel.y = player.prevVel.y + dvy * scale;
    }
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

  const activeCarrier = state.players.find((p) =>
    isCarryingBall(p, state.ball),
  );

  if (activeCarrier) {
    // Hard-set the ball's incoming velocity to perfectly match the player's vector
    state.ball.vel.x = activeCarrier.vel.x;
    state.ball.vel.y = activeCarrier.vel.y;

    // Hard-align the coordinates so there is 0% positional drift during heavy cuts
    state.ball.loc.x = activeCarrier.loc.x;
    state.ball.loc.y = activeCarrier.loc.y;
  }

  // Move entities
  triggerMove(state.ball);
  for (const player of state.players) {
    triggerMove(player);
  }
}

let lastTime = 0;
let timeAccumulator = 0;

async function tick(timestamp: number = performance.now()) {
  // 1. Initialize or compute frame delta time
  let dt = timestamp - lastTime;
  lastTime = timestamp;

  // Cap extreme delta spikes (e.g., when switching browser tabs) to prevent physics explosions
  if (dt > 100) dt = 16.666;

  // 2. Process simulation timing based on the current mode
  if (replayMode === "live") {
    // If the live game is in a post-play pause window, skip simulation updates but keep animating
    if (timestamp < state.pausedUntil) {
      render(state);
      updateScoreboardUI(state.scoreboard);
      requestAnimationFrame(tick);
      return;
    }

    // Apply the speed slider multiplier to the live delta time accumulation
    timeAccumulator += dt * simSpeed;

    // Fixed-timestep execution loop for live gameplay
    while (timeAccumulator >= LOGIC_TICK_MS) {
      // --- START OF YOUR EXISTING LIVE GAMESTEP LOGIC ---
      // (This updates player movements, pathing, checks collisions, fumbles, etc.)
      stepSimulation();
      timeAccumulator -= LOGIC_TICK_MS;

      // --- END OF YOUR EXISTING LIVE GAMESTEP LOGIC ---

      // Record a perfect frame snapshot immediately following the step resolution
      captureReplayFrame();
    }
  } else {
    // Replay Mode: The live simulation completely pauses.
    // We pass dt through the identical slider scale to control history playback speed!
    timeAccumulator += dt * simSpeed;

    const activePlay = completedPlays[replayMode];
    if (activePlay && activePlay.length > 0) {
      while (timeAccumulator >= LOGIC_TICK_MS) {
        // Step the replay animation forward frame-by-frame, looping seamlessly
        replayFrameIndex = (replayFrameIndex + 1) % activePlay.length;
        timeAccumulator -= LOGIC_TICK_MS;
      }
    }
  }

  // 3. Frame Routing & Render Pass
  if (replayMode === "live") {
    // Render standard ongoing game state
    render(state);
    updateScoreboardUI(state.scoreboard);
  } else {
    // Render historical frames from the replay buffer
    const activePlay = completedPlays[replayMode];
    if (activePlay && activePlay[replayFrameIndex]) {
      const frame = activePlay[replayFrameIndex];

      // Map the frame values into a temporary mock state structure for the renderer
      const mockState: State = {
        ...state,
        ball: { ...state.ball, loc: frame.ballLoc, vel: frame.ballVel },
        players: frame.players,
        scoreboard: frame.scoreboard,
      };

      // Feed the visual blueprint into your canvas engine & UI layer
      render(mockState);
      updateScoreboardUI(frame.scoreboard);
    }
  }

  // Continuously pump the main animation loop
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
  const isInterception = reason === "interception";
  const isIncomplete = reason === "incomplete";
  const isFieldGoal = reason === "fieldgoal";
  const isPunt = reason == "punt";

  // Determine where the ball naturally died before checking for a turnover
  const finalLOSBeforeFlip = isIncomplete ? prevScoreboard.LOS : endBallX;

  // Detect a Turnover on Downs (Failed to cross firstDownLine on 4th down)
  const isTurnoverOnDowns =
    prevScoreboard.down === "4th" &&
    !isTouchdown &&
    !isSafety &&
    !isInterception &&
    !isFieldGoal &&
    !isPunt &&
    finalLOSBeforeFlip < (prevScoreboard.firstDownLine ?? Infinity);

  // Calculate the next Line of Scrimmage with a field-perspective flip if possession changes
  let nextLOS = START_DRIVE;
  if (isTouchdown || isSafety || isInterception || isFieldGoal) {
    nextLOS = START_DRIVE;
  } else if (isPunt) {
    nextLOS = getLOSAfterPunt(prevScoreboard.LOS);
  } else if (isTurnoverOnDowns) {
    // Flip the ball position so the new offense drives left-to-right from that spot
    nextLOS = TOTAL_W - finalLOSBeforeFlip;
  } else {
    nextLOS = finalLOSBeforeFlip;
  }

  const yards = yardsFromPixels(
    (isTouchdown ? W + ENDZONE_W : endBallX) - prevScoreboard.LOS,
  );

  if (reason === "sack") {
    state.playAdvanced.sackFrame = state.steps;
  }

  const updatedStats = updateStatsAfterPlay(
    prevStats,
    currentPlay,
    yards,
    isTouchdown,
    reason,
    ballGiven,
    ballCarrier?.role,
    ballCarrier?.route,
    state.playAdvanced,
    state.scoreboard.LOS,
    endBallX,
  );

  if (numPlays(updatedStats) % 100 == 0)
    console.log(numPlays(updatedStats), updatedStats);

  // Set up down and distance metadata (Turnovers grant a fresh 1st down)
  let downDistance: Pick<Scoreboard, "down" | "distance" | "firstDownLine">;
  if (
    isTouchdown ||
    isInterception ||
    isSafety ||
    isFieldGoal ||
    isPunt ||
    isTurnoverOnDowns
  ) {
    const distance = distanceAfterFirstDown(nextLOS);
    downDistance = {
      down: "1st",
      distance,
      firstDownLine: computeFirstDownLine(nextLOS, distance),
    };
  } else {
    downDistance = updateDownAndDistance(prevScoreboard, nextLOS);
  }

  // Update replays
  if (currentPlayFrames.length > 0) {
    completedPlays.unshift([...currentPlayFrames]);
    if (completedPlays.length > 3) {
      completedPlays.pop();
    }
    currentPlayFrames = [];
    window.dispatchEvent(new CustomEvent("playRecorded"));
  }

  // --- POSSESSION & SCORE MASTER UPDATE ---
  // Find the exact active elements in the global teams array to keep data fresh
  const activeOffenseTeam = getPossessingTeam(state);
  const globalOffenseTeam = teams.find(
    (t) => t.name === activeOffenseTeam.name,
  )!;
  const globalDefenseTeam =
    teamId(teams[0]) === teamId(globalOffenseTeam) ? teams[1] : teams[0];

  // Apply scoring directly to the master global objects
  if (isTouchdown) {
    globalOffenseTeam.score += 7;
  } else if (isFieldGoal) {
    globalOffenseTeam.score += 3;
  } else if (isSafety) {
    globalDefenseTeam.score += 2;
  }

  // Check all possible reasons possession shifts to the other team
  const flipPossession =
    isTouchdown ||
    isFieldGoal ||
    isSafety ||
    isPunt ||
    isInterception ||
    isTurnoverOnDowns;

  if (flipPossession) {
    // Pass the fresh global master objects with updated scores to the new state
    Object.assign(
      state,
      createInitialState(globalDefenseTeam, globalOffenseTeam, nextLOS),
    );
  } else {
    Object.assign(
      state,
      createInitialState(globalOffenseTeam, globalDefenseTeam, nextLOS),
    );
  }

  // Sync historical scoreboard structures with the fresh layout
  state.stats = updatedStats;
  state.scoreboard = {
    ...state.scoreboard,
    quarter: prevScoreboard.quarter,
    time: prevScoreboard.time,
    ...downDistance,
  };
  state.currentPlay.special = generateSpecialPlaycall(state.scoreboard);

  state.pausedUntil = performance.now() + PAUSE_MS_AFTER_PLAY;
  state.blockingAssignments = new Map();
  assignCoverageTargets();

  // Reset timing logic
  simStartTime = state.pausedUntil;
  timeAccumulator = 0;
  runCount++;

  // Draw scoreboard
  updateScoreboardUI(state.scoreboard);
  onPlayResetCallback?.();
}

function onPlayReset(cb: () => void) {
  onPlayResetCallback = cb;
}

export {
  getCompletedPlaysCount,
  onPlayReset,
  resetSimulation,
  resolveCollision,
  setReplayMode,
  state,
  tick,
};

import {
  PAUSE_MS_AFTER_PLAY,
  simSpeed,
  TRAINING_MODE_ON,
} from "./core/constants";
import { generateSpecialPlaycall } from "./core/playbook";
import { getConstants } from "./core/ratings";
import { recreateState, state } from "./core/state";
import { Ball, PlayEndReason, Player } from "./core/types";
import { stepAsPlayer } from "./playerBehavior";
import { render } from "./render";
import { updateScoreboardUI } from "./scoreboard";
import {
  assignBlockingTargets,
  assignCoverageTargets,
} from "./sim/assignments";
import { resolveCollision } from "./sim/collision";
import {
  captureReplayFrame,
  getReplayFrame,
  getReplayMockState,
  incrementReplay,
  isLive,
  saveReplay,
} from "./sim/replay";
import { updateStatsAfterPlay } from "./stats";
import {
  clampPosInBounds,
  getLOSAfterPunt,
  isCarryingBall,
  snapBallToPlayer,
  updateDownAndDistance,
} from "./utils/field";
import { getDefenseTeam, getOffenseTeam } from "./utils/roster";
import {
  checkIfFieldGoal,
  checkIfInterception,
  checkIfPunt,
  checkIfSafety,
  checkIfTouchdown,
  checkIfTurnoverOnDowns,
  getFinalBallX,
  numPlays,
} from "./utils/stats";
import {
  ENDZONE_W,
  LOGIC_TICK_MS,
  START_DRIVE,
  TOTAL_W,
  W,
} from "./utils/units";

// Applies velocity and field constraints
function triggerMove(entity: Ball | Player) {
  entity.loc.x += entity.vel.x;
  entity.loc.y += entity.vel.y;

  const rightEndzone = W + ENDZONE_W;
  if (
    entity.type === "player" &&
    isCarryingBall(entity, state.ball) &&
    entity.loc.x > rightEndzone
  ) {
    resetSimulation("touchdown");
  }

  // If they go out of bounds, snap them back to the edge
  entity.loc = clampPosInBounds(entity.loc);
}

function stepSimulation() {
  // Handle special teams differently
  if (state.currentPlay.special === "fieldgoal") {
    resetSimulation("fieldgoal");
    return;
  } else if (state.currentPlay.special === "punt") {
    resetSimulation("punt");
    return;
  }

  // Increment tick count on current play
  state.steps++;

  // Player behavior
  // TODO: Can I compute cachedPlayers just once on start of each play?
  const cachedPlayers = {
    rushers: state.players.filter((p) => p.role === "rusher"),
    coverers: state.players.filter((p) => p.role === "coverer"),
    catchers: state.players.filter((p) => p.role === "catcher"),
    blockers: state.players.filter((p) => p.role === "blocker"),
  };
  assignBlockingTargets(cachedPlayers);

  for (const player of state.players) {
    player.prevVel = { x: player.vel.x, y: player.vel.y };
    player.contactedThisTick = false;
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
    if (isCarryingBall(player, state.ball)) {
      if (!player.contactedThisTick) {
        player.tacklePressure = 0;
      }

      snapBallToPlayer(player, state.ball);
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

async function tick(timestamp: number = performance.now()) {
  const dt = Math.min(timestamp - lastTime, 100); // cap tab-switch spikes
  lastTime = timestamp;

  // 1. Render last completed state
  if (isLive()) {
    render(state);
    updateScoreboardUI(state.scoreboard);
  } else {
    const frame = getReplayFrame();
    if (frame) {
      render(getReplayMockState(frame));
      updateScoreboardUI(frame.scoreboard);
    }
  }

  // 2. Advance simulation or replay playhead (skip during post-play pause)
  const paused = isLive() && timestamp < state.pausedUntil;
  if (!paused) {
    timeAccumulator += dt * simSpeed;
    while (timeAccumulator >= LOGIC_TICK_MS) {
      if (isLive()) {
        stepSimulation();
        captureReplayFrame();
      } else {
        incrementReplay();
      }
      timeAccumulator -= LOGIC_TICK_MS;
    }
  }

  requestAnimationFrame(tick);
}

function resetSimulation(reason: PlayEndReason) {
  const prevScoreboard = state.scoreboard;

  const isTouchdown = checkIfTouchdown(state, reason);
  const isSafety = checkIfSafety(state, reason);
  const isInterception = checkIfInterception(state, reason);
  const isFieldGoal = checkIfFieldGoal(state, reason);
  const isPunt = checkIfPunt(state, reason);

  // 1) Calculate new LOS
  const finalLOSBeforeFlip = getFinalBallX(state, reason, prevScoreboard);
  const isTurnoverOnDowns = checkIfTurnoverOnDowns(state, reason);

  let nextLOS = START_DRIVE;
  if (TRAINING_MODE_ON) {
    // Training mode: Same team keeps ball
    if (isTouchdown || isSafety || isFieldGoal) {
      nextLOS = START_DRIVE;
    } else {
      nextLOS = finalLOSBeforeFlip;
    }
  } else {
    // Normal game: Possession switches to other team
    if (isTouchdown || isSafety || isFieldGoal) {
      nextLOS = START_DRIVE;
    } else if (isPunt) {
      nextLOS = getLOSAfterPunt(prevScoreboard.LOS);
    } else if (isTurnoverOnDowns || isInterception) {
      nextLOS = TOTAL_W - finalLOSBeforeFlip;
    } else {
      nextLOS = finalLOSBeforeFlip;
    }
  }

  const activeOffenseTeam = getOffenseTeam(state);
  const activeDefenseTeam = getDefenseTeam(state);
  const offenseTeamName = activeOffenseTeam.name;
  const updatedTeamStats = updateStatsAfterPlay(state, reason);
  const updatedGlobalStats = {
    ...state.stats,
    [offenseTeamName]: updatedTeamStats,
  };

  if (numPlays(updatedTeamStats) % 100 === 0) {
    console.log(
      `${offenseTeamName} Offense Milestone:`,
      numPlays(updatedTeamStats),
      updatedTeamStats,
    );
  }

  const forceFirstDown =
    isTouchdown ||
    isInterception ||
    isSafety ||
    isFieldGoal ||
    isPunt ||
    isTurnoverOnDowns;
  const downDistance = updateDownAndDistance(
    prevScoreboard,
    nextLOS,
    forceFirstDown,
  );

  saveReplay();

  if (isTouchdown) {
    activeOffenseTeam.score += 7;
  } else if (isFieldGoal) {
    activeOffenseTeam.score += 3;
  } else if (isSafety) {
    activeDefenseTeam.score += 2;
  }

  const flipPossession =
    !TRAINING_MODE_ON &&
    (isTouchdown ||
      isFieldGoal ||
      isSafety ||
      isPunt ||
      isInterception ||
      isTurnoverOnDowns);

  if (flipPossession) {
    Object.assign(
      state,
      recreateState(activeDefenseTeam, activeOffenseTeam, nextLOS),
    );
  } else {
    Object.assign(
      state,
      recreateState(activeOffenseTeam, activeDefenseTeam, nextLOS),
    );
  }

  // Persist the entire dictionary block across the active session boundaries
  state.stats = updatedGlobalStats;

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

  timeAccumulator = 0;

  updateScoreboardUI(state.scoreboard);
  onPlayResetCallback?.();
}

let onPlayResetCallback: (() => void) | null = null;
function onPlayReset(cb: () => void) {
  onPlayResetCallback = cb;
}

export { onPlayReset, resetSimulation, state, tick };

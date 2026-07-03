import {
  PAUSE_MS_AFTER_PLAY,
  simSpeed,
  TRAINING_MODE_ON,
} from "../core/constants";
import { generateSpecialPlaycall } from "../core/playbook";
import { getConstants } from "../core/ratings";
import { recreateState, state } from "../core/state";
import { Ball, PlayEndReason, Player } from "../core/types";
import { stepAsPlayer } from "../behavior";
import { render } from "../render";
import { updateScoreboardUI } from "../scoreboard";
import { assignBlockingTargets, assignCoverageTargets } from "./assignments";
import { resolveCollision } from "./collision";
import {
  captureReplayFrame,
  getReplayFrame,
  getReplayMockState,
  incrementReplay,
  isLive,
  saveReplay,
} from "./replay";
import { updateStatsAfterPlay } from "../stats";
import {
  clampPosInBounds,
  getLOSAfterPunt,
  isCarryingBall,
  snapBallToPlayer,
  updateDownAndDistance,
} from "../utils/field";
import { tryUseTimeout } from "../utils/clock";
import { getDefenseTeam, getOffenseTeam } from "../utils/roster";
import {
  checkIfFieldGoal,
  checkIfInterception,
  checkIfPassIncomplete,
  checkIfPunt,
  checkIfSafety,
  checkIfTouchdown,
  checkIfTurnoverOnDowns,
  getFinalBallX,
  numPlays,
} from "../utils/stats";
import {
  ENDZONE_W,
  LOGIC_TICK_MS,
  PLAY_CLOCK_RUNOFF,
  QUARTER_SECONDS,
  START_DRIVE,
  ticksToSeconds,
  TWO_MINUTE_WARNING_SECONDS,
  TOTAL_W,
  W,
} from "../utils/units";
import { resolveBallInAir } from "../behavior/passing";

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

  // Run the game clock down during live play (real game only)
  if (!TRAINING_MODE_ON) {
    state.scoreboard.time = Math.max(
      0,
      state.scoreboard.time - ticksToSeconds(1),
    );
  }

  // Player behavior
  // TODO: Can I compute cachedPlayers just once on start of each play?
  const cachedPlayers = {
    passer: state.players.find((p) => p.role === "passer"),
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

  // Advance any in-flight pass and resolve the catch/INT/incompletion
  resolveBallInAir(state, cachedPlayers);
}

const QUARTERS = ["1st", "2nd", "3rd", "4th"] as const;
let gameOver = false;

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
  if (!paused && !(gameOver && isLive())) {
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
  const isIncomplete = checkIfPassIncomplete(state, reason);
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
  const nextDownDistance = updateDownAndDistance(
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

  // Advance the game clock between plays, rolling into the next quarter or
  // ending the game when it expires (real game only)
  let nextTime = prevScoreboard.time;
  let nextQuarter = prevScoreboard.quarter;
  let nextTwoMinuteWarning = prevScoreboard.twoMinuteWarning;
  if (!TRAINING_MODE_ON) {
    // Two-minute warning: a one-time clock stoppage the first time the clock
    // reaches 2:00 in Q2/Q4. The crossing play pins the clock to exactly 2:00
    // (or keeps a lower time it already ran to in-play) and latches the flag so
    // it never fires again; afterward the clock follows normal running/stopping
    // rules for the rest of the quarter.
    const inWarningQuarter = nextQuarter === "2nd" || nextQuarter === "4th";
    const warningFires =
      inWarningQuarter &&
      !nextTwoMinuteWarning &&
      nextTime - PLAY_CLOCK_RUNOFF <= TWO_MINUTE_WARNING_SECONDS;
    if (warningFires) {
      nextTwoMinuteWarning = true;
      nextTime = Math.min(nextTime, TWO_MINUTE_WARNING_SECONDS);
      // console.log("Two-minute warning");
    }

    // The clock only runs off between plays when it kept moving — not on
    // incompletions, changes of possession, scoring plays, or the single play
    // the two-minute warning stops it
    const clockAlreadyStopped =
      warningFires ||
      isIncomplete ||
      isInterception ||
      isPunt ||
      isSafety ||
      isFieldGoal ||
      isTurnoverOnDowns ||
      isTouchdown;

    // A team may burn a timeout to stop an otherwise-running clock
    const timeoutUsed =
      !clockAlreadyStopped &&
      tryUseTimeout(state.scoreboard.teams, nextQuarter, nextTime);

    if (!clockAlreadyStopped && !timeoutUsed) {
      nextTime -= PLAY_CLOCK_RUNOFF;
    }

    if (nextTime <= 0) {
      if (nextQuarter === "4th") {
        nextTime = 0;
        gameOver = true;
        console.log("Game over — final stats:");
        for (const [teamName, teamStats] of Object.entries(state.stats)) {
          console.log(`${teamName}:`, numPlays(teamStats), teamStats);
        }
      } else {
        nextQuarter = QUARTERS[QUARTERS.indexOf(nextQuarter) + 1];
        nextTime = QUARTER_SECONDS;
        nextTwoMinuteWarning = false; // reset for the new quarter
        // Halftime: each team gets a fresh set of 3 timeouts for the 2nd half
        if (nextQuarter === "3rd") {
          for (const team of state.scoreboard.teams) team.timeouts = 3;
        }
      }
    }
  }

  state.scoreboard = {
    ...state.scoreboard,
    quarter: nextQuarter,
    time: nextTime,
    twoMinuteWarning: nextTwoMinuteWarning,
    ...nextDownDistance,
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

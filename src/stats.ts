import { PlayEndReason, QBStats, RBStats, State, Stats } from "./core/types";
import { isCarryingBall } from "./utils/field";
import { getOffenseTeam } from "./utils/roster";
import {
  applyQBStats,
  applyRBStats,
  checkIfFieldGoal,
  checkIfInterception,
  checkIfPassAttempt,
  checkIfTouchdown,
  checkIfPassComplete,
  checkIfPunt,
  checkIfRush,
  checkIfSack,
  createEmptyStats,
  getFinalBallX,
  playcallCoverageKey,
  routeKey,
  updateAverage,
  updateCountYards,
} from "./utils/stats";
import { ENDZONE_W, pxToYards, ticksToSeconds, W } from "./utils/units";

/** Updates state.stats with information from the play that just ended */
function updateStatsAfterPlay(state: State, reason: PlayEndReason): Stats {
  const activeOffenseTeam = getOffenseTeam(state);
  const offenseTeamName = activeOffenseTeam.name;
  const _stats = state.stats[offenseTeamName] || createEmptyStats();
  const next: Stats = structuredClone(_stats);

  // 1) No stat tracking for special teams plays
  if (checkIfFieldGoal(state, reason) || checkIfPunt(state, reason))
    return next;

  const play = state.currentPlay;
  const los = state.scoreboard.LOS;
  const finalBallX = getFinalBallX(state, reason, state.scoreboard);
  const matchupKey = playcallCoverageKey(play.offense, play.defense);

  const isRush = checkIfRush(state, reason);
  const isPassAttempt = checkIfPassAttempt(state, reason);
  const isComplete = checkIfPassComplete(state, reason);
  const isSack = checkIfSack(state, reason);
  const isTouchdown = checkIfTouchdown(state, reason);
  const isInterception = checkIfInterception(state, reason);

  const _yards = pxToYards((isTouchdown ? W + ENDZONE_W : finalBallX) - los);
  const netYards = isInterception ? 0 : _yards;

  // 2) Playcall/coverage yard stats
  updateCountYards(next.playcalls[play.offense], netYards);
  updateCountYards(next.coverage[play.defense], netYards);
  updateCountYards(next.playcallCoverage[matchupKey], netYards);

  // 3) QB/RB stats, playcallCoverage stats, route yard stats
  if (play.offense === "pass") {
    const qbStats = next.playcallCoverageStats[matchupKey] as QBStats;
    applyQBStats(qbStats, netYards, state, reason);
    applyQBStats(next.qb, netYards, state, reason);

    const ballCarrier = state.players.find((p) =>
      isCarryingBall(p, state.ball),
    );
    const ballCarrierRoute = ballCarrier?.route;
    if (isPassAttempt || isSack) {
      // Update yards once for the route, and then update counts for all routes
      if (isComplete && ballCarrierRoute) {
        next.routes[routeKey(ballCarrierRoute)].yards += netYards;
      }
      for (const route of play.routes) {
        updateCountYards(next.routes[routeKey(route)], 0);
      }
    }
  } else {
    const rbStats = next.playcallCoverageStats[matchupKey] as RBStats;
    applyRBStats(rbStats, netYards, state, reason);
    applyRBStats(next.rb, netYards, state, reason);
  }

  // 4) Advanced stats
  const playAdvData = state.playAdvanced; // Stores play-specific data
  const adv = next.advanced; // Stores accumulated stats

  // NOTE: These counts (must) include the current play to comply with updateAverage()
  // These counts were updated during step 3
  const rushCount = next.rb.rushes;
  const passCount = next.qb.attempts;
  const completionCount = next.qb.completions;
  const sackCount = next.qb.sacks;
  const dropbackCount = passCount + sackCount;

  // Time to throw (TTT)
  if (isPassAttempt && playAdvData.throwTick !== undefined) {
    const playTtt = ticksToSeconds(playAdvData.throwTick);
    adv.timeToThrow = updateAverage(adv.timeToThrow, passCount, playTtt);
  }

  // Time to sack (TTS)
  if (isSack) {
    const playTts = ticksToSeconds(state.steps);
    adv.timeToSack = updateAverage(adv.timeToSack, sackCount, playTts);
  }

  // Intended/completed air yards
  if (isPassAttempt && playAdvData.airYards !== undefined) {
    const playAirYards = pxToYards(Math.max(0, playAdvData.airYards));
    adv.intendedAirYards = updateAverage(
      adv.intendedAirYards,
      passCount,
      playAirYards,
    );

    if (isComplete) {
      adv.completedAirYards = updateAverage(
        adv.completedAirYards,
        completionCount,
        playAirYards,
      );
    }
  }

  // Off-target throw %
  if (isPassAttempt) {
    const playOffTarget = playAdvData.wasOffTarget ? 1 : 0;
    adv.offTargetThrowRate = updateAverage(
      adv.offTargetThrowRate,
      passCount,
      playOffTarget,
    );
  }

  // Throw-away rate
  if (isPassAttempt) {
    const playThrowAway = playAdvData.wasThrowAway ? 1 : 0;
    adv.throwAwayRate = updateAverage(
      adv.throwAwayRate,
      passCount,
      playThrowAway,
    );
  }

  // Pressure rate, sack rate
  if (play.offense === "pass") {
    const playUnderPressure = playAdvData.wasUnderPressure ? 1 : 0;
    const playSackCount = isSack ? 1 : 0;

    adv.pressureRate = updateAverage(
      adv.pressureRate,
      dropbackCount,
      playUnderPressure,
    );
    adv.sackRate = updateAverage(adv.sackRate, dropbackCount, playSackCount);
  }

  // Separation at catch (requires at least one defender on field)
  if (
    isComplete &&
    playAdvData.separationAtCatch !== undefined &&
    isFinite(playAdvData.separationAtCatch)
  ) {
    const playSepYds = pxToYards(playAdvData.separationAtCatch);
    adv.receiverSeparation = updateAverage(
      adv.receiverSeparation,
      completionCount,
      playSepYds,
    );
  }

  // YBC / YAC
  if (isRush && los) {
    const playYbc =
      playAdvData.firstContactX === undefined
        ? netYards
        : pxToYards(playAdvData.firstContactX - los);
    const playYac = netYards - playYbc;
    adv.rushYardsBeforeContact = updateAverage(
      adv.rushYardsBeforeContact,
      rushCount,
      playYbc,
    );
    adv.rushYardsAfterContact = updateAverage(
      adv.rushYardsAfterContact,
      rushCount,
      playYac,
    );
  }

  // Receiver YAC
  if (isComplete && finalBallX && playAdvData.catchX !== undefined) {
    const yac = Math.max(0, pxToYards(finalBallX - playAdvData.catchX));
    adv.receiverYardsAfterCatch = updateAverage(
      adv.receiverYardsAfterCatch,
      completionCount,
      yac,
    );
  }

  return next;
}

export { updateStatsAfterPlay };

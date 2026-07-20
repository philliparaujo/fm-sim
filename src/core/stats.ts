import { Player, PlayEndReason, QBStats, RBStats, State, Stats } from "./types";
import { isCarryingBall } from "../utils/field";
import { getDefenseTeam, getOffenseTeam } from "../utils/roster";
import {
  applyQBStats,
  applyRBStats,
  checkIfFieldGoal,
  checkIfInterception,
  checkIfPassAttempt,
  checkIfPassIncomplete,
  checkIfTouchdown,
  checkIfPassComplete,
  checkIfPunt,
  checkIfRush,
  checkIfSack,
  createEmptyStats,
  getFinalBallX,
  playcallCoverageKey,
  routeKey,
  specificPlaycallCoverageKey,
  updateAverage,
  updateCountYards,
} from "../utils/stats";
import { ENDZONE_W, pxToYards, ticksToSeconds, W } from "../utils/units";

/**
 * Updates stats for the play that just ended and returns the full per-team map
 * with the offense and defense entries replaced. Offensive lines (passing,
 * rushing, receiving, playcalls, advanced) accrue to the possessing team; the
 * defensive line (tackles, TFLs, sacks, INTs, PBUs) accrues to the other team.
 */
function updateStatsAfterPlay(
  state: State,
  reason: PlayEndReason,
): Record<string, Stats> {
  const activeOffenseTeam = getOffenseTeam(state);
  const activeDefenseTeam = getDefenseTeam(state);
  const offenseTeamName = activeOffenseTeam.name;
  const defenseTeamName = activeDefenseTeam.name;

  const next: Stats = structuredClone(
    state.stats[offenseTeamName] || createEmptyStats(),
  );
  const defenseNext: Stats = structuredClone(
    state.stats[defenseTeamName] || createEmptyStats(),
  );
  const result: Record<string, Stats> = {
    ...state.stats,
    [offenseTeamName]: next,
    [defenseTeamName]: defenseNext,
  };

  // The team's aggregate passing/rushing lines live in the per-label dictionary
  // under the QB and RB slots; alias them for the accumulation below.
  const qb = next.players.QB!.passing!;
  const rb = next.players.RB!.rushing!;

  // 1) No stat tracking for special teams plays
  if (checkIfFieldGoal(state, reason) || checkIfPunt(state, reason))
    return result;

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

  // 2) Playcall/coverage yard stats. The defensive coverage call belongs to
  // the defense, not the offense — it's the defense's own playcall, and
  // "yards given up" only makes sense attributed to whoever called it.
  updateCountYards(next.playcalls[play.offense], netYards);
  updateCountYards(defenseNext.coverage[play.defense], netYards);
  updateCountYards(
    defenseNext.specificCoverage[play.defenseSpecific],
    netYards,
  );
  updateCountYards(
    defenseNext.specificPlaycallCoverage[
      specificPlaycallCoverageKey(play.offense, play.defenseSpecific)
    ],
    netYards,
  );
  updateCountYards(next.playcallCoverage[matchupKey], netYards);

  // 3) QB/RB stats, playcallCoverage stats, route yard stats
  if (play.offense === "pass") {
    const qbStats = next.playcallCoverageStats[matchupKey] as QBStats;
    applyQBStats(qbStats, netYards, state, reason);
    applyQBStats(qb, netYards, state, reason);

    const ballCarrier = state.players.find((p) =>
      isCarryingBall(p, state.ball),
    );
    const ballCarrierRoute = ballCarrier?.route;
    if (isPassAttempt || isSack) {
      // Update yards once for the route, and then update counts for all routes
      if (isComplete && ballCarrierRoute) {
        const key = routeKey(ballCarrierRoute);
        next.routes[key].yards += netYards;
        qb.routeYards[key] = (qb.routeYards[key] ?? 0) + netYards;
        const coverageBucket = (next.routeCoverage[play.defenseSpecific] ??=
          {});
        coverageBucket[key] = (coverageBucket[key] ?? 0) + netYards;
      }
      for (const route of play.routes) {
        updateCountYards(next.routes[routeKey(route)], 0);
      }
    }
  } else {
    const rbStats = next.playcallCoverageStats[matchupKey] as RBStats;
    applyRBStats(rbStats, netYards, state, reason);
    applyRBStats(rb, netYards, state, reason);
  }

  // 4) Advanced stats
  const playAdvData = state.playAdvanced; // Stores play-specific data
  const adv = next.advanced; // Stores accumulated stats

  // NOTE: These counts (must) include the current play to comply with updateAverage()
  // These counts were updated during step 3
  const rushCount = rb.rushes;
  const passCount = qb.attempts;
  const completionCount = qb.completions;
  const sackCount = qb.sacks;
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

  // 5) Receiving stats (offense): the targeted receiver gets a target; on a
  // completion the catcher also gets a reception, yards, and any touchdown.
  if (isPassAttempt) {
    const intended = state.ballFlight?.receiver;
    const intendedRec =
      intended && intended.color === activeOffenseTeam.color
        ? next.players[intended.label]?.receiving
        : undefined;
    if (intendedRec) intendedRec.targets++;
    if (isComplete) {
      const catcher = state.players.find((p) => isCarryingBall(p, state.ball));
      const rec =
        catcher && catcher.color === activeOffenseTeam.color
          ? next.players[catcher.label]?.receiving
          : undefined;
      if (rec) {
        rec.catches++;
        rec.yards += netYards;
        if (isTouchdown) rec.tds++;
        if (catcher?.route) {
          const key = routeKey(catcher.route);
          rec.routeYards[key] = (rec.routeYards[key] ?? 0) + netYards;
        }
      }
    }
  }

  // 6) Defensive stats (defense): credit the tackler, sacker, interceptor, or
  // pass-breakup defender captured during the play.
  const pa = state.playAdvanced;
  const defenseOf = (pl?: Player) =>
    pl && pl.color === activeDefenseTeam.color
      ? defenseNext.players[pl.label]?.defense
      : undefined;

  if (isSack) {
    const d = defenseOf(pa.tackler);
    if (d) {
      d.sacks++;
      d.tackles++; // a sack is also a tackle in the box score
    }
  } else if (reason === "tackle") {
    const d = defenseOf(pa.tackler);
    if (d) {
      d.tackles++;
      if (netYards < 0) d.tfls++; // tackle for loss
    }
  }
  if (isInterception) {
    const d = defenseOf(pa.interceptor);
    if (d) d.interceptions++;
  }
  if (checkIfPassIncomplete(state, reason)) {
    const d = defenseOf(pa.passDefender);
    if (d) d.passBreakups++;
  }

  return result;
}

export { updateStatsAfterPlay };

import {
  AdvancedStats,
  cornerRoute,
  curlRoute,
  CurrentPlay,
  DefensiveCoverageType,
  dragRoute,
  flatRoute,
  inRoute,
  OffensivePlayType,
  outRoute,
  PlayAdvancedData,
  PlaycallCoverageKey,
  PlayCallCoverageStats,
  PlaycallCoverageYards,
  PlayEndReason,
  postRoute,
  QBStats,
  RBStats,
  Role,
  Route,
  slantRoute,
  Stats,
  streakRoute,
  Vector,
} from "./core/types";
import { round2 } from "./util";
import { ENDZONE_W, pxToYards, ticksToSeconds, W } from "./utils/units";

const ROUTE_NAMES: [string, Route][] = [
  ["streak", streakRoute],
  ["post", postRoute],
  ["corner", cornerRoute],
  ["in", inRoute],
  ["out", outRoute],
  ["curl", curlRoute],
  ["slant", slantRoute],
  ["drag", dragRoute],
  ["flat", flatRoute],
];

const EMPTY_COUNT_YARDS = { count: 0, yards: 0, avg: 0 };

function emptyPlaycallCoverageYards(): PlaycallCoverageYards {
  return {
    runMan: { ...EMPTY_COUNT_YARDS },
    runManBlitz: { ...EMPTY_COUNT_YARDS },
    runZone: { ...EMPTY_COUNT_YARDS },
    runZoneBlitz: { ...EMPTY_COUNT_YARDS },
    passMan: { ...EMPTY_COUNT_YARDS },
    passManBlitz: { ...EMPTY_COUNT_YARDS },
    passZone: { ...EMPTY_COUNT_YARDS },
    passZoneBlitz: { ...EMPTY_COUNT_YARDS },
  };
}

function emptyPlaycallCoverageStats(): PlayCallCoverageStats {
  return {
    runMan: { ...emptyRBStats() },
    runManBlitz: { ...emptyRBStats() },
    runZone: { ...emptyRBStats() },
    runZoneBlitz: { ...emptyRBStats() },
    passMan: { ...emptyQBStats() },
    passManBlitz: { ...emptyQBStats() },
    passZone: { ...emptyQBStats() },
    passZoneBlitz: { ...emptyQBStats() },
  };
}

function emptyQBStats(): QBStats {
  return {
    attempts: 0,
    completions: 0,
    yards: 0,
    ypa: 0,
    cmp: 0,
    tds: 0,
    ints: 0,
    sacks: 0,
  };
}

function emptyRBStats(): RBStats {
  return { rushes: 0, yards: 0, ypc: 0, tds: 0, tfls: 0 };
}

function emptyAdvancedStats(): AdvancedStats {
  return {
    completedAirYards: 0,
    intendedAirYards: 0,
    offTargetThrowRate: 0,
    pressureRate: 0,
    receiverSeparation: 0,
    receiverYardsAfterCatch: 0,
    rushYardsAfterContact: 0,
    rushYardsBeforeContact: 0,
    sackRate: 0,
    throwAwayRate: 0,
    timeToThrow: 0,
    timeToSack: 0,
  };
}

function applyQBStats(
  s: QBStats,
  isPassAttempt: boolean,
  isSack: boolean,
  completion: boolean,
  isInterception: boolean,
  isTouchdown: boolean,
  yards: number,
) {
  if (isPassAttempt) s.attempts++;
  if (isSack) {
    s.sacks++;
  } else if (completion) {
    s.completions++;
    s.yards += yards;
    if (isTouchdown) s.tds++;
  } else if (isInterception) {
    s.ints++;
  }
  s.cmp = s.attempts > 0 ? round2(s.completions / s.attempts) : 0;
  s.ypa = s.attempts > 0 ? round2(s.yards / s.attempts) : 0;
}

function applyRBStats(
  s: RBStats,
  isRush: boolean,
  isTouchdown: boolean,
  yards: number,
) {
  if (!isRush) return;
  s.rushes++;
  s.yards += yards;
  if (yards < 0) s.tfls++;
  if (isTouchdown) s.tds++;
  s.ypc = s.rushes > 0 ? round2(s.yards / s.rushes) : 0;
}

function playcallCoverageKey(
  offense: OffensivePlayType,
  defense: DefensiveCoverageType,
): PlaycallCoverageKey {
  const suffix: Record<DefensiveCoverageType, string> = {
    man: "Man",
    manBlitz: "ManBlitz",
    zone: "Zone",
    zoneBlitz: "ZoneBlitz",
  };
  return `${offense}${suffix[defense]}` as PlaycallCoverageKey;
}

export function createEmptyStats(): Stats {
  return {
    playcalls: {
      run: { ...EMPTY_COUNT_YARDS },
      pass: { ...EMPTY_COUNT_YARDS },
    },
    coverage: {
      man: { ...EMPTY_COUNT_YARDS },
      manBlitz: { ...EMPTY_COUNT_YARDS },
      zone: { ...EMPTY_COUNT_YARDS },
      zoneBlitz: { ...EMPTY_COUNT_YARDS },
    },
    playcallCoverage: emptyPlaycallCoverageYards(),
    playcallCoverageStats: emptyPlaycallCoverageStats(),
    qb: { ...emptyQBStats() },
    rb: { ...emptyRBStats() },
    runAngles: {},
    routes: {},
    advanced: { ...emptyAdvancedStats() },
  };
}

function routeKey(route: Route): string {
  for (const [name, known] of ROUTE_NAMES) {
    if (
      known.breakAngle === route.breakAngle &&
      known.yardsBeforeBreak === route.yardsBeforeBreak &&
      known.stopAfterBreak === route.stopAfterBreak
    ) {
      return name;
    }
  }
  return `custom_${route.breakAngle}_${route.yardsBeforeBreak}`;
}

function runAngleKey(runAngle: Vector): string {
  const degrees = Math.round(
    (Math.atan2(runAngle.y, runAngle.x) * 180) / Math.PI,
  );
  return `${degrees}°`;
}

function bumpCountYards(
  map: Record<string, { count: number; yards: number }>,
  key: string,
  yards = 0,
) {
  if (!map[key]) {
    map[key] = { count: 0, yards: 0 };
  }
  map[key].count++;
  map[key].yards += yards;
}

function isPassCompletion(
  reason: PlayEndReason,
  ballGiven: boolean,
  ballCarrierRole?: Role,
): boolean {
  return (
    ballGiven &&
    ballCarrierRole === "catcher" &&
    (reason === "tackle" || reason === "touchdown")
  );
}

export function updateStatsAfterPlay(
  stats: Stats,
  play: CurrentPlay,
  yards: number,
  isTouchdown: boolean,
  reason: PlayEndReason,
  ballGiven: boolean,
  ballCarrierRole?: Role,
  ballCarrierRoute?: Route,
  playAdvanced?: PlayAdvancedData,
  los?: number,
  finalBallX?: number,
): Stats {
  if (reason === "fieldgoal" || reason === "punt") return stats;

  const next: Stats = structuredClone(stats);
  const matchupKey = playcallCoverageKey(play.offense, play.defense);
  const completion = isPassCompletion(reason, ballGiven, ballCarrierRole);
  const isRush = ballGiven && ballCarrierRole === "runner";
  const isSack = reason === "sack";
  const isInterception = reason === "interception";

  const isPassAttempt =
    play.offense === "pass" &&
    !isSack &&
    (reason === "incomplete" || isInterception || completion);
  const isScramble =
    play.offense === "pass" &&
    !isSack &&
    !isPassAttempt &&
    (reason === "tackle" || reason === "touchdown");

  let netYardsGained = yards;
  if (play.offense === "pass" && !completion && !isSack && !isScramble) {
    netYardsGained = 0;
  }

  // --- Playcall / coverage summary counts ---
  next.playcalls[play.offense].count++;
  next.playcalls[play.offense].yards += netYardsGained;
  next.playcalls[play.offense].avg = round2(
    next.playcalls[play.offense].yards / next.playcalls[play.offense].count,
  );

  next.coverage[play.defense].count++;
  next.coverage[play.defense].yards += netYardsGained;
  next.coverage[play.defense].avg = round2(
    next.coverage[play.defense].yards / next.coverage[play.defense].count,
  );

  next.playcallCoverage[matchupKey].count++;
  next.playcallCoverage[matchupKey].yards += netYardsGained;
  next.playcallCoverage[matchupKey].avg = round2(
    next.playcallCoverage[matchupKey].yards /
      next.playcallCoverage[matchupKey].count,
  );

  // --- Per-matchup + aggregate stats ---
  if (play.offense === "pass") {
    applyQBStats(
      next.playcallCoverageStats[matchupKey] as QBStats,
      isPassAttempt,
      isSack,
      completion,
      isInterception,
      isTouchdown,
      yards,
    );
    applyQBStats(
      next.qb,
      isPassAttempt,
      isSack,
      completion,
      isInterception,
      isTouchdown,
      yards,
    );

    if (isPassAttempt || isSack) {
      for (const route of play.routes) {
        bumpCountYards(next.routes, routeKey(route));
      }
      if (completion && ballCarrierRoute) {
        next.routes[routeKey(ballCarrierRoute)].yards += yards;
      }
      for (const route of play.routes) {
        const key = routeKey(route);
        next.routes[key].avg = round2(
          next.routes[key].yards / next.routes[key].count,
        );
      }
    }
  } else {
    applyRBStats(
      next.playcallCoverageStats[matchupKey] as RBStats,
      isRush,
      isTouchdown,
      yards,
    );
    applyRBStats(next.rb, isRush, isTouchdown, yards);

    if (play.runAngle && isRush) {
      const key = runAngleKey(play.runAngle);
      bumpCountYards(next.runAngles, key, yards);
      next.runAngles[key].avg = round2(
        next.runAngles[key].yards / next.runAngles[key].count,
      );
    }
  }

  // --- Advanced stats ---
  if (playAdvanced) {
    const adv = next.advanced;
    const passCount = next.qb.attempts;
    const completionCount = next.qb.completions;
    const sackCount = next.qb.sacks;
    const dropbackCount = passCount + sackCount;

    // FIX 1: Weight Time to Throw against Pass Attempts only, NOT global dropbacks
    if (
      isPassAttempt &&
      playAdvanced.throwTick !== undefined &&
      passCount > 0
    ) {
      const ttt = ticksToSeconds(playAdvanced.throwTick);
      adv.timeToThrow = (adv.timeToThrow * (passCount - 1) + ttt) / passCount;
    }

    // FIX 2: Weight Time to Sack against Sack Count only
    if (isSack && playAdvanced.sackTick !== undefined && sackCount > 0) {
      const ttt = ticksToSeconds(playAdvanced.sackTick);
      adv.timeToSack = (adv.timeToSack * (sackCount - 1) + ttt) / sackCount;
    }

    // Air Yards
    if (isPassAttempt && playAdvanced.airYards !== undefined && passCount > 0) {
      const airYardsYds = pxToYards(Math.max(0, playAdvanced.airYards));
      adv.intendedAirYards =
        (adv.intendedAirYards * (passCount - 1) + airYardsYds) / passCount;

      // FIX 3: Weight Completed Air Yards against completionCount, NOT passCount
      if (completion && completionCount > 0) {
        adv.completedAirYards =
          (adv.completedAirYards * (completionCount - 1) + airYardsYds) /
          completionCount;
      }
    }

    // Off-target throw %
    if (isPassAttempt && passCount > 0) {
      adv.offTargetThrowRate =
        (adv.offTargetThrowRate * (passCount - 1) +
          (playAdvanced.wasOffTarget ? 1 : 0)) /
        passCount;
    }

    // Throw-away rate — safeguard: cannot exceed total incompletion rate
    if (isPassAttempt && passCount > 0) {
      adv.throwAwayRate =
        (adv.throwAwayRate * (passCount - 1) +
          (playAdvanced.wasThrowAway ? 1 : 0)) /
        passCount;
      const maxPossibleRate = (passCount - completionCount) / passCount;
      if (adv.throwAwayRate > maxPossibleRate)
        adv.throwAwayRate = round2(maxPossibleRate);
    }

    // Pressure rate
    if (play.offense === "pass" && dropbackCount > 0) {
      const prevPressured = adv.pressureRate * (dropbackCount - 1);
      adv.pressureRate =
        (prevPressured + (playAdvanced.wasUnderPressure ? 1 : 0)) /
        dropbackCount;
    }

    // Separation at catch
    if (
      completion &&
      playAdvanced.separationAtCatch !== undefined &&
      isFinite(playAdvanced.separationAtCatch) &&
      completionCount > 0
    ) {
      const sepYds = pxToYards(playAdvanced.separationAtCatch);
      adv.receiverSeparation =
        (adv.receiverSeparation * (completionCount - 1) + sepYds) /
        completionCount;
    }

    // YBC / YAC
    if (isRush && los) {
      let ybc;
      if (playAdvanced.firstContactX === undefined) {
        ybc = yards;
      } else {
        ybc = pxToYards(playAdvanced.firstContactX - los);
      }
      const yac = yards - ybc;
      const n = next.rb.rushes;
      if (n > 0) {
        adv.rushYardsBeforeContact =
          (adv.rushYardsBeforeContact * (n - 1) + ybc) / n;
        adv.rushYardsAfterContact =
          (adv.rushYardsAfterContact * (n - 1) + yac) / n;
      }
    }

    // Receiver YAC
    if (
      completion &&
      finalBallX &&
      playAdvanced.catchX !== undefined &&
      completionCount > 0
    ) {
      const endX = isTouchdown ? W + ENDZONE_W : finalBallX;
      const yac = Math.max(0, pxToYards(endX - playAdvanced.catchX));
      adv.receiverYardsAfterCatch =
        (adv.receiverYardsAfterCatch * (completionCount - 1) + yac) /
        completionCount;
    }

    const totalPassPlays = next.playcalls.pass.count;
    adv.sackRate = totalPassPlays > 0 ? round2(sackCount / totalPassPlays) : 0;
  }

  return next;
}

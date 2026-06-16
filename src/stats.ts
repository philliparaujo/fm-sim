import { ENDZONE_W, W } from "./render";
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
} from "./types";
import { round2, yardsFromPixels } from "./util";

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
    timeToThrow: 0,
    timeToSack: 0,
  };
}

export function playcallCoverageKey(
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

export function routeKey(route: Route): string {
  for (const [name, known] of ROUTE_NAMES) {
    if (
      known.breakAngle === route.breakAngle &&
      known.steps === route.steps &&
      known.stopAfterBreak === route.stopAfterBreak
    ) {
      return name;
    }
  }
  return `custom_${route.breakAngle}_${route.steps}`;
}

export function runAngleKey(runAngle: Vector): string {
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
  const next: Stats = structuredClone(stats);
  const matchupKey = playcallCoverageKey(play.offense, play.defense);
  const completion = isPassCompletion(reason, ballGiven, ballCarrierRole);
  const isRush = ballGiven && ballCarrierRole === "runner";
  const isSack = reason === "sack";

  // Realized pass play vs QB scramble check
  const isPassAttempt =
    play.offense === "pass" &&
    !isSack &&
    (reason === "incomplete" || reason === "turnover" || completion);
  const isScramble =
    play.offense === "pass" &&
    !isSack &&
    !isPassAttempt &&
    (reason === "tackle" || reason === "touchdown");

  // Determine actual net yards gained by the offense on this play
  let netYardsGained = yards;
  if (play.offense === "pass" && !completion && !isSack && !isScramble) {
    // Incomplete passes or interceptions result in 0 yards gained for the team passing totals
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

  // --- playcallCoverageStats ---
  const matchupStats = next.playcallCoverageStats[matchupKey];

  if (play.offense === "pass") {
    const s = matchupStats as QBStats;
    if (isPassAttempt) s.attempts++;
    if (isSack) {
      s.sacks++;
    } else if (completion) {
      s.completions++;
      s.yards += yards;
      if (isTouchdown) s.tds++;
    }
    s.cmp = s.attempts > 0 ? round2(s.completions / s.attempts) : 0;
    s.ypa = s.attempts > 0 ? round2(s.yards / s.attempts) : 0;
  } else {
    const s = matchupStats as RBStats;
    if (isRush) {
      s.rushes++;
      s.yards += yards;
      if (yards < 0) s.tfls++;
      if (isTouchdown) s.tds++;
      s.ypc = s.rushes > 0 ? round2(s.yards / s.rushes) : 0;
    }
  }

  // --- Aggregate QB stats ---
  if (play.offense === "pass") {
    if (isPassAttempt) next.qb.attempts++;
    if (isSack) {
      next.qb.sacks++;
    } else if (completion) {
      next.qb.completions++;
      next.qb.yards += yards;
      if (isTouchdown) next.qb.tds++;
    }
    next.qb.ypa =
      next.qb.attempts > 0 ? round2(next.qb.yards / next.qb.attempts) : 0;
    next.qb.cmp =
      next.qb.attempts > 0 ? round2(next.qb.completions / next.qb.attempts) : 0;

    // Route tracking
    if (isPassAttempt || isSack) {
      for (const route of play.routes) {
        bumpCountYards(next.routes, routeKey(route));
      }
      if (completion && ballCarrierRoute) {
        const key = routeKey(ballCarrierRoute);
        if (next.routes[key]) {
          next.routes[key].yards += yards;
        }
      }
      // Recalculate averages for updated routes
      for (const route of play.routes) {
        const key = routeKey(route);
        if (next.routes[key]) {
          (next.routes[key] as any).avg = round2(
            next.routes[key].yards / next.routes[key].count,
          );
        }
      }
    }
  } else {
    // --- Aggregate RB stats ---
    if (isRush) {
      next.rb.rushes++;
      next.rb.yards += yards;
      if (yards < 0) next.rb.tfls++;
      if (isTouchdown) next.rb.tds++;
      next.rb.ypc =
        next.rb.rushes > 0 ? round2(next.rb.yards / next.rb.rushes) : 0;
    }

    // Only track run angles if a valid rush attempt actually took place
    if (play.runAngle && isRush) {
      const key = runAngleKey(play.runAngle);
      if (!next.runAngles[key])
        next.runAngles[key] = { count: 0, yards: 0, avg: 0 };
      next.runAngles[key].count++;
      next.runAngles[key].yards += yards;
      next.runAngles[key].avg = round2(
        next.runAngles[key].yards / next.runAngles[key].count,
      );
    }
  }

  // --- Advanced stats ---
  if (playAdvanced) {
    const adv = next.advanced;
    const completionCount = next.qb.completions;
    const passCount = next.qb.attempts;
    const dropbackCount = next.qb.attempts + next.qb.sacks; // total dropbacks so far
    const sackCount = next.qb.sacks;

    // Time to Throw (seconds): only on pass attempts, not sacks
    if (isPassAttempt && playAdvanced.throwFrame !== undefined) {
      const ttt = playAdvanced.throwFrame / 60;
      adv.timeToThrow =
        (adv.timeToThrow * (dropbackCount - 1) + ttt) / dropbackCount;
    }
    if (isSack && playAdvanced.sackFrame !== undefined) {
      const ttt = playAdvanced.sackFrame / 60;
      adv.timeToSack = (adv.timeToSack * (sackCount - 1) + ttt) / sackCount;
    }

    // Air Yards: average over pass attempts only
    if (isPassAttempt && playAdvanced.airYards !== undefined) {
      const airYardsYds = yardsFromPixels(Math.max(0, playAdvanced.airYards));
      adv.intendedAirYards = round2(
        (adv.intendedAirYards * (passCount - 1) + airYardsYds) / passCount,
      );
      if (completion) {
        adv.completedAirYards = round2(
          (adv.completedAirYards * (passCount - 1) + airYardsYds) /
            completionCount,
        );
      }
    }

    // Off-target throw %
    if (isPassAttempt && playAdvanced.wasOffTarget !== undefined) {
      const badCount =
        adv.offTargetThrowRate * (dropbackCount - 1) +
        (playAdvanced.wasOffTarget ? 1 : 0);
      adv.offTargetThrowRate = round2(badCount / dropbackCount);
    }

    // Pressure rate: pressured plays / total dropbacks
    if (play.offense === "pass") {
      const totalDropbacks = dropbackCount;
      const prevPressured = adv.pressureRate * (totalDropbacks - 1);
      adv.pressureRate = round2(
        (prevPressured + (playAdvanced.wasUnderPressure ? 1 : 0)) /
          totalDropbacks,
      );
    }

    // Separation at catch: average over completions only
    if (
      completion &&
      playAdvanced.separationAtCatch !== undefined &&
      isFinite(playAdvanced.separationAtCatch)
    ) {
      const sepYds = yardsFromPixels(playAdvanced.separationAtCatch);
      const cmpCount = next.qb.completions;
      adv.receiverSeparation = round2(
        (adv.receiverSeparation * (cmpCount - 1) + sepYds) / cmpCount,
      );
    }

    // YBC / YAC: split from firstContactX and catchX
    if (isRush && los) {
      let ybc;
      if (playAdvanced.firstContactX === undefined) {
        ybc = yards;
      } else {
        ybc = yardsFromPixels(playAdvanced.firstContactX - los);
      }
      const yac = yards - ybc;
      const n = next.rb.rushes;
      adv.rushYardsBeforeContact =
        (adv.rushYardsBeforeContact * (n - 1) + ybc) / n;
      adv.rushYardsAfterContact =
        (adv.rushYardsAfterContact * (n - 1) + yac) / n;
    }

    // Receiver YAC: yards from catchX to tackle
    if (completion && finalBallX && playAdvanced.catchX !== undefined) {
      const endX = isTouchdown ? W + ENDZONE_W : finalBallX;
      const yac = Math.max(0, yardsFromPixels(endX - playAdvanced.catchX));
      const cmpCount = next.qb.completions;
      adv.receiverYardsAfterCatch = round2(
        (adv.receiverYardsAfterCatch * (cmpCount - 1) + Math.max(0, yac)) /
          cmpCount,
      );
    }

    adv.sackRate = round2(next.qb.sacks / next.playcalls.pass.count);
  }

  return next;
}

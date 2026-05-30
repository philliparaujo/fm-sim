import {
  cornerRoute,
  curlRoute,
  CurrentPlay,
  DefensiveCoverageType,
  dragRoute,
  flatRoute,
  inRoute,
  OffensivePlayType,
  outRoute,
  PlaycallCoverageKey,
  PlaycallCoverageStats,
  PlayEndReason,
  postRoute,
  Role,
  Route,
  slantRoute,
  Stats,
  streakRoute,
  Vector,
} from "./types";

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

const EMPTY_COUNT_YARDS = { count: 0, yards: 0 };

function emptyPlaycallCoverageStats(): PlaycallCoverageStats {
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

function clonePlaycallCoverageStats(
  stats: PlaycallCoverageStats,
): PlaycallCoverageStats {
  return Object.fromEntries(
    (Object.keys(stats) as PlaycallCoverageKey[]).map((key) => [
      key,
      { ...stats[key] },
    ]),
  ) as PlaycallCoverageStats;
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
    playcallCoverage: emptyPlaycallCoverageStats(),
    qb: { attempts: 0, completions: 0, yards: 0, tds: 0, sacks: 0 },
    rb: { rushes: 0, yards: 0, tds: 0, tfls: 0 },
    runAngles: {},
    routes: {},
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
  const degrees = Math.round((Math.atan2(runAngle.y, runAngle.x) * 180) / Math.PI);
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
): Stats {
  const next: Stats = {
    playcalls: {
      run: { ...stats.playcalls.run },
      pass: { ...stats.playcalls.pass },
    },
    coverage: {
      man: { ...stats.coverage.man },
      manBlitz: { ...stats.coverage.manBlitz },
      zone: { ...stats.coverage.zone },
      zoneBlitz: { ...stats.coverage.zoneBlitz },
    },
    playcallCoverage: clonePlaycallCoverageStats(stats.playcallCoverage),
    qb: { ...stats.qb },
    rb: { ...stats.rb },
    runAngles: Object.fromEntries(
      Object.entries(stats.runAngles).map(([key, value]) => [key, { ...value }]),
    ),
    routes: Object.fromEntries(
      Object.entries(stats.routes).map(([key, value]) => [key, { ...value }]),
    ),
  };

  next.playcalls[play.offense].count++;
  next.playcalls[play.offense].yards += yards;
  next.coverage[play.defense].count++;
  next.coverage[play.defense].yards += yards;

  const matchupKey = playcallCoverageKey(play.offense, play.defense);
  next.playcallCoverage[matchupKey].count++;
  next.playcallCoverage[matchupKey].yards += yards;

  if (play.offense === "pass") {
    next.qb.attempts++;
    if (reason === "sack") {
      next.qb.sacks++;
    } else if (isPassCompletion(reason, ballGiven, ballCarrierRole)) {
      next.qb.completions++;
      next.qb.yards += yards;
      if (isTouchdown) {
        next.qb.tds++;
      }
    }

    for (const route of play.routes) {
      bumpCountYards(next.routes, routeKey(route));
    }

    if (
      isPassCompletion(reason, ballGiven, ballCarrierRole) &&
      ballCarrierRoute
    ) {
      const key = routeKey(ballCarrierRoute);
      if (next.routes[key]) {
        next.routes[key] = {
          ...next.routes[key],
          yards: next.routes[key].yards + yards,
        };
      }
    }
  } else {
    const isRush = ballGiven && ballCarrierRole === "runner";

    if (isRush) {
      next.rb.rushes++;
      next.rb.yards += yards;
      if (yards < 0) {
        next.rb.tfls++;
      }
      if (isTouchdown) {
        next.rb.tds++;
      }
    }

    if (play.runAngle) {
      const key = runAngleKey(play.runAngle);
      if (!next.runAngles[key]) {
        next.runAngles[key] = { count: 0, yards: 0 };
      }
      next.runAngles[key].count++;
      if (isRush) {
        next.runAngles[key].yards += yards;
      }
    }
  }

  return next;
}

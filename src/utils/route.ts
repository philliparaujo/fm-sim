import { Route, Vector } from "../core/types";

const streakRoute: Route = {
  breakAngle: 0,
  yardsBeforeBreak: 0,
  stopAfterBreak: false,
};
const postRoute: Route = {
  breakAngle: 45,
  yardsBeforeBreak: 15,
  stopAfterBreak: false,
};
const cornerRoute: Route = {
  breakAngle: -55,
  yardsBeforeBreak: 15,
  stopAfterBreak: false,
};
const inRoute: Route = {
  breakAngle: 90,
  yardsBeforeBreak: 10,
  stopAfterBreak: false,
};
const outRoute: Route = {
  breakAngle: -90,
  yardsBeforeBreak: 10,
  stopAfterBreak: false,
};
const curlRoute: Route = {
  breakAngle: 180,
  yardsBeforeBreak: 10,
  stopAfterBreak: true,
};
const slantRoute: Route = {
  breakAngle: 65,
  yardsBeforeBreak: 4,
  stopAfterBreak: false,
};
const dragRoute: Route = {
  breakAngle: 90,
  yardsBeforeBreak: 3,
  stopAfterBreak: false,
};
const flatRoute: Route = {
  breakAngle: -90,
  yardsBeforeBreak: 0,
  stopAfterBreak: false,
};

// ── Route depth ─────────────────────────────────────────────────────────────
// Every route is a quick/underneath throw (short), an intermediate break
// (medium), or a vertical shot downfield (deep). Medium's share of all routes
// called is fixed; the Short↔Deep scheme selector only flexes the split of
// the remainder between short and deep — see routeDepthShares.

const SHORT_ROUTES: Route[] = [slantRoute, dragRoute, flatRoute];
const MEDIUM_ROUTES: Route[] = [inRoute, outRoute, curlRoute];
const DEEP_ROUTES: Route[] = [streakRoute, postRoute, cornerRoute];

/** Fixed share of all routes called that are intermediate depth, regardless
 * of scheme. Keeping this below 1 also guarantees short/deep can never reach
 * 100% between them — they're always splitting what's left over. */
const MEDIUM_ROUTE_SHARE = 0.4;

/** Given a team's deepPercent (0–1: how much of the short/deep split leans
 * deep), returns the actual share of all routes called at each depth. Medium
 * is fixed; short and deep split the remaining pool. */
export function routeDepthShares(deepPercent: number): {
  short: number;
  medium: number;
  deep: number;
} {
  const flexPool = 1 - MEDIUM_ROUTE_SHARE;
  const deep = flexPool * deepPercent;
  const short = flexPool - deep;
  return { short, medium: MEDIUM_ROUTE_SHARE, deep };
}

/** Returns a random route used to assign to a catcher, weighted toward
 * short/medium/deep per the team's deepPercent tendency (default matches
 * PLAYBOOK_CONFIG's default). */
export function randomRoute(deepPercent = 0.6): Route {
  const { short, medium } = routeDepthShares(deepPercent);
  const roll = Math.random();
  const pool =
    roll < short
      ? SHORT_ROUTES
      : roll < short + medium
        ? MEDIUM_ROUTES
        : DEEP_ROUTES;
  return pool[Math.floor(Math.random() * pool.length)];
}

/** Returns a random unit vector that designates a runner's angle */
export function randomRunVector(): Vector {
  // 1. Generate a random angle between +80 and -80
  const MAX_ANGLE_DEGREES = 60;
  const maxAngleRad = (MAX_ANGLE_DEGREES * Math.PI) / 180;
  const angle = (Math.random() * 2 - 1) * maxAngleRad;

  return {
    x: Math.cos(angle),
    y: Math.sin(angle),
  };
}

/** Converts a run angle Vector to a string key */
export function runAngleKey(runAngle: Vector): string {
  const degrees = Math.round(
    (Math.atan2(runAngle.y, runAngle.x) * 180) / Math.PI,
  );
  return `${degrees}°`;
}

export {
  cornerRoute,
  curlRoute,
  dragRoute,
  flatRoute,
  inRoute,
  outRoute,
  postRoute,
  slantRoute,
  streakRoute,
};

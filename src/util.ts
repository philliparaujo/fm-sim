import { getSavedRatings } from "./core/playbook";
import { getDefaultRatingForLabel } from "./core/ratings";
import {
  Ball,
  cornerRoute,
  Coverage,
  curlRoute,
  dragRoute,
  flatRoute,
  inRoute,
  Label,
  outRoute,
  Player,
  PLAYER_LABELS,
  postRoute,
  Role,
  Roster,
  RosterPlayer,
  Route,
  Scoreboard,
  Side,
  slantRoute,
  State,
  Stats,
  streakRoute,
  Team,
  Vector,
} from "./core/types";
import {
  ENDZONE_W,
  H,
  pxToYards,
  TOTAL_H,
  TOTAL_W,
  W,
  yardsToPx,
} from "./utils/units";
import { dist, nullVector } from "./utils/vector";

// Slow down player's velocity (when in contact with blocker)
export function applyDamping(player: Player, factor: number, jitter: number) {
  // 1. Damping (Multiplicative): Slows the existing movement
  player.vel.x *= factor + (Math.random() * 2 - 1) * jitter;
  player.vel.y *= factor + (Math.random() * 2 - 1) * jitter;

  // 2. Jitter (Additive): Forces movement even if the axis was 0
  // This allows players to "slip" sideways during a head-on engagement
  player.vel.x += (Math.random() * 2 - 1) * jitter;
  player.vel.y += (Math.random() * 2 - 1) * jitter;
}

const BALL_SNAP_DIST = 24; // Maximum distance where a player will snap to the ball
export function isCarryingBall(player: Player, ball: Ball): boolean {
  return dist(player.loc, ball.loc) < BALL_SNAP_DIST;
}

export function randomRoute(): Route {
  const routes = [
    streakRoute,
    postRoute,
    cornerRoute,
    inRoute,
    outRoute,
    curlRoute,
    slantRoute,
    dragRoute,
    flatRoute,
  ];
  return routes[Math.floor(Math.random() * routes.length)];
}

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

export function computeFirstDownLine(
  LOS: number,
  yardsToGo: "goal" | number,
): number | null {
  if (yardsToGo === "goal") return null;
  return LOS + yardsToPx(yardsToGo);
}

export function yardsToGoal(LOS: number): number {
  const goalLine = W + ENDZONE_W;
  return Math.max(0, pxToYards(goalLine - LOS));
}

export function distanceAfterFirstDown(LOS: number): "goal" | number {
  return yardsToGoal(LOS) <= 10 ? "goal" : 10;
}

function nextDown(down: Scoreboard["down"]): Scoreboard["down"] {
  const DOWNS = ["1st", "2nd", "3rd", "4th"] as const;
  const idx = DOWNS.indexOf(down);
  return DOWNS[Math.min(idx + 1, DOWNS.length - 1)];
}

export function updateDownAndDistance(
  prev: Pick<Scoreboard, "LOS" | "firstDownLine" | "down" | "distance">,
  nextLOS: number,
): Pick<Scoreboard, "down" | "distance" | "firstDownLine"> {
  const gotFirstDown =
    prev.firstDownLine !== null && nextLOS >= prev.firstDownLine;

  if (gotFirstDown) {
    const distance = distanceAfterFirstDown(nextLOS);
    return {
      down: "1st",
      distance,
      firstDownLine: computeFirstDownLine(nextLOS, distance),
    };
  }

  const yardsGained = pxToYards(nextLOS - prev.LOS);
  const distance: "goal" | number =
    prev.distance === "goal"
      ? "goal"
      : Math.max(1, prev.distance - yardsGained);
  const down = prev.down === "4th" ? "4th" : nextDown(prev.down);

  return {
    down,
    distance,
    firstDownLine: computeFirstDownLine(nextLOS, distance),
  };
}

export function LOSToString(LOS: number) {
  if (LOS <= ENDZONE_W) return "Safety";
  if (LOS >= W + ENDZONE_W) return "Touchdown";

  const adjLOS = LOS - ENDZONE_W;
  const yardsNumber = Math.round(pxToYards(adjLOS));

  if (yardsNumber < 50) {
    return `< ${yardsNumber}`;
  } else if (yardsNumber === 50) {
    return `${yardsNumber}`;
  } else {
    return `${100 - yardsNumber} >`;
  }
}

const POCKET_CY = H / 2;
const POCKET_RX = 90;
const POCKET_RY = 360;
export function getPocket(LOS: number) {
  return {
    cx: LOS - yardsToPx(5),
    cy: POCKET_CY,
    rx: POCKET_RX,
    ry: POCKET_RY,
  };
}

export function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function isNoBreakRoute(route: Route): boolean {
  return route.yardsBeforeBreak === 0 || route.breakAngle === 0;
}

export function lerp(rating: number, min: number, max: number): number {
  return min + (max - min) * rating;
}

export function numPlays(stats: Stats) {
  return (
    stats.coverage.man.count +
    stats.coverage.manBlitz.count +
    stats.coverage.zone.count +
    stats.coverage.zoneBlitz.count
  );
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function isRunPlay(state: State): boolean {
  return (
    state.currentPlay.special === null && state.currentPlay.offense === "run"
  );
}

export function isPassPlay(state: State): boolean {
  return (
    state.currentPlay.special === null && state.currentPlay.offense === "pass"
  );
}

export function isFieldGoalPlay(state: State): boolean {
  return state.currentPlay.special === "fieldgoal";
}

export function isPuntPlay(state: State): boolean {
  return state.currentPlay.special === "punt";
}

export function getLOSAfterPunt(prevLOS: number): number {
  // Convert yard scales cleanly to pixel measurements using field width
  const AVERAGE_NET_PUNT = yardsToPx(45);
  const TOUCHBACK_POSITION = ENDZONE_W + yardsToPx(20); // Left goal line + 20 yards
  const OPPONENT_GOAL_LINE = TOTAL_W - ENDZONE_W; // Right goal line

  // 1. Where does the ball physically land on the screen? (Moving right)
  const landingSpotX = prevLOS + AVERAGE_NET_PUNT;

  // 2. If it touches or crosses the opponent's goal line, it's a touchback.
  // The new offense comes out to their own 20-yard line on the left.
  if (landingSpotX >= OPPONENT_GOAL_LINE) {
    return TOUCHBACK_POSITION;
  }

  // 3. Flip perspective: The distance remaining to the opponent's right goal line
  // becomes the new team's starting distance from their own left goal line.
  const distanceToOpponentGoal = OPPONENT_GOAL_LINE - landingSpotX;

  return ENDZONE_W + distanceToOpponentGoal;
}

export function labelToSide(label: Label): Side {
  if (["LT", "C", "RT", "QB", "XR", "ZR", "TE", "RB"].includes(label))
    return "offense";
  return "defense";
}

export function labelToRole(label: Label): Role {
  if (["LT", "C", "RT"].includes(label)) return "blocker";
  if (["QB"].includes(label)) return "passer";
  if (["XR", "ZR", "TE"].includes(label)) return "catcher";
  if (["RB"].includes(label)) return "runner";
  if (["LE", "DT", "RE"].includes(label)) return "rusher";
  return "coverer";
}

export function buildDefaultRoster(teamColor: string): Roster {
  const labels: Label[] = [...PLAYER_LABELS];
  return labels.map((label) => ({
    color: teamColor,
    label,
    ratings: getDefaultRatingForLabel(label),
  }));
}

export function getOffenseTeam(state: State): Team {
  const teams = state.scoreboard.teams;
  for (const team of teams) {
    if (team.possessing) return team;
  }

  console.warn("No offense team found??");
  return teams[0];
}

export function getDefenseTeam(state: State): Team {
  const teams = state.scoreboard.teams;
  for (const team of teams) {
    if (!team.possessing) return team;
  }

  console.warn("No defense team found??");
  return teams[0];
}

export function getFieldBounds() {
  const BOUNDARY_MARGIN = yardsToPx(1);
  return {
    minX: BOUNDARY_MARGIN,
    maxX: TOTAL_W - BOUNDARY_MARGIN,
    minY: BOUNDARY_MARGIN,
    maxY: TOTAL_H - BOUNDARY_MARGIN,
  };
}

export function nearSideline(pos: Vector): boolean {
  const { minX, maxX, minY, maxY } = getFieldBounds();

  if (pos.x < minX || pos.x > maxX || pos.y < minY || pos.y > maxY) {
    return true;
  }

  return false;
}

export function clampPosInBounds(pos: Vector): Vector {
  const { minX, maxX, minY, maxY } = getFieldBounds();

  return {
    x: Math.max(minX, Math.min(maxX, pos.x)),
    y: Math.max(minY, Math.min(maxY, pos.y)),
  };
}

export function fillOutRosterPlayer(
  rp: RosterPlayer,
  loc?: Vector,
  route?: Route,
  runAngle?: Vector,
  coverage?: Coverage,
  roleOverride?: Role,
): Player {
  return {
    color: rp.color,
    label: rp.label,
    loc: loc ?? nullVector(),
    role: roleOverride ?? labelToRole(rp.label),
    side: labelToSide(rp.label),
    type: "player",
    vel: nullVector(),
    prevVel: nullVector(),

    // TEMP: Ratings
    ratings: getSavedRatings(rp.label),

    // Specific properties determined on creation
    route: route ?? undefined,
    runAngle: runAngle ?? undefined,
    path: [],
    breakFrame: null,
    routeSideMultiplier: null,
    improvAngleRad: null,
    predictedTargets: null,
    coverage: coverage ?? undefined,
    playRushSeed: undefined,
    rushSpeedVariance: undefined,

    // Specific properties determined later
    assignedTarget: null,
    decisionTicks: 0,
    cachedThrowEval: null,
    perceivedLoc: null,
    perceivedVel: null,
    reactionTimer: 0,
    zone: nullVector(),

    contactedThisFrame: false,
    isBursting: false,
    shedCooldown: 0,
    shedImmunityFrames: 0,

    // Properties for rendering
    contextRays: null,
    chosenRayDir: null,
  };
}

import {
  AdvancedStats,
  CountYards,
  DefensiveCoverageType,
  DefensiveStats,
  Label,
  OffensivePlayType,
  PLAYER_LABELS,
  PlaycallCoverageKey,
  PlayCallCoverageStats,
  PlaycallCoverageYards,
  PlayEndReason,
  PlayerStats,
  PlayerStatsByLabel,
  QBStats,
  RBStats,
  ReceivingStats,
  Route,
  Scoreboard,
  State,
  Stats,
} from "../core/types";
import { labelToRole } from "./roster";
import { isCarryingBall } from "./field";
import { round2 } from "./math";
import {
  cornerRoute,
  curlRoute,
  dragRoute,
  flatRoute,
  inRoute,
  outRoute,
  postRoute,
  slantRoute,
  streakRoute,
} from "./route";
import { ENDZONE_W } from "./units";

/** Returns the count of non-special teams plays */
export function numPlays(stats: Stats): number {
  return (
    stats.coverage.man.count +
    stats.coverage.manBlitz.count +
    stats.coverage.zone.count +
    stats.coverage.zoneBlitz.count
  );
}

/** Returns the ball's x position after a play, ignoring all scores and changes of possession */
export function getFinalBallX(
  state: State,
  reason: PlayEndReason,
  scoreboard: Scoreboard,
): number {
  return checkIfPassIncomplete(state, reason)
    ? scoreboard.LOS
    : state.ball.loc.x;
}

/** Returns a new average from an existing average and one new value */
export function updateAverage(
  prevAverage: number,
  newCount: number,
  newValue: number,
): number {
  if (newCount === 0) console.warn("newCount in updateAverage() is 0??");
  return (prevAverage * (newCount - 1) + newValue) / newCount;
}

/* Helpers to initialize stat objects */
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

function emptyReceivingStats(): ReceivingStats {
  return { targets: 0, catches: 0, yards: 0, tds: 0 };
}

function emptyDefensiveStats(): DefensiveStats {
  return { tackles: 0, tfls: 0, sacks: 0, interceptions: 0, passBreakups: 0 };
}

/** Builds the empty stat line appropriate to a label's role (blockers get none). */
function emptyPlayerStats(label: Label): PlayerStats {
  switch (labelToRole(label)) {
    case "passer":
      return { passing: emptyQBStats() };
    case "runner":
      // RBs can catch out of the backfield, so track receiving too.
      return { rushing: emptyRBStats(), receiving: emptyReceivingStats() };
    case "catcher":
      return { receiving: emptyReceivingStats() };
    case "rusher":
    case "coverer":
      return { defense: emptyDefensiveStats() };
    default:
      return {};
  }
}

/** Seeds the per-label player dictionary with empty, role-appropriate stat lines. */
function emptyPlayerStatsByLabel(): PlayerStatsByLabel {
  const out: PlayerStatsByLabel = {};
  for (const label of PLAYER_LABELS) {
    const line = emptyPlayerStats(label);
    if (Object.keys(line).length > 0) out[label] = line;
  }
  return out;
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

/** Initializes a Stats object with all zeros */
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
    playcallCoverage: { ...emptyPlaycallCoverageYards() },
    playcallCoverageStats: { ...emptyPlaycallCoverageStats() },
    players: emptyPlayerStatsByLabel(),
    routes: Object.fromEntries(
      ROUTE_NAMES.map(([, route]) => [
        routeKey(route),
        { ...EMPTY_COUNT_YARDS },
      ]),
    ),
    advanced: { ...emptyAdvancedStats() },
  };
}

/* Helpers to get keys to fetch data from stat Record objects */
/** Converts a route to a string key */
export function routeKey(route: Route): string {
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

/** Converts a playcallCoverage to a string key */
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

/* Helpers to update and mutate stats */
/** Logs a pass if one was attempted and recalculates stats, mutating the QBStats object */
export function applyQBStats(
  s: QBStats,
  netYards: number,
  state: State,
  reason: PlayEndReason,
): void {
  // Update individual simple counts
  if (checkIfPassAttempt(state, reason)) s.attempts++;
  if (checkIfSack(state, reason)) s.sacks++;
  if (checkIfPassComplete(state, reason)) {
    s.completions++;
    s.yards += netYards;
  }
  if (checkIfTouchdown(state, reason)) s.tds++;
  if (checkIfInterception(state, reason)) s.ints++;

  // Recalculate averages
  s.cmp = s.attempts > 0 ? round2(s.completions / s.attempts) : 0;
  s.ypa = s.attempts > 0 ? round2(s.yards / s.attempts) : 0;
}

/** Logs a rush if one was attempted and recalculates stats, mutating the RBStats object */
export function applyRBStats(
  s: RBStats,
  netYards: number,
  state: State,
  reason: PlayEndReason,
): void {
  if (!checkIfRush(state, reason)) return;

  // Update individual simple counts
  s.rushes++;
  s.yards += netYards;
  if (netYards < 0) s.tfls++;
  if (checkIfTouchdown(state, reason)) s.tds++;

  // Recalculate averages
  s.ypc = s.rushes > 0 ? round2(s.yards / s.rushes) : 0;
}

/** Logs a play as being completed and recalculates stats, mutating the CountYards object */
export function updateCountYards(cy: CountYards, netYards: number): void {
  cy.count++;
  cy.yards += netYards;
  cy.avg = round2(cy.yards / cy.count);
}

/* Helpers to compute the result of a play end */
// 1) 4th down results + scoring plays,
export function checkIfTurnoverOnDowns(
  state: State,
  reason: PlayEndReason,
): boolean {
  const sb = state.scoreboard;
  const finalX = getFinalBallX(state, reason, sb);
  return (
    sb.down === "4th" &&
    !checkIfTouchdown(state, reason) &&
    !checkIfSafety(state, reason) &&
    !checkIfInterception(state, reason) &&
    !checkIfFieldGoal(state, reason) &&
    !checkIfPunt(state, reason) &&
    finalX < (sb.firstDownLine ?? Infinity)
  );
}

export function checkIfPunt(_state: State, reason: PlayEndReason): boolean {
  return reason === "punt";
}

export function checkIfFieldGoal(
  _state: State,
  reason: PlayEndReason,
): boolean {
  return reason === "fieldgoal";
}

// Play endings where the ball is downed live at its spot, so ball position
// decides the outcome. Every other ending (incomplete, interception, punt,
// fieldgoal, touchdown) is a dead-ball / special-teams result and can never be
// a safety no matter where the ball froze.
const BALL_DOWNED_REASONS: PlayEndReason[] = ["tackle", "sack"];

/** A safety: the offense is tackled or sacked with the ball in its own endzone. */
export function checkIfSafety(state: State, reason: PlayEndReason): boolean {
  return (
    BALL_DOWNED_REASONS.includes(reason) && state.ball.loc.x <= ENDZONE_W
  );
}

/** A touchdown is signalled explicitly when a ball carrier crosses the goal
 * line (see triggerMove), so it's keyed on the reason, not ball position. */
export function checkIfTouchdown(
  _state: State,
  reason: PlayEndReason,
): boolean {
  return reason === "touchdown";
}

// 2) Rush play
export function checkIfRush(state: State, _reason: PlayEndReason): boolean {
  const carrier = state.players.find((p) => isCarryingBall(p, state.ball));
  return !!state.ballGiven && carrier?.role === "runner";
}

// 3) Pass play
/** Checks if the ball was thrown on the last play */
export function checkIfPassAttempt(
  state: State,
  reason: PlayEndReason,
): boolean {
  return (
    state.currentPlay.offense === "pass" &&
    !checkIfSack(state, reason) &&
    (checkIfPassComplete(state, reason) ||
      checkIfPassIncomplete(state, reason) ||
      checkIfInterception(state, reason))
  );
}

export function checkIfPassComplete(
  state: State,
  reason: PlayEndReason,
): boolean {
  const carrier = state.players.find((p) => isCarryingBall(p, state.ball));
  return (
    !!state.ballGiven &&
    carrier?.role === "catcher" &&
    (reason === "tackle" || reason === "touchdown")
  );
}

/** NOTE: Returns false if it was an interception (only checks for balls not being caught) */
export function checkIfPassIncomplete(
  _state: State,
  reason: PlayEndReason,
): boolean {
  return reason === "incomplete";
}

export function checkIfInterception(
  _state: State,
  reason: PlayEndReason,
): boolean {
  return reason === "interception";
}

export function checkIfSack(_state: State, reason: PlayEndReason): boolean {
  return reason === "sack";
}

export function checkIfScramble(state: State, reason: PlayEndReason): boolean {
  return (
    state.currentPlay.offense === "pass" &&
    !checkIfSack(state, reason) &&
    !checkIfPassAttempt(state, reason) &&
    (reason === "tackle" || reason === "touchdown")
  );
}

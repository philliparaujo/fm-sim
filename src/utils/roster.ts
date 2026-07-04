import { generatePlayerName } from "../core/names";
import { getSavedRatings } from "../core/playbook";
import { getDefaultRatingForLabel } from "../core/ratings";
import {
  Coverage,
  Label,
  Player,
  PLAYER_LABELS,
  Role,
  Roster,
  RosterPlayer,
  Route,
  Side,
  State,
  Team,
  Vector,
} from "../core/types";
import { nullVector } from "../utils/vector";

/** Returns "offense" or "defense" based on player label */
export function labelToSide(label: Label): Side {
  if (["LT", "C", "RT", "QB", "XR", "ZR", "TE", "RB"].includes(label))
    return "offense";
  return "defense";
}

/** Returns player's role (e.g. "catcher") based on player label */
export function labelToRole(label: Label): Role {
  if (["LT", "C", "RT"].includes(label)) return "blocker";
  if (["QB"].includes(label)) return "passer";
  if (["XR", "ZR", "TE"].includes(label)) return "catcher";
  if (["RB"].includes(label)) return "runner";
  if (["LE", "DT", "RE"].includes(label)) return "rusher";
  return "coverer";
}

/** Returns the team currently possessing the ball */
export function getOffenseTeam(state: State): Team {
  const teams = state.scoreboard.teams;
  for (const team of teams) {
    if (team.possessing) return team;
  }

  console.warn("No offense team found??");
  return teams[0];
}

/** Returns the team currently not possessing the ball */
export function getDefenseTeam(state: State): Team {
  const teams = state.scoreboard.teams;
  for (const team of teams) {
    if (!team.possessing) return team;
  }

  console.warn("No defense team found??");
  return teams[0];
}

/** Initializes a team's full roster using default ratings and generated names */
export function buildDefaultRoster(teamColor: string): Roster {
  const labels: Label[] = [...PLAYER_LABELS];
  return labels.map((label) => ({
    color: teamColor,
    label,
    name: generatePlayerName(label),
    ratings: getDefaultRatingForLabel(label),
  }));
}

/** Converts a RosterPlayer into a full Player object */
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
    name: rp.name,
    starred: rp.starred,
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
    breakTick: null,
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

    contactedThisTick: false,
    isBursting: false,
    shedCooldown: 0,
    shedImmunityTicks: 0,

    // Properties for rendering
    contextRays: null,
    chosenRayDir: null,
  };
}

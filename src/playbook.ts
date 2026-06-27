import { ENDZONE_W, H, W } from "./constants";
import { Attribute, getDefaultRatingForLabel, Ratings } from "./ratings";
import {
  Ball,
  Coverage,
  Player,
  Role,
  RosterPlayer,
  Route,
  Scoreboard,
  SpecialPlayType,
  Team,
  Vector,
} from "./types";
import {
  emptyVector,
  labelToRole,
  labelToSide,
  randomRoute,
  randomRunVector,
  yardsFromPixels,
} from "./util";

const BLOCKERS_INCLUDED = true;
const PASSER_INCLUDED = true;
const CATCHERS_INCLUDED = true;
const RUNNER_INCLUDED = true;
const RUSHERS_INCLUDED = BLOCKERS_INCLUDED && true;
const COVERERS_INCLUDED = CATCHERS_INCLUDED && true;
const SAFETIES_INCLUDED = true;

const PLAYBOOK_CONFIG = {
  passPercent: 0.5, // Offensive playcall
  manPercent: 0.4, // Defensive underneath coverage
  blitzPercent: 0.3, // Cover 1 blitz or cover 2 shell
};

const TEAM_PLAYBOOKS: Record<string, Record<string, number>> = {
  red: {
    passPercent: PLAYBOOK_CONFIG.passPercent,
    manPercent: PLAYBOOK_CONFIG.manPercent,
    blitzPercent: PLAYBOOK_CONFIG.blitzPercent,
  },
  blue: {
    passPercent: PLAYBOOK_CONFIG.passPercent,
    manPercent: PLAYBOOK_CONFIG.manPercent,
    blitzPercent: PLAYBOOK_CONFIG.blitzPercent,
  },
};

function generateBall(LOS: number): Ball {
  const BALL_RADIUS = 18;
  const STROKE_WIDTH = 0.8;
  const LACE_WIDTH = 2;
  const BALL_X = LOS - (5 * W) / 100;
  return {
    type: "ball",
    loc: { x: BALL_X, y: H / 2 },
    vel: emptyVector(),
    radius: BALL_RADIUS,
    strokeWidth: STROKE_WIDTH,
    laceWidth: LACE_WIDTH,
  };
}

const savedRatings: Record<string, Partial<Ratings>> = {};
function saveRating(label: string, attr: Attribute, value: number) {
  if (!savedRatings[label]) savedRatings[label] = {};
  savedRatings[label][attr] = value;
}
function getSavedRatings(label: string): Ratings {
  return { ...getDefaultRatingForLabel(label), ...savedRatings[label] };
}

function generateOffensePlaycall2(
  LOS: number,
  ball: Ball,
  team: Team,
): {
  players: Player[];
  playType: "run" | "pass";
  runAngle?: Vector;
  routes: Route[];
} {
  const players: Player[] = [];

  const isPassPlay = Math.random() < PLAYBOOK_CONFIG.passPercent;
  const routes = isPassPlay
    ? [randomRoute(), randomRoute(), randomRoute()]
    : [];
  const runAngle = isPassPlay ? undefined : randomRunVector();

  const CENTER_Y = H / 2;
  const yTE = Math.random() < 0.5 ? CENTER_Y + 0.195 * H : CENTER_Y - 0.195 * H;

  for (const rp of team.roster) {
    const side = labelToSide(rp.label);
    const role = labelToRole(rp.label);
    if (side === "defense" || role === "coverer" || role === "rusher") continue;

    if (!BLOCKERS_INCLUDED && role === "blocker") continue;
    if (!PASSER_INCLUDED && role === "passer") continue;
    if (!CATCHERS_INCLUDED && role === "catcher") continue;
    if (!RUNNER_INCLUDED && role == "runner") continue;

    switch (rp.label) {
      case "LT": {
        players.push(
          fillOutRosterPlayer(rp, { x: LOS, y: CENTER_Y - 0.1 * H }),
        );
        break;
      }
      case "C": {
        players.push(fillOutRosterPlayer(rp, { x: LOS, y: CENTER_Y }));
        break;
      }
      case "RT": {
        players.push(
          fillOutRosterPlayer(rp, { x: LOS, y: CENTER_Y + 0.1 * H }),
        );
        break;
      }
      case "QB": {
        players.push(fillOutRosterPlayer(rp, { ...ball.loc }));
        break;
      }
      case "XR": {
        players.push(
          fillOutRosterPlayer(
            rp,
            { x: LOS, y: CENTER_Y - 0.325 * H },
            routes[0],
          ),
        );
        break;
      }
      case "ZR": {
        players.push(
          fillOutRosterPlayer(
            rp,
            { x: LOS, y: CENTER_Y + 0.325 * H },
            routes[1],
          ),
        );
        break;
      }
      case "TE": {
        players.push(
          fillOutRosterPlayer(
            rp,
            { x: LOS - (2 / 100) * W, y: yTE },
            routes[2],
          ),
        );
        break;
      }
      case "RB": {
        players.push(
          fillOutRosterPlayer(
            rp,
            { x: ball.loc.x - (5 / 100) * W, y: CENTER_Y },
            undefined,
            runAngle,
          ),
        );
      }
    }
  }

  return {
    players,
    playType: isPassPlay ? "pass" : "run",
    runAngle,
    routes,
  };
}

function generateDefensivePlaycall2(
  LOS: number,
  team: Team,
  offensivePlayers: Player[],
): {
  players: Player[];
  coverage: "man" | "manBlitz" | "zone" | "zoneBlitz";
} {
  const players: Player[] = [];
  const CENTER_Y = H / 2;

  const covererCoverage =
    Math.random() < PLAYBOOK_CONFIG.manPercent ? "man" : "zone";
  const isBlitz = Math.random() < PLAYBOOK_CONFIG.blitzPercent;
  const coverage = isBlitz
    ? covererCoverage === "man"
      ? "manBlitz"
      : "zoneBlitz"
    : covererCoverage;

  const catchers = offensivePlayers.filter((p) => p.role === "catcher");

  const zoneMargin = H * 0.1;
  const availableSpace = H - zoneMargin * 2;
  const zoneStep =
    catchers.length > 1 ? availableSpace / (catchers.length - 1) : 0;

  const COVERER_X = LOS + (10 / 100) * W;
  const covererIndexMap: Record<string, number> = { CB: 0, NB: 1, LB: 2 };
  const covererYPositions =
    covererCoverage === "man"
      ? [
          catchers[0]?.loc.y ?? CENTER_Y - 0.325 * H,
          catchers[1]?.loc.y ?? CENTER_Y + 0.325 * H,
          catchers[2]?.loc.y ?? CENTER_Y,
        ]
      : [zoneMargin, zoneMargin + 2 * zoneStep, zoneMargin + zoneStep];

  const ssRole: Role = isBlitz ? "rusher" : "coverer";
  const ssX = isBlitz ? LOS + (6 / 100) * W : LOS + (35 / 100) * W;
  const ssY = isBlitz
    ? Math.random() < 0.5
      ? H * 0.25
      : H * 0.75
    : (25 / 100) * H;
  const ssCoverage: Coverage = "zone";

  const fsX = LOS + (35 / 100) * W;
  const fsY = isBlitz ? H / 2 : (75 / 100) * H;

  for (const rp of team.roster) {
    const side = labelToSide(rp.label);
    const role = labelToRole(rp.label);

    if (
      side === "offense" ||
      role === "blocker" ||
      role === "runner" ||
      role === "passer" ||
      role === "catcher"
    )
      continue;

    if (!RUSHERS_INCLUDED && role === "rusher") continue;
    if (!COVERERS_INCLUDED && ["CB", "NB", "LB"].includes(rp.label)) continue;
    if (!SAFETIES_INCLUDED && ["FS", "SS"].includes(rp.label)) continue;

    switch (rp.label) {
      case "LE":
        players.push(
          fillOutRosterPlayer(rp, {
            x: LOS + (3 / 100) * W,
            y: CENTER_Y - (1 / 7) * H,
          }),
        );
        break;

      case "DT":
        players.push(
          fillOutRosterPlayer(rp, {
            x: LOS + (3 / 100) * W,
            y: CENTER_Y,
          }),
        );
        break;

      case "RE":
        players.push(
          fillOutRosterPlayer(rp, {
            x: LOS + (3 / 100) * W,
            y: CENTER_Y + (1 / 7) * H,
          }),
        );
        break;

      case "CB":
      case "NB":
      case "LB": {
        const idx = covererIndexMap[rp.label];
        players.push(
          fillOutRosterPlayer(
            rp,
            { x: COVERER_X, y: covererYPositions[idx] },
            undefined,
            undefined,
            covererCoverage,
          ),
        );
        break;
      }

      case "SS":
        players.push(
          fillOutRosterPlayer(
            rp,
            { x: ssX, y: ssY },
            undefined,
            undefined,
            ssCoverage,
            ssRole,
          ),
        );
        break;

      case "FS":
        players.push(
          fillOutRosterPlayer(
            rp,
            { x: fsX, y: fsY },
            undefined,
            undefined,
            "zone",
          ),
        );
        break;
    }
  }

  return { players, coverage };
}

function generateSpecialPlaycall(scoreboard: Scoreboard): SpecialPlayType {
  const GO_FOR_IT_DISTANCE = 2;
  const MAX_FIELD_GOAL_KICK_DISTANCE = 55; // actual kick distance, not LOS distance

  const FIELD_GOAL_SNAP_DEPTH = 7; // yards back from LOS for the kick spot
  const HOLDER_TO_CROSSBAR_DEPTH = 10; // yards from goal line to back of endzone/crossbar

  const yardsToOpponentEndzone = yardsFromPixels(
    W + ENDZONE_W - scoreboard.LOS,
  );
  const fieldGoalKickDistance =
    yardsToOpponentEndzone + FIELD_GOAL_SNAP_DEPTH + HOLDER_TO_CROSSBAR_DEPTH;

  if (scoreboard.down !== "4th") return null;
  if (
    scoreboard.distance === "goal" &&
    yardsToOpponentEndzone <= GO_FOR_IT_DISTANCE
  )
    return null;
  if (fieldGoalKickDistance <= MAX_FIELD_GOAL_KICK_DISTANCE) return "fieldgoal";
  return "punt";
}

function fillOutRosterPlayer(
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
    loc: loc ?? emptyVector(),
    role: roleOverride ?? labelToRole(rp.label),
    side: labelToSide(rp.label),
    type: "player",
    vel: emptyVector(),
    prevVel: emptyVector(),

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
    zone: emptyVector(),

    contactedThisFrame: false,
    isBursting: false,
  };
}

export {
  generateBall,
  generateDefensivePlaycall2,
  generateOffensePlaycall2,
  generateSpecialPlaycall,
  PLAYBOOK_CONFIG,
  saveRating,
  TEAM_PLAYBOOKS,
};

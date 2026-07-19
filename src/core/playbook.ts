import { computeFirstDownLine } from "../utils/field";
import { fillOutRosterPlayer, labelToRole, labelToSide } from "../utils/roster";
import { randomRoute, randomRunVector } from "../utils/route";
import {
  ENDZONE_W,
  FIELD_SCALE,
  H,
  pxToYards,
  QUARTER_SECONDS,
  W,
  yardsToPx,
} from "../utils/units";
import { nullVector } from "../utils/vector";
import {
  classifyStructure,
  pickCoverageStructure,
  resolveCoverage,
} from "./coverage";
import { LEAGUE_TEAMS } from "./teams";
import {
  Ball,
  DefensiveCoverageType,
  Player,
  Route,
  Scoreboard,
  SpecialPlayType,
  Team,
  Vector,
} from "./types";

const BLOCKERS_INCLUDED = true;
const PASSER_INCLUDED = true;
const CATCHERS_INCLUDED = true;
const RUNNER_INCLUDED = true;
const RUSHERS_INCLUDED = BLOCKERS_INCLUDED && true;
const COVERERS_INCLUDED = CATCHERS_INCLUDED && true;
const SAFETIES_INCLUDED = true;

const PLAYBOOK_CONFIG = {
  passPercent: 0.55, // Offensive playcall
  deepPercent: 0.6, // Share of non-medium pass routes
  manPercent: 0.5, // Defensive underneath coverage
  blitzPercent: 0.3, // Cover 1 blitz or cover 2 shell
};

// One tendency profile per league team, keyed by color, seeded from the defaults
const TEAM_PLAYBOOKS: Record<
  string,
  Record<string, number>
> = Object.fromEntries(
  LEAGUE_TEAMS.map((t) => [
    t.color,
    {
      passPercent: PLAYBOOK_CONFIG.passPercent,
      deepPercent: PLAYBOOK_CONFIG.deepPercent,
      manPercent: PLAYBOOK_CONFIG.manPercent,
      blitzPercent: PLAYBOOK_CONFIG.blitzPercent,
    },
  ]),
);

function generateBall(LOS: number): Ball {
  const BALL_RADIUS = 18 * FIELD_SCALE;
  const STROKE_WIDTH = 0.8 * FIELD_SCALE;
  const LACE_WIDTH = 2 * FIELD_SCALE;
  const BALL_X = LOS - yardsToPx(5);
  return {
    type: "ball",
    loc: { x: BALL_X, y: H / 2 },
    vel: nullVector(),
    radius: BALL_RADIUS,
    strokeWidth: STROKE_WIDTH,
    laceWidth: LACE_WIDTH,
  };
}

function generateScoreboard(
  LOS: number,
  offenseTeam: Team,
  defenseTeam: Team,
): Scoreboard {
  return {
    distance: 10,
    down: "1st",
    LOS: LOS,
    firstDownLine: computeFirstDownLine(LOS, 10),
    quarter: "1st",
    twoMinuteWarning: false,
    teams: [
      { ...offenseTeam, possessing: true },
      { ...defenseTeam, possessing: false },
    ],
    time: QUARTER_SECONDS,
  };
}

function generateOffensePlaycall(
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

  // Each team calls its own plays off its own tendencies, not a shared global
  // — PLAYBOOK_CONFIG is only ever a fallback/default.
  const tendencies = TEAM_PLAYBOOKS[team.color] ?? PLAYBOOK_CONFIG;
  const isPassPlay =
    Math.random() < (tendencies.passPercent ?? PLAYBOOK_CONFIG.passPercent);
  const deepPercent = tendencies.deepPercent ?? PLAYBOOK_CONFIG.deepPercent;
  const routes = isPassPlay
    ? [
        randomRoute(deepPercent),
        randomRoute(deepPercent),
        randomRoute(deepPercent),
      ]
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
          fillOutRosterPlayer(rp, { x: LOS - yardsToPx(2), y: yTE }, routes[2]),
        );
        break;
      }
      case "RB": {
        players.push(
          fillOutRosterPlayer(
            rp,
            { x: ball.loc.x - yardsToPx(5), y: CENTER_Y },
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

function generateDefensivePlaycall(
  LOS: number,
  team: Team,
  offensivePlayers: Player[],
): {
  players: Player[];
  coverage: DefensiveCoverageType;
  coverageName: string;
} {
  const players: Player[] = [];
  const CENTER_Y = H / 2;

  const catchers = offensivePlayers.filter((p) => p.role === "catcher");
  const catcherByLabel = Object.fromEntries(catchers.map((c) => [c.label, c]));

  // Pick a full coverage call (see core/coverage.ts) and resolve it into
  // concrete alignment for the 5 non-line defenders. Swap this policy or add
  // more presets to core/coverage.ts to change what defenses a team shows —
  // nothing below needs to change.
  // Each team calls its own coverages off its own tendencies, not a shared
  // global — PLAYBOOK_CONFIG is only ever a fallback/default.
  const tendencies = TEAM_PLAYBOOKS[team.color] ?? PLAYBOOK_CONFIG;
  const structure = pickCoverageStructure(
    tendencies.manPercent ?? PLAYBOOK_CONFIG.manPercent,
    tendencies.blitzPercent ?? PLAYBOOK_CONFIG.blitzPercent,
  );
  const resolved = resolveCoverage(structure, {
    los: LOS,
    centerY: CENTER_Y,
    fieldHeight: H,
    catcherY: {
      XR: catcherByLabel["XR"]?.loc.y,
      ZR: catcherByLabel["ZR"]?.loc.y,
      TE: catcherByLabel["TE"]?.loc.y,
    },
  });
  const coverage = classifyStructure(structure);

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
            x: LOS + yardsToPx(3),
            y: CENTER_Y - (1 / 7) * H,
          }),
        );
        break;

      case "DT":
        players.push(
          fillOutRosterPlayer(rp, {
            x: LOS + yardsToPx(3),
            y: CENTER_Y,
          }),
        );
        break;

      case "RE":
        players.push(
          fillOutRosterPlayer(rp, {
            x: LOS + yardsToPx(3),
            y: CENTER_Y + (1 / 7) * H,
          }),
        );
        break;

      case "CB":
      case "NB":
      case "LB":
      case "FS":
      case "SS": {
        const r = resolved[rp.label];
        players.push(
          fillOutRosterPlayer(
            rp,
            r.loc,
            undefined,
            undefined,
            r.coverage,
            r.role,
          ),
        );
        break;
      }
    }
  }

  return { players, coverage, coverageName: structure.name };
}

function generateSpecialPlaycall(scoreboard: Scoreboard): SpecialPlayType {
  const GO_FOR_IT_DISTANCE = 2;
  const MAX_FIELD_GOAL_KICK_DISTANCE = 55; // actual kick distance, not LOS distance

  const FIELD_GOAL_SNAP_DEPTH = 7; // yards back from LOS for the kick spot
  const HOLDER_TO_CROSSBAR_DEPTH = 10; // yards from goal line to back of endzone/crossbar

  const yardsToOpponentEndzone = pxToYards(W + ENDZONE_W - scoreboard.LOS);
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

export {
  generateBall,
  generateDefensivePlaycall,
  generateOffensePlaycall,
  generateScoreboard,
  generateSpecialPlaycall,
  PLAYBOOK_CONFIG,
  TEAM_PLAYBOOKS,
};

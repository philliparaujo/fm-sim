import { Attribute, defaultRatings, Ratings } from "./ratings";
import { H, W } from "./render";
import { Ball, PartialPlayer, Player, Route, Vector } from "./types";
import { emptyVector, randomRoute, randomRunVector } from "./util";

// Offensive playcall
const PASS_PERCENT = 0.5;
const RUN_PERCENT = 1 - PASS_PERCENT;

// Defensive underneath coverage playcall
const MAN_PERCENT = 0.5;
const ZONE_PERCENT = 1 - MAN_PERCENT;

// Cover 1 blitz or Cover 2 shell
const BLITZ_PERCENT = 0.5;

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

let offenseLabelIndex = 0;
let defenseLabelIndex = 0;
const OFFENSIVE_LABELS = ["LT", "C", "RT", "QB", "XR", "ZR", "TE", "RB"];
const DEFENSIVE_LABELS = ["LE", "DT", "RE", "CB", "NB", "LB", "SS", "FS"];
function nextOffenseLabel(): string {
  return OFFENSIVE_LABELS[offenseLabelIndex++ % OFFENSIVE_LABELS.length];
}
function nextDefenseLabel(): string {
  return DEFENSIVE_LABELS[defenseLabelIndex++ % DEFENSIVE_LABELS.length];
}

const savedRatings: Record<string, Partial<Ratings>> = {};
function saveRating(label: string, attr: Attribute, value: number) {
  if (!savedRatings[label]) savedRatings[label] = {};
  savedRatings[label][attr] = value;
}
function getSavedRatings(label: string): Ratings {
  return { ...defaultRatings, ...savedRatings[label] };
}

function generateOffensePlaycall(
  LOS: number,
  ball: Ball,
  teamColor: string,
): {
  players: PartialPlayer[];
  playType: "run" | "pass";
  runAngle?: Vector;
  routes: Route[];
} {
  offenseLabelIndex = 0;
  const isPassPlay = Math.random() < PASS_PERCENT;
  const players: PartialPlayer[] = [];

  const CENTER_Y = H / 2;
  const DEFAULT_RADIUS = 24;

  // Add 3 blockers
  const BLOCKER_X = LOS;
  const BLOCKER_CENTER_Y = CENTER_Y;
  const BLOCKER_SPREAD_Y = (0.4 / 4) * H;
  const BLOCKER_SPEED = 3;
  const BLOCKER_RADIUS = DEFAULT_RADIUS;
  for (let i = 0; i < 3; i++) {
    players.push({
      type: "player",
      color: teamColor,
      label: nextOffenseLabel(),
      position: "offense",
      role: "blocker",
      loc: { x: BLOCKER_X, y: BLOCKER_CENTER_Y + (i - 1) * BLOCKER_SPREAD_Y },
      vel: emptyVector(),
    });
  }

  // Add quarterback
  const QB_SPEED = 4.2;
  const QB_RADIUS = DEFAULT_RADIUS;
  players.push({
    type: "player",
    color: teamColor,
    label: nextOffenseLabel(),
    position: "offense",
    role: "passer",
    loc: { x: ball.loc.x, y: ball.loc.y },
    vel: emptyVector(),
  });

  // Add one receiver on each side
  const OUTSIDE_RECEIVER_X = LOS;
  const OUTSIDE_RECEIVER_SPREAD_Y = (1.3 / 4) * H;
  const OUTSIDE_RECEIVER_SPEED = 4.8;
  const OUTSIDE_RECEIVER_RADIUS = DEFAULT_RADIUS;
  for (let i = 0; i < 2; i++) {
    players.push({
      type: "player",
      color: teamColor,
      label: nextOffenseLabel(),
      position: "offense",
      role: "catcher",
      loc: {
        x: OUTSIDE_RECEIVER_X,
        y: CENTER_Y + (2 * i - 1) * OUTSIDE_RECEIVER_SPREAD_Y,
      },
      vel: emptyVector(),
      route: randomRoute(),
    });
  }

  // Choose where to place last receiver
  const SLOT_RECEIVER_X = LOS - (2 * W) / 100;
  const SLOT_RECEIVER_SPREAD_Y = (OUTSIDE_RECEIVER_SPREAD_Y * 3) / 5;
  const SLOT_RECEIVER_SPEED = 4.8;
  const SLOT_RECEIVER_RADIUS = DEFAULT_RADIUS;
  const SLOT_RECEIVER_Y =
    Math.random() < 0.5
      ? CENTER_Y - SLOT_RECEIVER_SPREAD_Y
      : CENTER_Y + SLOT_RECEIVER_SPREAD_Y;
  players.push({
    type: "player",
    color: teamColor,
    label: nextOffenseLabel(),
    position: "offense",
    role: "catcher",
    loc: { x: SLOT_RECEIVER_X, y: SLOT_RECEIVER_Y },
    vel: emptyVector(),
    route: randomRoute(),
  });

  // Choose what to do with RB (runner, blocker, catcher out wide)
  const RB_ROLE = "runner";
  const RB_Y = CENTER_Y;
  const RB_X = ball.loc.x - (5 / 100) * W;
  const RB_SPEED = 5.7;
  const RB_VEL = isPassPlay ? emptyVector() : randomRunVector();
  const RB_RADIUS = DEFAULT_RADIUS;
  players.push({
    type: "player",
    color: teamColor,
    label: nextOffenseLabel(),
    position: "offense",
    role: RB_ROLE,
    loc: { x: RB_X, y: RB_Y },
    vel: emptyVector(),
    runAngle: RB_VEL,
  });

  return {
    players,
    playType: isPassPlay ? "pass" : "run",
    runAngle: isPassPlay ? undefined : RB_VEL,
    routes: players
      .filter((p) => p.role === "catcher" && p.route)
      .map((p) => p.route!),
  };
}

function generateDefensivePlaycall(
  LOS: number,
  teamColor: string,
  offensivePlayers: PartialPlayer[],
): {
  players: PartialPlayer[];
  coverage: "man" | "manBlitz" | "zone" | "zoneBlitz";
} {
  defenseLabelIndex = 0;
  const players: PartialPlayer[] = [];

  const CENTER_Y = H / 2;
  const DEFAULT_RADIUS = 24;

  // Add 3 rushers on LOS
  const RUSHER_X = LOS + (5 / 100) * W;
  const RUSHER_CENTER_Y = CENTER_Y;
  const RUSHER_SPREAD_Y = (1 / 7) * H;
  const RUSHER_SPEED = 4.5;
  const RUSHER_RADIUS = DEFAULT_RADIUS;
  for (let i = 0; i < 3; i++) {
    players.push({
      type: "player",
      color: teamColor,
      label: nextDefenseLabel(),
      position: "defense",
      role: "rusher",
      loc: { x: RUSHER_X, y: RUSHER_CENTER_Y + (i - 1) * RUSHER_SPREAD_Y },
      vel: emptyVector(),
    });
  }

  // Match coverers with catchers
  const COVERER_X = LOS + (1 / 10) * W;
  const COVERER_SPEED = 4.8;
  const COVERER_RADIUS = DEFAULT_RADIUS;
  const COVERER_COVERAGE = Math.random() < MAN_PERCENT ? "man" : "zone";

  const catchers = offensivePlayers.filter((p) => p.role === "catcher");

  const zoneMargin = H * 0.1;
  const availableSpace = H - zoneMargin * 2;
  const zoneStep =
    catchers.length > 1 ? availableSpace / (catchers.length - 1) : 0;

  catchers.forEach((catcher, index) => {
    const yPos =
      COVERER_COVERAGE === "man"
        ? catcher.loc.y
        : catchers.length > 1
          ? zoneMargin + index * zoneStep
          : H / 2;

    players.push({
      type: "player",
      color: teamColor,
      label: nextDefenseLabel(),
      position: "defense",
      role: "coverer",
      loc: { x: COVERER_X, y: yPos },
      vel: { x: 0.5, y: 0 },
      coverage: COVERER_COVERAGE,
    });
  });

  // Choose what to do with LB/S (Cover 2 or Cover 1 blitz)
  const isBlitz = Math.random() < BLITZ_PERCENT;

  const LB_ROLE = isBlitz ? "rusher" : "coverer";
  const LB_X = isBlitz ? LOS + (7 / 100) * W : LOS + (35 / 100) * W;
  const LB_Y = isBlitz ? (Math.random() < 0.5 ? H * 0.25 : H * 0.75) : H / 3;
  const LB_SPEED = isBlitz ? 4.5 : 4.8;
  const LB_RADIUS = DEFAULT_RADIUS;
  players.push({
    type: "player",
    color: teamColor,
    label: nextDefenseLabel(),
    position: "defense",
    role: LB_ROLE,
    loc: { x: LB_X, y: LB_Y },
    vel: emptyVector(),
    coverage: "zone",
  });

  const S_X = LOS + (35 / 100) * W;
  const S_Y = isBlitz ? H / 2 : (2 * H) / 3;
  const S_SPEED = 4.8;
  const S_RADIUS = DEFAULT_RADIUS;
  players.push({
    type: "player",
    color: teamColor,
    label: nextDefenseLabel(),
    position: "defense",
    role: "coverer",
    loc: { x: S_X, y: S_Y },
    vel: emptyVector(),
    coverage: "zone",
  });

  const underneathCoverage = COVERER_COVERAGE;
  const coverage = isBlitz
    ? underneathCoverage === "man"
      ? "manBlitz"
      : "zoneBlitz"
    : underneathCoverage;

  return { players, coverage };
}

function fillOutPlayers(partials: PartialPlayer[]): Player[] {
  const players: Player[] = [];

  for (const partial of partials) {
    const full: Player = {
      // TEMP: Ratings
      ratings: getSavedRatings(partial.label),

      // General properties determined on creation
      type: partial.type,
      loc: partial.loc,
      vel: partial.vel,
      color: partial.color,
      label: partial.label,
      position: partial.position,
      role: partial.role,

      // Specific properties determined on creation
      runAngle: partial.runAngle,
      route: partial.route,
      path: [],
      breakFrame: null,
      coverage: partial.coverage,

      // Specific properties determined later
      assignedTarget: null,
      perceivedLoc: null,
      perceivedVel: null,
      reactionTimer: 0,
      zone: emptyVector(),

      contactedThisFrame: false,
    };
    players.push(full);
  }

  return players;
}

export {
  fillOutPlayers,
  generateBall,
  generateDefensivePlaycall,
  generateOffensePlaycall,
  saveRating,
};

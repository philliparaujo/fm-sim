import { labelToRole, labelToSide } from "../utils/roster";
import { scoreProspect } from "./draftEval";
import { DEFAULT_ROLE_WEIGHTS } from "./draftStrategies";
import { Attribute, getProximity, raiseRatingProximity, Ratings } from "./ratings";
import { LEAGUE } from "./state";
import { Label, RosterPlayer, Team } from "./types";

// ── Focus categories ────────────────────────────────────────────────────────
// A category decides WHICH of a player's trainable attributes a focused
// player's points develop. "general" spreads across every trainable attribute
// for that role; each specific category concentrates into its own group.

export type FocusCategory =
  | "general"
  | "running"
  | "passing"
  | "receiving"
  | "blocking"
  | "passRush"
  | "coverage";

export const FOCUS_CATEGORIES: { key: FocusCategory; label: string }[] = [
  { key: "general", label: "General" },
  { key: "running", label: "Running" },
  { key: "passing", label: "Passing" },
  { key: "receiving", label: "Receiving" },
  { key: "blocking", label: "Blocking" },
  { key: "passRush", label: "Pass Rush" },
  { key: "coverage", label: "Coverage" },
];

/** Weekly training-point budget: a handful of players get singled out for
 * focused development each week; everyone else still improves a little on
 * their own (see applyTraining below). */
export const POINTS_BUDGET = 3;

const CATEGORY_ATTRS: Record<Exclude<FocusCategory, "general">, Attribute[]> = {
  running: ["SPEED", "POWER", "VISION"],
  passing: ["THROWPOWER", "POCKETPRESENCE", "DECISIONMAKING", "SHORTACCURACY", "DEEPACCURACY"],
  receiving: ["ROUTERUNNING", "CATCHACCELERATION", "CATCHRADIUS", "SPEED"],
  blocking: ["PASSBLOCK", "RUNBLOCK", "SIZE"],
  passRush: ["BLOCKSHEDDING", "BEND", "SPEED"],
  coverage: ["MANCOVERAGE", "ZONECOVERAGE", "PURSUIT", "CATCHRADIUS"],
};

/** Physical/genetic tools — still trainable, but independently and at a
 * fraction of the normal rate (see PHYSICAL_DEVELOPMENT_RATE below), so a
 * position leaning heavily on these (e.g. a running back's SPEED/POWER)
 * doesn't have to dump its entire weekly development into one or two
 * leftover technique attributes. */
const PHYSICAL_ATTRS: Attribute[] = ["SPEED", "SIZE", "THROWPOWER", "POWER"];

/** A player's overall on the 0–100 scale. */
function ovrOf(rp: RosterPlayer): number {
  return scoreProspect(rp) * 100;
}

// ── Season-start baseline ────────────────────────────────────────────────────
// Snapshot of every rostered player's overall when the season began, so the
// training screen can show how much each player/side/team has developed since.

const baseline: Record<string, Partial<Record<Label, number>>> = {};
/** Season-start attribute ratings per team → label, so the training screen can
 * show an attribute's previous letter grade once training has changed it. */
const baselineRatings: Record<string, Partial<Record<Label, Ratings>>> = {};

/** Snapshots every team's current overalls and ratings as the season-start baseline. */
export function captureTrainingBaseline(): void {
  for (const k of Object.keys(baseline)) delete baseline[k];
  for (const k of Object.keys(baselineRatings)) delete baselineRatings[k];
  for (const team of LEAGUE) {
    const byLabel: Partial<Record<Label, number>> = {};
    const ratingsByLabel: Partial<Record<Label, Ratings>> = {};
    for (const rp of team.roster) {
      byLabel[rp.label] = ovrOf(rp);
      ratingsByLabel[rp.label] = { ...rp.ratings };
    }
    baseline[team.color] = byLabel;
    baselineRatings[team.color] = ratingsByLabel;
  }
}

/** A player's season-start rating for one attribute, or null if no baseline. */
export function playerBaselineRating(
  color: string,
  label: Label,
  attr: Attribute,
): number | null {
  return baselineRatings[color]?.[label]?.[attr] ?? null;
}

/** Captures the baseline once, the first time it's needed (before any training). */
export function ensureTrainingBaseline(): void {
  if (Object.keys(baseline).length === 0) captureTrainingBaseline();
}

/** Overall gained by a player since the season baseline (null if no baseline). */
export function playerOvrDelta(color: string, rp: RosterPlayer): number | null {
  const base = baseline[color]?.[rp.label];
  return base === undefined ? null : ovrOf(rp) - base;
}

/** Average overall gained by a team's players (optionally one side) since baseline. */
function groupDelta(team: Team, side?: "offense" | "defense"): number | null {
  const players = team.roster.filter(
    (rp) => !side || labelToSide(rp.label) === side,
  );
  const deltas = players
    .map((rp) => playerOvrDelta(team.color, rp))
    .filter((d): d is number => d !== null);
  if (deltas.length === 0) return null;
  return deltas.reduce((a, b) => a + b, 0) / deltas.length;
}

export function teamOvrDelta(team: Team): number | null {
  return groupDelta(team);
}
export function sideOvrDelta(team: Team, side: "offense" | "defense"): number | null {
  return groupDelta(team, side);
}

/** Average overall gained by a team's players at one role (e.g. "passer",
 * "catcher", "rusher") since the season baseline. */
export function roleOvrDelta(team: Team, role: string): number | null {
  const deltas = team.roster
    .filter((rp) => labelToRole(rp.label) === role)
    .map((rp) => playerOvrDelta(team.color, rp))
    .filter((d): d is number => d !== null);
  if (deltas.length === 0) return null;
  return deltas.reduce((a, b) => a + b, 0) / deltas.length;
}

// ── Weekly completion tracking ───────────────────────────────────────────────
// Which weeks each team has already trained for, whether the human confirmed
// it from the Training tab or it was auto-completed for a CPU team. Keyed by
// team color → set of completed week numbers.

const completedWeeks: Record<string, Set<number>> = {};

/** True once `color`'s training for `week` has been applied (by human or CPU). */
export function isTrainingDoneForWeek(color: string, week: number): boolean {
  return completedWeeks[color]?.has(week) ?? false;
}

function markTrainingDone(color: string, week: number): void {
  (completedWeeks[color] ??= new Set()).add(week);
}

/** Resets weekly-training completion — call whenever the season restarts. */
export function clearTrainingCompletion(): void {
  for (const k of Object.keys(completedWeeks)) delete completedWeeks[k];
}

// ── Weekly gain tracking ─────────────────────────────────────────────────────
// How much overall each player actually gained the specific week training was
// applied — separate from the season-long baseline above, so the UI can show
// "this week" alongside "this season". Captured directly in applyTraining
// (before/after), keyed by team color → label → week number.

const weeklyGains: Record<string, Partial<Record<Label, Record<number, number>>>> = {};

function recordWeeklyGain(color: string, label: Label, week: number, delta: number): void {
  const byLabel = (weeklyGains[color] ??= {});
  const byWeek = (byLabel[label] ??= {});
  byWeek[week] = delta;
}

/** A player's overall gain for the specific week training was applied (0 if
 * that player/week hasn't been trained). */
export function playerWeeklyGain(color: string, label: Label, week: number): number {
  return weeklyGains[color]?.[label]?.[week] ?? 0;
}

/** Average overall gained by a team's players (optionally filtered) in `week`. */
function groupWeeklyGain(
  team: Team,
  week: number,
  filter?: (rp: RosterPlayer) => boolean,
): number {
  const players = team.roster.filter((rp) => !filter || filter(rp));
  if (players.length === 0) return 0;
  const gains = players.map((rp) => playerWeeklyGain(team.color, rp.label, week));
  return gains.reduce((a, b) => a + b, 0) / gains.length;
}

export function teamWeeklyGain(team: Team, week: number): number {
  return groupWeeklyGain(team, week);
}
export function sideWeeklyGain(team: Team, week: number, side: "offense" | "defense"): number {
  return groupWeeklyGain(team, week, (rp) => labelToSide(rp.label) === side);
}
export function roleWeeklyGain(team: Team, week: number, role: string): number {
  return groupWeeklyGain(team, week, (rp) => labelToRole(rp.label) === role);
}

// ── Applying training ────────────────────────────────────────────────────────
//
// Every rostered player develops a little each week: players with focus points
// assigned get a bigger bump in the selected category's attributes; everyone
// else gets a much smaller, general "still practicing" bump.
//
// Two separate mechanisms move a player's attributes, and they don't mix:
//
// 1. Physical attributes (SPEED/SIZE/THROWPOWER/POWER) develop independently,
//    at a flat fraction of a technique attribute's rate (see
//    PHYSICAL_DEVELOPMENT_RATE), driven only by their own room to grow. This
//    is deliberately NOT tied to the overall-conservation math below — it's
//    what keeps a season of physical development to a small, steady partial
//    step (e.g. B → B+) instead of a runaway swing.
//
// 2. Technique attributes are conserved toward the same target OVERALL delta
//    for every player at a given overall (a diminishing-returns curve on
//    their scalar overall, not on any one attribute), regardless of how that
//    overall is composed. A role with a small technique-weight share (e.g. a
//    running back's VISION/PASSBLOCK) leans harder on those few attributes to
//    hit the same target as any other role.
//
// Both mechanisms run through a hard per-attribute weekly cap
// (MAX_WEEKLY_ATTR_PROX): whatever the math above wants, no single attribute
// can ever move more than that in one week. Without this cap, a role whose
// other attributes cap out early (or whose weight is concentrated on very few
// attributes) can otherwise see the *entire* remaining weekly budget dumped
// into one leftover attribute — which is exactly the "F → S in a season"
// runaway this cap exists to prevent.

/** Background (untouched players) weekly growth-target strength — this is a
 * target *overall* (0–1) delta at zero overall, scaled down by
 * developmentRate(overall) below. */
const BACKGROUND_STRENGTH = 0.01;
/** Growth-target strength per training point assigned to a player this week.
 * Meaningfully larger than the background rate, but still a single week's
 * worth once diminishing returns are applied. */
const FOCUS_STRENGTH_PER_POINT = 0.025;
/** Physical attributes develop at this fraction of a technique attribute's
 * rate, given equal room to grow — present, but a distant second. */
const PHYSICAL_DEVELOPMENT_RATE = 0.5;
/** Hard ceiling on how much any single attribute's proximity can move in one
 * week, regardless of what the formulas below would otherwise produce — the
 * actual guard against runaway swings. */
const MAX_WEEKLY_ATTR_PROX = 0.03;

/** Diminishing-returns curve on proximity (0 = worst/F, 1 = best/S): applied
 * both to a player's overall (how much total technique development they get
 * this week) and to each individual attribute's own room (physical or
 * technique). */
function developmentRate(proximity: number): number {
  const room = Math.max(0, 1 - proximity);
  return room * room;
}

/**
 * Applies a week's assigned points to a team's roster: players with points
 * develop the active category's attributes; everyone else gets a small
 * general bump. Mutates ratings in place, records each player's overall gain
 * for `week` (see playerWeeklyGain), and marks `week` complete for `team`.
 */
export function applyTraining(
  team: Team,
  points: Partial<Record<Label, number>>,
  category: FocusCategory,
  week: number,
): void {
  ensureTrainingBaseline();
  for (const rp of team.roster) {
    const before = ovrOf(rp);
    const assigned = points[rp.label] ?? 0;
    if (assigned > 0) {
      trainPlayer(rp, targetAttrs(rp, category), FOCUS_STRENGTH_PER_POINT * assigned);
    } else {
      trainPlayer(rp, targetAttrs(rp, "general"), BACKGROUND_STRENGTH);
    }
    recordWeeklyGain(team.color, rp.label, week, ovrOf(rp) - before);
  }
  markTrainingDone(team.color, week);
}

/** The attributes a category develops for a given player's role (physical
 * ones included — they just develop slower, see PHYSICAL_DEVELOPMENT_RATE),
 * falling back to a general spread when the category doesn't overlap that
 * role at all (so a mismatched focus still does something). */
function targetAttrs(rp: RosterPlayer, category: FocusCategory): Attribute[] {
  const roleAttrs = Object.keys(DEFAULT_ROLE_WEIGHTS[labelToRole(rp.label)] ?? {}) as Attribute[];

  if (category === "general") return roleAttrs;

  const overlap = roleAttrs.filter((a) => CATEGORY_ATTRS[category].includes(a));
  return overlap.length > 0 ? overlap : roleAttrs;
}

function trainPlayer(rp: RosterPlayer, attrs: Attribute[], strength: number): void {
  const physical = attrs.filter((a) => PHYSICAL_ATTRS.includes(a));
  const technique = attrs.filter((a) => !PHYSICAL_ATTRS.includes(a));
  developPhysical(rp, physical, strength);
  developTechnique(rp, technique, strength);
}

/** Physical attributes: a small, independent, capped bump — never amplified
 * by anything happening to the player's other attributes. */
function developPhysical(rp: RosterPlayer, attrs: Attribute[], strength: number): void {
  for (const attr of attrs) {
    const rating = rp.ratings[attr] ?? 0;
    const room = developmentRate(getProximity(attr, rating));
    const dProx = Math.min(MAX_WEEKLY_ATTR_PROX, strength * PHYSICAL_DEVELOPMENT_RATE * room);
    rp.ratings[attr] = raiseRatingProximity(attr, rating, dProx);
  }
}

/**
 * Technique attributes: raised so the player's OVERALL increases by roughly
 * `strength * developmentRate(overall)` this week — a target that depends
 * only on the player's current overall, not on how it's distributed across
 * attributes. That target overall delta is converted into concrete
 * per-attribute proximity gains by conserving the OVR formula (a weighted
 * average over every role attribute, physical included, via wTotal):
 * attributes with more of their own room absorb a bigger share of the shared
 * budget, and a role with little technique weight (e.g. a running back)
 * leans harder on its few technique attributes to hit the same target as any
 * other role — each capped at MAX_WEEKLY_ATTR_PROX so that leaning never
 * turns into a runaway swing.
 */
function developTechnique(rp: RosterPlayer, attrs: Attribute[], strength: number): void {
  const weights = DEFAULT_ROLE_WEIGHTS[labelToRole(rp.label)] ?? {};
  const wTotal = Object.values(weights).reduce((s, w) => s + (w ?? 0), 0);
  if (wTotal <= 0 || attrs.length === 0) return;

  const overall = scoreProspect(rp);
  const dOverallTarget = strength * developmentRate(overall);
  if (dOverallTarget <= 0) return;

  const rooms = attrs.map((attr) => {
    const rating = rp.ratings[attr] ?? 0;
    return { attr, weight: weights[attr] ?? 0, room: developmentRate(getProximity(attr, rating)) };
  });
  const totalRoomWeight = rooms.reduce((s, r) => s + r.weight * r.room, 0);
  if (totalRoomWeight <= 0) return; // every targeted attribute is already maxed

  const k = (dOverallTarget * wTotal) / totalRoomWeight;
  for (const { attr, room } of rooms) {
    const rating = rp.ratings[attr] ?? 0;
    const dProx = Math.min(MAX_WEEKLY_ATTR_PROX, k * room);
    rp.ratings[attr] = raiseRatingProximity(attr, rating, dProx);
  }
}

// ── CPU auto-training ────────────────────────────────────────────────────────
// An extremely basic stand-in for a human setting the week's focus: train
// whichever position group is weakest, and put the points on the players who
// need the reps most (the lowest-overall ones).

const ROLE_TO_CATEGORY: Partial<Record<string, FocusCategory>> = {
  passer: "passing",
  runner: "running",
  catcher: "receiving",
  blocker: "blocking",
  rusher: "passRush",
  coverer: "coverage",
};

/** The focus category matching the team's lowest-average-overall role. */
function weakestRoleCategory(team: Team): FocusCategory {
  const totals = new Map<string, { sum: number; n: number }>();
  for (const rp of team.roster) {
    const role = labelToRole(rp.label);
    const t = totals.get(role) ?? { sum: 0, n: 0 };
    t.sum += ovrOf(rp);
    t.n += 1;
    totals.set(role, t);
  }

  let worstRole: string | null = null;
  let worstAvg = Infinity;
  for (const [role, { sum, n }] of totals) {
    const avg = sum / n;
    if (avg < worstAvg) {
      worstAvg = avg;
      worstRole = role;
    }
  }
  return (worstRole && ROLE_TO_CATEGORY[worstRole]) || "general";
}

/** Puts one point each on the `n` lowest-overall players — a simple stand-in
 * for a human choosing who needs the reps most. */
function autoAssignPoints(team: Team, n: number): Partial<Record<Label, number>> {
  const neediest = [...team.roster].sort((a, b) => ovrOf(a) - ovrOf(b)).slice(0, n);
  const points: Partial<Record<Label, number>> = {};
  for (const rp of neediest) points[rp.label] = 1;
  return points;
}

/** Auto-completes one team's weekly training if it hasn't been done yet:
 * focuses the weakest position group and assigns points to the neediest
 * players. */
export function autoTrainTeam(team: Team, week: number): void {
  if (team.roster.length === 0) return;
  if (isTrainingDoneForWeek(team.color, week)) return;
  const category = weakestRoleCategory(team);
  const points = autoAssignPoints(team, POINTS_BUDGET);
  applyTraining(team, points, category, week);
}

/** Auto-completes weekly training for every league team except `excludeColor`
 * (typically the human's team, if any) that hasn't already trained this week. */
export function autoTrainAllExcept(excludeColor: string, week: number): void {
  for (const team of LEAGUE) {
    if (team.color === excludeColor) continue;
    autoTrainTeam(team, week);
  }
}

/** Auto-completes weekly training for every league team that hasn't already
 * trained this week — including a human-controlled one. Used as a fallback
 * when simming a week forward (see AUTO_TRAIN_ON_SIM), so a team's
 * development never silently skips a week just because nobody visited the
 * Training tab; a team that already trained manually is left untouched. */
export function autoTrainAll(week: number): void {
  for (const team of LEAGUE) autoTrainTeam(team, week);
}

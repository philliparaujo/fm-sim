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

const CATEGORY_ATTRS: Record<Exclude<FocusCategory, "general">, Attribute[]> = {
  running: ["SPEED", "POWER", "VISION"],
  passing: ["THROWPOWER", "POCKETPRESENCE", "DECISIONMAKING", "SHORTACCURACY", "DEEPACCURACY"],
  receiving: ["ROUTERUNNING", "CATCHACCELERATION", "CATCHRADIUS", "SPEED"],
  blocking: ["PASSBLOCK", "RUNBLOCK", "SIZE"],
  passRush: ["BLOCKSHEDDING", "BEND", "SPEED"],
  coverage: ["MANCOVERAGE", "ZONECOVERAGE", "PURSUIT", "CATCHRADIUS"],
};

/** Physical/genetic tools — not moved by practice, regardless of focus. */
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

// ── Applying training ────────────────────────────────────────────────────────
//
// Every rostered player develops a little each week: players with focus points
// assigned get a concentrated bump in the selected category's attributes;
// everyone else gets a much smaller, general "still practicing" bump. Neither
// ever touches a physical attribute (SPEED/SIZE/THROWPOWER/POWER) — those are
// fixed tools, not something a week of practice moves.
//
// Both bumps run through the same diminishing-returns curve: an attribute
// already near its peak (S/A grades) inches up far less than one with a lot of
// room to grow (D/F grades), so gains stay small and self-limiting.

/** Small weekly growth every rostered player gets on attributes not singled
 * out for focus this week (proximity units, before the diminishing-returns
 * curve below is applied). */
const BACKGROUND_STRENGTH = 0.015;
/** Growth strength per training point assigned to a player this week,
 * concentrated into the selected focus category's attributes. Meaningfully
 * larger than the background rate, but still a single week's worth. */
const FOCUS_STRENGTH_PER_POINT = 0.035;

/** Diminishing-returns curve on proximity (0 = worst/F, 1 = best/S): well-
 * rated attributes (S, A+, A, A-) improve far less per week than poorly-rated
 * ones (D+, D, D-, F), which have far more room to grow. */
function developmentRate(proximity: number): number {
  const room = Math.max(0, 1 - proximity);
  return room * room;
}

/**
 * Applies a week's assigned points to a team's roster: players with points
 * develop the active category's attributes; everyone else gets a small
 * general bump. Mutates ratings in place.
 */
export function applyTraining(
  team: Team,
  points: Partial<Record<Label, number>>,
  category: FocusCategory,
): void {
  ensureTrainingBaseline();
  for (const rp of team.roster) {
    const assigned = points[rp.label] ?? 0;
    if (assigned > 0) {
      trainAttrs(rp, targetAttrs(rp, category), FOCUS_STRENGTH_PER_POINT * assigned);
    } else {
      trainAttrs(rp, targetAttrs(rp, "general"), BACKGROUND_STRENGTH);
    }
  }
}

/** The trainable (non-physical) attributes a category develops for a given
 * player's role, falling back to a general spread when the category doesn't
 * overlap that role at all (so a mismatched focus still does something). */
function targetAttrs(rp: RosterPlayer, category: FocusCategory): Attribute[] {
  const roleAttrs = (
    Object.keys(DEFAULT_ROLE_WEIGHTS[labelToRole(rp.label)] ?? {}) as Attribute[]
  ).filter((a) => !PHYSICAL_ATTRS.includes(a));

  if (category === "general") return roleAttrs;

  const catAttrs = CATEGORY_ATTRS[category].filter((a) => !PHYSICAL_ATTRS.includes(a));
  const overlap = roleAttrs.filter((a) => catAttrs.includes(a));
  return overlap.length > 0 ? overlap : roleAttrs;
}

function trainAttrs(rp: RosterPlayer, attrs: Attribute[], strength: number): void {
  for (const attr of attrs) {
    const rating = rp.ratings[attr] ?? 0;
    const dProx = strength * developmentRate(getProximity(attr, rating));
    rp.ratings[attr] = raiseRatingProximity(attr, rating, dProx);
  }
}

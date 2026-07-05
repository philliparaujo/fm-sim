import { DraftProspect, hasLabel } from "./draft";
import { Attribute, getProximity, Ratings } from "./ratings";
import { Label, PLAYER_LABELS, Team } from "./types";
import { labelToRole } from "../utils/roster";

type RoleWeights = Partial<Record<Attribute, number>>;

const ROLE_WEIGHTS: Record<string, RoleWeights> = {
  passer: {
    SPEED: 0.05,
    THROWPOWER: 0.25,
    POCKETPRESENCE: 0.1,
    DECISIONMAKING: 0.25,
    SHORTACCURACY: 0.15,
    DEEPACCURACY: 0.2,
  },
  runner: {
    SPEED: 0.3,
    SIZE: 0.01,
    VISION: 0.25,
    POWER: 0.4,
    PASSBLOCK: 0.04,
  },
  catcher: {
    SPEED: 0.25,
    SIZE: 0.01,
    ROUTERUNNING: 0.25,
    CATCHACCELERATION: 0.05,
    CATCHRADIUS: 0.3,
    RUNBLOCK: 0.04,
    VISION: 0.05,
    POWER: 0.05,
  },
  blocker: {
    SPEED: 0.05,
    SIZE: 0.15,
    PASSBLOCK: 0.4,
    RUNBLOCK: 0.4,
  },
  rusher: {
    SPEED: 0.15,
    SIZE: 0.05,
    BLOCKSHEDDING: 0.4,
    BEND: 0.3,
    TACKLING: 0.1,
  },
  coverer: {
    SPEED: 0.18,
    SIZE: 0.01,
    PURSUIT: 0.05,
    MANCOVERAGE: 0.21,
    ZONECOVERAGE: 0.31,
    TACKLING: 0.05,
    BLOCKSHEDDING: 0.01,
    CATCHRADIUS: 0.08,
  },
};

export type EvalResult = {
  prospect: DraftProspect;
  label: Label;
  /** Normalized weighted score in [0, 1]. */
  score: number;
  /** How far ahead of the 2nd-best prospect at the same position (0 if only one remains). */
  margin: number;
};

/** Weighted average of a player's relevant attributes, normalized to [0, 1]. */
export function scoreProspect(prospect: {
  label: Label;
  ratings: Ratings;
}): number {
  const role = labelToRole(prospect.label as Label);
  const weights = ROLE_WEIGHTS[role] ?? {};
  let total = 0;
  let weightSum = 0;
  for (const [attr, w] of Object.entries(weights) as [Attribute, number][]) {
    total += getProximity(attr, prospect.ratings[attr] ?? 0) * w;
    weightSum += w;
  }
  return weightSum > 0 ? total / weightSum : 0;
}

/**
 * Best prospect within a single position group, plus their score margin over
 * the 2nd-best at that same position.
 */
export function bestInGroup(
  label: Label,
  pool: DraftProspect[],
): EvalResult | null {
  const ranked = pool
    .filter((p) => p.label === label)
    .map((p) => ({ prospect: p, score: scoreProspect(p) }))
    .sort((a, b) => b.score - a.score);

  if (ranked.length === 0) return null;
  const { prospect, score } = ranked[0];
  const margin = ranked.length > 1 ? score - ranked[1].score : score;
  return { prospect, label, score, margin };
}

// Tune these to shift "Best Pick" behavior.
// Higher MARGIN_WEIGHT = prioritize positions with a runaway top prospect.
// Higher SCORE_WEIGHT  = prioritize raw talent regardless of positional depth.
const MARGIN_WEIGHT = 0.77; // Roughly 30% given that margins are smaller than scores
const SCORE_WEIGHT = 0.23; // Roughly 70%

/**
 * Best single pick across all open label slots for the given team.
 * Ranks candidates by a weighted blend of positional margin and raw score so
 * that elite players at deep positions aren't left on the board unreasonably long.
 */
export function bestOverall(
  team: Team,
  pool: DraftProspect[],
): EvalResult | null {
  let best: EvalResult | null = null;
  let bestValue = -1;
  for (const label of PLAYER_LABELS) {
    if (hasLabel(team, label)) continue;
    const result = bestInGroup(label, pool);
    if (!result) continue;
    const value = result.margin * MARGIN_WEIGHT + result.score * SCORE_WEIGHT;
    if (value > bestValue) {
      bestValue = value;
      best = result;
    }
  }
  return best;
}

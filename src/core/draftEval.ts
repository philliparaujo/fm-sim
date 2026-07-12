import { DraftProspect, hasLabel } from "./pool";
import { Attribute, getProximity, Ratings } from "./ratings";
import { DEFAULT_ROLE_WEIGHTS, DraftStrategy, RoleWeights, STRATEGIES } from "./draftStrategies";
import { Label, PLAYER_LABELS, Team } from "./types";
import { labelToRole } from "../utils/roster";

export type EvalResult = {
  prospect: DraftProspect;
  label: Label;
  /** Normalized weighted score in [0, 1]. */
  score: number;
  /**
   * Cascade urgency: weighted sum of consecutive score gaps across all prospects
   * at this position (gaps weighted with exponential decay). High urgency means
   * the pool drops off sharply — missing this pick hurts more than a gradual pool.
   */
  urgency: number;
};

/** Weighted average of a player's relevant attributes, normalized to [0, 1]. */
export function scoreProspect(
  prospect: { label: Label; ratings: Ratings },
  roleWeights?: Record<string, RoleWeights>,
): number {
  const role = labelToRole(prospect.label as Label);
  const weights = (roleWeights ?? DEFAULT_ROLE_WEIGHTS)[role] ?? {};
  let total = 0;
  let weightSum = 0;
  for (const [attr, w] of Object.entries(weights) as [Attribute, number][]) {
    total += getProximity(attr, prospect.ratings[attr] ?? 0) * w;
    weightSum += w;
  }
  return weightSum > 0 ? total / weightSum : 0;
}

/**
 * Cascade urgency for a sorted (descending) score array.
 *
 * Each consecutive gap (s[i] - s[i+1]) is weighted by DECAY^i so that the
 * 1→2 cliff matters most, the 2→3 cliff matters next, etc.
 *
 * This penalizes positions whose pool tanks after the top 1-2 picks, even when
 * the 1-2 margin itself is small (e.g. [0.80, 0.75, 0.20, 0.15, ...]).
 */
const URGENCY_DECAY = 0.7;

function cascadeUrgency(scores: number[]): number {
  if (scores.length === 0) return 0;
  if (scores.length === 1) return scores[0];
  let urgency = 0;
  let weight = 1.0;
  for (let i = 0; i < scores.length - 1; i++) {
    urgency += (scores[i] - scores[i + 1]) * weight;
    weight *= URGENCY_DECAY;
  }
  return urgency;
}

/**
 * Best prospect within a single position group, plus cascade urgency across
 * the full remaining pool at that position.
 */
export function bestInGroup(
  label: Label,
  pool: DraftProspect[],
  strategy?: DraftStrategy,
): EvalResult | null {
  const roleWeights = strategy?.roleWeights;
  const ranked = pool
    .filter((p) => p.label === label)
    .map((p) => ({ prospect: p, score: scoreProspect(p, roleWeights) }))
    .sort((a, b) => b.score - a.score);

  if (ranked.length === 0) return null;

  const { prospect, score } = ranked[0];
  const urgency = cascadeUrgency(ranked.map((r) => r.score));
  return { prospect, label, score, urgency };
}

/**
 * Best single pick across all open label slots for the given team.
 *
 * Uses the strategy's score/urgency weights to rank candidates. `urgency`
 * reflects full pool depth, not just the 1–2 gap, so positions with a strong
 * #1 but a weak #2-8 rank higher than positions with two good options remaining.
 */
export function bestOverall(
  team: Team,
  pool: DraftProspect[],
  strategy: DraftStrategy = STRATEGIES.balanced,
): EvalResult | null {
  let best: EvalResult | null = null;
  let bestValue = -1;

  for (const label of PLAYER_LABELS) {
    if (hasLabel(team, label)) continue;
    const result = bestInGroup(label, pool, strategy);
    if (!result) continue;

    const posBonus = strategy.positionBonus?.[label] ?? 0;
    const value =
      result.urgency * strategy.urgencyWeight +
      result.score * strategy.scoreWeight +
      posBonus;

    if (value > bestValue) {
      bestValue = value;
      best = result;
    }
  }

  return best;
}

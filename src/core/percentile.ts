import { scoreProspect } from "./draftEval";
import { randomProspectRatings } from "./pool";
import { FINAL_WEEK } from "./schedule";
import { projectAutoTrainWeek } from "./training";
import { Label, PLAYER_LABELS, RosterPlayer } from "./types";

// ── Position overall percentiles ─────────────────────────────────────────────
//
// A player's overall percentile is where their overall falls within the
// distribution of ALL POSSIBLE players at their position — never a comparison
// against the other teams in the league. Because each position's default
// ratings and per-attribute spreads are fixed (see core/pool.ts), that
// distribution is fully determined and can be sampled once via Monte Carlo.
//
// Percentiles are position-normalized, so a 70th-percentile QB and a
// 70th-percentile CB are each "better than 70% of possible players at their
// own spot" — and, crucially, they never zero-sum against each other: a strong
// draft class can leave all eight teams above the 50th percentile.
//
// Aggregate (role / side / team) percentiles are NOT the mean of their members'
// percentiles. A group's overall is an AVERAGE of several players, and the
// average of k roughly-independent draws is far less variable than a single
// draw (its spread shrinks by ~√k). So a trio of catchers each individually at
// the 60th percentile is jointly a much rarer, better group than any single
// 60th-percentile catcher — the trio lands well above the 60th percentile of
// possible trios. We capture this exactly by percentiling a group's mean
// overall against the distribution of the SAME-composition synthetic groups'
// mean overalls (see groupOverallPercentile), which both matches the intuition
// and gives role/side/team ratings a realistically wider spread than raw
// per-player percentiles would.
//
// Training shifts the benchmark. Every player develops each week, so the whole
// population's overall distribution drifts upward (and compresses, since low
// overalls gain fastest). We therefore advance the same synthetic population
// week by week through the real CPU auto-training policy (projectAutoTrainWeek)
// and record overalls at each week, so a player's percentile is read against
// the population at the number of training weeks elapsed — measuring their own
// progression fairly against everyone else's.

/** Synthetic teams sampled to build the distributions. Each team contributes
 * one player per label, so this is the per-position sample size at every week,
 * and also the number of synthetic groups any aggregate is measured against. */
const SAMPLE_TEAMS = 400;

/** Distributions are precomputed for weeks 0 (draft day, untrained) through
 * FINAL_WEEK, matching the range training can actually advance a season. */
const MAX_WEEK = FINAL_WEEK;

/** raw[week][label] = overalls (0–100) of every synthetic team's player at that
 * label, kept in a fixed team-aligned order (index = synthetic team) so a
 * group aggregate can be formed by averaging across labels at the same index.
 * Built once, lazily; the distribution depends only on fixed
 * defaults/spreads/training math, so it never needs invalidating. */
let raw: Record<string, number[]>[] | null = null;

/** Cache of sorted group mean-overall distributions, keyed by
 * `week|sortedLabels`. Group compositions recur heavily (every team's catcher
 * group is {XR,ZR,TE}, etc.), so this is computed once per (week, composition)
 * and reused across teams. */
const groupCache = new Map<string, number[]>();

function buildSyntheticTeams(): RosterPlayer[][] {
  const teams: RosterPlayer[][] = [];
  for (let t = 0; t < SAMPLE_TEAMS; t++) {
    teams.push(
      PLAYER_LABELS.map((label) => ({
        color: "synthetic",
        label,
        name: "",
        ratings: randomProspectRatings(label),
      })),
    );
  }
  return teams;
}

function build(): void {
  const teams = buildSyntheticTeams();
  const byWeek: Record<string, number[]>[] = [];

  for (let week = 0; week <= MAX_WEEK; week++) {
    const byLabel: Record<string, number[]> = {};
    for (const label of PLAYER_LABELS) byLabel[label] = [];
    for (const roster of teams) {
      for (const rp of roster) byLabel[rp.label].push(scoreProspect(rp) * 100);
    }
    byWeek.push(byLabel);
    // Advance the population one week for the next iteration (skip after the
    // last recorded week — nothing reads past it).
    if (week < MAX_WEEK) {
      for (const roster of teams) projectAutoTrainWeek(roster);
    }
  }
  raw = byWeek;
}

function clampWeek(week: number): number {
  return Math.max(0, Math.min(MAX_WEEK, Math.round(week)));
}

/** Ascending-sorted distribution of the mean overall over `labels`, one sample
 * per synthetic team, at `week`. Cached by composition. */
function groupDistribution(labels: Label[], week: number): number[] {
  const w = clampWeek(week);
  const key = `${w}|${[...labels].sort().join(",")}`;
  const cached = groupCache.get(key);
  if (cached) return cached;

  const byLabel = raw![w];
  const cols = labels.map((l) => byLabel[l]).filter((c): c is number[] => !!c);
  const means: number[] = [];
  if (cols.length > 0) {
    for (let i = 0; i < SAMPLE_TEAMS; i++) {
      let sum = 0;
      for (const col of cols) sum += col[i];
      means.push(sum / cols.length);
    }
    means.sort((a, b) => a - b);
  }
  groupCache.set(key, means);
  return means;
}

/** Index of the first element ≥ target (lower bound) in an ascending array. */
function lowerBound(arr: number[], target: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Index of the first element > target (upper bound) in an ascending array. */
function upperBound(arr: number[], target: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] <= target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Percentile (0–100) of `value` within an ascending distribution, ties at
 * half credit so the population median maps near 50. */
function cdfPercentile(sorted: number[], value: number): number {
  if (sorted.length === 0) return 0;
  const below = lowerBound(sorted, value);
  const atOrBelow = upperBound(sorted, value);
  return ((below + atOrBelow) / 2 / sorted.length) * 100;
}

/**
 * Percentile (0–100) of a single player's `overall` for a position at `week`
 * elapsed training weeks, against the generative population (never the actual
 * league).
 */
export function overallPercentile(
  label: Label,
  overall: number,
  week = 0,
): number {
  if (!raw) build();
  return cdfPercentile(groupDistribution([label], week), overall);
}

/**
 * Percentile (0–100) of a group's `meanOverall` (its displayed average OVR)
 * against the distribution of same-composition synthetic groups' mean overalls
 * at `week`. `labels` are the positions actually present in the group, so a
 * partially-drafted group is still compared against groups of the same makeup.
 * This is the correct aggregate: it rewards depth (a whole group above average
 * is rarer, and ranks higher, than any one member being above average).
 */
export function groupOverallPercentile(
  labels: Label[],
  meanOverall: number,
  week = 0,
): number {
  if (!raw) build();
  if (labels.length === 0) return 0;
  return cdfPercentile(groupDistribution(labels, week), meanOverall);
}

import { draftPool } from "../core/draft";
import { scoreProspect } from "../core/draftEval";
import { groupOverallPercentile, overallPercentile } from "../core/percentile";
import { getCurrentWeek, isSeasonGenerated } from "../core/schedule";
import { LEAGUE } from "../core/state";
import { Label, RosterPlayer, Team } from "../core/types";
import { labelToRole, labelToSide } from "../utils/roster";

/** Which OVR metrics are shown everywhere, independently toggle-able (all
 * three can be on at once). Fixed display order: rating, rank, percentile. */
export type OvrDisplayKey = "rating" | "rank" | "percentile";
const DISPLAY_ORDER: OvrDisplayKey[] = ["rating", "rank", "percentile"];
const displayFlags: Record<OvrDisplayKey, boolean> = {
  rating: true,
  rank: false,
  percentile: false,
};

/** Current checked/unchecked state of all three metrics. */
export function getOvrDisplayFlags(): Record<OvrDisplayKey, boolean> {
  return { ...displayFlags };
}

/** Sets whether a metric is shown. Refuses to leave all three unchecked — at
 * least one metric must always be visible — and returns false if refused, so
 * the caller (a checkbox) can snap its own state back. */
export function setOvrDisplayFlag(key: OvrDisplayKey, value: boolean): boolean {
  if (!value && DISPLAY_ORDER.every((k) => k === key || !displayFlags[k])) {
    return false;
  }
  displayFlags[key] = value;
  return true;
}

/** How many values in `all` are strictly greater than `score` — gives 1-based rank. */
function rankIn(score: number, all: number[]): number {
  return all.filter((s) => s > score).length + 1;
}

/** Formats a rank number with medal styling markers for 1–3. */
export function formatRank(rank: number): string {
  if (rank === 1) return `<span class="rank-medal rank-gold">#1</span>`;
  if (rank === 2) return `<span class="rank-medal rank-silver">#2</span>`;
  if (rank === 3) return `<span class="rank-medal rank-bronze">#3</span>`;
  return `#${rank}`;
}

/** Formats a 0–100 percentile with a muted "%ile" suffix and a red→green tint
 * scaled to the value (higher = better than more of the position's field). */
export function formatPercentile(pct: number): string {
  const v = Math.round(pct);
  const hue = Math.round(v * 1.3); // 0 → red, 100 → green
  return (
    `<span class="ovr-pct" style="color:hsl(${hue},70%,60%)">${v}` +
    `<span class="ovr-pct-suffix">%ile</span></span>`
  );
}

/** Elapsed training weeks that a player's overall reflects, for choosing which
 * week's position distribution to measure percentile against. 0 on draft day
 * (before the season is generated); afterwards, the weeks already simmed (and
 * thus auto-trained) before the current one. */
function displayWeek(): number {
  if (!isSeasonGenerated()) return 0;
  return Math.max(0, getCurrentWeek() - 1);
}

/**
 * Renders an OVR value from whichever metrics are checked, in fixed order
 * (rating, rank, percentile). The first checked metric is shown bare; every
 * checked metric after it is appended in parentheses. `rank`/`pct` are
 * computed lazily so callers that only need the rating (the common case)
 * don't pay for the ranking or percentile pass.
 */
function formatOvr(
  ratingStr: string,
  rank: () => number,
  pct?: () => number,
): string {
  const parts: string[] = [];
  if (displayFlags.rating) parts.push(ratingStr);
  if (displayFlags.rank) parts.push(formatRank(rank()));
  if (displayFlags.percentile && pct) parts.push(formatPercentile(pct()));
  if (parts.length === 0) return ratingStr; // shouldn't happen; last-one guard prevents this
  return parts.map((p, i) => (i === 0 ? p : `(${p})`)).join(" ");
}

/** Percentile of a group's average overall (role/side/team) against the
 * distribution of same-composition synthetic groups — NOT the mean of the
 * members' individual percentiles. Averaging percentiles would wrongly ignore
 * that a whole group being above average is far rarer (and so ranks higher)
 * than any single member being above average; percentiling the group's mean
 * overall against like groups captures that depth. Still never compares one
 * team to another — the benchmark is the expected distribution of groups. */
function groupPercentile(players: RosterPlayer[]): number {
  if (players.length === 0) return 0;
  const labels = players.map((rp) => rp.label as Label);
  const meanOverall =
    players.reduce((s, rp) => s + scoreProspect(rp) * 100, 0) / players.length;
  return groupOverallPercentile(labels, meanOverall, displayWeek());
}

/** All players of a given label across pool + every team's roster. */
function allOfLabel(label: Label): { label: Label; ratings: RosterPlayer["ratings"] }[] {
  return [
    ...draftPool.filter((p) => p.label === label),
    ...LEAGUE.flatMap((t) => t.roster.filter((r) => r.label === label)),
  ];
}

/** "62.3", "#5", or "62.3 (#5)" — rank is among all players at that label. */
export function playerOvrDisplay(rp: { label: Label; ratings: RosterPlayer["ratings"] }): string {
  const score = scoreProspect(rp);
  return formatOvr(
    (score * 100).toFixed(1),
    () => {
      const allScores = allOfLabel(rp.label as Label).map((p) => scoreProspect(p));
      return rankIn(score, allScores);
    },
    () => overallPercentile(rp.label as Label, score * 100, displayWeek()),
  );
}

/** "58.3", "#2", or "58.3 (#2)" — rank is among all drafted teams. */
export function teamOvrDisplay(team: Team): string {
  if (team.roster.length === 0) return "—";
  const avg = team.roster.reduce((s, rp) => s + scoreProspect(rp), 0) / team.roster.length;
  return formatOvr(
    (avg * 100).toFixed(1),
    () => {
      const allAvgs = LEAGUE
        .filter((t) => t.roster.length > 0)
        .map((t) => t.roster.reduce((s, rp) => s + scoreProspect(rp), 0) / t.roster.length);
      return rankIn(avg, allAvgs);
    },
    () => groupPercentile(team.roster),
  );
}

/** Computes role avg in 0–100 for a team, or null if no players at that role. */
function teamRoleAvg(team: Team, role: string): number | null {
  const players = team.roster.filter((rp) => labelToRole(rp.label) === role);
  if (players.length === 0) return null;
  return (players.reduce((s, rp) => s + scoreProspect(rp), 0) / players.length) * 100;
}

/**
 * "46.2" in rating mode; "#3" in rankings mode (rank among teams that have
 * any players in that role). Accepts the team so avg is computed identically
 * for both the subject and all comparators, avoiding floating-point drift.
 */
export function roleOvrDisplay(team: Team, role: string): string {
  const avg = teamRoleAvg(team, role);
  if (avg === null) return "—";
  return formatOvr(
    avg.toFixed(1),
    () => {
      const allAvgs = LEAGUE.map((t) => teamRoleAvg(t, role)).filter((a): a is number => a !== null);
      return rankIn(avg, allAvgs);
    },
    () => groupPercentile(team.roster.filter((rp) => labelToRole(rp.label) === role)),
  );
}

/** Computes offense or defense avg OVR (0–100) for a team, or null if none drafted. */
function teamSideAvg(team: Team, side: "offense" | "defense"): number | null {
  const players = team.roster.filter((rp) => labelToSide(rp.label) === side);
  if (players.length === 0) return null;
  return (players.reduce((s, rp) => s + scoreProspect(rp), 0) / players.length) * 100;
}

/** "58.3" in rating mode; "#2" in rankings mode, for the team's offense or defense group. */
export function sideOvrDisplay(team: Team, side: "offense" | "defense"): string {
  const avg = teamSideAvg(team, side);
  if (avg === null) return "—";
  return formatOvr(
    avg.toFixed(1),
    () => {
      const allAvgs = LEAGUE.map((t) => teamSideAvg(t, side)).filter((a): a is number => a !== null);
      return rankIn(avg, allAvgs);
    },
    () => groupPercentile(team.roster.filter((rp) => labelToSide(rp.label) === side)),
  );
}

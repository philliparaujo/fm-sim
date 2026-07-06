import { draftPool } from "../core/draft";
import { scoreProspect } from "../core/draftEval";
import { LEAGUE } from "../core/state";
import { Label, RosterPlayer, Team } from "../core/types";
import { labelToRole } from "../utils/roster";

export let rankingsMode = false;
export function setRankingsMode(v: boolean) { rankingsMode = v; }

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

/** All players of a given label across pool + every team's roster. */
function allOfLabel(label: Label): { label: Label; ratings: RosterPlayer["ratings"] }[] {
  return [
    ...draftPool.filter((p) => p.label === label),
    ...LEAGUE.flatMap((t) => t.roster.filter((r) => r.label === label)),
  ];
}

/** "62.3" in rating mode; "#5" in rankings mode (rank among all players at that label). */
export function playerOvrDisplay(rp: { label: Label; ratings: RosterPlayer["ratings"] }): string {
  const score = scoreProspect(rp);
  if (!rankingsMode) return (score * 100).toFixed(1);
  const allScores = allOfLabel(rp.label as Label).map((p) => scoreProspect(p));
  return formatRank(rankIn(score, allScores));
}

/** "58.3" in rating mode; "#2" in rankings mode (rank among all drafted teams). */
export function teamOvrDisplay(team: Team): string {
  if (team.roster.length === 0) return "—";
  const avg = team.roster.reduce((s, rp) => s + scoreProspect(rp), 0) / team.roster.length;
  if (!rankingsMode) return (avg * 100).toFixed(1);
  const allAvgs = LEAGUE
    .filter((t) => t.roster.length > 0)
    .map((t) => t.roster.reduce((s, rp) => s + scoreProspect(rp), 0) / t.roster.length);
  return formatRank(rankIn(avg, allAvgs));
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
  if (!rankingsMode) return avg.toFixed(1);
  const allAvgs = LEAGUE.map((t) => teamRoleAvg(t, role)).filter((a): a is number => a !== null);
  return formatRank(rankIn(avg, allAvgs));
}

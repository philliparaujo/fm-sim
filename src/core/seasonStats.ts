import { Label, PlayerStats, PlayerStatsByLabel } from "./types";

/**
 * Season-long accumulation of individual player stats, keyed by team color then
 * roster label. Counting stats are summed across games; derived rates (cmp, ypa,
 * ypc) are recomputed from the running totals.
 */
const store: Record<string, PlayerStatsByLabel> = {};

/** Games played per team color. Every player on a team shares the team's total,
 * which can differ across teams once playoff games are added. */
const gamesByColor: Record<string, number> = {};

export function clearSeasonStats(): void {
  for (const k of Object.keys(store)) delete store[k];
  for (const k of Object.keys(gamesByColor)) delete gamesByColor[k];
}

export function getSeasonStats(): Record<string, PlayerStatsByLabel> {
  return store;
}

/** Games a team has played this season (0 if none recorded). */
export function getGamesPlayed(color: string): number {
  return gamesByColor[color] ?? 0;
}

/** True if any player has recorded a stat this season. */
export function hasSeasonStats(): boolean {
  return Object.keys(store).length > 0;
}

/** Folds one game's per-team, per-label stat lines into the season totals. */
export function addGamePlayerStats(
  byColor: Record<string, PlayerStatsByLabel>,
): void {
  for (const [color, players] of Object.entries(byColor)) {
    store[color] ??= {};
    gamesByColor[color] = (gamesByColor[color] ?? 0) + 1;
    for (const [label, line] of Object.entries(players)) {
      if (!line) continue;
      const dest = (store[color][label as Label] ??= {});
      mergePlayerStats(dest, line);
    }
  }
}

function mergePlayerStats(dest: PlayerStats, src: PlayerStats): void {
  if (src.passing) {
    const d = (dest.passing ??= {
      attempts: 0,
      completions: 0,
      yards: 0,
      ypa: 0,
      cmp: 0,
      tds: 0,
      ints: 0,
      sacks: 0,
    });
    d.attempts += src.passing.attempts;
    d.completions += src.passing.completions;
    d.yards += src.passing.yards;
    d.tds += src.passing.tds;
    d.ints += src.passing.ints;
    d.sacks += src.passing.sacks;
    d.cmp = d.attempts ? d.completions / d.attempts : 0;
    d.ypa = d.attempts ? d.yards / d.attempts : 0;
  }
  if (src.rushing) {
    const d = (dest.rushing ??= { rushes: 0, yards: 0, ypc: 0, tds: 0, tfls: 0 });
    d.rushes += src.rushing.rushes;
    d.yards += src.rushing.yards;
    d.tds += src.rushing.tds;
    d.tfls += src.rushing.tfls;
    d.ypc = d.rushes ? d.yards / d.rushes : 0;
  }
  if (src.receiving) {
    const d = (dest.receiving ??= { targets: 0, catches: 0, yards: 0, tds: 0 });
    d.targets += src.receiving.targets;
    d.catches += src.receiving.catches;
    d.yards += src.receiving.yards;
    d.tds += src.receiving.tds;
  }
  if (src.defense) {
    const d = (dest.defense ??= {
      tackles: 0,
      tfls: 0,
      sacks: 0,
      interceptions: 0,
      passBreakups: 0,
    });
    d.tackles += src.defense.tackles;
    d.tfls += src.defense.tfls;
    d.sacks += src.defense.sacks;
    d.interceptions += src.defense.interceptions;
    d.passBreakups += src.defense.passBreakups;
  }
}

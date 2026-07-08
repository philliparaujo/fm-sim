import { getDivisions, getGamesForWeek } from "./schedule";
import { Label, PlayerStats, PlayerStatsByLabel } from "./types";

export type Award = {
  divisionName: string;
  side: "offense" | "defense";
  color: string;
  label: Label;
  stats: PlayerStats;
  grade: number;
};

/**
 * Offensive performance grade, loosely modeled on fantasy scoring so passing,
 * rushing, and receiving production trade off realistically:
 *   pass  0.04/yd (~1 per 25), +4/TD, -2/INT, +0.1/comp, -0.5/sack taken
 *   rush  0.1/yd (~1 per 10), +6/TD
 *   recv  0.1/yd, +6/TD, +0.5/reception (PPR)
 */
export function passingGrade(s: PlayerStats): number {
  const p = s.passing;
  if (!p) return 0;
  return (
    p.yards * 0.04 +
    p.tds * 4 -
    p.ints * 3 +
    p.completions * 0.09 -
    p.attempts * 0.01 -
    p.sacks * 0.5
  );
}

export function rushingGrade(s: PlayerStats): number {
  const r = s.rushing;
  return r ? r.yards * 0.1 + r.tds * 6 : 0;
}

export function receivingGrade(s: PlayerStats): number {
  const r = s.receiving;
  return r ? r.yards * 0.1 + r.tds * 6 + r.catches * 0.5 : 0;
}

export function offensiveGrade(s: PlayerStats): number {
  return passingGrade(s) + rushingGrade(s) + receivingGrade(s);
}

/**
 * Defensive performance grade weighting splash plays over volume:
 *   +1/tackle, +2/TFL, +4/sack, +6/INT, +3/pass breakup
 */
export function defensiveGrade(s: PlayerStats): number {
  const d = s.defense;
  if (!d) return 0;
  return (
    d.tackles * 0.8 +
    d.tfls * 2 +
    d.sacks * 7 +
    d.interceptions * 7 +
    d.passBreakups * 0.7
  );
}

/**
 * MVP grade: total impact but heavily tilted toward quarterbacks, mirroring how
 * the real award almost always goes to a passer. Starts from overall offensive
 * plus a slice of defensive value, then adds a large passing bonus so a strong
 * QB outranks an equally productive back or receiver. OPOY, by contrast, uses
 * the flat `offensiveGrade`, so the most impressive raw stat line can win it.
 */
export function mvpGrade(s: PlayerStats): number {
  let g = offensiveGrade(s) + defensiveGrade(s) * 0.9;
  if (s.passing) g *= 1.5;
  return g;
}

/** True if the player recorded any offensive touch. */
export function hasOffense(s: PlayerStats): boolean {
  return !!(
    s.passing?.attempts ||
    s.rushing?.rushes ||
    s.receiving?.targets ||
    s.receiving?.catches
  );
}

/**
 * Per-division offensive & defensive players of the week, or null until every
 * game that week has been played. Works for regular-season and playoff weeks;
 * divisions with no teams playing that week simply contribute no awards.
 */
export function weeklyAwards(week: number): Award[] | null {
  const games = getGamesForWeek(week);
  if (games.length === 0 || !games.every((g) => g.played)) return null;

  // Each team plays at most once per week, so merging by color has no collisions.
  const weekStats: Record<string, PlayerStatsByLabel> = {};
  for (const g of games) {
    if (!g.playerStats) continue;
    for (const [color, players] of Object.entries(g.playerStats)) {
      weekStats[color] = players;
    }
  }

  const awards: Award[] = [];
  for (const div of getDivisions()) {
    let bestOff: Award | null = null;
    let bestDef: Award | null = null;

    for (const color of div.teamColors) {
      const players = weekStats[color];
      if (!players) continue;
      for (const [label, stats] of Object.entries(players)) {
        if (!stats) continue;

        if (hasOffense(stats)) {
          const grade = offensiveGrade(stats);
          if (!bestOff || grade > bestOff.grade) {
            bestOff = {
              divisionName: div.name,
              side: "offense",
              color,
              label: label as Label,
              stats,
              grade,
            };
          }
        }
        if (stats.defense) {
          const grade = defensiveGrade(stats);
          if (grade > 0 && (!bestDef || grade > bestDef.grade)) {
            bestDef = {
              divisionName: div.name,
              side: "defense",
              color,
              label: label as Label,
              stats,
              grade,
            };
          }
        }
      }
    }

    if (bestOff) awards.push(bestOff);
    if (bestDef) awards.push(bestDef);
  }

  return awards;
}

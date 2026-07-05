export type MatchupRecord = {
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
};

/** results[aColor][bColor] = a's record when playing against b */
const results: Record<string, Record<string, MatchupRecord>> = {};

export function getPts(rec: MatchupRecord) {
  const WIN_PTS = 3;
  const TIE_PTS = 1;
  const LOSE_PTS = 0;
  return WIN_PTS * rec.wins + TIE_PTS * rec.ties + LOSE_PTS * rec.losses;
}

function ensure(a: string, b: string) {
  results[a] ??= {};
  results[a][b] ??= {
    wins: 0,
    losses: 0,
    ties: 0,
    pointsFor: 0,
    pointsAgainst: 0,
  };
}

export function recordResult(
  aColor: string,
  bColor: string,
  aScore: number,
  bScore: number,
) {
  ensure(aColor, bColor);
  ensure(bColor, aColor);
  const ra = results[aColor][bColor];
  const rb = results[bColor][aColor];
  ra.pointsFor += aScore;
  ra.pointsAgainst += bScore;
  rb.pointsFor += bScore;
  rb.pointsAgainst += aScore;
  if (aScore > bScore) {
    ra.wins++;
    rb.losses++;
  } else if (bScore > aScore) {
    ra.losses++;
    rb.wins++;
  } else {
    ra.ties++;
    rb.ties++;
  }
}

export function getMatchup(
  aColor: string,
  bColor: string,
): MatchupRecord | null {
  return results[aColor]?.[bColor] ?? null;
}

/** Aggregate record across all opponents. */
export function getTeamRecord(teamColor: string): MatchupRecord {
  const out: MatchupRecord = {
    wins: 0,
    losses: 0,
    ties: 0,
    pointsFor: 0,
    pointsAgainst: 0,
  };
  for (const r of Object.values(results[teamColor] ?? {})) {
    out.wins += r.wins;
    out.losses += r.losses;
    out.ties += r.ties;
    out.pointsFor += r.pointsFor;
    out.pointsAgainst += r.pointsAgainst;
  }
  return out;
}

export function clearResults() {
  for (const k of Object.keys(results)) delete results[k];
}

import { LEAGUE } from "./state";
import { PlayerStatsByLabel, Team } from "./types";

/**
 * A single scheduled game. The home team starts the game with the ball (i.e. is
 * the "offense" team passed first into the simulator). Scores are only
 * meaningful once `played` is true.
 */
export type Game = {
  week: number;
  homeColor: string;
  awayColor: string;
  played: boolean;
  homeScore: number;
  awayScore: number;
  round: "regular" | "semifinal" | "final";
  /** Per-team, per-label box score, keyed by team color. Set when simulated. */
  playerStats?: Record<string, PlayerStatsByLabel>;
};

export type Division = { name: string; teamColors: string[] };

export type TeamRecord = {
  color: string;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
};

export const REG_SEASON_WEEKS = 10;
export const SEMIFINAL_WEEK = REG_SEASON_WEEKS + 1;
export const FINAL_WEEK = REG_SEASON_WEEKS + 2;

const DIVISION_NAMES = ["East", "West"];

let divisions: Division[] = [];
let games: Game[] = [];
let generated = false;

export function isSeasonGenerated(): boolean {
  return generated;
}
export function getDivisions(): Division[] {
  return divisions;
}
export function getGames(): Game[] {
  return games;
}

export function teamByColor(color: string): Team {
  return LEAGUE.find((t) => t.color === color)!;
}

export function divisionIndexOf(color: string): number {
  return divisions.findIndex((d) => d.teamColors.includes(color));
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Circle-method round robin. `colors.length` must be even. Returns an array of
 * rounds; each round is a set of disjoint pairs so every team plays exactly once
 * per round, and across all rounds every pair meets exactly once.
 */
function roundRobin(colors: string[]): [string, string][][] {
  const arr = [...colors];
  const n = arr.length;
  const rounds: [string, string][][] = [];
  for (let r = 0; r < n - 1; r++) {
    const pairs: [string, string][] = [];
    for (let i = 0; i < n / 2; i++) pairs.push([arr[i], arr[n - 1 - i]]);
    rounds.push(pairs);
    // Rotate all but the first element clockwise.
    const fixed = arr[0];
    const rest = arr.slice(1);
    rest.unshift(rest.pop()!);
    arr.splice(0, arr.length, fixed, ...rest);
  }
  return rounds;
}

/**
 * Randomly assigns 2 divisions of 4 and builds a 10-week schedule where each
 * team plays every division opponent twice and every cross-division opponent
 * once. Weeks 1–7 are a full single round robin (every pair once); weeks 8–10
 * are per-division round robins, giving division rivals their second meeting.
 */
export function generateSeason(): void {
  const colors = shuffle(LEAGUE.map((t) => t.color));
  divisions = [
    { name: DIVISION_NAMES[0], teamColors: colors.slice(0, 4) },
    { name: DIVISION_NAMES[1], teamColors: colors.slice(4, 8) },
  ];

  games = [];
  let homeFlip = false;
  const addGame = (week: number, a: string, b: string) => {
    // Alternate orientation so home/away stays roughly balanced.
    const [home, away] = homeFlip ? [b, a] : [a, b];
    homeFlip = !homeFlip;
    games.push({
      week,
      homeColor: home,
      awayColor: away,
      played: false,
      homeScore: 0,
      awayScore: 0,
      round: "regular",
    });
  };

  // Weeks 1–7: full round robin of all 8 teams (every pair meets once).
  const full = roundRobin(colors);
  full.forEach((round, i) => {
    for (const [a, b] of round) addGame(i + 1, a, b);
  });

  // Weeks 8–10: intra-division round robins (division rivals' second meeting).
  const rrA = roundRobin(divisions[0].teamColors);
  const rrB = roundRobin(divisions[1].teamColors);
  for (let r = 0; r < rrA.length; r++) {
    const week = full.length + 1 + r; // 8, 9, 10
    for (const [a, b] of rrA[r]) addGame(week, a, b);
    for (const [a, b] of rrB[r]) addGame(week, a, b);
  }

  generated = true;
}

/** Clears the entire season back to the ungenerated state. */
export function clearSeason(): void {
  divisions = [];
  games = [];
  generated = false;
}

export function getGamesForWeek(week: number): Game[] {
  return games.filter((g) => g.week === week);
}

export function maxWeek(): number {
  return games.reduce((m, g) => Math.max(m, g.week), 0);
}

export function regSeasonComplete(): boolean {
  const reg = games.filter((g) => g.round === "regular");
  return reg.length > 0 && reg.every((g) => g.played);
}

/** First week that still has an unplayed game, or FINAL_WEEK if the season is over. */
export function getCurrentWeek(): number {
  for (let w = 1; w <= FINAL_WEEK; w++) {
    const wg = getGamesForWeek(w);
    if (wg.length > 0 && wg.some((g) => !g.played)) return w;
  }
  return FINAL_WEEK;
}

/** Regular-season record for a team, aggregated across all played games. */
export function getRecord(color: string): TeamRecord {
  const rec: TeamRecord = {
    color,
    wins: 0,
    losses: 0,
    ties: 0,
    pointsFor: 0,
    pointsAgainst: 0,
  };
  for (const g of games) {
    if (g.round !== "regular" || !g.played) continue;
    let mine: number, theirs: number;
    if (g.homeColor === color) {
      mine = g.homeScore;
      theirs = g.awayScore;
    } else if (g.awayColor === color) {
      mine = g.awayScore;
      theirs = g.homeScore;
    } else continue;
    rec.pointsFor += mine;
    rec.pointsAgainst += theirs;
    if (mine > theirs) rec.wins++;
    else if (mine < theirs) rec.losses++;
    else rec.ties++;
  }
  return rec;
}

/** Sort comparator: win% (ties = half win), then point differential, then points for. */
export function compareRecords(a: TeamRecord, b: TeamRecord): number {
  const aw = a.wins + 0.5 * a.ties;
  const bw = b.wins + 0.5 * b.ties;
  if (bw !== aw) return bw - aw;
  const ad = a.pointsFor - a.pointsAgainst;
  const bd = b.pointsFor - b.pointsAgainst;
  if (bd !== ad) return bd - ad;
  return b.pointsFor - a.pointsFor;
}

export function getDivisionStandings(divIndex: number): TeamRecord[] {
  return divisions[divIndex].teamColors.map(getRecord).sort(compareRecords);
}

/**
 * The four playoff seeds once the regular season is complete: the two division
 * winners (seeded 1–2 by record), then the two best remaining records as
 * wildcards (seeded 3–4). Returns null while the regular season is unfinished.
 */
export function getSeeds(): TeamRecord[] | null {
  if (!regSeasonComplete()) return null;
  const winners = [getDivisionStandings(0)[0], getDivisionStandings(1)[0]].sort(
    compareRecords,
  );
  const winnerColors = new Set(winners.map((w) => w.color));
  const wild = LEAGUE.map((t) => getRecord(t.color))
    .filter((r) => !winnerColors.has(r.color))
    .sort(compareRecords)
    .slice(0, 2);
  return [winners[0], winners[1], wild[0], wild[1]];
}

/** The winner's color; on a tie the home team (higher seed) advances. */
export function winnerOf(g: Game): string {
  return g.homeScore >= g.awayScore ? g.homeColor : g.awayColor;
}

function mkPlayoff(
  week: number,
  home: string,
  away: string,
  round: Game["round"],
): Game {
  return {
    week,
    homeColor: home,
    awayColor: away,
    played: false,
    homeScore: 0,
    awayScore: 0,
    round,
  };
}

/**
 * Lazily builds the playoff bracket. Creates the two semifinals (1v4, 2v3) once
 * the regular season ends, and the final once both semifinals are played. Higher
 * seeds host. Safe to call repeatedly.
 */
export function advancePlayoffs(): void {
  if (!regSeasonComplete()) return;
  const seeds = getSeeds();
  if (!seeds) return;

  if (!games.some((g) => g.round === "semifinal")) {
    games.push(mkPlayoff(SEMIFINAL_WEEK, seeds[0].color, seeds[3].color, "semifinal"));
    games.push(mkPlayoff(SEMIFINAL_WEEK, seeds[1].color, seeds[2].color, "semifinal"));
    return;
  }

  const semis = games.filter((g) => g.round === "semifinal");
  if (semis.every((g) => g.played) && !games.some((g) => g.round === "final")) {
    const seedOrder = seeds.map((s) => s.color);
    const winners = semis
      .map(winnerOf)
      .sort((a, b) => seedOrder.indexOf(a) - seedOrder.indexOf(b));
    games.push(mkPlayoff(FINAL_WEEK, winners[0], winners[1], "final"));
  }
}

/** Records a game's final score and advances the playoff bracket if applicable. */
export function recordGame(game: Game, homeScore: number, awayScore: number): void {
  game.homeScore = homeScore;
  game.awayScore = awayScore;
  game.played = true;
  advancePlayoffs();
}

/** The champion's color once the final has been played, else null. */
export function getChampion(): string | null {
  const final = games.find((g) => g.round === "final");
  return final && final.played ? winnerOf(final) : null;
}

/** The seed number (1–4) for a color once the bracket is set, else null. */
export function seedOf(color: string): number | null {
  const seeds = getSeeds();
  if (!seeds) return null;
  const idx = seeds.findIndex((s) => s.color === color);
  return idx < 0 ? null : idx + 1;
}

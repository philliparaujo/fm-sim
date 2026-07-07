import { generatePlayerName } from "./names";
import { getDefaultRatingForLabel, Ratings } from "./ratings";
import { LEAGUE } from "./state";
import { Label, PLAYER_LABELS, Team } from "./types";

/** An undrafted player. Gets a team color assigned when drafted. */
export type DraftProspect = {
  id: number;
  label: Label;
  name: string;
  ratings: Ratings;
  starred?: boolean;
};

/** Number of available prospects per position label in the draft pool.
 *  Set higher than the number of teams (8) to create undrafted competition. */
export const PROSPECTS_PER_LABEL = 8;

// Gaussian random via Box-Muller — bell curve centered on 0 with std dev 1
function gaussianRandom(): number {
  let u = 0,
    v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Per-attribute standard deviation (in 0–1 rating space).
// Physical/body attributes cluster tightly; technique/skill attrs spread wider.
const ATTR_SPREAD: Partial<Record<keyof Ratings, number>> = {
  // Body — low variation within a position archetype
  SIZE: 0.04,
  SPEED: 0.09,
  // Mixed physical/technique
  THROWPOWER: 0.13,
  CATCHACCELERATION: 0.11,
  TACKLING: 0.11,
  PURSUIT: 0.11,
  POWER: 0.16,
  BEND: 0.15,
  // Pure technique — highest variation
  VISION: 0.2,
  POCKETPRESENCE: 0.18,
  DECISIONMAKING: 0.2,
  SHORTACCURACY: 0.18,
  DEEPACCURACY: 0.2,
  ROUTERUNNING: 0.17,
  CATCHRADIUS: 0.14,
  PASSBLOCK: 0.17,
  RUNBLOCK: 0.17,
  BLOCKSHEDDING: 0.17,
  MANCOVERAGE: 0.18,
  ZONECOVERAGE: 0.18,
};

function randomizeRatings(base: Ratings): Ratings {
  const result = { ...base };
  for (const key of Object.keys(result) as Array<keyof Ratings>) {
    const sigma = ATTR_SPREAD[key] ?? 0.15;
    result[key] = Math.max(
      0,
      Math.min(1, base[key] + gaussianRandom() * sigma),
    );
  }
  return result;
}

/** Builds the full draft pool: PROSPECTS_PER_LABEL players for each label, with
 * distinct names within a label. Each prospect gets randomized ratings centered
 * on the position default. */
function generatePool(): DraftProspect[] {
  const pool: DraftProspect[] = [];
  let id = 0;

  for (const label of PLAYER_LABELS) {
    const usedNames = new Set<string>();
    const baseRatings = getDefaultRatingForLabel(label);

    for (let i = 0; i < PROSPECTS_PER_LABEL; i++) {
      let name = generatePlayerName(label);
      while (usedNames.has(name)) name = generatePlayerName(label);
      usedNames.add(name);
      pool.push({
        id: id++,
        label,
        name,
        ratings: randomizeRatings(baseRatings),
      });
    }
  }

  return pool;
}

/** The remaining undrafted players. Shrinks as picks are made. */
export const draftPool: DraftProspect[] = generatePool();

/** True if the team already rostered a player at this label. */
export function hasLabel(team: Team, label: Label): boolean {
  return team.roster.some((rp) => rp.label === label);
}

/**
 * Drafts a pool prospect onto a team. Succeeds only if that team's label slot
 * is still open; on success the prospect leaves the pool and returns true.
 */
export function draftPlayer(teamColor: string, prospectId: number): boolean {
  const team = LEAGUE.find((t) => t.color === teamColor);
  const idx = draftPool.findIndex((p) => p.id === prospectId);
  if (!team || idx < 0) return false;

  const prospect = draftPool[idx];
  if (hasLabel(team, prospect.label)) return false; // slot already filled

  team.roster.push({
    color: team.color,
    label: prospect.label,
    name: prospect.name,
    ratings: prospect.ratings,
    starred: prospect.starred,
  });
  draftPool.splice(idx, 1);
  return true;
}

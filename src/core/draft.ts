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

// One prospect per team, per label -> the pool exactly fills every roster
const PROSPECTS_PER_LABEL = 8;

const RATING_SPREAD = 0.2;

function randomizeRatings(base: Ratings): Ratings {
  const result = { ...base };
  for (const key of Object.keys(result) as Array<keyof Ratings>) {
    const delta = (Math.random() * 2 - 1) * RATING_SPREAD;
    result[key] = Math.max(0, Math.min(1, base[key] + delta));
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
      pool.push({ id: id++, label, name, ratings: randomizeRatings(baseRatings) });
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

import { generatePlayerName } from "./names";
import { getDefaultRatingForLabel, Ratings } from "./ratings";
import { Label, PLAYER_LABELS, RosterPlayer } from "./types";

export type DraftProspect = {
  id: number;
  label: Label;
  name: string;
  ratings: Ratings;
  starred?: boolean;
};

export const PROSPECTS_PER_LABEL = 8;

// Per-attribute standard deviation (in 0–1 rating space).
// Physical/body attributes cluster tightly; technique/skill attrs spread wider.
export const ATTR_SPREAD: Partial<Record<keyof Ratings, number>> = {
  SIZE: 0.035,
  SPEED: 0.075,
  THROWPOWER: 0.13,
  CATCHACCELERATION: 0.11,
  TACKLING: 0.09,
  PURSUIT: 0.13,
  POWER: 0.16,
  BEND: 0.15,
  VISION: 0.22,
  POCKETPRESENCE: 0.18,
  DECISIONMAKING: 0.2,
  SHORTACCURACY: 0.18,
  DEEPACCURACY: 0.2,
  ROUTERUNNING: 0.17,
  CATCHRADIUS: 0.12,
  PASSBLOCK: 0.17,
  RUNBLOCK: 0.17,
  BLOCKSHEDDING: 0.17,
  MANCOVERAGE: 0.18,
  ZONECOVERAGE: 0.18,
};

// Gaussian random via Box-Muller — bell curve centered on 0 with std dev 1
function gaussianRandom(): number {
  let u = 0,
    v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function randomizeRatings(base: Ratings): Ratings {
  const result = { ...base };
  for (const key of Object.keys(result) as Array<keyof Ratings>) {
    const sigma = ATTR_SPREAD[key] ?? 0.15;
    result[key] = Math.max(0, Math.min(1, base[key] + gaussianRandom() * sigma));
  }
  return result;
}

/** A single random rating vector for a position, drawn from that label's
 * fixed defaults + per-attribute spread — the same generative distribution the
 * draft pool is sampled from. Used by the percentile model to build a
 * synthetic population per position. */
export function randomProspectRatings(label: Label): Ratings {
  return randomizeRatings(getDefaultRatingForLabel(label));
}

/** Generates a fresh pool of PROSPECTS_PER_LABEL prospects per position. */
export function generatePool(): DraftProspect[] {
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

/** True if the team already rostered a player at this label. */
export function hasLabel(team: { roster: RosterPlayer[] }, label: Label): boolean {
  return team.roster.some((rp) => rp.label === label);
}

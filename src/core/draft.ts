import { DraftProspect, generatePool, hasLabel } from "./pool";
import { LEAGUE } from "./state";
import { Label } from "./types";

export type { DraftProspect } from "./pool";
export { hasLabel, PROSPECTS_PER_LABEL } from "./pool";

/** The remaining undrafted players. Shrinks as picks are made. */
export const draftPool: DraftProspect[] = generatePool();

/** Monotonic counter stamped onto each pick so draft order can be recovered. */
let pickCounter = 0;

/** The most recent `n` picks across the whole league, newest first. */
export function getRecentPicks(
  n: number,
): { color: string; name: string; label: Label }[] {
  return LEAGUE.flatMap((t) =>
    t.roster.map((rp) => ({
      color: t.color,
      name: rp.name,
      label: rp.label,
      pickOrder: rp.pickOrder ?? 0,
    })),
  )
    .sort((a, b) => b.pickOrder - a.pickOrder)
    .slice(0, n);
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
  if (hasLabel(team, prospect.label)) return false;

  team.roster.push({
    color: team.color,
    label: prospect.label,
    name: prospect.name,
    ratings: prospect.ratings,
    starred: prospect.starred,
    pickOrder: ++pickCounter,
  });
  draftPool.splice(idx, 1);
  return true;
}

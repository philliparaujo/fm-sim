/** Static definition of a league team. `color` is a valid CSS color and is used
 * directly for rendering the team's players, scoreboard accents, etc. */
export type TeamDef = { color: string; name: string };

/** The league. For now every team drafts the same default roster; only the
 * color/name distinguish them. Add/remove entries here to resize the league. */
export const LEAGUE_TEAMS: TeamDef[] = [
  { color: "#BB0000", name: "RED" },
  { color: "#4444FF", name: "BLU" },
  { color: "#DD6600", name: "ORG" },
  { color: "#B59410", name: "GLD" },
  { color: "#006600", name: "GRN" },
  { color: "#00ABAB", name: "CYN" },
  { color: "#663388", name: "PRP" },
  { color: "#DD66AA", name: "PNK" },
];

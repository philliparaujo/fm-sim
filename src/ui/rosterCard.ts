import { scoreProspect } from "../core/draftEval";
import { PLAYER_LABELS, RosterPlayer, Team } from "../core/types";
import { labelToRole } from "../utils/roster";
import { playerOvrDisplay, roleOvrDisplay, teamOvrDisplay } from "./displayMode";

const ROLE_ORDER = ["passer", "runner", "catcher", "blocker", "rusher", "coverer"] as const;

export type RosterCardOptions = {
  /** Extra HTML injected into the header after the OVR. */
  headerSuffix?: string;
  /** Buttons to append after the role breakdown and before the player slots. */
  actionButtons?: HTMLElement[];
};

/** Computes per-role average OVR (0–100) for a roster. */
export function roleBreakdown(roster: RosterPlayer[]): Map<string, number> {
  const map = new Map<string, number[]>();
  for (const rp of roster) {
    const role = labelToRole(rp.label);
    if (!map.has(role)) map.set(role, []);
    map.get(role)!.push(scoreProspect(rp) * 100);
  }
  const out = new Map<string, number>();
  for (const role of ROLE_ORDER) {
    const scores = map.get(role);
    if (scores) out.set(role, scores.reduce((a, b) => a + b, 0) / scores.length);
  }
  return out;
}

/**
 * Builds a fixed-width roster card element showing:
 *   - Header: team name + OVR avg + optional suffix (e.g. possession badge)
 *   - Role breakdown row
 *   - All 16 label slots with player name and score
 *
 * The caller may append action buttons via `options.actionButtons`.
 */
export function buildRosterCard(team: Team, options: RosterCardOptions = {}): HTMLDivElement {
  const card = document.createElement("div");
  card.className = "draft-roster";

  // ── Header ──
  const header = document.createElement("div");
  header.className = "draft-roster-header";
  header.style.color = team.color;
  header.innerHTML =
    `${team.name} <span class="roster-card-count">(${team.roster.length}/${PLAYER_LABELS.length})</span>` +
    ` · <span class="roster-card-ovr">OVR ${teamOvrDisplay(team)}</span>` +
    (options.headerSuffix ?? "");
  card.appendChild(header);

  // ── Role breakdown ──
  const breakdown = document.createElement("div");
  breakdown.className = "roster-card-breakdown";
  const roles = roleBreakdown(team.roster);
  if (roles.size > 0) {
    breakdown.innerHTML = ROLE_ORDER.filter((r) => roles.has(r))
      .map((r) => `<span class="roster-card-role-chip"><span class="roster-card-role-name">${r}</span><span class="roster-card-role-ovr">${roleOvrDisplay(team, r)}</span></span>`)
      .join("");
  }
  card.appendChild(breakdown);

  // ── Action buttons ──
  for (const btn of options.actionButtons ?? []) {
    card.appendChild(btn);
  }

  // ── Player slots ──
  for (const label of PLAYER_LABELS) {
    const rp = team.roster.find((r) => r.label === label);
    const slot = document.createElement("div");
    slot.className = "draft-roster-slot";
    const nameClass = rp?.starred ? "draft-slot-name draft-starred-name" : "draft-slot-name";
    const nameText = rp ? `${rp.name} (${playerOvrDisplay(rp)})` : "—";
    slot.innerHTML = `<span class="draft-slot-label">${label}</span><span class="${nameClass}">${nameText}</span>`;
    card.appendChild(slot);
  }

  return card;
}

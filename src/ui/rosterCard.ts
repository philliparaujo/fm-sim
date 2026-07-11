import { Attribute, getLetterGrade, getProximity } from "../core/ratings";
import { scoreProspect } from "../core/draftEval";
import { Label, PLAYER_LABELS, RosterPlayer, Team } from "../core/types";
import { labelToRole } from "../utils/roster";
import { ATTR_SHORT_LABELS, ROLE_ATTRIBUTES } from "./playerAttrs";
import { playerOvrDisplay, roleOvrDisplay, sideOvrDisplay, teamOvrDisplay } from "./displayMode";

const ROLE_ORDER = ["passer", "runner", "catcher", "blocker", "rusher", "coverer"] as const;

export type RosterCardOptions = {
  /** Extra HTML injected into the header after the OVR. */
  headerSuffix?: string;
  /** Buttons to append after the role breakdown and before the player slots. */
  actionButtons?: HTMLElement[];
  /** Sort order for the player slot list. Default: position order (PLAYER_LABELS). */
  slotSort?: "pos" | "ovr" | "draft";
  /** If provided, empty slots show a "See prospects" button that calls this with the slot's label. */
  onSeeProspects?: (label: Label) => void;
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

/** Returns up to `count` role-relevant attributes sorted by proximity (highest first). */
function topAttrs(rp: RosterPlayer, count = 3): { attr: Attribute; grade: string; color: string }[] {
  const role = labelToRole(rp.label);
  const attrs = (ROLE_ATTRIBUTES[role] ?? []) as Attribute[];
  return attrs
    .map((attr) => {
      const ratingPct = Math.round((rp.ratings[attr] ?? 0) * 100);
      return {
        attr,
        proximity: getProximity(attr, rp.ratings[attr] ?? 0),
        ...getLetterGrade(attr, ratingPct),
      };
    })
    .sort((a, b) => b.proximity - a.proximity)
    .slice(0, count);
}

/**
 * Builds a fixed-width roster card element showing:
 *   - Header: team name + OVR avg + optional suffix
 *   - Role breakdown row
 *   - All 16 label slots, each with a two-row layout:
 *       Row 1: label · name · OVR
 *       Row 2: top-3 attribute grade chips (or "See prospects" button if empty)
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

  // ── Side (OFF/DEF) row ──
  if (team.roster.length > 0) {
    const sideRow = document.createElement("div");
    sideRow.className = "roster-card-side-row";
    sideRow.innerHTML =
      `<span class="roster-card-side-chip"><span class="roster-card-role-name">OFF</span><span class="roster-card-role-ovr">${sideOvrDisplay(team, "offense")}</span></span>` +
      `<span class="roster-card-side-chip"><span class="roster-card-role-name">DEF</span><span class="roster-card-role-ovr">${sideOvrDisplay(team, "defense")}</span></span>`;
    card.appendChild(sideRow);
  }

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
  const lastPick = team.roster.reduce<RosterPlayer | null>(
    (best, rp) => ((rp.pickOrder ?? 0) > (best?.pickOrder ?? -1) ? rp : best),
    null,
  );

  type Slot = { label: Label; rp: RosterPlayer | undefined };
  const allSlots: Slot[] = PLAYER_LABELS.map((l) => ({ label: l, rp: team.roster.find((r) => r.label === l) }));
  let slots: Slot[];
  if (options.slotSort === "ovr") {
    const drafted = allSlots.filter((s) => !!s.rp).sort((a, b) => scoreProspect(b.rp!) - scoreProspect(a.rp!));
    slots = [...drafted, ...allSlots.filter((s) => !s.rp)];
  } else if (options.slotSort === "draft") {
    const drafted = allSlots.filter((s) => !!s.rp).sort((a, b) => (a.rp!.pickOrder ?? 0) - (b.rp!.pickOrder ?? 0));
    slots = [...drafted, ...allSlots.filter((s) => !s.rp)];
  } else {
    slots = allSlots;
  }

  for (const { label, rp } of slots) {
    const slot = document.createElement("div");
    slot.className = "draft-roster-slot";
    if (rp && rp === lastPick) slot.classList.add("draft-slot-recent");

    // Row 1: label · name · OVR
    const row1 = document.createElement("div");
    row1.className = "slot-row1";

    const labelSpan = document.createElement("span");
    labelSpan.className = "draft-slot-label";
    labelSpan.textContent = label;
    row1.appendChild(labelSpan);

    if (rp) {
      const nameSpan = document.createElement("span");
      nameSpan.className = rp.starred ? "draft-slot-name draft-starred-name" : "draft-slot-name";
      nameSpan.textContent = rp.name;
      row1.appendChild(nameSpan);

      const ovrSpan = document.createElement("span");
      ovrSpan.className = "slot-ovr";
      ovrSpan.innerHTML = playerOvrDisplay(rp);
    row1.appendChild(ovrSpan);
    } else {
      const emptySpan = document.createElement("span");
      emptySpan.className = "draft-slot-name slot-empty";
      emptySpan.textContent = "—";
      row1.appendChild(emptySpan);
    }

    slot.appendChild(row1);

    // Row 2: top-3 attr chips OR "See prospects" button
    const row2 = document.createElement("div");
    row2.className = "slot-row2";

    if (rp) {
      for (const { attr, grade, color } of topAttrs(rp)) {
        const chip = document.createElement("span");
        chip.className = "slot-attr-chip";
        chip.innerHTML =
          `<span class="slot-grade" style="color:${color}">${grade}</span>` +
          `<span class="slot-attr-name">${ATTR_SHORT_LABELS[attr] ?? attr}</span>`;
        row2.appendChild(chip);
      }
    } else if (options.onSeeProspects) {
      const btn = document.createElement("button");
      btn.className = "slot-see-btn";
      btn.textContent = "See prospects";
      btn.addEventListener("click", () => options.onSeeProspects!(label));
      row2.appendChild(btn);
    }

    slot.appendChild(row2);
    card.appendChild(slot);
  }

  return card;
}

import { draftPool } from "../core/draft";
import { Attribute, getLetterGrade, getProximity } from "../core/ratings";
import { scoreProspect } from "../core/draftEval";
import { Label, PLAYER_LABELS, RosterPlayer, Team } from "../core/types";
import { labelToRole } from "../utils/roster";
import { ATTR_SHORT_LABELS, ROLE_ATTRIBUTES } from "./playerAttrs";
import {
  playerOvrDisplay,
  roleOvrDisplay,
  sideOvrDisplay,
  teamOvrDisplay,
} from "./displayMode";

const ROLE_ORDER = [
  "passer",
  "runner",
  "catcher",
  "blocker",
  "rusher",
  "coverer",
] as const;

export type RosterCardOptions = {
  /** Extra HTML injected into the header after the OVR. */
  headerSuffix?: string;
  /** Buttons to append after the role breakdown and before the player slots. */
  actionButtons?: HTMLElement[];
  /** Sort order for the player slot list. Default: position order (PLAYER_LABELS). */
  slotSort?: "pos" | "ovr" | "draft";
  /** If provided, empty slots show a "See prospects" button that calls this with the slot's label. */
  onSeeProspects?: (label: Label) => void;
  /** Show every role attribute on each player instead of just the top 3. */
  showAllAttrs?: boolean;
  /** Highlights the card (border + glow) as the user-controlled team — useful
   * when several rosters are shown together (draft recap, season rosters). */
  isUserTeam?: boolean;
  /**
   * Returns a player's season-start rating (0–1) for an attribute, or null.
   * When the attribute's letter grade has since changed, the chip shows the
   * previous grade alongside the current one (e.g. "B → A").
   */
  attrBaseline?: (rp: RosterPlayer, attr: Attribute) => number | null;
  /**
   * When set, shows overall-change chips (e.g. training gains since the season
   * baseline) next to the team OVR, each side's OVR, each role's OVR, and each
   * player's OVR. Each callback returns the delta in OVR points, or null.
   */
  overallDeltas?: {
    team?: () => number | null;
    side?: (side: "offense" | "defense") => number | null;
    role?: (role: string) => number | null;
    player?: (rp: RosterPlayer) => number | null;
  };
  /**
   * Same shape as overallDeltas, but for a single week's gain rather than the
   * season-long total — rendered as a second, distinctly styled chip (e.g.
   * "+0.3 wk") right next to the season chip.
   */
  weeklyDeltas?: {
    team?: () => number | null;
    side?: (side: "offense" | "defense") => number | null;
    role?: (role: string) => number | null;
    player?: (rp: RosterPlayer) => number | null;
  };
};

type AttrEntry = {
  attr: Attribute;
  ratingPct: number;
  grade: string;
  color: string;
};

/** Renders a small ▲/▼ overall-change chip, or "" when the delta is ~0/absent.
 * Pass `weekly: true` for the smaller, muted "this week" variant shown
 * alongside the season-long chip. */
function deltaChip(delta: number | null | undefined, weekly = false): string {
  if (delta == null || Math.abs(delta) < 0.05) return "";
  const up = delta > 0;
  const cls =
    (up ? "roster-delta-up" : "roster-delta-down") +
    (weekly ? " roster-delta-weekly" : "");
  const suffix = weekly ? " wk" : "";
  return ` <span class="roster-delta ${cls}">${up ? "▲+" : "▼"}${delta.toFixed(1)}${suffix}</span>`;
}

/** Combines a season chip and its weekly counterpart. */
function deltaChips(
  seasonDelta: number | null | undefined,
  weeklyDelta: number | null | undefined,
): string {
  return deltaChip(seasonDelta) + deltaChip(weeklyDelta, true);
}

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
    if (scores)
      out.set(role, scores.reduce((a, b) => a + b, 0) / scores.length);
  }
  return out;
}

/** Role-relevant attributes sorted by proximity (highest first), limited to
 * `count` (Infinity = all). */
function roleAttrEntries(rp: RosterPlayer, count = 3): AttrEntry[] {
  const role = labelToRole(rp.label);
  const attrs = (ROLE_ATTRIBUTES[role] ?? []) as Attribute[];
  return attrs
    .map((attr) => {
      const ratingPct = Math.round((rp.ratings[attr] ?? 0) * 100);
      return {
        attr,
        ratingPct,
        proximity: getProximity(attr, rp.ratings[attr] ?? 0),
        ...getLetterGrade(attr, ratingPct),
      };
    })
    .sort((a, b) => b.proximity - a.proximity)
    .slice(0, count)
    .map(({ attr, ratingPct, grade, color }) => ({
      attr,
      ratingPct,
      grade,
      color,
    }));
}

/** Builds one attribute chip's inner HTML, prefixing the previous letter grade
 * when training has changed it since the season baseline. */
function attrChipHtml(
  rp: RosterPlayer,
  entry: AttrEntry,
  options: RosterCardOptions,
): string {
  const { attr, grade, color } = entry;
  const name = ATTR_SHORT_LABELS[attr] ?? attr;

  let gradePart = `<span class="slot-grade" style="color:${color}">${grade}</span>`;
  const prevRating = options.attrBaseline?.(rp, attr);
  if (prevRating != null) {
    const prev = getLetterGrade(attr, Math.round(prevRating * 100));
    if (prev.grade !== grade) {
      gradePart =
        `<span class="slot-grade-prev" style="color:${prev.color}">${prev.grade}</span>` +
        `<span class="slot-grade-arrow">→</span>` +
        gradePart;
    }
  }
  return gradePart + `<span class="slot-attr-name">${name}</span>`;
}

/**
 * Builds a fixed-width roster card element showing:
 *   - Header: team name + OVR avg + optional suffix
 *   - Role breakdown row
 *   - All 16 label slots, each with a two-row layout:
 *       Row 1: label · name · OVR
 *       Row 2: top-3 attribute grade chips (or "See prospects" button if empty)
 */
export function buildRosterCard(
  team: Team,
  options: RosterCardOptions = {},
): HTMLDivElement {
  const card = document.createElement("div");
  card.className =
    "draft-roster" + (options.isUserTeam ? " draft-roster-user" : "");

  // ── Header ──
  const header = document.createElement("div");
  header.className = "draft-roster-header";
  header.style.color = team.color;
  header.innerHTML =
    `${team.name} · <span class="roster-card-ovr">OVR ${teamOvrDisplay(team)}${deltaChips(options.overallDeltas?.team?.(), options.weeklyDeltas?.team?.())}</span>` +
    (options.headerSuffix ?? "");
  card.appendChild(header);

  // ── Side (OFF/DEF) row ──
  if (team.roster.length > 0) {
    const sideRow = document.createElement("div");
    sideRow.className = "roster-card-side-row";
    sideRow.innerHTML =
      `<span class="roster-card-side-chip"><span class="roster-card-role-name">OFF</span><span class="roster-card-role-ovr">${sideOvrDisplay(team, "offense")}${deltaChips(options.overallDeltas?.side?.("offense"), options.weeklyDeltas?.side?.("offense"))}</span></span>` +
      `<span class="roster-card-side-chip"><span class="roster-card-role-name">DEF</span><span class="roster-card-role-ovr">${sideOvrDisplay(team, "defense")}${deltaChips(options.overallDeltas?.side?.("defense"), options.weeklyDeltas?.side?.("defense"))}</span></span>`;
    card.appendChild(sideRow);
  }

  // ── Role breakdown ──
  const breakdown = document.createElement("div");
  breakdown.className = "roster-card-breakdown";
  const roles = roleBreakdown(team.roster);
  if (roles.size > 0) {
    breakdown.innerHTML = ROLE_ORDER.filter((r) => roles.has(r))
      .map(
        (r) =>
          `<span class="roster-card-role-chip"><span class="roster-card-role-name">${r}</span><span class="roster-card-role-ovr">${roleOvrDisplay(team, r)}${deltaChips(options.overallDeltas?.role?.(r), options.weeklyDeltas?.role?.(r))}</span></span>`,
      )
      .join("");
  }
  card.appendChild(breakdown);

  // ── Action buttons ──
  for (const btn of options.actionButtons ?? []) {
    card.appendChild(btn);
  }

  // ── Player slots ──
  type Slot = { label: Label; rp: RosterPlayer | undefined };
  const allSlots: Slot[] = PLAYER_LABELS.map((l) => ({
    label: l,
    rp: team.roster.find((r) => r.label === l),
  }));
  let slots: Slot[];
  if (options.slotSort === "ovr") {
    const drafted = allSlots
      .filter((s) => !!s.rp)
      .sort((a, b) => scoreProspect(b.rp!) - scoreProspect(a.rp!));
    slots = [...drafted, ...allSlots.filter((s) => !s.rp)];
  } else if (options.slotSort === "draft") {
    const drafted = allSlots
      .filter((s) => !!s.rp)
      .sort((a, b) => (a.rp!.pickOrder ?? 0) - (b.rp!.pickOrder ?? 0));
    slots = [...drafted, ...allSlots.filter((s) => !s.rp)];
  } else {
    slots = allSlots;
  }

  for (const { label, rp } of slots) {
    const slot = document.createElement("div");
    slot.className = "draft-roster-slot";

    // Row 1: label · name · OVR
    const row1 = document.createElement("div");
    row1.className = "slot-row1";

    const labelSpan = document.createElement("span");
    labelSpan.className = "draft-slot-label";
    labelSpan.textContent = label;
    row1.appendChild(labelSpan);

    if (rp) {
      const nameSpan = document.createElement("span");
      nameSpan.className = rp.starred
        ? "draft-slot-name draft-starred-name"
        : "draft-slot-name";
      nameSpan.textContent = rp.name;
      row1.appendChild(nameSpan);

      const ovrSpan = document.createElement("span");
      ovrSpan.className = "slot-ovr";
      ovrSpan.innerHTML =
        playerOvrDisplay(rp) +
        deltaChips(
          options.overallDeltas?.player?.(rp),
          options.weeklyDeltas?.player?.(rp),
        );
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
      const entries = roleAttrEntries(rp, options.showAllAttrs ? Infinity : 3);
      for (const entry of entries) {
        const chip = document.createElement("span");
        chip.className = "slot-attr-chip";
        chip.innerHTML = attrChipHtml(rp, entry, options);
        row2.appendChild(chip);
      }
    } else if (options.onSeeProspects) {
      const available = draftPool.filter((p) => p.label === label).length;
      const btn = document.createElement("button");
      btn.className = "slot-see-btn";
      btn.textContent = `Show prospects (${available})`;
      btn.addEventListener("click", () => options.onSeeProspects!(label));
      row2.appendChild(btn);
    }

    slot.appendChild(row2);
    card.appendChild(slot);
  }

  return card;
}

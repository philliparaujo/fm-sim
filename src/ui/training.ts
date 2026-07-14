import { getCurrentWeek } from "../core/schedule";
import { TEAM_PLAYBOOKS } from "../core/playbook";
import { LEAGUE } from "../core/state";
import {
  applyTraining,
  ensureTrainingBaseline,
  FOCUS_CATEGORIES,
  FocusCategory,
  isTrainingDoneForWeek,
  playerBaselineRating,
  playerOvrDelta,
  POINTS_BUDGET,
  roleOvrDelta,
  sideOvrDelta,
  teamOvrDelta,
} from "../core/training";
import { Label, PLAYER_LABELS, RosterPlayer, Team } from "../core/types";
import { labelToRole, labelToSide } from "../utils/roster";
import { playerOvrDisplay, teamOvrDisplay } from "./displayMode";
import { buildRosterCard } from "./rosterCard";

// ── State ──────────────────────────────────────────────────────────────────

let trainingTeamColor = "";
/** The week currently being trained for. Null = not pinned, so it always
 * tracks the actual current week; set explicitly when the season tab's
 * per-week training gate sends the human here for a specific week. */
let trainingWeek: number | null = null;
/** The week's active focus category, controlling which attributes points pump. */
let focusCategory: FocusCategory = "general";
/** Points a team has tentatively assigned this week, keyed by color → label.
 * Applied to player ratings on Confirm. */
const pointsByTeam: Record<string, Partial<Record<Label, number>>> = {};

function activeTeam(): Team {
  return LEAGUE.find((t) => t.color === trainingTeamColor) ?? LEAGUE[0];
}

function activeWeek(): number {
  return trainingWeek ?? getCurrentWeek();
}

function teamPoints(color: string): Partial<Record<Label, number>> {
  return (pointsByTeam[color] ??= {});
}

function pointsUsed(color: string): number {
  return Object.values(teamPoints(color)).reduce((a, b) => a + (b ?? 0), 0);
}

// ── Focus labels ─────────────────────────────────────────────────────────

const FOCUS_BY_ROLE: Record<string, string> = {
  passer: "Passing",
  runner: "Rushing",
  catcher: "Receiving",
  blocker: "Blocking",
  rusher: "Pass Rush",
  coverer: "Coverage",
};

// ── Setup / render entry ───────────────────────────────────────────────────

export function setupTraining() {
  if (!trainingTeamColor && LEAGUE.length > 0) {
    trainingTeamColor = LEAGUE[0].color;
  }
  document.getElementById("tab-training")?.addEventListener("click", render);
  render();
}

/** Re-renders the training tab (e.g. after the global ratings/rankings toggle). */
export function rerenderTraining() {
  render();
}

function render() {
  const root = document.getElementById("training-root");
  if (!root) return;
  root.innerHTML = "";

  if (LEAGUE.length === 0) return;
  if (!LEAGUE.some((t) => t.color === trainingTeamColor)) {
    trainingTeamColor = LEAGUE[0].color;
  }

  // Snapshot season-start overalls the first time training is viewed (before
  // any points are applied) so development deltas read from a clean baseline.
  if (LEAGUE.every((t) => t.roster.length > 0)) ensureTrainingBaseline();

  const grid = document.createElement("div");
  grid.className = "trn-grid";
  grid.appendChild(renderFocusPanel()); // top-left
  grid.appendChild(renderRosterPanel()); // top-right
  grid.appendChild(renderFieldPanel()); // bottom-left
  grid.appendChild(renderSchemePanel()); // bottom-right
  root.appendChild(grid);
}

// ── Top-left: Focuses / point assignment ────────────────────────────────────

function renderFocusPanel(): HTMLElement {
  const team = activeTeam();
  const panel = section("Weekly Focus");
  const week = activeWeek();

  if (isTrainingDoneForWeek(team.color, week)) {
    const done = document.createElement("p");
    done.className = "trn-week-done";
    done.textContent = `✓ Week ${week} training complete.`;
    panel.appendChild(done);
    return panel;
  }

  const used = pointsUsed(team.color);
  const remaining = POINTS_BUDGET - used;

  // Header controls: budget counter + Auto Assign + Confirm
  const controls = document.createElement("div");
  controls.className = "trn-focus-controls";

  const counter = document.createElement("span");
  counter.className = "trn-points-counter";
  counter.innerHTML = `<strong>${used}</strong> / ${POINTS_BUDGET} pts`;
  controls.appendChild(counter);

  const autoBtn = document.createElement("button");
  autoBtn.className = "trn-btn";
  autoBtn.textContent = "Auto Assign";
  autoBtn.disabled = team.roster.length === 0;
  autoBtn.addEventListener("click", () => {
    autoAssign(team);
    render();
  });
  controls.appendChild(autoBtn);

  const confirmBtn = document.createElement("button");
  confirmBtn.className = "trn-btn trn-btn-primary";
  confirmBtn.textContent = "Confirm";
  confirmBtn.disabled = used === 0;
  confirmBtn.addEventListener("click", () => {
    // Apply the week's points under the active category, then clear the pool.
    applyTraining(team, teamPoints(team.color), focusCategory, week);
    pointsByTeam[team.color] = {};
    render();
  });
  controls.appendChild(confirmBtn);

  panel.appendChild(controls);

  // Focus category selector — decides which attributes the points develop.
  const catBar = document.createElement("div");
  catBar.className = "trn-cat-bar";
  for (const cat of FOCUS_CATEGORIES) {
    const btn = document.createElement("button");
    btn.className = "trn-cat-btn" + (focusCategory === cat.key ? " active" : "");
    btn.textContent = cat.label;
    btn.addEventListener("click", () => {
      focusCategory = cat.key;
      render();
    });
    catBar.appendChild(btn);
  }
  panel.appendChild(catBar);

  // Player rows
  const list = document.createElement("div");
  list.className = "trn-focus-list";

  const drafted = PLAYER_LABELS.map((label) => ({
    label,
    rp: team.roster.find((r) => r.label === label),
  }));

  for (const { label, rp } of drafted) {
    list.appendChild(renderFocusRow(team, label, rp, remaining));
  }

  panel.appendChild(list);
  return panel;
}

function renderFocusRow(
  team: Team,
  label: Label,
  rp: RosterPlayer | undefined,
  remaining: number,
): HTMLElement {
  const row = document.createElement("div");
  row.className = "trn-focus-row" + (rp ? "" : " trn-focus-row-empty");

  const info = document.createElement("div");
  info.className = "trn-focus-info";
  const focus = FOCUS_BY_ROLE[labelToRole(label)] ?? "—";
  info.innerHTML =
    `<span class="trn-focus-label">${label}</span>` +
    `<span class="trn-focus-name">${rp ? rp.name : "—"}</span>` +
    `<span class="trn-focus-focus">${focus}</span>` +
    (rp ? `<span class="trn-focus-ovr">${playerOvrDisplay(rp)}</span>` : "");
  row.appendChild(info);

  const stepper = document.createElement("div");
  stepper.className = "trn-stepper";
  const value = teamPoints(team.color)[label] ?? 0;

  const minus = document.createElement("button");
  minus.className = "trn-step-btn";
  minus.textContent = "−";
  minus.disabled = !rp || value <= 0;
  minus.addEventListener("click", () => {
    teamPoints(team.color)[label] = Math.max(0, value - 1);
    render();
  });

  const val = document.createElement("span");
  val.className = "trn-step-val";
  val.textContent = String(value);

  const plus = document.createElement("button");
  plus.className = "trn-step-btn";
  plus.textContent = "+";
  plus.disabled = !rp || remaining <= 0;
  plus.addEventListener("click", () => {
    teamPoints(team.color)[label] = value + 1;
    render();
  });

  stepper.append(minus, val, plus);
  row.appendChild(stepper);
  return row;
}

/** Evenly spreads the full budget across drafted players (resets first). */
function autoAssign(team: Team) {
  const pts = teamPoints(team.color);
  for (const l of PLAYER_LABELS) pts[l] = 0;

  const drafted = team.roster.map((r) => r.label);
  if (drafted.length === 0) return;

  for (let i = 0; i < POINTS_BUDGET; i++) {
    const label = drafted[i % drafted.length];
    pts[label] = (pts[label] ?? 0) + 1;
  }
}

// ── Top-right: roster + team toggle ─────────────────────────────────────────

function renderRosterPanel(): HTMLElement {
  const team = activeTeam();
  const panel = document.createElement("div");
  panel.className = "trn-panel trn-roster-panel";

  // Team toggle header: ◀ TEAM ▶  OVR (shared .team-toggle styling)
  const toggle = document.createElement("div");
  toggle.className = "team-toggle";

  const prev = document.createElement("button");
  prev.className = "team-toggle-btn";
  prev.textContent = "◀";
  prev.addEventListener("click", () => cycleTeam(-1));

  const name = document.createElement("span");
  name.className = "team-toggle-name";
  name.style.color = team.color;
  name.textContent = team.name;

  const next = document.createElement("button");
  next.className = "team-toggle-btn";
  next.textContent = "▶";
  next.addEventListener("click", () => cycleTeam(1));

  const ovr = document.createElement("span");
  ovr.className = "team-toggle-ovr";
  ovr.innerHTML = `OVR ${teamOvrDisplay(team)}`;

  toggle.append(prev, name, next, ovr);
  panel.appendChild(toggle);

  // Full roster card (reused from the draft/play screens for consistency)
  const cardWrap = document.createElement("div");
  cardWrap.className = "trn-roster-card-wrap";
  // Training-only: full attribute list, previous letter grades on changed
  // attributes, and development (Δ overall since season start) per player,
  // per role, per side, and for the team.
  cardWrap.appendChild(
    buildRosterCard(team, {
      showAllAttrs: true,
      attrBaseline: (rp, attr) => playerBaselineRating(team.color, rp.label, attr),
      overallDeltas: {
        team: () => teamOvrDelta(team),
        side: (side) => sideOvrDelta(team, side),
        role: (role) => roleOvrDelta(team, role),
        player: (rp) => playerOvrDelta(team.color, rp),
      },
    }),
  );
  panel.appendChild(cardWrap);

  return panel;
}

/** Pre-selects a team (and, optionally, pins a specific week) on the Training
 * tab — used when the season tab's per-week training gate sends the human
 * here to complete that week's training. */
export function focusTrainingTeam(color: string, week?: number): void {
  if (LEAGUE.some((t) => t.color === color)) {
    trainingTeamColor = color;
    if (week !== undefined) trainingWeek = week;
    render();
  }
}

function cycleTeam(delta: number) {
  const idx = LEAGUE.findIndex((t) => t.color === trainingTeamColor);
  const nextIdx = (idx + delta + LEAGUE.length) % LEAGUE.length;
  trainingTeamColor = LEAGUE[nextIdx].color;
  render();
}

// ── Bottom-left: field / formation ──────────────────────────────────────────

type FieldSpot = { label: Label; nx: number; ny: number };

// Normalized (0..1) base alignment mirroring the sim's real formation geometry
// (see core/playbook.ts). x = downfield (offense left of the LOS at 0.33,
// defense to the right), y = field width. One team's offense and defense are
// shown together so the whole roster is laid out spatially.
const FORMATION: FieldSpot[] = [
  // Offense
  { label: "XR", nx: 0.33, ny: 0.14 },
  { label: "LT", nx: 0.33, ny: 0.4 },
  { label: "C", nx: 0.33, ny: 0.5 },
  { label: "RT", nx: 0.33, ny: 0.6 },
  { label: "TE", nx: 0.31, ny: 0.7 },
  { label: "ZR", nx: 0.33, ny: 0.86 },
  { label: "QB", nx: 0.26, ny: 0.5 },
  { label: "RB", nx: 0.2, ny: 0.5 },
  // Defense
  { label: "LE", nx: 0.4, ny: 0.36 },
  { label: "DT", nx: 0.4, ny: 0.5 },
  { label: "RE", nx: 0.4, ny: 0.64 },
  { label: "CB", nx: 0.5, ny: 0.14 },
  { label: "LB", nx: 0.52, ny: 0.5 },
  { label: "NB", nx: 0.5, ny: 0.86 },
  { label: "SS", nx: 0.66, ny: 0.3 },
  { label: "FS", nx: 0.78, ny: 0.7 },
];

function renderFieldPanel(): HTMLElement {
  const team = activeTeam();
  const panel = section("Formation");

  const field = document.createElement("div");
  field.className = "trn-field";

  // Line of scrimmage marker
  const los = document.createElement("div");
  los.className = "trn-field-los";
  los.style.left = "33%";
  field.appendChild(los);

  for (const spot of FORMATION) {
    const rp = team.roster.find((r) => r.label === spot.label);
    const side = labelToSide(spot.label);
    const dot = document.createElement("div");
    dot.className =
      "trn-player trn-player-" + side + (rp ? "" : " trn-player-empty");
    dot.style.left = `${spot.nx * 100}%`;
    dot.style.top = `${spot.ny * 100}%`;
    if (side === "offense") dot.style.background = team.color;
    else dot.style.borderColor = team.color;
    dot.textContent = spot.label;
    dot.title = rp
      ? `${spot.label} · ${rp.name} · OVR ${playerOvrDisplay(rp)}`
      : `${spot.label} · (undrafted)`;
    field.appendChild(dot);
  }

  panel.appendChild(field);

  // Legend
  const legend = document.createElement("div");
  legend.className = "trn-field-legend";
  legend.innerHTML =
    `<span class="trn-legend-item"><span class="trn-legend-dot trn-player-offense" style="background:${team.color}"></span>Offense</span>` +
    `<span class="trn-legend-item"><span class="trn-legend-dot trn-player-defense" style="border-color:${team.color}"></span>Defense</span>`;
  panel.appendChild(legend);

  return panel;
}

// ── Bottom-right: scheme sliders ────────────────────────────────────────────

type SchemeSlider = {
  leftLabel: string;
  rightLabel: string;
  /** Reads the 0..1 slider position from the team's saved playbook. */
  get: (pb: Record<string, number>) => number;
  /** Writes the 0..1 slider position back into the team's saved playbook. */
  set: (pb: Record<string, number>, v: number) => void;
};

// Man/Zone inverts: slider left (0) = all man, so store manPercent = 1 - v.
const SCHEME_SLIDERS: SchemeSlider[] = [
  { leftLabel: "Run", rightLabel: "Pass", get: (pb) => pb.passPercent ?? 0.5, set: (pb, v) => (pb.passPercent = v) },
  { leftLabel: "Short", rightLabel: "Deep", get: (pb) => pb.deepPercent ?? 0.5, set: (pb, v) => (pb.deepPercent = v) },
  { leftLabel: "Man", rightLabel: "Zone", get: (pb) => 1 - (pb.manPercent ?? 0.5), set: (pb, v) => (pb.manPercent = 1 - v) },
  { leftLabel: "Safe", rightLabel: "Blitz", get: (pb) => pb.blitzPercent ?? 0.3, set: (pb, v) => (pb.blitzPercent = v) },
];

const SCHEME_STEPS = 5; // 5-button discrete slider: 0, .25, .5, .75, 1

function renderSchemePanel(): HTMLElement {
  const team = activeTeam();
  const pb = TEAM_PLAYBOOKS[team.color];
  const panel = section("Scheme");

  if (!pb) {
    const p = document.createElement("p");
    p.className = "trn-empty";
    p.textContent = "No playbook for this team.";
    panel.appendChild(p);
    return panel;
  }

  for (const slider of SCHEME_SLIDERS) {
    panel.appendChild(renderSchemeSlider(team, pb, slider));
  }
  return panel;
}

function renderSchemeSlider(
  team: Team,
  pb: Record<string, number>,
  slider: SchemeSlider,
): HTMLElement {
  const row = document.createElement("div");
  row.className = "trn-scheme-row";

  const left = document.createElement("span");
  left.className = "trn-scheme-label trn-scheme-left";
  left.textContent = slider.leftLabel;
  row.appendChild(left);

  const dots = document.createElement("div");
  dots.className = "trn-scheme-dots";
  const current = Math.round(slider.get(pb) * (SCHEME_STEPS - 1));

  for (let i = 0; i < SCHEME_STEPS; i++) {
    const dot = document.createElement("button");
    dot.className = "trn-scheme-dot" + (i === current ? " active" : "");
    if (i === current) dot.style.background = team.color;
    dot.addEventListener("click", () => {
      slider.set(pb, i / (SCHEME_STEPS - 1));
      // Persisted to the team's playbook; the play tab re-syncs PLAYBOOK_CONFIG
      // from TEAM_PLAYBOOKS on each snap, so a game in progress picks it up.
      render();
    });
    dots.appendChild(dot);
  }
  row.appendChild(dots);

  const right = document.createElement("span");
  right.className = "trn-scheme-label trn-scheme-right";
  right.textContent = slider.rightLabel;
  row.appendChild(right);

  return row;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function section(title: string): HTMLElement {
  const panel = document.createElement("div");
  panel.className = "trn-panel";
  const h = document.createElement("h3");
  h.className = "trn-heading";
  h.textContent = title;
  panel.appendChild(h);
  return panel;
}

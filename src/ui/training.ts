import { scoreProspect } from "../core/draftEval";
import { TEAM_PLAYBOOKS } from "../core/playbook";
import { getCurrentWeek } from "../core/schedule";
import { LEAGUE } from "../core/state";
import {
  applyTraining,
  ensureTrainingBaseline,
  FOCUS_CATEGORIES,
  FocusCategory,
  isTrainingDoneForWeek,
  playerBaselineRating,
  playerOvrDelta,
  playerWeeklyGain,
  POINTS_BUDGET,
  roleOvrDelta,
  roleWeeklyGain,
  sideOvrDelta,
  sideWeeklyGain,
  teamOvrDelta,
  teamWeeklyGain,
} from "../core/training";
import { Label, PLAYER_LABELS, RosterPlayer, Route, Team } from "../core/types";
import { labelToRole, labelToSide } from "../utils/roster";
import {
  cornerRoute,
  curlRoute,
  dragRoute,
  flatRoute,
  inRoute,
  outRoute,
  postRoute,
  routeDepthShares,
  slantRoute,
  streakRoute,
} from "../utils/route";
import { playerOvrDisplay } from "./displayMode";
import { getSelectedTeamColor } from "./draft";
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

  // render() fully rebuilds the tab on every interaction (including each +/-
  // stepper click), which would otherwise reset any scrollable panel — most
  // noticeably the focus list — back to the top every time, since freshly
  // created elements start at scrollTop 0. Preserve and restore scroll
  // position across the rebuild so repeatedly clicking +/- on a player further
  // down the roster doesn't jump the view back up each time.
  const scrollPositions = new Map<string, number>();
  root.querySelectorAll(".trn-focus-list, .trn-roster-card-wrap").forEach((el) => {
    if (el.scrollTop > 0) scrollPositions.set(el.className, el.scrollTop);
  });

  root.innerHTML = "";

  if (LEAGUE.length === 0) return;
  if (!LEAGUE.some((t) => t.color === trainingTeamColor)) {
    trainingTeamColor = LEAGUE[0].color;
  }

  // Snapshot season-start overalls the first time training is viewed (before
  // any points are applied) so development deltas read from a clean baseline.
  if (LEAGUE.every((t) => t.roster.length > 0)) ensureTrainingBaseline();

  // CPU teams never have a human tuning their scheme sliders, so derive one
  // live from current roster strength every render — both the formation
  // panel and the scheme panel below read the same freshly-computed values.
  const team = activeTeam();
  if (team.color !== getSelectedTeamColor() && team.roster.length > 0) {
    autoScheme(team);
  }

  const grid = document.createElement("div");
  grid.className = "trn-grid";
  grid.appendChild(renderFocusPanel()); // top-left
  grid.appendChild(renderRosterPanel()); // top-right
  grid.appendChild(renderFieldPanel()); // bottom-left
  grid.appendChild(renderSchemePanel()); // bottom-right
  root.appendChild(grid);

  root.querySelectorAll(".trn-focus-list, .trn-roster-card-wrap").forEach((el) => {
    const saved = scrollPositions.get(el.className);
    if (saved !== undefined) el.scrollTop = saved;
  });
}

// ── Top-left: Focuses / point assignment ────────────────────────────────────

function renderFocusPanel(): HTMLElement {
  const team = activeTeam();
  const panel = section("Weekly Focus");
  const week = activeWeek();
  // CPU teams' training is auto-completed elsewhere (see autoTrainTeam) — a
  // human viewing another team's page here shouldn't be able to edit its
  // points, category, or confirm on its behalf, so every control below is
  // grayed out unless this is the user's own team.
  const isUserTeam = team.color === getSelectedTeamColor();

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
  autoBtn.disabled = team.roster.length === 0 || !isUserTeam;
  autoBtn.addEventListener("click", () => {
    autoAssign(team);
    render();
  });
  controls.appendChild(autoBtn);

  const confirmBtn = document.createElement("button");
  confirmBtn.className = "trn-btn trn-btn-primary";
  confirmBtn.textContent = "Confirm";
  confirmBtn.disabled = used === 0 || !isUserTeam;
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
    btn.className =
      "trn-cat-btn" + (focusCategory === cat.key ? " active" : "");
    btn.textContent = cat.label;
    btn.disabled = !isUserTeam;
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
    list.appendChild(renderFocusRow(team, label, rp, remaining, isUserTeam));
  }

  panel.appendChild(list);
  return panel;
}

function renderFocusRow(
  team: Team,
  label: Label,
  rp: RosterPlayer | undefined,
  remaining: number,
  isUserTeam: boolean,
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
  minus.disabled = !rp || value <= 0 || !isUserTeam;
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
  plus.disabled = !rp || remaining <= 0 || !isUserTeam;
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

  toggle.append(prev, name, next);
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
      attrBaseline: (rp, attr) =>
        playerBaselineRating(team.color, rp.label, attr),
      overallDeltas: {
        team: () => teamOvrDelta(team),
        side: (side) => sideOvrDelta(team, side),
        role: (role) => roleOvrDelta(team, role),
        player: (rp) => playerOvrDelta(team.color, rp),
      },
      // "This week" gains for the week currently in context — 0/no chip
      // until that week is actually trained, then shows immediately.
      weeklyDeltas: {
        team: () => teamWeeklyGain(team, activeWeek()),
        side: (side) => sideWeeklyGain(team, activeWeek(), side),
        role: (role) => roleWeeklyGain(team, activeWeek(), role),
        player: (rp) => playerWeeklyGain(team.color, rp.label, activeWeek()),
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
//
// Offensive alignment (and the DL/underneath defensive alignment) never
// changes — only the annotations drawn from each fixed spot react to the
// scheme sliders. Only the two safeties actually reposition, per Safe/Blitz.

type FieldSpot = { label: Label; nx: number; ny: number };

// Normalized (0..1): x = downfield (offense left of the LOS at 0.33, defense
// to the right), y = field width.
const OFFENSE_FORMATION: FieldSpot[] = [
  { label: "XR", nx: 0.33, ny: 0.14 },
  { label: "LT", nx: 0.33, ny: 0.4 },
  { label: "C", nx: 0.33, ny: 0.5 },
  { label: "RT", nx: 0.33, ny: 0.6 },
  { label: "TE", nx: 0.31, ny: 0.7 },
  { label: "ZR", nx: 0.33, ny: 0.86 },
  { label: "QB", nx: 0.26, ny: 0.5 },
  { label: "RB", nx: 0.2, ny: 0.5 },
];
const DEFENSE_BASE_FORMATION: FieldSpot[] = [
  { label: "LE", nx: 0.4, ny: 0.36 },
  { label: "DT", nx: 0.4, ny: 0.5 },
  { label: "RE", nx: 0.4, ny: 0.64 },
  { label: "CB", nx: 0.5, ny: 0.14 },
  // LB shades toward the TE it's responsible for (ny 0.7) rather than dead
  // center, which also keeps it clear of the SS on single-high looks.
  { label: "LB", nx: 0.52, ny: 0.6 },
  { label: "NB", nx: 0.5, ny: 0.86 },
];

// ── Safe/Blitz (slider index 0–4) → safety depth + who's actually rushing ──
type SafetySpot = { nx: number; ny: number; rushing: boolean };
const SAFETY_PLANS: { ss: SafetySpot; fs: SafetySpot }[] = [
  // 0: true 2-high shell, base 3-man rush
  {
    ss: { nx: 0.78, ny: 0.3, rushing: false },
    fs: { nx: 0.78, ny: 0.7, rushing: false },
  },
  // 1: current/default 2-high (SS a step closer to the line), base 3-man rush
  {
    ss: { nx: 0.66, ny: 0.3, rushing: false },
    fs: { nx: 0.78, ny: 0.7, rushing: false },
  },
  // 2: single-high — SS rotates down toward the box but doesn't rush, 3-man rush
  {
    ss: { nx: 0.58, ny: 0.4, rushing: false },
    fs: { nx: 0.78, ny: 0.5, rushing: false },
  },
  // 3: single-high — SS blitzes, 4-man rush
  {
    ss: { nx: 0.42, ny: 0.25, rushing: true },
    fs: { nx: 0.78, ny: 0.5, rushing: false },
  },
  // 4: Cover 0 — both safeties come down and blitz, 5-man rush
  {
    ss: { nx: 0.42, ny: 0.25, rushing: true },
    fs: { nx: 0.42, ny: 0.75, rushing: true },
  },
];

// ── Man/Zone (slider index 0–4) → underneath coverage per label ────────────
// Man count steps down 3 → 2 → 1 → 1 → 0 as the dial slides toward zone, so a
// man-leaning setting actually reads man-first (not mostly zone). Man itself
// draws no annotation (see renderFieldPanel) — only zone gets a circle — so
// this table is the only thing that actually distinguishes the two.
type CoverageCall = "man" | "zone";
const UNDERNEATH_COVERAGE: Record<"CB" | "NB" | "LB", CoverageCall>[] = [
  { CB: "man", NB: "man", LB: "man" }, // 0: all man
  { CB: "zone", NB: "man", LB: "man" }, // 1: man-leaning — press both corners
  { CB: "man", NB: "man", LB: "zone" }, // 2: balanced — lone press corner on X
  { CB: "zone", NB: "zone", LB: "man" }, // 3: zone-leaning — LB robs the TE
  { CB: "zone", NB: "zone", LB: "zone" }, // 4: all zone
];

// ── Short/Deep (index) → each receiver's actual route shape ────────────────
// Run/Pass (index) → how many of them actually run one, and whether the RB's
// run vector shows at all. XR is shown at every Run/Pass setting that has any
// route at all (including "only one receiver"), so it carries the full
// short→deep progression; TE/ZR (only shown alongside it) get a simpler split.
const XR_ROUTE_BY_DEPTH: Route[] = [
  dragRoute,
  slantRoute,
  inRoute,
  postRoute,
  streakRoute,
];
const TE_ROUTE_BY_DEPTH: Route[] = [
  flatRoute,
  flatRoute,
  flatRoute,
  postRoute,
  postRoute,
];
const ZR_ROUTE_BY_DEPTH: Route[] = [
  curlRoute,
  outRoute,
  cornerRoute,
  inRoute,
  streakRoute,
];
const SHOWN_RECEIVERS_BY_RUNPASS: Label[][] = [
  [],
  ["XR"],
  ["XR", "ZR"],
  ["XR", "ZR", "TE"],
  ["XR", "ZR", "TE"],
];
const RUN_VECTOR_SHOWN_BY_RUNPASS = [true, true, true, true, false];

const SVG_NS = "http://www.w3.org/2000/svg";
// The annotation SVG uses a 16:9 viewBox matching the field, so it scales
// uniformly (circles stay circular, strokes stay even) — the old square
// viewBox stretched to fit distorted everything.
const VIEW_W = 160;
const VIEW_H = 90;
const X = (nx: number) => nx * VIEW_W;
const Y = (ny: number) => ny * VIEW_H;
/** Illustrative user-units per yard for drawing routes/vectors — not to scale
 * with the actual game, just enough to look right in this small diagram. */
const YARD_SCALE = 2.1;

type ArrowColor = "run" | "route" | "rush";

/** Keeps an arrowhead's tip fully inside the visible field regardless of
 * where the route/vector's true endpoint lands — out and corner routes break
 * toward the sideline and can otherwise compute an endpoint past the field
 * edge, where the container's overflow clipping would hide the arrowhead
 * entirely. */
const ARROW_EDGE_MARGIN = 4;
function clampToField(x: number, y: number): [number, number] {
  return [
    Math.min(VIEW_W - ARROW_EDGE_MARGIN, Math.max(ARROW_EDGE_MARGIN, x)),
    Math.min(VIEW_H - ARROW_EDGE_MARGIN, Math.max(ARROW_EDGE_MARGIN, y)),
  ];
}

function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, tag);
}

function addLine(
  svg: SVGSVGElement,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  opts: { dashed?: boolean; arrow?: ArrowColor; cls: string },
) {
  const line = svgEl("line");
  const [ex2, ey2] = opts.arrow ? clampToField(x2, y2) : [x2, y2];
  line.setAttribute("x1", String(x1));
  line.setAttribute("y1", String(y1));
  line.setAttribute("x2", String(ex2));
  line.setAttribute("y2", String(ey2));
  line.setAttribute("class", opts.cls);
  if (opts.dashed) line.setAttribute("stroke-dasharray", "2.5 2");
  // Each arrow color needs its own marker: a marker's own fill can't inherit
  // the referencing line's color (currentColor resolves to the marker, not
  // the line), so per-color markers are the reliable way to color arrowheads.
  if (opts.arrow)
    line.setAttribute("marker-end", `url(#trn-arrow-${opts.arrow})`);
  svg.appendChild(line);
}

function addCircle(
  svg: SVGSVGElement,
  cx: number,
  cy: number,
  r: number,
  cls: string,
) {
  const c = svgEl("circle");
  c.setAttribute("cx", String(cx));
  c.setAttribute("cy", String(cy));
  c.setAttribute("r", String(r));
  c.setAttribute("class", cls);
  svg.appendChild(c);
}

/** Draws a route's pre-break straight segment and (if it breaks) a short
 * post-break segment (with an arrowhead on the final leg), using the same
 * breakAngle/sideMultiplier convention the live sim uses (see
 * utils/behavior.ts) so the shape matches what that route does in a real play. */
function addRoute(svg: SVGSVGElement, spot: FieldSpot, route: Route) {
  const startX = X(spot.nx);
  const startY = Y(spot.ny);
  const sideMultiplier = spot.ny < 0.5 ? 1 : -1;

  const preBreakYards = route === streakRoute ? 30 : route.yardsBeforeBreak;
  const breakX = startX + preBreakYards * YARD_SCALE;

  if (route === streakRoute) {
    addLine(svg, startX, startY, breakX, startY, {
      dashed: true,
      arrow: "route",
      cls: "trn-anno-route",
    });
    return;
  }

  addLine(svg, startX, startY, breakX, startY, {
    dashed: true,
    cls: "trn-anno-route",
  });
  const postYards = route.stopAfterBreak ? 4 : 12;
  const angleRad = ((route.breakAngle * sideMultiplier) / 180) * Math.PI;
  const endX = breakX + Math.cos(angleRad) * postYards * YARD_SCALE;
  const endY = startY + Math.sin(angleRad) * postYards * YARD_SCALE;
  addLine(svg, breakX, startY, endX, endY, {
    dashed: true,
    arrow: "route",
    cls: "trn-anno-route",
  });
}

function renderFieldPanel(): HTMLElement {
  const team = activeTeam();
  const pb = TEAM_PLAYBOOKS[team.color] ?? {};
  const panel = section("Formation");

  const runPassIdx = closestIndex(
    SCHEME_SLIDERS[0].values,
    SCHEME_SLIDERS[0].get(pb),
  );
  const shortDeepIdx = closestIndex(
    SCHEME_SLIDERS[1].values,
    SCHEME_SLIDERS[1].get(pb),
  );
  const manZoneIdx = closestIndex(
    SCHEME_SLIDERS[2].values,
    SCHEME_SLIDERS[2].get(pb),
  );
  const safeBlitzIdx = closestIndex(
    SCHEME_SLIDERS[3].values,
    SCHEME_SLIDERS[3].get(pb),
  );

  const safetyPlan = SAFETY_PLANS[safeBlitzIdx];
  const coverage = UNDERNEATH_COVERAGE[manZoneIdx];
  const shownReceivers = new Set(SHOWN_RECEIVERS_BY_RUNPASS[runPassIdx]);
  const showRunVector = RUN_VECTOR_SHOWN_BY_RUNPASS[runPassIdx];

  const allSpots: (FieldSpot & { rushing?: boolean })[] = [
    ...OFFENSE_FORMATION,
    ...DEFENSE_BASE_FORMATION,
    { label: "SS", ...safetyPlan.ss },
    { label: "FS", ...safetyPlan.fs },
  ];
  const spotByLabel = new Map(allSpots.map((s) => [s.label, s]));

  const field = document.createElement("div");
  field.className = "trn-field";

  // Line of scrimmage marker
  const los = document.createElement("div");
  los.className = "trn-field-los";
  los.style.left = "33%";
  field.appendChild(los);

  // ── Annotation layer (behind the player dots) ──
  const svg = svgEl("svg");
  svg.setAttribute("viewBox", `0 0 ${VIEW_W} ${VIEW_H}`);
  svg.classList.add("trn-field-annotations");

  // One small arrow marker per color (fixed user-space size so it doesn't
  // balloon with stroke width).
  const marker = (id: ArrowColor, fill: string) =>
    `<marker id="trn-arrow-${id}" viewBox="0 0 10 10" refX="8.5" refY="5" ` +
    `markerWidth="4.5" markerHeight="4.5" markerUnits="userSpaceOnUse" orient="auto">` +
    `<path d="M0,1.5 L9,5 L0,8.5 z" fill="${fill}" /></marker>`;
  const defs = svgEl("defs");
  defs.innerHTML =
    marker("run", "#f59e0b") +
    marker("route", "#fcd34d") +
    marker("rush", "#ef4444");
  svg.appendChild(defs);

  // Run vector — a static stretch-run arrow toward the offense's left (top)
  // sideline, not straight up the middle.
  if (showRunVector) {
    const rb = spotByLabel.get("RB")!;
    addLine(svg, X(rb.nx), Y(rb.ny), X(rb.nx) + 13, Y(rb.ny) - 24, {
      arrow: "run",
      cls: "trn-anno-run",
    });
  }

  // Route concepts — dashed, only for catchers the Run/Pass slider shows.
  const routeByLabel: Partial<Record<string, Route>> = {
    XR: XR_ROUTE_BY_DEPTH[shortDeepIdx],
    TE: TE_ROUTE_BY_DEPTH[shortDeepIdx],
    ZR: ZR_ROUTE_BY_DEPTH[shortDeepIdx],
  };
  for (const label of ["XR", "ZR", "TE"] as const) {
    if (!shownReceivers.has(label)) continue;
    addRoute(svg, spotByLabel.get(label)!, routeByLabel[label]!);
  }

  // Rushers — small vectors toward the LOS. DL always rush; safeties only
  // when the Safe/Blitz plan sends them.
  const rushArrow = (spot: FieldSpot) =>
    addLine(svg, X(spot.nx), Y(spot.ny), X(spot.nx) - 8, Y(spot.ny), {
      arrow: "rush",
      cls: "trn-anno-rush",
    });
  for (const label of ["LE", "DT", "RE"] as const)
    rushArrow(spotByLabel.get(label)!);
  for (const label of ["SS", "FS"] as const) {
    const spot = spotByLabel.get(label)!;
    if (spot.rushing) rushArrow(spot);
    else addCircle(svg, X(spot.nx), Y(spot.ny), 12, "trn-anno-zone");
  }

  // Underneath coverage — a circle for each zone drop; man gets no
  // annotation at all (the absence of a circle is the "man" signal).
  for (const label of ["CB", "NB", "LB"] as const) {
    const spot = spotByLabel.get(label)!;
    if (coverage[label] === "zone") {
      addCircle(svg, X(spot.nx), Y(spot.ny), 12, "trn-anno-zone");
    }
  }

  field.appendChild(svg);

  // Player dots, on top of the annotation layer.
  for (const spot of allSpots) {
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
    `<span class="trn-legend-item"><span class="trn-legend-dot trn-player-defense" style="border-color:${team.color}"></span>Defense</span>` +
    `<span class="trn-legend-item"><span class="trn-legend-swatch trn-legend-swatch-run"></span>Run</span>` +
    `<span class="trn-legend-item"><span class="trn-legend-swatch trn-legend-swatch-route"></span>Route</span>` +
    `<span class="trn-legend-item"><span class="trn-legend-swatch trn-legend-swatch-rush"></span>Rush</span>` +
    `<span class="trn-legend-item"><span class="trn-legend-swatch trn-legend-swatch-zone"></span>Zone (man = no marker)</span>`;
  panel.appendChild(legend);

  return panel;
}

// ── Bottom-right: scheme sliders ────────────────────────────────────────────

type SchemeSlider = {
  leftLabel: string;
  rightLabel: string;
  /** 5 realistic tendency values this slider can be set to, ascending. Index
   * 2 (the middle button) matches PLAYBOOK_CONFIG's current default, so a
   * fresh team starts on a sensible "healthy middle" option. */
  values: number[];
  /** Reads the current 0–1 value from the team's saved playbook. */
  get: (pb: Record<string, number>) => number;
  /** Writes a 0–1 value back into the team's saved playbook. */
  set: (pb: Record<string, number>, v: number) => void;
  /** Overrides the default complementary (1-v)/v percentage display — e.g.
   * the Short/Deep slider shows the actual short/deep route shares (plus the
   * fixed medium share as a note) instead of the raw stored split. */
  describe?: (v: number) => {
    leftPct: number;
    rightPct: number;
    note?: string;
  };
  /** One tendency word/phrase per value in `values`, aligned by index; null
   * for the neutral middle option. Used to build the plain-English scheme
   * summary above the sliders. */
  tags: (string | null)[];
};

// Man/Zone inverts: slider left = all man, so store manPercent = 1 - v (v is
// the "zone share"). Every ladder's middle option mirrors PLAYBOOK_CONFIG's
// default (passPercent .55, deepPercent .4, manPercent .5, blitzPercent .3)
// so an untouched team's dial reads exactly where the engine already starts.
const SCHEME_SLIDERS: SchemeSlider[] = [
  {
    leftLabel: "Run",
    rightLabel: "Pass",
    values: [0.45, 0.5, 0.55, 0.6, 0.65],
    get: (pb) => pb.passPercent ?? 0.55,
    set: (pb, v) => (pb.passPercent = v),
    tags: ["run-heavy", "run-first", null, "pass-first", "pass-heavy"],
  },
  {
    leftLabel: "Short",
    rightLabel: "Deep",
    values: [0.4, 0.5, 0.6, 0.7, 0.8],
    get: (pb) => pb.deepPercent ?? 0.6,
    set: (pb, v) => (pb.deepPercent = v),
    // Medium's share of all routes is fixed (see routeDepthShares) — this
    // slider only flexes the short/deep split of what's left, so it's shown
    // as actual route shares rather than the raw stored fraction.
    describe: (v) => {
      const { short, medium, deep } = routeDepthShares(v);
      return {
        leftPct: Math.round(short * 100),
        rightPct: Math.round(deep * 100),
        note: `${Math.round(medium * 100)}% Medium`,
      };
    },
    tags: ["horizontal", "quick-game", null, "downfield", "vertical"],
  },
  {
    leftLabel: "Man",
    rightLabel: "Zone",
    values: [0.2, 0.35, 0.5, 0.65, 0.8],
    get: (pb) => 1 - (pb.manPercent ?? 0.5),
    set: (pb, v) => (pb.manPercent = 1 - v),
    tags: ["press-man", "man-match", null, "zone-match", "spot-drop"],
  },
  {
    leftLabel: "Safe",
    rightLabel: "Blitz",
    values: [0.1, 0.2, 0.3, 0.4, 0.5],
    get: (pb) => pb.blitzPercent ?? 0.3,
    set: (pb, v) => (pb.blitzPercent = v),
    tags: ["conservative", "safe", null, "aggressive", "blitz-happy"],
  },
];

// ── CPU auto-scheme ─────────────────────────────────────────────────────────
// CPU teams never manually tune their sliders — instead their scheme is
// derived live from roster strength, restricted to the 3 middle ladder
// options on every slider (index 1-3) so no CPU team ever commits to an
// extreme, unbalanced scheme.

/** Overall (0-1) for a team's player at `label`, or null if undrafted. */
function ovrAt(team: Team, label: Label): number | null {
  const rp = team.roster.find((r) => r.label === label);
  return rp ? scoreProspect(rp) : null;
}

/** Average overall (0-1) across the given labels for a team, or null if none
 * of them are drafted yet. */
function avgOvr(team: Team, labels: Label[]): number | null {
  const ovrs = labels
    .map((l) => ovrAt(team, l))
    .filter((o): o is number => o !== null);
  return ovrs.length > 0 ? ovrs.reduce((a, b) => a + b, 0) / ovrs.length : null;
}

/** 1 = best in the league. Ranks `team`'s avgOvr(labels) against every other
 * league team's same average; null if this team hasn't drafted any of them. */
function leagueRankByAvg(labels: Label[], team: Team): number | null {
  const mine = avgOvr(team, labels);
  if (mine === null) return null;
  const all = LEAGUE.map((t) => avgOvr(t, labels)).filter(
    (o): o is number => o !== null,
  );
  return all.filter((o) => o > mine).length + 1;
}

/** Maps a league rank to a signed lean in [-1, 1]: negative = elite (rank 1),
 * positive = weak (rank = league size). Null rank (undrafted) leans neutral. */
function rankLean(rank: number | null, leagueSize: number): number {
  if (rank === null || leagueSize <= 1) return 0;
  const normalized = (rank - 1) / (leagueSize - 1); // 0 = best, 1 = worst
  return (normalized - 0.5) * 2;
}

/** Average raw rating value for `attr` across a set of players. */
function avgAttr(
  players: RosterPlayer[],
  attr: keyof RosterPlayer["ratings"],
): number {
  return (
    players.reduce((s, p) => s + (p.ratings[attr] ?? 0), 0) / players.length
  );
}

/** Snaps a signed lean to one of the 3 permitted middle indices — never the
 * two extremes at either end of the ladder. */
function leanToMiddleIndex(lean: number, threshold: number): 1 | 2 | 3 {
  if (lean > threshold) return 3;
  if (lean < -threshold) return 1;
  return 2;
}

/** Derives and writes a full scheme (all 4 sliders) for a CPU team, based on
 * roster strength:
 *  - Run/Pass: passer vs runner league rank
 *  - Short/Deep: passer short vs deep accuracy, and catcher catch radius vs
 *    catch acceleration
 *  - Man/Zone: coverer man vs zone coverage rating
 *  - Safe/Blitz: rusher league rank (a weak pass rush leans blitz; a strong
 *    one can afford to play safe)
 * Every slider is restricted to indices 1-3 — CPU teams never pick an
 * extreme, unbalanced option. */
function autoScheme(team: Team): void {
  const pb = TEAM_PLAYBOOKS[team.color];
  if (!pb) return;
  const leagueSize = LEAGUE.length;

  const passerRank = leagueRankByAvg(["QB"], team);
  const runnerRank = leagueRankByAvg(["RB"], team);
  const runPassLean =
    rankLean(runnerRank, leagueSize) - rankLean(passerRank, leagueSize);

  const qb = team.roster.find((r) => r.label === "QB");
  const passerDelta = qb
    ? (qb.ratings.DEEPACCURACY ?? 0) - (qb.ratings.SHORTACCURACY ?? 0)
    : 0;
  const catchers = (["XR", "ZR", "TE"] as Label[])
    .map((l) => team.roster.find((r) => r.label === l))
    .filter((r): r is RosterPlayer => !!r);
  const catcherDelta =
    catchers.length > 0
      ? avgAttr(catchers, "CATCHRADIUS") -
        avgAttr(catchers, "CATCHACCELERATION")
      : 0;
  const shortDeepLean = (passerDelta + catcherDelta) / 2;

  const coverers = (["CB", "NB", "LB", "FS", "SS"] as Label[])
    .map((l) => team.roster.find((r) => r.label === l))
    .filter((r): r is RosterPlayer => !!r);
  const manZoneLean =
    coverers.length > 0
      ? avgAttr(coverers, "ZONECOVERAGE") - avgAttr(coverers, "MANCOVERAGE")
      : 0;

  const rusherRank = leagueRankByAvg(["LE", "DT", "RE"], team);
  const safeBlitzLean = rankLean(rusherRank, leagueSize);

  const RANK_THRESHOLD = 0.2; // league-rank-based leans span roughly [-1, 1]
  const ATTR_THRESHOLD = 0.06; // ratings are stored on a 0-1 scale

  const idx = [
    leanToMiddleIndex(runPassLean, RANK_THRESHOLD),
    leanToMiddleIndex(shortDeepLean, ATTR_THRESHOLD),
    leanToMiddleIndex(manZoneLean, ATTR_THRESHOLD),
    leanToMiddleIndex(safeBlitzLean, RANK_THRESHOLD),
  ];

  SCHEME_SLIDERS.forEach((slider, i) => slider.set(pb, slider.values[idx[i]]));
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Builds a quick, plain-English read on a team's current scheme — one phrase
 * for offense (Run/Pass + Short/Deep tags) and one for defense (Safe/Blitz +
 * Man/Zone tags, blitz tendency mentioned first). Falls back to "balanced"
 * when both sliders in a pairing sit on their neutral middle option. Tags are
 * stored lowercase and only the final phrase's first letter is capitalized,
 * so any combination of two tags (or just one, or neither) reads as one
 * cohesive sentence rather than fragments awkwardly Capitalized Mid-Sentence. */
function describeScheme(pb: Record<string, number>): {
  offense: string;
  defense: string;
} {
  const tagFor = (slider: SchemeSlider) =>
    slider.tags[closestIndex(slider.values, slider.get(pb))];
  const [runPass, shortDeep, manZone, safeBlitz] = SCHEME_SLIDERS.map(tagFor);

  const join = (
    a: string | null,
    b: string | null,
    suffix: string,
    sep: string,
  ) => {
    const phrase =
      a && b
        ? `${a}${sep}${b} ${suffix}`
        : a
          ? `${a} ${suffix}`
          : b
            ? `${b} ${suffix}`
            : `balanced ${suffix}`;
    return capitalize(phrase);
  };

  return {
    offense: join(runPass, shortDeep, "offense", ", "),
    defense: join(safeBlitz, manZone, "defense", " "),
  };
}

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

  const { offense, defense } = describeScheme(pb);
  const summary = document.createElement("div");
  summary.className = "trn-scheme-summary";
  summary.innerHTML =
    `<span class="trn-scheme-summary-line">🏈 ${offense}</span>` +
    `<span class="trn-scheme-summary-sep">·</span>` +
    `<span class="trn-scheme-summary-line">🛡️ ${defense}</span>`;
  panel.appendChild(summary);

  for (const slider of SCHEME_SLIDERS) {
    panel.appendChild(renderSchemeSlider(team, pb, slider));
  }
  return panel;
}

/** Index of the ladder value closest to the team's current setting. */
function closestIndex(values: number[], v: number): number {
  let best = 0;
  for (let i = 1; i < values.length; i++) {
    if (Math.abs(values[i] - v) < Math.abs(values[best] - v)) best = i;
  }
  return best;
}

function renderSchemeSlider(
  team: Team,
  pb: Record<string, number>,
  slider: SchemeSlider,
): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "trn-scheme-wrap";

  const row = document.createElement("div");
  row.className = "trn-scheme-row";

  const current = closestIndex(slider.values, slider.get(pb));
  const v = slider.values[current];
  const desc = slider.describe?.(v) ?? {
    leftPct: Math.round((1 - v) * 100),
    rightPct: Math.round(v * 100),
  };

  const left = document.createElement("span");
  left.className = "trn-scheme-label trn-scheme-left";
  left.innerHTML = `${slider.leftLabel} <span class="trn-scheme-pct">${desc.leftPct}%</span>`;
  row.appendChild(left);

  const dots = document.createElement("div");
  dots.className = "trn-scheme-dots";

  for (let i = 0; i < slider.values.length; i++) {
    const dot = document.createElement("button");
    dot.className = "trn-scheme-dot" + (i === current ? " active" : "");
    dot.title = `${Math.round(slider.values[i] * 100)}% ${slider.rightLabel}`;
    if (i === current) dot.style.background = team.color;
    dot.addEventListener("click", () => {
      slider.set(pb, slider.values[i]);
      // Persisted to the team's playbook; the play tab re-syncs PLAYBOOK_CONFIG
      // from TEAM_PLAYBOOKS on each snap, so a game in progress picks it up.
      render();
    });
    dots.appendChild(dot);
  }
  row.appendChild(dots);

  const right = document.createElement("span");
  right.className = "trn-scheme-label trn-scheme-right";
  right.innerHTML = `<span class="trn-scheme-pct">${desc.rightPct}%</span> ${slider.rightLabel}`;
  row.appendChild(right);

  wrap.appendChild(row);

  if (desc.note) {
    const note = document.createElement("div");
    note.className = "trn-scheme-note";
    note.textContent = desc.note;
    wrap.appendChild(note);
  }

  return wrap;
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

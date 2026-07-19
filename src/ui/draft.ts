import {
  DraftProspect,
  draftPlayer,
  draftPool,
  getRecentPicks,
  hasLabel,
} from "../core/draft";
import { bestOverall, scoreProspect } from "../core/draftEval";
import { overallPercentile } from "../core/percentile";
import { getLetterGrade, getProximity } from "../core/ratings";
import { LEAGUE } from "../core/state";
import { captureTrainingBaseline } from "../core/training";
import { Label, PLAYER_LABELS, Team } from "../core/types";
import { labelToRole } from "../utils/roster";
import { ATTR_LABELS, ATTR_SHORT_LABELS, ROLE_ATTRIBUTES } from "./playerAttrs";
import { formatRank, playerOvrDisplay, teamOvrDisplay } from "./displayMode";
import { buildRosterCard } from "./rosterCard";
import { showTabs } from "./tabs";

/** Set to true to auto-draft every team's full roster at startup. */
export const AUTO_DRAFTED = false;

/** Sentinel <option> value for "🎲 Random" in the team select — resolved to an
 * actual team color the moment it's chosen (see setupDraft's change handler),
 * never stored as the selection itself. */
const RANDOM_TEAM_VALUE = "__random__";

let selectedTeamColor = "";
let snakePickResolve: (() => void) | null = null;
let rosterViewIdx = 0;
let humanTurnActive = true; // false only while an AI team is picking in snake draft
let snakeDraftActive = false; // true only while a snake draft is running

/** True when the user may manually draft right now: a team is selected, the
 * snake draft is running, and it's the human's turn on the clock. Draft
 * buttons are grayed out otherwise (e.g. before the draft has begun). */
function canUserDraftNow(): boolean {
  return !!selectedTeamColor && snakeDraftActive && humanTurnActive;
}

const POOL_FILTERS: (Label | "ALL")[] = ["ALL", ...PLAYER_LABELS];
let poolFilter: Label | "ALL" = "ALL";
let rosterSort: "pos" | "ovr" | "draft" = "pos";
let onRosterSortChange: (() => void) | null = null;

/** Preset delays between AI snake-draft picks, shown as a segmented control. */
const PICK_DELAY_PRESETS: { label: string; ms: number }[] = [
  { label: "Instant", ms: 0 },
  { label: "Rapid", ms: 10 },
  { label: "Quick", ms: 500 },
  { label: "Slow", ms: 3000 },
];
let pickDelayMs = 10;

export function getRosterSort(): "pos" | "ovr" | "draft" {
  return rosterSort;
}
export function onRosterSort(cb: () => void) {
  onRosterSortChange = cb;
}

/** The team color currently focused in the "Drafting for" dropdown ("" = NONE). */
export function getSelectedTeamColor(): string {
  return selectedTeamColor;
}

/** Called by any draft action while a snake draft is waiting for the human's pick. */
function resolveSnakePick() {
  if (snakePickResolve) {
    const cb = snakePickResolve;
    snakePickResolve = null;
    cb();
  }
}

/** Builds the draft screen. Re-renders after each pick. */
export function setupDraft() {
  const teamSelect = document.getElementById(
    "draft-team-select",
  ) as HTMLSelectElement;
  if (!teamSelect) return;

  const noneOpt = document.createElement("option");
  noneOpt.value = "";
  noneOpt.textContent = "NONE";
  teamSelect.appendChild(noneOpt);

  const randomOpt = document.createElement("option");
  randomOpt.value = RANDOM_TEAM_VALUE;
  randomOpt.textContent = "🎲 Random";
  teamSelect.appendChild(randomOpt);

  for (const team of LEAGUE) {
    const opt = document.createElement("option");
    opt.value = team.color;
    opt.textContent = team.name;
    teamSelect.appendChild(opt);
  }

  selectedTeamColor = "";
  teamSelect.value = selectedTeamColor;
  syncTeamSelect(teamSelect);
  teamSelect.addEventListener("change", () => {
    let value = teamSelect.value;
    if (value === RANDOM_TEAM_VALUE) {
      // Roll a team, then snap the <select> to show it by name rather than
      // leaving "🎲 Random" displayed for a now-fixed choice.
      const randomTeam = LEAGUE[Math.floor(Math.random() * LEAGUE.length)];
      value = randomTeam.color;
      teamSelect.value = value;
    }
    selectedTeamColor = value;
    if (selectedTeamColor) {
      const idx = LEAGUE.findIndex((t) => t.color === selectedTeamColor);
      if (idx >= 0) rosterViewIdx = idx;
    }
    syncTeamSelect(teamSelect);
    render();
  });

  // Move the "Drafting for" control block into the global top bar
  const draftControls = document.querySelector<HTMLElement>(".draft-controls");
  const gtbTeamSelect = document.getElementById("gtb-team-select");
  if (draftControls && gtbTeamSelect) gtbTeamSelect.appendChild(draftControls);

  // Snake draft controls → global top bar
  const delayControl = document.createElement("div");
  delayControl.className = "gtb-delay";

  const delayTitle = document.createElement("span");
  delayTitle.className = "gtb-delay-title";
  delayTitle.textContent = "Pick delay";
  delayControl.appendChild(delayTitle);

  const seg = document.createElement("div");
  seg.className = "gtb-delay-seg";
  for (const preset of PICK_DELAY_PRESETS) {
    const opt = document.createElement("button");
    opt.className =
      "gtb-delay-opt" + (preset.ms === pickDelayMs ? " active" : "");
    opt.textContent = preset.label;
    opt.title =
      preset.ms === 0 ? "No delay" : `${preset.ms} ms between AI picks`;
    opt.addEventListener("click", () => {
      pickDelayMs = preset.ms;
      seg
        .querySelectorAll(".gtb-delay-opt")
        .forEach((el) => el.classList.remove("active"));
      opt.classList.add("active");
    });
    seg.appendChild(opt);
  }
  delayControl.appendChild(seg);

  const snakeBtn = document.createElement("button");
  snakeBtn.id = "gtb-snake-draft-btn";
  snakeBtn.className = "gtb-btn gtb-btn-primary";
  snakeBtn.textContent = "Begin Draft";
  snakeBtn.addEventListener("click", async () => {
    snakeBtn.disabled = true;
    snakeBtn.textContent = "Drafting…";
    await snakeDraftAll();
    snakeBtn.disabled = false;
    snakeBtn.textContent = "Begin Draft";
  });

  const snakeBtnArea = document.getElementById("gtb-snake-btn");
  snakeBtnArea?.append(snakeBtn, delayControl);

  // Sort buttons → global bottom bar
  const sortBtns = document.querySelectorAll<HTMLButtonElement>(
    "#gbb-sort .draft-sort-btn",
  );
  sortBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      rosterSort = btn.dataset.sort as typeof rosterSort;
      syncSortButtons();
      render();
      onRosterSortChange?.();
    });
  });

  if (AUTO_DRAFTED) {
    for (const team of LEAGUE) autoDraftTeam(team.color);
  }

  render();
}

/** Reflects the current selection on the "Drafting for" control: tints the
 * select with the chosen team's color and flags whether a team is set (so the
 * control reads as an active choice, not an unfilled placeholder). */
function syncTeamSelect(teamSelect: HTMLSelectElement) {
  const team = LEAGUE.find((t) => t.color === selectedTeamColor);
  teamSelect.style.color = team ? team.color : "";
  teamSelect.style.borderColor = team ? team.color : "";
  const controls = teamSelect.closest<HTMLElement>(".draft-controls");
  controls?.classList.toggle("has-team", !!team);
}

function syncSortButtons() {
  document
    .querySelectorAll<HTMLButtonElement>("#gbb-sort .draft-sort-btn")
    .forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.sort === rosterSort);
    });
}

/** Re-renders the draft tab (e.g. after the global ratings/rankings toggle). */
export function rerenderDraft() {
  render();
}

/** True when every team has a full 16-player roster. */
function isDraftComplete(): boolean {
  return LEAGUE.every((t) => t.roster.length === PLAYER_LABELS.length);
}

function render() {
  // Once we've transitioned to the season tabs, the draft screen is hidden.
  // Don't re-run showRecap() (which would re-inject the Start Season button).
  if (document.getElementById("draft-screen")?.style.display === "none") return;
  if (isDraftComplete()) {
    showRecap();
    return;
  }
  renderBestProspects();
  renderPool();
  renderRosters();
}

function showRecap() {
  document.getElementById("draft-main")!.style.display = "none";
  document.querySelector<HTMLElement>(".draft-controls")!.style.display =
    "none";
  const recap = document.getElementById("draft-recap")!;
  recap.style.display = "";

  const grid = document.getElementById("draft-recap-rosters")!;
  grid.innerHTML = "";
  syncSortButtons();
  for (const team of LEAGUE) {
    grid.appendChild(
      buildRosterCard(team, {
        slotSort: rosterSort,
        isUserTeam: team.color === selectedTeamColor,
      }),
    );
  }

  // Move "Start Season" into the global top bar, replacing the snake draft button
  const snakeBtnArea = document.getElementById("gtb-snake-btn");
  if (snakeBtnArea) snakeBtnArea.style.display = "none";

  const statusArea = document.getElementById("gtb-status");
  if (statusArea) {
    statusArea.style.display = "flex";
    statusArea.innerHTML = `<button id="draft-advance-btn" class="gtb-btn gtb-btn-advance">Start Season →</button>`;
    document.getElementById("draft-advance-btn")?.addEventListener(
      "click",
      () => {
        // Snapshot final rosters as the training baseline for development tracking.
        captureTrainingBaseline();
        document.getElementById("draft-screen")!.style.display = "none";
        statusArea.style.display = "none";
        showTabs("tab-schedule");
      },
      { once: true },
    );
  }
}

/** True if a team still has an open slot it can fill from the remaining pool. */
function teamNeedsPick(team: Team): boolean {
  return PLAYER_LABELS.some(
    (l) => !hasLabel(team, l) && draftPool.some((p) => p.label === l),
  );
}

/**
 * Runs a full snake draft using bestOverall (margin-based) picks until the pool
 * is exhausted. Order alternates each round: T1→T8, T8→T1, T1→T8, …
 */
async function snakeDraftAll() {
  showSnakeBar();
  snakeDraftActive = true;
  try {
    let forward = true;
    while (draftPool.length > 0) {
      const order = forward ? [...LEAGUE] : [...LEAGUE].reverse();
      let anyPick = false;
      for (let i = 0; i < order.length; i++) {
        const team = order[i];
        if (!teamNeedsPick(team)) continue;
        anyPick = true;
        const upcoming = order.slice(i + 1).filter(teamNeedsPick);
        const isHuman = !!selectedTeamColor && team.color === selectedTeamColor;
        updateSnakeBar(team, upcoming, isHuman);
        if (isHuman) {
          humanTurnActive = true;
          render();
          await new Promise<void>((resolve) => {
            snakePickResolve = resolve;
          });
        } else {
          humanTurnActive = false;
          // Pause BEFORE making the pick, while the bar correctly shows this
          // team on the clock and the previous pick already in "Last picks".
          // Delaying after the pick instead would leave the recent-picks list
          // one behind for the whole pause (the pick only surfaced when the
          // next team came on the clock). Read the live delay each pick so
          // changing the segmented control mid-draft takes effect immediately.
          if (pickDelayMs > 0)
            await new Promise((r) => setTimeout(r, pickDelayMs));
          const pick = bestOverall(team, draftPool);
          if (pick) draftPlayer(team.color, pick.prospect.id);
          render();
        }
      }
      if (!anyPick) break;
      forward = !forward;
    }
  } finally {
    snakePickResolve = null;
    humanTurnActive = true;
    snakeDraftActive = false;
    hideSnakeBar();
  }
}

// ── Snake-draft status — rendered inside #gtb-status in the global top bar ──

function showSnakeBar() {
  const status = document.getElementById("gtb-status");
  if (status) status.style.display = "flex";
}

function hideSnakeBar() {
  if (isDraftComplete()) return; // showRecap() owns the status area now
  const status = document.getElementById("gtb-status");
  if (status) status.style.display = "none";
}

function updateSnakeBar(current: Team, upcoming: Team[], isHuman: boolean) {
  const status = document.getElementById("gtb-status");
  if (!status) return;

  const onClock =
    `<div class="snake-bar-onclock${isHuman ? " snake-bar-you" : ""}">` +
    `<span class="snake-bar-tag">${isHuman ? "YOUR PICK" : "ON THE CLOCK"}</span>` +
    `<span class="snake-bar-team" style="color:${current.color}">${current.name}</span>` +
    `</div>`;

  const next = upcoming.slice(0, 3);
  const nextUp = next.length
    ? `<div class="snake-bar-next"><span class="snake-bar-label">Next</span>` +
      next
        .map(
          (t) =>
            `<span class="snake-bar-chip" style="color:${t.color}">${t.name}</span>`,
        )
        .join("") +
      `</div>`
    : "";

  const picks = getRecentPicks(5);
  const recent = picks.length
    ? `<div class="snake-bar-recent"><span class="snake-bar-label">Last picks</span>` +
      picks
        .map((p) => {
          const team = LEAGUE.find((t) => t.color === p.color);
          return (
            `<span class="snake-bar-pick">` +
            `<span class="snake-bar-pick-label">${p.label}</span> ` +
            `<span style="color:${team?.color ?? "#fff"}">${p.name}</span>` +
            `</span>`
          );
        })
        .join("") +
      `</div>`
    : "";

  status.innerHTML = onClock + nextUp + recent;
}

/** Fills all open label slots for a team with random available prospects. */
function autoDraftTeam(teamColor: string) {
  for (const label of PLAYER_LABELS) {
    const team = LEAGUE.find((t) => t.color === teamColor);
    if (!team || hasLabel(team, label)) continue;
    const available = draftPool.filter((p) => p.label === label);
    if (available.length === 0) continue;
    const pick = available[Math.floor(Math.random() * available.length)];
    draftPlayer(teamColor, pick.id);
  }
}

/**
 * Four "best prospect" cards. Rather than force one player per category (which
 * mislabels a player as e.g. "best position rank" when the overall #1 actually
 * holds that too), we feature the top remaining player of each category —
 * Overall, Position Rank, Positional Drop, Percentile — as four DISTINCT
 * players, then annotate each with every category it truly ranks top-4 in. So
 * a player who leads several categories shows all of them, and the other cards
 * surface genuinely different standouts.
 */
function renderBestProspects() {
  const container = document.getElementById("draft-best-prospects");
  if (!container) return;
  container.innerHTML = "";
  if (draftPool.length === 0) return;

  // Position rank: rank each pool player against ALL players at their position
  // (pool + already drafted), so a #2 QB stays #2 even after the #1 QB is
  // picked.
  const posRankOf = (p: DraftProspect): number => {
    const everyone = [
      ...draftPool.filter((q) => q.label === p.label),
      ...LEAGUE.flatMap((t) => t.roster.filter((r) => r.label === p.label)),
    ];
    const myScore = scoreProspect(p);
    return everyone.filter((q) => scoreProspect(q) > myScore).length + 1;
  };

  // Positional drop: only the top remaining player at each position "has" a
  // drop — the score gap down to the next-best remaining player at that spot
  // (how much value is lost by not taking them now). Everyone else is 0.
  const dropGapById = new Map<number, number>();
  {
    const byLabel = new Map<Label, DraftProspect[]>();
    for (const p of draftPool) {
      const l = p.label as Label;
      if (!byLabel.has(l)) byLabel.set(l, []);
      byLabel.get(l)!.push(p);
    }
    for (const grp of byLabel.values()) {
      grp.sort((a, b) => scoreProspect(b) - scoreProspect(a));
      const gap =
        grp.length > 1 ? scoreProspect(grp[0]) - scoreProspect(grp[1]) : 0;
      dropGapById.set(grp[0].id, gap);
    }
  }

  type Cand = {
    prospect: DraftProspect;
    score: number;
    posRank: number;
    dropGap: number;
    percentile: number;
  };
  const cands: Cand[] = draftPool.map((p) => {
    const score = scoreProspect(p);
    return {
      prospect: p,
      score,
      posRank: posRankOf(p),
      dropGap: dropGapById.get(p.id) ?? 0,
      // Draft-day (week 0) percentile — position-normalized, so it can crown a
      // different standout than raw overall.
      percentile: overallPercentile(p.label as Label, score * 100, 0),
    };
  });

  // Each category is a full ordering of the remaining pool; a player's "rank"
  // in a category is their 1-based position in that ordering.
  const categories: { name: string; sorted: Cand[] }[] = [
    { name: "Overall", sorted: [...cands].sort((a, b) => b.score - a.score) },
    {
      name: "Pos Rank",
      sorted: [...cands].sort((a, b) =>
        a.posRank !== b.posRank ? a.posRank - b.posRank : b.score - a.score,
      ),
    },
    {
      name: "Percentile",
      sorted: [...cands].sort(
        (a, b) => b.percentile - a.percentile || b.score - a.score,
      ),
    },
    {
      name: "Drop",
      sorted: [...cands].sort(
        (a, b) => b.dropGap - a.dropGap || b.score - a.score,
      ),
    },
  ];
  const rankMaps = categories.map((c) => {
    const m = new Map<number, number>();
    c.sorted.forEach((cand, i) => m.set(cand.prospect.id, i + 1));
    return m;
  });

  // Feature the top remaining (not-yet-featured) player of each category, in
  // order — yielding up to four distinct standouts.
  const featured: DraftProspect[] = [];
  const featuredIds = new Set<number>();
  for (const cat of categories) {
    const pick = cat.sorted.find((c) => !featuredIds.has(c.prospect.id));
    if (pick) {
      featured.push(pick.prospect);
      featuredIds.add(pick.prospect.id);
    }
  }

  const selectedTeam =
    LEAGUE.find((t) => t.color === selectedTeamColor) ?? null;

  const header = document.createElement("div");
  header.className = "draft-best-header";

  const heading = document.createElement("h3");
  heading.className = "draft-heading";
  heading.textContent = "Best Prospects Remaining";
  header.appendChild(heading);

  // "Best single pick" behaves exactly like a Draft button, but auto-selects
  // the best available player for the user's team: usable only on the user
  // team's own clock, and it advances the snake draft like any manual pick.
  const bestPick = selectedTeam ? bestOverall(selectedTeam, draftPool) : null;
  const bestBtn = document.createElement("button");
  bestBtn.className = "draft-best-pick-btn";
  bestBtn.textContent = "Best single pick";
  bestBtn.disabled = !canUserDraftNow() || !bestPick;
  bestBtn.addEventListener("click", () => {
    if (!bestPick) return;
    if (draftPlayer(selectedTeamColor, bestPick.prospect.id)) {
      render();
      resolveSnakePick();
    }
  });
  header.appendChild(bestBtn);

  container.appendChild(header);

  const cards = document.createElement("div");
  cards.className = "best-prospects-cards";

  for (const prospect of featured) {
    const card = document.createElement("div");
    card.className = "best-prospect-card";

    const posNameEl = document.createElement("div");
    posNameEl.className = "bp-pos-name";
    posNameEl.innerHTML =
      `<span class="bp-pos">${prospect.label}</span>` +
      `<span class="bp-name">${prospect.name}</span>`;

    const ovrEl = document.createElement("div");
    ovrEl.className = "bp-ovr";
    ovrEl.innerHTML = playerOvrDisplay(prospect);

    // Every category this player ranks top-4 in — its true standing, so a
    // player leading several categories shows all of them accurately.
    const badgesEl = document.createElement("div");
    badgesEl.className = "bp-badges";
    badgesEl.innerHTML = categories
      .map((cat, i) => ({
        name: cat.name,
        rank: rankMaps[i].get(prospect.id)!,
      }))
      .filter((b) => b.rank <= 4)
      .map(
        (b) =>
          `<span class="bp-badge">${formatRank(b.rank)}` +
          `<span class="bp-badge-cat">${b.name}</span></span>`,
      )
      .join("");

    const btn = document.createElement("button");
    btn.className = "draft-prospect-btn";
    btn.textContent = "Draft";
    btn.disabled =
      !canUserDraftNow() ||
      (selectedTeam ? hasLabel(selectedTeam, prospect.label as Label) : false);
    btn.addEventListener("click", () => {
      if (draftPlayer(selectedTeamColor, prospect.id)) {
        render();
        resolveSnakePick();
      }
    });

    card.append(posNameEl, ovrEl, badgesEl, btn);
    cards.appendChild(card);
  }

  container.appendChild(cards);
}

/** Single-team roster view with prev/next navigation across all 8 teams. */
function renderRosters() {
  const container = document.getElementById("draft-rosters")!;
  container.innerHTML = "";
  syncSortButtons();

  const team = LEAGUE[rosterViewIdx];

  // Navigation row — shared team-toggle styling (◀ NAME ▶ … OVR)
  const nav = document.createElement("div");
  nav.className = "team-toggle";

  const prevBtn = document.createElement("button");
  prevBtn.className = "team-toggle-btn";
  prevBtn.textContent = "◀";
  prevBtn.addEventListener("click", () => {
    rosterViewIdx = (rosterViewIdx - 1 + LEAGUE.length) % LEAGUE.length;
    render();
  });

  const teamLabel = document.createElement("span");
  teamLabel.className = "team-toggle-name";
  teamLabel.style.color = team.color;
  teamLabel.textContent = team.name;

  const nextBtn = document.createElement("button");
  nextBtn.className = "team-toggle-btn";
  nextBtn.textContent = "▶";
  nextBtn.addEventListener("click", () => {
    rosterViewIdx = (rosterViewIdx + 1) % LEAGUE.length;
    render();
  });

  const ovrLabel = document.createElement("span");
  ovrLabel.className = "team-toggle-ovr";
  ovrLabel.innerHTML = `OVR ${teamOvrDisplay(team)}`;

  nav.append(prevBtn, teamLabel, nextBtn, ovrLabel);
  container.appendChild(nav);

  const card = buildRosterCard(team, {
    slotSort: rosterSort,
    isUserTeam: team.color === selectedTeamColor,
    onSeeProspects: (label) => {
      poolFilter = label;
      render();
      document
        .getElementById("draft-pool")
        ?.scrollIntoView({ behavior: "smooth" });
    },
  });
  container.appendChild(card);
}

/** Available prospects with a position carousel filter at the top. */
function renderPool() {
  const container = document.getElementById("draft-pool")!;
  container.innerHTML = "";

  const team = LEAGUE.find((t) => t.color === selectedTeamColor) ?? null;

  // ── Carousel header ──────────────────────────────────────────────────────
  const filterIdx = POOL_FILTERS.indexOf(poolFilter);
  const prospects =
    poolFilter === "ALL"
      ? [...draftPool].sort((a, b) => scoreProspect(b) - scoreProspect(a))
      : draftPool
          .filter((p) => p.label === poolFilter)
          .sort((a, b) => scoreProspect(b) - scoreProspect(a));

  const avgOvr =
    prospects.length > 0
      ? (
          (prospects.reduce((s, p) => s + scoreProspect(p), 0) /
            prospects.length) *
          100
        ).toFixed(1)
      : null;

  const slotFilled =
    poolFilter !== "ALL" && team ? hasLabel(team, poolFilter as Label) : false;

  const carousel = document.createElement("div");
  carousel.className = "draft-pool-carousel";

  const prevBtn = document.createElement("button");
  prevBtn.className = "draft-carousel-btn";
  prevBtn.textContent = "‹";
  prevBtn.addEventListener("click", () => {
    poolFilter =
      POOL_FILTERS[(filterIdx - 1 + POOL_FILTERS.length) % POOL_FILTERS.length];
    render();
  });

  const labelSpan = document.createElement("span");
  labelSpan.className = "draft-carousel-label" + (slotFilled ? " filled" : "");
  labelSpan.textContent = poolFilter === "ALL" ? "ALL" : poolFilter;

  const nextBtn = document.createElement("button");
  nextBtn.className = "draft-carousel-btn";
  nextBtn.textContent = "›";
  nextBtn.addEventListener("click", () => {
    poolFilter = POOL_FILTERS[(filterIdx + 1) % POOL_FILTERS.length];
    render();
  });

  const infoSpan = document.createElement("span");
  infoSpan.className = "draft-carousel-info";
  if (avgOvr !== null)
    infoSpan.textContent = `avg ${avgOvr}  ·  ${prospects.length} available`;

  carousel.append(prevBtn, labelSpan, nextBtn, infoSpan);
  container.appendChild(carousel);

  if (prospects.length === 0) {
    const empty = document.createElement("p");
    empty.className = "draft-pool-empty";
    empty.textContent =
      poolFilter === "ALL"
        ? "Draft pool is empty."
        : `No ${poolFilter} available.`;
    container.appendChild(empty);
    return;
  }

  // ── Table ────────────────────────────────────────────────────────────────
  const showAll = poolFilter === "ALL";
  const attrs = showAll
    ? []
    : (ROLE_ATTRIBUTES[labelToRole(poolFilter as Label)] ?? []);

  const scroll = document.createElement("div");
  scroll.className = "draft-pool-scroll";

  const table = document.createElement("table");
  table.className = "dash-table";

  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");
  headerRow.innerHTML =
    `<th class="dash-th"></th>` +
    `<th class="dash-th">OVR</th>` +
    (showAll ? `<th class="dash-th">POS</th>` : "") +
    `<th class="dash-th dash-th-label">Name</th>` +
    (showAll
      ? `<th class="dash-th"></th>`
      : attrs
          .map((a) => `<th class="dash-th">${ATTR_LABELS[a] ?? a}</th>`)
          .join("")) +
    `<th class="dash-th"></th>`;
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  for (const prospect of prospects) {
    const prospectLabel = prospect.label as Label;
    const prospectSlotFilled = team ? hasLabel(team, prospectLabel) : false;
    const row = document.createElement("tr");
    row.className = "dash-row";

    // Star
    const starCell = document.createElement("td");
    starCell.className = "dash-td";
    const starBtn = document.createElement("button");
    starBtn.className = "draft-star-btn" + (prospect.starred ? " starred" : "");
    starBtn.textContent = prospect.starred ? "★" : "☆";
    starBtn.addEventListener("click", () => {
      prospect.starred = !prospect.starred;
      starBtn.textContent = prospect.starred ? "★" : "☆";
      starBtn.classList.toggle("starred", prospect.starred);
      nameCell.className =
        "dash-td-label" + (prospect.starred ? " draft-starred-name" : "");
    });
    starCell.appendChild(starBtn);
    row.appendChild(starCell);

    // OVR
    const scoreCell = document.createElement("td");
    scoreCell.className = "dash-td draft-ovr";
    scoreCell.innerHTML = playerOvrDisplay(prospect);
    row.appendChild(scoreCell);

    // Position (ALL mode only)
    if (showAll) {
      const posCell = document.createElement("td");
      posCell.className = "dash-td";
      posCell.textContent = prospect.label;
      row.appendChild(posCell);
    }

    // Name
    const nameCell = document.createElement("td");
    nameCell.className =
      "dash-td-label" + (prospect.starred ? " draft-starred-name" : "");
    nameCell.textContent = prospect.name;
    row.appendChild(nameCell);

    // Attributes
    if (showAll) {
      const role = labelToRole(prospectLabel);
      const roleAttrs = (ROLE_ATTRIBUTES[role] ??
        []) as (keyof typeof ATTR_SHORT_LABELS)[];
      const sorted = roleAttrs
        .map((attr) => ({
          attr,
          proximity: getProximity(attr, prospect.ratings[attr] ?? 0),
          ratingPct: Math.round((prospect.ratings[attr] ?? 0) * 100),
        }))
        .sort((a, b) => b.proximity - a.proximity);
      const td = document.createElement("td");
      td.className = "dash-td";
      const inner = document.createElement("div");
      inner.className = "pool-all-attrs";
      inner.innerHTML = sorted
        .map(({ attr, ratingPct }) => {
          const { grade, color } = getLetterGrade(attr, ratingPct);
          return `<span class="slot-attr-chip"><span class="slot-grade" style="color:${color}">${grade}</span><span class="slot-attr-name">${ATTR_SHORT_LABELS[attr] ?? attr}</span></span>`;
        })
        .join("");
      td.appendChild(inner);
      row.appendChild(td);
    } else {
      for (const attr of attrs) {
        const td = document.createElement("td");
        td.className = "dash-td";
        const ratingPct = Math.round((prospect.ratings[attr] ?? 0.5) * 100);
        const { grade, color } = getLetterGrade(attr, ratingPct);
        td.innerHTML = `<span class="dash-grade-badge" style="color:${color}">${grade}</span><span class="draft-rating-num">${ratingPct}</span>`;
        row.appendChild(td);
      }
    }

    // Draft button
    const actionCell = document.createElement("td");
    actionCell.className = "dash-td";
    const btn = document.createElement("button");
    btn.className = "draft-prospect-btn";
    btn.textContent = "Draft";
    btn.disabled = !canUserDraftNow() || prospectSlotFilled;
    btn.addEventListener("click", () => {
      if (draftPlayer(selectedTeamColor, prospect.id)) {
        render();
        resolveSnakePick();
      }
    });
    actionCell.appendChild(btn);
    row.appendChild(actionCell);

    tbody.appendChild(row);
  }
  table.appendChild(tbody);
  scroll.appendChild(table);
  container.appendChild(scroll);
}

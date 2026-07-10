import { draftPlayer, draftPool, getRecentPicks, hasLabel } from "../core/draft";
import { bestOverall, scoreProspect } from "../core/draftEval";
import { getLetterGrade } from "../core/ratings";
import { LEAGUE } from "../core/state";
import { Label, PLAYER_LABELS, Team } from "../core/types";
import { labelToRole } from "../utils/roster";
import { ATTR_LABELS, ROLE_ATTRIBUTES } from "./playerAttrs";
import { playerOvrDisplay } from "./displayMode";
import { buildRosterCard } from "./rosterCard";

/** Set to true to auto-draft every team's full roster at startup. */
export const AUTO_DRAFTED = false;

let selectedTeamColor = "";
let snakePickResolve: (() => void) | null = null;

const POOL_FILTERS: (Label | "ALL")[] = ["ALL", ...PLAYER_LABELS];
let poolFilter: Label | "ALL" = "ALL";
let rosterSort: "pos" | "ovr" | "draft" = "pos";

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

/** Builds the draft tab: a team selector, the available-player pool, and every
 * team's roster. Re-renders after each pick. */
export function setupDraft() {
  const teamSelect = document.getElementById(
    "draft-team-select",
  ) as HTMLSelectElement;
  if (!teamSelect) return;

  const noneOpt = document.createElement("option");
  noneOpt.value = "";
  noneOpt.textContent = "NONE";
  teamSelect.appendChild(noneOpt);

  for (const team of LEAGUE) {
    const opt = document.createElement("option");
    opt.value = team.color;
    opt.textContent = team.name;
    teamSelect.appendChild(opt);
  }

  selectedTeamColor = "";
  teamSelect.value = selectedTeamColor;
  teamSelect.addEventListener("change", () => {
    selectedTeamColor = teamSelect.value;
    render();
  });

  const delayInput = document.createElement("input");
  delayInput.type = "number";
  delayInput.min = "0";
  delayInput.max = "2000";
  delayInput.step = "50";
  delayInput.value = "10";
  delayInput.className = "dash-inline-number";
  delayInput.title = "Delay between snake draft picks (ms)";

  const delayLabel = document.createElement("label");
  delayLabel.textContent = "Pick delay (ms)";
  delayLabel.style.cssText =
    "font-size:13px;color:#9ca3af;display:flex;align-items:center;gap:6px;";
  delayLabel.appendChild(delayInput);

  const snakeBtn = document.createElement("button");
  snakeBtn.className = "draft-auto-btn";
  snakeBtn.style.whiteSpace = "nowrap";
  snakeBtn.textContent = "Snake Draft All";
  snakeBtn.addEventListener("click", async () => {
    snakeBtn.disabled = true;
    snakeBtn.textContent = "Drafting…";
    await snakeDraftAll(Number(delayInput.value));
    snakeBtn.disabled = false;
    snakeBtn.textContent = "Snake Draft All";
  });

  const controls = document.querySelector(".draft-controls");
  controls?.appendChild(delayLabel);
  controls?.appendChild(snakeBtn);

  if (AUTO_DRAFTED) {
    for (const team of LEAGUE) autoDraftTeam(team.color);
  }

  render();
}

/** Re-renders the draft tab (e.g. after the global ratings/rankings toggle). */
export function rerenderDraft() {
  render();
}

function render() {
  renderPool();
  renderRosters();
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
async function snakeDraftAll(delayMs: number) {
  showSnakeBar();
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
          // Human's turn — highlight and wait for them to make a pick
          render();
          await new Promise<void>((resolve) => { snakePickResolve = resolve; });
        } else {
          const pick = bestOverall(team, draftPool);
          if (pick) draftPlayer(team.color, pick.prospect.id);
          render();
          if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
        }
      }
      if (!anyPick) break;
      forward = !forward;
    }
  } finally {
    snakePickResolve = null;
    hideSnakeBar();
  }
}

// ── Frozen snake-draft status bar ───────────────────────────────────────────

let snakeBar: HTMLDivElement | null = null;

function showSnakeBar() {
  if (!snakeBar) {
    snakeBar = document.createElement("div");
    snakeBar.className = "snake-bar";
    document.body.appendChild(snakeBar);
  }
  snakeBar.style.display = "flex";
  document.body.classList.add("snake-bar-active");
}

function hideSnakeBar() {
  if (snakeBar) snakeBar.style.display = "none";
  document.body.classList.remove("snake-bar-active");
}

function updateSnakeBar(current: Team, upcoming: Team[], isHuman: boolean) {
  if (!snakeBar) return;

  const onClock =
    `<div class="snake-bar-onclock${isHuman ? " snake-bar-you" : ""}">` +
    `<span class="snake-bar-tag">${isHuman ? "YOUR PICK" : "ON THE CLOCK"}</span>` +
    `<span class="snake-bar-team" style="color:${current.color}">${current.name}</span>` +
    `<span class="snake-bar-slots">${current.roster.length}/${PLAYER_LABELS.length}</span>` +
    `</div>`;

  const next = upcoming.slice(0, 3);
  const nextUp = next.length
    ? `<div class="snake-bar-next"><span class="snake-bar-label">Next</span>` +
      next
        .map((t) => `<span class="snake-bar-chip" style="color:${t.color}">${t.name}</span>`)
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

  snakeBar.innerHTML = onClock + nextUp + recent;
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
          (prospects.reduce((s, p) => s + scoreProspect(p), 0) / prospects.length) *
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
    poolFilter = POOL_FILTERS[(filterIdx - 1 + POOL_FILTERS.length) % POOL_FILTERS.length];
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
    empty.textContent = poolFilter === "ALL" ? "Draft pool is empty." : `No ${poolFilter} available.`;
    container.appendChild(empty);
    return;
  }

  // ── Table ────────────────────────────────────────────────────────────────
  const showAll = poolFilter === "ALL";
  const attrs = showAll ? [] : (ROLE_ATTRIBUTES[labelToRole(poolFilter as Label)] ?? []);

  const table = document.createElement("table");
  table.className = "dash-table";

  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");
  headerRow.innerHTML =
    `<th class="dash-th"></th>` +
    `<th class="dash-th">OVR</th>` +
    (showAll ? `<th class="dash-th">POS</th>` : "") +
    `<th class="dash-th dash-th-label">Name</th>` +
    attrs.map((a) => `<th class="dash-th">${ATTR_LABELS[a] ?? a}</th>`).join("") +
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
      nameCell.className = "dash-td-label" + (prospect.starred ? " draft-starred-name" : "");
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
    nameCell.className = "dash-td-label" + (prospect.starred ? " draft-starred-name" : "");
    nameCell.textContent = prospect.name;
    row.appendChild(nameCell);

    // Attributes (label-specific mode only)
    for (const attr of attrs) {
      const td = document.createElement("td");
      td.className = "dash-td";
      const ratingPct = Math.round((prospect.ratings[attr] ?? 0.5) * 100);
      const { grade, color } = getLetterGrade(attr, ratingPct);
      td.innerHTML = `<span class="dash-grade-badge" style="color:${color}">${grade}</span><span class="draft-rating-num">${ratingPct}</span>`;
      row.appendChild(td);
    }

    // Draft button
    const actionCell = document.createElement("td");
    actionCell.className = "dash-td";
    const btn = document.createElement("button");
    btn.className = "draft-prospect-btn";
    btn.textContent = "Draft";
    btn.disabled = prospectSlotFilled || !selectedTeamColor;
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
  container.appendChild(table);
}

/** All 8 rosters, one card per team, with every label slot shown. */
function renderRosters() {
  const container = document.getElementById("draft-rosters")!;
  container.innerHTML = "";

  // ── Sort toggle ───────────────────────────────────────────────────────────
  const sortBar = document.createElement("div");
  sortBar.className = "draft-sort-bar";
  const sortLabel = document.createElement("span");
  sortLabel.className = "draft-sort-label";
  sortLabel.textContent = "Sort:";
  sortBar.appendChild(sortLabel);

  for (const mode of ["pos", "ovr", "draft"] as const) {
    const btn = document.createElement("button");
    btn.className = "draft-sort-btn" + (rosterSort === mode ? " active" : "");
    btn.textContent = mode === "pos" ? "Pos" : mode === "ovr" ? "OVR" : "Draft";
    btn.addEventListener("click", () => { rosterSort = mode; render(); });
    sortBar.appendChild(btn);
  }
  container.appendChild(sortBar);

  // ── Cards ─────────────────────────────────────────────────────────────────
  const grid = document.createElement("div");
  grid.id = "draft-rosters-grid";
  for (const team of LEAGUE) {
    const autoBtn = document.createElement("button");
    autoBtn.className = "draft-auto-btn";
    autoBtn.textContent = "Randomly select all";
    autoBtn.addEventListener("click", () => { autoDraftTeam(team.color); render(); });

    const bestBtn = document.createElement("button");
    bestBtn.className = "draft-auto-btn";
    bestBtn.textContent = "Best single pick";
    bestBtn.addEventListener("click", () => {
      const pick = bestOverall(team, draftPool);
      if (pick) draftPlayer(team.color, pick.prospect.id);
      render();
    });

    const card = buildRosterCard(team, {
      actionButtons: [autoBtn, bestBtn],
      slotSort: rosterSort,
    });
    grid.appendChild(card);
  }
  container.appendChild(grid);
}

import { DraftProspect, draftPlayer, draftPool, getRecentPicks, hasLabel } from "../core/draft";
import { bestOverall, scoreProspect } from "../core/draftEval";
import { getLetterGrade, getProximity } from "../core/ratings";
import { LEAGUE } from "../core/state";
import { captureTrainingBaseline } from "../core/training";
import { Label, PLAYER_LABELS, Team } from "../core/types";
import { labelToRole } from "../utils/roster";
import { ATTR_LABELS, ATTR_SHORT_LABELS, ROLE_ATTRIBUTES } from "./playerAttrs";
import { playerOvrDisplay, teamOvrDisplay } from "./displayMode";
import { buildRosterCard } from "./rosterCard";
import { showTabs } from "./tabs";

/** Set to true to auto-draft every team's full roster at startup. */
export const AUTO_DRAFTED = false;

let selectedTeamColor = "";
let snakePickResolve: (() => void) | null = null;
let rosterViewIdx = 0;
let humanTurnActive = true; // false only while an AI team is picking in snake draft

const POOL_FILTERS: (Label | "ALL")[] = ["ALL", ...PLAYER_LABELS];
let poolFilter: Label | "ALL" = "ALL";
let rosterSort: "pos" | "ovr" | "draft" = "pos";
let onRosterSortChange: (() => void) | null = null;

export function getRosterSort(): "pos" | "ovr" | "draft" { return rosterSort; }
export function onRosterSort(cb: () => void) { onRosterSortChange = cb; }

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
    if (selectedTeamColor) {
      const idx = LEAGUE.findIndex((t) => t.color === selectedTeamColor);
      if (idx >= 0) rosterViewIdx = idx;
    }
    render();
  });

  // Move the "Drafting for" control block into the global top bar
  const draftControls = document.querySelector<HTMLElement>(".draft-controls");
  const gtbTeamSelect = document.getElementById("gtb-team-select");
  if (draftControls && gtbTeamSelect) gtbTeamSelect.appendChild(draftControls);

  // Snake draft controls → global top bar
  const delayInput = document.createElement("input");
  delayInput.type = "number";
  delayInput.min = "0";
  delayInput.max = "2000";
  delayInput.step = "50";
  delayInput.value = "10";
  delayInput.className = "dash-inline-number";
  delayInput.title = "Delay between snake draft picks (ms)";

  const delayLabel = document.createElement("label");
  delayLabel.className = "gtb-delay-label";
  delayLabel.textContent = "Pick delay (ms)";
  delayLabel.appendChild(delayInput);

  const snakeBtn = document.createElement("button");
  snakeBtn.id = "gtb-snake-draft-btn";
  snakeBtn.className = "gtb-btn";
  snakeBtn.textContent = "Snake Draft All";
  snakeBtn.addEventListener("click", async () => {
    snakeBtn.disabled = true;
    snakeBtn.textContent = "Drafting…";
    await snakeDraftAll(Number(delayInput.value));
    snakeBtn.disabled = false;
    snakeBtn.textContent = "Snake Draft All";
  });

  const snakeBtnArea = document.getElementById("gtb-snake-btn");
  snakeBtnArea?.append(snakeBtn, delayLabel);

  // Sort buttons → global bottom bar
  const sortBtns = document.querySelectorAll<HTMLButtonElement>("#gbb-sort .draft-sort-btn");
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

function syncSortButtons() {
  document.querySelectorAll<HTMLButtonElement>("#gbb-sort .draft-sort-btn").forEach((btn) => {
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
  document.querySelector<HTMLElement>(".draft-controls")!.style.display = "none";
  const recap = document.getElementById("draft-recap")!;
  recap.style.display = "";

  const grid = document.getElementById("draft-recap-rosters")!;
  grid.innerHTML = "";
  syncSortButtons();
  for (const team of LEAGUE) {
    grid.appendChild(buildRosterCard(team, { slotSort: rosterSort }));
  }

  // Move "Start Season" into the global top bar, replacing the snake draft button
  const snakeBtnArea = document.getElementById("gtb-snake-btn");
  if (snakeBtnArea) snakeBtnArea.style.display = "none";

  const statusArea = document.getElementById("gtb-status");
  if (statusArea) {
    statusArea.style.display = "flex";
    statusArea.innerHTML =
      `<button id="draft-advance-btn" class="gtb-btn gtb-btn-advance">Start Season →</button>`;
    document.getElementById("draft-advance-btn")?.addEventListener("click", () => {
      // Snapshot final rosters as the training baseline for development tracking.
      captureTrainingBaseline();
      document.getElementById("draft-screen")!.style.display = "none";
      statusArea.style.display = "none";
      showTabs("tab-schedule");
    }, { once: true });
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
          humanTurnActive = true;
          render();
          await new Promise<void>((resolve) => { snakePickResolve = resolve; });
        } else {
          humanTurnActive = false;
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
    humanTurnActive = true;
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
    `<span class="snake-bar-slots">${current.roster.length}/${PLAYER_LABELS.length}</span>` +
    `</div>`;

  const next = upcoming.slice(0, 3);
  const nextUp = next.length
    ? `<div class="snake-bar-next"><span class="snake-bar-label">Next</span>` +
      next.map((t) => `<span class="snake-bar-chip" style="color:${t.color}">${t.name}</span>`).join("") +
      `</div>`
    : "";

  const picks = getRecentPicks(5);
  const recent = picks.length
    ? `<div class="snake-bar-recent"><span class="snake-bar-label">Last picks</span>` +
      picks.map((p) => {
        const team = LEAGUE.find((t) => t.color === p.color);
        return (
          `<span class="snake-bar-pick">` +
          `<span class="snake-bar-pick-label">${p.label}</span> ` +
          `<span style="color:${team?.color ?? "#fff"}">${p.name}</span>` +
          `</span>`
        );
      }).join("") +
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

/** Three distinct "best prospect" cards: top OVR, top position rank, biggest positional drop. */
function renderBestProspects() {
  const container = document.getElementById("draft-best-prospects");
  if (!container) return;
  container.innerHTML = "";
  if (draftPool.length === 0) return;

  // Rank each pool player against ALL players at their position (pool + already drafted),
  // so a #2 QB stays #2 even after the #1 QB is picked.
  const globalRankOf = (p: DraftProspect): number => {
    const everyone = [
      ...draftPool.filter((q) => q.label === p.label),
      ...LEAGUE.flatMap((t) => t.roster.filter((r) => r.label === p.label)),
    ];
    const myScore = scoreProspect(p);
    return everyone.filter((q) => scoreProspect(q) > myScore).length + 1;
  };

  type Ranked = { prospect: DraftProspect; posRank: number; score: number };
  const poolRanked: Ranked[] = draftPool.map((p) => ({
    prospect: p,
    posRank: globalRankOf(p),
    score: scoreProspect(p),
  }));

  // TOP TALENT: highest OVR remaining in pool
  const byOvr = [...poolRanked].sort((a, b) => b.score - a.score);

  // TOP RANKED: lowest posRank remaining (posRank ASC, score DESC tiebreak)
  const byPosRank = [...poolRanked].sort((a, b) =>
    a.posRank !== b.posRank ? a.posRank - b.posRank : b.score - a.score,
  );

  const used = new Set<number>();
  const picks: Array<{ prospect: DraftProspect; tag: string; sub: string }> = [];

  const pickFirst = (sorted: Ranked[], tag: string, sub: string) => {
    const c = sorted.find((x) => !used.has(x.prospect.id));
    if (c) { picks.push({ prospect: c.prospect, tag, sub }); used.add(c.prospect.id); }
  };

  pickFirst(byOvr,     "TOP TALENT",   "Highest overall");
  pickFirst(byPosRank, "TOP RANKED",   "Best position rank");

  // NOW OR NEVER: computed on what remains after TOP TALENT and TOP RANKED are set aside.
  // For each remaining player, gap = their score minus the next-lower-ranked remaining
  // player at the same position. Pick the player with the biggest such gap.
  // NOW OR NEVER: for each position, take only its top remaining player and compute
  // the gap to the next remaining player at that position. The position with the
  // biggest such gap wins — and the card shows that position's top player.
  const remaining = poolRanked.filter((r) => !used.has(r.prospect.id));
  const remByLabel = new Map<Label, Ranked[]>();
  for (const r of remaining) {
    const l = r.prospect.label as Label;
    if (!remByLabel.has(l)) remByLabel.set(l, []);
    remByLabel.get(l)!.push(r);
  }
  const nowOrNeverCands: (Ranked & { gap: number })[] = [];
  for (const grp of remByLabel.values()) {
    grp.sort((a, b) => a.posRank - b.posRank);
    const top = grp[0];
    const gap = grp.length > 1 ? top.score - grp[1].score : 0;
    nowOrNeverCands.push({ ...top, gap });
  }
  const byGap = nowOrNeverCands.sort((a, b) => b.gap - a.gap);
  pickFirst(byGap, "NOW OR NEVER", "Biggest position drop");

  const heading = document.createElement("h3");
  heading.className = "draft-heading";
  heading.textContent = "Best Prospects Remaining";
  container.appendChild(heading);

  const cards = document.createElement("div");
  cards.className = "best-prospects-cards";

  const selectedTeam = LEAGUE.find((t) => t.color === selectedTeamColor) ?? null;

  for (const { prospect, tag, sub } of picks) {
    const card = document.createElement("div");
    card.className = "best-prospect-card";

    const tagEl = document.createElement("div");
    tagEl.className = "bp-tag";
    tagEl.textContent = tag;

    const subEl = document.createElement("div");
    subEl.className = "bp-sub";
    subEl.textContent = sub;

    const posNameEl = document.createElement("div");
    posNameEl.className = "bp-pos-name";
    posNameEl.innerHTML =
      `<span class="bp-pos">${prospect.label}</span>` +
      `<span class="bp-name">${prospect.name}</span>`;

    const ovrEl = document.createElement("div");
    ovrEl.className = "bp-ovr";
    ovrEl.innerHTML = playerOvrDisplay(prospect);

    const btn = document.createElement("button");
    btn.className = "draft-prospect-btn";
    btn.textContent = "Draft";
    btn.disabled = !selectedTeamColor || !humanTurnActive || (selectedTeam ? hasLabel(selectedTeam, prospect.label as Label) : false);
    btn.addEventListener("click", () => {
      if (draftPlayer(selectedTeamColor, prospect.id)) { render(); resolveSnakePick(); }
    });

    card.append(tagEl, subEl, posNameEl, ovrEl, btn);
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
    onSeeProspects: (label) => {
      poolFilter = label;
      render();
      document.getElementById("draft-pool")?.scrollIntoView({ behavior: "smooth" });
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
    (showAll ? `<th class="dash-th"></th>` : attrs.map((a) => `<th class="dash-th">${ATTR_LABELS[a] ?? a}</th>`).join("")) +
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

    // Attributes
    if (showAll) {
      const role = labelToRole(prospectLabel);
      const roleAttrs = (ROLE_ATTRIBUTES[role] ?? []) as (keyof typeof ATTR_SHORT_LABELS)[];
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
    btn.disabled = !selectedTeamColor || !humanTurnActive || prospectSlotFilled;
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


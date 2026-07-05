import { draftPlayer, draftPool, hasLabel } from "../core/draft";
import { bestOverall, scoreProspect } from "../core/draftEval";
import { getLetterGrade } from "../core/ratings";
import { LEAGUE } from "../core/state";
import { Label, PLAYER_LABELS } from "../core/types";
import { labelToRole } from "../utils/roster";
import { ATTR_LABELS, ROLE_ATTRIBUTES } from "./playerAttrs";
import { buildRosterCard } from "./rosterCard";

/** Set to true to auto-draft every team's full roster at startup. */
export const AUTO_DRAFTED = false;

let selectedTeamColor = "";
let snakePickResolve: (() => void) | null = null;

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

function render() {
  renderPool();
  renderRosters();
}

/**
 * Runs a full snake draft using bestOverall (margin-based) picks until the pool
 * is exhausted. Order alternates each round: T1→T8, T8→T1, T1→T8, …
 */
async function snakeDraftAll(delayMs: number) {
  let forward = true;
  while (draftPool.length > 0) {
    const order = forward ? [...LEAGUE] : [...LEAGUE].reverse();
    let anyPick = false;
    for (const team of order) {
      if (!PLAYER_LABELS.some((l) => !hasLabel(team, l) && draftPool.some((p) => p.label === l))) continue;
      anyPick = true;
      if (selectedTeamColor && team.color === selectedTeamColor) {
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
  snakePickResolve = null;
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

/** Available prospects, grouped by label, shown as a stats table for comparison. */
function renderPool() {
  const container = document.getElementById("draft-pool")!;
  container.innerHTML = "";

  const team = LEAGUE.find((t) => t.color === selectedTeamColor) ?? null;

  for (const label of PLAYER_LABELS) {
    const prospects = draftPool
      .filter((p) => p.label === label)
      .sort((a, b) => scoreProspect(b) - scoreProspect(a));
    if (prospects.length === 0) continue;

    const slotFilled = team ? hasLabel(team, label) : false;
    const attrs = ROLE_ATTRIBUTES[labelToRole(label as Label)] ?? [];

    const section = document.createElement("div");
    section.className = "draft-pool-section";

    // Collapsed by default when the slot is already filled
    let collapsed = slotFilled;

    const labelEl = document.createElement("div");
    labelEl.className = "draft-pool-label draft-pool-toggle" + (slotFilled ? " filled" : "");
    labelEl.innerHTML =
      `<span class="draft-pool-toggle-arrow">${collapsed ? "▶" : "▼"}</span>` +
      `<span>${label}</span>` +
      `<span class="draft-pool-count">${prospects.length} available</span>`;
    section.appendChild(labelEl);

    const table = document.createElement("table");
    table.className = "dash-table";
    if (collapsed) table.style.display = "none";

    labelEl.addEventListener("click", () => {
      collapsed = !collapsed;
      table.style.display = collapsed ? "none" : "";
      (labelEl.querySelector(".draft-pool-toggle-arrow") as HTMLElement).textContent =
        collapsed ? "▶" : "▼";
    });

    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    headerRow.innerHTML =
      `<th class="dash-th"></th>` +
      `<th class="dash-th">OVR</th>` +
      `<th class="dash-th dash-th-label">Name</th>` +
      attrs
        .map((a) => `<th class="dash-th">${ATTR_LABELS[a] ?? a}</th>`)
        .join("") +
      `<th class="dash-th"></th>`;
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    for (const prospect of prospects) {
      const row = document.createElement("tr");
      row.className = "dash-row";

      const starCell = document.createElement("td");
      starCell.className = "dash-td";
      const starBtn = document.createElement("button");
      starBtn.className =
        "draft-star-btn" + (prospect.starred ? " starred" : "");
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

      const scoreCell = document.createElement("td");
      scoreCell.className = "dash-td draft-ovr";
      scoreCell.textContent = (scoreProspect(prospect) * 100).toFixed(1);
      row.appendChild(scoreCell);

      const nameCell = document.createElement("td");
      nameCell.className =
        "dash-td-label" + (prospect.starred ? " draft-starred-name" : "");
      nameCell.textContent = prospect.name;
      row.appendChild(nameCell);

      for (const attr of attrs) {
        const td = document.createElement("td");
        td.className = "dash-td";
        const ratingPct = Math.round((prospect.ratings[attr] ?? 0.5) * 100);
        const { grade, color } = getLetterGrade(attr, ratingPct);
        td.innerHTML = `<span class="dash-grade-badge" style="color:${color}">${grade}</span><span class="draft-rating-num">${ratingPct}</span>`;
        row.appendChild(td);
      }

      const actionCell = document.createElement("td");
      actionCell.className = "dash-td";
      const btn = document.createElement("button");
      btn.className = "draft-prospect-btn";
      btn.textContent = "Draft";
      btn.disabled = slotFilled || !selectedTeamColor;
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
    section.appendChild(table);
    container.appendChild(section);
  }
}

/** All 8 rosters, one card per team, with every label slot shown. */
function renderRosters() {
  const container = document.getElementById("draft-rosters")!;
  container.innerHTML = "";

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

    const card = buildRosterCard(team, { actionButtons: [autoBtn, bestBtn] });
    container.appendChild(card);
  }
}

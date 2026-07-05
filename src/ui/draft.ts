import { draftPlayer, draftPool, hasLabel } from "../core/draft";
import { bestOverall, scoreProspect } from "../core/draftEval";
import { getLetterGrade } from "../core/ratings";
import { LEAGUE } from "../core/state";
import { Label, PLAYER_LABELS } from "../core/types";
import { labelToRole } from "../utils/roster";
import { ATTR_LABELS, ROLE_ATTRIBUTES } from "./playerAttrs";

/** Set to true to auto-draft every team's full roster at startup. */
export const AUTO_DRAFTED = false;

let selectedTeamColor = "";

/** Builds the draft tab: a team selector, the available-player pool, and every
 * team's roster. Re-renders after each pick. */
export function setupDraft() {
  const teamSelect = document.getElementById(
    "draft-team-select",
  ) as HTMLSelectElement;
  if (!teamSelect) return;

  for (const team of LEAGUE) {
    const opt = document.createElement("option");
    opt.value = team.color;
    opt.textContent = team.name;
    teamSelect.appendChild(opt);
  }

  selectedTeamColor = LEAGUE[0].color;
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
      const pick = bestOverall(team, draftPool);
      if (pick) {
        draftPlayer(team.color, pick.prospect.id);
        anyPick = true;
        render();
        if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
      }
    }
    if (!anyPick) break;
    forward = !forward;
  }
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

  const team = LEAGUE.find((t) => t.color === selectedTeamColor)!;

  for (const label of PLAYER_LABELS) {
    const prospects = draftPool.filter((p) => p.label === label);
    if (prospects.length === 0) continue;

    const slotFilled = hasLabel(team, label);
    const attrs = ROLE_ATTRIBUTES[labelToRole(label as Label)] ?? [];

    const section = document.createElement("div");
    section.className = "draft-pool-section";

    const labelEl = document.createElement("div");
    labelEl.className = "draft-pool-label";
    labelEl.textContent = label;
    section.appendChild(labelEl);

    const table = document.createElement("table");
    table.className = "dash-table";

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
      btn.disabled = slotFilled;
      btn.addEventListener("click", () => {
        if (draftPlayer(selectedTeamColor, prospect.id)) render();
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
    const card = document.createElement("div");
    card.className = "draft-roster";

    const avgOvr =
      team.roster.length > 0
        ? (
            (team.roster.reduce((sum, rp) => sum + scoreProspect(rp), 0) /
              team.roster.length) *
            100
          ).toFixed(1)
        : "—";

    const header = document.createElement("div");
    header.className = "draft-roster-header";
    header.textContent = `${team.name} (${team.roster.length}/${PLAYER_LABELS.length}) · OVR ${avgOvr}`;
    header.style.color = team.color;
    card.appendChild(header);

    if (team.roster.length > 0) {
      const roleMap = new Map<string, number[]>();
      for (const rp of team.roster) {
        const role = labelToRole(rp.label);
        if (!roleMap.has(role)) roleMap.set(role, []);
        roleMap.get(role)!.push(scoreProspect(rp) * 100);
      }
      const roleOrder = ["passer", "runner", "catcher", "blocker", "rusher", "coverer"];
      const breakdown = document.createElement("div");
      breakdown.className = "draft-role-breakdown";
      breakdown.innerHTML = roleOrder
        .filter((r) => roleMap.has(r))
        .map((r) => {
          const scores = roleMap.get(r)!;
          const avg = (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1);
          return `<span class="draft-role-chip">${r}: ${avg}</span>`;
        })
        .join("");
      card.appendChild(breakdown);
    }

    const autoBtn = document.createElement("button");
    autoBtn.className = "draft-auto-btn";
    autoBtn.textContent = "Randomly select all";
    autoBtn.addEventListener("click", () => {
      autoDraftTeam(team.color);
      render();
    });
    card.appendChild(autoBtn);

    const bestBtn = document.createElement("button");
    bestBtn.className = "draft-auto-btn";
    bestBtn.textContent = "Best single pick";
    bestBtn.addEventListener("click", () => {
      const pick = bestOverall(team, draftPool);
      if (pick) draftPlayer(team.color, pick.prospect.id);
      render();
    });
    card.appendChild(bestBtn);

    for (const label of PLAYER_LABELS) {
      const rp = team.roster.find((r) => r.label === label);
      const slot = document.createElement("div");
      slot.className = "draft-roster-slot";
      const nameClass = rp?.starred
        ? "draft-slot-name draft-starred-name"
        : "draft-slot-name";
      const nameText = rp
        ? `${rp.name} (${(scoreProspect(rp) * 100).toFixed(1)})`
        : "—";
      slot.innerHTML = `<span class="draft-slot-label">${label}</span><span class="${nameClass}">${nameText}</span>`;
      card.appendChild(slot);
    }

    container.appendChild(card);
  }
}

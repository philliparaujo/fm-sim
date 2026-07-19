import { PLAYBOOK_CONFIG, TEAM_PLAYBOOKS } from "../core/playbook";
import { state } from "../sim";
import { getRosterSort } from "./draft";
import { buildRosterCard } from "./rosterCard";

let dashboardInitialized = false;
/** Which team's roster the Play-tab panel is currently showing (tab index). */
let activeTeamIdx = 0;

/** Builds the Play-tab roster panel: a team tab per side, showing one roster at
 * a time so the list stays short (small scrollbar). */
export function initDashboard() {
  activeTeamIdx = 0;
  dashboardInitialized = true;
  renderDashboard();
}

/** Re-renders the roster panel keeping the selected team tab — used after an
 * OVR-display or roster-sort toggle so the rosters reflect the new setting. */
export function rerenderDashboard() {
  if (!dashboardInitialized) return;
  renderDashboard();
}

function renderDashboard() {
  const container = document.getElementById("player-dashboard");
  if (!container) return;
  container.innerHTML = "";
  const teams = state.scoreboard?.teams;
  if (!teams || teams.length === 0) return;
  if (activeTeamIdx >= teams.length) activeTeamIdx = 0;

  // Team tabs — one per side.
  const tabs = document.createElement("div");
  tabs.className = "play-roster-tabs";
  teams.forEach((team, i) => {
    const tab = document.createElement("button");
    tab.className = "play-roster-tab" + (i === activeTeamIdx ? " active" : "");
    tab.textContent = team.name;
    tab.style.color = team.color;
    tab.addEventListener("click", () => {
      activeTeamIdx = i;
      renderDashboard();
    });
    tabs.appendChild(tab);
  });
  container.appendChild(tabs);

  // The selected team's roster. No OFF/DEF suffix here — the team tabs above
  // already identify the team, matching how rosters look elsewhere (draft,
  // training, season) and trimming an extra row to keep the scrollbar short.
  const team = teams[activeTeamIdx];
  const card = buildRosterCard(team, { slotSort: getRosterSort() });
  card.classList.add("play-roster");
  container.appendChild(card);

  updateDashboardValues();
}

/** Called after each play reset — syncs playbook sliders and the possession
 * badge on whichever team's roster is showing. */
export function updateDashboardValues() {
  if (!dashboardInitialized) return;
  if (!state.scoreboard?.teams) return;

  const offenseTeam = state.scoreboard.teams.find((t) => t.possessing);
  const defenseTeam = state.scoreboard.teams.find((t) => !t.possessing);

  if (offenseTeam) {
    PLAYBOOK_CONFIG.passPercent = TEAM_PLAYBOOKS[offenseTeam.color].passPercent;
    const ps = document.getElementById("pass-slider") as HTMLInputElement;
    const pl = document.getElementById("pass-label") as HTMLSpanElement;
    if (ps && pl) {
      ps.value = String(PLAYBOOK_CONFIG.passPercent);
      pl.textContent = `${PLAYBOOK_CONFIG.passPercent * 100}%`;
    }
  }

  if (defenseTeam) {
    PLAYBOOK_CONFIG.manPercent = TEAM_PLAYBOOKS[defenseTeam.color].manPercent;
    PLAYBOOK_CONFIG.blitzPercent =
      TEAM_PLAYBOOKS[defenseTeam.color].blitzPercent;
    const ms = document.getElementById("man-slider") as HTMLInputElement;
    const ml = document.getElementById("man-label") as HTMLSpanElement;
    if (ms && ml) {
      ms.value = String(PLAYBOOK_CONFIG.manPercent);
      ml.textContent = `${PLAYBOOK_CONFIG.manPercent * 100}%`;
    }
    const bs = document.getElementById("blitz-slider") as HTMLInputElement;
    const bl = document.getElementById("blitz-label") as HTMLSpanElement;
    if (bs && bl) {
      bs.value = String(PLAYBOOK_CONFIG.blitzPercent);
      bl.textContent = `${PLAYBOOK_CONFIG.blitzPercent * 100}%`;
    }
  }
}

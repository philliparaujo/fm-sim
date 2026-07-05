import { PLAYBOOK_CONFIG, TEAM_PLAYBOOKS } from "../core/playbook";
import { state } from "../sim";
import { buildRosterCard } from "./rosterCard";

let dashboardInitialized = false;

/** Renders the two playing teams' draft rosters side-by-side. */
export function initDashboard() {
  const container = document.getElementById("player-dashboard")!;
  container.innerHTML = "";
  if (!state.scoreboard?.teams) return;

  const wrap = document.createElement("div");
  wrap.className = "play-rosters-wrap";

  for (const team of state.scoreboard.teams) {
    const badge = `<span class="dash-possession-badge" data-team-badge="${team.color}"></span>`;
    const card = buildRosterCard(team, { headerSuffix: ` ${badge}` });
    card.classList.add("play-roster");
    wrap.appendChild(card);
  }

  container.appendChild(wrap);
  dashboardInitialized = true;
}

/** Called after each play reset — syncs playbook sliders and possession badges. */
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

  document.querySelectorAll("[data-team-badge]").forEach((el) => {
    const color = el.getAttribute("data-team-badge");
    const isPoss = state.scoreboard.teams.find(
      (t) => t.color === color,
    )?.possessing;
    el.textContent = isPoss ? "🏈 Off" : "🛡 Def";
  });
}

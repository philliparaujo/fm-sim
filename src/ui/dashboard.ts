import { PLAYBOOK_CONFIG, TEAM_PLAYBOOKS } from "../core/playbook";
import { scoreProspect } from "../core/draftEval";
import { PLAYER_LABELS } from "../core/types";
import { state } from "../sim";

let dashboardInitialized = false;

/** Renders the two playing teams' draft rosters side-by-side. */
export function initDashboard() {
  const container = document.getElementById("player-dashboard")!;
  container.innerHTML = "";
  if (!state.scoreboard?.teams) return;

  const wrap = document.createElement("div");
  wrap.className = "play-rosters-wrap";

  for (const team of state.scoreboard.teams) {
    const card = document.createElement("div");
    card.className = "draft-roster play-roster";

    const avgOvr =
      team.roster.length > 0
        ? (
            (team.roster.reduce((s, rp) => s + scoreProspect(rp), 0) /
              team.roster.length) *
            100
          ).toFixed(1)
        : "—";

    const header = document.createElement("div");
    header.className = "draft-roster-header";
    header.style.color = team.color;
    header.innerHTML =
      `${team.name} · OVR ${avgOvr} ` +
      `<span class="dash-possession-badge" data-team-badge="${team.color}"></span>`;
    card.appendChild(header);

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

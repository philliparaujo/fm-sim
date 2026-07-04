import { LEAGUE_TEAMS } from "../core/teams";
import { loadGame } from "../sim";
import { initDashboard, updateDashboardValues } from "./dashboard";

/** Populates two team dropdowns from the league and loads (auto-resets) a new
 * game whenever either selection changes. */
export function setupTeamPicker() {
  const sel0 = document.getElementById("team-select-0") as HTMLSelectElement;
  const sel1 = document.getElementById("team-select-1") as HTMLSelectElement;
  if (!sel0 || !sel1) return;

  for (const sel of [sel0, sel1]) {
    for (const team of LEAGUE_TEAMS) {
      const opt = document.createElement("option");
      opt.value = team.color;
      opt.textContent = team.name;
      sel.appendChild(opt);
    }
  }

  // Default to the opening matchup (first two teams)
  sel0.value = LEAGUE_TEAMS[0].color;
  sel1.value = LEAGUE_TEAMS[1].color;

  const load = () => {
    // Never let a team play itself — bump the second pick to another team
    if (sel1.value === sel0.value) {
      const other = LEAGUE_TEAMS.find((t) => t.color !== sel0.value)!;
      sel1.value = other.color;
    }

    loadGame(sel0.value, sel1.value); // sim: rebuild state for the two teams
    initDashboard(); // ui: rebuild the ratings tables for the new teams
    updateDashboardValues();
  };

  sel0.addEventListener("change", load);
  sel1.addEventListener("change", load);
}

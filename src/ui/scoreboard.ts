import { Scoreboard, Team } from "../core/types";
import { LOSToString, secondsToTimeString } from "../utils/units";

/** Fills in HTML elements using pre-existing scoreboard data */
export function updateScoreboardUI(data: Scoreboard) {
  // Sort by name so the two teams keep stable left/right slots even as
  // possession (and the underlying array order) flips between plays
  const teams = [...data.teams].sort((a, b) => a.name.localeCompare(b.name));
  teams.forEach((team, slot) => updateTeamSlot(slot, team));

  // Down & Distance
  document.getElementById("down-dist")!.textContent =
    `${data.down} & ${data.distance === "goal" ? "goal" : Math.round(data.distance)}`;

  // Yard Line
  document.getElementById("yard-line")!.textContent = LOSToString(data.LOS);

  // Clock and Quarter
  document.getElementById("game-clock")!.textContent = secondsToTimeString(
    data.time,
  );
  document.getElementById("quarter")!.textContent = data.quarter;
}

/** Fills one team slot (0 = left, 1 = right) with a team's live info */
function updateTeamSlot(slot: number, team: Team) {
  document.getElementById(`score-${slot}`)!.textContent = team.score.toString();
  document.getElementById(`name-${slot}`)!.textContent = team.name;

  // Fill the box with the team's color (colors are tuned for white text)
  document.getElementById(`team-${slot}`)!.style.background = team.color;

  updateTimeouts(`timeouts-${slot}`, team.timeouts);

  document
    .getElementById(`dot-${slot}`)!
    .classList.toggle("active", !!team.possessing);
}

/** Lights the first `count` timeout dashes yellow, the rest faded gray */
function updateTimeouts(containerId: string, count: number) {
  const dashes = document
    .getElementById(containerId)!
    .querySelectorAll(".timeout-dash");
  dashes.forEach((dash, i) => dash.classList.toggle("available", i < count));
}

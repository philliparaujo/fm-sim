import { Scoreboard } from "./types";
import { formatTime, LOSToString } from "./util";

function updateScoreboardUI(data: Scoreboard) {
  // 1. Update Scores
  document.getElementById("score-red")!.textContent =
    data.teams[0].score.toString();
  document.getElementById("score-blue")!.textContent =
    data.teams[1].score.toString();

  // 2. Update Team names
  document.getElementById("name-red")!.textContent = data.teams[0].name;
  document.getElementById("name-blue")!.textContent = data.teams[1].name;

  // 3. Update Down & Distance
  // Example: "1st & 10"
  document.getElementById("down-dist")!.textContent =
    `${data.down} & ${data.distance}`;

  // 4. Update Yard Line
  // Reuse your string conversion logic from earlier
  document.getElementById("yard-line")!.textContent = LOSToString(data.LOS);

  // 5. Update Clock and Quarter
  document.getElementById("game-clock")!.textContent = formatTime(data.time);
  document.getElementById("quarter")!.textContent = data.quarter;
}

export { updateScoreboardUI };

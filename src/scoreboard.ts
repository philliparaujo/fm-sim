import { Scoreboard } from "./core/types";
import { formatTime, LOSToString } from "./util";

export function updateScoreboardUI(data: Scoreboard) {
  const redTeam = data.teams[0].color === "red" ? data.teams[0] : data.teams[1];
  const blueTeam =
    data.teams[0].color === "blue" ? data.teams[0] : data.teams[1];

  // 1. Update Scores
  document.getElementById("score-red")!.textContent = redTeam.score.toString();
  document.getElementById("score-blue")!.textContent =
    blueTeam.score.toString();

  // 2. Update Team names
  document.getElementById("name-red")!.textContent = redTeam.name;
  document.getElementById("name-blue")!.textContent = blueTeam.name;

  // 3. Update Possession Dots
  const redDot = document.getElementById("dot-red")!;
  const blueDot = document.getElementById("dot-blue")!;

  if (redTeam.possessing) {
    redDot.classList.add("active");
    blueDot.classList.remove("active");
  } else if (blueTeam.possessing) {
    blueDot.classList.add("active");
    redDot.classList.remove("active");
  } else {
    // Safety fallback if neither has possession (e.g., between quarters/halftime)
    redDot.classList.remove("active");
    blueDot.classList.remove("active");
  }

  // 4. Update Down & Distance
  document.getElementById("down-dist")!.textContent =
    `${data.down} & ${data.distance === "goal" ? "goal" : Math.round(data.distance)}`;

  // 5. Update Yard Line
  document.getElementById("yard-line")!.textContent = LOSToString(data.LOS);

  // 6. Update Clock and Quarter
  document.getElementById("game-clock")!.textContent = formatTime(data.time);
  document.getElementById("quarter")!.textContent = data.quarter;
}

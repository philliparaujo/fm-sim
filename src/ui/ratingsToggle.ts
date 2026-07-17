import { OvrMode, ovrMode, setOvrMode } from "./displayMode";
import { rerenderDraft } from "./draft";
import { rerenderSchedule } from "./schedule";
import { rerenderStats } from "./stats";
import { rerenderTraining } from "./training";

const NEXT: Record<OvrMode, OvrMode> = {
  ratings: "rankings",
  rankings: "both",
  both: "percentile",
  percentile: "ratingPercentile",
  ratingPercentile: "ratings",
};
// Each label names the mode the button will switch TO when clicked.
const LABEL: Record<OvrMode, string> = {
  ratings: "Show Rankings",
  rankings: "Show Rating + Rank",
  both: "Show Percentiles",
  percentile: "Show Rating + Percentile",
  ratingPercentile: "Show Ratings",
};

const BTN_IDS = ["btn-ratings-toggle-draft"];

function syncButtons() {
  for (const id of BTN_IDS) {
    const btn = document.getElementById(id);
    if (!btn) continue;
    btn.textContent = LABEL[ovrMode];
    btn.classList.toggle("active", ovrMode !== "ratings");
  }
}

export function setupRatingsToggle() {
  for (const id of BTN_IDS) {
    document.getElementById(id)?.addEventListener("click", () => {
      setOvrMode(NEXT[ovrMode]);
      syncButtons();
      rerenderDraft();
      rerenderSchedule();
      rerenderStats();
      rerenderTraining();
    });
  }
  syncButtons();
}

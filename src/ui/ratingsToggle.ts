import { OvrMode, ovrMode, setOvrMode } from "./displayMode";
import { rerenderDraft } from "./draft";
import { rerenderSchedule } from "./schedule";
import { rerenderStats } from "./stats";

const NEXT: Record<OvrMode, OvrMode> = {
  ratings: "rankings",
  rankings: "both",
  both: "ratings",
};
const LABEL: Record<OvrMode, string> = {
  ratings: "Show Rankings",
  rankings: "Show Both",
  both: "Show Ratings",
};

const BTN_IDS = ["btn-ratings-toggle-draft", "btn-ratings-toggle-schedule"];

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
    });
  }
  syncButtons();
}

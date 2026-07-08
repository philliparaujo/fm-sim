import { OvrMode, ovrMode, setOvrMode } from "./displayMode";
import { rerenderDraft } from "./draft";
import { rerenderSchedule } from "./schedule";
import { rerenderSimulate } from "./simulate";

// Click cycles ratings → rankings → both → ratings. The label names the mode
// the next click will switch to.
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

/**
 * Wires the global header button that cycles every OVR display between raw
 * ratings, league rankings, and both side by side, then re-renders each tab so
 * the change shows regardless of which tab is active.
 */
export function setupRatingsToggle() {
  const btn = document.getElementById("btn-ratings-toggle");
  if (!btn) return;

  const sync = () => {
    btn.textContent = LABEL[ovrMode];
    btn.classList.toggle("active", ovrMode !== "ratings");
  };
  sync();

  btn.addEventListener("click", () => {
    setOvrMode(NEXT[ovrMode]);
    sync();
    rerenderDraft();
    rerenderSimulate();
    rerenderSchedule();
  });
}

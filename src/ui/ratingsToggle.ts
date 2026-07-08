import { rankingsMode, setRankingsMode } from "./displayMode";
import { rerenderDraft } from "./draft";
import { rerenderSchedule } from "./schedule";
import { rerenderSimulate } from "./simulate";

/**
 * Wires the global header button that flips every OVR display between raw
 * ratings and league rankings, then re-renders each tab so the change shows
 * regardless of which tab is active.
 */
export function setupRatingsToggle() {
  const btn = document.getElementById("btn-ratings-toggle");
  if (!btn) return;

  const sync = () => {
    btn.textContent = rankingsMode ? "Show Ratings" : "Show Rankings";
    btn.classList.toggle("active", rankingsMode);
  };
  sync();

  btn.addEventListener("click", () => {
    setRankingsMode(!rankingsMode);
    sync();
    rerenderDraft();
    rerenderSimulate();
    rerenderSchedule();
  });
}

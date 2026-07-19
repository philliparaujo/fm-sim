import { getReplayLabels, setReplayMode } from "../sim/replay";

/** Which entry is selected: "live" or a stored-play index (0 = most recent). */
let active: "live" | number = "live";

/**
 * Renders the play-by-play replay list as a vertical column: a "Live" row on
 * top, then one row per stored past play (most recent first), each captioned by
 * its game clock. Rebuilds whenever a new play is recorded.
 */
export function setupReplayControls() {
  const container = document.getElementById("replay-controls");
  if (!container) return;

  const makeRow = (idx: "live" | number, when: string): HTMLElement => {
    const row = document.createElement("button");
    row.className = "replay-row" + (idx === active ? " active-mode" : "");
    row.dataset.idx = String(idx);
    row.innerHTML =
      `<span class="replay-row-when">${when}</span>` +
      `<span class="replay-row-play">${idx === "live" ? "●" : "▷"}</span>`;
    row.addEventListener("click", () => {
      active = idx;
      setReplayMode(idx);
      container
        .querySelectorAll(".replay-row")
        .forEach((el) =>
          el.classList.toggle(
            "active-mode",
            (el as HTMLElement).dataset.idx === String(active),
          ),
        );
    });
    return row;
  };

  const rebuild = () => {
    container.innerHTML = "";
    container.appendChild(makeRow("live", "Live"));
    getReplayLabels().forEach((label, i) => {
      container.appendChild(makeRow(i, label || `${i + 1} plays ago`));
    });
  };

  rebuild();
  // A newly recorded play shifts the list; re-render it. Selection stays on
  // whatever `active` points to (live stays live).
  window.addEventListener("playRecorded", rebuild);
}

import { getCompletedPlaysCount, NUM_REPLAYS, setReplayMode } from "../sim/replay";

/** Generates the replay buttons from NUM_REPLAYS, wires selection, and unlocks
 * them as plays are recorded. */
export function setupReplayControls() {
  const container = document.getElementById("replay-controls")!;

  // Generate one "N Plays Ago" button per stored replay (disabled until recorded)
  for (let i = 1; i <= NUM_REPLAYS; i++) {
    const btn = document.createElement("button");
    btn.id = `btn-replay-${i}`;
    btn.className = "replay-btn";
    btn.disabled = true;
    btn.textContent = i === 1 ? "1 Play Ago" : `${i} Plays Ago`;
    container.appendChild(btn);
  }

  const buttons = container.querySelectorAll(".replay-btn");

  buttons.forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const target = e.target as HTMLButtonElement;

      buttons.forEach((b) => b.classList.remove("active-mode"));
      target.classList.add("active-mode");

      if (target.id === "btn-replay-live") {
        setReplayMode("live");
      } else {
        // "btn-replay-1" -> index 0, "btn-replay-2" -> index 1, ...
        const playIndex = parseInt(target.id.replace("btn-replay-", "")) - 1;
        setReplayMode(playIndex);
      }
    });
  });

  // Unlock buttons for however many plays have been recorded so far
  window.addEventListener("playRecorded", () => {
    const totalHistory = getCompletedPlaysCount();
    for (let i = 1; i <= NUM_REPLAYS; i++) {
      const btn = document.getElementById(`btn-replay-${i}`) as HTMLButtonElement;
      if (btn && i <= totalHistory) btn.removeAttribute("disabled");
    }
  });
}

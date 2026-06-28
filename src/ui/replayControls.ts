import { getCompletedPlaysCount, setReplayMode } from "../simulate";

/** Wires the live/replay buttons and unlocks them as plays are recorded. */
export function setupReplayControls() {
  const buttons = document.querySelectorAll(".replay-btn");

  buttons.forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const target = e.target as HTMLButtonElement;

      // Clear visual active highlights
      buttons.forEach((b) => ((b as HTMLButtonElement).style.background = ""));
      target.style.background = "#22c55e"; // Highlight current selection
      target.style.color = "white";

      if (target.id === "btn-replay-live") {
        setReplayMode("live");
      } else {
        // Map button selections directly to 0, 1, or 2 array entries
        const playIndex = parseInt(target.id.replace("btn-replay-", "")) - 1;
        setReplayMode(playIndex as 0 | 1 | 2);
      }
    });
  });

  // Listen for the custom event sent when a play ends to unlock available buttons
  window.addEventListener("playRecorded", () => {
    const totalHistory = getCompletedPlaysCount();
    for (let i = 1; i <= 3; i++) {
      const btn = document.getElementById(`btn-replay-${i}`) as HTMLButtonElement;
      if (btn && i <= totalHistory) {
        btn.removeAttribute("disabled");
      }
    }
  });
}

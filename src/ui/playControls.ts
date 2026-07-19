import { setSimSpeed } from "../core/constants";
import { fastForwardLive } from "../sim";

/** Five playback speeds; the middle one (1×) is the default. */
const SPEEDS = [0.5, 0.75, 1, 2, 4];
const DEFAULT_SPEED_IDX = 2;

let speedIdx = DEFAULT_SPEED_IDX;
/** The game starts paused so it doesn't run until the viewer presses play. */
let paused = true;

/** Effective sim speed = 0 while paused, otherwise the selected multiplier. */
function applySpeed() {
  setSimSpeed(paused ? 0 : SPEEDS[speedIdx]);
}

/** Wires the Play tab's playback bar: play/pause toggle, 5-way speed selector,
 * and the Sim Quarter / Sim to End fast-forward buttons. */
export function setupPlayControls() {
  const playBtn = document.getElementById("btn-play-pause") as HTMLButtonElement | null;
  const dotsWrap = document.getElementById("speed-dots");
  if (!playBtn || !dotsWrap) return;

  // Build the 5 speed options.
  SPEEDS.forEach((speed, i) => {
    const dot = document.createElement("button");
    dot.className = "speed-dot" + (i === speedIdx ? " active" : "");
    dot.textContent = `${speed}×`;
    dot.title = `${speed}× speed`;
    dot.addEventListener("click", () => {
      speedIdx = i;
      dotsWrap
        .querySelectorAll(".speed-dot")
        .forEach((d, j) => d.classList.toggle("active", j === i));
      applySpeed();
    });
    dotsWrap.appendChild(dot);
  });

  const syncPlayBtn = () => {
    playBtn.textContent = paused ? "▶" : "⏸";
    playBtn.classList.toggle("playing", !paused);
    playBtn.title = paused ? "Play" : "Pause";
  };
  playBtn.addEventListener("click", () => {
    paused = !paused;
    syncPlayBtn();
    applySpeed();
  });

  // Fast-forwards pause the live playback afterward — the viewer chose to skip,
  // so land on the resulting state rather than resuming at speed.
  const simThenPause = (mode: "quarter" | "end") => {
    fastForwardLive(mode);
    paused = true;
    syncPlayBtn();
    applySpeed();
  };
  document
    .getElementById("btn-sim-quarter")
    ?.addEventListener("click", () => simThenPause("quarter"));
  document
    .getElementById("btn-sim-to-end")
    ?.addEventListener("click", () => simThenPause("end"));

  syncPlayBtn();
  applySpeed();
}

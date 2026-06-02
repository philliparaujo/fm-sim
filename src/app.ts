import { setSimSpeed, tick } from "./simulate";

const SPEED_STEPS = [0.25, 0.5, 1, 2, 4, 8, 16];

async function init() {
  const slider = document.getElementById(
    "sim-speed-slider",
  ) as HTMLInputElement;
  const label = document.getElementById("speed-label") as HTMLSpanElement;

  // Setup the slider: 1x speed default, listener
  slider.value = "2";
  label.textContent = `${SPEED_STEPS[2]}×`;
  setSimSpeed(SPEED_STEPS[2]);

  slider.addEventListener("input", () => {
    const speed = SPEED_STEPS[Number(slider.value)];
    label.textContent = `${speed}×`;
    setSimSpeed(speed);
  });

  requestAnimationFrame(tick);
}

window.onload = init;

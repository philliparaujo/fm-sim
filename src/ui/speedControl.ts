import { setSimSpeed } from "../core/constants";

const SPEED_STEPS = [0, 0.25, 0.5, 1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024];

/** Wires the simulation speed slider and applies the initial speed. */
export function setupSpeedControl() {
  const slider = document.getElementById("sim-speed-slider") as HTMLInputElement;
  const label = document.getElementById("speed-label") as HTMLSpanElement;
  const defaultIdx = 0;
  slider.value = String(defaultIdx);
  label.textContent = `${SPEED_STEPS[defaultIdx]}×`;
  setSimSpeed(SPEED_STEPS[defaultIdx]);

  slider.addEventListener("input", () => {
    const speed = SPEED_STEPS[Number(slider.value)];
    label.textContent = `${speed}×`;
    setSimSpeed(speed);
  });
}

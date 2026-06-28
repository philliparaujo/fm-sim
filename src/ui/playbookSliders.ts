import { PLAYBOOK_CONFIG, TEAM_PLAYBOOKS } from "../core/playbook";
import { state } from "../simulate";

/** Wires the pass/man/blitz tendency sliders to the live engine and team playbooks. */
export function setupPlaybookSliders() {
  const configs = [
    {
      sliderId: "pass-slider",
      labelId: "pass-label",
      configKey: "passPercent",
      getRoleTeam: () => state.scoreboard?.teams?.find((t) => t.possessing), // Offense strategy
    },
    {
      sliderId: "man-slider",
      labelId: "man-label",
      configKey: "manPercent",
      getRoleTeam: () => state.scoreboard?.teams?.find((t) => !t.possessing), // Defense strategy
    },
    {
      sliderId: "blitz-slider",
      labelId: "blitz-label",
      configKey: "blitzPercent",
      getRoleTeam: () => state.scoreboard?.teams?.find((t) => !t.possessing), // Defense strategy
    },
  ] as const;

  configs.forEach(({ sliderId, labelId, configKey, getRoleTeam }) => {
    const slider = document.getElementById(sliderId) as HTMLInputElement;
    const label = document.getElementById(labelId) as HTMLSpanElement;

    if (!slider || !label) return;

    slider.addEventListener("input", () => {
      const numericValue = parseFloat(slider.value);

      // Update active engine variable on-the-fly
      PLAYBOOK_CONFIG[configKey] = numericValue;
      label.textContent = `${numericValue * 100}%`;

      // Persist assignment values into the proper team playbook database
      const targetTeam = getRoleTeam();
      if (targetTeam && TEAM_PLAYBOOKS[targetTeam.color]) {
        TEAM_PLAYBOOKS[targetTeam.color][configKey] = numericValue;
      }
    });
  });
}

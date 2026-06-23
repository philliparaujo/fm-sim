import { setSimSpeed } from "./constants";
import { PLAYBOOK_CONFIG, saveRating } from "./playbook";
import { Attribute } from "./ratings";
import {
  getCompletedPlaysCount,
  onPlayReset,
  setReplayMode,
  state,
  tick,
} from "./simulate";
import { Player } from "./types";

// Which attributes are relevant per role
const ROLE_ATTRIBUTES: Record<string, Attribute[]> = {
  passer: [
    "SPEED",
    // "SIZE",
    "throwPower",
    "pocketPresence",
    "pressureFeel",
    "decisionMaking",
    "shortAccuracy",
    "deepAccuracy",
  ],
  runner: ["SPEED", "SIZE", "VISION", "POWER"],
  catcher: [
    "SPEED",
    "SIZE",
    "routeRunning",
    "catchAcceleration",
    "catchRadius",
  ],
  blocker: ["SPEED", "SIZE", "PASSBLOCK", "RUNBLOCK"],
  rusher: ["SPEED", "SIZE", "BLOCKSHEDDING", "BEND"],
  coverer: [
    "SPEED",
    "SIZE",
    "manCoverage",
    "zoneCoverage",
    "PURSUIT",
    "TACKLING",
  ],
};

// Human-readable label per attribute key
const ATTR_LABELS: Partial<Record<Attribute, string>> = {
  SPEED: "Speed",
  SIZE: "Size",
  pocketPresence: "Pocket Presence",
  pressureFeel: "Pressure Feel",
  decisionMaking: "Decision Making",
  shortAccuracy: "Short Accuracy",
  deepAccuracy: "Deep Accuracy",
  throwPower: "Throw Power",
  VISION: "Vision",
  POWER: "Power",
  routeRunning: "Route Running",
  catchAcceleration: "Catch Acceleration",
  catchRadius: "Catch Radius",
  PASSBLOCK: "Pass Block",
  RUNBLOCK: "Run Block",
  BLOCKSHEDDING: "Block Shedding",
  BEND: "Bend",
  manCoverage: "Man Coverage",
  zoneCoverage: "Zone Coverage",
  PURSUIT: "Pursuit",
  TACKLING: "Tackling",
};

const SPEED_STEPS = [0, 0.25, 0.5, 1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024];

function ratingToPercent(r: number): string {
  return Math.round(r * 100) + "";
}

function buildDashboard() {
  const container = document.getElementById("player-dashboard")!;
  container.innerHTML = "";

  // Group players by team color then role
  const offensePlayers = state.players.filter((p) => p.side === "offense");
  const defensePlayers = state.players.filter((p) => p.side === "defense");

  const groups: { side: string; players: Player[] }[] = [
    { side: "Offense", players: offensePlayers },
    { side: "Defense", players: defensePlayers },
  ];

  for (const group of groups) {
    const groupEl = document.createElement("div");
    groupEl.className = "dash-group";

    const groupHeader = document.createElement("div");
    groupHeader.className = "dash-group-header";
    groupHeader.textContent = group.side;
    groupEl.appendChild(groupHeader);

    const cardsRow = document.createElement("div");
    cardsRow.className = "dash-cards-row";

    for (const player of group.players) {
      const attrs = ROLE_ATTRIBUTES[player.role] ?? ["SPEED"];
      const card = document.createElement("div");
      card.className = "dash-card";

      const roleLabel = document.createElement("div");
      roleLabel.className = "dash-role";
      roleLabel.textContent = player.label;
      roleLabel.style.borderColor = player.color;
      card.appendChild(roleLabel);

      for (const attr of attrs) {
        const currentRating = player.ratings[attr] ?? 0.5;

        const row = document.createElement("div");
        row.className = "dash-attr-row";

        const labelEl = document.createElement("span");
        labelEl.className = "dash-attr-label";
        labelEl.textContent = ATTR_LABELS[attr] ?? attr;

        const valueEl = document.createElement("span");
        valueEl.className = "dash-attr-value";
        valueEl.textContent = ratingToPercent(currentRating);

        const slider = document.createElement("input");
        slider.type = "range";
        slider.min = "0";
        slider.max = "100";
        slider.step = "1";
        slider.value = ratingToPercent(currentRating);
        slider.className = "dash-slider";

        slider.addEventListener("input", () => {
          const newRating = Number(slider.value) / 100;
          player.ratings[attr] = newRating;
          saveRating(player.label, attr, newRating);
          valueEl.textContent = slider.value;
        });

        row.appendChild(labelEl);
        row.appendChild(slider);
        row.appendChild(valueEl);
        card.appendChild(row);
      }

      cardsRow.appendChild(card);
    }

    groupEl.appendChild(cardsRow);
    container.appendChild(groupEl);
  }
}

function setupReplayFeatures() {
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
      const btn = document.getElementById(
        `btn-replay-${i}`,
      ) as HTMLButtonElement;
      if (btn && i <= totalHistory) {
        btn.removeAttribute("disabled");
      }
    }
  });
}

function setupPlaybookSliders() {
  const configs = [
    {
      sliderId: "pass-slider",
      labelId: "pass-label",
      configKey: "passPercent",
    },
    { sliderId: "man-slider", labelId: "man-label", configKey: "manPercent" },
    {
      sliderId: "blitz-slider",
      labelId: "blitz-label",
      configKey: "blitzPercent",
    },
  ] as const;

  configs.forEach(({ sliderId, labelId, configKey }) => {
    const slider = document.getElementById(sliderId) as HTMLInputElement;
    const label = document.getElementById(labelId) as HTMLSpanElement;

    if (!slider || !label) return;

    // Synchronize slider changes dynamically with the underlying engine state
    slider.addEventListener("input", () => {
      const numericValue = parseFloat(slider.value);

      // Update our simulation playbook state object on-the-fly
      PLAYBOOK_CONFIG[configKey] = numericValue;

      // Update user interface text labels to mirror selection
      label.textContent = `${numericValue * 100}%`;
    });
  });
}

async function init() {
  // Speed slider
  const slider = document.getElementById(
    "sim-speed-slider",
  ) as HTMLInputElement;
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

  // Build dashboard now, and rebuild after each play reset
  buildDashboard();
  onPlayReset(buildDashboard);

  // Replays
  setupReplayFeatures();

  // Playbook variable listeners
  setupPlaybookSliders();

  requestAnimationFrame(tick);
}

window.onload = init;

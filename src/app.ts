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
import { Player, Label, Role, PLAYER_LABELS } from "./types";

// Explicit lookup map to resolve a roster player's attributes via their label
const LABEL_TO_ROLE: Record<Label, Role> = {
  QB: "passer",
  RB: "runner",
  XR: "catcher",
  ZR: "catcher",
  TE: "catcher",
  LT: "blocker",
  C: "blocker",
  RT: "blocker",
  LE: "rusher",
  DT: "rusher",
  RE: "rusher",
  CB: "coverer",
  NB: "coverer",
  LB: "coverer",
  FS: "coverer",
  SS: "coverer",
};

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

const PLAYER_RATINGS_CACHE: Record<
  string,
  Record<string, Record<string, number>>
> = {
  red: {},
  blue: {},
};

const TEAM_PLAYBOOKS: Record<string, Record<string, number>> = {
  red: { passPercent: 0.5, manPercent: 0.5, blitzPercent: 0.3 },
  blue: { passPercent: 0.5, manPercent: 0.5, blitzPercent: 0.3 },
};

function ratingToPercent(r: number): string {
  return Math.round(r * 100) + "";
}

function buildDashboard() {
  const container = document.getElementById("player-dashboard")!;
  container.innerHTML = "";

  // Guard clause if the scoreboard state hasn't initialized yet
  if (!state.scoreboard || !state.scoreboard.teams) return;

  // 1. Force sync the newly spawned live field players with our persistent attributes cache
  if (state.players) {
    for (const p of state.players) {
      const cachedPlayerRatings = PLAYER_RATINGS_CACHE[p.color]?.[p.label];
      if (cachedPlayerRatings) {
        for (const attr of Object.keys(cachedPlayerRatings)) {
          p.ratings[attr as Attribute] = cachedPlayerRatings[attr as Attribute];
        }
      }
    }
  }

  // 2. Identify active units to sync and update playbook slider positions
  const offenseTeam = state.scoreboard.teams.find((t) => t.possessing);
  const defenseTeam = state.scoreboard.teams.find((t) => !t.possessing);

  if (offenseTeam) {
    PLAYBOOK_CONFIG.passPercent = TEAM_PLAYBOOKS[offenseTeam.color].passPercent;
    const passSlider = document.getElementById(
      "pass-slider",
    ) as HTMLInputElement;
    const passLabel = document.getElementById("pass-label") as HTMLSpanElement;
    if (passSlider && passLabel) {
      passSlider.value = String(PLAYBOOK_CONFIG.passPercent);
      passLabel.textContent = `${PLAYBOOK_CONFIG.passPercent * 100}%`;
    }
  }
  if (defenseTeam) {
    PLAYBOOK_CONFIG.manPercent = TEAM_PLAYBOOKS[defenseTeam.color].manPercent;
    PLAYBOOK_CONFIG.blitzPercent =
      TEAM_PLAYBOOKS[defenseTeam.color].blitzPercent;

    const manSlider = document.getElementById("man-slider") as HTMLInputElement;
    const manLabel = document.getElementById("man-label") as HTMLSpanElement;
    if (manSlider && manLabel) {
      manSlider.value = String(PLAYBOOK_CONFIG.manPercent);
      manLabel.textContent = `${PLAYBOOK_CONFIG.manPercent * 100}%`;
    }

    const blitzSlider = document.getElementById(
      "blitz-slider",
    ) as HTMLInputElement;
    const blitzLabel = document.getElementById(
      "blitz-label",
    ) as HTMLSpanElement;
    if (blitzSlider && blitzLabel) {
      blitzSlider.value = String(PLAYBOOK_CONFIG.blitzPercent);
      blitzLabel.textContent = `${PLAYBOOK_CONFIG.blitzPercent * 100}%`;
    }
  }

  // SORT TEAMS BY NAME: This keeps the visual columns locked to the same teams
  const sortedTeams = [...state.scoreboard.teams].sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  for (const team of sortedTeams) {
    const groupEl = document.createElement("div");
    groupEl.className = "dash-group";

    const groupHeader = document.createElement("div");
    groupHeader.className = "dash-group-header";

    groupHeader.textContent = team.possessing ? `${team.name} 🏈` : team.name;
    groupEl.appendChild(groupHeader);

    const cardsRow = document.createElement("div");
    cardsRow.className = "dash-cards-row";

    const sortedRoster = [...team.roster].sort(
      (a, b) => PLAYER_LABELS.indexOf(a.label) - PLAYER_LABELS.indexOf(b.label),
    );

    for (const rosterPlayer of sortedRoster) {
      const role = LABEL_TO_ROLE[rosterPlayer.label] ?? "blocker";
      const attrs = ROLE_ATTRIBUTES[role] ?? ["SPEED"];

      const card = document.createElement("div");
      card.className = "dash-card";

      const isOnField = state.players.some(
        (p) => p.label === rosterPlayer.label && p.color === team.color,
      );

      if (!isOnField) {
        card.style.opacity = "0.5";
        card.style.filter = "desaturate(40%)";
      }

      const roleLabel = document.createElement("div");
      roleLabel.className = "dash-role";
      roleLabel.textContent = isOnField
        ? rosterPlayer.label
        : `${rosterPlayer.label} (Bench)`;
      roleLabel.style.borderColor = team.color;
      card.appendChild(roleLabel);

      for (const attr of attrs) {
        // Initialize cache structures safely if they are blank
        if (!PLAYER_RATINGS_CACHE[team.color][rosterPlayer.label]) {
          PLAYER_RATINGS_CACHE[team.color][rosterPlayer.label] = {};
        }

        // Apply from persistent cache or fill cache from current instance properties
        if (
          PLAYER_RATINGS_CACHE[team.color][rosterPlayer.label][attr] !==
          undefined
        ) {
          rosterPlayer.ratings[attr] =
            PLAYER_RATINGS_CACHE[team.color][rosterPlayer.label][attr];
        } else {
          PLAYER_RATINGS_CACHE[team.color][rosterPlayer.label][attr] =
            rosterPlayer.ratings[attr] ?? 0.5;
        }

        const currentRating = rosterPlayer.ratings[attr];

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

          // 1. Update the isolated persistent data structures
          PLAYER_RATINGS_CACHE[team.color][rosterPlayer.label][attr] =
            newRating;
          rosterPlayer.ratings[attr] = newRating;
          saveRating(rosterPlayer.label, attr, newRating);

          // 2. Synchronize directly into live play if they are on the field
          const livePlayer = state.players.find(
            (p) => p.label === rosterPlayer.label && p.color === team.color,
          );
          if (livePlayer) {
            livePlayer.ratings[attr] = newRating;
          }

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

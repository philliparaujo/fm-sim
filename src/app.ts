import { setSimSpeed } from "./core/constants";
import { PLAYBOOK_CONFIG, saveRating, TEAM_PLAYBOOKS } from "./core/playbook";
import { Attribute, getLetterGrade } from "./core/ratings";
import {
  getCompletedPlaysCount,
  onPlayReset,
  setReplayMode,
  state,
  tick,
} from "./simulate";
import { PLAYER_LABELS } from "./core/types";
import { labelToRole, labelToSide } from "./utils/roster";

// Which attributes are relevant per role
const ROLE_ATTRIBUTES: Record<string, Attribute[]> = {
  passer: [
    "SPEED",
    // "SIZE",
    "THROWPOWER",
    "POCKETPRESENCE",
    "DECISIONMAKING",
    "SHORTACCURACY",
    "DEEPACCURACY",
  ],
  runner: ["SPEED", "SIZE", "VISION", "POWER"],
  catcher: [
    "SPEED",
    "SIZE",
    "ROUTERUNNING",
    "CATCHACCELERATION",
    "CATCHRADIUS",
  ],
  blocker: ["SPEED", "SIZE", "PASSBLOCK", "RUNBLOCK"],
  rusher: ["SPEED", "SIZE", "BLOCKSHEDDING", "BEND"],
  coverer: [
    "SPEED",
    "SIZE",
    "MANCOVERAGE",
    "ZONECOVERAGE",
    "PURSUIT",
    "TACKLING",
  ],
};

// Human-readable label per attribute key
const ATTR_LABELS: Partial<Record<Attribute, string>> = {
  SPEED: "Speed",
  SIZE: "Size",
  POCKETPRESENCE: "Pocket Pres.",
  DECISIONMAKING: "Dec. Making",
  SHORTACCURACY: "Short Acc.",
  DEEPACCURACY: "Deep Acc.",
  THROWPOWER: "Throw Power",
  VISION: "Vision",
  POWER: "Power",
  ROUTERUNNING: "Route Running",
  CATCHACCELERATION: "Catch Accel.",
  CATCHRADIUS: "Catch Radius",
  PASSBLOCK: "Pass Block",
  RUNBLOCK: "Run Block",
  BLOCKSHEDDING: "Block Shed",
  BEND: "Bend",
  MANCOVERAGE: "Man Cov.",
  ZONECOVERAGE: "Zone Cov.",
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

// Move this to the top level so it persists
let dashboardInitialized = false;

function initDashboard() {
  const container = document.getElementById("player-dashboard")!;
  container.innerHTML = "";

  if (!state.scoreboard?.teams) return;

  const sortedTeams = [...state.scoreboard.teams].sort((a, b) =>
    b.name.localeCompare(a.name),
  );

  for (const team of sortedTeams) {
    const section = document.createElement("div");
    section.className = "dash-team-section";

    const header = document.createElement("div");
    header.className = "dash-team-header";
    header.innerHTML = `<span class="dash-team-name" style="color:${team.color === "red" ? "#f87171" : "#60a5fa"}">${team.name}</span><span class="dash-possession-badge" data-team-badge="${team.color}"></span>`;
    section.appendChild(header);

    const sortedRoster = [...team.roster].sort(
      (a, b) => PLAYER_LABELS.indexOf(a.label) - PLAYER_LABELS.indexOf(b.label),
    );

    const offensePlayers = sortedRoster.filter(
      (rp) => labelToSide(rp.label) === "offense",
    );
    const defensePlayers = sortedRoster.filter(
      (rp) => labelToSide(rp.label) === "defense",
    );

    for (const [groupLabel, group] of [
      ["Offense", offensePlayers],
      ["Defense", defensePlayers],
    ] as [string, typeof sortedRoster][]) {
      if (group.length === 0) continue;

      const allAttrs = [
        ...new Set(
          group.flatMap((rp) => ROLE_ATTRIBUTES[labelToRole(rp.label)] ?? []),
        ),
      ];

      const tableWrap = document.createElement("div");
      tableWrap.className = "dash-table-wrap";

      const groupLabel2 = document.createElement("div");
      groupLabel2.className = "dash-sub-header";
      groupLabel2.textContent = groupLabel;
      tableWrap.appendChild(groupLabel2);

      const table = document.createElement("table");
      table.className = "dash-table";

      const thead = document.createElement("thead");
      const headerRow = document.createElement("tr");
      headerRow.innerHTML =
        `<th class="dash-th dash-th-label">Player</th>` +
        allAttrs
          .map((a) => `<th class="dash-th">${ATTR_LABELS[a] ?? a}</th>`)
          .join("");
      thead.appendChild(headerRow);
      table.appendChild(thead);

      const tbody = document.createElement("tbody");
      for (const rp of group) {
        const role = labelToRole(rp.label);
        const playerAttrs = ROLE_ATTRIBUTES[role] ?? [];
        const row = document.createElement("tr");
        row.className = "dash-row";

        const labelCell = document.createElement("td");
        labelCell.className = "dash-td-label";
        // We'll update the bench tag dynamically later
        labelCell.innerHTML = `<span class="dash-player-label" style="border-left-color:${team.color === "red" ? "#f87171" : "#60a5fa"}">${rp.label}</span><span class="dash-bench-tag" data-bench="${team.color}-${rp.label}" style="display:none;">bench</span>`;
        row.appendChild(labelCell);

        for (const attr of allAttrs) {
          const td = document.createElement("td");
          td.className = "dash-td";

          if (!playerAttrs.includes(attr)) {
            td.innerHTML = `<span class="dash-td-empty">—</span>`;
            row.appendChild(td);
            continue;
          }

          // Initialize cache
          if (!PLAYER_RATINGS_CACHE[team.color][rp.label])
            PLAYER_RATINGS_CACHE[team.color][rp.label] = {};
          if (PLAYER_RATINGS_CACHE[team.color][rp.label][attr] === undefined) {
            PLAYER_RATINGS_CACHE[team.color][rp.label][attr] =
              rp.ratings[attr] ?? 0.5;
          }

          // Assign unique data attributes so we can find these elements later without rebuilding
          const ratingPct = Math.round((rp.ratings[attr] ?? 0.5) * 100);
          const { grade, color } = getLetterGrade(attr, ratingPct);

          const gradeEl = document.createElement("span");
          gradeEl.className = "dash-grade-badge";
          gradeEl.style.color = color;
          gradeEl.textContent = grade;
          gradeEl.setAttribute(
            "data-grade",
            `${team.color}-${rp.label}-${attr}`,
          );

          const slider = document.createElement("input");
          slider.type = "number";
          slider.min = "0";
          slider.max = "100";
          slider.step = "1";
          slider.value = String(ratingPct);
          slider.className = "dash-inline-number";
          slider.setAttribute(
            "data-slider",
            `${team.color}-${rp.label}-${attr}`,
          );

          slider.addEventListener("input", () => {
            const newRating = Number(slider.value) / 100;
            PLAYER_RATINGS_CACHE[team.color][rp.label][attr] = newRating;
            rp.ratings[attr] = newRating;
            saveRating(rp.label, attr, newRating);
            const livePlayer = state.players.find(
              (p) => p.label === rp.label && p.color === team.color,
            );
            if (livePlayer) livePlayer.ratings[attr] = newRating;
            const pct = Math.round(newRating * 100);
            const { grade: g, color: c } = getLetterGrade(attr, pct);

            // Update grade inline immediately on user input
            gradeEl.textContent = g;
            gradeEl.style.color = c;
          });

          td.appendChild(gradeEl);
          td.appendChild(slider);
          row.appendChild(td);
        }
        tbody.appendChild(row);
      }

      table.appendChild(tbody);
      tableWrap.appendChild(table);
      section.appendChild(tableWrap);
    }

    container.appendChild(section);
  }

  dashboardInitialized = true;
}

function updateDashboardValues() {
  if (!dashboardInitialized) return;
  if (!state.scoreboard?.teams) return;

  const offenseTeam = state.scoreboard.teams.find((t) => t.possessing);
  const defenseTeam = state.scoreboard.teams.find((t) => !t.possessing);

  // 1. Update Playbook sliders silently
  if (offenseTeam) {
    PLAYBOOK_CONFIG.passPercent = TEAM_PLAYBOOKS[offenseTeam.color].passPercent;
    const ps = document.getElementById("pass-slider") as HTMLInputElement;
    const pl = document.getElementById("pass-label") as HTMLSpanElement;
    if (ps && pl) {
      ps.value = String(PLAYBOOK_CONFIG.passPercent);
      pl.textContent = `${PLAYBOOK_CONFIG.passPercent * 100}%`;
    }
  }
  if (defenseTeam) {
    PLAYBOOK_CONFIG.manPercent = TEAM_PLAYBOOKS[defenseTeam.color].manPercent;
    PLAYBOOK_CONFIG.blitzPercent =
      TEAM_PLAYBOOKS[defenseTeam.color].blitzPercent;
    const ms = document.getElementById("man-slider") as HTMLInputElement;
    const ml = document.getElementById("man-label") as HTMLSpanElement;
    if (ms && ml) {
      ms.value = String(PLAYBOOK_CONFIG.manPercent);
      ml.textContent = `${PLAYBOOK_CONFIG.manPercent * 100}%`;
    }
    const bs = document.getElementById("blitz-slider") as HTMLInputElement;
    const bl = document.getElementById("blitz-label") as HTMLSpanElement;
    if (bs && bl) {
      bs.value = String(PLAYBOOK_CONFIG.blitzPercent);
      bl.textContent = `${PLAYBOOK_CONFIG.blitzPercent * 100}%`;
    }
  }

  // 2. Sync live player ratings from cache
  if (state.players) {
    for (const p of state.players) {
      const cached = PLAYER_RATINGS_CACHE[p.color]?.[p.label];
      if (cached) {
        for (const attr of Object.keys(cached)) {
          p.ratings[attr as Attribute] = cached[attr as Attribute];
        }
      }
    }
  }

  // 3. Update Possession Badges
  document.querySelectorAll("[data-team-badge]").forEach((el) => {
    const color = el.getAttribute("data-team-badge");
    const isPoss = state.scoreboard.teams.find(
      (t) => t.color === color,
    )?.possessing;
    el.textContent = isPoss ? "🏈 Offense" : "🛡 Defense";
  });

  // 4. Update Bench Tags
  document.querySelectorAll("[data-bench]").forEach((el) => {
    const id = el.getAttribute("data-bench"); // format: "red-QB"
    const [color, label] = id!.split("-");
    const isOnField = state.players.some(
      (p) => p.label === label && p.color === color,
    );
    (el as HTMLElement).style.display = isOnField ? "none" : "inline";
  });

  // 5. Update Grades & Sliders (Only if values changed)
  for (const team of state.scoreboard.teams) {
    for (const rp of team.roster) {
      const role = labelToRole(rp.label);
      const playerAttrs = ROLE_ATTRIBUTES[role] ?? [];
      for (const attr of playerAttrs) {
        const cachedVal = PLAYER_RATINGS_CACHE[team.color]?.[rp.label]?.[attr];
        if (cachedVal !== undefined) {
          rp.ratings[attr] = cachedVal;
          const ratingPct = Math.round(cachedVal * 100);

          // Only perform DOM lookups/updates if the number actually changed
          const slider = document.querySelector(
            `[data-slider="${team.color}-${rp.label}-${attr}"]`,
          ) as HTMLInputElement;
          if (slider && Number(slider.value) !== ratingPct) {
            slider.value = String(ratingPct);
            const { grade, color } = getLetterGrade(attr, ratingPct);
            const gradeEl = document.querySelector(
              `[data-grade="${team.color}-${rp.label}-${attr}"]`,
            );
            if (gradeEl) {
              gradeEl.textContent = grade;
              (gradeEl as HTMLElement).style.color = color;
            }
          }
        }
      }
    }
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
  initDashboard();
  onPlayReset(updateDashboardValues);

  // Replays
  setupReplayFeatures();

  // Playbook variable listeners
  setupPlaybookSliders();

  requestAnimationFrame(tick);
}

window.onload = init;

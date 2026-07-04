import { PLAYBOOK_CONFIG, saveRating, TEAM_PLAYBOOKS } from "../core/playbook";
import { Attribute, getLetterGrade } from "../core/ratings";
import { PLAYER_LABELS } from "../core/types";
import { state } from "../sim";
import { labelToRole, labelToSide } from "../utils/roster";

// Which attributes are relevant per role
const ROLE_ATTRIBUTES: Record<string, Attribute[]> = {
  passer: [
    "SPEED",
    "THROWPOWER",
    "POCKETPRESENCE",
    "DECISIONMAKING",
    "SHORTACCURACY",
    "DEEPACCURACY",
  ],
  runner: ["SPEED", "SIZE", "VISION", "POWER", "PASSBLOCK"],
  catcher: [
    "SPEED",
    "SIZE",
    "ROUTERUNNING",
    "CATCHACCELERATION",
    "CATCHRADIUS",
    "RUNBLOCK",
    "VISION",
    "POWER",
  ],
  blocker: ["SPEED", "SIZE", "PASSBLOCK", "RUNBLOCK"],
  rusher: ["SPEED", "SIZE", "BLOCKSHEDDING", "BEND", "TACKLING"],
  coverer: [
    "SPEED",
    "SIZE",
    "PURSUIT",
    "MANCOVERAGE",
    "ZONECOVERAGE",
    "TACKLING",
    "BLOCKSHEDDING",
    "CATCHRADIUS",
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

// Ratings cache keyed by team color; entries are created lazily per team
const PLAYER_RATINGS_CACHE: Record<
  string,
  Record<string, Record<string, number>>
> = {};

let dashboardInitialized = false;

/** Builds the per-team ratings editor tables from scratch. */
export function initDashboard() {
  const container = document.getElementById("player-dashboard")!;
  container.innerHTML = "";

  if (!state.scoreboard?.teams) return;

  const sortedTeams = [...state.scoreboard.teams].sort((a, b) =>
    b.name.localeCompare(a.name),
  );

  for (const team of sortedTeams) {
    PLAYER_RATINGS_CACHE[team.color] ??= {};

    const section = document.createElement("div");
    section.className = "dash-team-section";

    const header = document.createElement("div");
    header.className = "dash-team-header";
    header.innerHTML = `<span class="dash-team-name" style="color:${team.color}">${team.name}</span><span class="dash-possession-badge" data-team-badge="${team.color}"></span>`;
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
        const nameClass = rp.starred
          ? "dash-player-name draft-starred-name"
          : "dash-player-name";
        labelCell.innerHTML = `<span class="dash-player-label" style="border-left-color:${team.color}">${rp.label}</span><span class="${nameClass}">${rp.name}</span>`;
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

/** Syncs dashboard widgets to current game state; called after each play reset. */
export function updateDashboardValues() {
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

  // 4. Update Grades & Sliders (Only if values changed)
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

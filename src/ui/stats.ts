import {
  getDivisions,
  getGames,
  getRecord,
  isSeasonGenerated,
  teamByColor,
  TeamRecord,
} from "../core/schedule";
import {
  getGamesPlayed,
  getSeasonStats,
  hasSeasonStats,
} from "../core/seasonStats";
import {
  defensiveGrade,
  hasOffense,
  mvpGrade,
  offensiveGrade,
} from "../core/awards";
import { LEAGUE } from "../core/state";
import { Label, PlayerStats } from "../core/types";
import { scoreProspect } from "../core/draftEval";
import { playerOvrDisplay } from "./displayMode";
import { renderDivisionTable } from "./schedule";
import { getSelectedTeamColor } from "./draft";

type StatTab = "passing" | "rushing" | "receiving" | "defense";

let statTab: StatTab = "passing";
let statSort: { col: number; dir: "asc" | "desc" } | null = null;
let teamStatSort: { col: number; dir: "asc" | "desc" } | null = null;

export function setupStats() {
  document.getElementById("tab-stats")?.addEventListener("click", render);
}

export function rerenderStats() {
  render();
}

function render() {
  const root = document.getElementById("stats-root");
  if (!root) return;
  root.innerHTML = "";

  if (!isSeasonGenerated()) {
    const msg = document.createElement("p");
    msg.className = "sched-empty";
    msg.textContent = "Generate a season to see stats.";
    root.appendChild(msg);
    return;
  }

  const mainRow = document.createElement("div");
  mainRow.className = "stats-main-row";

  // ── Left column: standings + team stats + player stats ────────────────────
  const leftCol = document.createElement("div");
  leftCol.className = "stats-left-col";

  const standSection = document.createElement("div");
  standSection.className = "sched-section";
  const standHeading = document.createElement("h3");
  standHeading.className = "sched-heading";
  standHeading.textContent = "Standings";
  standSection.appendChild(standHeading);
  const divWrap = document.createElement("div");
  divWrap.className = "sched-standings-wrap";
  getDivisions().forEach((div, i) => divWrap.appendChild(renderDivisionTable(div, i)));
  standSection.appendChild(divWrap);
  leftCol.appendChild(standSection);

  leftCol.appendChild(renderTeamStats());
  leftCol.appendChild(renderPlayerStats());

  // ── Right column: league leaders (2×2) + season awards ───────────────────
  const rightCol = document.createElement("div");
  rightCol.className = "stats-right-col";
  rightCol.appendChild(renderLeagueLeaders());
  rightCol.appendChild(renderSeasonAwards());

  mainRow.appendChild(leftCol);
  mainRow.appendChild(rightCol);
  root.appendChild(mainRow);
}

// ── League leaders ────────────────────────────────────────────────────────────

function renderLeagueLeaders(): HTMLElement {
  const section = document.createElement("div");
  section.className = "stats-leaders-col";

  const heading = document.createElement("h3");
  heading.className = "sched-heading";
  heading.textContent = "League Leaders";
  section.appendChild(heading);

  const records = LEAGUE.map((t) => getRecord(t.color));
  const played = records.some((r) => r.wins + r.losses + r.ties > 0);

  if (!played) {
    const p = document.createElement("p");
    p.className = "sched-empty";
    p.textContent = "Play some games to populate league leaders.";
    section.appendChild(p);
    return section;
  }

  const grid = document.createElement("div");
  grid.className = "sched-leaders stats-leaders-2x2";

  const leader = (
    title: string,
    pick: (r: TeamRecord) => number,
    fmt: (r: TeamRecord) => string,
    max = true,
  ) => {
    const best = [...records].sort((a, b) =>
      max ? pick(b) - pick(a) : pick(a) - pick(b),
    )[0];
    const team = teamByColor(best.color);
    const cell = document.createElement("div");
    cell.className = "sched-leader";
    cell.innerHTML =
      `<div class="sched-leader-title">${title}</div>` +
      `<div class="sched-leader-team" style="color:${team.color}">${team.name}</div>` +
      `<div class="sched-leader-val">${fmt(best)}</div>`;
    return cell;
  };

  grid.appendChild(leader("Most Points For", (r) => r.pointsFor, (r) => `${r.pointsFor} pts`));
  grid.appendChild(leader("Stingiest Defense", (r) => r.pointsAgainst, (r) => `${r.pointsAgainst} allowed`, false));
  grid.appendChild(leader("Best Point Diff", (r) => r.pointsFor - r.pointsAgainst, (r) => { const d = r.pointsFor - r.pointsAgainst; return `${d >= 0 ? "+" : ""}${d}`; }));
  grid.appendChild(leader("Most Wins", (r) => r.wins, (r) => `${r.wins} wins`));

  section.appendChild(grid);
  return section;
}

// ── Team stats ────────────────────────────────────────────────────────────────

type TeamStatCol = {
  header: string;
  get: (r: TeamStatRow) => number | string;
  fmt?: (v: number) => string;
  numeric: boolean;
};

type TeamStatRow = {
  color: string;
  name: string;
  gp: number;
  ppg: number;
  ppga: number;
  diff: number;
  ypg: number;
  passYpg: number;
  rushYpg: number;
  ypgAgainst: number;
  passYpgAgainst: number;
  rushYpgAgainst: number;
  ints: number;
  sacks: number;
};

const TEAM_STAT_COLS: TeamStatCol[] = [
  { header: "Team",    get: (r) => r.name,            numeric: false },
  { header: "GP",      get: (r) => r.gp,              numeric: true },
  { header: "PPG",     get: (r) => r.ppg,             fmt: (v) => v.toFixed(1), numeric: true },
  { header: "PPG/A",   get: (r) => r.ppga,            fmt: (v) => v.toFixed(1), numeric: true },
  { header: "DIFF",    get: (r) => r.diff,            fmt: (v) => (v >= 0 ? "+" : "") + v.toFixed(1), numeric: true },
  { header: "YPG",     get: (r) => r.ypg,             fmt: (v) => v.toFixed(1), numeric: true },
  { header: "PASS",    get: (r) => r.passYpg,         fmt: (v) => v.toFixed(1), numeric: true },
  { header: "RUSH",    get: (r) => r.rushYpg,         fmt: (v) => v.toFixed(1), numeric: true },
  { header: "YPG/A",   get: (r) => r.ypgAgainst,      fmt: (v) => v.toFixed(1), numeric: true },
  { header: "PASS/A",  get: (r) => r.passYpgAgainst,  fmt: (v) => v.toFixed(1), numeric: true },
  { header: "RUSH/A",  get: (r) => r.rushYpgAgainst,  fmt: (v) => v.toFixed(1), numeric: true },
  { header: "INT",     get: (r) => r.ints,            numeric: true },
  { header: "SACK",    get: (r) => r.sacks,           numeric: true },
];

/** Regular-season pass/rush yards allowed per team, summed from the opposing
 * team's per-game offensive output (season stats only track each team's own
 * offense, not what it gave up). */
function buildYardsAgainst(): Record<string, { pass: number; rush: number }> {
  const against: Record<string, { pass: number; rush: number }> = {};
  const sumOffense = (players: ReturnType<typeof getSeasonStats>[string]) => {
    let pass = 0, rush = 0;
    for (const stats of Object.values(players)) {
      pass += stats?.passing?.yards ?? 0;
      rush += stats?.rushing?.yards ?? 0;
    }
    return { pass, rush };
  };
  for (const g of getGames()) {
    if (g.round !== "regular" || !g.played || !g.playerStats) continue;
    const homeOff = sumOffense(g.playerStats[g.homeColor] ?? {});
    const awayOff = sumOffense(g.playerStats[g.awayColor] ?? {});
    against[g.homeColor] ??= { pass: 0, rush: 0 };
    against[g.awayColor] ??= { pass: 0, rush: 0 };
    against[g.homeColor].pass += awayOff.pass;
    against[g.homeColor].rush += awayOff.rush;
    against[g.awayColor].pass += homeOff.pass;
    against[g.awayColor].rush += homeOff.rush;
  }
  return against;
}

function buildTeamStatRows(): TeamStatRow[] {
  const seasonStats = getSeasonStats();
  const yardsAgainst = buildYardsAgainst();
  return LEAGUE.map((t) => {
    const gp = getGamesPlayed(t.color);
    const rec = getRecord(t.color);
    const teamPlayers = seasonStats[t.color] ?? {};
    let passYds = 0, rushYds = 0, ints = 0, sacks = 0;
    for (const stats of Object.values(teamPlayers)) {
      passYds += stats?.passing?.yards ?? 0;
      rushYds += stats?.rushing?.yards ?? 0;
      ints += stats?.defense?.interceptions ?? 0;
      sacks += stats?.defense?.sacks ?? 0;
    }
    const against = yardsAgainst[t.color] ?? { pass: 0, rush: 0 };
    const div = gp > 0 ? 1 / gp : 0;
    return {
      color: t.color,
      name: t.name,
      gp,
      ppg: rec.pointsFor * div,
      ppga: rec.pointsAgainst * div,
      diff: (rec.pointsFor - rec.pointsAgainst) * div,
      passYpg: passYds * div,
      rushYpg: rushYds * div,
      ypg: (passYds + rushYds) * div,
      passYpgAgainst: against.pass * div,
      rushYpgAgainst: against.rush * div,
      ypgAgainst: (against.pass + against.rush) * div,
      ints,
      sacks,
    };
  });
}

function renderTeamStats(): HTMLElement {
  const section = document.createElement("div");
  section.className = "sched-section";

  const heading = document.createElement("h3");
  heading.className = "sched-heading";
  heading.textContent = "Team Stats";
  section.appendChild(heading);

  if (!hasSeasonStats()) {
    const p = document.createElement("p");
    p.className = "sched-empty";
    p.textContent = "Simulate games to populate team stats.";
    section.appendChild(p);
    return section;
  }

  let rows = buildTeamStatRows();

  // Default: sort by PPG (col 2) desc
  const defaultColIdx = 2;
  if (!teamStatSort) teamStatSort = { col: defaultColIdx, dir: "desc" };

  const { col, dir } = teamStatSort;
  const colDef = TEAM_STAT_COLS[col];
  rows.sort((a, b) => {
    const va = colDef.get(a);
    const vb = colDef.get(b);
    const cmp =
      typeof va === "number" && typeof vb === "number"
        ? va - vb
        : String(va).localeCompare(String(vb));
    return dir === "asc" ? cmp : -cmp;
  });

  const wrap = document.createElement("div");
  wrap.className = "sched-stat-table-wrap";

  const table = document.createElement("table");
  table.className = "sched-stat-table stats-team-table";

  const thead = document.createElement("thead");
  const hRow = document.createElement("tr");
  hRow.innerHTML = `<th class="sched-stat-th sched-stat-th-rank">#</th>`;
  TEAM_STAT_COLS.forEach((c, i) => {
    const th = document.createElement("th");
    const active = teamStatSort?.col === i;
    const arrow = active ? (teamStatSort!.dir === "asc" ? " ▲" : " ▼") : "";
    th.className = "sched-stat-th sched-stat-th-sortable" + (active ? " active" : "");
    th.innerHTML = `${c.header}<span class="sched-stat-arrow">${arrow}</span>`;
    th.addEventListener("click", () => {
      if (teamStatSort?.col === i) {
        teamStatSort = { col: i, dir: teamStatSort.dir === "asc" ? "desc" : "asc" };
      } else {
        teamStatSort = { col: i, dir: c.numeric ? "desc" : "asc" };
      }
      render();
    });
    hRow.appendChild(th);
  });
  thead.appendChild(hRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  rows.forEach((row, i) => {
    const team = teamByColor(row.color);
    const tr = document.createElement("tr");
    tr.className = "sched-stat-row" + (row.color === getSelectedTeamColor() ? " sched-stat-row-focus" : "");
    tr.innerHTML = `<td class="sched-stat-td sched-stat-td-rank">${i + 1}</td>`;
    TEAM_STAT_COLS.forEach((c, ci) => {
      const raw = c.get(row);
      const display = c.fmt && typeof raw === "number"
        ? c.fmt(raw)
        : ci === 0
          ? `<span style="color:${team.color};font-weight:bold">${raw}</span>`
          : String(raw);
      tr.innerHTML += `<td class="sched-stat-td">${display}</td>`;
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
  section.appendChild(wrap);
  return section;
}

// ── Player stats (tabbed) ─────────────────────────────────────────────────────

type StatColumn = {
  header: string;
  get: (s: PlayerStats) => number;
  fmt?: (v: number) => string;
};

/** Capitalizes a route key for display (e.g. "slant" -> "Slant"). */
function formatRouteName(route: string): string {
  return route.charAt(0).toUpperCase() + route.slice(1);
}

/** The route with the most accumulated yards in a route → yards map. */
function bestRouteFromMap(routeYards: Record<string, number> | undefined): string {
  if (!routeYards) return "—";
  let best: string | null = null;
  let bestYds = -Infinity;
  for (const [route, yds] of Object.entries(routeYards)) {
    if (yds > bestYds) {
      bestYds = yds;
      best = route;
    }
  }
  return best ? formatRouteName(best) : "—";
}

/** The route this player earned the most receiving yards on this season. */
function bestRoute(s: PlayerStats): string {
  return bestRouteFromMap(s.receiving?.routeYards);
}

/** The route this QB threw for the most completed yards to this season. */
function bestPassRoute(s: PlayerStats): string {
  return bestRouteFromMap(s.passing?.routeYards);
}

const STAT_TABS: {
  key: StatTab;
  label: string;
  has: (s: PlayerStats) => boolean;
  sortBy: (s: PlayerStats) => number;
  columns: StatColumn[];
  yardsFor?: (s: PlayerStats) => number;
  bestRouteFor?: (s: PlayerStats) => string;
}[] = [
  {
    key: "passing",
    label: "Passing",
    has: (s) => !!s.passing,
    sortBy: (s) => s.passing?.yards ?? 0,
    yardsFor: (s) => s.passing!.yards,
    bestRouteFor: bestPassRoute,
    columns: [
      { header: "ATT",  get: (s) => s.passing!.attempts },
      { header: "CMP",  get: (s) => s.passing!.completions },
      { header: "CMP%", get: (s) => s.passing!.cmp * 100, fmt: (v) => v.toFixed(1) },
      { header: "YDS",  get: (s) => s.passing!.yards, fmt: (v) => v.toFixed(0) },
      { header: "YPA",  get: (s) => s.passing!.ypa, fmt: (v) => v.toFixed(1) },
      { header: "TD",   get: (s) => s.passing!.tds },
      { header: "INT",  get: (s) => s.passing!.ints },
      { header: "SACK", get: (s) => s.passing!.sacks },
    ],
  },
  {
    key: "rushing",
    label: "Rushing",
    has: (s) => !!s.rushing,
    sortBy: (s) => s.rushing?.yards ?? 0,
    yardsFor: (s) => s.rushing!.yards,
    columns: [
      { header: "ATT", get: (s) => s.rushing!.rushes },
      { header: "YDS", get: (s) => s.rushing!.yards, fmt: (v) => v.toFixed(0) },
      { header: "YPC", get: (s) => s.rushing!.ypc, fmt: (v) => v.toFixed(1) },
      { header: "TD",  get: (s) => s.rushing!.tds },
    ],
  },
  {
    key: "receiving",
    label: "Receiving",
    has: (s) => !!s.receiving,
    sortBy: (s) => s.receiving?.yards ?? 0,
    yardsFor: (s) => s.receiving!.yards,
    bestRouteFor: bestRoute,
    columns: [
      { header: "TGT", get: (s) => s.receiving!.targets },
      { header: "REC", get: (s) => s.receiving!.catches },
      { header: "YDS", get: (s) => s.receiving!.yards, fmt: (v) => v.toFixed(0) },
      { header: "TD",  get: (s) => s.receiving!.tds },
    ],
  },
  {
    key: "defense",
    label: "Defense",
    has: (s) => !!s.defense,
    sortBy: (s) => s.defense?.tackles ?? 0,
    columns: [
      { header: "TCKL", get: (s) => s.defense!.tackles },
      { header: "TFL",  get: (s) => s.defense!.tfls },
      { header: "SACK", get: (s) => s.defense!.sacks },
      { header: "INT",  get: (s) => s.defense!.interceptions },
      { header: "PBU",  get: (s) => s.defense!.passBreakups },
    ],
  },
];

function renderPlayerStats(): HTMLElement {
  const section = document.createElement("div");
  section.className = "stats-player-col";

  const heading = document.createElement("h3");
  heading.className = "sched-heading";
  heading.textContent = "Player Stats";
  section.appendChild(heading);

  if (!hasSeasonStats()) {
    const p = document.createElement("p");
    p.className = "sched-empty";
    p.textContent = "Simulate games to accumulate player stats over the season.";
    section.appendChild(p);
    return section;
  }

  const tabBar = document.createElement("div");
  tabBar.className = "sched-stat-tabs";
  for (const tab of STAT_TABS) {
    const btn = document.createElement("button");
    btn.className = "sched-stat-tab" + (statTab === tab.key ? " active" : "");
    btn.textContent = tab.label;
    btn.addEventListener("click", () => {
      statTab = tab.key;
      statSort = null;
      render();
    });
    tabBar.appendChild(btn);
  }
  section.appendChild(tabBar);

  const cfg = STAT_TABS.find((t) => t.key === statTab)!;
  section.appendChild(renderStatTable(cfg));
  return section;
}

type StatRow = {
  color: string;
  label: Label;
  stats: PlayerStats;
  team: ReturnType<typeof teamByColor>;
  rp: ReturnType<typeof teamByColor>["roster"][number] | undefined;
  name: string;
};

type TableColumn = {
  header: string;
  thClass?: string;
  tdClass?: string;
  cell: (row: StatRow) => string;
  sortVal: (row: StatRow) => number | string;
};

function renderStatTable(cfg: (typeof STAT_TABS)[number]): HTMLElement {
  const rows: StatRow[] = [];
  for (const [color, players] of Object.entries(getSeasonStats())) {
    for (const [label, stats] of Object.entries(players)) {
      if (stats && cfg.has(stats) && cfg.columns.some((c) => c.get(stats) !== 0)) {
        const team = teamByColor(color);
        const rp = team.roster.find((p) => p.label === label);
        rows.push({ color, label: label as Label, stats, team, rp, name: rp?.name ?? "—" });
      }
    }
  }

  const metaColumns: TableColumn[] = [
    {
      header: "Player",
      thClass: "sched-stat-th-player",
      tdClass: "sched-stat-td-player",
      cell: (r) => r.name,
      sortVal: (r) => r.name.toLowerCase(),
    },
    {
      header: "Team",
      cell: (r) => `<span style="color:${r.team.color};font-weight:bold">${r.team.name}</span>`,
      sortVal: (r) => r.team.name,
    },
    { header: "Pos", cell: (r) => r.label, sortVal: (r) => r.label },
    {
      header: "OVR",
      cell: (r) => (r.rp ? playerOvrDisplay(r.rp) : "—"),
      sortVal: (r) => (r.rp ? scoreProspect(r.rp) : -1),
    },
  ];

  const statColumns: TableColumn[] = [
    {
      header: "GP",
      cell: (r) => String(getGamesPlayed(r.color)),
      sortVal: (r) => getGamesPlayed(r.color),
    },
    ...cfg.columns.map((c): TableColumn => ({
      header: c.header,
      cell: (r) => { const v = c.get(r.stats); return c.fmt ? c.fmt(v) : String(v); },
      sortVal: (r) => c.get(r.stats),
    })),
  ];

  if (cfg.yardsFor) {
    const yardsFor = cfg.yardsFor;
    const ypg = (r: StatRow) => { const gp = getGamesPlayed(r.color); return gp ? yardsFor(r.stats) / gp : 0; };
    statColumns.push({ header: "YPG", cell: (r) => ypg(r).toFixed(1), sortVal: ypg });
  }

  if (cfg.bestRouteFor) {
    const bestRouteFor = cfg.bestRouteFor;
    statColumns.push({
      header: "Best Route",
      cell: (r) => bestRouteFor(r.stats),
      sortVal: (r) => bestRouteFor(r.stats),
    });
  }

  const grade = cfg.key === "defense" ? defensiveGrade : offensiveGrade;
  statColumns.push({
    header: "GRD",
    thClass: "sched-stat-grade",
    tdClass: "sched-stat-grade",
    cell: (r) => grade(r.stats).toFixed(1),
    sortVal: (r) => grade(r.stats),
  });

  statColumns[0].thClass = `${statColumns[0].thClass ?? ""} sched-stat-divider`.trim();
  statColumns[0].tdClass = `${statColumns[0].tdClass ?? ""} sched-stat-divider`.trim();

  const columns: TableColumn[] = [...metaColumns, ...statColumns];

  if (statSort && statSort.col < columns.length) {
    const { col, dir } = statSort;
    const sv = columns[col].sortVal;
    rows.sort((a, b) => {
      const va = sv(a), vb = sv(b);
      const cmp = typeof va === "number" && typeof vb === "number"
        ? va - vb : String(va).localeCompare(String(vb));
      return dir === "asc" ? cmp : -cmp;
    });
  } else {
    rows.sort((a, b) => cfg.sortBy(b.stats) - cfg.sortBy(a.stats));
  }

  const wrap = document.createElement("div");
  wrap.className = "sched-stat-table-wrap";
  const table = document.createElement("table");
  table.className = "sched-stat-table";

  const thead = document.createElement("thead");
  const hRow = document.createElement("tr");
  hRow.innerHTML = `<th class="sched-stat-th sched-stat-th-rank">#</th>`;
  columns.forEach((c, i) => {
    const th = document.createElement("th");
    th.className = "sched-stat-th sched-stat-th-sortable" + (c.thClass ? " " + c.thClass : "");
    const active = statSort?.col === i;
    const arrow = active ? (statSort!.dir === "asc" ? " ▲" : " ▼") : "";
    th.innerHTML = `${c.header}<span class="sched-stat-arrow">${arrow}</span>`;
    if (active) th.classList.add("active");
    th.addEventListener("click", () => {
      statSort = statSort?.col === i
        ? { col: i, dir: statSort.dir === "asc" ? "desc" : "asc" }
        : { col: i, dir: i >= 3 ? "desc" : "asc" };
      render();
    });
    hRow.appendChild(th);
  });
  thead.appendChild(hRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  rows.forEach((row, i) => {
    const tr = document.createElement("tr");
    tr.className = "sched-stat-row" + (row.color === getSelectedTeamColor() ? " sched-stat-row-focus" : "");
    tr.innerHTML =
      `<td class="sched-stat-td sched-stat-td-rank">${i + 1}</td>` +
      columns.map((c) => `<td class="sched-stat-td${c.tdClass ? " " + c.tdClass : ""}">${c.cell(row)}</td>`).join("");
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

// ── Season awards ─────────────────────────────────────────────────────────────

type AwardCandidate = {
  color: string;
  label: Label;
  name: string;
  grade: number;
  stats: PlayerStats;
  side: "offense" | "defense";
};

function offAwardSummary(s: PlayerStats): string {
  const parts: string[] = [];
  if (s.passing?.attempts) {
    const p = s.passing;
    parts.push(`${p.completions}/${p.attempts}, ${p.yards.toFixed(0)} pass yds` + (p.tds ? `, ${p.tds} TD` : "") + (p.ints ? `, ${p.ints} INT` : ""));
  }
  if (s.rushing?.rushes) {
    const r = s.rushing;
    parts.push(`${r.rushes} car, ${r.yards.toFixed(0)} rush yds` + (r.tds ? `, ${r.tds} TD` : ""));
  }
  if (s.receiving?.catches) {
    const r = s.receiving;
    parts.push(`${r.catches} rec, ${r.yards.toFixed(0)} rec yds` + (r.tds ? `, ${r.tds} TD` : ""));
  }
  return parts.join(" · ");
}

function defAwardSummary(s: PlayerStats): string {
  const d = s.defense!;
  const parts: [number, string][] = [
    [d.tackles, "tkl"], [d.tfls, "TFL"], [d.sacks, "sk"],
    [d.interceptions, "INT"], [d.passBreakups, "PBU"],
  ];
  return parts.filter(([n]) => n !== 0).map(([n, u]) => `${n} ${u}`).join(", ");
}

function renderSeasonAwards(): HTMLElement {
  const section = document.createElement("div");
  section.className = "stats-awards-col";

  const heading = document.createElement("h3");
  heading.className = "sched-heading";
  heading.textContent = "Season Awards";
  section.appendChild(heading);

  if (!hasSeasonStats()) {
    const p = document.createElement("p");
    p.className = "sched-empty";
    p.textContent = "Simulate games to build the OPOY, DPOY, and MVP races.";
    section.appendChild(p);
    return section;
  }

  const opoy: AwardCandidate[] = [];
  const dpoy: AwardCandidate[] = [];
  const mvp: AwardCandidate[] = [];

  for (const [color, players] of Object.entries(getSeasonStats())) {
    const team = teamByColor(color);
    for (const [label, stats] of Object.entries(players)) {
      if (!stats) continue;
      const name = team.roster.find((p) => p.label === label)?.name ?? label;
      const base = { color, label: label as Label, name, stats };
      const off = offensiveGrade(stats);
      const def = defensiveGrade(stats);
      const isOff = hasOffense(stats);
      if (isOff) opoy.push({ ...base, grade: off, side: "offense" });
      if (stats.defense && def > 0) dpoy.push({ ...base, grade: def, side: "defense" });
      if (off !== 0 || def > 0)
        mvp.push({ ...base, grade: mvpGrade(stats), side: isOff ? "offense" : "defense" });
    }
  }

  const grid = document.createElement("div");
  grid.className = "sched-awards-grid stats-awards-grid";
  grid.appendChild(awardLeaderboard("MVP", "Most Valuable Player", mvp));
  grid.appendChild(awardLeaderboard("OPOY", "Offensive Player of the Year", opoy));
  grid.appendChild(awardLeaderboard("DPOY", "Defensive Player of the Year", dpoy));
  section.appendChild(grid);
  return section;
}

function awardLeaderboard(
  title: string,
  subtitle: string,
  candidates: AwardCandidate[],
): HTMLElement {
  const col = document.createElement("div");
  col.className = "sched-award-col";

  const head = document.createElement("div");
  head.className = "sched-award-col-head";
  head.innerHTML =
    `<span class="sched-award-col-title">${title}</span>` +
    `<span class="sched-award-col-sub">${subtitle}</span>`;
  col.appendChild(head);

  const top = [...candidates].sort((a, b) => b.grade - a.grade).slice(0, 5);
  if (top.length === 0) {
    const p = document.createElement("p");
    p.className = "sched-empty";
    p.textContent = "No candidates yet.";
    col.appendChild(p);
    return col;
  }

  top.forEach((c, i) => {
    const team = teamByColor(c.color);
    const rp = team.roster.find((p) => p.label === c.label);
    const ovr = rp ? ` · ${playerOvrDisplay(rp)}` : "";
    const summary = c.side === "offense" ? offAwardSummary(c.stats) : defAwardSummary(c.stats);
    const row = document.createElement("div");
    row.className = "sched-award-rank" + (i === 0 ? " leader" : "");
    if (c.color === getSelectedTeamColor()) row.classList.add("focus");
    row.innerHTML =
      `<div class="sched-award-rank-top">` +
      `<span class="sched-award-rank-n">${i === 0 ? "👑" : i + 1}</span>` +
      `<span class="sched-award-rank-name" style="color:${team.color}">${c.name}</span>` +
      `<span class="sched-award-rank-meta">${c.label} · ${team.name}${ovr}</span>` +
      `<span class="sched-award-rank-grade">${c.grade.toFixed(1)}</span>` +
      `</div>` +
      `<div class="sched-award-rank-stat">${summary}</div>`;
    col.appendChild(row);
  });

  return col;
}


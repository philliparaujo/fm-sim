import {
  clearSeason,
  Division,
  divisionIndexOf,
  FINAL_WEEK,
  Game,
  generateSeason,
  getChampion,
  getCurrentWeek,
  getDivisions,
  getDivisionStandings,
  getGamesForWeek,
  getRecord,
  getSeeds,
  isSeasonGenerated,
  maxWeek,
  recordGame,
  REG_SEASON_WEEKS,
  regSeasonComplete,
  SEMIFINAL_WEEK,
  seedOf,
  teamByColor,
  TeamRecord,
} from "../core/schedule";
import {
  addGamePlayerStats,
  clearSeasonStats,
  getGamesPlayed,
  getSeasonStats,
  hasSeasonStats,
} from "../core/seasonStats";
import {
  Award,
  defensiveGrade,
  hasOffense,
  mvpGrade,
  offensiveGrade,
  weeklyAwards,
} from "../core/awards";
import { scoreProspect } from "../core/draftEval";
import { LEAGUE } from "../core/state";
import { Label, PlayerStats, PlayerStatsByLabel } from "../core/types";
import { loadGame } from "../sim";
import { workerGame } from "../sim/runGame";
import { playerOvrDisplay, teamOvrDisplay } from "./displayMode";
import { getSelectedTeamColor } from "./draft";
import { initDashboard, updateDashboardValues } from "./dashboard";
import { buildRosterCard } from "./rosterCard";

type StatTab = "passing" | "rushing" | "receiving" | "defense";

/** When true, the viewed week jumps to the current week after simming games.
 * Off by default so playing a week's games leaves you on that week. */
const AUTO_ADVANCE_WEEK = false;

let viewWeek = 1;
let busy = false;
let showRosters = false;
let statTab: StatTab = "passing";
/** Active column sort for the player-stats table; null = tab's default sort. */
let statSort: { col: number; dir: "asc" | "desc" } | null = null;
/** Keys of game cards whose box score is expanded. */
const expandedGames = new Set<string>();

function allDrafted(): boolean {
  return LEAGUE.every((t) => t.roster.length > 0);
}

function formatRecord(rec: TeamRecord): string {
  return rec.ties > 0
    ? `${rec.wins}-${rec.losses}-${rec.ties}`
    : `${rec.wins}-${rec.losses}`;
}

/** League-wide average points per game across all played regular-season games. */
function leagueAvgPPG(): number | null {
  let totalPoints = 0;
  let teamGames = 0;
  for (const rec of LEAGUE.map((t) => getRecord(t.color))) {
    totalPoints += rec.pointsFor;
    teamGames += rec.wins + rec.losses + rec.ties;
  }
  return teamGames > 0 ? totalPoints / teamGames : null;
}

export function setupSchedule() {
  document.getElementById("tab-schedule")?.addEventListener("click", render);
  render();
}

/** Re-renders the season tab (e.g. after the global ratings/rankings toggle). */
export function rerenderSchedule() {
  render();
}

// ── Simulation helpers ─────────────────────────────────────────────────────

async function simOneGame(game: Game): Promise<void> {
  const home = teamByColor(game.homeColor);
  const away = teamByColor(game.awayColor);
  // Home team starts with the ball → passed as the "offense" team.
  const { offenseScore, defenseScore, playerStats } = await workerGame(
    home,
    away,
  );
  recordGame(game, offenseScore, defenseScore);
  game.playerStats = playerStats;
  addGamePlayerStats(playerStats);
}

async function simWeek(week: number): Promise<void> {
  const unplayed = getGamesForWeek(week).filter((g) => !g.played);
  await Promise.all(unplayed.map(simOneGame));
}

/** Sims consecutive weeks until `lastWeek` is done (or the season ends). */
async function simThroughWeek(lastWeek: number): Promise<void> {
  let guard = 0;
  while (guard++ < FINAL_WEEK + 2) {
    const w = getCurrentWeek();
    if (w > lastWeek) break;
    const unplayed = getGamesForWeek(w).filter((g) => !g.played);
    if (unplayed.length === 0) break;
    await simWeek(w);
  }
}

function watchGame(game: Game) {
  loadGame(game.homeColor, game.awayColor);
  initDashboard();
  updateDashboardValues();
  document.getElementById("tab-play")?.click();
}

async function withBusy(action: () => Promise<void>) {
  if (busy) return;
  busy = true;
  render();
  try {
    await action();
  } finally {
    busy = false;
    if (AUTO_ADVANCE_WEEK) viewWeek = getCurrentWeek();
    render();
  }
}

// ── Rendering ──────────────────────────────────────────────────────────────

function render() {
  const root = document.getElementById("schedule-root");
  if (!root) return;
  root.innerHTML = "";

  root.appendChild(renderControls());

  if (!isSeasonGenerated()) {
    const msg = document.createElement("p");
    msg.className = "sched-empty";
    msg.textContent =
      "No season scheduled yet. Generate a season to draw divisions and a 10-week schedule.";
    root.appendChild(msg);
    return;
  }

  const champ = getChampion();
  if (champ) root.appendChild(renderChampionBanner(champ));

  root.appendChild(renderWeekView());
  root.appendChild(renderStandings());
  if (regSeasonComplete()) root.appendChild(renderPlayoffs());
  root.appendChild(renderStatsPlaceholder());
  root.appendChild(renderSeasonAwards());
  root.appendChild(renderPlayerStats());
  root.appendChild(renderRosters());
}

function renderControls(): HTMLElement {
  const bar = document.createElement("div");
  bar.className = "sched-controls";

  const genBtn = document.createElement("button");
  genBtn.className = "draft-auto-btn";
  genBtn.style.width = "auto";
  genBtn.textContent = isSeasonGenerated()
    ? "Regenerate Season"
    : "Generate Season";
  genBtn.disabled = busy;
  genBtn.addEventListener("click", () => {
    if (
      isSeasonGenerated() &&
      !confirm("Regenerate divisions & schedule? All results will be lost.")
    )
      return;
    generateSeason();
    clearSeasonStats();
    viewWeek = 1;
    render();
  });
  bar.appendChild(genBtn);

  if (isSeasonGenerated()) {
    const notDrafted = !allDrafted();

    const weekBtn = document.createElement("button");
    weekBtn.className = "draft-auto-btn";
    weekBtn.style.width = "auto";
    weekBtn.textContent = busy ? "Simulating…" : `Sim Week ${getCurrentWeek()}`;
    weekBtn.disabled = busy || notDrafted || !!getChampion();
    weekBtn.addEventListener("click", () =>
      withBusy(() => simWeek(getCurrentWeek())),
    );
    bar.appendChild(weekBtn);

    // Only offer "Sim to Playoffs" while the regular season is still going.
    if (!regSeasonComplete()) {
      const regBtn = document.createElement("button");
      regBtn.className = "draft-auto-btn";
      regBtn.style.width = "auto";
      regBtn.textContent = "Sim to Playoffs";
      regBtn.title = "Play out the rest of the regular season";
      regBtn.disabled = busy || notDrafted;
      regBtn.addEventListener("click", () =>
        withBusy(() => simThroughWeek(REG_SEASON_WEEKS)),
      );
      bar.appendChild(regBtn);
    }

    const seasonBtn = document.createElement("button");
    seasonBtn.className = "draft-auto-btn";
    seasonBtn.style.width = "auto";
    seasonBtn.textContent = "Sim to End";
    seasonBtn.title = "Play out the regular season and the entire playoffs";
    seasonBtn.disabled = busy || notDrafted || !!getChampion();
    seasonBtn.addEventListener("click", () => withBusy(() => simThroughWeek(FINAL_WEEK)));
    bar.appendChild(seasonBtn);

    const clearBtn = document.createElement("button");
    clearBtn.className = "draft-auto-btn sim-clear-btn";
    clearBtn.style.width = "auto";
    clearBtn.textContent = "Clear Season";
    clearBtn.disabled = busy;
    clearBtn.addEventListener("click", () => {
      clearSeason();
      clearSeasonStats();
      render();
    });
    bar.appendChild(clearBtn);

    if (notDrafted) {
      const warn = document.createElement("span");
      warn.className = "sched-warn";
      warn.textContent = "Draft all teams to enable simulation.";
      bar.appendChild(warn);
    }
  }

  return bar;
}

function renderChampionBanner(color: string): HTMLElement {
  const team = teamByColor(color);
  const banner = document.createElement("div");
  banner.className = "sched-champion";
  banner.innerHTML =
    `<span class="sched-trophy">🏆</span>` +
    `<span>League Champion: <strong style="color:${team.color}">${team.name}</strong></span>` +
    `<span class="sched-trophy">🏆</span>`;
  return banner;
}

function weekLabel(week: number): string {
  if (week === SEMIFINAL_WEEK) return "Semifinals";
  if (week === FINAL_WEEK) return "Championship";
  return `Week ${week}`;
}

function renderWeekView(): HTMLElement {
  const section = document.createElement("div");
  section.className = "sched-section";

  const last = Math.max(maxWeek(), REG_SEASON_WEEKS);
  viewWeek = Math.min(Math.max(viewWeek, 1), last);

  const nav = document.createElement("div");
  nav.className = "sched-week-nav";

  const prev = document.createElement("button");
  prev.className = "sched-nav-btn";
  prev.textContent = "‹";
  prev.disabled = viewWeek <= 1;
  prev.addEventListener("click", () => {
    viewWeek--;
    render();
  });

  const title = document.createElement("div");
  title.className = "sched-week-title";
  const isCurrent = viewWeek === getCurrentWeek();
  title.innerHTML =
    `<span class="sched-week-name">${weekLabel(viewWeek)}</span>` +
    (isCurrent ? `<span class="sched-week-current">CURRENT</span>` : "");

  const next = document.createElement("button");
  next.className = "sched-nav-btn";
  next.textContent = "›";
  next.disabled = viewWeek >= last;
  next.addEventListener("click", () => {
    viewWeek++;
    render();
  });

  nav.append(prev, title, next);
  section.appendChild(nav);

  const games = getGamesForWeek(viewWeek);
  if (games.length === 0) {
    const note = document.createElement("p");
    note.className = "sched-empty";
    note.textContent =
      viewWeek >= SEMIFINAL_WEEK
        ? "Playoff matchups appear once the regular season is complete."
        : "No games scheduled.";
    section.appendChild(note);
  } else {
    const grid = document.createElement("div");
    grid.className = "sched-games";
    for (const g of games) grid.appendChild(renderGameCard(g));
    section.appendChild(grid);

    const awards = weeklyAwards(viewWeek);
    if (awards && awards.length > 0) section.appendChild(renderAwards(awards));
  }

  return section;
}

/** Player-of-the-week award cards (per division, offense & defense). */
function renderAwards(awards: Award[]): HTMLElement {
  const box = document.createElement("div");
  box.className = "sched-awards";

  const heading = document.createElement("div");
  heading.className = "sched-awards-head";
  heading.textContent = "🏅 Players of the Week";
  box.appendChild(heading);

  const grid = document.createElement("div");
  grid.className = "sched-awards-grid";
  for (const a of awards) grid.appendChild(renderAwardCard(a));
  box.appendChild(grid);

  return box;
}

function renderAwardCard(a: Award): HTMLElement {
  const team = teamByColor(a.color);
  const name = team.roster.find((p) => p.label === a.label)?.name ?? a.label;
  const summary =
    a.side === "offense" ? offAwardSummary(a.stats) : defAwardSummary(a.stats);

  const card = document.createElement("div");
  card.className = `sched-award sched-award-${a.side}`;
  card.innerHTML =
    `<div class="sched-award-head">${a.divisionName} · ${a.side === "offense" ? "Offense" : "Defense"}</div>` +
    `<div class="sched-award-player" style="color:${team.color}">${name}` +
    `<span class="sched-award-grade">${a.grade.toFixed(1)}</span></div>` +
    `<div class="sched-award-meta">${a.label} · <span style="color:${team.color}">${team.name}</span></div>` +
    `<div class="sched-award-stat">${summary}</div>`;
  return card;
}

/** Combined offensive line (passing/rushing/receiving), zero parts dropped. */
function offAwardSummary(s: PlayerStats): string {
  const parts: string[] = [];
  if (s.passing?.attempts) {
    const p = s.passing;
    parts.push(
      `${p.completions}/${p.attempts}, ${p.yards.toFixed(0)} pass yds` +
        (p.tds ? `, ${p.tds} TD` : "") +
        (p.ints ? `, ${p.ints} INT` : ""),
    );
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
    [d.tackles, "tkl"],
    [d.tfls, "TFL"],
    [d.sacks, "sk"],
    [d.interceptions, "INT"],
    [d.passBreakups, "PBU"],
  ];
  return parts.filter(([n]) => n !== 0).map(([n, u]) => `${n} ${u}`).join(", ");
}

function renderGameCard(game: Game): HTMLElement {
  const home = teamByColor(game.homeColor);
  const away = teamByColor(game.awayColor);
  const card = document.createElement("div");
  card.className = "sched-game" + (game.played ? " played" : "");
  if (game.round !== "regular") card.classList.add("sched-game-playoff");
  const focus = getSelectedTeamColor();
  if (focus && (game.homeColor === focus || game.awayColor === focus))
    card.classList.add("sched-game-focus");

  const isTie = game.played && game.homeScore === game.awayScore;
  const homeWon = game.played && !isTie && game.homeScore > game.awayScore;
  const awayWon = game.played && !isTie && game.awayScore > game.homeScore;

  // Matchup tag: only division rivalries are called out (regular season only).
  const isDivision =
    game.round === "regular" &&
    divisionIndexOf(game.homeColor) === divisionIndexOf(game.awayColor);
  if (isDivision) {
    const tag = document.createElement("div");
    tag.className = "sched-game-tag sched-game-tag-div";
    tag.textContent = "DIVISION";
    card.appendChild(tag);
  }

  const teamRow = (
    team: typeof home,
    score: number,
    won: boolean,
    isHome: boolean,
  ) => {
    const seed = game.round !== "regular" ? seedOf(team.color) : null;
    return (
      `<div class="sched-game-team${won ? " winner" : ""}">` +
      `<span class="sched-game-name" style="color:${team.color}">` +
      (seed ? `<span class="sched-seed">${seed}</span>` : "") +
      `${isHome ? "🏈 " : ""}${team.name}` +
      `<span class="sched-game-ovr">${teamOvrDisplay(team)}</span>` +
      `<span class="sched-game-rec">${formatRecord(getRecord(team.color))}</span>` +
      `</span>` +
      `<span class="sched-game-score">${game.played ? score : ""}</span>` +
      `</div>`
    );
  };

  const body = document.createElement("div");
  body.className = "sched-game-body";
  body.innerHTML =
    teamRow(away, game.awayScore, awayWon, false) +
    teamRow(home, game.homeScore, homeWon, true);
  card.appendChild(body);

  const actions = document.createElement("div");
  actions.className = "sched-game-actions";

  if (game.played) {
    const result = document.createElement("span");
    result.className = "sched-game-final";
    result.textContent = isTie ? "TIE" : "FINAL";
    actions.appendChild(result);

    if (game.playerStats) {
      const key = gameKey(game);
      const expanded = expandedGames.has(key);
      const boxBtn = document.createElement("button");
      boxBtn.className = "sched-box-btn";
      boxBtn.textContent = expanded ? "▾ Box score" : "▸ Box score";
      boxBtn.addEventListener("click", () => {
        if (expanded) expandedGames.delete(key);
        else expandedGames.add(key);
        render();
      });
      actions.appendChild(boxBtn);
    }
  } else {
    const playBtn = document.createElement("button");
    playBtn.className = "sched-play-btn";
    playBtn.textContent = "Play ▶";
    playBtn.disabled = busy || !allDrafted();
    playBtn.addEventListener("click", () =>
      withBusy(async () => {
        await simOneGame(game);
      }),
    );
    actions.appendChild(playBtn);

    const watchBtn = document.createElement("button");
    watchBtn.className = "sched-watch-btn";
    watchBtn.textContent = "Watch";
    watchBtn.disabled = busy || !allDrafted();
    watchBtn.title = "Load this matchup live in the Play tab";
    watchBtn.addEventListener("click", () => watchGame(game));
    actions.appendChild(watchBtn);
  }

  card.appendChild(actions);

  if (game.played && game.playerStats && expandedGames.has(gameKey(game))) {
    card.appendChild(renderBoxScore(game));
  }

  return card;
}

function gameKey(game: Game): string {
  return `${game.round}-${game.week}-${game.homeColor}-${game.awayColor}`;
}

/** Compact per-team leaders (passer, rusher, top receiver, top defender). */
function renderBoxScore(game: Game): HTMLElement {
  const box = document.createElement("div");
  box.className = "sched-box";

  const stats = game.playerStats!;
  // Away team on top to match the card's team order.
  for (const color of [game.awayColor, game.homeColor]) {
    const team = teamByColor(color);
    const players = stats[color] ?? {};

    const teamEl = document.createElement("div");
    teamEl.className = "sched-box-team";

    const head = document.createElement("div");
    head.className = "sched-box-team-name";
    head.style.color = team.color;
    head.textContent = team.name;
    teamEl.appendChild(head);

    const nameOf = (label: string) =>
      team.roster.find((p) => p.label === label)?.name ?? label;

    const lines: string[] = [];

    // Joins stat parts, dropping any whose count is zero (keeps `always` parts).
    const statline = (always: string[], optional: [number, string][]) =>
      [
        ...always,
        ...optional.filter(([n]) => n !== 0).map(([n, unit]) => `${n} ${unit}`),
      ].join(", ");

    // Passer (the team's QB)
    const passEntry = Object.entries(players).find(([, s]) => s?.passing);
    if (passEntry) {
      const p = passEntry[1]!.passing!;
      if (p.attempts > 0)
        lines.push(
          leaderLine(
            passEntry[0],
            nameOf(passEntry[0]),
            statline(
              [`${p.completions}/${p.attempts}`, `${p.yards.toFixed(0)} yds`],
              [
                [p.tds, "TD"],
                [p.ints, "INT"],
              ],
            ),
          ),
        );
    }

    // Leading rusher (most carries, then yards)
    const rusher = topBy(
      players,
      (s) => (s.rushing?.rushes ?? 0) * 1000 + (s.rushing?.yards ?? 0),
    );
    if (rusher && rusher.stats.rushing!.rushes > 0) {
      const r = rusher.stats.rushing!;
      lines.push(
        leaderLine(
          rusher.label,
          nameOf(rusher.label),
          statline(
            [`${r.rushes} car`, `${r.yards.toFixed(0)} yds`],
            [[r.tds, "TD"]],
          ),
        ),
      );
    }

    // Leading receiver (most catches, then yards)
    const receiver = topBy(
      players,
      (s) => (s.receiving?.catches ?? 0) * 1000 + (s.receiving?.yards ?? 0),
    );
    if (receiver && receiver.stats.receiving!.catches > 0) {
      const r = receiver.stats.receiving!;
      lines.push(
        leaderLine(
          receiver.label,
          nameOf(receiver.label),
          statline(
            [`${r.catches} rec`, `${r.yards.toFixed(0)} yds`],
            [[r.tds, "TD"]],
          ),
        ),
      );
    }

    // Leading defender (top tackles, then sacks + INTs)
    const defender = topBy(players, (s) =>
      s.defense
        ? s.defense.tackles +
          s.defense.tfls * 2 +
          s.defense.sacks * 6 +
          s.defense.interceptions * 10 +
          s.defense.passBreakups * 2
        : 0,
    );
    if (defender && defender.stats.defense) {
      const d = defender.stats.defense;
      if (d.tackles + d.sacks + d.interceptions + d.passBreakups > 0)
        lines.push(
          leaderLine(
            defender.label,
            nameOf(defender.label),
            statline(
              [],
              [
                [d.tackles, "tkl"],
                [d.tfls, "tfl"],
                [d.sacks, "sk"],
                [d.interceptions, "INT"],
                [d.passBreakups, "PBU"],
              ],
            ),
          ),
        );
    }

    teamEl.innerHTML +=
      lines.join("") || `<div class="sched-box-empty">No production.</div>`;
    box.appendChild(teamEl);
  }

  return box;
}

function leaderLine(tag: string, name: string, detail: string): string {
  return (
    `<div class="sched-box-line">` +
    `<span class="sched-box-tag">${tag}</span>` +
    `<span class="sched-box-name">${name}</span>` +
    `<span class="sched-box-detail">${detail}</span>` +
    `</div>`
  );
}

/** Highest-scoring player line by `score` (negatives allowed), or null if none. */
function topBy(
  players: PlayerStatsByLabel,
  score: (s: PlayerStats) => number,
): { label: Label; stats: PlayerStats } | null {
  let best: { label: Label; stats: PlayerStats } | null = null;
  let bestScore = -Infinity;
  for (const [label, stats] of Object.entries(players)) {
    if (!stats) continue;
    const sc = score(stats);
    if (sc > bestScore) {
      bestScore = sc;
      best = { label: label as Label, stats };
    }
  }
  return best;
}

function renderStandings(): HTMLElement {
  const section = document.createElement("div");
  section.className = "sched-section";

  const heading = document.createElement("h3");
  heading.className = "sched-heading";
  heading.textContent = "Standings";
  section.appendChild(heading);

  const wrap = document.createElement("div");
  wrap.className = "sched-standings-wrap";
  getDivisions().forEach((div, i) =>
    wrap.appendChild(renderDivisionTable(div, i)),
  );
  section.appendChild(wrap);

  const avg = leagueAvgPPG();
  if (avg !== null) {
    const ppg = document.createElement("div");
    ppg.className = "sched-league-ppg";
    ppg.textContent = `League average: ${avg.toFixed(1)} PPG`;
    section.appendChild(ppg);
  }

  return section;
}

function renderDivisionTable(div: Division, divIndex: number): HTMLElement {
  const standings = getDivisionStandings(divIndex);
  const seeds = getSeeds();

  const box = document.createElement("div");
  box.className = "sched-division";

  const table = document.createElement("table");
  table.className = "sched-table";
  table.innerHTML =
    `<thead><tr>` +
    `<th class="sched-th sched-th-team">${div.name}</th>` +
    `<th class="sched-th">W</th><th class="sched-th">L</th><th class="sched-th">T</th>` +
    `<th class="sched-th">PCT</th>` +
    `<th class="sched-th">PF</th><th class="sched-th">PA</th><th class="sched-th">DIFF</th>` +
    `</tr></thead>`;

  const tbody = document.createElement("tbody");
  standings.forEach((rec, rank) => {
    const team = teamByColor(rec.color);
    const games = rec.wins + rec.losses + rec.ties;
    const pct =
      games > 0
        ? ((rec.wins + 0.5 * rec.ties) / games).toFixed(3).replace(/^0/, "")
        : "—";
    const diff = rec.pointsFor - rec.pointsAgainst;
    const seed = seeds ? seedOf(rec.color) : null;
    // Before the season ends, highlight the current division leader.
    const isLeader = rank === 0;

    const tr = document.createElement("tr");
    tr.className = "sched-row";
    if (seed) tr.classList.add("sched-row-playoff");
    else if (isLeader && !seeds) tr.classList.add("sched-row-leader");
    if (rec.color === getSelectedTeamColor())
      tr.classList.add("sched-row-focus");

    const marker = seed
      ? `<span class="sched-seed">${seed}</span>`
      : isLeader && !seeds
        ? `<span class="sched-leader-dot">◆</span>`
        : "";

    tr.innerHTML =
      `<td class="sched-td sched-td-team" style="color:${team.color}">${marker}${team.name}` +
      `<span class="sched-td-ovr">${teamOvrDisplay(team)}</span></td>` +
      `<td class="sched-td">${rec.wins}</td>` +
      `<td class="sched-td">${rec.losses}</td>` +
      `<td class="sched-td">${rec.ties}</td>` +
      `<td class="sched-td">${pct}</td>` +
      `<td class="sched-td">${rec.pointsFor}</td>` +
      `<td class="sched-td">${rec.pointsAgainst}</td>` +
      `<td class="sched-td">${diff >= 0 ? "+" : ""}${diff}</td>`;
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  box.appendChild(table);
  return box;
}

function renderPlayoffs(): HTMLElement {
  const section = document.createElement("div");
  section.className = "sched-section";

  const heading = document.createElement("h3");
  heading.className = "sched-heading";
  heading.textContent = "Playoff Bracket";
  section.appendChild(heading);

  const seeds = getSeeds();
  if (seeds) {
    const seedList = document.createElement("div");
    seedList.className = "sched-seedlist";
    seeds.forEach((rec, i) => {
      const team = teamByColor(rec.color);
      const chip = document.createElement("span");
      chip.className = "sched-seed-chip";
      chip.innerHTML =
        `<span class="sched-seed">${i + 1}</span>` +
        `<span style="color:${team.color}">${team.name}</span>` +
        `<span class="sched-seed-rec">${rec.wins}-${rec.losses}${rec.ties ? "-" + rec.ties : ""}</span>`;
      seedList.appendChild(chip);
    });
    section.appendChild(seedList);
  }

  const bracket = document.createElement("div");
  bracket.className = "sched-bracket";

  const semis = getGamesForWeek(SEMIFINAL_WEEK);
  const finals = getGamesForWeek(FINAL_WEEK);

  const col = (label: string, games: Game[]) => {
    const c = document.createElement("div");
    c.className = "sched-bracket-col";
    const h = document.createElement("div");
    h.className = "sched-bracket-label";
    h.textContent = label;
    c.appendChild(h);
    if (games.length === 0) {
      const p = document.createElement("p");
      p.className = "sched-empty";
      p.textContent = "Awaiting semifinal results.";
      c.appendChild(p);
    } else {
      for (const g of games) c.appendChild(renderGameCard(g));
    }
    return c;
  };

  bracket.appendChild(col("Semifinals", semis));
  bracket.appendChild(col("Championship", finals));
  section.appendChild(bracket);

  return section;
}

function renderStatsPlaceholder(): HTMLElement {
  const section = document.createElement("div");
  section.className = "sched-section";

  const heading = document.createElement("h3");
  heading.className = "sched-heading";
  heading.textContent = "League Leaders";
  section.appendChild(heading);

  const records = LEAGUE.map((t) => getRecord(t.color));
  const played = records.some((r) => r.wins + r.losses + r.ties > 0);

  const grid = document.createElement("div");
  grid.className = "sched-leaders";

  if (!played) {
    const p = document.createElement("p");
    p.className = "sched-empty";
    p.textContent = "Play some games to populate league leaders.";
    section.appendChild(p);
    return section;
  }

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

  grid.appendChild(
    leader(
      "Most Points For",
      (r) => r.pointsFor,
      (r) => `${r.pointsFor} pts`,
    ),
  );
  grid.appendChild(
    leader(
      "Stingiest Defense",
      (r) => r.pointsAgainst,
      (r) => `${r.pointsAgainst} allowed`,
      false,
    ),
  );
  grid.appendChild(
    leader(
      "Best Point Diff",
      (r) => r.pointsFor - r.pointsAgainst,
      (r) => {
        const d = r.pointsFor - r.pointsAgainst;
        return `${d >= 0 ? "+" : ""}${d}`;
      },
    ),
  );
  grid.appendChild(
    leader(
      "Most Wins",
      (r) => r.wins,
      (r) => `${r.wins} wins`,
    ),
  );

  section.appendChild(grid);
  return section;
}

// ── Player stats (tabbed: passing / rushing / receiving / defense) ───────────

type StatColumn = {
  header: string;
  /** Cell value from a player's stat line. */
  get: (s: PlayerStats) => number;
  /** Format for display (defaults to integer). */
  fmt?: (v: number) => string;
};

const STAT_TABS: {
  key: StatTab;
  label: string;
  /** Which stat block a player must have to appear on this tab. */
  has: (s: PlayerStats) => boolean;
  /** Column that the table is sorted by (descending). */
  sortBy: (s: PlayerStats) => number;
  columns: StatColumn[];
  /** Yardage accessor for offensive tabs → enables a YPG column. */
  yardsFor?: (s: PlayerStats) => number;
}[] = [
  {
    key: "passing",
    label: "Passing",
    has: (s) => !!s.passing,
    sortBy: (s) => s.passing?.yards ?? 0,
    yardsFor: (s) => s.passing!.yards,
    columns: [
      { header: "ATT", get: (s) => s.passing!.attempts },
      { header: "CMP", get: (s) => s.passing!.completions },
      {
        header: "CMP%",
        get: (s) => s.passing!.cmp * 100,
        fmt: (v) => v.toFixed(1),
      },
      { header: "YDS", get: (s) => s.passing!.yards, fmt: (v) => v.toFixed(0) },
      { header: "YPA", get: (s) => s.passing!.ypa, fmt: (v) => v.toFixed(1) },
      { header: "TD", get: (s) => s.passing!.tds },
      { header: "INT", get: (s) => s.passing!.ints },
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
      { header: "TD", get: (s) => s.rushing!.tds },
    ],
  },
  {
    key: "receiving",
    label: "Receiving",
    has: (s) => !!s.receiving,
    sortBy: (s) => s.receiving?.yards ?? 0,
    yardsFor: (s) => s.receiving!.yards,
    columns: [
      { header: "TGT", get: (s) => s.receiving!.targets },
      { header: "REC", get: (s) => s.receiving!.catches },
      {
        header: "YDS",
        get: (s) => s.receiving!.yards,
        fmt: (v) => v.toFixed(0),
      },
      { header: "TD", get: (s) => s.receiving!.tds },
    ],
  },
  {
    key: "defense",
    label: "Defense",
    has: (s) => !!s.defense,
    sortBy: (s) => s.defense?.tackles ?? 0,
    columns: [
      { header: "TCKL", get: (s) => s.defense!.tackles },
      { header: "TFL", get: (s) => s.defense!.tfls },
      { header: "SACK", get: (s) => s.defense!.sacks },
      { header: "INT", get: (s) => s.defense!.interceptions },
      { header: "PBU", get: (s) => s.defense!.passBreakups },
    ],
  },
];

function renderPlayerStats(): HTMLElement {
  const section = document.createElement("div");
  section.className = "sched-section";

  const heading = document.createElement("h3");
  heading.className = "sched-heading";
  heading.textContent = "Player Stats";
  section.appendChild(heading);

  if (!hasSeasonStats()) {
    const p = document.createElement("p");
    p.className = "sched-empty";
    p.textContent =
      "Simulate games to accumulate player stats over the season.";
    section.appendChild(p);
    return section;
  }

  // Sub-tab bar
  const tabBar = document.createElement("div");
  tabBar.className = "sched-stat-tabs";
  for (const tab of STAT_TABS) {
    const btn = document.createElement("button");
    btn.className = "sched-stat-tab" + (statTab === tab.key ? " active" : "");
    btn.textContent = tab.label;
    btn.addEventListener("click", () => {
      statTab = tab.key;
      statSort = null; // columns differ per tab
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
  /** Value used for sorting; string sorts alphabetically, number numerically. */
  sortVal: (row: StatRow) => number | string;
};

function renderStatTable(cfg: (typeof STAT_TABS)[number]): HTMLElement {
  // Gather every player carrying the relevant stat block.
  const rows: StatRow[] = [];
  for (const [color, players] of Object.entries(getSeasonStats())) {
    for (const [label, stats] of Object.entries(players)) {
      // Only include players with at least one non-zero stat on this tab
      // (e.g. hides RBs with no receiving production from the receiving tab).
      if (
        stats &&
        cfg.has(stats) &&
        cfg.columns.some((c) => c.get(stats) !== 0)
      ) {
        const team = teamByColor(color);
        const rp = team.roster.find((p) => p.label === label);
        rows.push({
          color,
          label: label as Label,
          stats,
          team,
          rp,
          name: rp?.name ?? "—",
        });
      }
    }
  }

  // Meta columns (player/team/pos/ovr) — visually separated from the stats.
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
      cell: (r) =>
        `<span style="color:${r.team.color};font-weight:bold">${r.team.name}</span>`,
      sortVal: (r) => r.team.name,
    },
    { header: "Pos", cell: (r) => r.label, sortVal: (r) => r.label },
    {
      header: "OVR",
      cell: (r) => (r.rp ? playerOvrDisplay(r.rp) : "—"),
      sortVal: (r) => (r.rp ? scoreProspect(r.rp) : -1),
    },
  ];

  // Stat columns: games played, the tab's stats, and YPG for offensive tabs.
  const statColumns: TableColumn[] = [
    {
      header: "GP",
      cell: (r) => String(getGamesPlayed(r.color)),
      sortVal: (r) => getGamesPlayed(r.color),
    },
    ...cfg.columns.map(
      (c): TableColumn => ({
        header: c.header,
        cell: (r) => {
          const v = c.get(r.stats);
          return c.fmt ? c.fmt(v) : String(v);
        },
        sortVal: (r) => c.get(r.stats),
      }),
    ),
  ];
  if (cfg.yardsFor) {
    const yardsFor = cfg.yardsFor;
    const ypg = (r: StatRow) => {
      const gp = getGamesPlayed(r.color);
      return gp ? yardsFor(r.stats) / gp : 0;
    };
    statColumns.push({
      header: "YPG",
      cell: (r) => ypg(r).toFixed(1),
      sortVal: ypg,
    });
  }

  // Award grade for this tab: offensive grade on offensive tabs, defensive on
  // the defense tab. Mirrors the OPOY/DPOY scoring.
  const grade = cfg.key === "defense" ? defensiveGrade : offensiveGrade;
  statColumns.push({
    header: "GRD",
    thClass: "sched-stat-grade",
    tdClass: "sched-stat-grade",
    cell: (r) => grade(r.stats).toFixed(1),
    sortVal: (r) => grade(r.stats),
  });

  // Mark the first stat column so it renders the meta/stats divider.
  statColumns[0].thClass =
    `${statColumns[0].thClass ?? ""} sched-stat-divider`.trim();
  statColumns[0].tdClass =
    `${statColumns[0].tdClass ?? ""} sched-stat-divider`.trim();

  const columns: TableColumn[] = [...metaColumns, ...statColumns];

  // Apply the active sort, or fall back to the tab's default (key stat, desc).
  if (statSort && statSort.col < columns.length) {
    const { col, dir } = statSort;
    const sv = columns[col].sortVal;
    rows.sort((a, b) => {
      const va = sv(a);
      const vb = sv(b);
      const cmp =
        typeof va === "number" && typeof vb === "number"
          ? va - vb
          : String(va).localeCompare(String(vb));
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
    th.className =
      "sched-stat-th sched-stat-th-sortable" +
      (c.thClass ? " " + c.thClass : "");
    const active = statSort?.col === i;
    const arrow = active ? (statSort!.dir === "asc" ? " ▲" : " ▼") : "";
    th.innerHTML = `${c.header}<span class="sched-stat-arrow">${arrow}</span>`;
    if (active) th.classList.add("active");
    th.addEventListener("click", () => {
      if (statSort?.col === i) {
        statSort = { col: i, dir: statSort.dir === "asc" ? "desc" : "asc" };
      } else {
        // OVR (col 3) and stat columns are numeric → default descending
        // (highest first); the text columns default to ascending.
        const numeric = i >= 3;
        statSort = { col: i, dir: numeric ? "desc" : "asc" };
      }
      render();
    });
    hRow.appendChild(th);
  });
  thead.appendChild(hRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  rows.forEach((row, i) => {
    const tr = document.createElement("tr");
    tr.className = "sched-stat-row";
    if (row.color === getSelectedTeamColor())
      tr.classList.add("sched-stat-row-focus");
    tr.innerHTML =
      `<td class="sched-stat-td sched-stat-td-rank">${i + 1}</td>` +
      columns
        .map(
          (c) =>
            `<td class="sched-stat-td${c.tdClass ? " " + c.tdClass : ""}">${c.cell(row)}</td>`,
        )
        .join("");
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

// ── Season awards (OPOY / DPOY / MVP) ────────────────────────────────────────

type AwardCandidate = {
  color: string;
  label: Label;
  name: string;
  grade: number;
  stats: PlayerStats;
  side: "offense" | "defense";
};

/**
 * Season-long award leaderboards. Because the grade functions are linear in the
 * counting stats, grading the accumulated season totals equals the sum of each
 * game's grade — so this stays in sync with the weekly stat accumulation.
 */
function renderSeasonAwards(): HTMLElement {
  const section = document.createElement("div");
  section.className = "sched-section";

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
      // MVP is QB-weighted total impact (see mvpGrade); its summary follows the
      // player's dominant side.
      if (off !== 0 || def > 0)
        mvp.push({ ...base, grade: mvpGrade(stats), side: isOff ? "offense" : "defense" });
    }
  }

  const grid = document.createElement("div");
  grid.className = "sched-awards-grid";
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
    const summary =
      c.side === "offense" ? offAwardSummary(c.stats) : defAwardSummary(c.stats);
    const row = document.createElement("div");
    row.className = "sched-award-rank" + (i === 0 ? " leader" : "");
    if (c.color === getSelectedTeamColor()) row.classList.add("focus");
    row.innerHTML =
      `<div class="sched-award-rank-top">` +
      `<span class="sched-award-rank-n">${i === 0 ? "👑" : i + 1}</span>` +
      `<span class="sched-award-rank-name" style="color:${team.color}">${c.name}</span>` +
      `<span class="sched-award-rank-meta">${c.label} · ${team.name}</span>` +
      `<span class="sched-award-rank-grade">${c.grade.toFixed(1)}</span>` +
      `</div>` +
      `<div class="sched-award-rank-stat">${summary}</div>`;
    col.appendChild(row);
  });

  return col;
}

function renderRosters(): HTMLElement {
  const section = document.createElement("div");
  section.className = "sched-section";

  const heading = document.createElement("h3");
  heading.className = "sched-heading sched-heading-toggle";
  heading.innerHTML = `<span>${showRosters ? "▼" : "▶"}</span> Rosters`;
  heading.addEventListener("click", () => {
    showRosters = !showRosters;
    render();
  });
  section.appendChild(heading);

  if (!showRosters) return section;

  getDivisions().forEach((div, i) => {
    const divHeading = document.createElement("div");
    divHeading.className = "sched-roster-div";
    divHeading.textContent = `${div.name} Division`;
    section.appendChild(divHeading);

    const row = document.createElement("div");
    row.className = "sched-roster-row";
    // Order by current standings within the division.
    for (const rec of getDivisionStandings(i)) {
      row.appendChild(buildRosterCard(teamByColor(rec.color)));
    }
    section.appendChild(row);
  });

  return section;
}

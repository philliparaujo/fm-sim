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
import { LEAGUE } from "../core/state";
import { loadGame } from "../sim";
import { workerGame } from "../sim/runGame";
import { teamOvrDisplay } from "./displayMode";
import { getSelectedTeamColor } from "./draft";
import { initDashboard, updateDashboardValues } from "./dashboard";
import { buildRosterCard } from "./rosterCard";

/** When true, the viewed week jumps to the current week after simming games.
 * Off by default so playing a week's games leaves you on that week. */
const AUTO_ADVANCE_WEEK = false;

let viewWeek = 1;
let busy = false;
let showRosters = false;

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

// ── Simulation helpers ─────────────────────────────────────────────────────

async function simOneGame(game: Game): Promise<void> {
  const home = teamByColor(game.homeColor);
  const away = teamByColor(game.awayColor);
  // Home team starts with the ball → passed as the "offense" team.
  const { offenseScore, defenseScore } = await workerGame(home, away);
  recordGame(game, offenseScore, defenseScore);
}

async function simWeek(week: number): Promise<void> {
  const unplayed = getGamesForWeek(week).filter((g) => !g.played);
  await Promise.all(unplayed.map(simOneGame));
}

async function simRestOfSeason(): Promise<void> {
  let guard = 0;
  while (guard++ < FINAL_WEEK + 2) {
    const w = getCurrentWeek();
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
  root.appendChild(renderStatsPlaceholders());
  root.appendChild(renderRosters());
}

function renderControls(): HTMLElement {
  const bar = document.createElement("div");
  bar.className = "sched-controls";

  const genBtn = document.createElement("button");
  genBtn.className = "draft-auto-btn";
  genBtn.style.width = "auto";
  genBtn.textContent = isSeasonGenerated() ? "Regenerate Season" : "Generate Season";
  genBtn.disabled = busy;
  genBtn.addEventListener("click", () => {
    if (isSeasonGenerated() && !confirm("Regenerate divisions & schedule? All results will be lost."))
      return;
    generateSeason();
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
    weekBtn.addEventListener("click", () => withBusy(() => simWeek(getCurrentWeek())));
    bar.appendChild(weekBtn);

    const seasonBtn = document.createElement("button");
    seasonBtn.className = "draft-auto-btn";
    seasonBtn.style.width = "auto";
    seasonBtn.textContent = "Sim to End";
    seasonBtn.disabled = busy || notDrafted || !!getChampion();
    seasonBtn.addEventListener("click", () => withBusy(simRestOfSeason));
    bar.appendChild(seasonBtn);

    const clearBtn = document.createElement("button");
    clearBtn.className = "draft-auto-btn sim-clear-btn";
    clearBtn.style.width = "auto";
    clearBtn.textContent = "Clear Season";
    clearBtn.disabled = busy;
    clearBtn.addEventListener("click", () => {
      clearSeason();
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
  }

  return section;
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

  const teamRow = (team: typeof home, score: number, won: boolean, isHome: boolean) => {
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
  return card;
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
  getDivisions().forEach((div, i) => wrap.appendChild(renderDivisionTable(div, i)));
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
    const pct = games > 0 ? ((rec.wins + 0.5 * rec.ties) / games).toFixed(3).replace(/^0/, "") : "—";
    const diff = rec.pointsFor - rec.pointsAgainst;
    const seed = seeds ? seedOf(rec.color) : null;
    // Before the season ends, highlight the current division leader.
    const isLeader = rank === 0;

    const tr = document.createElement("tr");
    tr.className = "sched-row";
    if (seed) tr.classList.add("sched-row-playoff");
    else if (isLeader && !seeds) tr.classList.add("sched-row-leader");
    if (rec.color === getSelectedTeamColor()) tr.classList.add("sched-row-focus");

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
    const best = [...records].sort((a, b) => (max ? pick(b) - pick(a) : pick(a) - pick(b)))[0];
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
  grid.appendChild(
    leader("Stingiest Defense", (r) => r.pointsAgainst, (r) => `${r.pointsAgainst} allowed`, false),
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
  grid.appendChild(leader("Most Wins", (r) => r.wins, (r) => `${r.wins} wins`));

  section.appendChild(grid);
  return section;
}

/** Placeholder panels for future team/player stats and an MVP race. */
function renderStatsPlaceholders(): HTMLElement {
  const section = document.createElement("div");
  section.className = "sched-section";

  const heading = document.createElement("h3");
  heading.className = "sched-heading";
  heading.textContent = "Stats & Awards";
  section.appendChild(heading);

  const grid = document.createElement("div");
  grid.className = "sched-placeholder-grid";

  const panel = (icon: string, title: string, blurb: string) => {
    const p = document.createElement("div");
    p.className = "sched-placeholder";
    p.innerHTML =
      `<div class="sched-placeholder-icon">${icon}</div>` +
      `<div class="sched-placeholder-title">${title}</div>` +
      `<div class="sched-placeholder-blurb">${blurb}</div>` +
      `<div class="sched-placeholder-tag">Coming soon</div>`;
    return p;
  };

  grid.appendChild(panel("🏈", "Player Stats", "Passing, rushing & receiving leaders per game."));
  grid.appendChild(panel("📊", "Team Stats", "Yards, turnovers, third-down and red-zone rates."));
  grid.appendChild(panel("⭐", "MVP Race", "Top performers ranked by season impact."));

  section.appendChild(grid);
  return section;
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

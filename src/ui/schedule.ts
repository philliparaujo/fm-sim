import {
  clearSeason,
  Division,
  divisionIndexOf,
  FINAL_WEEK,
  Game,
  generateSeason,
  getChampion,
  getCurrentWeek,
  getDivisionRecord,
  getDivisions,
  getDivisionStandings,
  getGames,
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
  addGameDefensiveStats,
  addGamePlayerStats,
  addGameRouteCoverageStats,
  clearSeasonStats,
  getSeasonStats,
  hasSeasonStats,
} from "../core/seasonStats";
import {
  autoTrainAll,
  autoTrainAllExcept,
  autoTrainTeam,
  clearTrainingCompletion,
  isTrainingDoneForWeek,
  teamWeeklyGain,
} from "../core/training";
import {
  Award,
  defensiveGrade,
  hasOffense,
  mvpGrade,
  offensiveGrade,
  receivingGrade,
  rushingGrade,
  weeklyAwards,
} from "../core/awards";
import { LEAGUE } from "../core/state";
import { Label, PlayerStats, PlayerStatsByLabel } from "../core/types";
import { Highlight } from "../core/highlights";
import { getLiveGameResult, loadGame, onGameOver } from "../sim";
import { workerGame } from "../sim/runGame";
import { openReel } from "./highlightReel";
import { playerOvrDisplay, teamOvrDisplay } from "./displayMode";
import { getSelectedTeamColor, getRosterSort, onRosterSort } from "./draft";
import { initDashboard, updateDashboardValues } from "./dashboard";
import { buildRosterCard } from "./rosterCard";
import { focusTrainingTeam } from "./training";

/** When true, the viewed week jumps to the current (first non-completed) week
 * after a multi-week sim (Sim to Playoffs / Sim to End) — see withBusy — so
 * you land on the next week that still needs action. A single "Sim Week N"
 * (or an individual game's Sim/Highlights action) never auto-advances; you
 * stay on the week you were looking at. */
const AUTO_ADVANCE_WEEK = true;

/** When true, simming a week (Sim Week / Sim to Playoffs / Sim to End) also
 * auto-completes that week's training for every team — human-controlled or
 * CPU — that hasn't already trained it manually, so development never
 * silently skips a week just because nobody visited the Training tab. */
const AUTO_TRAIN_ON_SIM = true;

let viewWeek = 1;
let busy = false;
let showRosters = false;
/** Week currently being simmed, for a live "Simulating Week N…" indicator that
 * updates on its own during a multi-week sim (Sim to Playoffs / Sim to End) —
 * not just when some unrelated click happens to trigger a re-render. Null
 * outside of an active sim. */
let simProgressWeek: number | null = null;
/** Which sim button is driving the active sim, so the progress label only
 * replaces THAT button's text — otherwise all three buttons would flip to the
 * same "Simulating…" text at once, which reads as three sims running. Null
 * outside of an active sim. */
let activeSimAction: "week" | "playoffs" | "end" | null = null;
/** The unplayed game currently being watched live, recorded once it ends. */
let pendingWatch: Game | null = null;
/** Keys of game cards whose box score is expanded. */
const expandedGames = new Set<string>();
/** Keys of game cards whose highlight list is expanded. */
const expandedHighlights = new Set<string>();

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

/** League-wide average yards per passing attempt across all season stats. */
function leagueAvgYPA(): number | null {
  let totalYards = 0;
  let totalAttempts = 0;
  for (const players of Object.values(getSeasonStats())) {
    for (const line of Object.values(players)) {
      if (line?.passing) {
        totalYards += line.passing.yards;
        totalAttempts += line.passing.attempts;
      }
    }
  }
  return totalAttempts > 0 ? totalYards / totalAttempts : null;
}

/** League-wide average yards per carry across all season stats. */
function leagueAvgYPC(): number | null {
  let totalYards = 0;
  let totalCarries = 0;
  for (const players of Object.values(getSeasonStats())) {
    for (const line of Object.values(players)) {
      if (line?.rushing) {
        totalYards += line.rushing.yards;
        totalCarries += line.rushing.rushes;
      }
    }
  }
  return totalCarries > 0 ? totalYards / totalCarries : null;
}

export function setupSchedule() {
  document.getElementById("tab-schedule")?.addEventListener("click", render);
  onRosterSort(() => render());
  onGameOver(recordWatchedGame);
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
  const {
    offenseScore,
    defenseScore,
    playerStats,
    defensivePlaycalls,
    routeCoverage,
    highlights,
  } = await workerGame(home, away);
  recordGame(game, offenseScore, defenseScore);
  game.playerStats = playerStats;
  game.highlights = highlights;
  // Playoff games don't count toward cumulative season stats or award races.
  if (game.round === "regular") {
    addGamePlayerStats(playerStats);
    addGameDefensiveStats(defensivePlaycalls);
    addGameRouteCoverageStats(routeCoverage);
  }
}

async function simWeek(week: number): Promise<void> {
  // Live progress indicator: updates the sim controls immediately (and again
  // once this week's games finish), independent of any other UI interaction —
  // so a multi-week sim visibly advances week by week on its own.
  simProgressWeek = week;
  render();
  // Training happens before that week's games so it can affect them, and only
  // fills in whoever hasn't already trained manually this week.
  if (AUTO_TRAIN_ON_SIM) autoTrainAll(week);
  const unplayed = getGamesForWeek(week).filter((g) => !g.played);
  await Promise.all(unplayed.map(simOneGame));
  render();
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

/** Loads a matchup live in the Play tab. Unlike a headless sim, the result is
 * recorded to the season only once the game finishes (see recordWatchedGame). */
function watchGame(game: Game) {
  pendingWatch = game.played ? null : game;
  loadGame(game.homeColor, game.awayColor);
  initDashboard();
  updateDashboardValues();
  document.getElementById("tab-play")?.click();
}

/** Fired when a live game ends: folds the game the viewer just watched into the
 * season standings and stats, exactly as a headless sim would have. */
function recordWatchedGame() {
  const game = pendingWatch;
  pendingWatch = null;
  if (!game || game.played) return;

  const { scoreByColor, playerStats, defensivePlaycalls, routeCoverage } =
    getLiveGameResult();
  // Guard against a stale pointer: only record if the game that just ended is
  // actually the matchup we were watching (both teams present in the result).
  if (
    scoreByColor[game.homeColor] === undefined ||
    scoreByColor[game.awayColor] === undefined
  ) {
    return;
  }
  recordGame(game, scoreByColor[game.homeColor], scoreByColor[game.awayColor]);
  game.playerStats = playerStats;
  // A live-watched game keeps no saved highlight reel — watching it was the reel.
  if (game.round === "regular") {
    addGamePlayerStats(playerStats);
    addGameDefensiveStats(defensivePlaycalls);
    addGameRouteCoverageStats(routeCoverage);
  }
  render();
}

async function withBusy(action: () => Promise<void>) {
  if (busy) return;
  busy = true;
  render();
  try {
    await action();
  } finally {
    busy = false;
    simProgressWeek = null;
    // Multi-week sims (Sim to Playoffs / Sim to End) jump the viewed week
    // forward to wherever the season actually landed. A single "Sim Week N"
    // (or an individual game's Sim/Highlights action) leaves the view exactly
    // where it was — the user is still looking at that same week's games.
    const wasMultiWeek = activeSimAction === "playoffs" || activeSimAction === "end";
    activeSimAction = null;
    if (AUTO_ADVANCE_WEEK && wasMultiWeek) viewWeek = getCurrentWeek();
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

  // Two-column layout: week view + optional playoffs (left), standings sidebar (right).
  const mainRow = document.createElement("div");
  mainRow.className = "sched-main-row";

  const leftCol = document.createElement("div");
  leftCol.className = "sched-left-col";
  leftCol.appendChild(renderWeekView());
  mainRow.appendChild(leftCol);

  mainRow.appendChild(renderSidebar());
  root.appendChild(mainRow);

  root.appendChild(renderRosters());
}

function renderControls(): HTMLElement {
  const bar = document.createElement("div");
  bar.className = "sched-controls";

  if (!isSeasonGenerated()) {
    const genBtn = document.createElement("button");
    genBtn.className = "draft-auto-btn";
    genBtn.style.width = "auto";
    genBtn.textContent = "Generate Season";
    genBtn.disabled = busy;
    genBtn.addEventListener("click", () => {
      generateSeason();
      clearSeasonStats();
      clearTrainingCompletion();
      viewWeek = 1;
      render();
    });
    bar.appendChild(genBtn);
  }

  if (isSeasonGenerated()) {
    const notDrafted = !allDrafted();

    // Live progress label, per sim button: each shows its OWN "Simulating…"
    // text only while it's the one actually driving the sim (activeSimAction)
    // — otherwise all three would flip to the same text at once, which reads
    // as three sims running simultaneously.
    const progressLabel = (action: typeof activeSimAction) =>
      activeSimAction === action && simProgressWeek !== null
        ? `Simulating ${weekLabel(simProgressWeek)}…`
        : null;

    const weekBtn = document.createElement("button");
    weekBtn.className = "draft-auto-btn";
    weekBtn.style.width = "auto";
    weekBtn.textContent = progressLabel("week") ?? `Sim Week ${getCurrentWeek()}`;
    weekBtn.disabled = busy || notDrafted || !!getChampion();
    weekBtn.addEventListener("click", () => {
      activeSimAction = "week";
      withBusy(() => simWeek(getCurrentWeek()));
    });
    bar.appendChild(weekBtn);

    // Only offer "Sim to Playoffs" while the regular season is still going.
    if (!regSeasonComplete()) {
      const regBtn = document.createElement("button");
      regBtn.className = "draft-auto-btn";
      regBtn.style.width = "auto";
      regBtn.textContent = progressLabel("playoffs") ?? "Sim to Playoffs";
      regBtn.title = "Play out the rest of the regular season";
      regBtn.disabled = busy || notDrafted;
      regBtn.addEventListener("click", () => {
        activeSimAction = "playoffs";
        withBusy(() => simThroughWeek(REG_SEASON_WEEKS));
      });
      bar.appendChild(regBtn);
    }

    const seasonBtn = document.createElement("button");
    seasonBtn.className = "draft-auto-btn";
    seasonBtn.style.width = "auto";
    seasonBtn.textContent = progressLabel("end") ?? "Sim to End";
    seasonBtn.title = "Play out the regular season and the entire playoffs";
    seasonBtn.disabled = busy || notDrafted || !!getChampion();
    seasonBtn.addEventListener("click", () => {
      activeSimAction = "end";
      withBusy(() => simThroughWeek(FINAL_WEEK));
    });
    bar.appendChild(seasonBtn);

    const clearBtn = document.createElement("button");
    clearBtn.className = "draft-auto-btn sim-clear-btn";
    clearBtn.style.width = "auto";
    clearBtn.textContent = "End Season";
    clearBtn.disabled = busy;
    clearBtn.addEventListener("click", () => {
      clearSeason();
      clearSeasonStats();
      clearTrainingCompletion();
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

  const gate = renderTrainingGate(viewWeek);
  if (gate) section.appendChild(gate);

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

/**
 * Shown above every week's games (not just the current one): prompts the
 * human to complete their own team's weekly training (never auto-completed
 * for them) and offers a button to auto-complete every other team's
 * training. Once a side is done, its row becomes a confirmation instead of
 * disappearing, so the gate is also a per-week completion record.
 */
function renderTrainingGate(week: number): HTMLElement | null {
  if (!allDrafted()) return null;

  const userColor = getSelectedTeamColor();
  const cpuTeams = LEAGUE.filter((t) => t.color !== userColor);
  const cpuDone = cpuTeams.every((t) => isTrainingDoneForWeek(t.color, week));
  const userDone = !userColor || isTrainingDoneForWeek(userColor, week);

  const gate = document.createElement("div");
  gate.className = "sched-training-gate";

  const title = document.createElement("div");
  title.className = "sched-training-gate-title";
  title.textContent = `Week ${week} Training`;
  gate.appendChild(title);

  if (userColor) {
    const team = teamByColor(userColor);
    const row = document.createElement("div");
    row.className = "sched-training-gate-row";
    if (userDone) {
      const gain = teamWeeklyGain(team, week);
      const gainText =
        Math.abs(gain) >= 0.05
          ? ` (${gain > 0 ? "+" : ""}${gain.toFixed(1)} OVR this week)`
          : "";
      row.innerHTML =
        `<span class="sched-training-gate-check">✓</span>` +
        `<span class="sched-training-gate-msg" style="color:${team.color}">${team.name}</span>` +
        `<span class="sched-training-gate-msg">training complete${gainText}.</span>`;
    } else {
      row.innerHTML =
        `<span class="sched-training-gate-msg" style="color:${team.color}">${team.name}</span>` +
        `<span class="sched-training-gate-msg">hasn't completed this week's training.</span>`;
      const goBtn = document.createElement("button");
      goBtn.className = "draft-auto-btn";
      goBtn.style.width = "auto";
      goBtn.textContent = "Go to Training";
      goBtn.addEventListener("click", () => {
        focusTrainingTeam(userColor, week);
        document.getElementById("tab-training")?.click();
      });
      row.appendChild(goBtn);

      const autoBtn = document.createElement("button");
      autoBtn.className = "draft-auto-btn";
      autoBtn.style.width = "auto";
      autoBtn.title = "Auto-pick a focus and points for your team this week";
      autoBtn.textContent = "Auto-Train My Team";
      autoBtn.addEventListener("click", () => {
        autoTrainTeam(team, week);
        render();
      });
      row.appendChild(autoBtn);
    }
    gate.appendChild(row);
  }

  const cpuRow = document.createElement("div");
  cpuRow.className = "sched-training-gate-row";
  if (cpuDone) {
    cpuRow.innerHTML =
      `<span class="sched-training-gate-check">✓</span>` +
      `<span class="sched-training-gate-msg">${userColor ? "CPU teams'" : "All teams'"} training complete.</span>`;
  } else {
    const msg = document.createElement("span");
    msg.className = "sched-training-gate-msg";
    msg.textContent = userColor
      ? "CPU teams still need this week's training."
      : "Teams still need this week's training.";
    cpuRow.appendChild(msg);
    const cpuBtn = document.createElement("button");
    cpuBtn.className = "draft-auto-btn";
    cpuBtn.style.width = "auto";
    cpuBtn.textContent = "Simulate CPU Training";
    cpuBtn.addEventListener("click", () => {
      autoTrainAllExcept(userColor, week);
      render();
    });
    cpuRow.appendChild(cpuBtn);
  }
  gate.appendChild(cpuRow);

  return gate;
}

function getStreak(color: string): string {
  const played = getGames()
    .filter((g) => (g.homeColor === color || g.awayColor === color) && g.played)
    .sort((a, b) => a.week - b.week);
  if (played.length === 0) return "—";
  const result = (g: Game): "W" | "L" | "T" => {
    const myScore = g.homeColor === color ? g.homeScore : g.awayScore;
    const oppScore = g.homeColor === color ? g.awayScore : g.homeScore;
    return myScore > oppScore ? "W" : myScore < oppScore ? "L" : "T";
  };
  const results = played.map(result);
  const last = results[results.length - 1];
  let count = 0;
  for (let i = results.length - 1; i >= 0 && results[i] === last; i--) count++;
  return `${last}${count}`;
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
  const rp = team.roster.find((p) => p.label === a.label);
  const name = rp?.name ?? a.label;
  const ovr = rp ? ` · ${playerOvrDisplay(rp)}` : "";
  const summary =
    a.side === "offense" ? offAwardSummary(a.stats) : defAwardSummary(a.stats);

  const card = document.createElement("div");
  card.className = `sched-award sched-award-${a.side}`;
  card.innerHTML =
    `<div class="sched-award-head">${a.divisionName} · ${a.side === "offense" ? "Offense" : "Defense"}</div>` +
    `<div class="sched-award-player" style="color:${team.color}">${name}` +
    `<span class="sched-award-grade">${a.grade.toFixed(1)}</span></div>` +
    `<div class="sched-award-meta">${a.label} · <span style="color:${team.color}">${team.name}</span>${ovr}</div>` +
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
  // Always render the row (even when blank) so every card reserves the same
  // vertical space — otherwise division games, which get a tag, end up taller
  // than non-division games, which didn't have the row at all.
  const isDivision =
    game.round === "regular" &&
    divisionIndexOf(game.homeColor) === divisionIndexOf(game.awayColor);
  const tag = document.createElement("div");
  tag.className = "sched-game-tag" + (isDivision ? " sched-game-tag-div" : " sched-game-tag-hidden");
  tag.textContent = isDivision ? "DIVISION" : " ";
  card.appendChild(tag);

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
    result.innerHTML = `<span class="sched-status-icon">✓</span>${isTie ? "TIE" : "FINAL"}`;
    actions.appendChild(result);

    const key = gameKey(game);
    if (game.playerStats) {
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

    if (game.highlights && game.highlights.length > 0) {
      const expanded = expandedHighlights.has(key);
      const hlBtn = document.createElement("button");
      hlBtn.className = "sched-box-btn sched-hl-btn";
      hlBtn.textContent = `${expanded ? "▾" : "▸"} Highlights (${game.highlights.length})`;
      hlBtn.addEventListener("click", () => {
        if (expanded) expandedHighlights.delete(key);
        else expandedHighlights.add(key);
        render();
      });
      actions.appendChild(hlBtn);
    }
  } else {
    const status = document.createElement("span");
    status.className = "sched-game-unplayed";
    status.innerHTML = `<span class="sched-status-icon sched-status-open">○</span>`;
    actions.appendChild(status);

    const simBtn = document.createElement("button");
    simBtn.className = "sched-play-btn";
    simBtn.textContent = "Sim ▶";
    simBtn.disabled = busy || !allDrafted();
    simBtn.title = "Simulate instantly and record the result";
    simBtn.addEventListener("click", () =>
      withBusy(async () => {
        await simOneGame(game);
      }),
    );
    actions.appendChild(simBtn);

    const watchBtn = document.createElement("button");
    watchBtn.className = "sched-watch-btn";
    watchBtn.textContent = "Watch";
    watchBtn.disabled = busy || !allDrafted();
    watchBtn.title = "Watch live in the Play tab — the result counts once it ends";
    watchBtn.addEventListener("click", () => watchGame(game));
    actions.appendChild(watchBtn);

    const hlBtn = document.createElement("button");
    hlBtn.className = "sched-watch-btn";
    hlBtn.textContent = "Highlights";
    hlBtn.disabled = busy || !allDrafted();
    hlBtn.title = "Sim the game, then watch its highlights back-to-back like a broadcast";
    hlBtn.addEventListener("click", () =>
      withBusy(async () => {
        await simOneGame(game);
        openReel(
          game.highlights ?? [],
          [game.homeColor, game.awayColor],
          undefined,
          true,
        );
      }),
    );
    actions.appendChild(hlBtn);
  }

  card.appendChild(actions);

  if (game.played && game.playerStats && expandedGames.has(gameKey(game))) {
    card.appendChild(renderBoxScore(game));
  }
  if (game.played && game.highlights && expandedHighlights.has(gameKey(game))) {
    card.appendChild(renderHighlightList(game));
  }

  return card;
}

const HIGHLIGHT_ICON: Record<Highlight["kind"], string> = {
  score: "🏈",
  turnover: "🔄",
  sack: "💥",
  bigPass: "🎯",
  bigRun: "🏃",
  loss: "🔻",
};

/** Expandable list of a game's highlights, each playable in the Play tab. */
function renderHighlightList(game: Game): HTMLElement {
  const highlights = game.highlights ?? [];
  const box = document.createElement("div");
  box.className = "sched-hl-list";

  for (const h of highlights) {
    const team = teamByColor(h.teamColor);
    const row = document.createElement("div");
    row.className = "sched-hl-row";

    const info = document.createElement("div");
    info.className = "sched-hl-info";
    info.innerHTML =
      `<span class="sched-hl-icon">${HIGHLIGHT_ICON[h.kind]}</span>` +
      `<span class="sched-hl-when">${h.quarter} ${h.clock}</span>` +
      `<span class="sched-hl-desc" style="color:${team.color}">${h.description}</span>`;
    row.appendChild(info);

    if (h.frames.length > 0) {
      const watch = document.createElement("button");
      watch.className = "sched-hl-watch";
      watch.textContent = "▶";
      watch.title = "Watch on the Play tab (use the reel bar for next/prev)";
      watch.addEventListener("click", () =>
        openReel(highlights, [game.homeColor, game.awayColor], h),
      );
      row.appendChild(watch);
    }

    box.appendChild(row);
  }

  return box;
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

    // Leading rusher (by rushing grade — same criteria as awards)
    const rusher = topBy(players, rushingGrade);
    if (rusher && rusher.stats.rushing && rusher.stats.rushing.rushes > 0) {
      const r = rusher.stats.rushing;
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

    // Leading receiver (by receiving grade — catches & TDs count, not just yards)
    const receiver = topBy(players, receivingGrade);
    if (receiver && receiver.stats.receiving && receiver.stats.receiving.catches > 0) {
      const r = receiver.stats.receiving;
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

    // Leading defender (by defensive grade — same criteria as DPOW)
    const defender = topBy(players, defensiveGrade);
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

function renderCompactDivisionTable(div: Division, divIndex: number): HTMLElement {
  const standings = getDivisionStandings(divIndex);
  const seeds = getSeeds();

  const box = document.createElement("div");
  box.className = "sched-division";

  const table = document.createElement("table");
  table.className = "sched-table";
  table.innerHTML =
    `<thead><tr>` +
    `<th class="sched-th sched-th-team">${div.name}</th>` +
    `<th class="sched-th">W-L</th>` +
    `<th class="sched-th">PPG</th>` +
    `<th class="sched-th">PPG/A</th>` +
    `<th class="sched-th">STRK</th>` +
    `</tr></thead>`;

  const tbody = document.createElement("tbody");
  standings.forEach((rec, rank) => {
    const team = teamByColor(rec.color);
    const seed = seeds ? seedOf(rec.color) : null;
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

    const wl = rec.ties > 0
      ? `${rec.wins}-${rec.losses}-${rec.ties}`
      : `${rec.wins}-${rec.losses}`;
    const gp = rec.wins + rec.losses + rec.ties;
    const ppg = gp > 0 ? (rec.pointsFor / gp).toFixed(1) : "—";
    const ppga = gp > 0 ? (rec.pointsAgainst / gp).toFixed(1) : "—";
    const streak = getStreak(rec.color);
    const streakColor = streak.startsWith("W") ? "#4ade80" : streak.startsWith("L") ? "#f87171" : "#9ca3af";

    tr.innerHTML =
      `<td class="sched-td sched-td-team" style="color:${team.color}">${marker}${team.name}` +
      `<span class="sched-td-ovr">${teamOvrDisplay(team)}</span></td>` +
      `<td class="sched-td">${wl}</td>` +
      `<td class="sched-td">${ppg}</td>` +
      `<td class="sched-td">${ppga}</td>` +
      `<td class="sched-td" style="color:${streakColor};font-weight:bold">${streak}</td>`;
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  box.appendChild(table);
  return box;
}

function renderSidebar(): HTMLElement {
  const sidebar = document.createElement("div");
  sidebar.className = "sched-sidebar";

  const standSection = document.createElement("div");
  standSection.className = "sched-section";
  const standHead = document.createElement("h3");
  standHead.className = "sched-heading";
  standHead.textContent = "Standings";
  standSection.appendChild(standHead);
  getDivisions().forEach((div, i) => standSection.appendChild(renderCompactDivisionTable(div, i)));

  const avgPPG = leagueAvgPPG();
  const avgYPA = leagueAvgYPA();
  const avgYPC = leagueAvgYPC();
  if (avgPPG !== null) {
    const stats = document.createElement("div");
    stats.className = "sched-league-ppg";
    const lines = [`League avg: ${avgPPG.toFixed(1)} PPG`];
    if (avgYPA !== null) lines.push(`${avgYPA.toFixed(1)} YPA`);
    if (avgYPC !== null) lines.push(`${avgYPC.toFixed(1)} YPC`);
    stats.textContent = lines.join(" · ");
    standSection.appendChild(stats);
  }

  // Seed chips once playoffs are seeded
  const seeds = getSeeds();
  if (seeds) {
    const seedList = document.createElement("div");
    seedList.className = "sched-seedlist";
    seedList.style.marginTop = "10px";
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
    standSection.appendChild(seedList);
  }

  sidebar.appendChild(standSection);
  sidebar.appendChild(renderAwardFavorites());
  return sidebar;
}

type AwardCand = { color: string; label: Label; name: string; grade: number; stats: PlayerStats; side: "offense" | "defense" };

function renderAwardFavorites(): HTMLElement {
  const section = document.createElement("div");
  section.className = "sched-section";

  const head = document.createElement("h3");
  head.className = "sched-heading";
  head.textContent = "Award Favorites";
  section.appendChild(head);

  if (!hasSeasonStats()) {
    const p = document.createElement("p");
    p.className = "sched-empty";
    p.textContent = "Play games to see award leaders.";
    section.appendChild(p);
    return section;
  }

  const opoy: AwardCand[] = [], dpoy: AwardCand[] = [], mvp: AwardCand[] = [];
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
      if (off !== 0 || def > 0) mvp.push({ ...base, grade: mvpGrade(stats), side: isOff ? "offense" : "defense" });
    }
  }
  opoy.sort((a, b) => b.grade - a.grade);
  dpoy.sort((a, b) => b.grade - a.grade);
  mvp.sort((a, b) => b.grade - a.grade);

  const grid = document.createElement("div");
  grid.className = "sched-awards-grid sched-award-favorites";

  const renderFav = (title: string, c: AwardCand | undefined) => {
    const card = document.createElement("div");
    card.className = `sched-award sched-award-${c?.side ?? "offense"}`;
    if (!c) {
      card.innerHTML = `<div class="sched-award-head">${title}</div><div class="sched-award-stat">No candidates yet.</div>`;
      return card;
    }
    const team = teamByColor(c.color);
    const rp = team.roster.find((p) => p.label === c.label);
    const ovr = rp ? ` · ${playerOvrDisplay(rp)}` : "";
    const summary = c.side === "offense" ? offAwardSummary(c.stats) : defAwardSummary(c.stats);
    card.innerHTML =
      `<div class="sched-award-head">${title}</div>` +
      `<div class="sched-award-player" style="color:${team.color}">${c.name}` +
      `<span class="sched-award-grade">${c.grade.toFixed(1)}</span></div>` +
      `<div class="sched-award-meta">${c.label} · <span style="color:${team.color}">${team.name}</span>${ovr}</div>` +
      `<div class="sched-award-stat">${summary}</div>`;
    return card;
  };

  grid.appendChild(renderFav("MVP", mvp[0]));
  grid.appendChild(renderFav("OPOY", opoy[0]));
  grid.appendChild(renderFav("DPOY", dpoy[0]));
  section.appendChild(grid);
  return section;
}

/** `showDivRecord` adds a DIV (in-division W-L-T) column — used by the Stats
 * tab's standings only; the Season tab's own standings omit it. */
export function renderDivisionTable(
  div: Division,
  divIndex: number,
  showDivRecord = false,
): HTMLElement {
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
    (showDivRecord ? `<th class="sched-th">DIV</th>` : "") +
    `<th class="sched-th">PF</th><th class="sched-th">PA</th><th class="sched-th">DIFF</th>` +
    `<th class="sched-th">STRK</th>` +
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

    const streak = getStreak(rec.color);
    const streakColor = streak.startsWith("W") ? "#4ade80" : streak.startsWith("L") ? "#f87171" : "#9ca3af";
    const divRec = showDivRecord ? getDivisionRecord(rec.color) : null;
    tr.innerHTML =
      `<td class="sched-td sched-td-team" style="color:${team.color}">${marker}${team.name}` +
      `<span class="sched-td-ovr">${teamOvrDisplay(team)}</span></td>` +
      `<td class="sched-td">${rec.wins}</td>` +
      `<td class="sched-td">${rec.losses}</td>` +
      `<td class="sched-td">${rec.ties}</td>` +
      `<td class="sched-td">${pct}</td>` +
      (divRec ? `<td class="sched-td">${formatRecord(divRec)}</td>` : "") +
      `<td class="sched-td">${rec.pointsFor}</td>` +
      `<td class="sched-td">${rec.pointsAgainst}</td>` +
      `<td class="sched-td">${diff >= 0 ? "+" : ""}${diff}</td>` +
      `<td class="sched-td" style="color:${streakColor};font-weight:bold">${streak}</td>`;
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  box.appendChild(table);
  return box;
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

  const grid = document.createElement("div");
  grid.className = "sched-rosters-grid";

  getDivisions().forEach((div, i) => {
    const col = document.createElement("div");
    col.className = "sched-roster-div-col";
    const divHeading = document.createElement("div");
    divHeading.className = "sched-roster-div";
    divHeading.textContent = `${div.name} Division`;
    col.appendChild(divHeading);
    const row = document.createElement("div");
    row.className = "sched-roster-row";
    for (const rec of getDivisionStandings(i)) {
      row.appendChild(
        buildRosterCard(teamByColor(rec.color), {
          slotSort: getRosterSort(),
          isUserTeam: rec.color === getSelectedTeamColor(),
        }),
      );
    }
    col.appendChild(row);
    grid.appendChild(col);
  });

  section.appendChild(grid);
  return section;
}

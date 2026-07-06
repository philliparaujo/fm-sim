import {
  clearResults,
  getMatchup,
  getPts,
  getTeamRecord,
  recordResult,
} from "../core/leagueResults";
import { LEAGUE } from "../core/state";
import { Team } from "../core/types";
import { roleOvrDisplay, teamOvrDisplay } from "./displayMode";
import { roleBreakdown } from "./rosterCard";

function workerGame(
  offenseTeam: Team,
  defenseTeam: Team,
): Promise<{ offenseScore: number; defenseScore: number }> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("../sim/simWorker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = (e) => {
      resolve(e.data);
      worker.terminate();
    };
    worker.onerror = reject;
    worker.postMessage({ offenseTeam, defenseTeam });
  });
}

let seasonRunning = false;

export function setupSimulate() {
  // Re-render every time the tab becomes active (e.g. after drafting)
  document.getElementById("tab-simulate")?.addEventListener("click", render);

  const seasonBtn = document.getElementById(
    "sim-season-btn",
  ) as HTMLButtonElement;
  const clearBtn = document.getElementById(
    "sim-clear-btn",
  ) as HTMLButtonElement;

  const seasonsInput = document.getElementById("sim-seasons-input") as HTMLInputElement;

  seasonBtn?.addEventListener("click", async () => {
    if (seasonRunning) return;
    if (!allDrafted()) {
      alert("Draft all teams before simulating.");
      return;
    }
    const totalSeasons = Math.max(1, Math.min(1000, Number(seasonsInput?.value) || 1));
    seasonRunning = true;
    seasonBtn.disabled = true;

    const pairs: [Team, Team][] = [];
    for (let i = 0; i < LEAGUE.length; i++)
      for (let j = i + 1; j < LEAGUE.length; j++)
        pairs.push([LEAGUE[i], LEAGUE[j]]);

    for (let s = 0; s < totalSeasons; s++) {
      seasonBtn.textContent = totalSeasons > 1 ? `Simulating… (${s + 1}/${totalSeasons})` : "Simulating…";
      const results = await Promise.all(
        pairs.map(([a, b]) =>
          workerGame(a, b).then(({ offenseScore, defenseScore }) => ({
            aColor: a.color,
            bColor: b.color,
            offenseScore,
            defenseScore,
          })),
        ),
      );
      for (const { aColor, bColor, offenseScore, defenseScore } of results)
        recordResult(aColor, bColor, offenseScore, defenseScore);
    }

    render();
    seasonRunning = false;
    seasonBtn.disabled = false;
    seasonBtn.textContent = "Simulate Season";
  });

  clearBtn?.addEventListener("click", () => {
    clearResults();
    render();
  });

  render();
}

function allDrafted(): boolean {
  return LEAGUE.every((t) => t.roster.length > 0);
}

async function runMatchup(
  rowTeam: Team,
  colTeam: Team,
  btn: HTMLButtonElement,
) {
  btn.disabled = true;
  const { offenseScore, defenseScore } = await workerGame(rowTeam, colTeam);
  recordResult(rowTeam.color, colTeam.color, offenseScore, defenseScore);
  btn.disabled = false;
  render();
}

function render() {
  renderGrid();
  renderRankings();
}

function renderGrid() {
  const container = document.getElementById("sim-grid")!;
  container.innerHTML = "";

  if (!allDrafted()) {
    container.innerHTML =
      '<p style="color:#666;padding:16px">Draft players for all teams before simulating.</p>';
    return;
  }

  const wrap = document.createElement("div");
  wrap.className = "sim-grid-wrap";

  const table = document.createElement("table");
  table.className = "dash-table sim-grid-table";

  // Column headers
  const thead = document.createElement("thead");
  const hRow = document.createElement("tr");
  hRow.innerHTML =
    `<th class="dash-th sim-corner"></th>` +
    LEAGUE.map(
      (t) =>
        `<th class="dash-th sim-col-header" style="color:${t.color}">${t.name}</th>`,
    ).join("");
  thead.appendChild(hRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  for (let ri = 0; ri < LEAGUE.length; ri++) {
    const rowTeam = LEAGUE[ri];
    const row = document.createElement("tr");
    row.className = "dash-row";

    // Row header
    const th = document.createElement("td");
    th.className = "dash-td-label sim-row-header";
    th.style.color = rowTeam.color;
    th.textContent = rowTeam.name;
    row.appendChild(th);

    for (let ci = 0; ci < LEAGUE.length; ci++) {
      const colTeam = LEAGUE[ci];
      const td = document.createElement("td");
      td.className = "dash-td sim-cell";

      if (ri === ci || ci < ri) {
        // Diagonal and lower triangle: black out
        td.className += ri === ci ? " sim-diagonal" : " sim-blackout";
        row.appendChild(td);
        continue;
      }

      // Upper triangle: show record + sim button
      const m = getMatchup(rowTeam.color, colTeam.color);
      const games = m ? m.wins + m.losses + m.ties : 0;

      if (m && games > 0) {
        const avgFor = (m.pointsFor / games).toFixed(1);
        const avgAgainst = (m.pointsAgainst / games).toFixed(1);
        const recordEl = document.createElement("div");
        recordEl.className = "sim-record";
        recordEl.innerHTML =
          `<span style="color:${rowTeam.color}">${m.wins}</span>` +
          `<span style="color:#6b7280">–</span>` +
          `<span style="color:${colTeam.color}">${m.losses}</span>` +
          `<span style="color:#6b7280">–</span>` +
          `<span>${m.ties}</span>`;
        const scoresEl = document.createElement("div");
        scoresEl.className = "sim-avg-score";
        scoresEl.innerHTML =
          `<span style="color:${rowTeam.color}">${avgFor}</span>` +
          `<span style="color:#6b7280"> – </span>` +
          `<span style="color:${colTeam.color}">${avgAgainst}</span>`;
        td.appendChild(recordEl);
        td.appendChild(scoresEl);
      }

      const btn = document.createElement("button");
      btn.className = "sim-play-btn";
      btn.textContent = "▶";
      btn.title = `${rowTeam.name} vs ${colTeam.name}`;
      btn.addEventListener("click", () => runMatchup(rowTeam, colTeam, btn));
      td.appendChild(btn);

      row.appendChild(td);
    }

    tbody.appendChild(row);
  }

  table.appendChild(tbody);
  wrap.appendChild(table);
  container.appendChild(wrap);
}

function renderRankings() {
  const container = document.getElementById("sim-rankings")!;
  container.innerHTML = "";

  const ranked = LEAGUE.map((team) => ({
    team,
    rec: getTeamRecord(team.color),
  })).sort((a, b) => {
    const apts = getPts(a.rec);
    const bpts = getPts(b.rec);
    if (bpts !== apts) return bpts - apts;
    return (
      b.rec.pointsFor -
      b.rec.pointsAgainst -
      (a.rec.pointsFor - a.rec.pointsAgainst)
    );
  });

  const wrap = document.createElement("div");
  wrap.className = "sim-rankings-wrap";

  const table = document.createElement("table");
  table.className = "dash-table";

  const thead = document.createElement("thead");
  thead.innerHTML =
    `<tr class="sim-rank-head">` +
    `<th class="sim-rank-th sim-rank-th-num">#</th>` +
    `<th class="sim-rank-th sim-rank-th-team">Team</th>` +
    `<th class="sim-rank-th">W</th>` +
    `<th class="sim-rank-th">L</th>` +
    `<th class="sim-rank-th">T</th>` +
    `<th class="sim-rank-th">PF/G</th>` +
    `<th class="sim-rank-th">PA/G</th>` +
    `<th class="sim-rank-th">+/−</th>` +
    `<th class="sim-rank-th">Pts</th>` +
    `</tr>`;
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  ranked.forEach(({ team, rec }, i) => {
    const games = rec.wins + rec.losses + rec.ties;
    const pfg = games > 0 ? (rec.pointsFor / games).toFixed(1) : "—";
    const pag = games > 0 ? (rec.pointsAgainst / games).toFixed(1) : "—";
    const diff = games > 0 ? (rec.pointsFor - rec.pointsAgainst) / games : 0;
    const diffStr = games > 0 ? `${diff >= 0 ? "+" : ""}${diff.toFixed(1)}` : "—";
    const pts = getPts(rec);
    const tr = document.createElement("tr");
    tr.className = "sim-rank-row";

    const numTd = document.createElement("td");
    numTd.className = "sim-rank-td sim-rank-td-num";
    numTd.textContent = String(i + 1);
    tr.appendChild(numTd);

    const teamTd = document.createElement("td");
    teamTd.className = "sim-rank-td sim-rank-td-team";
    teamTd.style.color = team.color;
    const nameRow = document.createElement("div");
    nameRow.textContent = team.name;
    if (team.roster.length > 0) {
      const ovrSpan = document.createElement("span");
      ovrSpan.className = "sim-rank-ovr";
      ovrSpan.innerHTML = teamOvrDisplay(team);
      nameRow.appendChild(ovrSpan);
    }
    teamTd.appendChild(nameRow);
    const roles = roleBreakdown(team.roster);
    if (roles.size > 0) {
      const breakdown = document.createElement("div");
      breakdown.className = "sim-rank-breakdown";
      for (const [role] of roles) {
        const chip = document.createElement("span");
        chip.className = "sim-rank-role-chip";
        chip.innerHTML = `<span class="sim-rank-role-name">${role}</span><span class="sim-rank-role-val">${roleOvrDisplay(team, role)}</span>`;
        breakdown.appendChild(chip);
      }
      teamTd.appendChild(breakdown);
    }
    tr.appendChild(teamTd);

    const rest = document.createElement("template");
    rest.innerHTML =
      `<td class="sim-rank-td">${rec.wins}</td>` +
      `<td class="sim-rank-td">${rec.losses}</td>` +
      `<td class="sim-rank-td">${rec.ties}</td>` +
      `<td class="sim-rank-td">${pfg}</td>` +
      `<td class="sim-rank-td">${pag}</td>` +
      `<td class="sim-rank-td">${diffStr}</td>` +
      `<td class="sim-rank-td sim-rank-pts">${pts}</td>`;
    tr.appendChild(rest.content);
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
  container.appendChild(wrap);
}


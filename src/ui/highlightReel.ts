import { Highlight, HIGHLIGHT_FRAME_STRIDE } from "../core/highlights";
import { teamByColor } from "../core/schedule";
import { loadGame } from "../sim";
import { playHighlight, setReplayMode } from "../sim/replay";
import { initDashboard, updateDashboardValues } from "./dashboard";

const HIGHLIGHT_ICON: Record<Highlight["kind"], string> = {
  score: "🏈",
  turnover: "🔄",
  sack: "💥",
  bigPass: "🎯",
  bigRun: "🏃",
  loss: "🔻",
  final: "🏁",
};

let reel: Highlight[] = [];
let index = 0;
/** Cinematic mode: the highlight list is hidden and clips auto-advance so the
 * game plays back like a live broadcast rather than a pick-from-a-list reel. */
let cinematic = false;

function panel(): HTMLElement | null {
  return document.getElementById("hl-panel");
}

/** Toggles the Play tab into/out of highlights mode. In highlights mode the
 * play-by-play replay list is hidden (CSS) and the highlights panel takes its
 * slot in the left column. */
function setHighlightsMode(on: boolean) {
  document.getElementById("play-tab")?.classList.toggle("hl-active", on);
}

/**
 * Opens a game's highlights as a playable reel. Loads that game's two teams
 * into the Play tab (same as watching live) so the roster panel matches the
 * game being watched, then shows the left panel (#hl-panel) with a list of
 * all highlights; clicking one plays it on the field canvas.
 *
 * In `cinematic` mode the list is hidden and clips play back-to-back on their
 * own, so the game feels live rather than picked from a menu.
 */
export function openReel(
  highlights: Highlight[],
  teamColors: [string, string],
  start?: Highlight,
  cinematicMode = false,
) {
  const filtered = highlights.filter((h) => h.frames.length > 0);
  if (filtered.length === 0) return;

  // Loading the matchup resets the live game, which dismisses any active reel
  // via the "liveGameLoaded" listener — so build the reel state after this.
  loadGame(teamColors[0], teamColors[1]);
  initDashboard();
  updateDashboardValues();

  reel = filtered;
  cinematic = cinematicMode;
  index = start ? Math.max(0, reel.indexOf(start)) : 0;

  document.getElementById("tab-play")?.click();
  renderPanel();
  playCurrent();
}

function playCurrent() {
  const h = reel[index];
  if (!h || h.frames.length === 0) return;
  // Cinematic clips chain into the next one automatically; a normal reel loops
  // the single selected clip until the viewer picks another.
  playHighlight(h.frames, HIGHLIGHT_FRAME_STRIDE, cinematic ? advanceCinematic : undefined);
  highlightActiveRow();
}

/** Auto-advance to the next clip (wrapping), invoked when the current one ends
 * in cinematic mode. */
function advanceCinematic() {
  index = (index + 1) % reel.length;
  const h = reel[index];
  if (h && h.frames.length > 0) {
    playHighlight(h.frames, HIGHLIGHT_FRAME_STRIDE, advanceCinematic);
  }
  highlightActiveRow();
}

function step(delta: number) {
  if (reel.length === 0) return;
  index = (index + delta + reel.length) % reel.length;
  playCurrent();
}

function close() {
  setReplayMode("live");
  hide();
}

function hide() {
  reel = [];
  index = 0;
  cinematic = false;
  const p = panel();
  if (p) p.style.display = "none";
  setHighlightsMode(false);
}

function highlightActiveRow() {
  const p = panel();
  if (!p) return;
  const cnt = p.querySelector(".hl-nav-count");
  if (cnt) cnt.textContent = `${index + 1} / ${reel.length}`;
  p.querySelectorAll(".hl-row").forEach((el, i) => {
    el.classList.toggle("hl-row-active", i === index);
    if (i === index) (el as HTMLElement).scrollIntoView({ block: "nearest" });
  });
}

function renderPanel() {
  const p = panel();
  if (!p) return;

  setHighlightsMode(true);
  // Cinematic mode auto-advances clips and shows a LIVE badge instead of the
  // prev/counter/next nav — but it still lists every highlight (with the
  // playing one marked), the same as pick-from-a-list mode.
  p.classList.toggle("hl-panel-cinematic", cinematic);

  p.style.display = "flex";
  p.innerHTML = "";

  // ── Header ──────────────────────────────────────────────────────────────
  const header = document.createElement("div");
  header.className = "hl-panel-header";

  if (cinematic) {
    const live = document.createElement("span");
    live.className = "hl-live-badge";
    live.textContent = "🔴 LIVE";
    header.appendChild(live);
  } else {
    const nav = document.createElement("div");
    nav.className = "hl-panel-nav";
    const prevBtn = document.createElement("button");
    prevBtn.className = "hl-nav-btn";
    prevBtn.textContent = "‹";
    prevBtn.addEventListener("click", () => step(-1));
    const counter = document.createElement("span");
    counter.className = "hl-nav-count";
    counter.textContent = `${index + 1} / ${reel.length}`;
    const nextBtn = document.createElement("button");
    nextBtn.className = "hl-nav-btn";
    nextBtn.textContent = "›";
    nextBtn.addEventListener("click", () => step(1));
    nav.append(prevBtn, counter, nextBtn);
    header.appendChild(nav);
  }

  const closeBtn = document.createElement("button");
  closeBtn.className = "hl-close-btn";
  closeBtn.textContent = "✕";
  closeBtn.title = "Back to live";
  closeBtn.addEventListener("click", close);
  header.appendChild(closeBtn);

  p.appendChild(header);

  // ── Scrollable list (both modes) ─────────────────────────────────────────
  const list = document.createElement("div");
  list.className = "hl-list";

  reel.forEach((h, i) => {
    const team = teamByColor(h.teamColor);
    const row = document.createElement("div");
    row.className = "hl-row" + (i === index ? " hl-row-active" : "");
    row.innerHTML =
      `<span class="hl-row-icon">${HIGHLIGHT_ICON[h.kind]}</span>` +
      `<span class="hl-row-when">${h.quarter} ${h.clock}</span>` +
      `<span class="hl-row-desc" style="color:${team.color}">${h.description}</span>`;
    row.addEventListener("click", () => {
      index = i;
      playCurrent();
      // Update counter and active row without full re-render
      const cnt = p.querySelector(".hl-nav-count");
      if (cnt) cnt.textContent = `${index + 1} / ${reel.length}`;
      p.querySelectorAll(".hl-row").forEach((el, j) =>
        el.classList.toggle("hl-row-active", j === index),
      );
    });
    list.appendChild(row);
  });

  p.appendChild(list);
}

export function setupHighlightReel() {
  window.addEventListener("liveGameLoaded", hide);
}

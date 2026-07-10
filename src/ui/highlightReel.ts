import { Highlight, HIGHLIGHT_FRAME_STRIDE } from "../core/highlights";
import { teamByColor } from "../core/schedule";
import { playHighlight, setReplayMode } from "../sim/replay";

// The currently open reel (a game's watchable highlights) and playhead.
let reel: Highlight[] = [];
let index = 0;
let bar: HTMLDivElement | null = null;

/**
 * Opens a game's highlights as a playable reel on the Play tab. Successive
 * highlights are reachable via the reel bar's Prev/Next without tab-hopping.
 */
export function openReel(highlights: Highlight[], start?: Highlight) {
  reel = highlights.filter((h) => h.frames.length > 0);
  if (reel.length === 0) return;
  index = start ? Math.max(0, reel.indexOf(start)) : 0;

  ensureBar();
  playCurrent();
  document.getElementById("tab-play")?.click();
}

function playCurrent() {
  const h = reel[index];
  playHighlight(h.frames, HIGHLIGHT_FRAME_STRIDE);
  renderBar();
}

function step(delta: number) {
  if (reel.length === 0) return;
  index = (index + delta + reel.length) % reel.length; // wrap around
  playCurrent();
}

/** Exits the reel and returns the field to live play. */
function close() {
  setReplayMode("live");
  hide();
}

/** Hides the reel bar without touching playback state (for live-game loads). */
function hide() {
  reel = [];
  index = 0;
  if (bar) bar.style.display = "none";
}

export function setupHighlightReel() {
  // A live game loading elsewhere (team picker, reset, "watch full game") has
  // already returned the field to live — just dismiss the reel bar.
  window.addEventListener("liveGameLoaded", hide);
}

function ensureBar() {
  if (bar) {
    bar.style.display = "flex";
    return;
  }
  bar = document.createElement("div");
  bar.className = "reel-bar";
  bar.innerHTML =
    `<button class="reel-btn reel-exit" title="Back to live">✕</button>` +
    `<button class="reel-btn reel-prev" title="Previous highlight">◀</button>` +
    `<span class="reel-info"></span>` +
    `<button class="reel-btn reel-next" title="Next highlight">▶</button>`;
  document.body.appendChild(bar);

  bar.querySelector(".reel-exit")!.addEventListener("click", close);
  bar.querySelector(".reel-prev")!.addEventListener("click", () => step(-1));
  bar.querySelector(".reel-next")!.addEventListener("click", () => step(1));
}

function renderBar() {
  if (!bar) return;
  const h = reel[index];
  const team = teamByColor(h.teamColor);
  const info = bar.querySelector(".reel-info") as HTMLElement;
  info.innerHTML =
    `<span class="reel-count">${index + 1}/${reel.length}</span>` +
    `<span class="reel-when">${h.quarter} ${h.clock}</span>` +
    `<span class="reel-desc" style="color:${team.color}">${h.description}</span>`;
}

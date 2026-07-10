import { Highlight, HIGHLIGHT_FRAME_STRIDE } from "../core/highlights";
import { teamByColor } from "../core/schedule";
import { playHighlight, setReplayMode } from "../sim/replay";

const HIGHLIGHT_ICON: Record<Highlight["kind"], string> = {
  score: "🏈",
  turnover: "🔄",
  sack: "💥",
  bigPass: "🎯",
  bigRun: "🏃",
  loss: "🔻",
};

let reel: Highlight[] = [];
let index = 0;

function panel(): HTMLElement | null {
  return document.getElementById("hl-panel");
}

/**
 * Opens a game's highlights as a playable reel. The Play tab's left panel
 * (#hl-panel) becomes visible with a list of all highlights; clicking one
 * plays it on the field canvas.
 */
export function openReel(highlights: Highlight[], start?: Highlight) {
  reel = highlights.filter((h) => h.frames.length > 0);
  if (reel.length === 0) return;
  index = start ? Math.max(0, reel.indexOf(start)) : 0;

  document.getElementById("tab-play")?.click();
  renderPanel();
  playCurrent();
}

function playCurrent() {
  const h = reel[index];
  if (h.frames.length > 0) playHighlight(h.frames, HIGHLIGHT_FRAME_STRIDE);
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
  const p = panel();
  if (p) p.style.display = "none";
}

function highlightActiveRow() {
  const p = panel();
  if (!p) return;
  p.querySelectorAll(".hl-row").forEach((el, i) => {
    el.classList.toggle("hl-row-active", i === index);
    if (i === index) (el as HTMLElement).scrollIntoView({ block: "nearest" });
  });
}

function renderPanel() {
  const p = panel();
  if (!p) return;
  p.style.display = "flex";
  p.innerHTML = "";

  // ── Header ──────────────────────────────────────────────────────────────
  const header = document.createElement("div");
  header.className = "hl-panel-header";

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

  const closeBtn = document.createElement("button");
  closeBtn.className = "hl-close-btn";
  closeBtn.textContent = "✕";
  closeBtn.title = "Back to live";
  closeBtn.addEventListener("click", close);

  header.append(nav, closeBtn);
  p.appendChild(header);

  // ── Scrollable list ──────────────────────────────────────────────────────
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

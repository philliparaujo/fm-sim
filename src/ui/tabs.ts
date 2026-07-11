const TABS = [
  { btn: "tab-play", panel: "play-tab" },
  { btn: "tab-schedule", panel: "schedule-tab" },
  { btn: "tab-stats", panel: "stats-tab" },
  { btn: "tab-training", panel: "training-tab" },
];

/** Wires the tab bar click handlers. Does NOT show the tab bar — call showTabs() for that. */
export function setupTabs() {
  for (const { btn } of TABS) {
    document.getElementById(btn)?.addEventListener("click", () => showTab(btn));
  }
}

/** Reveals the tab bar in the global top bar and activates the given tab (default: play). */
export function showTabs(activeBtn = "tab-play") {
  const tabs = document.getElementById("gtb-tabs");
  if (tabs) tabs.style.display = "flex";
  // Hide draft-only top-bar elements
  const teamSelectArea = document.getElementById("gtb-team-select");
  if (teamSelectArea) teamSelectArea.style.display = "none";
  const snakeArea = document.getElementById("gtb-snake-btn");
  if (snakeArea) snakeArea.style.display = "none";
  const statusArea = document.getElementById("gtb-status");
  if (statusArea) statusArea.style.display = "none";
  // Make all tab panels visible/hidden correctly
  for (const { panel } of TABS) {
    const el = document.getElementById(panel);
    if (el) el.style.display = "none";
  }
  showTab(activeBtn);
}

function showTab(activeBtn: string) {
  for (const { btn, panel } of TABS) {
    const isActive = btn === activeBtn;
    const panelEl = document.getElementById(panel);
    const btnEl = document.getElementById(btn);
    if (panelEl) panelEl.style.display = isActive ? "" : "none";
    if (btnEl) btnEl.classList.toggle("active", isActive);
  }
}

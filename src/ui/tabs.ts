const TABS = [
  { btn: "tab-play", panel: "play-tab" },
  { btn: "tab-draft", panel: "draft-tab", start: true },
];

/** Wires the Play/Draft tab bar to show one panel at a time. */
export function setupTabs() {
  for (const { btn, start } of TABS) {
    document.getElementById(btn)?.addEventListener("click", () => show(btn));
    if (start) {
      show(btn);
    }
  }
}

function show(activeBtn: string) {
  for (const { btn, panel } of TABS) {
    const isActive = btn === activeBtn;
    document.getElementById(panel)!.style.display = isActive ? "" : "none";
    document.getElementById(btn)!.classList.toggle("active", isActive);
  }
}

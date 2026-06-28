import { onPlayReset, tick } from "./simulate";
import { initDashboard, updateDashboardValues } from "./ui/dashboard";
import { setupPlaybookSliders } from "./ui/playbookSliders";
import { setupReplayControls } from "./ui/replayControls";
import { setupSpeedControl } from "./ui/speedControl";

async function init() {
  setupSpeedControl();

  // Build dashboard now, and rebuild after each play reset
  initDashboard();
  onPlayReset(updateDashboardValues);

  setupReplayControls();
  setupPlaybookSliders();

  requestAnimationFrame(tick);
}

window.onload = init;

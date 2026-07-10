import { assignCoverageTargets } from "./sim/assignments";
import { onPlayReset, tick } from "./sim";
import { initDashboard, updateDashboardValues } from "./ui/dashboard";
import { setupDraft } from "./ui/draft";
import { setupHighlightReel } from "./ui/highlightReel";
import { setupRatingsToggle } from "./ui/ratingsToggle";
import { setupSchedule } from "./ui/schedule";
import { setupStats } from "./ui/stats";
import { setupTraining } from "./ui/training";
import { setupSimulate } from "./ui/simulate";
import { setupPlaybookSliders } from "./ui/playbookSliders";
import { setupReplayControls } from "./ui/replayControls";
import { setupResetButton } from "./ui/resetButton";
import { setupSpeedControl } from "./ui/speedControl";
import { setupTabs } from "./ui/tabs";
import { setupTeamPicker } from "./ui/teamPicker";

async function init() {
  setupSpeedControl();

  // Build dashboard now, and rebuild after each play reset
  initDashboard();
  onPlayReset(updateDashboardValues);

  setupReplayControls();
  setupPlaybookSliders();
  setupResetButton();
  setupTeamPicker();

  setupTabs();
  setupDraft();
  setupSimulate();
  setupSchedule();
  setupStats();
  setupTraining();
  setupRatingsToggle();
  setupHighlightReel();

  assignCoverageTargets();
  requestAnimationFrame(tick);
}

window.onload = init;

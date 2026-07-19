import { assignCoverageTargets } from "./sim/assignments";
import { onPlayReset, tick } from "./sim";
import {
  initDashboard,
  rerenderDashboard,
  updateDashboardValues,
} from "./ui/dashboard";
import { onRosterSort, setupDraft } from "./ui/draft";
import { setupHighlightReel } from "./ui/highlightReel";
import { setupRatingsToggle } from "./ui/ratingsToggle";
import { setupSchedule } from "./ui/schedule";
import { setupStats } from "./ui/stats";
import { setupTraining } from "./ui/training";
import { setupPlaybookSliders } from "./ui/playbookSliders";
import { setupPlayControls } from "./ui/playControls";
import { setupReplayControls } from "./ui/replayControls";
import { setupResetButton } from "./ui/resetButton";
import { setupTabs } from "./ui/tabs";
import { setupTeamPicker } from "./ui/teamPicker";

async function init() {
  setupPlayControls();

  // Build dashboard now, and rebuild after each play reset
  initDashboard();
  onPlayReset(updateDashboardValues);
  // Keep the Play-tab rosters in sync with the roster-sort toggle.
  onRosterSort(rerenderDashboard);

  setupReplayControls();
  setupPlaybookSliders();
  setupResetButton();
  setupTeamPicker();

  setupTabs();
  setupDraft();
  setupSchedule();
  setupStats();
  setupTraining();
  setupRatingsToggle();
  setupHighlightReel();

  assignCoverageTargets();
  requestAnimationFrame(tick);
}

window.onload = init;

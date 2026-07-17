import { Highlight } from "../core/highlights";
import { TEAM_PLAYBOOKS } from "../core/playbook";
import { LEAGUE } from "../core/state";
import {
  PlayerStatsByLabel,
  RouteCoverageYards,
  SpecificPlaycallCoverageStats,
  Team,
} from "../core/types";
import { simulateFullGame } from "./index";

type WorkerInput = {
  offenseTeam: Team;
  defenseTeam: Team;
  /** Each team's current playbook tendencies from the main thread — this
   * worker's own TEAM_PLAYBOOKS is a separate module instance in a separate
   * thread, so it never sees main-thread changes (e.g. from the Training
   * tab) unless passed across explicitly. */
  offensePlaybook?: Record<string, number>;
  defensePlaybook?: Record<string, number>;
};
type WorkerOutput = {
  offenseScore: number;
  defenseScore: number;
  playerStats: Record<string, PlayerStatsByLabel>;
  defensivePlaycalls: Record<string, SpecificPlaycallCoverageStats>;
  routeCoverage: Record<string, RouteCoverageYards>;
  highlights: Highlight[];
};

self.onmessage = (e: MessageEvent<WorkerInput>) => {
  const { offenseTeam, defenseTeam, offensePlaybook, defensePlaybook } = e.data;

  // Inject the serialized roster data into this worker's isolated LEAGUE copy
  for (const incoming of [offenseTeam, defenseTeam]) {
    const lt = LEAGUE.find((t) => t.color === incoming.color);
    if (lt) lt.roster = incoming.roster;
  }

  // Mirror each team's current playbook tendencies into this worker's own
  // TEAM_PLAYBOOKS so the simulated game actually calls plays the way the
  // main thread has configured it, not this worker's stale defaults.
  if (offensePlaybook && TEAM_PLAYBOOKS[offenseTeam.color]) {
    Object.assign(TEAM_PLAYBOOKS[offenseTeam.color], offensePlaybook);
  }
  if (defensePlaybook && TEAM_PLAYBOOKS[defenseTeam.color]) {
    Object.assign(TEAM_PLAYBOOKS[defenseTeam.color], defensePlaybook);
  }

  const result = simulateFullGame(offenseTeam.color, defenseTeam.color);
  self.postMessage(result satisfies WorkerOutput);
};

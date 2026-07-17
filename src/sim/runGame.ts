import { Highlight } from "../core/highlights";
import { TEAM_PLAYBOOKS } from "../core/playbook";
import {
  PlayerStatsByLabel,
  RouteCoverageYards,
  SpecificPlaycallCoverageStats,
  Team,
} from "../core/types";

/**
 * Runs a full headless game in a Web Worker and resolves with the final scores,
 * each team's per-label player stat lines (keyed by team color), each team's
 * defensive coverage-call breakdown, each team's route-vs-coverage yards, and
 * the game's highlight reel. The `offenseTeam` starts the game with the ball
 * (home team).
 */
export function workerGame(
  offenseTeam: Team,
  defenseTeam: Team,
): Promise<{
  offenseScore: number;
  defenseScore: number;
  playerStats: Record<string, PlayerStatsByLabel>;
  defensivePlaycalls: Record<string, SpecificPlaycallCoverageStats>;
  routeCoverage: Record<string, RouteCoverageYards>;
  highlights: Highlight[];
}> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./simWorker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = (e) => {
      resolve(e.data);
      worker.terminate();
    };
    worker.onerror = reject;
    // The worker runs in its own thread with its own isolated module state,
    // so TEAM_PLAYBOOKS there never sees changes made on the main thread
    // (e.g. from the Training tab) unless explicitly sent across like this.
    worker.postMessage({
      offenseTeam,
      defenseTeam,
      offensePlaybook: TEAM_PLAYBOOKS[offenseTeam.color],
      defensePlaybook: TEAM_PLAYBOOKS[defenseTeam.color],
    });
  });
}

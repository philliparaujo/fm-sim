import { Highlight } from "../core/highlights";
import { PlayerStatsByLabel, Team } from "../core/types";

/**
 * Runs a full headless game in a Web Worker and resolves with the final scores,
 * each team's per-label player stat lines (keyed by team color), and the game's
 * highlight reel. The `offenseTeam` starts the game with the ball (home team).
 */
export function workerGame(
  offenseTeam: Team,
  defenseTeam: Team,
): Promise<{
  offenseScore: number;
  defenseScore: number;
  playerStats: Record<string, PlayerStatsByLabel>;
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
    worker.postMessage({ offenseTeam, defenseTeam });
  });
}

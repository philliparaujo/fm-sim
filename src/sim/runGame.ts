import { Team } from "../core/types";

/**
 * Runs a full headless game in a Web Worker and resolves with the final scores.
 * The `offenseTeam` starts the game with the ball (i.e. the home team).
 */
export function workerGame(
  offenseTeam: Team,
  defenseTeam: Team,
): Promise<{ offenseScore: number; defenseScore: number }> {
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

import { LEAGUE } from "../core/state";
import { Team } from "../core/types";
import { simulateFullGame } from "./index";

type WorkerInput = { offenseTeam: Team; defenseTeam: Team };
type WorkerOutput = { offenseScore: number; defenseScore: number };

self.onmessage = (e: MessageEvent<WorkerInput>) => {
  const { offenseTeam, defenseTeam } = e.data;

  // Inject the serialized roster data into this worker's isolated LEAGUE copy
  for (const incoming of [offenseTeam, defenseTeam]) {
    const lt = LEAGUE.find((t) => t.color === incoming.color);
    if (lt) lt.roster = incoming.roster;
  }

  const result = simulateFullGame(offenseTeam.color, defenseTeam.color);
  self.postMessage(result satisfies WorkerOutput);
};

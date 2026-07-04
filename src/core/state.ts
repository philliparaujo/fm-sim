import { buildDefaultRoster } from "../utils/roster";
import { START_DRIVE } from "../utils/units";
import {
  generateBall,
  generateDefensivePlaycall,
  generateOffensePlaycall,
  generateScoreboard,
  generateSpecialPlaycall,
} from "./playbook";
import { LEAGUE_TEAMS } from "./teams";
import { Player, State, Team } from "./types";

const recreateState = (
  offenseTeam: Team,
  defenseTeam: Team,
  startingLOS?: number,
): State => {
  const LOS = startingLOS ?? START_DRIVE;
  const ball = generateBall(LOS);
  const scoreboard = generateScoreboard(LOS, offenseTeam, defenseTeam);
  const offensePlay = generateOffensePlaycall(LOS, ball, offenseTeam);
  const defensePlay = generateDefensivePlaycall(
    LOS,
    defenseTeam,
    offensePlay.players,
  );
  const specialPlay = generateSpecialPlaycall(scoreboard);

  return {
    steps: 0,
    pausedUntil: 0,
    ballGiven: false,
    ballGivenAtStep: 0,
    blockingAssignments: new Map<Player, Player>(),
    scoreboard: scoreboard,
    stats: {},
    playAdvanced: {
      wasOffTarget: false,
      wasThrowAway: false,
      wasUnderPressure: false,
    },
    currentPlay: {
      offense: offensePlay.playType,
      defense: defensePlay.coverage,
      special: specialPlay,
      runAngle: offensePlay.runAngle,
      routes: offensePlay.routes,
    },
    ball: ball,
    ballFlight: null,
    players: [...offensePlay.players, ...defensePlay.players],
  };
};

/** Every league team, each with its own full roster. Score/timeouts/possession
 * are per-game and get reset whenever a game is loaded. */
const LEAGUE: Team[] = LEAGUE_TEAMS.map((def) => ({
  color: def.color,
  name: def.name,
  score: 0,
  timeouts: 3,
  possessing: false,
  roster: buildDefaultRoster(def.color),
}));

// Open on the first matchup in the league
const state: State = recreateState(LEAGUE[0], LEAGUE[1]);

export { LEAGUE, recreateState, state };

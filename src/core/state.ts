import { buildDefaultRoster } from "../utils/roster";
import { START_DRIVE } from "../utils/units";
import {
  generateBall,
  generateDefensivePlaycall,
  generateOffensePlaycall,
  generateScoreboard,
  generateSpecialPlaycall,
} from "./playbook";
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

const teams: Team[] = [
  {
    color: "red",
    name: "RED",
    score: 0,
    timeouts: 3,
    possessing: true,
    roster: buildDefaultRoster("red"),
  },
  {
    color: "blue",
    name: "BLU",
    score: 0,
    timeouts: 3,
    possessing: false,
    roster: buildDefaultRoster("blue"),
  },
];

const state: State = recreateState(teams[0], teams[1]);

export { recreateState, state };

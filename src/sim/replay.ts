import { ReplayFrame, State } from "../core/types";
import { state } from ".";

let currentPlayFrames: ReplayFrame[] = [];
let completedPlays: ReplayFrame[][] = []; // Stores up to 3 plays. [0] = 1 play ago, [1] = 2 ago, [2] = 3 ago
let replayMode: "live" | number = "live";
let replayFrameIndex = 0;

const NUM_REPLAYS = 3; // Can't change due to replayControls.ts logic, btn-replay-{#} buttons

/** Selects a specific replay index or to watch live */
function setReplayMode(mode: "live" | number) {
  replayMode = mode;
  replayFrameIndex = 0; // Reset animation playhead on switch
}

/** Returns how many replays are saved */
function getCompletedPlaysCount(): number {
  return completedPlays.length;
}

/** Records current frame to later save as part of a full play's replay */
function captureReplayFrame() {
  currentPlayFrames.push({
    ballLoc: { x: state.ball.loc.x, y: state.ball.loc.y },
    ballVel: { x: state.ball.vel.x, y: state.ball.vel.y },
    players: state.players.map((p) => ({
      ...p,
      loc: { x: p.loc.x, y: p.loc.y },
      vel: { x: p.vel.x, y: p.vel.y },
      prevVel: { x: p.prevVel.x, y: p.prevVel.y },
      assignedTarget: null,
    })),
    // Create a deep value copy of the scoreboard state
    scoreboard: JSON.parse(JSON.stringify(state.scoreboard)),
  });
}

/** Save the most recent replay and make room for it if necessary */
function saveReplay() {
  if (currentPlayFrames.length > 0) {
    completedPlays.unshift([...currentPlayFrames]);
    if (completedPlays.length > NUM_REPLAYS) {
      completedPlays.pop();
    }
    currentPlayFrames = [];
    window.dispatchEvent(new CustomEvent("playRecorded"));
  }
}

/** Returns true if on the current play, returns false if watching a replay */
function isLive(): boolean {
  return replayMode === "live";
}

/** If watching a replay, returns its current frame. Otherwise, returns null */
function getReplayFrame(): ReplayFrame | null {
  if (replayMode === "live") return null;
  const activePlay = completedPlays[replayMode];
  return activePlay[replayFrameIndex];
}

/** Converts the current replay frame into a state that can be rendered */
function getReplayMockState(frame: ReplayFrame): State {
  return {
    ...state,
    ball: { ...state.ball, loc: frame.ballLoc, vel: frame.ballVel },
    players: frame.players,
    scoreboard: frame.scoreboard,
  };
}

/** If watching a replay, move to its next frame (loops). Otherwise, no-op */
function incrementReplay(): void {
  if (replayMode === "live") return;
  const activePlay = completedPlays[replayMode];
  replayFrameIndex = (replayFrameIndex + 1) % activePlay.length;
}

export {
  captureReplayFrame,
  getCompletedPlaysCount,
  getReplayFrame,
  getReplayMockState,
  incrementReplay,
  isLive,
  saveReplay,
  setReplayMode,
};

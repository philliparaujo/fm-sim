import { ReplayFrame, State } from "../core/types";
import { state } from ".";

// Stores up to NUM_REPLAYS plays. [0] = 1 play ago, [1] = 2 ago, ...
let currentPlayFrames: ReplayFrame[] = [];
let completedPlays: ReplayFrame[][] = [];
let replayMode: "live" | number = "live";
let replayFrameIndex = 0;

/** How many past plays to keep for replay. The replay buttons are generated
 * from this, so changing it is all that's needed. */
export const NUM_REPLAYS = 10;

// ── One-off highlight playback (overrides the normal replay path) ──
let highlightFrames: ReplayFrame[] | null = null;
let highlightIndex = 0;
let highlightStride = 1;
let highlightTick = 0;
/** Fired when the current clip reaches its last frame. If set, it runs instead
 * of the default single-clip loop — letting a caller chain to the next clip
 * for continuous, live-feeling playback. */
let highlightEndCallback: (() => void) | null = null;

/** Plays an externally supplied set of frames (e.g. a simulated-game highlight),
 * advancing one frame every `stride` ticks to match the capture downsampling.
 * Without `onEnd` the clip loops; with it, `onEnd` fires once the clip finishes
 * (e.g. to advance to the next highlight). */
function playHighlight(frames: ReplayFrame[], stride = 1, onEnd?: () => void) {
  highlightFrames = frames.length > 0 ? frames : null;
  highlightIndex = 0;
  highlightStride = Math.max(1, stride);
  highlightTick = 0;
  highlightEndCallback = onEnd ?? null;
}

function isHighlightPlaying(): boolean {
  return highlightFrames !== null;
}

/** Selects a specific replay index or to watch live; also exits highlight mode. */
function setReplayMode(mode: "live" | number) {
  highlightFrames = null;
  highlightEndCallback = null;
  replayMode = mode;
  replayFrameIndex = 0; // Reset animation playhead on switch
}

/** Returns how many replays are saved */
function getCompletedPlaysCount(): number {
  return completedPlays.length;
}

/** Builds a renderable snapshot of the current live state. */
function snapshotFrame(): ReplayFrame {
  return {
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
  };
}

/** Records current frame to later save as part of a full play's replay */
function captureReplayFrame() {
  currentPlayFrames.push(snapshotFrame());
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
  if (highlightFrames) return false;
  return replayMode === "live";
}

/** If watching a replay/highlight, returns its current frame. Otherwise null */
function getReplayFrame(): ReplayFrame | null {
  if (highlightFrames) return highlightFrames[highlightIndex] ?? null;
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

/** If watching a replay/highlight, move to its next frame (loops). Else no-op */
function incrementReplay(): void {
  if (highlightFrames) {
    highlightTick++;
    if (highlightTick % highlightStride === 0) {
      if (highlightIndex + 1 >= highlightFrames.length) {
        // Clip finished: hand off to the end callback (which typically starts
        // the next clip) or, absent one, loop this clip.
        if (highlightEndCallback) {
          highlightEndCallback();
          return;
        }
        highlightIndex = 0;
      } else {
        highlightIndex++;
      }
    }
    return;
  }
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
  isHighlightPlaying,
  isLive,
  playHighlight,
  saveReplay,
  setReplayMode,
  snapshotFrame,
};

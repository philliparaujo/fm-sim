import { Ball, Player, Scoreboard, State, Vector } from "../core/types";
import { ENDZONE_W, pxToYards, TOTAL_H, TOTAL_W, W, yardsToPx } from "./units";
import { dist } from "./vector";

/** Returns the rectangular in-play field bounds */
export function getFieldBounds() {
  const BOUNDARY_MARGIN = yardsToPx(1);
  return {
    minX: BOUNDARY_MARGIN,
    maxX: TOTAL_W - BOUNDARY_MARGIN,
    minY: BOUNDARY_MARGIN,
    maxY: TOTAL_H - BOUNDARY_MARGIN,
  };
}

/** Returns true if the Vector is within a yard of out of bounds */
export function nearSideline(pos: Vector): boolean {
  const { minX, maxX, minY, maxY } = getFieldBounds();

  if (pos.x < minX || pos.x > maxX || pos.y < minY || pos.y > maxY) {
    return true;
  }

  return false;
}

/** Force a position Vector into the field's bounds */
export function clampPosInBounds(pos: Vector): Vector {
  const { minX, maxX, minY, maxY } = getFieldBounds();

  return {
    x: Math.max(minX, Math.min(maxX, pos.x)),
    y: Math.max(minY, Math.min(maxY, pos.y)),
  };
}

/** Calculate the new LOS (px) after a 45 yard punt */
export function getLOSAfterPunt(prevLOS: number): number {
  // Convert yard scales cleanly to pixel measurements using field width
  const AVERAGE_NET_PUNT = yardsToPx(45);
  const TOUCHBACK_POSITION = ENDZONE_W + yardsToPx(20); // Left goal line + 20 yards
  const OPPONENT_GOAL_LINE = TOTAL_W - ENDZONE_W; // Right goal line

  // 1. Where does the ball physically land on the screen? (Moving right)
  const landingSpotX = prevLOS + AVERAGE_NET_PUNT;

  // 2. If it touches or crosses the opponent's goal line, it's a touchback.
  // The new offense comes out to their own 20-yard line on the left.
  if (landingSpotX >= OPPONENT_GOAL_LINE) {
    return TOUCHBACK_POSITION;
  }

  // 3. Flip perspective: The distance remaining to the opponent's right goal line
  // becomes the new team's starting distance from their own left goal line.
  const distanceToOpponentGoal = OPPONENT_GOAL_LINE - landingSpotX;

  return ENDZONE_W + distanceToOpponentGoal;
}

/** Return location (px) of new first down line, or null if goal-to-go  */
export function computeFirstDownLine(
  LOS: number,
  yardsToGo: "goal" | number,
): number | null {
  if (yardsToGo === "goal") return null;
  return LOS + yardsToPx(yardsToGo);
}

/** Return number of yards from LOS needed to cross the opposing goal line */
export function yardsToGoal(LOS: number): number {
  const goalLine = W + ENDZONE_W;
  return Math.max(0, pxToYards(goalLine - LOS));
}

/** Return number of yards to go from a 1st down starting at the LOS */
export function distanceAfterFirstDown(LOS: number): "goal" | number {
  return yardsToGoal(LOS) <= 10 ? "goal" : 10;
}

function nextDown(down: Scoreboard["down"]): Scoreboard["down"] {
  const DOWNS = ["1st", "2nd", "3rd", "4th"] as const;
  const idx = DOWNS.indexOf(down);
  return DOWNS[Math.min(idx + 1, DOWNS.length - 1)];
}

/** Update scoreboard's down and distance based on last play's end location */
export function updateDownAndDistance(
  prev: Scoreboard,
  nextLOS: number,
  forceFirstDown = false,
): Pick<Scoreboard, "down" | "distance" | "firstDownLine"> {
  const gotFirstDown =
    forceFirstDown ||
    (prev.firstDownLine !== null && nextLOS >= prev.firstDownLine);

  if (gotFirstDown) {
    const distance = distanceAfterFirstDown(nextLOS);
    return {
      down: "1st",
      distance,
      firstDownLine: computeFirstDownLine(nextLOS, distance),
    };
  }

  const yardsGained = pxToYards(nextLOS - prev.LOS);
  const distance: "goal" | number =
    prev.distance === "goal"
      ? "goal"
      : Math.max(1, prev.distance - yardsGained);
  const down = prev.down === "4th" ? "4th" : nextDown(prev.down);

  return {
    down,
    distance,
    firstDownLine: computeFirstDownLine(nextLOS, distance),
  };
}

const BALL_SNAP_DIST = 24; // Maximum distance where a player will snap to the ball
export function isCarryingBall(player: Player, ball: Ball): boolean {
  return dist(player.loc, ball.loc) < BALL_SNAP_DIST;
}

export function isRunPlay(state: State): boolean {
  return (
    state.currentPlay.special === null && state.currentPlay.offense === "run"
  );
}

export function isPassPlay(state: State): boolean {
  return (
    state.currentPlay.special === null && state.currentPlay.offense === "pass"
  );
}

export function isFieldGoalPlay(state: State): boolean {
  return state.currentPlay.special === "fieldgoal";
}

export function isPuntPlay(state: State): boolean {
  return state.currentPlay.special === "punt";
}

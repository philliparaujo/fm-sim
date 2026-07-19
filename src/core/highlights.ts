import { ReplayFrame } from "./types";

export type HighlightKind =
  | "score"
  | "turnover"
  | "sack"
  | "bigPass"
  | "bigRun"
  | "loss"
  /** The game's very last play, forced into the reel even when it wouldn't
   * otherwise qualify (e.g. a clock-killing run) — see resetSimulation's
   * highlight capture — so a full reel always ends on the actual final play
   * and states the final score, instead of stopping at whatever earlier play
   * happened to be the last one that qualified on its own. */
  | "final";

/** A saved highlight: the play's replay frames plus display metadata. */
export type Highlight = {
  kind: HighlightKind;
  description: string;
  quarter: string;
  clock: string; // mm:ss on the game clock when the play ended
  teamColor: string; // team the entry is colored by
  frames: ReplayFrame[];
};

/**
 * Only every Nth logic tick is stored per highlight to keep the frame payload
 * manageable across the worker boundary; playback advances one frame every
 * `stride` ticks to keep real-time speed.
 */
export const HIGHLIGHT_FRAME_STRIDE = 2;

/**
 * The thresholds that make a play a highlight. Tweak these freely — everything
 * about what counts as a highlight lives here and in `evaluateHighlight`.
 */
export const HIGHLIGHT_RULES = {
  lossYards: 5, // a loss of this many yards or more
  runYards: 15, // a rush gaining this many yards or more
  passYards: 25, // a completion gaining this many yards or more
};

/** The play data `evaluateHighlight` needs to judge and describe a highlight. */
export type PlayOutcome = {
  playYards: number;
  isRush: boolean;
  isCompletePass: boolean;
  isSack: boolean;
  isInterception: boolean;
  isTouchdown: boolean;
  isFieldGoal: boolean;
  isSafety: boolean;
  offenseColor: string;
  offenseName: string;
  defenseColor: string;
  defenseName: string;
};

/**
 * Decides whether a finished play is a highlight and, if so, how to label it.
 * Returns null for ordinary plays. Scoring plays, turnovers, and sacks always
 * qualify; big gains and big losses qualify past the `HIGHLIGHT_RULES` cutoffs.
 * Priority is highest-impact first so each play gets a single label.
 */
export function evaluateHighlight(
  o: PlayOutcome,
): { kind: HighlightKind; description: string; teamColor: string } | null {
  const yds = Math.round(o.playYards);

  if (o.isTouchdown) {
    const how = o.isCompletePass ? "TD pass" : o.isRush ? "TD run" : "TD";
    return {
      kind: "score",
      description: `${o.offenseName} ${Math.abs(yds)}-yd ${how}`,
      teamColor: o.offenseColor,
    };
  }
  if (o.isFieldGoal) {
    return {
      kind: "score",
      description: `${o.offenseName} field goal`,
      teamColor: o.offenseColor,
    };
  }
  if (o.isSafety) {
    return {
      kind: "score",
      description: `${o.defenseName} safety`,
      teamColor: o.defenseColor,
    };
  }
  if (o.isInterception) {
    return {
      kind: "turnover",
      description: `${o.defenseName} interception`,
      teamColor: o.defenseColor,
    };
  }
  if (o.isSack) {
    return {
      kind: "sack",
      description: `${o.defenseName} sack`,
      teamColor: o.defenseColor,
    };
  }
  if (o.isCompletePass && yds >= HIGHLIGHT_RULES.passYards) {
    return {
      kind: "bigPass",
      description: `${o.offenseName} ${yds}-yd pass`,
      teamColor: o.offenseColor,
    };
  }
  if (o.isRush && yds >= HIGHLIGHT_RULES.runYards) {
    return {
      kind: "bigRun",
      description: `${o.offenseName} ${yds}-yd run`,
      teamColor: o.offenseColor,
    };
  }
  if ((o.isRush || o.isCompletePass) && yds <= -HIGHLIGHT_RULES.lossYards) {
    return {
      kind: "loss",
      description: `${o.offenseName} ${yds}-yd loss`,
      teamColor: o.offenseColor,
    };
  }
  return null;
}

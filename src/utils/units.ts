import { Ellipse } from "../core/types";

/* Sizing constants */
/** Goal line to goal line length (px) */
export const W = 2160;

/** Sideline-to-sideline (px)  */
export const H = 1200;

/** Get the dimensions of the pocket ellipse (px) */
export function getPocket(LOS: number): Ellipse {
  return {
    cx: LOS - yardsToPx(5),
    cy: H / 2,
    rx: 90,
    ry: 360,
  };
}

const PIXELS_PER_YARD = W / 100;
const YARDS_PER_METER = 1.09361;
const PIXELS_PER_METER = PIXELS_PER_YARD * YARDS_PER_METER;

export function pxToYards(pixels: number): number {
  return (pixels / W) * 100;
}

export function yardsToPx(yards: number): number {
  return yards * PIXELS_PER_YARD;
}

export function metersToPx(meters: number): number {
  return meters * PIXELS_PER_METER;
}

/* Derived field measurements */
/** Length of 1 endzone (px) */
export const ENDZONE_W = yardsToPx(10);

/** Full football field length (px) */
export const TOTAL_W = W + 2 * ENDZONE_W;

/** Full football field width (px) */
export const TOTAL_H = H;

/** Default starting field position distance from back of own endzone (px) */
export const START_DRIVE = ENDZONE_W + yardsToPx(25);

/** Distance between uprights (px) */
export const GOALPOST_CROSSBAR_WIDTH = yardsToPx(6.17);

/* Timing constants */
const TICKS_PER_SECOND = 60;
const SECONDS_PER_MINUTE = 60;
/** Duration of one tick / simulation step (ms) */
export const LOGIC_TICK_MS = 1000 / TICKS_PER_SECOND;

export function secondsToTicks(seconds: number): number {
  return seconds * TICKS_PER_SECOND;
}
export function ticksToSeconds(ticks: number): number {
  return ticks / TICKS_PER_SECOND;
}
export function perSecondToPerTick(unitsPerSecond: number): number {
  return unitsPerSecond / TICKS_PER_SECOND;
}

/** Length of one quarter, in game-clock seconds */
export const QUARTER_SECONDS = 900;
/** Game-clock seconds that run off between plays (real game only) */
export const PLAY_CLOCK_RUNOFF = 32;
/** Clock threshold (s) that triggers the two-minute warning in Q2/Q4 */
export const TWO_MINUTE_WARNING_SECONDS = 120;

/** Turns a number of seconds (e.g. 400) into a scoreboard time (e.g. '06:40') */
export function secondsToTimeString(seconds: number): string {
  const clamped = Math.max(0, seconds);
  const mins = Math.floor(clamped / SECONDS_PER_MINUTE);
  const secs = Math.floor(clamped % SECONDS_PER_MINUTE);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

/** Turns a LOS (px) into a yardage string (e.g. '< 35') */
export function LOSToString(LOS: number) {
  if (LOS <= ENDZONE_W) return "Safety";
  if (LOS >= W + ENDZONE_W) return "Touchdown";

  const adjLOS = LOS - ENDZONE_W;
  const yardsNumber = Math.round(pxToYards(adjLOS));

  if (yardsNumber < 50) {
    return `< ${yardsNumber}`;
  } else if (yardsNumber === 50) {
    return `${yardsNumber}`;
  } else {
    return `${100 - yardsNumber} >`;
  }
}

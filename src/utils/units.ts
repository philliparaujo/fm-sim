/* Sizing constants */
/** Goal line to goal line length (px) */
export const W = 2160;

/** Sideline-to-sideline (px)  */
export const H = 1200;

/* Conversions */
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

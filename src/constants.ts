/* Global constants */
export const TRAINING_MODE_ON = true;

/* Sizing constants */
export const W = 720 * 3;
export const H = 400 * 3;

export const ENDZONE_W = (W * 1) / 10;
export const TOTAL_W = W + 2 * ENDZONE_W;
export const TOTAL_H = H;

export const START_DRIVE = (25 * W) / 100 + ENDZONE_W;

/* Field goal constants */
export const GOALPOST_CROSSBAR_WIDTH = 138; // distance between uprights

/* Simulation constants */
export let simSpeed = 1;
export const LOGIC_TICK_MS = 1000 / 60;
export const PAUSE_MS_AFTER_PLAY = 0;
export function setSimSpeed(value: number) {
  simSpeed = value;
}

/* Player attribute constants */
// Blocker
export const MIN_BLOCK_DISTANCE = 120;

// Rusher
export const INLINE_NUDGE = 2.1; // Nudges rusher if inline with blocker
export const RUSHER_STEER_FACTOR = 1; // Rusher C.O.D amount

// Runner
export const ANGLE_ENDZONE_INTENT = 1;

// Recevier
export const PIXELS_PER_STEP = 45;
export const ROUTE_BREAK_ANGLE_JITTER = 3;

// Coverer
export const LEAD_FRAMES = 20;
export const ARRIVAL_RADIUS = 45;

// Pursuer
export const PURSUER_STEER_FACTOR = 0.5;

// Passer
export const BALL_GIVEN_STEPS = 400;
export const PASSER_HANDOFF_SEPARATION = 80;
export const SHORT_THROW_THRESHOLD_PX = 15 * (W / 100); // 15 yards in pixels

// Tackling
export const TACKLE_PRESSURE_PER_FRAME = 0.05; // How fast pressure builds while in contact (0–1 scale)
export const BROKEN_TACKLE_SPEED_BURST = 0.7; // Speed multiplier when carrier breaks a tackle
export const BROKEN_TACKLE_BURST_DURATION = 15;

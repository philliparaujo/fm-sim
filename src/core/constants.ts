/* Global constants */
export const TRAINING_MODE_ON = false;

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

// Recevier
export const ROUTE_BREAK_ANGLE_JITTER = 3;

// Coverer
export const LEAD_FRAMES = 20;
export const ARRIVAL_RADIUS = 45;

// Pursuer
export const PURSUER_STEER_FACTOR = 0.5;

// Passer
export const PASSER_HANDOFF_SEPARATION = 80;
export const PANIC_RUSHER_DIST = 80;
export const PANIC_THROW_CHANCE = 0.25;
export const MAX_PREDICTION_FRAMES = 300;

// Tackling
export const TACKLE_PRESSURE_PER_FRAME = 0.05; // How fast pressure builds while in contact (0–1 scale)
export const BROKEN_TACKLE_SPEED_BURST = 0.7; // Speed multiplier when carrier breaks a tackle
export const BROKEN_TACKLE_BURST_DURATION = 15;

import { FIELD_SCALE } from "../utils/units";

/* Global constants */
export const TRAINING_MODE_ON = false;
/** Gates routine dev-only console output (per-100-play milestones, full stat
 * dumps at game-over) that isn't useful in a shipped build. Genuine "this
 * should never happen" invariant warnings (e.g. utils/roster.ts) are left
 * ungated since they only fire on an actual bug, not routine play. */
export const DEBUG_LOGGING = false;

/* Simulation constants */
export let simSpeed = 1;
export const PAUSE_MS_AFTER_PLAY = 0;
export function setSimSpeed(value: number) {
  simSpeed = value;
}

/* Player attribute constants */
// Blocker
export const MIN_BLOCK_DISTANCE = 120 * FIELD_SCALE;

// Rusher
export const INLINE_NUDGE = 2.1; // Nudges rusher if inline with blocker (bias on unit normal Y component — dimensionless, must NOT scale)
export const RUSHER_STEER_FACTOR = 1; // Rusher C.O.D amount

// Recevier
export const ROUTE_BREAK_ANGLE_JITTER = 3;

// Coverer
export const LEAD_TICKS = 20; // # of ticks ahead the coverer wants to be
export const ARRIVAL_RADIUS = 45 * FIELD_SCALE;

// Pursuer
export const PURSUER_STEER_FACTOR = 0.5;

// Passer
export const PASSER_HANDOFF_SEPARATION = 80 * FIELD_SCALE;
export const PANIC_RUSHER_DIST = 80 * FIELD_SCALE;
export const PANIC_THROW_CHANCE = 0.25;
export const MAX_PREDICTION_TICKS = 300; // # of ticks ahead passer scans for
export const THROW_EVAL_INTERVAL = 6; // Passer evaluates throws every X ticks

// Tackling
export const TACKLE_PRESSURE_PER_TICK = 0.05; // How fast pressure builds each tick while in contact
export const BROKEN_TACKLE_SPEED_BURST = 0.7; // Speed multiplier when carrier breaks a tackle
export const BROKEN_TACKLE_BURST_DURATION = 15;

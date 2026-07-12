import { Attribute } from "./ratings";
import { Label } from "./types";

export type RoleWeights = Partial<Record<Attribute, number>>;

export type DraftStrategy = {
  name: string;
  /** Weight on the top prospect's raw attribute score (0–1). */
  scoreWeight: number;
  /** Weight on cascade urgency — how quickly the position pool drops off (0–1). */
  urgencyWeight: number;
  /** Additive pick-value bonus per position label; use to model positional preferences. */
  positionBonus?: Partial<Record<Label, number>>;
  /**
   * Custom per-role attribute weights for scoring prospects.
   * Keys must match labelToRole() outputs. Falls back to DEFAULT_ROLE_WEIGHTS for
   * any role not listed.
   */
  roleWeights?: Record<string, RoleWeights>;
};

// Default attribute weights per role used by scoreProspect.
export const DEFAULT_ROLE_WEIGHTS: Record<string, RoleWeights> = {
  passer: {
    SPEED: 0.05,
    THROWPOWER: 0.25,
    POCKETPRESENCE: 0.1,
    DECISIONMAKING: 0.25,
    SHORTACCURACY: 0.15,
    DEEPACCURACY: 0.2,
  },
  runner: {
    SPEED: 0.3,
    SIZE: 0.01,
    VISION: 0.25,
    POWER: 0.4,
    PASSBLOCK: 0.04,
  },
  catcher: {
    SPEED: 0.25,
    SIZE: 0.01,
    ROUTERUNNING: 0.25,
    CATCHACCELERATION: 0.05,
    CATCHRADIUS: 0.3,
    RUNBLOCK: 0.04,
    VISION: 0.05,
    POWER: 0.05,
  },
  blocker: {
    SPEED: 0.05,
    SIZE: 0.15,
    PASSBLOCK: 0.4,
    RUNBLOCK: 0.4,
  },
  rusher: {
    SPEED: 0.15,
    SIZE: 0.05,
    BLOCKSHEDDING: 0.4,
    BEND: 0.3,
    TACKLING: 0.1,
  },
  coverer: {
    SPEED: 0.18,
    SIZE: 0.01,
    PURSUIT: 0.05,
    MANCOVERAGE: 0.21,
    ZONECOVERAGE: 0.31,
    TACKLING: 0.05,
    BLOCKSHEDDING: 0.01,
    CATCHRADIUS: 0.08,
  },
};

export const STRATEGIES: Record<string, DraftStrategy> = {
  /**
   * Balanced: equal weight on raw talent and positional scarcity.
   * Good general-purpose strategy.
   */
  balanced: {
    name: "balanced",
    scoreWeight: 0.5,
    urgencyWeight: 0.5,
  },

  /**
   * Best Player Available: heavily favors raw attribute score.
   * Drafts elite talent even at non-scarce positions.
   */
  bpa: {
    name: "bpa",
    scoreWeight: 0.85,
    urgencyWeight: 0.15,
  },

  /**
   * Positional: heavily favors pool scarcity.
   * Always fills the position whose pool will dry up fastest.
   */
  positional: {
    name: "positional",
    scoreWeight: 0.2,
    urgencyWeight: 0.8,
  },

  /**
   * Value: urgency-leaning balance.
   * Reacts to pool cliffs without ignoring raw talent.
   */
  value: {
    name: "value",
    scoreWeight: 0.35,
    urgencyWeight: 0.65,
  },

  /**
   * Speed Rush: balanced base but bonuses for edge rushers and receivers.
   * Models a team that prioritizes pass-rush and aerial attack.
   */
  speedRush: {
    name: "speedRush",
    scoreWeight: 0.5,
    urgencyWeight: 0.5,
    positionBonus: { LE: 0.1, RE: 0.1, XR: 0.08, ZR: 0.06 },
  },

  /**
   * Power Run: balanced base but bonuses for running game positions.
   * Models a team that prioritizes the ground game.
   */
  powerRun: {
    name: "powerRun",
    scoreWeight: 0.5,
    urgencyWeight: 0.5,
    positionBonus: { RB: 0.12, LT: 0.08, RT: 0.06, C: 0.05 },
  },
};

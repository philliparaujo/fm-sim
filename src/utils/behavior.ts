import {
  MAX_PREDICTION_TICKS,
  ROUTE_BREAK_ANGLE_JITTER,
} from "../core/constants";
import { getConstants } from "../core/ratings";
import { Player, State, Vector } from "../core/types";
import { clampPosInBounds, getFieldBounds, nearSideline } from "./field";
import { lerp } from "./math";
import { H, yardsToPx } from "./units";

export const MAX_PATH_LENGTH = 200; // Cap path arrays to prevent render bloat

interface RouteVelocityContext {
  absoluteTick: number;
  currentLocX: number; // Added to trace X-axis position safely
  currentLocY: number;
  routeSideMultiplier: 1 | -1 | null;
  breakTick: number | null;
  improvAngleRad: number | null; // Added tracking field
}

const catcherRouteVariance = new WeakMap<
  Player,
  { angleOffset: number; stemDrift: number }
>();

export function getReceiverVelocityAtTick(
  receiver: Player,
  state: State,
  ctx: RouteVelocityContext,
): {
  velX: number;
  velY: number;
  sideMultiplier: 1 | -1 | null;
  isBreaking: boolean;
  improvAngleRad: number | null;
} {
  const { maxSpeed } = getConstants("SPEED", receiver);

  if (!receiver.route) {
    return {
      velX: 0,
      velY: 0,
      sideMultiplier: 1,
      isBreaking: false,
      improvAngleRad: null,
    };
  }

  // Ensure we compute currentLoc accurately for both phases
  const currentLoc = { x: ctx.currentLocX, y: ctx.currentLocY };

  const routeBreakThreshold =
    ctx.breakTick ??
    Math.floor(yardsToPx(receiver.route.yardsBeforeBreak) / maxSpeed);

  // 1) STEM PHASE
  if (ctx.absoluteTick < routeBreakThreshold) {
    if (nearSideline(receiver.loc)) {
      return {
        velX: 0,
        velY: 0,
        sideMultiplier:
          ctx.routeSideMultiplier ?? (ctx.currentLocY < H / 2 ? 1 : -1),
        isBreaking: false,
        improvAngleRad: null,
      };
    }

    return {
      velX: maxSpeed,
      velY: getCatcherRouteVariance(receiver).stemDrift,
      sideMultiplier:
        ctx.routeSideMultiplier ?? (ctx.currentLocY < H / 2 ? 1 : -1),
      isBreaking: false,
      improvAngleRad: null,
    };
  }

  const sideMultiplier =
    ctx.routeSideMultiplier ?? (ctx.currentLocY < H / 2 ? 1 : -1);

  // --- FIX: Pass the moving currentLoc here instead of the live receiver object ---
  const isTriggeredByTime = state.steps > 200;

  if (isTriggeredByTime) {
    if (ctx.improvAngleRad !== null) {
      return {
        velX: Math.cos(ctx.improvAngleRad) * maxSpeed,
        velY: Math.sin(ctx.improvAngleRad) * maxSpeed,
        sideMultiplier: sideMultiplier,
        isBreaking: false,
        improvAngleRad: ctx.improvAngleRad,
      };
    }

    const baseVelX = receiver.vel.x || maxSpeed;
    const baseVelY = receiver.vel.y || 0;

    const improv = getImprovisedVelocity(
      receiver,
      currentLoc,
      state.scoreboard.LOS,
      baseVelX,
      baseVelY,
      maxSpeed,
    );

    return {
      velX: improv.velX,
      velY: improv.velY,
      sideMultiplier: sideMultiplier,
      isBreaking: false,
      improvAngleRad: ctx.improvAngleRad ?? improv.angleRad,
    };
  }

  // 2) BREAK PHASE
  const { angleOffset } = getCatcherRouteVariance(receiver);
  const finalBreakAngleRad =
    (receiver.route.breakAngle + angleOffset) *
    sideMultiplier *
    (Math.PI / 180);

  const activeBreakTick = ctx.breakTick ?? routeBreakThreshold;
  const ticksSinceBreak = ctx.absoluteTick - activeBreakTick;
  let currentSpeed = maxSpeed;

  const {
    stopAfterBreakThreshold,
    routeCutSpeedRetained,
    reaccelerationDuration,
  } = getConstants("ROUTERUNNING", receiver);

  if (ticksSinceBreak <= reaccelerationDuration) {
    const progress = ticksSinceBreak / reaccelerationDuration;
    currentSpeed = maxSpeed * lerp(progress, routeCutSpeedRetained, 1.0);
  }

  let velX = Math.cos(finalBreakAngleRad) * currentSpeed;
  let velY = Math.sin(finalBreakAngleRad) * currentSpeed;

  if (
    receiver.route.stopAfterBreak &&
    ctx.absoluteTick > routeBreakThreshold + stopAfterBreakThreshold
  ) {
    velX *= 0.3;
    velY *= 0.3;
  }

  return { velX, velY, sideMultiplier, isBreaking: true, improvAngleRad: null };
}

function getCatcherRouteVariance(player: Player) {
  const { routeStemDrift } = getConstants("ROUTERUNNING", player);
  const { maxSpeed } = getConstants("SPEED", player);

  let variance = catcherRouteVariance.get(player);
  if (!variance) {
    variance = {
      angleOffset: (Math.random() * 2 - 1) * ROUTE_BREAK_ANGLE_JITTER,
      stemDrift: (Math.random() * 2 - 1) * routeStemDrift * maxSpeed,
    };
    catcherRouteVariance.set(player, variance);
  }
  return variance;
}

function getImprovisedVelocity(
  receiver: Player,
  currentLoc: Vector,
  LOS: number,
  incomingVelX: number,
  incomingVelY: number,
  currentSpeed: number,
): { velX: number; velY: number; angleRad: number } {
  const { maxX, minY, maxY } = getFieldBounds();
  const hitTop = currentLoc.y <= minY;
  const hitBottom = currentLoc.y >= maxY;
  const hitLeft = currentLoc.x <= LOS;
  const hitRight = currentLoc.x >= maxX;

  let angleRad =
    receiver.improvAngleRad ?? Math.atan2(incomingVelY, incomingVelX);

  const SPREAD = 35 * (Math.PI / 180); // Slightly narrowed to prevent spinning back into the same wall
  const randomJitter = (Math.random() * 2 - 1) * SPREAD;

  // 1. CORNER DETECTIONS (Highest Priority Overrides)
  if (hitRight && hitTop) {
    // Back-Right Corner -> Escape diagonally down and left (135 degrees)
    angleRad = (135 * Math.PI) / 180 + randomJitter * 0.5;
  } else if (hitRight && hitBottom) {
    // Front-Right Corner -> Escape diagonally up and left (-135 degrees)
    angleRad = (-135 * Math.PI) / 180 + randomJitter * 0.5;
  } else if (hitLeft && hitTop) {
    // Back-Left Corner -> Escape diagonally down and right (45 degrees)
    angleRad = (45 * Math.PI) / 180 + randomJitter * 0.5;
  } else if (hitLeft && hitBottom) {
    // Front-Left Corner -> Escape diagonally up and right (-45 degrees)
    angleRad = (-45 * Math.PI) / 180 + randomJitter * 0.5;
  }
  // 2. STANDARD WALL DETECTIONS
  else if (hitRight) {
    angleRad = Math.PI + randomJitter; // back toward left
  } else if (hitLeft) {
    angleRad = 0 + randomJitter; // back toward right
  } else if (hitBottom) {
    angleRad = -Math.PI / 2 + randomJitter; // back toward top
  } else if (hitTop) {
    angleRad = Math.PI / 2 + randomJitter; // back toward bottom
  }

  return {
    velX: Math.cos(angleRad) * currentSpeed,
    velY: Math.sin(angleRad) * currentSpeed,
    angleRad,
  };
}

export function predictReceiverRoute(
  receiver: Player,
  state: State,
): { timeline: Vector[]; ticksUntilBreak: number } {
  if (!receiver.route) return { timeline: [], ticksUntilBreak: 0 };

  const receiverTimeline: Vector[] = [];
  let currentSimulatedLoc = { ...receiver.loc };

  let simulatedBreakTick = receiver.breakTick;
  let simulatedSideMultiplier = receiver.routeSideMultiplier;
  let simulatedImprovAngle = receiver.improvAngleRad; // Track the heading look-ahead

  for (let tick = 1; tick <= MAX_PREDICTION_TICKS; tick++) {
    const absoluteTick = state.steps + tick;

    const res = getReceiverVelocityAtTick(receiver, state, {
      absoluteTick: absoluteTick,
      currentLocX: currentSimulatedLoc.x,
      currentLocY: currentSimulatedLoc.y,
      routeSideMultiplier: simulatedSideMultiplier,
      breakTick: simulatedBreakTick,
      improvAngleRad: simulatedImprovAngle, // Persist across timeline iterations
    });

    if (res.improvAngleRad !== null && simulatedImprovAngle === null) {
      simulatedImprovAngle = res.improvAngleRad; // Lock simulation angle
    }

    if (
      res.isBreaking &&
      (simulatedBreakTick === undefined || simulatedBreakTick === null)
    ) {
      simulatedBreakTick = absoluteTick;
      simulatedSideMultiplier = res.sideMultiplier;
    }

    currentSimulatedLoc.x += res.velX;
    currentSimulatedLoc.y += res.velY;

    const clampedLoc = clampPosInBounds(currentSimulatedLoc);
    receiverTimeline.push({ ...clampedLoc });
  }

  return {
    timeline: receiverTimeline,
    ticksUntilBreak: (simulatedBreakTick ?? state.steps) - state.steps,
  };
}

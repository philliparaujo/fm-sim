import { BROKEN_TACKLE_SPEED_BURST } from "../core/constants";
import { getConstants } from "../core/ratings";
import { CachedPlayers, Player, Ray, State, Vector } from "../core/types";
import { MAX_PATH_LENGTH } from "../utils/behavior";
import { isCarryingBall, snapBallToPlayer } from "../utils/field";
import { lerp } from "../utils/math";
import { FIELD_SCALE, H } from "../utils/units";
import { diff, length } from "../utils/vector";

function getContextSteering(
  player: Player,
  baseIntent: Vector,
  cachedPlayers: CachedPlayers,
): Vector {
  const { lookAhead } = getConstants("VISION", player);

  const NUM_RAYS = 64;
  const rays: Ray[] = [];

  // 1. Initialize rays and map baseline downfield Interest
  const intentLen = length(baseIntent) || 1;
  const normIntent = {
    x: baseIntent.x / intentLen,
    y: baseIntent.y / intentLen,
  };

  for (let i = 0; i < NUM_RAYS; i++) {
    const angle = (i / NUM_RAYS) * Math.PI * 2;
    const rayDir = { x: Math.cos(angle), y: Math.sin(angle) };

    // Baseline interest aligns with general heading towards endzone
    let interest = rayDir.x * normIntent.x + rayDir.y * normIntent.y;

    // Severely penalize running backwards toward our own endzone
    if (rayDir.x < -0.2) {
      interest *= 0.1;
    }
    // Give a minor acceleration bias for pushing straight downfield
    if (rayDir.x > 0.1) {
      interest += 0.2;
    }

    rays.push({
      dir: rayDir,
      interest: Math.max(0, interest),
      danger: 0,
      score: 0,
    });
  }

  // 2. Project Danger weights from defenders inside lookup distance
  const checkDefender = (defender: Player) => {
    const toDef = diff(defender.loc, player.loc);
    const distance = length(toDef);
    if (distance < lookAhead && distance > 0) {
      const normToDef = { x: toDef.x / distance, y: toDef.y / distance };
      const proximity = (lookAhead - distance) / lookAhead;
      const urgency = Math.pow(proximity, 2);

      for (const ray of rays) {
        const dot = ray.dir.x * normToDef.x + ray.dir.y * normToDef.y;
        if (dot > 0) ray.danger += Math.pow(dot, 3) * urgency * 3.5;
      }
    }
  };

  for (const r of cachedPlayers.rushers) checkDefender(r);
  for (const c of cachedPlayers.coverers) checkDefender(c);

  // 3. Keep runner inside field geometry bounds (Sideline Danger mitigation)
  const SIDELINE_CUSHION = 110 * FIELD_SCALE;
  if (player.loc.y < SIDELINE_CUSHION) {
    const scale = (SIDELINE_CUSHION - player.loc.y) / SIDELINE_CUSHION;
    for (const ray of rays) {
      if (ray.dir.y < 0) {
        ray.danger += Math.abs(ray.dir.y) * scale * 3.0;
      }
    }
  } else if (player.loc.y > H - SIDELINE_CUSHION) {
    const scale = (player.loc.y - (H - SIDELINE_CUSHION)) / SIDELINE_CUSHION;
    for (const ray of rays) {
      if (ray.dir.y > 0) {
        ray.danger += ray.dir.y * scale * 3.0;
      }
    }
  }

  // 4. Subtract danger from interest and select the winning vector
  let bestRay = rays[0];
  let maxScore = -Infinity;

  for (const ray of rays) {
    ray.score = ray.interest - ray.danger;
    if (ray.score > maxScore) {
      maxScore = ray.score;
      bestRay = ray;
    }
  }

  // Attach metadata dynamically to player object for render visualization
  player.contextRays = rays;
  player.chosenRayDir = bestRay.dir;

  return bestRay.dir;
}

function runTowardsEndzone(
  player: Player,
  state: State,
  cachedPlayers: CachedPlayers,
  targetDir: Vector = { x: 1.0, y: 0 },
) {
  const { maxSpeed } = getConstants("SPEED", player);
  const { catchSlowdownDuration, minCatchSpeedMultiplier } = getConstants(
    "CATCHACCELERATION",
    player,
  );

  // CRITICAL PATH FIX: Push a DEEP COPY of player position coordinates.
  // Pushing 'player.loc' passes an object reference, causing every point in the history
  // array to match current coordinates simultaneously, which blanks out the line!
  if (!player.path) player.path = [];
  player.path.push({ x: player.loc.x, y: player.loc.y });
  if (player.path.length > MAX_PATH_LENGTH) player.path.shift();

  // 1. OVERRIDE TARGET DIRECTION VIA CONTEXT STEERING MAP
  const optimizedTargetDir = getContextSteering(
    player,
    targetDir,
    cachedPlayers,
  );

  // 2. PRESERVE POST-CATCH SLOWDOWN MECHANICS
  const ticksSinceCatch = state.steps - state.ballGivenAtStep;
  let currentSpeed = maxSpeed;
  if (
    ticksSinceCatch < catchSlowdownDuration &&
    isCarryingBall(player, state.ball)
  ) {
    const progress = ticksSinceCatch / catchSlowdownDuration;
    const multiplier = lerp(progress, minCatchSpeedMultiplier, 1);
    currentSpeed *= multiplier;
  }

  // 3. PRESERVE BROKEN TACKLE SPEED BURSTS
  if (player.burstTicks && player.burstTicks > 0) {
    currentSpeed *= BROKEN_TACKLE_SPEED_BURST;
    player.burstTicks--;
  }

  // 4. SMOOTH PHYSICS MODEL STEERING
  const choiceDiscrepancy = Math.abs(
    Math.atan2(optimizedTargetDir.y, optimizedTargetDir.x) -
      Math.atan2(targetDir.y, targetDir.x),
  );
  const dynamicSteerFactor = choiceDiscrepancy > 0.2 ? 3.5 : 1;

  const d = length(optimizedTargetDir);
  if (d > 0) {
    // Both axes utilize the correct optimized context steering elements
    const targetVelX = (optimizedTargetDir.x / d) * currentSpeed;
    const targetVelY = (optimizedTargetDir.y / d) * currentSpeed;

    player.vel.x += (targetVelX - player.vel.x) * dynamicSteerFactor;
    player.vel.y += (targetVelY - player.vel.y) * dynamicSteerFactor;
  }

  // 5. SYNC BALL POSITION TO CARRIER
  if (isCarryingBall(player, state.ball)) {
    snapBallToPlayer(player, state.ball);
  }
}

function runTowardsBall(
  player: Player,
  state: State,
  _cachedPlayers: CachedPlayers,
  ball: Vector,
) {
  // Defenders need a reaction window before breaking on a thrown ball. Until
  // their coverage-based delay elapses, they hold their current heading rather
  // than converging on the landing spot.
  if (player.role === "coverer" && state.ballFlight?.isInFlight) {
    const { reactionDelay } = getConstants("MANCOVERAGE", player);
    const { zoneReactionDelay } = getConstants("ZONECOVERAGE", player);
    const ballReactionDelay =
      player.coverage === "man" ? reactionDelay : zoneReactionDelay;
    if (state.ballFlight.ticksElapsed < ballReactionDelay) return;
  }

  const { maxSpeed } = getConstants("SPEED", player);
  const toBall = diff(ball, player.loc);
  const d = length(toBall);
  player.vel.x = (toBall.x / d) * maxSpeed;
  player.vel.y = (toBall.y / d) * maxSpeed;

  if (!state.ballGiven && player.role === "catcher") {
    if (!player.path) player.path = [];
    player.path.push({ x: player.loc.x, y: player.loc.y });
    if (player.path.length > MAX_PATH_LENGTH) player.path.shift();
  }
}

export { runTowardsBall, runTowardsEndzone };

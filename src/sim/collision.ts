import { attemptTackle } from "../behavior/tackle";
import { INLINE_NUDGE } from "../core/constants";
import { getConstants } from "../core/ratings";
import { state } from "../core/state";
import { Ball, Entity, Player } from "../core/types";
import { resetSimulation } from "../simulate";
import {
  isCarryingBall,
  isPassPlay,
  isRunPlay,
  snapBallToPlayer,
} from "../utils/field";
import { diff, length } from "../utils/vector";

function ballCollideBehavior(player: Player) {
  switch (player.role) {
    case "blocker": {
      // If blocker collides with ball, simulation ends
      // resetSimulation("sack");
      break;
    }
    case "rusher": {
      // If rusher collides with ball, simulation ends
      if (!state.ballFlight?.isInFlight) {
        resetSimulation("sack");
      }
      break;
    }
    case "runner": {
      // If runner collides with ball on running play, runner carries ball
      if (isPassPlay(state) && !state.ballGiven) return;

      snapBallToPlayer(player, state.ball);
      break;
    }
    case "catcher": {
      // If catcher collides with ball, catcher carries ball
      snapBallToPlayer(player, state.ball);
      break;
    }
    case "coverer": {
      // If coverer collides with ball, simulation ends (turnover)
      resetSimulation("interception");
      break;
    }
    case "passer": {
      // If passer collides with ball, passer holds it
      if (!state.ballGiven) {
        snapBallToPlayer(player, state.ball);
      }
      break;
    }
  }
}

// Slow down player's velocity (when in contact with blocker)
function applyDamping(player: Player, factor: number, jitter: number) {
  // 1. Damping (Multiplicative): Slows the existing movement
  player.vel.x *= factor + (Math.random() * 2 - 1) * jitter;
  player.vel.y *= factor + (Math.random() * 2 - 1) * jitter;

  // 2. Jitter (Additive): Forces movement even if the axis was 0
  // This allows players to "slip" sideways during a head-on engagement
  player.vel.x += (Math.random() * 2 - 1) * jitter;
  player.vel.y += (Math.random() * 2 - 1) * jitter;
}

function resolveCollision(a: Player, b: Entity) {
  const toB = diff(b.loc, a.loc);
  const distance = length(toB);
  const aRadius = getConstants("SIZE", a).radius;
  const bRadius =
    b.type === "ball"
      ? (b as Ball).radius
      : getConstants("SIZE", b as Player).radius;
  const minDistance = aRadius + bRadius;

  if (distance < minDistance) {
    if (b.type === "ball") {
      if (isCarryingBall(a, b as Ball)) {
        ballCollideBehavior(a);
      }
    } else if (b.type === "player") {
      const playerB = b as Player;

      const blocker =
        a.role === "blocker" ? a : playerB.role === "blocker" ? playerB : null;
      const passer =
        a.role === "passer" ? a : playerB.role === "passer" ? playerB : null;
      const runner =
        a.role === "runner" ? a : playerB.role === "runner" ? playerB : null;

      const defender =
        a.role === "rusher" || a.role === "coverer"
          ? a
          : playerB.role === "rusher" || playerB.role === "coverer"
            ? playerB
            : null;

      const carrier = isCarryingBall(a, state.ball)
        ? a
        : isCarryingBall(playerB, state.ball)
          ? playerB
          : null;

      // ==========================================
      // NEW: RUN DEFENSE BLOCK-SHEDDING ENGINE
      // ==========================================
      if (blocker && defender) {
        // If the defender is currently in a successful shed burst, bypass block penalties entirely
        if (defender.shedImmunityTicks > 0) {
          defender.shedImmunityTicks--;
          return; // Skip standard collision/damping so they can run free
        }

        if (defender.shedCooldown > 0) {
          defender.shedCooldown--;
        }

        // Only roll for a shed if they are actively colliding and not on cooldown
        if (defender.shedCooldown === 0) {
          // Fetch raw ratings from 0.0 to 1.0
          // const shedderRating = defender.ratings?.blockShedding ?? 0.5;
          // const blockerRating = blocker.ratings?.RUNBLOCK ?? 0.5;
          const shedderRating = getConstants(
            "BLOCKSHEDDING",
            defender,
          ).blockShed;
          const blockerRating = isPassPlay(state)
            ? getConstants("PASSBLOCK", blocker).antiBlockShed
            : getConstants("RUNBLOCK", blocker).antiBlockShed;

          // Per-tick base probability (~2% chance per tick baseline at 60 FPS)
          const BASE_SHED_CHANCE = 0.006;
          // Scale chance: high block-shedding vs low run-blocking increases the odds drastically
          const shedChance =
            BASE_SHED_CHANCE * (shedderRating / Math.max(0.1, blockerRating));

          if (Math.random() < shedChance) {
            // SUCCESSFUL SHED!
            defender.shedImmunityTicks = 10; // 20 ticks (~0.33s) of block immunity
            defender.shedCooldown = 90; // Cooldown before getting locked in another block

            // PHYSICAL BYPASS NUDGE: Teleport the defender slightly past the blocker toward the ball
            const toBall = diff(state.ball.loc, defender.loc);
            const ballDist = length(toBall);
            if (ballDist > 0) {
              // Nudge them 25 pixels toward the ball to clear the blocker's bounding circle immediately
              defender.loc.x += (toBall.x / ballDist) * 25;
              defender.loc.y += (toBall.y / ballDist) * 25;
            }
            return; // Exit early to avoid damping this frame
          }
        }
      }

      // Initiate blocking (Standard fallback if block isn't shed)
      if (blocker && defender) {
        const { rusherDampingFactor } = getConstants("PASSBLOCK", blocker);
        const {
          runBlockDampingFactor,
          covererDampingFactor,
          runBlockPushStrength,
        } = getConstants("RUNBLOCK", blocker);
        const { randomJitter } = getConstants("BLOCKSHEDDING", defender);

        const damping =
          defender.role === "rusher"
            ? isRunPlay(state)
              ? runBlockDampingFactor
              : rusherDampingFactor
            : covererDampingFactor;

        applyDamping(defender, damping, randomJitter);

        // On run plays, good blockers drive defenders forward
        if (isRunPlay(state) && defender.role === "rusher") {
          const pushStrength =
            (1 - runBlockDampingFactor) * runBlockPushStrength;
          const blockerSpeed = length(blocker.vel);
          if (blockerSpeed > 0.1) {
            defender.vel.x += (blocker.vel.x / blockerSpeed) * pushStrength;
            defender.vel.y += (blocker.vel.y / blockerSpeed) * pushStrength;
          }
        }
      }

      // Initiate tackle attempt
      if (defender && carrier) {
        if (
          carrier.role !== "passer" &&
          state.playAdvanced.firstContactX === undefined
        ) {
          state.playAdvanced.firstContactX = carrier.loc.x;
        }
        attemptTackle(defender, carrier);
      }

      // Initiate handoff
      if (passer && runner && isRunPlay(state) && !state.ballGiven) {
        state.ball.loc.x = runner.loc.x;
        state.ball.loc.y = runner.loc.y;
        state.ballGiven = true;
      }

      // Resolve regular collision
      const overlap = minDistance - distance;
      const nx = toB.x / distance;
      const ny =
        toB.y / distance + (Math.random() * INLINE_NUDGE - INLINE_NUDGE / 2);

      const moveX = nx * (overlap / 2);
      const moveY = ny * (overlap / 2);

      a.loc.x -= moveX;
      a.loc.y -= moveY;
      if (isCarryingBall(a, state.ball)) {
        state.ball.loc.x -= moveX;
        state.ball.loc.y -= moveY;
      }

      playerB.loc.x += moveX;
      playerB.loc.y += moveY;
      if (isCarryingBall(playerB, state.ball)) {
        state.ball.loc.x += moveX;
        state.ball.loc.y += moveY;
      }
    }
  }
}

export { resolveCollision };

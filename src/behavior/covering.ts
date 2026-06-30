import { ARRIVAL_RADIUS, LEAD_TICKS } from "../core/constants";
import { getConstants } from "../core/ratings";
import { CachedPlayers, Player, State, Vector } from "../core/types";
import { yardsToPx } from "../utils/units";
import { dist } from "../utils/vector";

function updateCovererPerception(player: Player, targetCatcher: Player | null) {
  if (targetCatcher) {
    player.perceivedVel = { ...targetCatcher.vel };
    player.perceivedLoc = { ...targetCatcher.loc };
  } else {
    player.perceivedLoc = { ...player.loc };
    player.perceivedVel = { x: 0, y: 0 };
  }
}

function cover(player: Player, state: State, cachedPlayers: CachedPlayers) {
  const { maxSpeed } = getConstants("SPEED", player);
  const { manStartDelay, reactionDelay, manCushion } = getConstants(
    "MANCOVERAGE",
    player,
  );
  const { zonePull, zoneStartDelay } = getConstants("ZONECOVERAGE", player);

  const startDelay = player.coverage === "man" ? manStartDelay : zoneStartDelay;
  player.reactionTimer++;

  // 1. TARGET ACQUISITION
  let targetCatcher: Player | null = null;
  const catchers = cachedPlayers.catchers;

  let isDeepOverrideActive = false;
  const DEEP_THRESHOLD = state.scoreboard.LOS + yardsToPx(30); // 30 yards past LOS

  if (player.coverage === "man") {
    targetCatcher = catchers.find((p) => p === player.assignedTarget) || null;
  } else if (catchers.length > 0) {
    const deepThreats = catchers.filter((c) => c.loc.x > DEEP_THRESHOLD);

    if (deepThreats.length > 0) {
      // Someone is deeper than 30 yards -> Target the absolute deepest receiver
      targetCatcher = deepThreats.reduce((deepest, current) =>
        current.loc.x > deepest.loc.x ? current : deepest,
      );
      isDeepOverrideActive = true;
    } else {
      // Nobody past 30 yards -> Target the nearest receiver to the zone anchor point
      const anchor = player.zone ?? player.loc;
      targetCatcher = catchers.reduce((closest, current) =>
        dist(anchor, current.loc) < dist(anchor, closest.loc)
          ? current
          : closest,
      );
    }
  }

  // 2. PERCEPTION DELAY
  if (player.perceivedLoc === null || player.reactionTimer >= reactionDelay) {
    if (player.reactionTimer < startDelay && player.perceivedLoc === null)
      return;
    updateCovererPerception(player, targetCatcher);
    player.reactionTimer = 0;
  }

  // 3. EXTRAPOLATION
  const baseLoc = player.perceivedLoc ?? targetCatcher?.loc ?? player.loc;
  const baseVel = player.perceivedVel ?? targetCatcher?.vel ?? { x: 0, y: 0 };
  const extrapolatedLoc = {
    x: baseLoc.x + baseVel.x * player.reactionTimer,
    y: baseLoc.y + baseVel.y * player.reactionTimer,
  };

  // 4. POSITION TARGETING & CONSERVATIVE OVERRIDE
  let targetPoint: Vector = player.zone ?? { ...player.loc };

  if (targetCatcher) {
    if (player.coverage === "man") {
      // Left exactly the same as requested
      const toBallX = state.ball.loc.x - extrapolatedLoc.x;
      const toBallY = state.ball.loc.y - extrapolatedLoc.y;
      const toBallDist = Math.sqrt(toBallX * toBallX + toBallY * toBallY) || 1;
      targetPoint = {
        x:
          extrapolatedLoc.x +
          (toBallX / toBallDist) * manCushion +
          baseVel.x * LEAD_TICKS,
        y:
          extrapolatedLoc.y +
          (toBallY / toBallDist) * manCushion +
          baseVel.y * LEAD_TICKS,
      };
    } else {
      // ZONE COVERAGE ENHANCEMENT:
      // If the targeted catcher has a predicted throw location, blend their
      // extrapolated position with the throw target so the defender undercuts or fields the ball path.
      let coverageFocusX = extrapolatedLoc.x;
      let coverageFocusY = extrapolatedLoc.y;

      if (
        targetCatcher.predictedTargets !== null &&
        targetCatcher.predictedTargets.length > 0
      ) {
        const target =
          targetCatcher.predictedTargets[
            Math.floor(targetCatcher.predictedTargets.length / 2)
          ];
        // Shift focus halfway towards the anticipated throw spot to cheat toward the target
        coverageFocusX = (coverageFocusX + target.x) / 2;
        coverageFocusY = (coverageFocusY + target.y) / 2;
      }

      if (isDeepOverrideActive) {
        // EXTRA CONSERVATIVE DEEP ZONE MODE:
        // Position downfield/in front of the anticipated pass focus zone by a protective cushion
        const CONSERVATIVE_CUSHION = yardsToPx(7);

        targetPoint = {
          x: coverageFocusX + CONSERVATIVE_CUSHION + baseVel.x * LEAD_TICKS,
          y: coverageFocusY + baseVel.y * LEAD_TICKS,
        };
      } else {
        // STANDARD UNDERNEATH/INTERMEDIATE ZONE MODE:
        // Pull towards the enhanced coverage tracking position relative to their zone marker
        targetPoint = {
          x:
            player.zone!.x +
            (coverageFocusX - player.zone!.x) * zonePull +
            baseVel.x * LEAD_TICKS,
          y:
            player.zone!.y +
            (coverageFocusY - player.zone!.y) * zonePull +
            baseVel.y * LEAD_TICKS,
        };
      }
    }
  }

  // 5. MOTOR/STEERING FORCES
  const d = dist(player.loc, targetPoint);
  if (d < 0.5) {
    player.vel.x = 0;
    player.vel.y = 0;
    return;
  }

  const speedScale = Math.min(1, d / ARRIVAL_RADIUS);
  const angle = Math.atan2(
    targetPoint.y - player.loc.y,
    targetPoint.x - player.loc.x,
  );
  player.vel.x = Math.cos(angle) * maxSpeed * speedScale;
  player.vel.y = Math.sin(angle) * maxSpeed * speedScale;
}

export { cover };

import { MIN_BLOCK_DISTANCE } from "../core/constants";
import { getConstants } from "../core/ratings";
import { CachedPlayers, Player, State, Vector } from "../core/types";
import { isPassPlay } from "../utils/field";
import { FIELD_SCALE, H } from "../utils/units";
import { closestPointOnSegment, diff, dist, length } from "../utils/vector";

function blockNearestDefender(
  player: Player,
  state: State,
  cachedPlayers: CachedPlayers,
) {
  const { maxSpeed } = getConstants("SPEED", player);

  // 1. Identify valid targets based on dynamic engine assignments
  const assignedDefender = state.blockingAssignments.get(player);

  // Pass-blocking runners look exclusively at rushers threatening the pocket.
  // Downfield block-shifters or linemen evaluate rushers and coverers.
  const defenders = assignedDefender
    ? [assignedDefender]
    : player.role === "runner" && isPassPlay(state)
      ? cachedPlayers.rushers
      : [...cachedPlayers.rushers, ...cachedPlayers.coverers];

  let targetLoc: Vector | null = null;

  // 2. PATH A: Passer Protection Constraints (Runners on Pass Plays)
  if (player.role === "runner" && isPassPlay(state)) {
    const passer = cachedPlayers.passer;
    const anchorLoc = passer ? passer.loc : state.ball.loc;

    // Checks if an immediate thread has breached the pocket edge
    const activeThreat =
      assignedDefender || defenders.find((d) => dist(d.loc, anchorLoc) < 180 * FIELD_SCALE);

    if (activeThreat) {
      // Intercept path to protect the pocket anchor
      let interceptPoint = closestPointOnSegment(
        player.loc,
        activeThreat.loc,
        anchorLoc,
      );

      // Enforce pocket boundary buffer
      if (dist(interceptPoint, anchorLoc) < MIN_BLOCK_DISTANCE) {
        const toDefender = diff(activeThreat.loc, anchorLoc);
        const d = length(toDefender) || 1;
        interceptPoint = {
          x: anchorLoc.x + (toDefender.x / d) * MIN_BLOCK_DISTANCE,
          y: anchorLoc.y + (toDefender.y / d) * MIN_BLOCK_DISTANCE,
        };
      }
      targetLoc = interceptPoint;
    } else {
      // POCKET SCAN POSITION: Stationed 35 pixels upfield (East) of the passer to wait for blitzers
      targetLoc = {
        x: anchorLoc.x + 35 * FIELD_SCALE,
        y: anchorLoc.y,
      };
    }

    // 3. PATH B: Downfield Sealing & Inside Leverage Logic (Catchers or Running Backs on Run Plays)
  } else if (
    (player.role === "catcher" || player.role === "runner") &&
    !isPassPlay(state)
  ) {
    // Locate the primary target to seal
    let targetDefender: Player | null = assignedDefender || null;
    if (!targetDefender) {
      let minD = Infinity;
      defenders.forEach((d) => {
        const distance = dist(player.loc, d.loc);
        if (distance < minD) {
          minD = distance;
          targetDefender = d;
        }
      });
    }

    if (targetDefender) {
      const distanceToDefender = dist(player.loc, targetDefender.loc);

      // If they haven't engaged yet, shade dynamically to seal inside paths
      if (distanceToDefender > 30 * FIELD_SCALE) {
        const fieldCenterY = H / 2;

        // Above centerline: shade DOWN (+Y). Below centerline: shade UP (-Y)
        const insideShadeDirection =
          targetDefender.loc.y < fieldCenterY ? 1 : -1;

        const UPFIELD_SEAL_X = 15 * FIELD_SCALE;
        const INSIDE_SEAL_Y = 50 * FIELD_SCALE;

        targetLoc = {
          x: targetDefender.loc.x + UPFIELD_SEAL_X,
          y: targetDefender.loc.y + insideShadeDirection * INSIDE_SEAL_Y,
        };
      } else {
        // Close quarters: snap directly to tracking them to maintain contact engagement
        targetLoc = closestPointOnSegment(
          player.loc,
          targetDefender.loc,
          state.ball.loc,
        );
      }
    }

    // 4. PATH C: Traditional Interior/Line-Blocking (Standard Linemen/Interior Blockers)
  } else {
    const potentialBlocks = defenders.map((defender) => {
      let interceptPoint = closestPointOnSegment(
        player.loc,
        defender.loc,
        state.ball.loc,
      );

      if (dist(interceptPoint, state.ball.loc) < MIN_BLOCK_DISTANCE) {
        const toDefender = diff(defender.loc, state.ball.loc);
        const d = length(toDefender) || 1;
        interceptPoint = {
          x: state.ball.loc.x + (toDefender.x / d) * MIN_BLOCK_DISTANCE,
          y: state.ball.loc.y + (toDefender.y / d) * MIN_BLOCK_DISTANCE,
        };
      }

      const distToIntercept = dist(player.loc, interceptPoint);
      const threatIndex =
        dist(defender.loc, state.ball.loc) * 0.2 + distToIntercept;

      return { interceptPoint, threatIndex };
    });

    if (potentialBlocks.length > 0) {
      potentialBlocks.sort((a, b) => a.threatIndex - b.threatIndex);
      targetLoc = potentialBlocks[0].interceptPoint;
    }
  }

  // 5. Apply velocities toward the targeted tracking coordinate
  if (targetLoc) {
    const distToTarget = dist(player.loc, targetLoc);

    if (distToTarget < 3 * FIELD_SCALE) {
      // Dead zone threshold prevents micro-jittering oscillations when set
      player.vel.x = 0;
      player.vel.y = 0;
    } else {
      const angle = Math.atan2(
        targetLoc.y - player.loc.y,
        targetLoc.x - player.loc.x,
      );
      player.vel.x = Math.cos(angle) * maxSpeed;
      player.vel.y = Math.sin(angle) * maxSpeed;
    }
  }
}

export { blockNearestDefender };

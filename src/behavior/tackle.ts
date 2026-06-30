import {
  BROKEN_TACKLE_BURST_DURATION,
  BROKEN_TACKLE_SPEED_BURST,
  TACKLE_PRESSURE_PER_TICK,
} from "../core/constants";
import { getConstants } from "../core/ratings";
import { Player } from "../core/types";
import { resetSimulation, state } from "../sim";
import { secondsToTicks } from "../utils/units";

function attemptTackle(defender: Player, carrier: Player) {
  const { carrierPower, tacklePressureThreshold } = getConstants(
    "POWER",
    carrier,
  );
  const { maxSpeed } = getConstants("SPEED", carrier);
  const { defenderTackle, tackleAttemptChance } = getConstants(
    "TACKLING",
    defender,
  );

  if (carrier.role === "passer" && !state.ballFlight?.isInFlight) {
    resetSimulation("sack");
    return;
  } else if (carrier.role === "passer") {
    return;
  }

  defender.tackleCooldownTicks = defender.tackleCooldownTicks ?? 0;
  if (defender.tackleCooldownTicks > 0) {
    defender.tackleCooldownTicks--;
    return;
  }

  // Attrition pressure accumulates on contact
  carrier.contactedThisTick = true;
  carrier.tacklePressure =
    (carrier.tacklePressure ?? 0) + TACKLE_PRESSURE_PER_TICK;

  if (carrier.tacklePressure >= tacklePressureThreshold) {
    resetSimulation("tackle");
    return;
  }

  // 2. Calculate the Approach Angle Factor
  let angleModifier = 1.0; // Default baseline (side tackle)

  const carrierMag = Math.sqrt(carrier.vel.x ** 2 + carrier.vel.y ** 2);
  if (carrierMag > 0) {
    // Normalized heading vector of the ball carrier
    const carrierHeading = {
      x: carrier.vel.x / carrierMag,
      y: carrier.vel.y / carrierMag,
    };

    // Vector pointing from the carrier to the defender, then normalized
    const toDefender = {
      x: defender.loc.x - carrier.loc.x,
      y: defender.loc.y - carrier.loc.y,
    };
    const distToDefender = Math.sqrt(toDefender.x ** 2 + toDefender.y ** 2);

    if (distToDefender > 0) {
      const dirToDefender = {
        x: toDefender.x / distToDefender,
        y: toDefender.y / distToDefender,
      };

      // Dot Product: 1 = Head-on, -1 = From Behind, 0 = Directly from the side
      const approachDot =
        carrierHeading.x * dirToDefender.x + carrierHeading.y * dirToDefender.y;

      if (approachDot > 0) {
        // HEAD-ON: Linearly scale up tackle effectiveness up to +25%
        // An approachDot of 1.0 means maximum leverage
        angleModifier = 1.0 + approachDot * 0.25;
      } else {
        // FROM BEHIND: Linearly scale down tackle effectiveness by up to -40%
        // An approachDot of -1.0 means trailing directly behind the heels
        angleModifier = 1.0 + approachDot * 0.4;
      }
    }
  }

  // 3. Roll for the Distinct Tackle Attempt
  if (Math.random() < tackleAttemptChance) {
    // Apply the angle modifier directly to the defender's physical rolling strength
    const adjustedDefenderTackle = defenderTackle * angleModifier;
    const tackleChance =
      adjustedDefenderTackle / (adjustedDefenderTackle + carrierPower);

    if (Math.random() < tackleChance) {
      resetSimulation("tackle");
    } else {
      // Broken tackle logic
      carrier.tacklePressure = 0;
      carrier.burstTicks = BROKEN_TACKLE_BURST_DURATION;
      carrier.isBursting = true;

      if (carrierMag > 0) {
        carrier.vel.x =
          (carrier.vel.x / carrierMag) * maxSpeed * BROKEN_TACKLE_SPEED_BURST;
        carrier.vel.y =
          (carrier.vel.y / carrierMag) * maxSpeed * BROKEN_TACKLE_SPEED_BURST;
      }

      defender.tackleCooldownTicks = secondsToTicks(0.75); // Put defender on cooldown
    }
  }
}

export { attemptTackle };

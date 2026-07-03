import { Scoreboard, Team } from "../core/types";
import { TWO_MINUTE_WARNING_SECONDS } from "./units";

/**
 * Decides whether a team burns a timeout between plays to stop the clock.
 * Mutates the chosen team's `timeouts` and returns true if one was used.
 *
 * For now: the team with the ball in the final 2:00 of the 1st half, or the
 * trailing team in the final 2:00 of the 2nd half.
 */
export function tryUseTimeout(
  teams: Team[],
  quarter: Scoreboard["quarter"],
  time: number,
): boolean {
  if (time > TWO_MINUTE_WARNING_SECONDS) return false;

  const offense = teams.find((t) => t.possessing);
  const defense = teams.find((t) => !t.possessing);
  if (!offense || !defense) return false;

  // Final 2:00 of the 1st half: the team with the ball stops the clock
  if (quarter === "2nd") {
    if (offense.timeouts > 0) {
      offense.timeouts--;
      return true;
    }
    return false;
  }

  // Final 2:00 of the 2nd half: the trailing team stops the clock
  if (quarter === "4th") {
    const trailing =
      offense.score < defense.score
        ? offense
        : defense.score < offense.score
          ? defense
          : null;
    if (trailing && trailing.timeouts > 0) {
      trailing.timeouts--;
      return true;
    }
  }

  return false;
}

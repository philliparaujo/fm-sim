import { CachedPlayers } from "../core/types";
import { state } from ".";
import { isCarryingBall, isRunPlay } from "../utils/field";
import { closestPointOnSegment, dist, vectorToString } from "../utils/vector";

function assignCoverageTargets() {
  const catchers = [...state.players].filter((p) => p.role === "catcher");
  // Only deal with defenders assigned to "man"
  const manCoverers = state.players.filter(
    (p) => p.role === "coverer" && p.coverage === "man",
  );
  const zoneCoverers = state.players.filter(
    (p) => p.role === "coverer" && p.coverage === "zone",
  );

  // 1. Sort both by Y-coordinate so assignments are "parallel" (top-to-bottom)
  manCoverers.sort((a, b) => a.loc.y - b.loc.y);
  // We don't sort the main catchers array to keep IDs consistent, but we sort a reference list
  const catchersByY = [...catchers].sort((a, b) => a.loc.y - b.loc.y);

  const assignedCatcherIds = new Set<string>(); // Use a unique ID or reference

  // 2. Assign primary man coverage
  manCoverers.forEach((coverer) => {
    // Find the closest catcher that hasn't been claimed yet
    const available = catchersByY.filter(
      (c) => !assignedCatcherIds.has(vectorToString(c.loc)),
    );

    if (available.length > 0) {
      // Find the one closest to the coverer's current Y-level
      available.sort(
        (a, b) =>
          Math.abs(a.loc.y - coverer.loc.y) - Math.abs(b.loc.y - coverer.loc.y),
      );

      const target = available[0];
      coverer.assignedTarget = target;
      assignedCatcherIds.add(vectorToString(target.loc));
    } else {
      // 3. DOUBLE UP: If no unassigned catchers left, find the closest catcher overall
      // This creates "Double Coverage" on the most dangerous/closest threat
      const closestOverall = [...catchers].sort(
        (a, b) => dist(coverer.loc, a.loc) - dist(coverer.loc, b.loc),
      )[0];

      coverer.assignedTarget = closestOverall || null;
    }
  });

  // 4. Initialize Zone Centers
  zoneCoverers.forEach((coverer) => {
    coverer.assignedTarget = null;
    coverer.zone = { ...coverer.loc };
  });
}

function assignBlockingTargets(cachedPlayers: CachedPlayers) {
  // --- Step 1: Assign OL blockers to rushers (1-on-1, no double teams) ---
  const olBlockers = cachedPlayers.blockers;
  const rushers = cachedPlayers.rushers;

  // Release stale OL assignments
  for (const [blocker, defender] of state.blockingAssignments) {
    if (blocker.role === "blocker" && dist(blocker.loc, defender.loc) > 80) {
      state.blockingAssignments.delete(blocker);
    }
  }

  const assignedRushers = new Set(
    [...state.blockingAssignments.entries()]
      .filter(([blocker]) => blocker.role !== "runner")
      .map(([, defender]) => defender),
  );
  const freeRushers = rushers.filter((r) => !assignedRushers.has(r));
  const freeOL = olBlockers.filter((b) => !state.blockingAssignments.has(b));

  freeRushers.sort(
    (a, b) => dist(a.loc, state.ball.loc) - dist(b.loc, state.ball.loc),
  );

  for (const rusher of freeRushers) {
    if (freeOL.length === 0) break;
    freeOL.sort(
      (a, b) =>
        dist(a.loc, closestPointOnSegment(a.loc, rusher.loc, state.ball.loc)) -
        dist(b.loc, closestPointOnSegment(b.loc, rusher.loc, state.ball.loc)),
    );
    const assigned = freeOL.shift()!;
    state.blockingAssignments.set(assigned, rusher);
  }

  // --- Step 2: Assign runner ---
  const runner = state.players.find((p) => p.role === "runner");
  if (runner && !isCarryingBall(runner, state.ball)) {
    const runnerAssignment = state.blockingAssignments.get(runner);
    if (runnerAssignment && dist(runner.loc, runnerAssignment.loc) > 200) {
      state.blockingAssignments.delete(runner);
    }
    if (!state.blockingAssignments.has(runner)) {
      if (!isRunPlay(state)) {
        // First, check for any free rusher not already covered by OL
        const allAssignedRushers = new Set(state.blockingAssignments.values());
        const freeRusher = rushers
          .filter((r) => !allAssignedRushers.has(r))
          .sort(
            (a, b) => dist(a.loc, state.ball.loc) - dist(b.loc, state.ball.loc),
          )[0];

        // Fall back to double-teaming the most dangerous rusher
        const target =
          freeRusher ??
          rushers.sort(
            (a, b) => dist(a.loc, state.ball.loc) - dist(b.loc, state.ball.loc),
          )[0];

        if (target) {
          state.blockingAssignments.set(runner, target);
        }
      }
    }
  }

  // --- Step 3: On run plays, assign catchers to their man coverer ---
  if (isRunPlay(state)) {
    const catchers = cachedPlayers.catchers.filter(
      (p) => !isCarryingBall(p, state.ball),
    );

    // Release stale catcher assignments
    for (const catcher of catchers) {
      const assignment = state.blockingAssignments.get(catcher);
      if (assignment && dist(catcher.loc, assignment.loc) > 120) {
        state.blockingAssignments.delete(catcher);
      }
    }

    for (const coverer of state.players) {
      if (coverer.role !== "coverer" || !coverer.assignedTarget) continue;
      const catcher = catchers.find((c) => c === coverer.assignedTarget);
      if (catcher && !state.blockingAssignments.has(catcher)) {
        state.blockingAssignments.set(catcher, coverer);
      }
    }
  }
}

export { assignBlockingTargets, assignCoverageTargets };

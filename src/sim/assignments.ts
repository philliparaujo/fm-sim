import { CachedPlayers } from "../core/types";
import { state } from ".";
import { isCarryingBall, isRunPlay } from "../utils/field";
import { closestPointOnSegment, dist } from "../utils/vector";

// Fixed positional matchups: CB covers XR, NB covers ZR, LB covers TE
const MAN_MATCHUP: Record<string, string> = { CB: "XR", NB: "ZR", LB: "TE" };

function assignCoverageTargets() {
  const catchers = [...state.players].filter((p) => p.role === "catcher");
  const manCoverers = state.players.filter(
    (p) => p.role === "coverer" && p.coverage === "man",
  );
  const zoneCoverers = state.players.filter(
    (p) => p.role === "coverer" && p.coverage === "zone",
  );

  const assignedCatchers = new Set<(typeof catchers)[number]>();

  // 1. Primary: label-based matchups (CB→XR, NB→ZR, LB→TE)
  for (const coverer of manCoverers) {
    const preferredLabel = MAN_MATCHUP[coverer.label];
    if (preferredLabel) {
      const target = catchers.find((c) => c.label === preferredLabel);
      if (target) {
        coverer.assignedTarget = target;
        assignedCatchers.add(target);
        continue;
      }
    }
    coverer.assignedTarget = null; // cleared for fallback pass
  }

  // 2. Fallback: proximity-based for unmatched coverers (e.g. SS in man blitz)
  for (const coverer of manCoverers) {
    if (coverer.assignedTarget) continue;
    const available = catchers.filter((c) => !assignedCatchers.has(c));
    const pool = available.length > 0 ? available : [...catchers];
    const target = pool.sort(
      (a, b) => Math.abs(a.loc.y - coverer.loc.y) - Math.abs(b.loc.y - coverer.loc.y),
    )[0];
    if (target) {
      coverer.assignedTarget = target;
      assignedCatchers.add(target);
    }
  }

  // 3. Initialize Zone Centers
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

  // --- Step 3: On run plays, assign catchers to block their coverage defender ---
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

    // Man coverage: assign the catcher to block their assigned man defender
    for (const coverer of state.players) {
      if (coverer.role !== "coverer" || !coverer.assignedTarget) continue;
      const catcher = catchers.find((c) => c === coverer.assignedTarget);
      if (catcher && !state.blockingAssignments.has(catcher)) {
        state.blockingAssignments.set(catcher, coverer);
      }
    }

    // Zone coverage: assign each unblocked catcher to the nearest zone coverer
    const zoneCoverers = state.players.filter(
      (p) => p.role === "coverer" && p.coverage === "zone",
    );
    const assignedZoneDefenders = new Set<(typeof zoneCoverers)[number]>();
    for (const catcher of catchers) {
      if (state.blockingAssignments.has(catcher)) continue;
      if (zoneCoverers.length === 0) break;
      const available = zoneCoverers.filter((d) => !assignedZoneDefenders.has(d));
      const pool = available.length > 0 ? available : zoneCoverers;
      const nearest = [...pool].sort(
        (a, b) => dist(a.loc, catcher.loc) - dist(b.loc, catcher.loc),
      )[0];
      state.blockingAssignments.set(catcher, nearest);
      assignedZoneDefenders.add(nearest);
    }
  }
}

export { assignBlockingTargets, assignCoverageTargets };

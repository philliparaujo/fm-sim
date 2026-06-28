import { Stats } from "../core/types";

/** Returns the count of non-special teams plays */
export function numPlays(stats: Stats): number {
  return (
    stats.coverage.man.count +
    stats.coverage.manBlitz.count +
    stats.coverage.zone.count +
    stats.coverage.zoneBlitz.count
  );
}

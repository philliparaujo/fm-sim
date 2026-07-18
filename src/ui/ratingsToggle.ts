import {
  getOvrDisplayFlags,
  OvrDisplayKey,
  setOvrDisplayFlag,
} from "./displayMode";
import { rerenderDraft } from "./draft";
import { rerenderSchedule } from "./schedule";
import { rerenderStats } from "./stats";
import { rerenderTraining } from "./training";

/** Checkbox element IDs, left to right matching the fixed display order
 * (rating, rank, percentile) — see displayMode.ts's formatOvr. */
const CHECKBOX_IDS: Record<OvrDisplayKey, string> = {
  rating: "gbb-ovr-rating",
  rank: "gbb-ovr-rank",
  percentile: "gbb-ovr-percentile",
};

function rerenderAll() {
  rerenderDraft();
  rerenderSchedule();
  rerenderStats();
  rerenderTraining();
}

export function setupRatingsToggle() {
  const flags = getOvrDisplayFlags();
  for (const key of Object.keys(CHECKBOX_IDS) as OvrDisplayKey[]) {
    const cb = document.getElementById(CHECKBOX_IDS[key]) as HTMLInputElement | null;
    if (!cb) continue;
    cb.checked = flags[key];
    cb.addEventListener("change", () => {
      const applied = setOvrDisplayFlag(key, cb.checked);
      if (!applied) {
        // Refused: this was the last checked box — at least one metric must
        // always stay visible, so snap it back to checked.
        cb.checked = true;
        return;
      }
      rerenderAll();
    });
  }
}

import { tick } from "./simulate";

async function init() {
  console.log("Hello TypeScript");
  requestAnimationFrame(tick);
}

window.onload = init;

import { tick } from "./render";

async function init() {
  console.log("Hello TypeScript");
}

window.onload = init;
tick();

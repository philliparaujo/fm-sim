import { resetGame } from "../sim";

/** Wires the top-of-screen button that restarts the game from scratch. */
export function setupResetButton() {
  const btn = document.getElementById("btn-reset-game");
  btn?.addEventListener("click", resetGame);
}

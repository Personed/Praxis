import { createDoomInputController } from "./input-controller";
import { loadDoomRuntime } from "./runtime";
import type { DoomRuntime } from "./types";
import "./game-frame.css";

const host = document.getElementById("game")!;
const poster = document.getElementById("poster")!;
const status = document.getElementById("status")!;
const lifecycle = new AbortController();
let runtime: DoomRuntime | undefined;
let pending = false;
const notify = (state: string) => parent.postMessage({ type: "modus-doom", state }, "*");
const showError = (message: string) => {
  status.textContent = message;
  status.hidden = false;
  notify("error");
};
const input = createDoomInputController({
  host,
  returnFocus: () => notify("focus-composer"),
  onError: showError,
  onStatus(state) {
    status.hidden = state === "playing";
    if (state !== "playing") status.textContent = "Clique para continuar · Esc para liberar";
    notify(state);
  },
});

function activate(): void {
  if (lifecycle.signal.aborted) return;
  host.focus({ preventScroll: true });
  input.activateFromGesture();
  if (runtime || pending) return;
  pending = true;
  status.textContent = "Carregando DOOM…";
  status.hidden = false;
  void loadDoomRuntime(host, lifecycle.signal, (message) => {
    input.suspend();
    runtime = undefined;
    poster.hidden = false;
    showError(message);
  })
    .then((game) => {
      if (lifecycle.signal.aborted) {
        void game.dispose();
        return;
      }
      runtime = game;
      poster.hidden = true;
      input.attachRuntime(game);
    })
    .catch((error: unknown) => {
      if (lifecycle.signal.aborted) return;
      input.suspend();
      showError(error instanceof Error ? error.message : "Não foi possível iniciar o DOOM.");
    })
    .finally(() => {
      pending = false;
    });
}

host.addEventListener("click", activate);
host.addEventListener("keydown", (event) => {
  if ((event.key === "Enter" || event.key === " ") && document.pointerLockElement !== host) {
    event.preventDefault();
    activate();
  }
});
window.addEventListener("message", (event) => {
  if (event.source !== parent || event.data?.type !== "modus-doom-pause") return;
  input.suspend();
});
window.addEventListener(
  "pagehide",
  () => {
    input.dispose();
    lifecycle.abort();
    void runtime?.dispose();
  },
  { once: true },
);
notify("poster");

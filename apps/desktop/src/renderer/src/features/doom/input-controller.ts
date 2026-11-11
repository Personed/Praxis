import type { DoomRuntime } from "./types.ts";

export interface DoomInputController {
  activateFromGesture(): void;
  attachRuntime(runtime: DoomRuntime): void;
  suspend(): void;
  dispose(): void;
}

const specialKeys: Record<string, number> = {
  Escape: 256,
  Enter: 257,
  Tab: 258,
  Backspace: 259,
  // Arrows are movement aliases; aiming belongs to the mouse.
  ArrowRight: 68,
  ArrowLeft: 65,
  ArrowDown: 83,
  ArrowUp: 87,
  ShiftLeft: 340,
  ShiftRight: 344,
  ControlLeft: 341,
  ControlRight: 345,
  AltLeft: 342,
  AltRight: 346,
  Space: 32,
};

function dosKey(code: string): number | undefined {
  if (specialKeys[code] !== undefined) return specialKeys[code];
  if (/^Key[A-Z]$/.test(code)) return code.charCodeAt(3);
  if (/^Digit[0-9]$/.test(code)) return code.charCodeAt(5);
  if (/^F([1-9]|1[0-2])$/.test(code)) return 289 + Number(code.slice(1));
  return undefined;
}

function physicalCode(event: KeyboardEvent): string {
  if (event.code) return event.code;
  // Some WebView2/accessibility inputs provide key but leave code empty.
  if (/^[a-z]$/i.test(event.key)) return `Key${event.key.toUpperCase()}`;
  if (/^[0-9]$/.test(event.key)) return `Digit${event.key}`;
  if (event.key === " ") return "Space";
  return (
    ({ Control: "ControlLeft", Shift: "ShiftLeft", Alt: "AltLeft" } as Record<string, string>)[
      event.key
    ] ?? event.key
  );
}

export function createDoomInputController({
  host,
  returnFocus,
  onStatus,
  onError,
  environment,
}: {
  host: HTMLElement;
  returnFocus: () => void;
  onStatus: (status: "ready" | "playing" | "paused") => void;
  onError: (message: string) => void;
  environment?: { document: Document; window: Window };
}): DoomInputController {
  const doc = environment?.document ?? document;
  const win = environment?.window ?? window;
  let runtime: DoomRuntime | undefined;
  let wanted = false;
  let disposed = false;
  let playing = false;
  let captured = false;
  const ownsLock = () => doc.pointerLockElement === host;
  const pause = () => {
    wanted = false;
    playing = false;
    runtime?.releaseInputs();
    runtime?.pause();
    if (!disposed) onStatus("paused");
  };
  const suspend = () => {
    captured = false;
    pause();
    if (ownsLock()) doc.exitPointerLock();
  };
  const resumeIfReady = () => {
    if (!disposed && wanted && ownsLock() && runtime && !playing) {
      playing = true;
      runtime.resume();
      onStatus("playing");
    }
  };
  const lockChanged = () => {
    if (ownsLock()) {
      captured = true;
      resumeIfReady();
    } else {
      const restoreFocus = captured;
      captured = false;
      pause();
      if (restoreFocus && !disposed) returnFocus();
    }
  };
  const lockError = () => {
    if (disposed) return;
    suspend();
    onError("Não foi possível capturar o mouse. Clique no DOOM para tentar novamente.");
  };
  const keyDown = (event: KeyboardEvent) => {
    if (disposed || !ownsLock()) return;
    const code = physicalCode(event);
    if (code === "Escape") {
      // Keep the native default and also release in hosts that only deliver keydown.
      doc.exitPointerLock();
      return;
    }
    const key = dosKey(code);
    if (runtime && playing && key !== undefined) {
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) runtime.keyEvent(key, true);
    }
  };
  const keyUp = (event: KeyboardEvent) => {
    if (disposed || !ownsLock() || !playing) return;
    const key = dosKey(physicalCode(event));
    if (key !== undefined) {
      event.preventDefault();
      runtime?.keyEvent(key, false);
    }
  };
  const mouseMove = (event: MouseEvent) => {
    // GZDoom consumes raw pointer-lock deltas; freelook does not move the player.
    if (ownsLock() && playing) runtime?.mouseMotion(event.movementX, event.movementY);
  };
  const mouseDown = (event: MouseEvent) => {
    if (ownsLock() && playing) {
      event.preventDefault();
      runtime?.mouseButton(event.button, true);
    }
  };
  const mouseUp = (event: MouseEvent) => {
    if (ownsLock() && playing) runtime?.mouseButton(event.button, false);
  };
  const visibility = () => {
    if (doc.hidden) suspend();
  };
  const contextMenu = (event: Event) => {
    if (ownsLock()) event.preventDefault();
  };
  doc.addEventListener("pointerlockchange", lockChanged);
  doc.addEventListener("pointerlockerror", lockError);
  doc.addEventListener("keydown", keyDown, true);
  doc.addEventListener("keyup", keyUp, true);
  doc.addEventListener("mousemove", mouseMove);
  doc.addEventListener("mouseup", mouseUp);
  doc.addEventListener("visibilitychange", visibility);
  host.addEventListener("mousedown", mouseDown);
  host.addEventListener("contextmenu", contextMenu);
  win.addEventListener("blur", suspend);
  return {
    activateFromGesture() {
      if (disposed) return;
      wanted = true;
      if (ownsLock()) {
        resumeIfReady();
        return;
      }
      try {
        // Must execute inside the actual click/keyboard gesture, before async boot.
        const pending = host.requestPointerLock();
        if (pending) void pending.catch(lockError);
      } catch {
        lockError();
      }
    },
    attachRuntime(next) {
      if (disposed) {
        void next.dispose();
        return;
      }
      if (runtime !== next) playing = false;
      runtime = next;
      if (!wanted || !ownsLock()) {
        runtime.pause();
        onStatus("ready");
      }
      resumeIfReady();
    },
    suspend,
    dispose() {
      if (disposed) return;
      suspend();
      disposed = true;
      runtime = undefined;
      doc.removeEventListener("pointerlockchange", lockChanged);
      doc.removeEventListener("pointerlockerror", lockError);
      doc.removeEventListener("keydown", keyDown, true);
      doc.removeEventListener("keyup", keyUp, true);
      doc.removeEventListener("mousemove", mouseMove);
      doc.removeEventListener("mouseup", mouseUp);
      doc.removeEventListener("visibilitychange", visibility);
      host.removeEventListener("mousedown", mouseDown);
      host.removeEventListener("contextmenu", contextMenu);
      win.removeEventListener("blur", suspend);
    },
  };
}

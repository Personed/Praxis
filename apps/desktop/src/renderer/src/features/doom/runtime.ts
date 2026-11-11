import type { DoomRuntime } from "./types.ts";
import { keyboardInput, renderSize, startupArguments } from "./wide-protocol.ts";

const support = [
  "gzdoom.pk3",
  "game_support.pk3",
  "game_widescreen_gfx.pk3",
  "brightmaps.pk3",
  "lights.pk3",
];
const config = `[Doom.ConsoleVariables]
freelook=true
lookspring=false
lookstrafe=false
m_forward=0
m_side=0
[Doom.Bindings]
pause=pause
w=+forward
s=+back
a=+moveleft
d=+moveright
space=+use
shift=+speed
mouse1=+attack
mouse2=+altattack
1=slot 1
2=slot 2
3=slot 3
4=slot 4
5=slot 5
6=slot 6
7=slot 7
`;

export async function loadDoomRuntime(
  host: HTMLElement,
  signal: AbortSignal,
  onError?: (message: string) => void,
): Promise<DoomRuntime> {
  signal.throwIfAborted();
  if (typeof OffscreenCanvas === "undefined" || !("Suspending" in WebAssembly))
    throw new Error(
      "Este runtime requer WebAssembly JSPI e OffscreenCanvas. Atualize o aplicativo para executar o DOOM widescreen.",
    );
  const files: Record<string, Uint8Array> = {};
  const assets: [string, string][] = [
    ...support.map((name): [string, string] => [`/${name}`, `/doom/gzdoom/${name}`]),
    ["/DOOM1.WAD", "/doom/game/DOOM1.WAD"],
  ];
  await Promise.all(
    assets.map(async ([name, url]) => {
      const response = await fetch(url, { signal });
      if (!response.ok)
        throw new Error("Não foi possível carregar os arquivos locais do DOOM widescreen.");
      files[name] = new Uint8Array(await response.arrayBuffer());
    }),
  );
  signal.throwIfAborted();
  files["/nexo.ini"] = new TextEncoder().encode(config);
  const canvas = document.createElement("canvas");
  canvas.className = "doom-home-game";
  canvas.setAttribute("aria-hidden", "true");
  const initialSize = renderSize(host.clientWidth, host.clientHeight);
  canvas.width = initialSize.width;
  canvas.height = initialSize.height;
  host.append(canvas);
  let worker: Worker;
  try {
    worker = new Worker("/doom/gzdoom/nexo.worker.js");
  } catch (error) {
    canvas.remove();
    throw error;
  }
  let disposed = false;
  let playing = false;
  let booted = false;
  let failed = false;
  const keys = new Set<number>();
  const buttons = new Set<number>();
  const post = (message: object) => {
    if (!disposed) worker.postMessage(message);
  };
  const input = (target: string, evType: string, init: object) =>
    post({ type: "input", target, evType, init: { bubbles: true, cancelable: true, ...init } });
  const keyEvent = (code: number, pressed: boolean) => {
    const fields = keyboardInput(code);
    if (!fields) return;
    if (pressed) keys.add(code);
    else keys.delete(code);
    input("window", pressed ? "keydown" : "keyup", {
      ...fields,
      repeat: false,
      shiftKey: keys.has(340) || keys.has(344),
      ctrlKey: keys.has(341) || keys.has(345),
      altKey: keys.has(342) || keys.has(346),
    });
  };
  const mouseButton = (button: number, pressed: boolean) => {
    if (pressed) buttons.add(button);
    else buttons.delete(button);
    input(pressed ? "canvas" : "document", pressed ? "mousedown" : "mouseup", {
      button,
      buttons: [...buttons].reduce((mask, b) => mask | (b === 0 ? 1 : b === 1 ? 4 : 2), 0),
      clientX: canvas.width / 2,
      clientY: canvas.height / 2,
    });
  };
  const releaseInputs = () => {
    for (const key of [...keys]) keyEvent(key, false);
    for (const button of [...buttons]) mouseButton(button, false);
  };
  let lastSize = initialSize;
  const observer = new ResizeObserver(() => {
    const size = renderSize(host.clientWidth, host.clientHeight);
    if (size.width !== lastSize.width || size.height !== lastSize.height) {
      lastSize = size;
      post({ type: "resize", ...size });
    }
  });
  let bootTimer: ReturnType<typeof setTimeout> | undefined;
  let bootPromise: Promise<void> | undefined;
  let rejectBoot: ((error: unknown) => void) | undefined;
  const dispose = async () => {
    if (disposed) return;
    releaseInputs();
    disposed = true;
    clearTimeout(bootTimer);
    observer.disconnect();
    signal.removeEventListener("abort", abort);
    worker.terminate();
    canvas.remove();
    rejectBoot?.(signal.aborted ? signal.reason : new Error("DOOM encerrado."));
  };
  const abort = () => {
    void dispose();
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    bootPromise = new Promise<void>((resolve, reject) => {
      rejectBoot = reject;
      const timer = setTimeout(
        () =>
          reject(
            new Error("O DOOM widescreen demorou para iniciar. Clique para tentar novamente."),
          ),
        45000,
      );
      bootTimer = timer;
      const fail = (message: string) => {
        if (failed || disposed) return;
        failed = true;
        clearTimeout(timer);
        if (!booted) reject(new Error(message));
        else {
          void dispose();
          onError?.(message);
        }
      };
      worker.onmessage = ({ data }) => {
        if (disposed || failed) return;
        if (data.type === "game-ready") {
          clearTimeout(timer);
          booted = true;
          rejectBoot = undefined;
          resolve();
        } else if (["error", "abort"].includes(data.type)) {
          fail("O DOOM widescreen foi interrompido: " + (data.message || data.reason));
        }
      };
      worker.onerror = () =>
        fail("O runtime do DOOM widescreen foi interrompido. Clique para tentar novamente.");
    });
    const boot = bootPromise;
    const offscreen = canvas.transferControlToOffscreen();
    worker.postMessage(
      {
        type: "boot",
        canvas: offscreen,
        pinW: initialSize.width,
        pinH: initialSize.height,
        args: startupArguments(initialSize),
        files,
      },
      [offscreen, ...Object.values(files).map((bytes) => bytes.buffer)],
    );
    observer.observe(host);
    await boot;
    signal.throwIfAborted();
    return {
      canvas,
      releaseInputs,
      keyEvent,
      mouseButton,
      dispose,
      pause() {
        releaseInputs();
        if (playing) {
          post({ type: "suspend", paused: true });
          post({ type: "pointerlock", locked: false });
          playing = false;
        }
      },
      resume() {
        if (!playing && !disposed) {
          post({ type: "pointerlock", locked: true });
          post({ type: "suspend", paused: false });
          playing = true;
        }
      },
      mouseMotion(x, y) {
        if (playing)
          input("canvas", "mousemove", {
            movementX: x,
            movementY: y,
            clientX: canvas.width / 2,
            clientY: canvas.height / 2,
            buttons: 0,
          });
      },
    };
  } catch (error) {
    await dispose();
    await bootPromise?.catch(() => {});
    throw error;
  }
}

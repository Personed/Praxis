export interface DoomRuntime {
  canvas: HTMLCanvasElement;
  pause(): void;
  resume(): void;
  releaseInputs(): void;
  keyEvent(code: number, pressed: boolean): void;
  mouseMotion(x: number, y: number): void;
  mouseButton(button: number, pressed: boolean): void;
  dispose(): Promise<void>;
}

export interface DosCommandInterface {
  width(): number;
  height(): number;
  mute(): void;
  pause(): void;
  resume(): void;
  exit(): Promise<void>;
  sendKeyEvent(code: number, pressed: boolean): void;
  sendMouseRelativeMotion(x: number, y: number): void;
  sendMouseButton(button: number, pressed: boolean): void;
  events(): {
    onFrame(fn: (rgb: Uint8Array | null, rgba: Uint8Array | null) => void): void;
    onFrameSize(fn: (width: number, height: number) => void): void;
    onMessage(fn: (type: string, ...args: unknown[]) => void): void;
  };
}

export interface DosEngine {
  pathPrefix: string;
  dosboxWorker(bundle: Uint8Array): Promise<DosCommandInterface>;
}

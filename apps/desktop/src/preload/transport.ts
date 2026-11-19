/** Transport-agnostic IPC for the renderer: Electron ipcRenderer today, sidecar RPC under Tauri. */
// biome-ignore lint/suspicious/noExplicitAny: payload types vary per channel; handlers narrow them.
export type ModusListener = (event: unknown, payload: any) => void;

export type ModusTransport = {
  invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T>;
  on(channel: string, listener: ModusListener): void;
  removeListener(channel: string, listener: ModusListener): void;
  env: {
    platform: string;
    systemVersion: string;
    argv: string[];
  };
};

/**
 * WebSocket transport to the Node sidecar (Electron replacement).
 * Connects when the Tauri shell injects window.__MODUS_RPC__ = {port, token}.
 */
import type { ModusListener, ModusTransport } from "../../../preload/transport";

declare global {
  interface Window {
    __MODUS_RPC__?: { port: number; token: string };
    __MODUS_ENV__?: { platform: string; systemVersion: string; argv: string[] };
  }
}

export function createWsTransport(): ModusTransport | null {
  const rpc = window.__MODUS_RPC__;
  if (!rpc) return null;

  const listeners = new Map<string, Set<ModusListener>>();
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  let nextId = 0;
  let socket: WebSocket | null = null;
  let ready: Promise<void> | null = null;

  function connect(port: number, token: string): Promise<void> {
    if (ready) return ready;
    ready = new Promise((resolve, reject) => {
      socket = new WebSocket(`ws://127.0.0.1:${port}/?token=${token}`);
      socket.onopen = () => resolve();
      socket.onerror = () => reject(new Error("sidecar websocket error"));
      socket.onclose = () => {
        for (const p of pending.values()) p.reject(new Error("sidecar disconnected"));
        pending.clear();
        ready = null;
        socket = null;
        // Reconnect after a short delay; services broadcast to all clients anyway.
        setTimeout(() => void connect(port, token).catch(() => undefined), 500);
      };
      socket.onmessage = (evt) => {
        let msg: {
          type?: string;
          id?: number;
          value?: unknown;
          error?: string;
          channel?: string;
          args?: unknown[];
        };
        try {
          msg = JSON.parse(String(evt.data));
        } catch {
          return;
        }
        if (msg.type === "result" || msg.type === "error") {
          const p = pending.get(msg.id ?? -1);
          if (!p) return;
          pending.delete(msg.id ?? -1);
          if (msg.type === "error") p.reject(new Error(msg.error ?? "ipc error"));
          else p.resolve(msg.value);
        } else if (msg.type === "event" && msg.channel) {
          const payload = msg.args && msg.args.length === 1 ? msg.args[0] : msg.args;
          for (const listener of listeners.get(msg.channel) ?? []) {
            listener({}, payload);
          }
        }
      };
    });
    return ready;
  }

  const env = window.__MODUS_ENV__ ?? {
    platform: "linux",
    systemVersion: "",
    argv: [],
  };

  // Channels the Tauri shell owns (updater engine). Everything else goes to
  // the sidecar over the WebSocket.
  const tauriCommands: Record<string, string> = {
    "update:get-state": "modus_update_get_state",
    "update:install": "modus_update_install",
    "update:retry": "modus_update_check",
    "update:restart-now": "modus_update_restart",
    "update:open-release-page": "modus_update_open_release",
    "update:dismiss": "modus_update_dismiss",
  };
  const tauriEvents = new Set(["update:state-event"]);
  let tauriEventHooked = false;

  async function tauriInvoke<T>(command: string): Promise<T> {
    const { invoke } = await import("@tauri-apps/api/core");
    return (await invoke(command)) as T;
  }

  return {
    invoke: async <T = unknown>(channel: string, ...args: unknown[]) => {
      const command = tauriCommands[channel];
      if (command) {
        return await tauriInvoke<T>(command);
      }
      await connect(rpc.port, rpc.token);
      const id = ++nextId;
      // JSON can't represent undefined: send a sentinel the server maps back.
      const wireArgs = args.map((a) => (a === undefined ? { __modus_undefined: true } : a));
      return await new Promise<T>((resolve, reject) => {
        pending.set(id, { resolve: (v) => resolve(v as T), reject });
        socket?.send(JSON.stringify({ type: "invoke", id, channel, args: wireArgs }));
      });
    },
    on: (channel: string, listener: ModusListener) => {
      if (tauriEvents.has(channel) && !tauriEventHooked) {
        tauriEventHooked = true;
        void import("@tauri-apps/api/event").then(({ listen }) =>
          listen(channel, (evt) => {
            for (const l of listeners.get(channel) ?? []) {
              l({}, evt.payload);
            }
          }),
        );
      }
      let set = listeners.get(channel);
      if (!set) {
        set = new Set();
        listeners.set(channel, set);
      }
      set.add(listener);
    },
    removeListener: (channel: string, listener: ModusListener) => {
      listeners.get(channel)?.delete(listener);
    },
    env,
  };
}

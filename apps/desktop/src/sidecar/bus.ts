/**
 * Event bus: rpc.ts registers the socket broadcast, any sidecar module
 * (electron-shim webContents.send, remote-view screencast frames) publishes.
 */
export type SendFn = (channel: string, payload: unknown) => void;

let broadcaster: SendFn = () => {};

export function setEventBroadcaster(fn: SendFn): void {
  broadcaster = fn;
}

export function broadcastEvent(channel: string, payload: unknown): void {
  broadcaster(channel, payload);
}

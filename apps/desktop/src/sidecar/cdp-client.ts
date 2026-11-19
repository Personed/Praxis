/**
 * Minimal Chrome DevTools Protocol client over a raw WebSocket.
 * Used by remote-view.ts to drive the external Chromium that replaces
 * Electron's WebContentsView under the Tauri shell.
 *
 * Supports flat (sessionId-multiplexed) sessions: commands may carry a
 * sessionId and events are demuxed to listeners.
 */
import { createHash } from "node:crypto";
import { type ClientRequest, request } from "node:http";
import type { Duplex } from "node:stream";

export type CdpEvent = { method: string; params: Record<string, unknown>; sessionId?: string };
export type CdpEventListener = (event: CdpEvent) => void;

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

function acceptKey(key: string): string {
  return createHash("sha1")
    .update(key + WS_GUID)
    .digest("base64");
}

function encodeFrame(payload: Buffer, masked: boolean): Buffer {
  const len = payload.length;
  let header: Buffer;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[1] = masked ? 0x80 | len : len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[1] = masked ? 0x80 | 126 : 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = masked ? 0x80 | 127 : 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  header[0] = 0x81;
  if (!masked) {
    return Buffer.concat([header, payload]);
  }
  const maskKey = createHash("md5").update(String(Math.random())).digest().subarray(0, 4);
  const maskedPayload = Buffer.from(payload);
  for (let i = 0; i < maskedPayload.length; i++) {
    maskedPayload[i] = (maskedPayload[i] ?? 0) ^ (maskKey[i % 4] ?? 0);
  }
  return Buffer.concat([header, maskKey, maskedPayload]);
}

function decodeFrames(buffer: Buffer): {
  frames: Buffer[];
  rest: Buffer<ArrayBufferLike>;
  closed: boolean;
} {
  const frames: Buffer[] = [];
  let offset = 0;
  let closed = false;
  while (offset + 2 <= buffer.length) {
    const opcode = (buffer[offset] ?? 0) & 0x0f;
    let len = (buffer[offset + 1] ?? 0) & 0x7f;
    let pos = offset + 2;
    if (len === 126) {
      if (pos + 2 > buffer.length) break;
      len = buffer.readUInt16BE(pos);
      pos += 2;
    } else if (len === 127) {
      if (pos + 8 > buffer.length) break;
      len = Number(buffer.readBigUInt64BE(pos));
      pos += 8;
    }
    let mask: Buffer | undefined;
    if (((buffer[offset + 1] ?? 0) & 0x80) !== 0) {
      if (pos + 4 > buffer.length) break;
      mask = buffer.subarray(pos, pos + 4);
      pos += 4;
    }
    if (pos + len > buffer.length) break;
    const payload = Buffer.from(buffer.subarray(pos, pos + len));
    if (mask) {
      for (let i = 0; i < payload.length; i++) {
        payload[i] = (payload[i] ?? 0) ^ (mask[i % 4] ?? 0);
      }
    }
    offset = pos + len;
    if (opcode === 0x8) {
      closed = true;
      break;
    }
    if (opcode === 0x9) continue;
    if (opcode === 0x1 || opcode === 0x2) frames.push(payload);
  }
  return { frames, rest: buffer.subarray(offset), closed };
}

export class CdpConnection {
  private socket: Duplex | null = null;
  private nextId = 0;
  private readonly pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  private readonly listeners = new Set<CdpEventListener>();
  private closeListeners = new Set<() => void>();
  private closed = false;

  static async connect(wsUrl: string): Promise<CdpConnection> {
    const conn = new CdpConnection();
    await conn.open(wsUrl);
    return conn;
  }

  get isClosed(): boolean {
    return this.closed;
  }

  private open(wsUrl: string): Promise<void> {
    const url = new URL(wsUrl);
    const key = Buffer.from(String(Math.random())).toString("base64").slice(0, 16);
    return new Promise((resolve, reject) => {
      const req: ClientRequest = request({
        hostname: url.hostname,
        port: Number(url.port),
        path: `${url.pathname}${url.search}`,
        headers: {
          Connection: "Upgrade",
          Upgrade: "websocket",
          "Sec-WebSocket-Key": key,
          "Sec-WebSocket-Version": "13",
        },
      });
      req.on("upgrade", (_res, socket: Duplex, head: Buffer) => {
        this.socket = socket;
        let buf: Buffer<ArrayBufferLike> = head.length ? Buffer.from(head) : Buffer.alloc(0);
        socket.on("data", (chunk: Buffer) => {
          buf = Buffer.concat([buf, chunk]);
          const { frames, rest, closed } = decodeFrames(buf);
          buf = rest;
          if (closed) {
            this.handleClose();
            socket.destroy();
            return;
          }
          for (const frame of frames) {
            this.handleFrame(frame);
          }
        });
        socket.on("error", () => this.handleClose());
        socket.on("close", () => this.handleClose());
        resolve();
      });
      req.on("response", (res) => {
        if (res.statusCode !== 101 || res.headers["sec-websocket-accept"] !== acceptKey(key)) {
          reject(new Error(`CDP handshake failed: HTTP ${res.statusCode}`));
        }
      });
      req.on("error", reject);
      req.end();
    });
  }

  private handleFrame(frame: Buffer): void {
    let msg: {
      id?: number;
      result?: unknown;
      error?: { message?: string };
      method?: string;
      params?: Record<string, unknown>;
      sessionId?: string;
    };
    try {
      msg = JSON.parse(frame.toString("utf8"));
    } catch {
      return;
    }
    if (msg.id !== undefined) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) {
        p.reject(new Error(msg.error.message ?? "CDP error"));
      } else {
        p.resolve(msg.result);
      }
      return;
    }
    if (msg.method) {
      const event: CdpEvent = {
        method: msg.method,
        params: msg.params ?? {},
        ...(msg.sessionId !== undefined ? { sessionId: msg.sessionId } : {}),
      };
      for (const listener of this.listeners) {
        listener(event);
      }
    }
  }

  send<T = Record<string, unknown>>(
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string,
  ): Promise<T> {
    if (!this.socket || this.closed) {
      return Promise.reject(new Error("CDP connection closed"));
    }
    const id = ++this.nextId;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.socket?.write(
        encodeFrame(
          Buffer.from(
            JSON.stringify({
              id,
              method,
              params,
              ...(sessionId !== undefined ? { sessionId } : {}),
            }),
          ),
          true,
        ),
      );
    });
  }

  onEvent(listener: CdpEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onClose(listener: () => void): void {
    this.closeListeners.add(listener);
  }

  private handleClose(): void {
    if (this.closed) return;
    this.closed = true;
    const error = new Error("CDP connection closed");
    for (const p of this.pending.values()) {
      p.reject(error);
    }
    this.pending.clear();
    for (const listener of this.closeListeners) {
      listener();
    }
  }

  close(): void {
    this.handleClose();
    try {
      this.socket?.destroy();
    } catch {
      // ignore
    }
    this.socket = null;
  }
}

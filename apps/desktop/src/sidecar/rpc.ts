/**
 * JSON-RPC over WebSocket server for the Tauri sidecar.
 * Renderer sends {type:"invoke",id,channel,args}; replies {type:"result"|"error",id,...}.
 * Services push {type:"event",channel,args} via __setEventBroadcaster.
 */
import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
import { __invokeIpc, __setEventBroadcaster } from "./electron-shim";

type WsMessage = {
  type: string;
  id?: number;
  channel?: string;
  args?: unknown[];
};

// Minimal RFC6455 server (text frames only, no extensions) so the sidecar stays
// a single self-contained file with no extra deps.
const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

function acceptKey(key: string): string {
  return createHash("sha1")
    .update(key + WS_GUID)
    .digest("base64");
}

function encodeFrame(data: Buffer): Buffer {
  const len = data.length;
  let header: Buffer;
  if (len < 126) {
    header = Buffer.from([0x81, len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, data]);
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
    const masked = ((buffer[offset + 1] ?? 0) & 0x80) !== 0;
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
    if (masked) {
      if (pos + 4 > buffer.length) break;
      mask = buffer.subarray(pos, pos + 4);
      pos += 4;
    }
    if (pos + len > buffer.length) break;
    const payload = Buffer.from(buffer.subarray(pos, pos + len));
    if (mask)
      for (let i = 0; i < payload.length; i++) payload[i] = (payload[i] ?? 0) ^ (mask[i % 4] ?? 0);
    offset = pos + len;
    if (opcode === 0x8) {
      closed = true;
      break;
    }
    if (opcode === 0x9) continue; // ping: ignore (clients get pong on next frame anyway)
    if (opcode === 0x1 || opcode === 0x2) frames.push(payload);
  }
  return { frames, rest: buffer.subarray(offset), closed };
}

export type RpcServer = {
  port: number;
  close: () => void;
};

export function startRpcServer(port: number, token: string): Promise<RpcServer> {
  const sockets = new Set<Duplex>();

  const send = (socket: Duplex, msg: unknown) => {
    if (!socket.destroyed) socket.write(encodeFrame(Buffer.from(JSON.stringify(msg))));
  };
  const broadcast = (msg: unknown) => {
    const frame = encodeFrame(Buffer.from(JSON.stringify(msg)));
    for (const socket of sockets) {
      if (!socket.destroyed) socket.write(frame);
    }
  };

  __setEventBroadcaster((channel, payload) => {
    broadcast({ type: "event", channel, args: [payload] });
  });

  const server: Server = createServer((_req, res) => {
    console.log(`[rpc] http ${_req.method} ${_req.url} origin=${_req.headers.origin}`);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });

  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    console.log(`[rpc] upgrade ${req.url} origin=${req.headers.origin}`);
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.searchParams.get("token") !== token) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    const key = req.headers["sec-websocket-key"];
    if (!key) {
      socket.destroy();
      return;
    }
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
        "Upgrade: websocket\r\nConnection: Upgrade\r\n" +
        `Sec-WebSocket-Accept: ${acceptKey(key)}\r\n\r\n`,
    );
    sockets.add(socket);
    socket.on("error", () => sockets.delete(socket));
    socket.on("close", () => sockets.delete(socket));

    let buf: Buffer<ArrayBufferLike> = head.length ? Buffer.from(head) : Buffer.alloc(0);
    socket.on("data", (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      const { frames, rest, closed } = decodeFrames(buf);
      buf = rest;
      if (closed) {
        socket.destroy();
        return;
      }
      for (const frame of frames) {
        let msg: WsMessage;
        try {
          msg = JSON.parse(frame.toString("utf8"));
        } catch {
          continue;
        }
        if (msg.type === "invoke" && msg.id != null && msg.channel) {
          const { id, channel } = msg;
          const args = (msg.args ?? []).map((a) =>
            a !== null && typeof a === "object" && "__modus_undefined" in a ? undefined : a,
          );
          __invokeIpc(channel, args)
            .then((value) => send(socket, { type: "result", id, value }))
            .catch((error: unknown) =>
              send(socket, {
                type: "error",
                id,
                error: error instanceof Error ? error.message : String(error),
              }),
            );
        }
      }
    });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const actual = (server.address() as AddressInfo).port;
      resolve({ port: actual, close: () => server.close() });
    });
  });
}

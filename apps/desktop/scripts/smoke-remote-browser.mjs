// Smoke test: spawn sidecar, connect WS, create+show a browser tab, expect a
// browser:frame screencast event within the budget.

import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";

const token = "smoketoken123";
const child = spawn("node", ["out/sidecar/index.js"], {
  env: {
    ...process.env,
    MODUS_RPC_PORT: "0",
    MODUS_RPC_TOKEN: token,
    MODUS_CHROMIUM_PATH: "google-chrome",
  },
  cwd: new URL("..", import.meta.url).pathname,
});

let port = null;
let stdout = "";
child.stdout.on("data", (d) => {
  stdout += d.toString();
  const m = stdout.match(/MODUS_RPC_READY (\d+)/);
  if (m && !port) {
    port = Number(m[1]);
    run().catch(fail);
  }
});
child.stderr.on("data", (d) => process.stderr.write(d));

const fail = (err) => {
  console.error("FAIL", err);
  child.kill("SIGKILL");
  process.exit(1);
};
const done = (msg) => {
  console.log("PASS", msg);
  child.kill("SIGKILL");
  process.exit(0);
};
setTimeout(() => fail("timeout waiting for browser:frame"), 60_000);

function wsEncode(text) {
  const payload = Buffer.from(text);
  const mask = Buffer.alloc(4).fill(0);
  const header = [0x81];
  if (payload.length < 126) header.push(0x80 | payload.length);
  else {
    header.push(0x80 | 126, (payload.length >> 8) & 255, payload.length & 255);
  }
  return Buffer.concat([Buffer.from(header), mask, payload]);
}

async function run() {
  const net = await import("node:net");
  const crypto = await import("node:crypto");
  const key = crypto.randomBytes(16).toString("base64");
  const socket = net.connect(port, "127.0.0.1");
  socket.write(
    `GET /?token=${token} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
  );
  let buf = Buffer.alloc(0);
  let id = 0;
  let tabId = null;
  const invoke = (channel, input) =>
    new Promise((resolve, reject) => {
      id += 1;
      const mid = id;
      pending.set(mid, { resolve, reject });
      socket.write(wsEncode(JSON.stringify({ type: "invoke", id: mid, channel, args: [input] })));
    });
  const pending = new Map();
  let upgraded = false;
  socket.on("data", async (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    if (!upgraded) {
      const idx = buf.indexOf("\r\n\r\n");
      if (idx === -1) return;
      upgraded = true;
      buf = buf.subarray(idx + 4);
      const tab = await invoke("browser:create-tab", {
        workspaceId: "smoke-ws",
        url: "https://example.com",
      });
      tabId = tab.id;
      console.log("tab created", tabId);
      await invoke("browser:show", { tabId, bounds: { x: 0, y: 0, width: 960, height: 640 } });
      console.log("tab shown; waiting for frames...");
    }
    while (buf.length >= 2) {
      const len = buf[1] & 0x7f;
      let off = 2,
        plen = len;
      if (len === 126) {
        if (buf.length < 4) return;
        plen = buf.readUInt16BE(2);
        off = 4;
      }
      if (buf.length < off + plen) return;
      const msg = JSON.parse(buf.subarray(off, off + plen).toString());
      buf = buf.subarray(off + plen);
      if (msg.type === "result") pending.get(msg.id)?.resolve(msg.value);
      if (msg.type === "error") pending.get(msg.id)?.reject(new Error(msg.error));
      if (
        msg.type === "event" &&
        msg.channel === "browser:frame" &&
        msg.args?.[0]?.tabId === tabId
      ) {
        const bytes = Buffer.from(msg.args[0].data, "base64").length;
        done(`screencast frame received for ${tabId} (${bytes} bytes jpeg)`);
      }
    }
  });
  socket.on("error", fail);
}

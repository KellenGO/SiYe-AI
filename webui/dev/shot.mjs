// 用 CDP 驱动无头 Edge 截图，并回传控制台错误，供本地预览台迭代使用。
// 用法：node dev/shot.mjs --url http://localhost:5199/dev/index.html --out .preview/x.png --width 1600 --height 1000
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = Object.fromEntries(process.argv.slice(2).reduce((all, value, index, list) => {
  if (value.startsWith("--")) all.push([value.slice(2), list[index + 1] ?? ""]);
  return all;
}, []));

const url = args.url ?? "http://localhost:5199/dev/index.html";
const out = args.out ?? ".preview/shot.png";
const width = Number(args.width ?? 1600);
const height = Number(args.height ?? 1000);
const wait = Number(args.wait ?? 1800);
const port = Number(args.port ?? 9333);
const profile = mkdtempSync(join(tmpdir(), "siye-shot-"));
const edge = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

const browser = spawn(edge, [
  "--headless=new", "--disable-gpu", "--no-first-run", "--hide-scrollbars",
  "--allow-file-access-from-files",
  `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  `--window-size=${width},${height}`, "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function endpoint(path) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, { method: "PUT" });
      if (response.ok) return await response.json();
    } catch { /* 浏览器还没起来 */ }
    await sleep(200);
  }
  throw new Error("无法连接调试端口");
}

let socket;
try {
  const target = await endpoint(`/json/new?${encodeURIComponent(url)}`);
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });

  let next = 0;
  const pending = new Map();
  const logs = [];
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) { pending.get(message.id)(message.result); pending.delete(message.id); return; }
    if (message.method === "Runtime.consoleAPICalled") logs.push(`[${message.params.type}] ${message.params.args.map((row) => row.value ?? row.description ?? row.type).join(" ")}`);
    if (message.method === "Runtime.exceptionThrown") logs.push(`[exception] ${message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text}`);
    if (message.method === "Log.entryAdded") logs.push(`[log:${message.params.entry.level}] ${message.params.entry.text}`);
  };
  const send = (method, params = {}) => new Promise((resolve) => { const id = ++next; pending.set(id, resolve); socket.send(JSON.stringify({ id, method, params })); });

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Log.enable");
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url });
  await sleep(wait);
  if (args.eval) {
    const value = await send("Runtime.evaluate", { expression: args.eval, awaitPromise: true, returnByValue: true });
    const detail = value.result?.value ?? value.exceptionDetails?.exception?.description;
    if (detail !== undefined) console.log(`eval: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
    await sleep(500);
  }

  const probe = await send("Runtime.evaluate", {
    expression: `JSON.stringify({ scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight, body: document.body.getBoundingClientRect().toJSON(), dialog: (() => { const d = document.querySelector("dialog"); return d ? { open: d.open, rect: d.getBoundingClientRect().toJSON(), display: getComputedStyle(d).display } : null; })(), note: (() => { const n = document.querySelector(".dev-note"); return n ? n.getBoundingClientRect().toJSON() : null; })() })`,
    returnByValue: true,
  });
  console.log(probe.result?.value ?? "");
  const shot = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(out, Buffer.from(shot.data, "base64"));
  console.log(`saved ${out}`);
  if (logs.length) console.log(logs.join("\n"));
} finally {
  try { socket?.close(); } catch { /* ignore */ }
  browser.kill();
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
}

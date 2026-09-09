// offscreen document：唯一有 DOM、又在 extension origin 的常駐頁，負責 File System Access 讀寫。
// background 用 runtime.sendMessage({type:"fs:*"}) 呼叫；所有操作用 promise chain 序列化。
import { loadHandle, permissionState } from "../fs/handle-store.js";
import * as ops from "../fs/ops.js";

let chain = Promise.resolve();
const serial = (fn) => {
  const run = chain.then(fn, fn);
  chain = run.catch(() => {});
  return run;
};

async function root() {
  const h = await loadHandle();
  if (!h) throw Object.assign(new Error("no folder selected"), { code: "no-handle" });
  const p = await permissionState(h);
  if (p !== "granted") throw Object.assign(new Error(`permission ${p}`), { code: "no-permission" });
  return h;
}

const HANDLERS = {
  async "fs:status"() {
    const h = await loadHandle();
    return { ok: true, linked: !!h, permission: await permissionState(h), name: h?.name ?? null };
  },
  async "fs:read"({ path }) {
    return { ok: true, text: await ops.readText(await root(), path) };
  },
  async "fs:exists"({ path }) {
    return { ok: true, exists: await ops.exists(await root(), path) };
  },
  async "fs:stat"({ path }) {
    return { ok: true, stat: await ops.stat(await root(), path) };
  },
  async "fs:write"({ path, text }) {
    await ops.writeText(await root(), path, text);
    return { ok: true };
  },
  async "fs:append"({ path, text, header }) {
    await ops.appendText(await root(), path, text, header ?? "");
    return { ok: true };
  },
  async "fs:copy"({ from, to }) {
    return { ok: true, copied: await ops.copyFile(await root(), from, to) };
  },
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const h = HANDLERS[msg?.type];
  if (!h || msg?.target !== "offscreen") return false;
  serial(() => h(msg)).then(sendResponse, (e) => sendResponse({ ok: false, error: e?.message ?? String(e), code: e?.code ?? null }));
  return true;
});

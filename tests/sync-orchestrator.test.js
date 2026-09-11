// 同步流程本體：決策 → 上傳 / 下載 / 合併 → 更新同步狀態。
// Drive、檔案系統、狀態都以假的注入；不連網、不碰真的檔案。
import { test } from "node:test";
import assert from "node:assert/strict";
import { createSyncer, hashText } from "../src/sync/orchestrator.js";
import { mergeCsv } from "../src/sync/csv-merge.js";
import { headerLine, toRow, parseRows } from "../src/focus/csv.js";
import { DriveError } from "../src/drive/client.js";

const seg = (startIso, o = {}) => ({
  start: startIso, end: startIso, lectureId: 1, chapterIndex: 1, lectureIndex: 1, title: "T",
  watchedMs: 1000, posStart: 0, posEnd: 1, rate: 1, endReason: "pause",
  seekBackCount: 0, seekBackS: 0, videoDurationS: 100, extVersion: "0.6.0", ...o,
});
const csv = (...s) => headerLine() + s.map(toRow).join("");
const A = csv(seg("2026-09-10T01:00:00.000Z"));
const B = csv(seg("2026-09-10T02:00:00.000Z"));

/** 假 Drive：一個資料夾、以檔名為 key 的檔案表，md5 用內容 hash 代替。 */
function fakeDrive(initial = {}) {
  const files = new Map(Object.entries(initial).map(([name, text], i) => [name, { id: `f${i}`, text }]));
  const log = [];
  let nextId = 100;
  let failNextUpdate = null;
  return {
    files,
    log,
    failUpdateOnce: (e) => (failNextUpdate = e),
    async ensureFolder(name) {
      log.push(["ensureFolder", name]);
      return "folder1";
    },
    async findFile(name) {
      log.push(["findFile", name]);
      const f = files.get(name);
      return f ? { id: f.id, md5Checksum: hashText(f.text), modifiedTime: "t" } : null;
    },
    async download(id) {
      log.push(["download", id]);
      for (const f of files.values()) if (f.id === id) return f.text;
      throw new DriveError("not found", { status: 404 });
    },
    async createFile({ name, text }) {
      log.push(["createFile", name]);
      const f = { id: `f${nextId++}`, text };
      files.set(name, f);
      return { id: f.id, md5Checksum: hashText(text), modifiedTime: "t" };
    },
    async updateFile(id, text) {
      log.push(["updateFile", id]);
      if (failNextUpdate) {
        const e = failNextUpdate;
        failNextUpdate = null;
        throw e;
      }
      for (const f of files.values()) {
        if (f.id === id) {
          f.text = text;
          return { id, md5Checksum: hashText(text), modifiedTime: "t" };
        }
      }
      throw new DriveError("not found", { status: 404 });
    },
  };
}

function fakeFiles(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    async read(path) {
      return map.has(path) ? map.get(path) : null;
    },
    async write(path, text) {
      map.set(path, text);
    },
  };
}

function memState() {
  const m = new Map();
  return {
    async get(k) {
      return m.get(k) ?? null;
    },
    async set(k, v) {
      m.set(k, v);
    },
    dump: () => Object.fromEntries(m),
  };
}

const SPEC = { key: "course/watch-log.csv", localPath: "課程/watch-log.csv", remoteName: "watch-log.csv", mimeType: "text/csv", merge: mergeCsv };

const syncer = (drive, files, state) => createSyncer({ drive, files, state, rootFolder: "Udemy Boost" });

test("hashText：同內容同值、異內容異值、空字串與 null 不同", () => {
  assert.equal(hashText("abc"), hashText("abc"));
  assert.notEqual(hashText("abc"), hashText("abd"));
  assert.notEqual(hashText(""), hashText(null));
});

test("第一次：本地有、遠端沒有 → 建立遠端檔", async () => {
  const drive = fakeDrive();
  const files = fakeFiles({ "課程/watch-log.csv": A });
  const r = await syncer(drive, files, memState()).syncFile(SPEC);
  assert.equal(r.action, "create");
  assert.equal(drive.files.get("watch-log.csv").text, A);
});

test("第一次：遠端有、本地沒有 → 下載寫入本地", async () => {
  const drive = fakeDrive({ "watch-log.csv": B });
  const files = fakeFiles();
  const r = await syncer(drive, files, memState()).syncFile(SPEC);
  assert.equal(r.action, "download");
  assert.equal(await files.read("課程/watch-log.csv"), B);
});

test("兩邊都有、沒有同步狀態 → 合併，兩邊都拿到聯集", async () => {
  const drive = fakeDrive({ "watch-log.csv": B });
  const files = fakeFiles({ "課程/watch-log.csv": A });
  const r = await syncer(drive, files, memState()).syncFile(SPEC);
  assert.equal(r.action, "merge");
  const local = await files.read("課程/watch-log.csv");
  assert.equal(parseRows(local).rows.length, 2);
  assert.equal(drive.files.get("watch-log.csv").text, local, "合併後兩邊必須位元相同");
});

test("同步過且都沒變 → up-to-date，不上傳也不下載", async () => {
  const drive = fakeDrive();
  const files = fakeFiles({ "課程/watch-log.csv": A });
  const s = syncer(drive, files, memState());
  await s.syncFile(SPEC);
  drive.log.length = 0;
  const r = await s.syncFile(SPEC);
  assert.equal(r.action, "up-to-date");
  assert.equal(drive.log.filter(([op]) => op === "updateFile" || op === "download").length, 0);
});

test("只有本地變 → 上傳，不下載（不需要合併）", async () => {
  const drive = fakeDrive();
  const files = fakeFiles({ "課程/watch-log.csv": A });
  const state = memState();
  const s = syncer(drive, files, state);
  await s.syncFile(SPEC);
  await files.write("課程/watch-log.csv", mergeCsv(A, B).text);
  drive.log.length = 0;
  const r = await s.syncFile(SPEC);
  assert.equal(r.action, "upload");
  assert.equal(drive.log.some(([op]) => op === "download"), false);
  assert.equal(parseRows(drive.files.get("watch-log.csv").text).rows.length, 2);
});

test("只有遠端變 → 下載覆蓋本地", async () => {
  const drive = fakeDrive();
  const files = fakeFiles({ "課程/watch-log.csv": A });
  const s = syncer(drive, files, memState());
  await s.syncFile(SPEC);
  drive.files.get("watch-log.csv").text = mergeCsv(A, B).text;
  const r = await s.syncFile(SPEC);
  assert.equal(r.action, "download");
  assert.equal(parseRows(await files.read("課程/watch-log.csv")).rows.length, 2);
});

test("上傳撞到 412（別台同時寫）→ 自動重跑合併並成功", async () => {
  const drive = fakeDrive({ "watch-log.csv": A });
  const files = fakeFiles({ "課程/watch-log.csv": A });
  const state = memState();
  const s = syncer(drive, files, state);
  await s.syncFile(SPEC); // 對齊狀態
  await files.write("課程/watch-log.csv", mergeCsv(A, B).text);
  drive.failUpdateOnce(new DriveError("Precondition Failed", { status: 412, conflict: true }));
  const r = await s.syncFile(SPEC);
  assert.equal(r.action, "upload");
  assert.equal(r.retries, 1, "應該重試一次");
});

test("持續 412 → 放棄並丟錯，不可靜默當成功", async () => {
  const drive = fakeDrive({ "watch-log.csv": A });
  const files = fakeFiles({ "課程/watch-log.csv": B });
  const always = { ...drive, async updateFile() {
    throw new DriveError("Precondition Failed", { status: 412, conflict: true });
  } };
  await assert.rejects(() => syncer(always, files, memState()).syncFile(SPEC), (e) => e instanceof DriveError && e.conflict);
});

test("下載失敗 → 錯誤往上丟，本地檔案不被動到", async () => {
  const drive = fakeDrive({ "watch-log.csv": B });
  drive.download = async () => {
    throw new DriveError("boom", { status: 500, retryable: true });
  };
  const files = fakeFiles({ "課程/watch-log.csv": A });
  await assert.rejects(() => syncer(drive, files, memState()).syncFile(SPEC), DriveError);
  assert.equal(await files.read("課程/watch-log.csv"), A);
});

test("兩邊都沒有 → noop，不建立空檔", async () => {
  const drive = fakeDrive();
  const r = await syncer(drive, fakeFiles(), memState()).syncFile(SPEC);
  assert.equal(r.action, "noop");
  assert.equal(drive.files.size, 0);
});

test("驗收：兩台裝置各加一段 → 各自同步 → 內容一致且無重複", async () => {
  const cloud = fakeDrive();
  const pc1 = fakeFiles({ "課程/watch-log.csv": A });
  const pc2 = fakeFiles({ "課程/watch-log.csv": B });
  const s1 = syncer(cloud, pc1, memState());
  const s2 = syncer(cloud, pc2, memState());

  await s1.syncFile(SPEC); // PC1 先上傳 A
  await s2.syncFile(SPEC); // PC2 合併 A+B 並上傳
  await s1.syncFile(SPEC); // PC1 取回合併結果

  const t1 = await pc1.read("課程/watch-log.csv");
  const t2 = await pc2.read("課程/watch-log.csv");
  assert.equal(t1, t2, "兩台內容必須完全一致");
  assert.equal(t1, cloud.files.get("watch-log.csv").text, "雲端也要一致");
  assert.equal(parseRows(t1).rows.length, 2, "不能重複也不能遺失");

  // 再同步一輪不該有任何寫入
  cloud.log.length = 0;
  assert.equal((await s1.syncFile(SPEC)).action, "up-to-date");
  assert.equal((await s2.syncFile(SPEC)).action, "up-to-date");
  assert.equal(cloud.log.filter(([op]) => op === "updateFile" || op === "createFile").length, 0);
});

test("syncAll：多個檔案逐一同步，單檔失敗不影響其他檔，並回報每個結果", async () => {
  const drive = fakeDrive();
  drive.findFile = async (name) => {
    if (name === "bad.csv") throw new DriveError("boom", { status: 500, retryable: true });
    return null;
  };
  const files = fakeFiles({ "課程/watch-log.csv": A, "課程/bad.csv": A });
  const r = await syncer(drive, files, memState()).syncAll([
    SPEC,
    { ...SPEC, key: "course/bad.csv", localPath: "課程/bad.csv", remoteName: "bad.csv" },
  ]);
  assert.equal(r.results.length, 2);
  assert.equal(r.results[0].action, "create");
  assert.equal(r.results[1].ok, false);
  assert.match(r.results[1].error, /boom/);
});

// ---------- localWins：衍生檔（progress.md）的策略 ----------
// progress.md 是從 watch-log.csv 算出來的。合併兩份分析報告只會產生垃圾，
// 正確做法是「同步完 CSV 後在本機重算，再把本機這份推上去」。
// 所以只要本機有檔，就一律以本機為準；只有本機沒有時才從雲端取回。

const MD_SPEC = { key: "course/progress.md", localPath: "課程/progress.md", remoteName: "progress.md", mimeType: "text/markdown", localWins: true };

test("localWins：兩邊都變 → 上傳本機版本，不合併也不下載", async () => {
  const drive = fakeDrive({ "progress.md": "# 雲端舊版" });
  const files = fakeFiles({ "課程/progress.md": "# 本機新版" });
  const r = await syncer(drive, files, memState()).syncFile(MD_SPEC);
  assert.equal(r.action, "upload");
  assert.equal(drive.files.get("progress.md").text, "# 本機新版");
  assert.equal(await files.read("課程/progress.md"), "# 本機新版", "本機不可被雲端覆蓋");
  assert.equal(drive.log.some(([op]) => op === "download"), false, "衍生檔不需要下載來合併");
});

test("localWins：只有雲端變 → 仍以本機為準（本機會在同步後重算）", async () => {
  const drive = fakeDrive();
  const files = fakeFiles({ "課程/progress.md": "# v1" });
  const s = syncer(drive, files, memState());
  await s.syncFile(MD_SPEC);
  drive.files.get("progress.md").text = "# 別台推上來的";
  const r = await s.syncFile(MD_SPEC);
  assert.equal(r.action, "upload");
  assert.equal(await files.read("課程/progress.md"), "# v1");
});

test("localWins：本機沒有 → 從雲端取回（新機器第一次）", async () => {
  const drive = fakeDrive({ "progress.md": "# 雲端版" });
  const files = fakeFiles();
  const r = await syncer(drive, files, memState()).syncFile(MD_SPEC);
  assert.equal(r.action, "download");
  assert.equal(await files.read("課程/progress.md"), "# 雲端版");
});

test("localWins：兩邊都沒變 → up-to-date，不做多餘上傳", async () => {
  const drive = fakeDrive();
  const files = fakeFiles({ "課程/progress.md": "# v1" });
  const s = syncer(drive, files, memState());
  await s.syncFile(MD_SPEC);
  drive.log.length = 0;
  assert.equal((await s.syncFile(MD_SPEC)).action, "up-to-date");
  assert.equal(drive.log.some(([op]) => op === "updateFile"), false);
});

test("localWins 不需要 merge 函式也不會丟錯", async () => {
  const drive = fakeDrive({ "progress.md": "# 雲端" });
  const files = fakeFiles({ "課程/progress.md": "# 本機" });
  await assert.doesNotReject(() => syncer(drive, files, memState()).syncFile(MD_SPEC));
});

test("merge 的統計欄位要原樣往上帶（CSV 的 bad、notes 的 conflicts 都要看得到）", async () => {
  const drive = fakeDrive({ "x.md": "remote" });
  const files = fakeFiles({ "課程/x.md": "local" });
  const spec = {
    key: "course/x.md",
    localPath: "課程/x.md",
    remoteName: "x.md",
    merge: () => ({ text: "merged", total: 3, added: 1, conflicts: 2 }),
  };
  const r = await syncer(drive, files, memState()).syncFile(spec);
  assert.equal(r.action, "merge");
  assert.equal(r.conflicts, 2, "conflicts 被吞掉的話 popup 顯示不出衝突數");
  assert.equal(r.total, 3);
  assert.equal(r.added, 1);
});

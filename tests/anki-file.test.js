import test from "node:test";
import assert from "node:assert/strict";
import { MAX_CARD_JSON_BYTES, readCardJsonFile } from "../src/anki/file.js";

test("readCardJsonFile 在讀取前拒絕超過上限的檔案", async () => {
  let read = false;
  const file = { size: MAX_CARD_JSON_BYTES + 1, text: async () => { read = true; return "{}"; } };
  await assert.rejects(() => readCardJsonFile(file), /過大/);
  assert.equal(read, false);
});

test("readCardJsonFile 解析上限內 JSON 並拒絕 UTF-8 bytes 超限或壞 JSON", async () => {
  assert.deepEqual(await readCardJsonFile({ size: 7, text: async () => '{"a":1}' }), { a: 1 });
  await assert.rejects(() => readCardJsonFile({ size: 1, text: async () => `"${"界".repeat(MAX_CARD_JSON_BYTES)}"` }), /過大/);
  await assert.rejects(() => readCardJsonFile({ size: 1, text: async () => "{" }), /JSON/);
});

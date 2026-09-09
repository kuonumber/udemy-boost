export const MAX_CARD_JSON_BYTES = 1024 * 1024;

export async function readCardJsonFile(file) {
  if (!file || typeof file.text !== "function" || !Number.isFinite(file.size) || file.size < 0) throw new TypeError("卡片 JSON 檔案無效");
  if (file.size > MAX_CARD_JSON_BYTES) throw new Error("卡片 JSON 檔案過大");
  const raw = await file.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_CARD_JSON_BYTES) throw new Error("卡片 JSON 檔案過大");
  try { return JSON.parse(raw); } catch (error) { throw new Error(`卡片 JSON 無法解析：${error.message}`, { cause: error }); }
}

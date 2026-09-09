import { cardFingerprint } from "./cards.js";

const ENDPOINT = "http://127.0.0.1:8765";

export class AnkiConnectError extends Error {
  constructor(message, { cause } = {}) {
    super(message, { cause });
    this.name = "AnkiConnectError";
  }
}

export function createAnkiClient({ fetchFn = fetch, endpoint = ENDPOINT, timeoutMs = 5000 } = {}) {
  return Object.freeze({
    async invoke(action, params = {}) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let response;
      try {
        response = await fetchFn(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, version: 6, params }),
          signal: controller.signal,
        });
      } catch (error) {
        if (error?.name === "AbortError") throw new AnkiConnectError("AnkiConnect 連線逾時", { cause: error });
        throw new AnkiConnectError(`AnkiConnect 連線失敗：${error?.message ?? String(error)}`, { cause: error });
      } finally {
        clearTimeout(timer);
      }
      if (!response?.ok) throw new AnkiConnectError(`AnkiConnect HTTP 錯誤 ${response?.status ?? "unknown"}`);
      let body;
      try { body = await response.json(); } catch (error) { throw new AnkiConnectError("AnkiConnect 回傳的 JSON 無法解析", { cause: error }); }
      if (!body || typeof body !== "object" || !("result" in body) || !("error" in body)) throw new AnkiConnectError("AnkiConnect 回應格式無效");
      if (body.error != null) throw new AnkiConnectError(`AnkiConnect：${body.error}`);
      return body.result;
    },
  });
}

const escapeHtml = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const htmlText = (value) => escapeHtml(value).replaceAll("\n", "<br>");
const safeTag = (value) => String(value).trim().replace(/\s+/gu, "_").replace(/["']/gu, "");
const emptyCounts = () => ({ added: 0, duplicate: 0, rejected: 0, failed: 0 });

export async function syncCardsToAnki(packageData, { invoke = createAnkiClient().invoke, selectedIndices = packageData.cards.map((_card, index) => index) } = {}) {
  if (!Array.isArray(selectedIndices)) throw new TypeError("selectedIndices 必須是陣列");
  const selected = [...new Set(selectedIndices)];
  const deck = `Udemy Boost::${packageData.course.title}`;
  if (!selected.length) return { deck, counts: emptyCounts(), items: [] };
  if (selected.some((index) => !Number.isInteger(index) || index < 0 || index >= packageData.cards.length)) throw new RangeError("selectedIndices 超出範圍");

  const version = await invoke("version");
  if (version !== 6) throw new AnkiConnectError(`需要 AnkiConnect API 版本 6，目前為 ${version}`);
  const decks = await invoke("deckNames");
  if (!Array.isArray(decks)) throw new AnkiConnectError("deckNames 回應格式無效");
  if (!decks.includes(deck)) await invoke("createDeck", { deck });
  const models = await invoke("modelNames");
  const aliases = {
    basic: [{ model: "Basic", front: "Front", back: "Back" }, { model: "基本型", front: "正面", back: "背面" }],
    cloze: [{ model: "Cloze", front: "Text", back: "Back Extra" }, { model: "克漏字", front: "文字", back: "背面額外內容" }],
  };
  const resolved = {};
  for (const type of new Set(selected.map((index) => packageData.cards[index].type))) {
    resolved[type] = aliases[type].find((candidate) => models?.includes(candidate.model));
    if (!resolved[type]) throw new AnkiConnectError(`Anki 缺少 ${type === "cloze" ? "Cloze／克漏字" : "Basic／基本型"} note type`);
  }

  const pending = [];
  const items = [];
  for (const index of selected) {
    const card = packageData.cards[index];
    const fingerprint = await cardFingerprint(card, { courseId: packageData.course.id, unitId: packageData.unit.id });
    const duplicateIds = await invoke("findNotes", { query: `tag:ub-id::${fingerprint}` });
    if (Array.isArray(duplicateIds) && duplicateIds.length) {
      items.push({ index, status: "duplicate", noteId: duplicateIds[0], fingerprint });
      continue;
    }
    const source = `<hr><small>來源：<a href="${escapeHtml(packageData.unit.url)}">${htmlText(packageData.unit.title)}</a> · ${card.sourceStartSec}–${card.sourceEndSec}s<br>選卡理由：${htmlText(card.reason)}</small>`;
    const model = resolved[card.type];
    const fields = card.type === "basic"
      ? { [model.front]: htmlText(card.front), [model.back]: `${htmlText(card.back)}${source}` }
      : { [model.front]: htmlText(card.text), [model.back]: `${htmlText(card.extra)}${source}` };
    pending.push({
      index,
      fingerprint,
      note: {
        deckName: deck,
        modelName: model.model,
        fields,
        options: { allowDuplicate: false },
        tags: [...new Set(["udemy-boost", `ub-course::${safeTag(packageData.course.slug)}`, `ub-unit::${safeTag(packageData.unit.id)}`, `ub-id::${fingerprint}`, ...card.tags.map(safeTag).filter(Boolean)])],
      },
    });
  }

  if (pending.length) {
    const allowed = await invoke("canAddNotes", { notes: pending.map((entry) => entry.note) });
    const addable = pending.filter((_entry, index) => allowed?.[index] === true);
    items.push(...pending.filter((_entry, index) => allowed?.[index] !== true).map(({ index, fingerprint }) => ({ index, status: "rejected", fingerprint, error: "AnkiConnect canAddNotes rejected" })));
    if (addable.length) {
      const noteIds = await invoke("addNotes", { notes: addable.map((entry) => entry.note) });
      addable.forEach(({ index, fingerprint }, resultIndex) => {
        const noteId = noteIds?.[resultIndex];
        items.push(noteId == null ? { index, status: "failed", fingerprint, error: "AnkiConnect addNotes 未回傳 note ID" } : { index, status: "added", fingerprint, noteId });
      });
    }
  }
  items.sort((a, b) => a.index - b.index);
  const counts = emptyCounts();
  for (const item of items) counts[item.status]++;
  return { deck, counts, items };
}

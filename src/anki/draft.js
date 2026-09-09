import { validateCardPackage } from "./cards.js";

const RESULT_STATUSES = new Set(["added", "duplicate", "rejected", "failed"]);
const clone = (value) => structuredClone(value);

function validateDraft(draft) {
  if (!draft || typeof draft !== "object" || !Array.isArray(draft.cards)) throw new TypeError("draft 格式無效");
  return draft;
}

export function createDraft(packageData, { itemId = null, updatedAt = new Date().toISOString() } = {}) {
  const validated = validateCardPackage(packageData);
  const { cards, ...metadata } = validated;
  return { schemaVersion: 1, itemId, updatedAt, package: metadata, cards: cards.map((card) => ({ card, selected: true, syncStatus: "pending", noteId: null, error: null })) };
}

export function draftPackage(draft) {
  validateDraft(draft);
  return { ...clone(draft.package), cards: draft.cards.map((entry) => clone(entry.card)) };
}

export function editDraftCard(draft, index, changes) {
  validateDraft(draft);
  if (!Number.isInteger(index) || index < 0 || index >= draft.cards.length) throw new RangeError("card index 超出範圍");
  if (!changes || typeof changes !== "object" || Array.isArray(changes)) throw new TypeError("changes 必須是物件");
  const allowed = new Set(["selected", "front", "back", "text", "extra", "sourceStartSec", "sourceEndSec", "reason", "tags"]);
  const unknown = Object.keys(changes).filter((key) => !allowed.has(key));
  if (unknown.length) throw new Error(`修改包含未知欄位：${unknown.join(", ")}`);
  const next = clone(draft);
  const entry = next.cards[index];
  if ("selected" in changes) entry.selected = Boolean(changes.selected);
  for (const [key, value] of Object.entries(changes)) if (key !== "selected") entry.card[key] = value;
  const validated = validateCardPackage(draftPackage(next));
  next.cards[index].card = validated.cards[index];
  if (Object.keys(changes).some((key) => key !== "selected")) Object.assign(next.cards[index], { syncStatus: "pending", noteId: null, error: null });
  next.updatedAt = new Date().toISOString();
  return next;
}

export function selectedPendingIndices(draft) {
  validateDraft(draft);
  return draft.cards.flatMap((entry, index) => (entry.selected && !["added", "duplicate"].includes(entry.syncStatus) ? [index] : []));
}

export function markSyncResults(draft, results) {
  validateDraft(draft);
  if (!Array.isArray(results)) throw new TypeError("results 必須是陣列");
  const seen = new Set();
  const next = clone(draft);
  for (const result of results) {
    if (!Number.isInteger(result?.index) || result.index < 0 || result.index >= next.cards.length) throw new RangeError("result index 超出範圍");
    if (seen.has(result.index)) throw new Error(`result index 重複：${result.index}`);
    seen.add(result.index);
    if (!RESULT_STATUSES.has(result.status)) throw new Error(`未知 sync status：${result.status}`);
    Object.assign(next.cards[result.index], { syncStatus: result.status, noteId: result.noteId ?? null, error: result.error ?? null });
  }
  next.updatedAt = new Date().toISOString();
  return next;
}

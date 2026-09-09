import test from "node:test";
import assert from "node:assert/strict";
import { createDraft, editDraftCard, markSyncResults, selectedPendingIndices } from "../src/anki/draft.js";

const card = (n) => ({ type: "basic", front: `Q${n}`, back: `A${n}`, sourceStartSec: n, sourceEndSec: n + 1, reason: "核心", tags: ["tag"] });
const packageData = {
  schemaVersion: 1,
  course: { id: "42", title: "Course", slug: "course" },
  unit: { id: "12", chapterTitle: "Chapter", title: "Unit", url: "https://www.udemy.com/course/course/learn/lecture/12" },
  cards: [card(1), card(2), card(3), card(4), card(5)],
  warnings: [],
};

test("createDraft 預設全選並保存來源 item 與同步狀態", () => {
  const draft = createDraft(packageData, { itemId: "item-1", updatedAt: "2026-09-07T00:00:00Z" });
  assert.equal(draft.itemId, "item-1");
  assert.deepEqual(draft.cards.map((entry) => [entry.selected, entry.syncStatus]), Array(5).fill([true, "pending"]));
});

test("editDraftCard 可修改與取消卡片但不改動其他卡片", () => {
  const draft = createDraft(packageData, { itemId: "item-1" });
  const edited = editDraftCard(draft, 1, { front: "Updated", selected: false });
  assert.equal(edited.cards[1].card.front, "Updated");
  assert.equal(edited.cards[1].selected, false);
  assert.equal(edited.cards[0].card.front, "Q1");
  assert.equal(draft.cards[1].card.front, "Q2");
});

test("editDraftCard 拒絕越界、未知欄位與會破壞卡片契約的修改", () => {
  const draft = createDraft(packageData, { itemId: "item-1" });
  assert.throws(() => editDraftCard(draft, -1, {}), /index/);
  assert.throws(() => editDraftCard(draft, 9, {}), /index/);
  assert.throws(() => editDraftCard(draft, 0, { unknown: true }), /未知/);
  assert.throws(() => editDraftCard(draft, 0, { front: " " }), /front/);
});

test("selectedPendingIndices 排除取消及已成功同步卡片", () => {
  let draft = createDraft(packageData, { itemId: "item-1" });
  draft = editDraftCard(draft, 1, { selected: false });
  draft = markSyncResults(draft, [{ index: 2, status: "added", noteId: 99 }]);
  assert.deepEqual(selectedPendingIndices(draft), [0, 3, 4]);
});

test("markSyncResults 保存逐張結果並拒絕未知狀態或重複 index", () => {
  const draft = createDraft(packageData, { itemId: "item-1" });
  const next = markSyncResults(draft, [
    { index: 0, status: "duplicate", noteId: 10 },
    { index: 1, status: "failed", error: "offline" },
  ]);
  assert.equal(next.cards[0].syncStatus, "duplicate");
  assert.equal(next.cards[1].error, "offline");
  assert.throws(() => markSyncResults(draft, [{ index: 0, status: "wat" }]), /status/);
  assert.throws(() => markSyncResults(draft, [{ index: 0, status: "added" }, { index: 0, status: "failed" }]), /重複/);
});


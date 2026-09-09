import test from "node:test";
import assert from "node:assert/strict";
import { renderStudyPack } from "../src/anki/study-pack.js";
import { validateCardPackage } from "../src/anki/cards.js";
import { createDraft, draftPackage, editDraftCard, markSyncResults, selectedPendingIndices } from "../src/anki/draft.js";
import { syncCardsToAnki } from "../src/anki/client.js";

const card = (n) => ({ type: "basic", front: `Q${n}`, back: `A${n}`, sourceStartSec: n, sourceEndSec: n + 1, reason: "核心", tags: ["concept"] });

test("完整流程：匯出 → 匯入 → 編輯／取消 → 同步 → 成功卡不重送", async () => {
  const course = { id: "42", title: "Course", slug: "course" };
  const unit = { id: "12", chapterTitle: "Chapter", title: "Unit", url: "https://www.udemy.com/course/course/learn/lecture/12" };
  const markdown = renderStudyPack({ course, unit, enCues: [{ start: 0, end: 1, text: "lesson" }], zhCues: [] });
  assert.match(markdown, /\[00:00:00\.000 --> 00:00:01\.000\] lesson/);

  const imported = validateCardPackage({ schemaVersion: 1, course, unit, cards: [1, 2, 3, 4, 5].map(card), warnings: [] });
  let draft = createDraft(imported, { itemId: "item-1" });
  draft = editDraftCard(draft, 0, { front: "Edited question" });
  draft = editDraftCard(draft, 1, { selected: false });
  const calls = [];
  const invoke = async (action, params = {}) => {
    calls.push({ action, params });
    return ({ version: 6, deckNames: [], createDeck: 1, modelNames: ["Basic", "Cloze"], findNotes: [], canAddNotes: [true, true, true, true], addNotes: [101, 102, 103, 104] })[action];
  };
  const result = await syncCardsToAnki(draftPackage(draft), { invoke, selectedIndices: selectedPendingIndices(draft) });
  draft = markSyncResults(draft, result.items);
  assert.equal(result.counts.added, 4);
  assert.deepEqual(selectedPendingIndices(draft), []);
  assert.equal(calls.find((call) => call.action === "canAddNotes").params.notes[0].fields.Front, "Edited question");
  assert.equal(calls.find((call) => call.action === "addNotes").params.notes.length, 4);

  const secondCalls = [];
  const second = await syncCardsToAnki(draftPackage(draft), { invoke: async (...args) => secondCalls.push(args), selectedIndices: selectedPendingIndices(draft) });
  assert.equal(second.counts.added, 0);
  assert.equal(secondCalls.length, 0);
});

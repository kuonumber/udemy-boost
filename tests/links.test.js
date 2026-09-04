import { test } from "node:test";
import assert from "node:assert/strict";
import { render } from "../src/download/links.js";

test("render 產出 Markdown：課程標題 → 章節 → 連結", () => {
  const md = render("Complete Blender", [
    { chapter: "01. Intro", lecture: "02. Setup", title: "Blender Library", url: "https://drive.google.com/x" },
    { chapter: "01. Intro", lecture: "03. More", title: "Docs", url: "https://docs.blender.org/" },
    { chapter: "02. Modeling", lecture: "01. Cube", title: "Ref", url: "https://example.com/a" },
  ]);
  assert.equal(
    md,
    [
      "# Complete Blender",
      "",
      "## 01. Intro",
      "",
      "- [Blender Library](https://drive.google.com/x) — 02. Setup",
      "- [Docs](https://docs.blender.org/) — 03. More",
      "",
      "## 02. Modeling",
      "",
      "- [Ref](https://example.com/a) — 01. Cube",
      "",
    ].join("\n"),
  );
});

test("render URL 內的 ) 與空白會 percent-encode，title 內的 ] 會跳脫", () => {
  const md = render("C", [{ chapter: "01. S", lecture: "01. L", title: "a]b", url: "https://x.com/a b)c" }]);
  assert.ok(md.includes("[a\\]b](https://x.com/a%20b%29c)"));
});

test("render 沒有連結 → 只有標題與說明", () => {
  const md = render("C", []);
  assert.equal(md, "# C\n\n（本課程沒有外部連結）\n");
});

test("render title 為空時用 URL 當顯示文字", () => {
  const md = render("C", [{ chapter: "01. S", lecture: "01. L", title: "", url: "https://x.com/" }]);
  assert.ok(md.includes("[https://x.com/](https://x.com/)"));
});

test("render 非陣列丟 TypeError", () => {
  assert.throws(() => render("C", null), TypeError);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { parse, VttParseError, parseTimestamp } from "../src/vtt.js";

// ---------- parseTimestamp ----------

test("parseTimestamp 解析 HH:MM:SS.mmm", () => {
  assert.equal(parseTimestamp("01:02:03.456"), 3723.456);
});

test("parseTimestamp 解析 MM:SS.mmm（Udemy 英文軌格式）", () => {
  assert.equal(parseTimestamp("04.280".padStart(9, "00:00:")), 4.28);
  assert.equal(parseTimestamp("00:04.280"), 4.28);
});

test("parseTimestamp 零值", () => {
  assert.equal(parseTimestamp("00:00:00.000"), 0);
  assert.equal(parseTimestamp("00:00.000"), 0);
});

test("parseTimestamp 非法格式回傳 NaN", () => {
  assert.ok(Number.isNaN(parseTimestamp("abc")));
  assert.ok(Number.isNaN(parseTimestamp("1:2")));
  assert.ok(Number.isNaN(parseTimestamp("")));
  assert.ok(Number.isNaN(parseTimestamp("00:00:00,000"))); // SRT 逗號不接受
});

// ---------- parse: 正常路徑 ----------

const EN = `WEBVTT

1
00:04.280 --> 00:05.960
And welcome to the program.

2
00:06.760 --> 00:09.000
Now let's take a look.
`;

const ZH_CRLF = "WEBVTT\r\n\r\n00:00:04.280 --> 00:00:05.960\r\n歡迎來到程式。\r\n\r\n00:00:06.760 --> 00:00:09.000\r\n現在來看介面。\r\n";

test("parse 英文軌：cue id + MM:SS 格式", () => {
  const cues = parse(EN);
  assert.equal(cues.length, 2);
  assert.deepEqual(cues[0], { start: 4.28, end: 5.96, text: "And welcome to the program." });
  assert.deepEqual(cues[1], { start: 6.76, end: 9.0, text: "Now let's take a look." });
});

test("parse 中文軌：CRLF、無 cue id、HH:MM:SS 格式", () => {
  const cues = parse(ZH_CRLF);
  assert.equal(cues.length, 2);
  assert.equal(cues[0].text, "歡迎來到程式。");
  assert.equal(cues[1].start, 6.76);
});

test("parse 容忍 BOM", () => {
  const cues = parse("﻿" + EN);
  assert.equal(cues.length, 2);
});

test("parse 多行 cue 文字以換行合併", () => {
  const cues = parse("WEBVTT\n\n00:01.000 --> 00:02.000\nline one\nline two\n");
  assert.equal(cues[0].text, "line one\nline two");
});

test("parse 去掉 inline tag 並解碼 entity", () => {
  const cues = parse("WEBVTT\n\n00:01.000 --> 00:02.000\n<v Bob><b>Tom</b> &amp; Jerry &lt;3</v>\n");
  assert.equal(cues[0].text, "Tom & Jerry <3");
});

test("parse 忽略 cue 設定（position/align）", () => {
  const cues = parse("WEBVTT\n\n00:01.000 --> 00:02.000 align:start position:10%\nhi\n");
  assert.equal(cues[0].end, 2);
  assert.equal(cues[0].text, "hi");
});

test("parse 略過 NOTE 與 STYLE 區塊", () => {
  const src = "WEBVTT\n\nNOTE this is a note\nspanning lines\n\nSTYLE\n::cue { color: red }\n\n00:01.000 --> 00:02.000\nok\n";
  const cues = parse(src);
  assert.equal(cues.length, 1);
  assert.equal(cues[0].text, "ok");
});

test("parse WEBVTT header 後可帶描述文字", () => {
  const cues = parse("WEBVTT - some description\n\n00:01.000 --> 00:02.000\nok\n");
  assert.equal(cues.length, 1);
});

test("parse 結果依 start 排序", () => {
  const src = "WEBVTT\n\n00:05.000 --> 00:06.000\nb\n\n00:01.000 --> 00:02.000\na\n";
  const cues = parse(src);
  assert.deepEqual(cues.map((c) => c.text), ["a", "b"]);
});

// ---------- parse: 邊界 ----------

test("parse 只有 header 回傳空陣列", () => {
  assert.deepEqual(parse("WEBVTT\n"), []);
  assert.deepEqual(parse("WEBVTT"), []);
});

test("parse 單一 cue、檔尾無換行", () => {
  const cues = parse("WEBVTT\n\n00:01.000 --> 00:02.000\nonly");
  assert.equal(cues.length, 1);
  assert.equal(cues[0].text, "only");
});

test("parse 丟掉 end < start 的 cue，其餘保留", () => {
  const src = "WEBVTT\n\n00:05.000 --> 00:04.000\nbad\n\n00:06.000 --> 00:07.000\ngood\n";
  const cues = parse(src);
  assert.equal(cues.length, 1);
  assert.equal(cues[0].text, "good");
});

test("parse 丟掉時間格式錯誤的 cue，其餘保留", () => {
  const src = "WEBVTT\n\n00:xx.000 --> 00:04.000\nbad\n\n00:06.000 --> 00:07.000\ngood\n";
  const cues = parse(src);
  assert.equal(cues.length, 1);
});

test("parse 空文字 cue 會被丟掉", () => {
  const src = "WEBVTT\n\n00:01.000 --> 00:02.000\n\n\n00:03.000 --> 00:04.000\nok\n";
  const cues = parse(src);
  assert.equal(cues.length, 1);
  assert.equal(cues[0].text, "ok");
});

// ---------- parse: 非法輸入 ----------

test("parse 缺 WEBVTT header 丟 VttParseError", () => {
  assert.throws(() => parse("00:01.000 --> 00:02.000\nhi\n"), VttParseError);
});

test("parse 非字串輸入丟 VttParseError", () => {
  assert.throws(() => parse(null), VttParseError);
  assert.throws(() => parse(undefined), VttParseError);
  assert.throws(() => parse(123), VttParseError);
});

test("parse 空字串丟 VttParseError", () => {
  assert.throws(() => parse(""), VttParseError);
});

test("parse HTML 錯誤頁（signed URL 過期常見）丟 VttParseError", () => {
  assert.throws(() => parse("<html><body>AccessDenied</body></html>"), VttParseError);
});

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Dựng môi trường DOM cho module markdown (marked + DOMPurify chạy trong window). */
function setupDom() {
  const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
    url: "https://localhost/",
    pretendToBeVisual: true,
    runScripts: "outside-only",
  });
  const { window } = dom;
  const markedSource = fs.readFileSync(path.join(root, "vendor/marked/marked.umd.js"), "utf8");
  const purifySource = fs.readFileSync(path.join(root, "vendor/dompurify/purify.min.js"), "utf8");
  window.eval(markedSource);
  window.eval(purifySource);
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.DOMParser = window.DOMParser;
  globalThis.marked = window.marked;
  globalThis.DOMPurify = window.DOMPurify;
  return window;
}

setupDom();
const { renderMarkdown } = await import("../src/lib/markdown.js");

test("render GFM cơ bản", () => {
  const html = renderMarkdown("# Tiêu đề\n\n**đậm** và *nghiêng*");
  assert.match(html, /<h1>Tiêu đề<\/h1>/);
  assert.match(html, /<strong>đậm<\/strong>/);
  assert.match(html, /<em>nghiêng<\/em>/);
});

test("render danh sách, task list, code block, bảng", () => {
  const html = renderMarkdown(
    ["- [x] đã xong", "- [ ] chưa xong", "", "```js", "const a = 1;", "```", "", "| a | b |", "| - | - |", "| 1 | 2 |"].join("\n")
  );
  assert.match(html, /pdfmd-task/);
  assert.match(html, /☑/);
  assert.match(html, /☐/);
  assert.match(html, /<pre>/);
  assert.match(html, /<table>/);
});

test("loại bỏ script và handler (FR-03.6)", () => {
  const html = renderMarkdown('<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">');
  assert.ok(!/<script/i.test(html));
  assert.ok(!/onerror/i.test(html));
});

test("loại bỏ link javascript: và thẻ nhúng (FR-03.6, FR-03.7)", () => {
  const html = renderMarkdown("[x](javascript:alert(1))\n\n<iframe src=\"https://evil.example\"></iframe>");
  assert.ok(!/javascript:/i.test(html));
  assert.ok(!/<iframe/i.test(html));
});

test("link http mở tab mới với rel an toàn (FR-03.7)", () => {
  const html = renderMarkdown("[x](https://example.com)");
  assert.match(html, /target="_blank"/);
  assert.match(html, /rel="noopener noreferrer"/);
});

test("ảnh remote bị chặn, không tải tài nguyên (FR-03.8, AC-03)", () => {
  const html = renderMarkdown("![](https://tracker.example/x.png)");
  assert.ok(!/<img/i.test(html));
  assert.match(html, /\[ảnh đã chặn\]/);
  assert.ok(!/tracker\.example/i.test(html));
});

test("nội dung rỗng trả về chuỗi rỗng", () => {
  assert.equal(renderMarkdown(""), "");
  assert.equal(renderMarkdown("   \n  "), "");
});

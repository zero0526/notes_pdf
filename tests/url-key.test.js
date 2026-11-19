import test from "node:test";
import assert from "node:assert/strict";

import { normalizePdfUrl, looksLikePdfUrl, pageFromHash } from "../src/lib/url-key.js";

test("loại tham số token phiên/xác thực/tracking (FR-05.5, AC-21)", () => {
  assert.equal(
    normalizePdfUrl("https://x.com/a.pdf?token=abc&page=2#page=5"),
    "https://x.com/a.pdf?page=2"
  );
  assert.equal(
    normalizePdfUrl("https://x.com/a.pdf?token=xyz789&page=2"),
    "https://x.com/a.pdf?page=2"
  );
  assert.equal(
    normalizePdfUrl("https://cdn.x.com/f.pdf?X-Amz-Signature=xx&id=7"),
    "https://cdn.x.com/f.pdf?id=7"
  );
  assert.equal(
    normalizePdfUrl("https://x.com/a.pdf?v=2&utm_source=tw"),
    "https://x.com/a.pdf?v=2"
  );
  assert.equal(
    normalizePdfUrl("https://x.com/a.pdf?fbclid=abc&gclid=def"),
    "https://x.com/a.pdf"
  );
});

test("giữ tham số thường và sắp xếp theo tên rồi giá trị", () => {
  assert.equal(
    normalizePdfUrl("https://x.com/a.pdf?b=2&a=1"),
    "https://x.com/a.pdf?a=1&b=2"
  );
  assert.equal(
    normalizePdfUrl("https://x.com/a.pdf?a=2&a=1"),
    "https://x.com/a.pdf?a=1&a=2"
  );
});

test("giữ nguyên scheme/host/pathname và bỏ hash", () => {
  assert.equal(
    normalizePdfUrl("https://x.com/dir/a.pdf#page=12"),
    "https://x.com/dir/a.pdf"
  );
  assert.equal(normalizePdfUrl("file:///home/me/a.pdf"), "file:///home/me/a.pdf");
});

test("URL không hợp lệ trả về chuỗi rỗng", () => {
  assert.equal(normalizePdfUrl(""), "");
  assert.equal(normalizePdfUrl("không phải url"), "");
});

test("nhận diện URL PDF theo pathname (FR-01.1)", () => {
  assert.equal(looksLikePdfUrl("https://x.com/a.pdf"), true);
  assert.equal(looksLikePdfUrl("https://x.com/a.PDF"), true);
  assert.equal(looksLikePdfUrl("https://x.com/a.pdf?v=2"), true);
  assert.equal(looksLikePdfUrl("https://x.com/a.pdf#page=5"), true);
  assert.equal(looksLikePdfUrl("https://x.com/download?id=1"), false);
  assert.equal(looksLikePdfUrl("blob:https://x.com/abc"), false);
  assert.equal(looksLikePdfUrl("chrome-extension://abc/viewer.html"), false);
});

test("lấy số trang từ fragment (FR-01.7)", () => {
  assert.equal(pageFromHash("https://x.com/a.pdf#page=5"), 5);
  assert.equal(pageFromHash("https://x.com/a.pdf"), null);
});

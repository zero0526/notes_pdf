import test from "node:test";
import assert from "node:assert/strict";

import { resolveDest, resolveOutline, OUTLINE_STATUS } from "../src/lib/outline.js";

/** PDF giả lập theo API PDF.js. */
function fakeDocument({ outline, numPages = 100, named = {} }) {
  return {
    numPages,
    async getOutline() {
      return outline;
    },
    async getDestination(name) {
      return named[name] ?? null;
    },
    async getPageIndex(ref) {
      if (ref && typeof ref === "object" && typeof ref.index === "number") return ref.index;
      throw new Error("dest không hợp lệ");
    },
  };
}

test("dest dạng ref trang → getPageIndex + 1 (FR-08.5)", async () => {
  const page = await resolveDest(fakeDocument({ outline: null }), [{ index: 4 }], 100);
  assert.equal(page, 5);
});

test("dest dạng số nguyên → giá trị + 1 (FR-08.5, AC-15)", async () => {
  const page = await resolveDest(fakeDocument({ outline: null }), [6], 100);
  assert.equal(page, 7);
});

test("dest named không tồn tại → bỏ qua (FR-08.4, FR-08.6, AC-10)", async () => {
  const page = await resolveDest(fakeDocument({ outline: null }), "khong-ton-tai", 100);
  assert.equal(page, null);
});

test("dest trỏ tới trang ngoài numPages → bỏ qua (FR-08.6)", async () => {
  const page = await resolveDest(fakeDocument({ outline: null }), [500], 100);
  assert.equal(page, null);
});

test("phân giải outline: chương liên tiếp không có khoảng trống (AC-07)", async () => {
  const doc = fakeDocument({
    outline: [
      { title: "Chương 1", dest: [0] },
      { title: "Chương 2", dest: [9] },
    ],
    numPages: 30,
  });
  const result = await resolveOutline(doc, { numPages: 30 });
  assert.equal(result.status, OUTLINE_STATUS.OK);
  assert.equal(result.chapters.length, 2);
  assert.deepEqual(
    result.chapters.map((c) => [c.start, c.end]),
    [
      [1, 9],
      [10, 30],
    ]
  );
});

test("outline rỗng → trạng thái none (FR-08.2)", async () => {
  const result = await resolveOutline(fakeDocument({ outline: null }));
  assert.equal(result.status, OUTLINE_STATUS.NONE);
});

test("item lỗi không ảnh hưởng các item khác (FR-08.6)", async () => {
  const doc = fakeDocument({
    outline: [
      { title: "Lỗi", dest: "khong-ton-tai" },
      { title: "Chương 1", dest: [0] },
    ],
    numPages: 20,
  });
  const result = await resolveOutline(doc, { numPages: 20 });
  assert.equal(result.status, OUTLINE_STATUS.OK);
  assert.equal(result.chapters.length, 1);
  assert.equal(result.chapters[0].title, "Chương 1");
});

test("trùng trang bắt đầu → giữ chương đầu tiên (FR-08.8)", async () => {
  const doc = fakeDocument({
    outline: [
      { title: "A", dest: [0] },
      { title: "B", dest: [0] },
    ],
    numPages: 20,
  });
  const result = await resolveOutline(doc, { numPages: 20 });
  assert.equal(result.chapters.length, 1);
  assert.equal(result.chapters[0].title, "A");
});

test("quá thời gian 3s → trạng thái timeout (FR-08.10)", async () => {
  const doc = {
    numPages: 10,
    async getOutline() {
      await new Promise((resolve) => setTimeout(resolve, 200));
      return [{ title: "Chậm", dest: [0] }];
    },
    async getDestination() {
      return null;
    },
    async getPageIndex() {
      return 0;
    },
  };
  const result = await resolveOutline(doc, { timeoutMs: 30, numPages: 10 });
  assert.equal(result.status, OUTLINE_STATUS.TIMEOUT);
});

import test from "node:test";
import assert from "node:assert/strict";

import * as ops from "../src/lib/state-ops.js";

function stateWith(overrides = {}) {
  return { ...ops.createDefaultState(1000), ...overrides };
}

test("rangeKey đúng định dạng D-01", () => {
  assert.equal(ops.rangeKey(3, 15), "3-15");
  assert.deepEqual(ops.parseRangeKey("3-15"), { start: 3, end: 15 });
  assert.equal(ops.parseRangeKey("0-15"), null);
  assert.equal(ops.parseRangeKey("03-15"), null);
});

test("ưu tiên đơn vị manual → chapter → chunk (FR-02.7)", () => {
  const state = stateWith({
    ranges: [
      { start: 1, end: 10, source: "chapter", createdAt: 1, updatedAt: 1 },
      { start: 4, end: 4, source: "chunk", createdAt: 1, updatedAt: 1 },
      { start: 5, end: 6, source: "manual", createdAt: 1, updatedAt: 1 },
    ],
  });
  assert.equal(ops.findExistingUnit(state, 5).source, "manual");
  assert.equal(ops.findExistingUnit(state, 4).source, "chapter", "chapter ưu tiên hơn chunk");
  assert.equal(ops.findExistingUnit(state, 2).source, "chapter");
  assert.equal(ops.findExistingUnit(state, 99), null);
});

test("range chunk mới không overlap và bị chặn bởi range kế tiếp (FR-02.8)", () => {
  const state = stateWith({
    ranges: [{ start: 5, end: 8, source: "manual", createdAt: 1, updatedAt: 1 }],
  });
  const range = ops.createChunkRange(state, 3, { numPages: 20, chunk: 5 });
  assert.equal(range.start, 3);
  assert.equal(range.end, 4, "end bị chặn bởi range kế tiếp (5-1)");

  const tail = ops.createChunkRange(state, 9, { numPages: 12, chunk: 5 });
  assert.equal(tail.end, 12, "end bị chặn bởi numPages");

  const after = ops.createChunkRange(state, 9, { numPages: 30, chunk: 2 });
  assert.equal(after.end, 10);
});

test("tạo chapter range từ danh sách chương (FR-09.1)", () => {
  const chapters = [
    { title: "Chương 1", start: 7, end: 24 },
    { title: "Chương 2", start: 25, end: 40 },
  ];
  const range = ops.createChapterRange(10, chapters);
  assert.equal(range.start, 7);
  assert.equal(range.end, 24);
  assert.equal(range.source, "chapter");
  assert.equal(range.title, "Chương 1");
  assert.equal(ops.createChapterRange(3, chapters), null, "front-matter không thuộc chương nào");
});

test("chuẩn hoá state: bổ sung note, dọn khoá mồ côi, chunk hỏng → 1 (D-03, D-06, D-11)", () => {
  const raw = {
    schemaVersion: 2,
    ranges: [
      { start: 1, end: 3, source: "chunk", updatedAt: 5 },
      { start: 1, end: 3, source: "manual", updatedAt: 7 },
    ],
    notes: { "1-3": "abc", "9-9": "orphan" },
    chunk: 999,
    mode: "sai",
  };
  const { state } = ops.normalizeState(raw);
  assert.equal(state.chunk, 1);
  assert.equal(state.mode, "chunk");
  assert.equal(state.ranges.length, 1, "range trùng khoá bị gộp, giữ bản mới hơn");
  assert.equal(state.ranges[0].source, "manual", "giữ bản cập nhật mới hơn");
  assert.equal(state.notes["1-3"], "abc", "mọi range đều có note tương ứng");
  assert.equal(state.notes["9-9"], undefined, "khoá mồ côi bị dọn");
});

test("state thiếu schemaVersion được coi là cấu trúc cũ và mọi range thành manual (FR-05.7, D-10)", () => {
  const raw = {
    ranges: [{ start: 1, end: 2, updatedAt: 3 }],
    notes: { "1-2": "note cũ" },
  };
  const { state, reason } = ops.normalizeState(raw);
  assert.equal(reason, "legacy");
  assert.equal(state.ranges[0].source, "manual");
  assert.equal(state.notes["1-2"], "note cũ");
});

test("schemaVersion mới hơn bị từ chối (D-13)", () => {
  const { state, recovered } = ops.normalizeState({ schemaVersion: 99, ranges: [] });
  assert.equal(recovered, true);
  assert.equal(state.ranges.length, 0);
});

test("tên chương bị cắt còn 500 ký tự (D-12)", () => {
  const raw = {
    schemaVersion: 2,
    ranges: [{ start: 1, end: 2, source: "chapter", title: "x".repeat(900), updatedAt: 1 }],
    notes: {},
  };
  const { state } = ops.normalizeState(raw);
  assert.equal(state.ranges[0].title.length, 500);
});

test("bật Chapter Mode: chunk có nội dung → manual, chunk rỗng → xoá (FR-09.7, AC-18)", () => {
  const state = stateWith({
    ranges: [
      { start: 4, end: 4, source: "chunk", createdAt: 1, updatedAt: 1 },
      { start: 6, end: 6, source: "chunk", createdAt: 1, updatedAt: 1 },
      { start: 30, end: 30, source: "chunk", createdAt: 1, updatedAt: 1 },
    ],
    notes: { "4-4": "nội dung", "6-6": "", "30-30": "" },
  });
  const next = ops.normalizeForChapterMode(state, [{ title: "Chương 1", start: 1, end: 10 }]);
  const byKey = Object.fromEntries(next.ranges.map((r) => [ops.rangeKey(r.start, r.end), r]));
  assert.equal(byKey["4-4"].source, "manual");
  assert.equal(next.notes["4-4"], "nội dung", "không mất ghi chú");
  assert.equal(byKey["6-6"], undefined, "chunk rỗng overlap chương bị dọn");
  assert.equal(byKey["30-30"].source, "chunk", "chunk ngoài chương giữ nguyên");
});

test("sửa khoảng trang: phát hiện xung đột và di trú ghi chú (FR-04.3, FR-04.4, AC-13)", () => {
  const state = stateWith({
    ranges: [
      { start: 3, end: 5, source: "manual", createdAt: 1, updatedAt: 1 },
      { start: 6, end: 8, source: "manual", createdAt: 1, updatedAt: 1 },
      { start: 1, end: 20, source: "chapter", title: "Chương 1", createdAt: 1, updatedAt: 1 },
    ],
    notes: { "3-5": "ABC", "6-8": "XYZ", "1-20": "" },
  });
  const plan = ops.planRangeEdit(state, { start: 3, end: 7, key: "3-5" });
  assert.equal(plan.conflicts.length, 1, "chỉ 6-8 có nội dung nên bị báo xung đột");
  assert.equal(plan.conflicts[0].start, 6);
  const next = plan.nextState;
  assert.equal(next.notes["3-7"], "ABC", "ghi chú di trú sang khoá mới");
  assert.equal(next.notes["6-8"], undefined, "khoá bị xoá");
  assert.equal(next.ranges.find((r) => r.source === "chapter").title, "Chương 1", "range chapter không bị xoá");
  const edited = next.ranges.find((r) => r.start === 3 && r.end === 7);
  assert.equal(edited.source, "manual");
});

test("hợp nhất state khi nhiều tab cùng ghi (FR-11.3)", () => {
  const local = stateWith({
    ranges: [{ start: 1, end: 3, source: "manual", createdAt: 1, updatedAt: 10 }],
    notes: { "1-3": "bản cũ" },
    noteTimes: { "1-3": 10 },
  });
  const remote = {
    ...local,
    notes: { "1-3": "bản mới" },
    noteTimes: { "1-3": 20 },
  };
  const merged = ops.mergeStates(local, remote);
  assert.equal(merged.notes["1-3"], "bản mới");
});

test("tombstone xoá được tôn trọng khi hợp nhất", () => {
  const local = stateWith({
    ranges: [{ start: 1, end: 3, source: "manual", createdAt: 1, updatedAt: 30 }],
    notes: { "1-3": "x" },
    noteTimes: { "1-3": 30 },
    deleted: { "1-3": 40 },
  });
  const remote = {
    ...local,
    notes: { "1-3": "y" },
    noteTimes: { "1-3": 20 },
    deleted: {},
  };
  const merged = ops.mergeStates(local, remote);
  assert.equal(merged.notes["1-3"], undefined);
});

test("modeExplicit được giữ lại khi chuẩn hoá state (FR-09.2)", () => {
  const raw = {
    schemaVersion: 2,
    ranges: [],
    notes: {},
    mode: "chunk",
    modeExplicit: true,
  };
  const { state } = ops.normalizeState(raw);
  assert.equal(state.modeExplicit, true);
  assert.equal(state.mode, "chunk");
});

test("state mặc định chưa có lựa chọn chế độ tường minh", () => {
  const state = ops.createDefaultState(1);
  assert.equal(state.modeExplicit, false);
  assert.equal(state.mode, "chunk");
});

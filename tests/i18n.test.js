import test from "node:test";
import assert from "node:assert/strict";

import { LIMITS, clampPanelWidth } from "../src/lib/i18n.js";

test("clampPanelWidth giữ nguyên giá trị hợp lệ", () => {
  assert.equal(clampPanelWidth(420), 420);
  assert.equal(clampPanelWidth("380"), 380);
});

test("clampPanelWidth kẹp ở hai đầu và làm tròn", () => {
  assert.equal(clampPanelWidth(120), LIMITS.PANEL_WIDTH_MIN);
  assert.equal(clampPanelWidth(9999), LIMITS.PANEL_WIDTH_MAX);
  assert.equal(clampPanelWidth(420.6), 421);
});

test("clampPanelWidth rơi về mặc định khi giá trị rác", () => {
  assert.equal(clampPanelWidth(null), LIMITS.PANEL_WIDTH);
  assert.equal(clampPanelWidth("abc"), LIMITS.PANEL_WIDTH);
  assert.equal(clampPanelWidth(-5), LIMITS.PANEL_WIDTH);
});

test("clampPanelWidth tôn trọng trần theo cửa sổ", () => {
  assert.equal(clampPanelWidth(720, 600), 600);
  assert.equal(clampPanelWidth(720, 200), LIMITS.PANEL_WIDTH_MIN);
  assert.equal(clampPanelWidth(380, Infinity), 380);
});

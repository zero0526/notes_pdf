import test from "node:test";
import assert from "node:assert/strict";

import { stateToMarkdown, slugify, buildIndexJson } from "../src/lib/serialize-md.js";
import * as ops from "../src/lib/state-ops.js";

test("slugify loại ký tự cấm và giới hạn 80 ký tự", () => {
  assert.equal(slugify('A/B:C*D?E"F<G>H|I'), "A-B-C-D-E-F-G-H-I");
  assert.equal(slugify("Tài liệu nghiên cứu"), "Tài-liệu-nghiên-cứu");
  assert.equal(slugify("x".repeat(200)).length, 80);
});

test("file .md có frontmatter, marker và heading (storage design 5.2)", () => {
  const state = ops.createDefaultState(1763280000000);
  state.mode = "chapter";
  state.chunk = 1;
  state.ranges = [
    { start: 1, end: 6, source: "chunk", createdAt: 1, updatedAt: 1763280000000 },
    { start: 7, end: 24, source: "chapter", title: "Chương 1: Tổng quan", createdAt: 1, updatedAt: 1763280600000 },
  ];
  state.notes = { "1-6": "Ghi chú phần mở đầu…", "7-24": "- Ý chính…" };

  const md = stateToMarkdown(state, {
    pdfUrl: "https://example.com/tai-lieu.pdf",
    fingerprint: "abc",
    title: "Tài liệu nghiên cứu",
    fileName: "tai-lieu-1234abcd.md",
  });

  assert.match(md, /^---\n/);
  assert.match(md, /pdfnotes: 1/);
  assert.match(md, /pdfUrl: "https:\/\/example\.com\/tai-lieu\.pdf"/);
  assert.match(md, /mode: chapter/);
  assert.match(md, /<!-- pdfnotes:range \{"key":"1-6","source":"chunk","updatedAt":1763280000000\} -->/);
  assert.match(md, /## Trang 1–6/);
  assert.match(md, /Ghi chú phần mở đầu…/);
  assert.match(md, /## Trang 7–24 — Chương 1: Tổng quan/);
  assert.match(md, /- Ý chính…/);
});

test("file index JSON hợp lệ", () => {
  const json = JSON.parse(
    buildIndexJson([{ pdfUrl: "https://x/a.pdf", fileName: "a-1234abcd.md", title: "A", fingerprint: "f", updatedAt: 1 }])
  );
  assert.equal(json.version, 1);
  assert.equal(json.files.length, 1);
  assert.equal(json.files[0].fileName, "a-1234abcd.md");
});

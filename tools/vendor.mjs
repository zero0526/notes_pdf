#!/usr/bin/env node
/**
 * Đồng bộ thư viện vendor (NFR-M2, NFR-S6):
 *  - Tải bản phân phối chính thức của PDF.js (không dùng CDN lúc chạy).
 *  - Sao chép build/, web/, cmaps/, standard_fonts/, toàn bộ locale vào vendor/pdfjs.
 *  - Vá viewer.html để nạp panel + thư viện Markdown.
 *  - Sao chép marked + DOMPurify vào vendor/.
 *
 * Cách dùng:
 *   node tools/vendor.mjs            # đồng bộ + vá
 *   node tools/vendor.mjs --check    # chỉ kiểm tra trạng thái vá (không tải)
 */

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vendorDir = path.join(root, "vendor");
const cacheDir = path.join(root, ".cache");

const PDFJS_VERSION = "3.11.174";
const PATCH_BEGIN = "<!-- pdfmd:patch:begin -->";
const PATCH_END = "<!-- pdfmd:patch:end -->";

function log(message) {
  process.stdout.write(`[vendor] ${message}\n`);
}

function copyDir(from, to, filter = () => true) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (!filter(source, entry)) continue;
    if (entry.isDirectory()) copyDir(source, target, filter);
    else fs.copyFileSync(source, target);
  }
}

/** Tải & giải nén bản phân phối PDF.js. */
function fetchPdfjsDist(version) {
  const target = path.join(cacheDir, `pdfjs-${version}-dist.zip`);
  if (!fs.existsSync(target)) {
    fs.mkdirSync(cacheDir, { recursive: true });
    const url = `https://github.com/mozilla/pdf.js/releases/download/v${version}/pdfjs-${version}-dist.zip`;
    log(`tải ${url}`);
    execFileSync("curl", ["-fsSL", "-o", target, url], { stdio: "inherit" });
  }
  const extractDir = path.join(cacheDir, `pdfjs-${version}`);
  fs.rmSync(extractDir, { recursive: true, force: true });
  fs.mkdirSync(extractDir, { recursive: true });
  execFileSync("unzip", ["-q", "-o", target, "-d", extractDir], { stdio: "inherit" });
  return extractDir;
}

/** Bản vá viewer.js: bỏ kiểm tra same-origin + cho phép panel chịu trách nhiệm mở tệp. */
function patchViewerJs(file) {
  const source = fs.readFileSync(file, "utf8");
  let updated = source;

  // 1) Extension có host_permissions nên được phép tải PDF cross-origin.
  updated = updated.replace(
    `  var validateFileURL = function (file) {
    if (!file) {
      return;
    }`,
    `  var validateFileURL = function (file) {
    if (!file) {
      return;
    }
    if (location.protocol === "chrome-extension:") {
      // pdfmd: bỏ kiểm tra same-origin cho trang extension.
      return;
    }`
  );

  // 2) Không tự mở tệp trong viewer — panel chịu trách nhiệm (một nguồn tải duy nhất).
  updated = updated.replace(
    `    if (file) {
      this.open({
        url: file
      });`,
    `    if (file && !window.__pdfmdNoAutoOpen) {
      this.open({
        url: file
      });`
  );

  if (updated === source) {
    console.warn("[vendor] CẢNH BÁO: không khớp mẫu vá trong viewer.js — cần cập nhật tools/vendor.mjs");
    return "không vá được";
  }
  fs.writeFileSync(file, updated);
  return "đã vá";
}

/** Bản vá viewer.html (tái lập được sau mỗi lần nâng cấp PDF.js). */
function patchViewerHtml(file) {
  const source = fs.readFileSync(file, "utf8");
  const block = [
    PATCH_BEGIN,
    '    <link rel="stylesheet" href="../../../src/panel/panel.css">',
    '    <script src="../../../vendor/marked/marked.umd.js"></script>',
    '    <script src="../../../vendor/dompurify/purify.min.js"></script>',
    '    <script type="module" src="../../../src/panel/panel.js"></script>',
    PATCH_END,
  ].join("\n");

  if (source.includes(PATCH_BEGIN)) {
    const updated = source.replace(
      new RegExp(`${escapeRegExp(PATCH_BEGIN)}[\\s\\S]*?${escapeRegExp(PATCH_END)}`),
      block
    );
    if (updated !== source) fs.writeFileSync(file, updated);
    return "đã vá lại";
  }

  const anchor = '<link rel="stylesheet" href="viewer.css">';
  if (!source.includes(anchor)) {
    throw new Error("Không tìm thấy điểm chèn trong viewer.html — cần cập nhật tools/vendor.mjs");
  }
  fs.writeFileSync(file, source.replace(anchor, `${anchor}\n\n${block}`));
  return "đã vá";
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * PDF.js không dùng en-US làm fallback khi một locale khác thiếu khoá dịch.
 * Bổ sung các khoá đó để tránh hàng loạt cảnh báo "#key is undefined".
 */
function fillMissingLocaleKeys(localeDir) {
  const fallback = path.join(localeDir, "en-US/viewer.properties");
  if (!fs.existsSync(fallback)) return 0;

  const keyOf = (line) => {
    const match = /^([A-Za-z0-9_.]+)\s*=/.exec(line);
    return match ? match[1] : null;
  };
  const fallbackKeys = new Map();
  for (const line of fs.readFileSync(fallback, "utf8").split(/\r?\n/)) {
    const key = keyOf(line);
    if (key) fallbackKeys.set(key, line);
  }

  let patched = 0;
  for (const entry of fs.readdirSync(localeDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === "en-US") continue;
    const file = path.join(localeDir, entry.name, "viewer.properties");
    if (!fs.existsSync(file)) continue;

    const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
    const known = new Set(lines.map(keyOf).filter(Boolean));
    const missing = [...fallbackKeys].filter(([key]) => !known.has(key)).map(([, line]) => line);
    if (!missing.length) continue;

    const body = lines.join("\n").replace(/\s*$/, "");
    fs.writeFileSync(file, `${body}\n\n# pdfmd: fallback từ en-US (khoá chưa dịch)\n${missing.join("\n")}\n`);
    patched++;
  }
  return patched;
}

function copyVendoredLibs() {
  const modules = path.join(root, "node_modules");
  const marked = path.join(modules, "marked/lib/marked.umd.js");
  const purify = path.join(modules, "dompurify/dist/purify.min.js");
  for (const file of [marked, purify]) {
    if (!fs.existsSync(file)) {
      throw new Error(`Thiếu ${file} — chạy \`npm install\` trước.`);
    }
  }
  fs.mkdirSync(path.join(vendorDir, "marked"), { recursive: true });
  fs.mkdirSync(path.join(vendorDir, "dompurify"), { recursive: true });
  fs.copyFileSync(marked, path.join(vendorDir, "marked/marked.umd.js"));
  fs.copyFileSync(purify, path.join(vendorDir, "dompurify/purify.min.js"));
  log("đã cập nhật marked + DOMPurify");
}

function syncPdfjs() {
  const dist = fetchPdfjsDist(PDFJS_VERSION);
  const source = path.join(dist, "web");
  const target = path.join(vendorDir, "pdfjs");
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(target, { recursive: true });

  fs.mkdirSync(path.join(target, "build"), { recursive: true });
  for (const name of ["pdf.js", "pdf.worker.js"]) {
    fs.copyFileSync(path.join(dist, "build", name), path.join(target, "build", name));
  }

  fs.mkdirSync(path.join(target, "web"), { recursive: true });
  for (const name of ["viewer.html", "viewer.js", "viewer.css"]) {
    fs.copyFileSync(path.join(source, name), path.join(target, "web", name));
  }
  copyDir(path.join(source, "images"), path.join(target, "web/images"));
  copyDir(path.join(source, "cmaps"), path.join(target, "cmaps"));
  copyDir(path.join(source, "standard_fonts"), path.join(target, "standard_fonts"));

  // locale.properties import TẤT CẢ ngôn ngữ; nếu chỉ copy en-US thì trình duyệt
  // ở ngôn ngữ khác (vd. vi) sẽ báo "#... is undefined" cho mọi nhãn trên toolbar.
  copyDir(path.join(source, "locale"), path.join(target, "web/locale"));
  const patchedLocales = fillMissingLocaleKeys(path.join(target, "web/locale"));

  log(`đã đồng bộ PDF.js ${PDFJS_VERSION}`);
  log(`đã bổ sung khoá en-US cho ${patchedLocales} locale chưa dịch đủ`);
  log(`viewer.js ${patchViewerJs(path.join(target, "web/viewer.js"))}`);
  const state = patchViewerHtml(path.join(target, "web/viewer.html"));
  log(`viewer.html ${state}`);
}

function check() {
  const viewer = path.join(vendorDir, "pdfjs/web/viewer.html");
  if (!fs.existsSync(viewer)) {
    log("CHƯA ĐỒNG BỘ: thiếu vendor/pdfjs/web/viewer.html");
    process.exitCode = 1;
    return;
  }
  const source = fs.readFileSync(viewer, "utf8");
  const ok = source.includes(PATCH_BEGIN) && source.includes("src/panel/panel.js");
  log(ok ? "OK: vendor đã đồng bộ và vá" : "CHƯA VÁ: chạy `npm run vendor`");
  if (!ok) process.exitCode = 1;
}

const checkOnly = process.argv.includes("--check");
if (checkOnly) {
  check();
} else {
  copyVendoredLibs();
  syncPdfjs();
  check();
}

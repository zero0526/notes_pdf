#!/usr/bin/env node
/**
 * Kiểm thử khói (smoke test) chạy thật trong Chrome: cài extension, mở PDF,
 * gõ ghi chú, kiểm tra lưu IndexedDB, mở lại để khôi phục, kiểm tra preview.
 *
 * Dùng: node tools/smoke-test.mjs
 * Cần: puppeteer-core + một bản Chrome cho Testing (CHROME_BIN).
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import puppeteer from "puppeteer-core";

import { buildOutlinePdf } from "./make-test-pdf.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const chromeBin =
  process.env.CHROME_BIN ??
  "/tmp/opencode/cft/chrome/linux-157.0.8103.78/chrome-linux64/chrome";
const httpPort = 9344;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function log(message) {
  process.stdout.write(`[smoke] ${message}\n`);
}

function fail(message) {
  process.stderr.write(`[smoke] LỖI: ${message}\n`);
  process.exitCode = 1;
  throw new Error(message);
}

/* ------------------------------------------------------------------ */
/* 1. Tạo PDF thử nghiệm (3 trang)                                     */
/* ------------------------------------------------------------------ */

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pdfmd-smoke-"));
const htmlPath = path.join(tmpDir, "doc.html");
const pdfPath = path.join(tmpDir, "doc.pdf");

fs.writeFileSync(
  htmlPath,
  `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
   @page { size: A4; margin: 2cm; }
   .page { page-break-after: always; font-family: sans-serif; }
   </style></head><body>
   <div class="page"><h1>Trang 1</h1><p>Nội dung trang đầu.</p></div>
   <div class="page"><h1>Trang 2</h1><p>Nội dung trang hai.</p></div>
   <div class="page"><h1>Trang 3</h1><p>Nội dung trang ba.</p></div>
   </body></html>`
);

function runChrome(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(chromeBin, args, { stdio: ["ignore", "pipe", "pipe"] });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`chrome exit ${code}`))));
    setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 60000);
  });
}

await runChrome([
  "--headless=new",
  "--no-sandbox",
  "--disable-gpu",
  `--print-to-pdf=${pdfPath}`,
  "--no-pdf-header-footer",
  `file://${htmlPath}`,
]);
if (!fs.existsSync(pdfPath)) fail("Không tạo được PDF thử nghiệm");
log(`đã tạo PDF thử nghiệm (${fs.statSync(pdfPath).size} byte)`);

/* ------------------------------------------------------------------ */
/* 2. Máy chủ HTTP cục bộ                                               */
/* ------------------------------------------------------------------ */

const outlinePdfPath = path.join(tmpDir, "outline.pdf");
fs.writeFileSync(outlinePdfPath, buildOutlinePdf({ chapters: 2, pagesPerChapter: 3 }));

const server = http.createServer((req, res) => {
  if (req.url.startsWith("/doc.pdf")) {
    res.writeHead(200, { "Content-Type": "application/pdf" });
    res.end(fs.readFileSync(pdfPath));
    return;
  }
  if (req.url.startsWith("/outline.pdf")) {
    res.writeHead(200, { "Content-Type": "application/pdf" });
    res.end(fs.readFileSync(outlinePdfPath));
    return;
  }
  res.writeHead(404);
  res.end("not found");
});
await new Promise((resolve) => server.listen(httpPort, "127.0.0.1", resolve));
log(`máy chủ PDF: http://127.0.0.1:${httpPort}/doc.pdf`);

/* ------------------------------------------------------------------ */
/* 3. Khởi động Chrome với extension                                   */
/* ------------------------------------------------------------------ */

const browser = await puppeteer.launch({
  executablePath: chromeBin,
  headless: true,
  pipe: true,
  protocolTimeout: 120000,
  args: [
    "--no-sandbox",
    "--disable-gpu",
    "--enable-unsafe-extension-debugging",
    `--disable-extensions-except=${root}`,
    `--load-extension=${root}`,
  ],
});
log("Chrome đã khởi động");

let extensionId = null;
for (let attempt = 0; attempt < 60 && !extensionId; attempt += 1) {
  for (const target of browser.targets()) {
    if (target.url().startsWith("chrome-extension://") && target.url().includes("src/background/sw.js")) {
      extensionId = new URL(target.url()).host;
      break;
    }
  }
  if (!extensionId) await sleep(250);
}
if (!extensionId) {
  const urls = browser.targets().map((t) => t.url());
  fail(`Không tìm thấy service worker của extension. Các target: ${urls.join(", ")}`);
}
log(`extension id: ${extensionId}`);

const viewerUrl =
  `chrome-extension://${extensionId}/vendor/pdfjs/web/viewer.html` +
  `?file=${encodeURIComponent(`http://127.0.0.1:${httpPort}/doc.pdf`)}`;

/* ------------------------------------------------------------------ */
/* 4. Tự động chuyển hướng URL .pdf (FR-01, AC-01)                      */
/* ------------------------------------------------------------------ */

const redirectPage = await browser.newPage();
// Việc chuyển hướng có thể huỷ navigation đang chạy → bỏ qua lỗi ERR_ABORTED.
await redirectPage
  .goto(`http://127.0.0.1:${httpPort}/doc.pdf`, { waitUntil: "domcontentloaded", timeout: 30000 })
  .catch(() => {});
await redirectPage
  .waitForFunction(
    `location.protocol === "chrome-extension:" && location.pathname.includes("viewer.html")`,
    { timeout: 20000 }
  )
  .catch(() => fail("URL .pdf không được chuyển hướng sang viewer"));
const redirectedUrl = redirectPage.url();
log(`đã chuyển hướng: ${redirectedUrl.slice(0, 96)}…`);
if (!redirectedUrl.includes(encodeURIComponent("doc.pdf"))) {
  fail("URL viewer không mang tham số file đúng");
}
await redirectPage.close();

/* ------------------------------------------------------------------ */
/* 5. Mở viewer và kiểm tra panel                                      */
/* ------------------------------------------------------------------ */

const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(String(error)));
page.on("dialog", async (dialog) => {
  log(`hộp thoại: ${dialog.type()} — ${dialog.message()}`);
  await dialog.dismiss().catch(() => {});
});
page.on("console", (message) => {
  if (message.type() === "error") pageErrors.push(message.text());
});

await page.goto(viewerUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForSelector("#pdfmd-editor", { timeout: 30000 });
log("panel đã hiển thị");

// Chờ panel xác định được đơn vị ghi chú (PDF phải tải xong).
await page.waitForFunction(
  `/Trang \\d+–\\d+/.test(document.querySelector("#pdfmd-range-title").textContent)`,
  { timeout: 30000 }
);
const rangeTitle = await page.evaluate(() => document.querySelector("#pdfmd-range-title").textContent.trim());
log(`tiêu đề khoảng trang: ${rangeTitle}`);
if (!/Trang \d+–\d+/.test(rangeTitle)) fail(`Tiêu đề khoảng trang sai: ${rangeTitle}`);

await page.waitForFunction("window.PDFViewerApplication?.pdfDocument?.numPages > 0", { timeout: 30000 });
const pageCount = await page.evaluate(() => PDFViewerApplication.pdfDocument.numPages);
log(`số trang PDF: ${pageCount}`);
if (pageCount < 3) fail("PDF không tải được trong viewer");

/* ------------------------------------------------------------------ */
/* 6. Gõ ghi chú và kiểm tra lưu                                       */
/* ------------------------------------------------------------------ */

await page.evaluate(() => {
  const editor = document.querySelector("#pdfmd-editor");
  editor.value = "# Xin chào\n\n- Ý chính";
  editor.dispatchEvent(new Event("input", { bubbles: true }));
});
await sleep(1500);

const statusText = await page.evaluate(() => document.querySelector("#pdfmd-status").textContent.trim());
log(`trạng thái footer: ${statusText}`);
if (!/Đã lưu/.test(statusText)) fail(`Chưa lưu được (footer: ${statusText})`);

const saved = await page.evaluate(async () => {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open("pdf-md-notes-v1");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const store = db.transaction("pdfs", "readonly").objectStore("pdfs");
  const values = await new Promise((resolve) => {
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
  });
  return values;
});
if (!saved.length) fail("IndexedDB không có state nào");
const notes = Object.values(saved[0].notes ?? {});
if (!notes.some((note) => note.includes("Xin chào"))) {
  fail(`Nội dung ghi chú không được lưu: ${JSON.stringify(saved[0].notes)}`);
}
log("ghi chú đã lưu vào IndexedDB");

/* ------------------------------------------------------------------ */
/* 7. Chuyển trang → đơn vị ghi chú mới                                 */
/* ------------------------------------------------------------------ */

await page.evaluate(() => {
  PDFViewerApplication.pdfViewer.currentPageNumber = 2;
});
await sleep(1200);
const titleAfterJump = await page.evaluate(() => document.querySelector("#pdfmd-range-title").textContent.trim());
log(`sau khi chuyển sang trang 2: ${titleAfterJump}`);
if (!/Trang 2–2/.test(titleAfterJump)) fail(`Đơn vị ghi chú không đổi theo trang: ${titleAfterJump}`);

const emptyAfterJump = await page.evaluate(() => document.querySelector("#pdfmd-editor").value);
if (emptyAfterJump.includes("Xin chào")) fail("Ghi chú của trang 1 bị lẫn sang trang 2");

/* ------------------------------------------------------------------ */
/* 7b. Sửa khoảng trang (FR-04, AC-13)                                  */
/* ------------------------------------------------------------------ */

// Quay lại trang 1 (đơn vị đang giữ ghi chú) rồi mở rộng khoảng trang 1 → 3.
await page.evaluate(() => {
  PDFViewerApplication.pdfViewer.currentPageNumber = 1;
});
await sleep(1200);
await page.evaluate(() => {
  document.querySelector("#pdfmd-range-btn").click();
});
await page.waitForSelector("#pdfmd-start", { timeout: 10000 });
await page.evaluate(() => {
  const start = document.querySelector("#pdfmd-start");
  const end = document.querySelector("#pdfmd-end");
  start.value = "1";
  end.value = "3";
  document.querySelector("#pdfmd-apply").click();
});
await sleep(1500);
const edited = await page.evaluate(() => ({
  title: document.querySelector("#pdfmd-range-title").textContent.trim(),
  note: document.querySelector("#pdfmd-editor").value,
}));
log(`sau khi sửa khoảng trang: ${JSON.stringify(edited)}`);
if (!/Trang 1–3/.test(edited.title)) fail(`Sửa khoảng trang không áp dụng: ${edited.title}`);
if (!edited.note.includes("Xin chào")) fail("Ghi chú không được di trú sang khoảng trang mới");

/* ------------------------------------------------------------------ */
/* 8. Mở lại PDF → khôi phục ghi chú                                    */
/* ------------------------------------------------------------------ */

const page2 = await browser.newPage();
await page2.setViewport({ width: 1440, height: 900 });
await page2.bringToFront();
await page2.goto(viewerUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
await page2.waitForSelector("#pdfmd-editor", { timeout: 30000 });
await page2.waitForFunction("window.PDFViewerApplication?.pdfDocument?.numPages > 0", { timeout: 30000 });
// Viewer khôi phục vị trí lần đọc trước (trang 2) — quay lại trang 1 để kiểm tra ghi chú.
await page2.evaluate(() => {
  PDFViewerApplication.pdfViewer.currentPageNumber = 1;
});
await page2.waitForFunction(
  `document.querySelector("#pdfmd-editor").value.includes("Xin chào")`,
  { timeout: 20000 }
);
log("ghi chú được khôi phục khi mở lại PDF");

/* ------------------------------------------------------------------ */
/* 9. Preview & sanitize                                                */
/* ------------------------------------------------------------------ */

await page2.evaluate(() => document.querySelector('[data-tab="preview"]').click());
await sleep(600);
const previewHtml = await page2.evaluate(() => document.querySelector("#pdfmd-preview").innerHTML);
if (!/<h1/i.test(previewHtml)) fail(`Preview không render heading: ${previewHtml.slice(0, 200)}`);
log("preview render GFM OK");

// Sanitize được kiểm thử ở tầng unit (tests/markdown.test.js).

/* ------------------------------------------------------------------ */
/* 8b. Thu gọn / mở rộng panel (FR-06, AC-05)                           */
/* ------------------------------------------------------------------ */

const layout = await page.evaluate(() => ({
  outer: document.querySelector("#outerContainer").getBoundingClientRect().width,
  window: window.innerWidth,
}));
if (layout.window - layout.outer < 300) {
  fail(`Panel chưa thu hẹp vùng PDF: ${JSON.stringify(layout)}`);
}
await page.evaluate(() => document.querySelector("#pdfmd-collapse-btn").click());
await sleep(400);
const collapsed = await page.evaluate(() => ({
  hidden: document.body.classList.contains("pdfmd-panel-hidden"),
  floatingVisible: !document.querySelector("#pdfmd-floating").hidden,
  outer: document.querySelector("#outerContainer").getBoundingClientRect().width,
}));
log(`panel thu gọn: ${JSON.stringify(collapsed)}`);
if (!collapsed.hidden || !collapsed.floatingVisible) fail("Không ẩn panel / thiếu nút nổi");
if (collapsed.outer < layout.window - 10) fail("Vùng PDF chưa mở rộng khi ẩn panel");
await page.evaluate(() => document.querySelector("#pdfmd-floating").click());
await sleep(400);
const expanded = await page.evaluate(() => document.body.classList.contains("pdfmd-panel-hidden"));
if (expanded) fail("Không mở lại được panel");

/* ------------------------------------------------------------------ */
/* 9b. Chế độ "Theo chương" (AC-07, AC-16)                              */
/* ------------------------------------------------------------------ */

const outlineUrl =
  `chrome-extension://${extensionId}/vendor/pdfjs/web/viewer.html` +
  `?file=${encodeURIComponent(`http://127.0.0.1:${httpPort}/outline.pdf`)}`;
const outlinePage = await browser.newPage();
await outlinePage.setViewport({ width: 1440, height: 900 });
await outlinePage.goto(outlineUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
await outlinePage.waitForSelector("#pdfmd-editor", { timeout: 30000 });
await outlinePage.waitForFunction(
  `/Trang \\d+–\\d+/.test(document.querySelector("#pdfmd-range-title").textContent)`,
  { timeout: 30000 }
);
await sleep(1500); // chờ phân giải outline

const outlineState = await outlinePage.evaluate(() => {
  const panel = globalThis.pdfmdPanel;
  return {
    title: document.querySelector("#pdfmd-range-title").textContent.trim(),
    chapter: document.querySelector("#pdfmd-chapter-text").textContent.trim(),
    chip: document.querySelector("#pdfmd-mode-chip").textContent.trim(),
    mode: panel?.doc?.mode,
    outlineStatus: panel?.outlineStatus,
    chapters: panel?.chapters ?? [],
  };
});
log(`chế độ chương: ${JSON.stringify(outlineState)}`);
if (outlineState.outlineStatus !== "ok") fail("Không phân giải được outline");
if (outlineState.mode !== "chapter") fail(`Mặc định phải là Chapter Mode, đang là ${outlineState.mode}`);
if (!/Trang 1–3/.test(outlineState.title)) fail(`Khoảng trang chương 1 sai: ${outlineState.title}`);
if (!/Chương 1/.test(outlineState.chapter)) fail(`Không hiện tên chương: ${outlineState.chapter}`);

// Ghi chú ở trang 1 → sang trang 2 (cùng chương) vẫn giữ.
await outlinePage.evaluate(() => {
  const editor = document.querySelector("#pdfmd-editor");
  editor.value = "Ghi chú chương 1";
  editor.dispatchEvent(new Event("input", { bubbles: true }));
});
await sleep(800);
await outlinePage.evaluate(() => {
  PDFViewerApplication.pdfViewer.currentPageNumber = 2;
});
await sleep(1200);
const keptNote = await outlinePage.evaluate(() => document.querySelector("#pdfmd-editor").value);
if (!keptNote.includes("Ghi chú chương 1")) fail("Chuyển trang trong cùng chương phải giữ ghi chú");

// Sang trang 4 (đầu chương 2) → đơn vị mới, ghi chú trống.
await outlinePage.evaluate(() => {
  PDFViewerApplication.pdfViewer.currentPageNumber = 4;
});
await sleep(1200);
const chapter2 = await outlinePage.evaluate(() => ({
  title: document.querySelector("#pdfmd-range-title").textContent.trim(),
  chapter: document.querySelector("#pdfmd-chapter-text").textContent.trim(),
  note: document.querySelector("#pdfmd-editor").value,
}));
log(`chương 2: ${JSON.stringify(chapter2)}`);
if (!/Trang 4–6/.test(chapter2.title)) fail(`Khoảng trang chương 2 sai: ${chapter2.title}`);
if (!/Chương 2/.test(chapter2.chapter)) fail(`Tên chương 2 sai: ${chapter2.chapter}`);
if (chapter2.note.includes("Ghi chú chương 1")) fail("Ghi chú chương 1 bị lẫn sang chương 2");
await outlinePage.close();

/* ------------------------------------------------------------------ */
/* 10. Popup & Options                                                  */
/* ------------------------------------------------------------------ */

const popupPage = await browser.newPage();
const popupErrors = [];
popupPage.on("pageerror", (error) => popupErrors.push(String(error)));
await popupPage.goto(`chrome-extension://${extensionId}/src/popup/popup.html`, { waitUntil: "domcontentloaded" });
await popupPage.waitForFunction(
  `document.querySelector("#app-version") && document.querySelector("#app-version").textContent.trim() !== ""`,
  { timeout: 15000 }
).catch(() => fail(`Popup không chạy được script: ${popupErrors.join(" | ")}`));
const popupToggle = await popupPage.evaluate(() => document.querySelector("#auto-redirect").checked);
if (popupToggle !== true) fail("Popup: toggle redirect mặc định phải bật");
const popupVersion = await popupPage.evaluate(() => document.querySelector("#app-version").textContent.trim());
if (!/^v\d+\.\d+\.\d+$/.test(popupVersion)) fail(`Popup chưa chạy script: version = "${popupVersion}"`);
log(`popup hiển thị OK (${popupVersion})`);

const optionsPage = await browser.newPage();
const optionsErrors = [];
optionsPage.on("pageerror", (error) => optionsErrors.push(String(error)));
await optionsPage.goto(`chrome-extension://${extensionId}/src/options/options.html`, { waitUntil: "domcontentloaded" });
await optionsPage.waitForFunction(
  `document.querySelector("#dir-status") && document.querySelector("#dir-status").textContent.trim() !== ""`,
  { timeout: 15000 }
).catch(() => fail(`Options không chạy được script: ${optionsErrors.join(" | ")}`));
const dirStatus = await optionsPage.evaluate(() => document.querySelector("#dir-status").textContent.trim());
if (!dirStatus) fail("Options chưa chạy script (trạng thái thư mục rỗng)");
log(`options: trạng thái thư mục = ${dirStatus}`);
await popupPage.close();
await optionsPage.close();

/* ------------------------------------------------------------------ */
/* 11. Kết thúc                                                         */
/* ------------------------------------------------------------------ */

await browser.close();
server.close();
fs.rmSync(tmpDir, { recursive: true, force: true });

if (pageErrors.length > 0) {
  log(`lỗi JS ghi nhận được: ${pageErrors.slice(0, 5).join(" | ")}`);
}
log("SMOKE TEST PASSED");

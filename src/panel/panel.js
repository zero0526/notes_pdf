/**
 * Note Panel — panel ghi chú trong viewer PDF.js (S1).
 *
 * Trách nhiệm:
 *  - Xác định đơn vị ghi chú theo FR-02.7 (manual → chapter → chunk → tạo mới).
 *  - Soạn Markdown, tự lưu 400ms, flush tại các điểm bắt buộc (FR-03).
 *  - Quản lý khoảng trang (FR-04), chế độ Chương/Trang (FR-09), hiển thị chương (FR-10).
 *  - Mirror file .md (FR-12) + cảnh báo đa tab (FR-11).
 */

import { normalizePdfUrl, pageFromHash } from "../lib/url-key.js";
import * as store from "../lib/notes-store.js";
import * as ops from "../lib/state-ops.js";
import { renderMarkdown } from "../lib/markdown.js";
import { resolveOutline, OUTLINE_STATUS } from "../lib/outline.js";
import { FsMirror, MIRROR_STATUS } from "../lib/fs-mirror.js";
import { STRINGS, ERRORS, LIMITS, clampPanelWidth } from "../lib/i18n.js";

const SOURCE_LABEL = {
  manual: "Khoảng trang",
  chapter: "Chương",
  chunk: "Trang",
};

// Panel chịu trách nhiệm mở tệp PDF (một nguồn tải duy nhất, hỗ trợ file://).
// Gắn cờ đồng bộ trước khi viewer chạy (script module = deferred, chạy trước DOMContentLoaded).
globalThis.__pdfmdNoAutoOpen = true;

class NotePanel {
  constructor() {
    this.pdfUrl = "";
    this.key = "";
    this.doc = ops.createDefaultState();
    this.numPages = 0;
    this.currentPage = 1;
    this.currentUnitKey = null;
    this.chapters = [];
    this.outlineStatus = "pending";
    this.outlineSettled = false;
    this.degraded = false;
    this.activeTab = "write";
    this.saveTimer = null;
    this.previewTimer = null;
    this.pendingSave = null;
    this.saving = false;
    this.mirrorEnabled = true;
    this.conflictInfo = null;
    this.hasOutline = false;
    this.panelWidth = LIMITS.PANEL_WIDTH;

    this.root = null;
    this.els = {};
    this.mirror = null;
    this.tabChannel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("pdfmd:tabs") : null;
  }

  /* ------------------------------------------------------------------ *
   * Khởi tạo
   * ------------------------------------------------------------------ */

  async init() {
    const params = new URLSearchParams(location.search);
    this.pdfUrl = params.get("file") ?? "";

    this.buildDom();
    this.bindEvents();
    await this.loadPanelWidth();
    // Cửa sổ hẹp: panel thành overlay và mặc định ẩn để ưu tiên đọc (UI design 11).
    if (window.innerWidth < 900) this.setPanelVisible(false);

    if (!this.pdfUrl) {
      this.showFatal("Không tìm thấy đường dẫn PDF. Hãy mở một tệp PDF để bắt đầu ghi chú.");
      return;
    }

    this.key = normalizePdfUrl(this.pdfUrl);
    document.title = `${STRINGS.appName} — ${this.pdfUrl.split("/").pop() || "PDF"}`;
    try {
      await chrome.storage.session.set({ lastPdfUrl: this.pdfUrl, lastPdfKey: this.key });
    } catch {
      /* bỏ qua */
    }
    await this.applyEditorFontSize();

    await this.loadState();
    await this.initMirror();
    this.detectIncognito();
    this.detectMultiTab();

    this.connectViewer();
  }

  /** Nạp state từ IndexedDB, tự phục hồi khi dữ liệu hỏng (FR-05.6/05.7). */
  async loadState() {
    let raw = null;
    try {
      raw = await store.getState(this.key);
    } catch (error) {
      console.warn("[pdfmd] Không đọc được IndexedDB:", error);
      this.enterDegradedMode();
      return;
    }

    const result = ops.normalizeState(raw);
    this.doc = result.state;
    this.isNewDocument = raw === null;

    if (result.recovered) {
      // FR-05.6: sao lưu rồi khởi tạo mới.
      try {
        await store.backupState(this.key, raw);
      } catch (error) {
        console.warn("[pdfmd] Không sao lưu được state lỗi:", error);
      }
      this.doc = ops.createDefaultState();
      this.toast(STRINGS.toastDataRecovered);
    } else if (result.reason === "legacy" && raw) {
      // FR-05.7: chuyển đổi cấu trúc cũ, tạo bản sao lưu trước.
      try {
        await store.backupState(this.key, raw);
      } catch (error) {
        console.warn("[pdfmd] Không sao lưu được state cũ:", error);
      }
      await this.saveNow();
    }

    if (this.doc.outlineCache?.chapters?.length) {
      this.chapters = this.doc.outlineCache.chapters;
      this.hasOutline = true;
    }
    this.updateModeChip();
  }

  /** Áp dụng cỡ chữ editor tuỳ chọn trong Settings (UI design khối B). */
  async applyEditorFontSize() {
    try {
      const settings = await chrome.storage.sync.get({ editorFontSize: 13 });
      const size = Math.min(Math.max(Number(settings.editorFontSize) || 13, 11), 18);
      this.els.editor.style.fontSize = `${size}px`;
    } catch {
      /* bỏ qua */
    }
  }

  /** Nạp chiều rộng panel đã lưu (kéo tay hoặc đặt trong Settings). */
  async loadPanelWidth() {
    try {
      const settings = await chrome.storage.sync.get({ panelWidth: LIMITS.PANEL_WIDTH });
      this.applyPanelWidth(settings.panelWidth);
    } catch {
      this.applyPanelWidth(LIMITS.PANEL_WIDTH);
    }
  }

  /** Áp dụng chiều rộng panel, tuỳ chọn ghi nhớ. */
  applyPanelWidth(value, persist = false) {
    const width = clampPanelWidth(value, window.innerWidth - 80);
    this.panelWidth = width;
    document.documentElement.style.setProperty("--pdfmd-panel-width", `${width}px`);
    if (persist) this.persistPanelWidth(width);
  }

  persistPanelWidth(width) {
    try {
      chrome.storage.sync.set({ panelWidth: width });
    } catch {
      /* bỏ qua */
    }
  }

  /** Khởi tạo tầng mirror file .md. */
  async initMirror() {
    this.mirror = new FsMirror({
      onStatus: (status) => this.onMirrorStatus(status),
      onConflict: (info) => this.onMirrorConflict(info),
    });
    await this.mirror.init();
    this.renderBanners();
  }

  /* ------------------------------------------------------------------ *
   * Kết nối viewer PDF.js
   * ------------------------------------------------------------------ */

  async connectViewer() {
    const app = await this.waitForViewerApp();
    if (!app) {
      this.showFatal("Không khởi tạo được trình xem PDF (IF-05).");
      return;
    }
    this.app = app;

    app.eventBus.on("documentloaded", () => this.onDocumentLoaded());
    app.eventBus.on("pagesinit", () => this.onPagesInit());
    app.eventBus.on("pagechanging", (event) => this.onPageChanging(event.pageNumber));
    app.eventBus.on("documenterror", (event) => {
      const reason = event?.reason?.message ?? "Không tải được tệp PDF.";
      console.warn("[pdfmd] Lỗi tải PDF:", reason);
      this.showFatal(
        this.pdfUrl.startsWith("file:")
          ? ERRORS.E01
          : `Không tải được tệp PDF: ${reason}`
      );
    });

    this.startPdfTimeout();
    await this.openPdf();
  }

  /** Chờ PDFViewerApplication sẵn sàng. */
  async waitForViewerApp() {
    const deadline = Date.now() + LIMITS.PDFJS_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const app = globalThis.PDFViewerApplication;
      if (app?.eventBus && app?.initializedPromise) {
        try {
          await app.initializedPromise;
        } catch {
          /* bỏ qua */
        }
        return app;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return null;
  }

  /** Mở tệp PDF trong viewer. */
  async openPdf() {
    const app = this.app;
    if (!app) return;
    try {
      if (this.pdfUrl.startsWith("file:")) {
        // Đọc trước bằng fetch (extension có quyền file) rồi truyền dữ liệu.
        const response = await fetch(this.pdfUrl);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const buffer = await response.arrayBuffer();
        await app.open({ data: new Uint8Array(buffer) });
      } else {
        await app.open({ url: this.pdfUrl });
      }
    } catch (error) {
      console.warn("[pdfmd] Không mở được PDF:", error);
      this.showFatal(
        this.pdfUrl.startsWith("file:")
          ? ERRORS.E01
          : "Không tải được tệp PDF. Kiểm tra lại đường dẫn hoặc quyền truy cập."
      );
    }
  }

  /** Timeout khởi tạo PDF.js (NFR-R3). */
  startPdfTimeout() {
    this.pdfTimeoutTimer = setTimeout(() => {
      if (!this.app?.pdfDocument) {
        this.showFatal("Trình xem PDF không phản hồi trong 15 giây. Tệp PDF có thể đã hỏng hoặc cần mật khẩu.");
      }
    }, LIMITS.PDFJS_TIMEOUT_MS);
  }

  async onDocumentLoaded() {
    clearTimeout(this.pdfTimeoutTimer);
    this.outlineSettled = false;
    const pdfDocument = this.app.pdfDocument;
    if (!pdfDocument) return;
    this.pdfDocument = pdfDocument;
    this.numPages = pdfDocument.numPages ?? 0;

    const fingerprint = pdfDocument.fingerprints?.[0] ?? "";
    this.fingerprint = fingerprint;

    // FR-09.8: dùng cache khi trùng fingerprint + numPages.
    const cache = this.doc.outlineCache;
    if (cache && cache.fingerprint === fingerprint && cache.numPages === this.numPages && cache.chapters.length > 0) {
      this.chapters = cache.chapters;
      this.hasOutline = true;
      this.outlineStatus = OUTLINE_STATUS.OK;
      this.outlineSettled = true;
      this.applyDefaultMode();
      this.renderBanners();
      await this.scheduleSync();
      return;
    }

    this.outlineStatus = "pending";
    this.outlineSettled = false;
    this.renderBanners();
    const result = await resolveOutline(pdfDocument, {
      timeoutMs: LIMITS.OUTLINE_TIMEOUT_MS,
      maxItems: LIMITS.OUTLINE_MAX_ITEMS,
      warnItems: LIMITS.OUTLINE_WARN_ITEMS,
      numPages: this.numPages,
    });

    this.outlineStatus = result.status;
    this.outlineSettled = true;
    this.chapters = result.chapters;
    this.hasOutline = result.chapters.length > 0;

    if (result.status === OUTLINE_STATUS.OK) {
      this.doc.outlineCache = {
        fingerprint,
        numPages: this.numPages,
        chapters: result.chapters,
        resolvedAt: result.resolvedAt,
      };
    } else {
      // E-05: không đọc được mục lục → chia theo số trang.
      if (result.status === OUTLINE_STATUS.TIMEOUT || result.status === OUTLINE_STATUS.FAILED) {
        this.doc.outlineCache = undefined;
        this.addBanner("outline-failed", ERRORS.E05, "warn");
      }
    }

    this.applyDefaultMode();
    this.updateModeChip();
    this.renderBanners();
    await this.saveNow();
    await this.scheduleSync();
  }

  /** FR-09.2: mặc định Chapter Mode nếu có ít nhất 1 chương (trừ khi người dùng đã chọn). */
  applyDefaultMode() {
    if (this.doc.modeExplicit) return;
    if (this.hasOutline) this.doc.mode = ops.MODE.CHAPTER;
  }

  onPagesInit() {
    clearTimeout(this.pdfTimeoutTimer);
    this.numPages = this.app?.pagesCount ?? this.numPages;
    this.currentPage = this.app?.pdfViewer?.currentPageNumber ?? 1;
    this.applyInitialPage();
    this.scheduleSync();
  }

  /** FR-01.7 / AC-20: mở đúng trang theo fragment `#page=N`. */
  applyInitialPage() {
    const target = pageFromHash(this.pdfUrl) ?? pageFromHash(location.href);
    if (!target || !this.app?.pdfViewer) return;
    if (target >= 1 && target <= this.numPages && this.app.pdfViewer.currentPageNumber !== target) {
      this.app.pdfViewer.currentPageNumber = target;
    }
  }

  onPageChanging(pageNumber) {
    this.currentPage = pageNumber;
    this.scheduleSync();
  }

  /* ------------------------------------------------------------------ *
   * Đơn vị ghi chú (FR-02)
   * ------------------------------------------------------------------ */

  /** Xếp các lần đồng bộ đơn vị ghi chú thành hàng đợi tuần tự (tránh chạy song song). */
  scheduleSync() {
    this.syncQueue = (this.syncQueue ?? Promise.resolve())
      .then(() => this.syncUnit())
      .catch((error) => console.warn("[pdfmd] Lỗi đồng bộ đơn vị ghi chú:", error));
    return this.syncQueue;
  }

  async syncUnit() {
    if (!this.numPages) {
      this.setWaiting(true);
      return;
    }
    const page = this.currentPage;
    let range = ops.findExistingUnit(this.doc, page);

    if (!range) {
      if (!this.outlineSettled) {
        // FR-02.7 bước 4b: chờ phân giải outline (tối đa 3 giây) trước khi tạo đơn vị mới.
        this.setWaiting(true);
        return;
      }
      if (this.doc.mode === ops.MODE.CHAPTER && this.hasOutline) {
        range = ops.createChapterRange(page, this.chapters);
      }
      if (!range) {
        range = ops.createChunkRange(this.doc, page, {
          numPages: this.numPages,
          chunk: this.doc.chunk,
        });
      }
      const key = ops.rangeKey(range.start, range.end);
      if (this.doc.ranges.some((item) => ops.rangeKey(item.start, item.end) === key)) {
        range = this.doc.ranges.find((item) => ops.rangeKey(item.start, item.end) === key);
      } else {
        this.doc.ranges = ops.sortRanges([...this.doc.ranges, range]);
        this.doc.notes[key] = "";
        this.doc.noteTimes[key] = Date.now();
        await this.saveNow();
      }
    }

    this.setWaiting(false);
    const key = ops.rangeKey(range.start, range.end);
    if (key === this.currentUnitKey) {
      this.renderUnitHeader(range);
      return;
    }

    // FR-02.4 / FR-03.5(a): flush rồi mới chuyển đơn vị.
    await this.flushNow();
    this.currentUnitKey = key;
    this.loadNoteIntoEditor();
    this.renderUnitHeader(range);
  }

  renderUnitHeader(range) {
    this.els.rangeTitle.textContent = STRINGS.pageRange.replace("{start}", range.start).replace("{end}", range.end);
    this.els.rangeTitle.title = `${SOURCE_LABEL[range.source] ?? range.source}`;
    const chapter = range.title ?? "";
    if (chapter) {
      this.els.chapter.hidden = false;
      this.els.chapterText.textContent = chapter;
      this.els.chapterText.title = chapter;
    } else {
      this.els.chapter.hidden = true;
      this.els.chapterText.textContent = "";
      this.els.chapterText.title = "";
    }
    this.els.editor.setAttribute("aria-label", `${STRINGS.panelTitle} — ${this.els.rangeTitle.textContent}`);
  }

  loadNoteIntoEditor() {
    const note = this.doc.notes[this.currentUnitKey] ?? "";
    this.els.editor.value = note;
    this.els.editor.scrollTop = 0;
    this.renderPreview(true);
  }

  /* ------------------------------------------------------------------ *
   * Lưu trữ (FR-03)
   * ------------------------------------------------------------------ */

  scheduleSave() {
    this.setSaveStatus("saving");
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.saveNow().catch((error) => console.warn("[pdfmd] Lưu thất bại:", error));
    }, LIMITS.AUTOSAVE_DEBOUNCE_MS);
  }

  /** Ghi state lên IndexedDB (hợp nhất với bản ghi mới nhất — FR-11.3). */
  async saveNow() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.degraded) {
      this.setSaveStatus("degraded");
      return;
    }
    if (this.saving) {
      this.pendingSave = true;
      return;
    }
    this.saving = true;
    this.setSaveStatus("saving");
    try {
      this.doc.updatedAt = Date.now();
      let remote = null;
      try {
        remote = await store.getState(this.key);
      } catch {
        remote = null;
      }
      if (remote) {
        this.doc = ops.mergeStates(this.doc, ops.normalizeState(remote).state);
      }
      await store.putState(this.key, this.doc);
      this.setSaveStatus("saved");
      if (this.mirrorEnabled) {
        this.mirror?.markDirty(this.key, this.doc, {
          title: this.documentTitle(),
          fingerprint: this.fingerprint ?? "",
        });
      }
      this.checkSizeWarnings();
    } catch (error) {
      console.warn("[pdfmd] Lỗi khi ghi IndexedDB:", error);
      this.enterDegradedMode();
    } finally {
      this.saving = false;
      if (this.pendingSave) {
        this.pendingSave = false;
        await this.saveNow();
      }
    }
  }

  /** Flush đồng bộ: ghi ghi chú đang soạn + lưu + mirror (FR-03.5). */
  async flushNow() {
    if (this.currentUnitKey) {
      this.doc.notes[this.currentUnitKey] = this.els.editor.value;
      this.doc.noteTimes[this.currentUnitKey] = Date.now();
    }
    await this.saveNow();
    if (this.mirrorEnabled && this.mirror) {
      await this.mirror.flushNow(this.key, this.doc, {
        title: this.documentTitle(),
        fingerprint: this.fingerprint ?? "",
      });
    }
  }

  enterDegradedMode() {
    this.degraded = true;
    this.setSaveStatus("degraded");
    this.addBanner("degraded", ERRORS.E03, "error", {
      label: STRINGS.btnRetry,
      action: async () => {
        store.resetDbCache();
        this.degraded = false;
        this.removeBanner("degraded");
        await this.loadState();
        await this.saveNow();
      },
    });
  }

  checkSizeWarnings() {
    const noteBytes = this.currentUnitKey
      ? new TextEncoder().encode(this.doc.notes[this.currentUnitKey] ?? "").length
      : 0;
    if (noteBytes > LIMITS.NOTE_BYTES) {
      this.addBanner("note-large", ERRORS.E08, "warn");
    }
    const stateBytes = ops.estimateStateBytes(this.doc);
    if (stateBytes > LIMITS.STATE_BYTES) {
      this.addBanner("state-large", STRINGS.statusMemoryFull, "warn");
    }
  }

  /* ------------------------------------------------------------------ *
   * Chế độ Chương / Trang (FR-09)
   * ------------------------------------------------------------------ */

  updateModeChip() {
    const isChapter = this.doc.mode === ops.MODE.CHAPTER;
    this.els.modeChip.textContent = isChapter ? STRINGS.chipChapter : STRINGS.chipChunk;
  }

  async setMode(mode) {
    if (mode === this.doc.mode) return;
    await this.flushNow();
    const previous = this.doc.mode;
    this.doc.mode = mode;
    this.doc.modeExplicit = true;
    if (mode === ops.MODE.CHAPTER && previous === ops.MODE.CHUNK) {
      // FR-09.7: chuẩn hoá range chunk khi bật Chapter Mode.
      this.doc = ops.normalizeForChapterMode(this.doc, this.chapters);
    }
    this.updateModeChip();
    await this.saveNow();
    await this.scheduleSync();
  }

  /* ------------------------------------------------------------------ *
   * Sửa khoảng trang (FR-04)
   * ------------------------------------------------------------------ */

  async editRange() {
    if (!this.currentUnitKey) {
      alert(STRINGS.alertMissingRange);
      return;
    }
    const current = this.doc.ranges.find(
      (range) => ops.rangeKey(range.start, range.end) === this.currentUnitKey
    );
    if (!current) return;

    const values = await this.openRangeDialog(current);
    if (!values) return; // người dùng huỷ

    const { start, end } = values;
    if (!Number.isInteger(start) || start < 1) {
      alert(start < 1 ? STRINGS.alertStartMin : STRINGS.alertNotInteger);
      return;
    }
    if (!Number.isInteger(end)) {
      alert(STRINGS.alertNotInteger);
      return;
    }
    if (end < start) {
      alert(STRINGS.alertEndMin);
      return;
    }
    if (this.numPages && end > this.numPages) {
      alert(STRINGS.alertEndTooBig.replace("{numPages}", String(this.numPages)));
      return;
    }

    const plan = ops.planRangeEdit(this.doc, {
      start,
      end,
      key: this.currentUnitKey,
    });
    if (!plan.nextState) return;

    if (plan.conflicts.length > 0) {
      const confirmed = await this.confirmConflict(plan.conflicts);
      if (!confirmed) return;
    }

    await this.flushNow();
    this.doc = plan.nextState;
    this.currentUnitKey = ops.rangeKey(start, end);
    await this.saveNow();
    this.loadNoteIntoEditor();
    const range = this.doc.ranges.find(
      (item) => ops.rangeKey(item.start, item.end) === this.currentUnitKey
    );
    if (range) this.renderUnitHeader(range);
    this.toast(STRINGS.toastRangeChanged);
  }

  /* ------------------------------------------------------------------ *
   * Giao diện: DOM & sự kiện
   * ------------------------------------------------------------------ */

  buildDom() {
    const root = document.createElement("div");
    root.id = "pdfmd-root";
    root.innerHTML = `
      <aside class="pdfmd-panel" role="complementary" aria-label="${STRINGS.panelTitle}">
        <div class="pdfmd-resizer" id="pdfmd-resizer" role="separator" aria-orientation="vertical"
             aria-label="${STRINGS.resizerTitle}" title="${STRINGS.resizerTitle}" tabindex="0"></div>
        <header class="pdfmd-header">
          <span class="pdfmd-title">${STRINGS.panelTitle}</span>
          <div class="pdfmd-header-actions">
            <button type="button" class="pdfmd-btn pdfmd-btn-text" id="pdfmd-range-btn"
                    title="${STRINGS.btnRangeTitle}" aria-label="${STRINGS.btnRangeTitle}">${STRINGS.btnRange}</button>
            <button type="button" class="pdfmd-btn pdfmd-btn-icon" id="pdfmd-collapse-btn"
                    title="${STRINGS.btnCollapseTitle}" aria-label="${STRINGS.btnCollapseTitle}">${STRINGS.btnCollapse}</button>
          </div>
        </header>
        <div class="pdfmd-banners" id="pdfmd-banners"></div>
        <div class="pdfmd-unit">
          <div class="pdfmd-range-title" id="pdfmd-range-title">${STRINGS.pageRange.replace("{start}", "…").replace("{end}", "…")}</div>
          <div class="pdfmd-chapter" id="pdfmd-chapter" hidden><span class="pdfmd-dot"></span><span id="pdfmd-chapter-text"></span></div>
          <button type="button" class="pdfmd-chip" id="pdfmd-mode-chip" title="${STRINGS.chipTitle}">${STRINGS.chipChunk}</button>
        </div>
        <div class="pdfmd-tabs" role="tablist">
          <button type="button" role="tab" class="pdfmd-tab is-active" data-tab="write" aria-selected="true">${STRINGS.tabWrite}</button>
          <button type="button" role="tab" class="pdfmd-tab" data-tab="preview" aria-selected="false">${STRINGS.tabPreview}</button>
        </div>
        <div class="pdfmd-body">
          <textarea id="pdfmd-editor" class="pdfmd-editor" spellcheck="false"
                    placeholder="${STRINGS.editorPlaceholder}" aria-label="${STRINGS.panelTitle}"></textarea>
          <div id="pdfmd-preview" class="pdfmd-preview" hidden></div>
          <div id="pdfmd-waiting" class="pdfmd-waiting" hidden aria-live="polite">
            <span class="pdfmd-spinner" aria-hidden="true"></span>
            <span>${STRINGS.outlinePending}</span>
          </div>
        </div>
        <footer class="pdfmd-footer">
          <span class="pdfmd-status" id="pdfmd-status" aria-live="polite">${STRINGS.statusReady}</span>
          <span class="pdfmd-mirror" id="pdfmd-mirror">${STRINGS.mirrorOff}</span>
        </footer>
      </aside>
      <button type="button" class="pdfmd-floating" id="pdfmd-floating" hidden
              title="${STRINGS.btnExpandTitle}" aria-label="${STRINGS.btnExpandTitle}">📝</button>
      <div class="pdfmd-modal-root" id="pdfmd-modal-root"></div>
      <div class="pdfmd-toasts" id="pdfmd-toasts" aria-live="polite"></div>
    `;
    document.body.appendChild(root);
    document.body.classList.add("pdfmd-enabled");

    this.root = root;
    this.els = {
      panel: root.querySelector(".pdfmd-panel"),
      resizer: root.querySelector("#pdfmd-resizer"),
      banners: root.querySelector("#pdfmd-banners"),
      rangeTitle: root.querySelector("#pdfmd-range-title"),
      chapter: root.querySelector("#pdfmd-chapter"),
      chapterText: root.querySelector("#pdfmd-chapter-text"),
      modeChip: root.querySelector("#pdfmd-mode-chip"),
      tabs: [...root.querySelectorAll(".pdfmd-tab")],
      editor: root.querySelector("#pdfmd-editor"),
      preview: root.querySelector("#pdfmd-preview"),
      waiting: root.querySelector("#pdfmd-waiting"),
      status: root.querySelector("#pdfmd-status"),
      mirror: root.querySelector("#pdfmd-mirror"),
      floating: root.querySelector("#pdfmd-floating"),
      modalRoot: root.querySelector("#pdfmd-modal-root"),
      toasts: root.querySelector("#pdfmd-toasts"),
      rangeBtn: root.querySelector("#pdfmd-range-btn"),
      collapseBtn: root.querySelector("#pdfmd-collapse-btn"),
    };
  }

  bindEvents() {
    const { editor, rangeBtn, collapseBtn, floating, modeChip, tabs } = this.els;
    this.bindResizer();

    editor.addEventListener("input", () => {
      if (!this.currentUnitKey) return;
      this.doc.notes[this.currentUnitKey] = editor.value;
      this.doc.noteTimes[this.currentUnitKey] = Date.now();
      this.scheduleSave();
      if (this.activeTab === "preview") this.schedulePreview();
    });

    editor.addEventListener("keydown", (event) => {
      // FR-03.9: Ctrl/Cmd+S lưu ngay.
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        this.flushNow().catch(() => {});
      }
    });

    rangeBtn.addEventListener("click", () => this.editRange());
    collapseBtn.addEventListener("click", () => this.setPanelVisible(false));
    floating.addEventListener("click", () => this.setPanelVisible(true));
    modeChip.addEventListener("click", () => this.openModeMenu());

    for (const tab of tabs) {
      tab.addEventListener("click", () => this.setTab(tab.dataset.tab));
    }

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") this.flushNow().catch(() => {});
    });
    window.addEventListener("pagehide", () => this.flushNow().catch(() => {}));
    window.addEventListener("beforeunload", () => {
      if (this.currentUnitKey) {
        this.doc.notes[this.currentUnitKey] = editor.value;
      }
      this.flushNow().catch(() => {});
    });

    if (this.tabChannel) {
      this.tabChannel.onmessage = (event) => {
        const message = event.data ?? {};
        if (message.type === "pdfmd:hello") {
          this.tabChannel.postMessage({ type: "pdfmd:here", key: this.key });
        } else if (message.type === "pdfmd:here") {
          if (message.key === this.key) this.addBanner("multi-tab", STRINGS.bannerMultiTab, "warn");
        }
      };
      this.tabChannel.postMessage({ type: "pdfmd:hello", key: this.key });
    }
  }

  /** Kéo cạnh trái panel để đổi chiều rộng; nhấp đôi/Reset để về mặc định. */
  bindResizer() {
    const resizer = this.els.resizer;
    let pointerId = null;
    let startX = 0;
    let startWidth = 0;

    const onMove = (event) => {
      if (event.pointerId !== pointerId) return;
      this.applyPanelWidth(startWidth + (startX - event.clientX));
    };
    const endDrag = (event) => {
      if (pointerId !== null && event.pointerId !== pointerId) return;
      pointerId = null;
      document.body.classList.remove("pdfmd-resizing");
      resizer.removeEventListener("pointermove", onMove);
      resizer.removeEventListener("pointerup", endDrag);
      resizer.removeEventListener("pointercancel", endDrag);
      this.persistPanelWidth(this.panelWidth);
    };

    resizer.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      pointerId = event.pointerId;
      startX = event.clientX;
      startWidth = this.panelWidth;
      document.body.classList.add("pdfmd-resizing");
      resizer.setPointerCapture?.(pointerId);
      resizer.addEventListener("pointermove", onMove);
      resizer.addEventListener("pointerup", endDrag);
      resizer.addEventListener("pointercancel", endDrag);
    });

    resizer.addEventListener("dblclick", () => {
      this.applyPanelWidth(LIMITS.PANEL_WIDTH, true);
      this.toast(STRINGS.toastPanelWidthReset);
    });

    resizer.addEventListener("keydown", (event) => {
      const step = event.shiftKey ? 48 : 16;
      if (event.key === "ArrowLeft") this.applyPanelWidth(this.panelWidth + step, true);
      else if (event.key === "ArrowRight") this.applyPanelWidth(this.panelWidth - step, true);
      else if (event.key === "Home") {
        this.applyPanelWidth(LIMITS.PANEL_WIDTH, true);
        this.toast(STRINGS.toastPanelWidthReset);
      } else return;
      event.preventDefault();
    });
  }

  setTab(tab) {
    this.activeTab = tab;
    for (const button of this.els.tabs) {
      const active = button.dataset.tab === tab;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", active ? "true" : "false");
    }
    this.els.editor.hidden = tab !== "write";
    this.els.preview.hidden = tab !== "preview";
    if (tab === "preview") this.renderPreview();
  }

  schedulePreview() {
    if (this.previewTimer) clearTimeout(this.previewTimer);
    this.previewTimer = setTimeout(() => this.renderPreview(), LIMITS.PREVIEW_DEBOUNCE_MS);
  }

  /** Render preview (FR-03.10: note > 100KB chỉ render khi bấm nút). */
  renderPreview(force = false) {
    if (this.activeTab !== "preview" && !force) return;
    const note = this.doc.notes[this.currentUnitKey] ?? "";
    const bytes = new TextEncoder().encode(note).length;
    if (bytes > LIMITS.NOTE_BYTES && !force) {
      this.els.preview.innerHTML = "";
      const button = document.createElement("button");
      button.type = "button";
      button.className = "pdfmd-btn pdfmd-btn-text";
      button.textContent = STRINGS.btnRender;
      button.addEventListener("click", () => this.renderPreview(true));
      this.els.preview.appendChild(button);
      return;
    }
    if (!note.trim()) {
      this.els.preview.innerHTML = `<p class="pdfmd-preview-empty">${STRINGS.previewEmpty}</p>`;
      return;
    }
    this.els.preview.innerHTML = renderMarkdown(note);
  }

  setPanelVisible(visible) {
    document.body.classList.toggle("pdfmd-panel-hidden", !visible);
    this.els.panel.setAttribute("aria-hidden", visible ? "false" : "true");
    this.els.floating.hidden = visible;
    if (visible) {
      // FR-06.3: giữ nguyên đơn vị và nội dung đang soạn.
      this.els.editor.focus();
    }
  }

  setWaiting(waiting) {
    this.els.waiting.hidden = !waiting;
    if (waiting) {
      this.els.editor.hidden = true;
      this.els.preview.hidden = true;
    } else {
      this.els.editor.hidden = this.activeTab !== "write";
      this.els.preview.hidden = this.activeTab !== "preview";
    }
  }

  setSaveStatus(status) {
    const labels = {
      ready: STRINGS.statusReady,
      saving: STRINGS.statusSaving,
      saved: STRINGS.statusSaved.replace("{time}", new Date().toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })),
      degraded: STRINGS.statusDegraded,
    };
    this.els.status.textContent = labels[status] ?? STRINGS.statusReady;
    this.els.status.dataset.state = status;
  }

  onMirrorStatus(status) {
    const labels = {
      [MIRROR_STATUS.OK]: STRINGS.mirrorOk,
      [MIRROR_STATUS.NEEDS_GRANT]: STRINGS.mirrorNeedsGrant,
      [MIRROR_STATUS.DENIED]: STRINGS.mirrorNeedsGrant,
      [MIRROR_STATUS.ERROR]: STRINGS.mirrorError,
      [MIRROR_STATUS.PAUSED]: STRINGS.mirrorLocked,
      [MIRROR_STATUS.CONFLICT]: STRINGS.mirrorConflict,
      [MIRROR_STATUS.BROKEN]: STRINGS.mirrorError,
      [MIRROR_STATUS.UNSUPPORTED]: STRINGS.mirrorOff,
      [MIRROR_STATUS.OFF]: STRINGS.mirrorOff,
    };
    this.els.mirror.textContent = labels[status] ?? STRINGS.mirrorOff;
    this.els.mirror.dataset.state = status;
    this.renderBanners();
  }

  onMirrorConflict(info) {
    this.conflictInfo = info;
    this.addBanner("fs-conflict", ERRORS.E14, "warn", {
      label: STRINGS.btnOverwrite,
      action: () => this.resolveConflict("overwrite"),
      secondary: {
        label: STRINGS.btnKeepExternal,
        action: () => this.resolveConflict("keep"),
      },
    });
  }

  async resolveConflict(action) {
    if (!this.conflictInfo) return;
    await this.mirror.resolveConflict(this.key, action);
    this.conflictInfo = null;
    this.removeBanner("fs-conflict");
    if (action === "overwrite") {
      await this.mirror.flushNow(this.key, this.doc, {
        title: this.documentTitle(),
        fingerprint: this.fingerprint ?? "",
      });
    }
    this.renderBanners();
  }

  detectIncognito() {
    try {
      if (chrome?.extension?.inIncognitoContext) {
        this.addBanner("incognito", ERRORS.E09, "info");
      }
    } catch {
      /* bỏ qua */
    }
  }

  detectMultiTab() {
    // Hỏi các tab khác: tab đang mở cùng PDF sẽ trả lời "pdfmd:here".
    this.tabChannel?.postMessage({ type: "pdfmd:hello", key: this.key });
  }

  documentTitle() {
    const name = this.pdfUrl.split(/[?#]/)[0].split("/").pop() ?? "";
    try {
      return decodeURIComponent(name.replace(/\.pdf$/i, "")) || "tai-lieu";
    } catch {
      return name || "tai-lieu";
    }
  }

  /* ------------------------------------------------------------------ *
   * Banner & toast
   * ------------------------------------------------------------------ */

  /**
   * @param {string} id
   * @param {string} message
   * @param {"info"|"warn"|"error"} level
   * @param {{label?:string, action?:Function, secondary?:{label:string, action:Function}}} [actions]
   */
  addBanner(id, message, level = "info", actions = {}) {
    this.removeBanner(id);
    const banner = document.createElement("div");
    banner.className = `pdfmd-banner is-${level}`;
    banner.dataset.id = id;
    const text = document.createElement("span");
    text.className = "pdfmd-banner-text";
    text.textContent = message;
    banner.appendChild(text);

    if (actions.label && actions.action) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "pdfmd-btn pdfmd-btn-text";
      button.textContent = actions.label;
      button.addEventListener("click", actions.action);
      banner.appendChild(button);
    }
    if (actions.secondary?.label && actions.secondary.action) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "pdfmd-btn pdfmd-btn-text";
      button.textContent = actions.secondary.label;
      button.addEventListener("click", actions.secondary.action);
      banner.appendChild(button);
    }

    this.els.banners.appendChild(banner);
    this.limitBanners();
  }

  /** @param {string} id */
  removeBanner(id) {
    this.els.banners.querySelector(`[data-id="${id}"]`)?.remove();
  }

  /** Tối đa 2 banner; phần còn lại gom vào toast (UI design 3.5). */
  limitBanners() {
    const banners = [...this.els.banners.children];
    while (banners.length > 2) {
      const overflow = banners.shift();
      this.toast(overflow.textContent ?? "");
      overflow.remove();
    }
  }

  renderBanners() {
    const status = this.mirror?.status;
    if (status === MIRROR_STATUS.NEEDS_GRANT || status === MIRROR_STATUS.DENIED) {
      this.addBanner("fs-grant", STRINGS.bannerGrant, "warn", {
        label: STRINGS.btnGrant,
        action: async () => {
          const ok = await this.mirror.requestGrant();
          if (ok) {
            this.toast(STRINGS.toastGranted);
            this.removeBanner("fs-grant");
          }
        },
      });
    } else if (status === MIRROR_STATUS.BROKEN) {
      this.addBanner("fs-broken", STRINGS.bannerBrokenDir, "warn", {
        label: STRINGS.btnChooseDir,
        action: () => this.mirror.chooseDirectory(),
      });
    } else if (status === MIRROR_STATUS.UNSUPPORTED) {
      this.addBanner("fs-unsupported", STRINGS.bannerUnsupported, "info");
    }
  }

  /** @param {string} message */
  toast(message) {
    if (!message) return;
    const toast = document.createElement("div");
    toast.className = "pdfmd-toast";
    toast.textContent = message;
    this.els.toasts.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
  }

  /** @param {string} message */
  showFatal(message) {
    this.els.panel.hidden = true;
    this.els.floating.hidden = true;
    const error = document.createElement("div");
    error.className = "pdfmd-fatal";
    error.setAttribute("role", "alert");
    error.textContent = message;
    document.body.appendChild(error);
  }

  /* ------------------------------------------------------------------ *
   * Hộp thoại (S4, S5)
   * ------------------------------------------------------------------ */

  /**
   * @param {{start:number,end:number}} current
   * @returns {Promise<{start:number,end:number}|null>}
   */
  openRangeDialog(current) {
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "pdfmd-modal-overlay";
      overlay.innerHTML = `
        <div class="pdfmd-modal" role="dialog" aria-modal="true" aria-label="${STRINGS.dlgRangeTitle}">
          <h2 class="pdfmd-modal-title">${STRINGS.dlgRangeTitle}</h2>
          <label class="pdfmd-field">
            <span>${STRINGS.dlgStart}</span>
            <input type="number" id="pdfmd-start" value="${current.start}" min="1" step="1" />
          </label>
          <label class="pdfmd-field">
            <span>${STRINGS.dlgEnd}</span>
            <input type="number" id="pdfmd-end" value="${current.end}" min="1" step="1" />
          </label>
          <div class="pdfmd-modal-actions">
            <button type="button" class="pdfmd-btn pdfmd-btn-text" id="pdfmd-cancel">${STRINGS.dlgCancel}</button>
            <button type="button" class="pdfmd-btn pdfmd-btn-primary" id="pdfmd-apply">${STRINGS.dlgApply}</button>
          </div>
        </div>
      `;
      this.els.modalRoot.appendChild(overlay);

      const startInput = overlay.querySelector("#pdfmd-start");
      const endInput = overlay.querySelector("#pdfmd-end");
      const applyButton = overlay.querySelector("#pdfmd-apply");
      const cancelButton = overlay.querySelector("#pdfmd-cancel");

      const close = (value) => {
        overlay.remove();
        document.removeEventListener("keydown", onKeyDown, true);
        resolve(value);
      };
      const onKeyDown = (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          close(null);
        } else if (event.key === "Tab") {
          trapFocus(overlay, event);
        }
      };

      cancelButton.addEventListener("click", () => close(null));
      overlay.addEventListener("click", (event) => {
        if (event.target === overlay) close(null);
      });
      applyButton.addEventListener("click", () => {
        const start = Number(startInput.value);
        const end = Number(endInput.value);
        close({ start, end });
      });
      document.addEventListener("keydown", onKeyDown, true);
      startInput.focus();
      startInput.select();
    });
  }

  /**
   * @param {object[]} conflicts
   * @returns {Promise<boolean>}
   */
  confirmConflict(conflicts) {
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "pdfmd-modal-overlay";
      const items = conflicts
        .map((range) => {
          const key = ops.rangeKey(range.start, range.end);
          const note = this.doc.notes[key] ?? "";
          return `<li>Trang ${range.start}–${range.end} · ${note.length} ký tự</li>`;
        })
        .join("");
      overlay.innerHTML = `
        <div class="pdfmd-modal" role="dialog" aria-modal="true" aria-label="${STRINGS.dlgConflictTitle}">
          <h2 class="pdfmd-modal-title">${STRINGS.dlgConflictTitle}</h2>
          <p>${STRINGS.dlgConflictBody.replace("{count}", String(conflicts.length))}</p>
          <ul class="pdfmd-conflict-list">${items}</ul>
          <div class="pdfmd-modal-actions">
            <button type="button" class="pdfmd-btn pdfmd-btn-text" id="pdfmd-conflict-cancel">${STRINGS.dlgCancel}</button>
            <button type="button" class="pdfmd-btn pdfmd-btn-danger" id="pdfmd-conflict-ok">${STRINGS.dlgConflictContinue}</button>
          </div>
        </div>
      `;
      this.els.modalRoot.appendChild(overlay);

      const close = (value) => {
        overlay.remove();
        document.removeEventListener("keydown", onKeyDown, true);
        resolve(value);
      };
      const onKeyDown = (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          close(false);
        } else if (event.key === "Tab") {
          trapFocus(overlay, event);
        }
      };
      overlay.querySelector("#pdfmd-conflict-cancel").addEventListener("click", () => close(false));
      overlay.querySelector("#pdfmd-conflict-ok").addEventListener("click", () => close(true));
      overlay.addEventListener("click", (event) => {
        if (event.target === overlay) close(false);
      });
      document.addEventListener("keydown", onKeyDown, true);
      overlay.querySelector("#pdfmd-conflict-ok").focus();
    });
  }

  /** Menu chế độ (S5). */
  openModeMenu() {
    const existing = this.els.modalRoot.querySelector(".pdfmd-menu");
    if (existing) {
      existing.remove();
      return;
    }
    const menu = document.createElement("div");
    menu.className = "pdfmd-menu";
    const chapterDisabled = !this.hasOutline;
    menu.innerHTML = `
      <button type="button" class="pdfmd-menu-item" id="pdfmd-mode-chapter" ${chapterDisabled ? "disabled" : ""}>
        <span class="pdfmd-menu-label">${this.doc.mode === ops.MODE.CHAPTER ? "✓ " : ""}${STRINGS.modeChapter}</span>
        <span class="pdfmd-menu-desc">${STRINGS.modeChapterDesc}</span>
      </button>
      <button type="button" class="pdfmd-menu-item" id="pdfmd-mode-chunk">
        <span class="pdfmd-menu-label">${this.doc.mode === ops.MODE.CHUNK ? "✓ " : ""}${STRINGS.modeChunk}</span>
        <span class="pdfmd-menu-desc">${STRINGS.modeChunkDesc}</span>
        <label class="pdfmd-menu-field">
          <span>Chunk</span>
          <input type="number" id="pdfmd-chunk-input" min="1" max="100" step="1" value="${this.doc.chunk}" />
        </label>
      </button>
    `;
    this.els.modalRoot.appendChild(menu);
    const rect = this.els.modeChip.getBoundingClientRect();
    menu.style.top = `${Math.round(rect.bottom + 6)}px`;
    menu.style.right = `${Math.max(12, Math.round(window.innerWidth - rect.right))}px`;

    const close = () => {
      menu.remove();
      document.removeEventListener("click", onOutside, true);
    };
    const onOutside = (event) => {
      if (!menu.contains(event.target)) close();
    };
    setTimeout(() => document.addEventListener("click", onOutside, true), 0);

    menu.querySelector("#pdfmd-mode-chapter").addEventListener("click", async () => {
      close();
      await this.setMode(ops.MODE.CHAPTER);
    });
    const chunkInput = menu.querySelector("#pdfmd-chunk-input");
    chunkInput.addEventListener("click", (event) => event.stopPropagation());
    chunkInput.addEventListener("change", async () => {
      const value = Number(chunkInput.value);
      if (!Number.isInteger(value) || value < LIMITS.MIN_CHUNK || value > LIMITS.MAX_CHUNK) {
        alert(STRINGS.alertChunk);
        chunkInput.value = String(this.doc.chunk);
        return;
      }
      await this.flushNow();
      this.doc.chunk = value;
      await this.saveNow();
    });
  }
}

/** Giữ focus trong modal (UI design 10). */
function trapFocus(container, event) {
  const focusables = container.querySelectorAll(
    'button:not([disabled]), input:not([disabled]), [href], select, textarea, [tabindex]:not([tabindex="-1"])'
  );
  if (focusables.length === 0) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

const panel = new NotePanel();
globalThis.pdfmdPanel = panel; // tiện cho kiểm thử & gỡ lỗi
panel.init().catch((error) => {
  console.error("[pdfmd] Lỗi khởi tạo panel:", error);
});

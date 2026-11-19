/**
 * Mirror ghi chú ra file .md thật (FR-12).
 *
 * - IndexedDB là source of truth; file .md là mirror write-through.
 * - Ghi nguyên tử: createWritable() → write() → close().
 * - Khoá liên tab bằng Web Locks API.
 * - Phát hiện file bị sửa bên ngoài → dừng ghi đè, hỏi người dùng.
 */

import { getFileRecord, setFileRecord, listStates, getSetting, setSetting } from "./notes-store.js";
import { buildFileName, stateToMarkdown, buildIndexJson, sha256Hex } from "./serialize-md.js";
import { FS_STATUS, PermissionManager } from "./permission-manager.js";

export const MIRROR_STATUS = {
  OFF: "off",
  OK: "ok",
  NEEDS_GRANT: "needs-grant",
  DENIED: "denied",
  BROKEN: "broken",
  PAUSED: "paused",
  CONFLICT: "conflict",
  UNSUPPORTED: "unsupported",
  ERROR: "error",
};

const INDEX_FILE = "_pdf-notes-index.json";
const FS_DEBOUNCE_MS = 1000;
const INDEX_DEBOUNCE_MS = 5000;
const RETRY_DELAYS = [1000, 2000, 4000];

export class FsMirror {
  /**
   * @param {{onStatus?: (status: string, info?: any) => void, onConflict?: (info: any) => void}} [options]
   */
  constructor(options = {}) {
    this.onStatus = options.onStatus ?? (() => {});
    this.onConflict = options.onConflict ?? (() => {});
    this.permission = new PermissionManager({
      onStatus: (status) => {
        if (status === FS_STATUS.NEEDS_GRANT) this.setStatus(MIRROR_STATUS.NEEDS_GRANT);
        else if (status === FS_STATUS.DENIED) this.setStatus(MIRROR_STATUS.DENIED);
        else if (status === FS_STATUS.BROKEN) this.setStatus(MIRROR_STATUS.BROKEN);
        else if (status === FS_STATUS.UNSUPPORTED) this.setStatus(MIRROR_STATUS.UNSUPPORTED);
        else if (status === FS_STATUS.READY) this.setStatus(MIRROR_STATUS.OK);
      },
    });
    this.status = MIRROR_STATUS.OFF;
    /** @type {Map<string, {timer:any, state:object, meta:object}>} */
    this.queue = new Map();
    /** @type {Map<string, Promise<void>>} */
    this.inflight = new Map();
    this.indexTimer = null;
  }

  /** @returns {Promise<string>} trạng thái mirror */
  async init() {
    const permissionStatus = await this.permission.init();
    if (permissionStatus === FS_STATUS.UNSUPPORTED) {
      this.setStatus(MIRROR_STATUS.UNSUPPORTED);
    } else if (permissionStatus === FS_STATUS.OFF) {
      this.setStatus(MIRROR_STATUS.OFF);
    }
    return this.status;
  }

  get directoryLabel() {
    return this.permission.label;
  }

  /** Chọn thư mục (user gesture, tab đầy đủ). */
  async chooseDirectory() {
    const ok = await this.permission.chooseDirectory();
    if (ok) this.setStatus(MIRROR_STATUS.OK);
    return ok;
  }

  /** Xin lại quyền (user gesture). */
  async requestGrant() {
    const ok = await this.permission.requestGrant();
    if (ok) {
      this.setStatus(MIRROR_STATUS.OK);
      await this.flushAll();
    }
    return ok;
  }

  /**
   * Đánh dấu PDF cần ghi lại file .md.
   * @param {string} pdfUrl
   * @param {object} state PdfState
   * @param {{title?:string, fingerprint?:string}} meta
   */
  markDirty(pdfUrl, state, meta = {}) {
    if (this.status === MIRROR_STATUS.UNSUPPORTED) return;
    const entry = this.queue.get(pdfUrl) ?? { timer: null };
    entry.state = state;
    entry.meta = meta;
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      this.queue.delete(pdfUrl);
      this.writeNow(pdfUrl, state, meta).catch((error) => {
        console.warn("[pdfmd] Ghi file .md thất bại:", error);
      });
    }, FS_DEBOUNCE_MS);
    this.queue.set(pdfUrl, entry);
  }

  /** Ghi ngay (điểm flush). */
  async flushNow(pdfUrl, state, meta = {}) {
    const entry = this.queue.get(pdfUrl);
    if (entry?.timer) clearTimeout(entry.timer);
    this.queue.delete(pdfUrl);
    return this.writeNow(pdfUrl, state, meta);
  }

  /** Ghi tất cả các file đang chờ. */
  async flushAll() {
    const entries = [...this.queue.entries()];
    for (const [pdfUrl, entry] of entries) {
      if (entry.timer) clearTimeout(entry.timer);
      this.queue.delete(pdfUrl);
      await this.writeNow(pdfUrl, entry.state, entry.meta).catch(() => {});
    }
  }

  /**
   * Ghi một file .md cho một PDF.
   * @param {string} pdfUrl
   * @param {object} state
   * @param {{title?:string, fingerprint?:string}} meta
   */
  async writeNow(pdfUrl, state, meta = {}) {
    if (this.status === MIRROR_STATUS.UNSUPPORTED) return;
    if (!this.permission.handle) {
      this.setStatus(MIRROR_STATUS.OFF);
      return;
    }
    if (this.inflight.has(pdfUrl)) {
      // Single-flight: bản mới nhất thắng (storage design mục 6).
      const pending = this.inflight.get(pdfUrl).then(() => this.writeNow(pdfUrl, state, meta));
      this.inflight.set(pdfUrl, pending);
      return pending;
    }

    const task = (async () => {
      const permission = await this.permission.refreshPermission();
      if (permission === FS_STATUS.NEEDS_GRANT) {
        this.setStatus(MIRROR_STATUS.NEEDS_GRANT);
        return;
      }
      if (permission === FS_STATUS.DENIED) {
        this.setStatus(MIRROR_STATUS.DENIED);
        return;
      }
      if (permission !== FS_STATUS.READY) return;

      const lockName = `pdfmd:fs:${await sha256Hex(pdfUrl)}`;
      await navigator.locks.request(lockName, async () => {
        await this.writeFile(pdfUrl, state, meta);
      });
    })();

    this.inflight.set(pdfUrl, task);
    try {
      await task;
    } finally {
      if (this.inflight.get(pdfUrl) === task) this.inflight.delete(pdfUrl);
    }
  }

  /**
   * @param {string} pdfUrl
   * @param {object} state
   * @param {{title?:string, fingerprint?:string}} meta
   */
  async writeFile(pdfUrl, state, meta = {}) {
    const dir = this.permission.handle;
    if (!dir) return;

    let record = await getFileRecord(pdfUrl);
    const title = meta.title || record?.title || "";
    if (!record?.fileName) {
      const fileName = await buildFileName(title || fileNameFromUrl(pdfUrl), pdfUrl);
      record = {
        fileName,
        title,
        fingerprint: meta.fingerprint ?? "",
        lastWrittenHash: "",
        lastModified: 0,
        size: 0,
        mirrorStatus: "ok",
        updatedAt: Date.now(),
      };
    }

    const content = stateToMarkdown(state, {
      pdfUrl,
      fingerprint: meta.fingerprint ?? record.fingerprint ?? "",
      title: record.title ?? title,
      fileName: record.fileName,
    });

    // Phát hiện file bị sửa bên ngoài (FR-12.6).
    const existing = await this.readFile(dir, record.fileName);
    if (existing && record.lastWrittenHash) {
      const currentHash = await sha256Hex(existing.content);
      if (currentHash !== record.lastWrittenHash && record.mirrorStatus !== "conflict") {
        record.mirrorStatus = "conflict";
        await setFileRecord(pdfUrl, record);
        this.setStatus(MIRROR_STATUS.CONFLICT);
        this.onConflict({ pdfUrl, fileName: record.fileName, externalContent: existing.content });
        return;
      }
    }
    if (record.mirrorStatus === "conflict") {
      this.setStatus(MIRROR_STATUS.CONFLICT);
      return;
    }

    await this.writeWithRetry(dir, record.fileName, content);

    record.lastWrittenHash = await sha256Hex(content);
    record.lastModified = Date.now();
    record.size = new TextEncoder().encode(content).length;
    record.mirrorStatus = "ok";
    record.updatedAt = Date.now();
    record.fingerprint = meta.fingerprint ?? record.fingerprint ?? "";
    await setFileRecord(pdfUrl, record);
    this.setStatus(MIRROR_STATUS.OK);
    this.scheduleIndex();
  }

  /**
   * Ghi có retry khi file bị khoá bởi ứng dụng khác (NoModificationAllowedError).
   */
  async writeWithRetry(dir, fileName, content) {
    let attempt = 0;
    for (;;) {
      try {
        const fileHandle = await dir.getFileHandle(fileName, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(content);
        await writable.close();
        return;
      } catch (error) {
        const name = error?.name ?? "";
        if (name === "NoModificationAllowedError" && attempt < RETRY_DELAYS.length) {
          await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS[attempt]));
          attempt += 1;
          continue;
        }
        if (name === "NotFoundError") {
          this.setStatus(MIRROR_STATUS.BROKEN);
          throw error;
        }
        if (name === "NotAllowedError") {
          this.setStatus(MIRROR_STATUS.NEEDS_GRANT);
          throw error;
        }
        this.setStatus(MIRROR_STATUS.ERROR);
        throw error;
      }
    }
  }

  /** @returns {Promise<{content:string, lastModified:number, size:number}|null>} */
  async readFile(dir, fileName) {
    try {
      const handle = await dir.getFileHandle(fileName, { create: false });
      const file = await handle.getFile();
      return {
        content: await file.text(),
        lastModified: file.lastModified,
        size: file.size,
      };
    } catch {
      return null;
    }
  }

  /**
   * Giải quyết xung đột file bị sửa bên ngoài.
   * @param {string} pdfUrl
   * @param {"overwrite"|"keep"} action
   */
  async resolveConflict(pdfUrl, action) {
    const record = await getFileRecord(pdfUrl);
    if (!record) return false;
    const dir = this.permission.handle;
    if (!dir) return false;

    if (action === "overwrite") {
      const existing = await this.readFile(dir, record.fileName);
      if (existing) {
        const stamp = formatStamp(new Date());
        await this.writeWithRetry(dir, `${record.fileName.replace(/\.md$/, "")}.conflict-${stamp}.md`, existing.content);
      }
      record.mirrorStatus = "ok";
      record.lastWrittenHash = "";
      await setFileRecord(pdfUrl, record);
      this.setStatus(MIRROR_STATUS.OK);
      return true;
    }

    // "Giữ bản ngoài": dừng đồng bộ file này.
    record.mirrorStatus = "conflict";
    await setFileRecord(pdfUrl, record);
    this.setStatus(MIRROR_STATUS.CONFLICT);
    return true;
  }

  /** Ghi file index tra cứu (debounce 5s). */
  scheduleIndex() {
    if (this.indexTimer) clearTimeout(this.indexTimer);
    this.indexTimer = setTimeout(() => {
      this.indexTimer = null;
      this.writeIndex().catch((error) => console.warn("[pdfmd] Không ghi được file index:", error));
    }, INDEX_DEBOUNCE_MS);
  }

  async writeIndex() {
    const dir = this.permission.handle;
    if (!dir) return;
    const records = await listStates();
    const files = [];
    for (const { key, state } of records) {
      const record = await getFileRecord(key);
      if (!record?.fileName) continue;
      files.push({
        pdfUrl: key,
        fileName: record.fileName,
        title: record.title ?? "",
        fingerprint: record.fingerprint ?? "",
        updatedAt: state?.updatedAt ?? 0,
      });
    }
    await this.writeWithRetry(dir, INDEX_FILE, buildIndexJson(files));
  }

  /** Xuất toàn bộ PDF đã có ghi chú ra thư mục. */
  async exportAll() {
    const dir = this.permission.handle;
    if (!dir) return 0;
    const states = await listStates();
    let count = 0;
    for (const { key, state } of states) {
      const record = await getFileRecord(key);
      const fileName = record?.fileName ?? (await buildFileName(fileNameFromUrl(key), key));
      const content = stateToMarkdown(state, {
        pdfUrl: key,
        fingerprint: record?.fingerprint ?? "",
        title: record?.title ?? fileNameFromUrl(key),
        fileName,
      });
      await this.writeWithRetry(dir, fileName, content);
      if (!record) {
        await setFileRecord(key, {
          fileName,
          title: record?.title ?? fileNameFromUrl(key),
          fingerprint: record?.fingerprint ?? "",
          lastWrittenHash: await sha256Hex(content),
          lastModified: Date.now(),
          size: new TextEncoder().encode(content).length,
          mirrorStatus: "ok",
          updatedAt: Date.now(),
        });
      }
      count += 1;
    }
    this.scheduleIndex();
    return count;
  }

  /** @param {string} status */
  setStatus(status) {
    if (this.status === status) return;
    this.status = status;
    this.onStatus(status);
  }
}

/** @param {string} url */
function fileNameFromUrl(url) {
  try {
    const parsed = new URL(url);
    const name = decodeURIComponent(parsed.pathname.split("/").pop() ?? "");
    return name.replace(/\.pdf$/i, "") || "tai-lieu";
  } catch {
    return "tai-lieu";
  }
}

/** @param {Date} date */
function formatStamp(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

/** Tải file .md thủ công (fallback khi trình duyệt không hỗ trợ FS API). */
export async function downloadMarkdownFallback(content, fileName) {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/** @param {string} key */
export async function isMirrorEnabled() {
  try {
    const prefs = await getSetting("fsPrefs");
    return prefs?.mirrorEnabled !== false;
  } catch {
    return true;
  }
}

/** @param {boolean} enabled */
export async function setMirrorEnabled(enabled) {
  await setSetting("fsPrefs", { ...(await getSetting("fsPrefs")), mirrorEnabled: enabled });
}

/**
 * Quản lý quyền thư mục (File System Access API).
 *
 * Nguyên tắc (storage design F2/F3/F4):
 *  - Luôn queryPermission() trước khi ghi; quyền có thể mất giữa phiên.
 *  - Chỉ gọi requestPermission() trong user gesture (click handler).
 *  - Không dùng service worker cho tầng FS.
 */

import { getSetting, setSetting } from "./notes-store.js";

export const SETTING_FS_DIR = "fsDir";
export const SETTING_FS_PREFS = "fsPrefs";

export const FS_STATUS = {
  UNSUPPORTED: "unsupported",
  OFF: "off",
  READY: "ready",
  NEEDS_GRANT: "needs-grant",
  DENIED: "denied",
  BROKEN: "broken",
};

/** Kiểm tra trình duyệt có hỗ trợ File System Access API hay không. */
export function isFsApiSupported() {
  return typeof window !== "undefined" && typeof window.showDirectoryPicker === "function";
}

export class PermissionManager {
  /**
   * @param {{onStatus?: (status: string, detail?: any) => void}} [options]
   */
  constructor(options = {}) {
    this.onStatus = options.onStatus ?? (() => {});
    this.handle = null;
    this.status = FS_STATUS.OFF;
    this.label = "";
    this.channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("pdfmd:fs") : null;
    if (this.channel) {
      this.channel.onmessage = (event) => {
        if (event.data?.type === "fs-granted") this.onStatus(this.status, { broadcast: true });
      };
    }
  }

  /** Nạp handle đã lưu trong IndexedDB và kiểm tra quyền hiện tại. */
  async init() {
    if (!isFsApiSupported()) {
      this.handle = null;
      this.setStatus(FS_STATUS.UNSUPPORTED);
      return this.status;
    }
    let stored = null;
    try {
      stored = await getSetting(SETTING_FS_DIR);
    } catch {
      stored = null;
    }
    if (!stored?.handle) {
      this.handle = null;
      this.setStatus(FS_STATUS.OFF);
      return this.status;
    }
    this.handle = stored.handle;
    this.label = stored.label ?? "";
    await this.refreshPermission();
    return this.status;
  }

  /** @returns {Promise<string>} trạng thái quyền sau khi kiểm tra */
  async refreshPermission() {
    if (!this.handle) {
      this.setStatus(FS_STATUS.OFF);
      return this.status;
    }
    let state = "prompt";
    try {
      state = await this.handle.queryPermission({ mode: "readwrite" });
    } catch (error) {
      console.warn("[pdfmd] Không kiểm tra được quyền thư mục:", error);
      this.setStatus(FS_STATUS.BROKEN);
      return this.status;
    }
    if (state === "granted") {
      this.setStatus(FS_STATUS.READY);
    } else if (state === "denied") {
      this.setStatus(FS_STATUS.DENIED);
    } else {
      this.setStatus(FS_STATUS.NEEDS_GRANT);
    }
    return this.status;
  }

  /**
   * Mở picker — BẮT BUỘC gọi từ user gesture ở tab đầy đủ (F3/F6).
   * @returns {Promise<boolean>} true nếu chọn thành công
   */
  async chooseDirectory() {
    if (!isFsApiSupported()) {
      this.setStatus(FS_STATUS.UNSUPPORTED);
      return false;
    }
    try {
      const handle = await window.showDirectoryPicker({
        id: "pdf-md-notes",
        mode: "readwrite",
        startIn: "documents",
      });
      const permission = await handle.requestPermission({ mode: "readwrite" });
      if (permission !== "granted") {
        this.handle = handle;
        this.label = handle.name ?? "";
        await setSetting(SETTING_FS_DIR, { handle, label: this.label, pickedAt: Date.now() });
        this.setStatus(FS_STATUS.DENIED);
        return false;
      }
      this.handle = handle;
      this.label = handle.name ?? "";
      await setSetting(SETTING_FS_DIR, { handle, label: this.label, pickedAt: Date.now() });
      this.setStatus(FS_STATUS.READY);
      this.broadcast("fs-granted");
      return true;
    } catch (error) {
      if (error?.name === "AbortError") return false;
      console.warn("[pdfmd] Không chọn được thư mục:", error);
      this.setStatus(FS_STATUS.BROKEN);
      return false;
    }
  }

  /** Xin lại quyền — phải nằm trong click handler (F3). */
  async requestGrant() {
    if (!this.handle) return false;
    try {
      const permission = await this.handle.requestPermission({ mode: "readwrite" });
      if (permission === "granted") {
        this.setStatus(FS_STATUS.READY);
        this.broadcast("fs-granted");
        return true;
      }
      this.setStatus(FS_STATUS.DENIED);
      return false;
    } catch (error) {
      console.warn("[pdfmd] Không cấp được quyền thư mục:", error);
      this.setStatus(FS_STATUS.DENIED);
      return false;
    }
  }

  /** Gỡ handle (người dùng đổi thư mục / thu hồi). */
  async forgetDirectory() {
    this.handle = null;
    this.label = "";
    try {
      await setSetting(SETTING_FS_DIR, null);
    } catch {
      /* bỏ qua */
    }
    this.setStatus(FS_STATUS.OFF);
  }

  /** @param {string} status */
  setStatus(status) {
    this.status = status;
    this.onStatus(status, { label: this.label });
  }

  /** @param {any} message */
  broadcast(message) {
    try {
      this.channel?.postMessage(message);
    } catch {
      /* bỏ qua */
    }
  }
}

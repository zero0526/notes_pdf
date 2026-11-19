/**
 * Popup tiện ích (S2): bật/tắt redirect, trạng thái thư mục .md, khoá PDF hiện tại.
 */

import { normalizePdfUrl } from "../lib/url-key.js";
import { getSetting } from "../lib/notes-store.js";
import { SETTING_FS_DIR } from "../lib/permission-manager.js";

const el = (id) => document.getElementById(id);

async function init() {
  const manifest = chrome.runtime.getManifest();
  el("app-version").textContent = `v${manifest.version}`;
  el("toggle-label").textContent = "Tự động mở PDF bằng tiện ích";
  el("dir-label").textContent = "Thư mục .md";
  el("dir-name").textContent = "Chưa chọn";
  el("open-storage").textContent = "Mở cài đặt lưu trữ";
  el("open-options").textContent = "Giới hạn & trợ giúp";

  const settings = await chrome.storage.sync.get({ autoRedirect: true });
  const toggle = el("auto-redirect");
  toggle.checked = settings.autoRedirect !== false;
  toggle.addEventListener("change", async () => {
    await chrome.storage.sync.set({ autoRedirect: toggle.checked });
    if (!toggle.checked) {
      showToast("Đã tắt tự chuyển hướng PDF");
    }
  });

  await renderStorageCard();
  await renderCurrentKey();

  el("open-storage").addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("src/options/options.html") });
    window.close();
  });
  el("open-options").addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("src/options/options.html") });
    window.close();
  });
}

/** Thẻ trạng thái thư mục lưu trữ. */
async function renderStorageCard() {
  const dot = el("dir-dot");
  const name = el("dir-name");
  const perm = el("dir-perm");

  let stored = null;
  try {
    stored = await getSetting(SETTING_FS_DIR);
  } catch {
    stored = null;
  }
  if (!stored?.handle) {
    name.textContent = "Chưa chọn";
    perm.textContent = "";
    dot.className = "popup-dot";
    return;
  }

  name.textContent = stored.label || stored.handle.name || "Thư mục";
  if (typeof window.showDirectoryPicker !== "function") {
    perm.textContent = "Không hỗ trợ";
    dot.className = "popup-dot is-denied";
    return;
  }
  let state = "prompt";
  try {
    state = await stored.handle.queryPermission({ mode: "readwrite" });
  } catch {
    state = "prompt";
  }
  if (state === "granted") {
    perm.textContent = "Sẵn sàng";
    dot.className = "popup-dot is-ready";
  } else if (state === "denied") {
    perm.textContent = "Không hỗ trợ";
    dot.className = "popup-dot is-denied";
  } else {
    perm.textContent = "Cần cấp lại quyền";
    dot.className = "popup-dot is-grant";
  }
}

/** Khoá PDF hiện tại (FR-07.3). */
async function renderCurrentKey() {
  const target = el("current-key");
  let pdfUrl = null;

  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = tabs[0]?.url ?? "";
    if (url.startsWith("chrome-extension://") && url.includes("viewer.html")) {
      pdfUrl = new URL(url).searchParams.get("file");
    }
  } catch {
    pdfUrl = null;
  }

  if (!pdfUrl) {
    try {
      const session = await chrome.storage.session.get("lastPdfUrl");
      pdfUrl = session.lastPdfUrl ?? null;
    } catch {
      pdfUrl = null;
    }
  }

  if (!pdfUrl) {
    target.textContent = "—";
    target.title = "";
    return;
  }
  const key = normalizePdfUrl(pdfUrl);
  target.textContent = key;
  target.title = key;
}

/** @param {string} message */
function showToast(message) {
  const toast = document.createElement("div");
  toast.className = "popup-toast";
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2500);
}

init().catch((error) => console.warn("[pdfmd] Popup lỗi:", error));

/**
 * Service worker nền: tự động chuyển hướng PDF sang viewer nội bộ (FR-01),
 * context menu "Mở bằng PDF Notes" (FR-01.8) và cấu hình đồng bộ (FR-07).
 */

import { looksLikePdfUrl, normalizePdfUrl } from "../lib/url-key.js";

const VIEWER_PATH = "vendor/pdfjs/web/viewer.html";
const SETTING_AUTO_REDIRECT = "autoRedirect";
const SETTING_MIRROR = "mirrorEnabled";
const SETTING_FONT_SIZE = "editorFontSize";
const DEFAULT_SETTINGS = {
  [SETTING_AUTO_REDIRECT]: true,
  [SETTING_MIRROR]: true,
  [SETTING_FONT_SIZE]: 13,
};

chrome.runtime.onInstalled.addListener(async (details) => {
  await ensureDefaults();
  await ensureContextMenu();
  if (details.reason === "install") {
    await chrome.tabs.create({ url: chrome.runtime.getURL("src/options/options.html") });
  }
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureDefaults();
  await ensureContextMenu();
});

/** Đặt giá trị mặc định cho các thiết lập chưa có. */
async function ensureDefaults() {
  const current = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  const patch = {};
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    if (current[key] === undefined) patch[key] = value;
  }
  if (Object.keys(patch).length > 0) await chrome.storage.sync.set(patch);
}

async function ensureContextMenu() {
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({
    id: "pdfmd-open-link",
    title: "Mở bằng PDF Notes",
    contexts: ["link"],
  });
}

chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId !== "pdfmd-open-link") return;
  const url = info.linkUrl ?? info.pageUrl;
  if (!url) return;
  await openInViewer(url);
});

/** Mở một URL PDF trong viewer nội bộ. */
async function openInViewer(pdfUrl, tabId) {
  const viewerUrl = buildViewerUrl(pdfUrl);
  try {
    if (typeof tabId === "number") {
      await chrome.tabs.update(tabId, { url: viewerUrl });
    } else {
      await chrome.tabs.create({ url: viewerUrl });
    }
  } catch (error) {
    // FR-01.5: tab đóng giữa lúc redirect → bỏ qua im lặng.
    console.warn("[pdfmd] Không chuyển hướng được tab:", error?.message ?? error);
  }
}

/** URL viewer: viewer.html?file=<URL đã encode> (FR-01.1). */
export function buildViewerUrl(pdfUrl) {
  const base = chrome.runtime.getURL(VIEWER_PATH);
  return `${base}?file=${encodeURIComponent(pdfUrl)}`;
}

chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
  if (details.frameId !== 0) return; // FR-01.2: chỉ tab chính
  const url = details.url ?? "";
  if (!url) return;
  if (url.startsWith("chrome-extension://")) return; // FR-01.3
  if (url.startsWith("blob:") || url.startsWith("data:")) return;
  if (!looksLikePdfUrl(url)) return;

  const settings = await chrome.storage.sync.get({ [SETTING_AUTO_REDIRECT]: true });
  if (!settings[SETTING_AUTO_REDIRECT]) return;

  await openInViewer(url, details.tabId);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "pdfmd:viewer-url") {
    sendResponse({ url: buildViewerUrl(message.pdfUrl ?? "") });
    return true;
  }
  if (message?.type === "pdfmd:normalize-url") {
    sendResponse({ key: normalizePdfUrl(message.pdfUrl ?? "") });
    return true;
  }
  return false;
});

/**
 * Trang cài đặt (S3): thư mục lưu .md, quyền, hành vi, giới hạn.
 */

import { FsMirror, MIRROR_STATUS, downloadMarkdownFallback } from "../lib/fs-mirror.js";
import { isFsApiSupported } from "../lib/permission-manager.js";
import { getState } from "../lib/notes-store.js";
import { stateToMarkdown, buildFileName } from "../lib/serialize-md.js";
import { LIMITS, clampPanelWidth } from "../lib/i18n.js";

const el = (id) => document.getElementById(id);
const mirror = new FsMirror({
  onStatus: (status) => renderStatus(status),
});

async function init() {
  const settings = await chrome.storage.sync.get({
    autoRedirect: true,
    mirrorEnabled: true,
    editorFontSize: 13,
    panelWidth: LIMITS.PANEL_WIDTH,
  });

  const redirect = el("auto-redirect");
  redirect.checked = settings.autoRedirect !== false;
  redirect.addEventListener("change", () => {
    chrome.storage.sync.set({ autoRedirect: redirect.checked });
  });

  const mirrorToggle = el("mirror-enabled");
  mirrorToggle.checked = settings.mirrorEnabled !== false;
  mirrorToggle.addEventListener("change", async () => {
    await chrome.storage.sync.set({ mirrorEnabled: mirrorToggle.checked });
  });

  const fontSize = el("editor-font-size");
  fontSize.value = String(settings.editorFontSize ?? 13);
  fontSize.addEventListener("change", () => {
    const value = Math.min(Math.max(Number(fontSize.value) || 13, 11), 18);
    fontSize.value = String(value);
    chrome.storage.sync.set({ editorFontSize: value });
    document.documentElement.style.setProperty("--pdfmd-editor-size", `${value}px`);
  });

  const panelWidth = el("panel-width");
  panelWidth.min = String(LIMITS.PANEL_WIDTH_MIN);
  panelWidth.max = String(LIMITS.PANEL_WIDTH_MAX);
  panelWidth.value = String(clampPanelWidth(settings.panelWidth));
  panelWidth.addEventListener("change", () => {
    const value = clampPanelWidth(panelWidth.value);
    panelWidth.value = String(value);
    chrome.storage.sync.set({ panelWidth: value });
    document.documentElement.style.setProperty("--pdfmd-panel-width", `${value}px`);
  });

  el("choose-dir").addEventListener("click", async () => {
    const ok = await mirror.chooseDirectory();
    if (ok) renderStatus(MIRROR_STATUS.OK);
  });
  el("grant-dir").addEventListener("click", async () => {
    const ok = await mirror.requestGrant();
    if (ok) renderStatus(MIRROR_STATUS.OK);
  });
  el("export-all").addEventListener("click", async () => {
    if (mirror.status !== MIRROR_STATUS.OK) {
      el("fs-hint").textContent = "Cần cấp quyền thư mục trước khi xuất.";
      return;
    }
    const count = await mirror.exportAll();
    el("fs-hint").textContent = `Đã xuất ${count} file .md.`;
  });
  el("copy-new-dir").addEventListener("click", async () => {
    const ok = await mirror.chooseDirectory();
    if (ok) {
      const count = await mirror.exportAll();
      el("fs-hint").textContent = `Đã sao chép ${count} file .md sang thư mục mới.`;
    }
  });
  el("download-md").addEventListener("click", () => downloadCurrent());

  await mirror.init();
  renderStatus(mirror.status);
}

function renderStatus(status) {
  const statusEl = el("dir-status");
  const chooseBtn = el("choose-dir");
  const grantBtn = el("grant-dir");
  const hint = el("fs-hint");
  const label = mirror.directoryLabel;

  if (!isFsApiSupported()) {
    statusEl.textContent = "Trình duyệt không hỗ trợ ghi thư mục — dùng nút Tải .md";
    statusEl.className = "status is-warn";
    chooseBtn.disabled = true;
    grantBtn.hidden = true;
    hint.textContent = "Ghi chú vẫn được lưu trong trình duyệt (IndexedDB).";
    return;
  }

  chooseBtn.disabled = false;
  chooseBtn.textContent = label ? "Đổi thư mục" : "Chọn thư mục lưu trữ";

  switch (status) {
    case MIRROR_STATUS.OK:
      statusEl.textContent = label ? `Đã sẵn sàng — ${label}` : "Sẵn sàng";
      statusEl.className = "status is-ready";
      grantBtn.hidden = true;
      hint.textContent = "Ghi chú được đồng bộ ra file .md sau mỗi lần lưu.";
      break;
    case MIRROR_STATUS.NEEDS_GRANT:
      statusEl.textContent = label ? `Cần cấp lại quyền — ${label}` : "Cần cấp lại quyền";
      statusEl.className = "status is-warn";
      grantBtn.hidden = false;
      hint.textContent = "Quyền thư mục có thể mất sau khi đóng hết tab. Bấm để cấp lại.";
      break;
    case MIRROR_STATUS.DENIED:
      statusEl.textContent = "Không có quyền ghi thư mục";
      statusEl.className = "status is-error";
      grantBtn.hidden = false;
      hint.textContent = "Ghi chú vẫn lưu trong trình duyệt.";
      break;
    case MIRROR_STATUS.BROKEN:
      statusEl.textContent = "Không tìm thấy thư mục lưu trữ";
      statusEl.className = "status is-error";
      grantBtn.hidden = true;
      hint.textContent = "Chọn lại thư mục để tiếp tục đồng bộ.";
      break;
    default:
      statusEl.textContent = "Chưa chọn thư mục";
      statusEl.className = "status";
      grantBtn.hidden = true;
      hint.textContent = "Ghi chú vẫn được lưu trong trình duyệt (IndexedDB).";
  }
}

/** Tải file .md của PDF đang mở (fallback). */
async function downloadCurrent() {
  let pdfUrl = null;
  try {
    const session = await chrome.storage.session.get("lastPdfUrl");
    pdfUrl = session.lastPdfUrl ?? null;
  } catch {
    pdfUrl = null;
  }
  if (!pdfUrl) {
    el("fs-hint").textContent = "Không có PDF nào đang mở để tải.";
    return;
  }
  const state = await getState(pdfUrl);
  if (!state) {
    el("fs-hint").textContent = "PDF này chưa có ghi chú để tải.";
    return;
  }
  const fileName = await buildFileName("tai-lieu", pdfUrl);
  const content = stateToMarkdown(state, { pdfUrl, title: fileName.replace(/\.md$/, "") });
  await downloadMarkdownFallback(content, fileName);
}

init().catch((error) => console.warn("[pdfmd] Options lỗi:", error));

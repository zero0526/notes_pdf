/**
 * Bảng chuỗi giao diện (NFR-U4: tiếng Việt, tập trung một nơi, sẵn sàng đa ngôn ngữ).
 * Mọi chuỗi hiển thị cho người dùng phải lấy từ đây.
 */
export const STRINGS = {
  appName: "PDF Markdown Notes",
  version: "v{version}",

  // Panel
  panelTitle: "📝 Ghi chú",
  btnRange: "Khoảng trang",
  btnRangeTitle: "Sửa khoảng trang của ghi chú hiện tại",
  btnCollapse: "–",
  btnCollapseTitle: "Ẩn panel ghi chú",
  btnExpandTitle: "Hiện panel ghi chú",
  resizerTitle: "Kéo để đổi chiều rộng panel (nhấp đôi để đặt lại)",
  toastPanelWidthReset: "Đã đặt lại chiều rộng panel",
  tabWrite: "Soạn",
  tabPreview: "Xem trước",
  editorPlaceholder: "Ghi chú Markdown cho khoảng trang này…",
  previewEmpty: "Chưa có nội dung để xem trước.",
  imageBlocked: "[ảnh đã chặn]",
  outlinePending: "Đang phân tích mục lục…",
  pageRange: "Trang {start}–{end}",
  chipChapter: "Chương ▾",
  chipChunk: "Trang ▾",
  chipTitle: "Chế độ tạo ghi chú mới",
  btnRender: "Render",

  // Footer
  statusReady: "Sẵn sàng",
  statusSaving: "Đang lưu...",
  statusSaved: "Đã lưu {time}",
  statusDegraded: "Không lưu được — ghi chú chỉ tồn tại trong phiên này",
  statusMemoryFull: "Bộ nhớ đầy — xoá bớt ghi chú/PDF cũ",
  btnRetry: "Thử lại",
  mirrorOk: ".md ✓",
  mirrorNeedsGrant: ".md chờ quyền",
  mirrorError: ".md lỗi",
  mirrorLocked: ".md bị khoá",
  mirrorConflict: ".md xung đột",
  mirrorOff: "—",

  // Banner
  bannerGrant: "Đồng bộ .md tạm dừng — bấm «Cấp quyền thư mục»",
  bannerDenied: "Không có quyền ghi thư mục — ghi chú vẫn lưu trong trình duyệt",
  bannerBrokenDir: "Không tìm thấy thư mục lưu trữ — chọn lại thư mục",
  bannerConflict: "File .md đã được sửa bên ngoài",
  bannerMultiTab: "PDF này đang mở ở tab khác — thay đổi có thể ghi đè nhau",
  bannerIncognito: "Phiên ẩn danh — ghi chú sẽ mất khi đóng phiên",
  bannerDegraded: "Không lưu được — ghi chú chỉ tồn tại trong phiên này",
  bannerUnsupported: "Trình duyệt không hỗ trợ ghi thư mục — dùng nút Tải .md",
  bannerOutlineFailed: "Không đọc được mục lục — chia theo số trang",

  btnGrant: "Cấp quyền thư mục",
  btnOpenSettings: "Mở cài đặt",
  btnChooseDir: "Chọn lại thư mục",
  btnOverwrite: "Ghi đè (có bản sao lưu)",
  btnKeepExternal: "Giữ bản ngoài",

  // Dialog khoảng trang
  dlgRangeTitle: "Sửa khoảng trang",
  dlgStart: "Trang bắt đầu",
  dlgEnd: "Trang kết thúc",
  dlgCancel: "Huỷ",
  dlgApply: "Áp dụng",
  dlgConflictTitle: "Xoá các khoảng trang chồng lấn?",
  dlgConflictBody: "Sửa khoảng trang sẽ xoá {count} ghi chú có nội dung:",
  dlgConflictContinue: "Tiếp tục",

  // Menu chế độ
  modeChapter: "Theo chương",
  modeChapterDesc: "Dùng mục lục có sẵn của PDF",
  modeChunk: "Theo số trang",
  modeChunkDesc: "Mỗi ghi chú mới chiếm số trang đã đặt",

  // Alert validate
  alertNotInteger: "Vui lòng nhập số nguyên dương.",
  alertStartMin: "Trang bắt đầu phải ≥ 1.",
  alertEndMin: "Trang kết thúc phải ≥ trang bắt đầu.",
  alertEndTooBig: "PDF chỉ có {numPages} trang. Khoảng trang không được vượt quá trang cuối.",
  alertChunk: "Chunk phải là số nguyên trong khoảng 1–100.",
  alertMissingRange: "Chưa có đơn vị ghi chú để sửa.",

  // Toast
  toastRangeChanged: "Đã đổi khoảng trang",
  toastGranted: "Đã cấp quyền thư mục — đồng bộ .md tiếp tục",
  toastDataRecovered: "Dữ liệu ghi chú bị lỗi — đã tạo bản mới (bản cũ được sao lưu)",
  toastRedirectOff: "Đã tắt tự chuyển hướng PDF",

  // Popup
  popupAutoRedirect: "Tự động mở PDF bằng tiện ích",
  popupDirLabel: "Thư mục .md",
  popupDirNotChosen: "Chưa chọn",
  popupOpenStorage: "Mở cài đặt lưu trữ",
  popupLimits: "Giới hạn & trợ giúp",
  popupPermReady: "Sẵn sàng",
  popupPermGrant: "Cần cấp lại quyền",
  popupPermDenied: "Không hỗ trợ",

  // Context menu
  ctxOpenWith: "Mở bằng PDF Notes",

  // Options
  optTitle: "Cài đặt PDF Markdown Notes",
  optStorageTitle: "Lưu trữ thư mục (.md)",
  optStorageDesc:
    "Ghi chú được lưu trong trình duyệt (IndexedDB) và đồng bộ ra file .md thật trong thư mục bạn chọn.",
  optChooseDir: "Chọn thư mục lưu trữ",
  optChangeDir: "Đổi thư mục",
  optExportAll: "Xuất tất cả .md",
  optCopyToNew: "Sao chép sang thư mục mới",
  optDownload: "Tải .md",
  optNotesTitle: "Ghi chú",
  optChunkTitle: "Chunk mặc định toàn cục",
  optChunkHint: "v1.2",
  optFontSize: "Cỡ chữ editor",
  optPanelWidth: "Chiều rộng panel",
  optBehaviorTitle: "Hành vi",
  optMirrorEnabled: "Đồng bộ file .md",
  optLimitsTitle: "Giới hạn & trợ giúp",
};

/** Bảng mã lỗi (SRS mục 8, storage design mục 10). */
export const ERRORS = {
  E01: 'Bật "Allow access to file URLs" cho tiện ích trong chrome://extensions',
  E02: "PDF cần mật khẩu — mở khoá để bắt đầu ghi chú",
  E03: "Không lưu được — ghi chú chỉ tồn tại trong phiên này",
  E04: "Bộ nhớ đầy — xoá bớt ghi chú/PDF cũ",
  E05: "Không đọc được mục lục — chia theo số trang",
  E06: "Dữ liệu ghi chú bị lỗi — đã tạo bản mới (bản cũ được sao lưu)",
  E08: "Ghi chú lớn (>100KB) — có thể chậm khi xem trước",
  E09: "Phiên ẩn danh — ghi chú sẽ mất khi đóng phiên",
  E10: 'Đồng bộ .md tạm dừng — bấm "Cấp quyền thư mục"',
  E11: "Không có quyền ghi thư mục — ghi chú vẫn lưu trong trình duyệt",
  E12: "Không tìm thấy thư mục lưu trữ — chọn lại thư mục",
  E13: "File .md đang bị ứng dụng khác giữ — đồng bộ file này tạm dừng",
  E14: "File .md đã được sửa bên ngoài — chọn ghi đè (có bản sao lưu) hoặc giữ bản ngoài",
  E15: "Trình duyệt không hỗ trợ ghi thư mục — dùng nút Tải .md",
};

/** Ngưỡng cảnh báo. */
export const LIMITS = {
  NOTE_BYTES: 100 * 1024,
  STATE_BYTES: 2 * 1024 * 1024,
  DB_BYTES: 500 * 1024 * 1024,
  AUTOSAVE_DEBOUNCE_MS: 400,
  PREVIEW_DEBOUNCE_MS: 150,
  MIRROR_DEBOUNCE_MS: 1000,
  OUTLINE_TIMEOUT_MS: 3000,
  OUTLINE_MAX_ITEMS: 500,
  OUTLINE_WARN_ITEMS: 1000,
  PDFJS_TIMEOUT_MS: 15000,
  PANEL_WIDTH: 380,
  PANEL_WIDTH_MIN: 280,
  PANEL_WIDTH_MAX: 720,
  MAX_TITLE_LEN: 500,
  MIN_CHUNK: 1,
  MAX_CHUNK: 100,
};

/**
 * Kẹp chiều rộng panel vào khoảng cho phép.
 * @param {unknown} value Giá trị thô (từ storage, input hoặc cử chỉ kéo).
 * @param {number} [upperBound] Trần tuỳ theo chiều rộng cửa sổ.
 * @returns {number} Số nguyên pixel hợp lệ.
 */
export function clampPanelWidth(value, upperBound = LIMITS.PANEL_WIDTH_MAX) {
  const raw = Number(value);
  const base = Number.isFinite(raw) && raw > 0 ? raw : LIMITS.PANEL_WIDTH;
  const bound = Number(upperBound);
  const max = Number.isFinite(bound) && bound > 0
    ? Math.min(LIMITS.PANEL_WIDTH_MAX, Math.max(LIMITS.PANEL_WIDTH_MIN, bound))
    : LIMITS.PANEL_WIDTH_MAX;
  return Math.round(Math.min(Math.max(base, LIMITS.PANEL_WIDTH_MIN), max));
}

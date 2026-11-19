# PDF Markdown Notes — tiện ích mở rộng trình duyệt

Xem PDF ngay trong trình duyệt và ghi chú **Markdown** theo **chương** (mục lục có sẵn của PDF) hoặc theo **khoảng trang**.
Dữ liệu lưu 100% cục bộ (IndexedDB) và có thể đồng bộ ra **file `.md` thật** trong thư mục bạn chọn.

| | |
|---|---|
| Nền tảng | Chrome ≥ 110, Edge ≥ 110, Brave, Cốc Cốc (Manifest V3) |
| Tài liệu gốc | `srs.md` (SRS v1.1) · `storage_design.md` (SAD-STORAGE-01) · `ui_design.md` (UID-01) |
| Phiên bản | v1.1.0 |

---

## 1. Tính năng

- **Tự động chuyển hướng PDF** sang viewer nội bộ (PDF.js) — bật/tắt trong popup.
- **Ghi chú theo đơn vị nội dung**: chuyển trang trong cùng chương/khoảng trang thì ghi chú giữ nguyên; ra ngoài đơn vị sẽ chuyển sang ghi chú mới.
- **Chia theo chương** nếu PDF có outline, **tự động chia theo số trang** nếu không có (hoặc outline lỗi).
- **Chỉnh khoảng trang** thủ công (start/end), có kiểm tra xung đột và di trú nội dung ghi chú.
- **Soạn Markdown (GFM)** với tab *Xem trước* được sanitize: bỏ script/handler, chặn ảnh remote, link mở tab mới với `rel="noopener noreferrer"`.
- **Tự lưu** 400 ms + flush tại các điểm bắt buộc (đổi đơn vị, đổi chế độ, sửa khoảng trang, ẩn tab, đóng trang).
- **Mirror file `.md`** thật qua File System Access API (một file cho mỗi PDF, có frontmatter + marker để máy đọc).
- **Chiều rộng panel tuỳ chỉnh**: kéo cạnh trái panel (nhấp đôi để về 380px), dùng mũi tên khi focus, hoặc đặt trong *Cài đặt → Ghi chú → Chiều rộng panel* (280–720px). Chiều rộng được lưu giữa các phiên.
- **Cảnh báo đa tab**, **chế độ ẩn danh**, **trạng thái lỗi lưu trữ** (DEGRADED) đều hiển thị rõ trong panel.

---

## 2. Cài đặt (Chrome/Edge)

1. Mở `chrome://extensions` (hoặc `edge://extensions`).
2. Bật **Developer mode** (Chế độ dành cho nhà phát triển).
3. Chọn **Load unpacked** (Tải tiện ích đã giải nén) → chọn thư mục gốc của dự án (thư mục chứa `manifest.json`).
4. Mở một tệp PDF → trình duyệt chuyển hướng sang viewer của tiện ích.

Tuỳ chọn thêm:

- Muốn mở PDF `file://` → bật **Allow access to file URLs** trong trang tiện ích.
- Muốn ghi file `.md` → mở **Cài đặt** (trang Options) → **Chọn thư mục lưu trữ**.

---

## 3. Phát triển

```bash
npm install          # cài dependency (chỉ dùng cho build & kiểm thử)
npm run vendor       # tải & vá lại PDF.js, marked, DOMPurify vào vendor/
npm test             # kiểm thử đơn vị (node:test)
npm run smoke        # kiểm thử khói: nạp extension thật vào Chrome, mở PDF, gõ & lưu ghi chú
npm run icons        # sinh lại icon PNG cho manifest
```

Sau mỗi lần `npm run vendor`, chỉ cần **Reload** tiện ích trong `chrome://extensions`.

### Kiểm thử khói

`npm run smoke` cần một bản **Chrome for Testing** (Chrome chính thức chặn `--load-extension`).
Cài sẵn qua `npx @puppeteer/browsers install chrome@stable --path ./.cache/cft`, rồi:

```bash
CHROME_BIN=./.cache/cft/chrome/linux-<phiên bản>/chrome-linux64/chrome npm run smoke
```

Kịch bản kiểm thử (tất cả đều chạy thật trong Chrome):

1. URL `.pdf` được chuyển hướng sang viewer của tiện ích.
2. Panel hiển thị đúng khoảng trang, gõ ghi chú → tự lưu vào IndexedDB.
3. Đổi trang → đơn vị ghi chú mới, ghi chú cũ không bị lẫn.
4. Sửa khoảng trang (1 → 3) → ghi chú được di trú sang khoá mới.
5. Mở lại PDF → ghi chú được khôi phục.
6. Tab *Xem trước* render Markdown (GFM).
7. Thu gọn panel → vùng PDF mở rộng toàn chiều ngang, nút nổi hoạt động.
8. PDF có outline → chế độ *Theo chương*, giữ ghi chú khi chuyển trang trong cùng chương,
   sang chương sau → ghi chú trống và đúng tên chương.
9. Popup và trang Cài đặt mở được, đọc đúng cấu hình.

> `tools/make-test-pdf.mjs` sinh PDF có outline để kiểm thử chế độ *Theo chương*.

---

## 4. Cấu trúc mã

```
manifest.json              Manifest V3
src/
  background/sw.js         Chuyển hướng PDF, context menu, cấu hình
  panel/panel.js|.css      Note Panel (đơn vị ghi chú, soạn thảo, lưu, dialog)
  lib/
    url-key.js             Chuẩn hoá khoá URL PDF (loại token phiên/tracking)
    notes-store.js         IndexedDB (pdfs / settings / files) + hàng đợi ghi
    state-ops.js           Toán học state: range, đơn vị, sửa khoảng trang, hợp nhất
    markdown.js            Render GFM + sanitize + chặn ảnh remote
    outline.js             Phân giải outline (named dest, dest số, timeout 3s)
    serialize-md.js        PdfState → file .md + đặt tên tệp ổn định
    permission-manager.js  Quyền thư mục (File System Access API)
    fs-mirror.js           Mirror ghi file .md (Web Locks, retry, chống ghi đè ngoài)
    i18n.js                Toàn bộ chuỗi giao diện tiếng Việt
  popup/  options/         Popup & trang cài đặt
tools/
  vendor.mjs               Tải + vá PDF.js/marked/DOMPurify (tái lập được sau nâng cấp)
  make-icons.mjs           Sinh icon PNG
  smoke-test.mjs           Kiểm thử khói trên Chrome thật
vendor/                    Thư viện đóng gói cục bộ (không dùng CDN)
tests/                     Kiểm thử đơn vị (node:test)
```

> **Nâng cấp PDF.js**: chỉ cần đổi `PDFJS_VERSION` trong `tools/vendor.mjs` rồi chạy `npm run vendor`.
> Script sẽ tải bản phân phối mới và **vá lại** `viewer.html` / `viewer.js` theo đúng các điểm đã ghi chú.

---

## 5. Dữ liệu & khoá

- Khoá lưu trữ = **URL PDF đã chuẩn hoá**: bỏ hash, loại tham số phiên/xác thựt/tracking
  (`token`, `access_token`, `sig`, `x-amz-*`, `utm_*`, `fbclid`, `gclid`, …), sắp xếp tham số còn lại theo tên rồi giá trị.
- Ví dụ: `a.pdf?token=abc&page=2#page=1` và `a.pdf?page=2` là **cùng một bộ ghi chú**;
  `a.pdf?page=2` và `a.pdf?page=3` là **hai bộ khác nhau**.
- Cơ sở dữ liệu: IndexedDB `pdf-md-notes-v1` (`pdfs`, `settings`, `files`).

---

## 6. Giới hạn đã biết

| Vấn đề | Hành vi |
|---|---|
| **Nhiều tab cùng mở một PDF** | Ghi đè theo **bản sau cùng (last-write-wins)** trên toàn state; các ghi được hợp nhất theo thời điểm cập nhật của từng range/note (tombstone được tôn trọng). Panel hiện cảnh báo "PDF này đang mở ở tab khác". |
| **Quyền thư mục** | Quyền File System Access có thể mất sau khi đóng hết tab hoặc khởi động lại trình duyệt → hiện banner "Cấp quyền thư mục". Nếu Chrome hỏi, chọn **"Allow on every visit"** để các phiên sau không phải cấp lại. |
| **Picker thư mục** | Chỉ mở được từ **tab đầy đủ** (panel trong viewer hoặc trang Options), không mở được từ popup. |
| **Trình duyệt không hỗ trợ FS API** (Brave sau flag) | Mirror `.md` bị tắt (`—` ở footer), dùng nút **Tải .md**; ghi chú vẫn lưu trong IndexedDB. |
| **Cửa sổ ẩn danh** | IndexedDB chỉ tồn tại trong phiên; mirror `.md` tắt. Panel hiện cảnh báo. |
| **Tham số token lạ** | Tham số có tên ngoài danh sách ở Phụ lục B sẽ **không** bị loại → đổi giá trị tham số đó tạo bộ ghi chú mới. |
| **Cửa sổ hẹp (< 900px)** | Panel chuyển sang kiểu overlay và **mặc định ẩn** để ưu tiên đọc; bấm nút nổi 📝 để mở lại. |
| **PDF nhiều ngôn ngữ** | Chỉ hỗ trợ dạng `GET` với đuôi `.pdf`; PDF trả về bằng `Content-Type` nhưng URL không có đuôi `.pdf` → dùng context menu **"Mở bằng PDF Notes"**. |
| **Font Type1** | PDF.js có thể không dựng được một số font Type1 cổ trong trình duyệt (giới hạn của thư viện, không phải của tiện ích). |

---

## 7. Quyền truy cập

| Quyền | Mục đích |
|---|---|
| `storage` | Lưu cấu hình (`chrome.storage.sync`) và ghi chú (IndexedDB). |
| `webNavigation` | Quan sát điều hướng để chuyển hướng PDF. |
| `contextMenus` | Menu "Mở bằng PDF Notes" trên link. |
| `host_permissions: <all_urls>` | Viewer tải PDF cross-origin và nhận URL điều hướng. |

Không yêu cầu `tabs`, `clipboard`, `downloads`. Không có backend, không telemetry, không tải mã từ xa —
mọi thư viện đều nằm trong `vendor/` và được nạp từ chính tiện ích.

---

## 8. Giấy phép thư viện

- [PDF.js](https://mozilla.github.io/pdf.js/) — Apache-2.0 (`vendor/pdfjs/`)
- [marked](https://github.com/markedjs/marked) — MIT (`vendor/marked/`)
- [DOMPurify](https://github.com/cure53/DOMPurify) — Apache-2.0 / MPL-2.0 (`vendor/dompurify/`)

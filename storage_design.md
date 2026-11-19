# THIẾT KẾ KIẾN TRÚC LƯU TRỮ
## PDF Markdown Notes — Ghi file `.md` thật qua File System Access API

| Mục | Nội dung |
|---|---|
| Mã tài liệu | SAD-STORAGE-01 |
| Bổ sung cho | SRS v1.1 (thêm FR-12, NFR, E-10…E-15, AC-23…AC-32) |
| Phạm vi | Tầng lưu trữ: IndexedDB (hiện hành) + **mirror file `.md`** trong thư mục người dùng chọn |

---

## 0. XÁC MINH NỀN TẢNG (đọc trước khi thiết kế)

Các sự thật nền tảng đã kiểm chứng, chi phối toàn bộ kiến trúc:

| # | Sự thật | Hệ quả thiết kế |
|---|---|---|
| F1 | `FileSystemDirectoryHandle` lưu được vào IndexedDB và tái sử dụng qua các phiên trình duyệt — đúng pattern VS Code web và các extension MV3 thực tế đang dùng [[15]] | Không phải chọn lại thư mục mỗi lần mở |
| F2 | **Quyền ghi không bền**: mất khi khởi động lại trình duyệt/đóng hết tab của origin; extension thực tế phải có nút "Grant Folder Access" sau mỗi phiên mới [[65]] | Quyền là **tài nguyên phiên dễ bay hơi** → luôn `queryPermission` trước khi ghi |
| F3 | `requestPermission()` **bắt buộc có transient user activation** (click…); không có sẽ ném `SecurityError`; không gọi được từ worker [[12]] | ⚠️ **Điểm chỉnh trong mô tả của bạn**: popup xác nhận **không thể tự bật ra ở "lần ghi âm thầm đầu tiên"** — phải gắn vào một nút bấm |
| F4 | Quyền cũng có thể mất **giữa phiên** (tab bị nền lâu → auto-revoke; extension ghi âm thực tế gặp lỗi này sau pause dài) [[57]] | Không giả định "cấp 1 lần là đủ cho cả phiên" |
| F5 | Chrome 122+ có prompt 3 lựa chọn, trong đó **"Allow on every visit"** cấp quyền bền nếu handle được lưu IDB và `requestPermission()` được gọi ở lần mở sau [[15]] | Best-case: người dùng chọn mục này → các phiên sau im lặng thật sự |
| F6 | **`showDirectoryPicker` có bug nền tảng trong extension**: từng lỗi AbortError/treo trong ngữ cảnh extension [[39]]; ghi nhận thực tế 07/2026: picker **hỏng trong side-panel, phải chuyển sang tab đầy đủ** mới chạy | Picker **chỉ mở từ trang tab đầy đủ** (options/panel trong viewer); cấm popup/side-panel; bắt buộc probe + fallback |
| F7 | Handle **không đi qua được message boundary của extension** (`chrome.runtime`) — extension thực tế phải trung chuyển qua IndexedDB [[57]] | Mọi context đọc handle từ IDB, không gửi qua message |
| F8 | Ghi qua `createWritable → write → close` là **nguyên tử**: spec đảm bảo file chỉ chứa nội dung cũ hoặc mới, không nửa chừng [[24]] | Không cần tự chế temp-file/rename |
| F9 | Xin quyền trên **directory handle** bao trùm mọi file bên trong — một prompt cho tất cả file `.md` [[57]] | Chỉ quản lý 1 handle thư mục, không xin quyền từng file |
| F10 | Brave: API này **sau flag**, chưa bật mặc định [[38]]; trình duyệt chặn một số thư mục hệ thống nhạy cảm [[38]] | Feature-detect → chế độ UNSUPPORTED; khuyến nghị thư mục riêng kiểu `~/Documents/PDF-Notes` |

> **Hai chỉnh sửa so với mô tả của bạn:** (1) lần ghi đầu sau restart **không tự popup** — thiết kế dùng banner + nút "Cấp quyền thư mục" (F3); (2) picker **không mở từ popup** — popup đóng khi dialog mở và picker có bug trong ngữ cảnh hẹp (F6) — mở từ panel trong viewer hoặc trang options.

---

## 1. QUYẾT ĐỊNH THIẾT KẾ

| Mã | Quyết định | Lý do |
|---|---|---|
| D1 | **IndexedDB là source of truth; file `.md` là mirror write-through** | Quyền FS bay hơi (F2/F4) → gõ phím không bao giờ được phụ thuộc FS; mirror vẫn đạt mục tiêu "file .md thật, cập nhật gần realtime" |
| D2 | Picker mở **từ tab đầy đủ** (nút trong panel viewer hoặc trang options); popup chỉ hiển thị trạng thái + nút mở options | F6 |
| D3 | Không bao giờ tự bật prompt khi đang gõ; quyền thiếu → **banner + nút cấp lại** gắn click handler | F3 + UX: không ngắt luồng gõ |
| D4 | **Một file `.md` cho mỗi PDF**, chứa toàn bộ range/chương dạng section | Khớp yêu cầu `ten-tai-lieu.md`; dễ mở bằng Obsidian/editor |
| D5 | Ghi nguyên tử bằng `createWritable → close`; khoá liên tab bằng **Web Locks API** | F8; nhiều tab cùng PDF không xé file |
| D6 | Trung chuyển handle **qua IDB**, không qua message | F7 |
| D7 | Chỉ đụng file do extension tạo (theo registry trong IDB + file index); không liệt kê/xoá file lạ | An toàn dữ liệu người dùng |
| D8 | Phát hiện file bị sửa bên ngoài → **tạm dừng ghi đè file đó**, hỏi người dùng | Chống mất công sức sửa tay trong Obsidian |
| D9 | Incognito: mirror **tắt** (IDB vốn ephemeral); Brave/không API: **UNSUPPORTED**, fallback IDB + tải thủ công | F10, nhất quán E-09 |

---

## 2. SƠ ĐỒ THÀNH PHẦN & LUỒNG DỮ LIỆU

```
┌─────────────────────────── Viewer tab (extension page) ───────────────────────────┐
│  Note Panel (UI)                                                                  │
│    │ gõ phím                                                                      │
│    ▼                                                                              │
│  notes-store ──(debounce 400ms + flush points)──► IndexedDB `pdfs`  [SOURCE OF TRUTH]
│    │ markDirty(pdfUrl)                                                            │
│    ▼                                                                              │
│  fs-mirror (mới)                                                                  │
│    ├─ permission-gate: queryPermission(dirHandle) mỗi批次                          │
│    ├─ debounce 1000ms + coalesce (bản mới nhất thắng)                             │
│    ├─ Web Locks `pdfmd:fs:<hash(pdfUrl)>`  ◄── khoá với các tab khác              │
│    ├─ external-change check (lastModified/size/hash)                              │
│    ├─ serializer: PdfState → Markdown (frontmatter + range markers)               │
│    └─ createWritable → write → close  ───────────► ~/Documents/PDF-Notes/*.md     │
│                                                                                   │
│  permission-manager: banner + nút "Cấp quyền thư mục" (requestPermission trong    │
│                      click handler) ── broadcast 'fs-granted' ──► các tab khác    │
└───────────────────────────────────────────────────────────────────────────────────┘
        ▲ handle đọc từ IDB (F7)                    ▲ BroadcastChannel `pdfmd:fs`
┌───────┴────────┐   ┌──────────────────────────────┴─────────┐
│ Options tab    │   │ Popup (chỉ viewer trạng thái)          │
│ "Chọn thư mục" │   │ - Thư mục: PDF-Notes · Trạng thái quyền │
│ showDirectory- │   │ - [Mở cài đặt lưu trữ] (mở options tab)│
│ Picker (D2)    │   └────────────────────────────────────────┘
└────────────────┘
IndexedDB pdf-md-notes-v1:  pdfs (state) · settings (dirHandle, prefs) · files (registry .md)
Service worker: KHÔNG tham gia ghi file (không window, không activation — F3/F6).
```

---

## 3. VÒNG ĐỜI QUYỀN & TRẠNG THÁI MIRROR

### 3.1. State machine

```
UNSUPPORTED ──────────────── (không có API / Brave sau flag / incognito)
OFF ──(chọn thư mục)──► READY ⇄ NEEDS_GRANT ──(từ chối)──► DENIED
                         │  ▲                     │
        (thư mục mất)    │  └──(cấp lại, flush)───┘
                         ▼
                       BROKEN ──(chọn lại thư mục, re-link theo registry)──► READY
READY ──(lỗi ghi tạm: file bị khoá)──► RETRYING ──(3 lần thất bại)──► PAUSED(file)
READY ──(file bị sửa ngoài)──► CONFLICT(file) ──(người dùng chọn)──► READY
```

### 3.2. Bảng chuyển trạng thái

| Sự kiện | Kiểm tra | Hành vi |
|---|---|---|
| Viewer READY | Đọc `settings.fsDir` từ IDB → `queryPermission({mode:'readwrite'})` | `granted` → READY; `prompt` → NEEDS_GRANT (banner E-10); `denied` → DENIED (E-11) |
| Bấm **"Cấp quyền thư mục"** | Trong click handler: `await dirHandle.requestPermission({mode:'readwrite'})` | `granted` → flush hàng đợi + broadcast; Chrome 122+ có thể hiện prompt 3 lựa chọn, user chọn "Allow on every visit" → các phiên sau im lặng (F5) |
| Trước mỗi批次 ghi | `queryPermission` lại (F4) | Mất quyền giữa chừng → NEEDS_GRANT, giữ hàng đợi, **không** thử ghi |
| `getFileHandle/getFile` ném `NotFoundError` | Thư mục/file bị xoá/di chuyển | BROKEN (E-12) → nút "Chọn lại thư mục" |
| Không có `showDirectoryPicker` trong `window` | Probe lúc khởi tạo | UNSUPPORTED (E-15): ẩn nút chọn thư mục, hiện giải thích + fallback |

**Quy tắc vàng:** mọi thao tác FS chỉ chạy khi `queryPermission === 'granted'`; không bao giờ gọi `requestPermission` ngoài user gesture (F3); không bao giờ gọi từ service worker/worker (F3, F6).

---

## 4. CÁC LUỒNG CHÍNH

**A. Thiết lập lần đầu**
1. Panel/options → nút "Chọn thư mục lưu trữ" (tab đầy đủ — D2).
2. `showDirectoryPicker({ id: 'pdf-md-notes', mode: 'readwrite', startIn: 'documents' })` — xin quyền ghi ngay lúc chọn, một prompt.
3. Lưu `{handle, label, pickedAt}` vào IDB `settings` (F1) → probe ghi thử file index → READY.
4. Xuất ngay file `.md` của PDF đang mở; nút "Xuất tất cả PDF đã có note" (Should).

**B. Gõ phím → ghi âm thầm (quyền READY)**
```
gõ → 400ms → IDB put (luôn thành công trước) → markDirty
   → 1000ms FS-debounce → Web Lock → queryPermission ✓
   → so stat file (chống sửa ngoài) → serialize PdfState
   → createWritable → write → close (nguyên tử, F8)
   → cập nhật registry `files` → footer "Đã lưu · .md ✓"
```

**C. Khởi động lại trình duyệt (luồng bạn mô tả, đã chỉnh theo F3)**
1. Mở PDF → note khôi phục từ IDB **ngay lập tức**, soạn bình thường.
2. `queryPermission` = `prompt` → banner: *"Đồng bộ .md tạm dừng — bấm Cấp quyền thư mục"* (E-10). **Không popup tự bật.**
3. Người dùng bấm nút → prompt Chrome hiện (có thể là prompt 3 lựa chọn 122+, F5) → granted.
4. Flush toàn bộ phần chưa ghi (bản mới nhất theo từng PDF) → từ đó ghi âm thầm.
5. Trong lúc chờ quyền: mọi thay đổi vẫn vào IDB + hàng đợi dirty — **không mất chữ nào**.

**D. File bị sửa bên ngoài (Obsidian/editor)**
- Trước khi ghi: so `lastModified + size + hash` với registry → lệch ⇒ CONFLICT(file), dừng ghi đè file đó (D8), banner E-14: *"File .md đã được sửa bên ngoài"* + lựa chọn **[Ghi đè, lưu bản sao lưu]** / **[Giữ bản ngoài, tạm dừng đồng bộ file này]**.
- Ghi đè → tạo `ten-file.conflict-<timestamp>.md` chứa bản ngoài trước, rồi ghi bản IDB. Auto-merge theo marker: v1.2 (import).

**E. Đổi/thu hồi thư mục**
- Đổi thư mục: chọn lại → từ đó ghi vào thư mục mới; nút "Sao chép các .md hiện có sang thư mục mới" (Should). File cũ giữ nguyên.
- Người dùng thu hồi quyền qua icon thanh địa chỉ → `queryPermission` lần kế = `prompt/denied` → NEEDS_GRANT/DENIED, không crash.

---

## 5. TỔ CHỨC FILE & ĐỊNH DẠNG `.md`

### 5.1. Đặt tên (ổn định, không phụ thuộc phiên)
```
fileName = slug(title) + "-" + sha256(pdfUrl).slice(0,8) + ".md"
```
- `title`: tên tài liệu (metadata PDF → tiêu đề viewer → tên file từ URL, bỏ `.pdf`).
- `slug`: giữ Unicode tiếng Việt, khoảng trắng → `-`, loại ký tự cấm `\ / : * ? " < > |`, ≤ 80 ký tự.
- Hash 8 ký tự từ `pdfUrl` chuẩn hoá → hai PDF trùng tên không đụng nhau; cùng PDF luôn ra cùng tên.
- Registry `pdfUrl → fileName` trong IDB bảo đảm tên không đổi kể cả khi title PDF đổi.

### 5.2. Định dạng file (round-trip được cho import v1.2)
```markdown
---
pdfnotes: 1
pdfUrl: "https://example.com/tai-lieu.pdf"
fingerprint: "…"
title: "Tài liệu nghiên cứu"
mode: chapter
chunk: 1
updatedAt: "2026-11-16T09:30:00Z"
---

<!-- pdfnotes:range {"key":"1-6","source":"chunk","updatedAt":1763280000000} -->
## Trang 1–6

Ghi chú phần mở đầu…

<!-- pdfnotes:range {"key":"7-24","source":"chapter","title":"Chương 1: Tổng quan","updatedAt":1763280600000} -->
## Trang 7–24 — Chương 1: Tổng quan

- Ý chính…
```
- Mỗi range = 1 marker comment (máy đọc) + heading (người đọc) + nội dung note.
- File luôn **sinh lại từ IDB** (D1); sửa tay bên ngoài chỉ được hấp thụ qua luồng conflict/import — không bao giờ bị ghi đè thầm lặng (D8).
- Chuỗi YAML được escape; tên chương là plain text (nhất quán NFR-S5).

### 5.3. File chỉ mục `_pdf-notes-index.json` (Should)
`{ version, updatedAt, files: [{pdfUrl, fileName, title, fingerprint, updatedAt}] }` — debounce 5s; phục vụ tra cứu ngoài extension và khôi phục liên kết sau này. Extension **chỉ đọc/ghi file có trong registry + file index + conflict copy** (D7).

---

## 6. PIPELINE GHI & ĐỒNG THỜI

| Khía cạnh | Quy tắc |
|---|---|
| Nhịp | IDB 400ms (SRS); FS mirror debounce **1000ms** sau flush IDB gần nhất + ghi ngay tại flush points (đổi đơn vị, đổi mode, `visibilitychange→hidden`, `pagehide`) |
| Coalesce | Hàng đợi theo `pdfUrl`, bản mới nhất thắng; single-flight mỗi file |
| Khoá liên tab | `navigator.locks.request('pdfmd:fs:' + hash(pdfUrl))` bao quanh check-stat → write; khoá cả file index bằng khoá riêng |
| Retry | `NoModificationAllowedError` (file bị app khác khoá, vd thư mục sync): 3 lần, backoff 1s/2s/4s → PAUSED(file) + banner E-13 |
| Không retry | `NotAllowedError` → NEEDS_GRANT (chờ user); `NotFoundError` → BROKEN |
| Đo lường | NFR-P9: ghi mirror p95 ≤ 150ms với file ≤ 2MB; mọi lỗi FS **không** chặn luồng gõ (NFR-R5) |

---

## 7. MỞ RỘNG DỮ LIỆU (cùng DB `pdf-md-notes-v1`)

```ts
// ObjectStore mới: settings (out-of-line)
'fsDir'   → { handle: FileSystemDirectoryHandle, label: string, pickedAt: number }
'fsPrefs' → { mirrorEnabled: boolean, lastGrantAt?: number }

// ObjectStore mới: files (out-of-line, key = pdfUrl)
{ fileName: string, title: string, fingerprint: string,
  lastWrittenHash: string, lastModified: number, size: number,
  mirrorStatus: 'ok'|'conflict'|'paused', updatedAt: number }
```
- Handle lưu IDB bằng structured clone — pattern đã được VS Code web và extension MV3 thực tế kiểm chứng [[15]].
- **Không** đưa handle lên `chrome.storage.sync` (không clone được, và là dữ liệu máy-cục-bộ).
- Mọi context (panel tab khác, options) đọc handle từ IDB, không nhận qua message (F7) [[57]].

---

## 8. ĐA TAB

- Quyền FS là theo origin + thư mục: cấp ở một tab → tab khác `queryPermission` lại là thấy (permission-manager broadcast `fs-granted` qua `BroadcastChannel('pdfmd:fs')` để các tab re-query + flush ngay).
- Ghi file: Web Locks chống giẫm chân; nội dung vẫn theo ngữ nghĩa last-write-wins/merge của FR-11 (IDB quyết định nội dung, mirror chỉ phản chiếu).
- Tab cuối cùng đóng: quyền có thể bị thu hồi theo chính sách origin (F2) — không sao, IDB đã đủ; phiên sau theo luồng C.

---

## 9. BẢO MẬT & RIÊNG TƯ (bổ sung SRS)

| Mã | Yêu cầu |
|---|---|
| NFR-S8 | Chỉ tạo/ghi file trong registry + `_pdf-notes-index.json` + conflict copy; không liệt kê, không xoá file khác của người dùng |
| NFR-S9 | Handle + registry chỉ ở IndexedDB cục bộ; không sync, không network (kế thừa NFR-S1) |
| NFR-S10 | Không xin quyền mới trong manifest — FS Access là quyền runtime do người dùng cấp qua picker; justification store không đổi |
| D9 | Incognito: mirror tắt hẳn; Brave/thiếu API: UNSUPPORTED, không probe lặp |

---

## 10. YÊU CẦU BỔ SUNG VÀO SRS

### FR-12 — Mirror file `.md` (MỚI)

| Mã | Yêu cầu | Ưu tiên |
|---|---|---|
| FR-12.1 | Nút "Chọn thư mục lưu trữ" trong panel/options (tab đầy đủ); dùng `showDirectoryPicker` với `mode:'readwrite'`; **không** mở từ popup/side-panel | Must |
| FR-12.2 | Lưu directory handle vào IndexedDB; các phiên sau không phải chọn lại | Must |
| FR-12.3 | Mỗi flush IDB → xếp hàng ghi `.md` (debounce 1s + flush points); một file `.md`/PDF theo mục 5 | Must |
| FR-12.4 | Mọi lỗi/thiếu quyền FS không chặn soạn thảo; note luôn vào IDB trước | Must |
| FR-12.5 | `queryPermission` trước mỗi批次 ghi; thiếu quyền → banner + nút "Cấp quyền thư mục" gọi `requestPermission` trong click handler; cấp xong flush hàng đợi | Must |
| FR-12.6 | Phát hiện file sửa ngoài qua stat+hash → dừng ghi đè file đó, banner lựa chọn (mục 4D) | Must |
| FR-12.7 | Ghi nguyên tử `createWritable→close`; Web Locks liên tab | Must |
| FR-12.8 | Feature-detect API; UNSUPPORTED (Brave sau flag, incognito) → ẩn chọn thư mục + giải thích, IDB hoạt động bình thường | Must |
| FR-12.9 | File index `_pdf-notes-index.json`; popup hiển thị thư mục + trạng thái quyền | Should |
| FR-12.10 | "Xuất tất cả", "Sao chép sang thư mục mới", ghi đè có backup | Should |
| FR-12.11 | Fallback tải `.md` qua `chrome.downloads` (thư mục `Downloads/PDF-Notes`, `conflictAction:'overwrite'`) khi UNSUPPORTED — pattern extension thực tế đã dùng [[65]] | Should |
| FR-12.12 | Import/merge từ `.md` sửa ngoài theo marker | Could (v1.2) |

### NFR mới
- **NFR-P9**: ghi mirror p95 ≤ 150ms (file ≤ 2MB).
- **NFR-R5**: tầng mirror không bao giờ gây mất dữ liệu hay chặn gõ; mất quyền FS ⇒ tối đa mirror trễ, IDB nguyên vẹn.
- **NFR-U8**: footer có trạng thái mirror (`Đã lưu · .md ✓` / `.md chờ quyền` / `.md lỗi`); banner `aria-live="polite"`.

### Lỗi mới

| Mã | Tình huống | Thông báo |
|---|---|---|
| E-10 | Quyền cần cấp lại | `Đồng bộ .md tạm dừng — bấm "Cấp quyền thư mục"` |
| E-11 | Người dùng từ chối quyền | `Không có quyền ghi thư mục — ghi chú vẫn lưu trong trình duyệt` |
| E-12 | Thư mục bị xoá/di chuyển | `Không tìm thấy thư mục lưu trữ — chọn lại thư mục` |
| E-13 | File bị app khác khoá (hết retry) | `File .md đang bị ứng dụng khác giữ — đồng bộ file này tạm dừng` |
| E-14 | File bị sửa bên ngoài | `File .md đã được sửa bên ngoài — chọn ghi đè (có bản sao lưu) hoặc giữ bản ngoài` |
| E-15 | API không khả dụng | `Trình duyệt không hỗ trợ ghi thư mục — dùng nút Tải .md` |

### AC mới
- **AC-23**: Chọn thư mục → file `ten-tai-lieu-<hash8>.md` xuất hiện, đủ mọi range, frontmatter đúng.
- **AC-24**: Quyền READY, gõ → ≤ 1.5s file cập nhật, không prompt.
- **AC-25**: Restart → banner E-10, gõ vẫn lưu IDB; **không prompt tự bật khi đang gõ**; bấm cấp quyền → phần chưa ghi được flush.
- **AC-26**: Từ chối quyền → panel hoạt động, footer `.md chờ quyền`, không mất note.
- **AC-27**: Sửa file bằng editor ngoài → không bị ghi đè thầm lặng; chọn "Ghi đè" → có conflict copy.
- **AC-28**: Xoá thư mục → E-12; chọn lại → ghi tiếp đúng tên file cũ (registry).
- **AC-29**: 2 tab cùng PDF ghi đồng thời → file không hỏng (lock); cấp quyền tab A → tab B ghi được sau re-query.
- **AC-30**: Trình duyệt không API → UNSUPPORTED, IDB bình thường, có nút Tải `.md`.
- **AC-31**: Incognito → mirror tắt, E-09.
- **AC-32**: Kill trình duyệt giữa lúc ghi → file chứa trọn bản cũ hoặc trọn bản mới (F8) [[24]].

---

## 11. RỦI RO & GIẢM THIỂU

| Rủi ro | Mức | Giảm thiểu |
|---|---|---|
| Bug picker trong ngữ cảnh extension (side-panel/popup hỏng, có dự án 07/2026 phải bỏ tính năng vì bug không hết trên máy thật) [[39]] | **Cao** | D2 (chỉ tab đầy đủ) + probe ghi thử lúc setup + E-15/fallback FR-12.11; kiểm thử thật trên Chrome/Edge/Cốc Cốc trước phát hành |
| Quyền bay hơi giữa phiên/restart (F2/F4) | Trung bình | Kiến trúc D1 + banner + hàng đợi dirty; hướng dẫn user chọn "Allow on every visit" nếu prompt 122+ hiện (F5) |
| Brave chưa bật API [[38]] | Trung bình | UNSUPPORTED + downloads fallback |
| Thư mục sync (OneDrive…) khoá file | Trung bình | Retry backoff + E-13; README khuyến nghị thư mục cục bộ riêng |
| Người dùng sửa `.md` ngoài | Trung bình | D8 + conflict copy; import v1.2 |
| Chọn nhầm thư mục hệ thống bị chặn [[38]] | Thấp | `startIn:'documents'` + hướng dẫn tạo `PDF-Notes` riêng |

## 12. THAM SỐ & TRIỂN KHAI

| Tham số | Giá trị |
|---|---|
| FS debounce / flush | 1000ms / theo flush points SRS |
| Retry file khoá | 3 lần · 1s/2s/4s |
| Slug / hash tên file | ≤ 80 ký tự / 8 hex |
| Index debounce | 5s |
| Hậu tố conflict copy | `.conflict-<YYYYMMDD-HHmmss>.md` |

**Triển khai:** Giai đoạn 1 (v1.1): FR-12.1–12.8 (Must) + 12.9–12.11 (Should) · Giai đoạn 2 (v1.2): import/merge 12.12, khôi phục liên kết từ index. **Không** dùng service worker/offscreen cho tầng FS — mọi thao tác quyền và ghi nằm trong viewer/options page, nơi có window và user gesture (F3, F6).

---

Tóm lại: kiến trúc giữ đúng ý bạn — chọn thư mục một lần, handle nằm trong IndexedDB, ghi `.md` âm thầm — nhưng đặt **IndexedDB làm nền an toàn** và coi quyền FS là tài nguyên phiên cần xin lại bằng **một nút bấm** (không thể tự popup), đồng thời né bug picker bằng cách chỉ mở từ tab đầy đủ. Bạn muốn tôi viết tiếp **module `fs-mirror.js` + `permission-manager.js` mẫu** (code hoàn chỉnh theo thiết kế này) hay **bộ test Playwright cho các AC-23→32**?
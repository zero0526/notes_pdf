# MÔ TẢ GIAO DIỆN NGƯỜI DÙNG (UI DESCRIPTION)
## PDF Markdown Notes — Tiện ích mở rộng trình duyệt · v1.1

| Mục | Nội dung |
|---|---|
| Mã tài liệu | UID-01 (mô tả bằng lời, không kèm bản mẫu) |
| Căn cứ | SRS v1.1 (FR-01…FR-12) + SAD-STORAGE-01 |
| Ngôn ngữ UI | Tiếng Việt (NFR-U4) |
| Theme | Tối mặc định; theme sáng thuộc v1.2 |
| Quy ước | Mọi chuỗi UI đặt trong ngoặc kép là **chuỗi chính xác** hiển thị cho người dùng; kích thước tính bằng px |

---

## 1. DANH MỤC BỀ MẶT GIAO DIỆN

| # | Bề mặt | Nơi xuất hiện | Vai trò |
|---|---|---|---|
| S1 | Viewer + Note Panel | Tab đầy đủ, URL `chrome-extension://…/viewer.html` | Bề mặt làm việc chính: đọc PDF + soạn ghi chú |
| S2 | Popup tiện ích | Bấm icon toolbar | Bật/tắt redirect, xem nhanh trạng thái lưu trữ |
| S3 | Trang Options | Tab đầy đủ, mở từ popup/panel | Cấu hình thư mục lưu `.md`, quyền, chunk, thông tin giới hạn |
| S4 | Hộp thoại khoảng trang | Modal trong panel | Sửa `start/end`, validate, xác nhận overlap |
| S5 | Menu chế độ | Thả từ chip trong panel | Chọn Chương/Trang, chỉnh chunk |
| S6 | Banner + toast | Trong panel / góc dưới phải | Cảnh báo quyền, đa tab, lỗi lưu, xác nhận thao tác |
| S7 | Nút nổi thu gọn | Góc phải trên vùng viewer | Mở lại panel khi đã ẩn |
| S8 | Context menu | Chuột phải lên link bất kỳ | "Mở bằng PDF Notes" (FR-01.8) |

---

## 2. NGÔN NGỮ HÌNH ẢNH

### 2.1. Màu sắc

| Vai trò | Mã màu | Ghi chú sử dụng |
|---|---|---|
| Nền panel / nền tối chính | `#1f1f23` | Toàn bộ panel, popup, options |
| Chữ chính | `#e8e8ea` | Nội dung, tiêu đề |
| Chữ phụ / dòng chương | `#9aa0b0` | Nhãn phụ, metadata, dòng tên chương |
| Nền nút / ô nhập | `#2a2a30` | Nút, input, tab không active |
| Viền | `#444444` | Viền nút, ô nhập, đường chia khối |
| Thông tin / liên kết | `#4da3ff` | Link preview, chip đang active, focus ring |
| Thành công / đã lưu | `#4ade80` | Chấm trạng thái "Đã lưu", ".md ✓" |
| Cảnh báo / chờ | `#ffb454` | Banner quyền, đa tab, ".md chờ quyền" |
| Lỗi / nguy hiểm | `#ff5470` | DEGRADED, alert, nút xoá |
| Nhấn mạnh chương | `#2dd4bf` | Chấm màu trước tên chương, mục active trong mục lục |
| Giấy PDF | `#f4eddc`, chữ `#2a2620` | Trang PDF do PDF.js render (không tuỳ chỉnh) |

Tương phản chữ/nền ≥ 4.5:1 (NFR-U7). Màu trạng thái **luôn kèm biểu tượng/chữ**, không chỉ dựa vào màu.

### 2.2. Chữ

| Thành phần | Font | Cỡ / giãn dòng |
|---|---|---|
| Tiêu đề panel, popup | `system-ui` (Be Vietnam Pro nếu có) | 15px / 1.4, đậm 600 |
| Dòng `Trang a–b` | `system-ui` | 14px, đậm 600 |
| Dòng tên chương | `system-ui` | 12px, màu `#9aa0b0`, **1 dòng + ellipsis**, tooltip tên đầy đủ |
| Editor | `ui-monospace` | 13px / 1.5 (điều chỉnh được 11–18px trong Options) |
| Preview | `system-ui` | 14px / 1.6; code trong preview dùng `ui-monospace` 13px |
| Footer, banner, tooltip | `system-ui` | 12px |
| Nút | `system-ui` | 13px, đậm 500 |

### 2.3. Hình khối & chuyển động

- Bo góc: nút/ô nhập 4px; thẻ/banner 8px; modal 12px.
- Bóng: modal `0 14px 44px rgba(0,0,0,.5)`; panel không bóng (phẳng, chia bằng viền trái 1px `#444`).
- Chuyển động: đổi tab 160ms; thu gọn/mở panel 200ms; banner trượt vào 180ms; toast 240ms; easing chuẩn `cubic-bezier(.2,.8,.2,1)`. Không animation khi `prefers-reduced-motion`.
- Biểu tượng: emoji tối giản đúng SRS (`📝` nút nổi/header, `–` thu gọn, `▾` menu, `✓` đã lưu, `⚠` cảnh báo). Placeholder editor **không emoji** (NFR-U5).

---

## 3. S1 — VIEWER + NOTE PANEL (màn hình chính)

### 3.1. Bố cục tổng thể
Cửa sổ tab chia hai vùng dọc: **vùng PDF bên trái** chiếm toàn bộ phần còn lại, **panel ghi chú bên phải rộng cố định 380px**, cao full cửa sổ (`fixed; right:0; top:0; bottom:0`). Viewer PDF.js **co lại** đúng 380px, không bị panel che nội dung (FR-02.1). Thanh toolbar gốc của PDF.js (trang, zoom, tìm kiếm, mục lục) giữ nguyên trong vùng trái.

### 3.2. Panel — thứ tự khối từ trên xuống

**Khối 1 — Header (cao 44px):** trái là nhãn "📝 Ghi chú" (15px đậm); phải là hai nút vuông 28×28: "Khoảng trang" (mở S4, tooltip "Sửa khoảng trang của ghi chú hiện tại") và "–" (thu gọn panel, tooltip "Ẩn panel ghi chú"). Mọi nút có `aria-label` tương ứng.

**Khối 2 — Banner (tuỳ điều kiện, xem 3.5):** nằm ngay dưới header, đẩy nội dung xuống, không che editor.

**Khối 3 — Thông tin đơn vị:** dòng "Trang a–b" (14px đậm, en-dash U+2013). Ngay dưới là dòng tên chương (12px, `#9aa0b0`, chấm màu `#2dd4bf` đầu dòng) — **chỉ hiện khi đơn vị có tên chương**; đơn vị chunk/manual không tên thì ẩn hẳn dòng này (FR-10.2). Tên dài cắt ellipsis, hover hiện tooltip tên đầy đủ (NFR-U6).

**Khối 4 — Chip chế độ:** nút nhỏ dạng chip, nhãn "Chương ▾" hoặc "Trang ▾" theo `state.mode`. Bấm mở S5. Tooltip: "Chế độ tạo ghi chú mới".

**Khối 5 — Tabs:** hai tab "Soạn" và "Xem trước", gạch chân tab active màu `#4da3ff` trượt 160ms. Tab Soạn chỉ hiện textarea; tab Xem trước chỉ hiện div preview (FR-03.1).

**Khối 6 — Vùng soạn thảo (chiếm phần còn lại, cuộn độc lập):**
- *Tab Soạn:* textarea nền `#2a2a30`, chữ `#e8e8ea`, font mono 13px/1.5, padding 12px, không resize tay, placeholder "Ghi chú Markdown cho khoảng trang này…". Con trỏ và vùng chọn giữ nguyên khi chuyển trang trong cùng đơn vị (FR-02.3).
- *Tab Xem trước:* render GFM đã sanitize. Heading, đậm/nghiêng, list, blockquote (viền trái 3px `#444`), code block nền `#191922`, bảng viền `#444`. Task list hiển thị ký tự tĩnh ☐/☑ (không bấm được). Ảnh remote thay bằng chip xám "[ảnh đã chặn]" (FR-03.8). Link màu `#4da3ff`, mở tab mới. Preview trống hiện chữ mờ "Chưa có nội dung để xem trước.". Render debounce 150ms; note > 100KB chỉ render khi bấm nút "Render" (FR-03.10).
- *Trạng thái chờ outline:* nếu trang hiện tại chưa có đơn vị và outline đang phân giải, vùng này thay bằng spinner + "Đang phân tích mục lục…" tối đa 3 giây; các đơn vị đã có vẫn soạn bình thường (FR-09.8).

**Khối 7 — Footer (cao 32px, viền trên 1px):** hai cụm, `aria-live="polite"`:
- Trái — trạng thái lưu IDB: "Sẵn sàng" → "Đang lưu..." → "Đã lưu HH:mm"; lỗi thì "Không lưu được — ghi chú chỉ tồn tại trong phiên này" kèm nút "Thử lại".
- Phải — trạng thái mirror `.md`: ".md ✓" (xanh) / ".md chờ quyền" (vàng) / ".md lỗi" (đỏ) / ".md bị khoá" / ".md xung đột" / "—" (mirror tắt hoặc không hỗ trợ).

### 3.3. Hành vi điều hướng
Mỗi lần đổi trang, panel xác định đơn vị theo thứ tự manual → chapter → chunk → tạo mới theo chế độ (FR-02.7). Trong cùng đơn vị: nội dung, con trỏ, tab đang mở **không đổi**. Ra ngoài đơn vị: flush note cũ rồi nạp note mới; tiêu đề và dòng chương cập nhật tương ứng. Tiêu đề luôn phản ánh đúng khoảng trang của đơn vị đang phục vụ.

### 3.4. Ẩn/hiện panel
Bấm "–": panel trượt ra phải trong 200ms, vùng PDF mở rộng toàn chiều ngang; đồng thời xuất hiện **nút nổi 📝** hình tròn 40px tại `top:12px; right:12px` của vùng viewer, nền `#2a2a30`, viền `#444`, tooltip "Hiện panel ghi chú". Bấm nút nổi: panel trượt vào, giữ nguyên đơn vị, nội dung đang gõ và tab đang mở (FR-06.3). Trạng thái ẩn/hiện không nhớ qua phiên.

### 3.5. Banner trong panel (cao 36–48px, nền tối pha màu cảnh báo, chữ 12px)

| Điều kiện | Chuỗi hiển thị | Nút đi kèm |
|---|---|---|
| Mất quyền thư mục (E-10) | "Đồng bộ .md tạm dừng — bấm «Cấp quyền thư mục»" | "Cấp quyền thư mục" → gọi xin quyền ngay trong click; thành công thì banner biến mất, footer về ".md ✓", toast "Đã cấp quyền thư mục — đồng bộ .md tiếp tục" |
| Từ chối quyền (E-11) | "Không có quyền ghi thư mục — ghi chú vẫn lưu trong trình duyệt" | "Mở cài đặt" → S3 |
| Thư mục mất (E-12) | "Không tìm thấy thư mục lưu trữ — chọn lại thư mục" | "Chọn lại thư mục" → mở picker trong tab này |
| File bị sửa ngoài (E-14) | "File .md đã được sửa bên ngoài" | "Ghi đè (có bản sao lưu)" / "Giữ bản ngoài" |
| Đa tab (FR-11.1) | "PDF này đang mở ở tab khác — thay đổi có thể ghi đè nhau" | không nút, chỉ cảnh báo |
| Ẩn danh (E-09) | "Phiên ẩn danh — ghi chú sẽ mất khi đóng phiên" | không nút |
| IDB lỗi (E-03) | "Không lưu được — ghi chú chỉ tồn tại trong phiên này" | "Thử lại" |

Banner nền vàng cho cảnh báo chờ, nền đỏ cho lỗi mất dữ liệu, nền xanh-xám cho thông tin. Nhiều banner cùng lúc: xếp chồng theo thứ tự ưu tiên lỗi dữ liệu > quyền > đa tab > ẩn danh, tối đa 2 banner hiển thị, phần còn lại gom vào toast.

---

## 4. S2 — POPUP TIỆN ÍCH (rộng 320px)

Từ trên xuống:
1. **Header:** "PDF Markdown Notes" + phiên bản nhỏ.
2. **Toggle redirect:** checkbox nhãn "Tự động mở PDF bằng tiện ích", mặc định bật, đồng bộ `storage.sync` (FR-07.1/2). Tắt → toast nhỏ "Đã tắt tự chuyển hướng PDF".
3. **Thẻ thư mục lưu trữ:** nhãn "Thư mục .md", tên thư mục người dùng đã chọn (vd "PDF-Notes") hoặc "Chưa chọn"; chấm trạng thái quyền (xanh/vàng/đỏ) kèm chữ "Sẵn sàng" / "Cần cấp lại quyền" / "Không hỗ trợ". Nút "Mở cài đặt lưu trữ" → mở S3 trong tab mới. **Popup không bao giờ mở picker hay prompt quyền** (quyết định D2/D3).
4. **Khoá PDF hiện tại** (FR-07.3): dòng chữ nhỏ 11px, màu phụ, hiển thị `pdfUrl` đã chuẩn hoá của tab đang mở, cắt giữa bằng ellipsis, tooltip toàn bộ; giúp người dùng hiểu phạm vi lưu ghi chú.
5. **Footer:** link "Giới hạn & trợ giúp" → mục cuối S3.

---

## 5. S3 — TRANG OPTIONS (tab đầy đủ)

Trang một cột, rộng tối đa 720px, căn giữa, nền tối cùng ngôn ngữ panel. Các khối:

**Khối A — Lưu trữ thư mục (.md):**
- Dòng mô tả: "Ghi chú được lưu trong trình duyệt (IndexedDB) và đồng bộ ra file .md thật trong thư mục bạn chọn."
- Nút chính "Chọn thư mục lưu trữ" / khi đã chọn thì "Đổi thư mục" — mở picker **tại tab này**, xin quyền ghi ngay lúc chọn.
- Dòng trạng thái quyền + nút "Cấp quyền thư mục" (chỉ hiện khi cần; bấm trong click handler).
- Nút phụ: "Xuất tất cả .md", "Sao chép sang thư mục mới", "Tải .md thủ công" (fallback khi trình duyệt không hỗ trợ API — E-15).
- Khi không hỗ trợ (Brave sau flag, ẩn danh): ẩn nút chọn thư mục, thay bằng dòng giải thích "Trình duyệt không hỗ trợ ghi thư mục — dùng nút Tải .md" (E-15).

**Khối B — Ghi chú:** ô "Chunk mặc định toàn cục" (1–100) — thuộc v1.2, hiện ở dạng disabled kèm nhãn "v1.2"; ô "Cỡ chữ editor" 11–18px áp dụng ngay.

**Khối C — Hành vi:** toggle redirect (đồng bộ với popup); công tắc "Đồng bộ file .md" (tắt → footer mirror "—", IDB vẫn lưu).

**Khối D — Giới hạn & trợ giúp:** liệt kê bằng lời các giới hạn đã tài liệu hoá: quyền thư mục phải cấp lại sau mỗi phiên trình duyệt (có thể chọn "Allow on every visit" nếu Chrome hỏi); ẩn danh không lưu bền; nhiều tab cùng PDF ghi đè theo bản sau cùng; URL có token phiên đã được bỏ qua khi định danh ghi chú.

---

## 6. S4 / S5 — HỘP THOẠI & MENU

### 6.1. Hộp thoại khoảng trang (S4)
Modal 360px giữa màn hình, scrim mờ 60%, tiêu đề "Sửa khoảng trang". Hai ô nhập số xếp dọc: "Trang bắt đầu", "Trang kết thúc", giá trị khởi tạo theo đơn vị hiện tại. Nút "Huỷ" và "Áp dụng". Focus đặt vào ô đầu; Tab xoay vòng trong modal; Esc = Huỷ; bấm scrim = Huỷ.

**Validate khi Áp dụng — sai thì hiện alert (hộp thoại cảnh báo một nút "OK"), không áp dụng gì:**

| Điều kiện | Chuỗi alert chính xác |
|---|---|
| Rỗng / không phải số nguyên | "Vui lòng nhập số nguyên dương." |
| start < 1 | "Trang bắt đầu phải ≥ 1." |
| end < start | "Trang kết thúc phải ≥ trang bắt đầu." |
| end > numPages | "PDF chỉ có {numPages} trang. Khoảng trang không được vượt quá trang cuối." |

**Xác nhận overlap:** nếu khoảng mới chồng lên range manual/chunk khác có note khác rỗng, hiện hộp thoại thứ hai: tiêu đề "Xoá các khoảng trang chồng lấn?", nội dung "Sửa khoảng trang sẽ xoá N ghi chú có nội dung:" kèm danh sách "Trang a–b · X ký tự", hai nút "Huỷ" / "Tiếp tục". Huỷ giữ nguyên 100%; Tiếp tục xoá conflict, di trú note sang khoá mới, range thành manual, giữ tên chương nếu có. Range lớp chapter không bị xoá. Toàn bộ thao tác nguyên tử; xong có toast "Đã đổi khoảng trang".

### 6.2. Menu chế độ (S5)
Thả từ chip, rộng 220px, hai mục:
- "Theo chương" — kèm mô tả phụ "Dùng mục lục có sẵn của PDF"; **disabled** (chữ mờ, không bấm được) khi PDF không có outline hoặc phân giải lỗi.
- "Theo số trang" — kèm ô nhập chunk nhỏ (1–100) ngay trong mục; giá trị ngoài khoảng → alert "Chunk phải là số nguyên trong khoảng 1–100." và không áp dụng.
Mục đang chọn có dấu ✓ và nền nhấn `#2a2a30`. Đổi chế độ không xoá note/range; các range chunk có nội dung chồng chương được nâng thành manual, range rỗng bị dọn (FR-09.7) — kết quả nhìn thấy: không ghi chú nào biến mất khỏi panel.

### 6.3. Các hộp thoại khác
- **Ghi đè file sửa ngoài:** "File .md đã được sửa bên ngoài" + hai lựa chọn "Ghi đè (có bản sao lưu)" / "Giữ bản ngoài"; ghi đè tạo bản sao lưu rồi mới ghi.
- **Xác nhận reset/xoá** (nếu có thao tác phá huỷ): luôn nêu rõ số lượng bị ảnh hưởng, nút nguy hiểm màu `#ff5470`, nút an toàn đặt trước.

---

## 7. DANH MỤC CHUỖI UI CHÍNH (tiếng Việt, dùng nguyên văn)

| Ngữ cảnh | Chuỗi |
|---|---|
| Header panel | "📝 Ghi chú" |
| Thông tin khoảng | "Trang a–b" (en-dash) |
| Tabs | "Soạn" · "Xem trước" |
| Placeholder editor | "Ghi chú Markdown cho khoảng trang này…" |
| Preview trống | "Chưa có nội dung để xem trước." |
| Ảnh bị chặn | "[ảnh đã chặn]" |
| Chờ outline | "Đang phân tích mục lục…" |
| Footer lưu | "Sẵn sàng" · "Đang lưu..." · "Đã lưu HH:mm" · "Không lưu được — ghi chú chỉ tồn tại trong phiên này" |
| Footer mirror | ".md ✓" · ".md chờ quyền" · ".md lỗi" · ".md bị khoá" · ".md xung đột" · "—" |
| Nút | "Khoảng trang" · "–" · "📝" · "Chương ▾" / "Trang ▾" · "Cấp quyền thư mục" · "Chọn thư mục lưu trữ" · "Đổi thư mục" · "Xuất tất cả .md" · "Tải .md" · "Thử lại" · "Huỷ" · "Áp dụng" · "Tiếp tục" · "OK" |
| Popup | "Tự động mở PDF bằng tiện ích" · "Thư mục .md" · "Chưa chọn" · "Mở cài đặt lưu trữ" |
| Context menu | "Mở bằng PDF Notes" |
| PDF mật khẩu | "PDF cần mật khẩu — mở khoá để bắt đầu ghi chú" |
| Lỗi file:// | "Bật «Allow access to file URLs» cho tiện ích trong chrome://extensions" |
| Outline lỗi | "Không đọc được mục lục — chia theo số trang" |
| Note lớn | "Ghi chú lớn (>100KB) — có thể chậm khi xem trước" |
| Bộ nhớ đầy | "Bộ nhớ đầy — xoá bớt ghi chú/PDF cũ" |
| Dữ liệu hỏng | "Dữ liệu ghi chú bị lỗi — đã tạo bản mới (bản cũ được sao lưu)" |

---

## 8. MA TRẬN TRẠNG THÁI HIỂN THỊ

| Trạng thái hệ thống | Footer trái | Footer phải | Banner | Editor |
|---|---|---|---|---|
| Bình thường, đã cấp quyền | Đã lưu HH:mm | .md ✓ | — | soạn được |
| Đang gõ (debounce) | Đang lưu... | giữ nguyên | — | soạn được |
| Chờ quyền thư mục | Đã lưu HH:mm | .md chờ quyền | E-10 + nút cấp | soạn được |
| IDB lỗi (DEGRADED) | Không lưu được… + Thử lại | .md lỗi | E-03 | soạn được (in-memory) |
| File .md bị khoá | Đã lưu HH:mm | .md bị khoá | E-13 | soạn được |
| File .md sửa ngoài | Đã lưu HH:mm | .md xung đột | E-14 + 2 lựa chọn | soạn được |
| Mirror tắt / không hỗ trợ | Đã lưu HH:mm | — | E-15 (nếu không hỗ trợ) | soạn được |
| Ẩn danh | Đã lưu (trong phiên) | — | E-09 | soạn được |
| Chờ outline (≤3s) | Sẵn sàng | giữ nguyên | — | spinner nếu đơn vị chưa tạo |
| PDF lỗi / mật khẩu | — | — | — | panel ẩn hoặc chờ (E-01/E-02) |

---

## 9. THỜI GIAN & CHUYỂN ĐỘNG NHÌN THẤY

| Mốc | Giá trị | Người dùng thấy gì |
|---|---|---|
| Debounce lưu IDB | 400ms ± 50 | Ngừng gõ ~nửa giây → "Đang lưu..." rồi "Đã lưu" |
| Debounce preview | 150ms | Preview cập nhật gần tức thì khi đang mở tab Xem trước |
| Mirror .md | 1000ms + flush points | ".md ✓" trễ hơn "Đã lưu" ~1 giây |
| Chờ outline | tối đa 3s | Spinner "Đang phân tích mục lục…" |
| Timeout PDF.js | 15s | Quá hạn → panel không hiện, viewer báo lỗi |
| Thu gọn/mở panel | 200ms | Trượt ngang, PDF giãn theo |
| Đổi tab / menu / banner / toast | 160 / 160 / 180 / 240ms | Mượt, không giật |

---

## 10. BÀN PHÍM & KHẢ NĂNG TIẾP CẬN

- `Ctrl/Cmd+S` trong editor: chặn hành vi trình duyệt, lưu ngay, footer "Đã lưu".
- `Esc`: đóng modal/menu theo ngữ nghĩa Huỷ; `Tab` xoay vòng trong modal (focus trap), focus trả về nút mở khi đóng.
- Thứ tự focus panel: header → chip chế độ → tabs → editor → footer.
- Footer và banner dùng `aria-live="polite"`; mọi nút có `aria-label` + tooltip; ảnh bị chặn có nhãn văn bản.
- Tương phản ≥ 4.5:1; trạng thái không chỉ dựa vào màu (kèm ✓/⚠/chữ).
- Tôn trọng `prefers-reduced-motion`: tắt trượt/co giãn.

---

## 11. CỬA SỔ HẸP (quy tắc bổ sung cho UI)

- Chiều ngang cửa sổ < 900px: panel chuyển sang **overlay** trượt từ phải (rộng tối đa 86% cửa sổ), có scrim mờ che vùng PDF; nút nổi 📝 giữ nguyên để mở/đóng; mặc định ẩn để ưu tiên đọc.
- Popup giữ 320px; Options chuyển một cột co giãn, các nút xuống dòng.
- Không breakpoint nào làm mất chữ đang gõ: mọi thay đổi bố cục đều flush trước.

---

## 12. BẢN ĐỒ LỖI → VỊ TRÍ HIỂN THỊ

| Mã | Hiện ở đâu | Hình thức |
|---|---|---|
| E-01, E-02 | Vùng viewer | Thông báo lỗi của viewer / lớp phủ chờ mật khẩu; panel ẩn hoặc chờ |
| E-03, E-04 | Footer + banner panel | Chữ lỗi đỏ + nút "Thử lại" |
| E-05 | Footer/toast nhẹ | "Không đọc được mục lục — chia theo số trang" |
| E-06 | Toast | Thông báo đã sao lưu + tạo bản mới |
| E-08 | Footer | Cảnh báo note/state lớn |
| E-09 | Banner | Cảnh báo ẩn danh |
| E-10…E-15 | Banner panel + footer phải | Theo bảng 3.5 và ma trận mục 8 |

---

## 13. KHÔNG THUỘC UI v1.1

Theme sáng, phím tắt mở rộng (`Ctrl+M/B/I`), dropdown danh sách chương để nhảy nhanh, trình duyệt danh sách ghi chú (note browser), tuỳ chọn cho phép ảnh remote, chunk toàn cục — tất cả hiển thị ở dạng disabled kèm nhãn "v1.2" nếu cần nhắc trong Options, không xuất hiện trong luồng chính.

---

Tài liệu này là mô tả UI đầy đủ bằng lời, khớp từng khối với FR/NFR/E/AC trong SRS. Nếu cần, bước tiếp theo tôi có thể tách riêng **bảng chuỗi i18n dạng key–value** (để đưa thẳng vào `_locales/vi/messages.json`) hoặc **checklist QA theo từng bề mặt S1–S8**.
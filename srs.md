# ĐẶC TẢ YÊU CẦU PHẦN MỀM (SRS)
## Ứng dụng: **PDF Markdown Notes** — Tiện ích mở rộng trình duyệt

| Mục | Nội dung |
|---|---|
| Tên tài liệu | SRS – PDF Markdown Notes |
| Phiên bản tài liệu | 1.1 |
| Phiên bản sản phẩm mục tiêu | v1.1 |
| Chuẩn tham chiếu | ISO/IEC/IEEE 29148:2018 |
| Đối tượng đọc | Dev, QA, PO, người dùng cuối |
| Quy ước ưu tiên | **Must** (bắt buộc, trong v1.1) · **Should** (nên có, trong v1.1) · **Could** (hoãn, xem Lộ trình) |

---

## 1. GIỚI THIỆU

### 1.1. Mục đích
Xác định đầy đủ yêu cầu chức năng, phi chức năng, giao diện, dữ liệu và tiêu chí nghiệm thu cho tiện ích **PDF Markdown Notes** trên trình duyệt Chromium: xem PDF trong trình duyệt, viết ghi chú Markdown gắn với khoảng trang hoặc chương, lưu cục bộ theo từng PDF.

### 1.2. Phạm vi
- Xem PDF qua viewer PDF.js tích hợp trong extension.
- Ghi chú Markdown gắn với **một khoảng trang** `[a, b]` hoặc **một chương** (theo outline PDF).
- Ghi chú giữ nguyên khi điều hướng trong cùng đơn vị; ra ngoài đơn vị → tự chuyển/tạo ghi chú tương ứng.
- Tự phát hiện outline PDF, chia ghi chú theo chương; fallback chia theo số trang (`chunk`).
- Chuyển đổi chế độ chia **Chương / Trang** theo từng PDF.
- Dữ liệu lưu 100% cục bộ (IndexedDB), khoá theo URL PDF đã chuẩn hoá.

### 1.3. Định nghĩa & thuật ngữ

| Thuật ngữ | Định nghĩa |
|---|---|
| **Range** | Cặp `(start, end)`, số nguyên, `1 ≤ start ≤ end`, biểu diễn khoảng trang `[start, end]` |
| **rangeKey** | Chuỗi `"start-end"` định danh một range |
| **Chunk** | Số trang mặc định của một range mới khi chia theo trang. Mặc định 1, hợp lệ `[1, 100]` |
| **Note** | Chuỗi Markdown gắn với một `rangeKey` |
| **Đơn vị ghi chú (Unit)** | Range đang phục vụ trang hiện tại; quyết định nội dung hiển thị trên panel |
| **Lớp range (`source`)** | `manual` (người dùng tạo/sửa) · `chapter` (sinh từ outline) · `chunk` (sinh theo số trang) |
| **Outline** | Cây bookmark/mục lục của PDF; mỗi item có `title`, `dest`, `items`, `url` |
| **Chương (Chapter)** | Item outline được chọn làm đơn vị chia; mặc định lấy cấp cao nhất (top-level) |
| **Chapter Range** | `[start, end]` của chương: `start` = trang dest trỏ tới; `end` = trang bắt đầu chương kế tiếp − 1 (chương cuối: trang cuối PDF) |
| **Chapter Mode / Chunk Mode** | Chế độ tạo range mới theo chương / theo số trang |
| **Front-matter** | Các trang trước chương đầu tiên (bìa, mục lục…), không thuộc chương nào |
| **Fingerprint** | Mã định danh nội dung file PDF do PDF.js cung cấp; dùng kiểm tra file không đổi |
| **Token phiên** | Tham số query mang tính phiên/xác thực/tracking, không định danh nội dung PDF |
| **DEGRADED** | Trạng thái panel soạn thảo in-memory khi không ghi được IndexedDB |
| **Viewer / Panel** | Trang `viewer.html` của PDF.js trong extension / sidebar ghi chú rộng 380px bên phải |
| **Overlap** | Hai range giao nhau: `r1.start ≤ r2.end && r2.start ≤ r1.end` |

### 1.4. Tài liệu tham chiếu
- ISO/IEC/IEEE 29148:2018 — Requirements engineering.
- Chrome Extensions — Manifest V3.
- PDF.js API: `PDFViewerApplication.eventBus`, `PDFDocumentProxy.getOutline/getDestination/getPageIndex`, `numPages`, `fingerprints`.
- CommonMark / GFM (GitHub Flavored Markdown).

---

## 2. MÔ TẢ TỔNG QUAN

### 2.1. Bối cảnh sản phẩm
Trình xem PDF mặc định của Chromium (PDFium) không cho extension đọc số trang hiện tại → sản phẩm dùng viewer PDF.js để quan sát sự kiện chuyển trang. Hệ thống gồm 4 thành phần: **Background service worker**, **PDF.js viewer**, **Note Panel**, **IndexedDB store**.

### 2.2. Đối tượng người dùng

| Persona | Đặc điểm | Nhu cầu chính |
|---|---|---|
| Sinh viên / Researcher | Đọc paper, sách dài | Ghi chú theo chương/trang, tra cứu lại |
| Reviewer tài liệu | Đọc tài liệu kỹ thuật | Note theo nhóm trang, xuất `.md` (v1.2) |
| Người dùng phổ thông | Đọc hợp đồng, hướng dẫn | Note nhanh, không cài app ngoài |

### 2.3. Ràng buộc

| Mã | Ràng buộc |
|---|---|
| C-01 | Chỉ hỗ trợ trình duyệt nhân Chromium: Chrome ≥ 110, Edge ≥ 110, Brave, Cốc Cốc |
| C-02 | Bắt buộc redirect PDF sang viewer của extension; không thể chèn panel vào viewer gốc của trình duyệt |
| C-03 | Không backend; dữ liệu 100% local |
| C-04 | Manifest V3; không background page; không blocking webRequest |
| C-05 | Chất lượng chia theo chương phụ thuộc outline có sẵn trong PDF; hệ thống không tự sinh outline |
| C-06 | Một số outline item có `dest` không phân giải được; hệ thống phải bỏ qua an toàn |
| C-07 | PDF trả về qua `Content-Type` mà URL không có đuôi `.pdf` không thể tự nhận diện trong MV3; chỉ hỗ trợ qua thao tác thủ công (FR-01.8) |
| C-08 | Trong cửa sổ ẩn danh, dữ liệu IndexedDB chỉ tồn tại trong phiên (ephemeral) |

### 2.4. Giả định
- A-01: Người dùng có quyền truy cập PDF (không paywall/auth phức tạp).
- A-02: PDF là file tĩnh, không phải stream liên tục.
- A-03: Ổ đĩa còn ≥ 50MB cho IndexedDB.
- A-04: PDF có outline thường theo cấu trúc phân cấp chương → mục → tiểu mục.
- A-05: Trang bắt đầu chương xác định được từ `dest` của outline item.

### 2.5. Ngoài phạm vi (v1.1)
Đồng bộ đám mây/đa thiết bị · chia sẻ nhiều người dùng · highlight/annotation lên trang PDF · xuất PDF nhúng ghi chú · Firefox/Safari · tự sinh outline (OCR/heuristic) · sửa outline gốc · PDF dạng `blob:`/`data:` · PDF mở bằng POST hoặc trong iframe.

---

## 3. YÊU CẦU CHỨC NĂNG

### FR-01 — Nhận diện & chuyển hướng PDF

| Mã | Yêu cầu | Ưu tiên |
|---|---|---|
| FR-01.1 | Tự động chuyển hướng sang viewer nội bộ khi điều hướng tới URL có `pathname` kết thúc `.pdf` (không phân biệt hoa/thường, cho phép query/hash). URL viewer: `viewer.html?file=<URL đã encode>` | Must |
| FR-01.2 | Chỉ redirect navigation ở `frameId = 0` (tab chính) | Must |
| FR-01.3 | Không redirect URL thuộc `chrome-extension://` (bất kỳ extension) — chống vòng lặp | Must |
| FR-01.4 | Redirect bật/tắt qua popup; lưu `chrome.storage.sync`; mặc định **bật** | Must |
| FR-01.5 | Tab đóng giữa lúc redirect → bỏ qua im lặng, không crash service worker | Must |
| FR-01.6 | URL `file://`: redirect khi extension được cấp "Allow access to file URLs"; nếu mở thất bại → thông báo lỗi kèm hướng dẫn cấp quyền (E-01) | Must |
| FR-01.7 | Giữ tham số trang `#page=N` từ URL gốc, truyền vào viewer để mở đúng trang | Should |
| FR-01.8 | Context menu trên link: **"Mở bằng PDF Notes"** → mở viewer với URL link (bù cho C-07) | Should |
| FR-01.9 | Trong cửa sổ ẩn danh: footer panel hiển thị cảnh báo dữ liệu chỉ tồn tại trong phiên (E-09) | Should |

**Bảng luật nhận diện URL:**

| URL | Redirect tự động |
|---|---|
| `https://x.com/a.pdf` · `a.PDF` · `a.pdf?v=2` · `a.pdf#page=5` | ✅ |
| `file:///…/a.pdf` | ✅ (điều kiện FR-01.6) |
| `https://x.com/download?id=1` (Content-Type: application/pdf) | ❌ — dùng FR-01.8 |
| `blob:` · `data:` | ❌ |
| `chrome-extension://…` | ❌ |
| PDF trong iframe / mở bằng POST | ❌ |

### FR-02 — Hiển thị ghi chú theo đơn vị nội dung

| Mã | Yêu cầu | Ưu tiên |
|---|---|---|
| FR-02.1 | Khi viewer khởi tạo xong, panel hiển thị bên phải, không che nội dung PDF (vùng PDF co lại tương ứng) | Must |
| FR-02.2 | Mỗi sự kiện chuyển trang, xác định đơn vị ghi chú của trang hiện tại theo **FR-02.7**; nạp note tương ứng | Must |
| FR-02.3 | Chuyển trang **trong cùng đơn vị**: nội dung panel giữ nguyên, không reset, không mất dữ liệu đang gõ | Must |
| FR-02.4 | Chuyển trang **ra ngoài đơn vị hiện tại**: flush note đang soạn, rồi chuyển sang note của đơn vị mới (hoặc tạo mới) | Must |
| FR-02.5 | Tiêu đề panel hiển thị `Trang a–b`; kèm tên chương nếu đơn vị có tên chương | Must |
| FR-02.6 | Danh sách range luôn sắp xếp tăng dần theo `start` | Must |
| FR-02.7 | **Quy tắc xác định đơn vị** (thứ tự ưu tiên, áp dụng cho trang `p`): | Must |

**FR-02.7 — Bảng quy tắc tra cứu & tạo đơn vị:**

| Bước | Điều kiện | Hành vi |
|---|---|---|
| 1 | Có range lớp `manual` chứa `p` | Dùng range đó |
| 2 | Có range lớp `chapter` chứa `p` | Dùng range đó |
| 3 | Có range lớp `chunk` chứa `p` | Dùng range đó |
| 4a | Không range nào chứa `p`; mode = `chapter`; outline đã phân giải; có chương chứa `p` | Tạo Chapter Range `[start, end]` của chương, kèm tên chương |
| 4b | Không range nào chứa `p`; mode = `chapter`; outline **đang phân giải** | Hoãn tạo mới tối đa **3 giây**; hiển thị "Đang phân tích mục lục…"; các range đã có vẫn soạn bình thường |
| 4c | Còn lại (mode = `chunk`, hoặc `p` ngoài mọi chương, hoặc outline không có/lỗi) | Tạo range chunk `[p, min(p + chunk − 1, numPages, start của range kế tiếp gần nhất − 1)]` |

| Mã | Yêu cầu | Ưu tiên |
|---|---|---|
| FR-02.8 | Range chunk mới không được overlap bất kỳ range nào; `end` bị chặn bởi `numPages` và range kế tiếp | Must |
| FR-02.9 | Khi chưa biết tổng số trang (viewer chưa khởi tạo xong), không tạo range; panel ở trạng thái chờ | Must |

**Bất biến chồng lấn (áp dụng toàn hệ thống):**
- `manual`–`manual`, `chapter`–`chapter`, `chunk`–`chunk`: **không** overlap.
- Range `manual` **được phép nằm trong** range `chapter` (tra cứu ưu tiên manual).
- Range `chunk` không overlap bất kỳ range nào.

### FR-03 — Soạn thảo Markdown

| Mã | Yêu cầu | Ưu tiên |
|---|---|---|
| FR-03.1 | Panel có 2 tab: **Soạn** (textarea) và **Xem trước** (HTML render) | Must |
| FR-03.2 | Hỗ trợ GFM: heading, bold, italic, list, task list, code inline, code block, link, blockquote, table. Task list hiển thị dạng ký tự tĩnh ☐/☑ (không tương tác) | Must |
| FR-03.3 | Auto-save sau **400ms** kể từ lần gõ cuối (debounce) | Must |
| FR-03.4 | Footer hiển thị trạng thái: `Sẵn sàng` → `Đang lưu...` → `Đã lưu` | Must |
| FR-03.5 | Các điểm **flush bắt buộc** ngoài debounce: (a) trước khi đổi đơn vị ghi chú; (b) trước khi đổi mode; (c) trước khi sửa range; (d) khi tab bị ẩn (`visibilitychange → hidden`); (e) `pagehide`; (f) `beforeunload` (best-effort) | Must |
| FR-03.6 | HTML render phải được sanitize: loại `<script>`, mọi event handler `on*`, URL scheme `javascript:`, thẻ nhúng (`iframe`, `object`, `embed`), form; không cho raw HTML đi qua chưa lọc | Must |
| FR-03.7 | Link trong preview mở tab mới với thuộc tính an toàn (`noopener noreferrer`); chỉ chấp nhận scheme `http`, `https`, `mailto` | Must |
| FR-03.8 | **Chặn ảnh remote mặc định** trong preview; vị trí ảnh hiển thị placeholder `[ảnh đã chặn]`. Không tải bất kỳ tài nguyên remote nào từ preview | Must |
| FR-03.9 | Phím `Ctrl/Cmd+S` trong editor: chặn hành vi mặc định của trình duyệt, flush ngay, footer `Đã lưu` | Should |
| FR-03.10 | Preview render debounce 150ms khi tab Xem trước mở; note > 100KB chỉ render khi người dùng chủ động bấm render | Should |
| FR-03.11 | Tại một thời điểm chỉ có một thao tác ghi cho mỗi PDF; thay đổi phát sinh trong lúc ghi được ghi tiếp ngay sau đó (không ghi song song, không mất bản mới nhất) | Must |

### FR-04 — Quản lý khoảng trang

| Mã | Yêu cầu | Ưu tiên |
|---|---|---|
| FR-04.1 | Nút **"Khoảng trang"** cho sửa `start`, `end` của đơn vị hiện tại (nhập tuần tự: start trước, end sau) | Must |
| FR-04.2 | Validate đầu vào theo bảng dưới; đầu vào không hợp lệ → **hiển thị alert** với thông báo tương ứng và **không áp dụng** thay đổi | Must |
| FR-04.3 | Khi sửa range gây overlap với range lớp `manual`/`chunk` khác: nếu **bất kỳ note nào của các range đó khác rỗng** → hộp thoại xác nhận liệt kê các khoảng trang sẽ bị xoá; người dùng xác nhận → xoá các range đó cùng note; huỷ → giữ nguyên toàn bộ. Range lớp `chapter` không bị xoá | Must |
| FR-04.4 | Nội dung note được **di trú** sang `rangeKey` mới khi đổi start/end; khoá cũ bị xoá | Must |
| FR-04.5 | Sau khi sửa, range trở thành lớp `manual`; nếu range có tên chương thì giữ tên chương | Must |
| FR-04.6 | Toàn bộ thao tác sửa range (xoá conflict + di trú note + cập nhật range) phải áp dụng **nguyên tử** — thành công tất cả hoặc không đổi gì | Must |
| FR-04.7 | Cho phép cấu hình `chunk` (số trang mặc định mỗi note mới), mặc định 1, hợp lệ `[1, 100]`; ngoài khoảng → alert và không áp dụng | Should |

**Bảng validate & thông báo alert (FR-04.2):**

| Điều kiện | Thông báo alert |
|---|---|
| Không phải số nguyên / rỗng | `Vui lòng nhập số nguyên dương.` |
| `start < 1` | `Trang bắt đầu phải ≥ 1.` |
| `end < start` | `Trang kết thúc phải ≥ trang bắt đầu.` |
| `end > numPages` | `PDF chỉ có {numPages} trang. Khoảng trang không được vượt quá trang cuối.` |
| Người dùng huỷ ở bước nhập bất kỳ | Huỷ toàn bộ thao tác, không thay đổi dữ liệu, không alert |

### FR-05 — Lưu trữ & khôi phục

| Mã | Yêu cầu | Ưu tiên |
|---|---|---|
| FR-05.1 | Dữ liệu lưu theo khoá `pdfUrl` = **URL PDF đã chuẩn hoá** theo FR-05.5 | Must |
| FR-05.2 | Lưu bằng IndexedDB: DB `pdf-md-notes-v1`, object store `pdfs` (out-of-line key) | Must |
| FR-05.3 | Mở lại cùng PDF → khôi phục toàn bộ ranges + notes + mode + chunk | Must |
| FR-05.4 | `pdfUrl` chưa có trong DB → khởi tạo state mặc định (xem 6.2) | Must |
| FR-05.5 | **Chuẩn hoá khoá URL**: (1) bỏ toàn bộ hash; (2) loại các tham số query là **token phiên / xác thực / tracking** theo Phụ lục B (so khớp tên không phân biệt hoa/thường); (3) các tham số còn lại giữ nguyên, sắp xếp theo tên rồi giá trị; (4) giữ nguyên scheme, host, pathname | Must |
| FR-05.6 | Khi load: kiểm tra và làm sạch state theo các quy tắc toàn vẹn mục 6.3 trước khi đưa vào panel. State không đọc/parse được → sao lưu sang khoá `pdfUrl + "#backup"`, khởi tạo state mới, thông báo E-06 | Must |
| FR-05.7 | Dữ liệu không có trường `schemaVersion` (cấu trúc cũ) → tự động chuyển đổi sang cấu trúc hiện hành; mọi range cũ được phân lớp `manual`; tạo bản sao lưu trước khi chuyển đổi | Must |
| FR-05.8 | Mỗi lần ghi là một giao dịch ghi toàn bộ state của một `pdfUrl`; không ghi từng phần | Must |

### FR-06 — Ẩn/hiện panel

| Mã | Yêu cầu | Ưu tiên |
|---|---|---|
| FR-06.1 | Nút thu gọn `–` → ẩn panel, hiện nút nổi `📝` góc phải trên | Must |
| FR-06.2 | Khi ẩn panel, vùng PDF mở rộng toàn chiều ngang cửa sổ | Must |
| FR-06.3 | Bấm nút nổi `📝` → hiện lại panel, giữ nguyên đơn vị và nội dung đang soạn | Must |
| FR-06.4 | Nhớ trạng thái ẩn/hiện giữa các phiên | Could |

### FR-07 — Cấu hình (Popup)

| Mã | Yêu cầu | Ưu tiên |
|---|---|---|
| FR-07.1 | Checkbox bật/tắt auto-redirect | Must |
| FR-07.2 | Trạng thái popup đồng bộ `chrome.storage.sync` | Must |
| FR-07.3 | Popup hiển thị khoá `pdfUrl` chuẩn hoá của PDF đang mở (giúp người dùng nhận biết phạm vi lưu ghi chú) | Should |
| FR-07.4 | Đặt chunk mặc định toàn cục | Could |

### FR-08 — Phát hiện & phân giải Outline

| Mã | Yêu cầu | Ưu tiên |
|---|---|---|
| FR-08.1 | Sau khi PDF load xong, lấy cây outline qua `pdfDocument.getOutline()` | Must |
| FR-08.2 | Outline `null`/rỗng → đánh dấu **không có outline**, dùng Chunk Mode | Must |
| FR-08.3 | Mỗi item được chọn làm chương phải phân giải `dest` thành số trang bắt đầu (1-based) | Must |
| FR-08.4 | `dest` là chuỗi (named destination) → phân giải qua `getDestination(dest)` thành mảng tường minh rồi xác định trang | Must |
| FR-08.5 | `dest` là mảng tường minh: phần tử đầu là **ref trang** → dùng `getPageIndex(ref) + 1`; phần tử đầu là **số nguyên** (page index trực tiếp) → dùng `giá trị + 1` | Must |
| FR-08.6 | Item không phân giải được (lỗi, destination không tồn tại, trang ngoài `[1, numPages]`) → **bỏ qua item đó**, ghi log, không ảnh hưởng các item khác | Must |
| FR-08.7 | Item chỉ có `url` (link ngoài), không có `dest` hợp lệ → loại | Must |
| FR-08.8 | Sắp xếp chương theo trang bắt đầu tăng dần; các chương trùng trang bắt đầu → **giữ chương đầu tiên** theo thứ tự xuất hiện trong outline | Must |
| FR-08.9 | Giới hạn xử lý **500 item** đầu (theo cấp đang chọn); outline > **1.000 item** → ghi cảnh báo, vẫn hoạt động | Must |
| FR-08.10 | Timeout phân giải toàn bộ: **3 giây**; quá hạn → trạng thái outline `failed`, dùng Chunk Mode, thông báo E-05 | Must |
| FR-08.11 | Tên chương lưu dạng plain text, tối đa 500 ký tự (cắt phần vượt) | Must |
| FR-08.12 | Các trang front-matter không thuộc chương nào; không tự tạo chương cho vùng này | Must |

### FR-09 — Chapter Range & chế độ chia

| Mã | Yêu cầu | Ưu tiên |
|---|---|---|
| FR-09.1 | Mỗi chương tạo thành Chapter Range: `start` = trang bắt đầu chương; `end` = trang bắt đầu chương kế tiếp − 1; chương cuối: `end = numPages` | Must |
| FR-09.2 | Mặc định **Chapter Mode** nếu phân giải thành công ≥ 1 chương; ngược lại Chunk Mode | Must |
| FR-09.3 | Ở Chapter Mode, trang không thuộc chương nào (front-matter, khoảng trống do lỗi dữ liệu) → tạo range chunk tạm theo FR-02.7 bước 4c | Must |
| FR-09.4 | Người dùng chuyển được chế độ **Chương / Trang** bằng điều khiển trong panel; lựa chọn "Theo chương" bị vô hiệu khi không có outline | Should |
| FR-09.5 | Chế độ (`chapter`/`chunk`) lưu theo từng PDF trong state | Must |
| FR-09.6 | Chuyển chế độ **không xoá** note hay range hiện có; các range đã tồn tại tiếp tục phục vụ trang của nó; chế độ chỉ quyết định cách **tạo mới** | Must |
| FR-09.7 | **Chuẩn hoá khi bật Chapter Mode** (lần đầu hoặc chuyển từ Chunk Mode): range `chunk` **có nội dung** overlap chương → chuyển lớp `manual`; range `chunk` **rỗng** overlap chương → xoá. Kết quả: không note nào bị mất hoặc bị che sau khi đổi chế độ | Must |
| FR-09.8 | Cache kết quả phân giải outline theo **fingerprint** của file: mở lại PDF trùng fingerprint và trùng `numPages` → dùng cache, không phân giải lại; fingerprint khác → phân giải lại, không xoá các range hiện có | Should |
| FR-09.9 | Cấu hình độ sâu outline (top-level / toàn cây); mặc định top-level | Could |

### FR-10 — Hiển thị thông tin chương

| Mã | Yêu cầu | Ưu tiên |
|---|---|---|
| FR-10.1 | Đơn vị hiện tại có tên chương → panel hiển thị tên chương bên cạnh dòng `Trang a–b` | Must |
| FR-10.2 | Đơn vị không có tên chương → chỉ hiển thị `Trang a–b` | Must |
| FR-10.3 | Chip hiển thị chế độ hiện tại (`Chương` / `Trang`); bấm mở menu chuyển chế độ | Should |
| FR-10.4 | Tên chương dài: cắt 1 dòng + ellipsis; tooltip hiển thị tên đầy đủ | Must |
| FR-10.5 | Tên chương và mọi chuỗi lấy từ PDF hiển thị dạng **văn bản thuần** (không diễn giải HTML) | Must |
| FR-10.6 | Dropdown danh sách chương để nhảy nhanh đến chương | Could |

### FR-11 — Nhiều tab cùng một PDF

| Mã | Yêu cầu | Ưu tiên |
|---|---|---|
| FR-11.1 | Phát hiện ≥ 2 tab cùng mở một `pdfUrl` → banner cảnh báo trên panel: `PDF này đang mở ở tab khác — thay đổi có thể ghi đè nhau` | Must |
| FR-11.2 | Hành vi ghi mặc định: bản ghi sau cùng thắng (last-write-wins) trên toàn state; giới hạn này phải nêu trong README | Must |
| FR-11.3 | Hợp nhất khi ghi: trong giao dịch ghi, đọc state mới nhất và hợp nhất theo từng range/note — bản có thời điểm cập nhật mới hơn thắng; thao tác xoá được tôn trọng (tombstone) | Should |
| FR-11.4 | Đồng bộ nội dung giữa các tab theo thời gian thực (tab kia tự nạp lại note khi không đang soạn) | Could |

---

## 4. YÊU CẦU PHI CHỨC NĂNG

### 4.1. Hiệu năng

| Mã | Yêu cầu | Chỉ số |
|---|---|---|
| NFR-P1 | Từ khi viewer sẵn sàng trang (`pagesinit`) đến khi panel tương tác được | ≤ 500ms (không tính thời gian chờ phân giải outline — chỉ chặn tạo range mới, tối đa 3s) |
| NFR-P2 | Độ trễ auto-save (debounce) | 400ms ± 50ms |
| NFR-P3 | Render preview note ≤ 50KB | ≤ 100ms |
| NFR-P4 | Chuyển trang mượt | ≥ 55 FPS; không block main thread > 50ms |
| NFR-P5 | Dung lượng IndexedDB | Không giới hạn cứng; cảnh báo khi > 500MB |
| NFR-P6 | Phân giải outline ≤ 500 chương | ≤ 300ms |
| NFR-P7 | Phân giải dest số lượng lớn | Không block main thread; xử lý theo批次 nhỏ, nhường luồng định kỳ |
| NFR-P8 | Ghi một state ≤ 2MB vào IndexedDB | p95 ≤ 50ms |

### 4.2. Độ tin cậy

| Mã | Yêu cầu |
|---|---|
| NFR-R1 | Cửa sổ mất dữ liệu tối đa khi tiến trình bị kill đột ngột ≈ 400ms (debounce) + thời gian ghi (≤ 50ms p95). Khi đóng tab/ẩn cửa sổ, flush ngay tại các điểm quy định ở FR-03.5 để thu hẹp cửa sổ này |
| NFR-R2 | IndexedDB lỗi → panel chuyển **DEGRADED** (soạn in-memory), hiển thị thông báo và nút thử lại; không chặn soạn thảo |
| NFR-R3 | PDF.js không khởi tạo trong 15s hoặc lỗi load → panel không hiển thị, không crash trang |
| NFR-R4 | Outline > 1.000 item: hệ thống vẫn hoạt động (giới hạn xử lý theo FR-08.9), có cảnh báo |

### 4.3. Bảo mật & quyền riêng tư

| Mã | Yêu cầu |
|---|---|
| NFR-S1 | Không gửi bất kỳ dữ liệu note nào ra network; không telemetry |
| NFR-S2 | Sanitize HTML preview theo FR-03.6 |
| NFR-S3 | Quyền tối thiểu: `storage`, `webNavigation`, `contextMenus`, `host_permissions: <all_urls>` (cần để viewer tải PDF cross-origin và nhận URL điều hướng). **Không** yêu cầu `tabs`, `clipboard`, `downloads` |
| NFR-S4 | Chỉ xin thêm quyền khi có tính năng tương ứng (vd `downloads` khi có export) |
| NFR-S5 | Mọi chuỗi nguồn từ PDF (tên chương, metadata) chỉ hiển thị dạng văn bản thuần |
| NFR-S6 | Không nạp mã từ xa: mọi thư viện đóng gói cục bộ, không CDN, không `eval`, không inline script; tuân thủ CSP mặc định MV3 |
| NFR-S7 | Preview không tải tài nguyên remote mặc định (FR-03.8); link ngoài bắt buộc thuộc tính an toàn (FR-03.7) |

### 4.4. Khả dụng & trải nghiệm

| Mã | Yêu cầu |
|---|---|
| NFR-U1 | Theme tối mặc định; theme sáng: Could |
| NFR-U2 | Phím tắt mở rộng (`Ctrl/Cmd+M` focus editor, `+B` bold, `+I` italic): Could |
| NFR-U3 | Mọi nút có tooltip và `aria-label` |
| NFR-U4 | Ngôn ngữ giao diện v1.1: **Tiếng Việt**; toàn bộ chuỗi UI tập trung một nơi, sẵn sàng đa ngôn ngữ |
| NFR-U5 | Placeholder textarea không dùng quá 3 ký tự emoji |
| NFR-U6 | Tên chương truncate 1 dòng + tooltip đầy đủ |
| NFR-U7 | Trạng thái lưu dùng `aria-live="polite"`; hộp thoại nhập range quản lý focus đúng; độ tương phản chữ/nền ≥ 4.5:1 |

### 4.5. Khả năng bảo trì

| Mã | Yêu cầu |
|---|---|
| NFR-M1 | Mã chia module rõ: background, note-panel, notes-store, popup |
| NFR-M2 | Không hard-code phiên bản PDF.js; nâng cấp được qua thư mục vendor, các tuỳ chỉnh viewer phải tái lập được sau nâng cấp |
| NFR-M3 | Có `README.md` hướng dẫn cài đặt, phát triển, và nêu giới hạn last-write-wins (FR-11.2) |

### 4.6. Tương thích

| Mã | Yêu cầu |
|---|---|
| NFR-C1 | Chrome ≥ 110, Edge ≥ 110 |
| NFR-C2 | Hỗ trợ PDF ≤ 200MB |
| NFR-C3 | Manifest V3, không background page |
| NFR-C4 | Thành phần render PDF phải chạy được trên Chrome 110; kiểm chứng bắt buộc trên Chrome 110 và bản stable mới nhất trước mỗi lần phát hành |
| NFR-C5 | Viewer mở được PDF từ mọi origin `http/https` (trong phạm vi host permission) và `file://` (khi được cấp quyền) |

---

## 5. YÊU CẦU GIAO DIỆN NGƯỜI DÙNG

### 5.1. Bố cục panel

```
┌───────────────────────────────────────────────┐
│ [PDF Viewer]                    │ 📝 Ghi chú  │ ← header
│                                 │ [Khoảng trang][–]│
│                                 │ Trang 3–15  │ ← range info
│                                 │ Chương 2: … │ ← tên chương (nếu có)
│                                 │ [Chương ▾]  │ ← chip chế độ
│                                 │ [Soạn][Xem trước]│ ← tabs
│                                 │ <textarea>  │
│                                 │ hoặc preview│
│                                 │ Đã lưu      │ ← footer
└───────────────────────────────────────────────┘
```

### 5.2. Đặc tả thành phần

| Thành phần | Đặc tả |
|---|---|
| Panel | Rộng 380px, `fixed; right:0; top:0; bottom:0` |
| Editor font | `ui-monospace`, 13px, line-height 1.5 |
| Preview font | `system-ui`, 14px |
| Màu | Nền `#1f1f23`, chữ `#e8e8ea`; nút `#2a2a30`, border `#444`, radius 4px |
| Nút nổi khi ẩn | `top:12px; right:12px`, ký tự `📝` |
| Dòng tên chương | 12px, màu `#9aa`, truncate 1 dòng, `title` = tên đầy đủ |
| Chip chế độ | `Chương` / `Trang`; menu 2 lựa chọn: **Theo chương** (disable khi không outline), **Theo số trang** |
| Footer | `Sẵn sàng` / `Đang lưu...` / `Đã lưu` / `Không lưu được — ghi chú chỉ tồn tại trong phiên này` + các cảnh báo E-04/E-08/E-09 |
| Banner đa tab | Dòng cảnh báo nền vàng nhạt đầu panel (FR-11.1) |
| Trạng thái chờ outline | Spinner + `Đang phân tích mục lục…` tại vùng editor của đơn vị chưa tạo (≤ 3s) |

### 5.3. Hành vi UI
- Tab **Soạn**: chỉ hiện textarea. Tab **Xem trước**: chỉ hiện div preview.
- Nút `–`: ẩn panel + hiện nút nổi; nút nổi: hiện lại panel.
- Nút **Khoảng trang**: nhập start → nhập end; lỗi → **alert** theo bảng FR-04.2, không áp dụng; huỷ → thoát không đổi.
- Conflict có note khác rỗng → hộp thoại xác nhận liệt kê khoảng trang bị xoá (FR-04.3).

---

## 6. YÊU CẦU DỮ LIỆU

### 6.1. Lược đồ IndexedDB

```
Database: pdf-md-notes-v1
└── ObjectStore: pdfs   (keyPath: null, out-of-line)
    key   : string = pdfUrl chuẩn hoá (FR-05.5)
    value : PdfState
```

### 6.2. Cấu trúc logic `PdfState`

```ts
interface PdfState {
  schemaVersion: 2;
  ranges: Range[];                          // sắp xếp tăng theo start
  notes: Record<string, string>;           // rangeKey → Markdown
  noteTimes?: Record<string, number>;      // thời điểm cập nhật note (phục vụ hợp nhất đa tab)
  deleted?: Record<string, number>;        // tombstone các rangeKey đã xoá
  chunk: number;                            // mặc định 1, hợp lệ [1,100]
  mode: 'chapter' | 'chunk';
  outlineCache?: {
    fingerprint: string;
    numPages: number;
    chapters: { title: string; start: number; end: number }[];
    resolvedAt: number;
  };
  updatedAt: number;
}
interface Range {
  start: number;                            // ≥ 1
  end: number;                              // ≥ start
  source: 'manual' | 'chapter' | 'chunk';
  title?: string;                           // tên chương, plain text ≤ 500 ký tự
  createdAt: number;
  updatedAt: number;
}
// rangeKey = `${start}-${end}`
// State mặc định: { schemaVersion:2, ranges:[], notes:{}, chunk:1,
//                  mode:'chunk' (đổi 'chapter' khi outline phân giải ok), updatedAt:now }
```

### 6.3. Quy tắc toàn vẹn

| Mã | Quy tắc |
|---|---|
| D-01 | `rangeKey` khớp `^[1-9]\d*-[1-9]\d*$` |
| D-02 | Không có 2 range trùng khoá trong một state |
| D-03 | `notes[rangeKey]` tồn tại (mặc định `""`) ngay khi range được tạo |
| D-04 | Xoá/sửa range → xoá/di trú khoá tương ứng trong `notes` |
| D-05 | Bất biến chồng lấn theo lớp (FR-02.7): manual–manual, chapter–chapter, chunk–chunk không overlap; manual được nằm trong chapter; chunk không overlap bất kỳ range nào |
| D-06 | `chunk` hỏng (NaN, < 1, > 100) → reset 1 khi load |
| D-07 | `mode` mặc định `chapter` nếu outline phân giải thành công ≥ 1 chương; ngược lại `chunk` |
| D-08 | Range `manual` không bị xoá/ghi đè tự động bởi việc tạo chapter range |
| D-09 | Chuyển mode không xoá note/range (ngoại trừ chuẩn hoá range chunk **rỗng** theo FR-09.7) |
| D-10 | `source` ∈ {manual, chapter, chunk}; dữ liệu thiếu `source` → gán `manual` |
| D-11 | Mọi khoá trong `notes` phải tồn tại trong `ranges`; khoá mồ côi bị dọn khi load |
| D-12 | `title` plain text ≤ 500 ký tự |
| D-13 | `schemaVersion` lớn hơn mức ứng dụng hỗ trợ → từ chối load, thông báo E-06 |
| D-14 | `start, end` nguyên dương, `end ≥ start`; chặn trên theo `numPages` áp dụng tại thời điểm tạo/sửa (không áp khi load) |

### 6.4. Dung lượng
- Note: khuyến nghị ≤ **100KB/note**; vượt → cảnh báo footer (E-08).
- State mỗi PDF: khuyến nghị ≤ **2MB**; vượt → cảnh báo footer.
- Tổng DB > 500MB → cảnh báo (NFR-P5).

---

## 7. YÊU CẦU GIAO DIỆN HỆ THỐNG

| Mã | Yêu cầu |
|---|---|
| IF-01 | Quan sát điều hướng tab chính qua `chrome.webNavigation` (trước khi commit) |
| IF-02 | Chuyển hướng tab qua `chrome.tabs.update` |
| IF-03 | Settings qua `chrome.storage.sync` (`autoRedirect`) |
| IF-04 | URL viewer tạo qua `chrome.runtime.getURL` |
| IF-05 | Theo dõi viewer qua `PDFViewerApplication.eventBus`: `pagesinit` (tổng số trang sẵn sàng), `documentloaded` (truy cập `pdfDocument`), `pagechanging` (trang hiện tại), sự kiện yêu cầu mật khẩu |
| IF-06 | Truy xuất outline qua `pdfDocument.getOutline()`, `getDestination()`, `getPageIndex()`; định danh file qua `pdfDocument.fingerprints` |
| IF-07 | Render Markdown tương thích GFM + sanitize HTML đạt FR-03.6/03.7/03.8 |
| IF-08 | Lưu trữ qua IndexedDB theo lược đồ 6.1 |
| IF-09 | Viewer chấp nhận tham số `file` là URL khác origin (trong phạm vi host permission) và `file://` khi được cấp quyền |

---

## 8. DANH MỤC LỖI & HÀNH VI

| Mã | Tình huống | Hành vi | Thông báo (tiếng Việt) |
|---|---|---|---|
| E-01 | Tải PDF thất bại (404, `file://` chưa cấp quyền…) | Panel không hiển thị; viewer hiện lỗi | Với file://: `Bật "Allow access to file URLs" cho tiện ích trong chrome://extensions` |
| E-02 | PDF có mật khẩu | Panel chờ; hoạt động sau khi mở khoá | `PDF cần mật khẩu — mở khoá để bắt đầu ghi chú` |
| E-03 | IndexedDB mở/ghi thất bại | DEGRADED + nút thử lại | `Không lưu được — ghi chú chỉ tồn tại trong phiên này` |
| E-04 | Hết hạn mức bộ nhớ | DEGRADED | `Bộ nhớ đầy — xoá bớt ghi chú/PDF cũ` |
| E-05 | Outline lỗi toàn bộ / quá 3s | Chunk Mode | `Không đọc được mục lục — chia theo số trang` |
| E-06 | State hỏng / schema không hỗ trợ | Sao lưu + khởi tạo mới | `Dữ liệu ghi chú bị lỗi — đã tạo bản mới (bản cũ được sao lưu)` |
| E-07 | Tab đóng giữa lúc redirect | Bỏ qua im lặng | — |
| E-08 | Note > 100KB / state > 2MB | Vẫn lưu, cảnh báo | `Ghi chú lớn (>100KB) — có thể chậm khi xem trước` |
| E-09 | Cửa sổ ẩn danh | Vẫn lưu trong phiên | `Phiên ẩn danh — ghi chú sẽ mất khi đóng phiên` |

---

## 9. TIÊU CHÍ NGHIỆM THU

**AC-01 — Redirect**
- [ ] Mở `https://example.com/file.pdf` → chuyển sang `chrome-extension://…/viewer.html?file=https%3A%2F%2Fexample.com%2Ffile.pdf`.
- [ ] Tắt autoRedirect → không redirect. URL không phải PDF → không redirect. URL extension → không redirect.

**AC-02 — Note theo range**
- [ ] Chunk = 1, trang 1 gõ "Hello" → lưu; trang 2 → panel trống; quay lại trang 1 → "Hello" còn.
- [ ] Range 3–5 "ABC": trang 3/4/5 đều "ABC"; trang 6 → note mới 6–6.
- [ ] Đổi 3–5 thành 3–7 → "ABC" còn ở 3–7.

**AC-03 — Markdown & an toàn**
- [ ] `# Tiêu đề` → `<h1>`; `**bold**` → chữ đậm; bảng GFM render đúng.
- [ ] `<script>alert(1)</script>` → không thực thi. Link `javascript:` → bị loại.
- [ ] `![](https://tracker.example/x.png)` → không có request mạng; hiện `[ảnh đã chặn]`.

**AC-04 — Persistence**
- [ ] Đóng tab, mở lại cùng URL → note đầy đủ.
- [ ] Kill trình duyệt sau 500ms ngừng gõ → note còn (đã auto-save).

**AC-05 — UI**
- [ ] `–` ẩn panel, hiện `📝`; bấm `📝` hiện lại; PDF full-width khi ẩn; tiêu đề `Trang a–b` đúng.

**AC-06 — Lỗi lưu trữ**
- [ ] IndexedDB bị chặn/lỗi → vẫn soạn được, footer `Không lưu được…`, có nút thử lại.
- [ ] Ẩn danh (extension được bật) → soạn + lưu trong phiên, footer cảnh báo E-09.

**AC-07 — Chia theo chương**
- [ ] PDF có outline 10 chương: trang đầu chương 1 → panel hiện tên chương 1; mọi trang trong chương 1 giữ nguyên note; sang trang đầu chương 2 → note trống + tên chương 2; không có khoảng trống giữa các chapter range.

**AC-08 — Fallback**
- [ ] PDF không outline → chế độ `Trang`, hành vi chia theo chunk.
- [ ] Outline toàn dest lỗi → chế độ `Trang` + thông báo E-05, không crash.

**AC-09 — Chuyển chế độ**
- [ ] Đổi Chương ↔ Trang: mọi note/range còn nguyên, các range đã có tiếp tục phục vụ trang của nó; chỉ trang chưa có range được tạo theo chế độ mới.
- [ ] Đóng tab mở lại → chế độ đã chọn được giữ.

**AC-10 — Dest lỗi cục bộ**
- [ ] Một named destination không tồn tại → item đó bị bỏ qua (có log); các chương khác dùng bình thường.

**AC-11 — file://**
- [ ] Chưa cấp file access → lỗi + hướng dẫn; cấp quyền + reload → hoạt động.

**AC-12 — PDF mật khẩu**
- [ ] Panel chờ, không crash; mở khoá đúng → panel hoạt động.

**AC-13 — Sửa range overlap**
- [ ] Range 3–5 "ABC", 6–8 "XYZ"; sửa 3–5 → 3–7: hiện xác nhận liệt kê "XYZ"; xác nhận → 3–7 = "ABC", 6–8 xoá; huỷ → giữ nguyên 100%.

**AC-14 — Dữ liệu cấu trúc cũ**
- [ ] State không có `schemaVersion` → note còn nguyên, range cũ thành `manual`, có bản sao lưu.

**AC-15 — Dest dạng số nguyên**
- [ ] Outline item có `dest[0]` là số nguyên → vẫn ra chương đúng trang.

**AC-16 — Front-matter**
- [ ] Chương 1 bắt đầu trang 7: trang 2 → range chunk 2–2, tiêu đề chỉ `Trang 2–2`; trang 7 → chương 1.

**AC-17 — Chờ outline**
- [ ] Chuyển đến trang chưa có range khi outline đang phân giải → không tạo range chunk; phân giải xong → tạo đúng chapter range (≤ 3s).

**AC-18 — Không ẩn note khi bật Chapter Mode**
- [ ] Note chunk tại 4–4 nằm trong chương [1,10]; bật Chapter Mode → 4–4 thành `manual`, note vẫn hiện ở trang 4; trang 5 hiện note chương.

**AC-19 — Đa tab**
- [ ] Mở cùng PDF ở 2 tab → cả 2 hiện banner cảnh báo.

**AC-20 — Deep link**
- [ ] Mở `a.pdf#page=5` → viewer mở trang 5, panel bound đúng đơn vị trang 5.

**AC-21 — Chuẩn hoá khoá URL**
- [ ] Mở `a.pdf?token=abc123&page=2#page=1` rồi mở `a.pdf?token=xyz789&page=2` → cùng một bộ ghi chú (token phiên bị bỏ qua).
- [ ] Mở `a.pdf?page=2` và `a.pdf?page=3` → hai bộ ghi chú khác nhau.

**AC-22 — Alert validate range**
- [ ] PDF 50 trang, sửa range end = 60 → alert `PDF chỉ có 50 trang. Khoảng trang không được vượt quá trang cuối.`, range giữ nguyên.
- [ ] Nhập `end < start` / không phải số nguyên → alert đúng thông báo, không áp dụng.

---

## 10. MA TRẬN TRUY VẾT

| Nhu cầu người dùng | FR | AC |
|---|---|---|
| Ghi chú theo trang PDF | FR-02, FR-03, FR-05 | AC-02, AC-04 |
| Trang a–b dùng chung 1 note | FR-02.3, FR-02.7, FR-04 | AC-02, AC-13 |
| Sang b+1 tạo note mới | FR-02.4, FR-02.7 | AC-02 |
| Chia note theo chương | FR-08, FR-09, FR-10 | AC-07, AC-15, AC-16, AC-17 |
| Không outline thì chia theo trang | FR-08.2, FR-09.2–09.3 | AC-08 |
| Đổi chế độ không mất note | FR-09.6–09.7 | AC-09, AC-18 |
| Markdown an toàn | FR-03.2, 03.6–03.8 | AC-03 |
| Mở mọi PDF (đuôi lạ, file://, trang cụ thể) | FR-01.6–01.8 | AC-11, AC-20 |
| Note không mất vì URL đổi token | FR-05.5 | AC-21 |
| Nhập range sai được cảnh báo | FR-04.2 | AC-22 |
| Không che PDF, ẩn/hiện nhanh | FR-02.1, FR-06 | AC-05 |
| An toàn khi nhiều tab | FR-11 | AC-19 |

---

## 11. LỘ TRÌNH PHIÊN BẢN

| Version | Phạm vi |
|---|---|
| **v1.1 (hiện tại)** | Toàn bộ yêu cầu **Must + Should** trong tài liệu này |
| **v1.2** | Export/Import `.md` · dropdown danh sách chương · cấu hình độ sâu outline · phím tắt mở rộng · theme sáng · trình duyệt note · tuỳ chọn ảnh remote · chunk mặc định toàn cục |
| **v2.0** | Đồng bộ đa thiết bị (backend tuỳ chọn) · Firefox · tự sinh outline heuristic |

---

## PHỤ LỤC A — Bảng tham số

| Tham số | Giá trị |
|---|---|
| Debounce auto-save | 400ms ± 50ms |
| Debounce preview | 150ms |
| Panel width | 380px mặc định, chỉnh được 280–720px (kéo cạnh trái hoặc Settings, lưu bằng `chrome.storage.sync`) |
| Chunk mặc định / khoảng hợp lệ | 1 / [1, 100] |
| Timeout khởi tạo PDF.js | 15s |
| Timeout phân giải outline | 3s |
| Giới hạn item outline xử lý / ngưỡng cảnh báo | 500 / 1.000 |
| Độ dài tên chương lưu tối đa | 500 ký tự |
| Note khuyến nghị / cảnh báo | 100KB |
| State mỗi PDF khuyến nghị | 2MB |
| Ngưỡng cảnh báo tổng DB | 500MB |
| Kích thước PDF hỗ trợ | ≤ 200MB |
| Ghi IDB p95 | ≤ 50ms |

## PHỤ LỤC B — Tham số query bị loại khi chuẩn hoá khoá URL (FR-05.5)

So khớp **tên tham số**, không phân biệt hoa/thường:

| Nhóm | Tên tham số |
|---|---|
| Phiên / xác thực | `token`, `access_token`, `id_token`, `auth`, `authorization`, `session`, `session_id`, `sessionid`, `sid`, `phpsessid`, `jsessionid` |
| Chữ ký / thời hạn URL | `signature`, `sig`, `expires`, `expiry`, `policy`, `key-pair-id`; mọi tên bắt đầu `x-amz-` |
| Tracking | mọi tên bắt đầu `utm_`; `fbclid`, `gclid`, `msclkid`, `mc_cid`, `mc_eid` |

**Ví dụ chuẩn hoá:**

| URL gốc | Khoá `pdfUrl` |
|---|---|
| `https://x.com/a.pdf?token=abc&page=2#page=5` | `https://x.com/a.pdf?page=2` |
| `https://cdn.x.com/f.pdf?X-Amz-Signature=…&id=7` | `https://cdn.x.com/f.pdf?id=7` |
| `https://x.com/a.pdf?v=2&utm_source=tw` | `https://x.com/a.pdf?v=2` |
| `https://x.com/a.pdf?b=2&a=1` | `https://x.com/a.pdf?a=1&b=2` |

*Giới hạn đã biết (ghi trong README): tham số token đặt tên ngoài danh sách trên sẽ không bị loại → URL đổi giá trị tham số đó tạo bộ ghi chú mới.*

---

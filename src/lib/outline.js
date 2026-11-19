/**
 * Phát hiện & phân giải outline PDF (FR-08).
 *
 * - dest là chuỗi (named destination) → getDestination() rồi phân giải tiếp.
 * - dest là mảng tường minh: phần tử đầu là ref trang → getPageIndex(ref) + 1;
 *   là số nguyên → giá trị + 1.
 * - Item lỗi bị bỏ qua, không ảnh hưởng item khác.
 * - Toàn bộ quá trình bị giới hạn 3 giây; quá hạn → trạng thái "timeout".
 */

import { plainTitle } from "./state-ops.js";

export const OUTLINE_STATUS = {
  OK: "ok",
  NONE: "none",
  FAILED: "failed",
  TIMEOUT: "timeout",
};

/**
 * @param {any} pdfDocument
 * @param {{timeoutMs?:number, maxItems?:number, warnItems?:number, depth?:number, numPages?:number}} [options]
 * @returns {Promise<{status:string, chapters:Array<{title:string,start:number,end:number}>, warnings:string[], resolvedAt:number}>}
 */
export async function resolveOutline(pdfDocument, options = {}) {
  const timeoutMs = options.timeoutMs ?? 3000;
  const maxItems = options.maxItems ?? 500;
  const warnItems = options.warnItems ?? 1000;
  const depth = options.depth ?? 0;
  const warnings = [];

  const run = (async () => {
    let outline;
    try {
      outline = await pdfDocument.getOutline();
    } catch (error) {
      console.warn("[pdfmd] Không đọc được outline:", error);
      return { status: OUTLINE_STATUS.FAILED, chapters: [], warnings, resolvedAt: Date.now() };
    }

    if (!outline || outline.length === 0) {
      return { status: OUTLINE_STATUS.NONE, chapters: [], warnings, resolvedAt: Date.now() };
    }

    const totalItems = countItems(outline);
    if (totalItems > warnItems) {
      const message = `Outline có ${totalItems} item (>${warnItems}) — hệ thống vẫn hoạt động nhưng chỉ xử lý ${maxItems} item đầu.`;
      warnings.push(message);
      console.warn("[pdfmd]", message);
    }

    const items = pickLevel(outline, depth).slice(0, maxItems);
    const numPages = options.numPages ?? pdfDocument.numPages ?? 0;
    const resolved = [];

    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      const page = await resolveDest(pdfDocument, item?.dest, numPages);
      if (page == null) {
        console.warn("[pdfmd] Bỏ qua outline item không phân giải được:", item?.title);
        continue;
      }
      resolved.push({ title: plainTitle(item?.title ?? ""), start: page, order: index });
      // Nhường luồng định kỳ để không chặn main thread (NFR-P7).
      if ((index + 1) % 25 === 0) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }

    if (resolved.length === 0) {
      return { status: OUTLINE_STATUS.FAILED, chapters: [], warnings, resolvedAt: Date.now() };
    }

    // FR-08.8: sắp xếp theo trang bắt đầu; trùng trang → giữ chương đầu tiên.
    resolved.sort((a, b) => a.start - b.start || a.order - b.order);
    const unique = [];
    for (const chapter of resolved) {
      if (unique.length > 0 && unique[unique.length - 1].start === chapter.start) continue;
      unique.push(chapter);
    }

    const chapters = unique.map((chapter, index) => {
      const next = unique[index + 1];
      const end = next ? next.start - 1 : Math.max(numPages, chapter.start);
      return { title: chapter.title, start: chapter.start, end: Math.max(chapter.start, end) };
    });

    return { status: OUTLINE_STATUS.OK, chapters, warnings, resolvedAt: Date.now() };
  })();

  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(
      () => resolve({ status: OUTLINE_STATUS.TIMEOUT, chapters: [], warnings, resolvedAt: Date.now() }),
      timeoutMs
    );
  });

  try {
    const result = await Promise.race([run, timeout]);
    if (result.status === OUTLINE_STATUS.TIMEOUT) {
      console.warn(`[pdfmd] Phân giải outline quá ${timeoutMs}ms — dùng chia theo số trang.`);
    }
    return result;
  } finally {
    clearTimeout(timer);
  }
}

/** Đếm tổng số item trong cây outline. */
function countItems(items) {
  let total = 0;
  for (const item of items) {
    total += 1;
    if (Array.isArray(item?.items) && item.items.length > 0) {
      total += countItems(item.items);
    }
  }
  return total;
}

/** Lấy các item ở cấp `depth` (mặc định top-level). */
function pickLevel(items, depth) {
  if (depth <= 0) return items;
  let current = items;
  for (let level = 0; level < depth; level += 1) {
    const next = [];
    for (const item of current) {
      if (Array.isArray(item?.items)) next.push(...item.items);
    }
    if (next.length === 0) return [];
    current = next;
  }
  return current;
}

/**
 * Phân giải dest thành số trang 1-based.
 * @returns {Promise<number|null>}
 */
export async function resolveDest(pdfDocument, dest, numPages) {
  if (dest == null) return null;
  try {
    let target = dest;
    if (typeof target === "string") {
      const explicit = await pdfDocument.getDestination(target);
      if (!explicit) return null;
      target = explicit;
    }
    if (!Array.isArray(target) || target.length === 0) return null;
    const first = target[0];
    let page;
    if (typeof first === "number" && Number.isFinite(first)) {
      page = first + 1; // FR-08.5: chỉ số trang trực tiếp
    } else if (first && typeof first === "object") {
      const index = await pdfDocument.getPageIndex(first);
      if (typeof index !== "number" || index < 0) return null;
      page = index + 1;
    } else {
      return null;
    }
    if (!Number.isFinite(page) || page < 1) return null;
    if (numPages && page > numPages) return null; // FR-08.6
    return page;
  } catch (error) {
    console.warn("[pdfmd] Không phân giải được dest:", error);
    return null;
  }
}

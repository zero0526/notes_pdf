/**
 * Toán học trạng thái ghi chú: tạo/sửa/xoá range, tra cứu đơn vị ghi chú,
 * chuẩn hoá khi đổi chế độ, hợp nhất khi nhiều tab cùng ghi.
 * Toàn bộ hàm ở đây là hàm thuần (pure) để kiểm thử được độc lập.
 */

export const SCHEMA_VERSION = 2;

export const SOURCE = {
  MANUAL: "manual",
  CHAPTER: "chapter",
  CHUNK: "chunk",
};

export const MODE = {
  CHAPTER: "chapter",
  CHUNK: "chunk",
};

/** @param {number} start @param {number} end */
export function rangeKey(start, end) {
  return `${start}-${end}`;
}

/** @param {string} key */
export function parseRangeKey(key) {
  const match = /^([1-9]\d*)-([1-9]\d*)$/.exec(key ?? "");
  return match ? { start: Number(match[1]), end: Number(match[2]) } : null;
}

/** @param {{start:number,end:number}} a @param {{start:number,end:number}} b */
export function overlaps(a, b) {
  return a.start <= b.end && b.start <= a.end;
}

/** @param {{start:number,end:number}} range @param {number} page */
export function contains(range, page) {
  return page >= range.start && page <= range.end;
}

/** Bỏ khoảng trắng, cắt về 500 ký tự, loại thẻ HTML (FR-08.11, D-12, NFR-S5). */
export function plainTitle(value, maxLen = 500) {
  if (value == null) return "";
  const text = String(value).replace(/<[^>]*>/g, "");
  return text.length > maxLen ? text.slice(0, maxLen) : text;
}

/**
 * State mặc định (SRS 6.2).
 * @param {number} now
 */
export function createDefaultState(now = Date.now()) {
  return {
    schemaVersion: SCHEMA_VERSION,
    ranges: [],
    notes: {},
    noteTimes: {},
    deleted: {},
    chunk: 1,
    mode: MODE.CHUNK,
    modeExplicit: false, // người dùng đã chọn chế độ hay chưa (FR-09.2)
    updatedAt: now,
  };
}

/**
 * Làm sạch / chuyển đổi state đọc từ IndexedDB (FR-05.6, FR-05.7, mục 6.3).
 * @param {any} raw
 * @param {{now?: number}} [options]
 * @returns {{state: object, recovered: boolean, reason: string|null}}
 */
export function normalizeState(raw, options = {}) {
  const now = options.now ?? Date.now();
  if (!raw || typeof raw !== "object") {
    return { state: createDefaultState(now), recovered: false, reason: null };
  }

  const version = raw.schemaVersion;
  if (typeof version === "number" && version > SCHEMA_VERSION) {
    return { state: createDefaultState(now), recovered: true, reason: "unsupported-schema" };
  }

  const legacy = typeof version !== "number";
  const ranges = Array.isArray(raw.ranges) ? raw.ranges : [];
  const notes = raw.notes && typeof raw.notes === "object" ? raw.notes : {};
  const noteTimes = raw.noteTimes && typeof raw.noteTimes === "object" ? raw.noteTimes : {};
  const deleted = raw.deleted && typeof raw.deleted === "object" ? raw.deleted : {};

  /** @type {Map<string, any>} */
  const byKey = new Map();
  for (const item of ranges) {
    if (!item || typeof item !== "object") continue;
    const start = toInt(item.start);
    const end = toInt(item.end);
    if (start == null || end == null || start < 1 || end < start) continue;
    const source = [SOURCE.MANUAL, SOURCE.CHAPTER, SOURCE.CHUNK].includes(item.source)
      ? item.source
      : SOURCE.MANUAL; // D-10
    const key = rangeKey(start, end);
    const range = {
      start,
      end,
      source,
      title: item.title ? plainTitle(item.title) : undefined,
      createdAt: toInt(item.createdAt) ?? now,
      updatedAt: toInt(item.updatedAt) ?? now,
    };
    const previous = byKey.get(key);
    if (!previous || (range.updatedAt ?? 0) >= (previous.updatedAt ?? 0)) {
      byKey.set(key, range); // D-02
    }
  }

  const cleanRanges = [...byKey.values()].sort((a, b) => a.start - b.start || a.end - b.end);

  const cleanNotes = {};
  const cleanNoteTimes = {};
  for (const range of cleanRanges) {
    const key = rangeKey(range.start, range.end);
    const note = typeof notes[key] === "string" ? notes[key] : "";
    cleanNotes[key] = note; // D-03
    cleanNoteTimes[key] = toInt(noteTimes[key]) ?? range.updatedAt ?? now;
  }
  // D-11: khoá mồ côi bị dọn
  const cleanDeleted = {};
  for (const [key, time] of Object.entries(deleted)) {
    if (parseRangeKey(key)) cleanDeleted[key] = toInt(time) ?? now;
  }

  const chunkRaw = toInt(raw.chunk);
  const chunk = chunkRaw != null && chunkRaw >= 1 && chunkRaw <= 100 ? chunkRaw : 1; // D-06

  const mode = raw.mode === MODE.CHAPTER ? MODE.CHAPTER : MODE.CHUNK;
  const modeExplicit = raw.modeExplicit === true;

  return {
    state: {
      schemaVersion: SCHEMA_VERSION,
      ranges: cleanRanges,
      notes: cleanNotes,
      noteTimes: cleanNoteTimes,
      deleted: cleanDeleted,
      chunk,
      mode,
      modeExplicit,
      outlineCache: sanitizeOutlineCache(raw.outlineCache),
      updatedAt: toInt(raw.updatedAt) ?? now,
    },
    recovered: false,
    reason: legacy ? "legacy" : null,
  };
}

function sanitizeOutlineCache(cache) {
  if (!cache || typeof cache !== "object") return undefined;
  const fingerprint = typeof cache.fingerprint === "string" ? cache.fingerprint : "";
  const numPages = toInt(cache.numPages);
  const chapters = Array.isArray(cache.chapters)
    ? cache.chapters
        .map((chapter) => {
          const start = toInt(chapter?.start);
          const end = toInt(chapter?.end);
          if (start == null || end == null || start < 1 || end < start) return null;
          return { title: plainTitle(chapter?.title ?? ""), start, end };
        })
        .filter(Boolean)
    : [];
  if (!fingerprint || numPages == null) return undefined;
  return {
    fingerprint,
    numPages,
    chapters,
    resolvedAt: toInt(cache.resolvedAt) ?? Date.now(),
  };
}

function toInt(value) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) return Number(value.trim());
  return null;
}

/** Sắp xếp range theo `start` tăng dần (FR-02.6). */
export function sortRanges(ranges) {
  return [...ranges].sort((a, b) => a.start - b.start || a.end - b.end);
}

/**
 * Tra cứu đơn vị ghi chú đang phục vụ trang `page` theo thứ tự ưu tiên
 * manual → chapter → chunk (FR-02.7 bước 1-3).
 * @param {object} state
 * @param {number} page
 * @returns {object|null}
 */
export function findExistingUnit(state, page) {
  const candidates = state.ranges.filter((range) => contains(range, page));
  if (candidates.length === 0) return null;
  const priority = { [SOURCE.MANUAL]: 0, [SOURCE.CHAPTER]: 1, [SOURCE.CHUNK]: 2 };
  candidates.sort((a, b) => {
    const bySource = priority[a.source] - priority[b.source];
    if (bySource !== 0) return bySource;
    const spanA = a.end - a.start;
    const spanB = b.end - b.start;
    if (spanA !== spanB) return spanA - spanB;
    return b.start - a.start;
  });
  return candidates[0];
}

/**
 * Tạo range chunk cho trang `page` (FR-02.7 bước 4c, FR-02.8).
 * @param {object} state
 * @param {number} page
 * @param {{numPages:number, chunk:number}} ctx
 */
export function createChunkRange(state, page, ctx) {
  const chunk = Math.min(Math.max(ctx.chunk || 1, 1), 100);
  const numPages = ctx.numPages;
  const nextStarts = state.ranges
    .filter((range) => range.start > page)
    .map((range) => range.start)
    .sort((a, b) => a - b);
  const nextStart = nextStarts.length > 0 ? nextStarts[0] : null;
  let end = page + chunk - 1;
  if (numPages != null) end = Math.min(end, numPages);
  if (nextStart != null) end = Math.min(end, nextStart - 1);
  if (end < page) end = page;
  return {
    start: page,
    end,
    source: SOURCE.CHUNK,
    title: undefined,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

/**
 * Tạo range chapter từ danh sách chương đã phân giải (FR-09.1).
 * @param {number} page
 * @param {Array<{title:string,start:number,end:number}>} chapters
 */
export function createChapterRange(page, chapters) {
  const chapter = chapters.find((item) => page >= item.start && page <= item.end);
  if (!chapter) return null;
  return {
    start: chapter.start,
    end: chapter.end,
    source: SOURCE.CHAPTER,
    title: chapter.title || undefined,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

/**
 * Chuẩn hoá state khi bật Chapter Mode (FR-09.7):
 * range chunk có nội dung overlap chương → thành manual; range chunk rỗng → xoá.
 * @param {object} state
 * @param {Array<{start:number,end:number}>} chapters
 * @param {number} now
 */
export function normalizeForChapterMode(state, chapters, now = Date.now()) {
  const next = cloneState(state);
  const kept = [];
  for (const range of next.ranges) {
    if (range.source !== SOURCE.CHUNK) {
      kept.push(range);
      continue;
    }
    const overlapsChapter = chapters.some((chapter) => overlaps(range, chapter));
    if (!overlapsChapter) {
      kept.push(range);
      continue;
    }
    const key = rangeKey(range.start, range.end);
    const note = next.notes[key] ?? "";
    if (note.trim() !== "") {
      kept.push({ ...range, source: SOURCE.MANUAL, updatedAt: now });
    } else {
      delete next.notes[key];
      delete next.noteTimes[key];
      next.deleted[key] = Math.max(next.deleted[key] ?? 0, now);
    }
  }
  next.ranges = sortRanges(kept);
  return next;
}

/** @param {object} state */
export function cloneState(state) {
  return {
    ...state,
    ranges: state.ranges.map((range) => ({ ...range })),
    notes: { ...state.notes },
    noteTimes: { ...state.noteTimes },
    deleted: { ...state.deleted },
  };
}

/**
 * Sửa khoảng trang của đơn vị hiện tại (FR-04).
 * Trả về cấu hình thay đổi (chưa áp dụng) để UI hỏi xác nhận trước.
 * @param {object} state
 * @param {{start:number,end:number,key:string}} edit
 * @returns {{conflicts: object[], nextState: object|null}}
 */
export function planRangeEdit(state, edit) {
  const next = cloneState(state);
  const current = next.ranges.find(
    (range) => rangeKey(range.start, range.end) === edit.key
  );
  if (!current) return { conflicts: [], nextState: null };

  const target = { start: edit.start, end: edit.end };
  const conflicts = next.ranges.filter(
    (range) =>
      rangeKey(range.start, range.end) !== edit.key &&
      range.source !== SOURCE.CHAPTER && // FR-04.3: range chapter không bị xoá
      overlaps(range, target)
  );
  const conflictsWithNotes = conflicts.filter(
    (range) => (next.notes[rangeKey(range.start, range.end)] ?? "").trim() !== ""
  );

  for (const range of conflicts) {
    const key = rangeKey(range.start, range.end);
    delete next.notes[key];
    delete next.noteTimes[key];
    next.deleted[key] = Date.now();
    next.ranges = next.ranges.filter((item) => rangeKey(item.start, item.end) !== key);
  }

  const oldKey = rangeKey(current.start, current.end);
  const newKey = rangeKey(target.start, target.end);
  const note = next.notes[oldKey] ?? "";
  const noteTime = next.noteTimes[oldKey] ?? Date.now();

  next.ranges = next.ranges.filter((range) => rangeKey(range.start, range.end) !== oldKey);
  delete next.notes[oldKey];
  delete next.noteTimes[oldKey];
  next.deleted[oldKey] = Date.now();

  const updated = {
    ...current,
    start: target.start,
    end: target.end,
    source: SOURCE.MANUAL, // FR-04.5
    updatedAt: Date.now(),
  };
  next.ranges.push(updated);
  next.ranges = sortRanges(next.ranges);
  next.notes[newKey] = note; // FR-04.4
  next.noteTimes[newKey] = noteTime;
  next.updatedAt = Date.now();

  return { conflicts: conflictsWithNotes, nextState: next };
}

/**
 * Hợp nhất state khi nhiều tab cùng ghi (FR-11.3).
 * Bản có thời điểm cập nhật mới hơn thắng; xoá được tôn trọng (tombstone).
 * @param {object} local
 * @param {object} remote
 */
export function mergeStates(local, remote) {
  if (!remote) return local;
  const merged = cloneState(local);
  const now = Date.now();

  // Range: hợp nhất theo khoá, ưu tiên bản cập nhật mới hơn.
  const rangeMap = new Map();
  for (const range of [...merged.ranges, ...(remote.ranges ?? [])]) {
    const key = rangeKey(range.start, range.end);
    const previous = rangeMap.get(key);
    if (!previous || (range.updatedAt ?? 0) >= (previous.updatedAt ?? 0)) {
      rangeMap.set(key, { ...range });
    }
  }
  merged.ranges = sortRanges([...rangeMap.values()]);

  const remoteNotes = remote.notes ?? {};
  const remoteTimes = remote.noteTimes ?? {};
  const remoteDeleted = remote.deleted ?? {};

  for (const key of new Set([
    ...Object.keys(merged.notes),
    ...Object.keys(remoteNotes),
  ])) {
    const localTime = merged.noteTimes[key] ?? 0;
    const remoteTime = remoteTimes[key] ?? 0;
    const deletedAt = Math.max(merged.deleted[key] ?? 0, remoteDeleted[key] ?? 0);
    if (deletedAt > Math.max(localTime, remoteTime)) {
      delete merged.notes[key];
      delete merged.noteTimes[key];
      merged.deleted[key] = deletedAt;
      continue;
    }
    if (remoteTime > localTime && remoteNotes[key] !== undefined) {
      merged.notes[key] = remoteNotes[key];
      merged.noteTimes[key] = remoteTime;
    }
  }

  for (const [key, time] of Object.entries(remoteDeleted ?? {})) {
    merged.deleted[key] = Math.max(merged.deleted[key] ?? 0, time ?? 0);
  }

  merged.chunk = remote.chunk ?? merged.chunk;
  if (remote.mode && remote.mode !== merged.mode) {
    // Chế độ đã được người dùng chọn ở tab khác → giữ theo bản mới hơn.
    if (remote.modeExplicit) {
      merged.mode = remote.mode;
      merged.modeExplicit = true;
    }
  }
  merged.updatedAt = Math.max(merged.updatedAt ?? 0, remote.updatedAt ?? 0, now);
  return merged;
}

/** Tổng số byte xấp xỉ của state (cảnh báo E-08). */
export function estimateStateBytes(state) {
  try {
    return new TextEncoder().encode(JSON.stringify(state)).length;
  } catch {
    return 0;
  }
}

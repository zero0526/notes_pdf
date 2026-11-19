/**
 * Tầng lưu trữ IndexedDB (SRS 6.1, FR-05).
 *
 * DB: pdf-md-notes-v1
 *   pdfs     (out-of-line) : key = pdfUrl chuẩn hoá, value = PdfState
 *   settings (out-of-line) : cấu hình cục bộ (fsDir, fsPrefs, ...)
 *   files    (out-of-line) : key = pdfUrl, value = registry file .md
 */

export const DB_NAME = "pdf-md-notes-v1";
export const DB_VERSION = 1;
export const STORE_PDFS = "pdfs";
export const STORE_SETTINGS = "settings";
export const STORE_FILES = "files";
export const BACKUP_SUFFIX = "#backup";

let dbPromise = null;

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

/**
 * Mở (hoặc mở lại) cơ sở dữ liệu.
 * @returns {Promise<IDBDatabase>}
 */
export function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB không khả dụng"));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_PDFS)) {
        db.createObjectStore(STORE_PDFS);
      }
      if (!db.objectStoreNames.contains(STORE_SETTINGS)) {
        db.createObjectStore(STORE_SETTINGS);
      }
      if (!db.objectStoreNames.contains(STORE_FILES)) {
        db.createObjectStore(STORE_FILES);
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onclose = () => {
        dbPromise = null;
      };
      resolve(db);
    };
    request.onerror = () => {
      dbPromise = null;
      reject(request.error ?? new Error("Không mở được IndexedDB"));
    };
    request.onblocked = () => {
      dbPromise = null;
      reject(new Error("IndexedDB bị khoá bởi tab khác"));
    };
  });
  return dbPromise;
}

/** Đóng cache DB (dùng khi cần thử lại sau lỗi). */
export function resetDbCache() {
  dbPromise = null;
}

/**
 * @param {string} storeName
 * @param {IDBTransactionMode} mode
 * @param {(store: IDBObjectStore) => any} fn
 */
async function withStore(storeName, mode, fn) {
  const db = await openDb();
  const tx = db.transaction(storeName, mode);
  const store = tx.objectStore(storeName);
  const result = await fn(store);
  if (mode === "readwrite") await txDone(tx);
  return result;
}

/** @param {string} key */
export async function getState(key) {
  const value = await withStore(STORE_PDFS, "readonly", (store) =>
    requestToPromise(store.get(key))
  );
  return value ?? null;
}

/**
 * Ghi toàn bộ state của một pdfUrl trong một giao dịch (FR-05.8).
 * Các ghi diễn ra theo hàng đợi tuần tự cho từng khoá (FR-03.11).
 * @param {string} key
 * @param {object} state
 */
const writeQueues = new Map();

export function putState(key, state) {
  const previous = writeQueues.get(key) ?? Promise.resolve();
  const next = previous
    .catch(() => {})
    .then(async () => {
      await withStore(STORE_PDFS, "readwrite", (store) => {
        store.put(state, key);
      });
      return state;
    });
  writeQueues.set(
    key,
    next.catch(() => {})
  );
  return next;
}

/** @param {string} key */
export async function deleteState(key) {
  return withStore(STORE_PDFS, "readwrite", (store) => {
    store.delete(key);
  });
}

/** Sao lưu state sang khoá dự phòng (FR-05.6, FR-05.7). */
export async function backupState(key, state) {
  return putState(`${key}${BACKUP_SUFFIX}`, state);
}

/** @param {string} key */
export async function getSetting(key) {
  const value = await withStore(STORE_SETTINGS, "readonly", (store) =>
    requestToPromise(store.get(key))
  );
  return value ?? null;
}

/**
 * @param {string} key
 * @param {any} value
 */
export async function setSetting(key, value) {
  return withStore(STORE_SETTINGS, "readwrite", (store) => {
    store.put(value, key);
  });
}

/** @param {string} pdfUrl */
export async function getFileRecord(pdfUrl) {
  const value = await withStore(STORE_FILES, "readonly", (store) =>
    requestToPromise(store.get(pdfUrl))
  );
  return value ?? null;
}

/**
 * @param {string} pdfUrl
 * @param {object} record
 */
export async function setFileRecord(pdfUrl, record) {
  return withStore(STORE_FILES, "readwrite", (store) => {
    store.put(record, pdfUrl);
  });
}

/** Danh sách registry file .md. */
export async function listFileRecords() {
  const values = await withStore(STORE_FILES, "readonly", (store) =>
    requestToPromise(store.getAll())
  );
  return values ?? [];
}

/** Danh sách toàn bộ state đã lưu (dùng cho "Xuất tất cả .md"). */
export async function listStates() {
  const db = await openDb();
  const tx = db.transaction(STORE_PDFS, "readonly");
  const store = tx.objectStore(STORE_PDFS);
  const keys = await requestToPromise(store.getAllKeys());
  const values = await requestToPromise(store.getAll());
  const result = [];
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (typeof key === "string" && key.endsWith(BACKUP_SUFFIX)) continue;
    result.push({ key, state: values[index] });
  }
  return result;
}

/** Ước lượng dung lượng DB (NFR-P5). */
export async function estimateDbBytes() {
  if (navigator.storage?.estimate) {
    try {
      const { usage } = await navigator.storage.estimate();
      return usage ?? 0;
    } catch {
      return 0;
    }
  }
  return 0;
}

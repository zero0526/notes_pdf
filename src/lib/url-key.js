/**
 * Chuẩn hoá khoá URL PDF (FR-05.5 + Phụ lục B).
 * - Bỏ toàn bộ hash.
 * - Loại tham số query mang tính phiên / xác thực / tracking.
 * - Sắp xếp tham số còn lại theo tên rồi giá trị.
 * - Giữ nguyên scheme, host, pathname.
 */

/** Nhóm 1: phiên / xác thực (so khớp tên, không phân biệt hoa thường). */
export const SESSION_AUTH_PARAMS = new Set([
  "token",
  "access_token",
  "id_token",
  "auth",
  "authorization",
  "session",
  "session_id",
  "sessionid",
  "sid",
  "phpsessid",
  "jsessionid",
]);

/** Nhóm 2: chữ ký / thời hạn URL. */
export const SIGNATURE_PARAMS = new Set([
  "signature",
  "sig",
  "expires",
  "expiry",
  "policy",
  "key-pair-id",
]);

/** Nhóm 3: tracking. */
export const TRACKING_PARAMS = new Set(["fbclid", "gclid", "msclkid", "mc_cid", "mc_eid"]);

/** Tiền tố được loại bỏ. */
export const DROPPED_PREFIXES = ["x-amz-", "utm_"];

/**
 * @param {string} name tên tham số (đã lowercase)
 * @returns {boolean} true nếu tham số này không định danh nội dung PDF
 */
export function isSessionParam(name) {
  const lower = name.toLowerCase();
  if (SESSION_AUTH_PARAMS.has(lower)) return true;
  if (SIGNATURE_PARAMS.has(lower)) return true;
  if (TRACKING_PARAMS.has(lower)) return true;
  return DROPPED_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

/**
 * Chuẩn hoá URL PDF thành khoá lưu trữ.
 * @param {string} rawUrl
 * @returns {string} khoá chuẩn hoá, hoặc chuỗi rỗng nếu URL không hợp lệ
 */
export function normalizePdfUrl(rawUrl) {
  if (!rawUrl) return "";
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return "";
  }
  url.hash = "";
  const pairs = [];
  for (const [name, value] of url.searchParams.entries()) {
    if (isSessionParam(name)) continue;
    pairs.push([name, value]);
  }
  pairs.sort((a, b) => (a[0] === b[0] ? compare(a[1], b[1]) : compare(a[0], b[0])));
  const query = pairs.map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`).join("&");
  return `${url.protocol}//${url.host}${url.pathname}${query ? `?${query}` : ""}`;
}

function compare(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * URL có trông như tệp PDF không (FR-01.1): pathname kết thúc bằng `.pdf`.
 * @param {string} rawUrl
 */
export function looksLikePdfUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return /\.pdf$/i.test(url.pathname);
  } catch {
    return false;
  }
}

/** Lấy số trang trong fragment `#page=N` (FR-01.7). */
export function pageFromHash(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const match = /[#&]page=(\d+)/.exec(url.hash);
    return match ? Number(match[1]) : null;
  } catch {
    return null;
  }
}

/**
 * Render Markdown (GFM) + sanitize HTML an toàn (FR-03.2, FR-03.6, FR-03.7, FR-03.8).
 *
 * Quy tắc bắt buộc:
 *  - Không thẻ script / iframe / object / embed / form, không handler on*.
 *  - Chỉ chấp nhận scheme http, https, mailto cho link; link mở tab mới với
 *    rel="noopener noreferrer".
 *  - Ảnh remote bị chặn hoàn toàn, thay bằng chip "[ảnh đã chặn]".
 *  - Task list hiển thị ký tự tĩnh ☐ / ☑.
 */

const ALLOWED_TAGS = [
  "p",
  "br",
  "strong",
  "b",
  "em",
  "i",
  "del",
  "s",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "pre",
  "code",
  "blockquote",
  "a",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "th",
  "td",
  "hr",
  "span",
  "div",
  "input",
  "img",
];

const ALLOWED_ATTR = ["href", "title", "type", "checked", "disabled", "align", "src", "alt"];

const SAFE_SCHEMES = new Set(["http:", "https:", "mailto:"]);

function getMarked() {
  return globalThis.marked ?? null;
}

function getPurify() {
  return globalThis.DOMPurify ?? null;
}

/**
 * @param {string} markdown
 * @returns {string} HTML đã sanitize
 */
export function renderMarkdown(markdown) {
  const source = String(markdown ?? "");
  if (!source.trim()) return "";

  let html;
  const marked = getMarked();
  if (marked) {
    html = marked.parse(source, { gfm: true, breaks: false, async: false });
  } else {
    html = fallbackRender(source);
  }

  const purify = getPurify();
  if (purify) {
    html = purify.sanitize(html, {
      ALLOWED_TAGS,
      ALLOWED_ATTR,
      FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form", "link", "meta", "base", "svg", "math"],
      FORBID_ATTR: ["style", "srcset", "formaction", "target"],
      ALLOW_DATA_ATTR: false,
      ALLOW_UNKNOWN_PROTOCOLS: false,
    });
  } else {
    html = escapeHtml(html);
  }

  return postProcess(html);
}

/** Bước hậu xử lý DOM: chặn ảnh, link an toàn, task list tĩnh. */
function postProcess(html) {
  if (typeof DOMParser === "undefined") return html;
  const doc = new DOMParser().parseFromString(`<div id="root">${html}</div>`, "text/html");
  const root = doc.getElementById("root");
  if (!root) return html;

  // Ảnh: chặn hoàn toàn, không tải tài nguyên remote (FR-03.8).
  for (const img of [...root.querySelectorAll("img")]) {
    const chip = doc.createElement("span");
    chip.className = "pdfmd-blocked-image";
    chip.textContent = "[ảnh đã chặn]";
    img.replaceWith(chip);
  }

  // Task list: ký tự tĩnh, không tương tác (FR-03.2).
  for (const input of [...root.querySelectorAll('input[type="checkbox"]')]) {
    const chip = doc.createElement("span");
    chip.className = "pdfmd-task";
    chip.textContent = input.checked ? "☑" : "☐";
    input.replaceWith(chip);
  }

  // Link: chỉ http/https/mailto, mở tab mới, không rò quyền (FR-03.7).
  for (const anchor of [...root.querySelectorAll("a")]) {
    const href = anchor.getAttribute("href") ?? "";
    let safe = false;
    try {
      const url = new URL(href, doc.baseURI || "https://localhost/");
      safe = SAFE_SCHEMES.has(url.protocol);
    } catch {
      safe = false;
    }
    if (!safe) {
      anchor.removeAttribute("href");
      anchor.classList.add("pdfmd-link-blocked");
    } else {
      anchor.setAttribute("target", "_blank");
      anchor.setAttribute("rel", "noopener noreferrer");
    }
  }

  // Chặn mọi handler còn sót và mọi tải tài nguyên ngoài.
  for (const element of [...root.querySelectorAll("*")]) {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith("on") || name === "style" || name === "src" || name === "srcset") {
        element.removeAttribute(attribute.name);
      }
    }
  }

  return root.innerHTML;
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Renderer tối giản khi thư viện không tải được (không dùng eval). */
function fallbackRender(source) {
  const escaped = escapeHtml(source);
  return escaped
    .split(/\n{2,}/)
    .map((block) => `<p>${block.replace(/\n/g, "<br>")}</p>`)
    .join("");
}

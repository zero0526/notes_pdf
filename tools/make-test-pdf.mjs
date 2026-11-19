#!/usr/bin/env node
/**
 * Sinh PDF thử nghiệm có outline (mục lục) để kiểm thử chế độ "Theo chương".
 *
 * Dùng: node tools/make-test-pdf.mjs <đường dẫn output> [số chương] [số trang mỗi chương]
 */

import fs from "node:fs";

/** Chuỗi PDF dạng hex UTF-16BE (có BOM) để hỗ trợ tiếng Việt. */
function pdfText(value) {
  const bytes = Buffer.from(`\uFEFF${value}`, "utf16le").swap16();
  return `<${bytes.toString("hex").toUpperCase()}>`;
}

/**
 * @param {{chapters:number, pagesPerChapter:number, titlePrefix?:string}} options
 * @returns {Buffer}
 */
export function buildOutlinePdf(options = {}) {
  const chapters = options.chapters ?? 2;
  const pagesPerChapter = options.pagesPerChapter ?? 3;
  const titlePrefix = options.titlePrefix ?? "Chương";
  const totalPages = chapters * pagesPerChapter;

  /** @type {string[]} */
  const objects = [];
  const add = (body) => {
    objects.push(body);
    return objects.length; // số thứ tự object (1-based)
  };

  const catalogId = 1;
  const pagesId = 2;
  objects.push("", ""); // tạm giữ chỗ cho Catalog & Pages

  const pageIds = [];
  const contentIds = [];
  const fontId = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  for (let page = 1; page <= totalPages; page += 1) {
    const content = `BT /F1 24 Tf 72 700 Td (Trang ${page}) Tj ET`;
    const contentId = add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    contentIds.push(contentId);
    const pageId = add(
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] ` +
        `/Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`
    );
    pageIds.push(pageId);
  }
  // Outlines: root + một item cho mỗi chương (dest trỏ tới trang đầu chương).
  const outlineRootId = add("");
  const itemIds = [];
  for (let chapter = 0; chapter < chapters; chapter += 1) {
    const pageId = pageIds[chapter * pagesPerChapter];
    itemIds.push(
      add(
        `<< /Title ${pdfText(`${titlePrefix} ${chapter + 1}`)} /Parent ${outlineRootId} 0 R ` +
          `/Dest [${pageId} 0 R /XYZ null null null] >>`
      )
    );
  }

  objects[catalogId - 1] =
    `<< /Type /Catalog /Pages ${pagesId} 0 R /Outlines ${outlineRootId} 0 R /PageMode /UseOutlines >>`;
  objects[pagesId - 1] =
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${totalPages} >>`;
  objects[outlineRootId - 1] =
    `<< /Type /Outlines /First ${itemIds[0]} 0 R /Last ${itemIds[itemIds.length - 1]} 0 R /Count ${itemIds.length} >>`;
  for (let index = 0; index < itemIds.length; index += 1) {
    const next = itemIds[index + 1];
    const prev = itemIds[index - 1];
    const body = objects[itemIds[index] - 1];
    const links = [next ? `/Next ${next} 0 R` : "", prev ? `/Prev ${prev} 0 R` : ""]
      .filter(Boolean)
      .join(" ");
    objects[itemIds[index] - 1] = body.replace(" /Parent", ` ${links} /Parent`);
  }

  // Dựng file với bảng xref chính xác.
  const chunks = [];
  let offset = 0;
  const push = (text) => {
    const buffer = Buffer.from(text, "latin1");
    chunks.push(buffer);
    offset += buffer.length;
  };

  push("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  const offsets = [];
  objects.forEach((body, index) => {
    offsets[index] = offset;
    push(`${index + 1} 0 obj\n${body}\nendobj\n`);
  });
  const xrefOffset = offset;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const value of offsets) {
    xref += `${String(value).padStart(10, "0")} 00000 n \n`;
  }
  push(xref);
  push(`trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

  return Buffer.concat(chunks);
}

if (process.argv[1] && process.argv[1].endsWith("make-test-pdf.mjs")) {
  const output = process.argv[2] ?? "test-outline.pdf";
  const chapters = Number(process.argv[3] ?? 2);
  const pagesPerChapter = Number(process.argv[4] ?? 3);
  const buffer = buildOutlinePdf({ chapters, pagesPerChapter });
  fs.writeFileSync(output, buffer);
  process.stdout.write(`[pdf] đã ghi ${output} (${buffer.length} byte, ${chapters} chương)\n`);
}

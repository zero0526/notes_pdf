#!/usr/bin/env node
/**
 * Sinh icon PNG cho manifest (không phụ thuộc thư viện ngoài).
 * Dùng zlib của Node để dựng PNG tối giảu: nền tối + trang giấy sáng + vài dòng gạch chữ.
 */

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const assetsDir = path.join(root, "assets");

const BG = [0x1f, 0x1f, 0x23, 0xff];
const PAPER = [0xe8, 0xe8, 0xea, 0xff];
const ACCENT = [0x4d, 0xa3, 0xff, 0xff];
const LINE = [0x9a, 0xa0, 0xb0, 0xff];

function crc32(buffer) {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return ~crc >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

/**
 * @param {number} size
 * @returns {Buffer} PNG
 */
function renderIcon(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const put = (x, y, color) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const offset = (y * size + x) * 4;
    pixels[offset] = color[0];
    pixels[offset + 1] = color[1];
    pixels[offset + 2] = color[2];
    pixels[offset + 3] = color[3];
  };

  const margin = Math.round(size * 0.16);
  const pageWidth = size - margin * 2;
  const pageHeight = size - margin * 2;
  const radius = Math.max(1, Math.round(size * 0.06));

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      put(x, y, BG);
    }
  }

  // Trang giấy (bo góc).
  for (let y = margin; y < size - margin; y += 1) {
    for (let x = margin; x < size - margin; x += 1) {
      const nearLeft = x - margin < radius;
      const nearRight = size - margin - 1 - x < radius;
      const nearTop = y - margin < radius;
      const nearBottom = size - margin - 1 - y < radius;
      const corner =
        (nearLeft || nearRight) && (nearTop || nearBottom) &&
        (x - margin < radius || size - margin - 1 - x < radius) &&
        (y - margin < radius || size - margin - 1 - y < radius);
      if (corner) {
        const dx = Math.min(x - margin, size - margin - 1 - x);
        const dy = Math.min(y - margin, size - margin - 1 - y);
        if (dx * dx + dy * dy > radius * radius) continue;
      }
      put(x, y, PAPER);
    }
  }

  // Vạch dòng "ghi chú".
  const lineHeight = Math.max(1, Math.round(size * 0.07));
  const textLeft = margin + Math.round(pageWidth * 0.14);
  const textWidth = pageWidth - Math.round(pageWidth * 0.28);
  const lineWidth = Math.max(1, Math.round(size * 0.05));
  for (let index = 0; index < 3; index += 1) {
    const y = margin + Math.round(pageHeight * (0.28 + index * 0.22));
    const width = index === 2 ? Math.round(textWidth * 0.6) : textWidth;
    for (let dy = 0; dy < lineHeight; dy += 1) {
      for (let dx = 0; dx < width; dx += 1) {
        put(textLeft + dx, y + dy, index === 0 ? ACCENT : LINE);
      }
    }
  }

  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0;
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

fs.mkdirSync(assetsDir, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  const file = path.join(assetsDir, `icon${size}.png`);
  fs.writeFileSync(file, renderIcon(size));
  process.stdout.write(`[icons] ${path.relative(root, file)}\n`);
}

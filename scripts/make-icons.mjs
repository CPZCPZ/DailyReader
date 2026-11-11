#!/usr/bin/env node
/**
 * 生成 PWA 图标（纯 Node，无依赖）：蓝紫渐变圆角底 + 白色书本图形。
 * 输出 public/icons/icon-{192,512}.png 和 icon-maskable-512.png（maskable 带安全边距）。
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '..', 'public', 'icons');
mkdirSync(outDir, { recursive: true });

/* ---------- 最小 PNG 编码器 ---------- */

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let crc = -1;
  for (const b of buf) crc = (crc >>> 8) ^ table[(crc ^ b) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  // 每行前置 filter byte 0
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------- 像素绘制 ---------- */

function mix(a, b, t) {
  return a + (b - a) * t;
}

function drawIcon(size, maskable = false) {
  const rgba = Buffer.alloc(size * size * 4);
  // maskable：内容收缩到中心 ~72%，四周留纯色安全区
  const inset = maskable ? size * 0.14 : 0;
  const S = size - inset * 2;

  const set = (x, y, r, g, b, a = 255) => {
    const i = (y * size + x) * 4;
    const na = a / 255;
    rgba[i] = Math.round(r * na + rgba[i] * (1 - na));
    rgba[i + 1] = Math.round(g * na + rgba[i + 1] * (1 - na));
    rgba[i + 2] = Math.round(b * na + rgba[i + 2] * (1 - na));
    rgba[i + 3] = Math.max(rgba[i + 3], Math.round(a));
  };

  // 抗锯齿覆盖率（1px）
  const cover = (fn) => {
    const SS = 3; // 3x3 超采样
    let hit = 0;
    for (let sy = 0; sy < SS; sy++)
      for (let sx = 0; sx < SS; sx++) if (fn((sx + 0.5) / SS, (sy + 0.5) / SS)) hit++;
    return hit / (SS * SS);
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const ix = px - inset;
      const iy = py - inset;

      // 圆角矩形背景（渐变）
      const radius = S * 0.22;
      const rx = Math.max(Math.abs(ix - S / 2) - (S / 2 - radius), 0);
      const ry = Math.max(Math.abs(iy - S / 2) - (S / 2 - radius), 0);
      const insideBg = cover((ox, oy) => {
        const cx = ix - 0.5 + ox, cy = iy - 0.5 + oy;
        const dx = Math.max(Math.abs(cx - S / 2) - (S / 2 - radius), 0);
        const dy = Math.max(Math.abs(cy - S / 2) - (S / 2 - radius), 0);
        return dx * dx + dy * dy <= radius * radius;
      });
      if (insideBg > 0) {
        const t = (ix / S + iy / S) / 2;
        const r = mix(37, 79, t); // #2563eb → #4f46e5
        const g = mix(99, 70, t);
        const b = mix(235, 229, t);
        set(x, y, r, g, b, insideBg * 255);
      }

      // 白色翻开的书：两页四边形 + 中缝
      const bx0 = S * 0.20, bx1 = S * 0.5, bx2 = S * 0.80;
      const by0 = S * 0.27, by1 = S * 0.50, by2 = S * 0.75;
      const pageL = cover((ox, oy) => {
        const cx = ix - 0.5 + ox, cy = iy - 0.5 + oy;
        if (cx > bx1) return false;
        // 上边从 (bx0,by0) 到 (bx1,by1)；下边从 (bx0,by2) 到 (bx1,by1)
        const tTop = (cx - bx0) / (bx1 - bx0);
        const top = by0 + (by1 - by0) * tTop;
        const bot = by2 + (by1 - by2) * tTop;
        return cy >= top && cy <= bot;
      });
      const pageR = cover((ox, oy) => {
        const cx = ix - 0.5 + ox, cy = iy - 0.5 + oy;
        if (cx < bx1) return false;
        const tTop = (bx2 - cx) / (bx2 - bx1);
        const top = by0 + (by1 - by0) * tTop;
        const bot = by2 + (by1 - by2) * tTop;
        return cy >= top && cy <= bot;
      });
      const page = Math.max(pageL, pageR);
      if (page > 0) set(x, y, 255, 255, 255, page * 240);

      // 中缝
      const spineW = S * 0.018;
      const spine = cover((ox, oy) => {
        const cx = ix - 0.5 + ox, cy = iy - 0.5 + oy;
        return Math.abs(cx - bx1) <= spineW && cy >= by1 - S * 0.01 && cy <= by1 + S * 0.2;
      });
      if (spine > 0) set(x, y, 37, 99, 235, spine * 200);
    }
  }
  return encodePng(size, size, rgba);
}

for (const [name, size, maskable] of [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['icon-maskable-512.png', 512, true],
]) {
  const png = drawIcon(size, maskable);
  writeFileSync(join(outDir, name), png);
  console.log(`✓ ${join('public', 'icons', name)} (${png.length} bytes)`);
}

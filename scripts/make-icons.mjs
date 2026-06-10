/**
 * Generates the PWA / Android icons as PNG files with zero dependencies
 * (hand-rolled PNG encoder + anti-aliased circle rasterizer).
 *
 *   npm run icons      → writes icons/icon-192.png, icon-512.png,
 *                        icon-maskable-512.png, apple-touch-icon.png
 *
 * Artwork = the Time Architect "dot flower" logo from the sidebar SVG,
 * on the app's warm paper background.
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'icons');

// ── minimal PNG encoder ──
const CRC_TABLE = (() => {
    const table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        table[n] = c;
    }
    return table;
})();

function crc32(buf) {
    let c = -1;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
}

function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
    const raw = Buffer.alloc((width * 4 + 1) * height);
    for (let y = 0; y < height; y++) {
        raw[y * (width * 4 + 1)] = 0; // filter: none
        rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8;  // bit depth
    ihdr[9] = 6;  // color type RGBA
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', ihdr),
        chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
        chunk('IEND', Buffer.alloc(0))
    ]);
}

// ── rasterizer ──
function hex(rgb) {
    return [parseInt(rgb.slice(1, 3), 16), parseInt(rgb.slice(3, 5), 16), parseInt(rgb.slice(5, 7), 16)];
}

function makeCanvas(size) {
    return { size, data: Buffer.alloc(size * size * 4) };
}

function blendPixel(canvas, x, y, [r, g, b], alpha) {
    if (alpha <= 0 || x < 0 || y < 0 || x >= canvas.size || y >= canvas.size) return;
    const i = (y * canvas.size + x) * 4;
    const old = canvas.data;
    const oa = old[i + 3] / 255;
    const na = alpha + oa * (1 - alpha);
    if (na <= 0) return;
    old[i] = Math.round((r * alpha + old[i] * oa * (1 - alpha)) / na);
    old[i + 1] = Math.round((g * alpha + old[i + 1] * oa * (1 - alpha)) / na);
    old[i + 2] = Math.round((b * alpha + old[i + 2] * oa * (1 - alpha)) / na);
    old[i + 3] = Math.round(na * 255);
}

function fillRoundedRect(canvas, radius, color) {
    const s = canvas.size;
    const rgb = hex(color);
    for (let y = 0; y < s; y++) {
        for (let x = 0; x < s; x++) {
            const cx = Math.max(radius - x, x - (s - 1 - radius), 0);
            const cy = Math.max(radius - y, y - (s - 1 - radius), 0);
            const d = Math.hypot(cx, cy);
            const alpha = Math.max(0, Math.min(1, radius - d + 0.5));
            blendPixel(canvas, x, y, rgb, cx && cy ? alpha : 1);
        }
    }
}

function fillCircle(canvas, cx, cy, radius, color) {
    const rgb = hex(color);
    const x0 = Math.max(0, Math.floor(cx - radius - 2));
    const x1 = Math.min(canvas.size - 1, Math.ceil(cx + radius + 2));
    const y0 = Math.max(0, Math.floor(cy - radius - 2));
    const y1 = Math.min(canvas.size - 1, Math.ceil(cy + radius + 2));
    for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
            const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
            const alpha = Math.max(0, Math.min(1, radius - d + 0.5));
            blendPixel(canvas, x, y, rgb, alpha);
        }
    }
}

// Dot-flower logo from calendarSidebarHtml (38x38 viewBox).
const FLOWER = [
    { x: 19, y: 8, r: 5, c: '#FF7A1A' },
    { x: 28.5, y: 13.5, r: 5, c: '#FF8A00' },
    { x: 28.5, y: 24.5, r: 5, c: '#FF5A1F' },
    { x: 19, y: 30, r: 5, c: '#FF7A1A' },
    { x: 9.5, y: 24.5, r: 5, c: '#FF8A00' },
    { x: 9.5, y: 13.5, r: 5, c: '#FF5A1F' },
    { x: 19, y: 19, r: 4, c: '#FF6B1A' }
];

function drawIcon(size, { maskable = false, background = '#FFFDF8', cornerRatio = 0.22 } = {}) {
    const canvas = makeCanvas(size);
    if (maskable) {
        fillRoundedRect(canvas, 0, background); // full-bleed square; the OS masks it
    } else {
        fillRoundedRect(canvas, size * cornerRatio, background);
    }
    // maskable safe zone = inner 80%; keep the flower inside 60% to be safe
    const logoSpan = maskable ? size * 0.58 : size * 0.72;
    const scale = logoSpan / 38;
    const offset = (size - logoSpan) / 2;
    for (const dot of FLOWER) {
        fillCircle(canvas, offset + dot.x * scale, offset + dot.y * scale, dot.r * scale, dot.c);
    }
    return encodePng(size, size, canvas.data);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const files = {
    'icon-192.png': drawIcon(192),
    'icon-512.png': drawIcon(512),
    'icon-maskable-512.png': drawIcon(512, { maskable: true }),
    'apple-touch-icon.png': drawIcon(180, { maskable: true })
};
for (const [name, buf] of Object.entries(files)) {
    fs.writeFileSync(path.join(OUT_DIR, name), buf);
    console.log(`wrote icons/${name} (${buf.length} bytes)`);
}

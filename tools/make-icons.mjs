// Генерирует иконки PWA без внешних зависимостей: рисуем пиксели, жмём zlib, пишем PNG.
// Мотив — знак рубля: стойка, правая половина кольца (чаша) и перекладина.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
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

function png(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // бит на канал
  ihdr[9] = 6;   // RGBA
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // фильтр None
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const BG_TOP = [0x18, 0x22, 0x31];
const BG_BOTTOM = [0x0d, 0x12, 0x1c];
const GLYPH = [0x3f, 0xd0, 0xa8];

// Кроет ли точка (нормированные координаты) знак рубля
function inGlyph(x, y) {
  if (x >= 0.395 && x <= 0.49 && y >= 0.20 && y <= 0.80) return true;        // стойка
  if (x >= 0.295 && x <= 0.595 && y >= 0.625 && y <= 0.695) return true;      // перекладина
  if (x >= 0.49) {                                                           // чаша
    const d = Math.hypot(x - 0.49, y - 0.40);
    if (d <= 0.195 && d >= 0.105) return true;
  }
  return false;
}

function render(size) {
  const buf = Buffer.alloc(size * size * 4);
  const SS = 3; // суперсэмплинг для сглаживания
  for (let py = 0; py < size; py++) {
    const t = py / (size - 1);
    const bg = [0, 1, 2].map(i => Math.round(BG_TOP[i] + (BG_BOTTOM[i] - BG_TOP[i]) * t));
    for (let px = 0; px < size; px++) {
      let hits = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (px + (sx + 0.5) / SS) / size;
          const y = (py + (sy + 0.5) / SS) / size;
          if (inGlyph(x, y)) hits++;
        }
      }
      const a = hits / (SS * SS);
      const o = (py * size + px) * 4;
      for (let i = 0; i < 3; i++) buf[o + i] = Math.round(bg[i] + (GLYPH[i] - bg[i]) * a);
      buf[o + 3] = 255;
    }
  }
  return png(size, size, buf);
}

mkdirSync('icons', { recursive: true });
for (const [name, size] of [['apple-touch-icon', 180], ['icon-192', 192], ['icon-512', 512]]) {
  const file = `icons/${name}.png`;
  writeFileSync(file, render(size));
  console.log(`${file} — ${size}×${size}`);
}

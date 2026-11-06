// アイコン画像（PNG）を外部ライブラリなしで生成する
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, draw) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = draw(x / size, y / size);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
// 絵柄：夜空の背景に、黄色い星形の衝撃と、飛んでいく丸いキャラ
function art(pad) {
  return (u, v) => {
    const x = (u - 0.5) / (1 - pad * 2) + 0.5, y = (v - 0.5) / (1 - pad * 2) + 0.5;
    const bg = [27 + v * 30, 31 + v * 10, 59 + v * 40, 255];
    const dx = x - 0.42, dy = y - 0.55;
    const ang = Math.atan2(dy, dx), rad = Math.hypot(dx, dy);
    const star = 0.26 + 0.09 * Math.cos(ang * 8);
    let c = bg;
    if (rad < star) c = [255, 207, 63, 255];
    if (rad < star * 0.62) c = [255, 246, 201, 255];
    const bx = x - 0.7, by = y - 0.3;
    if (Math.hypot(bx, by) < 0.13) c = [79, 140, 255, 255];
    if (Math.hypot(bx + 0.035, by + 0.02) < 0.025 || Math.hypot(bx - 0.035, by + 0.02) < 0.025) c = [20, 20, 40, 255];
    // 飛んでいく線
    for (let i = 0; i < 3; i++) {
      const lx = x - (0.5 - i * 0.03), ly = y - (0.42 - i * 0.07);
      const t = lx * 0.83 + ly * -0.55, d = Math.abs(lx * 0.55 + ly * 0.83);
      if (t > -0.12 && t < 0.02 && d < 0.012) c = [255, 255, 255, 255];
    }
    return c;
  };
}
writeFileSync('public/icons/icon-192.png', png(192, art(0)));
writeFileSync('public/icons/icon-512.png', png(512, art(0)));
writeFileSync('public/icons/icon-512-maskable.png', png(512, art(0.1)));
writeFileSync('public/icons/apple-touch-icon.png', png(180, art(0.04)));
console.log('icons written');

//!/usr/bin/env node
// 生成 tray.png（32x32 蓝色圆点）——用纯 Node 写 PNG 太复杂，改用 BMP 格式
// Electron Tray 支持 .png/.ico；这里生成一个最简单的 16x16 ICO。
const fs = require('fs');
const path = require('path');

// 16x16 32bpp ICO，纯蓝圆
const W = 16, H = 16;
const bpp = 32, rowSize = W * 4, imgSize = rowSize * H;

// BITMAPINFOHEADER (40 bytes), height = 2*H (XOR+AND)
const bih = Buffer.alloc(40);
bih.writeUInt32LE(40, 0);
bih.writeInt32LE(W, 4);
bih.writeInt32LE(H * 2, 8);
bih.writeUInt16LE(1, 12);
bih.writeUInt16LE(bpp, 14);
bih.writeUInt32LE(imgSize, 20);

// AND mask (1bpp, rows padded to 32 bits): W=16 → 2 bytes/row, padded to 4
const andRow = 4;
const andSize = andRow * H;

const xor = Buffer.alloc(imgSize);
const r0 = 7.0;
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const dx = x - r0, dy = y - r0;
    const inside = dx * dx + dy * dy <= r0 * r0;
    const o = y * rowSize + x * 4;
    if (inside) {
      xor[o] = 0xe0;     // B
      xor[o + 1] = 0x6c; // G  (#4f8cff → BGR)
      xor[o + 2] = 0x8f; // R
      xor[o + 3] = 0xff; // A
    }
  }
}
const and = Buffer.alloc(andSize); // 全 0 = 不透明（alpha 生效）

const iconDir = Buffer.alloc(6);
iconDir.writeUInt16LE(0, 0);
iconDir.writeUInt16LE(1, 2); // type icon
iconDir.writeUInt16LE(1, 4); // count

const entry = Buffer.alloc(16);
entry[0] = W; entry[1] = H;
entry[2] = 0; entry[3] = 0;
entry.writeUInt16LE(1, 4);
entry.writeUInt16LE(bpp, 6);
entry.writeUInt32LE(40 + imgSize + andSize, 8);
entry.writeUInt32LE(22, 12); // data offset

const out = Buffer.concat([iconDir, entry, bih, xor, and]);
fs.writeFileSync(path.join(__dirname, 'tray.png'), out);
console.log('written (ico-format saved as tray.png):', out.length, 'bytes');

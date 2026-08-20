/* Generates the app icons: a rounded dark tile with a red apex chevron.
   No image libraries in the repo, so the PNGs are encoded by hand. */
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

function crc32(buf) {
  let c, table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xFFFFFFFF;
  for (const b of buf) crc = table[(crc ^ b) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(size, pixel) {
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y, size);
      const o = y * stride + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

/* signed distance to a thick chevron, so the mark stays crisp at any size */
function chevron(x, y, s) {
  const u = x / s, v = y / s;
  const cx = 0.5, apex = 0.30, foot = 0.74, half = 0.26, thick = 0.115;
  // two legs of the chevron, as capsules from the apex down to each foot
  const legs = [[cx, apex, cx - half, foot], [cx, apex, cx + half, foot]];
  let d = 1;
  for (const [x1, y1, x2, y2] of legs) {
    const dx = x2 - x1, dy = y2 - y1;
    const t = Math.max(0, Math.min(1, ((u - x1) * dx + (v - y1) * dy) / (dx * dx + dy * dy)));
    const px = x1 + t * dx - u, py = y1 + t * dy - v;
    d = Math.min(d, Math.hypot(px, py));
  }
  return d - thick / 2;
}

function draw(x, y, s) {
  const u = x / s, v = y / s;
  // rounded-square mask
  const r = 0.21, k = Math.max(Math.abs(u - 0.5), Math.abs(v - 0.5));
  const corner = Math.hypot(Math.max(Math.abs(u - 0.5) - (0.5 - r), 0), Math.max(Math.abs(v - 0.5) - (0.5 - r), 0));
  const outside = k > 0.5 || corner > r;
  if (outside) return [0, 0, 0, 0];

  // background: a slight diagonal lift so the tile is not flat
  const t = (u + v) / 2;
  const bg = [11 + 18 * t, 13 + 20 * t, 16 + 24 * t];

  const d = chevron(x, y, s);
  const aa = 1.4 / s;
  const inMark = 1 - Math.min(1, Math.max(0, (d + aa) / (2 * aa)));
  const mark = [230, 60, 48];
  return [
    Math.round(bg[0] + (mark[0] - bg[0]) * inMark),
    Math.round(bg[1] + (mark[1] - bg[1]) * inMark),
    Math.round(bg[2] + (mark[2] - bg[2]) * inMark),
    255
  ];
}

for (const [name, size] of [["icon-192.png", 192], ["icon-512.png", 512], ["apple-touch-icon.png", 180]]) {
  writeFileSync(new URL("../icons/" + name, import.meta.url), png(size, draw));
  console.log("wrote icons/" + name);
}

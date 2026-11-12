import { writeFileSync } from 'node:fs';
import zlib from 'node:zlib';

const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#2c1a32"/>
      <stop offset="100%" stop-color="#180e1c"/>
    </linearGradient>
    <linearGradient id="glow" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#d3ef8a"/>
      <stop offset="100%" stop-color="#ff9f8f"/>
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="12" stdDeviation="16" flood-color="#000000" flood-opacity="0.5"/>
    </filter>
  </defs>
  <rect width="512" height="512" rx="120" fill="url(#bg)"/>
  <rect x="16" y="16" width="480" height="480" rx="108" fill="none" stroke="url(#glow)" stroke-width="6" opacity="0.45"/>
  <g transform="translate(100, 100) scale(4.875)" filter="url(#shadow)">
    <path d="M32 6A24 24 0 1 1 20.5 51L9 56L13.5 44.8A24 24 0 0 1 32 6Z" fill="none" stroke="#d3ef8a" stroke-width="3.5" stroke-linejoin="round"/>
    <path d="M23 27L41 33" stroke="#d3ef8a" stroke-width="2.5" stroke-linecap="round"/>
    <circle cx="23" cy="27" r="5.5" fill="#d3ef8a"/>
    <circle cx="41" cy="33" r="5.5" fill="#ff9f8f"/>
  </g>
</svg>`;

writeFileSync('icon.svg', svgContent, 'utf8');

function createPng(width, height, drawFn) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const crcBuf = Buffer.alloc(4);
    let c = 0xFFFFFFFF;
    const combined = Buffer.concat([typeBuf, data]);
    for (let i = 0; i < combined.length; i++) {
      c ^= combined[i];
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
    }
    crcBuf.writeInt32BE(~c, 0);
    return Buffer.concat([len, combined, crcBuf]);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const ihdrChunk = chunk('IHDR', ihdr);

  const rawData = Buffer.alloc(height * (1 + width * 4));
  let offset = 0;
  for (let y = 0; y < height; y++) {
    rawData[offset++] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = drawFn(x, y, width, height);
      rawData[offset++] = r;
      rawData[offset++] = g;
      rawData[offset++] = b;
      rawData[offset++] = a;
    }
  }
  const idatChunk = chunk('IDAT', zlib.deflateSync(rawData));
  const iendChunk = chunk('IEND', Buffer.alloc(0));
  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function drawTawasolIcon(x, y, w, h) {
  const cx = w / 2;
  const cy = h / 2;
  const rad = w * 0.46;
  const dx = Math.abs(x - cx);
  const dy = Math.abs(y - cy);
  // Rounded corner squircle
  const cornerR = w * 0.22;
  const isInside = (dx <= cx && dy <= cy - cornerR) ||
                   (dy <= cy && dx <= cx - cornerR) ||
                   (Math.hypot(dx - (cx - cornerR), dy - (cy - cornerR)) <= cornerR);

  if (!isInside) return [0, 0, 0, 0];

  // Inner logo elements
  // Lime circle 1 at (0.36 * w, 0.42 * h)
  const dot1X = w * 0.36;
  const dot1Y = h * 0.42;
  const d1 = Math.hypot(x - dot1X, y - dot1Y);
  if (d1 <= w * 0.088) return [211, 239, 138, 255]; // Lime

  // Coral circle 2 at (0.64 * w, 0.52 * h)
  const dot2X = w * 0.64;
  const dot2Y = h * 0.52;
  const d2 = Math.hypot(x - dot2X, y - dot2Y);
  if (d2 <= w * 0.088) return [255, 159, 143, 255]; // Coral

  // Dialog bubble line ring
  const ringDist = Math.hypot(x - cx, y - cy);
  if (ringDist >= w * 0.28 && ringDist <= w * 0.34) {
    return [211, 239, 138, 240];
  }

  // Connecting line
  // From (0.36, 0.42) to (0.64, 0.52)
  const lineT = Math.max(0, Math.min(1, ((x - dot1X) * (dot2X - dot1X) + (y - dot1Y) * (dot2Y - dot1Y)) / ((dot2X - dot1X) ** 2 + (dot2Y - dot1Y) ** 2)));
  const projX = dot1X + lineT * (dot2X - dot1X);
  const projY = dot1Y + lineT * (dot2Y - dot1Y);
  if (Math.hypot(x - projX, y - projY) <= w * 0.02) {
    return [211, 239, 138, 230];
  }

  // Background gradient: dark plum
  const gradientFactor = (x + y) / (w + h);
  const bgR = Math.round(44 - gradientFactor * 16);
  const bgG = Math.round(26 - gradientFactor * 10);
  const bgB = Math.round(50 - gradientFactor * 18);
  return [bgR, bgG, bgB, 255];
}

const p192 = createPng(192, 192, drawTawasolIcon);
writeFileSync('icon-192.png', p192);

const p512 = createPng(512, 512, drawTawasolIcon);
writeFileSync('icon-512.png', p512);

console.log('Icons generated successfully ✓');

'use strict';

// Generates 16x16 PNG icons for Windows taskbar thumbnail toolbar.
// Self-contained: no external image files needed.

const { nativeImage } = require('electron');
const zlib = require('zlib');

const SIZE = 16;

// ==================== CRC32 (for PNG chunks) ====================

const crc32Table = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) {
    c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  }
  crc32Table[i] = c;
}

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ crc32Table[(crc ^ buf[i]) & 0xFF];
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// ==================== Minimal PNG encoder ====================

function makePNG(rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type: RGBA

  // Raw scanlines: each row = 1 filter byte (0 = None) + SIZE*4 pixel bytes
  const rowLen = SIZE * 4;
  const raw = Buffer.alloc(SIZE * (1 + rowLen));
  for (let y = 0; y < SIZE; y++) {
    const off = y * (1 + rowLen);
    raw[off] = 0; // filter: None
    rgba.copy(raw, off + 1, y * rowLen, (y + 1) * rowLen);
  }

  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crcBuf]);
}

// ==================== Drawing helpers ====================

function px(buf, x, y, r, g, b) {
  if (x < 0 || x >= SIZE || y < 0 || y >= SIZE) return;
  const i = (y * SIZE + x) * 4;
  buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = 255;
}

function rect(buf, x, y, w, h, r, g, b) {
  for (let dy = 0; dy < h; dy++)
    for (let dx = 0; dx < w; dx++)
      px(buf, x + dx, y + dy, r, g, b);
}

// ==================== Icon shapes ====================

const W = [220, 230, 240]; // white (active)
const G = [100, 110, 120]; // gray (muted shape)
const R = [220, 50, 50];   // red (slash)

function drawMic(buf, c) {
  // Mic head (rounded rectangle)
  rect(buf, 6, 1, 4, 1, ...c);   // top edge
  rect(buf, 5, 2, 6, 4, ...c);   // body
  rect(buf, 6, 6, 4, 1, ...c);   // bottom edge
  // Cradle arms
  rect(buf, 3, 7, 1, 2, ...c);
  rect(buf, 12, 7, 1, 2, ...c);
  // Cradle base
  rect(buf, 4, 9, 8, 1, ...c);
  // Stem
  rect(buf, 7, 10, 2, 2, ...c);
  // Base
  rect(buf, 4, 12, 8, 1, ...c);
}

function drawSpeaker(buf, c) {
  // Driver face
  rect(buf, 1, 5, 2, 4, ...c);
  // Connector
  rect(buf, 3, 5, 1, 4, ...c);
  // Cone (flares out)
  rect(buf, 4, 4, 1, 6, ...c);
  rect(buf, 5, 3, 1, 8, ...c);
  rect(buf, 6, 2, 1, 10, ...c);
}

function drawWaves(buf, c) {
  // Near wave arc
  px(buf, 9, 4, ...c);
  px(buf, 8, 5, ...c);
  px(buf, 8, 6, ...c);
  px(buf, 8, 7, ...c);
  px(buf, 8, 8, ...c);
  px(buf, 9, 9, ...c);
  // Far wave arc
  px(buf, 11, 3, ...c);
  px(buf, 10, 4, ...c);
  px(buf, 10, 5, ...c);
  px(buf, 10, 6, ...c);
  px(buf, 10, 7, ...c);
  px(buf, 10, 8, ...c);
  px(buf, 10, 9, ...c);
  px(buf, 11, 10, ...c);
}

function drawSlash(buf) {
  // Diagonal red slash from top-right to bottom-left, 2px wide
  for (let i = 0; i < 12; i++) {
    px(buf, 13 - i, 1 + i, ...R);
    px(buf, 12 - i, 1 + i, ...R);
  }
}

// ==================== Public API ====================

function createTaskbarIcons() {
  const micOn = Buffer.alloc(SIZE * SIZE * 4);
  drawMic(micOn, W);

  const micOff = Buffer.alloc(SIZE * SIZE * 4);
  drawMic(micOff, G);
  drawSlash(micOff);

  const spkOn = Buffer.alloc(SIZE * SIZE * 4);
  drawSpeaker(spkOn, W);
  drawWaves(spkOn, W);

  const spkOff = Buffer.alloc(SIZE * SIZE * 4);
  drawSpeaker(spkOff, G);
  drawSlash(spkOff);

  return {
    micOn:      nativeImage.createFromBuffer(makePNG(micOn)),
    micOff:     nativeImage.createFromBuffer(makePNG(micOff)),
    speakerOn:  nativeImage.createFromBuffer(makePNG(spkOn)),
    speakerOff: nativeImage.createFromBuffer(makePNG(spkOff))
  };
}

module.exports = { createTaskbarIcons };

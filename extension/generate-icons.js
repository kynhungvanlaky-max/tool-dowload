/**
 * generate-icons.js
 * Tạo file icon PNG cho Chrome Extension MediaFetch Helper
 * Chạy: node generate-icons.js
 * Không cần npm install thêm gì - chỉ dùng built-in Node.js modules
 */

const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

// ─── Palette màu Catppuccin Mocha ───────────────────────────────────────────
const BG   = [30,  30,  46,  255]; // #1e1e2e – nền tối
const BG2  = [49,  50,  68,  255]; // #313244 – nền card
const BLUE = [137, 180, 250, 255]; // #89b4fa – accent xanh
const TEAL = [148, 226, 213, 255]; // #94e2d5 – teal
const NONE = [0,   0,   0,   0  ]; // Trong suốt

// ─── Tiện ích tạo PNG thủ công ──────────────────────────────────────────────
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let j = 0; j < 8; j++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function makeChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.concat([typeBytes, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcBuf), 0);
  return Buffer.concat([len, typeBytes, data, crc]);
}

function makePNG(width, height, pixelFn) {
  // Signature
  const sig = Buffer.from([137,80,78,71,13,10,26,10]);

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width,  0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8]  = 8;  // bit depth
  ihdr[9]  = 2;  // color type: RGB (3 channels)
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  // IDAT: raw pixel rows với filter byte 0 ở đầu mỗi hàng
  const rawRows = [];
  for (let y = 0; y < height; y++) {
    const row = [0]; // filter byte none
    for (let x = 0; x < width; x++) {
      const px = pixelFn(x, y, width, height);
      row.push(px[0], px[1], px[2]);
    }
    rawRows.push(Buffer.from(row));
  }

  const rawData = Buffer.concat(rawRows);
  const compressed = zlib.deflateSync(rawData, { level: 9 });

  return Buffer.concat([
    sig,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', compressed),
    makeChunk('IEND', Buffer.alloc(0))
  ]);
}

function makePNGWithAlpha(width, height, pixelFn) {
  const sig = Buffer.from([137,80,78,71,13,10,26,10]);

  // IHDR: RGBA
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width,  0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8]  = 8;
  ihdr[9]  = 6; // color type: RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const rawRows = [];
  for (let y = 0; y < height; y++) {
    const row = [0];
    for (let x = 0; x < width; x++) {
      const px = pixelFn(x, y, width, height);
      row.push(px[0], px[1], px[2], px[3]);
    }
    rawRows.push(Buffer.from(row));
  }

  const rawData = Buffer.concat(rawRows);
  const compressed = zlib.deflateSync(rawData, { level: 9 });

  return Buffer.concat([
    sig,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', compressed),
    makeChunk('IEND', Buffer.alloc(0))
  ]);
}

// ─── Hàm vẽ icon MediaFetch ─────────────────────────────────────────────────
function drawIcon(x, y, w, h) {
  const cx = w / 2, cy = h / 2;
  const r = w / 2;

  // Normalize về [0, 1]
  const nx = x / w, ny = y / h;

  // 1. Vẽ hình tròn nền gradient
  const dx = x - cx, dy = y - cy;
  const dist = Math.sqrt(dx*dx + dy*dy);
  if (dist > r - 0.5) return NONE; // ngoài vòng tròn → trong suốt

  // Gradient nền: từ BG2 (trên) sang BG (dưới)
  const t = ny; // 0 ở trên, 1 ở dưới
  const bgR = Math.round(BG2[0] * (1 - t) + BG[0] * t);
  const bgG = Math.round(BG2[1] * (1 - t) + BG[1] * t);
  const bgB = Math.round(BG2[2] * (1 - t) + BG[2] * t);

  // 2. Vẽ mũi tên tải xuống (download arrow)
  const arrowW = w * 0.40;  // chiều rộng mũi tên
  const arrowH = w * 0.22;  // chiều cao phần tam giác
  const stemW  = w * 0.16;  // chiều rộng thân mũi tên
  const stemH  = w * 0.28;  // chiều cao thân mũi tên
  const baseY  = h * 0.72;  // vị trí Y đáy mũi tên
  const topY   = baseY - stemH - arrowH;
  const lineY  = h * 0.80;  // vị trí Y đường gạch ngang

  // Thân đứng
  const stemLeft  = cx - stemW / 2;
  const stemRight = cx + stemW / 2;
  const stemTop   = topY;
  const stemBot   = baseY - arrowH;

  if (x >= stemLeft && x <= stemRight && y >= stemTop && y <= stemBot) {
    return [BLUE[0], BLUE[1], BLUE[2], 255];
  }

  // Tam giác mũi tên (hình thang ngược): đỉnh ở dưới giữa
  const arrowLeft  = cx - arrowW / 2;
  const arrowRight = cx + arrowW / 2;
  const arrowTop   = stemBot;
  const arrowBotY  = baseY;

  if (y >= arrowTop && y <= arrowBotY) {
    // Kiểm tra trong tam giác: hàng càng xuống dưới càng hẹp lại về giữa
    const ratio = (y - arrowTop) / (arrowBotY - arrowTop);
    const halfW = (arrowW / 2) * (1 - ratio);
    if (x >= cx - halfW && x <= cx + halfW) {
      // Tint teal ở phần cuối mũi tên
      const blend = ratio;
      return [
        Math.round(BLUE[0] * (1-blend) + TEAL[0] * blend),
        Math.round(BLUE[1] * (1-blend) + TEAL[1] * blend),
        Math.round(BLUE[2] * (1-blend) + TEAL[2] * blend),
        255
      ];
    }
  }

  // Đường gạch ngang ở đáy
  const lineThick = Math.max(1, Math.round(w * 0.08));
  const lineLeft  = cx - arrowW / 2;
  const lineRight = cx + arrowW / 2;
  if (y >= lineY && y <= lineY + lineThick && x >= lineLeft && x <= lineRight) {
    return [BLUE[0], BLUE[1], BLUE[2], 255];
  }

  // Viền tròn nhẹ
  if (dist > r - 1.5) {
    return [60, 60, 80, 255];
  }

  return [bgR, bgG, bgB, 255];
}

// ─── Tạo các file icon ──────────────────────────────────────────────────────
const outDir = path.join(__dirname, 'icons');
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
  console.log('📁 Đã tạo thư mục: extension/icons/');
}

const sizes = [16, 48, 128];
for (const size of sizes) {
  const buf = makePNGWithAlpha(size, size, drawIcon);
  const outPath = path.join(outDir, `icon${size}.png`);
  fs.writeFileSync(outPath, buf);
  console.log(`✅ Đã tạo icon${size}.png (${buf.length} bytes)`);
}

console.log('\n🎉 Hoàn tất! Tất cả icon đã được tạo trong thư mục extension/icons/');
console.log('👉 Tiếp theo: Vào chrome://extensions → Load unpacked → Chọn thư mục extension/');

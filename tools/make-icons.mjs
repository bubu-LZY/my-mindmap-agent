// 生成带白色圆角方框的应用图标
// 用法: node tools/make-icons.mjs
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import pngToIco from 'png-to-ico';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SRC = ''; // TODO: 放置你的图标源图片（圆角矩形 PNG）绝对路径，留空则跳过图标生成
const OUT_DIR = path.join(ROOT, 'electron', 'icons');

const CANVAS = 256;               // 主图尺寸
const RADIUS = Math.round(CANVAS * 0.22); // 圆角半径 ≈ 56px
const ICON_RATIO = 0.78;          // 图标占画布比例
const ICON_SIZE = Math.round(CANVAS * ICON_RATIO); // ≈ 200px

async function main() {
  if (!fs.existsSync(OUT_DIR)) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
  }

  // 1. 白色圆角矩形背景
  const bgSvg = Buffer.from(
    `<svg width="${CANVAS}" height="${CANVAS}" xmlns="http://www.w3.org/2000/svg">` +
    `<rect x="0" y="0" width="${CANVAS}" height="${CANVAS}" rx="${RADIUS}" ry="${RADIUS}" fill="#ffffff"/>` +
    `</svg>`
  );

  // 2. 将图标缩放到 ICON_SIZE 并居中
  const iconBuf = await sharp(SRC)
    .resize(ICON_SIZE, ICON_SIZE, { fit: 'contain' })
    .png()
    .toBuffer();

  const offset = Math.round((CANVAS - ICON_SIZE) / 2);

  // 3. 合成: 白色圆角底 + 居中图标
  const composed = await sharp(bgSvg)
    .composite([{ input: iconBuf, left: offset, top: offset }])
    .png()
    .toBuffer();

  // 4. 生成多尺寸 PNG
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const pngFiles = [];
  for (const s of sizes) {
    const out = path.join(OUT_DIR, `icon-${s}.png`);
    await sharp(composed).resize(s, s).png().toFile(out);
    pngFiles.push(out);
  }

  // 5. 输出主 PNG 与托盘 PNG
  const mainPng = path.join(OUT_DIR, 'icon.png');
  const trayPng = path.join(OUT_DIR, 'tray-32.png');
  await sharp(composed).resize(256, 256).png().toFile(mainPng);
  await sharp(composed).resize(32, 32).png().toFile(trayPng);

  // 6. 生成 .ico
  const icoInputs = sizes.map((s) => path.join(OUT_DIR, `icon-${s}.png`));
  const icoBuf = await pngToIco(icoInputs);
  const icoPath = path.join(OUT_DIR, 'icon.ico');
  fs.writeFileSync(icoPath, icoBuf);

  // 清理中间尺寸文件
  for (const f of pngFiles) {
    fs.unlinkSync(f);
  }

  console.log('✅ 图标生成完成:');
  console.log('  ' + mainPng);
  console.log('  ' + trayPng);
  console.log('  ' + icoPath);
}

main().catch((err) => {
  console.error('❌ 图标生成失败:', err);
  process.exit(1);
});

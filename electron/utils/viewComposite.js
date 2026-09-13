'use strict'
/**
 * 原生子视图合成。
 *
 * 主窗口截图（webContents.capturePage）只包含窗口自己的页面内容。用 BrowserView
 * 渲染的东西（例如 DeepSeek 网页版面板）属于另一棵渲染树、由原生层直接画在窗口上，
 * 截图里抓不到 —— 局域网镜像里就会出现「面板框在、里面一片空白」。
 *
 * 这里做两件事：
 * 1) 把 DIP 坐标的视图位置换算成截图里的物理像素位置，并裁掉窗口外的部分；
 * 2) 把子视图自己的截图像素叠进主截图。
 *
 * 坐标换算刻意不依赖 nativeImage.getSize() 的 DIP / 物理像素语义 —— 那套语义在
 * HiDPI 下有歧义（同一个 buffer 既能解读成 2x 逻辑尺寸、也能解读成 1x 物理尺寸），
 * 一旦解读错就会画出错位的画面。这里统一从「像素缓冲区长度 + 已知宽高比」反推物理
 * 尺寸，结果唯一且可验证。
 */

const BYTES_PER_PIXEL = 4

/**
 * 由像素缓冲区长度和已知宽高比反推真实物理像素尺寸。
 *
 * pixels = width * height 且 width / height = dipWidth / dipHeight，
 * 于是 height = sqrt(pixels * dipHeight / dipWidth)。
 *
 * 返回 null 表示数据不自洽（长度不是整数像素、宽高比对不上）。此时宁可放弃合成，
 * 也不要往画面里贴一块错位的图。
 */
function resolvePhysicalSize (byteLength, dipWidth, dipHeight) {
  const pixels = Math.floor((byteLength || 0) / BYTES_PER_PIXEL)
  if (!pixels || !(dipWidth > 0) || !(dipHeight > 0)) return null
  const height = Math.round(Math.sqrt((pixels * dipHeight) / dipWidth))
  if (!(height > 0)) return null
  const width = Math.round(pixels / height)
  if (!(width > 0)) return null
  // 必须正好铺满缓冲区：width * height 就是像素数
  if (width * height !== pixels) return null
  // 宽高比要在取整误差范围内吻合（1px 级别的偏差不该放大成错位）
  const expected = dipWidth / dipHeight
  if (Math.abs(width / height - expected) > expected * 0.02) return null
  return { width, height }
}

/**
 * 计算子视图在主窗口截图里的落脚矩形（物理像素），并裁掉窗口外的部分。
 *
 * baseSize / sourceSize 用物理像素；contentSize / viewBounds 用 DIP
 * （BrowserView 的 bounds 本来就是相对窗口内容区、以 DIP 记的）。
 *
 * 目标宽高直接取子视图截图的物理尺寸，不做缩放：同一块屏幕上主窗口与子视图的缩放比
 * 一致，两者本就该等大，省掉一次重采样也就没有插值误差。
 */
function computePlacement ({ baseSize, contentSize, viewBounds, sourceSize }) {
  if (!baseSize || !contentSize || !viewBounds || !sourceSize) return null
  const baseW = baseSize.width
  const baseH = baseSize.height
  const srcW = sourceSize.width
  const srcH = sourceSize.height
  if (!(baseW > 0) || !(baseH > 0) || !(srcW > 0) || !(srcH > 0)) return null
  if (!(contentSize.width > 0) || !(contentSize.height > 0)) return null
  if (!(viewBounds.width > 0) || !(viewBounds.height > 0)) return null

  const ratioX = baseW / contentSize.width
  const ratioY = baseH / contentSize.height
  const target = {
    x: Math.round(viewBounds.x * ratioX),
    y: Math.round(viewBounds.y * ratioY),
    width: srcW,
    height: srcH
  }

  const left = Math.max(0, target.x)
  const top = Math.max(0, target.y)
  const clip = {
    x: left,
    y: top,
    width: Math.min(baseW, target.x + srcW) - left,
    height: Math.min(baseH, target.y + srcH) - top
  }
  // 完全落在窗口外，或尺寸被裁没了
  if (!(clip.width > 0) || !(clip.height > 0)) return null

  return { target, clip }
}

/**
 * 把若干层子视图位图叠进主截图位图（就地修改 dstBitmap 并返回）。
 *
 * 两者都是 BGRA / 每像素 4 字节。layer = { target, clip, bitmap }，
 * target 为未裁剪的落脚矩形（决定源位图的行跨距），clip 为实际写入区域。
 */
function compositeBitmaps (dstBitmap, baseSize, layers) {
  if (!dstBitmap || !baseSize || !Array.isArray(layers) || !layers.length) return dstBitmap
  const baseW = baseSize.width
  const baseH = baseSize.height
  if (!(baseW > 0) || !(baseH > 0)) return dstBitmap
  const dstStride = baseW * BYTES_PER_PIXEL

  for (const layer of layers) {
    if (!layer || !layer.bitmap || !layer.target || !layer.clip) continue
    const srcStride = layer.target.width * BYTES_PER_PIXEL
    // 源位图必须足够大，否则按行读取会越界
    if (layer.bitmap.length < srcStride * layer.target.height) continue
    const rowBytes = layer.clip.width * BYTES_PER_PIXEL
    if (!(rowBytes > 0)) continue

    for (let row = 0; row < layer.clip.height; row++) {
      const srcRow = layer.clip.y - layer.target.y + row
      if (srcRow < 0) continue
      const srcStart = srcRow * srcStride + (layer.clip.x - layer.target.x) * BYTES_PER_PIXEL
      const dstStart = (layer.clip.y + row) * dstStride + layer.clip.x * BYTES_PER_PIXEL
      if (srcStart < 0) continue
      if (srcStart + rowBytes > layer.bitmap.length) continue
      if (dstStart < 0 || dstStart + rowBytes > dstBitmap.length) continue
      layer.bitmap.copy(dstBitmap, dstStart, srcStart, srcStart + rowBytes)
    }
  }

  return dstBitmap
}

/**
 * 在一组矩形（DIP，相对窗口内容区）里找出包含指定点的那一个，返回下标；没命中返回 -1。
 *
 * 后添加的视图画在上面，所以从后往前找。远程输入路由靠它决定「这一下点在了哪个面」——
 * 点在主窗口页面上就注入主窗口，点在原生子视图上就必须注入那个子视图，
 * 否则面板看得见却点不动。矩形传 null（视图已销毁）会被跳过。
 */
function pickTopmostIndexAtPoint (rects, x, y) {
  if (!Array.isArray(rects)) return -1
  if (!Number.isFinite(x) || !Number.isFinite(y)) return -1
  for (let i = rects.length - 1; i >= 0; i--) {
    const r = rects[i]
    if (!r) continue
    if (!(r.width > 0) || !(r.height > 0)) continue
    // 右/下边界取开区间，避免相邻两个面在边界线上同时命中
    if (x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height) return i
  }
  return -1
}

module.exports = {
  BYTES_PER_PIXEL,
  resolvePhysicalSize,
  computePlacement,
  compositeBitmaps,
  pickTopmostIndexAtPoint
}
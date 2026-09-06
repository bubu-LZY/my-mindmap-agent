<template>
  <!-- 截图选区遮罩（覆盖整个应用窗口） -->
  <Teleport to="body">
    <div
      v-if="capturing"
      class="ocr-shot-mask"
      @mousedown="onMaskMouseDown"
      @mousemove="onMaskMouseMove"
      @mouseup="onMaskMouseUp"
    >
      <img v-if="bgImage" :src="bgImage" class="ocr-shot-bg" draggable="false" />
      <div
        v-if="selection"
        class="ocr-shot-sel"
        :style="selStyle"
      ></div>
      <div class="ocr-shot-toolbar" @mousedown.stop @mouseup.stop @click.stop>
        <span class="ocr-shot-hint">拖拽框选要识别的区域，松手自动识别</span>
        <button class="ocr-shot-cancel" @click="cancelCapture">取消</button>
      </div>
    </div>
  </Teleport>

  <!-- OCR 结果悬浮窗 -->
  <Teleport to="body">
    <Transition name="ocr-result">
      <div v-if="resultVisible" class="ocr-result-panel">
        <div class="ocr-result-header">
          <span class="ocr-result-title">识别结果</span>
          <button class="ocr-result-close" @click="resultVisible = false">✕</button>
        </div>
        <div class="ocr-result-body">
          <div v-if="resultLoading" class="ocr-result-loading">识别中，请稍候…</div>
          <textarea
            v-else
            class="ocr-result-text"
            :value="resultText"
            readonly
            spellcheck="false"
          ></textarea>
        </div>
        <div class="ocr-result-footer">
          <button class="ocr-result-btn" @click="recapture">重新截图</button>
          <button class="ocr-result-btn primary" :disabled="!resultText" @click="copyResult">一键复制</button>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { ref, computed, onBeforeUnmount } from 'vue'
import { ElMessage } from 'element-plus'

const capturing = ref(false)
const bgImage = ref('')
const bgW = ref(0)
const bgH = ref(0)
const selection = ref(null) // { x1, y1, x2, y2 } CSS 坐标（相对视口）
let dragStart = null

const resultVisible = ref(false)
const resultLoading = ref(false)
const resultText = ref('')

const selStyle = computed(() => {
  if (!selection.value) return {}
  const s = selection.value
  const left = Math.min(s.x1, s.x2)
  const top = Math.min(s.y1, s.y2)
  const w = Math.abs(s.x2 - s.x1)
  const h = Math.abs(s.y2 - s.y1)
  return {
    left: left + 'px',
    top: top + 'px',
    width: w + 'px',
    height: h + 'px'
  }
})

// 进入截图模式
const startCapture = async () => {
  try {
    const r = await window.electronAPI?.captureWindow?.()
    if (!r || !r.success) {
      ElMessage.error('截图失败：' + (r?.error || '无法捕获窗口'))
      return
    }
    bgImage.value = r.dataUrl
    bgW.value = r.width
    bgH.value = r.height
    selection.value = null
    dragStart = null
    resultVisible.value = false
    capturing.value = true
  } catch (e) {
    ElMessage.error('截图失败：' + (e?.message || e))
  }
}

const cancelCapture = () => {
  capturing.value = false
  bgImage.value = ''
  selection.value = null
  dragStart = null
}

// 拖拽选区
const onMaskMouseDown = (e) => {
  if (e.button !== 0) return
  dragStart = { x: e.clientX, y: e.clientY }
  selection.value = { x1: e.clientX, y1: e.clientY, x2: e.clientX, y2: e.clientY }
}

const onMaskMouseMove = (e) => {
  if (!dragStart) return
  selection.value = { x1: dragStart.x, y1: dragStart.y, x2: e.clientX, y2: e.clientY }
}

const onMaskMouseUp = async (e) => {
  if (!dragStart || !selection.value) return
  const s = selection.value
  const w = Math.abs(s.x2 - s.x1)
  const h = Math.abs(s.y2 - s.y1)
  dragStart = null
  // 选区过小视为误触，忽略
  if (w < 10 || h < 10) {
    selection.value = null
    return
  }
  // 裁剪并识别
  await cropAndOcr(s)
}

// 裁剪选区 → 内置 OCR（tesseract，不走多模态）
const cropAndOcr = async (s) => {
  capturing.value = false
  const img = new Image()
  img.src = bgImage.value
  await new Promise((resolve, reject) => {
    img.onload = resolve
    img.onerror = reject
  })
  // 截图是物理像素，视口是 CSS 像素：按比例换算裁剪坐标
  const scale = bgW.value && window.innerWidth ? bgW.value / window.innerWidth : 1
  const sx = Math.min(s.x1, s.x2) * scale
  const sy = Math.min(s.y1, s.y2) * scale
  const sw = Math.abs(s.x2 - s.x1) * scale
  const sh = Math.abs(s.y2 - s.y1) * scale

  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(sw))
  canvas.height = Math.max(1, Math.round(sh))
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)

  // 提准预处理：小图放大到目标宽度（tesseract 对 ~3000px 内的图识别率更高），并转灰度
  const TARGET_W = 2400
  let src = canvas
  if (sw < TARGET_W) {
    const up = document.createElement('canvas')
    const ratio = Math.min(3, TARGET_W / Math.max(1, sw))
    up.width = Math.round(canvas.width * ratio)
    up.height = Math.round(canvas.height * ratio)
    const uctx = up.getContext('2d')
    uctx.imageSmoothingEnabled = true
    uctx.imageSmoothingQuality = 'high'
    uctx.fillStyle = '#fff'
    uctx.fillRect(0, 0, up.width, up.height)
    uctx.drawImage(canvas, 0, 0, up.width, up.height)
    src = up
  }
  // 灰度化提升对比度，减少彩色背景对 OCR 的干扰
  const gray = document.createElement('canvas')
  gray.width = src.width
  gray.height = src.height
  const gctx = gray.getContext('2d')
  gctx.drawImage(src, 0, 0)
  const imageData = gctx.getImageData(0, 0, gray.width, gray.height)
  const d = imageData.data
  for (let i = 0; i < d.length; i += 4) {
    const v = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
    d[i] = d[i + 1] = d[i + 2] = v
  }
  gctx.putImageData(imageData, 0, 0)

  const dataUrl = gray.toDataURL('image/png')
  const base64 = dataUrl.split(',')[1]

  resultVisible.value = true
  resultLoading.value = true
  resultText.value = ''
  try {
    const res = await window.electronAPI?.ocrBase64?.(base64, 'chi_sim+eng')
    if (res && res.success && res.text) {
      resultText.value = res.text.trim()
    } else {
      resultText.value = ''
      ElMessage.warning('未识别到文字：' + (res?.error || '该区域可能没有文字'))
    }
  } catch (e) {
    resultText.value = ''
    ElMessage.error('识别失败：' + (e?.message || e))
  } finally {
    resultLoading.value = false
  }
}

const recapture = () => {
  resultVisible.value = false
  resultText.value = ''
  startCapture()
}

// 复制结果
const copyResult = async () => {
  if (!resultText.value) return
  try {
    await navigator.clipboard.writeText(resultText.value)
  } catch {
    const ta = document.createElement('textarea')
    ta.value = resultText.value
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
  }
  ElMessage.success('已复制识别文字')
}

// 暴露给父组件（顶栏按钮触发）
defineExpose({ startCapture })

onBeforeUnmount(() => {
  cancelCapture()
})
</script>

<style>
.ocr-shot-mask {
  position: fixed;
  inset: 0;
  z-index: 9998;
  background: rgba(0, 0, 0, 0.55);
  cursor: crosshair;
  user-select: none;
}
.ocr-shot-bg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: fill;
  pointer-events: none;
}
.ocr-shot-sel {
  position: absolute;
  border: 2px solid #409eff;
  background: rgba(64, 158, 255, 0.12);
  box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.4);
  pointer-events: none;
}
.ocr-shot-toolbar {
  position: fixed;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 8px 16px;
  background: rgba(0, 0, 0, 0.75);
  border-radius: 8px;
  color: #fff;
  font-size: 13px;
  z-index: 9999;
}
.ocr-shot-cancel {
  padding: 4px 14px;
  border: 1px solid rgba(255, 255, 255, 0.4);
  background: transparent;
  color: #fff;
  border-radius: 5px;
  cursor: pointer;
  font-size: 12px;
}
.ocr-shot-cancel:hover {
  background: rgba(255, 255, 255, 0.15);
}

/* 结果悬浮窗 */
.ocr-result-panel {
  position: fixed;
  right: 24px;
  bottom: 24px;
  z-index: 10001;
  width: 360px;
  max-width: calc(100vw - 48px);
  max-height: 70vh;
  display: flex;
  flex-direction: column;
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.22);
  overflow: hidden;
}
.ocr-result-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid #ebeef5;
}
.ocr-result-title {
  font-size: 14px;
  font-weight: 600;
  color: #303133;
}
.ocr-result-close {
  border: none;
  background: transparent;
  font-size: 16px;
  color: #909399;
  cursor: pointer;
}
.ocr-result-body {
  padding: 12px 16px;
  overflow: auto;
  flex: 1;
}
.ocr-result-loading {
  color: #909399;
  font-size: 13px;
  padding: 12px 0;
}
.ocr-result-text {
  width: 100%;
  box-sizing: border-box;
  min-height: 120px;
  max-height: 40vh;
  border: 1px solid #e4e7ed;
  border-radius: 6px;
  padding: 10px 12px;
  font-size: 13px;
  line-height: 1.7;
  color: #303133;
  resize: vertical;
  outline: none;
  background: #fafbfc;
  font-family: inherit;
}
.ocr-result-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 12px 16px;
  border-top: 1px solid #ebeef5;
}
.ocr-result-btn {
  padding: 6px 16px;
  border: 1px solid #dcdfe6;
  background: #fff;
  border-radius: 6px;
  font-size: 13px;
  color: #606266;
  cursor: pointer;
}
.ocr-result-btn.primary {
  border: none;
  background: #409eff;
  color: #fff;
}
.ocr-result-btn.primary:hover {
  background: #66b1ff;
}
.ocr-result-btn.primary:disabled {
  background: #a0cfff;
  cursor: not-allowed;
}

.ocr-result-enter-active,
.ocr-result-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.ocr-result-enter-from,
.ocr-result-leave-to {
  opacity: 0;
  transform: translateY(12px);
}
</style>

<template>
  <div class="doc-viewer" v-loading="loading" element-loading-text="文档解析中…">
    <div class="doc-toolbar">
      <span class="doc-title">{{ fileName }}</span>
      <span class="doc-meta" v-if="metaText">{{ metaText }}</span>
      <div class="doc-spacer"></div>
      <template v-if="docType === 'md' && !error">
        <el-button size="small" @click="mdViewMode = 'source'" :type="mdViewMode === 'source' ? 'primary' : ''">源码</el-button>
        <el-button size="small" @click="mdViewMode = 'rendered'" :type="mdViewMode === 'rendered' ? 'primary' : ''">渲染</el-button>
      </template>
      <template v-if="docType === 'pdf' && !error">
        <span class="pdf-page-indicator">{{ pdfCurrentPage }} / {{ pdfTotalPages }}</span>
        <span class="pdf-goto">
          <input
            class="pdf-goto-input"
            type="number"
            min="1"
            :max="pdfTotalPages"
            v-model="gotoPageInput"
            placeholder="页码"
            @keyup.enter="gotoPage"
          />
          <el-button size="small" @click="gotoPage">跳转</el-button>
        </span>
        <el-button v-if="pdfOutline.length > 0" size="small" @click.stop="outlineVisible = !outlineVisible">
          目录
        </el-button>
        <el-button size="small" :loading="copyingText" @click="copyPdfText">复制文字</el-button>
      </template>
      <template v-if="!error">
        <el-button size="small" @click="zoomDoc(-0.2)" :disabled="zoomScale <= 0.5">缩小</el-button>
        <span class="pdf-page-indicator">{{ Math.round(zoomScale * 100) }}%</span>
        <el-button size="small" @click="zoomDoc(0.2)" :disabled="zoomScale >= 3">放大</el-button>
        <el-button size="small" @click="resetZoom" :disabled="zoomScale === 1 && panX === 0 && panY === 0">重置</el-button>
        <el-button
          size="small"
          :type="panMode ? 'primary' : ''"
          @click="togglePanMode"
          :title="panMode ? '抓手模式已开启：按住左键拖动即可平移' : '开启抓手模式：按住左键拖动即可平移'"
        >抓手</el-button>
      </template>
      <el-button size="small" @click="reload" v-if="!loading">重新解析</el-button>
      <el-button size="small" type="primary" @click="emit('close')">关闭</el-button>
    </div>

    <div
      class="doc-body"
      ref="docBodyRef"
      v-if="!error"
      :class="{ 'is-pan-mode': panMode, 'is-panning': panning }"
      @contextmenu.prevent
      @wheel="onWheel"
      @scroll="onPdfScroll"
      @mousedown="onMouseDown"
      @mousemove="onMouseMove"
      @mouseup="onMouseUp"
      @mouseleave="onMouseLeave"
    >
      <!-- 跳转定位指示条：固定在视口顶部，跳转后闪烁，精确指示跳转位置（而非整页/整文档外框） -->
      <div v-if="locateFlash" class="doc-locate-bar"></div>
      <div class="doc-zoom-wrapper" :style="{ minHeight: zoomSpacerH }">
        <div class="doc-zoom-content" ref="zoomContentRef" :style="{ transform: `translate(${panX}px, ${panY}px) scale(${zoomScale})`, transformOrigin: 'top center' }">
          <div v-if="docType === 'md' && mdViewMode === 'rendered'" class="md-preview doc-html" v-html="html"></div>
          <pre v-else-if="docType === 'md'" class="text-preview">{{ text }}</pre>
          <div v-else-if="docType === 'docx' || docType === 'xlsx' || docType === 'xls' || docType === 'csv'" class="doc-html" v-html="html"></div>
          <div v-else-if="docType === 'pdf'" class="pdf-preview">
            <div
              v-for="p in pdfPages"
              :key="p.num"
              class="pdf-page-wrap"
              :data-page="p.num"
              :style="{ width: p.width + 'px', height: p.height + 'px' }"
            ></div>
          </div>
          <pre v-else-if="text" class="text-preview">{{ text }}</pre>
        </div>
      </div>
    </div>
    <div class="doc-error" v-else>
      <p>{{ error }}</p>
      <p class="doc-error-hint" v-if="errorHint">{{ errorHint }}</p>
    </div>
  </div>

  <!-- 文档空白处右键：AI 转换为思维导图 / 添加标签 -->
  <div
    v-if="ctxMenuVisible"
    class="doc-ctx-menu"
    :style="{ left: ctxMenuPos.x + 'px', top: ctxMenuPos.y + 'px' }"
  >
    <div v-if="ctxSelectionText" class="doc-ctx-item" @click="onAddToChat">
      <svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M17 9.5a5.5 5.5 0 0 1-5.5 5.5c-.7 0-1.4-.1-2-.4L5 16l.9-3.1A5.5 5.5 0 1 1 17 9.5z" />
      </svg>
      添加到 AI 助手对话框
    </div>
    <div class="doc-ctx-item" @click="onAddTag">
      <svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M16.5 3.5l-2-2-8 8-1.2 3.2 3.2-1.2 8-8z" />
        <path d="M12.5 3.5l2 2" />
      </svg>
      添加标签
    </div>
    <div class="doc-ctx-item" @click="onConvertToMindmap">
      <svg viewBox="0 0 20 20" width="14" height="14" fill="none">
        <path d="M10 3.5a1.5 1.5 0 100 3 1.5 1.5 0 000-3zM4 14a1.5 1.5 0 100 3 1.5 1.5 0 000-3zm12 0a1.5 1.5 0 100 3 1.5 1.5 0 000-3zM10 7v3.5m0 0H4m6 0h6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
      AI 转换为思维导图
    </div>
  </div>

  <!-- PDF 目录下拉 -->
  <div v-if="outlineVisible && pdfOutline.length > 0" class="pdf-outline-panel" @click.stop>
    <div class="pdf-outline-header">
      <span>目录</span>
      <button class="pdf-outline-close" @click="outlineVisible = false">✕</button>
    </div>
    <div class="pdf-outline-list">
      <div
        v-for="(item, i) in visibleOutline"
        :key="item.uid || i"
        class="pdf-outline-item"
        :style="{ paddingLeft: (12 + item.depth * 16) + 'px' }"
        :class="{ 'has-page': item.page != null }"
        @click="onOutlineClick(item)"
      >
        <span class="pdf-outline-toggle" @click.stop="toggleOutlineNode(item)">
          {{ item.hasChildren ? (collapsedOutlineUids.has(item.uid) ? '▶' : '▼') : '' }}
        </span>
        <span class="pdf-outline-title">{{ item.title }}</span>
        <span v-if="item.page != null" class="pdf-outline-page">{{ item.page }}</span>
      </div>
      <div v-if="pdfOutline.length === 0" class="pdf-outline-empty">无目录</div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, onBeforeUnmount, nextTick, computed } from 'vue'
import { ElMessage } from 'element-plus'
import { parseDocument, chunkText } from '../services/docParseService'
import { renderMarkdown } from '../utils/markdownRenderer'
import { sanitizeSafeHtml } from '../utils/sanitizeHtml'
import { searchService } from '../services/searchService'
import { warmLocalDocTextCache } from '../services/toolHandler'

const props = defineProps({
  visible: { type: Boolean, default: false },
  filePath: { type: String, default: '' },
  fileName: { type: String, default: '' }
})
const emit = defineEmits(['close', 'convert-mindmap', 'add-tag', 'add-to-chat'])

const loading = ref(false)
const error = ref('')
const errorHint = ref('')
const docType = ref('')
const text = ref('')
const html = ref('')
const metaText = ref('')
const mdViewMode = ref('source')

const pdfPage = ref(1)
const pdfTotalPages = ref(0)
const gotoPageInput = ref('')
const copyingText = ref(false)
// 按页文本缓存（供「复制文字」使用；indexPdfText 后台填充）
const pdfPageTexts = ref({})
// 连续滚动：所有页占位数据 { num, width, height }
const pdfPages = ref([])
// 当前可视页（滚动时更新，用于顶部页码指示）
const pdfCurrentPage = ref(1)
// PDF 目录（getOutline）：[{ title, page, items: [...] }]
const pdfOutline = ref([])
const outlineVisible = ref(false)
// 目录折叠状态：被折叠节点的 uid 集合（默认只展开前 2 层，避免"很多目录"平铺观感）
const collapsedOutlineUids = ref(new Set())
const toggleOutlineNode = (item) => {
  if (!item.hasChildren) return
  const s = new Set(collapsedOutlineUids.value)
  if (s.has(item.uid)) s.delete(item.uid)
  else s.add(item.uid)
  collapsedOutlineUids.value = s
}
// 可见的目录扁平列表（带深度），跳过被折叠节点的子层级
const visibleOutline = computed(() => {
  const out = []
  const walk = (items) => {
    for (const it of items) {
      out.push(it)
      if (it.items?.length && !collapsedOutlineUids.value.has(it.uid)) walk(it.items)
    }
  }
  walk(pdfOutline.value)
  return out
})
// 每页渲染状态（canvas 是否已渲染 / 是否在渲染中）
const pdfRenderedPages = new Set()
const pdfRenderingPages = new Set()
// 每页 canvas / textLayer DOM 引用（懒渲染 + 离屏回收）
const pdfCanvasEls = new Map()
const pdfTextEls = new Map()
// 连续滚动渲染宽度（CSS px），页面按此宽度等比渲染
const PDF_PAGE_WIDTH = 900
const zoomScale = ref(1)
const zoomContentRef = ref(null)
const zoomSpacerH = ref('auto')
// 平移（pan）：放大后可按住右键拖动（或抓手模式下按住左键拖动）自由查看文档各处
const panX = ref(0)
const panY = ref(0)
const panMode = ref(false)   // 抓手/平移模式开关（方案C）
const panning = ref(false)   // 正在拖拽平移中（用于光标样式）
const docBodyRef = ref(null) // 文档滚动容器（记录/恢复滚动位置）
let pdfDoc = null

const PDF_DOC_EXTS = ['pdf']

// ============ 右键菜单：任意文档 → AI 转换为思维导图 ============
const ctxMenuVisible = ref(false)
const ctxMenuPos = ref({ x: 0, y: 0 })
const ctxSelectionText = ref('') // 右键时选中的文字（用于「添加到 AI 助手对话框」）

// 右键原地点击（未拖动）→ 弹出转换菜单；拖动 → 平移。菜单改在 mouseup 时判定是否弹出
const openContextMenu = (x, y) => {
  if (error.value || !docType.value) return // 有错误/未加载完成时不显示（无内容可转换）
  // 捕获当前选中的文字（若有），供「添加到 AI 助手对话框」菜单项使用
  try {
    const sel = window.getSelection()
    ctxSelectionText.value = sel ? String(sel.toString() || '').trim() : ''
  } catch { ctxSelectionText.value = '' }
  ctxMenuVisible.value = true
  ctxMenuPos.value = { x, y }
}

const closeCtxMenu = () => { ctxMenuVisible.value = false }

const onDocClick = () => { if (ctxMenuVisible.value) closeCtxMenu(); if (outlineVisible.value) outlineVisible.value = false }

const onConvertToMindmap = () => {
  closeCtxMenu()
  emit('convert-mindmap', { filePath: props.filePath, fileName: props.fileName })
}

// 添加标签：记录当前位置（PDF 页码 / 其他文档滚动位置）交给父组件弹窗
const onAddTag = () => {
  const pos = { x: ctxMenuPos.value.x, y: ctxMenuPos.value.y }
  closeCtxMenu()
  let page = null
  let scrollTop = null
  if (docType.value === 'pdf') {
    page = pdfPage.value
  } else {
    scrollTop = docBodyRef.value?.scrollTop ?? 0
  }
  emit('add-tag', {
    filePath: props.filePath,
    fileName: props.fileName,
    fileType: docType.value,
    page,
    scrollTop,
    pos
  })
}

// 将选中的文字添加到 AI 助手对话框（以引用参考资料原子对象呈现）
const onAddToChat = () => {
  const text = ctxSelectionText.value
  closeCtxMenu()
  if (!text) return
  emit('add-to-chat', { text, fileName: props.fileName, filePath: props.filePath })
}

// 外部跳转（标签模式点击标签定位）：PDF 跳到指定页，其他文档恢复到指定滚动位置
// 文档尚未加载完成时先暂存，加载完成后自动应用
let pendingJump = null
// 跳转定位指示条：固定在视口顶部闪烁，精确指示跳转位置
const locateFlash = ref(false)
let locateFlashTimer = null
const flashLocate = () => {
  locateFlash.value = true
  if (locateFlashTimer) clearTimeout(locateFlashTimer)
  locateFlashTimer = setTimeout(() => { locateFlash.value = false }, 1600)
}

const applyJump = ({ page, scrollTop } = {}) => {
  if (docType.value === 'pdf') {
    // 页面占位（pdfPages）可能尚未填充完成，此时暂存待加载完成后重试
    if (!pdfPages.value.length) {
      pendingJump = { page, scrollTop }
      return
    }
    if (page != null && page >= 1 && page <= pdfTotalPages.value) {
      pdfPage.value = page
      pdfCurrentPage.value = page
      // 等页面占位挂载后滚动到指定页，并用定位条闪烁指示位置
      nextTick(() => {
        scrollToPage(page, { flash: false })
        // 确保目标页已渲染（懒渲染）
        renderPdfPage(page)
        flashLocate()
      })
    }
  } else if (scrollTop != null) {
    nextTick(() => {
      if (docBodyRef.value) docBodyRef.value.scrollTop = scrollTop
      flashLocate()
    })
  }
}
const jumpTo = ({ page, scrollTop } = {}) => {
  if (!docType.value) {
    pendingJump = { page, scrollTop }
    return
  }
  applyJump({ page, scrollTop })
}

// ============ 浏览位置缓存（切换文档标签时保留位置，避免重新加载后跳回顶部） ============
// 按 filePath 缓存浏览位置快照：PDF 记页码，其他文档记滚动位置
const viewStateCache = new Map()
let prevFilePath = ''

// 保存当前文件的浏览位置到缓存（在切走/重载前调用）
const captureViewState = () => {
  const fp = prevFilePath || props.filePath
  if (!fp) return
  const state = {
    type: docType.value,
    page: pdfPage.value,
    scrollTop: docBodyRef.value?.scrollTop ?? 0,
    outlineVisible: outlineVisible.value
  }
  viewStateCache.set(fp, state)
}

// 恢复目标文件的浏览位置（在 load 重置状态后、内容渲染完成前调用）
const restoreViewState = (fp) => {
  const state = viewStateCache.get(fp)
  if (!state) return
  // 通过 pendingJump 复用现有定位逻辑：PDF 跳页，文本恢复滚动位置
  pendingJump = {
    page: state.type === 'pdf' ? (state.page ?? null) : null,
    scrollTop: state.type !== 'pdf' ? (state.scrollTop ?? null) : null
  }
}

defineExpose({ jumpTo })

// ============ 平移：方案A（右键拖动）+ 方案C（抓手模式左键拖动）============
let panDrag = null // { button, startX, startY, moved, baseX, baseY }

const onMouseDown = (e) => {
  if (error.value || !docType.value) return
  // 右键拖动 = 平移；左键仅当抓手模式开启时 = 平移（其余左键保留文本选择等默认行为）
  const isRight = e.button === 2
  const isLeftPan = e.button === 0 && panMode.value
  if (!isRight && !isLeftPan) return
  e.preventDefault()
  panDrag = { button: e.button, startX: e.clientX, startY: e.clientY, moved: false, baseX: panX.value, baseY: panY.value }
}

const onMouseMove = (e) => {
  if (!panDrag) return
  const dx = e.clientX - panDrag.startX
  const dy = e.clientY - panDrag.startY
  if (!panDrag.moved) {
    if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return // 未超过阈值，暂不判定为拖动
    panDrag.moved = true
    panning.value = true
  }
  panX.value = panDrag.baseX + dx
  panY.value = panDrag.baseY + dy
}

const onMouseUp = (e) => {
  if (!panDrag) return
  const isRight = panDrag.button === 2
  const moved = panDrag.moved
  panDrag = null
  panning.value = false
  if (isRight && !moved) openContextMenu(e.clientX, e.clientY) // 右键原地点击 → 弹转换菜单
}

const onMouseLeave = () => {
  if (!panDrag) return
  panDrag = null
  panning.value = false
}

const togglePanMode = () => { panMode.value = !panMode.value }

// 加载序号：快速切换文件/重新解析时丢弃过期结果，避免并发加载错乱
let loadToken = 0

const load = async () => {
  if (!props.filePath) return
  const token = ++loadToken
  cleanupPdf() // 销毁旧的 pdfDoc，防止快速切换文件时旧文档并发渲染错乱
  loading.value = true
  error.value = ''
  errorHint.value = ''
  text.value = ''
  html.value = ''
  metaText.value = ''
  docType.value = ''
  mdViewMode.value = 'source'
  pdfPage.value = 1
  pdfTotalPages.value = 0
  gotoPageInput.value = ''
  pdfPageTexts.value = {}
  pdfOutline.value = []
  outlineVisible.value = false
  zoomScale.value = 1
  panX.value = 0
  panY.value = 0
  pendingJump = null
  // 记录当前文件路径，供下次切走时保存浏览位置
  prevFilePath = props.filePath
  // 若此文件之前浏览过，恢复其缓存位置（页码/滚动），避免切回来跳回顶部
  restoreViewState(props.filePath)
  try {
    if (PDF_DOC_EXTS.includes(props.filePath.split('.').pop().toLowerCase())) {
      await loadPdf(token)
      if (token !== loadToken) return // 期间又触发了新加载，丢弃本次结果
      if (pendingJump) { const j = pendingJump; pendingJump = null; applyJump(j) }
      indexInBackground(undefined, token)
      return
    }
    const res = await parseDocument(props.filePath)
    if (token !== loadToken) return // 丢弃过期结果
    if (!res.success) {
      error.value = res.error || '解析失败'
      return
    }
    docType.value = res.type
    if (res.type === 'md') {
      html.value = sanitizeSafeHtml(renderMarkdown(res.text))
      text.value = res.text
    } else if (res.type === 'docx' || res.type === 'xlsx' || res.type === 'xls' || res.type === 'csv') {
      html.value = sanitizeSafeHtml(res.html || '')
    } else {
      text.value = res.text
    }
    metaText.value = buildMeta(res.meta, res.type)
    if (pendingJump) { const j = pendingJump; pendingJump = null; applyJump(j) }
    // 预热缓存：Agent 后续 read_local_file / retrieve_local_file 命中缓存，无需重新解析全文
    warmLocalDocTextCache(props.filePath, res.type, res.text, res.meta)
    indexInBackground(res.text, token)
  } catch (e) {
    if (token !== loadToken) return
    error.value = '打开文档失败：' + (e?.message || e)
  } finally {
    if (token === loadToken) {
      loading.value = false
      nextTick(updateZoomSpacer)
    }
  }
}

const buildMeta = (meta = {}, type) => {
  const parts = []
  if (meta.pages) parts.push(`${meta.pages} 页`)
  if (meta.sheets) parts.push(`${meta.sheets} 个工作表 / ${meta.rows} 行`)
  if (meta.slides) parts.push(`${meta.slides} 张幻灯片`)
  if (meta.rows && type === 'csv') parts.push(`${meta.rows} 行`)
  if (meta.chars) parts.push(`${formatNum(meta.chars)} 字符`)
  const typeNames = { pdf: 'PDF', docx: 'Word', pptx: 'PPT', xlsx: 'Excel', xls: 'Excel（旧版）', csv: 'CSV', md: 'Markdown', text: '文本' }
  return parts.length ? `${typeNames[type] || '文档'} · ${parts.join(' · ')}` : ''
}

const formatNum = (n) => n >= 10000 ? (n / 10000).toFixed(1) + ' 万' : String(n)

// PDF 原样渲染（含扫描版）：pdfjs-dist 连续滚动，逐页懒渲染 canvas + 文本层（可选中复制）
let pdfjsLib = null
const loadPdf = async (token) => {
  const bin = await window.electronAPI.fs.readBinary(props.filePath)
  if (token !== loadToken) return
  if (!bin.success) throw new Error(bin.error)
  const buf = bin.data instanceof Uint8Array
    ? bin.data
    : bin.data
      ? new Uint8Array(bin.data)
      : Uint8Array.from(atob(bin.base64 || ''), c => c.charCodeAt(0))
  pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const workerUrl = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl
  let doc = null
  try {
    doc = await pdfjsLib.getDocument({
      data: buf,
      cMapUrl: 'https://unpkg.com/pdfjs-dist@4.10.38/cmaps/',
      cMapPacked: true
    }).promise
  } catch (e) {
    if (token !== loadToken) return
    if (e?.name === 'PasswordException' || /password/i.test(String(e?.message || ''))) {
      error.value = '该 PDF 已加密，无法查看'
      errorHint.value = '请先在 PDF 阅读器中解除密码后再打开。'
      return
    }
    throw e
  }
  if (token !== loadToken) { try { doc.destroy() } catch {} return }
  pdfDoc = doc
  pdfTotalPages.value = pdfDoc.numPages || 0
  docType.value = 'pdf'
  metaText.value = `PDF · ${pdfTotalPages.value} 页`
  pdfPage.value = 1
  pdfCurrentPage.value = 1
  pdfPages.value = []
  pdfRenderedPages.clear()
  pdfRenderingPages.clear()
  pdfCanvasEls.clear()
  pdfTextEls.clear()

  // 逐页取 viewport 尺寸（并发分批），按固定宽度等比换算占位高度
  const pageCount = pdfTotalPages.value
  const sizes = new Array(pageCount + 1).fill(null)
  let firstBaseW = 1
  const BATCH = 6
  for (let s = 1; s <= pageCount; s += BATCH) {
    if (token !== loadToken) return
    const batch = []
    for (let i = s; i < Math.min(s + BATCH, pageCount + 1); i++) {
      batch.push((async () => {
        const page = await pdfDoc.getPage(i)
        try {
          const base = page.getViewport({ scale: 1 })
          if (i === 1) firstBaseW = base.width || 1
          const scale = PDF_PAGE_WIDTH / (base.width || 1)
          const vp = page.getViewport({ scale })
          sizes[i] = { width: Math.floor(vp.width), height: Math.floor(vp.height), scale }
        } finally {
          try { page.cleanup() } catch {}
        }
      })())
    }
    await Promise.all(batch)
  }
  if (token !== loadToken) return
  pdfPages.value = sizes.slice(1).map((s, idx) => ({
    num: idx + 1,
    width: s?.width || PDF_PAGE_WIDTH,
    height: s?.height || Math.round(PDF_PAGE_WIDTH * 1.414),
    scale: s?.scale || (PDF_PAGE_WIDTH / firstBaseW)
  }))

  // 加载 PDF 目录（书签/大纲），供点击跳转页码
  loadPdfOutline(token)

  // 等 DOM 挂载后设置懒渲染监听 + 渲染首屏
  await nextTick()
  setupPdfObserver()
  // 延迟后台预提取文本层（不阻塞渲染）：写入缓存 + 索引知识库，让 Agent 后续读取命中缓存变快
  setTimeout(() => { if (token === loadToken) indexPdfText(token) }, 600)
}

// 解析 PDF 目录（getOutline），把目标解析为页码（getDestination → getPageIndex）
const loadPdfOutline = async (token) => {
  pdfOutline.value = []
  if (!pdfDoc || token !== loadToken) return
  try {
    const outline = await pdfDoc.getOutline()
    if (!Array.isArray(outline)) return
    const resolvePage = async (dest) => {
      try {
        if (!dest) return null
        const explicit = Array.isArray(dest) ? dest[0] : dest
        if (typeof explicit === 'string') {
          const named = await pdfDoc.getDestination(explicit)
          if (named) {
            const idx = await pdfDoc.getPageIndex(named[0])
            return idx + 1
          }
          return null
        }
        const idx = await pdfDoc.getPageIndex(explicit)
        return idx + 1
      } catch { return null }
    }
    let uidCounter = 0
    const mapItems = async (items, depth = 0) => {
      const out = []
      for (const it of items) {
        const page = await resolvePage(it.dest)
        const uid = 'o' + (++uidCounter)
        const children = it.items?.length ? await mapItems(it.items, depth + 1) : []
        out.push({
          uid,
          title: String(it.title || '未命名'),
          page,
          depth,
          hasChildren: children.length > 0,
          items: children
        })
        if (token !== loadToken) return out
      }
      return out
    }
    pdfOutline.value = await mapItems(outline, 0)
  } catch { /* 目录解析失败不影响查看 */ }
}

// 渲染单页：canvas 画页面 + 文本层（透明文字，可选中复制）
const renderPdfPage = async (num) => {
  if (!pdfDoc || !pdfjsLib) return
  if (pdfRenderedPages.has(num) || pdfRenderingPages.has(num)) return
  const wrap = docBodyRef.value?.querySelector(`.pdf-page-wrap[data-page="${num}"]`)
  if (!wrap) return
  pdfRenderingPages.add(num)
  let page = null
  try {
    page = await pdfDoc.getPage(num)
    const meta = pdfPages.value[num - 1] || { scale: 1 }
    const viewport = page.getViewport({ scale: meta.scale })
    // 高 DPI 屏幕按 1.5 倍封顶，避免 2x/3x 下 canvas 像素数量成倍放大导致内存暴涨
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5)

    // canvas
    let canvas = pdfCanvasEls.get(num)
    if (!canvas) {
      canvas = document.createElement('canvas')
      canvas.className = 'pdf-canvas'
      canvas.style.width = viewport.width + 'px'
      canvas.style.height = viewport.height + 'px'
      wrap.appendChild(canvas)
      pdfCanvasEls.set(num, canvas)
    }
    const pxW = Math.floor(viewport.width * dpr)
    const pxH = Math.floor(viewport.height * dpr)
    if (canvas.width !== pxW) canvas.width = pxW
    if (canvas.height !== pxH) canvas.height = pxH
    const ctx = canvas.getContext('2d')
    await page.render({
      canvasContext: ctx,
      viewport,
      transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null,
      background: '#ffffff'
    }).promise

    // 画布渲染完成立即标记已渲染（不等文本层），避免已显示内容仍被当作未渲染而判定错乱
    pdfRenderedPages.add(num)

    // 文本层（可选中复制文字）
    try {
      let textLayer = pdfTextEls.get(num)
      if (!textLayer) {
        textLayer = document.createElement('div')
        textLayer.className = 'pdf-text-layer'
        wrap.appendChild(textLayer)
        pdfTextEls.set(num, textLayer)
      }
      textLayer.innerHTML = ''
      // TextLayer 依赖 --scale-factor 变量定位文字，必须设置为 viewport.scale（CSS 缩放，不含 dpr），
      // 否则 span 的 fontSize/定位计算错误，导致复制时文字交错重叠
      textLayer.style.setProperty('--scale-factor', String(viewport.scale))
      const textContent = await page.getTextContent()
      const layer = new pdfjsLib.TextLayer({
        textContentSource: textContent,
        container: textLayer,
        viewport
      })
      await layer.render()
      // 缓存该页纯文本（供「复制文字」按钮使用）
      const t = (textContent.items || []).map(it => it.str || '').join(' ')
      if (t.trim()) pdfPageTexts.value[num] = t
    } catch (e) {
      // 文本层失败不影响页面显示（扫描版无文本层）
      const el = pdfTextEls.get(num)
      if (el) { el.innerHTML = '' }
    }
  } catch (e) {
    console.warn('PDF 页面渲染失败:', num, e)
  } finally {
    pdfRenderingPages.delete(num)
    if (page) { try { page.cleanup() } catch {} }
    schedulePdfRecycle()
  }
}

// 回收离屏页面的 canvas/文本层，释放内存（保留占位尺寸）
const recyclePdfPage = (num) => {
  // 正在渲染中的页面跳过回收，避免画布渲染完成时元素已被移除或结果丢失
  if (pdfRenderingPages.has(num)) return
  const canvas = pdfCanvasEls.get(num)
  if (canvas) {
    canvas.width = 0
    canvas.height = 0
    try { canvas.remove() } catch {}
    pdfCanvasEls.delete(num)
  }
  const tl = pdfTextEls.get(num)
  if (tl) {
    try { tl.remove() } catch {}
    pdfTextEls.delete(num)
  }
  pdfRenderedPages.delete(num)
}

// 懒渲染监听：进入视口前后 1 屏的页面渲染，更远的回收
let pdfObserver = null
const setupPdfObserver = () => {
  if (pdfObserver) { try { pdfObserver.disconnect() } catch {} pdfObserver = null }
  const body = docBodyRef.value
  if (!body) return
  pdfObserver = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const num = Number(e.target.dataset.page)
      if (!num) continue
      if (e.isIntersecting) {
        renderPdfPage(num)
      }
    }
  }, { root: body, rootMargin: '1200px 0px 1200px 0px' })
  // 观察所有页面占位，触发懒渲染
  docBodyRef.value?.querySelectorAll('.pdf-page-wrap').forEach(el => pdfObserver.observe(el))
  // 更新当前可视页
  updateCurrentPage()
}

// 滚动时更新当前可视页 + 回收太远的页面
const onPdfScroll = () => {
  if (docType.value !== 'pdf') return
  updateCurrentPage()
  schedulePdfRecycle()
}

let pdfRecycleTimer = null
const schedulePdfRecycle = () => {
  if (pdfRecycleTimer) return
  pdfRecycleTimer = setTimeout(() => {
    pdfRecycleTimer = null
    recycleFarPages()
  }, 300)
}

// 回收距当前可视页超过 ±4 页的已渲染页（内存保护）
const recycleFarPages = () => {
  const cur = pdfCurrentPage.value
  for (const num of [...pdfRenderedPages]) {
    if (Math.abs(num - cur) > 4) recyclePdfPage(num)
  }
}

// 根据滚动位置计算当前可视的第一个页面
const updateCurrentPage = () => {
  const body = docBodyRef.value
  if (!body || !pdfPages.value.length) return
  const wraps = body.querySelectorAll('.pdf-page-wrap')
  const top = body.scrollTop + 100
  let cur = pdfCurrentPage.value
  for (const el of wraps) {
    const num = Number(el.dataset.page)
    // offsetTop 是未缩放的布局坐标，而 scrollTop 与占位高度(zoomSpacerH)同处“视觉/缩放后”坐标系。
    // 必须换算成视觉坐标（宽度 snap 不参与纵向），否则缩小后识别错页，导致真正可见页被回收成空白。
    const off = el.offsetTop * zoomScale.value + panY.value
    if (off <= top) cur = num
    else break
  }
  pdfCurrentPage.value = cur
  pdfPage.value = cur
  // 保底渲染：快速/惯性滚动时 observer 可能来不及触发，主动渲染当前页前后若干页，避免视口出现空白占位
  const from = Math.max(1, cur - 2)
  const to = Math.min(pdfPages.value.length, cur + 2)
  for (let n = from; n <= to; n++) renderPdfPage(n)
}

// 滚动到指定页（手动计算 scrollTop，避免 scrollIntoView 滚动外层容器导致顶部被遮挡）
const scrollToPage = (n, { flash = true } = {}) => {
  const body = docBodyRef.value
  const wrap = body?.querySelector(`.pdf-page-wrap[data-page="${n}"]`)
  if (body && wrap) {
    // 计算 wrap 相对 doc-body 内容顶部的偏移，留 20px 顶部边距，避免被工具栏/边框遮住
    const bodyRect = body.getBoundingClientRect()
    const wrapRect = wrap.getBoundingClientRect()
    const targetScroll = body.scrollTop + (wrapRect.top - bodyRect.top) - 20
    body.scrollTop = Math.max(0, targetScroll)
  }
  if (flash) flashLocate()
}

// 点击目录项跳转
const onOutlineClick = (item) => {
  // 父节点（有子级但无页码）：点击切换折叠/展开，不关闭面板
  if (item.hasChildren && item.page == null) {
    toggleOutlineNode(item)
    return
  }
  if (item.page != null) {
    scrollToPage(item.page)
  }
  outlineVisible.value = false
}

// 后台提取 PDF 文本层用于缓存预热 + 知识库索引（非扫描型 PDF 有文本层，扫描型无文本则跳过）
// 复用 loadPdf 已加载的 pdfDoc，避免二次读文件/二次加载 pdfjs 导致内存翻倍
const indexPdfText = async (token) => {
  if (!pdfDoc || token !== loadToken) return
  try {
    if (!searchService.isAvailable()) return
    const parts = []
    const pageCount = pdfDoc.numPages || 0
    for (let i = 1; i <= pageCount; i++) {
      if (token !== loadToken) return
      if (i % 5 === 0) await new Promise((resolve) => setTimeout(resolve, 0))
      let page
      try {
        page = await pdfDoc.getPage(i)
        const content = await page.getTextContent()
        const t = (content.items || []).map(it => it.str || '').join(' ')
        if (t.trim()) {
          parts.push(t)
          // 超大 PDF 不逐页缓存全部文本，避免内存被 pdfPageTexts 撑高；复制时按需提取。
          if (pageCount <= 120) pdfPageTexts.value[i] = t
        }
      } finally {
        if (page) { try { page.cleanup() } catch {} }
      }
    }
    const fullText = parts.join('\n\n').slice(0, 300000)
    if (fullText.trim() && token === loadToken) {
      warmLocalDocTextCache(props.filePath, 'pdf', fullText, { pages: pageCount })
      indexInBackground(fullText)
    }
  } catch { /* 索引失败不影响查看 */ }
}

// 页码输入跳转（连续滚动：滚动到指定页并闪烁）
const gotoPage = async () => {
  const n = parseInt(gotoPageInput.value, 10)
  if (!n || isNaN(n)) return
  if (n < 1 || n > pdfTotalPages.value) {
    ElMessage.warning(`页码需在 1 ~ ${pdfTotalPages.value} 之间`)
    return
  }
  gotoPageInput.value = ''
  scrollToPage(n)
}

// 复制 PDF 文字：优先用已缓存的文本层；未缓存（如扫描版/尚未提取）时现场提取当前可视页
const copyPdfText = async () => {
  if (!pdfDoc) return
  copyingText.value = true
  const cur = pdfCurrentPage.value || pdfPage.value
  try {
    let text = pdfPageTexts.value[cur] || ''
    if (!text.trim()) {
      // 现场提取当前可视页文本层
      const page = await pdfDoc.getPage(cur)
      try {
        const content = await page.getTextContent()
        text = (content.items || []).map(it => it.str || '').join(' ').trim()
      } finally {
        try { page.cleanup() } catch {}
      }
    }
    if (!text.trim()) {
      ElMessage.warning('当前页没有可复制的文本层（可能是扫描版 PDF）')
      return
    }
    // 复制到剪贴板（Electron 环境优先走 navigator.clipboard，失败降级 execCommand）
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    }
    ElMessage.success(`已复制第 ${cur} 页文字`)
  } catch (e) {
    ElMessage.error('复制失败：' + (e?.message || e))
  } finally {
    copyingText.value = false
  }
}

// 通用缩放（所有文档类型）：CSS transform scale，文字/表格/PDF 画布一起放大缩小
const zoomDoc = (delta) => {
  const next = Math.min(3, Math.max(0.5, zoomScale.value + delta))
  if (next === zoomScale.value) return
  zoomScale.value = next
  // 缩回 100% 及以下时无需平移，位移归零，避免内容残留偏移
  if (next <= 1) { panX.value = 0; panY.value = 0 }
}

const resetZoom = () => {
  zoomScale.value = 1
  panX.value = 0
  panY.value = 0
}

// transform 缩放不改变布局尺寸，缩放后撑开占位高度，保证 doc-body 滚动范围正确
const updateZoomSpacer = () => {
  const el = zoomContentRef.value
  if (!el) return
  zoomSpacerH.value = (el.offsetHeight * zoomScale.value) + 'px'
}
watch(zoomScale, () => nextTick(() => {
  updateZoomSpacer()
  // 缩放后页面视觉位置整体变化，立即重算当前可视页并回收过远页，避免缩小后停留旧页码导致空白
  if (docType.value === 'pdf') {
    updateCurrentPage()
    recycleFarPages()
  }
}))

// 按住 Ctrl（或 Mac 的 Cmd）滚动滚轮时缩放文档（所有文档类型通用）；其余情况保持正常滚动
const onWheel = (e) => {
  if (!e.ctrlKey && !e.metaKey) return
  e.preventDefault()
  const delta = e.deltaY > 0 ? -0.1 : 0.1
  zoomDoc(delta)
}

const reload = () => load()

const cleanupPdf = () => {
  if (pdfObserver) { try { pdfObserver.disconnect() } catch {} pdfObserver = null }
  if (pdfRecycleTimer) { clearTimeout(pdfRecycleTimer); pdfRecycleTimer = null }
  if (locateFlashTimer) { clearTimeout(locateFlashTimer); locateFlashTimer = null }
  locateFlash.value = false
  pdfRenderedPages.clear()
  pdfRenderingPages.clear()
  pdfCanvasEls.clear()
  pdfTextEls.clear()
  if (pdfDoc) { try { pdfDoc.destroy() } catch {} pdfDoc = null }
  pdfjsLib = null
}

// 打开即后台索引进知识库：可被 AI 的 search_knowledge_base / semantic_search 检索到
const indexInBackground = async (fullText, token) => {
  try {
    if (!searchService.isAvailable()) return
    const chunks = chunkText(fullText || text.value)
    if (!chunks.length) return
    // 已切换文件/卸载：跳过后续索引与向量化，避免大文档切换时并发向量化导致卡死/内存暴涨
    if (token !== undefined && token !== loadToken) return
    let mtime = ''
    let fileSize = 0
    if (window.electronAPI?.fs?.stat) {
      const st = await window.electronAPI.fs.stat(props.filePath)
      if (st?.success) {
        mtime = st.mtime
        fileSize = Number(st.size || 0)
      }
    }
    if (token !== undefined && token !== loadToken) return
    const r = await searchService.indexDocument(props.filePath, props.fileName, 'doc', chunks, mtime)
    // 向量化最耗内存：切换文件后不再启动
    if (token !== undefined && token !== loadToken) return
    if (r?.success && !r?.skipped) {
      // 大文档也做向量索引，但改为小批流式写入，避免一次性把全部向量放在内存。
      const text = String(fullText || text.value || '')
      if (text.length <= 1000000 && chunks.length <= 500 && (!fileSize || fileSize <= 40 * 1024 * 1024)) {
        searchService.indexDocumentVectors(props.filePath, props.fileName, mtime, chunks.slice(0, 500))
      }
    }
  } catch { /* 索引失败不影响查看 */ }
}

// 显示状态或文件路径变化时重新加载文档（数组 watch 合并同 tick 变更，避免重复解析）。
// immediate：分屏/切换文件时 DocViewer 因 key 变化会重新挂载，首次挂载即需加载，否则文档空白。
watch([() => props.visible, () => props.filePath], ([visible, fp]) => {
  if (visible && fp) {
    document.removeEventListener('click', onDocClick, true)
    document.addEventListener('click', onDocClick, true)
    // 切换到不同文件时，先把上一个文件的浏览位置存进缓存
    if (prevFilePath && prevFilePath !== fp) captureViewState()
    load()
  } else {
    // 离开文档视图（切到思维导图标签/关闭）前，保存当前浏览位置
    if (props.filePath) captureViewState()
    document.removeEventListener('click', onDocClick, true)
    closeCtxMenu()
    cleanupPdf()
  }
}, { immediate: true })

onBeforeUnmount(() => {
  loadToken++ // 使所有 pending 的后台加载/索引任务失效
  document.removeEventListener('click', onDocClick, true)
  cleanupPdf()
})
</script>

<style>
/* 全局样式：v-html 内容无法用 scoped 覆盖 */
.doc-viewer {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #f5f6f8;
}
.doc-toolbar {
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  gap: 8px;
  padding: 8px 12px;
  background: #fff;
  border-bottom: 1px solid #e4e7ed;
  flex-shrink: 0;
  overflow-x: auto;
  overflow-y: hidden;
}
.doc-title {
  font-size: 14px;
  font-weight: 600;
  color: #303133;
  max-width: 220px;
  min-width: 0;
  flex-shrink: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.doc-meta {
  font-size: 12px;
  color: #909399;
}
.doc-spacer { flex: 1; }
.pdf-page-indicator {
  font-size: 13px;
  color: #606266;
  min-width: 52px;
  text-align: center;
  flex-shrink: 0;
}
.pdf-goto {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}
.pdf-goto-input {
  width: 60px;
  height: 26px;
  padding: 0 8px;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  font-size: 13px;
  text-align: center;
  outline: none;
  box-sizing: border-box;
}
.pdf-goto-input:focus {
  border-color: #409eff;
}
.doc-body {
  flex: 1;
  overflow: auto;
  padding: 24px;
}
.doc-body.is-pan-mode { cursor: grab; user-select: none; }
.doc-body.is-panning { cursor: grabbing; }
/* 跳转定位指示条：sticky 固定在视口顶部，跳转后闪烁指示位置 */
.doc-locate-bar {
  position: sticky;
  top: 0;
  z-index: 5;
  height: 3px;
  margin: -24px -24px 0;
  background: #409eff;
  box-shadow: 0 1px 6px rgba(64, 158, 255, 0.8);
  animation: locate-bar-flash 0.5s ease-in-out 4;
}
@keyframes locate-bar-flash {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.15; }
}
.pdf-preview {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 18px;
  padding-bottom: 40px;
}
.pdf-page-wrap {
  position: relative;
  background: #fff;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.15);
  overflow: hidden;
  transition: box-shadow 0.2s ease;
}
.pdf-canvas {
  display: block;
  width: 100%;
  height: 100%;
  background: #fff;
}
.pdf-text-layer {
  position: absolute;
  inset: 0;
  overflow: hidden;
  text-align: initial;
  line-height: 1;
  text-size-adjust: none;
  forced-color-adjust: none;
  transform-origin: 0 0;
  caret-color: CanvasText;
  z-index: 1;
}
.pdf-text-layer span,
.pdf-text-layer br {
  color: transparent;
  -webkit-text-fill-color: transparent;
  position: absolute;
  white-space: pre;
  cursor: text;
  transform-origin: 0% 0%;
}
/* 对齐 pdfjs 官方：span 层级、markedContent 特殊定位、换行元素不显示选区背景，避免蓝色选区错位/重叠 */
.pdf-text-layer > :not(.markedContent),
.pdf-text-layer .markedContent span:not(.markedContent) {
  z-index: 1;
}
.pdf-text-layer span.markedContent {
  top: 0;
  height: 0;
}
.pdf-text-layer ::selection {
  background: rgba(0, 100, 255, 0.25);
  color: transparent;
  -webkit-text-fill-color: transparent;
}
.pdf-text-layer br::selection {
  background: transparent;
}
.text-preview {
  max-width: 900px;
  margin: 0 auto;
  background: #fff;
  padding: 32px 40px;
  border-radius: 8px;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: anywhere;
  font-family: Consolas, Monaco, 'Courier New', monospace;
  font-size: 13px;
  line-height: 1.7;
  color: #303133;
}
.doc-html {
  max-width: 900px;
  margin: 0 auto;
  background: #fff;
  padding: 40px 48px;
  border-radius: 8px;
  font-size: 14px;
  line-height: 1.8;
  color: #2c3e50;
}
.doc-html h1, .doc-html h2, .doc-html h3, .doc-html h4 {
  margin: 1.2em 0 0.5em;
  color: #1f2d3d;
  line-height: 1.4;
}
.doc-html h1 { font-size: 1.7em; border-bottom: 1px solid #ebeef5; padding-bottom: 0.3em; }
.doc-html h2 { font-size: 1.4em; }
.doc-html h3 { font-size: 1.2em; }
.doc-html p { margin: 0.6em 0; }
.doc-html img { max-width: 100%; }
.doc-html table {
  border-collapse: collapse;
  margin: 1em 0;
  width: 100%;
  font-size: 13px;
}
.doc-html table td, .doc-html table th {
  border: 1px solid #dcdfe6;
  padding: 6px 10px;
  text-align: left;
  vertical-align: top;
}
.doc-html th, .doc-html thead td {
  background: #f5f7fa;
  font-weight: 600;
  position: sticky;
  top: 0;
}
.doc-table { margin: 1em 0; width: 100%; }
.doc-table td, .doc-table th { border: 1px solid #dcdfe6; padding: 6px 10px; }
.doc-table tbody tr:nth-child(even) { background: #fafbfc; }
.doc-table td { white-space: pre-wrap; word-break: break-all; }
.sheet-name {
  font-weight: 600;
  color: #409eff;
  margin: 14px 0 6px;
  font-size: 13px;
}
.sheet-gap { height: 18px; }
.doc-html pre {
  background: #f5f6f8;
  padding: 12px 14px;
  border-radius: 6px;
  overflow: auto;
  font-size: 13px;
}
.doc-html code {
  background: #f0f2f5;
  padding: 1px 5px;
  border-radius: 3px;
  font-size: 0.92em;
}
.doc-html pre code { background: none; padding: 0; }
/* MD 渲染专用样式（参考 vditor：表格居中、引用左侧竖线等） */
.doc-html .md-table-wrap {
  margin: 1em auto;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}
.doc-html .md-table {
  border-collapse: collapse;
  margin: 0 auto;
  width: auto;
  min-width: 40%;
  font-size: 13px;
  border: 1px solid #dcdfe6;
}
.doc-html .md-table th,
.doc-html .md-table td {
  border: 1px solid #dcdfe6;
  padding: 6px 12px;
  text-align: left;
  vertical-align: middle;
}
.doc-html .md-table th {
  background: #f5f7fa;
  font-weight: 600;
}
.doc-html .md-table tbody tr:nth-child(even) {
  background: #fafbfc;
}
.doc-html .md-quote {
  margin: 0.8em 0;
  padding: 0.5em 1em;
  border-left: 4px solid #dfe2e5;
  background: #f6f8fa;
  color: #586069;
  border-radius: 0 4px 4px 0;
}
.doc-html .md-quote p {
  margin: 0.2em 0;
}
.doc-html .md-list {
  margin: 0.6em 0;
  padding-left: 1.8em;
}
.doc-html .md-list li {
  margin: 0.25em 0;
}
.doc-html .md-hr {
  border: none;
  border-top: 1px solid #e4e7ed;
  margin: 1em 0;
}
.doc-html .md-inline-code {
  padding: 0.15em 0.4em;
  background: rgba(0, 0, 0, 0.05);
  border-radius: 4px;
  font-family: Consolas, Monaco, 'Courier New', monospace;
  font-size: 0.9em;
  color: #c7254e;
}
.doc-html .md-code-block {
  margin: 0.8em 0;
  padding: 12px 14px;
  background: #f6f8fa;
  border-radius: 6px;
  overflow-x: auto;
  font-size: 13px;
  line-height: 1.5;
}
.doc-html .md-code-block code {
  font-family: Consolas, Monaco, 'Courier New', monospace;
  white-space: pre;
  background: none;
  padding: 0;
}
.doc-error {
  margin: 80px auto;
  text-align: center;
  color: #f56c6c;
  max-width: 560px;
}
.doc-error-hint {
  color: #909399;
  font-size: 13px;
  margin-top: 8px;
}
.doc-ctx-menu {
  position: fixed;
  z-index: 9999;
  background: #fff;
  border: 1px solid #e4e7ed;
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  padding: 6px;
  min-width: 190px;
}
.doc-ctx-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 12px;
  border-radius: 6px;
  font-size: 13px;
  color: #303133;
  cursor: pointer;
  user-select: none;
}
.doc-ctx-item:hover { background: #f0f7ff; color: #409eff; }
.doc-ctx-item svg { color: #409eff; flex-shrink: 0; }
.pdf-outline-panel {
  position: fixed;
  right: 24px;
  top: 64px;
  z-index: 9998;
  width: 320px;
  max-height: 70vh;
  display: flex;
  flex-direction: column;
  background: #fff;
  border: 1px solid #e4e7ed;
  border-radius: 10px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.18);
  overflow: hidden;
}
.pdf-outline-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid #ebeef5;
  font-size: 14px;
  font-weight: 600;
  color: #303133;
}
.pdf-outline-close {
  border: none;
  background: none;
  font-size: 14px;
  color: #909399;
  cursor: pointer;
}
.pdf-outline-close:hover { color: #303133; }
.pdf-outline-list {
  flex: 1;
  overflow-y: auto;
  padding: 6px;
}
.pdf-outline-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  color: #606266;
}
.pdf-outline-item:hover { background: #f0f7ff; color: #409eff; }
.pdf-outline-item.has-page { cursor: pointer; }
.pdf-outline-toggle {
  flex-shrink: 0;
  width: 12px;
  text-align: center;
  font-size: 10px;
  color: #909399;
  user-select: none;
}
.pdf-outline-title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pdf-outline-page {
  flex-shrink: 0;
  font-size: 12px;
  color: #909399;
}
.pdf-outline-empty {
  padding: 20px;
  text-align: center;
  color: #a8abb2;
  font-size: 13px;
}
</style>

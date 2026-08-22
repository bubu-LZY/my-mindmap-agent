<template>
  <Transition name="tb-slide">
    <div
      v-show="visible"
      ref="toolbarRef"
      class="text-toolbar"
      :style="toolbarStyle"
      @mousedown="onToolbarMousedown"
      @click.stop
    >
      <!-- 加粗 -->
      <button
        class="tb-btn"
        :class="{ active: states.bold }"
        @click="exec('bold')"
        @mousedown.prevent
        title="加粗 (Ctrl+B)"
      >
        <span class="tb-glyph bold">B</span>
      </button>

      <!-- 斜体 -->
      <button
        class="tb-btn"
        :class="{ active: states.italic }"
        @click="exec('italic')"
        @mousedown.prevent
        title="斜体 (Ctrl+I)"
      >
        <span class="tb-glyph italic">I</span>
      </button>

      <!-- 下划线 -->
      <button
        class="tb-btn"
        :class="{ active: states.underline }"
        @click="exec('underline')"
        @mousedown.prevent
        title="下划线 (Ctrl+U)"
      >
        <span class="tb-glyph underline">U</span>
      </button>

      <!-- 删除线 -->
      <button
        class="tb-btn"
        :class="{ active: states.strikeThrough }"
        @click="exec('strikeThrough')"
        @mousedown.prevent
        title="删除线"
      >
        <span class="tb-glyph strike">S</span>
      </button>

      <span class="tb-sep"></span>

      <!-- 文字颜色 -->
      <div class="tb-color-group">
        <button class="tb-color-btn" @click="toggleMenu('fore')" @mousedown.prevent="saveSelection" title="文字颜色">
          <span class="tb-glyph">A</span>
          <span class="color-bar" :style="{ backgroundColor: foreColor }"></span>
        </button>
        <Transition name="tb-menu">
          <div v-if="foreColorMenuOpen" class="color-palette" @mousedown.prevent>
            <button
              v-for="c in textColors"
              :key="c"
              class="color-swatch"
              :style="{ backgroundColor: c }"
              @click="applyColor('foreColor', c)"
              @mousedown.prevent="saveSelection"
            ></button>
            <button class="color-swatch clear-swatch" @click="applyColor('foreColor', '')" @mousedown.prevent="saveSelection" title="清除颜色">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>
            </button>
          </div>
        </Transition>
      </div>

      <!-- 背景高亮 -->
      <div class="tb-color-group">
        <button class="tb-color-btn" @click="toggleMenu('hi')" @mousedown.prevent="saveSelection" title="背景高亮">
          <span class="tb-glyph highlight-icon">H</span>
          <span class="color-bar" :style="{ backgroundColor: hiColor }"></span>
        </button>
        <Transition name="tb-menu">
          <div v-if="hiColorMenuOpen" class="color-palette" @mousedown.prevent>
            <button
              v-for="c in highlightColors"
              :key="c"
              class="color-swatch"
              :style="{ backgroundColor: c }"
              @click="applyColor('hiliteColor', c)"
              @mousedown.prevent="saveSelection"
            ></button>
            <button class="color-swatch clear-swatch" @click="applyColor('hiliteColor', '')" @mousedown.prevent="saveSelection" title="清除高亮">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>
            </button>
          </div>
        </Transition>
      </div>

      <span class="tb-sep"></span>

      <!-- 字号 -->
      <div class="tb-size-group">
        <button class="tb-btn size-btn" @click="toggleSizeMenu" @mousedown.prevent="saveSelection" title="字号">
          <span class="tb-glyph">字号</span>
          <svg width="10" height="10" viewBox="0 0 12 12" fill="currentColor">
            <path d="M6 8L2 4h8z" />
          </svg>
        </button>
        <Transition name="tb-menu">
          <div v-if="sizeMenuOpen" class="size-menu" @mousedown.prevent>
            <button
              v-for="s in sizes"
              :key="s.value"
              class="size-item"
              :style="{ fontSize: s.px + 'px' }"
              @click="execFontSize(s.value)"
              @mousedown.prevent="saveSelection"
            >
              {{ s.label }}
            </button>
          </div>
        </Transition>
      </div>

      <span class="tb-sep"></span>

      <!-- 清除格式 -->
      <button class="tb-btn" @click="exec('removeFormat')" @mousedown.prevent title="清除格式">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <path d="M4 7h16M9 7l5 10M15 7l-3 6"/>
        </svg>
      </button>
    </div>
  </Transition>
</template>

<script setup>
import { ref, reactive, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { textColorValues, highlightColorValues } from '../utils/textStyle'

const props = defineProps({
  visible: {
    type: Boolean,
    default: false
  },
  // 获取思维导图实例的函数（用于直接取 richText.quill，不再依赖从未设置的 DOM.__quill）
  getMindMap: {
    type: Function,
    default: null
  }
})

const emit = defineEmits(['interact-start', 'interact-end'])

// 工具栏元素引用 & 动态定位样式
const toolbarRef = ref(null)
const toolbarStyle = reactive({
  top: '8px',
  left: '50%',
  transform: 'translateX(-50%) translateY(var(--tb-slide-y, 0px))'
})

// 格式状态
const states = reactive({
  bold: false,
  italic: false,
  underline: false,
  strikeThrough: false
})

// 颜色
const foreColor = ref('#1d1d1f')
const hiColor = ref('#fff3b0')
const foreColorMenuOpen = ref(false)
const hiColorMenuOpen = ref(false)

// 预设色板：与 FixedToolbar / AI 工具共用同一套颜色
const textColors = textColorValues
const highlightColors = highlightColorValues

// 字号菜单
const sizeMenuOpen = ref(false)
const sizes = [
  { label: '小', value: 'small', px: 12 },
  { label: '标准', value: 'normal', px: 14 },
  { label: '中', value: 'large', px: 18 },
  { label: '大', value: 'huge', px: 24 }
]

/* ============================================================
 * 菜单切换 — 关闭其他菜单，通知父组件交互状态
 * ============================================================ */
const toggleMenu = (which) => {
  if (which === 'fore') {
    foreColorMenuOpen.value = !foreColorMenuOpen.value
    hiColorMenuOpen.value = false
    sizeMenuOpen.value = false
  } else if (which === 'hi') {
    hiColorMenuOpen.value = !hiColorMenuOpen.value
    foreColorMenuOpen.value = false
    sizeMenuOpen.value = false
  }
  // 同步通知父组件（打开菜单时立即置 isToolbarInteracting=true）：
  // 点击按钮会冒泡触发 body_click → hide_text_edit，而 watch 回调是异步微任务，
  // 若不同步 emit，hide_text_edit 时 isToolbarInteracting 仍为 false，工具栏会被隐藏、菜单弹不出来
  const anyOpen = foreColorMenuOpen.value || hiColorMenuOpen.value || sizeMenuOpen.value
  if (anyOpen) emit('interact-start')
}

// 字号菜单切换：与 toggleMenu 一致，打开时同步 emit interact-start
const toggleSizeMenu = () => {
  sizeMenuOpen.value = !sizeMenuOpen.value
  foreColorMenuOpen.value = false
  hiColorMenuOpen.value = false
  if (sizeMenuOpen.value) emit('interact-start')
}

// 监听菜单状态变化，通知父组件（关闭菜单时由 watch 异步 emit interact-end 兜底）
watch([foreColorMenuOpen, hiColorMenuOpen, sizeMenuOpen], () => {
  const anyOpen = foreColorMenuOpen.value || hiColorMenuOpen.value || sizeMenuOpen.value
  emit(anyOpen ? 'interact-start' : 'interact-end')
})

/* ============================================================
 * 选区保存/恢复
 * 解决：点击颜色选择器/字号菜单时，原生弹窗会抢夺焦点导致选区丢失
 * 方案：mousedown 时保存选区，执行格式命令前恢复选区
 * ============================================================ */
let savedQuill = null        // 保存 Quill 实例引用
let savedQuillRange = null   // 保存 Quill 选区 { index, length }
let savedRange = null        // 保存 DOM Range（contenteditable 场景）

/**
 * 保存当前选区（在 mousedown 之前调用）
 * 同时保存 Quill 选区和 DOM Range，确保两种编辑模式都能恢复
 */
const saveSelection = () => {
  // 尝试保存 Quill 选区（思维导图模式）
  const quill = getQuill()
  if (quill) {
    const range = quill.getSelection()
    if (range) {
      savedQuill = quill
      // 拷贝为纯值：getSelection 返回内部引用，之后会被 selection-change 改写导致脏数据
      savedQuillRange = { index: range.index, length: range.length }
    }
  }
  // 保存 DOM Range（大纲模式 contenteditable）
  const sel = window.getSelection()
  if (sel && sel.rangeCount > 0) {
    const range = sel.getRangeAt(0)
    // 只保存非折叠的选区（有文字选中）
    if (!range.collapsed) {
      savedRange = range.cloneRange()
    }
  }
}

/**
 * 恢复保存的选区，使格式命令能正确应用到目标文字
 * 优先恢复 Quill 选区（思维导图模式），其次恢复 DOM Range（大纲模式）
 */
const restoreSelection = () => {
  // 优先恢复 Quill 选区
  if (savedQuill && savedQuillRange) {
    try {
      savedQuill.focus()
      savedQuill.setSelection(savedQuillRange.index, savedQuillRange.length)
      return true
    } catch (e) {
      // Quill 可能已不可用，降级到 DOM Range
    }
  }
  // 恢复 DOM Range
  if (savedRange) {
    try {
      const sel = window.getSelection()
      sel.removeAllRanges()
      sel.addRange(savedRange)
      return true
    } catch (e) {
      // ignore
    }
  }
  return false
}

/**
 * 工具栏 mousedown 事件：保存选区 + 阻止默认行为（防止焦点丢失）
 * + 阻止冒泡到 body：
 *   simple-mind-map 的 TextEdit 监听 body_mousedown/body_click
 *   （isEndNodeTextEditOnClickOuter 默认 true），点击工具栏按钮若冒泡到 body
 *   会立即 hideEditTextBox 关闭节点编辑框（richText.node 置空、编辑框 display:none）。
 *   之后点击色块时 getQuill() 返回 null、保存的选区也随编辑框一起失效，
 *   表现为"设置字体颜色/背景高亮点击后没有反应"。点击事件同样在根节点截断（@click.stop）。
 */
const onToolbarMousedown = (e) => {
  e.preventDefault()
  e.stopPropagation()
  saveSelection()
}

// 尝试获取当前选区所在的 Quill 实例（思维导图富文本编辑器）
const getQuill = () => {
  // 优先从思维导图实例直接取（richText.node 非空 = 正在编辑思维导图节点；
  // 旧方案依赖的 DOM.__quill 属性从未被设置，导致思维导图模式下永远返回 null）
  try {
    const mm = typeof props.getMindMap === 'function' ? props.getMindMap() : null
    const rt = mm && mm.richText
    if (rt && rt.quill && rt.node) return rt.quill
  } catch (e) {
    // ignore，走降级
  }
  // 降级1：从当前选区查找可见的 Quill 编辑器（仅用于判断选区是否在富文本框内）
  const sel = window.getSelection()
  if (sel && sel.rangeCount > 0) {
    let node = sel.anchorNode
    while (node && node !== document.body) {
      if (node.classList && node.classList.contains('ql-editor')) {
        // 找到了 Quill 编辑框但拿不到实例（无 __quill）：仅当编辑框可见时
        // 通过实例引用再次尝试，否则返回 null 走 contenteditable 降级
        return null
      }
      node = node.parentNode
    }
  }
  // 降级2：大纲模式 contenteditable，无 Quill 实例，返回 null 由调用方走 document.execCommand
  return null
}

// 执行格式命令 —— 先恢复选区，再优先使用 Quill API，回退到 execCommand
const exec = (command) => {
  restoreSelection()
  const quill = getQuill()
  if (quill) {
    const fmt = quill.getFormat()
    switch (command) {
      case 'bold': quill.format('bold', !fmt.bold); break
      case 'italic': quill.format('italic', !fmt.italic); break
      case 'underline': quill.format('underline', !fmt.underline); break
      case 'strikeThrough': quill.format('strike', !fmt.strike); break
      case 'removeFormat': {
        const range = quill.getSelection()
        if (range) quill.removeFormat(range.index, range.length)
        break
      }
    }
  } else {
    document.execCommand(command, false, null)
  }
  updateStates()
}

// 用显式选区执行 Quill 格式写入（Quill 2 的 formatText 对象格式）。
// quill.format(name, value) 内部依赖 getSelection(true)，选区一旦异常会静默无效果；
// 这里优先用 mousedown 时保存的选区，失败再退回当前选区 / quill.format
const applyQuillFormats = (quill, formats) => {
  const saved = (savedQuill === quill && savedQuillRange) ? savedQuillRange : null
  let range = (saved && saved.length > 0) ? saved : quill.getSelection()
  if (range && range.length > 0) {
    try {
      quill.formatText(range.index, range.length, formats, 'user')
      // 恢复选区高亮，便于继续叠加其他格式
      try { quill.setSelection(range.index, range.length, 'silent') } catch (e) {}
      return
    } catch (e) { /* 走兜底 */ }
  }
  try { quill.format(Object.keys(formats)[0], Object.values(formats)[0]) } catch (e) {}
}

// 应用颜色（点击色块时触发，选区已在 mousedown 时保存）
const applyColor = (command, color) => {
  // 恢复保存的选区；即使恢复失败也继续执行（用 quill 当前选区兜底），
  // 避免旧逻辑中 if (!restored && color) return 导致颜色设置被静默跳过
  restoreSelection()

  const quill = getQuill()
  if (quill) {
    // foreColor → quill 的 color 格式；hiliteColor → quill 的 background 格式
    const fmtKey = command === 'foreColor' ? 'color' : 'background'
    applyQuillFormats(quill, { [fmtKey]: color || false })
    if (command === 'foreColor') {
      foreColor.value = color || '#1d1d1f'
    } else {
      hiColor.value = color || '#fff3b0'
    }
    try { quill.focus() } catch (e) {}
    // 立即刷新画布节点，避免“退出编辑后/选中状态下才看到变化”
    const mm = typeof props.getMindMap === 'function' ? props.getMindMap() : null
    if (mm && typeof mm.render === 'function') {
      setTimeout(() => { try { mm.render() } catch (e) {} }, 0)
    }
  } else {
    if (color) {
      document.execCommand(command, false, color)
    } else {
      document.execCommand('removeFormat', false, null)
    }
  }

  // 关闭菜单
  foreColorMenuOpen.value = false
  hiColorMenuOpen.value = false
  updateStates()
}

// 执行字号命令
// 本应用 quill 的 size 注册为内联 font-size StyleAttributor（whitelist:null），
// 只接受 "12px" 这类 CSS 值；传库默认的 small/large/huge 会静默失效
const execFontSize = (s) => {
  restoreSelection()
  const quill = getQuill()
  if (quill) {
    if (s.value === 'normal') {
      applyQuillFormats(quill, { size: false })
    } else {
      applyQuillFormats(quill, { size: s.px + 'px' })
    }
    const mm = typeof props.getMindMap === 'function' ? props.getMindMap() : null
    if (mm && typeof mm.render === 'function') {
      setTimeout(() => { try { mm.render() } catch (e) {} }, 0)
    }
  } else {
    const sizeMap = { small: '2', normal: '3', large: '5', huge: '6' }
    document.execCommand('fontSize', false, sizeMap[s.value] || '3')
  }
  sizeMenuOpen.value = false
  updateStates()
}

// 更新按钮状态
const updateStates = () => {
  const quill = getQuill()
  if (quill) {
    const fmt = quill.getFormat()
    states.bold = !!fmt.bold
    states.italic = !!fmt.italic
    states.underline = !!fmt.underline
    states.strikeThrough = !!fmt.strike
    if (fmt.color) foreColor.value = fmt.color
    if (fmt.background) hiColor.value = fmt.background
  } else {
    try {
      states.bold = document.queryCommandState('bold')
      states.italic = document.queryCommandState('italic')
      states.underline = document.queryCommandState('underline')
      states.strikeThrough = document.queryCommandState('strikeThrough')
    } catch {
      // ignore
    }
  }
}

// 定位矩形：优先选区矩形；折叠光标（仅编辑未选中文字）时取光标行，空节点时取节点文本元素整行
const getRectForPosition = (range) => {
  // 全零矩形（选区暂不可见/丢失，SVG foreignObject 下偶发）会导致工具条跳到左上角，直接判无效
  const isDegenerate = (r) => !r || (r.width === 0 && r.height === 0 && r.top === 0 && r.left === 0)
  if (!range.collapsed) {
    const r = range.getBoundingClientRect()
    if (r && (r.width > 0 || r.height > 0) && !isDegenerate(r)) return r
  }
  let r = range.getBoundingClientRect()
  if (r && r.height > 0 && (r.top !== 0 || r.bottom !== 0) && !isDegenerate(r)) return r
  const rects = range.getClientRects()
  if (rects && rects.length) {
    const valid = Array.from(rects).find(x => !isDegenerate(x) && (x.width > 0 || x.height > 0))
    if (valid) return valid
  }
  const container = range.startContainer
  const el = container.nodeType === 3 ? container.parentElement : container
  const nodeEl = el && el.closest ? el.closest('.node-text, .ql-editor') : null
  if (nodeEl) {
    const nr = nodeEl.getBoundingClientRect()
    if (!isDegenerate(nr)) return nr
  }
  return null
}

// 计算并更新工具栏位置，使其跟随当前选区/光标
const updatePosition = () => {
  const toolbar = toolbarRef.value
  if (!toolbar) return

  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return

  const range = sel.getRangeAt(0)
  const selRect = getRectForPosition(range)
  if (!selRect) return

  const offsetParent = toolbar.offsetParent
  if (!offsetParent) return
  const parentRect = offsetParent.getBoundingClientRect()

  const tbRect = toolbar.getBoundingClientRect()
  const tbHeight = tbRect.height
  const tbWidth = tbRect.width

  const GAP = 8
  const EDGE = 4
  const vw = window.innerWidth
  const vh = window.innerHeight

  // ---------- 遮挡检测：工具栏不应盖住选区之外的节点文字行 ----------
  // 取选区所在编辑容器（思维导图 .ql-editor / 大纲 contenteditable）的块级行矩形
  const collectEditingLines = () => {
    try {
      let el = range.startContainer
      if (el && el.nodeType === 3) el = el.parentElement
      const editor = el && el.closest ? el.closest('.ql-editor, [contenteditable="true"]') : null
      if (!editor) return null
      const rows = []
      for (const child of editor.children || []) {
        const r = child.getBoundingClientRect()
        if (r && (r.width > 0 || r.height > 0)) rows.push(r)
      }
      return rows.length ? { rows, editorRect: editor.getBoundingClientRect() } : null
    } catch (e) {
      return null
    }
  }
  const linesInfo = collectEditingLines()
  // 矩形相交判定
  const overlaps = (a, b) =>
    a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
  // 行与选区不相交 = 选区之外的文字行（被工具栏盖住即视为遮挡）
  const isRowOutsideSelection = (r) =>
    !(r.top < selRect.bottom + 2 && r.bottom > selRect.top - 2)

  // 候选位置是否可用：完整落在视口内、不与选区重叠、不遮挡选区之外的文字行
  const candidateOk = (c, checkLines) => {
    if (c.top < EDGE || c.left < EDGE) return false
    if (c.top + tbHeight > vh - EDGE || c.left + tbWidth > vw - EDGE) return false
    const tbBox = { top: c.top, left: c.left, right: c.left + tbWidth, bottom: c.top + tbHeight }
    if (overlaps(tbBox, selRect)) return false
    if (checkLines && linesInfo) {
      for (const r of linesInfo.rows) {
        if (isRowOutsideSelection(r) && overlaps(tbBox, r)) return false
      }
    }
    return true
  }

  // ---------- 6 级优先级候选（上/下 × 居中/左对齐/右对齐） ----------
  const cx = selRect.left + selRect.width / 2
  const candidates = [
    { top: selRect.top - tbHeight - GAP, left: cx - tbWidth / 2, x: '-50%' },   // 1 选区上方居中
    { top: selRect.bottom + GAP, left: cx - tbWidth / 2, x: '-50%' },           // 2 选区下方居中
    { top: selRect.top - tbHeight - GAP, left: selRect.left, x: '0' },          // 3 选区上方左对齐
    { top: selRect.bottom + GAP, left: selRect.left, x: '0' },                  // 4 选区下方左对齐
    { top: selRect.top - tbHeight - GAP, left: selRect.right - tbWidth, x: '-100%' }, // 5 选区上方右对齐
    { top: selRect.bottom + GAP, left: selRect.right - tbWidth, x: '-100%' }    // 6 选区下方右对齐
  ]
  let pick = candidates.find(c => candidateOk(c, true))

  // 6 级全部不可用（多行文本上下都有其他行）时，退到编辑框整体上方/下方（绝不遮挡节点文字）
  if (!pick && linesInfo && linesInfo.editorRect) {
    const er = linesInfo.editorRect
    const ecx = er.left + er.width / 2
    const fallbacks = [
      { top: er.top - tbHeight - GAP, left: ecx - tbWidth / 2, x: '-50%' },
      { top: er.bottom + GAP, left: ecx - tbWidth / 2, x: '-50%' }
    ]
    pick = fallbacks.find(c => candidateOk(c, false))
  }

  // 仍不可用则取默认候选（选区上方居中）并 clamp 进视口
  if (!pick) pick = candidates[0]
  let top = pick.top
  let left = pick.left
  if (top < EDGE) top = EDGE
  if (top + tbHeight > vh - EDGE) top = Math.max(EDGE, vh - tbHeight - EDGE)
  if (left < EDGE) left = EDGE
  if (left + tbWidth > vw - EDGE) left = Math.max(EDGE, vw - tbWidth - EDGE)

  toolbarStyle.top = `${Math.round(top - parentRect.top)}px`
  toolbarStyle.left = `${Math.round(left - parentRect.left)}px`
  toolbarStyle.transform = `translateX(${pick.x}) translateY(var(--tb-slide-y, 0px))`
}

// 监听选区变化
const onSelectionChange = () => {
  if (props.visible) {
    updateStates()
    updatePosition()
  }
}

// 工具栏显示时，在下一帧计算位置
watch(
  () => props.visible,
  (val) => {
    if (val) {
      nextTick(() => {
        updateStates()
        updatePosition()
      })
    } else {
      // 工具栏隐藏时清除保存的选区和关闭所有菜单
      savedQuill = null
      savedQuillRange = null
      savedRange = null
      sizeMenuOpen.value = false
      foreColorMenuOpen.value = false
      hiColorMenuOpen.value = false
    }
  }
)

// 滚动/窗口尺寸变化时让工具栏跟随节点
const onViewportChange = () => {
  if (props.visible) updatePosition()
}

// 点击工具栏外部时关闭所有下拉菜单，避免菜单卡开导致 interact-end 不触发、
// 进而让父组件 isToolbarInteracting 永久为 true、工具栏无法隐藏
const onDocumentMousedown = (e) => {
  if (!foreColorMenuOpen.value && !hiColorMenuOpen.value && !sizeMenuOpen.value) return
  const toolbar = toolbarRef.value
  if (toolbar && toolbar.contains(e.target)) return
  foreColorMenuOpen.value = false
  hiColorMenuOpen.value = false
  sizeMenuOpen.value = false
}

// Escape 关闭下拉菜单：菜单开着时按 Esc 会退出节点编辑（hide_text_edit 被交互状态跳过），
// 但不会产生 document mousedown，菜单将一直卡开、isToolbarInteracting 卡 true，工具栏永久显示
const onDocumentKeydown = (e) => {
  if (e.key !== 'Escape') return
  if (!foreColorMenuOpen.value && !hiColorMenuOpen.value && !sizeMenuOpen.value) return
  foreColorMenuOpen.value = false
  hiColorMenuOpen.value = false
  sizeMenuOpen.value = false
}

onMounted(() => {
  document.addEventListener('selectionchange', onSelectionChange)
  // 捕获阶段监听所有容器滚动（如大纲树滚动），保证工具栏跟随节点
  document.addEventListener('scroll', onViewportChange, true)
  window.addEventListener('resize', onViewportChange)
  document.addEventListener('mousedown', onDocumentMousedown)
  document.addEventListener('keydown', onDocumentKeydown)
})

onBeforeUnmount(() => {
  document.removeEventListener('selectionchange', onSelectionChange)
  document.removeEventListener('scroll', onViewportChange, true)
  window.removeEventListener('resize', onViewportChange)
  document.removeEventListener('mousedown', onDocumentMousedown)
  document.removeEventListener('keydown', onDocumentKeydown)
})
</script>

<style scoped>
.text-toolbar {
  position: absolute;
  z-index: 1000;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px 6px;
  background: rgba(255, 255, 255, 0.88);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 12px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.12), 0 1px 3px rgba(0, 0, 0, 0.06);
  user-select: none;
}

/* 按钮 */
.tb-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 30px;
  height: 30px;
  padding: 0 6px;
  border: none;
  background: transparent;
  border-radius: 7px;
  cursor: pointer;
  color: #1d1d1f;
  font-size: 14px;
  transition: background-color 0.15s, color 0.15s;
}

.tb-btn:hover {
  background-color: rgba(0, 0, 0, 0.06);
}

.tb-btn:active {
  background-color: rgba(0, 0, 0, 0.1);
}

.tb-btn.active {
  background-color: rgba(0, 122, 255, 0.12);
  color: #007aff;
}

/* 字符图标 */
.tb-glyph {
  font-size: 14px;
  font-weight: 600;
  line-height: 1;
}

.tb-glyph.bold { font-weight: 800; }
.tb-glyph.italic { font-style: italic; font-weight: 600; }
.tb-glyph.underline { text-decoration: underline; font-weight: 600; }
.tb-glyph.strike { text-decoration: line-through; font-weight: 600; }
.tb-glyph.highlight-icon {
  font-weight: 600;
  background: linear-gradient(transparent 55%, #ffe066 55%);
  padding: 0 1px;
}

/* 分隔符 */
.tb-sep {
  width: 1px;
  height: 18px;
  background-color: rgba(0, 0, 0, 0.1);
  margin: 0 3px;
  flex-shrink: 0;
}

/* 颜色按钮 */
.tb-color-btn {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-width: 30px;
  height: 30px;
  border: none;
  background: transparent;
  border-radius: 7px;
  cursor: pointer;
  color: #1d1d1f;
  transition: background-color 0.15s;
}

.tb-color-btn:hover {
  background-color: rgba(0, 0, 0, 0.06);
}

.color-bar {
  width: 16px;
  height: 3px;
  border-radius: 2px;
  margin-top: 1px;
}

/* 色板下拉 */
.tb-color-group {
  position: relative;
}

.color-palette {
  position: absolute;
  top: calc(100% + 4px);
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 8px;
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 10px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  width: 140px;
  z-index: 1001;
}

.color-swatch {
  width: 22px;
  height: 22px;
  border-radius: 5px;
  border: 1px solid rgba(0, 0, 0, 0.1);
  cursor: pointer;
  transition: transform 0.1s, box-shadow 0.1s;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.color-swatch:hover {
  transform: scale(1.15);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
}

.color-swatch.clear-swatch {
  background: white;
  color: #8e8e93;
}

/* 字号下拉 */
.tb-size-group {
  position: relative;
}

.size-btn {
  gap: 2px;
}

.size-btn .tb-glyph {
  font-size: 12px;
  font-weight: 500;
}

.size-menu {
  position: absolute;
  top: calc(100% + 4px);
  left: 50%;
  transform: translateX(-50%);
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 10px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  padding: 4px;
  min-width: 80px;
  z-index: 1001;
}

.size-item {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  padding: 6px 12px;
  border: none;
  background: transparent;
  border-radius: 6px;
  cursor: pointer;
  color: #1d1d1f;
  font-weight: 500;
  transition: background-color 0.15s;
}

.size-item:hover {
  background-color: rgba(0, 122, 255, 0.08);
  color: #007aff;
}

/* 过渡动画 */
.tb-slide-enter-active,
.tb-slide-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.tb-slide-enter-from,
.tb-slide-leave-to {
  opacity: 0;
  --tb-slide-y: -8px;
}

.tb-menu-enter-active,
.tb-menu-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}

.tb-menu-enter-from,
.tb-menu-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(-4px);
}
</style>

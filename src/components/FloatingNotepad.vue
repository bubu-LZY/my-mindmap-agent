<template>
  <div
    class="floating-notepad"
    :style="{ left: pos.x + 'px', top: pos.y + 'px', width: size.w + 'px', height: size.h + 'px' }"
    @mousedown.stop
  >
    <!-- 标题栏（拖拽区） -->
    <div
      class="np-header"
      @pointerdown="onDragStart"
      @pointermove="onDragMove"
      @pointerup="onDragEnd"
      @pointercancel="onDragEnd"
    >
      <div class="np-title">
        <svg viewBox="0 0 16 16" fill="none" width="14" height="14">
          <rect x="2.5" y="2.5" width="11" height="11" rx="2" stroke="currentColor" stroke-width="1.4"/>
          <path d="M5.5 6h5M5.5 8.5h5M5.5 11h3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
        </svg>
        <span>记事本</span>
      </div>
      <div class="np-header-actions">
        <button class="np-icon-btn" title="无序列表（•）" @click.stop="insertList(false)">•≡</button>
        <button class="np-icon-btn" title="有序列表（1. 2. 3.）" @click.stop="insertList(true)">1≡</button>
        <button class="np-icon-btn np-clear-btn" title="一键清空" @click.stop="clearAll">清空</button>
        <button class="np-icon-btn" title="关闭（内容自动保存）" @click.stop="close">×</button>
      </div>
    </div>

    <!-- 可编辑内容区 -->
    <div class="np-body">
      <div
        ref="editorRef"
        class="np-editor"
        contenteditable="true"
        spellcheck="false"
        @input="onInput"
        @blur="saveNow"
        @keydown="onKeydown"
      ></div>
    </div>

    <!-- 右下角缩放手柄 -->
    <div
      class="np-resize"
      @pointerdown="onResizeStart"
      @pointermove="onResizeMove"
      @pointerup="onResizeEnd"
      @pointercancel="onResizeEnd"
    ></div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'

const STORAGE_KEY = 'my-mindmap-agent:notepad'
const POS_KEY = 'my-mindmap-agent:notepad:pos'
const SIZE_KEY = 'my-mindmap-agent:notepad:size'

const emit = defineEmits(['close'])

const pos = ref({ x: Math.max(20, window.innerWidth - 380), y: 90 })
const size = ref({ w: 340, h: 400 })
const editorRef = ref(null)

let dragOffset = null
let resizeStart = null
let saveTimer = null

// 从 localStorage 恢复位置和大小
const loadPrefs = () => {
  try {
    const p = JSON.parse(localStorage.getItem(POS_KEY) || 'null')
    if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) {
      pos.value = {
        x: Math.max(0, Math.min(p.x, window.innerWidth - 100)),
        y: Math.max(0, Math.min(p.y, window.innerHeight - 60))
      }
    }
  } catch (e) {}
  try {
    const s = JSON.parse(localStorage.getItem(SIZE_KEY) || 'null')
    if (s && Number.isFinite(s.w) && Number.isFinite(s.h)) {
      size.value = { w: Math.max(240, s.w), h: Math.max(200, s.h) }
    }
  } catch (e) {}
}

const loadContent = () => {
  const text = localStorage.getItem(STORAGE_KEY) || ''
  if (editorRef.value) {
    editorRef.value.innerHTML = text
  }
}

const saveNow = () => {
  if (!editorRef.value) return
  const html = editorRef.value.innerHTML
  localStorage.setItem(STORAGE_KEY, html)
}

// 输入防抖自动保存
const onInput = () => {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(saveNow, 400)
}

// 中文数字序列
const CN_NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二']

// 匹配行首的序号前缀，返回 { prefix, next }；无法匹配返回 null
const matchListPrefix = (text) => {
  if (!text) return null
  let m
  // 阿拉伯数字 + 顿号/点/逗号：1、 1. 1，
  m = text.match(/^(\d+)([、.．，,])[ \t]*/)
  if (m) {
    const n = parseInt(m[1], 10)
    return { prefix: m[0], next: `${n + 1}${m[2]} ` }
  }
  // 括号数字：（1）（2）
  m = text.match(/^（(\d+)）[ \t]*/)
  if (m) {
    const n = parseInt(m[1], 10)
    return { prefix: m[0], next: `（${n + 1}）` }
  }
  // 中文数字 + 顿号：一、二、
  m = text.match(/^([一二三四五六七八九十]+)、[ \t]*/)
  if (m) {
    const idx = CN_NUM.indexOf(m[1])
    if (idx !== -1 && idx + 1 < CN_NUM.length) {
      return { prefix: m[0], next: `${CN_NUM[idx + 1]}、` }
    }
  }
  // 无序：- · •
  m = text.match(/^([-·•])[ \t]*/)
  if (m) {
    return { prefix: m[0], next: `${m[1]} ` }
  }
  return null
}

// 获取光标所在行的文本（从行首到光标，<br> 视为换行）
const getCurrentLineText = () => {
  const el = editorRef.value
  if (!el) return ''
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return ''
  const range = sel.getRangeAt(0)
  try {
    const preRange = document.createRange()
    preRange.selectNodeContents(el)
    preRange.setEnd(range.startContainer, range.startOffset)
    const preText = preRange.toString()
    const lastBreak = preText.lastIndexOf('\n')
    return lastBreak === -1 ? preText : preText.slice(lastBreak + 1)
  } catch (e) {
    return ''
  }
}

// 获取当前行首的文本节点位置（用于删除行首序号，退出列表）
const deleteCurrentLinePrefix = (prefixLen) => {
  const el = editorRef.value
  if (!el) return
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return
  const range = sel.getRangeAt(0)
  const delRange = document.createRange()
  delRange.selectNodeContents(el)
  delRange.setEnd(range.startContainer, range.startOffset)
  // 计算行首位置：向前找 prefixLen 个字符
  const preText = delRange.toString()
  const lastBreak = preText.lastIndexOf('\n')
  const lineStart = lastBreak + 1
  // 从行首删除 prefixLen 个字符。
  // 注意：这里必须把 <br> 也计入一个“换行字符”，否则行号偏移和 DOM 文本节点对不上，
  // 会导致删除到上一行内容。
  const mapTextOffset = (target) => {
    const walker = document.createTreeWalker(
      el,
      NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT
    )
    let pos = 0
    let node
    while ((node = walker.nextNode())) {
      if (node.nodeType === Node.TEXT_NODE) {
        const len = node.textContent.length
        if (target <= pos + len) {
          return { node, offset: target - pos }
        }
        pos += len
      } else if (node.tagName === 'BR') {
        pos += 1
      }
    }
    return null
  }
  const startNode = mapTextOffset(lineStart)
  const endNode = mapTextOffset(lineStart + prefixLen)
  if (startNode && endNode) {
    delRange.setStart(startNode.node, startNode.offset)
    delRange.setEnd(endNode.node, endNode.offset)
    delRange.deleteContents()
  }
}

// 在当前光标位置插入一个换行，并把光标放到换行之后。
// 用于空列表项退出列表，避免 execCommand('insertLineBreak') 在 contenteditable
// 中对 BR/选区处理不稳定，导致光标跳回上一行。
const insertLineBreakAtSelection = () => {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return false
  const range = sel.getRangeAt(0)
  const br = document.createElement('br')
  range.insertNode(br)
  const nextRange = document.createRange()
  nextRange.setStartAfter(br)
  nextRange.collapse(true)
  sel.removeAllRanges()
  sel.addRange(nextRange)
  return true
}

const onKeydown = (e) => {
  // Tab 键插入缩进（避免焦点跳出编辑器）
  if (e.key === 'Tab') {
    e.preventDefault()
    document.execCommand('insertText', false, '  ')
    return
  }
  // 回车：检测行首序号，自动延续（1、→2、；一、→二、；（1）→（2）；- → -）
  if (e.key === 'Enter') {
    const lineText = getCurrentLineText()
    const matched = matchListPrefix(lineText)
    if (matched) {
      e.preventDefault()
      const content = lineText.slice(matched.prefix.length).trim()
      if (!content) {
        // 当前行只有序号没有内容：删除行首序号后换行（退出列表）
        try { deleteCurrentLinePrefix(matched.prefix.length) } catch (err) {}
        insertLineBreakAtSelection()
      } else {
        // 换行后插入下一个序号
        document.execCommand('insertLineBreak', false, null)
        document.execCommand('insertText', false, matched.next)
      }
      saveNow()
    }
  }
}

// 插入无序/有序列表：先确保光标所在行有内容，再触发列表
const insertList = (ordered) => {
  const el = editorRef.value
  if (!el) return
  el.focus()
  // 检查当前是否有选区/光标，没有则聚焦到末尾
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0 || !el.contains(sel.anchorNode)) {
    const range = document.createRange()
    range.selectNodeContents(el)
    range.collapse(false)
    sel.removeAllRanges()
    sel.addRange(range)
  }
  document.execCommand(ordered ? 'insertOrderedList' : 'insertUnorderedList', false, null)
  saveNow()
}

const clearAll = () => {
  const el = editorRef.value
  if (!el) return
  if (!window.confirm('确定清空记事本全部内容吗？')) return
  el.innerHTML = ''
  saveNow()
}

const close = () => {
  saveNow()
  emit('close')
}

// ============ 拖拽 ============
const onDragStart = (e) => {
  if (e.target && e.target.closest && e.target.closest('button')) return
  const rect = e.currentTarget.closest('.floating-notepad')?.getBoundingClientRect()
  if (!rect) return
  dragOffset = { x: e.clientX - rect.left, y: e.clientY - rect.top }
  try { e.currentTarget.setPointerCapture?.(e.pointerId) } catch (err) {}
}

const onDragMove = (e) => {
  if (!dragOffset) return
  pos.value = {
    x: Math.max(0, Math.min(e.clientX - dragOffset.x, window.innerWidth - 80)),
    y: Math.max(0, Math.min(e.clientY - dragOffset.y, window.innerHeight - 40))
  }
  localStorage.setItem(POS_KEY, JSON.stringify(pos.value))
}

const onDragEnd = (e) => {
  dragOffset = null
  try { e.currentTarget.releasePointerCapture?.(e.pointerId) } catch (err) {}
}

// ============ 缩放 ============
const onResizeStart = (e) => {
  resizeStart = { x: e.clientX, y: e.clientY, w: size.value.w, h: size.value.h }
  try { e.currentTarget.setPointerCapture?.(e.pointerId) } catch (err) {}
}

const onResizeMove = (e) => {
  if (!resizeStart) return
  size.value = {
    w: Math.max(240, resizeStart.w + (e.clientX - resizeStart.x)),
    h: Math.max(200, resizeStart.h + (e.clientY - resizeStart.y))
  }
  localStorage.setItem(SIZE_KEY, JSON.stringify(size.value))
}

const onResizeEnd = (e) => {
  resizeStart = null
  try { e.currentTarget.releasePointerCapture?.(e.pointerId) } catch (err) {}
}

onMounted(() => {
  loadPrefs()
  loadContent()
})

onBeforeUnmount(() => {
  if (saveTimer) clearTimeout(saveTimer)
  saveNow()
})
</script>

<style scoped>
.floating-notepad {
  position: fixed;
  z-index: 8000;
  display: flex;
  flex-direction: column;
  background: rgba(28, 30, 38, 0.96);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 12px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
  overflow: hidden;
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
}

.np-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 12px;
  cursor: move;
  user-select: none;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  flex-shrink: 0;
}

.np-title {
  display: flex;
  align-items: center;
  gap: 7px;
  color: #e5e7eb;
  font-size: 13px;
  font-weight: 600;
  min-width: 0;
}

.np-header-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.np-icon-btn {
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.05);
  color: #cbd5e1;
  border-radius: 6px;
  padding: 4px 8px;
  font-size: 12px;
  cursor: pointer;
  line-height: 1;
  transition: background 0.15s, color 0.15s;
}

.np-icon-btn:hover {
  background: rgba(255, 255, 255, 0.14);
  color: #fff;
}

.np-clear-btn:hover {
  background: rgba(239, 68, 68, 0.25);
  border-color: rgba(239, 68, 68, 0.4);
}

.np-body {
  flex: 1;
  min-height: 0;
  padding: 10px 12px;
  overflow: hidden;
}

.np-editor {
  width: 100%;
  height: 100%;
  overflow-y: auto;
  outline: none;
  color: #e5e7eb;
  font-size: 13px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
}

.np-editor:empty::before {
  content: '在此记录，内容自动保存，跨文件可用…';
  color: rgba(255, 255, 255, 0.25);
}

.np-editor :deep(ul) {
  padding-left: 20px;
  list-style: disc;
}

.np-editor :deep(ol) {
  padding-left: 20px;
  list-style: decimal;
}

.np-editor :deep(li) {
  margin: 2px 0;
}

.np-resize {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 16px;
  height: 16px;
  cursor: nwse-resize;
}

.np-resize::after {
  content: '';
  position: absolute;
  right: 4px;
  bottom: 4px;
  width: 8px;
  height: 8px;
  border-right: 2px solid rgba(255, 255, 255, 0.35);
  border-bottom: 2px solid rgba(255, 255, 255, 0.35);
}
</style>

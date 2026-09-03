<template>
  <div class="outline-wrapper" :class="{ 'is-fullscreen': isFullscreen }" :style="{ display: visible ? 'flex' : 'none' }">
    <!-- 顶部固定工具栏（与思维导图模式一致的功能） -->
    <div class="outline-toolbar-bar">
      <OutlineToolbar
        :disabled="!toolbarTargetUid"
        :cloze-hidden="clozeHidden"
        :painter-active="painterActive"
        @apply="onToolbarApply"
        @note="onToolbarNote"
        @gen="onToolbarGen"
        @toggle-cloze="onToolbarToggleCloze"
        @hide-cloze="onToolbarHideCloze"
        @show-cloze="onToolbarShowCloze"
        @export="onToolbarExport"
        @format-painter="onToolbarFormatPainter"
      />
    </div>

    <!-- 全屏展示：按钮已移至全局右下角按钮组，此处保留 ESC 快捷键逻辑 -->
    <!-- （全屏样式仍由 is-fullscreen class 控制） -->

    <!-- 文字编辑工具栏 -->
    <TextToolbar
      :visible="textToolbarVisible"
      :get-mind-map="() => null"
      position-mode="fixed"
      @interact-start="onToolbarInteractStart"
      @interact-end="onToolbarInteractEnd"
    />

    <!-- 树形大纲 -->
    <div
      class="tree-container"
      @keydown="onTreeKeydown"
      @click.capture="onTreeClickCapture"
      @contextmenu.prevent="onTreeContextmenu"
    >
      <el-tree
        ref="treeRef"
        :data="treeData"
        node-key="uid"
        draggable
        default-expand-all
        :indent="24"
        :props="defaultProps"
        :expand-on-click-node="false"
        @node-drop="onNodeDrop"
        @current-change="onCurrentChange"
      >
        <template #default="{ node, data }">
          <span class="custom-tree-node" :class="data.frameClass || ''" :style="data.frameStyle || null">
            <!-- 层级竖线：每行为每个祖先层级画一段竖线（穿过该级展开图标中心），相邻行首尾相接形成每级一条连续竖线 -->
            <span class="indent-guides" aria-hidden="true">
              <span
                v-for="i in (node.isLeaf ? node.level : node.level - 1)"
                :key="i"
                class="indent-guide"
                :style="{ left: (i - 1) * 24 + 12 + 'px' }"
              ></span>
            </span>
            <span
              class="node-text"
              :class="{ 'node-selected': selectedUid === data.uid && editingUid !== data.uid }"
              contenteditable="true"
              :data-uid="data.uid"
              @focus="onNodeFocus($event, data)"
              @blur="onNodeBlur($event, data)"
              @keydown.enter.prevent="onEnterKey($event, data)"
              @keydown.tab.prevent="onTabKey($event, data)"
              @keydown.backspace="onBackspace($event, data)"
              v-html="data.label"
            ></span>
            <img
              v-if="data.image"
              :src="data.image"
              class="node-image"
              :title="data.imageTitle || '节点图片'"
              @click.stop="onNodeImageDblclick(data, $event)"
            />
            <span
              v-if="data.assocTo && data.assocTo.length"
              class="node-assoc-badge"
              :title="'关联 → ' + data.assocTo.join('、')"
            >
              <svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M10.6 13.4a1 1 0 0 0 0 1.4 1 1 0 0 0 1.4 0l3-3a3 3 0 0 0-4.2-4.2l-1.4 1.4a1 1 0 0 0 1.4 1.4l1.4-1.4a1 1 0 0 1 1.4 1.4l-3 3zm2.8-2.8a1 1 0 0 0-1.4 0l-3 3a3 3 0 0 0 4.2 4.2l1.4-1.4a1 1 0 0 0-1.4-1.4l-1.4 1.4a1 1 0 0 1-1.4-1.4l3-3a1 1 0 0 0 0-1.4z"/></svg>
            </span>
            <span
              v-if="data.note"
              class="node-note-icon"
              :title="data.note"
              @click.stop="onNoteIconClick(data, $event)"
            >
              <!-- 与思维导图模式 simple-mind-map 内置备注图标（icons.note）保持一致 -->
              <svg viewBox="0 0 1024 1024" width="12" height="12"><path fill="currentColor" d="M152.768 985.984 152.768 49.856l434.56 0 66.816 0 234.048 267.392 0 66.816 0 601.92L152.768 985.984 152.768 985.984zM654.144 193.088l0 124.16 108.736 0L654.144 193.088 654.144 193.088zM821.312 384.064l-167.168 0L587.328 384.064 587.328 317.312 587.328 116.736 219.584 116.736 219.584 919.04l601.728 0L821.312 384.064 821.312 384.064zM386.688 517.888 319.808 517.888 319.808 450.944l66.816 0L386.624 517.888 386.688 517.888zM386.688 651.584 319.808 651.584 319.808 584.704l66.816 0L386.624 651.584 386.688 651.584zM386.688 785.344 319.808 785.344l0-66.88 66.816 0L386.624 785.344 386.688 785.344 386.688 785.344zM721.024 517.888 453.632 517.888 453.632 450.944l267.392 0L721.024 517.888 721.024 517.888zM654.144 651.584 453.632 651.584 453.632 584.704l200.512 0L654.144 651.584 654.144 651.584zM620.672 785.344l-167.04 0 0-66.88 167.04 0L620.672 785.344 620.672 785.344z"/></svg>
            </span>
            <!-- 概括标记：显示在被概括节点旁，点击弹出悬浮编辑窗 -->
            <span
              v-if="data.generalizations && data.generalizations.length"
              class="node-generalization"
              :class="{ 'has-range': data.generalizations[0].hasRange }"
              :title="(data.generalizations[0].hasRange ? '子节点概括：' : '概括：') + (data.generalizations[0].text || '（空）点击编辑')"
              @click.stop="onGeneralizationClick(data, $event)"
            >
              <span class="ng-brace">}</span>
              <span class="ng-text">{{ data.generalizations[0].text || '概括' }}</span>
              <img
                v-if="data.generalizations[0].image"
                :src="data.generalizations[0].image"
                class="node-gen-image"
                :title="data.generalizations[0].imageTitle || '概括图片'"
                @click.stop="onNodeImageDblclick({ image: data.generalizations[0].image, imageTitle: data.generalizations[0].imageTitle }, $event)"
              />
            </span>
          </span>
        </template>
      </el-tree>
    </div>

    <!-- 右键菜单 -->
    <Contextmenu
      :visible="contextmenuVisible"
      :left="contextmenuLeft"
      :top="contextmenuTop"
      :type="contextmenuType"
      :node="contextmenuNode"
      :mindMap="props.mindMap"
      :exec-mode="false"
      @close="contextmenuVisible = false"
      @select="onContextmenuSelect"
      @ai-continue="onAiContinue"
      @ai-add-child="onAiAddChild"
      @ai-rewrite="onAiRewrite"
      @ai-cloze="onAiCloze"
      @ai-cloze-full-map="onAiClozeFullMap"
      @reorganize-mindmap="onReorganizeMindmap"
      @ai-quiz="onAiQuiz"
      @ai-add-to-chat="onAiAddToChat"
      @add-review="onAddReview"
      @add-tag="onAddTag"
      @toggle-cloze="onToggleCloze"
      @toggle-cloze-all="onToggleClozeAll"
      @clear-all-cloze="onClearAllCloze"
      @node-note="onNodeNote"
    />

    <!-- 节点备注编辑弹窗（悬浮于节点旁，与思维导图模式一致） -->
    <NoteDialog
      :visible="noteDialogVisible"
      :initial-text="noteDialogText"
      :node-name="noteDialogNodeName"
      :multi-count="noteDialogNodes.length"
      :pos="noteDialogPos"
      @save="onNoteSave"
      @clear="onNoteClear"
      @close="noteDialogVisible = false"
    />

    <!-- 节点概括编辑弹窗（悬浮于概括标记旁） -->
    <NoteDialog
      :visible="genDialogVisible"
      :initial-text="genDialogText"
      :node-name="genDialogNodeName"
      :pos="genDialogPos"
      title-text="节点概括"
      placeholder="输入概括内容（支持多行），显示在节点旁"
      clear-label="清除概括"
      @save="onGenSave"
      @clear="onGenClear"
      @close="genDialogVisible = false"
    />

    <!-- 引用悬浮/固定预览（Teleport 到 body，避免大纲隐藏时 display:none） -->
    <Teleport to="body">
      <PreviewOverlay
        :visible="previewVisible"
        :file-path="previewFilePath"
        :node-uid="previewNodeUid"
        :pos="previewPos"
        :pinned="previewPinned"
        @hide="previewVisible = false"
        @open-file="onOutlinePreviewOpenFile"
        @stay="onOutlinePreviewStay"
        @interacting="onOutlinePreviewInteracting"
      />
    </Teleport>

    <!-- 节点图片全屏查看（大纲模式） -->
    <Teleport to="body">
      <Transition name="outline-img-viewer">
        <div v-if="imageViewerVisible" class="outline-img-viewer-mask" @click="imageViewerVisible = false">
          <img :src="imageViewerSrc" :alt="imageViewerTitle" class="outline-img-viewer-img" @click.stop />
          <button class="outline-img-viewer-close" title="关闭" @click="imageViewerVisible = false">✕</button>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup>
import { ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { ElMessage } from 'element-plus'
import { createUid, textToNodeRichTextWithWrap, getTextFromHtml, checkIsNodeStyleDataKey } from 'simple-mind-map/src/utils'
import TextToolbar from './TextToolbar.vue'
import OutlineToolbar from './OutlineToolbar.vue'
import Contextmenu from './Contextmenu.vue'
import NoteDialog from './NoteDialog.vue'
import PreviewOverlay from './PreviewOverlay.vue'
import { applyTextStyleToNodes, ensureIsolatedInlineSpan, setTextDecorationToken } from '../utils/textStyle'
import { legacyTableHtmlToText } from '../utils/markdownParser'
import { clonePlainTree } from '../utils/treeUtils'
import Tribute from 'tributejs'
import 'tributejs/dist/tribute.css'
import {
  scanFiles, scanNodes, filterFiles, filterNodes, getDisplayName,
  buildFileLink, buildNodeLink, parseReferenceLink, isReferenceLink
} from '../services/referenceService'
import {
  convertOutlineClozeSyntax,
  revertOutlineClozeSyntax,
  isClozeHiddenAll,
  isUidClozeHidden,
  toggleClozeByUid,
  toggleAllCloze,
  setAllClozeHidden,
  applyClozeStylesToElement,
  applyNestedClozeStylesToElement,
  isNestedClozeEl,
  removeClozeSpansBalanced,
  clearAllCloze,
  resetClozeState,
  saveClozeState
} from '../utils/cloze'
import { sanitizeSafeHtml } from '../utils/sanitizeHtml'
import { buildTriModeHtml } from '../utils/triModeExport'
import { buildGraphDataFromRaw, downloadGraphHtml } from '../utils/graphExport'
import { safeExportSvg } from '../utils/safeExportSvg'

/**
 * 将大纲 contenteditable 的 innerHTML 转换为思维导图富文本格式
 * 1. 将 [==text==] 标记转为 <span class="smm-cloze">text</span>
 * 2. 使用 textToNodeRichTextWithWrap 确保 <p><span> 包裹
 * 3. 如果已含 HTML 元素（如引用链接），直接包裹在 <p> 中
 */
const outlineHtmlToRichText = (html) => {
  if (!html || !html.trim()) return '<p><span></span></p>'
  // 先把 [==text==] 转为 <span class="smm-cloze">text</span>
  let converted = convertOutlineClozeSyntax(html)
  // 规范化挖空 span 开标签：剥离挖空显隐状态写入的内联样式/属性（innerHTML 会序列化 style）
  converted = converted.replace(/<span\b[^>]*>/gi, (tag) =>
    /smm-cloze/.test(tag) ? '<span class="smm-cloze">' : tag
  )
  // 检查是否已含 HTML 元素
  const div = document.createElement('div')
  div.innerHTML = converted
  let hasHtmlElement = false
  for (let i = div.childNodes.length - 1; i >= 0; i--) {
    if (div.childNodes[i].nodeType === 1) { hasHtmlElement = true; break }
  }
  if (hasHtmlElement) {
    // 已含 HTML（引用链接、挖空 span 等），确保用 <p> 包裹
    if (!/<p[\s>]/i.test(converted)) {
      converted = '<p>' + converted + '</p>'
    }
    return converted
  }
  // 纯文本：使用 textToNodeRichTextWithWrap 转 <p><span>text</span></p>
  // 但 textToNodeRichTextWithWrap 会 strip HTML，所以需要先标记挖空位置
  // 先把 [==text==] 提取出来，对纯文本做 wrap，再插入挖空 span
  const plainText = div.textContent || div.innerText || ''
  if (!plainText.trim()) return '<p><span></span></p>'
  // 检查是否有挖空标记
  const hasClozeMarker = /\[==[\s\S]+?==\]/.test(html)
  if (hasClozeMarker) {
    // 有挖空标记：先把标记转为占位符，wrap 后再替换回来
    const markers = []
    let textWithPlaceholders = html.replace(/\[==([\s\S]+?)==\]/g, (m, inner) => {
      const placeholder = `\x00CLOZE${markers.length}\x00`
      markers.push(getTextFromHtml(inner))
      return placeholder
    })
    // 获取纯文本（去除 HTML 标签）
    const tempDiv = document.createElement('div')
    tempDiv.innerHTML = textWithPlaceholders
    const plainWithPlaceholders = tempDiv.textContent || tempDiv.innerText || ''
    // 使用 textToNodeRichTextWithWrap 转 <p><span>text</span></p>
    const wrapped = textToNodeRichTextWithWrap(plainWithPlaceholders)
    // 把占位符替换回 <span class="smm-cloze">
    let result = wrapped
    markers.forEach((text, i) => {
      const placeholder = `\x00CLOZE${i}\x00`
      result = result.split(placeholder).join('<span class="smm-cloze">' + text + '</span>')
    })
    return result
  }
  // 无挖空标记的纯文本
  return textToNodeRichTextWithWrap(plainText)
}

const props = defineProps({
  mindMap: {
    type: Object,
    default: null
  },
  visible: {
    type: Boolean,
    default: true
  },
  currentFileName: {
    type: String,
    default: ''
  },
  // 当前导图数据（App 层同步维护）：思维导图实例未就绪/隐藏容器渲染异常时的兜底数据源
  mindMapData: {
    type: Object,
    default: null
  },
  // 全屏状态（由父组件控制，分屏模式下全局共用全屏按钮）
  fullscreen: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits([
  'ai-continue',
  'ai-add-child',
  'ai-rewrite',
  'ai-cloze',
  'ai-cloze-full-map',
  'reorganize-mindmap',
  'ai-quiz',
  'ai-add-to-chat',
  'add-review',
  'add-tag',
  'open-reference-file',
  'fullscreen-change'
])

const treeRef = ref(null)
const treeData = ref([])
const defaultProps = { label: 'label', children: 'children' }

// 全屏展示（与思维导图模式一致）：整个界面只保留大纲，ESC 或再次点击退出
const isFullscreen = ref(false)
const toggleFullscreen = () => setFullscreen(!isFullscreen.value)
const setFullscreen = (v) => {
  const next = !!v
  if (next === isFullscreen.value) return
  isFullscreen.value = next
  emit('fullscreen-change', next)
}

// 监听父组件传入的 fullscreen prop（分屏模式下由全局按钮控制）
watch(() => props.fullscreen, (v) => {
  if (v !== isFullscreen.value) {
    setFullscreen(v)
  }
}, { immediate: true })
const onFullscreenKeydown = (e) => {
  if (e.key === 'Escape' && isFullscreen.value) {
    e.stopPropagation()
    setFullscreen(false)
  }
}
window.addEventListener('keydown', onFullscreenKeydown, true)
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onFullscreenKeydown, true)
})

// 挖空隐藏状态（大纲模式）
const clozeHidden = ref(true)
const onClozeStateChanged = () => {
  clozeHidden.value = isClozeHiddenAll()
  applyOutlineClozeStyles()
}

/* ============================================================
 * 大纲模式挖空
 * ============================================================ */

/**
 * 将按 uid 的挖空显隐状态应用到大纲 DOM
 * v-html 渲染后 .smm-cloze 无状态，需要每次刷新后重新应用
 */
const applyOutlineClozeStyles = () => {
  const container = treeRef.value?.$el
  if (!container) return
  const els = container.querySelectorAll('.smm-cloze')
  els.forEach((span) => {
    const nodeEl = span.closest('[data-uid]')
    const uid = nodeEl?.dataset?.uid || ''
    if (isNestedClozeEl(span)) {
      applyNestedClozeStylesToElement(span, isUidClozeHidden(uid))
    } else {
      applyClozeStylesToElement(span, uid, isUidClozeHidden(uid))
    }
  })
}

/**
 * 点击挖空文字：切换该节点挖空显隐（捕获阶段，阻止进入编辑）
 */
const onTreeClickCapture = (e) => {
  const clozeEl = e.target?.closest?.('.smm-cloze')
  if (!clozeEl) return
  const nodeTextEl = clozeEl.closest('.node-text')
  if (!nodeTextEl) return
  e.preventDefault()
  e.stopPropagation()
  const uid = nodeTextEl.dataset?.uid
  if (!uid) return
  toggleClozeByUid(uid)
  // 点击挖空只做显隐切换，不进入编辑：blur 触发编辑内容保存
  if (document.activeElement === nodeTextEl) nodeTextEl.blur()
  applyOutlineClozeStyles()
}

// document 捕获兜底：确保挖空点击即使不落在 tree-container 上也能切换显隐。
const onDocumentClozeClick = (e) => {
  const clozeEl = e.target?.closest?.('.smm-cloze')
  if (!clozeEl) return
  const nodeTextEl = clozeEl.closest('.node-text')
  if (!nodeTextEl) return
  e.preventDefault()
  e.stopPropagation()
  const uid = nodeTextEl.dataset?.uid
  if (!uid) return
  toggleClozeByUid(uid)
  if (document.activeElement === nodeTextEl) nodeTextEl.blur()
  applyOutlineClozeStyles()
}

// 阻止挖空文字被浏览器双击选词/聚焦拖拽选中，快速点击显隐时不会留下蓝色选区。
const onDocumentClozeMousedown = (e) => {
  const clozeEl = e.target?.closest?.('.smm-cloze')
  if (!clozeEl) return
  e.preventDefault()
  e.stopPropagation()
}

/** 解开 DOM 中的挖空 span（保留内容） */
const unwrapClozeElement = (el) => {
  const parent = el.parentNode
  if (!parent) return
  while (el.firstChild) parent.insertBefore(el.firstChild, el)
  parent.removeChild(el)
}

/**
 * 整节点挖空切换（直接修改 renderTree 数据）
 * 已有挖空则移除，否则把全部文本包进 smm-cloze span
 */
const toggleClozeWholeNodeByUid = (uid) => {
  if (!props.mindMap?.renderer?.renderTree) return
  ensureUids()
  const result = findNodeAndParent(props.mindMap.renderer.renderTree, uid)
  if (!result) return

  let text = result.node.data.text || ''
  const hasCloze = /<span[^>]*smm-cloze[^>]*>/.test(text)
  if (hasCloze) {
    text = removeClozeSpansBalanced(text)
  } else if (text.includes('<')) {
    text = text.replace(
      /(<p[^>]*>)([\s\S]*?)(<\/p>)/gi,
      (m, open, inner, close) => open + '<span class="smm-cloze">' + inner + '</span>' + close
    )
  } else {
    const escaped = String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
    text = '<p><span class="smm-cloze">' + escaped + '</span></p>'
  }
  result.node.data.text = text
  result.node.data.richText = true
  commitData(uid)
}

/**
 * Ctrl+H 挖空快捷键
 * 编辑态 + 有选区 → 切换选区挖空；否则 → 整节点挖空切换
 */
const onClozeHotkey = () => {
  const focusEl = document.activeElement
  const sel = window.getSelection()
  const isEditingNodeText =
    focusEl && focusEl.classList?.contains('node-text') && focusEl.isContentEditable

  if (
    isEditingNodeText &&
    sel && sel.rangeCount > 0 && !sel.isCollapsed &&
    focusEl.contains(sel.anchorNode)
  ) {
    const anchorEl = sel.anchorNode?.nodeType === 1 ? sel.anchorNode : sel.anchorNode?.parentElement
    const existing = anchorEl?.closest?.('.smm-cloze')
    if (existing && focusEl.contains(existing)) {
      unwrapClozeElement(existing)
    } else {
      const range = sel.getRangeAt(0)
      const frag = range.extractContents()
      const span = document.createElement('span')
      span.className = 'smm-cloze'
      span.appendChild(frag)
      range.insertNode(span)
    }
    // 复用 blur 保存逻辑把 DOM 写回 mind-map 数据
    const uid = focusEl.dataset?.uid
    const data = uid ? findNodeInTree(treeData.value, uid) : null
    if (data) onNodeBlur({ target: focusEl }, data)
    nextTick(() => applyOutlineClozeStyles())
    return
  }

  const uid = selectedUid.value || editingUid.value
  if (uid) toggleClozeWholeNodeByUid(uid)
}

/** 右键菜单：添加/移除挖空标记 */
const onToggleCloze = () => {
  const uid = contextmenuUid.value || selectedUid.value || editingUid.value
  if (uid) toggleClozeWholeNodeByUid(uid)
}

/** 右键菜单：显示/隐藏全部挖空 */
const onToggleClozeAll = () => {
  toggleAllCloze()
  nextTick(() => applyOutlineClozeStyles())
}

/** 右键菜单：清除全文挖空（操作 mindMap 数据，大纲树经 node_tree_render_end 自动刷新） */
const onClearAllCloze = () => {
  const count = clearAllCloze()
  resetClozeState()
  saveClozeState()
  if (count > 0) {
    try { ElMessage.success(`已清除 ${count} 个节点的挖空`) } catch (e) {}
  } else {
    try { ElMessage.info('当前导图没有挖空标记') } catch (e) {}
  }
  nextTick(() => applyOutlineClozeStyles())
}

// 文字编辑工具栏
const textToolbarVisible = ref(false)
const isToolbarInteracting = ref(false)  // 工具栏正在交互（颜色选择器/字号菜单打开中）
let blurTimer = null

// 工具栏交互事件：颜色选择器/字号菜单打开时，阻止 blur 计时器隐藏工具栏
const onToolbarInteractStart = () => {
  isToolbarInteracting.value = true
  if (blurTimer) {
    clearTimeout(blurTimer)
    blurTimer = null
  }
}

const onToolbarInteractEnd = () => {
  isToolbarInteracting.value = false
}

// 右键菜单
const contextmenuVisible = ref(false)
const contextmenuLeft = ref(0)
const contextmenuTop = ref(0)
const contextmenuType = ref('node') // 'node' | 'svg'
const contextmenuNode = ref(null)
const contextmenuUid = ref(null) // 大纲节点 uid（用于直接数据操作）

// 剪贴板（本组件内）
let clipboardData = null

// 编辑状态追踪
const editingUid = ref(null)    // 正在编辑的节点 uid
const selectedUid = ref(null)   // 选中但未编辑的节点 uid（新增节点）
const pendingSelectUid = ref(null)  // 刷新后需要选中的节点
const pendingEditUid = ref(null)    // 刷新后需要恢复编辑状态的节点（Tab/Shift+Tab 操作）
const pendingEditCaretAtEnd = ref(false) // 恢复编辑时光标置于末尾（而非全选），用于删除空节点后的聚焦
let isPerformingTabOp = false        // Tab/Shift+Tab 操作进行中，阻止 onNodeBlur 干扰
// Backspace 长按保护锁：删除空节点后置 true，退格键松开（keyup）前阻止一切删除动作，
// 防止焦点跳到上一节点后继续长按清空其文字（"穿透删除"）
let backspaceHoldLock = false
// 跨节点删除"停顿"标记：记录已按过一次 Backspace 但尚未执行的节点 uid。
// 光标在节点最前面（或节点已空）时，第一次按下只标记不删除，
// 松开后再次按下才真正删除该节点并把光标交还给上一节点。
let armedBackspaceUid = null

// 标志位：避免自身操作触发的 data_change 导致重复刷新
let notHandleDataChange = false

/* ============================================================
 * Tribute.js 引用功能
 * ============================================================ */
let tributeInstance = null
// 缓存文件/节点列表，避免每次输入都重新扫描
let cachedFiles = []
let cachedNodes = []
let cacheTimer = null

/**
 * 初始化 Tribute 实例
 * 两个 collection：@ 触发文件搜索，# 触发节点搜索
 */
const initTribute = () => {
  tributeInstance = new Tribute({
    collection: [
      // @ 文件引用
      {
        trigger: '@',
        values: async (text, cb) => {
          if (cachedFiles.length === 0) {
            cachedFiles = await scanFiles()
          }
          cb(filterFiles(cachedFiles, text))
        },
        lookup: 'name',
        fillAttr: 'name',
        selectTemplate: (item) => {
          if (!item?.original) return ''
          const displayText = getDisplayName(item.original.name)
          const linkUrl = buildFileLink(item.original.path)
          return `<span contenteditable="false" class="ref-tag"><a href="${linkUrl}">${displayText}</a></span>&nbsp;`
        },
        menuItemTemplate: (item) => {
          return `<span class="ref-menu-icon">📄</span> <span>${item.original.name}</span> <span class="ref-menu-meta">${item.original.parentName || ''}</span>`
        },
        noMatchTemplate: () => '<span class="ref-no-match">未找到匹配文件</span>'
      },
      // # 节点引用
      {
        trigger: '#',
        values: async (text, cb) => {
          if (cachedNodes.length === 0) {
            cachedNodes = await scanNodes()
          }
          cb(filterNodes(cachedNodes, text))
        },
        lookup: 'fullPath',
        fillAttr: 'name',
        selectTemplate: (item) => {
          if (!item?.original) return ''
          const displayText = `${item.original.fileName}：${item.original.name}`
          const linkUrl = buildNodeLink(item.original.filePath, item.original.nodeUid)
          return `<span contenteditable="false" class="ref-tag"><a href="${linkUrl}">${displayText}</a></span>&nbsp;`
        },
        menuItemTemplate: (item) => {
          return `<span class="ref-menu-icon">🔗</span> <span>${item.original.name}</span> <span class="ref-menu-meta">${item.original.fileName || ''}</span>`
        },
        noMatchTemplate: () => '<span class="ref-no-match">未找到匹配节点</span>'
      }
    ],
    // 搜索时显示的菜单项数量
    menuItemLimit: 20,
    // 菜单样式类
    menuContainer: document.body,
    // 替换触发字符和搜索文本
    requireLeadingSpace: false,
    replaceTextSuffix: ''
  })
}

/**
 * 将 Tribute 绑定到所有 contenteditable 节点
 * 在树渲染完成后调用
 */
const attachTributeToNodes = () => {
  if (!tributeInstance) return
  const container = treeRef.value?.$el
  if (!container) return

  const elements = container.querySelectorAll('.node-text[contenteditable="true"]')
  elements.forEach((el) => {
    // 检查是否已绑定
    if (el.dataset.tributeAttached) return
    tributeInstance.attach(el)
    el.dataset.tributeAttached = 'true'
  })
}

/**
 * 刷新缓存（定时清理，确保新文件能被搜索到）
 */
const refreshCache = () => {
  cachedFiles = []
  cachedNodes = []
}

/* ============================================================
 * 数据转换工具
 * ============================================================ */

const transformData = (node) => {
  if (!node) return null
  const nodeData = node.data || {}
  // 概括：无 range 为节点自身概括，有 range 为指定子节点区间的概括，均挂在节点 data.generalization
  const rawGens = Array.isArray(nodeData.generalization)
    ? nodeData.generalization
    : (nodeData.generalization ? [nodeData.generalization] : [])
  const result = {
    uid: nodeData.uid || createUid(),
    // 大纲中使用 [==text==] 语法显示挖空
    label: sanitizeSafeHtml(revertOutlineClozeSyntax(nodeData.text || '')),
    children: [],
    // 保留思维导图的折叠状态（expand=false 表示已折叠），refresh 后据此恢复 el-tree 折叠
    expand: nodeData.expand === false ? false : true,
    note: nodeData.note || '',
    outerFrame: nodeData.outerFrame || null,
    assocTargets: Array.isArray(nodeData.associativeLineTargets) ? nodeData.associativeLineTargets : [],
    // 节点图片：大纲模式同样以缩略图显示（与思维导图模式的 SET_NODE_IMAGE 对应）
    image: nodeData.image || '',
    imageTitle: nodeData.imageTitle || '',
    generalizations: rawGens.map((g) => {
      const textHtml = String(g?.text || '')
      const plainText = (getTextFromHtml(textHtml) || textHtml.replace(/<[^>]+>/g, '')).trim()
      // 概括图片：优先概括节点自身 image 字段，其次从富文本里提取内嵌 <img>（粘贴的图片）
      let genImage = g?.image || ''
      if (!genImage) {
        const m = textHtml.match(/<img[^>]+src=["']([^"']+)["']/i)
        genImage = m ? m[1] : ''
      }
      return {
        text: plainText,
        hasRange: !!(g?.range && g.range.length > 0),
        image: genImage,
        imageTitle: g?.imageTitle || ''
      }
    })
  }
  if (node.children && node.children.length > 0) {
    result.children = node.children.map((child) => transformData(child)).filter(Boolean)
  }
  return result
}

/**
 * 装饰树数据：
 * 1. 关联线：把目标的 uid 解析成文本（悬停徽标显示）
 * 2. 外框：同一父节点下 groupId 相同的兄弟节点连成一组，标记 bracket 类名（start/mid/end/single）
 */
const decorateTreeData = (rootNode) => {
  const uidTextMap = {}
  const collect = (n) => {
    uidTextMap[n.uid] = getTextFromHtml(n.label || '') || ''
    n.children.forEach(collect)
  }
  collect(rootNode)

  const decorate = (n) => {
    if (n.assocTargets.length > 0) {
      n.assocTo = n.assocTargets.map((u) => uidTextMap[u]).filter(Boolean)
    }
    const groups = new Map()
    for (const child of n.children) {
      const g = child.outerFrame?.groupId
      if (!g) continue
      if (!groups.has(g)) groups.set(g, [])
      groups.get(g).push(child)
    }
    groups.forEach((list) => {
      for (const child of list) {
        const single = list.length === 1
        child.frameClass = single
          ? 'frame-single'
          : child === list[0] ? 'frame-start' : child === list[list.length - 1] ? 'frame-end' : 'frame-mid'
        const st = child.outerFrame || {}
        child.frameStyle = {
          borderColor: st.strokeColor || '#0984e3',
          borderStyle: st.strokeDasharray && st.strokeDasharray !== 'none' ? 'dashed' : 'solid'
        }
      }
    })
    n.children.forEach(decorate)
  }
  decorate(rootNode)
}

const transformToTreeData = (data) => {
  if (!data) return []
  const root = transformData(data)
  if (root) decorateTreeData(root)
  return root ? [root] : []
}

/**
 * 确保思维导图数据树中每个节点都有 uid
 * 如果节点缺少 data.uid，则分配一个新 uid
 * 这保证了树数据的 uid 与思维导图数据 uid 一致，
 * 使得 findNodeAndParent 能正确找到节点
 */
const ensureUids = () => {
  if (!props.mindMap || !props.mindMap.renderer || !props.mindMap.renderer.renderTree) return
  const walk = (node) => {
    if (!node) return
    if (!node.data) node.data = {}
    if (!node.data.uid) {
      node.data.uid = createUid()
    }
    if (!node.data.richText) node.data.richText = true
    if (node.data.text && /<table\b/i.test(node.data.text)) {
      node.data.text = legacyTableHtmlToText(node.data.text)
    }
    if (node.data.text && !node.data.text.startsWith('<')) {
      node.data.text = `<p><span>${node.data.text}</span></p>`
    }
    if (node.children) {
      node.children = node.children.filter(c => c && c.data)
      node.children.forEach(walk)
    }
  }
  walk(props.mindMap.renderer.renderTree)
}

/**
 * 在 mind-map 数据树中递归查找节点及其父节点
 * 返回 { node, parent } 或 null
 */
// 从 mindMap 数据树节点构建带 parent 链的兼容节点（供 AI 工具/复习计划使用）
const buildCompatibleNode = (dataNode, parent = null) => {
  if (!dataNode) return null
  const node = {
    data: dataNode.data || {},
    uid: dataNode.data && dataNode.data.uid,
    parent: parent || null,
    children: []
  }
  if (Array.isArray(dataNode.children)) {
    node.children = dataNode.children
      .map((ch) => buildCompatibleNode(ch, node))
      .filter(Boolean)
  }
  return node
}

const findNodeAndParent = (data, uid, parent = null) => {
  if (!data) return null
  if (data.data?.uid === uid) return { node: data, parent }
  if (data.children) {
    for (const child of data.children) {
      const result = findNodeAndParent(child, uid, data)
      if (result) return result
    }
  }
  return null
}

/* ============================================================
 * 刷新 & 事件监听
 * ============================================================ */

// 监听 mindMap 实例变化（切换 Tab 时 mindMap 实例会变），自动刷新大纲数据
watch(() => props.mindMap, (newMindMap, oldMindMap) => {
  if (newMindMap !== oldMindMap && newMindMap && props.visible) {
    unregisterListeners(oldMindMap)
    registerListeners(newMindMap)
    nextTick(() => refresh())
  }
})

const refresh = () => {
  // 优先从思维导图实例取数据（保持 uid 一致）；实例未就绪/隐藏容器渲染异常时
  // 回退到 App 层同步维护的 mindMapData，保证大纲不出现 "no data"
  let data = null
  if (props.mindMap && props.mindMap.renderer && props.mindMap.renderer.renderTree) {
    // 确保内部 renderTree 中每个节点都有 uid（getData 返回深拷贝，需修改原始数据）
    try {
      ensureUids()
      data = props.mindMap.getData() || null
    } catch (e) {
      data = null
    }
  }
  if (!data || !data.data) data = props.mindMapData || null
  // 记录待选节点：折叠恢复时保持其祖先链展开，保证新节点可见
  const focusUidForExpand = pendingSelectUid.value
  if (data) {
    treeData.value = transformToTreeData(clonePlainTree(data))
  }

  // 刷新后选中待选节点
  if (pendingSelectUid.value) {
    const uid = pendingSelectUid.value
    pendingSelectUid.value = null
    const shouldRestoreEdit = pendingEditUid.value === uid
    if (shouldRestoreEdit) pendingEditUid.value = null
    const caretAtEnd = pendingEditCaretAtEnd.value
    if (shouldRestoreEdit) pendingEditCaretAtEnd.value = false
    nextTick(() => {
      if (treeRef.value) {
        treeRef.value.setCurrentKey(uid)
      }
      selectedUid.value = uid
      // Tab/Shift+Tab 后恢复编辑状态，全选文字方便替换
      if (shouldRestoreEdit) {
        isPerformingTabOp = false
        editingUid.value = uid
        textToolbarVisible.value = true
        nextTick(() => {
          const el = treeRef.value?.$el?.querySelector(`[data-uid="${uid}"]`)
          if (el) {
            el.focus()
            const range = document.createRange()
            range.selectNodeContents(el)
            // caretAtEnd（如删除空节点后聚焦上一节点）：光标放末尾，
            // 避免全选状态下再按一次退格一键清空整个节点
            range.collapse(!caretAtEnd)
            const sel = window.getSelection()
            sel.removeAllRanges()
            sel.addRange(range)
          }
        })
      }
    })
  }

  // 树渲染完成后绑定 Tribute 到新增的 contenteditable 节点，并应用挖空显隐样式
  nextTick(() => {
    // 恢复折叠状态：treeData 整体替换会让 el-tree（default-expand-all）重建并全部展开，
    // 已折叠的节点被意外展开（表现为"回车后折叠丢失"），按数据中的 expand=false 重新收起
    restoreCollapsedState(focusUidForExpand)
    attachTributeToNodes()
    applyOutlineClozeStyles()
  })
}

/**
 * 按 treeData 中的 expand 字段恢复 el-tree 的折叠状态：
 * expand=false 的节点重新 collapse；待选节点（新创建节点）的祖先链保持展开，
 * 避免新节点落在折叠子树内不可见
 */
const restoreCollapsedState = (focusUid = null) => {
  try {
    const tree = treeRef.value
    if (!tree || !tree.store || !tree.store.root) return
    // 收集待选节点的祖先 uid，保持展开
    const keepExpanded = new Set()
    if (focusUid) {
      const collectAncestors = (n) => {
        if (!n || !n.data || !n.data.uid) return
        if (n.data.uid === focusUid) throw new Error('found')
        ;(n.children || []).forEach(collectAncestors)
      }
      try {
        const walkData = (item) => {
          if (!item) return
          if (item.uid === focusUid) throw new Error('found')
          ;(item.children || []).forEach(walkData)
        }
        // 在 treeData 中找祖先链
        const findPath = (item, target, path) => {
          if (!item) return null
          if (item.uid === target) return [...path, item.uid]
          for (const c of (item.children || [])) {
            const r = findPath(c, target, path)
            if (r) return r
          }
          return null
        }
        for (const rootItem of treeData.value) {
          const p = findPath(rootItem, focusUid, [])
          if (p) { p.slice(0, -1).forEach(uid => keepExpanded.add(uid)); break }
        }
      } catch (e) { /* 未找到则不保持任何展开 */ }
    }
    const walk = (n) => {
      if (!n) return
      if (n.data && n.data.expand === false && !keepExpanded.has(n.data.uid) && n.childNodes && n.childNodes.length > 0) {
        if (n.expanded && typeof n.collapse === 'function') n.collapse()
      }
      ;(n.childNodes || []).forEach(walk)
    }
    tree.store.root.childNodes.forEach(walk)
  } catch (e) {
    // 恢复失败不影响主流程
  }
}

const handleDataChange = () => {
  if (notHandleDataChange) {
    notHandleDataChange = false
    return
  }
  refresh()
}

const handleNodeTreeRenderEnd = () => {
  if (notHandleDataChange) {
    notHandleDataChange = false
    return
  }
  refresh()
}

const registerListeners = (mindMap) => {
  if (!mindMap) return
  mindMap.on('data_change', handleDataChange)
  mindMap.on('node_tree_render_end', handleNodeTreeRenderEnd)
}

const unregisterListeners = (mindMap) => {
  if (!mindMap) return
  mindMap.off('data_change', handleDataChange)
  mindMap.off('node_tree_render_end', handleNodeTreeRenderEnd)
}

/* ============================================================
 * 节点编辑：焦点 / 失焦
 * ============================================================ */

const onNodeFocus = (event, data) => {
  editingUid.value = data.uid
  selectedUid.value = null
  // 进入编辑时重置跨节点删除的"停顿"标记：
  // - 空节点：预置标记，使第一次 Backspace 就能删掉它（新建空节点后按一下即删，保持原手感）；
  // - 有内容节点：清空标记，必须先停顿一次才能跨节点删除，避免误删整段文字。
  armedBackspaceUid = isNodeEmpty(event?.target) ? data.uid : null
  if (blurTimer) {
    clearTimeout(blurTimer)
    blurTimer = null
  }
  textToolbarVisible.value = true
}

const onNodeBlur = (event, data) => {
  editingUid.value = null
  // 工具栏正在交互时不隐藏（颜色选择器/字号菜单打开中）
  if (!isToolbarInteracting.value) {
    blurTimer = setTimeout(() => {
      textToolbarVisible.value = false
    }, 200)
  }

  // Tab/Shift+Tab 操作期间 contenteditable 会被重建触发 blur，
  // 此时文本已由操作函数保存到 mindMap 数据，跳过避免干扰
  if (isPerformingTabOp) return

  const rawHtml = event.target.innerHTML.trim()
  if (!props.mindMap) return

  // 转换为思维导图富文本格式（含 [==text==] → smm-cloze span 转换）
  const richText = outlineHtmlToRichText(rawHtml)
  // 大纲显示用的 label（把 smm-cloze span 转回 [==text==] 标记）
  const outlineLabel = sanitizeSafeHtml(revertOutlineClozeSyntax(richText))
  if (outlineLabel === data.label) return

  const node = props.mindMap.renderer.findNodeByUid(data.uid)
  if (node) {
    notHandleDataChange = true
    // 使用 setText 触发节点重新渲染，确保富文本和挖空样式正确应用
    node.setText(richText, true)
    data.label = outlineLabel
    // 确保渲染后应用挖空样式
    setTimeout(() => {
      if (props.mindMap) props.mindMap.render()
    }, 50)
  }
}

/* ============================================================
 * el-tree 选中变化
 * ============================================================ */

const onCurrentChange = (data) => {
  if (!editingUid.value) {
    selectedUid.value = data.uid
  }
}

/* ============================================================
 * 树级键盘：Tab/Enter/打字进入编辑
 * 参考幕布思维导图快捷键行为
 * ============================================================ */

/* ============================================================
 * 引用块原子删除：Backspace/Delete 一下删除整个 ref-tag
 * ============================================================ */

const getAdjacentRefTag = (textEl, container, offset, dir) => {
  const childNodes = Array.from(textEl.childNodes)
  let idx = -1
  if (container === textEl) {
    idx = offset // 元素节点内偏移即子节点索引
  } else {
    idx = childNodes.indexOf(container)
  }
  if (idx === -1) return null
  const target = dir === 'prev' ? childNodes[idx - 1] : childNodes[idx]
  return target && target.nodeType === 1 && target.classList?.contains('ref-tag') ? target : null
}

const deleteRefTagAtomically = (event) => {
  try {
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return false
    const range = sel.getRangeAt(0)
    const container = range.startContainer
    const parentEl = container.nodeType === 3 ? container.parentElement : container
    const textEl = parentEl?.closest?.('.node-text')
    if (!textEl) return false

    let refEl = null
    if (event.key === 'Backspace') {
      // 光标前是普通文字时走默认逐字删除
      if (container.nodeType === 3 && range.startOffset > 0) return false
      refEl = getAdjacentRefTag(textEl, container, range.startOffset, 'prev')
    } else {
      if (container.nodeType === 3 && range.startOffset < (container.length || 0)) return false
      refEl = getAdjacentRefTag(textEl, container, range.startOffset, 'next')
    }
    if (!refEl) return false

    event.preventDefault()
    refEl.remove()
    // 触发 input 事件让编辑内容保存逻辑生效
    textEl.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  } catch (e) {
    return false
  }
}

const onTreeKeydown = (event) => {
  // ESC 取消格式刷（编辑态/非编辑态均生效）
  if (event.key === 'Escape' && painterActive.value) {
    event.preventDefault()
    exitFormatPainter('已取消格式刷')
    return
  }
  // Ctrl+H / Cmd+H：挖空快捷键（编辑态与非编辑态都可用）
  if ((event.ctrlKey || event.metaKey) && (event.key === 'h' || event.key === 'H')) {
    event.preventDefault()
    // 阻止冒泡到 App.vue 的全局 Ctrl+H 处理器，避免同一次按键重复写入挖空数据
    event.stopPropagation()
    onClozeHotkey()
    return
  }
  // 引用块原子删除：Backspace/Delete 一下删除整个 ref-tag（编辑态）
  if (event.key === 'Backspace' || event.key === 'Delete') {
    if (deleteRefTagAtomically(event)) return
  } else {
    // 按下其它键（打字/方向键/粘贴等）说明用户已不在"停顿→跨节点删除"的连续操作中，
    // 清除停顿标记，避免之后在行首误删整个节点
    armedBackspaceUid = null
  }

  // 方向键：节点间导航（编辑态下光标处于行边界时跨节点移动）
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
    const isEditing = !!(editingUid.value || (event.target && event.target.isContentEditable))
    if (isEditing) {
      // 编辑态：↑ 光标在首行 / ↓ 光标在末行 / ← 光标在最前 / → 光标在最后 时跨节点，
      // 其余情况放行原生行为，让光标在文本内移动
      const textEl = (event.target.closest && event.target.closest('.node-text')) || document.activeElement
      const boundary = getCaretBoundary()
      const atStart = boundary ? boundary.atStart : false
      const atEnd = boundary ? boundary.atEnd : false
      let target = null
      if (event.key === 'ArrowUp' && isCaretOnLine(textEl, 'first')) {
        target = getArrowNavTarget('ArrowUp', true)
      } else if (event.key === 'ArrowDown' && isCaretOnLine(textEl, 'last')) {
        target = getArrowNavTarget('ArrowDown', true)
      } else if (event.key === 'ArrowLeft' && atStart) {
        target = getArrowNavTarget('ArrowLeft', true)
      } else if (event.key === 'ArrowRight' && atEnd) {
        target = getArrowNavTarget('ArrowRight', true)
      }
      if (!target) return
      event.preventDefault()
      // 先提交当前编辑（blur 触发 onNodeBlur 保存文本），再跨节点移动光标
      const activeEl = document.activeElement
      if (activeEl && activeEl.isContentEditable) activeEl.blur()
      nextTick(() => {
        const el = treeRef.value?.$el?.querySelector(`[data-uid="${target.uid}"]`)
        if (el) {
          placeCaretAt(el, target.caretAtEnd)
          el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
        } else {
          selectNodeByUid(target.uid)
        }
      })
      return
    }
    // 非编辑态：到边界（首个/末个节点）后保持不动，不再触发选中与滚动
    event.preventDefault()
    const target = getArrowNavTarget(event.key, false)
    if (target) selectNodeByUid(target.uid)
    return
  }

  // 正在编辑中 → 由 contenteditable 上的事件处理器接管
  if (editingUid.value) return
  // 目标已经是 contenteditable → 不干预（已由 @keydown 处理）
  if (event.target.isContentEditable) return

  // Tab 键：降级当前节点 / Shift+Tab 提升节点层级
  if (event.key === 'Tab') {
    event.preventDefault()
    const targetUid = editingUid.value || selectedUid.value
    if (!targetUid) return
    const target = findNodeInTree(treeData.value, targetUid)
    if (target) {
      onTabKey(event, target)
    }
    return
  }

  // Enter 键：插入兄弟节点
  if (event.key === 'Enter') {
    event.preventDefault()
    const targetUid = editingUid.value || selectedUid.value
    if (!targetUid) return
    const target = findNodeInTree(treeData.value, targetUid)
    if (target) {
      onEnter({ target: { innerText: target.label }, preventDefault: () => {} }, target)
    }
    return
  }

  // 没有选中节点 → 不处理
  if (!selectedUid.value) return
  // 只处理可打印字符（type-to-edit）
  if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) return

  event.preventDefault()
  const uid = selectedUid.value

  nextTick(() => {
    const el = treeRef.value?.$el?.querySelector(`[data-uid="${uid}"]`)
    if (el) {
      el.focus()
      el.innerText = event.key
      // 触发 input 事件，让 Tribute.js 能检测到 @ 或 # 触发字符
      el.dispatchEvent(new Event('input', { bubbles: true }))
      // 将光标移到末尾
      const range = document.createRange()
      range.selectNodeContents(el)
      range.collapse(false)
      const sel = window.getSelection()
      sel.removeAllRanges()
      sel.addRange(range)
    }
  })
}

/**
 * 判断光标是否处于 contenteditable 文本的最前/最后（用于方向键跨行导航判断）
 * 返回 null 表示无法判断（无光标/有选区/不在节点文本内）
 */
const getCaretBoundary = () => {
  try {
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return null
    const range = sel.getRangeAt(0)
    const container = range.startContainer
    const parentEl = container.nodeType === 3 ? container.parentElement : container
    const nodeText = parentEl?.closest?.('.node-text')
    if (!nodeText) return null

    // 用"光标前后的纯文本长度"判定边界，而不是 compareBoundaryPoints：
    // 节点内容是富文本（文字被 <span>/<b> 等标签包裹）时，光标位于内层文本节点的开头，
    // 用位置比较会判定成"不在最前面"（内层节点位置永远在容器起点之后），
    // 导致在第一个字前面按 Backspace 时无法触发跨节点删除。
    const preRange = document.createRange()
    preRange.selectNodeContents(nodeText)
    try {
      preRange.setEnd(range.startContainer, range.startOffset)
    } catch (e) {
      return null
    }
    const atStart = (preRange.toString() || '').length === 0

    const postRange = document.createRange()
    postRange.selectNodeContents(nodeText)
    try {
      postRange.setStart(range.endContainer, range.endOffset)
    } catch (e) {
      return null
    }
    const atEnd = (postRange.toString() || '').length === 0

    return { atStart, atEnd }
  } catch (e) {
    return null
  }
}

/**
 * 光标是否位于 contenteditable 文本的首行/末行（用于 ↑↓ 跨节点导航判断）
 * 取不到光标矩形（如空节点）时按单行处理，返回 true
 */
const isCaretOnLine = (el, which) => {
  try {
    if (!el || !el.isConnected) return false
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return false
    const range = sel.getRangeAt(0).cloneRange()
    let rect = range.getBoundingClientRect()
    if (!rect || (rect.top === 0 && rect.bottom === 0)) {
      const rects = range.getClientRects()
      rect = rects && rects.length ? rects[rects.length - 1] : null
    }
    if (!rect) return true
    const elRect = el.getBoundingClientRect()
    if (which === 'first') {
      return Math.abs(rect.top - elRect.top) < Math.max(4, rect.height / 2)
    }
    return Math.abs(rect.bottom - elRect.bottom) < Math.max(4, rect.height / 2)
  } catch (e) {
    return false
  }
}

/**
 * 把光标放到 contenteditable 节点文本的开头或末尾
 */
const placeCaretAt = (el, atEnd) => {
  try {
    el.focus()
    const range = document.createRange()
    range.selectNodeContents(el)
    range.collapse(!atEnd)
    const sel = window.getSelection()
    sel.removeAllRanges()
    sel.addRange(range)
  } catch (e) {}
}

/**
 * 方向键导航目标：
 * 编辑态（editing=true）：↑↓←→ 在可见节点列表中前后移动（光标落到对端）
 * 非编辑态：↑↓ 前后移动；← 折叠或回到父节点；→ 展开或进入首个子节点
 * 到达边界时返回 null（保持不动，不触发选中与滚动）
 */
const getArrowNavTarget = (key, editing) => {
  if (!treeRef.value) return null

  // 使用 el-tree store 获取所有可见节点
  const store = treeRef.value.store
  const nodes = []
  const walkStore = (node) => {
    if (!node) return
    if (node.level > 0 && node.data && node.visible !== false) {
      nodes.push(node)
    }
    if (node.expanded && node.childNodes) {
      node.childNodes.forEach(walkStore)
    }
  }
  if (store && store.root) {
    store.root.childNodes.forEach(walkStore)
  }

  if (nodes.length === 0) return null

  // 当前节点在列表中的位置
  const focusUid = editingUid.value || selectedUid.value
  const currentIndex = focusUid
    ? nodes.findIndex(n => n.data.uid === focusUid)
    : -1

  if (key === 'ArrowDown') {
    if (currentIndex >= nodes.length - 1) return null
    return { uid: nodes[currentIndex + 1]?.data?.uid, caretAtEnd: false }
  }
  if (key === 'ArrowUp') {
    if (currentIndex <= 0) return null
    return { uid: nodes[currentIndex - 1]?.data?.uid, caretAtEnd: true }
  }
  if (key === 'ArrowLeft') {
    if (editing) {
      if (currentIndex <= 0) return null
      return { uid: nodes[currentIndex - 1]?.data?.uid, caretAtEnd: true }
    }
    const current = currentIndex >= 0 ? nodes[currentIndex] : null
    if (current && current.childNodes && current.childNodes.length > 0 && current.expanded) {
      current.collapse()
    } else if (current && current.parent && current.parent.level > 0) {
      return { uid: current.parent.data?.uid, caretAtEnd: true }
    }
    return null
  }
  if (key === 'ArrowRight') {
    if (editing) {
      if (currentIndex >= nodes.length - 1) return null
      return { uid: nodes[currentIndex + 1]?.data?.uid, caretAtEnd: false }
    }
    const current = currentIndex >= 0 ? nodes[currentIndex] : null
    if (current && current.childNodes && current.childNodes.length > 0 && !current.expanded) {
      current.expand()
    } else if (current && current.childNodes && current.childNodes.length > 0) {
      return { uid: current.childNodes[0]?.data?.uid, caretAtEnd: false }
    }
    return null
  }
  return null
}

/**
 * 选中指定 uid 的节点
 */
const selectNodeByUid = (uid) => {
  if (!uid) return
  selectedUid.value = uid
  if (treeRef.value) {
    treeRef.value.setCurrentKey(uid)
  }
  nextTick(() => {
    const el = treeRef.value?.$el?.querySelector(`[data-uid="${uid}"]`)
    if (el) {
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  })
}

/* ============================================================
 * 快捷键操作（直接数据操作，不依赖 execCommand）
 * ============================================================ */

/**
 * 保存当前编辑文本到 mind-map 数据树
 */
const saveTextToData = (data, mindData) => {
  const result = findNodeAndParent(mindData, data.uid)
  if (result) {
    result.node.data.text = data.label
  }
}

/**
 * 从事件中获取节点文本（兼容编辑状态和非编辑状态）
 */
const getNodeText = (event, data) => {
  if (event.target && event.target.isContentEditable) {
    return event.target.innerHTML.trim()
  }
  return data.label || ''
}

/**
 * 在 mind-map 数据中查找节点及其父节点（多层回退策略）
 * 1. 先用 data.uid 在 getData() 副本中查找
 * 2. 如果找不到，用 renderer.findNodeByUid 在内部节点树中查找，获取真实 uid
 * 3. 用真实 uid 重新在 getData() 副本中查找
 * 4. 如果还找不到，按文本内容匹配
 */
const findNodeRobust = (uid, nodeText) => {
  if (!props.mindMap) return null
  const mindData = props.mindMap.getData()

  // 方法1: 直接用 uid 在数据副本中查找
  let result = findNodeAndParent(mindData, uid)
  if (result) return { result, mindData }

  // 方法2: 用 renderer 在内部节点树中查找，获取真实 uid
  if (props.mindMap.renderer) {
    const mindNode = props.mindMap.renderer.findNodeByUid(uid)
    if (mindNode) {
      const realUid = mindNode.getData('uid')
      if (realUid && realUid !== uid) {
        // 方法3: 用真实 uid 重新查找
        result = findNodeAndParent(mindData, realUid)
        if (result) return { result, mindData }
      }
    }
  }

  // 方法4: 按文本内容匹配（回退）
  if (nodeText) {
    const plainText = nodeText.replace(/<[^>]+>/g, '').trim()
    const findByText = (node, parent = null) => {
      if (!node) return null
      const text = (node.data?.text || '').replace(/<[^>]+>/g, '').trim()
      if (text === plainText) return { node, parent }
      if (node.children) {
        for (const child of node.children) {
          const r = findByText(child, node)
          if (r) return r
        }
      }
      return null
    }
    result = findByText(mindData)
    if (result) return { result, mindData }
  }

  return null
}

/**
 * 回车：插入兄弟节点
 * 直接修改 renderer.renderTree（源数据），避免 getData() 深拷贝导致 uid 丢失
 */
/**
 * 检查光标后是否有实际文字内容（用于富文本场景下更可靠的行尾判断）
 */
const hasTextAfterCaret = (el) => {
  try {
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return false
    const range = sel.getRangeAt(0)
    const afterRange = document.createRange()
    afterRange.setStart(range.startContainer, range.startOffset)
    afterRange.setEnd(el, el.childNodes.length)
    const testWrap = document.createElement('div')
    testWrap.appendChild(afterRange.cloneContents())
    return !!testWrap.textContent.trim()
  } catch (e) {
    return false
  }
}

// 编辑态回车：Shift+Enter 在当前节点内换行（插入 <br>）；普通 Enter 走 onEnter 新增兄弟/子节点
const onEnterKey = (event, data) => {
  if (event.shiftKey) {
    event.preventDefault()
    try {
      document.execCommand('insertLineBreak')
    } catch (e) {
      const sel = window.getSelection()
      if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0)
        const br = document.createElement('br')
        range.deleteContents()
        range.insertNode(br)
        range.setStartAfter(br)
        range.setEndAfter(br)
        sel.removeAllRanges()
        sel.addRange(range)
      }
    }
    return
  }
  // 光标位于文本中间（非行首/行尾）：执行"拆分并降级"——
  // 光标后的文字剪切到新子节点（缩进一级），符合大纲的父子层级递进逻辑
  // 注意：getCaretBoundary 在富文本场景下可能判断不准，需额外检查光标后是否有实际文字
  const boundary = getCaretBoundary()
  const el = event.target
  const hasTextAfter = hasTextAfterCaret(el)
  const atStart = boundary?.atStart
  const atEnd = boundary?.atEnd || !hasTextAfter
  if (!atStart && !atEnd && hasTextAfter) {
    event.preventDefault()
    splitNodeAtCaret(event, data)
    return
  }
  onEnter(event, data)
}

/**
 * 回车拆分（光标在文本中间时触发）：
 * 1. 光标位置后的文字被剪切，创建一个子节点（缩进一级）承载该段文字；
 * 2. 新子节点插入到子节点列表最顶端；
 * 3. 新子节点进入编辑状态且该段文字默认全选（高亮），可直接继续编辑或覆盖输入。
 */
const splitNodeAtCaret = (event, data) => {
  if (!props.mindMap?.renderer?.renderTree) return
  ensureUids()

  const el = event.target
  const sel = window.getSelection()
  if (!el || !sel || sel.rangeCount === 0 || !sel.isCollapsed) return

  const range = sel.getRangeAt(0)
  // 光标（含）之后到节点末尾的范围
  const afterRange = document.createRange()
  try {
    afterRange.setStart(range.startContainer, range.startOffset)
    afterRange.setEnd(el, el.childNodes.length)
  } catch (e) {
    return
  }
  // 先克隆检查光标后是否有实际文字，避免对空内容做无意义的拆分
  let afterHtml = ''
  try {
    const testWrap = document.createElement('div')
    testWrap.appendChild(afterRange.cloneContents())
    if (!testWrap.textContent.trim()) return
    const frag = afterRange.extractContents()
    const wrap = document.createElement('div')
    wrap.appendChild(frag)
    afterHtml = wrap.innerHTML
  } catch (e) {
    return
  }
  const beforeHtml = el.innerHTML

  const result = findNodeAndParent(props.mindMap.renderer.renderTree, data.uid)
  if (!result) return

  // 当前节点保留光标前的文字
  const richBefore = outlineHtmlToRichText(beforeHtml)
  result.node.data.text = richBefore
  result.node.data.richText = true
  data.label = sanitizeSafeHtml(revertOutlineClozeSyntax(richBefore))

  // 光标后的文字剪切为新子节点（缩进一级），插入到子列表最顶端
  const richAfter = outlineHtmlToRichText(afterHtml)
  const newNode = { data: { text: richAfter, uid: createUid(), richText: true }, children: [] }
  if (!result.node.children) result.node.children = []
  result.node.children.unshift(newNode)

  // 新子节点进入编辑模式，pendingEditUid 恢复时默认全选文字
  pendingSelectUid.value = newNode.data.uid
  pendingEditUid.value = newNode.data.uid

  props.mindMap.render()
  props.mindMap.command.addHistory()
}

const onEnter = (event, data) => {
  if (!props.mindMap?.renderer?.renderTree) return
  ensureUids()

  const rawHtml = getNodeText(event, data)
  const richText = outlineHtmlToRichText(rawHtml)
  data.label = sanitizeSafeHtml(revertOutlineClozeSyntax(richText))

  // 直接在 renderer.renderTree（源数据）中查找，不使用 getData() 深拷贝
  const result = findNodeAndParent(props.mindMap.renderer.renderTree, data.uid)
  if (!result) {
    console.warn('[onEnter] node not found in renderTree:', data.uid)
    return
  }
  // 根节点：创建子节点（而非兄弟节点），插到子列表最顶端
  if (!result.parent) {
    if (!result.node.children) result.node.children = []
    const childNode = { data: { text: '<p><span>新节点</span></p>', uid: createUid(), richText: true }, children: [] }
    result.node.children.unshift(childNode)
    pendingSelectUid.value = childNode.data.uid
    pendingEditUid.value = childNode.data.uid
    props.mindMap.render()
    props.mindMap.command.addHistory()
    return
  }

  // 更新当前节点文本（使用富文本格式）
  result.node.data.text = richText
  result.node.data.richText = true

  // 创建新兄弟节点（使用富文本格式，确保思维导图不会出现独立悬浮输入框）
  const newNode = { data: { text: '<p><span>新节点</span></p>', uid: createUid(), richText: true }, children: [] }
  const index = result.parent.children.indexOf(result.node)
  result.parent.children.splice(index + 1, 0, newNode)

  // 设置待选节点，渲染并添加历史记录（不使用 setData 避免 clearHistory）
  // 同时设置 pendingEditUid，使新节点进入编辑模式（光标移到新节点）
  pendingSelectUid.value = newNode.data.uid
  pendingEditUid.value = newNode.data.uid
  props.mindMap.render()
  props.mindMap.command.addHistory()
}

/**
 * Tab 键分发：Tab 添加子节点，Shift+Tab 提升节点
 */
const onTabKey = (event, data) => {
  if (event.shiftKey) {
    onShiftTab(event, data)
  } else {
    onTab(event, data)
  }
}

/**
 * Tab：将当前节点降级（变为上一个兄弟节点的子节点）
 * 直接修改 renderer.renderTree（源数据），避免 getData() 深拷贝导致 uid 丢失
 */
const onTab = (event, data) => {
  if (!props.mindMap?.renderer?.renderTree) return
  ensureUids()

  const rawHtml = getNodeText(event, data)
  const richText = outlineHtmlToRichText(rawHtml)
  data.label = sanitizeSafeHtml(revertOutlineClozeSyntax(richText))

  // 直接在 renderer.renderTree（源数据）中查找
  const result = findNodeAndParent(props.mindMap.renderer.renderTree, data.uid)
  // 根节点：创建子节点（而非降级），插到子列表最顶端
  if (result && !result.parent) {
    if (!result.node.children) result.node.children = []
    const childNode = { data: { text: '<p><span>新节点</span></p>', uid: createUid(), richText: true }, children: [] }
    result.node.children.unshift(childNode)
    pendingSelectUid.value = childNode.data.uid
    pendingEditUid.value = childNode.data.uid
    props.mindMap.render()
    props.mindMap.command.addHistory()
    return
  }
  if (!result || !result.parent) return // 安全检查

  // 更新当前节点文本
  result.node.data.text = richText
  result.node.data.richText = true

  // 找到当前节点在父节点 children 中的位置
  const index = result.parent.children.indexOf(result.node)
  if (index <= 0) return // 没有上一个兄弟节点，无法降级

  // 上一个兄弟节点
  const prevSibling = result.parent.children[index - 1]

  // 从父节点的 children 中移除当前节点
  result.parent.children.splice(index, 1)

  // 将当前节点添加为上一个兄弟节点的最后一个子节点
  if (!prevSibling.children) prevSibling.children = []
  prevSibling.children.push(result.node)

  // 设置待选节点和编辑恢复，允许 refresh 同步视图后恢复光标
  isPerformingTabOp = true
  pendingSelectUid.value = data.uid
  pendingEditUid.value = data.uid
  props.mindMap.render()
  props.mindMap.command.addHistory()
}

/**
 * Shift+Tab：将节点向左提升一级（移到父节点的后面）
 * 直接修改 renderer.renderTree（源数据），避免 getData() 深拷贝导致 uid 丢失
 */
const onShiftTab = (event, data) => {
  if (!props.mindMap?.renderer?.renderTree) return
  ensureUids()

  const rawHtml = getNodeText(event, data)
  const richText = outlineHtmlToRichText(rawHtml)
  data.label = sanitizeSafeHtml(revertOutlineClozeSyntax(richText))

  // 直接在 renderer.renderTree（源数据）中查找
  const result = findNodeAndParent(props.mindMap.renderer.renderTree, data.uid)
  if (!result || !result.parent) return // 根节点无法提升

  // 查找祖父节点
  const parentUid = result.parent.data?.uid
  const parentResult = parentUid ? findNodeAndParent(props.mindMap.renderer.renderTree, parentUid) : null
  if (!parentResult || !parentResult.parent) return // 已在根级，无法提升

  // 更新当前节点文本
  result.node.data.text = richText
  result.node.data.richText = true

  // 从父节点的 children 中移除
  const index = result.parent.children.indexOf(result.node)
  result.parent.children.splice(index, 1)

  // 插入到父节点后面（祖父节点的 children 中）
  const parentIndex = parentResult.parent.children.indexOf(result.parent)
  parentResult.parent.children.splice(parentIndex + 1, 0, result.node)

  // 设置待选节点和编辑恢复，允许 refresh 同步视图后恢复光标
  isPerformingTabOp = true
  pendingSelectUid.value = data.uid
  pendingEditUid.value = data.uid
  props.mindMap.render()
  props.mindMap.command.addHistory()
}

/* ============================================================
 * 工具栏按钮操作
 * ============================================================ */

const insertSibling = () => {
  if (!props.mindMap) return
  // 优先使用正在编辑或选中的节点
  const targetUid = editingUid.value || selectedUid.value
  if (!targetUid) {
    // 没有选中节点时，使用根节点的第一个子节点
    if (treeData.value[0]?.children?.length > 0) {
      const child = treeData.value[0].children[0]
      onEnter({ target: { innerText: child.label }, preventDefault: () => {} }, child)
    }
    return
  }
  const target = findNodeInTree(treeData.value, targetUid)
  if (target) {
    onEnter({ target: { innerText: target.label }, preventDefault: () => {} }, target)
  }
}

const insertChild = () => {
  if (!props.mindMap) return
  const targetUid = editingUid.value || selectedUid.value || treeData.value[0]?.uid
  if (!targetUid) return
  const target = findNodeInTree(treeData.value, targetUid)
  if (target) {
    onTab({ target: { innerText: target.label }, preventDefault: () => {} }, target)
  }
}

const removeNode = () => {
  if (!props.mindMap?.renderer?.renderTree) return
  const targetUid = editingUid.value || selectedUid.value
  if (!targetUid) return

  ensureUids()
  const result = findNodeAndParent(props.mindMap.renderer.renderTree, targetUid)
  if (!result || !result.parent) return // 不能删除根节点

  const index = result.parent.children.indexOf(result.node)
  const prevSibling = index > 0 ? result.parent.children[index - 1] : null
  result.parent.children.splice(index, 1)

  // 删除后选中前一个兄弟节点（或父节点）
  pendingSelectUid.value = prevSibling?.data?.uid || result.parent.data?.uid || null
  props.mindMap.render()
  props.mindMap.command.addHistory()
}

/**
 * Backspace：光标在节点最前面 / 节点已空时，删除当前节点并聚焦前一个兄弟节点
 * 两段式保护（长按与非长按走同一套节奏）：
 * 1. 第一次按下只是"停顿"：不删除当前节点的任何内容，仅标记该节点；
 * 2. 松开后再次按下，才删除该节点、把光标交还给上一节点（跨节点删除）；
 * 3. 长按（键盘自动重复）只删除当前节点内的文字，且永不跨节点删除，
 *    文字删空后自动"武装"，松手后再按一次即可跨节点；
 * 4. 跨节点删除后加锁，退格键松开（keyup）前不再响应任何删除，
 *    防止焦点跳到上一节点后继续长按清空其文字。
 */
const onBackspaceKeyup = (e) => {
  if (e.key === 'Backspace' || e.key === 'Delete') backspaceHoldLock = false
}

/**
 * 检查节点是否为空（无实际文字内容），兼容富文本结构
 */
const isNodeEmpty = (el) => {
  try {
    if (!el) return true
    // 优先用 textContent，比 innerText 更可靠（不受 <br> 等元素影响）
    const text = el.textContent || ''
    if (text.trim()) return false
    // 双重检查：innerText 也可能包含可见内容
    const inner = el.innerText || ''
    if (inner.trim()) return false
    return true
  } catch (e) {
    return false
  }
}

const onBackspace = (event, data) => {
  // 刚删除过空节点且退格键尚未松开：阻止一切删除，防止穿透到上一节点
  if (backspaceHoldLock) {
    event.preventDefault()
    return
  }
  const el = event.target
  const boundary = getCaretBoundary()
  const atStart = boundary?.atStart ?? false
  const isEmpty = isNodeEmpty(el)

  // 情况一：节点有文字且光标不在最前面 → 不拦截，正常删除字符。
  // 若这一下正好把节点删空，则顺带"武装"跨节点删除，
  // 使松手后只需再按一次即可跨节点（与长按删空后的体验一致）。
  if (!isEmpty && !atStart) {
    const uid = data.uid
    nextTick(() => {
      if (!el || !el.isConnected) return
      armedBackspaceUid = isNodeEmpty(el) ? uid : null
    })
    return
  }

  // 情况二：光标在最前面 或 节点已空 → 进入"停顿 / 跨节点删除"两段式判断
  event.preventDefault()

  // 长按产生的重复按键永远不跨节点删除，避免一次按住清空多个节点
  if (event.repeat) return

  // 第一次按下：只做停顿，不删除任何内容（包括当前节点里的文字）
  if (armedBackspaceUid !== data.uid) {
    armedBackspaceUid = data.uid
    return
  }

  // 第二次按下：删除当前节点并聚焦上一节点
  armedBackspaceUid = null

  if (!props.mindMap?.renderer?.renderTree) return
  ensureUids()

  const result = findNodeAndParent(props.mindMap.renderer.renderTree, data.uid)
  if (!result || !result.parent) return // 根节点不删除

  const index = result.parent.children.indexOf(result.node)
  const prevSibling = index > 0 ? result.parent.children[index - 1] : null
  result.parent.children.splice(index, 1)

  // 删除后聚焦前一个兄弟节点并进入编辑模式（光标置于末尾而非全选，
  // 避免松手后再按一次退格时一键清空上一节点全部文字）
  if (prevSibling) {
    pendingSelectUid.value = prevSibling.data.uid
    pendingEditUid.value = prevSibling.data.uid
    pendingEditCaretAtEnd.value = true
  } else {
    // 没有前一个兄弟节点时，聚焦父节点并进入编辑模式
    const parentUid = result.parent.data?.uid || null
    pendingSelectUid.value = parentUid
    pendingEditUid.value = parentUid
    pendingEditCaretAtEnd.value = true
  }
  props.mindMap.render()
  props.mindMap.command.addHistory()
  // 本次按住期间不再执行任何删除，松手（keyup）后解锁
  backspaceHoldLock = true
}

/** 在 treeData 中按 uid 查找节点 */
const findNodeInTree = (tree, uid) => {
  for (const item of tree) {
    if (item.uid === uid) return item
    if (item.children) {
      const found = findNodeInTree(item.children, uid)
      if (found) return found
    }
  }
  return null
}

/* ============================================================
 * 右键菜单
 * ============================================================ */

/**
 * 树容器右键事件：根据点击位置判断显示节点菜单或画布菜单
 */
const onTreeContextmenu = (e) => {
  // 从点击元素向上查找 data-uid，定位右键的节点
  let el = e.target
  while (el && el !== e.currentTarget) {
    if (el.dataset && el.dataset.uid) {
      const uid = el.dataset.uid
      const mm = props.mindMap
      let mmNode =
        mm && mm.renderer && typeof mm.renderer.findNodeByUid === 'function'
          ? mm.renderer.findNodeByUid(uid)
          : null
      // fallback: mindMap instance not ready/stale -> build compatible node from mindMapData
      if (!mmNode && props.mindMapData) {
        const found = findNodeAndParent(props.mindMapData, uid)
        if (found) mmNode = buildCompatibleNode(found.node, found.parent)
      }
      contextmenuVisible.value = true
      contextmenuLeft.value = e.clientX
      contextmenuTop.value = e.clientY
      contextmenuType.value = 'node'
      contextmenuNode.value = mmNode
      contextmenuUid.value = uid
      // 同步选中状态
      editingUid.value = null
      selectedUid.value = uid
      return
    }
    el = el.parentElement
  }
  // 点击空白区域 → 画布菜单
  contextmenuVisible.value = true
  contextmenuLeft.value = e.clientX
  contextmenuTop.value = e.clientY
  contextmenuType.value = 'svg'
  contextmenuNode.value = null
  contextmenuUid.value = null
}

/**
 * 克隆节点树（生成新 uid）
 */
const cloneNodeTree = (node) => {
  const clone = {
    data: { ...node.data, uid: createUid() },
    children: []
  }
  if (node.children && node.children.length > 0) {
    clone.children = node.children.map(cloneNodeTree)
  }
  return clone
}

/** 提交数据变更的统一封装（直接渲染 renderTree，不使用 setData 避免 clearHistory） */
const commitData = (selectUid = null) => {
  pendingSelectUid.value = selectUid
  props.mindMap.render()
  props.mindMap.command.addHistory()
}

/** 插入兄弟节点 */
const insertSiblingByUid = (uid) => {
  if (!props.mindMap?.renderer?.renderTree) return
  ensureUids()
  const result = findNodeAndParent(props.mindMap.renderer.renderTree, uid)
  if (!result || !result.parent) return // 根节点无法添加兄弟
  const newNode = { data: { text: '<p><span>新节点</span></p>', uid: createUid(), richText: true }, children: [] }
  const index = result.parent.children.indexOf(result.node)
  result.parent.children.splice(index + 1, 0, newNode)
  pendingEditUid.value = newNode.data.uid
  commitData(newNode.data.uid)
}

/** 插入子节点（新节点插到子节点列表最顶端，便于高频新增时立即可见可编辑） */
const insertChildByUid = (uid) => {
  if (!props.mindMap?.renderer?.renderTree) return
  ensureUids()
  const result = findNodeAndParent(props.mindMap.renderer.renderTree, uid)
  if (!result) return
  const newNode = { data: { text: '<p><span>新节点</span></p>', uid: createUid(), richText: true }, children: [] }
  if (!result.node.children) result.node.children = []
  result.node.children.unshift(newNode)
  pendingEditUid.value = newNode.data.uid
  commitData(newNode.data.uid)
}

/** 插入父节点（在当前节点上方插入新父节点，当前节点变为新父节点的子节点） */
const insertParentByUid = (uid) => {
  if (!props.mindMap?.renderer?.renderTree) return
  ensureUids()
  const result = findNodeAndParent(props.mindMap.renderer.renderTree, uid)
  if (!result || !result.parent) return // 根节点无法插入父节点
  const newParent = {
    data: { text: '<p><span>新节点</span></p>', uid: createUid(), richText: true },
    children: [result.node]
  }
  const index = result.parent.children.indexOf(result.node)
  result.parent.children.splice(index, 1, newParent)
  pendingEditUid.value = newParent.data.uid
  commitData(newParent.data.uid)
}

/** 上移/下移节点（在兄弟中调整顺序） */
const moveNodeByUid = (uid, direction) => {
  if (!props.mindMap?.renderer?.renderTree) return
  ensureUids()
  const result = findNodeAndParent(props.mindMap.renderer.renderTree, uid)
  if (!result || !result.parent) return
  const siblings = result.parent.children
  const index = siblings.indexOf(result.node)
  const targetIndex = index + direction
  if (targetIndex < 0 || targetIndex >= siblings.length) return
  siblings.splice(index, 1)
  siblings.splice(targetIndex, 0, result.node)
  commitData(uid)
}

/** 切换节点展开/收起状态 */
const toggleExpandByUid = (uid) => {
  if (!props.mindMap?.renderer?.renderTree) return
  ensureUids()
  const result = findNodeAndParent(props.mindMap.renderer.renderTree, uid)
  if (!result) return
  if (!result.node.children || result.node.children.length === 0) return
  const cur = result.node.data.expand
  result.node.data.expand = cur === false ? true : false
  commitData(uid)
}

/** 删除节点（含子节点） */
const removeNodeByUid = (uid) => {
  if (!props.mindMap?.renderer?.renderTree) return
  ensureUids()
  const result = findNodeAndParent(props.mindMap.renderer.renderTree, uid)
  if (!result || !result.parent) return // 不能删除根节点
  const index = result.parent.children.indexOf(result.node)
  result.parent.children.splice(index, 1)
  commitData(null)
}

/** 仅删除当前节点（子节点提升到父节点） */
const removeCurrentNodeByUid = (uid) => {
  if (!props.mindMap?.renderer?.renderTree) return
  ensureUids()
  const result = findNodeAndParent(props.mindMap.renderer.renderTree, uid)
  if (!result || !result.parent) return // 不能删除根节点
  const index = result.parent.children.indexOf(result.node)
  const children = result.node.children || []
  result.parent.children.splice(index, 1, ...children)
  commitData(null)
}

/** 复制节点 */
const copyNodeByUid = (uid) => {
  if (!props.mindMap?.renderer?.renderTree) return
  ensureUids()
  const result = findNodeAndParent(props.mindMap.renderer.renderTree, uid)
  if (!result) return
  clipboardData = cloneNodeTree(result.node)
}

/** 剪切节点 */
const cutNodeByUid = (uid) => {
  if (!props.mindMap?.renderer?.renderTree) return
  ensureUids()
  const result = findNodeAndParent(props.mindMap.renderer.renderTree, uid)
  if (!result || !result.parent) return // 不能剪切根节点
  clipboardData = cloneNodeTree(result.node)
  const index = result.parent.children.indexOf(result.node)
  result.parent.children.splice(index, 1)
  commitData(null)
}

/** 粘贴节点（作为子节点） */
const pasteNodeByUid = (uid) => {
  if (!props.mindMap?.renderer?.renderTree || !clipboardData) return
  ensureUids()
  const result = findNodeAndParent(props.mindMap.renderer.renderTree, uid)
  if (!result) return
  const pasted = cloneNodeTree(clipboardData)
  if (!result.node.children) result.node.children = []
  result.node.children.push(pasted)
  commitData(pasted.data.uid)
}

/** 展开/收起所有节点 */
const setAllExpand = (expand) => {
  if (!props.mindMap?.renderer?.renderTree) return
  ensureUids()
  const walk = (node) => {
    if (node.children && node.children.length > 0) {
      node.data.expand = expand
      node.children.forEach(walk)
    }
  }
  walk(props.mindMap.renderer.renderTree)
  commitData(null)
}

/**
 * 菜单选择处理（直接数据操作）
 */
const onContextmenuSelect = ({ action, node }) => {
  const uid = contextmenuUid.value
  const mm = props.mindMap
  switch (action) {
    case 'INSERT_NODE':
      insertSiblingByUid(uid)
      break
    case 'INSERT_CHILD_NODE':
      insertChildByUid(uid)
      break
    case 'INSERT_PARENT_NODE':
      insertParentByUid(uid)
      break
    case 'UP_NODE':
      moveNodeByUid(uid, -1)
      break
    case 'DOWN_NODE':
      moveNodeByUid(uid, 1)
      break
    case 'TOGGLE_EXPAND':
      toggleExpandByUid(uid)
      break
    case 'REMOVE_NODE':
      removeNodeByUid(uid)
      break
    case 'REMOVE_CURRENT_NODE':
      removeCurrentNodeByUid(uid)
      break
    case 'COPY_NODE':
      copyNodeByUid(uid)
      break
    case 'CUT_NODE':
      cutNodeByUid(uid)
      break
    case 'PASTE_NODE':
      pasteNodeByUid(uid)
      break
    case 'RETURN_CENTER':
      if (mm && mm.renderer && typeof mm.renderer.setRootNodeCenter === 'function') {
        mm.renderer.setRootNodeCenter()
      }
      break
    case 'EXPAND_ALL':
      setAllExpand(true)
      break
    case 'UNEXPAND_ALL':
      setAllExpand(false)
      break
    case 'RESET_LAYOUT':
      if (mm) mm.execCommand('RESET_LAYOUT')
      break
    case 'FIT_CANVAS':
      if (mm && mm.view && typeof mm.view.fit === 'function') {
        mm.view.fit()
      }
      break
    case 'ADD_OUTER_FRAME': {
      const node = mm?.renderer?.findNodeByUid?.(uid)
      if (!node || node.isRoot || node.isGeneralization) {
        try { ElMessage.warning('该节点不支持添加外框') } catch (e) {}
        break
      }
      try {
        mm.execCommand('ADD_OUTER_FRAME', [node], {})
        try { ElMessage.success('已添加外框') } catch (e) {}
      } catch (err) {
        console.error('[OutlineView] 添加外框失败:', err)
      }
      break
    }
    case 'REMOVE_OUTER_FRAME': {
      const node = mm?.renderer?.findNodeByUid?.(uid)
      const groupId = node?.getData?.('outerFrame')?.groupId
      if (!node || !node.parent) break
      try {
        // 同一 groupId 的兄弟节点整组移除，与画布删除语义一致
        const siblings = (node.parent.children || []).filter((c) => {
          const g = c.getData?.('outerFrame')?.groupId
          return groupId ? g === groupId : c === node
        })
        const list = siblings.length > 0 ? siblings : [node]
        for (const child of list) {
          mm.execCommand('SET_NODE_DATA', child, { outerFrame: null })
        }
        try { ElMessage.success(`已移除 ${list.length} 个节点的外框`) } catch (e) {}
      } catch (err) {
        console.error('[OutlineView] 移除外框失败:', err)
      }
      break
    }
    case 'REMOVE_ASSOC_LINE': {
      try { mm?.associativeLine?.removeLine?.() } catch (err) {}
      break
    }
    default:
      break
  }
}

/* ============ 节点备注（大纲模式，悬浮编辑与思维导图模式一致） ============ */
const noteDialogVisible = ref(false)
const noteDialogText = ref('')
const noteDialogNodeName = ref('')
const noteDialogNodes = ref([])
const noteDialogPos = ref(null) // 备注悬浮窗屏幕坐标

const nodeNameOf = (node) => {
  const t = node?.getData?.('text') || ''
  return String(t).replace(/<[^>]+>/g, '').trim().slice(0, 40)
}

// 计算悬浮窗坐标：锚点元素右侧，右侧空间不足时翻到左侧，并防溢出
const computePopoverPos = (anchorRect) => {
  if (!anchorRect) return null
  const width = 340
  let x = anchorRect.right + 12
  if (x + width > window.innerWidth - 12) {
    x = Math.max(12, anchorRect.left - width - 12)
  }
  let y = anchorRect.top - 6
  if (y + 280 > window.innerHeight - 12) {
    y = Math.max(12, window.innerHeight - 292)
  }
  return { x, y }
}

// 取大纲树中节点 DOM 的屏幕位置
const nodeScreenPosByUid = (uid) => {
  try {
    const el = treeRef.value?.$el?.querySelector(`[data-uid="${uid}"]`)
    const rect = el?.getBoundingClientRect?.()
    return (rect && rect.width > 0) ? computePopoverPos(rect) : null
  } catch (e) {
    return null
  }
}

const onNodeNote = (nodes) => {
  const list = (nodes && nodes.length > 0) ? nodes : []
  if (!list.length) return
  noteDialogNodes.value = list
  noteDialogText.value = list[0].getData?.('note') || ''
  noteDialogNodeName.value = list.length > 1 ? `${nodeNameOf(list[0])} 等` : nodeNameOf(list[0])
  noteDialogPos.value = nodeScreenPosByUid(list[0].getData?.('uid'))
  noteDialogVisible.value = true
}

const onNoteIconClick = (data, e) => {
  const mm = props.mindMap
  const node = mm?.renderer?.findNodeByUid?.(data.uid)
  if (!node) {
    try { ElMessage.warning('思维导图实例未就绪，请稍后重试') } catch (err) {}
    return
  }
  noteDialogNodes.value = [node]
  noteDialogText.value = data.note || ''
  noteDialogNodeName.value = nodeNameOf(node)
  noteDialogPos.value = computePopoverPos(e.currentTarget.getBoundingClientRect())
  noteDialogVisible.value = true
}

const applyNoteToNodes = (text) => {
  const mm = props.mindMap
  if (!mm || !noteDialogNodes.value.length) return
  let count = 0
  for (const node of noteDialogNodes.value) {
    try {
      mm.execCommand('SET_NODE_NOTE', node, text || '')
      count++
    } catch (err) {
      console.error('[OutlineView] 设置备注失败:', err)
    }
  }
  noteDialogVisible.value = false
  if (count > 0) {
    try { ElMessage.success(text ? `已为 ${count} 个节点设置备注` : `已清除 ${count} 个节点的备注`) } catch (e) {}
  }
}

const onNoteSave = (text) => applyNoteToNodes(text)
const onNoteClear = () => applyNoteToNodes('')

/* ============ 节点图片全屏查看（大纲模式） ============ */
const imageViewerVisible = ref(false)
const imageViewerSrc = ref('')
const imageViewerTitle = ref('')

// 双击大纲节点图片 → 全屏查看（与思维导图模式 node_img_dblclick 一致）
const onNodeImageDblclick = (data, e) => {
  const src = data?.image
  if (!src) return
  imageViewerSrc.value = src
  imageViewerTitle.value = data?.imageTitle || '节点图片'
  imageViewerVisible.value = true
}

/* ============ 节点概括（大纲模式） ============ */
const genDialogVisible = ref(false)
const genDialogText = ref('')
const genDialogNodeName = ref('')
const genDialogNodes = ref([])
const genDialogPos = ref(null) // 概括悬浮窗屏幕坐标

const generalizationListOf = (node) => {
  const g = node?.getData?.('generalization')
  return Array.isArray(g) ? g : (g ? [g] : [])
}

const genTextToHtml = (text) => {
  const t = String(text || '').trim()
  if (!t) return ''
  // 多行文本逐行转 <p>（与思维导图富文本结构一致）
  return t.split(/\r?\n/).map((line) => {
    const esc = line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    return `<p><span>${esc || '<br>'}</span></p>`
  }).join('')
}

// 点击概括标记 → 悬浮编辑窗
const onGeneralizationClick = (data, e) => {
  const mm = props.mindMap
  const node = mm?.renderer?.findNodeByUid?.(data.uid)
  if (!node) {
    try { ElMessage.warning('思维导图实例未就绪，请稍后重试') } catch (err) {}
    return
  }
  const list = generalizationListOf(node)
  genDialogNodes.value = [node]
  genDialogText.value = list[0] ? (getTextFromHtml(list[0].text || '') || '').trim() : ''
  genDialogNodeName.value = nodeNameOf(node)
  genDialogPos.value = computePopoverPos(e.currentTarget.getBoundingClientRect())
  genDialogVisible.value = true
}

// 保存概括：已有概括直接更新（保留 range 等字段）；新增走 ADD_GENERALIZATION 命令（可 Ctrl+Z 撤销）
const onGenSave = (text) => {
  const mm = props.mindMap
  const node = genDialogNodes.value[0]
  if (!mm || !node) { genDialogVisible.value = false; return }
  try {
    const html = genTextToHtml(text)
    const existing = generalizationListOf(node)
    if (!html) {
      if (existing.length > 0) {
        node.setData({ generalization: [] })
        commitData(node.getData('uid'))
        try { ElMessage.success('已清除概括') } catch (e) {}
      }
    } else if (existing.length > 0) {
      node.setData({ generalization: [{ ...existing[0], text: html, richText: true }] })
      commitData(node.getData('uid'))
      try { ElMessage.success('已保存概括') } catch (e) {}
    } else {
      if (node.isRoot) {
        try { ElMessage.warning('根节点不支持添加概括') } catch (e) {}
        genDialogVisible.value = false
        return
      }
      mm.renderer.activeNodeList = [node]
      mm.execCommand('ADD_GENERALIZATION', { text: html, richText: true }, false)
      try { ElMessage.success('已添加概括') } catch (e) {}
    }
    mm.renderer.activeNodeList = []
  } catch (err) {
    console.error('[OutlineView] 保存概括失败:', err)
    try { ElMessage.error('保存概括失败') } catch (e) {}
  }
  genDialogVisible.value = false
}

const onGenClear = () => {
  const mm = props.mindMap
  const node = genDialogNodes.value[0]
  if (mm && node) {
    try {
      node.setData({ generalization: [] })
      commitData(node.getData('uid'))
      try { ElMessage.success('已清除概括') } catch (e) {}
    } catch (err) {
      console.error('[OutlineView] 清除概括失败:', err)
    }
  }
  genDialogVisible.value = false
}

/* ============ 顶部固定工具栏（与思维导图模式一致） ============ */
// 工具栏目标节点：优先选中节点，其次正在编辑的节点
const toolbarTargetUid = ref('')
watch([selectedUid, editingUid], ([sel, editing]) => {
  toolbarTargetUid.value = sel || editing || ''
}, { immediate: true })

const findTargetNode = () => {
  const uid = toolbarTargetUid.value
  if (!uid) return null
  return props.mindMap?.renderer?.findNodeByUid?.(uid) || null
}

// 文字样式：颜色/高亮/粗斜体/下划线/删除线/字体/字号
const onToolbarApply = (action) => {
  // 大纲编辑态：顶部固定工具栏的颜色/字体/加粗等动作优先作用于当前选中文字，
  // 避免误走“选中节点”提示。
  if (isOutlineTextEditing() && applyOutlineTextStyleAction(action)) return
  const node = findTargetNode()
  if (!node) {
    try { ElMessage.warning('请先选中或编辑一个节点') } catch (e) {}
    return
  }
  applyTextStyleToNodes(props.mindMap, [node], action)
}

/* ============ 大纲选区文字样式（供 App 快捷键复用） ============ */
const collectOutlineSelectionTextNodes = () => {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return null
  const range = sel.getRangeAt(0)
  if (range.collapsed) return null
  const root = range.commonAncestorContainer
  const walkRoot = root && root.nodeType === 3 ? root.parentElement : root
  if (!walkRoot) return null
  const textNodes = []
  const walker = document.createTreeWalker(walkRoot, NodeFilter.SHOW_TEXT)
  while (walker.nextNode()) {
    const tn = walker.currentNode
    if (!tn.nodeValue || !tn.nodeValue.length) continue
    let start = 0
    let end = tn.nodeValue.length
    let included = false
    if (tn === range.startContainer && tn === range.endContainer) {
      start = range.startOffset
      end = range.endOffset
      included = start < end
    } else if (tn === range.startContainer) {
      start = range.startOffset
      end = tn.nodeValue.length
      included = start < end
    } else if (tn === range.endContainer) {
      start = 0
      end = range.endOffset
      included = start < end
    } else {
      try {
        included = range.comparePoint(tn, 0) >= 0 && range.comparePoint(tn, tn.nodeValue.length) <= 0
      } catch (e) {
        included = range.intersectsNode(tn)
      }
    }
    if (!included || start >= end) continue
    textNodes.push({ tn, start, end })
  }
  return textNodes.length ? textNodes : null
}

const splitOutlineSelectionNode = (item) => {
  let node = item.tn
  if (item.end < node.nodeValue.length) node.splitText(item.end)
  if (item.start > 0) node = node.splitText(item.start)
  return node
}

const applyOutlineSelectionStyles = (styles) => {
  const items = collectOutlineSelectionTextNodes()
  if (!items || !items.length || !styles.length) return false
  let changed = 0
  let lastEl = null
  for (const item of items) {
    try {
      const node = splitOutlineSelectionNode(item)
      const el = ensureIsolatedInlineSpan(node)
      lastEl = el
      for (const [prop, value] of styles) {
        if (value === false || value === null || value === '') el.style.removeProperty(prop)
        else el.style.setProperty(prop, value)
      }
      changed++
    } catch (e) {}
  }
  if (lastEl) {
    try {
      const sel = window.getSelection()
      const range = document.createRange()
      range.selectNodeContents(lastEl)
      range.collapse(false)
      sel.removeAllRanges()
      sel.addRange(range)
    } catch (e) {}
  }
  return changed > 0
}

const applyOutlineSelectionDecoration = (token, add) => {
  const items = collectOutlineSelectionTextNodes()
  if (!items || !items.length) return false
  let changed = 0
  let lastEl = null
  for (const item of items) {
    try {
      const node = splitOutlineSelectionNode(item)
      const el = ensureIsolatedInlineSpan(node)
      lastEl = el
      setTextDecorationToken(el, token, add)
      changed++
    } catch (e) {}
  }
  if (lastEl) {
    try {
      const sel = window.getSelection()
      const range = document.createRange()
      range.selectNodeContents(lastEl)
      range.collapse(false)
      sel.removeAllRanges()
      sel.addRange(range)
    } catch (e) {}
  }
  return changed > 0
}

const isOutlineTextEditing = () => {
  const el = document.activeElement
  if (!el || !el.closest || !el.closest('.node-text')) return false
  const sel = window.getSelection()
  return !!(sel && sel.rangeCount > 0 && !sel.getRangeAt(0).collapsed)
}

const applyOutlineTextStyleAction = (action) => {
  if (!isOutlineTextEditing()) return false
  if (action.startsWith('color:')) {
    return applyOutlineSelectionStyles([['color', action.slice(6)]])
  }
  if (action.startsWith('highlight:')) {
    return applyOutlineSelectionStyles([['background-color', action.slice(10)]])
  }
  if (action.startsWith('font:')) {
    const value = action.slice(5)
    return applyOutlineSelectionStyles(value ? [['font-family', value]] : [['font-family', false]])
  }
  if (action.startsWith('fontsize:')) {
    const value = action.slice(9)
    return applyOutlineSelectionStyles(value ? [['font-size', value + 'px']] : [['font-size', false]])
  }
  if (action === 'bold') {
    const add = !document.queryCommandState('bold')
    return applyOutlineSelectionStyles([['font-weight', add ? 'bold' : 'normal']])
  }
  if (action === 'italic-on') {
    return applyOutlineSelectionStyles([['font-style', 'italic']])
  }
  if (action === 'italic-off') {
    return applyOutlineSelectionStyles([['font-style', 'normal']])
  }
  if (action === 'italic') {
    const add = !document.queryCommandState('italic')
    return applyOutlineSelectionStyles([['font-style', add ? 'italic' : 'normal']])
  }
  if (action === 'underline') {
    const add = !document.queryCommandState('underline')
    return applyOutlineSelectionDecoration('underline', add)
  }
  if (action === 'strikethrough') {
    const add = !document.queryCommandState('strikeThrough')
    return applyOutlineSelectionDecoration('line-through', add)
  }
  return false
}

/* ============ 格式刷（大纲模式） ============ */
// 编辑态：复制选中文字的格式 -> 选中其他文字自动应用
// 非编辑态：复制选中节点的文本格式 -> 点击其他节点应用到整行
const painterActive = ref(false)
const painterFormat = ref(null)
const painterSourceUid = ref('')
let painterSourceSel = null   // 开启时的选区快照（避免对源选区自身重复应用）
let painterApplying = false

// 从元素沿祖先链收集有效文本格式（终止于 stopEl；无格式返回 null）
const collectElFormat = (el, stopEl) => {
  const fmt = {}
  const decoTokens = new Set()
  let cur = el
  while (cur && cur !== stopEl && cur.nodeType === 1) {
    const tag = (cur.tagName || '').toUpperCase()
    if (tag === 'B' || tag === 'STRONG') fmt.fontWeight = 'bold'
    if (tag === 'I' || tag === 'EM') fmt.fontStyle = 'italic'
    if (tag === 'U') decoTokens.add('underline')
    if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL') decoTokens.add('line-through')
    const s = cur.style
    if (s) {
      if (s.color) fmt.color = s.color
      if (s.backgroundColor) fmt.backgroundColor = s.backgroundColor
      const w = s.fontWeight
      if (w && (w === 'bold' || w === 'bolder' || parseInt(w, 10) >= 600)) fmt.fontWeight = 'bold'
      if (s.fontStyle === 'italic') fmt.fontStyle = 'italic'
      const deco = s.textDecorationLine || s.textDecoration || ''
      if (/underline/i.test(deco)) decoTokens.add('underline')
      if (/line-through/i.test(deco)) decoTokens.add('line-through')
      if (s.fontFamily) fmt.fontFamily = s.fontFamily
      if (s.fontSize) fmt.fontSize = s.fontSize
    }
    cur = cur.parentElement
  }
  if (decoTokens.size) fmt.textDecorationLine = Array.from(decoTokens).join(' ')
  const hasAny = fmt.color || fmt.backgroundColor || fmt.fontWeight || fmt.fontStyle ||
    fmt.textDecorationLine || fmt.fontFamily || fmt.fontSize
  return hasAny ? fmt : null
}

// 编辑态：取当前选区起点所在元素的有效格式
const captureSelectionFormat = () => {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return null
  const range = sel.getRangeAt(0)
  if (range.collapsed) return null
  let el = range.startContainer
  if (el && el.nodeType === 3) el = el.parentElement
  if (!el || !el.closest) return null
  const row = el.closest('.node-text')
  if (!row) return null
  return collectElFormat(el, row)
}

// 非编辑态：从节点数据富文本 HTML 提取第一个带格式元素的样式
const captureNodeFormat = (node) => {
  try {
    const data = node.getData && node.getData()
    const html = data && data.text
    if (!html || typeof html !== 'string' || !/<[a-z]/i.test(html)) return null
    const div = document.createElement('div')
    div.innerHTML = html
    const walker = document.createTreeWalker(div, NodeFilter.SHOW_ELEMENT)
    while (walker.nextNode()) {
      const fmt = collectElFormat(walker.currentNode, div)
      if (fmt) return fmt
    }
    return null
  } catch (e) {
    return null
  }
}

const snapshotSelection = () => {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return null
  return {
    anchorNode: sel.anchorNode,
    anchorOffset: sel.anchorOffset,
    focusNode: sel.focusNode,
    focusOffset: sel.focusOffset
  }
}

const isSameSelection = (snap) => {
  if (!snap) return false
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return false
  return sel.anchorNode === snap.anchorNode && sel.anchorOffset === snap.anchorOffset &&
    sel.focusNode === snap.focusNode && sel.focusOffset === snap.focusOffset
}

const exitFormatPainter = (msg) => {
  painterActive.value = false
  painterFormat.value = null
  painterSourceUid.value = ''
  painterSourceSel = null
  if (msg) {
    try { ElMessage.info(msg) } catch (e) {}
  }
}

// 编辑态选区应用：对选区内每个文本节点（按选中范围拆分）包内联 span 并写入样式
const applyPainterToSelection = () => {
  const fmt = painterFormat.value
  if (!fmt) return false
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return false
  const range = sel.getRangeAt(0)
  if (range.collapsed) return false
  let probe = range.startContainer
  if (probe && probe.nodeType === 3) probe = probe.parentElement
  if (!probe || !probe.closest || !probe.closest('.node-text')) return false
  const walkRoot = range.commonAncestorContainer.nodeType === 3
    ? range.commonAncestorContainer.parentElement
    : range.commonAncestorContainer
  if (!walkRoot) return false
  const textNodes = []
  const walker = document.createTreeWalker(walkRoot, NodeFilter.SHOW_TEXT)
  while (walker.nextNode()) {
    const tn = walker.currentNode
    try { if (range.intersectsNode(tn)) textNodes.push(tn) } catch (e) {}
  }
  if (!textNodes.length) return false
  const styleProps = []
  if (fmt.color) styleProps.push(['color', fmt.color])
  if (fmt.backgroundColor) styleProps.push(['background-color', fmt.backgroundColor])
  if (fmt.fontWeight) styleProps.push(['font-weight', fmt.fontWeight])
  if (fmt.fontStyle) styleProps.push(['font-style', fmt.fontStyle])
  if (fmt.textDecorationLine) styleProps.push(['text-decoration-line', fmt.textDecorationLine])
  if (fmt.fontFamily) styleProps.push(['font-family', fmt.fontFamily])
  if (fmt.fontSize) styleProps.push(['font-size', fmt.fontSize])
  if (!styleProps.length) return false
  let changed = 0
  for (const tn of textNodes) {
    try {
      let node = tn
      const start = tn === range.startContainer ? range.startOffset : 0
      const end = tn === range.endContainer ? range.endOffset : tn.nodeValue.length
      if (start >= end) continue
      if (end < tn.nodeValue.length) tn.splitText(end)
      if (start > 0) node = tn.splitText(start)
      const el = ensureIsolatedInlineSpan(node)
      for (const [k, v] of styleProps) el.style.setProperty(k, v)
      changed++
    } catch (e) {}
  }
  return changed > 0
}

// 非编辑态节点应用：格式转 action 序列走数据层
const applyPainterToNode = (node) => {
  const fmt = painterFormat.value
  if (!fmt || !node) return false
  const actions = []
  if (fmt.color) actions.push('color:' + fmt.color)
  if (fmt.backgroundColor) actions.push('highlight:' + fmt.backgroundColor)
  if (fmt.fontWeight) actions.push('bold-on')
  if (fmt.fontStyle) actions.push('italic-on')
  if (fmt.textDecorationLine) {
    if (/underline/i.test(fmt.textDecorationLine)) actions.push('underline-on')
    if (/line-through/i.test(fmt.textDecorationLine)) actions.push('strikethrough-on')
  }
  if (fmt.fontFamily) actions.push('font:' + fmt.fontFamily)
  if (fmt.fontSize) {
    const px = String(fmt.fontSize).replace(/px$/i, '')
    if (px) actions.push('fontsize:' + px)
  }
  let changed = 0
  for (const a of actions) {
    try { changed += applyTextStyleToNodes(props.mindMap, [node], a) } catch (e) {}
  }
  return changed > 0
}

// 工具栏格式刷按钮入口
const onToolbarFormatPainter = () => {
  if (painterActive.value) {
    exitFormatPainter('已取消格式刷')
    return
  }
  // 优先编辑态选区格式
  const selFmt = captureSelectionFormat()
  if (selFmt) {
    painterFormat.value = selFmt
    painterSourceUid.value = editingUid.value || ''
    painterSourceSel = snapshotSelection()
    painterActive.value = true
    try { ElMessage.success('已复制选中文字格式，选中其他文字即可应用（ESC 取消）') } catch (e) {}
    return
  }
  // 非编辑态：选中节点的文本格式
  const node = findTargetNode()
  if (node) {
    const fmt = captureNodeFormat(node)
    if (fmt) {
      painterFormat.value = fmt
      painterSourceUid.value = toolbarTargetUid.value || ''
      painterSourceSel = snapshotSelection()
      painterActive.value = true
      try { ElMessage.success('已复制节点文本格式，点击目标节点即可应用（ESC 取消）') } catch (e) {}
      return
    }
  }
  try { ElMessage.warning('未检测到格式：请先选中带格式的文字，或选中已设置样式的节点') } catch (e) {}
}

// 编辑态：mouseup 后延迟检查选区（拖选过程中不触发；跳过开启时的源选区）
const onPainterMouseup = () => {
  if (!painterActive.value || painterApplying) return
  setTimeout(() => {
    if (!painterActive.value || painterApplying) return
    try {
      const sel = window.getSelection()
      if (!sel || sel.rangeCount === 0 || sel.getRangeAt(0).collapsed) return
      if (isSameSelection(painterSourceSel)) return
      let el = sel.anchorNode
      if (el && el.nodeType === 3) el = el.parentElement
      if (!el || !el.closest || !el.closest('.node-text')) return
      painterApplying = true
      if (applyPainterToSelection()) {
        exitFormatPainter()
        try { ElMessage.success('格式已应用') } catch (e) {}
      }
    } catch (e) {
      // ignore
    } finally {
      painterApplying = false
    }
  }, 80)
}

// 非编辑态：选中行变化时应用（跳过源行）
watch(selectedUid, (uid) => {
  if (!painterActive.value || painterApplying) return
  if (!uid || uid === painterSourceUid.value) return
  const node = props.mindMap?.renderer?.findNodeByUid?.(uid)
  if (!node) return
  painterApplying = true
  try {
    if (applyPainterToNode(node)) {
      exitFormatPainter()
      try { ElMessage.success('格式已应用到节点') } catch (e) {}
    }
  } catch (e) {
    // ignore
  } finally {
    painterApplying = false
  }
})

// 备注：悬浮编辑窗定位到目标节点旁
const onToolbarNote = () => {
  const node = findTargetNode()
  if (!node) return
  onNodeNote([node])
}

// 概括：已有概括 → 打开编辑窗；无概括 → 打开编辑窗（保存时创建）
// Ctrl+G 快捷键与工具栏概括按钮共用此入口
const openGeneralization = () => {
  const node = findTargetNode()
  if (!node) {
    try { ElMessage.info('请先选中或编辑一个节点再使用概要功能') } catch (e) {}
    return false
  }
  if (node.isRoot && generalizationListOf(node).length === 0) {
    try { ElMessage.warning('根节点不支持添加概括') } catch (e) {}
    return false
  }
  const uid = node.getData?.('uid')
  const list = generalizationListOf(node)
  genDialogNodes.value = [node]
  genDialogText.value = list[0] ? (getTextFromHtml(list[0].text || '') || '').trim() : ''
  genDialogNodeName.value = nodeNameOf(node)
  genDialogPos.value = nodeScreenPosByUid(uid)
  genDialogVisible.value = true
  return true
}

const onToolbarGen = () => {
  openGeneralization()
}

// 显示/隐藏全部挖空
const onToolbarToggleCloze = () => {
  try {
    toggleAllCloze()
    nextTick(() => applyOutlineClozeStyles())
  } catch (e) {
    console.error('[OutlineView] 挖空切换失败:', e)
  }
}

const onToolbarHideCloze = () => {
  try {
    setAllClozeHidden(true)
    nextTick(() => applyOutlineClozeStyles())
  } catch (e) {
    console.error('[OutlineView] 隐藏挖空失败:', e)
  }
}

const onToolbarShowCloze = () => {
  try {
    setAllClozeHidden(false)
    nextTick(() => applyOutlineClozeStyles())
  } catch (e) {
    console.error('[OutlineView] 显示挖空失败:', e)
  }
}

// 导出（数据类格式；图片类导出依赖可见画布，请切换到思维导图模式）
const outlineExporting = ref(false)
const outlineExportFileName = () => {
  const root = treeData.value[0]
  const rootText = String(root?.label || '').replace(/<[^>]+>/g, '').trim()
  const fileName = String(props.currentFileName || '').split(/[\\/]/).pop() || ''
  const base = (fileName.replace(/\.[^.]+$/, '') || rootText).slice(0, 30) || '大纲'
  return `${base.replace(/[\\/:*?"<>|]/g, '_')}-大纲`
}

const onToolbarExport = async (type) => {
  const mm = props.mindMap
  if (!mm || outlineExporting.value) return
  if (type === 'copy-md') {
    outlineExporting.value = true
    try {
      const mod = await import('simple-mind-map/src/parse/markdown.js')
      const markdown = mod.default || mod
      let data = null
      try { data = mm.getData() } catch (e) { data = null }
      if (!data || !data.data) data = props.mindMapData
      const mdText = markdown.transformToMarkdown(data)
      if (!mdText) throw new Error('Markdown 转换结果为空')
      await navigator.clipboard.writeText(mdText)
      ElMessage.success('已复制 Markdown 文本到剪贴板')
    } catch (e) {
      console.error('[OutlineView] 复制 Markdown 失败:', e)
      ElMessage.error(`复制失败: ${e.message}`)
    } finally {
      outlineExporting.value = false
    }
    return
  }
  // 大纲模式 HTML 导出：生成可交互的折叠/展开 HTML
  if (type === 'html') {
    outlineExporting.value = true
    try {
      const html = buildOutlineHtml(treeData.value, outlineExportFileName())
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${outlineExportFileName()}.html`
      a.click()
      URL.revokeObjectURL(url)
      ElMessage.success(`已导出：${outlineExportFileName()}.html`)
    } catch (e) {
      console.error('[OutlineView] HTML 导出失败:', e)
      ElMessage.error(`导出失败: ${e.message}`)
    } finally {
      outlineExporting.value = false
    }
    return
  }
  // 大纲模式 PDF 导出：通过 HTML 转 PDF
  if (type === 'pdf') {
    outlineExporting.value = true
    try {
      await exportOutlineAsPdf(treeData.value, outlineExportFileName())
      ElMessage.success(`已导出：${outlineExportFileName()}.pdf`)
    } catch (e) {
      console.error('[OutlineView] PDF 导出失败:', e)
      ElMessage.error(`导出失败: ${e.message}`)
    } finally {
      outlineExporting.value = false
    }
    return
  }
  // 三模式 HTML 导出（思维导图 + 大纲 + 关联图）
  if (type === 'tri-html') {
    outlineExporting.value = true
    try {
      const rawData = mm.getData?.() || props.mindMapData
      if (!rawData) throw new Error('没有可导出的数据')
      const text = (rawData.data?.text || '思维导图').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() || '思维导图'
      const svgDataUrl = await safeExportSvg(mm, text)
      const html = await buildTriModeHtml(svgDataUrl, rawData, text)
      const fileName = `${text}-全视图模式`
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${fileName}.html`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      ElMessage.success(`三模式 HTML 已导出：${fileName}.html`)
    } catch (e) {
      console.error('[OutlineView] 三模式 HTML 导出失败:', e)
      ElMessage.error(`导出失败: ${e.message}`)
    } finally {
      outlineExporting.value = false
    }
    return
  }
  // 关联图 HTML 导出
  if (type === 'graph-html') {
    outlineExporting.value = true
    try {
      const rawData = mm.getData?.() || props.mindMapData
      if (!rawData) throw new Error('没有可导出的数据')
      const graphData = buildGraphDataFromRaw(rawData)
      const text = (rawData.data?.text || '关联图').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() || '关联图'
      downloadGraphHtml(graphData, text)
      ElMessage.success(`关联图已导出：${text}.html`)
    } catch (e) {
      console.error('[OutlineView] 关联图导出失败:', e)
      ElMessage.error(`导出失败: ${e.message}`)
    } finally {
      outlineExporting.value = false
    }
    return
  }
  if (!mm.doExport) return
  outlineExporting.value = true
  const name = outlineExportFileName()
  try {
    let url
    switch (type) {
      case 'json': url = await mm.doExport.json(name, false); break
      case 'smm': url = await mm.doExport.smm(name, false); break
      case 'md': url = await mm.doExport.md(); break
      case 'xmind': url = await mm.doExport.xmind(name); break
      default: return
    }
    if (!url) throw new Error('导出数据为空')
    const a = document.createElement('a')
    a.href = url
    a.download = `${name}.${type}`
    a.click()
    ElMessage.success(`已导出：${name}.${type}`)
  } catch (e) {
    console.error('[OutlineView] 导出失败:', e)
    ElMessage.error(`导出失败: ${e.message}`)
  } finally {
    outlineExporting.value = false
  }
}

// 构建大纲 HTML（支持节点展开/收起 + 挖空显示/隐藏）
const buildOutlineHtml = (nodes, title) => {
  const htmlEscape = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

  const renderNode = (node, depth = 0) => {
    if (!node) return ''
    const label = String(node.label || '').replace(/<[^>]+>/g, '').trim() || '未命名'
    const hasCloze = /smm-cloze/.test(String(node.label || ''))
    const children = node.children || []
    const hasChildren = children.length > 0
    const paddingLeft = depth * 24

    let html = `<div class="outline-item" style="padding-left:${paddingLeft}px">`
    if (hasChildren) {
      html += `<span class="toggle-btn" onclick="toggleNode(this)">▼</span>`
    } else {
      html += `<span class="toggle-placeholder"></span>`
    }
    html += `<span class="node-text${hasCloze ? ' has-cloze' : ''}"${hasCloze ? ' onclick="toggleNodeCloze(this)" title="点击显示/隐藏挖空内容"' : ''}>${htmlEscape(label)}</span>`
    html += `</div>`

    if (hasChildren) {
      html += `<div class="children-container">`
      for (const child of children) {
        html += renderNode(child, depth + 1)
      }
      html += `</div>`
    }
    return html
  }

  let bodyHtml = ''
  if (Array.isArray(nodes)) {
    for (const node of nodes) {
      bodyHtml += renderNode(node, 0)
    }
  } else if (nodes) {
    bodyHtml += renderNode(nodes, 0)
  }

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${htmlEscape(title)}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'PingFang SC', 'Microsoft YaHei', sans-serif; background: #f6f6f8; color: #1d1d1f; padding: 20px; }
  .toolbar { position: fixed; top: 16px; right: 20px; z-index: 100; display: flex; gap: 8px; }
  .toolbar button { padding: 8px 14px; border: 1px solid rgba(0,0,0,0.12); border-radius: 8px; background: rgba(255,255,255,0.95); font-size: 13px; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,0.08); transition: all 0.15s; }
  .toolbar button:hover { background: #f0f0f0; }
  .toolbar button.active { background: #007aff; color: #fff; border-color: #007aff; }
  h1 { font-size: 24px; font-weight: 600; margin-bottom: 20px; padding: 10px 0; border-bottom: 2px solid #e5e5ea; }
  .outline-item { display: flex; align-items: center; padding: 6px 0; gap: 6px; }
  .toggle-btn { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; font-size: 10px; cursor: pointer; color: #86868b; transition: transform 0.2s; user-select: none; flex-shrink: 0; }
  .toggle-btn.collapsed { transform: rotate(-90deg); }
  .toggle-placeholder { display: inline-block; width: 20px; flex-shrink: 0; }
  .node-text { font-size: 15px; line-height: 1.6; }
  .node-text.has-cloze { background: rgba(124, 58, 237, 0.13); border-bottom: 2px solid rgba(124, 58, 237, 0.7); border-radius: 3px; padding: 0 3px; }
  .node-text.cloze-hidden { color: transparent !important; background: rgba(124, 58, 237, 0.08); border-bottom-color: rgba(124, 58, 237, 0.3); }
  .children-container { overflow: hidden; transition: max-height 0.25s ease; }
  .children-container.collapsed { max-height: 0 !important; }
</style>
</head>
<body>
<div class="toolbar">
  <button onclick="expandAll()" title="展开全部">展开全部</button>
  <button onclick="collapseAll()" title="收起全部">收起全部</button>
  <button id="clozeToggle" onclick="toggleCloze()" title="显示/隐藏挖空内容">显示挖空</button>
</div>
<h1>${htmlEscape(title)}</h1>
<div class="outline-tree">
${bodyHtml}
</div>
<script>
function toggleNode(btn) {
  var item = btn.closest('.outline-item');
  var children = item.nextElementSibling;
  if (!children || !children.classList.contains('children-container')) return;
  var isCollapsed = children.classList.toggle('collapsed');
  btn.classList.toggle('collapsed', isCollapsed);
}

function expandAll() {
  document.querySelectorAll('.children-container').forEach(function(c) {
    c.classList.remove('collapsed');
  });
  document.querySelectorAll('.toggle-btn').forEach(function(b) {
    b.classList.remove('collapsed');
  });
}

function collapseAll() {
  document.querySelectorAll('.children-container').forEach(function(c) {
    c.classList.add('collapsed');
  });
  document.querySelectorAll('.toggle-btn').forEach(function(b) {
    b.classList.add('collapsed');
  });
}

var clozeVisible = true;
function toggleCloze() {
  clozeVisible = !clozeVisible;
  document.querySelectorAll('.node-text.has-cloze').forEach(function(el) {
    el.classList.toggle('cloze-hidden', !clozeVisible);
  });
  document.getElementById('clozeToggle').textContent = clozeVisible ? '隐藏挖空' : '显示挖空';
  document.getElementById('clozeToggle').classList.toggle('active', !clozeVisible);
}

function toggleNodeCloze(el) {
  el.classList.toggle('cloze-hidden');
}
<\/script>
</body>
</html>`
}

// 大纲 PDF 导出（通过打印 HTML 实现）
const exportOutlineAsPdf = async (nodes, title) => {
  const html = buildOutlineHtml(nodes, title)
  // 注入打印样式：隐藏工具栏，展开所有节点
  const printHtml = html.replace('</head>', `
<style>
  @media print { .toolbar { display: none !important; } }
  .toolbar { display: none; }
  .children-container { max-height: none !important; }
  .toggle-btn { display: none; }
  .toggle-placeholder { display: none; }
  .outline-item { padding-left: 0 !important; }
</style>
</head>`)
  // 使用 Electron 的打印功能或 window.print
  const printWindow = window.open('', '_blank')
  if (!printWindow) throw new Error('无法打开打印窗口，请允许弹出窗口')
  printWindow.document.write(printHtml)
  printWindow.document.close()
  // 等待内容加载完成后触发打印
  setTimeout(() => {
    printWindow.print()
    // 打印对话框关闭后关闭窗口
    printWindow.onafterprint = () => printWindow.close()
  }, 500)
}

/* ============================================================
 * AI 菜单事件 → 转发给父组件
 * ============================================================ */

const onAiContinue = (node) => {
  emit('ai-continue', node)
}

const onAiAddChild = (node) => {
  emit('ai-add-child', node)
}

const onAiRewrite = (node) => {
  emit('ai-rewrite', node)
}

const onAiCloze = (node) => {
  emit('ai-cloze', node)
}

const onAiClozeFullMap = () => {
  emit('ai-cloze-full-map')
}

const onReorganizeMindmap = () => {
  emit('reorganize-mindmap')
}


const onAiQuiz = (node) => {
  emit('ai-quiz', node)
}

const onAiAddToChat = (node) => {
  emit('ai-add-to-chat', node)
}

const onAddReview = (node) => {
  emit('add-review', node)
}

const onAddTag = (node) => {
  emit('add-tag', node)
}

/* ============================================================
 * 拖拽排序
 * ============================================================ */

const onNodeDrop = (draggingNode, dropNode, dropType) => {
  if (!props.mindMap?.renderer?.renderTree) return
  ensureUids()
  const dragUid = draggingNode.data.uid
  const dropUid = dropNode.data.uid

  const renderTree = props.mindMap.renderer.renderTree
  const dragResult = findNodeAndParent(renderTree, dragUid)
  const dropResult = findNodeAndParent(renderTree, dropUid)
  if (!dragResult || !dropResult) return

  // 从原位置移除
  const dragIndex = dragResult.parent.children.indexOf(dragResult.node)
  dragResult.parent.children.splice(dragIndex, 1)

  if (dropType === 'before') {
    const idx = dropResult.parent.children.indexOf(dropResult.node)
    dropResult.parent.children.splice(idx, 0, dragResult.node)
  } else if (dropType === 'after') {
    const idx = dropResult.parent.children.indexOf(dropResult.node)
    dropResult.parent.children.splice(idx + 1, 0, dragResult.node)
  } else if (dropType === 'inner') {
    if (!dropResult.node.children) dropResult.node.children = []
    dropResult.node.children.push(dragResult.node)
  }

  props.mindMap.render()
  props.mindMap.command.addHistory()
}

/* ============================================================
 * 引用链接点击/悬浮预览（大纲模式）
 * document capture 监听，拦截 .ref-tag 内的引用链接
 * ============================================================ */
const previewVisible = ref(false)
const previewFilePath = ref('')
const previewNodeUid = ref('')
const previewPos = ref({ x: 0, y: 0 })
const previewPinned = ref(false)
let previewShowTimer = null
let previewHideTimer = null

// 预览统一自动隐藏（与 MindMapEditor 相同的鼠标位置驱动模型）：
// 鼠标在悬浮窗或引用链接上、悬浮窗内拖动中 → 保持；移出 → 延时隐藏
let previewLastMouse = { x: -1, y: -1 }
let previewMoveThrottle = null
let previewInteracting = false

const isMouseOverPreviewKeepArea = () => {
  const el = document.elementFromPoint(previewLastMouse.x, previewLastMouse.y)
  if (!el || !el.closest) return false
  if (el.closest('.preview-overlay')) return true
  const a = el.closest('a[href]')
  return !!(a && isReferenceLink(a.getAttribute('href') || ''))
}

const clearPreviewHideTimer = () => {
  if (previewHideTimer) {
    clearTimeout(previewHideTimer)
    previewHideTimer = null
  }
}

const schedulePreviewHide = (delay = 300) => {
  clearPreviewHideTimer()
  previewHideTimer = setTimeout(() => {
    previewHideTimer = null
    if (!previewVisible.value) return
    if (previewInteracting) return
    if (isMouseOverPreviewKeepArea()) return
    previewVisible.value = false
  }, delay)
}

const onPreviewMouseMove = (e) => {
  previewLastMouse.x = e.clientX
  previewLastMouse.y = e.clientY
  if (!previewVisible.value) return
  if (previewMoveThrottle) return
  previewMoveThrottle = setTimeout(() => {
    previewMoveThrottle = null
    if (previewInteracting || isMouseOverPreviewKeepArea()) {
      clearPreviewHideTimer()
    } else {
      schedulePreviewHide()
    }
  }, 120)
}

const onOutlinePreviewInteracting = (val) => {
  previewInteracting = !!val
  if (previewInteracting) {
    clearPreviewHideTimer()
  } else {
    schedulePreviewHide(300)
  }
}

const onOutlineLinkClick = (e) => {
  // 本视图隐藏时（如处于思维导图模式）不响应：MindMapEditor 也监听同一 document 事件，
  // 双方同时响应会打开两个 Teleport 预览窗，用户需分别关闭
  if (!props.visible) return
  const link = e.target?.closest?.('a[href]')
  if (!link) return
  const href = link.getAttribute('href') || ''
  if (!isReferenceLink(href)) return

  e.preventDefault()
  e.stopPropagation()

  const ref = parseReferenceLink(href)
  if (!ref.type) return

  const rect = link.getBoundingClientRect()
  previewFilePath.value = ref.filePath
  previewNodeUid.value = ref.nodeUid || ''
  previewPos.value = { x: rect.left, y: rect.bottom }
  previewPinned.value = true
  previewVisible.value = true
}

const onOutlineLinkHover = (e) => {
  if (!props.visible) return // 视图隐藏时让位于当前视图的预览（避免双悬浮窗）
  const link = e.target?.closest?.('a[href]')
  if (!link) return
  const href = link.getAttribute('href') || ''
  if (!isReferenceLink(href)) return

  if (previewHideTimer) {
    clearTimeout(previewHideTimer)
    previewHideTimer = null
  }
  if (previewVisible.value) return

  const ref = parseReferenceLink(href)
  if (!ref.type) return
  if (previewShowTimer) clearTimeout(previewShowTimer)

  previewShowTimer = setTimeout(() => {
    previewShowTimer = null
    const rect = link.getBoundingClientRect()
    previewFilePath.value = ref.filePath
    previewNodeUid.value = ref.nodeUid || ''
    previewPos.value = { x: rect.left, y: rect.bottom }
    previewPinned.value = false
    previewVisible.value = true
  }, 300)
}

const onOutlineLinkLeave = (e) => {
  if (!props.visible) return
  const link = e.target?.closest?.('a[href]')
  if (!link) return
  const href = link.getAttribute('href') || ''
  if (!isReferenceLink(href)) return

  if (previewShowTimer) {
    clearTimeout(previewShowTimer)
    previewShowTimer = null
  }
  // 统一延时检查：鼠标若已移到悬浮窗或其他引用链接上则保持显示
  schedulePreviewHide(300)
}

const onOutlinePreviewStay = () => {
  clearPreviewHideTimer()
}

const onOutlinePreviewOpenFile = (data) => {
  previewVisible.value = false
  emit('open-reference-file', data)
}

/**
 * 预览悬浮窗外部 mousedown：点击悬浮窗以外区域即关闭（大纲模式）。
 * 排除：悬浮窗自身、引用链接（交给 click 阶段的 onOutlineLinkClick 重新定位/刷新）。
 */
const onOutlinePreviewExternalMousedown = (e) => {
  if (!previewVisible.value) return
  const target = e.target
  if (!target?.closest) return
  if (target.closest('.preview-overlay')) return
  const a = target.closest('a[href]')
  if (a && isReferenceLink(a.getAttribute('href') || '')) return
  if (previewShowTimer) {
    clearTimeout(previewShowTimer)
    previewShowTimer = null
  }
  clearPreviewHideTimer()
  previewVisible.value = false
  previewPinned.value = false
}

/* ============================================================
 * 生命周期
 * ============================================================ */

onMounted(() => {
  // 初始化 Tribute 引用功能
  initTribute()
  // 定时刷新文件/节点缓存（每 60 秒）
  cacheTimer = setInterval(refreshCache, 60000)

  // 挖空状态
  clozeHidden.value = isClozeHiddenAll()
  window.addEventListener('cloze-state-changed', onClozeStateChanged)

  // Backspace 长按保护：松开退格键时解除删除锁定
  window.addEventListener('keyup', onBackspaceKeyup)

  // 引用链接点击/悬浮（document capture）
  document.addEventListener('click', onOutlineLinkClick, true)
  document.addEventListener('click', onDocumentClozeClick, true)
  document.addEventListener('mousedown', onDocumentClozeMousedown, true)
  document.addEventListener('mouseover', onOutlineLinkHover, true)
  document.addEventListener('mouseout', onOutlineLinkLeave, true)
  document.addEventListener('mousedown', onOutlinePreviewExternalMousedown, true)
  window.addEventListener('mousemove', onPreviewMouseMove)
  // 格式刷：mouseup 后检查选区应用格式
  document.addEventListener('mouseup', onPainterMouseup)

  nextTick(() => {
    if (props.mindMap) {
      registerListeners(props.mindMap)
      refresh()
    }
  })
})

onBeforeUnmount(() => {
  unregisterListeners(props.mindMap)
  window.removeEventListener('cloze-state-changed', onClozeStateChanged)
  window.removeEventListener('keyup', onBackspaceKeyup)
  document.removeEventListener('click', onOutlineLinkClick, true)
  document.removeEventListener('click', onDocumentClozeClick, true)
  document.removeEventListener('mousedown', onDocumentClozeMousedown, true)
  document.removeEventListener('mouseover', onOutlineLinkHover, true)
  document.removeEventListener('mouseout', onOutlineLinkLeave, true)
  document.removeEventListener('mousedown', onOutlinePreviewExternalMousedown, true)
  window.removeEventListener('mousemove', onPreviewMouseMove)
  document.removeEventListener('mouseup', onPainterMouseup)
  if (previewShowTimer) {
    clearTimeout(previewShowTimer)
    previewShowTimer = null
  }
  if (previewHideTimer) {
    clearTimeout(previewHideTimer)
    previewHideTimer = null
  }
  // 清理 Tribute
  if (tributeInstance) {
    tributeInstance.detach(document.querySelector('.tree-container'))
    tributeInstance = null
  }
  // 清理缓存定时器
  if (cacheTimer) {
    clearInterval(cacheTimer)
    cacheTimer = null
  }
})

watch(
  () => props.mindMap,
  (newMindMap, oldMindMap) => {
    if (oldMindMap) unregisterListeners(oldMindMap)
    if (newMindMap) {
      registerListeners(newMindMap)
      refresh()
    }
  }
)

// 切换离开大纲视图时，触发失焦以保存正在编辑的内容
// 解决切换到思维导图视图时 blur 事件未触发导致 [==text==] 未转换的问题
watch(() => props.visible, (newVisible, oldVisible) => {
  if (oldVisible && !newVisible) {
    // 切换离开大纲视图 - 保存正在进行的编辑
    if (editingUid.value) {
      const el = document.activeElement
      if (el && el.isContentEditable) {
        el.blur()
      }
    }
    // 关闭残留的引用预览悬浮窗（Teleport 到 body，不随容器隐藏），
    // 避免切到思维导图视图后两个预览窗并存
    if (previewShowTimer) {
      clearTimeout(previewShowTimer)
      previewShowTimer = null
    }
    if (previewHideTimer) {
      clearTimeout(previewHideTimer)
      previewHideTimer = null
    }
    previewVisible.value = false
    previewPinned.value = false
  }
  if (!oldVisible && newVisible) {
    // 切换回大纲视图 - 强制刷新数据并重新应用挖空显隐样式
    // （隐藏容器下思维导图实例可能未派发渲染事件，需主动拉取，避免 "no data"）
    nextTick(() => {
      refresh()
      applyOutlineClozeStyles()
    })
  }
})

defineExpose({
  refresh,
  openGeneralization,
  setFullscreen,
  isOutlineTextEditing,
  applyOutlineTextStyleAction
})
</script>

<style scoped>
.outline-wrapper {
  position: relative;
  width: 100%;
  height: 100%;
  flex-direction: column;
  background-color: var(--main-bg);
  overflow: hidden;
}

/* 全屏展示：固定定位覆盖整个窗口，只保留大纲（与思维导图模式一致，低于右键菜单/悬浮预览层级） */
.outline-wrapper.is-fullscreen {
  position: fixed;
  inset: 0;
  z-index: 5000;
  background-color: var(--main-bg);
}
.outline-wrapper.is-fullscreen .outline-toolbar-bar {
  display: none;
}

.fullscreen-btn {
  position: absolute;
  right: 16px;
  bottom: 16px;
  z-index: 10;
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.92);
  color: #666;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.14);
  transition: background 0.15s, color 0.15s, transform 0.15s;
}

.fullscreen-btn:hover {
  background: #ffffff;
  color: var(--apple-blue, #007aff);
  transform: scale(1.06);
}

.fullscreen-btn.is-fullscreen {
  background: rgba(0, 0, 0, 0.5);
  color: #ffffff;
}

.fullscreen-btn.is-fullscreen:hover {
  background: rgba(0, 0, 0, 0.65);
  color: #ffffff;
}

/* ========== Tree Container ========== */
.tree-container {
  flex: 1;
  overflow-y: auto;
  padding: 12px 24px 24px;
}

/* ========== Custom Tree Node ========== */
.custom-tree-node {
  flex: 1;
  display: flex;
  align-items: center;
  width: 100%;
  padding: 2px 0;
}

.node-text {
  flex: 1;
  display: inline-block;
  padding: 5px 10px;
  min-width: 60px;
  outline: none;
  border-radius: var(--radius-sm);
  font-size: 14px;
  line-height: 1.5;
  color: var(--text-primary);
  transition: background-color var(--transition-fast),
    box-shadow var(--transition-fast);
  white-space: normal; /* 允许长文本自动换行 */
  word-break: break-word; /* 连续长单词/URL 也能断行 */
  overflow-wrap: anywhere;
  min-height: 27px;
  align-self: center;
}

.node-text:hover {
  background-color: rgba(0, 0, 0, 0.04);
}

.node-text:focus {
  background-color: rgba(0, 122, 255, 0.06);
  box-shadow: var(--focus-ring);
}

.node-text.node-selected {
  background-color: rgba(0, 122, 255, 0.1);
  box-shadow: inset 0 0 0 1px rgba(0, 122, 255, 0.3);
}

/* ========== 节点备注 / 关联线徽标 ========== */
.node-note-icon,
.node-assoc-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  margin-left: 4px;
  border-radius: 4px;
  cursor: default;
  flex-shrink: 0;
  color: #999;
}

.node-note-icon {
  cursor: pointer;
  /* 与思维导图模式一致：图标颜色跟随节点文字色 */
  color: inherit;
}

.node-note-icon:hover {
  background: rgba(128, 128, 128, 0.15);
  color: #409eff;
}

.node-assoc-badge {
  color: #2980b9;
}

.node-assoc-badge:hover {
  background: rgba(41, 128, 185, 0.12);
}

/* ========== 节点图片缩略图（大纲模式） ========== */
.node-image,
.node-gen-image {
  display: inline-block;
  vertical-align: middle;
  max-width: 60px;
  max-height: 40px;
  width: auto;
  height: auto;
  border-radius: 4px;
  margin: 0 2px;
  object-fit: contain;
  cursor: zoom-in;
  flex-shrink: 0;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.08);
}

.node-image:hover,
.node-gen-image:hover {
  box-shadow: 0 0 0 1px rgba(64, 158, 255, 0.5);
}

/* ========== 节点图片全屏查看（大纲模式） ========== */
.outline-img-viewer-mask {
  position: fixed;
  inset: 0;
  z-index: 6000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.82);
  cursor: zoom-out;
}

.outline-img-viewer-img {
  max-width: calc(100vw - 64px);
  max-height: calc(100vh - 64px);
  object-fit: contain;
  border-radius: 8px;
  box-shadow: 0 12px 50px rgba(0, 0, 0, 0.5);
}

.outline-img-viewer-close {
  position: absolute;
  top: 18px;
  right: 22px;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.18);
  color: #fff;
  font-size: 16px;
  cursor: pointer;
}

.outline-img-viewer-enter-active,
.outline-img-viewer-leave-active {
  transition: opacity 0.18s ease;
}

.outline-img-viewer-enter-from,
.outline-img-viewer-leave-to {
  opacity: 0;
}

/* ========== 节点概括标记（与思维导图概括节点呼应） ========== */
.node-generalization {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  margin-left: 6px;
  padding: 1px 8px 1px 4px;
  border-radius: 10px;
  background: rgba(142, 68, 173, 0.08);
  border: 1px solid rgba(142, 68, 173, 0.35);
  color: #7d3ba8;
  font-size: 12px;
  line-height: 1.5;
  cursor: pointer;
  flex-shrink: 0;
  max-width: 320px;
  transition: background 0.12s, border-color 0.12s;
}

.node-generalization:hover {
  background: rgba(142, 68, 173, 0.16);
  border-color: rgba(142, 68, 173, 0.6);
}

.node-generalization .ng-brace {
  font-family: Georgia, 'Times New Roman', serif;
  font-weight: 700;
  font-size: 15px;
  line-height: 1;
  transform: scaleX(1.15);
}

.node-generalization.has-range .ng-brace {
  color: #b06ad0;
}

.node-generalization .ng-text {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

/* ========== 顶部固定工具栏 ========== */
.outline-toolbar-bar {
  position: absolute;
  inset: 0;
  display: block;
  padding: 0;
  pointer-events: none;
  z-index: 20;
}

.outline-toolbar-bar :deep(.outline-dock-toolbar) {
  pointer-events: auto;
}

.tree-container {
  position: relative;
  z-index: 1;
  padding: 52px 24px 24px;
}

/* 大纲根节点/最上方选区时，浮动文字工具栏必须压在顶部工具栏和树内容之上 */
:deep(.text-toolbar) {
  z-index: 1200 !important;
}

/* ========== 外框括线（同一父节点下 groupId 相同的兄弟节点） ========== */
.custom-tree-node.frame-start,
.custom-tree-node.frame-mid,
.custom-tree-node.frame-end {
  border-left-width: 2px;
  padding-left: 8px;
  margin-left: 4px;
}

.custom-tree-node.frame-start {
  border-top-width: 2px;
  border-top-left-radius: 6px;
  padding-top: 2px;
}

.custom-tree-node.frame-end {
  border-bottom-width: 2px;
  border-bottom-left-radius: 6px;
  padding-bottom: 2px;
}

.custom-tree-node.frame-single {
  border-width: 2px;
  border-radius: 6px;
  padding: 2px 8px;
  margin: 1px 0 1px 4px;
}

/* ========== Element Plus Tree Overrides ========== */
:deep(.el-tree) {
  background: transparent;
}

/* 恢复 el-tree 默认层级缩进（不覆盖 padding-left）；
   height:auto 允许长文本换行撑开行高，不再被固定行高遮住 */
:deep(.el-tree-node__content) {
  height: auto;
  min-height: 36px;
  border-radius: var(--radius-sm);
  transition: background-color var(--transition-fast);
  position: relative; /* 作为层级竖线 .indent-guides 的定位基准 */
}

/* 根节点（第一层）加粗显示 */
:deep(.el-tree > .el-tree-node > .el-tree-node__content .node-text) {
  font-size: 16px;
  font-weight: 600;
  color: #1a1a1a !important;
}

/* 根节点：覆盖思维导图白色文字内联样式，确保大纲模式下可见 */
:deep(.el-tree > .el-tree-node > .el-tree-node__content .node-text *:not(a)) {
  color: #1a1a1a !important;
}

/* 第二层节点 */
:deep(.el-tree > .el-tree-node > .el-tree-node__children > .el-tree-node > .el-tree-node__content .node-text) {
  font-size: 14px;
  font-weight: 500;
  color: #333;
}

/* 层级竖线：每行相对 .el-tree-node__content（position:relative）定位，
   竖线穿过各级展开图标中心((层级-1)*24+12)，相邻行首尾相接形成每级一条连续竖线 */
.indent-guides {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  right: 0;
  pointer-events: none;
}

.indent-guide {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background-color: rgba(0, 0, 0, 0.06);
}

:deep(.el-tree-node__content:hover) {
  background-color: rgba(0, 0, 0, 0.03);
}

:deep(.el-tree-node__expand-icon) {
  color: var(--text-secondary);
  font-size: 12px;
}

:deep(.el-tree-node__expand-icon:hover) {
  color: var(--text-primary);
}

:deep(.el-tree-node.is-drop-inner > .el-tree-node__content) {
  background-color: rgba(0, 122, 255, 0.08);
}

/* Tree scrollbar */
.tree-container::-webkit-scrollbar {
  width: 8px;
}

.tree-container::-webkit-scrollbar-track {
  background: transparent;
}

.tree-container::-webkit-scrollbar-thumb {
  background-color: rgba(0, 0, 0, 0.12);
  border-radius: var(--radius-full);
  border: 2px solid transparent;
  background-clip: padding-box;
}

.tree-container::-webkit-scrollbar-thumb:hover {
  background-color: rgba(0, 0, 0, 0.2);
  border: 2px solid transparent;
  background-clip: padding-box;
}

/* ========== 引用链接样式 ========== */
/* 大纲节点中的引用标签（灰色背景引用块） */
:deep(.node-text a[href^="mindmap-file:"]),
:deep(.node-text a[href^="mindmap-node:"]) {
  background-color: rgba(120, 120, 128, 0.18);
  color: #3a3a3c;
  padding: 1px 6px;
  border-radius: 4px;
  text-decoration: none;
  cursor: pointer;
  font-size: 0.9em;
  font-weight: 500;
  transition: background-color 0.15s ease;
  display: inline-block;
}

:deep(.node-text a[href^="mindmap-file:"]:hover),
:deep(.node-text a[href^="mindmap-node:"]:hover) {
  background-color: rgba(120, 120, 128, 0.3);
}

/* 引用标签容器（不可编辑） */
:deep(.node-text .ref-tag) {
  display: inline-block;
}

/* 挖空样式 - 大纲模式
 * 下划线/透明文字由 cloze.js 的 applyClozeStylesToElement 以内联样式应用（按节点显隐状态），
 * 这里只保留光标与圆角，避免与内联 background-image 下划线重叠 */
:deep(.smm-cloze) {
  border-radius: 3px;
  cursor: pointer;
}

/* 挖空隐藏态：后代自带的 color 内联样式也要强制透明（先设字色再挖空时文字才能藏住） */
:deep(.smm-cloze-hidden),
:deep(.smm-cloze-hidden *) {
  color: transparent !important;
}
</style>

<!-- Tribute.js 菜单全局样式（菜单渲染在 body 上，不受 scoped 限制） -->
<style>
.mm-md-table {
  border-collapse: collapse;
  width: 100%;
  font-size: 12px;
  line-height: 1.45;
  margin: 4px 0;
}
.mm-md-table th,
.mm-md-table td {
  border: 1px solid #e2e5ea;
  padding: 4px 7px;
  text-align: left;
  vertical-align: top;
}
.mm-md-table th {
  background: #f2f5f9;
  font-weight: 600;
}
.mm-md-quote {
  display: inline-block;
  border-left: 3px solid #9aa5b1;
  background: #f6f8fa;
  color: #4b5563;
  padding: 3px 8px;
  border-radius: 0 6px 6px 0;
}

.tribute-container {
  z-index: 10002 !important;
  background: rgba(255, 255, 255, 0.98) !important;
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  border: 1px solid rgba(0, 0, 0, 0.08) !important;
  border-radius: 12px !important;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12) !important;
  overflow: hidden;
  max-height: 300px !important;
  overflow-y: auto;
}

.tribute-container ul {
  margin: 0 !important;
  padding: 4px !important;
  list-style: none !important;
}

.tribute-container li {
  padding: 8px 10px !important;
  border-radius: 8px !important;
  cursor: pointer !important;
  font-size: 13px !important;
  color: #1a1a1a !important;
  display: flex !important;
  align-items: center !important;
  gap: 6px !important;
  transition: background-color 0.15s ease !important;
}

.tribute-container li.highlight,
.tribute-container li:hover {
  background-color: rgba(74, 144, 217, 0.1) !important;
}

.tribute-container .ref-menu-icon {
  font-size: 14px;
  opacity: 0.7;
}

.tribute-container .ref-menu-meta {
  font-size: 11px;
  color: #86868b;
  margin-left: auto;
  padding-left: 8px;
}

.tribute-container .ref-no-match {
  padding: 16px 12px;
  text-align: center;
  font-size: 13px;
  color: #86868b;
  display: block;
}

.tribute-container::-webkit-scrollbar {
  width: 5px;
}

.tribute-container::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.12);
  border-radius: 3px;
}
</style>

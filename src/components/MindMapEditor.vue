<template>
  <div
    class="mind-map-wrapper"
    :class="{ 'is-fullscreen': isFullscreen }"
    ref="wrapperRef"
    @keydown="onWrapperKeydown"
  >
    <div ref="containerRef" class="mind-map-container"></div>

    <!-- 固定工具栏：悬浮于思维导图画布之上（顶部文件名下方） -->
    <FixedToolbar :mindMap="mindMap" :activeNodes="fixedToolbarNodes" @node-note="onNodeNote" />

    <!-- 全屏展示：整个界面只保留导图，ESC 或再次点击退出 -->
    <button
      class="fullscreen-btn"
      :class="{ 'is-fullscreen': isFullscreen }"
      :title="isFullscreen ? '退出全屏 (ESC)' : '全屏展示导图 (ESC 退出)'"
      @click="toggleFullscreen"
    >
      <svg v-if="!isFullscreen" viewBox="0 0 24 24" width="15" height="15">
        <path fill="currentColor" d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" />
      </svg>
      <svg v-else viewBox="0 0 24 24" width="15" height="15">
        <path fill="currentColor" d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z" />
      </svg>
    </button>

    <TextToolbar
      :visible="textToolbarVisible"
      :get-mind-map="() => mindMap"
      @interact-start="onToolbarInteractStart"
      @interact-end="onToolbarInteractEnd"
    />

    <!-- 节点/画布右键菜单 -->
    <Contextmenu
      :visible="contextmenuVisible"
      :left="contextmenuLeft"
      :top="contextmenuTop"
      :type="contextmenuType"
      :node="contextmenuNode"
      :activeNodes="contextmenuActiveNodes"
      :mindMap="mindMap"
      @close="contextmenuVisible = false"
      @ai-continue="onAiContinue"
      @ai-add-child="onAiAddChild"
      @ai-rewrite="onAiRewrite"
      @ai-cloze="onAiCloze"
      @ai-cloze-full-map="onAiClozeFullMap"
      @reorganize-mindmap="onReorganizeMindmap"
      @ai-quiz="onAiQuiz"
      @ai-add-to-chat="onAiAddToChat"
      @add-review="onAddReview"
      @toggle-cloze="onToggleCloze"
      @toggle-cloze-all="onToggleClozeAll"
      @clear-all-cloze="onClearAllCloze"
      @node-note="onNodeNote"
      @insert-image="onInsertNodeImage"
    />

    <!-- 节点备注编辑弹窗 -->
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

    <!-- 引用搜索弹窗（inline 模式：跟随光标，输入实时过滤，焦点保持在编辑器） -->
    <ReferencePopup
      ref="refPopupRef"
      :visible="refPopupVisible"
      :pos="refPopupPos"
      :mode="refPopupMode"
      inline
      :query="refPopupQuery"
      @select="onRefSelect"
      @cancel="onRefCancel"
      @item-hover="onRefItemHover"
    />

    <input
      ref="nodeImageInputRef"
      type="file"
      accept="image/*"
      style="display: none"
      @change="onNodeImageFileSelected"
    />

    <!-- 引用悬浮预览（Teleport 到 body，避免父级 display:none 隐藏） -->
    <Teleport to="body">
      <PreviewOverlay
        :visible="previewVisible"
        :file-path="previewFilePath"
        :node-uid="previewNodeUid"
        :pos="previewPos"
        :pinned="previewPinned"
        @hide="onPreviewHide"
        @open-file="onPreviewOpenFile"
        @stay="onPreviewStay"
        @interacting="onPreviewInteracting"
      />
    </Teleport>

    <!-- 节点图片全屏查看 -->
    <Teleport to="body">
      <Transition name="node-img-viewer">
        <div v-if="nodeImageViewerVisible" class="node-img-viewer-mask" @click="nodeImageViewerVisible = false">
          <img
            :src="nodeImageViewerSrc"
            class="node-img-viewer-img"
            alt="节点图片"
            @click.stop
          />
          <button class="node-img-viewer-close" title="关闭" @click="nodeImageViewerVisible = false">✕</button>
        </div>
      </Transition>
      <div
        v-if="nodeImageHintVisible"
        class="node-img-hint"
        :style="{ left: nodeImageHintPos.x + 'px', top: nodeImageHintPos.y + 'px' }"
      >双击打开图片</div>
    </Teleport>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import { ElMessage } from 'element-plus'
import MindMap from 'simple-mind-map'
import Quill from 'quill'
import Delta from 'quill-delta'
import { Scope } from 'parchment'
import { createUid } from 'simple-mind-map/src/utils'
import { nodeRichTextToTextWithWrap } from 'simple-mind-map/src/utils'
import Drag from 'simple-mind-map/src/plugins/Drag.js'
import Select from 'simple-mind-map/src/plugins/Select.js'
import RichText from 'simple-mind-map/src/plugins/RichText.js'
import Export from 'simple-mind-map/src/plugins/Export.js'
import ExportPDF from 'simple-mind-map/src/plugins/ExportPDF.js'
import ExportXMind from 'simple-mind-map/src/plugins/ExportXMind.js'
import MiniMap from 'simple-mind-map/src/plugins/MiniMap.js'
import Search from 'simple-mind-map/src/plugins/Search.js'
import AssociativeLine from 'simple-mind-map/src/plugins/AssociativeLine.js'
import OuterFrame from 'simple-mind-map/src/plugins/OuterFrame.js'
import Painter from 'simple-mind-map/src/plugins/Painter.js'
import NodeImgAdjust from 'simple-mind-map/src/plugins/NodeImgAdjust.js'
import TouchEvent from 'simple-mind-map/src/plugins/TouchEvent.js'
import TextToolbar from './TextToolbar.vue'
import Contextmenu from './Contextmenu.vue'
import NoteDialog from './NoteDialog.vue'
import FixedToolbar from './FixedToolbar.vue'
import ReferencePopup from './ReferencePopup.vue'
import PreviewOverlay from './PreviewOverlay.vue'
import { parseReferenceLink, isReferenceLink } from '../services/referenceService'
import { useMindMapStore } from '../stores/mindMapStore'
import { initCloze, destroyCloze, applyClozeStyles, toggleAllCloze, isClozeHiddenAll, toggleSelectionCloze, clozeWholeNode, encodeClozeInHtml, setupClozeClickHandler, nodeHasCloze, clearAllCloze, resetClozeState, saveClozeState } from '../utils/cloze'
import { normalizeHtmlForQuill } from '../utils/textStyle'

function normalizeNodeData(node) {
  if (!node) return null
  if (!node.data) node.data = {}
  if (!node.data.uid) node.data.uid = createUid()
  if (!node.data.richText) node.data.richText = true
  if (node.data.text && !node.data.text.startsWith('<')) {
    node.data.text = `<p><span>${node.data.text}</span></p>`
  }
  if (!node.data.text) {
    node.data.text = '<p><span></span></p>'
  }
  if (node.children) {
    node.children.forEach(normalizeNodeData)
  }
  return node
}

const props = defineProps({
  data: {
    type: Object,
    default: () => ({})
  },
  visible: {
    type: Boolean,
    default: true
  },
  // [多实例] 当前 Tab 对应的文件路径（fileId），用于把本实例注册进 store 多实例表，
  // AI 任务按绑定的 fileId 取到这个独立实例操作，切走文件不影响它
  fileId: {
    type: String,
    default: ''
  }
})

const emit = defineEmits([
  'data-change',
  'node-active',
  'node-tree-render-end',
  'ai-continue',
  'ai-add-child',
  'ai-rewrite',
  'ai-cloze',
  'ai-cloze-full-map',
  'reorganize-mindmap',
  'ai-quiz',
  'ai-add-to-chat',
  'add-review',
  'open-reference-file',
  'fullscreen-change'
])

const wrapperRef = ref(null)
const containerRef = ref(null)
// 固定工具栏：当前激活节点（驱动按钮可用态）
const fixedToolbarNodes = ref([])
let mindMap = null
// 全局注册表：AI 工具（toolHandler）经 store 惰性获取实例，
// 避免父组件一次性快照为 null 后所有导图类工具永久报"实例未初始化"
const mindMapStore = useMindMapStore()

// 全屏展示：整个界面只保留导图（覆盖左侧文件栏/右侧聊天等），ESC 或再次点击退出
const isFullscreen = ref(false)
const syncAfterFullscreenChange = () => {
  // 容器尺寸变化后重算画布布局
  nextTick(() => {
    setTimeout(() => {
      if (mindMap && mindMap.resize) mindMap.resize()
    }, 80)
  })
}
const toggleFullscreen = () => {
  isFullscreen.value = !isFullscreen.value
  emit('fullscreen-change', isFullscreen.value)
  syncAfterFullscreenChange()
}
const setFullscreen = (v) => {
  const next = !!v
  if (next === isFullscreen.value) return
  isFullscreen.value = next
  emit('fullscreen-change', next)
  syncAfterFullscreenChange()
}
const onFullscreenKeydown = (e) => {
  if (e.key === 'Escape' && isFullscreen.value) {
    e.stopPropagation()
    isFullscreen.value = false
    emit('fullscreen-change', false)
    syncAfterFullscreenChange()
  }
}
window.addEventListener('keydown', onFullscreenKeydown, true)
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onFullscreenKeydown, true)
})

// 文字编辑工具栏
const textToolbarVisible = ref(false)
const isToolbarInteracting = ref(false)  // 工具栏正在交互（颜色选择器/字号菜单打开中）
// hide_text_edit 在菜单交互期间被跳过时置位：编辑结束事件只发一次，
// 若不记下来等交互结束后补隐藏，工具栏会永久卡在界面上（点哪都不消失）
let pendingToolbarHide = false

// 工具栏交互事件：颜色选择器/字号菜单打开时，阻止 hide_text_edit 隐藏工具栏
const onToolbarInteractStart = () => {
  isToolbarInteracting.value = true
}

const onToolbarInteractEnd = () => {
  isToolbarInteracting.value = false
  if (pendingToolbarHide) {
    pendingToolbarHide = false
    // 交互期间编辑确实结束过：补隐藏。但若期间又重新进入了编辑
    // （如菜单开着时双击了新节点），工具栏应保持显示
    const rt = mindMap && mindMap.richText
    if (!(rt && rt.node)) {
      textToolbarVisible.value = false
    }
  }
}

// 右键菜单
const contextmenuVisible = ref(false)
const contextmenuLeft = ref(0)
const contextmenuTop = ref(0)
const contextmenuType = ref('node') // 'node' | 'svg'
const contextmenuNode = ref(null)
const contextmenuActiveNodes = ref([])

// 右键拖动检测：区分右键单击（弹出菜单）和右键拖动（平移画布，不弹菜单）
let rightMouseDownPos = null
let isRightDragging = false
// 右键按下瞬间的多选快照：simple-mind-map 在右键多选节点时会清空多选只保留当前节点，
// 需要在 mousedown 阶段（contextmenu 之前）先快照，再在菜单事件中恢复
let rightDownActiveNodes = []

/* ============================================================
 * 引用功能状态
 * ============================================================ */
// 引用搜索弹窗
const refPopupVisible = ref(false)
const refPopupPos = ref({ x: 0, y: 0 })
const refPopupMode = ref('file') // 'file' | 'node'
const refPopupRef = ref(null)
const refPopupQuery = ref('')
let refTriggerIndex = -1 // 记录 @ 或 # 在 Quill 中的位置

// 引用悬浮预览
const previewVisible = ref(false)
const previewPos = ref({ x: 0, y: 0 })
const previewFilePath = ref('')
const previewNodeUid = ref('')
const previewPinned = ref(false) // 点击触发的预览（不显示箭头）
let previewHideTimer = null
let previewShowTimer = null
let previewSrcHref = '' // 当前预览对应的引用链接 href，用于判断是否同一链接

// 节点图片插入与全屏查看
const nodeImageInputRef = ref(null)
const nodeImageTargetNodes = ref([])
const nodeImageViewerVisible = ref(false)
const nodeImageViewerSrc = ref('')
const nodeImageHintVisible = ref(false)
const nodeImageHintPos = ref({ x: 0, y: 0 })

// ============ 预览统一自动隐藏：鼠标位置驱动 ============
// 规则：鼠标在悬浮窗/引用搜索列表/引用链接上，或悬浮窗内拖动中、画布平移中 → 保持显示；
// 移出以上区域 → 延时自动隐藏。取代"固定模式+手动关闭"。
let previewLastMouse = { x: -1, y: -1 }
let previewMoveThrottle = null
let previewInteracting = false // 悬浮窗内拖动导图/拖动窗口中（PreviewOverlay 上报）
let canvasPanActive = false // 主画布右/中键平移中

const isMouseOverPreviewKeepArea = () => {
  const el = document.elementFromPoint(previewLastMouse.x, previewLastMouse.y)
  if (!el || !el.closest) return false
  if (el.closest('.preview-overlay')) return true
  if (el.closest('.ref-popup')) return true
  const a = el.closest('a[href]')
  return !!(a && isReferenceLink(a.getAttribute('href') || ''))
}

const clearPreviewHideTimer = () => {
  if (previewHideTimer) {
    clearTimeout(previewHideTimer)
    previewHideTimer = null
  }
}

/**
 * 延时检查并隐藏预览：到期时若鼠标已回到悬浮窗/链接/列表上或正在拖动，则保持显示
 */
const schedulePreviewHide = (delay = 300) => {
  clearPreviewHideTimer()
  previewHideTimer = setTimeout(() => {
    previewHideTimer = null
    if (!previewVisible.value) return
    if (previewInteracting || canvasPanActive) return
    if (isMouseOverPreviewKeepArea()) return
    previewVisible.value = false
  }, delay)
}

/**
 * 立即关闭引用预览悬浮窗（清计时器+复位固定态）
 */
const closePreviewNow = () => {
  if (previewShowTimer) {
    clearTimeout(previewShowTimer)
    previewShowTimer = null
  }
  clearPreviewHideTimer()
  previewVisible.value = false
  previewPinned.value = false
  previewInteracting = false
}

/**
 * 全局 mousemove：节流检查鼠标位置，维持/启动自动隐藏
 */
const onPreviewMouseMove = (e) => {
  previewLastMouse.x = e.clientX
  previewLastMouse.y = e.clientY
  if (!previewVisible.value) return
  if (previewMoveThrottle) return
  previewMoveThrottle = setTimeout(() => {
    previewMoveThrottle = null
    if (previewInteracting || canvasPanActive || isMouseOverPreviewKeepArea()) {
      clearPreviewHideTimer()
    } else {
      schedulePreviewHide()
    }
  }, 120)
}

// 防止 setData 时 data_change 事件回传导致循环
let isSettingData = false

// 注册插件（MindMap.usePlugin 内部会检查重复，安全重复调用）
  MindMap.usePlugin(Drag)
  MindMap.usePlugin(Select)
  MindMap.usePlugin(RichText)
  MindMap.usePlugin(Export)
  MindMap.usePlugin(ExportPDF)
  MindMap.usePlugin(ExportXMind)
  MindMap.usePlugin(MiniMap)
  MindMap.usePlugin(Search)
  MindMap.usePlugin(AssociativeLine)
  MindMap.usePlugin(OuterFrame)
  MindMap.usePlugin(Painter)
  MindMap.usePlugin(NodeImgAdjust)
  MindMap.usePlugin(TouchEvent)

// simple-mind-map 初始化 Quill 时使用 formats 白名单创建实例级 registry，
// 白名单内不含 code，导致编辑态挖空的 formatText('code') 被静默忽略。
// 解决方案：向全局 Quill registry 注册两个 blot，借道白名单中已存在的槽位：
// 1. formula 槽 → ClozeBlot（class="smm-cloze"）：
//    实例 registry 在 Quill 构造时就会带上它，因此编辑态进入时能正确解析已有挖空 span，
//    不会被 optimize 解包导致“双击节点挖空被取消”。
//    编辑态新增挖空也直接使用 formatText('formula')，DOM 直接生成 smm-cloze span。
//    本应用不使用 quill 公式功能，槽位可安全占用。
// 2. size 槽 → SizeStyle（style="font-size:..."）：
//    原生 size 是 class 型（ql-size），不追踪内联 font-size 样式，
//    导致节点富文本里的 font-size 在编辑周期被解包丢失（“取消挖空后字体变小”）。
let quillClozeBlotRegistered = false
const registerQuillClozeBlots = () => {
  if (quillClozeBlotRegistered) return
  quillClozeBlotRegistered = true
  try {
    const parchment = Quill.import('parchment')
    const Inline = Quill.import('blots/inline')
    const Embed = Quill.import('blots/embed')
    class ClozeBlot extends Inline {
      static blotName = 'formula'
      static className = 'smm-cloze'
      static tagName = 'SPAN'
      static formats() {
        return true
      }
    }
    Quill.register(ClozeBlot, true)
    // 引用原子块：Embed blot，长度恒为 1 → 整体删除/整体选中，无法逐字编辑
    // DOM 输出 <a class="smm-ref" href="mindmap-file:...">text</a>，
    // 渲染态由 document 级点击/悬浮监听识别 a[href] 弹出预览
    class RefBlot extends Embed {
      static blotName = 'ref'
      static tagName = 'A'
      static className = 'smm-ref'
      static create(value) {
        const node = super.create(value)
        if (value && typeof value === 'object') {
          node.setAttribute('href', value.href || '')
          node.textContent = value.text || ''
          node.setAttribute('title', value.text || '')
        }
        return node
      }
      static value(node) {
        return {
          text: node.textContent || '',
          href: node.getAttribute('href') || ''
        }
      }
    }
    Quill.register(RefBlot, true)
    // 借 formula 槽位的 requiredContainer 注册链把 RefBlot 带进每个 Quill 实例的
    // formats 白名单 registry（expandConfig 注册白名单 blot 后会沿 requiredContainer
    // 链继续注册）；否则节点编辑时已保存的 smm-ref 引用会被 optimize 解包成普通文本。
    // 注意：parchment 运行时 optimize 同样会读 requiredContainer，发现 blot 父级不是
    // 该容器时调用 wrap() 自动包裹。RefBlot 是 Embed 叶子 blot 没有 appendChild，
    // wrap 会先往 DOM 插入 <a class="smm-ref"> 再抛 ParchmentError，引发
    // MutationObserver → update → optimize 的 DOM 抖动循环（Ctrl+H 挖空即触发，程序卡死）。
    // 因此用独立标记类承载注册链，并令 Symbol.hasInstance 恒为真：
    // 运行时 instanceof 检查永远通过、不再包裹；expandConfig 注册链照常走到 RefBlot。
    class RefRegistryMarker {
      static blotName = 'ref-chain'
      static requiredContainer = RefBlot
      static [Symbol.hasInstance] = () => true
    }
    ClozeBlot.requiredContainer = RefRegistryMarker
    const SizeStyle = new parchment.StyleAttributor(
      'size',
      'font-size',
      { scope: parchment.Scope.INLINE, whitelist: null }
    )
    Quill.register(SizeStyle, true)
  } catch (e) {
    console.warn('注册 quill 挖空/字号 blot 失败:', e)
  }
}
registerQuillClozeBlots()

/**
 * 给 RichText 插件增加图片能力：
 * 1. 把 Quill 实例白名单加入 image，使节点内可以粘贴/保留多张图片；
 * 2. 粘贴图片时把图片作为 inline embed 插入当前光标位置，而不是被富文本插件丢弃。
 */
const installRichTextImageSupport = () => {
  try {
    RichText.prototype.initQuillEditor = function () {
      this.quill = new Quill(this.textEditNode, {
        modules: {
          toolbar: false,
          keyboard: {
            bindings: {
              enter: {
                key: 'Enter',
                handler: function () {}
              },
              shiftEnter: {
                key: 'Enter',
                shiftKey: true,
                handler: function (range, context) {
                  const lineFormats = Object.keys(context.format).reduce(
                    (formats, format) => {
                      if (
                        this.quill.scroll.query(format, Scope.BLOCK) &&
                        !Array.isArray(context.format[format])
                      ) {
                        formats[format] = context.format[format]
                      }
                      return formats
                    },
                    {}
                  )
                  const delta = new Delta()
                    .retain(range.index)
                    .delete(range.length)
                    .insert('\n', lineFormats)
                  this.quill.updateContents(delta, Quill.sources.USER)
                  this.quill.setSelection(range.index + 1, Quill.sources.SILENT)
                  this.quill.focus()
                  Object.keys(context.format).forEach(name => {
                    if (lineFormats[name] != null) return
                    if (Array.isArray(context.format[name])) return
                    if (name === 'code' || name === 'link') return
                    this.quill.format(name, context.format[name], Quill.sources.USER)
                  })
                }
              },
              tab: {
                key: 9,
                handler: function () {}
              }
            }
          }
        },
        formats: [
          'bold',
          'italic',
          'underline',
          'strike',
          'color',
          'background',
          'font',
          'size',
          'formula',
          'image'
        ],
        theme: 'snow'
      })

      this.quill.root.addEventListener('copy', event => {
        event.preventDefault()
        const sel = window.getSelection()
        const originStr = sel.toString()
        try {
          const range = sel.getRangeAt(0)
          const div = document.createElement('div')
          div.appendChild(range.cloneContents())
          const text = nodeRichTextToTextWithWrap(div.innerHTML)
          event.clipboardData.setData('text/plain', text)
        } catch (e) {
          event.clipboardData.setData('text/plain', originStr)
        }
      })

      this.quill.on('selection-change', range => {
        if (this.isInserting) return
        this.lastRange = this.range
        this.range = null
        if (range) {
          this.pasteUseRange = range
          let bounds = this.quill.getBounds(range.index, range.length)
          let rect = this.textEditNode.getBoundingClientRect()
          let rectInfo = {
            left: bounds.left + rect.left,
            top: bounds.top + rect.top,
            right: bounds.right + rect.left,
            bottom: bounds.bottom + rect.top,
            width: bounds.width
          }
          let formatInfo = this.quill.getFormat(range.index, range.length)
          let hasRange = false
          if (range.length == 0) {
            hasRange = false
          } else {
            this.range = range
            hasRange = true
          }
          this.mindMap.emit('rich_text_selection_change', hasRange, rectInfo, formatInfo)
        } else {
          this.mindMap.emit('rich_text_selection_change', false, null, null)
        }
      })

      this.quill.on('text-change', () => {
        let contents = this.quill.getContents()
        let len = contents.ops.length
        if (len <= 0 || (len === 1 && contents.ops[0].insert === '\n')) {
          this.lostStyle = true
          this.syncFormatToNodeConfig(null, true)
        } else if (this.lostStyle && !this.isCompositing) {
          this.setTextStyleIfNotRichText(this.node)
          this.lostStyle = false
        }
        this.mindMap.emit('node_text_edit_change', {
          node: this.node,
          text: this.getEditText(),
          richText: true
        })
      })

      this.quill.clipboard.addMatcher(Node.ELEMENT_NODE, (node, delta) => {
        let ops = []
        let style = this.getPasteTextStyle()
        delta.ops.forEach(op => {
          if (op.insert && typeof op.insert === 'string') {
            ops.push({
              attributes: { ...style },
              insert: this.formatPasteText(op.insert)
            })
          }
        })
        delta.ops = ops
        return delta
      })

      // 粘贴图片：文件列表存在图片时由本应用接管；纯文本粘贴仍走 Quill 默认流程
      this.quill.root.addEventListener(
        'paste',
        async e => {
          const files = Array.from(e.clipboardData?.files || [])
          const images = files.filter(f => f.type && f.type.startsWith('image/'))
          if (images.length === 0) return
          e.preventDefault()
          e.stopPropagation()
          const range = this.quill.getSelection(true)
          let index = range ? range.index : Math.max(0, this.quill.getLength() - 1)
          for (const file of images) {
            try {
              const dataUrl = await new Promise((resolve, reject) => {
                const reader = new FileReader()
                reader.onload = () => resolve(String(reader.result || ''))
                reader.onerror = reject
                reader.readAsDataURL(file)
              })
              if (!dataUrl) continue
              this.quill.insertEmbed(index, 'image', dataUrl, Quill.sources.USER)
              index += 1
            } catch (err) {
              console.error('[MindMapEditor] 粘贴节点图片失败:', err)
            }
          }
          this.quill.setSelection(index, 0, Quill.sources.SILENT)
        },
        true
      )
    }
  } catch (e) {
    console.warn('安装富文本图片粘贴支持失败:', e)
  }
}
installRichTextImageSupport()

// 定义自定义主题：根节点蓝色背景，逻辑结构（右向展开）
// 必须在 new MindMap() 之前定义，因为构造函数中会引用该主题名
MindMap.defineTheme('blueRoot', {
  backgroundColor: '#fafbfc',
  // 节点内边距（确保空白节点也有合理尺寸）
  paddingX: 15,
  paddingY: 5,
  root: {
    shape: 'rectangle',
    fillColor: '#4A90D9',
    color: '#ffffff',
    fontSize: 22,
    fontWeight: 'bold',
    fontStyle: 'normal',
    lineHeight: 1.4,
    borderColor: 'transparent',
    borderWidth: 0,
    borderRadius: 10,
    borderDasharray: 'none',
    active: {
      borderColor: '#2c6fb0',
      borderWidth: 3,
      borderDasharray: 'none'
    }
  },
  second: {
    shape: 'rectangle',
    fillColor: '#e8f0fa',
    color: '#1a1a1a',
    fontSize: 16,
    fontWeight: 'normal',
    fontStyle: 'normal',
    lineHeight: 1.5,
    borderColor: '#b3d0ee',
    borderWidth: 1,
    borderRadius: 8,
    borderDasharray: 'none',
    active: {
      borderColor: '#4A90D9',
      borderWidth: 2,
      borderDasharray: 'none'
    }
  },
  node: {
    shape: 'rectangle',
    fillColor: '#ffffff',
    color: '#333333',
    fontSize: 14,
    fontWeight: 'normal',
    fontStyle: 'normal',
    lineHeight: 1.5,
    borderColor: '#e0e0e0',
    borderWidth: 1,
    borderRadius: 6,
    borderDasharray: 'none',
    active: {
      borderColor: '#4A90D9',
      borderWidth: 2,
      borderDasharray: 'none'
    }
  },
  generalization: {
    shape: 'rectangle',
    fillColor: '#f0f0f0',
    color: '#333',
    fontSize: 13,
    fontWeight: 'bold',
    fontStyle: 'normal',
    lineHeight: 1.5,
    borderColor: '#ccc',
    borderWidth: 1,
    borderRadius: 6,
    borderDasharray: 'none',
    active: {
      borderColor: '#4A90D9',
      borderWidth: 2,
      borderDasharray: 'none'
    }
  },
  lineWidth: 2,
  lineColor: '#b0b8c1',
  lineStyle: 'straight',
  generalizationLineWidth: 1,
  generalizationLineColor: '#ccc',
  associativityLineWidth: 1,
  associativityLineColor: '#999',
  associativityLineDasharray: '6,4',
  rootLineKeepSameInRect: false,
  rootLineStartPositionKeepSameInRect: false,
  borderRadius: 6,
  borderWidth: 1,
  lineRadius: 0
})

// 额外主题：通过 defineTheme 与 default 主题合并，只覆盖关键外观字段。
// 主题切换见 FixedToolbar，节点级背景色则直接改节点 fillColor。
MindMap.defineTheme('light', {
  backgroundColor: '#ffffff',
  root: { shape: 'rectangle', fillColor: '#007aff', color: '#ffffff', fontWeight: 'bold', borderRadius: 10, borderColor: 'transparent' },
  second: { shape: 'rectangle', fillColor: '#f0f4ff', color: '#1a1a1a', borderColor: '#c9d8ff', borderRadius: 8 },
  node: { shape: 'rectangle', fillColor: '#ffffff', color: '#333333', borderColor: '#e0e0e0', borderWidth: 1 },
  lineColor: '#b9c7e8',
  lineWidth: 2
})

MindMap.defineTheme('dark', {
  backgroundColor: '#1f2430',
  root: { shape: 'rectangle', fillColor: '#3b4252', color: '#ffffff', fontWeight: 'bold', borderRadius: 10, borderColor: 'transparent' },
  second: { shape: 'rectangle', fillColor: '#2b303d', color: '#e5e7eb', borderColor: '#4b5563', borderRadius: 8 },
  node: { shape: 'rectangle', fillColor: '#2b303d', color: '#d1d5db', borderColor: '#4b5563', borderWidth: 1 },
  generalization: { shape: 'rectangle', fillColor: '#2b303d', color: '#e5e7eb', borderColor: '#4b5563', borderRadius: 6 },
  lineColor: '#6b7280',
  lineWidth: 2
})

MindMap.defineTheme('warm', {
  backgroundColor: '#fffaf3',
  root: { shape: 'rectangle', fillColor: '#d97706', color: '#ffffff', fontWeight: 'bold', borderRadius: 10, borderColor: 'transparent' },
  second: { shape: 'rectangle', fillColor: '#fff1d6', color: '#4a2c08', borderColor: '#f5c77e', borderRadius: 8 },
  node: { shape: 'rectangle', fillColor: '#ffffff', color: '#5b4636', borderColor: '#ead9c3', borderWidth: 1 },
  lineColor: '#e6b96a',
  lineWidth: 2
})

MindMap.defineTheme('green', {
  backgroundColor: '#f7fcf9',
  root: { shape: 'rectangle', fillColor: '#16a34a', color: '#ffffff', fontWeight: 'bold', borderRadius: 10, borderColor: 'transparent' },
  second: { shape: 'rectangle', fillColor: '#e8f9ef', color: '#14532d', borderColor: '#b7e6c8', borderRadius: 8 },
  node: { shape: 'rectangle', fillColor: '#ffffff', color: '#2f5d46', borderColor: '#cfe8d8', borderWidth: 1 },
  lineColor: '#9fd9b7',
  lineWidth: 2
})

MindMap.defineTheme('purple', {
  backgroundColor: '#faf8ff',
  root: { shape: 'rectangle', fillColor: '#7c3aed', color: '#ffffff', fontWeight: 'bold', borderRadius: 10, borderColor: 'transparent' },
  second: { shape: 'rectangle', fillColor: '#f1e9ff', color: '#3b1d78', borderColor: '#d9c8f5', borderRadius: 8 },
  node: { shape: 'rectangle', fillColor: '#ffffff', color: '#4c3a6b', borderColor: '#e3d9f2', borderWidth: 1 },
  lineColor: '#cdb7ef',
  lineWidth: 2
})

MindMap.defineTheme('minimal', {
  backgroundColor: '#ffffff',
  root: { shape: 'rectangle', fillColor: '#111111', color: '#ffffff', fontWeight: 'bold', borderRadius: 8, borderColor: 'transparent' },
  second: { shape: 'rectangle', fillColor: '#ffffff', color: '#111111', borderColor: '#dddddd', borderRadius: 8 },
  node: { shape: 'rectangle', fillColor: '#ffffff', color: '#333333', borderColor: '#e6e6e6', borderWidth: 1 },
  lineColor: '#cccccc',
  lineWidth: 1,
  lineRadius: 0
})

// 主题持久化：默认 blueRoot，用户可在固定工具栏切换
const AVAILABLE_THEMES = ['blueRoot', 'light', 'dark', 'warm', 'green', 'purple', 'minimal']
const getSavedTheme = () => {
  try {
    const t = localStorage.getItem('mindmap_theme')
    return AVAILABLE_THEMES.includes(t) ? t : 'blueRoot'
  } catch (e) {
    return 'blueRoot'
  }
}

// 初始化思维导图
const initMindMap = () => {
  if (!containerRef.value) return
  // 防重复实例：容器（flex 布局）内二次 new MindMap 会追加第二份 SVG，
  // 表现为左侧一张导图、右侧一张重复导图；已存在时只做 resize
  if (mindMap) {
    try { mindMap.resize() } catch (e) { /* 忽略 */ }
    return
  }

  const normalizedData = normalizeNodeData(JSON.parse(JSON.stringify(props.data)))

  mindMap = new MindMap({
    el: containerRef.value,
    data: normalizedData,
    layout: (() => {
      try {
        const saved = localStorage.getItem('mindmap_layout')
        return ['logicalStructure', 'logicalStructureLeft', 'mindMap', 'organizationStructure', 'catalogOrganization', 'timeline', 'verticalTimeline', 'fishbone'].includes(saved) ? saved : 'logicalStructure'
      } catch (e) {
        return 'logicalStructure'
      }
    })(),
    theme: getSavedTheme(),
    readonly: false,
    mousewheelAction: 'zoom',
    fit: true,
    // 左键框选节点，右键按住拖动画布，右键单击弹出菜单
    useLeftKeySelectionRightKeyDrag: true,
    // 禁用库自带的画布拖拽平移：画布平移统一由本组件的右键/中键拖动逻辑负责。
    // 原因：库的 drag 事件依赖 window 冒泡阶段 mouseup 复位按键标志，节点会
    // stopPropagation 吞掉右键 mouseup，且窗口外松手时 mouseup 完全丢失，
    // 标志位卡在按下状态后画布会永久跟随鼠标（需点击文件树才能解除）；
    // 库自带平移还会与本组件平移叠加（双重速度）
    isDisableDrag: true,
    // 编辑时实时在节点上渲染文字，编辑框透明无阴影贴合节点，而非独立悬浮窗
    openRealtimeRenderOnNodeTextEdit: true,
    // 节点图片缩放/删除按钮更紧凑
    imgResizeBtnSize: 18,
    // 进入编辑前把旧版内联 font-weight/font-style 等归一化为 Quill 语义标签，
    // 保证非编辑态加粗与编辑态加粗是同一状态，取消其一不会残留另一种状态
    transformRichTextOnEnterEdit: normalizeHtmlForQuill,
    // 退出编辑时把 <code> 转为 <span class="smm-cloze">（挖空编码）
    beforeHideRichTextEdit: (richTextPlugin) => {
      // 获取编辑器 HTML，把 <code> 转为 smm-cloze span，再写回 quill
      try {
        const quill = richTextPlugin.quill
        if (!quill) return
        const html = richTextPlugin.getEditText()
        const encoded = encodeClozeInHtml(html)
        if (encoded !== html) {
          // 有 <code> 标签需要转换，重写 quill 内容
          quill.root.innerHTML = encoded
        }
      } catch (e) {
        console.warn('beforeHideRichTextEdit cloze encode failed:', e)
      }
    },
    // 导出图片/SVG 保真钩子（三层防护，任一生效即可防末字截断）：
    // ① 计算样式移植：导出走隔离光栅化（SVG as Image），应用 CSS 继承链断裂，
    //    字体/字号回退到默认值导致文字变宽、末字换行后被 foreignObject 高度裁掉。
    //    把实况 DOM 的真实渲染样式逐节点搬到克隆节点上，保证与画布逐像素一致。
    // ② overflow:visible：即使仍有细微偏差，溢出内容照常渲染而不是被裁剪隐藏。
    // ③ 宽高余量：光栅化字体度量与实况测量的兜底缓冲。
    handleBeingExportSvg: (svg) => {
      try {
        const styleEl = document.createElementNS('http://www.w3.org/2000/svg', 'style')
        styleEl.textContent = `
          foreignObject { overflow: visible !important; }
          .smm-richtext-node-wrap {
            word-break: break-all;
            font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', 'Helvetica Neue', 'PingFang SC', 'Microsoft YaHei', sans-serif;
          }
          .smm-richtext-node-wrap p { font-family: inherit; }
          .smm-cloze {
            background-color: rgba(124, 58, 237, 0.13);
            border-bottom: 2px solid rgba(124, 58, 237, 0.7);
            border-radius: 3px;
            padding: 0 1px;
          }
          .smm-cloze-hidden, .smm-cloze-hidden * { color: transparent !important; }
          .smm-cloze-hidden {
            background-color: rgba(124, 58, 237, 0.18) !important;
            border-bottom: 2px solid #7c3aed !important;
          }
          .smm-richtext-node-wrap a[href^="mindmap-file:"],
          .smm-richtext-node-wrap a[href^="mindmap-node:"] {
            background-color: rgba(120, 120, 128, 0.18);
            color: #3a3a3c;
            padding: 1px 6px;
            border-radius: 4px;
            text-decoration: none;
            font-size: 0.9em;
            font-weight: 500;
          }
        `
        svg.node.appendChild(styleEl)

        // ① 计算样式移植：live 与 clone 的 foreignObject 按文档序一一对应（clone 为整树深拷贝）；
        //    数量不一致（导出删减过元素等边角情况）则整组跳过，回退到纯 CSS 兜底，避免错位污染
        const cloneFos = svg.find('foreignObject')
        let liveFos = []
        try {
          if (mindMap && mindMap.svg) liveFos = mindMap.svg.find('foreignObject')
        } catch (err) { /* 取不到实况树则跳过移植 */ }
        if (liveFos.length > 0 && liveFos.length === cloneFos.length) {
          // 只移植影响文字宽度/换行的继承性属性；quill 内联样式（用户自定义格式）在 clone 中已存在会自然覆盖
          const PROPS = [
            'font-family', 'font-size', 'font-weight', 'font-style',
            'line-height', 'letter-spacing', 'word-break', 'white-space',
            'text-decoration-line', 'color'
          ]
          cloneFos.forEach((fo, i) => {
            try {
              const liveWrap = liveFos[i].node.querySelector('.smm-richtext-node-wrap')
              const cloneWrap = fo.node.querySelector('.smm-richtext-node-wrap')
              if (!liveWrap || !cloneWrap) return
              const cs = window.getComputedStyle(liveWrap)
              for (const p of PROPS) {
                const v = cs.getPropertyValue(p)
                if (v) cloneWrap.style.setProperty(p, v)
              }
            } catch (err) { /* 单节点失败不影响其余 */ }
          })
        }

        // ②+③ 溢出可见 + 宽高余量
        cloneFos.forEach(fo => {
          try {
            fo.node.style.setProperty('overflow', 'visible', 'important')
            const w = parseFloat(fo.attr('width'))
            if (!isNaN(w)) fo.attr('width', w + 8)
            const h = parseFloat(fo.attr('height'))
            if (!isNaN(h)) fo.attr('height', h + 6)
          } catch (err) { /* 单节点失败不影响其余 */ }
        })

        // 导出 PDF/SVG 时只在导出副本上显示全部挖空内容，不动前端实际 DOM。
        // 前端画布仍保持用户当前的挖空显隐状态，不会出现闪烁或状态被改变。
        try {
          const rootEl = svg.node || svg
          rootEl.querySelectorAll('.smm-cloze').forEach(el => {
            el.classList.remove('smm-cloze-hidden')
            el.style.removeProperty('color')
          })
        } catch (err) {
          console.warn('export cloze show-all failed:', err)
        }
      } catch (e) {
        console.warn('export svg fidelity fix failed:', e)
      }
      return svg
    }
  })
  mindMapStore.setMindMap(mindMap)
  // [多实例] 把本实例按 fileId 注册进表，AI 任务按绑定的 fileId 取到这个独立实例
  if (props.fileId) mindMapStore.registerInstance(props.fileId, mindMap)

  // 概要线样式统一为直线直角，和 logicalStructure 的 straight 连线风格保持一致。
  // 库内 renderGeneralization 写死为二次贝塞尔曲线，这里完整替换原逻辑并绘制直角 path。
  try {
    const layout = mindMap.renderer && mindMap.renderer.layout
    if (layout && typeof layout.renderGeneralization === 'function') {
      layout.renderGeneralization = function (list) {
        list.forEach(item => {
          let {
            left,
            top,
            bottom,
            right,
            generalizationLineMargin,
            generalizationNodeMargin
          } = this.getNodeGeneralizationRenderBoundaries(item, 'h')
          let x = this.isUseLeft
            ? left - generalizationLineMargin
            : right + generalizationLineMargin
          // 直角括号离最近节点再留出一点间距，避免贴得太近
          let extraGap = 12
          x = x + (this.isUseLeft ? -extraGap : extraGap)
          let y1 = top
          let y2 = bottom
          let cy = y1 + (y2 - y1) / 2
          let endX = x + (this.isUseLeft ? -generalizationNodeMargin : generalizationNodeMargin)
          // 直角括号：竖线覆盖整个概括区间，上下各伸出一个短直角边把区间“框”起来，
          // 中间再用水平直角线连接到概要节点
          let arm = 12
          let armX = x + (this.isUseLeft ? arm : -arm)
          let path = `M ${x},${y1} L ${x},${y2} M ${x},${y1} L ${armX},${y1} M ${x},${y2} L ${armX},${y2} M ${x},${cy} L ${endX},${cy}`
          item.generalizationLine.plot(path)
          item.generalizationNode.left =
            x +
            (this.isUseLeft ? -generalizationNodeMargin : generalizationNodeMargin) -
            (this.isUseLeft ? item.generalizationNode.width : 0)
          item.generalizationNode.top =
            top + (bottom - top - item.generalizationNode.height) / 2
        })
      }
    }
  } catch (e) {
    console.warn('[MindMapEditor] 概要线样式补丁失败:', e)
  }

  // 监听数据变化 —— 仅在用户编辑时回传，程序性 setData 时不回传
  mindMap.on('data_change', (data) => {
    if (isSettingData) return
    emit('data-change', data)
  })

  // 监听节点激活
  mindMap.on('node_active', (node, activeNodeList) => {
    fixedToolbarNodes.value = activeNodeList || []
    emit('node-active', node, activeNodeList)
  })

  // 监听树渲染完成
  mindMap.on('node_tree_render_end', (...args) => {
    emit('node-tree-render-end', ...args)
    // 渲染完成后重新应用挖空样式
    setTimeout(() => applyClozeStyles(), 100)
  })

  // 视图隐藏期间发生过渲染则置位：隐藏中（display:none）渲染会导致 foreignObject 文本丢失，
  // 切回视图时需完整重渲染恢复；未渲染过则切回时无需任何重渲染（避免闪烁）
  mindMap.on('node_tree_render_start', () => {
    if (!props.visible) renderedWhileHidden = true
  })

  // 监听前进后退 —— 参数是 (activeIndex, length)
  mindMap.on('back_forward', (activeIndex, length) => {
    // 撤销/重做后刷新激活节点状态
    const activeNodes = mindMap.renderer.activeNodeList
    if (activeNodes && activeNodes.length > 0) {
      emit('node-active', activeNodes[0], activeNodes)
    } else {
      emit('node-active', null, [])
    }
  })

  // 双击节点进入文字编辑 -> 显示工具栏
  mindMap.on('node_dblclick', (node) => {
    // 双击进入编辑时取消多选状态：只保留被编辑的节点。
    // 否则编辑期间按文字操作快捷键会错误地作用到整个多选集合
    const r = mindMap.renderer
    if (r && r.activeNodeList && r.activeNodeList.length > 1 && node) {
      try {
        if (typeof r.clearActiveNode === 'function') r.clearActiveNode()
        // 第二参 true：不触发 before_node_active，避免把 TextEdit 刚打开的编辑框立即关闭
        if (typeof r.addNodeToActiveList === 'function') r.addNodeToActiveList(node, true)
        if (typeof r.emitNodeActiveEvent === 'function') r.emitNodeActiveEvent(node)
        // 通知外部激活节点集合变化
        emit('node-active', node, [node])
      } catch (err) {
        console.error('双击清除多选失败:', err)
      }
    }
    nextTick(() => {
      // 新的编辑会话开始：清掉上一会话遗留的"待隐藏"标记，防止它在新会话里误关工具栏
      pendingToolbarHide = false
      textToolbarVisible.value = true
    })
  })

  // 双击节点图片：全屏查看（NodeImgAdjust 负责拖拽缩放）
  mindMap.on('node_img_dblclick', (node) => {
    openNodeImageViewer(node)
  })

  // 节点图片悬浮：中心显示“双击打开图片”提示
  mindMap.on('node_img_mouseenter', (node, img) => {
    try {
      const rect = img?.rbox?.() || img?.node?.getBoundingClientRect?.()
      if (!rect) return
      nodeImageHintPos.value = {
        x: rect.x + rect.width / 2,
        y: rect.y + rect.height / 2
      }
      nodeImageHintVisible.value = true
    } catch (e) {}
  })
  mindMap.on('node_img_mouseleave', () => {
    nodeImageHintVisible.value = false
  })

  // 文字编辑结束 → 隐藏工具栏；颜色/字号菜单打开（交互中）时跳过，但记录下来
  // 由 onToolbarInteractEnd 在菜单关闭后补隐藏。
  // 原因：hide_text_edit 只在编辑框关闭瞬间发一次；若交互期间直接 return 不记录，
  // 之后再无任何事件触发隐藏，工具栏会永久卡在界面上（含 isToolbarInteracting 卡 true
  // 导致后续所有 hide_text_edit 都被跳死的场景）。
  mindMap.on('hide_text_edit', () => {
    if (isToolbarInteracting.value) {
      pendingToolbarHide = true
      return
    }
    textToolbarVisible.value = false
  })

  // 节点右键按下：快照多选。node_mousedown 在库清空多选（contextmenu 阶段）之前触发，
  // 比 DOM capture 监听更可靠（capture 依赖 svgEl 结构，可能因渲染时序失效）
  mindMap.on('node_mousedown', (node, e) => {
    if (e && (e.which === 3 || e.button === 2)) {
      const activeNodes = mindMap.renderer?.activeNodeList
      rightDownActiveNodes = (activeNodes && activeNodes.length > 1) ? activeNodes.slice() : []
    }
  })

  // 节点右键菜单
  mindMap.on('node_contextmenu', (e, node) => {
    if (isRightDragging) {
      isRightDragging = false
      rightMouseDownPos = null
      return
    }
    // 右键单击（未拖动）打开菜单：必须清掉按下位置，
    // 否则后续无按键的鼠标移动超过阈值会凭空启动平移（画布跟随鼠标且无法松开）
    rightMouseDownPos = null
    contextmenuVisible.value = true
    contextmenuLeft.value = e.clientX
    contextmenuTop.value = e.clientY
    contextmenuType.value = 'node'
    contextmenuNode.value = node
    // 恢复被库清空的多选：右键按下的节点在快照中且快照是多个节点 → 多节点菜单
    const snapshot = rightDownActiveNodes
    rightDownActiveNodes = []
    // 快照可能因时序失效，兜底从当前激活列表判断（但库已清空多选，通常只有单节点）
    if (snapshot.length > 1 && snapshot.some(n => n === node || n.getData?.('uid') === node.getData?.('uid'))) {
      contextmenuActiveNodes.value = snapshot
      for (const n of snapshot) {
        try {
          if (n !== node && !n.getData('isActive')) {
            mindMap.renderer.addNodeToActiveList(n, true)
          }
        } catch (err) {
          // 节点可能已失效
        }
      }
    } else {
      const activeNodes = mindMap.renderer.activeNodeList
      contextmenuActiveNodes.value = (activeNodes && activeNodes.length > 1) ? activeNodes : [node]
    }
  })

  // 画布右键菜单
  mindMap.on('contextmenu', (e) => {
    if (isRightDragging) {
      isRightDragging = false
      rightMouseDownPos = null
      return
    }
    // 同节点右键菜单：单击打开菜单时清掉按下位置，防止后续无按键移动触发幻影平移
    rightMouseDownPos = null
    contextmenuVisible.value = true
    contextmenuLeft.value = e.clientX
    contextmenuTop.value = e.clientY
    contextmenuType.value = 'svg'
    contextmenuNode.value = null
  })

  // 右键/中键拖动平移画布：右键移动超过阈值后平移（单击仍弹菜单），中键按下即平移。
  // 绑定稳定容器而非 SVG：simple-mind-map 重渲染/换布局时可能替换 SVG，旧监听会随之丢失。
  const svgEl = containerRef.value
  if (svgEl) {
    // window 级平移：拖动中鼠标移出画布也不中断
    let canvasPanning = null // { lastX, lastY }
    const startCanvasPan = (x, y) => {
      if (canvasPanning) return
      canvasPanning = { lastX: x, lastY: y }
      canvasPanActive = true
      clearPreviewHideTimer() // 画布平移期间预览保持显示
      const onPanMove = (ev) => {
        if (!canvasPanning) return
        // 防御：mousemove 时已无任何按键按下（mouseup 被吞或窗口外释放），立即结束平移
        if (ev.buttons === 0 && ev.which === 0) { onPanUp(); return }
        const dx = ev.clientX - canvasPanning.lastX
        const dy = ev.clientY - canvasPanning.lastY
        canvasPanning.lastX = ev.clientX
        canvasPanning.lastY = ev.clientY
        if (dx || dy) {
          try { mindMap.view.translateXY(dx, dy) } catch (err) {}
        }
      }
      const onPanUp = () => {
        canvasPanning = null
        canvasPanActive = false
        rightMouseDownPos = null
        window.removeEventListener('mousemove', onPanMove, true)
        window.removeEventListener('mouseup', onPanUp, true)
        // 平移结束：若鼠标不在预览相关区域，按统一规则延时隐藏
        if (previewVisible.value) schedulePreviewHide(400)
      }
      // capture 阶段监听：库在非根节点的 mouseup 上会 stopPropagation（非中键一律吞掉），
      // 冒泡阶段的 window 监听收不到 mouseup，导致平移状态卡死、画布持续跟随鼠标；
      // capture 在目标元素处理器之前触发，不受 stopPropagation 影响
      window.addEventListener('mousemove', onPanMove, true)
      window.addEventListener('mouseup', onPanUp, true)
    }

    // capture 阶段监听：必须先于库的节点 mousedown 处理器执行，
    // 否则多选在快照前就被库清空，右键菜单退化为单节点
    svgEl.addEventListener('mousedown', (e) => {
      if (e.button === 2) {
        rightMouseDownPos = { x: e.clientX, y: e.clientY }
        isRightDragging = false
        // 快照当前多选状态（contextmenu 事件前，库可能清空多选）
        const activeNodes = mindMap.renderer?.activeNodeList
        rightDownActiveNodes = (activeNodes && activeNodes.length > 1) ? activeNodes.slice() : []
      } else if (e.button === 1) {
        // 中键：捕获阶段拦截，阻止浏览器自动滚动图标和库的节点/拖拽处理，立即开始平移
        e.preventDefault()
        e.stopPropagation()
        startCanvasPan(e.clientX, e.clientY)
      } else if (e.button === 0) {
        // 左键按下意味着可能开始新选择，使旧快照失效
        rightDownActiveNodes = []
      }
    }, true)
    svgEl.addEventListener('mousemove', (e) => {
      if (rightMouseDownPos) {
        const dx = e.clientX - rightMouseDownPos.x
        const dy = e.clientY - rightMouseDownPos.y
        if (!isRightDragging && Math.sqrt(dx * dx + dy * dy) > 5) {
          isRightDragging = true
          // 右键判定为拖动后开始平移画布（不再弹菜单）
          startCanvasPan(e.clientX, e.clientY)
        }
      }
    })
    svgEl.addEventListener('mouseup', (e) => {
      if (e.button === 2) {
        // mouseup 在 contextmenu 之前触发，isRightDragging 已就绪
      }
    })
    // 右键拖动画布时不弹浏览器默认菜单
    svgEl.addEventListener('contextmenu', (e) => {
      if (isRightDragging) e.preventDefault()
    })
    // Chromium 的中键自动滚动可能在 auxclick 阶段补触发，双保险拦截
    svgEl.addEventListener('auxclick', (e) => {
      if (e.button === 1) e.preventDefault()
    }, true)
  }

  // ============ 引用功能初始化 ============
  setupReferenceFeatures()

  // ============ 挖空功能初始化 ============
  initCloze(mindMap)
  setupClozeClickHandler(mindMap)
  // 渲染完成后应用挖空样式
  setTimeout(() => applyClozeStyles(), 200)
  setTimeout(() => applyClozeStyles(), 500)

  // ============ 快捷键调整 ============
  // 库默认 Control+Enter = 根节点居中；改由 App.vue 全局接管为"框选节点批量挖空"
  try {
    mindMap.keyCommand.removeShortcut('Control+Enter')
  } catch (e) { /* 旧版本库无此方法时忽略 */ }
}

/**
 * 快捷键：Tab 添加子节点，Shift+Tab 提升节点层级
 * 参考幕布思维导图行为：无论是否在编辑状态都生效
 */
const onWrapperKeydown = (event) => {
  // Ctrl+H 已移至 App.vue 全局处理，避免焦点不可用时无法触发

  // Esc: 取消正在进行的关联线绘制
  if (event.key === 'Escape' && mindMap?.associativeLine?.creatingStartNode) {
    try {
      mindMap.associativeLine.cancelCreateLine()
      try { ElMessage.info('已取消关联线绘制') } catch (e) {}
    } catch (err) {}
    return
  }

  // 挖空快捷键已统一为 Ctrl+H（App.vue 全局处理），此处不再重复处理 Ctrl+Enter

  if (event.key !== 'Tab') return

  // 检查是否有激活的节点
  const hasActiveNode = mindMap && mindMap.renderer && mindMap.renderer.activeNodeList && mindMap.renderer.activeNodeList.length > 0
  if (!hasActiveNode) return

  event.preventDefault()
  const isEditing = event.target.isContentEditable

  if (event.shiftKey) {
    // Shift+Tab: 提升节点层级
    if (isEditing) {
      exitEditMode(() => promoteActiveNode())
    } else {
      promoteActiveNode()
    }
  } else {
    // Tab: 添加子节点
    if (isEditing) {
      exitEditMode(() => mindMap.execCommand('INSERT_CHILD_NODE'))
    } else {
      mindMap.execCommand('INSERT_CHILD_NODE')
    }
  }
}

/** 退出编辑模式，然后执行回调 */
const exitEditMode = (callback) => {
  if (!mindMap) return
  if (mindMap.renderer.textEdit?.hideEditTextBox) {
    mindMap.renderer.textEdit.hideEditTextBox()
  }
  nextTick(() => callback())
}

/**
 * 提升激活节点层级（将节点移到父节点后面，变成父节点的兄弟）
 * 通过直接操作数据实现，确保与大纲模式行为一致
 */
const promoteActiveNode = () => {
  if (!mindMap) return
  const node = mindMap.renderer.activeNodeList?.[0]
  if (!node) return

  const parent = node.parent
  if (!parent || !parent.parent) return // 根节点或一级节点无法提升

  // 获取思维导图数据
  const mindData = mindMap.getData()
  const nodeUid = node.getData('uid') || node.uid
  const parentUid = parent.getData('uid') || parent.uid

  // 递归查找节点及其父节点和祖父节点
  const findResult = findNodeInData(mindData, nodeUid)
  if (!findResult || !findResult.parent) return

  const parentResult = findNodeInData(mindData, parentUid)
  if (!parentResult || !parentResult.parent) return

  // 从父节点的 children 中移除当前节点
  const parentChildren = findResult.parent.children
  const nodeIndex = parentChildren.indexOf(findResult.node)
  if (nodeIndex === -1) return
  parentChildren.splice(nodeIndex, 1)

  // 插入到父节点后面（祖父节点的 children 中）
  const grandparentChildren = parentResult.parent.children
  const parentIndex = grandparentChildren.indexOf(findResult.parent)
  if (parentIndex === -1) return
  grandparentChildren.splice(parentIndex + 1, 0, findResult.node)

  // 更新数据（setData 内部已走 reRender 完整重绘，再 render 会造成残留「重影」）
  isSettingData = true
  mindMap.setData(mindData)
  nextTick(() => {
    isSettingData = false
    // 重新激活被提升的节点
    const newNode = mindMap.renderer.findNodeByUid(nodeUid)
    if (newNode) {
      mindMap.renderer.moveNodeToCenter(newNode)
    }
  })
}

/**
 * 在数据树中递归查找节点及其父节点
 * @returns {{node: object, parent: object|null} | null}
 */
const findNodeInData = (data, uid, parent = null) => {
  if (!data) return null
  if (data.data?.uid === uid) return { node: data, parent }
  if (data.children) {
    for (const child of data.children) {
      const result = findNodeInData(child, uid, data)
      if (result) return result
    }
  }
  return null
}

/* ============================================================
 * 引用功能实现
 * ============================================================ */

/**
 * 初始化引用功能：
 * 1. 补丁 Quill Link blot 允许自定义协议
 * 2. 监听 Quill text-change 检测 @/# 输入
 * 3. 监听渲染态链接点击和悬浮
 */
const setupReferenceFeatures = () => {
  if (!mindMap) return

  // 等待 RichText 插件就绪
  nextTick(() => {
    patchQuillLinkBlot()
  })

  // 渲染态链接点击和悬浮 + Quill 输入检测（@/# 触发）
  setupLinkInteraction()
}

/**
 * 补丁 Quill Link blot 的 sanitize 方法
 * 允许 mindmap-file: 和 mindmap-node: 自定义协议
 * 使用顶部导入的全局 Quill 注册（quill 实例在首次进入编辑态时才创建，
 * 依赖实例会因取不到而跳过注册）
 */
const patchQuillLinkBlot = () => {
  try {
    const Link = Quill.import('formats/link')
    const originalSanitize = Link.sanitize

    Link.sanitize = function (value) {
      if (typeof value === 'string') {
        if (value.startsWith('mindmap-file:') || value.startsWith('mindmap-node:')) {
          return value
        }
      }
      return originalSanitize.call(this, value)
    }

    Quill.register(Link, true)
  } catch (e) {
    console.warn('Quill Link blot 补丁失败:', e)
  }
}

/**
 * 监听 Quill 编辑器输入（document capture 级 input 事件）：
 * 1. 检测 @ 和 # 输入触发引用弹窗
 * 2. 弹窗打开期间，提取触发字符后到光标的文本作为过滤词，弹窗跟随光标移动
 *
 * 注意：不能通过 quill.on('text-change') 实现 —— Quill 实例只在节点进入编辑态后才挂载，
 * 实例创建时 mindMap.richText.quill 为空，监听会静默失效（@/# 无法触发的根因）。
 * input 事件在 .ql-editor（contenteditable）上必然触发，与挂载时机无关。
 */
const onQuillInputCapture = (e) => {
  const target = e.target
  if (!target || !target.classList || !target.classList.contains('ql-editor')) return

  // 弹窗已打开：更新过滤词并跟随光标
  if (refPopupVisible.value) {
    updateRefPopupQuery()
    return
  }

  const ch = e.data
  if (ch === '@') {
    handleTriggerChar('file')
  } else if (ch === '#') {
    handleTriggerChar('node')
  }
}

/**
 * 弹窗打开期间：提取过滤词、跟随光标重新定位、检测关闭条件
 */
const updateRefPopupQuery = () => {
  try {
    const quill = mindMap.richText?.quill
    if (!quill || refTriggerIndex < 0) {
      closeRefPopup()
      return
    }
    const sel = quill.getSelection()
    if (!sel) return
    if (sel.index < refTriggerIndex) {
      closeRefPopup()
      return
    }
    const query = quill.getText(refTriggerIndex, sel.index - refTriggerIndex)
    // 空格/换行视为结束引用输入
    if (/\s/.test(query)) {
      closeRefPopup()
      return
    }
    refPopupQuery.value = query

    // 跟随光标定位弹窗
    const bounds = quill.getBounds(sel.index)
    if (bounds) {
      const editorRect = quill.root.getBoundingClientRect()
      refPopupPos.value = {
        x: editorRect.left + bounds.left,
        y: editorRect.top + bounds.bottom + 4
      }
    }
  } catch (e) {
    // 忽略
  }
}

/**
 * 关闭引用弹窗
 */
const closeRefPopup = () => {
  refPopupVisible.value = false
  refTriggerIndex = -1
  refPopupQuery.value = ''
}

/**
 * 处理触发字符（@ 或 #）
 * 获取光标位置并显示引用搜索弹窗（焦点保持在编辑器，输入实时过滤）
 */
const handleTriggerChar = (mode) => {
  try {
    const quill = mindMap.richText?.quill
    if (!quill) return

    const range = quill.getSelection()
    if (!range) return

    refTriggerIndex = range.index // 光标当前位置（@ 或 # 之后）
    refPopupQuery.value = ''

    // 获取光标在屏幕上的坐标
    const bounds = quill.getBounds(range.index)
    if (!bounds) return

    const editorEl = quill.root
    const editorRect = editorEl.getBoundingClientRect()

    refPopupPos.value = {
      x: editorRect.left + bounds.left,
      y: editorRect.top + bounds.bottom + 4
    }
    refPopupMode.value = mode
    refPopupVisible.value = true
  } catch (e) {
    console.warn('触发字符处理失败:', e)
  }
}

/**
 * 引用选择回调：删除触发字符+查询文本，将选中的文件/节点插入为引用链接
 */
const onRefSelect = (selection) => {
  refPopupVisible.value = false

  try {
    const quill = mindMap.richText?.quill
    if (!quill || refTriggerIndex < 1) {
      refTriggerIndex = -1
      return
    }

    // 删除触发字符（@/#）+ 已输入的查询文本
    // 注意：鼠标点击弹窗项时 quill 已失焦，getSelection() 返回 null，
    // 不能依赖光标位置计算删除长度（旧逻辑只删掉触发符，搜索词残留在节点里），
    // 直接用弹窗实时维护的查询词 refPopupQuery 长度计算
    const queryLen = (refPopupQuery.value || '').length
    const removeLen = 1 + queryLen
    quill.deleteText(refTriggerIndex - 1, removeLen)

    const insertIndex = refTriggerIndex - 1
    const { displayText, linkUrl } = selection

    // 以原子 Embed 插入引用块（长度 1，整体选中/删除，不可逐字编辑），
    // DOM 为 <a class="smm-ref" href="...">，渲染态/编辑态均可点击弹预览、带灰底样式
    quill.insertEmbed(insertIndex, 'ref', { text: displayText, href: linkUrl })
    // 插入空格并把光标移到引用块之后
    quill.insertText(insertIndex + 1, ' ', {})
    quill.setSelection(insertIndex + 2, 0)

    refTriggerIndex = -1
    refPopupQuery.value = ''
  } catch (e) {
    console.warn('引用插入失败:', e)
  }
}

/**
 * 引用弹窗取消
 */
const onRefCancel = () => {
  closeRefPopup()
}

/**
 * 判断格式对象是否为思维导图引用链接
 * 兼容两种形态：原子 Embed（fmt.ref）与旧版 link 格式（fmt.link）
 */
const isRefLinkFormat = (fmt) =>
  fmt && (
    fmt.ref ||
    (typeof fmt.link === 'string' &&
      (fmt.link.startsWith('mindmap-file:') || fmt.link.startsWith('mindmap-node:')))
  )

/**
 * 引用块原子删除：Backspace/Delete 一下删除整个引用（含其全部文本）
 */
const deleteRefAtomically = (direction, e) => {
  try {
    const quill = mindMap.richText?.quill
    if (!quill) return
    const sel = quill.getSelection()
    if (!sel || sel.length > 0) return // 仅处理光标态，选区态交给默认行为

    const len = quill.getLength()
    if (direction === 'back') {
      if (sel.index <= 0) return
      if (!isRefLinkFormat(quill.getFormat(sel.index - 1, 1))) return
      let start = sel.index - 1
      while (start > 0 && isRefLinkFormat(quill.getFormat(start - 1, 1))) start--
      e.preventDefault()
      e.stopPropagation()
      quill.deleteText(start, sel.index - start)
      return true
    } else {
      if (sel.index >= len - 1) return
      if (!isRefLinkFormat(quill.getFormat(sel.index, 1))) return
      let end = sel.index + 1
      while (end < len - 1 && isRefLinkFormat(quill.getFormat(end, 1))) end++
      e.preventDefault()
      e.stopPropagation()
      quill.deleteText(sel.index, end - sel.index)
      return true
    }
  } catch (err) {
    // 忽略
  }
  return false
}

/**
 * 编辑态方向键跨节点移动光标：
 * 光标已在文本最前（← 或 ↑ 且处于首行行首）→ 跳到前一个节点（父节点或上方节点）末尾
 * 光标已在文本最后（→ 或 ↓ 且处于末行行尾）→ 跳到下一个节点开头
 * 前后节点按可见节点深度优先顺序取（跳过概要节点与已收起节点的子树）
 */
const getVisibleNodeListForNav = () => {
  const list = []
  const walk = (node) => {
    if (!node || node.isGeneralization) return
    list.push(node)
    if (node.getData('expand') === false) return
    ;(node.children || []).forEach(walk)
  }
  walk(mindMap.renderer.root)
  return list
}

const switchEditToNode = (targetUid, caretAtStart, retries = 2) => {
  const rt = mindMap.richText
  if (!rt) return
  // 当前文本未改动时暂停历史收集，避免纯光标切换污染 Ctrl+Z 撤销栈
  let paused = false
  try {
    const curHtml = rt.sortHtmlNodeStyles(rt.getEditText())
    if (curHtml === (rt.node?.getData?.('text') || '')) {
      mindMap.command.isPause = true
      paused = true
    }
  } catch (e) {}
  try { rt.hideEditText([rt.node]) } catch (e) {}
  if (paused) {
    try { mindMap.command.isPause = false } catch (e) {}
  }
  // hideEditText 触发重渲染，旧节点实例可能失效，按 uid 重新取
  requestAnimationFrame(() => {
    let target = null
    try { target = mindMap.renderer.findNodeByUid(targetUid) } catch (e) {}
    if (!target) {
      if (retries > 0) setTimeout(() => switchEditToNode(targetUid, caretAtStart, retries - 1), 80)
      return
    }
    try {
      rt.showEditText({ node: target })
      const q = rt.quill
      if (q) {
        const idx = caretAtStart ? 0 : Math.max(0, q.getLength() - 1)
        q.setSelection(idx)
        q.focus()
      }
    } catch (e) {}
  })
}

const crossNodeArrowNavigate = (e) => {
  const rt = mindMap?.richText
  if (!rt || !rt.showTextEdit || !rt.quill || !rt.node) return false
  const quill = rt.quill
  let sel = null
  try { sel = quill.getSelection() } catch (err) {}
  if (!sel || sel.length > 0) return false
  const len = quill.getLength()
  const atFirst = sel.index === 0
  // Quill 文档末尾恒有一个换行符，故末尾位置为 len-1
  const atLast = sel.index >= len - 1

  let dir = null
  if (e.key === 'ArrowLeft' && atFirst) dir = 'prev'
  else if (e.key === 'ArrowRight' && atLast) dir = 'next'
  else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    // 与首行/末行的 top 比较判断光标是否在第一行/最后一行
    let curB = null
    let firstB = null
    let lastB = null
    try {
      curB = quill.getBounds(sel.index)
      firstB = quill.getBounds(0)
      lastB = quill.getBounds(len - 1)
    } catch (err) {}
    if (curB && firstB && lastB) {
      const sameLine = (a, b) => Math.abs(a.top - b.top) < Math.max(4, Math.min(a.height, b.height) / 2)
      if (e.key === 'ArrowUp' && sameLine(curB, firstB)) dir = 'prev'
      if (e.key === 'ArrowDown' && sameLine(curB, lastB)) dir = 'next'
    }
  }
  if (!dir) return false

  let list = []
  try { list = getVisibleNodeListForNav() } catch (err) {}
  const idx = list.findIndex(n => n === rt.node || n.uid === rt.node.uid)
  if (idx === -1) return false
  const target = dir === 'prev' ? list[idx - 1] : list[idx + 1]
  if (!target) return false

  e.preventDefault()
  e.stopPropagation()
  const targetUid = target.getData('uid') || target.uid
  switchEditToNode(targetUid, dir === 'next')
  return true
}

// Quill 当前节点是否已经没有文字（只余末尾换行）
const isQuillNodeEmpty = () => {
  try {
    const q = mindMap.richText?.quill
    if (!q) return false
    const len = q.getLength()
    if (len <= 1) return true
    const text = q.getText(0, len - 1) || ''
    return !text.replace(/\uFEFF/g, '').trim()
  } catch (err) {
    return false
  }
}

/**
 * 空节点按 Backspace 删除当前节点，并进入上一个可编辑节点。
 * 规则：优先同层级前一个兄弟；没有前兄弟则进入父节点；根节点不删除。
 */
const deleteEmptyNodeAndEditPrevious = (node) => {
  try {
    if (!mindMap || !node || node.isRoot) return
    const parent = node.parent
    if (!parent) return
    const siblings = (parent.children || []).filter(n => !n.isGeneralization)
    const idx = siblings.indexOf(node)
    const target = idx > 0 ? siblings[idx - 1] : (parent.isRoot ? null : parent)
    if (!target) return
    const targetUid = target.getData?.('uid') || target.uid
    if (!targetUid) return

    mindMap.execCommand('REMOVE_NODE', [node])
    requestAnimationFrame(() => {
      switchEditToNode(targetUid, false)
    })
  } catch (err) {
    console.warn('[MindMapEditor] 空节点 Backspace 删除失败:', err)
  }
}

const handleBackspaceInQuill = (e) => {
  const rt = mindMap?.richText
  if (!rt || !rt.showTextEdit || !rt.quill || !rt.node) return
  if (!isQuillNodeEmpty()) return // 还有文字时交给 Quill 默认删除

  e.preventDefault()
  e.stopPropagation()
  // 长按重复的 Backspace 只删文字，不删节点；松开后再按一次才会删除空节点
  if (e.repeat) return
  deleteEmptyNodeAndEditPrevious(rt.node)
}

// Quill 编辑器 keydown 拦截（capture，document 级）：
// 引用弹窗打开时 ↑↓ 导航、Enter 确认、Esc 关闭；Backspace/Delete 引用块原子删除
const onQuillKeydownCapture = (e) => {
  try {
    const target = e.target
    if (!target || !target.closest || !target.closest('.ql-editor')) return

    if (refPopupVisible.value) {
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        e.stopPropagation()
        refPopupRef.value?.selectPrev()
        return
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        e.stopPropagation()
        refPopupRef.value?.selectNext()
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        refPopupRef.value?.confirmSelection()
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        closeRefPopup()
        return
      }
    }

    // 方向键到达文本边界时跨节点移动光标（未达边界不拦截，保持 Quill 默认行为）
    if (
      e.key === 'ArrowUp' || e.key === 'ArrowDown' ||
      e.key === 'ArrowLeft' || e.key === 'ArrowRight'
    ) {
      if (crossNodeArrowNavigate(e)) return
    }

    if (e.key === 'Backspace') {
      if (deleteRefAtomically('back', e)) return
      handleBackspaceInQuill(e)
    } else if (e.key === 'Delete') {
      deleteRefAtomically('forward', e)
    }
  } catch (err) {
    // 忽略
  }
}

/**
 * 设置渲染态链接的点击和悬浮交互
 * 使用 capture 阶段监听，拦截引用链接的点击
 */
const setupLinkInteraction = () => {
  // 点击：打开引用
  document.addEventListener('click', onLinkClick, true)
  // 悬浮：显示预览
  document.addEventListener('mouseover', onLinkHover, true)
  document.addEventListener('mouseout', onLinkLeave, true)
  // 点击弹窗外非编辑器区域：关闭引用弹窗
  document.addEventListener('mousedown', onRefPopupExternalMousedown, true)
  // Quill 输入检测：@/# 触发引用弹窗
  document.addEventListener('input', onQuillInputCapture, true)
}

/**
 * 引用弹窗外部 mousedown：关闭弹窗（点击弹窗自身或编辑器内不关闭）
 */
const onRefPopupExternalMousedown = (e) => {
  if (!refPopupVisible.value) return
  const target = e.target
  if (!target) return
  if (target.closest?.('.ref-popup')) return
  if (target.closest?.('.ql-editor')) return
  // 在预览悬浮窗内拖动导图属于挑选引用的一部分，不关闭搜索列表
  if (target.closest?.('.preview-overlay')) return
  closeRefPopup()
}

/**
 * 链接点击处理
 */
const onLinkClick = (e) => {
  // 本视图隐藏时（如处于大纲模式）不响应：OutlineView 也监听同一 document 事件，
  // 双方同时响应会打开两个 Teleport 预览窗，用户需分别关闭
  if (!props.visible) return
  const link = e.target.closest?.('a[href]')
  if (!link) return

  const href = link.getAttribute('href') || ''
  if (!isReferenceLink(href)) return

  e.preventDefault()
  e.stopPropagation()

  const ref = parseReferenceLink(href)
  if (!ref.type) return

  // 获取链接在屏幕上的位置
  const rect = link.getBoundingClientRect()
  const pos = { x: rect.left, y: rect.bottom }

  // 显示预览（点击触发：固定显示，支持拖拽缩放，不自动隐藏）
  previewFilePath.value = ref.filePath
  previewNodeUid.value = ref.nodeUid || ''
  previewPos.value = pos
  previewPinned.value = true
  previewVisible.value = true
}

/**
 * 链接悬浮处理
 */
const onLinkHover = (e) => {
  if (!props.visible) return // 视图隐藏时让位于当前视图的预览（避免双悬浮窗）
  const link = e.target.closest?.('a[href]')
  if (!link) return

  const href = link.getAttribute('href') || ''
  if (!isReferenceLink(href)) return

  // 取消之前的隐藏计时器
  clearPreviewHideTimer()

  // 如果预览已显示且是同一个链接，不重复处理
  if (previewVisible.value && previewSrcHref === href) return

  const ref = parseReferenceLink(href)
  if (!ref.type) return

  // 取消之前的显示计时器
  if (previewShowTimer) {
    clearTimeout(previewShowTimer)
  }

  // 延迟显示预览
  previewShowTimer = setTimeout(() => {
    previewShowTimer = null
    const rect = link.getBoundingClientRect()
    previewFilePath.value = ref.filePath
    previewNodeUid.value = ref.nodeUid || ''
    previewPos.value = { x: rect.left, y: rect.bottom }
    previewSrcHref = href
    previewPinned.value = false // 悬浮触发：非固定，鼠标离开自动隐藏
    previewVisible.value = true
  }, 300)
}

/**
 * 链接离开处理
 */
const onLinkLeave = (e) => {
  if (!props.visible) return
  const link = e.target.closest?.('a[href]')
  if (!link) return

  const href = link.getAttribute('href') || ''
  if (!isReferenceLink(href)) return

  // 取消未触发的显示计时器
  if (previewShowTimer) {
    clearTimeout(previewShowTimer)
    previewShowTimer = null
  }

  // 统一延时检查：鼠标若已移到悬浮窗/列表/其他引用链接上则保持显示
  schedulePreviewHide(300)
}

/**
 * 预览隐藏
 */
const onPreviewHide = () => {
  previewVisible.value = false
}

/**
 * 搜索列表项悬浮：右侧显示对应预览（文件级显示整图，节点级缩放定位+高亮闪烁）
 * payload 为 null 表示移出列表，延迟隐藏预览
 */
const onRefItemHover = (payload) => {
  if (!payload) {
    if (previewShowTimer) {
      clearTimeout(previewShowTimer)
      previewShowTimer = null
    }
    if (!previewVisible.value) return
    schedulePreviewHide(300)
    return
  }

  clearPreviewHideTimer()
  if (previewShowTimer) clearTimeout(previewShowTimer)

  previewShowTimer = setTimeout(() => {
    previewShowTimer = null
    previewFilePath.value = payload.filePath
    previewNodeUid.value = payload.nodeUid || ''
    previewPos.value = payload.pos
    previewPinned.value = false
    previewVisible.value = true
  }, 150)
}

/**
 * 预览窗被鼠标移入：取消待执行的隐藏（允许用户拖动/缩放悬浮窗）
 */
const onPreviewStay = () => {
  clearPreviewHideTimer()
}

/**
 * 悬浮窗内拖动状态上报（拖动导图/拖动窗口）：拖动中不自动隐藏，结束后按鼠标位置判定
 */
const onPreviewInteracting = (val) => {
  previewInteracting = !!val
  if (previewInteracting) {
    clearPreviewHideTimer()
  } else {
    schedulePreviewHide(300)
  }
}

/**
 * 预览中打开文件
 */
const onPreviewOpenFile = (data) => {
  previewVisible.value = false
  emit('open-reference-file', data)
}

/* ============================================================
 * AI 菜单事件 → 转发给父组件
 * ============================================================ */

const onAiContinue = (nodes) => {
  emit('ai-continue', nodes)
}

const onAiAddChild = (nodes) => {
  emit('ai-add-child', nodes)
}

const onAiRewrite = (nodes) => {
  emit('ai-rewrite', nodes)
}

const onAiCloze = (nodes) => {
  emit('ai-cloze', nodes)
}

const onAiClozeFullMap = () => {
  emit('ai-cloze-full-map')
}

const onReorganizeMindmap = () => {
  emit('reorganize-mindmap')
}


const onAiQuiz = (nodes) => {
  emit('ai-quiz', nodes)
}

const onAiAddToChat = (nodes) => {
  emit('ai-add-to-chat', nodes)
}

const onAddReview = (nodes) => {
  emit('add-review', nodes)
}

/* ============ 节点备注（思维导图模式） ============ */
const noteDialogVisible = ref(false)
const noteDialogText = ref('')
const noteDialogNodeName = ref('')
const noteDialogNodes = ref([])
const noteDialogPos = ref(null) // 节点屏幕坐标，供备注悬浮窗定位在节点旁

const plainTextOfNode = (node) => {
  const t = node?.getData?.('text') || ''
  return String(t).replace(/<[^>]+>/g, '').trim().slice(0, 40)
}

const onNodeNote = (nodes) => {
  const list = (nodes && nodes.length > 0) ? nodes : []
  if (!list.length) return
  noteDialogNodes.value = list
  noteDialogText.value = list[0].getData?.('note') || ''
  noteDialogNodeName.value = list.length > 1 ? `${plainTextOfNode(list[0])} 等` : plainTextOfNode(list[0])
  // 计算首个节点在屏幕上的位置（含缩放/容器偏移），把备注悬浮窗定位在节点右侧
  noteDialogPos.value = computeNodeScreenPos(list[0])
  noteDialogVisible.value = true
}

// 计算节点在屏幕上的坐标，返回悬浮窗左上角位置（节点右侧，右侧不足时翻到左侧）
const computeNodeScreenPos = (node) => {
  try {
    const gEl = node?.group?.node
    const rect = gEl?.getBoundingClientRect?.()
    if (!rect || rect.width <= 0) return null
    const width = 340
    let x = rect.right + 12
    if (x + width > window.innerWidth - 12) {
      x = rect.left - width - 12
    }
    if (x < 12) x = 12
    const y = Math.max(12, Math.min(rect.top, window.innerHeight - 260))
    return { x, y }
  } catch (e) {
    return null
  }
}

const applyNoteToNodes = (text) => {
  const mm = mindMap
  if (!mm || !noteDialogNodes.value.length) return
  let count = 0
  for (const node of noteDialogNodes.value) {
    try {
      mm.execCommand('SET_NODE_NOTE', node, text || '')
      count++
    } catch (err) {
      console.error('[MindMapEditor] 设置备注失败:', err)
    }
  }
  noteDialogVisible.value = false
  if (count > 0) {
    try {
      ElMessage.success(text ? `已为 ${count} 个节点设置备注` : `已清除 ${count} 个节点的备注`)
    } catch (e) {}
  }
}

const onNoteSave = (text) => applyNoteToNodes(text)
const onNoteClear = () => applyNoteToNodes('')

// 打开文件选择器，为当前选中节点插入图片
const onInsertNodeImage = (nodes) => {
  const list = (Array.isArray(nodes) && nodes.length > 0) ? nodes : (mindMap?.renderer?.activeNodeList || [])
  if (!list.length) {
    try { ElMessage.info('请先选中一个节点再插入图片') } catch (e) {}
    return
  }
  nodeImageTargetNodes.value = list.filter(n => !n.isGeneralization)
  if (!nodeImageTargetNodes.value.length) {
    try { ElMessage.info('概要节点不支持插入图片') } catch (e) {}
    return
  }
  nodeImageInputRef.value?.click()
}

const onNodeImageFileSelected = (e) => {
  const file = e.target?.files?.[0]
  e.target.value = ''
  if (!file || !mindMap || !nodeImageTargetNodes.value.length) return
  const reader = new FileReader()
  reader.onload = async () => {
    const url = String(reader.result || '')
    if (!url) return
    let width = 0
    let height = 0
    try {
      const size = await new Promise((resolve, reject) => {
        const img = new Image()
        img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
        img.onerror = reject
        img.src = url
      })
      width = size.width
      height = size.height
    } catch (err) {
      width = 200
      height = 150
    }
    for (const node of nodeImageTargetNodes.value) {
      try {
        mindMap.execCommand('SET_NODE_IMAGE', node, {
          url,
          title: file.name || '',
          width,
          height,
          custom: false
        })
      } catch (err) {
        console.error('[MindMapEditor] 设置节点图片失败:', err)
      }
    }
    nodeImageTargetNodes.value = []
  }
  reader.readAsDataURL(file)
}

const openNodeImageViewer = (node) => {
  const src = node?.getData?.('image')
  if (!src) return
  nodeImageViewerSrc.value = src
  nodeImageViewerVisible.value = true
}

const onToggleCloze = () => {
  // 与 Ctrl+H 语义一致：只添加/移除挖空标记，显隐由鼠标左键单击挖空文字切换
  const result = clozeWholeNode()
  if (result === 'added' || result === 'removed' || result === 'mixed') {
    setTimeout(() => applyClozeStyles(), 50)
    setTimeout(() => applyClozeStyles(), 200)
  }
}

const onToggleClozeAll = () => {
  // 画布右键菜单：全局切换所有挖空的显隐
  toggleAllCloze()
  setTimeout(() => applyClozeStyles(), 50)
  setTimeout(() => applyClozeStyles(), 200)
}

const onClearAllCloze = () => {
  // 画布右键菜单：移除全图所有挖空标记
  const count = clearAllCloze()
  resetClozeState()
  saveClozeState()
  if (count > 0) {
    try { ElMessage.success(`已清除 ${count} 个节点的挖空`) } catch (e) {}
    setTimeout(() => applyClozeStyles(), 50)
    setTimeout(() => applyClozeStyles(), 200)
  } else {
    try { ElMessage.info('当前导图没有挖空标记') } catch (e) {}
  }
}

// 注意：不监听 props.data 变化！
// 父组件通过 editorRef.value.setData() 显式调用更新，
// 避免数据双向绑定形成无限循环（data_change → 父更新 data → watch 触发 setData → data_change...）

// 视图隐藏期间是否发生过渲染（配合 node_tree_render_start 监听置位）：
// 只有发生过才需要在切回时完整重渲染（恢复 foreignObject 文本），否则切回零重渲染避免闪烁
let renderedWhileHidden = false

// 监听 visible 变化，切换显示时触发 resize 或初始化
watch(
  () => props.visible,
  (visible) => {
    if (visible) {
      nextTick(() => {
        if (mindMap) {
          if (renderedWhileHidden) {
            // 隐藏期间发生过渲染：foreignObject 内文本可能丢失（只剩骨架），需一次完整重渲染恢复
            renderedWhileHidden = false
            // 先同步容器尺寸但跳过 resize() 内部的渲染（后续 reRender 会以新尺寸完整重画，
            // 若不跳过会出现 resize 渲染 + reRender 各一次，画布闪两下）
            try {
              mindMap.getElRectInfo()
              mindMap.svg.size(mindMap.width, mindMap.height)
              mindMap.emit('resize')
            } catch (e) { /* 容器尺寸为0时会抛错，不影响后续 */ }
            let mergedIntoPending = false
            try {
              mindMap.reRender(() => {}, 'SWITCH_VIEW')
              // reRender 被合并进正在进行的渲染队列时（hasWaitRendering），合并渲染存在
              // 节点复用但连线对象指向 clearDraw 清除的旧 DOM 的缺陷，需等队列落定后兜底一次；
              // 未被合并则本次渲染已干净完成，不再二次渲染（否则闪烁两下）
              mergedIntoPending = !!(mindMap.renderer && mindMap.renderer.hasWaitRendering)
            } catch (e) {
              try { mindMap.render() } catch (e2) { /* 忽略 */ }
            }
            if (mergedIntoPending) {
              setTimeout(() => {
                try { if (mindMap) mindMap.reRender() } catch (e) { /* 忽略 */ }
              }, 300)
            }
          } else {
            // 隐藏期间无渲染：画布状态完好，仅同步尺寸即可（尺寸未变时零渲染，完全无闪烁）
            try { mindMap.resize() } catch (e) { /* 容器尺寸为0时会抛错，不影响后续 */ }
          }
        } else {
          // 视图隐藏：关闭残留的引用预览悬浮窗（Teleport 到 body，不随容器 display:none 隐藏），
          // 避免切到另一视图后两个预览窗并存
          closePreviewNow()
          // 思维导图尚未初始化（可能之前容器尺寸为 0），重新尝试
          waitForContainerAndInit()
        }
      })
    }
  }
)

// ResizeObserver：当容器从 0 尺寸变为非 0 时自动初始化思维导图
let resizeObserver = null
// 常驻观察器：容器尺寸变化（右侧 AI 面板开合、侧栏折叠等）时同步实例缓存的 elRect，
// 否则框选矩形会按旧坐标绘制，出现在远离鼠标的位置
let containerSizeObserver = null

const startContainerSizeObserver = () => {
  if (containerSizeObserver || !containerRef.value) return
  containerSizeObserver = new ResizeObserver((entries) => {
    if (!mindMap) return
    for (const entry of entries) {
      const { width, height } = entry.contentRect
      if (width > 0 && height > 0) {
        try { mindMap.resize() } catch (e) { /* 忽略瞬时异常尺寸 */ }
        break
      }
    }
  })
  containerSizeObserver.observe(containerRef.value)
}

const waitForContainerAndInit = () => {
  if (!containerRef.value) return

  // 如果思维导图已初始化，只需 resize
  if (mindMap) {
    mindMap.resize()
    return
  }

  // 检查容器当前尺寸
  const rect = containerRef.value.getBoundingClientRect()
  if (rect.width > 0 && rect.height > 0) {
    initMindMap()
    return
  }

  // 容器尺寸为 0，使用 ResizeObserver 等待尺寸变化
  if (resizeObserver) resizeObserver.disconnect()

  resizeObserver = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const { width, height } = entry.contentRect
      if (width > 0 && height > 0) {
        resizeObserver.disconnect()
        resizeObserver = null
        initMindMap()
        break
      }
    }
  })

  resizeObserver.observe(containerRef.value)
}

onMounted(() => {
  document.addEventListener('keydown', onQuillKeydownCapture, true)
  window.addEventListener('mousemove', onPreviewMouseMove)
  nextTick(() => {
    waitForContainerAndInit()
    startContainerSizeObserver()
  })
})

onBeforeUnmount(() => {
  if (resizeObserver) {
    resizeObserver.disconnect()
    resizeObserver = null
  }
  if (containerSizeObserver) {
    containerSizeObserver.disconnect()
    containerSizeObserver = null
  }
  // 销毁挖空观察器
  destroyCloze()
  if (mindMap) {
    mindMap.destroy()
    mindMap = null
    mindMapStore.setMindMap(null)
    // [多实例] 从多实例表注销本实例
    if (props.fileId) mindMapStore.unregisterInstance(props.fileId)
  }
  // 清理引用功能的 document 级事件监听
  document.removeEventListener('keydown', onQuillKeydownCapture, true)
  window.removeEventListener('mousemove', onPreviewMouseMove)
  document.removeEventListener('click', onLinkClick, true)
  document.removeEventListener('mouseover', onLinkHover, true)
  document.removeEventListener('mouseout', onLinkLeave, true)
  document.removeEventListener('mousedown', onRefPopupExternalMousedown, true)
  document.removeEventListener('input', onQuillInputCapture, true)
  if (previewHideTimer) {
    clearTimeout(previewHideTimer)
  }
  if (previewShowTimer) {
    clearTimeout(previewShowTimer)
  }
})

// 暴露方法
defineExpose({
  getMindMap: () => mindMap,
  setFullscreen,
  // 提交进行中的文本编辑（导图 quill 编辑框）：hideEditTextBox 会把编辑内容写回节点数据。
  // 供关窗保护/切换文件前调用，避免编辑中的文本未入库即丢失
  commitEditing: () => {
    try {
      if (mindMap && mindMap.renderer && mindMap.renderer.textEdit) {
        mindMap.renderer.textEdit.hideEditTextBox()
      }
      // addHistory 被 throttle 包裹（100ms 尾沿触发），SET_NODE_TEXT 后 data_change
      // 不会同步派发，上层 flushAutoSave 检查 isDirty 时仍为 false 会直接跳过保存。
      // 这里用未节流的 originAddHistory 强制立即落历史并同步派发 data_change
      if (mindMap && mindMap.command && mindMap.command.originAddHistory) {
        try { mindMap.command.originAddHistory() } catch (e) { /* 忽略 */ }
      }
    } catch (e) { /* 忽略 */ }
  },
  setData: (data) => {
    if (mindMap && data) {
      // 外部数据替换前先提交编辑中的文本并关闭编辑框，避免未提交输入被直接丢弃、编辑框悬在新数据上
      try {
        if (mindMap.renderer && mindMap.renderer.textEdit) {
          mindMap.renderer.textEdit.hideEditTextBox()
        }
      } catch (e) { /* 忽略 */ }
      const normalized = normalizeNodeData(JSON.parse(JSON.stringify(data)))
      isSettingData = true
      // setData 内部已走 reRender（clearDraw+clearCache+render），无需再 render，避免产生重影
      mindMap.setData(normalized)
      // render 是异步的，下一帧解除锁定
      nextTick(() => {
        isSettingData = false
      })
    }
  },
  // 容器隐藏（display:none，如先切到大纲视图）时实例可能从未初始化：
  // 大纲视图依赖 mindMap 实例（renderTree/getData），必须在隐藏状态下也能建实例，
  // 切回思维导图视图时由 visible watch 负责 resize+reRender 修正布局
  ensureInit: () => {
    if (mindMap) {
      try { mindMap.resize() } catch (e) { /* 隐藏容器 resize 可能无意义，忽略 */ }
      return
    }
    if (containerRef.value) {
      // 建实例前先移除挂起的 ResizeObserver：否则容器从 display:none 恢复尺寸时
      // 观察器回调会再次 initMindMap，在同一容器里建出第二个实例（重复导图）
      if (resizeObserver) {
        resizeObserver.disconnect()
        resizeObserver = null
      }
      try {
        initMindMap()
      } catch (e) {
        // 隐藏容器（0 尺寸）下构造可能失败：装回 ResizeObserver，容器恢复可见时自愈重建，
        // 否则观察器已被拆除、实例又为 null，导图将永久无法初始化
        console.error('[MindMapEditor] ensureInit 初始化失败，等待容器可见后重试:', e)
        waitForContainerAndInit()
      }
    }
  },
  getData: () => {
    if (mindMap) {
      return mindMap.getData()
    }
    return null
  },
  execCommand: (...args) => {
    if (mindMap) {
      mindMap.execCommand(...args)
    }
  },
  resize: () => {
    if (mindMap) {
      mindMap.resize()
    }
  },
  toggleCloze: () => {
    return toggleAllCloze()
  },
  isClozeHidden: () => {
    return isClozeHiddenAll()
  },
  applyCloze: () => {
    applyClozeStyles()
  },
  insertNodeImage: (nodes) => {
    onInsertNodeImage(nodes)
  },
  createCloze: () => {
    const result = clozeWholeNode()
    if (result === 'added' || result === 'removed' || result === 'mixed') {
      setTimeout(() => applyClozeStyles(), 50)
      setTimeout(() => applyClozeStyles(), 200)
      setTimeout(() => applyClozeStyles(), 500)
    }
    return result
  },
  toggleSelectionCloze: () => {
    const result = toggleSelectionCloze()
    if (result === 'added') {
      setTimeout(() => applyClozeStyles(), 50)
      setTimeout(() => applyClozeStyles(), 200)
    }
    return result
  },
  isEditing: () => {
    if (!mindMap || !mindMap.richText) return false
    const rt = mindMap.richText
    return !!(rt.showTextEdit && rt.textEditNode && rt.textEditNode.style.display !== 'none')
  },
  hasActiveNodeCloze: () => {
    if (!mindMap || !mindMap.renderer) return false
    const activeNodes = mindMap.renderer.activeNodeList
    if (!activeNodes || activeNodes.length === 0) return false
    return activeNodes.some(node => nodeHasCloze(node))
  },
  hasActiveNodes: () => {
    if (!mindMap || !mindMap.renderer) return false
    const activeNodes = mindMap.renderer.activeNodeList
    return !!(activeNodes && activeNodes.length > 0)
  },
  highlightNodes: (nodes) => {
    if (!mindMap || !mindMap.renderer || !nodes) return
    const nodeArr = Array.isArray(nodes) ? nodes : [nodes]
    mindMap.renderer.clearActiveNode()
    nodeArr.forEach(node => {
      if (node && mindMap.renderer.addNodeToActiveList) {
        mindMap.renderer.addNodeToActiveList(node)
      }
    })
    if (mindMap.renderer.emitNodeActiveEvent) {
      mindMap.renderer.emitNodeActiveEvent()
    }
  }
})
</script>

<style scoped>
.mind-map-wrapper {
  flex: 1;
  min-width: 0;
  min-height: 0;
  position: relative;
  overflow: hidden;
}

/* 全屏展示：固定定位覆盖整个窗口，只保留导图（低于右键菜单/悬浮预览层级） */
.mind-map-wrapper.is-fullscreen {
  position: fixed;
  inset: 0;
  z-index: 5000;
  border-radius: 0;
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

.mind-map-container {
  width: 100%;
  height: 100%;
  touch-action: none;
}

/* 确保 SVG 占满容器 */
.mind-map-container :deep(svg) {
  width: 100%;
  height: 100%;
}

/* ============ 引用链接样式 ============ */
/* 渲染态：思维导图节点中的引用链接（灰色背景引用块） */
.mind-map-container :deep(.smm-richtext-node-wrap a[href^="mindmap-file:"]),
.mind-map-container :deep(.smm-richtext-node-wrap a[href^="mindmap-node:"]),
.mind-map-container :deep(.ql-editor a[href^="mindmap-file:"]),
.mind-map-container :deep(.ql-editor a[href^="mindmap-node:"]) {
  background-color: rgba(120, 120, 128, 0.18);
  color: #3a3a3c;
  padding: 1px 6px;
  border-radius: 4px;
  text-decoration: none;
  cursor: pointer;
  font-size: 0.9em;
  font-weight: 500;
  transition: background-color 0.15s ease;
}

.mind-map-container :deep(.smm-richtext-node-wrap a[href^="mindmap-file:"]:hover),
.mind-map-container :deep(.smm-richtext-node-wrap a[href^="mindmap-node:"]:hover),
.mind-map-container :deep(.ql-editor a[href^="mindmap-file:"]:hover),
.mind-map-container :deep(.ql-editor a[href^="mindmap-node:"]:hover) {
  background-color: rgba(120, 120, 128, 0.3);
}

/* ============ 节点图片全屏查看 ============ */
.node-img-viewer-mask {
  position: fixed;
  inset: 0;
  z-index: 6000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.82);
  cursor: zoom-out;
}

.node-img-viewer-img {
  max-width: calc(100vw - 64px);
  max-height: calc(100vh - 64px);
  object-fit: contain;
  border-radius: 8px;
  box-shadow: 0 12px 50px rgba(0, 0, 0, 0.5);
}

.node-img-viewer-close {
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

.node-img-hint {
  position: fixed;
  z-index: 6001;
  padding: 3px 8px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.68);
  color: #fff;
  font-size: 11px;
  white-space: nowrap;
  pointer-events: none;
  transform: translate(-50%, -50%);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}

.node-img-viewer-enter-active,
.node-img-viewer-leave-active {
  transition: opacity 0.18s ease;
}

.node-img-viewer-enter-from,
.node-img-viewer-leave-to {
  opacity: 0;
}

/* ============ 挖空样式 ============ */
/* 挖空内容基础样式（显示态：深紫下划线 + 半透明紫底） */
.mind-map-container :deep(.smm-cloze) {
  background-color: rgba(124, 58, 237, 0.13);
  border-bottom: 2px solid rgba(124, 58, 237, 0.7);
  border-radius: 3px;
  padding: 0 1px;
  transition: all 0.2s ease;
}

/* 挖空隐藏态：文字透明 + 半透明紫底 + 深紫下划线
   通配符覆盖后代自带的 color 内联样式（先设字色再挖空时文字才能藏住） */
.mind-map-container :deep(.smm-cloze-hidden),
.mind-map-container :deep(.smm-cloze-hidden *) {
  color: transparent !important;
}

.mind-map-container :deep(.smm-cloze-hidden) {
  background-color: rgba(124, 58, 237, 0.18) !important;
  border-bottom: 2px solid #7c3aed !important;
}

/* 编辑态：quill 内 <code> 标签显示深紫下划线（挖空标记）
   只用 text-decoration 一条线：再加 border-bottom 会双线叠加显粗 */
.mind-map-container :deep(.ql-editor code) {
  background-color: transparent;
  color: inherit;
  text-decoration: underline;
  text-decoration-color: #7c3aed;
  text-decoration-thickness: 2px;
  text-underline-offset: 3px;
  padding-bottom: 1px;
  border-radius: 2px;
}

/* 编辑态：已有挖空 span（smm-cloze）同样显示深紫下划线 + 紫底，提示挖空范围 */
.mind-map-container :deep(.ql-editor .smm-cloze) {
  background-color: rgba(124, 58, 237, 0.13);
  text-decoration: underline;
  text-decoration-color: #7c3aed;
  text-decoration-thickness: 2px;
  text-underline-offset: 3px;
  padding-bottom: 1px;
  border-radius: 2px;
  cursor: pointer;
}
</style>

<!-- 透明化 Quill 编辑器（openRealtimeRenderOnNodeTextEdit 模式）
     非 scoped 样式，因为编辑器元素被附加到 document.body -->
<style>
.smm-richtext-node-edit-wrap {
  background: transparent !important;
  box-shadow: none !important;
  border: none !important;
}
.smm-richtext-node-edit-wrap .ql-container {
  background: transparent !important;
  border: none !important;
  box-shadow: none !important;
}
.smm-richtext-node-edit-wrap .ql-container.ql-snow {
  border: none !important;
  background: transparent !important;
}
.smm-richtext-node-edit-wrap .ql-editor {
  background: transparent !important;
  border: none !important;
  box-shadow: none !important;
}
.smm-richtext-node-edit-wrap .ql-editor.ql-blank::before {
  display: none !important;
}
.smm-richtext-node-edit-wrap .ql-tooltip {
  display: none !important;
}

/* 编辑态挖空标记：编辑器挂在 document.body 上，scoped 选择器匹配不到，必须用全局样式。
   文字保持可见，深紫下划线 + 紫底提示挖空范围（取消部分挖空后仍能识别哪些文字被挖空）
   只用 text-decoration 一条线：再加 border-bottom 会双线叠加显粗 */
.smm-richtext-node-edit-wrap .ql-editor .smm-cloze {
  background-color: rgba(124, 58, 237, 0.13);
  text-decoration: underline;
  text-decoration-color: #7c3aed;
  text-decoration-thickness: 2px;
  text-underline-offset: 3px;
  padding-bottom: 1px;
  border-radius: 2px;
}

/* 编辑态引用原子块：编辑器挂在 document.body 上，scoped 选择器匹配不到，必须用全局样式。
   灰底胶囊样式与渲染态一致，cursor:pointer 提示可点击弹出预览 */
.smm-richtext-node-edit-wrap .ql-editor a.smm-ref {
  background-color: rgba(120, 120, 128, 0.18);
  color: #3a3a3c;
  padding: 1px 6px;
  border-radius: 4px;
  text-decoration: none;
  cursor: pointer;
  font-size: 0.9em;
  font-weight: 500;
  user-select: all;
}

.smm-richtext-node-edit-wrap .ql-editor a.smm-ref:hover {
  background-color: rgba(120, 120, 128, 0.3);
}

.smm-richtext-node-edit-wrap .ql-editor code {
  background-color: transparent;
  color: inherit;
  text-decoration: underline;
  text-decoration-color: #7c3aed;
  text-decoration-thickness: 2px;
  text-underline-offset: 3px;
  padding-bottom: 1px;
  border-radius: 2px;
}

/* 节点内粘贴的多张图片：编辑态与渲染态统一按内容缩略显示 */
.smm-richtext-node-wrap img,
.smm-richtext-node-edit-wrap .ql-editor img {
  display: inline-block;
  vertical-align: middle;
  max-width: 180px;
  max-height: 120px;
  width: auto;
  height: auto;
  border-radius: 6px;
  margin: 1px 2px;
  object-fit: contain;
}
</style>

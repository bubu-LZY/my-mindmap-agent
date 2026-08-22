<template>
  <Teleport to="body">
    <Transition name="ctx-menu">
      <div
        v-if="visible"
        ref="menuRef"
        class="context-menu"
        :style="menuStyle"
        @click.stop
        @contextmenu.prevent
        @mousedown.stop
      >
        <template v-for="(item, index) in currentItems" :key="index">
          <!-- 分隔线 -->
          <div v-if="item.sep" class="ctx-separator"></div>

          <!-- 菜单项 -->
          <button
            v-else
            class="ctx-item"
            :class="{ danger: item.danger, ai: item.ai, 'has-badge': !!item.badge }"
            @click="onSelect(item)"
            @mouseenter="onItemHover"
          >
            <span v-if="item.badge" class="ctx-ai-badge">{{ item.badge }}</span>
            <span v-else-if="item.ai" class="ctx-ai-dot" aria-hidden="true"></span>
            <span class="ctx-label">{{ item.label }}</span>
            <span v-if="item.shortcut" class="ctx-shortcut">{{ item.shortcut }}</span>
          </button>
        </template>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'

const props = defineProps({
  visible: {
    type: Boolean,
    default: false
  },
  left: {
    type: Number,
    default: 0
  },
  top: {
    type: Number,
    default: 0
  },
  type: {
    type: String,
    default: 'node' // 'node' | 'svg'
  },
  node: {
    type: Object,
    default: null
  },
  activeNodes: {
    type: Array,
    default: () => []
  },
  mindMap: {
    type: Object,
    default: null
  },
  // 是否由组件内部通过 mindMap.execCommand 执行命令
  // MindMapEditor 传 true（默认），OutlineView 传 false 并通过 select 事件自行处理
  execMode: {
    type: Boolean,
    default: true
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
  'toggle-cloze',
  'toggle-cloze-all',
  'clear-all-cloze',
  'node-note',
  'insert-image',
  'close',
  'select'
])

const menuRef = ref(null)
const adjustedLeft = ref(0)
const adjustedTop = ref(0)

/* ============================================================
 * 菜单项定义
 * ============================================================ */

const isMultiNode = computed(() => props.activeNodes && props.activeNodes.length > 1)

const nodeMenuItems = computed(() => {
  const multi = isMultiNode.value
  const count = multi ? props.activeNodes.length : 0
  const isOutline = !props.execMode
  const hasNote = !!(props.node?.getData?.('note'))
  const hasOuterFrame = !!(props.node?.getData?.('outerFrame'))

  const items = [
    { key: 'NODE_NOTE', label: multi ? `为 ${count} 个节点设置备注` : (hasNote ? '编辑备注' : '添加备注') },
    { key: 'NODE_IMAGE', label: multi ? `为 ${count} 个节点插入图片` : '插入图片' },
    { sep: true },
    { key: 'REMOVE_NODE', label: multi ? `删除 ${count} 个节点` : '删除节点', shortcut: 'Delete', danger: true },
    { sep: true },
    { key: 'AI_CONTINUE', label: multi ? `AI 续写 ${count} 个节点` : 'AI 续写此节点', badge: '续写', ai: true },
    { key: 'AI_ADD_CHILD', label: multi ? `AI 为 ${count} 个节点新增子节点` : 'AI 新增子节点', badge: '新增', ai: true },
    { key: 'AI_REWRITE', label: multi ? `AI 背诵改写 ${count} 个节点` : 'AI 背诵改写此节点', badge: '改写', ai: true },
    { key: 'AI_CLOZE', label: multi ? `AI 智能挖空 ${count} 个节点` : 'AI 智能挖空', badge: '挖空', ai: true },
    { key: 'AI_QUIZ', label: multi ? `AI 出题 ${count} 个节点` : 'AI 出题', badge: '出题', ai: true },
    { key: 'AI_ADD_TO_CHAT', label: multi ? `将 ${count} 个节点添加到 AI 对话` : '将节点添加到 AI 对话', badge: '对话', ai: true },
    { key: 'ADD_REVIEW', label: multi ? `为 ${count} 个节点添加复习计划` : '添加复习计划', shortcut: 'Ctrl+R' },
    ...(isOutline
      ? [
          { sep: true },
          { key: 'ADD_OUTER_FRAME', label: multi ? `为 ${count} 个节点添加外框` : '添加外框' },
          ...(hasOuterFrame ? [{ key: 'REMOVE_OUTER_FRAME', label: '移除外框' }] : [])
        ]
      : [])
  ]

  return items
})

const svgMenuItems = computed(() => [
  { key: 'RETURN_CENTER', label: '回到中心', shortcut: 'Ctrl+Enter' },
  { sep: true },
  { key: 'EXPAND_ALL', label: '展开所有' },
  { key: 'UNEXPAND_ALL', label: '收起所有' },
  { sep: true },
  { key: 'RESET_LAYOUT', label: '整理布局', shortcut: 'Ctrl+L' },
  { key: 'FIT_CANVAS', label: '适应画布', shortcut: 'Ctrl+I' },
  { sep: true },
  { key: 'REMOVE_ASSOC_LINE', label: '删除选中的关联线' },
  { sep: true },
  { key: 'REORGANIZE_MINDMAP', label: '一键整理导图（为新文件）', badge: '整理', ai: true },
  { key: 'AI_CLOZE_FULL_MAP', label: 'AI 全文挖空', badge: '挖空', ai: true },
  { key: 'TOGGLE_CLOZE_ALL', label: '显示/隐藏全部挖空' },
  { key: 'CLEAR_ALL_CLOZE', label: '清除全文挖空', danger: true }
])

const currentItems = computed(() =>
  props.type === 'node' ? nodeMenuItems.value : svgMenuItems.value
)

const menuStyle = computed(() => ({
  left: adjustedLeft.value + 'px',
  top: adjustedTop.value + 'px'
}))

/* ============================================================
 * 菜单显示位置自适应（避免溢出视口）
 * ============================================================ */

const adjustPosition = () => {
  const el = menuRef.value
  if (!el) {
    adjustedLeft.value = props.left
    adjustedTop.value = props.top
    return
  }
  const rect = el.getBoundingClientRect()
  const margin = 8
  const vw = window.innerWidth
  const vh = window.innerHeight
  let l = props.left
  let t = props.top
  if (l + rect.width > vw - margin) {
    l = Math.max(margin, vw - rect.width - margin)
  }
  if (t + rect.height > vh - margin) {
    t = Math.max(margin, vh - rect.height - margin)
  }
  adjustedLeft.value = l
  adjustedTop.value = t
}

watch(
  () => props.visible,
  (visible) => {
    if (visible) {
      // 先用原始坐标渲染，避免闪烁
      adjustedLeft.value = props.left
      adjustedTop.value = props.top
      nextTick(adjustPosition)
    }
  }
)

// 坐标变化时（连续右键）重新计算
watch(
  [() => props.left, () => props.top, () => props.type],
  () => {
    if (props.visible) {
      adjustedLeft.value = props.left
      adjustedTop.value = props.top
      nextTick(adjustPosition)
    }
  }
)

/* ============================================================
 * 命令执行
 * ============================================================ */

const execCommand = (command) => {
  const mm = props.mindMap
  if (!mm) return
  try {
    mm.execCommand(command)
  } catch (err) {
    console.error('[Contextmenu] execCommand 失败:', command, err)
  }
}

const executeAction = (key) => {
  const mm = props.mindMap
  if (!mm) return
  switch (key) {
    case 'INSERT_NODE':
      execCommand('INSERT_NODE')
      break
    case 'INSERT_CHILD_NODE':
      execCommand('INSERT_CHILD_NODE')
      break
    case 'INSERT_PARENT_NODE':
      execCommand('INSERT_PARENT_NODE')
      break
    case 'UP_NODE':
      execCommand('UP_NODE')
      break
    case 'DOWN_NODE':
      execCommand('DOWN_NODE')
      break
    case 'TOGGLE_EXPAND':
      // 切换激活节点的展开状态
      if (mm.renderer && typeof mm.renderer.toggleActiveExpand === 'function') {
        mm.renderer.toggleActiveExpand()
      } else if (props.node) {
        mm.execCommand('SET_NODE_EXPAND', props.node, !props.node.getData('expand'))
      }
      break
    case 'REMOVE_NODE':
      execCommand('REMOVE_NODE')
      break
    case 'REMOVE_CURRENT_NODE':
      execCommand('REMOVE_CURRENT_NODE')
      break
    case 'COPY_NODE':
      if (mm.renderer && typeof mm.renderer.copy === 'function') {
        mm.renderer.copy()
      }
      break
    case 'CUT_NODE':
      if (mm.renderer && typeof mm.renderer.cut === 'function') {
        mm.renderer.cut()
      }
      break
    case 'PASTE_NODE':
      if (mm.renderer && typeof mm.renderer.paste === 'function') {
        mm.renderer.paste()
      }
      break
    case 'RETURN_CENTER':
      if (mm.renderer && typeof mm.renderer.setRootNodeCenter === 'function') {
        mm.renderer.setRootNodeCenter()
      }
      break
    case 'EXPAND_ALL':
      execCommand('EXPAND_ALL')
      break
    case 'UNEXPAND_ALL':
      execCommand('UNEXPAND_ALL')
      break
    case 'RESET_LAYOUT':
      execCommand('RESET_LAYOUT')
      break
    case 'FIT_CANVAS':
      if (mm.view && typeof mm.view.fit === 'function') {
        mm.view.fit()
      }
      break
    case 'REMOVE_ASSOC_LINE':
      // 删除当前激活（点击选中）的关联线
      if (mm.associativeLine) {
        try {
          mm.associativeLine.removeLine()
        } catch (err) {}
      }
      break
    default:
      break
  }
}

/* ============================================================
 * 选择处理
 * ============================================================ */

const onSelect = (item) => {
  if (item.sep) return

  // 获取激活节点列表（多节点场景）
  const nodes = (props.activeNodes && props.activeNodes.length > 0) ? props.activeNodes : (props.node ? [props.node] : [])

  // AI 相关动作：始终 emit，交由父组件处理
  switch (item.key) {
    case 'AI_CONTINUE':
      emit('ai-continue', nodes)
      close()
      return
    case 'AI_ADD_CHILD':
      emit('ai-add-child', nodes)
      close()
      return
    case 'AI_REWRITE':
      emit('ai-rewrite', nodes)
      close()
      return
    case 'AI_CLOZE':
      emit('ai-cloze', nodes)
      close()
      return
    case 'AI_QUIZ':
      emit('ai-quiz', nodes)
      close()
      return
    case 'REORGANIZE_MINDMAP':
      emit('reorganize-mindmap')
      close()
      return
    case 'AI_CLOZE_FULL_MAP':
      emit('ai-cloze-full-map')
      close()
      return
    case 'AI_ADD_TO_CHAT':
      emit('ai-add-to-chat', nodes)
      close()
      return
    case 'ADD_REVIEW':
      emit('add-review', nodes)
      close()
      return
    case 'TOGGLE_CLOZE':
      emit('toggle-cloze')
      close()
      return
    case 'NODE_NOTE':
      emit('node-note', nodes)
      close()
      return
    case 'NODE_IMAGE':
      emit('insert-image', nodes)
      close()
      return
    case 'TOGGLE_CLOZE_ALL':
      emit('toggle-cloze-all')
      close()
      return
    case 'CLEAR_ALL_CLOZE':
      emit('clear-all-cloze')
      close()
      return
  }

  // 通用动作：通知父组件（OutlineView 等可据此做直接数据操作）
  emit('select', { action: item.key, node: props.node, nodes })

  // execMode 为 true 时由组件内部执行命令（MindMapEditor 场景）
  if (props.execMode) {
    executeAction(item.key)
  }

  close()
}

const close = () => {
  emit('close')
}

const onItemHover = () => {
  // 预留：hover 时的扩展点
}

/* ============================================================
 * 点击外部 / Esc 关闭
 * ============================================================ */

const onClickOutside = (e) => {
  if (!props.visible) return
  if (menuRef.value && !menuRef.value.contains(e.target)) {
    close()
  }
}

const onKeydown = (e) => {
  if (e.key === 'Escape' && props.visible) {
    close()
  }
}

onMounted(() => {
  document.addEventListener('mousedown', onClickOutside, true)
  document.addEventListener('keydown', onKeydown)
  window.addEventListener('resize', onResize)
})

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onClickOutside, true)
  document.removeEventListener('keydown', onKeydown)
  window.removeEventListener('resize', onResize)
})

const onResize = () => {
  if (props.visible) {
    close()
  }
}
</script>

<style scoped>
.context-menu {
  position: fixed;
  z-index: 9999;
  min-width: 240px;
  max-width: 340px;
  padding: 4px;
  background: rgba(255, 255, 255, 0.88);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  backdrop-filter: blur(20px) saturate(180%);
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.16),
    0 2px 8px rgba(0, 0, 0, 0.08),
    0 0 0 0.5px rgba(0, 0, 0, 0.04);
  user-select: none;
  font-family: var(--font-family, -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'PingFang SC', sans-serif);
}

/* 菜单项 */
.ctx-item {
  position: relative;
  display: flex;
  align-items: center;
  width: 100%;
  height: 30px;
  padding: 0 10px;
  border: none;
  background: transparent;
  border-radius: 7px;
  cursor: pointer;
  color: #1d1d1f;
  font-size: 13px;
  font-weight: 400;
  text-align: left;
  transition: background-color 0.12s ease, color 0.12s ease;
}

.ctx-item:hover {
  background-color: rgba(0, 122, 255, 0.1);
  color: #007aff;
}

.ctx-item:active {
  background-color: rgba(0, 122, 255, 0.16);
}

.ctx-label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ctx-shortcut {
  flex-shrink: 0;
  margin-left: 16px;
  font-size: 11px;
  color: #86868b;
  font-weight: 400;
  letter-spacing: 0.2px;
}

.ctx-item:hover .ctx-shortcut {
  color: rgba(0, 122, 255, 0.7);
}

/* 危险项（删除） */
.ctx-item.danger {
  color: #ff3b30;
}

.ctx-item.danger:hover {
  background-color: rgba(255, 59, 48, 0.1);
  color: #ff3b30;
}

.ctx-item.danger:active {
  background-color: rgba(255, 59, 48, 0.16);
}

/* AI 项 */
.ctx-item.ai {
  color: #1d1d1f;
}

.ctx-item.ai:hover {
  background-color: rgba(175, 82, 222, 0.1);
  color: #af52de;
}

.ctx-item.ai:active {
  background-color: rgba(175, 82, 222, 0.16);
}

.ctx-ai-dot {
  flex-shrink: 0;
  width: 6px;
  height: 6px;
  margin-right: 8px;
  border-radius: 50%;
  background: linear-gradient(135deg, #af52de, #5856d6);
  box-shadow: 0 0 0 2px rgba(175, 82, 222, 0.12);
}

/* AI 功能前置标签：蓝底白字，加强提醒 */
.ctx-ai-badge {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 34px;
  height: 18px;
  padding: 0 6px;
  margin-right: 8px;
  border-radius: 5px;
  background-color: #007aff;
  color: #ffffff;
  font-size: 11px;
  font-weight: 500;
  line-height: 1;
  letter-spacing: 1px;
}

.ctx-item.has-badge .ctx-label {
  text-overflow: clip;
}

/* 分隔线 */
.ctx-separator {
  height: 1px;
  margin: 4px 10px;
  background-color: rgba(0, 0, 0, 0.08);
  flex-shrink: 0;
}

/* 进入/离开动画 */
.ctx-menu-enter-active,
.ctx-menu-leave-active {
  transition: opacity 0.16s ease, transform 0.16s ease;
  transform-origin: top left;
}

.ctx-menu-enter-from,
.ctx-menu-leave-to {
  opacity: 0;
  transform: scale(0.96);
}
</style>

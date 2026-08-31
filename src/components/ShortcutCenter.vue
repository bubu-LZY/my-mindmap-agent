<template>
  <Teleport to="body">
    <Transition name="sc-pop">
      <div v-if="visible" class="sc-mask" @click.self="$emit('close')">
        <div class="sc-window" role="dialog" aria-label="快捷键中心">
          <!-- 标题栏 -->
          <div class="sc-header">
            <div class="sc-title-wrap">
              <span class="sc-title-icon">
                <svg viewBox="0 0 20 20" fill="none" width="15" height="15">
                  <rect x="2" y="4" width="16" height="12" rx="2.5" stroke="currentColor" stroke-width="1.5"/>
                  <path d="M6.5 8h3M6.5 11.5h7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                </svg>
              </span>
              <span class="sc-title">快捷键中心</span>
              <span class="sc-subtitle">操作查看手册</span>
            </div>
            <button class="sc-close-btn" title="关闭" @click="$emit('close')">
              <svg viewBox="0 0 14 14" fill="none" width="12" height="12">
                <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
              </svg>
            </button>
          </div>

          <!-- 可滚动内容区 -->
          <div class="sc-body" ref="bodyRef">
            <div v-for="group in shortcutGroups" :key="group.name" class="sc-group">
              <div class="sc-group-header">
                <span class="sc-group-dot" :style="{ background: group.color }"></span>
                <span class="sc-group-name">{{ group.name }}</span>
              </div>
              <div v-for="(item, idx) in group.items" :key="group.name + idx" class="sc-row">
                <div class="sc-keys">
                  <template v-for="(key, ki) in item.keys" :key="ki">
                    <kbd class="sc-kbd">{{ key.k }}</kbd>
                    <span v-if="ki < item.keys.length - 1" class="sc-key-sep">+</span>
                  </template>
                </div>
                <div class="sc-desc">{{ item.desc }}</div>
              </div>
            </div>

            <div class="sc-footer-tip">
              提示：挖空内容默认隐藏，单击挖空文字可切换显示/隐藏；AI 生成的节点修改均可通过 Ctrl+Z 撤销。
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'

defineProps({
  visible: { type: Boolean, default: false }
})
const emit = defineEmits(['close'])

const bodyRef = ref(null)

const onEsc = (e) => {
  if (e.key === 'Escape') emit('close')
}
onMounted(() => window.addEventListener('keydown', onEsc))
onBeforeUnmount(() => window.removeEventListener('keydown', onEsc))

const k = (key) => ({ k: key })

const shortcutGroups = [
  {
    name: '通用（全局）',
    color: '#3b82f6',
    items: [
      { keys: [k('Ctrl'), k('Z')], desc: '撤销上一步操作（含 AI 生成 / 改写 / 挖空 / 续写）' },
      { keys: [k('Ctrl'), k('Y')], desc: '重做（也可用 Ctrl+Shift+Z）' },
      { keys: [k('Ctrl'), k('S')], desc: '保存当前思维导图文件' },
      { keys: [k('Ctrl'), k('F')], desc: '聚焦搜索栏；全屏模式下打开节点搜索框' },
      { keys: [k('Ctrl'), k('R')], desc: '将当前选中节点添加到复习计划' },
      { keys: [k('Ctrl'), k('H')], desc: '添加 / 移除挖空标记（编辑态：选中文字；非编辑态：整个节点）' },
      { keys: [k('Ctrl'), k('G')], desc: '添加概要 / 概括（大纲模式：打开概括编辑窗；导图模式：激活节点添加概括）' },
      { keys: [k('Ctrl'), k('`')], desc: '添加 / 移除删除线（编辑态：选中文字；非编辑态：整个节点内容）' },
      { keys: [k('Ctrl'), k('B')], desc: '添加 / 移除加粗（编辑态：选中文字；非编辑态：整个节点内容）' },
      { keys: [k('Ctrl'), k('I')], desc: '添加 / 移除斜体（编辑态：选中文字；非编辑态：整个节点内容）' },
      { keys: [k('Ctrl'), k('U')], desc: '添加 / 移除下划线（编辑态：选中文字；非编辑态：整个节点内容）' },
      { keys: [k('Ctrl'), k('Enter')], desc: '回到中心（画布视野回归根节点）' },
      { keys: [k('Alt'), k('1')], desc: '截图识别文字（OCR）' },
      { keys: [k('Alt'), k('R/O/G/B/P/K')], desc: '设置选中节点的字体颜色（红/橙/绿/蓝/紫/黑，支持框选多节点批量）' },
      { keys: [k('Ctrl'), k('Alt'), k('Y/G/B/P')], desc: '设置选中节点的高亮背景色（黄/绿/蓝/粉）' }
    ]
  },
  {
    name: '思维导图模式',
    color: '#8b5cf6',
    items: [
      { keys: [k('Tab')], desc: '插入子节点' },
      { keys: [k('Enter')], desc: '插入兄弟节点' },
      { keys: [k('Delete')], desc: '删除选中节点（Backspace 同效）' },
      { keys: [k('↑ ↓ ← →')], desc: '在节点之间导航' },
      { keys: [k('双击节点')], desc: '进入文本编辑状态（鼠标操作）' },
      { keys: [k('单击挖空文字')], desc: '切换挖空的显示 / 隐藏（鼠标操作）' },
      { keys: [k('滚轮 / 拖拽')], desc: '缩放画布 / 平移视图（鼠标操作）' }
    ]
  },
  {
    name: '大纲模式',
    color: '#10b981',
    items: [
      { keys: [k('Enter')], desc: '插入兄弟节点（根节点上为创建子节点）' },
      { keys: [k('Tab')], desc: '将节点降级为子节点' },
      { keys: [k('Shift'), k('Tab')], desc: '提升节点层级' },
      { keys: [k('Backspace ×2')], desc: '删除空节点（清空文字后再按一次）' },
      { keys: [k('↑ ↓ ← →')], desc: '在节点之间导航' },
      { keys: [k('直接输入字符')], desc: '快速编辑选中的节点' },
      { keys: [k('@')], desc: '插入文件引用（弹窗选择文件）' },
      { keys: [k('#')], desc: '插入节点引用（弹窗选择节点）' },
      { keys: [k('Ctrl'), k('H')], desc: '添加 / 移除挖空（编辑态选区 / 非编辑态全节点）' },
      { keys: [k('Esc')], desc: '取消编辑' }
    ]
  },
  {
    name: '文本编辑器内',
    color: '#f59e0b',
    items: [
      { keys: [k('Ctrl'), k('I')], desc: '斜体选中文本' },
      { keys: [k('Ctrl'), k('U')], desc: '下划线选中文本' },
      { keys: [k('↑ ↓')], desc: '引用弹窗打开时：上下选择引用项' },
      { keys: [k('Enter')], desc: '引用弹窗打开时：确认插入引用' },
      { keys: [k('Esc')], desc: '关闭引用弹窗' },
      { keys: [k('Backspace')], desc: '整体删除引用标签（不逐字删除）' }
    ]
  },
  {
    name: 'AI 对话面板',
    color: '#ec4899',
    items: [
      { keys: [k('Enter')], desc: '发送消息（AI 提问等待中：作为提问的回答）' },
      { keys: [k('Shift'), k('Enter')], desc: '输入框内换行' },
      { keys: [k('停止按钮')], desc: '中断 AI 回复与正在运行的工具调用' },
      { keys: [k('快捷回复按钮')], desc: 'AI 续写提问时一键回复「无参考资料 / 无续写要求」' }
    ]
  },
  {
    name: '复习模式',
    color: '#ef4444',
    items: [
      { keys: [k('Ctrl'), k('R')], desc: '添加选中节点到复习计划' },
      { keys: [k('节点右键')], desc: '右键菜单 → 添加到复习计划（鼠标操作）' },
      { keys: [k('单击挖空文字')], desc: '自测时切换挖空答案的显示 / 隐藏（鼠标操作）' }
    ]
  }
]
</script>

<style scoped>
.sc-mask {
  position: fixed;
  inset: 0;
  z-index: 3000;
  background: rgba(15, 23, 42, 0.25);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 9vh;
}

.sc-window {
  width: 480px;
  max-width: calc(100vw - 48px);
  max-height: 76vh;
  display: flex;
  flex-direction: column;
  background: var(--main-bg, #ffffff);
  border: 1px solid var(--border-color, #e2e8f0);
  border-radius: 14px;
  box-shadow: 0 18px 48px rgba(15, 23, 42, 0.22);
  overflow: hidden;
}

/* 标题栏 */
.sc-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 13px 16px 11px;
  border-bottom: 1px solid var(--border-color, #e2e8f0);
  flex-shrink: 0;
  background: linear-gradient(135deg, rgba(139, 92, 246, 0.07), rgba(59, 130, 246, 0.07));
}

.sc-title-wrap {
  display: flex;
  align-items: center;
  gap: 7px;
}

.sc-title-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 7px;
  background: rgba(139, 92, 246, 0.14);
  color: #7c3aed;
}

.sc-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--text-primary, #1e293b);
}

.sc-subtitle {
  font-size: 11px;
  color: var(--text-secondary, #94a3b8);
  border-left: 1px solid var(--border-color, #e2e8f0);
  padding-left: 7px;
  margin-left: 1px;
}

.sc-close-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary, #94a3b8);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.sc-close-btn:hover {
  background: rgba(100, 116, 139, 0.12);
  color: var(--text-primary, #1e293b);
}

/* 可滚动内容 */
.sc-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 12px 16px 14px;
}

.sc-body::-webkit-scrollbar {
  width: 8px;
}

.sc-body::-webkit-scrollbar-thumb {
  background: rgba(100, 116, 139, 0.28);
  border-radius: 4px;
}

.sc-body::-webkit-scrollbar-thumb:hover {
  background: rgba(100, 116, 139, 0.45);
}

.sc-group {
  margin-bottom: 14px;
}

.sc-group-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 7px;
}

.sc-group-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}

.sc-group-name {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-primary, #1e293b);
  letter-spacing: 0.02em;
}

.sc-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 5px 8px;
  border-radius: 7px;
}

.sc-row:hover {
  background: rgba(100, 116, 139, 0.07);
}

.sc-keys {
  display: flex;
  align-items: center;
  gap: 3px;
  flex-shrink: 0;
  min-width: 132px;
  max-width: 180px;
  flex-wrap: wrap;
}

.sc-kbd {
  display: inline-block;
  padding: 2px 7px;
  font-size: 11px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  line-height: 1.45;
  color: #334155;
  background: #f1f5f9;
  border: 1px solid #cbd5e1;
  border-bottom-width: 2px;
  border-radius: 5px;
  white-space: nowrap;
}

.sc-key-sep {
  font-size: 10px;
  color: #94a3b8;
}

.sc-desc {
  font-size: 12px;
  color: var(--text-secondary, #64748b);
  line-height: 1.5;
}

.sc-footer-tip {
  margin-top: 4px;
  padding: 9px 11px;
  font-size: 11px;
  line-height: 1.6;
  color: #7c6ba8;
  background: rgba(139, 92, 246, 0.07);
  border: 1px dashed rgba(139, 92, 246, 0.3);
  border-radius: 8px;
}

/* 弹出动画 */
.sc-pop-enter-active,
.sc-pop-leave-active {
  transition: opacity 0.18s ease;
}

.sc-pop-enter-active .sc-window,
.sc-pop-leave-active .sc-window {
  transition: transform 0.18s ease, opacity 0.18s ease;
}

.sc-pop-enter-from,
.sc-pop-leave-to {
  opacity: 0;
}

.sc-pop-enter-from .sc-window,
.sc-pop-leave-to .sc-window {
  transform: translateY(-10px) scale(0.97);
  opacity: 0;
}
</style>

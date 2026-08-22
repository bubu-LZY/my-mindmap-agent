<template>
  <div
    v-if="visible"
    class="ref-popup"
    :style="{ left: pos.x + 'px', top: pos.y + 'px' }"
    @mousedown.stop
  >
    <!-- 搜索输入 -->
    <div class="ref-search">
      <span class="ref-icon">{{ mode === 'file' ? '@' : '#' }}</span>
      <input
        ref="searchInputRef"
        v-model="searchQuery"
        class="ref-input"
        :class="{ 'ref-input-inline': inline }"
        :readonly="inline"
        tabindex="-1"
        :placeholder="mode === 'file' ? '搜索文件...' : '搜索节点...'"
        @keydown.up.prevent="selectPrev"
        @keydown.down.prevent="selectNext"
        @keydown.enter.prevent="confirmSelection"
        @keydown.escape.prevent="hide"
      />
    </div>

    <!-- 搜索结果列表 -->
    <div class="ref-list" v-if="filteredItems.length > 0" @mouseleave="onListLeave">
      <div
        v-for="(item, index) in filteredItems"
        :key="item.path || item.nodeUid"
        class="ref-item"
        :class="{ active: index === selectedIndex }"
        @click="selectItem(index)"
        @mouseenter="selectedIndex = index"
      >
        <!-- 文件项 -->
        <template v-if="mode === 'file'">
          <span class="ref-item-icon">📄</span>
          <span class="ref-item-name">{{ item.name }}</span>
          <span class="ref-item-meta">{{ item.parentName }}</span>
        </template>
        <!-- 节点项 -->
        <template v-else>
          <span class="ref-item-icon">🔗</span>
          <div class="ref-item-content">
            <span class="ref-item-name">{{ item.name }}</span>
            <span class="ref-item-meta">{{ item.fileName }}</span>
          </div>
        </template>
        <!-- 放大镜按钮：仅悬浮其上才弹出预览悬浮窗 -->
        <button
          class="ref-preview-btn"
          title="预览"
          @click.stop
          @mouseenter="onItemHover(item, $event)"
          @mouseleave="onListLeave"
        >
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none">
            <circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" stroke-width="2" />
            <line x1="15.5" y1="15.5" x2="21" y2="21" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
          </svg>
        </button>
      </div>
    </div>

    <!-- 空状态 -->
    <div class="ref-empty" v-else-if="!loading">
      <span v-if="searchQuery">未找到匹配结果</span>
      <span v-else>{{ mode === 'file' ? '暂无可用文件' : '暂无可用节点' }}</span>
    </div>

    <!-- 加载中 -->
    <div class="ref-loading" v-if="loading">
      <span class="ref-spinner"></span>
      <span>加载中...</span>
    </div>

    <!-- 底部提示 -->
    <div class="ref-footer">
      <span>↑↓ 导航</span>
      <span>↵ 确认</span>
      <span>Esc 取消</span>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import {
  scanFiles, scanNodes, filterFiles, filterNodes, getDisplayName,
  buildFileLink, buildNodeLink
} from '../services/referenceService'

const props = defineProps({
  visible: { type: Boolean, default: false },
  pos: { type: Object, default: () => ({ x: 0, y: 0 }) },
  mode: { type: String, default: 'file' }, // 'file' | 'node'
  // inline 模式：焦点保持在编辑器中，输入文字通过 query 传入实时过滤
  inline: { type: Boolean, default: false },
  query: { type: String, default: '' }
})

const emit = defineEmits(['select', 'cancel', 'item-hover'])

// 双保险：确保插入的引用显示文本是纯文本「文件名：节点内容」，不带 HTML 标签
const stripHtml = (html) => String(html || '')
  .replace(/<br\s*\/?>/gi, ' ')
  .replace(/<\/(p|div|li|h[1-6])>/gi, ' ')
  .replace(/<[^>]+>/g, '')
  .replace(/\s+/g, ' ')
  .trim()

const searchInputRef = ref(null)
const searchQuery = ref('')
const selectedIndex = ref(0)
const loading = ref(false)
const allFiles = ref([])
const allNodes = ref([])

// 过滤后的列表
const filteredItems = computed(() => {
  if (props.mode === 'file') {
    return filterFiles(allFiles.value, searchQuery.value)
  } else {
    return filterNodes(allNodes.value, searchQuery.value)
  }
})

// 选中项变化时，确保在可见范围内
watch(filteredItems, () => {
  selectedIndex.value = 0
}, { immediate: true })

// inline 模式：外部输入同步到过滤词
watch(() => props.query, (q) => {
  if (props.inline) searchQuery.value = q || ''
})

// 监听可见性变化
watch(() => props.visible, async (visible) => {
  if (visible) {
    searchQuery.value = props.inline ? (props.query || '') : ''
    selectedIndex.value = 0
    await loadData()
    await nextTick()
    if (!props.inline) {
      searchInputRef.value?.focus()
    }
  } else {
    // 弹窗关闭时同步关闭 hover 预览
    emit('item-hover', null)
  }
})

// 监听模式变化
watch(() => props.mode, async () => {
  if (props.visible) {
    searchQuery.value = props.inline ? (props.query || '') : ''
    selectedIndex.value = 0
    await loadData()
  }
})

/**
 * 加载数据
 */
const loadData = async () => {
  loading.value = true
  try {
    if (props.mode === 'file') {
      allFiles.value = await scanFiles()
    } else {
      allNodes.value = await scanNodes()
    }
  } finally {
    loading.value = false
  }
}

/**
 * 选择上一项
 */
const selectPrev = () => {
  if (filteredItems.value.length === 0) return
  selectedIndex.value = selectedIndex.value > 0
    ? selectedIndex.value - 1
    : filteredItems.value.length - 1
  scrollIntoView()
}

/**
 * 选择下一项
 */
const selectNext = () => {
  if (filteredItems.value.length === 0) return
  selectedIndex.value = selectedIndex.value < filteredItems.value.length - 1
    ? selectedIndex.value + 1
    : 0
  scrollIntoView()
}

/**
 * 确认选择
 */
const confirmSelection = () => {
  if (filteredItems.value.length === 0) return
  const item = filteredItems.value[selectedIndex.value]
  selectItem(selectedIndex.value)
}

/**
 * 选中某个项目
 */
const selectItem = (index) => {
  const item = filteredItems.value[index]
  if (!item) return

  if (props.mode === 'file') {
    // 文件引用
    emit('select', {
      displayText: getDisplayName(item.name),
      linkUrl: buildFileLink(item.path),
      item
    })
  } else {
    // 节点引用
    emit('select', {
      displayText: `${item.fileName}：${stripHtml(item.name)}`,
      linkUrl: buildNodeLink(item.filePath, item.nodeUid),
      item
    })
  }
}

/**
 * 列表项悬浮：通知父组件在列表右侧显示预览（文件级显示整图，节点级定位高亮）
 */
const onItemHover = (item, e) => {
  if (!item) return
  const el = e?.target?.closest?.('.ref-item') || e?.target
  const rect = el?.getBoundingClientRect?.()
  const pos = rect
    ? { x: rect.right + 8, y: rect.top }
    : { x: (props.pos?.x || 0) + 330, y: props.pos?.y || 0 }
  if (props.mode === 'file') {
    emit('item-hover', { filePath: item.path, nodeUid: '', pos })
  } else {
    emit('item-hover', { filePath: item.filePath, nodeUid: item.nodeUid, pos })
  }
}

/**
 * 鼠标移出列表：通知父组件延迟隐藏预览
 */
const onListLeave = () => {
  emit('item-hover', null)
}

// 滚动选中项到可见区域
const scrollIntoView = () => {
  nextTick(() => {
    const container = document.querySelector('.ref-list')
    const activeItem = container?.querySelector('.ref-item.active')
    if (activeItem) {
      activeItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  })
}

/**
 * 隐藏弹窗
 */
const hide = () => {
  emit('cancel')
}

// 暴露导航/确认方法（inline 模式下由编辑器的 keydown 拦截远程调用）
defineExpose({
  selectPrev,
  selectNext,
  confirmSelection,
  hide
})

// 外部点击关闭
const onExternalClick = (e) => {
  if (!props.visible) return
  const popup = document.querySelector('.ref-popup')
  if (popup && !popup.contains(e.target)) {
    // inline 模式下，编辑器内点击由编辑器失焦/选区逻辑处理，这里只处理弹窗外真正无关区域的点击
    if (props.inline) return
    hide()
  }
}

onMounted(() => {
  document.addEventListener('mousedown', onExternalClick, true)
})

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onExternalClick, true)
})
</script>

<style scoped>
.ref-popup {
  position: fixed;
  z-index: 10000;
  width: 320px;
  max-height: 360px;
  background: rgba(255, 255, 255, 0.98);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}

/* 搜索栏 */
.ref-search {
  display: flex;
  align-items: center;
  padding: 8px 12px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
}

.ref-icon {
  font-size: 16px;
  font-weight: 700;
  color: #4A90D9;
  margin-right: 8px;
  min-width: 16px;
  text-align: center;
}

.ref-input {
  flex: 1;
  border: none;
  outline: none;
  font-size: 14px;
  background: transparent;
  color: #1a1a1a;
}

.ref-input::placeholder {
  color: #86868b;
}

.ref-input-inline {
  pointer-events: none;
  caret-color: transparent;
}

/* 列表 */
.ref-list {
  flex: 1;
  overflow-y: auto;
  max-height: 260px;
  padding: 4px;
}

.ref-list::-webkit-scrollbar {
  width: 5px;
}

.ref-list::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.12);
  border-radius: 3px;
}

/* 列表项 */
.ref-item {
  display: flex;
  align-items: center;
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
  transition: background-color 0.15s ease;
}

.ref-item.active {
  background-color: rgba(74, 144, 217, 0.1);
}

.ref-item-icon {
  font-size: 14px;
  margin-right: 8px;
  opacity: 0.7;
}

.ref-item-content {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}

.ref-item-name {
  font-size: 13px;
  color: #1a1a1a;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ref-item-meta {
  font-size: 11px;
  color: #86868b;
  margin-left: auto;
  padding-left: 8px;
  white-space: nowrap;
}

.ref-item-content .ref-item-meta {
  margin-left: 0;
  padding-left: 0;
}

/* 放大镜预览按钮：仅悬浮其上才弹出预览 */
.ref-preview-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  margin-left: 6px;
  padding: 0;
  flex-shrink: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #86868b;
  cursor: pointer;
  transition: background-color 0.15s ease, color 0.15s ease;
}

.ref-preview-btn:hover {
  background: rgba(74, 144, 217, 0.12);
  color: #4A90D9;
}

/* 空状态 */
.ref-empty {
  padding: 24px 12px;
  text-align: center;
  font-size: 13px;
  color: #86868b;
}

/* 加载中 */
.ref-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 24px 12px;
  font-size: 13px;
  color: #86868b;
}

.ref-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(74, 144, 217, 0.2);
  border-top-color: #4A90D9;
  border-radius: 50%;
  animation: ref-spin 0.6s linear infinite;
}

@keyframes ref-spin {
  to { transform: rotate(360deg); }
}

/* 底部提示 */
.ref-footer {
  display: flex;
  justify-content: center;
  gap: 12px;
  padding: 6px 12px;
  border-top: 1px solid rgba(0, 0, 0, 0.06);
  font-size: 11px;
  color: #86868b;
}
</style>

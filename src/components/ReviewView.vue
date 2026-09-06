<template>
  <div class="review-sidebar">
    <!-- 面板头部 -->
    <div class="panel-header">
      <span class="panel-title">复习计划</span>
      <div class="panel-stats" v-if="stats">
        <span class="stat-item">今日 {{ stats.todayTotal }}</span>
        <span class="stat-item done">已完成 {{ stats.todayCompleted }}</span>
        <button class="overview-btn" @click="openOverview">复习总览</button>
        <span class="stat-item pending" v-if="stats.todayUncompleted > 0">待复习 {{ stats.todayUncompleted }}</span>
      </div>
    </div>

    <!-- 面板内容：顶部日期横向滚动 + 下方节点列表（全宽） -->
    <div class="panel-body">
      <!-- 顶部日期横向滚动条：滚轮/触控板在该区域滚动=切换前/后日期 -->
      <div class="date-bar" ref="dateBarRef" @wheel.prevent="onDateBarWheel">
        <div
          class="date-chip"
          v-for="date in reviewDates"
          :key="date"
          :class="{
            active: date === selectedDate,
            today: date === today
          }"
          @click="selectDate(date)"
        >
          <span class="date-text">{{ formatDateDisplay(date) }}</span>
          <span class="date-badge" v-if="dateItemCount(date) > 0">{{ dateItemCount(date) }}</span>
        </div>
        <div class="empty-tip date-empty" v-if="reviewDates.length === 0">
          暂无复习计划
        </div>
      </div>

      <!-- 下方节点列表：按文件分组折叠展示（默认展开） -->
      <div class="node-list">
        <div class="list-scroll">
          <div v-for="group in groupedItems" :key="group.key" class="file-group">
            <div class="file-group-header" @click="toggleGroup(group.key)">
              <span class="file-group-arrow" :class="{ collapsed: group.collapsed }">&#9662;</span>
              <span class="file-group-name" :title="group.fileName">{{ group.fileName }}</span>
              <span class="file-group-count">{{ group.items.length }}</span>
            </div>
            <div v-show="!group.collapsed" class="file-group-body">
              <div
                class="node-item"
                v-for="item in group.items"
                :key="item.id + '_' + item.currentCycle.cycle"
                :class="{ completed: item.currentCycle.completed }"
              >
                <div class="node-info" @click="navigateToNode(item)">
                  <span class="node-cycle-badge">{{ item.currentCycle.label }}</span>
                  <div class="node-detail">
                    <div class="node-title">{{ resolveNodeText(item) }}</div>
                  </div>
                </div>
                <label class="node-checkbox" @click.stop>
                  <input
                    type="checkbox"
                    :checked="item.currentCycle.completed"
                    @change="toggleComplete(item, $event.target.checked)"
                  />
                  <span class="checkbox-custom"></span>
                </label>
              </div>
            </div>
          </div>
          <div class="empty-tip" v-if="currentDateItems.length === 0">
            {{ selectedDate === today ? '今日暂无复习任务' : '该日期暂无复习任务' }}
          </div>
        </div>
      </div>
    </div>

    <!-- 每日复习提醒设置 -->
    <div class="reminder-bar">
      <label class="reminder-toggle">
        <input type="checkbox" v-model="reminderEnabled" />
        <span>每日提醒</span>
      </label>
      <input
        type="time"
        class="reminder-time"
        v-model="reminderTime"
        :disabled="!reminderEnabled"
      />
      <label class="reminder-toggle">
        <input type="checkbox" v-model="reminderFeishu" :disabled="!reminderEnabled" />
        <span>飞书提醒</span>
      </label>
      <label class="reminder-toggle">
        <input type="checkbox" v-model="reminderWechat" :disabled="!reminderEnabled" />
        <span>微信提醒</span>
      </label>
      <button class="reminder-save" @click="saveReminder">保存</button>
    </div>

    <!-- 复习总览弹窗（Teleport 到 body，作为独立窗口显示） -->
    <Teleport to="body">
      <Transition name="overview-modal">
        <div v-if="showOverview" class="overview-modal-overlay" @click.self="showOverview = false">
          <div class="overview-modal-window">
            <!-- 窗口标题栏 -->
            <div class="overview-modal-header">
              <span class="overview-modal-title">复习总览</span>
              <div class="overview-modal-actions">
                <button class="clear-completed-btn" @click="clearAllCompleted">清除所有已完成</button>
                <button class="overview-close" @click="showOverview = false">✕</button>
              </div>
            </div>
            <!-- 表格内容 -->
            <div class="overview-table-wrap">
              <table class="overview-table">
                <thead>
                  <tr>
                    <th class="col-index">序号</th>
                    <th class="col-name">节点名称</th>
                    <th v-for="c in overviewCycles" :key="c.cycle" class="col-cycle">{{ c.label }}</th>
                    <th class="col-action">操作</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(item, index) in overviewData" :key="item.id" :class="{ completed: isAllCyclesCompleted(item) }">
                    <td class="col-index">{{ index + 1 }}</td>
                    <td class="col-name" :title="resolveNodeText(item)">{{ resolveNodeText(item) }}</td>
                    <td v-for="c in overviewCycles" :key="c.cycle" class="col-cycle">
                      <div class="ov-cycle-cell">
                        <span class="ov-cycle-date">{{ getCycleReviewDate(item, c.cycle) }}</span>
                        <label class="ov-checkbox" @click.stop>
                          <input
                            type="checkbox"
                            :checked="getCycleCompleted(item, c.cycle)"
                            @change="toggleOverviewCycle(item, c.cycle, $event.target.checked)"
                          />
                          <span class="ov-checkbox-custom"></span>
                        </label>
                      </div>
                    </td>
                    <td class="col-action">
                      <button class="btn-delete-task" @click="deleteReviewItem(item.id)">删除</button>
                    </td>
                  </tr>
                  <tr v-if="overviewData.length === 0">
                    <td :colspan="overviewCycles.length + 3" class="empty-tip">暂无复习计划</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { ElMessage } from 'element-plus'
import {
  getAllReviewDates,
  getReviewItemsByDate,
  markCycleCompleted,
  markCycleUncompleted,
  getReviewStats,
  getToday,
  formatDate,
  addToReviewPlan,
  getReviewPlan,
  removeById,
  isInReviewPlan,
  extractNodeText,
  getReminderConfig,
  saveReminderConfig,
  CYCLES
} from '../utils/reviewPlan'

const props = defineProps({
  mindMap: {
    type: Object,
    default: null
  },
  mindMapData: {
    type: Object,
    default: null
  },
  visible: {
    type: Boolean,
    default: true
  },
  currentFilePath: {
    type: String,
    default: ''
  },
  activeNode: {
    type: Object,
    default: null
  }
})

const emit = defineEmits(['navigate'])

// 复习数据
const reviewDates = ref([])
const selectedDate = ref('')
const currentDateItems = ref([])
const stats = ref(null)
const dateBarRef = ref(null)
// 响应式"今日"：应用跨天常驻时 setup 期常量会停留在昨天，每次刷新数据时重算
const today = ref(getToday())

// 复习总览
const showOverview = ref(false)
// 全部 5 个周期均显示（1天、3天、7天、15天、31天）
const overviewCycles = computed(() => CYCLES)
const overviewData = ref([])

/**
 * 打开复习总览弹窗
 */
const openOverview = () => {
  refreshOverview()
  showOverview.value = true
}

/**
 * 删除复习任务（删除该任务的所有复习节点）
 */
const deleteReviewItem = (id) => {
  removeById(id)
  refreshOverview()
  refreshData()
  ElMessage.success('已删除该复习任务')
}

/**
 * 获取复习总览数据
 */
const refreshOverview = () => {
  overviewData.value = getReviewPlan()
}

/**
 * 获取指定周期的完成状态
 */
const getCycleCompleted = (item, cycleNum) => {
  const c = item.cycles?.find(c => c.cycle === cycleNum)
  return c ? c.completed : false
}

/**
 * 获取指定周期的复习日期（复选框左侧显示）
 */
const getCycleReviewDate = (item, cycleNum) => {
  const c = item.cycles?.find(c => c.cycle === cycleNum)
  return c?.reviewDate || ''
}

/**
 * 切换总览中某个周期的完成状态
 */
const toggleOverviewCycle = (item, cycleNum, val) => {
  if (val) {
    markCycleCompleted(item.id, cycleNum)
  } else {
    markCycleUncompleted(item.id, cycleNum)
  }
  refreshOverview()
  refreshData()
}

/**
 * 判断是否所有显示周期都已完成
 */
const isAllCyclesCompleted = (item) => {
  return overviewCycles.value.every(c => getCycleCompleted(item, c.cycle))
}

/**
 * 清除所有已完成状态
 */
const clearAllCompleted = () => {
  const list = getReviewPlan()
  list.forEach(item => {
    item.cycles.forEach(c => {
      c.completed = false
      c.completedDate = null
    })
  })
  localStorage.setItem('MINDMAP_REVIEW_PLAN', JSON.stringify(list))
  refreshOverview()
  refreshData()
}

/**
 * 刷新复习数据
 */
const refreshData = () => {
  today.value = getToday()
  reviewDates.value = getAllReviewDates()
  stats.value = getReviewStats()
  refreshOverview()
  if (selectedDate.value) {
    loadDateItems(selectedDate.value)
  }
}

/**
 * 选择日期
 */
const selectDate = (date) => {
  selectedDate.value = date
  loadDateItems(date)
  scrollActiveDateIntoView()
}

/**
 * 将当前选中的日期 chip 滚入日期栏可视区（切换日期后横向滚动条同步跟随，保证后面的日期能看见）
 */
const scrollActiveDateIntoView = () => {
  nextTick(() => {
    const bar = dateBarRef.value
    const chip = bar && bar.querySelector('.date-chip.active')
    if (!bar || !chip) return
    const barRect = bar.getBoundingClientRect()
    const chipRect = chip.getBoundingClientRect()
    const gap = chipRect.left - barRect.left
    if (gap < 0) {
      bar.scrollLeft += gap - 8
    } else if (chipRect.right > barRect.right) {
      bar.scrollLeft += chipRect.right - barRect.right + 8
    }
  })
}

/**
 * 日期栏滚轮切换：仅在日期栏区域内，滚动滚轮/触控板切换到后一个（向下滚）或前一个（向上滚）日期
 */
const onDateBarWheel = (e) => {
  const dates = reviewDates.value
  if (!dates.length) return
  const delta = e.deltaY !== 0 ? e.deltaY : e.deltaX
  if (delta === 0) return
  const cur = dates.indexOf(selectedDate.value)
  const step = delta > 0 ? 1 : -1
  let next = cur === -1 ? (step > 0 ? 0 : dates.length - 1) : cur + step
  if (next < 0) next = 0
  if (next >= dates.length) next = dates.length - 1
  if (next !== cur) selectDate(dates[next])
}

/**
 * 加载指定日期的复习项
 */
const loadDateItems = (date) => {
  currentDateItems.value = getReviewItemsByDate(date)
}

/* ============================================================
 * 按文件分组展示（默认展开，可折叠）
 * ============================================================ */

// 已手动折叠的文件分组（跨日期记忆用户的折叠偏好）
const collapsedGroups = ref(new Set())

const groupedItems = computed(() => {
  const groups = []
  const index = new Map()
  currentDateItems.value.forEach(item => {
    const key = item.filePath || '__none__'
    let g = index.get(key)
    if (!g) {
      g = {
        key,
        fileName: item.fileName || '未分类',
        items: [],
        collapsed: collapsedGroups.value.has(key)
      }
      index.set(key, g)
      groups.push(g)
    }
    g.items.push(item)
  })
  return groups
})

const toggleGroup = (key) => {
  const next = new Set(collapsedGroups.value)
  if (next.has(key)) {
    next.delete(key)
  } else {
    next.add(key)
  }
  collapsedGroups.value = next
}

/* ============================================================
 * 每日复习提醒设置（App.vue 每 30 秒轮询此配置）
 * ============================================================ */

const reminderCfg0 = getReminderConfig()
const reminderEnabled = ref(reminderCfg0.enabled)
const reminderTime = ref(reminderCfg0.time)
const reminderFeishu = ref(reminderCfg0.feishu)
const reminderWechat = ref(reminderCfg0.wechat)

const saveReminder = () => {
  const ok = saveReminderConfig({
    enabled: reminderEnabled.value,
    time: reminderTime.value,
    feishu: reminderFeishu.value,
    wechat: reminderWechat.value
  })
  if (ok) {
    const channels = []
    if (reminderFeishu.value) channels.push('飞书')
    if (reminderWechat.value) channels.push('微信')
    if (!channels.length) channels.push('系统通知')
    ElMessage.success(reminderEnabled.value
      ? `已开启每日复习提醒（${reminderTime.value}，${channels.join('/')}）`
      : '已关闭每日复习提醒')
  } else {
    ElMessage.error('提醒设置保存失败')
  }
}

/**
 * 日期项数量
 */
const dateItemCount = (date) => {
  return getReviewItemsByDate(date).length
}

/**
 * 格式化日期显示
 */
const formatDateDisplay = (dateStr) => {
  const d = new Date(dateStr)
  const month = d.getMonth() + 1
  const day = d.getDate()
  const weekday = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()]
  return `${month}月${day}日 周${weekday}`
}

/**
 * 去除 HTML 标签
 */
const stripHtml = (html) => {
  if (!html) return ''
  const div = document.createElement('div')
  div.innerHTML = html
  return (div.innerText || div.textContent || '').trim()
}

/**
 * 解析条目显示文本：历史数据 nodeText 为空时，
 * 尝试从当前打开的导图中按 uid 查找节点文本
 */
const resolveNodeText = (item) => {
  if (item?.nodeText) return stripHtml(item.nodeText)
  if (!item?.nodeUid || !props.mindMap?.renderer?.findNodeByUid) return ''
  if (item.filePath && props.currentFilePath && item.filePath !== props.currentFilePath) return ''
  try {
    const node = props.mindMap.renderer.findNodeByUid(item.nodeUid)
    return node ? extractNodeText(node) : ''
  } catch (e) {
    return ''
  }
}

/**
 * 切换完成状态
 */
const toggleComplete = (item, val) => {
  if (val) {
    markCycleCompleted(item.id, item.currentCycle.cycle)
  } else {
    markCycleUncompleted(item.id, item.currentCycle.cycle)
  }
  refreshData()
}

/**
 * 导航到节点：发送事件给 App.vue
 */
const navigateToNode = (item) => {
  emit('navigate', {
    nodeUid: item.nodeUid,
    filePath: item.filePath,
    fileName: item.fileName
  })
}

/**
 * 将当前选中节点添加到复习计划（供外部调用）
 */
const addCurrentNodeToReview = () => {
  if (!props.activeNode) {
    ElMessage.warning('请先在思维导图中选中一个节点')
    return false
  }

  // 获取节点数据
  const node = props.activeNode
  const nodeUid = node?.data?.uid || node?.uid || ''
  if (!nodeUid) {
    ElMessage.warning('无法获取节点 UID')
    return false
  }

  // 检查是否已在复习计划中
  if (isInReviewPlan(nodeUid)) {
    ElMessage.info('该节点已在复习计划中')
    return false
  }

  // 获取节点文本和父节点文本（Node 实例数据在 nodeData 上，须走 getData）
  const nodeText = extractNodeText(node)

  // 获取父节点文本
  const parentText = node?.parent ? extractNodeText(node.parent) : ''

  // 获取文件名
  let fileName = ''
  if (props.currentFilePath) {
    const parts = props.currentFilePath.split(/[\\/]/)
    fileName = parts[parts.length - 1] || ''
  }

  addToReviewPlan({
    nodeUid,
    nodeText,
    parentText,
    filePath: props.currentFilePath,
    fileName
  })

  ElMessage.success('已添加到复习计划')
  refreshData()
  // 默认选中今天
  if (!selectedDate.value) {
    selectedDate.value = today.value
    loadDateItems(today.value)
  }
  return true
}

// 监听可见性变化
watch(
  () => props.visible,
  (visible) => {
    if (visible) {
      refreshData()
      if (!selectedDate.value) {
        selectedDate.value = today
        loadDateItems(today)
      }
    }
  }
)

// 监听数据变化
// App.vue 每次 data_change 都用新对象整体替换 mindMapData 引用，无需 deep 遍历整棵导图；
// 连续编辑时防抖 300ms，避免每次按键触发全量 localStorage 读+parse
let dataWatchTimer = null
watch(
  () => props.mindMapData,
  () => {
    if (!props.visible) return
    if (dataWatchTimer) clearTimeout(dataWatchTimer)
    dataWatchTimer = setTimeout(() => {
      dataWatchTimer = null
      refreshData()
    }, 300)
  }
)

onMounted(() => {
  refreshData()
  selectedDate.value = today.value
  loadDateItems(today.value)
  const onReviewChanged = () => {
    refreshOverview()
    refreshData()
  }
  window.addEventListener('review-plan-changed', onReviewChanged)
  onBeforeUnmount(() => window.removeEventListener('review-plan-changed', onReviewChanged))
})

defineExpose({ refreshData, addCurrentNodeToReview })
</script>

<style scoped>
.review-sidebar {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  position: relative;
}

/* ========== Panel Header ========== */
.panel-header {
  padding: 14px 16px 10px;
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
}

.panel-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
}

.panel-stats {
  display: flex;
  gap: 10px;
  font-size: 12px;
  margin-top: 6px;
}

.stat-item {
  color: var(--text-secondary);
}

.stat-item.done {
  color: var(--apple-green, #34c759);
}

.stat-item.pending {
  color: var(--apple-orange, #ff9500);
}

/* ========== Panel Body ========== */
.panel-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* ========== Date Bar（顶部横向滚动） ========== */
.date-bar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border-color);
  overflow-x: auto;
  overflow-y: hidden;
  white-space: nowrap;
  scrollbar-width: thin;
}

.date-bar::-webkit-scrollbar {
  height: 4px;
}

.date-bar::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.12);
  border-radius: 2px;
}

.list-scroll {
  height: 100%;
  overflow-y: auto;
  padding: 4px 0;
}

.list-scroll::-webkit-scrollbar {
  width: 4px;
}

.list-scroll::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.12);
  border-radius: 2px;
}

.date-chip {
  flex-shrink: 0;
  padding: 5px 10px;
  cursor: pointer;
  font-size: 12px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  transition: background-color var(--transition-fast);
  color: var(--text-primary);
  background-color: rgba(0, 0, 0, 0.035);
  border-radius: var(--radius-full);
  border: 1px solid transparent;
  user-select: none;
}

.date-chip:hover {
  background-color: rgba(0, 0, 0, 0.06);
}

.date-chip.active {
  background-color: rgba(0, 122, 255, 0.1);
  border-color: var(--apple-blue);
  color: var(--apple-blue);
  font-weight: 500;
}

.date-chip.today .date-text::before {
  content: '●';
  color: var(--apple-orange, #ff9500);
  margin-right: 3px;
  font-size: 9px;
}

.date-empty {
  flex-shrink: 0;
  padding: 4px 0;
}

.date-badge {
  background-color: var(--apple-blue);
  color: #fff;
  font-size: 10px;
  min-width: 16px;
  height: 16px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 4px;
}

/* ========== Node List ========== */
.node-list {
  flex: 1;
  overflow: hidden;
}

/* ========== File Group（按文件折叠分组） ========== */
.file-group {
  border-bottom: 1px solid rgba(0, 0, 0, 0.05);
}

.file-group-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 10px;
  cursor: pointer;
  background: rgba(0, 0, 0, 0.025);
  position: sticky;
  top: 0;
  z-index: 2;
  user-select: none;
}

.file-group-header:hover {
  background: rgba(0, 122, 255, 0.06);
}

.file-group-arrow {
  font-size: 10px;
  color: var(--text-secondary);
  transition: transform 0.15s;
  flex-shrink: 0;
}

.file-group-arrow.collapsed {
  transform: rotate(-90deg);
}

.file-group-name {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-group-count {
  font-size: 10px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 8px;
  background: var(--apple-blue);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.node-cycle-badge {
  font-size: 10px;
  background-color: rgba(0, 0, 0, 0.05);
  padding: 1px 5px;
  border-radius: 3px;
  color: var(--text-secondary);
  flex-shrink: 0;
  margin-top: 1px;
  white-space: nowrap;
}

/* ========== Reminder Bar ========== */
.reminder-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-top: 1px solid var(--border-color);
  flex-shrink: 0;
}

.reminder-toggle {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--text-secondary);
  cursor: pointer;
  user-select: none;
}

.reminder-toggle input {
  accent-color: var(--apple-blue, #007aff);
  cursor: pointer;
}

.reminder-time {
  font-size: 12px;
  padding: 2px 6px;
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 6px;
  color: var(--text-primary);
  background: transparent;
  cursor: pointer;
}

.reminder-time:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.reminder-save {
  margin-left: auto;
  font-size: 11px;
  padding: 3px 12px;
  border: 1px solid rgba(0, 0, 0, 0.1);
  border-radius: 10px;
  background: transparent;
  color: var(--apple-blue, #007aff);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.reminder-save:hover {
  background: rgba(0, 122, 255, 0.08);
  border-color: var(--apple-blue, #007aff);
}

.node-item {
  padding: 8px 10px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.04);
  display: flex;
  align-items: flex-start;
  gap: 6px;
  transition: background-color var(--transition-fast);
}

.node-item:hover {
  background-color: rgba(0, 0, 0, 0.02);
}

.node-item.completed {
  opacity: 0.5;
}

.node-item.completed .node-title {
  text-decoration: line-through;
}

.node-info {
  flex: 1;
  cursor: pointer;
  display: flex;
  gap: 4px;
  min-width: 0;
}

.node-index {
  font-size: 12px;
  color: var(--text-tertiary);
  flex-shrink: 0;
  margin-top: 1px;
}

.node-detail {
  flex: 1;
  min-width: 0;
}

.node-title {
  font-size: 13px;
  line-height: 1.4;
  color: var(--text-primary);
  word-break: break-word;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.node-meta {
  margin-top: 3px;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  font-size: 11px;
  color: var(--text-secondary);
}

.node-file {
  color: var(--apple-blue);
}

.node-cycle {
  background-color: rgba(0, 0, 0, 0.05);
  padding: 0 4px;
  border-radius: 3px;
}

/* ========== Checkbox ========== */
.node-checkbox {
  flex-shrink: 0;
  margin-top: 1px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.node-checkbox input {
  display: none;
}

.checkbox-custom {
  width: 16px;
  height: 16px;
  border: 1.5px solid rgba(0, 0, 0, 0.2);
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--transition-fast);
}

.node-checkbox input:checked + .checkbox-custom {
  background-color: var(--apple-green, #34c759);
  border-color: var(--apple-green, #34c759);
}

.node-checkbox input:checked + .checkbox-custom::after {
  content: '';
  width: 4px;
  height: 8px;
  border: solid #fff;
  border-width: 0 2px 2px 0;
  transform: rotate(45deg);
  margin-bottom: 2px;
}

/* ========== Empty Tip ========== */
.empty-tip {
  padding: 20px 16px;
  text-align: center;
  color: var(--text-tertiary);
  font-size: 12px;
}

/* ========== Overview Button ========== */
.overview-btn {
  font-size: 11px;
  padding: 1px 8px;
  border: 1px solid rgba(0, 0, 0, 0.1);
  border-radius: 10px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.overview-btn:hover {
  background: rgba(0, 122, 255, 0.06);
  color: var(--apple-blue);
  border-color: var(--apple-blue);
}

/* ========== Overview Modal (Popup Window) ========== */
.overview-modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.25);
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
  backdrop-filter: blur(2px);
}

.overview-modal-window {
  background: var(--bg-primary, #fff);
  border-radius: 12px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.2);
  width: 90vw;
  max-width: 1100px;
  height: 75vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.overview-modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 20px;
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
}

.overview-modal-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
}

.overview-modal-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.overview-close {
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  font-size: 16px;
  border-radius: 6px;
  transition: all var(--transition-fast);
  display: flex;
  align-items: center;
  justify-content: center;
}

.overview-close:hover {
  background: rgba(0, 0, 0, 0.06);
  color: var(--text-primary);
}

.overview-table-wrap {
  flex: 1;
  overflow: auto;
  padding: 0;
}

.overview-table-wrap::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

.overview-table-wrap::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.12);
  border-radius: 3px;
}

.overview-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.overview-table thead {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--bg-secondary, #f5f5f7);
}

.overview-table th {
  padding: 10px 8px;
  text-align: center;
  font-weight: 600;
  color: var(--text-secondary);
  border-bottom: 1px solid var(--border-color);
  white-space: nowrap;
}

.overview-table th.col-index {
  width: 50px;
}

.overview-table th.col-name {
  text-align: left;
  min-width: 160px;
  padding-left: 14px;
}

.overview-table th.col-cycle {
  min-width: 112px;
}

.overview-table th.col-action {
  width: 70px;
}

.overview-table td {
  padding: 8px;
  text-align: center;
  border-bottom: 1px solid rgba(0, 0, 0, 0.04);
  color: var(--text-primary);
}

.overview-table td.col-name {
  text-align: left;
  padding-left: 14px;
  max-width: 300px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.overview-table td.col-action {
  padding: 4px;
}

.overview-table tr.completed td {
  opacity: 0.5;
}

.overview-table tr.completed .col-name {
  text-decoration: line-through;
}

/* Delete Task Button */
.btn-delete-task {
  font-size: 12px;
  padding: 3px 10px;
  border: 1px solid rgba(255, 59, 48, 0.2);
  border-radius: 6px;
  background: transparent;
  color: var(--apple-red, #ff3b30);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.btn-delete-task:hover {
  background: rgba(255, 59, 48, 0.08);
  border-color: var(--apple-red, #ff3b30);
}

/* Overview Checkbox */
.ov-cycle-cell {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

.ov-cycle-date {
  font-size: 11px;
  color: var(--text-secondary);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.ov-checkbox {
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.ov-checkbox input {
  display: none;
}

.ov-checkbox-custom {
  width: 16px;
  height: 16px;
  border: 1.5px solid rgba(0, 0, 0, 0.2);
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--transition-fast);
}

.ov-checkbox input:checked + .ov-checkbox-custom {
  background-color: var(--apple-green, #34c759);
  border-color: var(--apple-green, #34c759);
}

.ov-checkbox input:checked + .ov-checkbox-custom::after {
  content: '';
  width: 4px;
  height: 8px;
  border: solid #fff;
  border-width: 0 2px 2px 0;
  transform: rotate(45deg);
  margin-bottom: 2px;
}

/* Clear Completed Button */
.clear-completed-btn {
  font-size: 12px;
  padding: 4px 12px;
  border: 1px solid rgba(0, 0, 0, 0.1);
  border-radius: 8px;
  background: transparent;
  color: var(--apple-orange, #ff9500);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.clear-completed-btn:hover {
  background: rgba(255, 149, 0, 0.08);
  border-color: var(--apple-orange, #ff9500);
}

/* Modal Transition */
.overview-modal-enter-active,
.overview-modal-leave-active {
  transition: opacity 0.2s ease;
}

.overview-modal-enter-from,
.overview-modal-leave-to {
  opacity: 0;
}

.overview-modal-enter-active .overview-modal-window,
.overview-modal-leave-active .overview-modal-window {
  transition: transform 0.25s ease, opacity 0.25s ease;
}

.overview-modal-enter-from .overview-modal-window,
.overview-modal-leave-to .overview-modal-window {
  transform: scale(0.95) translateY(-10px);
  opacity: 0;
}
</style>

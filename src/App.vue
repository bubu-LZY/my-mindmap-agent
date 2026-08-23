<template>
  <div class="app-container">
    <!-- ============ 顶部导航栏 ============ -->
    <header class="top-navbar">
      <!-- 当前文件名 -->
      <div class="app-title" :title="currentFileName">{{ currentFileName }}</div>

      <!-- 刷新界面：先保存文档再软重启，用于界面卡死/异常显示时恢复 -->
      <button
        class="nav-btn title-refresh-btn"
        title="保存并刷新界面（软重启，界面异常时恢复用）"
        @click="refreshUI"
      >
        <svg viewBox="0 0 16 16" fill="none" width="13" height="13">
          <path d="M13.5 8a5.5 5.5 0 11-1.62-3.9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
          <path d="M13.8 1.6v3h-3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>

      <!-- 工具按钮组 -->
      <div class="navbar-actions">
        <button
          v-if="refNavigationStack.length > 0"
          class="nav-btn feishu-btn return-map-btn"
          :title="`返回原导图（还可返回 ${refNavigationStack.length} 级）`"
          @click="returnToPreviousMap"
        >
          <svg viewBox="0 0 16 16" fill="none" width="14" height="14" style="margin-right: 4px; flex-shrink: 0;">
            <path d="M10 3L5 8l5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          <span class="feishu-btn-text">返回原导图</span>
        </button>
        <button class="nav-btn feishu-btn" title="快捷键中心（操作手册）" @click="shortcutCenterVisible = true">
          <span class="feishu-btn-text">快捷键</span>
        </button>
        <button class="nav-btn feishu-btn" title="AI 定时任务" @click="toggleTaskSchedulerPanel">
          <span class="feishu-btn-text">定时任务</span>
        </button>
      </div>
    </header>

    <!-- ============ Tab 标签栏 ============ -->
    <nav class="tab-bar" v-show="tabs.length > 0">
      <div
        v-for="tab in tabs"
        :key="tab.fileId"
        class="tab-item"
        :class="{ active: tab.fileId === activeFileId, 'drag-over': dragOverTab === tab.fileId }"
        :title="tab.fileId"
        draggable="true"
        @click="switchTab(tab.fileId)"
        @dragstart="onTabDragStart($event, tab.fileId)"
        @dragover.prevent="onTabDragOver($event, tab.fileId)"
        @dragleave="onTabDragLeave(tab.fileId)"
        @drop.prevent="onTabDrop($event, tab.fileId)"
      >
        <span class="tab-name">{{ tab.fileName || (tab.fileId ? tab.fileId.split('/').pop() : '') || '未命名' }}</span>
        <span class="tab-close" @click.stop="closeTab(tab.fileId)" title="关闭标签">×</span>
      </div>
    </nav>

    <!-- ============ 主内容区 ============ -->
    <div class="main-content">
      <!-- ===== 左侧栏 ===== -->
      <aside class="sidebar" :class="{ collapsed: !sidebarExpanded, 'review-mode': viewMode === 'review' }">
        <!-- 侧边栏内容 -->
        <div class="sidebar-content">
        <!-- 视图切换 Segmented Control（三模式） -->
        <div class="view-toggle-section">
          <div class="segmented-control three-segments">
            <div
              class="segment-indicator"
              :style="{
                transform: `translateX(${viewModeIndex * 100}%)`
              }"
            ></div>
            <button
              class="segment-btn"
              :class="{ active: viewMode === 'outline' }"
              @click="switchView('outline')"
            >
              大纲
            </button>
            <button
              class="segment-btn"
              :class="{ active: viewMode === 'mindmap' }"
              @click="switchView('mindmap')"
            >
              思维导图
            </button>
            <button
              class="segment-btn"
              :class="{ active: viewMode === 'review' }"
              @click="switchView('review')"
            >
              复习模式
            </button>
          </div>
        </div>

        <!-- 文件树（始终挂载，仅切换可见性，避免 v-if 导致组件销毁重建后数据丢失） -->
        <div class="file-tree-wrapper" v-show="viewMode !== 'review'">
          <SearchBar ref="searchBarRef" @open-file="onSearchOpenFile" />
          <FileTree
            ref="fileTreeRef"
            :currentFilePath="currentFilePath"
            @open-file="onTreeOpenFile"
            @file-renamed="onFileRenamed"
            @file-moved="onFileMoved"
            @before-move="onBeforeTreeMove"
          />
        </div>

        <!-- 复习模式：复习计划（日期 + 节点列表） -->
        <ReviewView
          v-show="viewMode === 'review'"
          ref="reviewViewRef"
          :mindMap="activeMindMap"
          :mindMapData="mindMapData"
          :visible="viewMode === 'review'"
          :currentFilePath="currentFilePath"
          :activeNode="activeNode"
          @navigate="handleReviewNavigate"
        />
        </div><!-- /sidebar-content -->
      </aside>

      <!-- 侧边栏折叠/展开按钮 -->
      <button
        class="sidebar-collapse-btn"
        :style="{ left: sidebarLeftOffset }"
        :title="sidebarExpanded ? '折叠侧边栏' : '展开侧边栏'"
        @click="toggleSidebar"
      >
        <svg viewBox="0 0 16 16" fill="none" width="14" height="14">
          <path
            v-if="sidebarExpanded"
            d="M10 3L5 8l5 5"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
          <path
            v-else
            d="M6 3l5 5-5 5"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </button>

      <!-- ===== 中间主区域 ===== -->
      <main class="main-area">
        <!-- 欢迎页面（未打开任何文件时显示） -->
        <div v-if="!hasFile" class="welcome-screen">
          <div class="welcome-logo">
            <svg viewBox="0 0 120 120" fill="none" width="80" height="80">
              <circle cx="60" cy="60" r="56" fill="rgba(0,122,255,0.06)" />
              <circle cx="60" cy="60" r="40" fill="rgba(0,122,255,0.10)" />
              <circle cx="60" cy="60" r="24" fill="rgba(0,122,255,0.15)" />
              <circle cx="60" cy="20" r="6" fill="var(--apple-blue)" />
              <circle cx="20" cy="80" r="6" fill="var(--apple-blue)" />
              <circle cx="100" cy="80" r="6" fill="var(--apple-blue)" />
              <line x1="60" y1="26" x2="60" y2="50" stroke="var(--apple-blue)" stroke-width="2" opacity="0.4" />
              <line x1="26" y1="76" x2="48" y2="60" stroke="var(--apple-blue)" stroke-width="2" opacity="0.4" />
              <line x1="94" y1="76" x2="72" y2="60" stroke="var(--apple-blue)" stroke-width="2" opacity="0.4" />
            </svg>
          </div>
          <h1 class="welcome-title">My-mindmap</h1>
          <p class="welcome-subtitle">智能体 + 思维导图</p>
          <p class="welcome-hint">从左侧文件树打开文件，或点击「新建」开始创建</p>
        </div>

        <!-- 思维导图视图（在思维导图和复习模式下都显示） -->
        <div
          class="mind-map-view"
          :style="{ display: viewMode === 'mindmap' || viewMode === 'review' ? 'flex' : 'none' }"
        >
          <MindMapEditor
            v-for="(tab, i) in tabs"
            :key="tab.fileId"
            :ref="el => { if (el) editorRefs[i] = el }"
            :data="tab.data"
            :file-id="tab.fileId"
            :visible="i === activeIndex && hasFile && (viewMode === 'mindmap' || viewMode === 'review')"
            v-show="i === activeIndex"
            @data-change="onDataChange"
            @node-active="onNodeActive"
            @node-tree-render-end="onNodeTreeRenderEnd"
            @ai-continue="handleAiContinue"
            @ai-add-child="handleAiAddChild"
            @ai-rewrite="handleAiRewrite"
            @ai-cloze="handleAiCloze"
            @ai-cloze-full-map="handleAiClozeFullMap"
            @reorganize-mindmap="handleReorganizeMindmap"
            @ai-quiz="handleAiQuiz"
            @ai-add-to-chat="handleAiAddToChat"
            @add-review="handleAddReview"
            @open-reference-file="handleOpenReferenceFile"
            @fullscreen-change="onMindMapFullscreenChange"
          />
        </div>

        <!-- 大纲视图 -->
        <div
          v-show="hasFile"
          class="outline-view"
          :style="{ display: viewMode === 'outline' ? 'block' : 'none' }"
        >
          <OutlineView
            ref="outlineViewRef"
            :mindMap="activeMindMap"
            :visible="viewMode === 'outline'"
            :mindMapData="mindMapData"
            @ai-continue="handleAiContinue"
            @ai-add-child="handleAiAddChild"
            @ai-rewrite="handleAiRewrite"
            @ai-cloze="handleAiCloze"
            @ai-cloze-full-map="handleAiClozeFullMap"
            @reorganize-mindmap="handleReorganizeMindmap"
            @ai-quiz="handleAiQuiz"
            @ai-add-to-chat="handleAiAddToChat"
            @add-review="handleAddReview"
            @open-reference-file="handleOpenReferenceFile"
            @fullscreen-change="onOutlineFullscreenChange"
          />
        </div>
      </main>

      <!-- ===== 右侧 AI 面板折叠/展开按钮 ===== -->
      <button
        class="ai-collapse-btn"
        :class="{ collapsed: !aiPanelExpanded }"
        :style="{ right: aiPanelRightOffset }"
        :title="aiPanelExpanded ? '折叠AI助手' : '展开AI助手'"
        @click="toggleAiPanel"
      >
        <svg viewBox="0 0 16 16" fill="none" width="14" height="14">
          <path
            v-if="aiPanelExpanded"
            d="M6 3l5 5-5 5"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
          <path
            v-else
            d="M10 3L5 8l5 5"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </button>

      <!-- AI 悬浮球：AI 侧边栏收起时显示 -->
      <button
        v-if="!aiPanelExpanded"
        class="ai-float-ball"
        :class="{ active: floatingChatVisible }"
        @click="toggleFloatingChat"
        title="打开 AI 悬浮对话"
      >
        <svg viewBox="0 0 24 24" fill="none" width="22" height="22">
          <path d="M12 4a8 8 0 0 0-8 8c0 1.4.4 2.7 1 3.8L4 20l4.4-1.1c1.1.5 2.3.8 3.6.8a8 8 0 1 0 0-16z" fill="currentColor"/>
          <circle cx="9" cy="12" r="1.1" fill="#0a84ff"/>
          <circle cx="12" cy="12" r="1.1" fill="#0a84ff"/>
          <circle cx="15" cy="12" r="1.1" fill="#0a84ff"/>
        </svg>
      </button>

      <!-- ===== 右侧 AI 面板 ===== -->
      <aside class="ai-panel" :class="{ collapsed: !aiPanelExpanded, 'floating-chat': !aiPanelExpanded && floatingChatVisible }">
        <ChatPanel
          ref="chatPanelRef"
          :mindMap="activeMindMap"
          :activeNode="activeNode"
          :currentFilePath="currentFilePath"
          :currentFileName="currentFileName"
          :compact="!aiPanelExpanded"
          :webSearch="webSearchEnabled"
          @tool-call-status="onToolCallStatus"
          @toggle-log-panel="onToggleLogPanel"
          @log-updated="onLogUpdated"
          @conversation-changed="onConversationChanged"
          @file-created="onFileCreated"
          @external-file-created="onExternalFileCreated"
          @file-deleted="onFileDeleted"
          @switch-view="switchView"
          @file-renamed="onFileRenamed"
          @open-settings="openSettings"
        />
      </aside>

      <!-- ===== 日志面板（AI助手右侧） ===== -->
      <aside class="log-panel-container" v-if="logPanelVisible">
        <LogPanel
          :refreshSignal="logRefreshSignal"
          :conversationId="currentConversationId"
          @close="closeLogPanel"
        />
      </aside>
    </div>

    <!-- ============ 底部状态栏 ============ -->
    <footer class="status-bar">
      <div class="status-left">
        <el-icon class="status-icon"><Document /></el-icon>
        <span class="status-text">{{ currentFileName }}</span>
      </div>
      <div class="status-right">
        <span class="status-text">{{ nodeCount }} 个节点</span>
        <span class="status-separator">|</span>
        <span class="status-text">{{ viewMode === 'mindmap' ? '思维导图视图' : viewMode === 'outline' ? '大纲视图' : '复习模式' }}</span>
      </div>
    </footer>

    <!-- ============ 右下角视图快速切换按钮 ============
         显示条件：任一视图处于全屏（全屏时无论侧边栏展开与否都需要快速切换），
         或左右侧栏均收起；切换不会展开侧栏，全屏状态会同步到目标视图 -->
    <button
      v-if="hasFile && (mmFullscreen || outlineFullscreen || (!sidebarExpanded && !aiPanelExpanded)) && (viewMode === 'mindmap' || viewMode === 'outline' || viewMode === 'review')"
      class="quick-view-switch-btn"
      :class="{ 'in-fullscreen': mmFullscreen || outlineFullscreen }"
      :title="viewMode === 'outline' ? '切换到思维导图模式' : '切换到大纲模式'"
      @click="quickSwitchView"
    >
      <!-- 图标指示目标视图：当前为大纲时显示导图图标，反之显示大纲列表图标 -->
      <svg v-if="viewMode === 'outline'" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="5" cy="12" r="2" />
        <circle cx="18.5" cy="5" r="1.8" />
        <circle cx="18.5" cy="12" r="1.8" />
        <circle cx="18.5" cy="19" r="1.8" />
        <path d="M7 12h3.5M10.5 12l4.4-4.8M10.5 12h6.2M10.5 12l4.4 4.8" />
      </svg>
      <svg v-else viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M4 6h16M4 12h16M4 18h10" />
      </svg>
    </button>

    <!-- ============ 设置弹窗 ============ -->
    <el-dialog
      v-model="settingsVisible"
      title="设置"
      width="860px"
      :close-on-click-modal="true"
      align-center
      destroy-on-close
    >
      <SettingsView @saved="onSettingsSaved" />
    </el-dialog>

    <!-- ============ 工具调用状态指示器 ============ -->
    <ToolCallIndicator
      :status="toolCallStatus"
      @dismiss="toolCallStatus = ''"
    />

    <!-- ============ AI 定时任务面板（侧滑） ============ -->
    <Transition name="feishu-slide">
      <div v-if="taskSchedulerPanelVisible" class="feishu-panel-container" :style="{ left: taskSchedulerPanelLeftOffset }">
        <TaskSchedulerPanel
          :visible="true"
          @close="taskSchedulerPanelVisible = false"
        />
      </div>
    </Transition>

    <!-- ============ 快捷键中心（悬浮小窗口） ============ -->
    <ShortcutCenter :visible="shortcutCenterVisible" @close="shortcutCenterVisible = false" />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, FolderOpened, Document } from '@element-plus/icons-vue'
import MindMapEditor from './components/MindMapEditor.vue'
import OutlineView from './components/OutlineView.vue'
import ReviewView from './components/ReviewView.vue'
import FileTree from './components/FileTree.vue'
import SearchBar from './components/SearchBar.vue'
import ChatPanel from './components/ChatPanel.vue'
import LogPanel from './components/LogPanel.vue'
import ToolCallIndicator from './components/ToolCallIndicator.vue'
import SettingsView from './components/SettingsView.vue'
import TaskSchedulerPanel from './components/TaskSchedulerPanel.vue'
import ShortcutCenter from './components/ShortcutCenter.vue'
import { taskSchedulerService } from './services/taskSchedulerService'
import { searchService } from './services/searchService'
import { countNodes } from './utils/treeUtils'
import { addToReviewPlan, isInReviewPlan, extractNodeText, removeOrphanReviewItems, remapReviewPaths, getTodayReviewItems, getReminderConfig, getToday } from './utils/reviewPlan'
import { addFeishuLog } from './utils/feishuLogStore'
import { addPanelLog } from './utils/panelLogStore'
import { feishuService } from './services/feishuService'
import { wechatService } from './services/wechatService'
import { useMindMapStore } from './stores/mindMapStore'
import {
  applyTextStyleToNodes,
  fontColorShortcuts,
  highlightColorShortcuts
} from './utils/textStyle'

// 视图模式：outline | mindmap | review
const viewMode = ref('mindmap')

// 视图模式索引（用于 segmented control 指示器位置）
const viewModeIndex = computed(() => {
  const modes = ['outline', 'mindmap', 'review']
  return modes.indexOf(viewMode.value)
})

// MindMapEditor 组件引用（多实例：每个 Tab 一个独立 editor）
// editorRefs[i] 对应 tabs[i] 的编辑器实例；v-for 通过函数 ref 写入
const editorRefs = ref([])
// [多实例] Tab 列表：每元素 { fileId, fileName, data, isImported }
const tabs = ref([])
// [多实例] 当前激活 Tab 的 fileId
const activeFileId = ref('')
const dragTabId = ref('')
const dragOverTab = ref('')
// [多实例] 激活 Tab 索引（未匹配时返回 -1，editorRef 相应返回 null）
const activeIndex = computed(() => tabs.value.findIndex(t => t.fileId === activeFileId.value))
// editorRef 指向激活 Tab 的 editor：现有所有 editorRef.value.xxx 调用自动指向当前 Tab
const editorRef = computed(() => editorRefs.value[activeIndex.value] || null)

// OutlineView 组件引用
const outlineViewRef = ref(null)

// ChatPanel 组件引用
const chatPanelRef = ref(null)

// FileTree 组件引用
const fileTreeRef = ref(null)

// SearchBar 组件引用
const searchBarRef = ref(null)

// ReviewView 组件引用
const reviewViewRef = ref(null)

// mind-map 实例引用
const mindMapInstance = ref(null)

// 传给 ChatPanel 的导图实例：快照可能因容器隐藏初始化失败而为 null，
// 取值时实时从编辑器兜底获取，避免 AI 导图工具一直拿到过期空值
const activeMindMap = computed(() => {
  return mindMapInstance.value || editorRef.value?.getMindMap?.() || null
})

// 当前选中的节点
const activeNode = ref(null)

// 思维导图数据
const mindMapData = ref({
  data: { text: '<p><span>中心主题</span></p>', uid: 'root-' + Date.now(), richText: true },
  children: []
})

// 当前文件路径
const currentFilePath = ref('')

// 当前内容是否来自 md/xmind 解析导入：源文件不允许被 JSON 覆盖，保存时改存同名 .smm
const currentFileIsImported = ref(false)

// 是否已打开文件（控制欢迎页面显示）
const hasFile = ref(false)

// 工具调用状态
const toolCallStatus = ref('')

// 设置弹窗
const settingsVisible = ref(false)

// 快捷键中心（悬浮小窗口）
const shortcutCenterVisible = ref(false)

// AI 定时任务面板
const taskSchedulerPanelVisible = ref(false)
const toggleTaskSchedulerPanel = () => {
  taskSchedulerPanelVisible.value = !taskSchedulerPanelVisible.value
}
// 侧边栏当前宽度（像素）：复习模式加宽以容纳复习计划完整布局
const sidebarWidthPx = computed(() => {
  if (!sidebarExpanded.value) return '0px'
  return viewMode.value === 'review' ? '400px' : '240px'
})

// 定时任务面板左侧偏移（跟随侧边栏展开/折叠）
const taskSchedulerPanelLeftOffset = computed(() => {
  return sidebarWidthPx.value
})

// 侧边栏（目录树 + 大纲/导图/复习模式切换）默认展开
const sidebarExpanded = ref(true)
const toggleSidebar = () => {
  sidebarExpanded.value = !sidebarExpanded.value
  // 侧栏宽度有 0.25s 过渡动画，展开/收起都要在过渡结束后 resize 思维导图，
  // 否则画布会按中间宽度绘制（表现为只按钮移动、窗口不动）
  const resizeEditor = () => {
    if (editorRef.value && (viewMode.value === 'mindmap' || viewMode.value === 'review')) {
      editorRef.value.resize()
    }
  }
  nextTick(resizeEditor)
  setTimeout(resizeEditor, 280)
}

// 侧边栏按钮的 left 偏移
const sidebarLeftOffset = computed(() => {
  return sidebarWidthPx.value
})

// AI 面板折叠状态（默认展开，与左侧边栏一致，可通过右侧按钮收起）
const aiPanelExpanded = ref(true)
const floatingChatVisible = ref(false)
const toggleAiPanel = () => {
  aiPanelExpanded.value = !aiPanelExpanded.value
  if (aiPanelExpanded.value) floatingChatVisible.value = false
  nextTick(() => {
    if (editorRef.value && (viewMode.value === 'mindmap' || viewMode.value === 'review')) {
      editorRef.value.resize()
    }
  })
}
const toggleFloatingChat = () => { floatingChatVisible.value = !floatingChatVisible.value }

// AI面板按钮的 right 偏移（考虑日志面板宽度）
const aiPanelRightOffset = computed(() => {
  if (!aiPanelExpanded.value) return '0px'
  const logWidth = logPanelVisible.value ? 300 : 0
  return `calc(var(--ai-panel-width) + ${logWidth}px)`
})

// 联网搜索开关（默认开启，不显示按钮）
const webSearchEnabled = ref(true)

// 日志面板
const logPanelVisible = ref(false)
const logRefreshSignal = ref(0)
// 当前对话 ID，用于日志面板按对话筛选
const currentConversationId = ref('')

// 计算属性：当前文件名
const currentFileName = computed(() => {
  if (!currentFilePath.value) return '未保存'
  const parts = currentFilePath.value.split(/[\\/]/)
  return parts[parts.length - 1] || '未保存'
})

// 计算属性：节点数量（使用 mindMapData 保证实时更新）
const nodeCount = computed(() => {
  try {
    if (mindMapData.value && mindMapData.value.data) {
      return countNodes(mindMapData.value)
    }
  } catch {
    // ignore
  }
  return 0
})

// 默认思维导图数据
const createDefaultData = () => {
  return {
    data: { text: '<p><span>中心主题</span></p>', uid: 'root-' + Date.now(), richText: true },
    children: []
  }
}

// 获取 mind-map 实例
const initMindMapInstance = () => {
  nextTick(() => {
    if (editorRef.value) {
      // 默认停在大纲视图时容器 display:none，实例从未初始化；大纲/复习视图都依赖实例，必须先建好
      if (!mindMapInstance.value && editorRef.value.ensureInit) {
        try { editorRef.value.ensureInit() } catch (e) { /* 忽略 */ }
      }
      mindMapInstance.value = editorRef.value.getMindMap()
    }
  })
}

// 视图切换
const switchView = (mode) => {
  if (viewMode.value === mode) return
  viewMode.value = mode
  // 注意：切换到思维导图/复习模式时不再额外调用 resize——
  // MindMapEditor 的 visible 监听器已负责尺寸同步与按需重渲染（隐藏期间无渲染则零重渲染，
  // 彻底避免切换闪烁）；此处再 resize 会在尺寸变化时多触发一次渲染导致画布闪烁
  // 切换到大纲模式时主动刷新大纲数据：
  // 思维导图容器隐藏期间实例可能未派发渲染事件，大纲需要主动拉取数据兜底
  if (mode === 'outline') {
    nextTick(() => {
      outlineViewRef.value?.refresh?.()
    })
  }
  // 进入复习模式时检测孤儿复习任务（文件可能在应用运行期间被外部删除）
  if (mode === 'review') {
    checkOrphanReviewItems()
  }
}

// 思维导图/大纲各自的独立全屏状态跟踪（用于右下角快速切换按钮同步全屏与样式）
const mmFullscreen = ref(false)
const outlineFullscreen = ref(false)
const onMindMapFullscreenChange = (v) => {
  mmFullscreen.value = v
  if (v) {
    aiPanelExpanded.value = false
    floatingChatVisible.value = false
  }
}
const onOutlineFullscreenChange = (v) => {
  outlineFullscreen.value = v
  if (v) {
    aiPanelExpanded.value = false
    floatingChatVisible.value = false
  }
}

// 右下角快速切换：大纲 ↔ 思维导图；左右侧栏保持收起不变，全屏状态下切换会把全屏同步带到目标视图
const quickSwitchView = () => {
  const target = viewMode.value === 'outline' ? 'mindmap' : 'outline'
  const keepFullscreen = mmFullscreen.value || outlineFullscreen.value
  if (target === 'mindmap') {
    outlineViewRef.value?.setFullscreen?.(false)
    if (keepFullscreen) editorRef.value?.setFullscreen?.(true)
  } else {
    editorRef.value?.setFullscreen?.(false)
    if (keepFullscreen) outlineViewRef.value?.setFullscreen?.(true)
  }
  switchView(target)
}

// 数据变化回调
const onDataChange = (data) => {
  mindMapData.value = data
  scheduleAutoSave()
}

// 节点激活回调
const onNodeActive = (node, activeNodeList) => {
  activeNode.value = node
}

// 树渲染结束回调
const onNodeTreeRenderEnd = () => {
  // 确保 mindMap 实例可用
  if (!mindMapInstance.value && editorRef.value) {
    mindMapInstance.value = editorRef.value.getMindMap()
  }
}

// 工具调用状态回调
const onToolCallStatus = (status) => {
  toolCallStatus.value = status
}

// 日志面板切换
const onToggleLogPanel = (visible) => {
  logPanelVisible.value = visible
}

// 关闭日志面板（同步 ChatPanel 内部状态）
const closeLogPanel = () => {
  logPanelVisible.value = false
  if (chatPanelRef.value && chatPanelRef.value.setLogPanelVisible) {
    chatPanelRef.value.setLogPanelVisible(false)
  }
}

// 日志更新信号
const onLogUpdated = () => {
  logRefreshSignal.value++
}

// 当前对话切换，更新日志面板的对话筛选
const onConversationChanged = (conversationId) => {
  currentConversationId.value = conversationId || ''
}

// AI 创建了新文件，更新当前文件路径并刷新目录树
const onFileCreated = (filePath, fileName) => {
  if (filePath) {
    hasFile.value = true
    nextTick(() => {
      if (fileTreeRef.value && fileTreeRef.value.refreshTree) {
        fileTreeRef.value.refreshTree()
      }
      if (fileTreeRef.value && fileTreeRef.value.openFileByPath) {
        fileTreeRef.value.openFileByPath(filePath)
      } else {
        currentFilePath.value = filePath
      }
    })
  }
}

// AI 生成了独立文件（AI出题/导出等），画布内容未切换：
// 只刷新左侧目录树让新文件出现，当前打开的文件保持不变
const onExternalFileCreated = () => {
  nextTick(() => {
    if (fileTreeRef.value && fileTreeRef.value.refreshTree) {
      fileTreeRef.value.refreshTree()
    }
  })
}

// AI 撤销后删除了本轮生成的文件，刷新目录树让这些文件消失。
// 左侧目录树删除当前文件时，filePath 为被删除文件；关闭对应 Tab 并解绑 AI 任务。
const onFileDeleted = (filePath = '') => {
  if (filePath) {
    const fid = normalizeFileId(filePath)
    const store = useMindMapStore()
    try {
      if (store.activeTaskFileId === fid) store.setActiveTaskFileId('')
      store.unregisterInstance(fid)
    } catch (e) {}
    const idx = tabs.value.findIndex(t => t.fileId === fid)
    if (idx >= 0) {
      closeTab(tabs.value[idx].fileId)
    } else if (normalizeFileId(currentFilePath.value) === fid) {
      currentFilePath.value = ''
      hasFile.value = false
      activeFileId.value = ''
    }
  }
  nextTick(() => {
    if (fileTreeRef.value && fileTreeRef.value.refreshTree) {
      fileTreeRef.value.refreshTree()
    }
  })
}

/* ============================================================
 * 右键菜单 AI 功能 → 转发给 ChatPanel
 * ============================================================ */

const handleAiContinue = (nodes) => {
  if (chatPanelRef.value && chatPanelRef.value.aiContinue) {
    chatPanelRef.value.aiContinue(nodes)
  }
}

// AI 新增子节点：由 AI 询问层级/资料后调用 add_child_nodes 工具一次生成
const handleAiAddChild = (nodes) => {
  if (chatPanelRef.value && chatPanelRef.value.aiAddChild) {
    chatPanelRef.value.aiAddChild(nodes)
  }
}

const handleAiRewrite = (nodes) => {
  if (chatPanelRef.value && chatPanelRef.value.aiRewrite) {
    chatPanelRef.value.aiRewrite(nodes)
  }
}

const handleAiCloze = (nodes) => {
  if (chatPanelRef.value && chatPanelRef.value.aiCloze) {
    chatPanelRef.value.aiCloze(nodes)
  }
}

const handleAiClozeFullMap = () => {
  if (chatPanelRef.value && chatPanelRef.value.aiCloze) {
    chatPanelRef.value.aiCloze([], { scope: 'root' })
  }
}

const handleReorganizeMindmap = () => {
  if (chatPanelRef.value && chatPanelRef.value.reorganizeMindmap) {
    chatPanelRef.value.reorganizeMindmap()
  }
}


const handleAiQuiz = (nodes) => {
  if (chatPanelRef.value && chatPanelRef.value.aiQuiz) {
    chatPanelRef.value.aiQuiz(nodes)
  }
}

const handleAiAddToChat = (nodes) => {
  if (chatPanelRef.value && chatPanelRef.value.addToInput) {
    chatPanelRef.value.addToInput(nodes)
  }
}

/* ============================================================
 * 添加复习计划（右键菜单 / Ctrl+R）
 * ============================================================ */

const handleAddReview = (nodes) => {
  // 统一转为数组
  const nodeArr = Array.isArray(nodes) ? nodes : [nodes]
  const validNodes = nodeArr.filter(Boolean)
  if (validNodes.length === 0) return

  // 设置当前激活节点为第一个
  activeNode.value = validNodes[0]

  // 为每个节点添加复习计划
  if (reviewViewRef.value && reviewViewRef.value.addCurrentNodeToReview) {
    // ReviewView 已挂载，逐个添加
    for (const node of validNodes) {
      activeNode.value = node
      reviewViewRef.value.addCurrentNodeToReview()
    }
    // 恢复为第一个
    activeNode.value = validNodes[0]
  } else {
    // ReviewView 可能未挂载（不在复习模式），直接添加
    for (const node of validNodes) {
      addNodeToReviewPlan(node)
    }
  }
}

/**
 * 直接添加节点到复习计划（不依赖 ReviewView 组件）
 */
const addNodeToReviewPlan = (node) => {
  if (!node) {
    ElMessage.warning('请先选中一个节点')
    return
  }

  const nodeUid = node?.data?.uid || node?.uid || ''
  if (!nodeUid) {
    ElMessage.warning('无法获取节点 UID')
    return
  }

  if (isInReviewPlan(nodeUid)) {
    ElMessage.info('该节点已在复习计划中')
    return
  }

  // 获取节点文本（Node 实例数据在 nodeData 上，须走 getData）
  const nodeText = extractNodeText(node)

  // 获取父节点文本
  const parentText = node?.parent ? extractNodeText(node.parent) : ''

  // 获取文件名
  let fileName = ''
  if (currentFilePath.value) {
    const parts = currentFilePath.value.split(/[\\/]/)
    fileName = parts[parts.length - 1] || ''
  }

  addToReviewPlan({
    nodeUid,
    nodeText,
    parentText,
    filePath: currentFilePath.value,
    fileName
  })

  ElMessage.success('已添加到复习计划')
}

/**
 * 引用跳转历史栈：通过引用"去编辑"跳转到其他导图时记录来源，
 * 顶部"返回原导图"按钮逐级返回
 */
const refNavigationStack = ref([])

/**
 * 打开引用文件（悬浮窗"去编辑"）
 */
const handleOpenReferenceFile = async ({ filePath, nodeUid }) => {
  if (!filePath) return
  try {
    // 切换前先落盘当前文件的待保存修改
    await flushAutoSave()
    // 记录跳转来源，供"返回原导图"使用（目标与当前相同时不入栈）
    if (currentFilePath.value && currentFilePath.value !== filePath) {
      refNavigationStack.value.push({ filePath: currentFilePath.value })
    } else if (!currentFilePath.value) {
      refNavigationStack.value.push({ filePath: '' })
    }

    const result = await window.electronAPI.refReadFile(filePath)
    if (!result.success) {
      ElMessage.error('打开文件失败: ' + (result.error || '未知错误'))
      return
    }

    let data = result.data
    if (result.type === 'json' && data) {
      if (!data.root && !data.data) {
        data = { root: { data: { text: '空白文档' }, children: [] } }
      }
      mindMapData.value = data
      currentFilePath.value = filePath
      currentFileIsImported.value = false
      markClean(data)
      // [多实例] 同步 activeFileId 到目标文件并确保 Tab 存在
      syncActiveTab(filePath, data, false)
      if (editorRef.value) {
        editorRef.value.setData(data)
      }

      if (viewMode.value !== 'mindmap') {
        switchView('mindmap')
      }

      locateAndBlinkNode(nodeUid, { delay: 400 })
    } else if (result.type === 'markdown') {
      ElMessage.info('Markdown 文件预览暂不支持直接编辑，请使用思维导图格式')
    }
  } catch (e) {
    ElMessage.error('打开引用文件出错: ' + e.message)
  }
}

/**
 * 返回原导图：逐级回退引用跳转历史
 */
const returnToPreviousMap = async () => {
  const prev = refNavigationStack.value.pop()
  if (!prev) return

  // 来源为未保存的临时导图，无法恢复
  if (!prev.filePath) {
    ElMessage.info('来源导图未保存到磁盘，无法返回')
    return
  }
  if (prev.filePath === currentFilePath.value) {
    // 已在目标导图（极少发生），直接跳过
    const next = refNavigationStack.value.pop()
    if (next && next.filePath && next.filePath !== currentFilePath.value) {
      await loadMapFromFile(next.filePath)
    }
    return
  }
  await loadMapFromFile(prev.filePath)
}

/**
 * 从磁盘加载导图文件并切换到思维导图视图
 */
const loadMapFromFile = async (filePath) => {
  try {
    // 切换前先落盘当前文件的待保存修改
    await flushAutoSave()
    const result = await window.electronAPI.refReadFile(filePath)
    if (!result.success) {
      ElMessage.error('返回原导图失败: ' + (result.error || '未知错误'))
      return
    }
    let data = result.data
    if (result.type === 'json' && data) {
      if (!data.root && !data.data) {
        data = { root: { data: { text: '空白文档' }, children: [] } }
      }
      mindMapData.value = data
      currentFilePath.value = filePath
      currentFileIsImported.value = false
      markClean(data)
      // [多实例] 同步 activeFileId 到目标文件并确保 Tab 存在
      syncActiveTab(filePath, data, false)
      if (editorRef.value) {
        editorRef.value.setData(data)
      }
      if (viewMode.value !== 'mindmap') {
        switchView('mindmap')
      }
    } else if (result.type === 'markdown') {
      ElMessage.info('该文件为 Markdown 格式，暂不支持直接编辑')
    }
  } catch (e) {
    ElMessage.error('返回原导图出错: ' + e.message)
  }
}

/* ============================================================
 * 复习模式：导航到节点并高亮闪烁
 * 如果是非终末节点（有子节点），则高亮该节点及所有子节点
 * ============================================================ */

const handleReviewNavigate = async ({ nodeUid, filePath }) => {
  // 如果文件路径不同，先加载对应文件
  if (filePath && filePath !== currentFilePath.value) {
    try {
      // 切换前先落盘当前文件的待保存修改
      await flushAutoSave()
      if (window.electronAPI && window.electronAPI.openFile) {
        const result = await window.electronAPI.openFile(filePath)
        if (result && result.success && result.data) {
          currentFilePath.value = filePath
          currentFileIsImported.value = false
          mindMapData.value = result.data
          markClean(result.data)
          // [多实例] 同步 activeFileId 到目标文件并确保 Tab 存在
          syncActiveTab(filePath, result.data, false)
          if (editorRef.value) {
            editorRef.value.setData(result.data)
          }
        }
      }
    } catch (e) {
      console.error('加载复习文件失败:', e)
    }
  }

  // 等待渲染完成后导航到节点（轮询等待，渲染完成前不会闪烁）
  // keepView：留在复习模式，只切换中间导图内容并高亮闪烁节点
  locateAndBlinkNode(nodeUid, { delay: 400, keepView: true })
}

/**
 * 多节点闪烁动画：1s 内闪烁两次
 * 为所有节点创建高亮框
 */
let blinkTimer = null
let blinkElements = []
const blinkNodes = (nodes) => {
  // 清理之前的闪烁
  if (blinkTimer) {
    clearInterval(blinkTimer)
    blinkTimer = null
  }
  blinkElements.forEach(el => {
    if (el && el.remove) el.remove()
  })
  blinkElements = []

  const mindMap = editorRef.value?.getMindMap?.()
  if (!mindMap || !mindMap.draw) return

  // 为每个节点创建高亮框
  for (const node of nodes) {
    const groupEl = node.group
    if (!groupEl) continue

    const bbox = groupEl.node().getBBox()
    if (!bbox) continue

    const el = mindMap.draw.rect()
      .x(bbox.x - 6)
      .y(bbox.y - 6)
      .width(bbox.width + 12)
      .height(bbox.height + 12)
      .radius(8)
      .fill('none')
      .stroke({ color: '#ff9500', width: 3, dasharray: '0' })
      .opacity(0)

    blinkElements.push(el)
  }

  if (blinkElements.length === 0) return

  // 闪烁：1s 内闪两次（亮 250ms → 暗 250ms → 亮 250ms → 暗 250ms）
  let blinkCount = 0
  const maxBlinks = 4
  blinkTimer = setInterval(() => {
    if (blinkCount >= maxBlinks) {
      clearInterval(blinkTimer)
      blinkTimer = null
      blinkElements.forEach(el => el.opacity(0))
      setTimeout(() => {
        blinkElements.forEach(el => {
          if (el && el.remove) el.remove()
        })
        blinkElements = []
      }, 100)
      return
    }
    // 交替显示/隐藏
    const opacity = blinkCount % 2 === 0 ? 1 : 0
    blinkElements.forEach(el => el.opacity(opacity))
    blinkCount++
  }, 250)
}

/**
 * 定位并高亮闪烁指定节点（搜索结果 / 引用打开 / 复习导航共用）
 * 文件加载与树渲染均为异步，固定延时会因竞态找不到节点或拿到已失效的节点实例：
 * 这里轮询等待（最多 15 次 × 200ms），直到节点已渲染（group 已挂载）才执行定位与闪烁
 */
const locateAndBlinkNode = (nodeUid, { delay = 300, keepView = false } = {}) => {
  if (!nodeUid) return
  // keepView：复习模式导航时保持当前视图（导图在复习模式下也可见），不强制切回思维导图
  if (!keepView && viewMode.value !== 'mindmap') {
    switchView('mindmap')
  }
  let attempts = 0
  const maxAttempts = 15
  const tryLocate = () => {
    attempts++
    const mindMap = editorRef.value?.getMindMap?.()
    const node = mindMap?.renderer?.findNodeByUid?.(nodeUid)
    if (node && node.group) {
      try {
        if (mindMap.renderer.moveNodeToCenter) {
          mindMap.renderer.moveNodeToCenter(node)
        }
        mindMap.renderer.activeNodeList = [node]
        const allNodes = []
        const collectNodes = (n) => {
          allNodes.push(n)
          if (n.children && n.children.length > 0) {
            n.children.forEach(child => collectNodes(child))
          }
        }
        collectNodes(node)
        // 高亮闪烁：只有1个节点（无子节点）时只闪烁该节点，否则闪烁整个子树
        // moveNodeToCenter 可能触发异步重渲染清掉闪烁框，延后+补闪一次确保可见
        setTimeout(() => blinkNodes(allNodes), 120)
        setTimeout(() => blinkNodes(allNodes), 450)
      } catch (e) {
        // 定位失败忽略
      }
      return
    }
    if (attempts < maxAttempts) setTimeout(tryLocate, 200)
  }
  setTimeout(tryLocate, delay)
}

/* ============================================================
 * 文件操作
 * ============================================================ */

/* ============================================================
 * 多 Tab 多实例
 * ============================================================ */

// 归一化 fileId：统一分隔符为 /，去掉末尾分隔符，用作 tabs 的唯一键
const normalizeFileId = (p) => String(p || '').replace(/[\\\/]+/g, '/').replace(/\/+$/, '')

// 打开文件到 Tab：同 fileId 已存在则激活已有 Tab（不新建），否则新建 Tab。
// 同步 currentFilePath/hasFile/mindMapData 兼容依赖单值的代码。
// openInTab 内不调 editorRef.value.setData：新 Tab 靠 :data 初始化，切已有 Tab 靠 v-show。
const openInTab = (filePath, data, fileName, isImported) => {
  const fid = normalizeFileId(filePath)
  const existing = tabs.value.find(t => t.fileId === fid)
  if (existing) {
    // 同文件禁止多开：激活已有 Tab
    activeFileId.value = fid
    mindMapData.value = existing.data
  } else {
    tabs.value.push({ fileId: fid, fileName: fileName || '', data, isImported: !!isImported })
    activeFileId.value = fid
    mindMapData.value = data
  }
  // 兼容单值
  currentFilePath.value = filePath
  currentFileIsImported.value = !!isImported
  hasFile.value = true
}

// [多实例] 切换激活 Tab：点 Tab 栏触发，同步单值到目标 Tab（兼容依赖单值的代码）
const switchTab = (fileId) => {
  const tab = tabs.value.find(t => t.fileId === fileId)
  if (!tab) return
  activeFileId.value = fileId
  mindMapData.value = tab.data
  currentFilePath.value = tab.fileId
  currentFileIsImported.value = tab.isImported
  hasFile.value = true
  // 切换 Tab 后刷新大纲（大纲模式下需要两次 nextTick 确保 mindMap 实例已切换）
  nextTick(() => {
    nextTick(() => {
      outlineViewRef.value?.refresh?.()
    })
  })
}

// [多实例] Tab 拖拽排序
const onTabDragStart = (e, fileId) => {
  dragTabId.value = fileId
  e.dataTransfer.setData('text/plain', fileId)
  e.dataTransfer.effectAllowed = 'move'
}
const onTabDragOver = (e, fileId) => {
  if (!dragTabId.value || dragTabId.value === fileId) return
  dragOverTab.value = fileId
}
const onTabDragLeave = (fileId) => {
  if (dragOverTab.value === fileId) dragOverTab.value = ''
}
const onTabDrop = (e, fileId) => {
  dragOverTab.value = ''
  const fromId = dragTabId.value
  dragTabId.value = ''
  if (!fromId || fromId === fileId) return
  const fromIdx = tabs.value.findIndex(t => t.fileId === fromId)
  const toIdx = tabs.value.findIndex(t => t.fileId === fileId)
  if (fromIdx < 0 || toIdx < 0) return
  const [moved] = tabs.value.splice(fromIdx, 1)
  tabs.value.splice(toIdx, 0, moved)
}

// [多实例] 关闭 Tab：移除该 Tab（v-for 卸载 MindMapEditor 自动 destroy + unregisterInstance），
// 切到相邻 Tab；最后一个 Tab 关闭则回空状态。
// TODO(PRD): 关闭前若该 Tab 有运行中 AI 任务，应弹"终止任务/取消关闭"——暂简化直接关，后续加。
const closeTab = (fileId) => {
  const idx = tabs.value.findIndex(t => t.fileId === fileId)
  if (idx < 0) return
  tabs.value.splice(idx, 1)
  if (tabs.value.length > 0) {
    const next = tabs.value[Math.min(idx, tabs.value.length - 1)]
    activeFileId.value = next.fileId
    mindMapData.value = next.data
    currentFilePath.value = next.fileId
    currentFileIsImported.value = next.isImported
    hasFile.value = true
    nextTick(() => {
      nextTick(() => {
        outlineViewRef.value?.refresh?.()
      })
    })
  } else {
    activeFileId.value = ''
    currentFilePath.value = ''
    currentFileIsImported.value = false
    hasFile.value = false
    mindMapData.value = { data: { text: '<p><span>中心主题</span></p>', uid: 'root-' + Date.now(), richText: true }, children: [] }
  }
}

// [多实例] 同步 activeFileId 到目标文件并确保 Tab 存在、更新初始数据。
// 用于"更新当前 Tab 数据"场景（引用跳转/返回原导图/复习导航/打开对话框/保存后重载）：
// editorRef.value 已指激活 Tab editor，setData 刷新激活 Tab 实例内容。
const syncActiveTab = (filePath, data, isImported = false) => {
  const fid = normalizeFileId(filePath)
  if (!fid) return
  activeFileId.value = fid
  const idx = tabs.value.findIndex(t => t.fileId === fid)
  if (idx >= 0) {
    tabs.value[idx].data = data
  } else {
    // 目标文件不在 tabs 中（如引用跳转加载新文件）：新建 Tab 承载
    tabs.value.push({ fileId: fid, fileName: '', data, isImported: !!isImported })
  }
}

// 激活 Tab 切换时同步 mindMapInstance 指向当前 Tab 的实例
// （ReviewView/OutlineView/快捷键等依赖 mindMapInstance，切 Tab 后须指向新 Tab）
watch(activeFileId, () => {
  nextTick(() => {
    const inst = editorRef.value?.getMindMap?.() || null
    if (inst !== mindMapInstance.value) {
      mindMapInstance.value = inst
    }
  })
})

// 文件树打开文件回调
const onTreeOpenFile = async ({ filePath, fileName, data, isMarkdown, isXmind }) => {
  if (!data) {
    // 关闭当前文件（文件/所在目录被删除等场景）：
    // 必须先于 flushAutoSave 判断，且不再回存——否则会在已删除的路径下重建文件
    markClean(null)
    const fid = normalizeFileId(filePath)
    // [多实例] 从 tabs 移除该文件（组件卸载时自动 unregisterInstance）
    tabs.value = tabs.value.filter(t => t.fileId !== fid)
    if (tabs.value.length > 0) {
      // 切到剩余第一个 Tab
      const next = tabs.value[0]
      activeFileId.value = next.fileId
      currentFilePath.value = next.fileId
      currentFileIsImported.value = next.isImported
      mindMapData.value = next.data
      hasFile.value = true
      nextTick(() => { outlineViewRef.value?.refresh?.() })
    } else {
      activeFileId.value = ''
      currentFilePath.value = ''
      currentFileIsImported.value = false
      hasFile.value = false
    }
    return
  }
  // 切换前先落盘当前文件的待保存修改（防抖窗口内的编辑不能随切换丢失）
  await flushAutoSave()
  // 主动切换文件时清空引用跳转历史（新的导航上下文）
  if (filePath !== currentFilePath.value) {
    refNavigationStack.value = []
  }
  let fileData = data
  if (isMarkdown && typeof data === 'string') {
    const { parseMarkdownToTree } = await import('./utils/markdownParser')
    fileData = parseMarkdownToTree(data)
  }
  markClean(fileData)
  // [多实例] 打开到 Tab：同文件激活已有，新文件新建。openInTab 内同步 currentFilePath/hasFile/mindMapData。
  // 多实例下新 Tab 靠 :data 初始化，不再需要 editorRef.ensureInit/setData。
  openInTab(filePath, fileData, fileName, !!(isMarkdown || isXmind))
  // 大纲视图隐藏容器下渲染事件可能不达：主动刷新大纲（OutlineView 内部有 mindMapData 兜底）
  nextTick(() => {
    outlineViewRef.value?.refresh?.()
  })
  // 索引文件到知识库
  if (searchService.isAvailable()) {
    const fName = fileName || filePath.split(/[\\/]/).pop() || '未命名'
    searchService.indexFile(filePath, fName, fileData).catch(() => {})
  }
}

// 文件/目录重命名后同步 currentFilePath：否则自动保存会在旧路径重建文件
const onFileRenamed = ({ oldPath, newPath }) => {
  // 同步复习计划中的路径，避免文件被误判为已删除而清掉复习任务
  remapReviewPaths(oldPath, newPath)
  const cur = currentFilePath.value
  if (!cur || !oldPath) return
  const sep = oldPath.includes('\\') ? '\\' : '/'
  let next = null
  if (cur === oldPath) {
    next = newPath
  } else if (cur.startsWith(oldPath + sep)) {
    next = newPath + cur.slice(oldPath.length)
  }
  if (next && next !== cur) {
    currentFilePath.value = next
    hasFile.value = true
  }
}

// 拖拽移动前的保存确认（FileTree 通过 before-move 发起，resolve(true) 放行移动）
// 仅当移动涉及当前打开文件（文件本身或其所在目录）且存在未保存修改时弹窗；
// 落盘完成后再移动，保证移动瞬间磁盘内容完整、不会在旧路径重建文件
const onBeforeTreeMove = async ({ srcPath, destDir, resolve }) => {
  const finish = (ok) => { try { resolve(ok) } catch { /* 忽略 */ } }
  try {
    const norm = p => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '')
    const cur = norm(currentFilePath.value)
    const src = norm(srcPath)
    const affects = !!cur && (cur === src || cur.startsWith(src + '/'))
    if (!affects || !isDirty.value) {
      finish(true)
      return
    }
    const name = srcPath.split(/[\\/]/).pop() || '当前文件'
    try {
      await ElMessageBox.confirm(
        `「${name}」有未保存的修改，移动前需要先保存。`,
        '保存并移动',
        { confirmButtonText: '保存并移动', cancelButtonText: '取消移动', type: 'info' }
      )
    } catch {
      finish(false)
      return
    }
    const saved = await flushAutoSave()
    if (!saved) {
      ElMessage.error('保存失败，已取消移动；请检查文件后重试')
      finish(false)
      return
    }
    finish(true)
  } catch (e) {
    // 确认流程异常不阻断移动（保存兜底由自动保存机制承担）
    finish(true)
  }
}

// 拖拽移动后同步 currentFilePath（当前文件本身或其所在目录被移动）
const onFileMoved = ({ srcPath, destDir }) => {
  const cur = currentFilePath.value
  if (!srcPath || !destDir) return
  const sep = destDir.includes('\\') ? '\\' : '/'
  // 移动的是文件还是目录未知：按目录前缀重映射可同时覆盖两种情况（复习计划路径同步）
  remapReviewPaths(srcPath, destDir + sep + srcPath.split(/[\\/]/).pop())
  if (!cur) return
  let next = null
  if (cur === srcPath) {
    next = destDir + sep + cur.split(/[\\/]/).pop()
  } else if (cur.startsWith(srcPath + '\\') || cur.startsWith(srcPath + '/')) {
    next = destDir + sep + cur.slice(srcPath.length + 1)
  }
  if (next && next !== cur) {
    currentFilePath.value = next
    hasFile.value = true
  }
}

// 搜索结果点击打开文件（若命中具体节点，定位并高亮闪烁）
const onSearchOpenFile = async ({ filePath, nodeUid }) => {
  // 目标就是当前打开的文件时不再重新加载：避免整树重渲染导致节点实例失效、闪烁丢失
  if (filePath && filePath !== currentFilePath.value && fileTreeRef.value && fileTreeRef.value.openFileByPath) {
    fileTreeRef.value.openFileByPath(filePath)
    // 等待文件异步加载完成（onTreeOpenFile 会更新 currentFilePath），
    // 否则 locateAndBlinkNode 的短轮询可能因 IPC/落盘延迟而找不到节点
    await waitForFileLoaded(filePath)
  }
  locateAndBlinkNode(nodeUid)
}

// 等待目标文件切换加载完成（currentFilePath 变为目标；超时 5 秒兜底）
const waitForFileLoaded = (filePath) => {
  return new Promise((resolve) => {
    let tries = 0
    const check = () => {
      if (currentFilePath.value === filePath || tries >= 50) {
        resolve()
        return
      }
      tries++
      setTimeout(check, 100)
    }
    check()
  })
}

// 新建文件
const newFile = () => {
  ElMessageBox.confirm('确定要新建思维导图吗？当前未保存的内容将丢失。', '提示', {
    confirmButtonText: '确定',
    cancelButtonText: '取消',
    type: 'warning'
  })
    .then(async () => {
      // 新建前先落盘当前文件的待保存修改
      await flushAutoSave()
      mindMapData.value = createDefaultData()
      currentFilePath.value = ''
      currentFileIsImported.value = false
      hasFile.value = true
      markClean(mindMapData.value)
      // [多实例] 新建空白：currentFilePath 为空无法建新 Tab，更新当前 Tab 初始数据
      const ni = activeIndex.value
      if (ni >= 0) tabs.value[ni].data = mindMapData.value
      if (editorRef.value) {
        editorRef.value.setData(mindMapData.value)
      }
      ElMessage.success('已新建思维导图')
    })
    .catch(() => {})
}

// 打开文件
const openFile = async () => {
  try {
    if (window.electronAPI && window.electronAPI.selectFile) {
      const result = await window.electronAPI.selectFile()
      if (result && result.success && result.data) {
        // 切换前先落盘当前文件的待保存修改
        await flushAutoSave()
        currentFilePath.value = result.filePath || ''
        hasFile.value = true
        let fileData = result.data
        if (result.isMarkdown) {
          const { parseMarkdownToTree } = await import('./utils/markdownParser')
          fileData = parseMarkdownToTree(result.data)
        } else if (result.isXmind) {
          const { parseXmindBase64 } = await import('./utils/xmindParser')
          fileData = await parseXmindBase64(result.data, result.fileName)
          if (!fileData) return
        }
        // md/xmind 源文件按导入处理：保存时改存 .smm，不覆盖源文件
        currentFileIsImported.value = !!(result.isMarkdown || result.isXmind)
        mindMapData.value = fileData
        markClean(fileData)
        // [多实例] 同步 activeFileId 到目标文件并确保 Tab 存在
        syncActiveTab(currentFilePath.value, fileData, !!(result.isMarkdown || result.isXmind))
        // 与 onTreeOpenFile 同理：容器刚从隐藏态变可见，等待 DOM 刷新后再写入数据
        await nextTick()
        if (editorRef.value) {
          editorRef.value.setData(fileData)
        }
        ElMessage.success('文件已打开')
      }
    } else {
      ElMessage.info('请在 Electron 环境中使用此功能')
    }
  } catch (error) {
    console.error('打开文件失败:', error)
    ElMessage.error('打开文件失败')
  }
}

// 保存文件（返回值：true=已保存 / false=保存失败 / null=无数据可存，供刷新前保护逻辑判断）
const saveFile = async () => {
  try {
    const data = editorRef.value ? editorRef.value.getData() : mindMapData.value
    if (!data) {
      ElMessage.warning('没有可保存的数据')
      return null
    }

    if (window.electronAPI && window.electronAPI.saveFile) {
      let filename = currentFilePath.value
      if (currentFileIsImported.value && filename) {
        // md/xmind 源文件不可被 JSON 覆盖：编辑内容改存同目录同名 .smm，源文件保持原样
        filename = filename.replace(/\.(md|xmind)$/i, '.smm')
      }
      if (!filename) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
        filename = `mindmap_${timestamp}.smm`
      }
      const result = await window.electronAPI.saveFile(filename, data, { overwrite: true })
      if (result && result.success) {
        currentFilePath.value = result.filePath
        currentFileIsImported.value = false
        markClean(data)
        ElMessage.success('保存成功')
        // 刷新文件树
        if (fileTreeRef.value && fileTreeRef.value.reloadCurrentFile) {
          fileTreeRef.value.reloadCurrentFile()
        }
        // 重新索引到知识库
        if (searchService.isAvailable()) {
          const fName = result.filePath.split(/[\\/]/).pop() || '未命名'
          searchService.indexFile(result.filePath, fName, data).catch(() => {})
        }
        return true
      } else {
        ElMessage.error('保存失败: ' + (result?.error || '未知错误'))
        return false
      }
    } else {
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: 'application/json'
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'mind-map.json'
      a.click()
      URL.revokeObjectURL(url)
      ElMessage.success('已下载文件')
      return true
    }
  } catch (error) {
    console.error('保存失败:', error)
    ElMessage.error('保存失败')
    return false
  }
}

// 软重启：先确保当前文档已保存，再整页刷新恢复界面状态（用于界面卡死/异常显示时自救）
// 对话记录、运行日志、挖空状态等均已持久化，刷新后自动恢复
const refreshUI = async () => {
  // 先提交进行中的节点文本编辑，保证编辑中的内容进入本次保存的数据
  // （saveFile 本身不提交编辑，不先提交会存成旧数据，且 beforeunload 阶段的
  //  补提交会重新置脏文档导致 reload 被拦）
  try {
    if (document.activeElement && document.activeElement !== document.body) {
      document.activeElement.blur()
    }
  } catch (err) { /* 忽略 */ }
  try {
    if (editorRef.value && editorRef.value.commitEditing) {
      editorRef.value.commitEditing()
    }
  } catch (err) { /* 忽略 */ }
  const saved = await saveFile()
  if (saved === false) {
    ElMessage.warning('文档保存失败，已取消刷新以保护数据')
    return
  }
  // 放行 beforeunload 拦截：reload 瞬间若因异步 data_change 重新置脏，onBeforeUnload 会
  // preventDefault —— Electron 下这会静默取消 reload（无任何弹窗），随后兜底的 window.close()
  // 又被主进程"点叉仅隐藏窗口驻留托盘"的逻辑拦截，表现为软重启点了完全没反应。
  // 此时数据刚保存过，放行刷新没有丢失风险。
  allowReload = true
  ElMessage.info('正在刷新界面…')
  setTimeout(() => location.reload(), 400)
}

/* ============================================================
 * 自动保存：脏标记 + 防抖 + 关闭前保护
 * - 数据变化后 3 秒无进一步操作则静默保存（无弹窗、不刷新文件树）
 * - 内容与上次保存一致时跳过写盘（避免打开文件后的回环保存）
 * - 窗口关闭时若有未落盘的修改：先拦截关闭 → 保存完成 → 再放行
 * ============================================================ */
const isDirty = ref(false)
const AUTOSAVE_DELAY = 3000
let autoSaveTimer = null
let lastSavedJSON = ''
let allowClose = false
// 软重启放行标记：refreshUI 保存完成后置位，onBeforeUnload 据此放行 location.reload()，
// 不参与真正的窗口关闭保护（关闭保护仍走 allowClose/isDirty 判断）
let allowReload = false

// 标记为"已保存"状态：清脏、取消待执行的自动保存
const markClean = (data) => {
  try {
    lastSavedJSON = typeof data === 'string' ? data : JSON.stringify(data)
  } catch {
    lastSavedJSON = ''
  }
  isDirty.value = false
  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer)
    autoSaveTimer = null
  }
}

// 静默保存（串行化）：多个保存请求排成队列依次执行，
// 防止并发写盘在"保存中移动文件"场景于旧路径重建文件
let saveQueueTail = Promise.resolve()
const quietSave = () => {
  const run = saveQueueTail.then(() => quietSaveCore(), () => quietSaveCore())
  saveQueueTail = run.catch(() => {})
  return run
}

// 静默保存实现：成功返回 true（无提示、不刷新文件树，避免打断界面）
const quietSaveCore = async () => {
  try {
    if (!hasFile.value) {
      isDirty.value = false
      return true
    }
    const data = editorRef.value ? editorRef.value.getData() : mindMapData.value
    if (!data) return true

    let json
    try { json = JSON.stringify(data) } catch { json = null }
    if (json !== null && json === lastSavedJSON) {
      isDirty.value = false
      return true
    }

    if (!(window.electronAPI && window.electronAPI.saveFile)) return false

    let filename = currentFilePath.value
    if (currentFileIsImported.value && filename) {
      // md/xmind 源文件不可被 JSON 覆盖：编辑内容改存同目录同名 .smm，源文件保持原样
      filename = filename.replace(/\.(md|xmind)$/i, '.smm')
    }
    if (!filename) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
      filename = `mindmap_${timestamp}.smm`
    }
    // 记录发起保存时的文件路径：await 期间用户可能已切换文件，
    // 完成后若路径已变化则不回写状态，防止把 currentFilePath 回退到旧文件
    const pathAtSaveStart = currentFilePath.value
    const result = await window.electronAPI.saveFile(filename, data, { overwrite: true })
    if (result && result.success) {
      if (currentFilePath.value === pathAtSaveStart) {
        currentFilePath.value = result.filePath
        currentFileIsImported.value = false
        if (json !== null) lastSavedJSON = json
        isDirty.value = false
      }
      // 后台更新知识库索引（静默；文件确已落盘，与当前打开哪个文件无关）
      if (searchService.isAvailable()) {
        const fName = result.filePath.split(/[\\/]/).pop() || '未命名'
        searchService.indexFile(result.filePath, fName, data).catch(() => {})
      }
      return true
    }
    console.error('[自动保存] 失败:', result?.error)
  } catch (e) {
    console.error('[自动保存] 异常:', e)
  }
  return false
}

// 数据变化 → 置脏 + 重置防抖计时
const scheduleAutoSave = () => {
  // 未打开任何文件时，隐藏的空白画布初始化也会派发 data_change；
  // 此时绝不允许自动保存，否则每次启动都会在桌面生成 mindmap_时间戳.smm。
  if (!hasFile.value) {
    isDirty.value = false
    if (autoSaveTimer) {
      clearTimeout(autoSaveTimer)
      autoSaveTimer = null
    }
    return
  }
  isDirty.value = true
  if (autoSaveTimer) clearTimeout(autoSaveTimer)
  autoSaveTimer = setTimeout(async () => {
    autoSaveTimer = null
    await quietSave()
  }, AUTOSAVE_DELAY)
}

// 立即落盘（关闭前保护调用）；返回 true=无需保存或已保存成功，false=保存失败
const flushAutoSave = async () => {
  // 切换文件/关闭等外部流转前，先提交编辑中的文本（大纲 contenteditable blur / 导图编辑框），
  // 否则 getData 拿不到未提交输入，保存的是旧数据、输入随之丢失
  try {
    if (document.activeElement && document.activeElement !== document.body) {
      document.activeElement.blur()
    }
  } catch (err) { /* 忽略 */ }
  try {
    if (editorRef.value && editorRef.value.commitEditing) {
      editorRef.value.commitEditing()
    }
  } catch (err) { /* 忽略 */ }
  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer)
    autoSaveTimer = null
  }
  if (!isDirty.value) return true
  return quietSave()
}

// 关闭前保护：有未保存修改时拦截关闭，保存完成后再放行
const onBeforeUnload = (e) => {
  // 关窗流程不派发 blur：先强制提交编辑中的文本（大纲 contenteditable / 导图 quill 编辑框），
  // 否则编辑内容既不在导图数据里、isDirty 也不会置位，直接关窗即丢失
  try {
    if (document.activeElement && document.activeElement !== document.body) {
      document.activeElement.blur()
    }
  } catch (err) { /* 忽略 */ }
  try {
    if (editorRef.value && editorRef.value.commitEditing) {
      editorRef.value.commitEditing()
    }
  } catch (err) { /* 忽略 */ }
  if (allowClose || allowReload || !isDirty.value) return
  if (!(window.electronAPI && window.electronAPI.saveFile)) return // 浏览器环境无保存能力
  e.preventDefault()
  e.returnValue = false
  flushAutoSave().then((ok) => {
    if (ok) {
      allowClose = true
      window.close()
    } else {
      // 保存失败：保持窗口打开并提示，不静默丢数据
      ElMessage.error('关闭前自动保存失败，请手动保存（Ctrl+S）后再关闭')
    }
  })
}

// 打开设置弹窗
const openSettings = () => {
  settingsVisible.value = true
}

// 设置保存回调（保存后不关闭弹窗，便于继续配置其他分区）
const onSettingsSaved = () => {
  // 通知 ChatPanel 重新加载模型名称
  if (chatPanelRef.value && chatPanelRef.value.reloadModel) {
    chatPanelRef.value.reloadModel()
  }
  // 默认保存目录与左侧目录树保存位置共用同一数据：设置变化后同步目录树根目录
  nextTick(async () => {
    try {
      if (window.electronAPI?.getDefaultSaveDir) {
        const dir = await window.electronAPI.getDefaultSaveDir()
        if (dir && fileTreeRef.value?.syncSaveDirRoot) {
          fileTreeRef.value.syncSaveDirRoot(dir)
        }
      }
    } catch (e) { /* 同步失败忽略 */ }
  })
}

/* ============================================================
 * AI 定时任务触发处理
 * 当 Windows Task Scheduler 在指定时间启动应用时，
 * main.js 检测到 --scheduled-task 参数后发送 task:scheduledTrigger 事件，
 * TaskSchedulerPanel 收到后 emit('scheduled-trigger', taskId)，
 * 此处根据 taskId 获取任务元数据，将 AI 提示词发送到 ChatPanel 执行。
 * 三端隔离：执行结果只留在消息中心「定时端」，不外推微信/飞书
 * ============================================================ */
const onScheduledTaskTrigger = async (taskId) => {
  if (!taskId) return
  try {
    // 从 electron-store 获取任务元数据
    const allTasks = await taskSchedulerService.getAll()
    const task = allTasks[taskId]
    if (!task) {
      console.warn('[定时任务] 未找到任务元数据:', taskId)
      ElMessage.warning('定时任务触发，但未找到任务配置')
      return
    }

    // 定时任务不弹出 AI 面板打扰用户：消息走定时端独立通道，仅在消息中心按钮累计未读
    nextTick(async () => {
      if (chatPanelRef.value && chatPanelRef.value.processExternalMessage) {
        ElMessage.info(`定时任务触发: ${task.name}`)
        const timeStr = new Date().toLocaleString('zh-CN', { hour12: false })
        chatPanelRef.value.pushThirdPartyNotice?.('task', `⏰ 定时任务触发：${task.name}（${timeStr}）`)
        addPanelLog('task', 'send', `定时任务「${task.name}」触发，提示词：${task.prompt}`)
        // extLogger：工具调用/结果/错误实时记录到定时端日志
        const taskLogger = (type, content) => {
          const mappedType = type === 'send' ? 'receive' : type
          addPanelLog('task', mappedType, content.length > 500 ? content.slice(0, 500) + '...' : content)
        }
        try {
          const reply = await chatPanelRef.value.processExternalMessage(task.prompt, 'task', taskLogger)
          // 三端隔离：定时任务结果只留在消息中心「定时端」，不再外推微信/飞书
          if (reply && /^AI 正在处理/.test(reply)) {
            ElMessage.warning(`定时任务「${task.name}」未执行：${reply}`)
            addPanelLog('task', 'error', `定时任务「${task.name}」未执行：${reply}`)
          } else {
            ElMessage.success(`定时任务「${task.name}」已完成，结果见消息中心-定时端`)
            addPanelLog('task', 'receive', `定时任务「${task.name}」执行完成，AI 回复：${reply}`)
          }
        } catch (err) {
          console.error('[定时任务] AI 执行失败:', err)
          ElMessage.error('定时任务 AI 执行失败: ' + err.message)
          addPanelLog('task', 'error', `定时任务「${task.name}」AI 执行失败: ${err.message}`)
        }
      } else if (chatPanelRef.value && chatPanelRef.value.sendDirectMessage) {
        chatPanelRef.value.sendDirectMessage(task.prompt)
      }
    })
  } catch (err) {
    console.error('[定时任务] 触发处理失败:', err)
    ElMessage.error('定时任务触发失败: ' + err.message)
    addPanelLog('task', 'error', `定时任务触发处理失败: ${err.message}`)
  }
}

// 焦点上下文判定：返回 'input'（普通输入框）/ 'richtext'（节点编辑框）/ null（画布等）
const getTextEditContext = (e) => {
  const el = e.target
  if (!el || !el.tagName) return null
  const tag = el.tagName.toUpperCase()
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return 'input'
  if (el.isContentEditable) return 'richtext'
  return null
}

// 键盘快捷键：按"按键 × 焦点位置"行为矩阵分流
// ┌────────────────┬──────────────────┬──────────────────┬──────────────────┐
// │ 按键            │ A 普通输入框      │ B 节点编辑框      │ C 画布/非编辑区   │
// ├────────────────┼──────────────────┼──────────────────┼──────────────────┤
// │ Ctrl+Z         │ 放行：撤销文字    │ 放行：撤销文字    │ 撤销导图          │
// │ Ctrl+Shift+Z/Y │ 放行：重做文字    │ 放行：重做文字    │ 重做导图          │
// │ Ctrl+S         │ 保存文件          │ 保存文件          │ 保存文件          │
// │ Ctrl+R         │ 拦截不触发        │ 添加节点到复习    │ 添加节点到复习    │
// │ Ctrl+H         │ 拦截不触发        │ 选中文本挖空      │ 选中节点挖空      │
// │ Ctrl+G         │ 拦截不触发        │ 概括该节点        │ 概括选中节点      │
// │ Ctrl+`      │ 拦截不触发        │ 选中文字删除线    │ 整个节点删除线    │
// │ Ctrl+B         │ 放行：原生行为    │ 放行：原生加粗    │ 整个节点加粗      │
// │ Ctrl+I         │ 放行：原生行为    │ 放行：原生斜体    │ 整个节点斜体      │
// │ Ctrl+F         │ 聚焦搜索栏        │ 聚焦搜索栏        │ 聚焦搜索栏        │
// └────────────────┴──────────────────┴──────────────────┴──────────────────┘
// 颜色/高亮快捷键：编辑态作用于选中文字；非编辑态作用于全部选中节点（支持多选）
const applyColorShortcut = (action, label) => {
  // 复习模式与思维导图模式共用同一套导图操作（复习模式仅左侧多一个复习计划面板）
  // 优先从编辑器组件实时取实例：mindMapInstance 可能因切换文件/重建导图而过时
  const mm = (editorRef.value && editorRef.value.getMindMap && editorRef.value.getMindMap()) || mindMapInstance.value
  if (!mm || !mm.renderer) {
    ElMessage.info('请先打开一个思维导图文件')
    return
  }
  if (editorRef.value && editorRef.value.isEditing && editorRef.value.isEditing()) {
    // 编辑态：对选中文字应用样式（applyTextStyleToNodes 内部自动走选区）
    // 焦点短暂丢失时 quill.getSelection() 返回 null，兜底读插件保存的 range/lastRange
    // （Alt/Ctrl+Alt 快捷键在 Windows 上按 Alt 会令编辑框失焦，lastRange 是唯一可用来源）
    let hasSel = false
    try {
      const r = mm.richText?.quill?.getSelection()
      const saved = mm.richText?.range || mm.richText?.lastRange
      hasSel = !!((r && r.length > 0) || (saved && saved.length > 0))
    } catch (e) {}
    if (!hasSel) {
      ElMessage.info('请先选中要设置样式的文字')
      return
    }
    applyTextStyleToNodes(mm, [], action)
    return
  }
  const nodes = (mm.renderer.activeNodeList || []).filter(n => !n.isGeneralization)
  if (nodes.length === 0) {
    ElMessage.info('请先选中节点（支持框选多个）再使用颜色快捷键')
    return
  }
  const changed = applyTextStyleToNodes(mm, nodes, action)
  if (changed > 0) {
    ElMessage.success(`已将 ${changed} 个节点${action.startsWith('highlight:') ? '高亮' : '文字颜色'}设为${label}`)
  } else {
    ElMessage.info('选中节点没有可应用样式的文本')
  }
}

// toggle 样式快捷键（Ctrl+`删除线 / Ctrl+B 加粗）：编辑态作用于选中文字，非编辑态(点击节点未进入编辑)作用于整个节点内容
const applyToggleStyleShortcut = (action, styleLabel, verb) => {
  // 复习模式与思维导图模式共用同一套导图操作
  // 优先从编辑器组件实时取实例：mindMapInstance 可能因切换文件/重建导图而过时
  const mm = (editorRef.value && editorRef.value.getMindMap && editorRef.value.getMindMap()) || mindMapInstance.value
  if (!mm || !mm.renderer) {
    ElMessage.info('请先打开一个思维导图文件')
    return
  }
  if (editorRef.value && editorRef.value.isEditing && editorRef.value.isEditing()) {
    let hasSel = false
    try {
      const r = mm.richText?.quill?.getSelection()
      const saved = mm.richText?.range || mm.richText?.lastRange
      hasSel = !!((r && r.length > 0) || (saved && saved.length > 0))
    } catch (e) {}
    if (!hasSel) {
      ElMessage.info(`请先选中要${verb}的文字`)
      return
    }
    applyTextStyleToNodes(mm, [], action)
    return
  }
  const nodes = (mm.renderer.activeNodeList || []).filter(n => !n.isGeneralization)
  if (nodes.length === 0) {
    ElMessage.info(`请先选中节点（支持框选多个）再使用${styleLabel}快捷键`)
    return
  }
  const changed = applyTextStyleToNodes(mm, nodes, action)
  if (changed > 0) {
    ElMessage.success(`已为 ${changed} 个节点整体内容添加/移除${styleLabel}`)
  } else {
    ElMessage.info('选中节点没有可应用样式的文本')
  }
}

const handleKeyDown = (e) => {
  const ctrl = e.ctrlKey || e.metaKey

  // Alt+字母 = 字体颜色；Ctrl+Alt+字母 = 高亮背景色（R红/O橙/G绿/B蓝/P紫/K黑；高亮：Y黄/G绿/B蓝/P粉）
  if (e.altKey) {
    const codeMatch = /^Key([A-Z])$/.exec(e.code || '')
    if (!codeMatch) return
    const letter = codeMatch[1].toLowerCase()
    const conf = ctrl ? highlightColorShortcuts[letter] : fontColorShortcuts[letter]
    if (!conf) return
    e.preventDefault()
    if (getTextEditContext(e) === 'input') return
    applyColorShortcut(ctrl ? 'highlight:' + conf.color : 'color:' + conf.color, conf.label)
    return
  }

  if (!ctrl) return

  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key
  const textCtx = getTextEditContext(e)

  // Ctrl+`（反引号）: 删除线;编辑态=选中文字,非编辑态=整个节点内容;普通输入框内不触发
  if (e.code === 'Backquote' && !e.shiftKey && !e.altKey) {
    e.preventDefault()
    if (textCtx === 'input') return
    applyToggleStyleShortcut('strikethrough', '删除线', '加删除线')
    return
  }

  // Ctrl+Enter: 回到中心（画布视野回归根节点，与右键「回到中心」一致）；输入框/编辑态放行原生行为
  if (e.key === 'Enter' && e.ctrlKey && !e.shiftKey && !e.altKey) {
    if (textCtx) return
    e.preventDefault()
    const mm = mindMapInstance.value || editorRef.value?.getMindMap?.()
    if (mm?.renderer && typeof mm.renderer.setRootNodeCenter === 'function') {
      mm.renderer.setRootNodeCenter()
    }
    return
  }

  // Ctrl+B: 加粗;编辑态放行原生富文本加粗,非编辑态=整个节点内容;普通输入框内不触发
  if (key === 'b' && !e.shiftKey) {
    if (textCtx) return
    e.preventDefault()
    applyToggleStyleShortcut('bold', '加粗', '加粗')
    return
  }

  // Ctrl+I: 斜体;编辑态放行原生富文本斜体,非编辑态(框选多节点)=整个节点内容;普通输入框内不触发
  if (key === 'i' && !e.shiftKey) {
    if (textCtx) return
    e.preventDefault()
    applyToggleStyleShortcut('italic', '斜体', '斜体')
    return
  }

  // Ctrl+Z: 文本上下文放行原生文字撤销，画布撤销导图
  if (key === 'z' && !e.shiftKey) {
    if (textCtx) return
    e.preventDefault()
    if (editorRef.value) {
      editorRef.value.execCommand('BACK')
    }
    return
  }

  // Ctrl+Y or Ctrl+Shift+Z: 文本上下文放行原生文字重做，画布重做导图
  if (key === 'y' || (key === 'z' && e.shiftKey)) {
    if (textCtx) return
    e.preventDefault()
    if (editorRef.value) {
      editorRef.value.execCommand('FORWARD')
    }
    return
  }

  // Ctrl+S: 保存（任意位置）
  if (key === 's') {
    e.preventDefault()
    saveFile()
    return
  }

  // Ctrl+R: 添加当前节点到复习计划；普通输入框内不触发（仅阻止 Electron 默认刷新）
  if (key === 'r') {
    e.preventDefault()
    if (textCtx === 'input') return
    handleAddReview(activeNode.value)
    return
  }

  // Ctrl+H: 添加/移除挖空标记（不切换显隐，显隐通过鼠标点击控制）；普通输入框内不触发
  if (key === 'h') {
    e.preventDefault()
    if (textCtx === 'input') return
    if (!editorRef.value) return

    if (editorRef.value.isEditing && editorRef.value.isEditing()) {
      // 编辑态：选中文本添加/移除挖空
      const result = editorRef.value.toggleSelectionCloze()
      if (result === 'added') {
        ElMessage.success('已添加挖空标记')
      } else if (result === 'removed') {
        ElMessage.success('已取消挖空标记')
      } else {
        ElMessage.info('请先选中文本再按 Ctrl+H')
      }
    } else if (editorRef.value.hasActiveNodes && editorRef.value.hasActiveNodes()) {
      // 非编辑态：对选中节点添加/移除挖空标记
      const result = editorRef.value.createCloze()
      if (result === 'added') {
        ElMessage.success('已添加挖空标记，点击挖空文字可切换显隐')
      } else if (result === 'removed') {
        ElMessage.success('已取消挖空标记')
      } else if (result === 'mixed') {
        ElMessage.success('挖空标记已更新')
      } else {
        ElMessage.info('无法对根节点创建挖空，请选择子节点')
      }
    } else {
      ElMessage.info('请先选择一个节点再按 Ctrl+H')
    }
    return
  }

  // Ctrl+G: 概要（概括）：大纲模式=选中/编辑节点打开概括编辑悬浮窗；思维导图模式=激活节点添加概括
  if (key === 'g') {
    e.preventDefault()
    if (textCtx === 'input') return
    if (viewMode.value === 'outline') {
      outlineViewRef.value?.openGeneralization?.()
    } else if (editorRef.value) {
      const mm = editorRef.value.getMindMap?.()
      if (mm && mm.renderer && mm.renderer.activeNodeList && mm.renderer.activeNodeList.length > 0) {
        mm.execCommand('ADD_GENERALIZATION')
      } else {
        ElMessage.info('请先选择一个节点再使用概要功能')
      }
    }
    return
  }

  // Ctrl+F: 聚焦搜索栏（任意位置）
  if (key === 'f') {
    e.preventDefault()
    if (searchBarRef.value && searchBarRef.value.focus) {
      searchBarRef.value.focus()
    }
    return
  }
}

// 启动时后台重建搜索索引（覆盖从未打开过的文件，静默执行不打扰用户）
const rebuildSearchIndex = async () => {
  try {
    if (!searchService.isAvailable() || !window.electronAPI?.refScanFiles) return
    // refScanFiles 返回 { success, files } 对象，而非数组
    const res = await window.electronAPI.refScanFiles()
    if (!res?.success || !Array.isArray(res.files)) return
    for (const f of res.files.slice(0, 200)) {
      try {
        const r = await window.electronAPI.refReadFile(f.path)
        if (r?.success && r.type === 'json' && r.data) {
          await searchService.indexFile(f.path, r.fileName || f.name, r.data)
        }
      } catch (e) {
        // 单个文件索引失败忽略
      }
    }
  } catch (e) {
    // 忽略
  }
}

// 检测并清理文件已被删除的孤儿复习任务（覆盖应用未运行时文件被外部删除的场景）
const checkOrphanReviewItems = async () => {
  try {
    const orphans = await removeOrphanReviewItems()
    if (orphans.length > 0) {
      const names = orphans
        .map(o => o.nodeText || o.fileName || '未知任务')
        .filter(Boolean)
        .slice(0, 5)
        .join('、')
      ElMessage.warning({
        message: `检测到 ${orphans.length} 个复习任务对应的文件已被删除，已自动取消：${names}${orphans.length > 5 ? ' 等' : ''}`,
        duration: 6000
      })
    }
  } catch (e) {
    // 忽略
  }
}

/* ============================================================
 * 每日复习定时提醒：到达设定时间后弹出今日复习清单（日期+星期+有序列表）
 * 每 30 秒轮询一次，当天已提醒过则不再重复（配置在复习模式左侧栏设置）
 * ============================================================ */

let reviewReminderTimer = null
let reviewReminderLastFired = '' // 当天已提醒标记 YYYY-MM-DD HH:mm

const buildReminderText = () => {
  const now = new Date()
  const weekday = ['日', '一', '二', '三', '四', '五', '六'][now.getDay()]
  const items = getTodayReviewItems()
  const pending = items.filter(it => !it.currentCycle?.completed)
  const lines = pending.slice(0, 20).map((it, i) => {
    const name = (it.nodeText || '未命名节点').replace(/<[^>]+>/g, '').slice(0, 40)
    const file = it.fileName ? `（${it.fileName}）` : ''
    return `${i + 1}. ${name}${file} · ${it.currentCycle?.label || ''}复习`
  })
  const more = pending.length > 20 ? `\n…其余 ${pending.length - 20} 项见复习模式` : ''
  const body = pending.length > 0 ? lines.join('\n') + more : '今日没有待复习的任务，保持节奏！'
  return `【今日复习提醒】${now.getMonth() + 1}月${now.getDate()}日 星期${weekday}（${pending.length} 项待复习）\n${body}`
}

// 按开关推送到飞书/微信；失败静默忽略，不影响系统通知兜底
const sendThirdPartyReminder = async (text) => {
  const cfg = getReminderConfig()
  if (cfg.feishu) {
    try {
      const feishu = window.electronAPI?.feishu
      if (feishu && typeof feishu.sendMessage === 'function') {
        let chatId = ''
        const fcfg = await feishu.getConfig()
        chatId = (fcfg && fcfg.defaultChatId) || ''
        if (!chatId) {
          const chats = await feishu.listChats()
          const list = (chats && (chats.items || chats.chats)) || []
          if (list.length > 0) chatId = list[0].chat_id
        }
        if (chatId) await feishu.sendMessage(chatId, 'chat_id', 'text', JSON.stringify({ text }))
      }
    } catch (e) {
      console.error('飞书复习提醒发送失败:', e)
    }
  }
  if (cfg.wechat) {
    try {
      const wechat = window.electronAPI?.wechat
      if (wechat && typeof wechat.sendMessage === 'function') {
        const wcfg = await wechat.getConfig()
        if (wcfg && wcfg.hasToken) {
          await wechat.sendMessage('', text)
        }
      }
    } catch (e) {
      console.error('微信复习提醒发送失败:', e)
    }
  }
}

const fireReviewReminder = () => {
  const now = new Date()
  const nowHM = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  const stamp = `${getToday()} ${nowHM}`
  if (reviewReminderLastFired === stamp) return

  const cfg = getReminderConfig()
  const text = buildReminderText()
  if (cfg.feishu || cfg.wechat) {
    // 开了飞书/微信：只走三方推送（飞书开推飞书，微信开推微信，都开都推）
    sendThirdPartyReminder(text)
  } else {
    // 都没开：走系统通知
    try {
      new Notification('今日复习提醒', { body: text })
    } catch (e) { /* 系统通知不可用时忽略 */ }
  }
  reviewReminderLastFired = stamp
}

const checkReviewReminder = () => {
  const cfg = getReminderConfig()
  if (!cfg.enabled || !/^\d{2}:\d{2}$/.test(cfg.time)) return
  const now = new Date()
  const nowHM = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  // 已过设定时间且今天未提醒过 → 触发（含启动晚于设定时间的补提醒场景）
  if (nowHM >= cfg.time && !reviewReminderLastFired.startsWith(getToday())) {
    fireReviewReminder()
  }
}

const startReviewReminder = () => {
  if (reviewReminderTimer) clearInterval(reviewReminderTimer)
  checkReviewReminder()
  reviewReminderTimer = setInterval(checkReviewReminder, 30000)
}

onMounted(() => {
  initMindMapInstance()
  window.addEventListener('keydown', handleKeyDown)
  // 关闭前保护：有未落盘修改时先保存再退出
  window.addEventListener('beforeunload', onBeforeUnload)
  // 延迟后台重建搜索索引，不影响启动速度
  setTimeout(() => { rebuildSearchIndex() }, 3000)
  // 启动时检测孤儿复习任务（文件可能在上次关闭期间被外部删除）
  setTimeout(() => { checkOrphanReviewItems() }, 1500)
  // 每日复习定时提醒（30 秒轮询，跨天/修改配置自动生效）
  startReviewReminder()

  // 注册定时任务触发监听器
  // 当 Windows Task Scheduler 在指定时间启动应用时，main.js 发送 task:scheduledTrigger 事件
  // 此处直接在 App 层监听，确保即使 TaskSchedulerPanel 未打开也能接收触发
  if (taskSchedulerService.isAvailable()) {
    taskSchedulerService.onScheduledTrigger((taskId) => {
      onScheduledTaskTrigger(taskId)
    })
  }

  // 飞书机器人消息处理：走飞书端独立通道（不弹出 AI 面板、不污染用户对话），使用 AI 工具链执行
  if (window.electronAPI?.feishuBot?.onProcessMessage) {
    window.electronAPI.feishuBot.onProcessMessage(async (data) => {
      const { id, text } = data
      addPanelLog('feishu', 'receive', `收到机器人消息：${text}`)
      try {
        const reply = await chatPanelRef.value?.processExternalMessage(text, 'feishu', (type, content) => {
          addFeishuLog(type, content)
          const safeContent = typeof content === 'string' && content.length > 500 ? content.slice(0, 500) + '...' : content
          addPanelLog('feishu', type, safeContent)
        })
        addPanelLog('feishu', 'send', `AI 回复已发送：${reply || '(AI 未返回内容)'}`)
        window.electronAPI.feishuBot.sendProcessMessageResult(id, reply || '(AI 未返回内容)')
      } catch (err) {
        addFeishuLog('error', err.message)
        addPanelLog('feishu', 'error', `AI 处理失败：${err.message}`)
        window.electronAPI.feishuBot.sendProcessMessageResult(id, null, err.message)
      }
    })
  }

  // 微信机器人消息处理：走微信端独立通道（不弹出 AI 面板、不污染用户对话），与飞书同构
  if (window.electronAPI?.wechatBot?.onProcessMessage) {
    window.electronAPI.wechatBot.onProcessMessage(async (data) => {
      const { id, text } = data
      addPanelLog('wechat', 'receive', `收到机器人消息：${text}`)
      try {
        const reply = await chatPanelRef.value?.processExternalMessage(text, 'wechat', (type, content) => {
          addFeishuLog(type, `[微信] ${content}`)
          const safeContent = typeof content === 'string' && content.length > 500 ? content.slice(0, 500) + '...' : content
          addPanelLog('wechat', type, safeContent)
        })
        addPanelLog('wechat', 'send', `AI 回复已发送：${reply || '(AI 未返回内容)'}`)
        window.electronAPI.wechatBot.sendProcessMessageResult(id, reply || '(AI 未返回内容)')
      } catch (err) {
        addFeishuLog('error', `[微信] ${err.message}`)
        addPanelLog('wechat', 'error', `AI 处理失败：${err.message}`)
        window.electronAPI.wechatBot.sendProcessMessageResult(id, null, err.message)
      }
    })
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeyDown)
  window.removeEventListener('beforeunload', onBeforeUnload)
  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer)
    autoSaveTimer = null
  }
  if (reviewReminderTimer) {
    clearInterval(reviewReminderTimer)
    reviewReminderTimer = null
  }
})
</script>

<style scoped>
.app-container {
  display: flex;
  flex-direction: column;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  position: relative;
  background-color: var(--main-bg);
}

/* ============================================
   Top Navbar
   ============================================ */
.top-navbar {
  height: var(--navbar-height);
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  background-color: var(--navbar-bg);
  -webkit-backdrop-filter: var(--blur-amount) var(--blur-saturate);
  backdrop-filter: var(--blur-amount) var(--blur-saturate);
  border-bottom: 1px solid var(--border-color);
  z-index: 100;
}

/* Tab 标签栏 */
.tab-bar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 0 8px;
  height: 32px;
  background-color: var(--navbar-bg);
  border-bottom: 1px solid var(--border-color);
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: thin;
}
.tab-bar::-webkit-scrollbar { height: 4px; }
.tab-item {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  padding: 0 10px;
  border-radius: 6px;
  font-size: 12.5px;
  color: var(--text-secondary, #6e6e73);
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
  max-width: 220px;
  transition: background-color 0.12s, color 0.12s;
}
.tab-item:hover { background-color: var(--hover-bg, rgba(0,0,0,0.05)); color: var(--text-primary, #1d1d1f); }
.tab-item.active { background-color: var(--active-bg, rgba(0,122,255,0.10)); color: var(--text-primary, #1d1d1f); font-weight: 600; }
.tab-item.drag-over { border-left: 2px solid var(--apple-blue, #007aff); }
.tab-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tab-close {
  display: flex; align-items: center; justify-content: center;
  width: 16px; height: 16px; border-radius: 4px;
  font-size: 14px; line-height: 1;
  color: var(--text-tertiary, #a1a1a6);
  flex-shrink: 0;
}
.tab-close:hover { background-color: var(--hover-bg, rgba(0,0,0,0.05)); color: #ff3b30; }

.app-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  letter-spacing: -0.01em;
  user-select: none;
  flex: 1;
  text-align: center;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 0 8px;
}

/* 文件名右侧的刷新按钮：软重启恢复界面状态（红色醒目提示为重置类操作）
   用 .nav-btn.title-refresh-btn 复合选择器，避免被后定义的 .nav-btn 默认色覆盖 */
.nav-btn.title-refresh-btn {
  flex-shrink: 0;
  width: 26px;
  height: 26px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-left: -2px;
  color: #e5484d;
}

.nav-btn.title-refresh-btn:hover {
  background: rgba(229, 72, 77, 0.1);
  color: #e5484d;
}

.nav-btn.title-refresh-btn:active {
  background: rgba(229, 72, 77, 0.16);
}

.title-refresh-btn svg {
  transition: transform 0.4s;
}

.title-refresh-btn:hover svg {
  transform: rotate(180deg);
}

.sidebar-toggle {
  flex-shrink: 0;
}

/* 侧边栏折叠按钮 */
.sidebar-collapse-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 36px;
  background: rgba(0, 0, 0, 0.06);
  border: none;
  border-radius: 0 6px 6px 0;
  cursor: pointer;
  color: var(--text-tertiary);
  transition: left 0.25s ease, color 0.2s ease, transform 0.2s ease, background 0.2s ease;
  position: absolute;
  top: 50%;
  z-index: 20;
  transform: translateX(0) translateY(-50%);
}

.sidebar-collapse-btn:hover {
  color: var(--apple-blue);
  background: rgba(0, 0, 0, 0.1);
  transform: translateX(3px) translateY(-50%);
}

/* AI面板折叠按钮 */
.ai-collapse-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 36px;
  background: rgba(0, 0, 0, 0.06);
  border: none;
  border-radius: 6px 0 0 6px;
  cursor: pointer;
  color: var(--text-tertiary);
  transition: right 0.25s ease, color 0.2s ease, transform 0.2s ease, background 0.2s ease;
  position: absolute;
  top: 50%;
  z-index: 20;
  transform: translateX(0) translateY(-50%);
}

.ai-collapse-btn:hover {
  color: var(--apple-blue);
  background: rgba(0, 0, 0, 0.1);
  transform: translateX(-3px) translateY(-50%);
}

.ai-float-ball {
  position: fixed;
  right: 22px;
  bottom: 88px;
  z-index: 700;
  width: 52px;
  height: 52px;
  border: none;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.92);
  color: var(--apple-blue, #007aff);
  box-shadow: 0 8px 26px rgba(0, 0, 0, 0.18);
  cursor: pointer;
  backdrop-filter: blur(10px);
}

.ai-float-ball.active {
  background: var(--apple-blue, #007aff);
  color: #fff;
}

.navbar-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 40px;
  justify-content: flex-end;
}

.nav-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  color: var(--text-secondary);
  transition: background-color var(--transition-fast),
    color var(--transition-fast), transform var(--transition-fast);
}

.nav-btn:hover {
  background-color: rgba(0, 0, 0, 0.06);
  color: var(--text-primary);
}

.nav-btn:active {
  background-color: rgba(0, 0, 0, 0.1);
  transform: scale(0.96);
}

.nav-btn .el-icon {
  font-size: 17px;
}

/* ============================================
   Main Content (Sidebar + Main + AI Panel)
   ============================================ */
.main-content {
  flex: 1;
  display: flex;
  overflow: hidden;
  min-height: 0;
  position: relative;
}

/* ============================================
   Sidebar
   ============================================ */
.sidebar {
  width: var(--sidebar-width);
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background-color: var(--sidebar-bg);
  -webkit-backdrop-filter: var(--blur-amount) var(--blur-saturate);
  backdrop-filter: var(--blur-amount) var(--blur-saturate);
  border-right: 1px solid var(--border-color);
  overflow: hidden;
  transition: width 0.25s ease;
}

.sidebar-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
}

.sidebar.collapsed,
.sidebar.collapsed.review-mode {
  width: 0;
  border-right: none;
}

.sidebar.review-mode {
  width: var(--sidebar-width-review);
}

/* View toggle - Segmented Control */
.view-toggle-section {
  padding: 16px 12px;
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
}

.segmented-control {
  position: relative;
  display: flex;
  background-color: rgba(0, 0, 0, 0.06);
  border-radius: var(--radius-sm);
  padding: 2px;
  height: 30px;
}

.segmented-control.three-segments .segment-indicator {
  width: calc(33.333% - 1.33px);
}

.segmented-control.three-segments .segment-btn {
  font-size: 12px;
}

.segment-indicator {
  position: absolute;
  top: 2px;
  left: 2px;
  width: calc(50% - 2px);
  height: calc(100% - 4px);
  background-color: #fff;
  border-radius: var(--radius-xs);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1), 0 0 0 0.5px rgba(0, 0, 0, 0.04);
  transition: transform var(--transition-standard);
  z-index: 0;
}

.segment-btn {
  flex: 1;
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 500;
  font-family: var(--font-family);
  color: var(--text-secondary);
  background: transparent;
  border: none;
  cursor: pointer;
  transition: color var(--transition-fast);
  user-select: none;
}

.segment-btn.active {
  color: var(--text-primary);
}

.segment-btn:not(.active):hover {
  color: var(--text-primary);
}

/* File tree wrapper */
.file-tree-wrapper {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

/* ============================================
   Main Area
   ============================================ */
.main-area {
  flex: 1;
  position: relative;
  overflow: hidden;
  background-color: var(--main-bg);
  min-width: 200px;
}

.welcome-screen {
  position: absolute;
  inset: 0;
  z-index: 2;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background-color: var(--main-bg);
  user-select: none;
}

.welcome-logo {
  margin-bottom: 12px;
}

.welcome-title {
  font-size: 28px;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0;
  letter-spacing: -0.5px;
}

.welcome-subtitle {
  font-size: 15px;
  color: var(--text-secondary);
  margin: 0;
}

.welcome-hint {
  font-size: 13px;
  color: var(--text-tertiary);
  margin-top: 16px;
}

.mind-map-view {
  width: 100%;
  height: 100%;
  display: flex;
  position: relative;
  /* 不设置 z-index：否则会创建 stacking context，把内部全屏层的 z-index:5000
     限制在本层内，导致全屏后右下角全屏/退出按钮被底部状态栏(z-index:100)遮挡 */
}

.outline-view {
  width: 100%;
  height: 100%;
  overflow: hidden;
}

/* ============================================
   AI Panel
   ============================================ */
.ai-panel {
  width: var(--ai-panel-width);
  flex-shrink: 0;
  overflow: hidden;
  transition: width 0.25s ease;
}

.ai-panel.collapsed {
  width: 0;
}

.ai-panel.floating-chat {
  position: fixed;
  right: 16px;
  bottom: 80px;
  z-index: 650;
  width: min(300px, calc(100vw - 24px));
  height: min(440px, calc(100vh - 96px));
  border-radius: 18px;
  box-shadow: 0 14px 46px rgba(0, 0, 0, 0.24);
  overflow: hidden;
}

/* Log Panel (right of AI panel) */
.log-panel-container {
  width: 300px;
  flex-shrink: 0;
  overflow: hidden;
}

/* ============================================
   Status Bar
   ============================================ */
.status-bar {
  height: var(--status-bar-height);
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  background-color: var(--status-bar-bg);
  -webkit-backdrop-filter: var(--blur-amount) var(--blur-saturate);
  backdrop-filter: var(--blur-amount) var(--blur-saturate);
  border-top: 1px solid var(--border-color);
  z-index: 100;
}

.status-left,
.status-right {
  display: flex;
  align-items: center;
  gap: 6px;
}

.status-icon {
  font-size: 12px;
  color: var(--text-secondary);
}

.status-text {
  font-size: 11px;
  color: var(--text-secondary);
  user-select: none;
}

/* ============ 右下角视图快速切换按钮 ============ */
/* 位于各视图自带全屏按钮左侧（right:16+30+6）；层级高于全屏覆盖层(5000)，全屏模式下同样可见可点 */
.quick-view-switch-btn {
  position: fixed;
  right: 52px;
  bottom: calc(var(--status-bar-height) + 16px);
  z-index: 5100;
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

.quick-view-switch-btn:hover {
  background: #ffffff;
  color: var(--apple-blue, #007aff);
  transform: scale(1.06);
}

/* 全屏模式下与全屏按钮对齐（全屏层覆盖状态栏，无需额外偏移），配色与全屏按钮一致 */
.quick-view-switch-btn.in-fullscreen {
  bottom: 16px;
  background: rgba(0, 0, 0, 0.5);
  color: #ffffff;
}

.quick-view-switch-btn.in-fullscreen:hover {
  background: rgba(0, 0, 0, 0.65);
  color: #ffffff;
}

.status-separator {
  color: var(--text-tertiary);
  font-size: 11px;
}

/* ============================================
   Settings Dialog overrides
   ============================================ */
:deep(.el-dialog) {
  border-radius: var(--radius-md) !important;
}

:deep(.el-dialog__headerbtn) {
  height: 36px;
  width: 36px;
  top: 12px;
  right: 12px;
}

:deep(.el-dialog__headerbtn .el-dialog__close) {
  font-size: 16px;
  color: var(--text-secondary);
}

:deep(.el-dialog__headerbtn:hover .el-dialog__close) {
  color: var(--text-primary);
}

/* ============================================
   Feishu Button (navbar)
   ============================================ */
.feishu-btn {
  width: auto;
  padding: 0 10px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  font-family: var(--font-family);
}

.feishu-btn:hover {
  color: var(--apple-blue);
}

.feishu-btn-text {
  letter-spacing: 0.02em;
}

/* 返回原导图按钮：引用跳转后出现，蓝色强调 */
.return-map-btn {
  color: var(--apple-blue, #007aff);
  background: rgba(0, 122, 255, 0.08);
  border-radius: 6px;
  display: inline-flex;
  align-items: center;
  height: 26px;
  line-height: 1;
}

.return-map-btn:hover {
  color: #fff;
  background: var(--apple-blue, #007aff);
}

/* ============================================
   Feishu Panel (Slide-in)
   ============================================ */
.feishu-panel-container {
  position: fixed;
  top: var(--navbar-height);
  width: 400px;
  height: calc(100vh - var(--navbar-height) - var(--status-bar-height));
  z-index: 1000;
  background: var(--main-bg);
  box-shadow: 2px 0 12px rgba(0, 0, 0, 0.1);
  overflow: hidden;
}

/* 三方链接面板：飞书+微信双渠道配置，内容较多，加宽 */
.third-party-panel {
  width: 560px;
  max-width: calc(100vw - 40px);
}

.feishu-slide-enter-active,
.feishu-slide-leave-active {
  transition: transform 0.3s ease, opacity 0.3s ease;
}

.feishu-slide-enter-from,
.feishu-slide-leave-to {
  transform: translateX(-100%);
  opacity: 0;
}
</style>

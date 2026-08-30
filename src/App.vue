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
        <button class="nav-btn feishu-btn" title="截图识别文字（OCR）" @click="startOcrScreenshot">
          <span class="feishu-btn-text">截图识别</span>
        </button>
        <button class="nav-btn feishu-btn" title="布局模板（保存/恢复窗口布局）" @click="openLayoutDialog">
          <span class="feishu-btn-text">布局</span>
        </button>
        <button class="nav-btn feishu-btn" title="设置（AI 配置 / 三方集成 / 消息中心）" @click="openSettings">
          <span class="feishu-btn-text">设置</span>
        </button>
      </div>
    </header>

    <!-- ============ Tab 标签栏 ============ -->
    <nav class="tab-bar" v-show="tabs.length > 0 || docTabs.length > 0">
      <div
        v-for="t in orderedTabs"
        :key="t.key"
        class="tab-item"
        :class="{ active: t.active, 'drag-over': dragOverTabKey === t.key }"
        :title="t.title"
        draggable="true"
        @click="t.onClick"
        @dragstart="onAnyTabDragStart($event, t.key)"
        @dragover.prevent="onAnyTabDragOver($event, t.key)"
        @dragleave="onAnyTabDragLeave(t.key)"
        @drop.prevent="onAnyTabDrop($event, t.key)"
        @dragend="onAnyTabDragEnd"
      >
        <span class="tab-name">{{ t.name }}</span>
        <span class="tab-close" @click.stop="t.onClose" title="关闭标签">×</span>
      </div>
    </nav>

    <!-- ============ 主内容区 ============ -->
    <div class="main-content">
      <!-- ===== 左侧栏 ===== -->
      <aside class="sidebar" :class="{ collapsed: !sidebarExpanded, 'wide-mode': viewMode === 'review' || viewMode === 'tag' }">
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
              :class="{ active: viewMode === 'mindmap' || viewMode === 'outline' || viewMode === 'graph' }"
              @click="switchToFileTree"
            >
              文件目录
            </button>
            <button
              class="segment-btn"
              :class="{ active: viewMode === 'tag' }"
              @click="switchView('tag')"
            >
              标签
            </button>
            <button
              class="segment-btn"
              :class="{ active: viewMode === 'review' }"
              @click="switchView('review')"
            >
              复习
            </button>
          </div>
        </div>

        <!-- 文件树（始终挂载，仅切换可见性，避免 v-if 导致组件销毁重建后数据丢失） -->
        <div class="file-tree-wrapper" v-show="viewMode !== 'review' && viewMode !== 'tag'">
          <SearchBar ref="searchBarRef" @open-file="onSearchOpenFile" />
          <FileTree
            ref="fileTreeRef"
            :currentFilePath="currentFilePath"
            @open-file="onTreeOpenFile"
            @open-doc="onTreeOpenDoc"
            @file-deleted="onFileDeleted"
            @file-renamed="onFileRenamed"
            @file-moved="onFileMoved"
            @before-move="onBeforeTreeMove"
            @add-tag="onFileTreeAddTag"
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

        <!-- 标签模式：收藏标签列表（标签 + 备注 + 文件，点击跳转） -->
        <div class="tag-mode-wrapper" v-show="viewMode === 'tag'">
          <SearchBar ref="tagSearchBarRef" @open-file="onSearchOpenFile" />
          <TagView
            ref="tagViewRef"
            :visible="viewMode === 'tag'"
            @navigate="handleTagNavigate"
          />
        </div>
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

      <!-- ===== 中间主区域：Obsidian 式分屏画布 ===== -->
      <main
        class="main-area window-canvas"
        @dragover.prevent="onCanvasDragOver"
        @drop.prevent="onCanvasDrop"
      >
        <!-- 欢迎页面（未打开任何文件时显示） -->
        <div v-if="!layoutRoot" class="welcome-screen">
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
          <p class="welcome-hint">从左侧文件树打开文件；拖拽顶部标签到分屏边缘可组合多个导图</p>
        </div>

        <!-- 分屏 pane（Obsidian 式，按分割树排列） -->
        <div
          v-for="pl in paneLayouts"
          :key="pl.pane.id"
          class="split-pane"
          :class="{ active: pl.pane.id === activePaneId, fullscreen: pl.pane.fullscreen, 'single-pane': !isMultiPane }"
          :style="{ left: pl.x + '%', top: pl.y + '%', width: pl.w + '%', height: pl.h + '%' }"
          @mousedown.capture="focusPane(pl.pane.id)"
          @dragover.prevent="onPaneDragOver(pl.pane, $event)"
          @dragleave="onPaneDragLeave(pl.pane)"
          @drop.prevent="onPaneDrop(pl.pane, $event)"
        >
          <div
            class="pane-titlebar"
            v-show="isMultiPane"
            draggable="true"
            @dragstart="onPaneTitleDragStart($event, pl.pane.id)"
            @dragend="onPaneTitleDragEnd"
            title="拖动到中间交换位置，拖到边缘切换分屏方向"
          >
            <span v-if="pl.pane.fileType === 'outline'" class="pane-type-badge">大纲</span>
            <span v-else-if="pl.pane.fileType === 'doc'" class="pane-type-badge">文档</span>
            <span class="pane-title" :title="pl.pane.title">{{ pl.pane.title }}</span>
            <button class="pane-close" title="关闭分屏" @click.stop="closePane(pl.pane.id)">×</button>
          </div>
          <div class="pane-body">
            <MindMapEditor
              v-if="pl.pane.fileType === 'mindmap'"
              v-show="pl.pane.view !== 'outline' && pl.pane.view !== 'graph'"
              :key="'mm-' + pl.pane.id + ':' + pl.pane.fileId"
              :ref="el => registerEditor(pl.pane.id, el)"
              :data="tabFor(pl.pane.fileId).data"
              :file-id="pl.pane.fileId"
              :visible="pl.pane.view !== 'outline' && pl.pane.view !== 'graph'"
              :fullscreen="pl.pane.fullscreen"
              @data-change="onDataChange"
              @node-active="(node, list) => onNodeActive(pl.pane, node, list)"
              @node-tree-render-end="onNodeTreeRenderEnd"
              @ai-continue="handleAiContinue"
              @ai-add-child="handleAiAddChild"
              @ai-rewrite="handleAiRewrite"
              @ai-cloze="handleAiCloze"
              @ai-cloze-full-map="handleAiClozeFullMap"
              @ai-rewrite-full-map="handleAiRewriteFullMap"
              @reorganize-mindmap="handleReorganizeMindmap"
              @ai-quiz="handleAiQuiz"
              @ai-add-to-chat="handleAiAddToChat"
              @add-review="handleAddReview"
              @add-tag="handleAddTag"
              @open-reference-file="handleOpenReferenceFile"
              @fullscreen-change="v => onPaneFullscreenChange(pl.pane, v, 'mindmap')"
            />
            <!-- 固定工具条：放在激活 pane 内部，相对 pane 定位，避免分屏时遮挡其他窗格标题栏 -->
            <FixedToolbar
              v-if="pl.pane.id === activePaneId && pl.pane.fileType === 'mindmap' && pl.pane.view !== 'outline' && pl.pane.view !== 'graph' && !pl.pane.fullscreen"
              :mindMap="activeMindMapInstance"
              :activeNodes="activePaneNodes"
              :split-mode="isMultiPane"
              @node-note="onToolbarNodeNote"
            />
            <OutlineView
              v-if="pl.pane.fileType === 'mindmap' && pl.pane.view === 'outline'"
              :key="'ol-' + pl.pane.id + ':' + pl.pane.fileId"
              :ref="el => registerOutlineView(pl.pane.id, el)"
              :mindMap="mindMapInstances[pl.pane.id] || null"
              :visible="true"
              :mindMapData="tabFor(pl.pane.fileId).data"
              :current-file-name="pl.pane.title"
              :fullscreen="pl.pane.fullscreen"
              @ai-continue="handleAiContinue"
              @ai-add-child="handleAiAddChild"
              @ai-rewrite="handleAiRewrite"
              @ai-cloze="handleAiCloze"
              @ai-cloze-full-map="handleAiClozeFullMap"
              @reorganize-mindmap="handleReorganizeMindmap"
              @ai-quiz="handleAiQuiz"
              @ai-add-to-chat="handleAiAddToChat"
              @add-review="handleAddReview"
              @add-tag="handleAddTag"
              @open-reference-file="handleOpenReferenceFile"
              @fullscreen-change="v => onPaneFullscreenChange(pl.pane, v, 'outline')"
            />
            <GraphView
              v-if="pl.pane.fileType === 'mindmap' && pl.pane.view === 'graph'"
              :mindMap="mindMapInstances[pl.pane.id] || null"
              :mindMapData="tabFor(pl.pane.fileId).data"
              @locate-node="onGraphLocateNode"
            />
            <DocViewer
              v-if="pl.pane.fileType === 'doc'"
              :key="'doc-' + pl.pane.id + ':' + pl.pane.filePath"
              :ref="el => registerDocViewer(pl.pane.id, el)"
              :visible="true"
              :file-path="pl.pane.filePath"
              :file-name="pl.pane.title"
              @close="closePane(pl.pane.id)"
              @convert-mindmap="onDocConvertMindmap"
              @add-tag="onDocAddTag"
              @add-to-chat="onDocAddToChat"
            />
          </div>
          <!-- 拖拽分屏边缘指示 -->
          <div v-if="dragOverPaneId === pl.pane.id" class="pane-drop-indicator" :class="dragOverEdge"></div>
        </div>

        <!-- 分割条 -->
        <div
          v-for="sp in splitterLayouts"
          :key="sp.splitId"
          class="split-divider"
          :class="sp.direction"
          :style="dividerStyle(sp)"
          @mousedown="startSplitterDrag(sp, $event)"
        ></div>

        <!-- ============ 右下角全局按钮组（思维导图/大纲/关联图/全屏，跟随主内容区） ============ -->
        <div
          v-if="hasFile && activePane && activePane.fileType === 'mindmap' && (viewMode === 'mindmap' || viewMode === 'outline' || viewMode === 'graph')"
          class="global-bottom-right-actions"
          :class="{ 'in-fullscreen': activePane.fullscreen }"
        >
          <button
            class="global-action-btn"
            :class="{ active: (viewMode === 'mindmap' || viewMode === 'outline') && activePane.view !== 'outline' }"
            title="思维导图模式"
            @click="switchToMindMapView"
          >
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="5" cy="12" r="2" />
              <circle cx="18.5" cy="5" r="1.8" />
              <circle cx="18.5" cy="12" r="1.8" />
              <circle cx="18.5" cy="19" r="1.8" />
              <path d="M7 12h3.5M10.5 12l4.4-4.8M10.5 12h6.2M10.5 12l4.4 4.8" />
            </svg>
          </button>
          <button
            class="global-action-btn"
            :class="{ active: (viewMode === 'mindmap' || viewMode === 'outline') && activePane.view === 'outline' }"
            title="大纲模式"
            @click="switchToOutlineView"
          >
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M4 6h16M4 12h16M4 18h10" />
            </svg>
          </button>
          <button
            class="global-action-btn"
            :class="{ active: viewMode === 'graph' }"
            title="关联图模式"
            @click="toggleGraphView"
          >
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="5" cy="6" r="2.5" />
              <circle cx="19" cy="6" r="2.5" />
              <circle cx="12" cy="18" r="2.5" />
              <path d="M7 7.5l3.5 8.5M17 7.5l-3.5 8.5" />
            </svg>
          </button>
          <button
            class="global-action-btn"
            :class="{ active: activePane.fullscreen }"
            :title="activePane.fullscreen ? '退出全屏 (ESC)' : '全屏展示 (ESC 退出)'"
            @click="toggleActivePaneFullscreen"
          >
            <svg v-if="!activePane.fullscreen" viewBox="0 0 24 24" width="15" height="15" fill="currentColor">
              <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" />
            </svg>
            <svg v-else viewBox="0 0 24 24" width="15" height="15" fill="currentColor">
              <path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z" />
            </svg>
          </button>
        </div>
      </main>

      <!-- ===== 右侧 AI 面板折叠/展开按钮 ===== -->
      <button
        class="ai-collapse-btn"
        :class="{ collapsed: !aiPanelExpanded }"
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

      <!-- AI 悬浮球：AI 侧边栏收起时显示（全屏模式下也显示） -->
      <button
        v-if="!aiPanelExpanded && !floatingChatVisible"
        class="ai-float-ball"
        :class="{ active: floatingChatVisible, 'in-fullscreen': mmFullscreen || outlineFullscreen }"
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
      <aside class="ai-panel" :class="{ collapsed: !aiPanelExpanded, 'floating-chat': !aiPanelExpanded && floatingChatVisible, 'in-fullscreen': mmFullscreen || outlineFullscreen }">
        <button
          v-if="!aiPanelExpanded && floatingChatVisible"
          class="floating-chat-close"
          title="关闭悬浮对话"
          @click="floatingChatVisible = false"
        >×</button>
        <ChatPanel
          ref="chatPanelRef"
          :mindMap="aiBoundMindMap"
          :activeNode="activeNode"
          :currentFilePath="currentFilePath"
          :currentFileName="currentFileName"
          :compact="!aiPanelExpanded"
          :webSearch="webSearchEnabled"
          :mindMapWindows="mindMapWindows"
          :aiBindFileId="aiBindFileId"
          :aiBindLocked="aiBindLocked"
          @update-ai-bind="onUpdateAiBind"
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
        <span class="status-text">{{ viewMode === 'mindmap' ? '思维导图视图' : viewMode === 'outline' ? '大纲视图' : viewMode === 'graph' ? '关联图视图' : viewMode === 'tag' ? '标签模式' : '复习模式' }}</span>
      </div>
    </footer>

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

    <!-- ============ 布局模板弹窗 ============ -->
    <el-dialog
      v-model="layoutDialogVisible"
      title="布局模板"
      width="560px"
      :close-on-click-modal="true"
      align-center
      destroy-on-close
    >
      <div class="layout-dialog">
        <div class="layout-save-row">
          <el-input
            v-model="layoutSaveName"
            placeholder="输入布局名称，保存当前窗口排列"
            maxlength="40"
            clearable
            @keyup.enter="saveLayoutTemplate"
          />
          <el-button type="primary" @click="saveLayoutTemplate">保存当前布局</el-button>
        </div>
        <div class="layout-list">
          <div v-if="layoutTemplates.length === 0" class="layout-empty">暂无保存的布局模板</div>
          <div v-for="tpl in layoutTemplates" :key="tpl.name" class="layout-item">
            <div class="layout-item-info">
              <span class="layout-item-name">{{ tpl.name }}</span>
              <span class="layout-item-meta">{{ tpl.paneCount }} 个窗口 · {{ tpl.createdAt ? new Date(tpl.createdAt).toLocaleString() : '' }}</span>
            </div>
            <div class="layout-item-actions">
              <el-button size="small" @click="restoreLayoutTemplate(tpl)">恢复</el-button>
              <el-button size="small" type="danger" plain @click="deleteLayoutTemplate(tpl)">删除</el-button>
            </div>
          </div>
        </div>
      </div>
    </el-dialog>

    <!-- ============ 添加标签悬浮窗 ============ -->
    <Teleport to="body">
      <Transition name="tag-pop">
        <div
          v-if="addTagDialogVisible"
          class="add-tag-popover"
          :style="addTagPopoverStyle"
          @click.stop
        >
          <div class="add-tag-pop-header">
            <span class="add-tag-pop-title">添加标签</span>
            <button class="add-tag-pop-close" @click="addTagDialogVisible = false">✕</button>
          </div>
          <div class="add-tag-pop-body">
            <div class="add-tag-loc" v-if="addTagTarget.locationText">{{ addTagTarget.locationText }}</div>
            <input
              ref="addTagNameInputRef"
              v-model="addTagForm.tag"
              class="add-tag-input"
              placeholder="标签名（如：重点、待整理、重要概念）"
              maxlength="30"
              @keyup.enter="confirmAddTag"
              @keydown.esc="addTagDialogVisible = false"
            />
            <textarea
              v-model="addTagForm.note"
              class="add-tag-textarea"
              placeholder="备注（可留空）"
              maxlength="200"
              rows="3"
            ></textarea>
          </div>
          <div class="add-tag-pop-footer">
            <button class="add-tag-btn" @click="addTagDialogVisible = false">取消</button>
            <button class="add-tag-btn primary" @click="confirmAddTag">确定</button>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- ============ 工具调用状态指示器 ============ -->
    <ToolCallIndicator
      :status="toolCallStatus"
      @dismiss="toolCallStatus = ''"
    />

    <!-- ============ OCR 截图识别 ============ -->
    <OcrScreenshot ref="ocrScreenshotRef" />

    <!-- ============ AI 定时任务面板（侧滑） ============ -->
    <Transition name="feishu-slide">
      <div v-if="taskSchedulerPanelVisible" class="feishu-panel-container" :style="{ left: taskSchedulerPanelLeftOffset }">
        <TaskSchedulerPanel
          :visible="true"
          @close="taskSchedulerPanelVisible = false"
          @run-now="taskId => onScheduledTaskTrigger(taskId, { manual: true })"
        />
      </div>
    </Transition>

    <!-- ============ 快捷键中心（悬浮小窗口） ============ -->
    <ShortcutCenter :visible="shortcutCenterVisible" @close="shortcutCenterVisible = false" />

    <!-- ============ 全屏节点搜索框（Ctrl+F） ============ -->
    <div v-if="nodeSearchVisible" class="node-search-bar">
      <input
        ref="nodeSearchInputRef"
        v-model="nodeSearchText"
        class="node-search-input"
        placeholder="搜索节点…"
        @input="doNodeSearch"
        @keydown.enter="nodeSearchNext"
        @keydown.esc="closeNodeSearch"
      />
      <span class="node-search-count">{{ nodeSearchCount ? (nodeSearchIndex + 1) + ' / ' + nodeSearchCount : (nodeSearchText ? '无结果' : '') }}</span>
      <button class="node-search-btn" :disabled="!nodeSearchCount" title="上一个（Shift+Enter）" @click="nodeSearchPrev">↑</button>
      <button class="node-search-btn" :disabled="!nodeSearchCount" title="下一个（Enter）" @click="nodeSearchNext">↓</button>
      <button class="node-search-btn" title="关闭（Esc）" @click="closeNodeSearch">✕</button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, shallowReactive, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, FolderOpened, Document } from '@element-plus/icons-vue'
import MindMapEditor from './components/MindMapEditor.vue'
import OutlineView from './components/OutlineView.vue'
import FixedToolbar from './components/FixedToolbar.vue'
import ReviewView from './components/ReviewView.vue'
import TagView from './components/TagView.vue'
import FileTree from './components/FileTree.vue'
import SearchBar from './components/SearchBar.vue'
import DocViewer from './components/DocViewer.vue'
import OcrScreenshot from './components/OcrScreenshot.vue'
import ChatPanel from './components/ChatPanel.vue'
import GraphView from './components/GraphView.vue'
import LogPanel from './components/LogPanel.vue'
import ToolCallIndicator from './components/ToolCallIndicator.vue'
import SettingsView from './components/SettingsView.vue'
import TaskSchedulerPanel from './components/TaskSchedulerPanel.vue'
import ShortcutCenter from './components/ShortcutCenter.vue'
import { taskSchedulerService } from './services/taskSchedulerService'
import { searchService } from './services/searchService'
import { countNodes } from './utils/treeUtils'
import { addToReviewPlan, isInReviewPlan, extractNodeText, removeOrphanReviewItems, remapReviewPaths, getTodayReviewItems, getReminderConfig, getToday } from './utils/reviewPlan'
import { addTag, getTagsByFilePath, removeTagsByFilePath, remapTagPaths } from './utils/tagStore'
import { addFeishuLog } from './utils/feishuLogStore'
import { addPanelLog } from './utils/panelLogStore'
import { feishuService } from './services/feishuService'
import { wechatService } from './services/wechatService'
import { useMindMapStore } from './stores/mindMapStore'
import { getDragFilePath } from './utils/dragState'
import {
  applyTextStyleToNodes,
  fontColorShortcuts,
  highlightColorShortcuts
} from './utils/textStyle'

// 视图模式：outline | mindmap | tag | review
const viewMode = ref('mindmap')

// 视图模式索引（用于 segmented control 指示器位置）：文件目录 / 标签 / 复习 三段
const viewModeIndex = computed(() => {
  if (viewMode.value === 'tag') return 1
  if (viewMode.value === 'review') return 2
  return 0 // mindmap / outline / graph 都属于「文件目录」
})

// MindMapEditor 组件引用（多实例：每个导图文件一个独立 editor，按 fileId 索引）
const editorRefs = shallowReactive({})
// [多实例] Tab 列表：每元素 { fileId, fileName, data, isImported }
const tabs = ref([])
// [多实例] 当前激活 Tab 的 fileId
const activeFileId = ref('')
const dragTabKey = ref('')
const dragOverTabKey = ref('')
// 拖动 pane 标题栏交换位置时的源 pane id
const dragPaneId = ref('')
// 统一标签顺序：思维导图标签(map)与文档标签(doc)共用一套拖拽顺序，元素 { kind, id }
const tabOrder = ref([])
// [多实例] 激活 Tab 索引（未匹配时返回 -1）
const activeIndex = computed(() => tabs.value.findIndex(t => t.fileId === activeFileId.value))
// editorRef 指向当前激活 pane 的 editor（多窗口下即当前聚焦窗口的实例）
const editorRef = computed(() => {
  const pid = activePaneId.value
  return (pid && editorRefs[pid]) || null
})

// ChatPanel 组件引用
const chatPanelRef = ref(null)

// FileTree 组件引用
const fileTreeRef = ref(null)

// SearchBar 组件引用
const searchBarRef = ref(null)

// ReviewView 组件引用
const reviewViewRef = ref(null)

// TagView 组件引用
const tagViewRef = ref(null)

// OcrScreenshot 组件引用
const ocrScreenshotRef = ref(null)

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

// 文档查看器（PDF/DOCX/XLSX/CSV/MD/TXT）：点击目录树中的文档文件原样打开（内嵌中间区域，支持多标签）
const showDocViewer = ref(false)
const docTabs = ref([])            // { filePath, fileName }
const activeDocFilePath = ref('')  // 当前激活的文档路径
const activeDocFile = computed(() => docTabs.value.find(t => t.filePath === activeDocFilePath.value) || { filePath: '', fileName: '' })

/* ============================================================
 * 需求2：Obsidian 式分屏布局（分屏树 + 标签拖到边缘分屏）
 * ============================================================ */
// 分屏树节点：
// - pane:  { id, kind:'pane', fileType:'mindmap'|'doc'|'outline', fileId, filePath, title, fullscreen }
// - split: { id, kind:'split', direction:'row'|'column', sizes:[r0,r1], children:[a,b] }
const layoutRoot = ref(null)
const activePaneId = ref('')
let paneSeq = 0
let splitSeq = 0

// 每文件的 mindMap 实例 / 大纲组件 / 文档组件（浅响应：属性赋值触发更新，值不做深层代理）
const mindMapInstances = shallowReactive({})
const outlineViewRefs = shallowReactive({})
const docViewerRefs = shallowReactive({})
// 每个 pane 的激活节点列表（供全局 FixedToolbar 使用）
const paneActiveNodes = shallowReactive({})

// 在树中按 id 查找 pane
const findPaneById = (node, id) => {
  if (!node) return null
  if (node.kind === 'pane') return node.id === id ? node : null
  for (const c of node.children) {
    const r = findPaneById(c, id)
    if (r) return r
  }
  return null
}

// 在树中按文件查找 pane（mindmap/outline 按 fileId，doc 按 filePath）
const findPaneByFile = (node, fileType, key) => {
  if (!node) return null
  if (node.kind === 'pane') {
    const k = fileType === 'doc' ? node.filePath : node.fileId
    return (node.fileType === fileType && k === key) ? node : null
  }
  for (const c of node.children) {
    const r = findPaneByFile(c, fileType, key)
    if (r) return r
  }
  return null
}

// 收集树中所有 pane（深度优先）
const collectPanes = (node, out = []) => {
  if (!node) return out
  if (node.kind === 'pane') { out.push(node); return out }
  node.children.forEach(c => collectPanes(c, out))
  return out
}

// 当前激活 pane
const activePane = computed(() => findPaneById(layoutRoot.value, activePaneId.value))

// 是否多分屏模式（大于 1 个 pane 时显示边框/标题栏）
const isMultiPane = computed(() => collectPanes(layoutRoot.value).length > 1)

// 当前激活 pane 的 mindMap 实例（供全局 FixedToolbar / 全屏按钮使用）
const activeMindMapInstance = computed(() => {
  const p = activePane.value
  if (!p || p.fileType !== 'mindmap') return null
  return mindMapInstances[p.id] || null
})

// 当前激活 pane 的导图原始数据（供关联图等不依赖编辑器实例的组件使用）
const activeMindMapData = computed(() => {
  const p = activePane.value
  if (!p || p.fileType !== 'mindmap' || !p.fileId) return null
  return tabFor(p.fileId)?.data || null
})

// 当前激活 pane 的激活节点列表（供全局 FixedToolbar 使用）
const activePaneNodes = computed(() => {
  const p = activePane.value
  if (!p) return []
  return paneActiveNodes[p.id] || []
})

// 当前聚焦的大纲视图的 OutlineView 组件（文本样式/概括等操作据此定位到正确 pane）
const outlineViewRef = computed(() => {
  const p = activePane.value
  return (p && p.fileType === 'mindmap' && p.view === 'outline' && outlineViewRefs[p.id]) || null
})
// 当前聚焦的文档窗口的 DocViewer 组件（标签跳转 jumpTo 用）
const docViewerRef = computed(() => {
  const p = activePane.value
  return (p && p.fileType === 'doc' && docViewerRefs[p.id]) || null
})

// 根据 fileId 取对应 Tab（导图 pane 渲染用；兜底返回空数据）
const tabFor = (fileId) => tabs.value.find(t => t.fileId === fileId) || { fileId, fileName: '', data: null, isImported: false }

const nextPaneId = () => 'pane-' + (++paneSeq)
const nextSplitId = () => 'sp-' + (++splitSeq)

const makePane = (fileType, payload) => ({
  id: nextPaneId(),
  kind: 'pane',
  fileType,
  fileId: fileType === 'doc' ? '' : (payload.fileId || ''),
  filePath: fileType === 'doc' ? (payload.filePath || '') : '',
  title: payload.title || ((fileType === 'doc' ? payload.filePath : payload.fileId) || '').split('/').pop() || '未命名',
  fullscreen: false,
  view: 'map'
})

// 聚焦 pane：同步单值状态（activeFileId / activeDocFilePath / viewMode / showDocViewer）
const focusPane = (paneId) => {
  const pane = findPaneById(layoutRoot.value, paneId)
  if (!pane) return
  activePaneId.value = paneId
  if (pane.fileType === 'doc') {
    activeDocFilePath.value = pane.filePath
    showDocViewer.value = true
    currentFilePath.value = pane.filePath // 同步目录树选中该文档
  } else {
    const tab = tabs.value.find(t => t.fileId === pane.fileId)
    activeFileId.value = pane.fileId
    if (tab) {
      mindMapData.value = tab.data
      currentFilePath.value = tab.fileId
      currentFileIsImported.value = tab.isImported
    }
    hasFile.value = true
    showDocViewer.value = false
    // 仅在导图/大纲/关联图视图间切换 viewMode；复习/标签侧栏模式保持不变
    if (viewMode.value === 'mindmap' || viewMode.value === 'outline' || viewMode.value === 'graph') {
      viewMode.value = pane.view === 'outline' ? 'outline' : pane.view === 'graph' ? 'graph' : 'mindmap'
    }
  }
}

// 打开文件到分屏：已存在则聚焦；空布局则单 pane；否则替换激活 pane（一个界面一个导图）
const openFileToPane = (fileType, fileId, filePath, title) => {
  const key = fileType === 'doc' ? filePath : fileId
  if (!key) return null
  let pane = findPaneByFile(layoutRoot.value, fileType, key)
  if (pane) {
    focusPane(pane.id)
    return pane
  }
  if (!layoutRoot.value) {
    pane = makePane(fileType, { fileId, filePath, title })
    layoutRoot.value = pane
    focusPane(pane.id)
    return pane
  }
  let target = findPaneById(layoutRoot.value, activePaneId.value)
  if (!target) target = collectPanes(layoutRoot.value)[0]
  if (target) {
    target.fileType = fileType
    target.fileId = fileType === 'doc' ? '' : fileId
    target.filePath = fileType === 'doc' ? filePath : ''
    target.title = title || key.split('/').pop() || '未命名'
    target.fullscreen = false
    focusPane(target.id)
    return target
  }
  return null
}

// 在目标 pane 边缘分屏：direction = 'left'|'right'|'top'|'bottom'
const splitPane = (targetPaneId, direction, fileType, fileId, filePath, title) => {
  const key = fileType === 'doc' ? filePath : fileId
  if (!key) return null
  // 拖拽分屏始终新建 pane（允许同一文件出现在多个 pane，Obsidian 行为），不再去重聚焦
  const targetPane = findPaneById(layoutRoot.value, targetPaneId)
  if (!targetPane) return null
  const newPane = makePane(fileType, { fileId, filePath, title })
  const replace = (node) => {
    if (!node) return null
    if (node.kind === 'pane') {
      if (node.id !== targetPaneId) return node
      const isRow = direction === 'left' || direction === 'right'
      return {
        id: nextSplitId(),
        kind: 'split',
        direction: isRow ? 'row' : 'column',
        sizes: [0.5, 0.5],
        children: (direction === 'left' || direction === 'top') ? [newPane, node] : [node, newPane]
      }
    }
    node.children = node.children.map(replace)
    return node
  }
  layoutRoot.value = replace(layoutRoot.value)
  focusPane(newPane.id)
  // 分屏后所有 pane 尺寸均已变化，统一 resize 全部编辑器，避免新 pane 空白或旧 pane 缩放残留
  nextTick(() => {
    requestAnimationFrame(() => {
      Object.keys(editorRefs).forEach(pid => {
        const ed = editorRefs[pid]
        if (ed && typeof ed.resize === 'function') {
          try { ed.resize() } catch (err) { /* 忽略 */ }
        }
      })
    })
  })
  return newPane
}

// 交换两个 pane 的内容（拖动标题栏到另一个 pane 中间时交换位置）
const swapPanes = (paneIdA, paneIdB) => {
  const a = findPaneById(layoutRoot.value, paneIdA)
  const b = findPaneById(layoutRoot.value, paneIdB)
  if (!a || !b || a === b) return
  const tmp = { fileType: a.fileType, fileId: a.fileId, filePath: a.filePath, title: a.title, view: a.view }
  a.fileType = b.fileType
  a.fileId = b.fileId
  a.filePath = b.filePath
  a.title = b.title
  a.view = b.view
  b.fileType = tmp.fileType
  b.fileId = tmp.fileId
  b.filePath = tmp.filePath
  b.title = tmp.title
  b.view = tmp.view
  focusPane(paneIdA)
  // 内容已互换，统一 resize 一次确保画布/文档正确重排
  nextTick(() => {
    requestAnimationFrame(() => {
      Object.keys(editorRefs).forEach(pid => {
        const ed = editorRefs[pid]
        if (ed && typeof ed.resize === 'function') { try { ed.resize() } catch (err) { /* 忽略 */ } }
      })
    })
  })
}

// 拖动标题栏到另一个窗格的边缘：改变这两个窗格的分屏方向（上下或左右）
const reorientSplit = (srcPaneId, targetPaneId, edge) => {
  const src = findPaneById(layoutRoot.value, srcPaneId)
  const target = findPaneById(layoutRoot.value, targetPaneId)
  if (!src || !target || src === target) return
  const isRow = edge === 'left' || edge === 'right'
  const direction = isRow ? 'row' : 'column'
  // 1) 先把源窗格从树中摘除，并折叠其原位置（若只剩一个兄弟则上移）
  const detach = (node) => {
    if (!node) return null
    if (node.kind === 'pane') return node.id === srcPaneId ? null : node
    const children = node.children.map(detach).filter(Boolean)
    if (children.length === 0) return null
    if (children.length === 1) return children[0]
    node.children = children
    return node
  }
  let root = detach(layoutRoot.value)
  // 2) 在目标窗格位置，用新的 split 把源窗格与目标窗格按边缘方向重排
  const wrap = (node) => {
    if (!node) return null
    if (node.kind === 'pane') {
      if (node.id !== targetPaneId) return node
      const children = (edge === 'left' || edge === 'top') ? [src, node] : [node, src]
      return { id: nextSplitId(), kind: 'split', direction, sizes: [0.5, 0.5], children }
    }
    node.children = node.children.map(wrap)
    return node
  }
  root = wrap(root)
  if (!root) return
  layoutRoot.value = root
  focusPane(srcPaneId)
  nextTick(() => {
    requestAnimationFrame(() => {
      Object.keys(editorRefs).forEach(pid => {
        const ed = editorRefs[pid]
        if (ed && typeof ed.resize === 'function') { try { ed.resize() } catch (err) { /* 忽略 */ } }
      })
    })
  })
}

// 关闭 pane：从树中移除并折叠；若该文件无其他 pane 引用则关闭标签
const closePane = async (paneId) => {
  const pane = findPaneById(layoutRoot.value, paneId)
  if (!pane) return
  if (pane.fileType === 'mindmap' && dirtyFiles.has(pane.fileId)) {
    const ok = await saveFileById(pane.fileId).catch(() => false)
    if (!ok) ElMessage.error('关闭前保存失败，该窗口的修改可能已丢失')
  }
  dirtyFiles.delete(pane.fileId)
  const remove = (node) => {
    if (!node) return null
    if (node.kind === 'pane') return node.id === paneId ? null : node
    const children = node.children.map(remove).filter(Boolean)
    if (children.length === 0) return null
    if (children.length === 1) return children[0]
    node.children = children
    return node
  }
  layoutRoot.value = remove(layoutRoot.value)

  if (pane.fileType === 'mindmap') {
    if (!findPaneByFile(layoutRoot.value, 'mindmap', pane.fileId)) {
      const idx = tabs.value.findIndex(t => t.fileId === pane.fileId)
      if (idx >= 0) tabs.value.splice(idx, 1)
      releaseAiBindIfClosed(pane.fileId)
    }
  } else if (pane.fileType === 'doc') {
    if (!findPaneByFile(layoutRoot.value, 'doc', pane.filePath)) {
      docTabs.value = docTabs.value.filter(t => t.filePath !== pane.filePath)
    }
  }

  const remaining = collectPanes(layoutRoot.value)
  if (remaining.length > 0) {
    const next = findPaneById(layoutRoot.value, activePaneId.value) || remaining[remaining.length - 1]
    focusPane(next.id)
  } else {
    activePaneId.value = ''
    if (tabs.value.length === 0) {
      activeFileId.value = ''
      currentFilePath.value = ''
      currentFileIsImported.value = false
      hasFile.value = false
      mindMapData.value = { data: { text: '<p><span>中心主题</span></p>', uid: 'root-' + Date.now(), richText: true }, children: [] }
    }
    if (docTabs.value.length === 0) {
      activeDocFilePath.value = ''
      showDocViewer.value = false
    }
  }
  isDirty.value = dirtyFiles.size > 0
}

// 编辑器注册（函数 ref）：按 pane.id 索引（允许同一文件出现在多个 pane），挂载后同步实例到 mindMapInstances
const registerEditor = (paneId, el) => {
  if (el) {
    editorRefs[paneId] = el
    nextTick(() => {
      try { el.ensureInit?.() } catch (e) { /* 忽略 */ }
      const inst = el.getMindMap?.()
      if (inst) mindMapInstances[paneId] = inst
    })
  } else {
    delete editorRefs[paneId]
    delete mindMapInstances[paneId]
  }
}
const registerDocViewer = (paneId, el) => {
  if (el) docViewerRefs[paneId] = el
  else delete docViewerRefs[paneId]
}
const registerOutlineView = (paneId, el) => {
  if (el) outlineViewRefs[paneId] = el
  else delete outlineViewRefs[paneId]
}

/* ============ 分屏布局计算（百分比盒 + 分割条） ============ */
const paneLayouts = ref([])
const splitterLayouts = ref([])

const recomputeLayouts = () => {
  const panes = []
  const splitters = []
  const walk = (node, x, y, w, h) => {
    if (!node) return
    if (node.kind === 'pane') {
      panes.push({ pane: node, x, y, w, h })
      return
    }
    const [s0, s1] = node.sizes || [0.5, 0.5]
    const sum = (s0 + s1) || 1
    if (node.direction === 'row') {
      const w0 = w * s0 / sum
      walk(node.children[0], x, y, w0, h)
      walk(node.children[1], x + w0, y, w - w0, h)
      splitters.push({ splitId: node.id, direction: 'vertical', box: { x, y, w, h }, pos: x + w0 })
    } else {
      const h0 = h * s0 / sum
      walk(node.children[0], x, y, w, h0)
      walk(node.children[1], x, y + h0, w, h - h0)
      splitters.push({ splitId: node.id, direction: 'horizontal', box: { x, y, w, h }, pos: y + h0 })
    }
  }
  walk(layoutRoot.value, 0, 0, 100, 100)
  paneLayouts.value = panes
  splitterLayouts.value = splitters
}

watch(layoutRoot, () => recomputeLayouts(), { deep: true, immediate: true })

const updateSplitSizes = (splitId, ratio) => {
  const findSplit = (node) => {
    if (!node) return null
    if (node.kind === 'split' && node.id === splitId) return node
    for (const c of (node.children || [])) {
      const r = findSplit(c)
      if (r) return r
    }
    return null
  }
  const split = findSplit(layoutRoot.value)
  if (split) split.sizes = [ratio, 1 - ratio]
}

const dividerStyle = (sp) => {
  if (sp.direction === 'vertical') {
    return { left: `calc(${sp.pos}% - 2px)`, top: sp.box.y + '%', width: '4px', height: sp.box.h + '%' }
  }
  return { top: `calc(${sp.pos}% - 2px)`, left: sp.box.x + '%', width: sp.box.w + '%', height: '4px' }
}

/* ============ 分割条拖拽 ============ */
const clampNum = (v, min, max) => Math.min(Math.max(v, min), max)
let splitterDragState = null

const startSplitterDrag = (sp, e) => {
  if (e.button !== 0) return
  const canvas = document.querySelector('.window-canvas')
  const rect = canvas ? canvas.getBoundingClientRect() : { left: 0, top: 0, width: 1, height: 1 }
  splitterDragState = { splitId: sp.splitId, direction: sp.direction, box: sp.box, rect }
  e.preventDefault()
}

const onGlobalMouseMove = (e) => {
  if (splitterDragState) {
    const s = splitterDragState
    let ratio
    if (s.direction === 'vertical') {
      const boxLeft = s.rect.left + s.box.x * s.rect.width / 100
      const boxWidth = s.box.w * s.rect.width / 100
      ratio = (e.clientX - boxLeft) / boxWidth
    } else {
      const boxTop = s.rect.top + s.box.y * s.rect.height / 100
      const boxHeight = s.box.h * s.rect.height / 100
      ratio = (e.clientY - boxTop) / boxHeight
    }
    ratio = clampNum(ratio, 0.15, 0.85)
    updateSplitSizes(s.splitId, ratio)
  }
}
const onGlobalMouseUp = () => {
  splitterDragState = null
}

/* ============ 拖拽标签到 pane 边缘分屏 ============ */
const dragOverPaneId = ref('')
const dragOverEdge = ref('')

const computeDropEdge = (pane, e) => {
  const el = e.currentTarget
  const rect = el.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return null
  const x = e.clientX - rect.left
  const y = e.clientY - rect.top
  // 计算鼠标到四条边的相对距离（0=贴边，1=对边），取最近的边作为分屏方向。
  // 旧的“先判左右再判上下”写法会在四角（尤其左下角）总命中左右，导致上下分屏几乎无法触发。
  const dl = x / rect.width
  const dr = 1 - dl
  const dt = y / rect.height
  const db = 1 - dt
  const t = 0.28
  const min = Math.min(dl, dr, dt, db)
  if (min > t) return null
  if (min === dl) return 'left'
  if (min === dr) return 'right'
  if (min === dt) return 'top'
  return 'bottom'
}

// 解析拖拽文本 → { fileType, fileId, filePath, title }
const parseDropText = (text) => {
  if (text.startsWith('map:')) {
    const fid = text.slice(4)
    const tab = tabs.value.find(t => t.fileId === fid)
    return { fileType: 'mindmap', fileId: fid, filePath: '', title: (tab && tab.fileName) || fid.split('/').pop() || '未命名' }
  }
  if (text.startsWith('doc:')) {
    const fp = text.slice(4)
    const d = docTabs.value.find(t => t.filePath === fp)
    return { fileType: 'doc', fileId: '', filePath: fp, title: (d && d.fileName) || fp.split(/[\\/]/).pop() || '未命名' }
  }
  const ext = String(text).split('.').pop().toLowerCase()
  const docExts = ['pdf', 'docx', 'xlsx', 'xls', 'csv', 'tsv', 'txt', 'md', 'markdown', 'log', 'html', 'xml']
  if (docExts.includes(ext)) {
    return { fileType: 'doc', fileId: '', filePath: text, title: text.split(/[\\/]/).pop() || '未命名' }
  }
  return { fileType: 'mindmap', fileId: normalizeFileId(text), filePath: '', title: text.split(/[\\/]/).pop() || '未命名' }
}

// 拖动 pane 标题栏：记录源 pane，准备交换位置
const onPaneTitleDragStart = (e, paneId) => {
  dragPaneId.value = paneId
  e.dataTransfer.setData('text/plain', 'pane:' + paneId)
  e.dataTransfer.effectAllowed = 'move'
}
const onPaneTitleDragEnd = () => {
  dragPaneId.value = ''
  dragOverPaneId.value = ''
  dragOverEdge.value = ''
}

const onPaneDragOver = (pane, e) => {
  e.stopPropagation()
  // 无论是否命中，都声明可放置并设为 move，保证 drop 事件一定能触发（否则浏览器可能拒绝 drop，出现“卡住”）
  e.dataTransfer.dropEffect = 'move'
  // 拖 pane 标题栏：命中边缘=改变分屏方向，中间区域=交换位置
  if (dragPaneId.value && dragPaneId.value !== pane.id) {
    const edge = computeDropEdge(pane, e)
    dragOverPaneId.value = pane.id
    dragOverEdge.value = edge || 'swap'
    return
  }
  const edge = computeDropEdge(pane, e)
  if (edge) {
    dragOverPaneId.value = pane.id
    dragOverEdge.value = edge
  } else {
    // 在 pane 中间区域：清除高亮（不允许在中心位置 drop，只能在边缘）
    if (dragOverPaneId.value === pane.id) {
      dragOverPaneId.value = ''
      dragOverEdge.value = ''
    }
  }
}

const onPaneDragLeave = (pane) => {
  if (dragOverPaneId.value === pane.id) {
    dragOverPaneId.value = ''
    dragOverEdge.value = ''
  }
}

// 从文件树拖入未打开过的导图时，先加载其数据到 tabs（不替换当前 pane）
const loadMindmapForSplit = async (filePath) => {
  if (!window.electronAPI?.openFile) return false
  try {
    const result = await window.electronAPI.openFile(filePath)
    if (result && result.success && result.data && !result.isXmind) {
      let fileData = result.data
      if (result.isMarkdown && typeof fileData === 'string') {
        const { parseMarkdownToTree } = await import('./utils/markdownParser')
        fileData = parseMarkdownToTree(fileData)
      }
      const fid = normalizeFileId(filePath)
      const fileName = filePath.split(/[\\/]/).pop() || '未命名'
      if (!tabs.value.some(t => t.fileId === fid)) {
        tabs.value.push({ fileId: fid, fileName, data: fileData, isImported: !!(result.isMarkdown || result.isXmind) })
      }
      return true
    }
  } catch (e) {
    console.error('[分屏] 加载导图失败:', e)
  }
  return false
}

const onPaneDrop = async (pane, e) => {
  e.stopPropagation()
  // 拖 pane 标题栏：命中边缘=改变分屏方向，中间区域=交换两个窗口的位置
  if (dragPaneId.value && dragPaneId.value !== pane.id) {
    const src = dragPaneId.value
    const edge = computeDropEdge(pane, e)
    dragPaneId.value = ''
    dragOverPaneId.value = ''
    dragOverEdge.value = ''
    if (edge) reorientSplit(src, pane.id, edge)
    else swapPanes(src, pane.id)
    return
  }
  dragOverPaneId.value = ''
  dragOverEdge.value = ''
  // 标签拖拽的 key（map:/doc:）可能因同页拖拽 getData 返回空而丢失，这里用 dragTabKey 作后备
  const text = (e.dataTransfer?.getData('text/plain') || dragTabKey.value || getDragFilePath() || '').trim()
  if (!text) return
  const edge = computeDropEdge(pane, e) || 'right'
  const info = parseDropText(text)
  dragTabKey.value = ''

  // 文件未打开时先补齐：导图加载数据进 tabs，文档加入 docTabs；否则新 pane 会空白
  if (info.fileType === 'mindmap' && !tabs.value.some(t => t.fileId === info.fileId)) {
    await loadMindmapForSplit(info.fileId)
    if (!tabs.value.some(t => t.fileId === info.fileId)) {
      ElMessage.error('无法加载该导图文件，文件可能已移动或删除')
      return
    }
  } else if (info.fileType === 'doc' && !docTabs.value.some(t => t.filePath === info.filePath)) {
    docTabs.value.push({ filePath: info.filePath, fileName: info.title })
  }

  splitPane(pane.id, edge, info.fileType, info.fileId, info.filePath, info.title)
}

// 拖到空白画布（无 pane）→ 直接打开
const onCanvasDragOver = (e) => {
  e.dataTransfer.dropEffect = 'move'
}
const onCanvasDrop = (e) => {
  const text = (e.dataTransfer?.getData('text/plain') || dragTabKey.value || getDragFilePath() || '').trim()
  if (!text) return
  const info = parseDropText(text)
  dragTabKey.value = ''
  if (info.fileType === 'doc') {
    onTreeOpenDoc({ filePath: info.filePath, fileName: info.title })
  } else if (fileTreeRef.value?.openFileByPath) {
    fileTreeRef.value.openFileByPath(info.filePath || info.fileId)
  }
}

/* ============================================================
 * 布局模板保存/恢复（命名模板，localStorage 存储，无工作区绑定）
 * ============================================================ */
const layoutTemplates = ref([])
const layoutDialogVisible = ref(false)
const layoutSaveName = ref('')

const LAYOUT_TEMPLATES_KEY = 'mindmap-layout-templates'

const loadLayoutTemplates = () => {
  try {
    layoutTemplates.value = JSON.parse(localStorage.getItem(LAYOUT_TEMPLATES_KEY) || '[]')
  } catch {
    layoutTemplates.value = []
  }
}
const persistLayoutTemplates = () => {
  try {
    localStorage.setItem(LAYOUT_TEMPLATES_KEY, JSON.stringify(layoutTemplates.value))
  } catch (e) { /* 忽略 */ }
}

// 递归重建分屏树（读文件 + 建 pane/split）
const buildPaneTree = async (node) => {
  if (!node) return null
  if (node.kind === 'split') {
    const children = []
    for (const c of (node.children || [])) {
      const r = await buildPaneTree(c)
      if (r) children.push(r)
    }
    if (children.length === 0) return null
    if (children.length === 1) return children[0]
    return { id: nextSplitId(), kind: 'split', direction: node.direction || 'row', sizes: node.sizes || [0.5, 0.5], children }
  }
  if (node.fileType === 'doc') {
    if (!node.filePath) return null
    if (!docTabs.value.some(t => t.filePath === node.filePath)) {
      docTabs.value.push({ filePath: node.filePath, fileName: node.title })
    }
    return makePane('doc', { filePath: node.filePath, title: node.title })
  }
  const fp = node.fileId || node.filePath
  if (!fp) return null
  const res = await window.electronAPI?.refReadFile?.(fp)
  if (!(res?.success && res.data != null)) return null
  const fid = normalizeFileId(fp)
  // 兼容 markdown 等类型：恢复时前端解析为导图树
  let fileData = res.data
  if (res.type === 'markdown' && typeof res.data === 'string') {
    try {
      const { parseMarkdownToTree } = await import('./utils/markdownParser')
      fileData = parseMarkdownToTree(res.data)
    } catch (e) { fileData = res.data }
  }
  if (!tabs.value.some(t => t.fileId === fid)) {
    tabs.value.push({ fileId: fid, fileName: node.title || fid.split('/').pop() || '未命名', data: fileData, isImported: false })
  }
  const p = makePane('mindmap', { fileId: fid, title: node.title || fid.split('/').pop() || '未命名' })
  p.view = node.view === 'outline' ? 'outline' : node.view === 'graph' ? 'graph' : 'map'
  return p
}

const saveLayoutTemplate = () => {
  const name = layoutSaveName.value.trim()
  if (!name) {
    ElMessage.warning('请输入布局名称')
    return
  }
  if (!layoutRoot.value) {
    ElMessage.warning('当前没有打开的文件，无法保存布局')
    return
  }
  const tpl = {
    name,
    createdAt: Date.now(),
    paneCount: collectPanes(layoutRoot.value).length,
    layout: JSON.parse(JSON.stringify(layoutRoot.value))
  }
  const idx = layoutTemplates.value.findIndex(t => t.name === name)
  if (idx >= 0) layoutTemplates.value.splice(idx, 1, tpl)
  else layoutTemplates.value.push(tpl)
  persistLayoutTemplates()
  layoutSaveName.value = ''
  ElMessage.success(`已保存布局「${name}」`)
}

const restoreLayoutTemplate = async (tpl) => {
  if (!tpl || !tpl.layout) return
  try {
    const root = await buildPaneTree(tpl.layout)
    if (!root) {
      ElMessage.warning('布局中的文件已不存在，无法恢复')
      return
    }
    layoutRoot.value = root
    const first = collectPanes(root)[0]
    if (first) focusPane(first.id)
    ElMessage.success(`已恢复布局「${tpl.name}」`)
  } catch (e) {
    console.error('恢复布局失败:', e)
    ElMessage.error('恢复布局失败: ' + (e?.message || e))
  }
}

const deleteLayoutTemplate = (tpl) => {
  layoutTemplates.value = layoutTemplates.value.filter(t => t.name !== tpl.name)
  persistLayoutTemplates()
}

const openLayoutDialog = () => {
  loadLayoutTemplates()
  layoutSaveName.value = ''
  layoutDialogVisible.value = true
}

/* ============================================================
 * AI 绑定：当前窗口 + 窗口列表 + 锁定
 * ============================================================ */
const aiBindFileId = ref('')      // '' = 跟随当前聚焦窗口
const aiBindLocked = ref(false)   // true = 锁定到 aiBindFileId

// AI 实际操作的导图实例：锁定到某窗口时用该窗口实例，否则跟随当前聚焦窗口
const aiBoundMindMap = computed(() => {
  if (aiBindLocked.value && aiBindFileId.value) {
    const pane = findPaneByFile(layoutRoot.value, 'mindmap', aiBindFileId.value)
    if (pane) {
      return mindMapInstances[pane.id] || editorRefs[pane.id]?.getMindMap?.() || null
    }
    return null
  }
  return activeMindMap.value
})

// 供 AI 绑定下拉框选择：所有打开的导图窗口
const mindMapWindows = computed(() => tabs.value.map(t => ({
  fileId: t.fileId,
  fileName: t.fileName || t.fileId.split('/').pop() || '未命名'
})))

const onUpdateAiBind = ({ fileId, locked }) => {
  aiBindFileId.value = fileId || ''
  aiBindLocked.value = !!locked
}

// 关闭窗口时若该窗口是 AI 锁定目标，则解除锁定
const releaseAiBindIfClosed = (fileId) => {
  if (aiBindLocked.value && aiBindFileId.value === fileId) {
    aiBindFileId.value = ''
    aiBindLocked.value = false
  }
}

// AI 定时任务面板
const taskSchedulerPanelVisible = ref(false)
const toggleTaskSchedulerPanel = () => {
  taskSchedulerPanelVisible.value = !taskSchedulerPanelVisible.value
}

// 启动 OCR 截图识别
const startOcrScreenshot = () => {
  ocrScreenshotRef.value?.startCapture?.()
}
// 侧边栏当前宽度（像素）：复习/标签模式加宽以容纳完整布局
const sidebarWidthPx = computed(() => {
  if (!sidebarExpanded.value) return '0px'
  return (viewMode.value === 'review' || viewMode.value === 'tag') ? '400px' : '300px'
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

// AI 面板折叠状态（启动时默认收起，可通过右侧按钮展开）
const aiPanelExpanded = ref(false)
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

// 联网搜索开关（默认开启，不显示按钮）
const webSearchEnabled = ref(true)

// 日志面板
const logPanelVisible = ref(false)
const logRefreshSignal = ref(0)
// 当前对话 ID，用于日志面板按对话筛选
const currentConversationId = ref('')

// 计算属性：当前文件名
const currentFileName = computed(() => {
  // 文档视图打开时显示当前文档文件名（否则显示思维导图文件名/未保存）
  if (showDocViewer.value && activeDocFile.value.fileName) {
    return activeDocFile.value.fileName
  }
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

// 视图切换：大纲/思维导图/关联图 = 切换当前 pane 视图；标签/复习 = 侧边栏模式
const switchView = (mode) => {
  if (mode === 'mindmap' || mode === 'outline' || mode === 'graph') {
    let pane = activePane.value
    if (!pane || pane.fileType !== 'mindmap') {
      if (!activeFileId.value) {
        ElMessage.info('请先打开一个思维导图文件')
        return
      }
      openFileToPane('mindmap', activeFileId.value, '', activeFileId.value.split('/').pop() || '未命名')
      pane = activePane.value
    }
    if (pane && pane.fileType === 'mindmap') {
      pane.view = mode === 'outline' ? 'outline' : (mode === 'graph' ? 'graph' : 'map')
    }
    viewMode.value = mode
    if (mode === 'outline') {
      nextTick(() => { outlineViewRef.value?.refresh?.() })
    }
    return
  }
  if (viewMode.value === mode) return
  viewMode.value = mode
  if (mode === 'review') {
    checkOrphanReviewItems()
  }
  if (mode === 'tag') {
    nextTick(() => {
      tagViewRef.value?.refresh?.()
      checkOrphanTags()
    })
  }
}

// 回到「文件目录」视图（显示目录树）：从标签/复习模式切回，不强制要求已打开思维导图文件
const switchToFileTree = () => {
  if (viewMode.value === 'mindmap' || viewMode.value === 'outline' || viewMode.value === 'graph') return
  const pane = activePane.value
  if (pane && pane.fileType === 'mindmap') {
    viewMode.value = pane.view === 'outline' ? 'outline' : pane.view === 'graph' ? 'graph' : 'mindmap'
  } else {
    viewMode.value = 'mindmap'
  }
}

// 关联图点击节点 → 切回导图视图并定位闪烁该节点
const onGraphLocateNode = (nodeUid) => {
  if (!nodeUid) return
  switchView('mindmap')
  showDocViewer.value = false
  locateAndBlinkNode(nodeUid, { delay: 300, keepView: false })
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

// 某 pane 的全屏状态变化：让 pane 本身铺满整屏并置顶，解决浮动/分屏层叠上下文限制问题
const onPaneFullscreenChange = (pane, v, type) => {
  if (!pane) return
  pane.fullscreen = !!v
  if (type === 'mindmap') onMindMapFullscreenChange(v)
  else onOutlineFullscreenChange(v)
}

// 全局全屏切换：操作当前激活的 pane
const toggleActivePaneFullscreen = () => {
  const p = activePane.value
  if (!p) return
  const next = !p.fullscreen
  p.fullscreen = next
  if (p.fileType === 'mindmap') {
    onMindMapFullscreenChange(next)
    const editor = editorRefs[p.id]
    if (editor?.setFullscreen) editor.setFullscreen(next)
  } else if (p.view === 'outline') {
    onOutlineFullscreenChange(next)
    const ov = outlineViewRefs[p.id]
    if (ov?.setFullscreen) ov.setFullscreen(next)
  }
}

// 全局固定工具栏：节点备注事件
const onToolbarNodeNote = (nodes) => {
  const p = activePane.value
  if (!p || p.fileType !== 'mindmap') return
  const editor = editorRefs[p.id]
  if (editor?.onNodeNote) {
    editor.onNodeNote(nodes)
  } else if (editor?.openNoteDialog) {
    editor.openNoteDialog(nodes)
  }
}

// 切换到思维导图模式
const switchToMindMapView = () => {
  switchView('mindmap')
}

// 切换到大纲模式
const switchToOutlineView = () => {
  switchView('outline')
}

// 切换关联图视图
const toggleGraphView = () => {
  const p = activePane.value
  if (p && p.fileType === 'mindmap' && p.view === 'graph') {
    switchView('mindmap')  // 从关联图切回思维导图
  } else {
    switchView('graph')
  }
}

// 数据变化回调（fileId 由编辑器上报，多窗口下据此按文件独立跟踪脏标记）
const onDataChange = (data, fileId) => {
  const fid = fileId || activeFileId.value
  mindMapData.value = data
  if (fid) {
    const tab = tabs.value.find(t => t.fileId === fid)
    if (tab) tab.data = data
  }
  scheduleAutoSave(fid)
}

// 节点激活回调（分屏模式下区分不同 pane）
const onNodeActive = (pane, node, activeNodeList) => {
  activeNode.value = node
  if (pane && pane.id) {
    paneActiveNodes[pane.id] = activeNodeList || []
  }
}

// 树渲染结束回调
const onNodeTreeRenderEnd = () => {
  // 同步所有已挂载编辑器实例到 mindMapInstances（供大纲窗口绑定）
  for (const pid of Object.keys(editorRefs)) {
    const inst = editorRefs[pid]?.getMindMap?.()
    if (inst) mindMapInstances[pid] = inst
  }
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
      // 分屏模式下不自动打开新文件（避免替换当前 pane 破坏分屏布局），单 pane 时才打开查看
      if (!isMultiPane.value) {
        if (fileTreeRef.value && fileTreeRef.value.openFileByPath) {
          fileTreeRef.value.openFileByPath(filePath)
        } else {
          currentFilePath.value = filePath
        }
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
    // 清理该文件的复习计划与标签（删除后残留会指向不存在的文件）
    try { removeOrphanReviewItems() } catch (e) {}
    try { getTagsByFilePath(filePath).length && removeTagsByFilePath(filePath) } catch (e) {}
    // 文件已删除：清除其脏标记，避免关闭窗口时把已删除文件重新写回磁盘
    markClean(null, fid)
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

// AI 快捷功能触发时确保 AI 面板可见：
// 统一打开右下角悬浮球悬浮对话窗（floating-chat），不展开右侧侧栏，
// 避免挤占画布；全屏时全屏层(z-index 5000)会盖住侧栏，悬浮窗 z-index 6000 仍可见
const ensureAiPanelVisible = () => {
  aiPanelExpanded.value = false
  floatingChatVisible.value = true
}

const handleAiContinue = (nodes) => {
  ensureAiPanelVisible()
  if (chatPanelRef.value && chatPanelRef.value.aiContinue) {
    chatPanelRef.value.aiContinue(nodes)
  }
}

// AI 新增子节点：由 AI 询问层级/资料后调用 add_child_nodes 工具一次生成
const handleAiAddChild = (nodes) => {
  ensureAiPanelVisible()
  if (chatPanelRef.value && chatPanelRef.value.aiAddChild) {
    chatPanelRef.value.aiAddChild(nodes)
  }
}

const handleAiRewrite = (nodes) => {
  ensureAiPanelVisible()
  if (chatPanelRef.value && chatPanelRef.value.aiRewrite) {
    chatPanelRef.value.aiRewrite(nodes)
  }
}

const handleAiCloze = (nodes) => {
  ensureAiPanelVisible()
  if (chatPanelRef.value && chatPanelRef.value.aiCloze) {
    chatPanelRef.value.aiCloze(nodes)
  }
}

const handleAiClozeFullMap = () => {
  ensureAiPanelVisible()
  if (chatPanelRef.value && chatPanelRef.value.aiCloze) {
    chatPanelRef.value.aiCloze([], { scope: 'root' })
  }
}

const handleAiRewriteFullMap = () => {
  ensureAiPanelVisible()
  if (chatPanelRef.value && chatPanelRef.value.aiRewriteFullMap) {
    chatPanelRef.value.aiRewriteFullMap()
  }
}

const handleReorganizeMindmap = () => {
  ensureAiPanelVisible()
  if (chatPanelRef.value && chatPanelRef.value.reorganizeMindmap) {
    chatPanelRef.value.reorganizeMindmap()
  }
}


const handleAiQuiz = (nodes) => {
  ensureAiPanelVisible()
  if (chatPanelRef.value && chatPanelRef.value.aiQuiz) {
    chatPanelRef.value.aiQuiz(nodes)
  }
}

const handleAiAddToChat = (nodes) => {
  ensureAiPanelVisible()
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

/* ============================================================
 * 添加标签（节点右键 / 文档右键 / 文件树右键 共用入口）
 * ============================================================ */

const addTagDialogVisible = ref(false)
const addTagForm = ref({ tag: '', note: '' })
// 待添加标签的目标信息：{ filePath, fileName, fileType, nodeUid, nodeText, page, scrollTop, locationText }
const addTagTarget = ref({})
// 悬浮窗定位：默认居中偏上，可传入 pos 跟随触发点
const addTagPopoverPos = ref(null)
const addTagNameInputRef = ref(null)

const addTagPopoverStyle = computed(() => {
  if (addTagPopoverPos.value) {
    const { x, y } = addTagPopoverPos.value
    // 悬浮窗尺寸约 340×220，超出视口时回退到安全区
    const vw = window.innerWidth
    const vh = window.innerHeight
    const left = Math.min(Math.max(8, x - 170), vw - 356)
    const top = Math.min(Math.max(8, y + 12), vh - 240)
    return { left: left + 'px', top: top + 'px' }
  }
  return { left: '50%', top: '22%', transform: 'translateX(-50%)' }
})

// 打开添加标签悬浮窗（统一入口，供节点/文档/文件树调用）
const openAddTagDialog = (target, pos) => {
  addTagTarget.value = target || {}
  addTagForm.value = { tag: '', note: '' }
  addTagPopoverPos.value = pos || null
  addTagDialogVisible.value = true
  nextTick(() => addTagNameInputRef.value?.focus())
}

// 点击外部关闭悬浮窗
const onAddTagGlobalMouseDown = (e) => {
  if (!addTagDialogVisible.value) return
  if (e.target.closest && e.target.closest('.add-tag-popover')) return
  addTagDialogVisible.value = false
}
onMounted(() => document.addEventListener('mousedown', onAddTagGlobalMouseDown, true))
onBeforeUnmount(() => document.removeEventListener('mousedown', onAddTagGlobalMouseDown, true))

// 确认添加标签
const confirmAddTag = () => {
  const tag = addTagForm.value.tag.trim()
  if (!tag) {
    ElMessage.warning('请输入标签名')
    return
  }
  const t = addTagTarget.value || {}
  const item = addTag({
    tag,
    note: addTagForm.value.note,
    filePath: t.filePath,
    fileName: t.fileName,
    fileType: t.fileType || 'doc',
    nodeUid: t.nodeUid || '',
    nodeText: t.nodeText || '',
    page: t.page,
    scrollTop: t.scrollTop
  })
  if (!item) {
    ElMessage.info('该位置已有标签，无需重复添加')
    addTagDialogVisible.value = false
    return
  }
  addTagDialogVisible.value = false
  ElMessage.success('已添加标签')
  // 标签模式已挂载则刷新
  tagViewRef.value?.refresh?.()
}

// 节点添加标签（右键菜单）：为节点/选中节点打标签，定位到节点
const handleAddTag = (nodes) => {
  const nodeArr = Array.isArray(nodes) ? nodes : [nodes]
  const validNodes = nodeArr.filter(Boolean)
  if (validNodes.length === 0) return
  const node = validNodes[0]
  const nodeUid = node?.data?.uid || node?.uid || node?.getData?.('uid') || ''
  const nodeText = extractNodeText(node)
  let fileName = ''
  if (currentFilePath.value) {
    const parts = currentFilePath.value.split(/[\\/]/)
    fileName = parts[parts.length - 1] || ''
  }
  openAddTagDialog({
    filePath: currentFilePath.value,
    fileName,
    fileType: 'smm',
    nodeUid,
    nodeText,
    locationText: '节点：' + (nodeText || '未命名节点')
  })
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

      // 节点引用：定位并闪烁目标节点；文件引用（无 nodeUid）：定位并闪烁根节点
      if (nodeUid) {
        locateAndBlinkNode(nodeUid, { delay: 400 })
      } else {
        const rootUid = data?.root?.data?.uid || data?.data?.uid || ''
        locateAndBlinkNode(rootUid, { delay: 400, subtree: false })
      }
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
          hasFile.value = true
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
  // 先退出文档视图，露出导图，否则打开文档时导图被遮挡、定位闪烁不可见
  showDocViewer.value = false
  locateAndBlinkNode(nodeUid, { delay: 400, keepView: true })
}

/* ============================================================
 * 标签模式：点击标签跳转到对应文件对应位置
 * - 思维导图节点标签：加载文件 + 定位闪烁节点（复用复习导航逻辑）
 * - 文档标签：打开文档视图，PDF 跳到指定页，其他文档跳到滚动位置
 * ============================================================ */
const handleTagNavigate = async (item) => {
  if (!item || !item.filePath) return

  // 思维导图节点级标签
  if (item.nodeUid) {
    if (item.filePath !== currentFilePath.value) {
      try {
        await flushAutoSave()
        if (window.electronAPI && window.electronAPI.openFile) {
          const result = await window.electronAPI.openFile(item.filePath)
          if (result && result.success && result.data) {
            currentFilePath.value = item.filePath
            currentFileIsImported.value = false
            mindMapData.value = result.data
            hasFile.value = true
            markClean(result.data)
            syncActiveTab(item.filePath, result.data, false)
            if (editorRef.value) {
              editorRef.value.setData(result.data)
            }
            showDocViewer.value = false
          }
        }
      } catch (e) {
        console.error('加载标签文件失败:', e)
      }
    } else {
      // 同一导图：退出文档视图，露出导图以便定位闪烁
      showDocViewer.value = false
    }
    // 定位并闪烁节点（保留在标签模式）
    locateAndBlinkNode(item.nodeUid, { delay: 400, keepView: true })
    return
  }

  // 文件级标签（从文件树添加，无节点/页码定位）：按扩展名判断打开导图还是文档
  const ext = String(item.filePath || '').split('.').pop().toLowerCase()
  const docExts = ['pdf', 'docx', 'xlsx', 'xls', 'csv', 'tsv', 'txt', 'md', 'markdown', 'json', 'log', 'html', 'xml']
  if (item.fileType === 'file' && !docExts.includes(ext)) {
    // 导图文件（.smm 等）：走导图打开流程
    try {
      await flushAutoSave()
      const result = await window.electronAPI?.openFile?.(item.filePath)
      if (result && result.success && result.data) {
        currentFilePath.value = item.filePath
        currentFileIsImported.value = false
        mindMapData.value = result.data
        hasFile.value = true
        markClean(result.data)
        syncActiveTab(item.filePath, result.data, false)
        if (editorRef.value) editorRef.value.setData(result.data)
        showDocViewer.value = false
      }
    } catch (e) {
      console.error('打开标签导图文件失败:', e)
    }
    return
  }

  // 文档标签：打开文档 pane 并定位
  try {
    const name = item.fileName || item.filePath.split(/[\\/]/).pop() || '未命名'
    if (!docTabs.value.some(t => t.filePath === item.filePath)) {
      docTabs.value.push({ filePath: item.filePath, fileName: name })
    }
    openFileToPane('doc', '', item.filePath, name)
    // 等文档 pane 挂载后定位（PDF 页码 / 其他文档滚动位置）
    nextTick(() => {
      setTimeout(() => {
        docViewerRef.value?.jumpTo?.({
          page: item.page,
          scrollTop: item.scrollTop
        })
      }, 300)
    })
  } catch (e) {
    console.error('打开标签文档失败:', e)
  }
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
  if (!mindMap) return

  // 为每个节点创建 fixed 定位的闪烁框。
  // 复用图片缩放把手的定位思路：用 getBoundingClientRect() 拿屏幕坐标（含节点
  // translate 与画布缩放/平移），避免 SVG getBBox() 缺 translate 偏移导致框错位。
  for (const node of nodes) {
    const groupEl = node.group
    if (!groupEl) continue
    let rect
    try {
      rect = groupEl.node.getBoundingClientRect()
    } catch (e) {
      continue
    }
    if (!rect || (rect.width === 0 && rect.height === 0)) continue

    const el = document.createElement('div')
    el.style.cssText = [
      'position: fixed',
      `left: ${rect.left - 6}px`,
      `top: ${rect.top - 6}px`,
      `width: ${rect.width + 12}px`,
      `height: ${rect.height + 12}px`,
      'border: 3px solid #ff9500',
      'border-radius: 8px',
      'pointer-events: none',
      'z-index: 6001',
      'box-shadow: 0 0 12px rgba(255, 149, 0, 0.65)',
      'opacity: 0'
    ].join(';')
    document.body.appendChild(el)
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
      blinkElements.forEach(el => {
        if (el && el.remove) el.remove()
      })
      blinkElements = []
      return
    }
    // 交替显示/隐藏
    const opacity = blinkCount % 2 === 0 ? 1 : 0
    blinkElements.forEach(el => {
      el.style.opacity = opacity
    })
    blinkCount++
  }, 250)
}

/**
 * 定位并高亮闪烁指定节点（搜索结果 / 引用打开 / 复习导航共用）
 * 文件加载与树渲染均为异步，固定延时会因竞态找不到节点或拿到已失效的节点实例：
 * 这里轮询等待（最多 15 次 × 200ms），直到节点已渲染（group 已挂载）才执行定位与闪烁
 */
const locateAndBlinkNode = (nodeUid, { delay = 300, keepView = false, subtree = true } = {}) => {
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
          if (subtree && n.children && n.children.length > 0) {
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
  // [分屏] 打开到分屏 pane（一个界面一个导图）
  openFileToPane('mindmap', fid, '', fileName || fid.split('/').pop() || '未命名')
}

// [多实例] 切换激活 Tab：点 Tab 栏触发，聚焦对应 pane（或打开到激活 pane）
const switchTab = (fileId) => {
  const tab = tabs.value.find(t => t.fileId === fileId)
  if (!tab) return
  openFileToPane('mindmap', fileId, '', tab.fileName || fileId.split('/').pop() || '未命名')
  // 切换 Tab 后刷新大纲
  nextTick(() => {
    nextTick(() => {
      outlineViewRef.value?.refresh?.()
    })
  })
}

// 根据 kind + id 构造标签渲染项（思维导图 map / 文档 doc）
const buildTabItem = (kind, id) => {
  if (kind === 'map') {
    const tab = tabs.value.find(t => t.fileId === id)
    if (!tab) return null
    return {
      key: 'map:' + id,
      name: tab.fileName || (tab.fileId ? tab.fileId.split('/').pop() : '') || '未命名',
      title: tab.fileId,
      active: tab.fileId === activeFileId.value,
      onClick: () => switchTab(tab.fileId),
      onClose: () => closeTab(tab.fileId)
    }
  }
  const doc = docTabs.value.find(d => d.filePath === id)
  if (!doc) return null
  return {
    key: 'doc:' + id,
    name: doc.fileName,
    title: doc.filePath,
    active: doc.filePath === activeDocFilePath.value,
    onClick: () => switchDocTab(doc.filePath),
    onClose: () => closeDocTab(doc.filePath)
  }
}

// 统一标签渲染列表：按 tabOrder 顺序输出，新增标签（不在 order 里）追加到末尾
const orderedTabs = computed(() => {
  const list = []
  const seen = new Set()
  for (const o of tabOrder.value) {
    const item = buildTabItem(o.kind, o.id)
    if (item && !seen.has(item.key)) { list.push(item); seen.add(item.key) }
  }
  for (const tab of tabs.value) {
    const key = 'map:' + tab.fileId
    if (!seen.has(key)) { const item = buildTabItem('map', tab.fileId); if (item) { list.push(item); seen.add(key) } }
  }
  for (const doc of docTabs.value) {
    const key = 'doc:' + doc.filePath
    if (!seen.has(key)) { const item = buildTabItem('doc', doc.filePath); if (item) { list.push(item); seen.add(key) } }
  }
  return list
})

// 同步 tabOrder：保留已有顺序，移除已关闭标签，追加新增标签（幂等，拖拽 drop 时调用）
const syncTabOrder = () => {
  const result = []
  const seen = new Set()
  for (const o of tabOrder.value) {
    const key = o.kind + ':' + o.id
    if (seen.has(key)) continue
    if (o.kind === 'map') {
      if (tabs.value.some(t => t.fileId === o.id)) { result.push(o); seen.add(key) }
    } else if (docTabs.value.some(d => d.filePath === o.id)) {
      result.push(o); seen.add(key)
    }
  }
  for (const t of tabs.value) {
    const key = 'map:' + t.fileId
    if (!seen.has(key)) { result.push({ kind: 'map', id: t.fileId }); seen.add(key) }
  }
  for (const d of docTabs.value) {
    const key = 'doc:' + d.filePath
    if (!seen.has(key)) { result.push({ kind: 'doc', id: d.filePath }); seen.add(key) }
  }
  tabOrder.value = result
}

// [统一] 标签拖拽排序：思维导图标签与文档标签共用一套顺序，可自由跨组调序
const onAnyTabDragStart = (e, key) => {
  dragTabKey.value = key
  e.dataTransfer.setData('text/plain', key)
  e.dataTransfer.effectAllowed = 'move'
}
const onAnyTabDragOver = (e, key) => {
  if (!dragTabKey.value || dragTabKey.value === key) return
  dragOverTabKey.value = key
}
const onAnyTabDragLeave = (key) => {
  if (dragOverTabKey.value === key) dragOverTabKey.value = ''
}
const onAnyTabDrop = (e, key) => {
  dragOverTabKey.value = ''
  const fromKey = dragTabKey.value
  dragTabKey.value = ''
  if (!fromKey || fromKey === key) return
  syncTabOrder()
  const fromIdx = tabOrder.value.findIndex(o => (o.kind + ':' + o.id) === fromKey)
  const toIdx = tabOrder.value.findIndex(o => (o.kind + ':' + o.id) === key)
  if (fromIdx < 0 || toIdx < 0) return
  const [moved] = tabOrder.value.splice(fromIdx, 1)
  tabOrder.value.splice(toIdx, 0, moved)
}

// 拖拽结束统一清理（无论 drop 到标签栏还是画布）
const onAnyTabDragEnd = () => {
  dragTabKey.value = ''
  dragOverTabKey.value = ''
}

// [多实例] 关闭 Tab：联动关闭对应导图 pane（由 closePane 统一处理标签移除与折叠）
const closeTab = (fileId) => {
  const pane = findPaneByFile(layoutRoot.value, 'mindmap', fileId)
  if (pane) {
    closePane(pane.id)
    return
  }
  // 兜底：无 pane（理论上不会发生）直接移除标签
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
  } else {
    activeFileId.value = ''
    currentFilePath.value = ''
    currentFileIsImported.value = false
    hasFile.value = false
    mindMapData.value = { data: { text: '<p><span>中心主题</span></p>', uid: 'root-' + Date.now(), richText: true }, children: [] }
  }
  nextTick(() => {
    nextTick(() => {
      outlineViewRef.value?.refresh?.()
    })
  })
}

// [多实例] 同步 activeFileId 到目标文件并确保 Tab 存在、更新初始数据。
// 用于"更新当前 Tab 数据"场景（引用跳转/返回原导图/复习导航/打开对话框/保存后重载）。
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
  // [分屏] 打开到分屏 pane（一个界面一个导图）
  const tab = tabs.value.find(t => t.fileId === fid)
  openFileToPane('mindmap', fid, '', (tab && tab.fileName) || fid.split('/').pop() || '未命名')
}

// 激活 Tab 切换时同步 mindMapInstance 指向当前 Tab 的实例
// （ReviewView/OutlineView/快捷键等依赖 mindMapInstance，切 Tab 后须指向新 Tab）
watch(activeFileId, () => {
  nextTick(() => {
    const inst = editorRef.value?.getMindMap?.() || null
    if (inst !== mindMapInstance.value) {
      mindMapInstance.value = inst
    }
    // 切换 Tab 后主动刷新大纲（mindMap 实例可能需要额外 nextTick 才就绪）
    nextTick(() => {
      outlineViewRef.value?.refresh?.()
    })
  })
})

// 文件树打开文件回调
const onTreeOpenDoc = ({ filePath, fileName }) => {
  const name = fileName || filePath.split(/[\\/]/).pop() || '未命名'
  // 加入文档标签（去重）
  if (!docTabs.value.some(t => t.filePath === filePath)) {
    docTabs.value.push({ filePath, fileName: name })
  }
  // [分屏] 打开到分屏 pane
  openFileToPane('doc', '', filePath, name)
}

// 切换文档标签
const switchDocTab = (filePath) => {
  const d = docTabs.value.find(t => t.filePath === filePath)
  openFileToPane('doc', '', filePath, d ? d.fileName : (filePath.split(/[\\/]/).pop() || '未命名'))
}

// 关闭文档标签：联动关闭对应文档 pane
const closeDocTab = (filePath) => {
  const pane = findPaneByFile(layoutRoot.value, 'doc', filePath)
  if (pane) {
    closePane(pane.id)
    return
  }
  docTabs.value = docTabs.value.filter(t => t.filePath !== filePath)
  if (activeDocFilePath.value === filePath) {
    if (docTabs.value.length > 0) {
      activeDocFilePath.value = docTabs.value[docTabs.value.length - 1].filePath
    } else {
      activeDocFilePath.value = ''
      showDocViewer.value = false
    }
  }
}

// 关闭当前文档视图（关闭按钮），回到思维导图/大纲视图
const onDocClose = () => {
  closeDocTab(activeDocFilePath.value)
}

// 文档右键「添加标签」：记录当前位置（页码/滚动位置）后弹窗输入
const onDocAddTag = ({ filePath, fileName, fileType, page, scrollTop, pos }) => {
  if (!filePath) return
  let locationText = '文档'
  if (page != null) locationText = `第 ${page} 页`
  else if (scrollTop != null) locationText = '文档当前位置'
  openAddTagDialog({
    filePath,
    fileName,
    fileType: fileType || 'doc',
    page,
    scrollTop,
    locationText
  }, pos)
}

// 文档右键「添加到 AI 助手对话框」：把选中的文字作为引用参考资料原子对象加入 AI 输入框
const onDocAddToChat = ({ text, fileName, filePath }) => {
  const clean = String(text || '').trim()
  if (!clean) return
  ensureAiPanelVisible()
  if (chatPanelRef.value && chatPanelRef.value.addTextToInput) {
    chatPanelRef.value.addTextToInput(clean, fileName || (filePath ? filePath.split(/[\\/]/).pop() : '文档'))
  }
}

// 文件树右键「添加标签」：文件级标签（打开文件即可，无节点/页码定位）
const onFileTreeAddTag = ({ filePath, fileName, fileType, pos }) => {
  if (!filePath) return
  openAddTagDialog({
    filePath,
    fileName,
    fileType: fileType || 'file',
    locationText: '文件：' + (fileName || '未命名')
  }, pos)
}

// 文档右键「AI 转换为思维导图」：原子对象显示，内部直接读文件 + AI 语义整理 + 生成新 .smm。
// 不关闭文档窗口、不改变当前分屏布局、不生成中间 MD 文件，只在 AI 面板展示进度。
const onDocConvertMindmap = async ({ filePath, fileName }) => {
  if (!filePath) return
  // 文件大小检查：超过 20MB 直接拒绝，避免超大文件解析与上下文爆满
  try {
    const st = await window.electronAPI?.fs?.stat?.(filePath)
    if (st?.success && st.size > 20 * 1024 * 1024) {
      ElMessage.error('文件过大（超过 20MB），请压缩后重试')
      return
    }
  } catch { /* 无法 stat 时继续，交给后续读取步骤报错 */ }
  // 展开 AI 面板让用户看到转换进度（不影响分屏布局）
  ensureAiPanelVisible()
  try {
    await chatPanelRef.value?.convertDocToMindmap(filePath, fileName)
  } catch (e) {
    ElMessage.error('AI 转换启动失败：' + (e?.message || e))
  }
}

const onTreeOpenFile = async ({ filePath, fileName, data, isMarkdown, isXmind, skipAutoSave }) => {
  if (!data) {
    // 关闭当前文件（文件/所在目录被删除等场景）：
    // 必须先于 flushAutoSave 判断，且不再回存——否则会在已删除的路径下重建文件
    markClean(null, normalizeFileId(filePath))
    closeTab(normalizeFileId(filePath))
    return
  }
  // 切换前先落盘当前文件的待保存修改（防抖窗口内的编辑不能随切换丢失）
  // 保存失败不应阻塞打开新文件：捕获异常继续执行，避免“点击文件无反应”
  // skipAutoSave（版本恢复场景）：跳过自动保存，避免把内存中的未保存修改写回、覆盖刚恢复的版本
  if (!skipAutoSave) {
    try { await flushAutoSave() } catch (e) { console.error('切换前自动保存失败（已忽略，继续打开）:', e) }
  }
  // 主动切换文件时清空引用跳转历史（新的导航上下文）
  if (filePath !== currentFilePath.value) {
    refNavigationStack.value = []
  }
  let fileData = data
  if (isMarkdown && typeof data === 'string') {
    const { parseMarkdownToTree } = await import('./utils/markdownParser')
    fileData = parseMarkdownToTree(data)
  }
  markClean(fileData, normalizeFileId(filePath))
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
  // 同步复习计划与标签中的路径，避免文件被误判为已删除而清掉任务/标签
  remapReviewPaths(oldPath, newPath)
  remapTagPaths(oldPath, newPath)
  if (!oldPath || !newPath) return
  const sep = oldPath.includes('\\') ? '\\' : '/'
  const normOld = normalizeFileId(oldPath)
  const normNew = normalizeFileId(newPath)

  // 同步更新 tabs 数组中匹配的 fileId 和 fileName
  tabs.value.forEach(tab => {
    const tabFid = tab.fileId
    if (tabFid === normOld) {
      tab.fileId = normNew
      tab.fileName = normNew.split('/').pop() || tab.fileName
    } else if (tabFid.startsWith(normOld + '/')) {
      tab.fileId = normNew + tabFid.slice(normOld.length)
    }
  })

  // 同步更新 activeFileId
  if (activeFileId.value === normOld) {
    activeFileId.value = normNew
  } else if (activeFileId.value.startsWith(normOld + '/')) {
    activeFileId.value = normNew + activeFileId.value.slice(normOld.length)
  }

  // [分屏] 同步更新 pane 内的 fileId / filePath
  collectPanes(layoutRoot.value).forEach(w => {
    if (w.fileType === 'doc') {
      if (w.filePath === oldPath) {
        w.filePath = newPath
        w.title = newPath.split(/[\\/]/).pop() || w.title
      } else if (w.filePath.startsWith(oldPath + sep)) {
        w.filePath = newPath + w.filePath.slice(oldPath.length)
      }
    } else if (w.fileId === normOld) {
      w.fileId = normNew
    } else if (w.fileId.startsWith(normOld + '/')) {
      w.fileId = normNew + w.fileId.slice(normOld.length)
    }
  })

  // 同步更新 currentFilePath
  const cur = currentFilePath.value
  if (cur) {
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
  if (!srcPath || !destDir) return
  const sep = destDir.includes('\\') ? '\\' : '/'
  const fileName = srcPath.split(/[\\/]/).pop()
  const newPath = destDir + sep + fileName
  // 移动的是文件还是目录未知：按目录前缀重映射可同时覆盖两种情况（复习计划/标签路径同步）
  remapReviewPaths(srcPath, newPath)
  remapTagPaths(srcPath, newPath)

  const normSrc = normalizeFileId(srcPath)
  const normDest = normalizeFileId(destDir)

  // 同步更新 tabs 数组中匹配的 fileId 和 fileName
  tabs.value.forEach(tab => {
    const tabFid = tab.fileId
    if (tabFid === normSrc) {
      tab.fileId = normalizeFileId(newPath)
      tab.fileName = fileName || tab.fileName
    } else if (tabFid.startsWith(normSrc + '/')) {
      tab.fileId = normalizeFileId(destDir + sep + tabFid.slice(normSrc.length + 1))
    }
  })

  // 同步更新 activeFileId
  if (activeFileId.value === normSrc) {
    activeFileId.value = normalizeFileId(newPath)
  } else if (activeFileId.value.startsWith(normSrc + '/')) {
    activeFileId.value = normalizeFileId(destDir + sep + activeFileId.value.slice(normSrc.length + 1))
  }

  // [分屏] 同步更新 pane 内的 fileId / filePath
  collectPanes(layoutRoot.value).forEach(w => {
    if (w.fileType === 'doc') {
      if (w.filePath === srcPath) {
        w.filePath = newPath
        w.title = fileName || w.title
      } else if (w.filePath.startsWith(srcPath + '\\') || w.filePath.startsWith(srcPath + '/')) {
        w.filePath = destDir + sep + w.filePath.slice(srcPath.length + 1)
      }
    } else if (w.fileId === normSrc) {
      w.fileId = normalizeFileId(newPath)
    } else if (w.fileId.startsWith(normSrc + '/')) {
      w.fileId = normalizeFileId(destDir + sep + w.fileId.slice(normSrc.length + 1))
    }
  })

  // 同步更新 currentFilePath
  const cur = currentFilePath.value
  if (cur) {
    let next = null
    if (cur === srcPath) {
      next = newPath
    } else if (cur.startsWith(srcPath + '\\') || cur.startsWith(srcPath + '/')) {
      next = destDir + sep + cur.slice(srcPath.length + 1)
    }
    if (next && next !== cur) {
      currentFilePath.value = next
      hasFile.value = true
    }
  }
}

// 搜索结果点击打开文件（若命中具体节点，定位并高亮闪烁）
const onSearchOpenFile = async ({ filePath, nodeUid, fileType, isTag, page, scrollTop }) => {
  // 标签结果：跳转到标签对应位置（节点/页码/滚动位置）
  if (isTag) {
    handleTagNavigate({ filePath, nodeUid, page, scrollTop })
    return
  }
  // 文档类结果（PDF/Word/Excel/CSV/MD/TXT 等知识库索引的文档）用文档查看器打开；
  // 思维导图节点命中保持原逻辑：加载文件并定位闪烁节点
  const ext = String(filePath || '').split('.').pop().toLowerCase()
  const docExts = ['pdf', 'docx', 'xlsx', 'xls', 'csv', 'tsv', 'txt', 'md', 'markdown', 'log', 'html', 'xml']
  if (fileType === 'doc' || (docExts.includes(ext) && ext !== 'json')) {
    onTreeOpenDoc({ filePath, fileName: String(filePath || '').split(/[\\/]/).pop() || '未命名' })
    return
  }
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
        const filePath = result.filePath || ''
        const fileName = result.fileName || filePath.split(/[\\/]/).pop() || '未命名'
        // Markdown 默认用文档查看器原样阅读（不转 .smm），右键空白处可 AI 转导图
        if (result.isMarkdown) {
          onTreeOpenDoc({ filePath, fileName })
          return
        }
        // 切换前先落盘当前文件的待保存修改
        await flushAutoSave()
        currentFilePath.value = filePath
        hasFile.value = true
        let fileData = result.data
        if (result.isXmind) {
          const { parseXmindBase64 } = await import('./utils/xmindParser')
          fileData = await parseXmindBase64(result.data, result.fileName)
          if (!fileData) return
        }
        // xmind 源文件按导入处理：保存时改存 .smm，不覆盖源文件
        currentFileIsImported.value = !!result.isXmind
        mindMapData.value = fileData
        markClean(fileData)
        // [多实例] 同步 activeFileId 到目标文件并确保 Tab 存在
        syncActiveTab(currentFilePath.value, fileData, !!result.isXmind)
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
    // 先提交当前窗口进行中的文本编辑，避免 Ctrl+S 时编辑中的文字未入库
    try { editorRef.value?.commitEditing?.() } catch (e) { /* 忽略 */ }
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
  // 保存所有脏文件（含各窗口未提交的文本编辑），全部落盘后再刷新
  const saved = await flushAutoSave()
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
let allowClose = false
let allowReload = false
// 每个文件的脏标记与最后保存内容（fileId -> JSON），多窗口各自独立保存，避免漏存/串存
const dirtyFiles = new Set()
const lastSavedJsonMap = {}

// 提交所有编辑器正在进行的文本编辑（多窗口：不能只提交当前聚焦窗口）
const commitAllEditors = () => {
  for (const fid of Object.keys(editorRefs)) {
    try { editorRefs[fid]?.commitEditing?.() } catch (e) { /* 忽略 */ }
  }
}

// 标记指定（默认当前）文件为"已保存"状态：清脏、取消待执行的自动保存
const markClean = (data, fileId) => {
  const fid = fileId || normalizeFileId(currentFilePath.value) || activeFileId.value
  if (fid) {
    try {
      lastSavedJsonMap[fid] = typeof data === 'string' ? data : JSON.stringify(data)
    } catch {
      lastSavedJsonMap[fid] = ''
    }
    dirtyFiles.delete(fid)
    const tab = tabs.value.find(t => t.fileId === fid)
    if (tab && data && typeof data === 'object') tab.data = data
  }
  isDirty.value = dirtyFiles.size > 0
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

// 导入文件（md/xmind）首次保存为 .smm 后，把 fileId 迁移到新路径（标签/窗口/激活态/最后保存键）
const remapImportedFileId = (oldFid, newFid) => {
  if (!oldFid || !newFid || oldFid === newFid) return
  const tab = tabs.value.find(t => t.fileId === oldFid)
  if (tab) {
    tab.fileId = newFid
    tab.isImported = false
    tab.fileName = newFid.split('/').pop() || tab.fileName
  }
  // 更新 pane（fileId 变化会触发编辑器按 key 重建，数据由 tab.data 兜底保持）
  collectPanes(layoutRoot.value).forEach(w => {
    if (w.fileId === oldFid) {
      w.fileId = newFid
      w.title = newFid.split('/').pop() || w.title
    }
  })
  if (lastSavedJsonMap[oldFid] !== undefined) delete lastSavedJsonMap[oldFid]
  if (activeFileId.value === oldFid) activeFileId.value = newFid
  if (normalizeFileId(currentFilePath.value) === oldFid) currentFilePath.value = newFid
}

// 保存单个文件：成功/无需保存返回 true，失败返回 false
const saveFileById = async (fid) => {
  const pane = findPaneByFile(layoutRoot.value, 'mindmap', fid)
  const editor = pane ? editorRefs[pane.id] : null
  const tab = tabs.value.find(t => t.fileId === fid)
  if (!editor && !tab) {
    dirtyFiles.delete(fid)
    return true
  }
  try { editor?.commitEditing?.() } catch (e) { /* 忽略 */ }
  const data = editor?.getData?.() || tab?.data || null
  if (!data) {
    dirtyFiles.delete(fid)
    return true
  }
  let json
  try { json = JSON.stringify(data) } catch { json = null }
  if (json !== null && json === lastSavedJsonMap[fid]) {
    dirtyFiles.delete(fid)
    return true
  }
  if (!(window.electronAPI && window.electronAPI.saveFile)) return false

  let filename = tab?.fileId || fid
  if (tab?.isImported && filename) {
    // md/xmind 源文件不可被 JSON 覆盖：编辑内容改存同目录同名 .smm
    filename = filename.replace(/\.(md|xmind)$/i, '.smm')
  }
  if (!filename) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    filename = `mindmap_${timestamp}.smm`
  }
  const result = await window.electronAPI.saveFile(filename, data, { overwrite: true })
  if (result && result.success) {
    // 导入文件（md/xmind）首次落盘为 .smm：迁移 fileId 到新路径
    const savedPath = result.filePath || filename
    const newFid = normalizeFileId(savedPath)
    dirtyFiles.delete(fid)
    if (tab?.isImported && newFid && newFid !== fid) {
      remapImportedFileId(fid, newFid)
      fid = newFid
      // 刷新文件树，让新生成的 .smm 出现（导入文件首次落盘为 .smm）
      nextTick(() => { fileTreeRef.value?.refreshTree?.() })
    }
    if (json !== null) lastSavedJsonMap[fid] = json
    // 后台更新知识库索引（静默）
    if (searchService.isAvailable()) {
      const fName = savedPath.split(/[\\/]/).pop() || '未命名'
      searchService.indexFile(savedPath, fName, data).catch(() => {})
    }
    return true
  }
  console.error('[自动保存] 失败:', result?.error)
  return false
}

// 静默保存实现：遍历所有脏文件逐个保存
const quietSaveCore = async () => {
  const fids = Array.from(dirtyFiles)
  if (fids.length === 0) {
    isDirty.value = false
    return true
  }
  let allOk = true
  for (const fid of fids) {
    const ok = await saveFileById(fid)
    if (!ok) allOk = false
  }
  isDirty.value = dirtyFiles.size > 0
  return allOk
}

// 数据变化 → 标记当前文件为脏 + 重置防抖计时
const scheduleAutoSave = (fileId) => {
  if (!hasFile.value) {
    dirtyFiles.clear()
    isDirty.value = false
    if (autoSaveTimer) {
      clearTimeout(autoSaveTimer)
      autoSaveTimer = null
    }
    return
  }
  const fid = fileId || activeFileId.value
  if (fid) dirtyFiles.add(fid)
  isDirty.value = dirtyFiles.size > 0
  if (autoSaveTimer) clearTimeout(autoSaveTimer)
  autoSaveTimer = setTimeout(async () => {
    autoSaveTimer = null
    await quietSave()
  }, AUTOSAVE_DELAY)
}

// 立即落盘（切换文件/关闭前调用）；返回 true=无需保存或已保存成功，false=保存失败
const flushAutoSave = async () => {
  try {
    if (document.activeElement && document.activeElement !== document.body) {
      document.activeElement.blur()
    }
  } catch (err) { /* 忽略 */ }
  commitAllEditors()
  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer)
    autoSaveTimer = null
  }
  if (dirtyFiles.size === 0) return true
  return quietSave()
}

// 关闭前保护：有未保存修改时拦截关闭，保存完成后再放行
const onBeforeUnload = (e) => {
  try {
    if (document.activeElement && document.activeElement !== document.body) {
      document.activeElement.blur()
    }
  } catch (err) { /* 忽略 */ }
  commitAllEditors()
  if (allowClose || allowReload || dirtyFiles.size === 0) return
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
const onScheduledTaskTrigger = async (taskId, opts = {}) => {
  if (!taskId) return
  const isManual = !!opts.manual
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
        ElMessage.info(`${isManual ? '手动触发' : '定时任务触发'}: ${task.name}`)
        const timeStr = new Date().toLocaleString('zh-CN', { hour12: false })
        const triggerLabel = isManual ? '手动触发' : '定时任务触发'
        chatPanelRef.value.pushThirdPartyNotice?.('task', `⚡ ${triggerLabel}：${task.name}（${timeStr}）`)
        addPanelLog('task', 'send', `${triggerLabel}任务「${task.name}」，提示词：${task.prompt}`)
        // extLogger：工具调用/结果/错误实时记录到定时端日志
        const taskLogger = (type, content) => {
          const mappedType = type === 'send' ? 'receive' : type
          addPanelLog('task', mappedType, content.length > 500 ? content.slice(0, 500) + '...' : content)
        }
        try {
          const reply = await chatPanelRef.value.processExternalMessage(task.prompt, 'task', taskLogger)
          // 三端隔离：定时任务结果只留在消息中心「定时端」，不再外推微信/飞书
          if (reply && /^AI 正在处理/.test(reply)) {
            ElMessage.warning(`${triggerLabel}任务「${task.name}」未执行：${reply}`)
            addPanelLog('task', 'error', `${triggerLabel}任务「${task.name}」未执行：${reply}`)
          } else {
            ElMessage.success(`${triggerLabel}任务「${task.name}」已完成，结果见消息中心-定时端`)
            addPanelLog('task', 'receive', `${triggerLabel}任务「${task.name}」执行完成，AI 回复：${reply}`)
          }
        } catch (err) {
          console.error('[定时任务] AI 执行失败:', err)
          ElMessage.error(`${triggerLabel}任务 AI 执行失败: ` + err.message)
          addPanelLog('task', 'error', `${triggerLabel}任务「${task.name}」AI 执行失败: ${err.message}`)
        }
      } else if (chatPanelRef.value && chatPanelRef.value.sendDirectMessage) {
        chatPanelRef.value.sendDirectMessage(task.prompt)
      }
    })
  } catch (err) {
    console.error('[定时任务] 触发处理失败:', err)
    ElMessage.error((isManual ? '手动触发' : '定时任务触发') + '失败: ' + err.message)
    addPanelLog('task', 'error', `${isManual ? '手动触发' : '定时任务触发'}处理失败: ${err.message}`)
  }
}

// 焦点上下文判定：返回 'input'（普通输入框）/ 'richtext'（节点编辑框）/ null（画布等）
const getTextEditContext = (e) => {
  const el = e.target
  if (!el || !el.tagName) return null
  const tag = el.tagName.toUpperCase()
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return 'input'
  // 大纲模式下焦点事件 target 常是 contenteditable 内部的子 span，直接判断
  // isContentEditable 会误判为画布，导致 Ctrl+Z/B/I 等被导图命令拦截。
  if (el.isContentEditable || (el.closest && el.closest('[contenteditable="true"]'))) return 'richtext'
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
  // 大纲模式：选中文字时直接作用于大纲 DOM 选区，不再走导图节点/Quill 分支。
  if (viewMode.value === 'outline' && outlineViewRef.value?.isOutlineTextEditing?.()) {
    if (outlineViewRef.value.applyOutlineTextStyleAction?.(action)) {
      ElMessage.success(`已设置${label}`)
    }
    return
  }
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
  // 颜色/高亮/样式支持概要节点（不再排除 isGeneralization）
  const nodes = mm.renderer.activeNodeList || []
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
  // 大纲模式：选中文字时直接作用于大纲 DOM 选区。
  if (viewMode.value === 'outline' && outlineViewRef.value?.isOutlineTextEditing?.()) {
    if (outlineViewRef.value.applyOutlineTextStyleAction?.(action)) {
      ElMessage.success(`已${verb}选中文字`)
    }
    return
  }
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
  // 加粗/斜体/下划线/删除线支持概要节点（不再排除 isGeneralization）
  const nodes = mm.renderer.activeNodeList || []
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

// ========== 全屏节点搜索（Ctrl+F）：思维导图/大纲模式下的节点搜索 ==========
const nodeSearchVisible = ref(false)
const nodeSearchText = ref('')
const nodeSearchCount = ref(0)
const nodeSearchIndex = ref(-1)
const nodeSearchInputRef = ref(null)

const getSearchMindMap = () => mindMapInstance.value || editorRef.value?.getMindMap?.() || null

const openNodeSearch = () => {
  nodeSearchVisible.value = true
  nodeSearchText.value = ''
  nodeSearchCount.value = 0
  nodeSearchIndex.value = -1
  nextTick(() => nodeSearchInputRef.value?.focus())
}

const closeNodeSearch = () => {
  nodeSearchVisible.value = false
  const mm = getSearchMindMap()
  try { mm?.search?.endSearch?.() } catch {}
  nodeSearchCount.value = 0
  nodeSearchIndex.value = -1
}

const doNodeSearch = () => {
  const mm = getSearchMindMap()
  if (!mm?.search) return
  const text = nodeSearchText.value.trim()
  if (!text) {
    try { mm.search.endSearch() } catch {}
    nodeSearchCount.value = 0
    nodeSearchIndex.value = -1
    return
  }
  mm.search.search(text)
  nodeSearchCount.value = (mm.search.matchNodeList && mm.search.matchNodeList.length) || 0
  nodeSearchIndex.value = mm.search.currentIndex ?? -1
}

const nodeSearchNext = () => {
  const mm = getSearchMindMap()
  if (!mm?.search || !nodeSearchCount.value) return
  mm.search.searchNext(() => { nodeSearchIndex.value = mm.search.currentIndex })
}

const nodeSearchPrev = () => {
  const mm = getSearchMindMap()
  if (!mm?.search || !nodeSearchCount.value) return
  let idx = (mm.search.currentIndex ?? 0) - 1
  if (idx < 0) idx = (mm.search.matchNodeList?.length || 1) - 1
  mm.search.jump(idx, () => { nodeSearchIndex.value = mm.search.currentIndex })
}

const handleKeyDown = (e) => {
  const ctrl = e.ctrlKey || e.metaKey

  // Alt+1：截图识别文字（OCR）
  if (e.altKey && !ctrl && e.code === 'Digit1') {
    e.preventDefault()
    startOcrScreenshot()
    return
  }

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

  // Ctrl+U: 下划线;编辑态放行原生富文本下划线,非编辑态(框选多节点)=整个节点内容;普通输入框内不触发
  if (key === 'u' && !e.shiftKey) {
    if (textCtx) return
    e.preventDefault()
    applyToggleStyleShortcut('underline', '下划线', '下划线')
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

  // Ctrl+F: 全屏（思维导图/大纲）下打开节点搜索框；否则聚焦左侧搜索栏
  if (key === 'f') {
    e.preventDefault()
    if (textCtx === 'input') return // 输入框内放行，不抢占节点搜索
    if ((mmFullscreen.value || outlineFullscreen.value) && (viewMode.value === 'mindmap' || viewMode.value === 'outline')) {
      openNodeSearch()
    } else if (searchBarRef.value && searchBarRef.value.focus) {
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

// 检测并清理文件已被删除的孤儿标签
const checkOrphanTags = async () => {
  try {
    const { removeOrphanTags } = await import('./utils/tagStore')
    const orphans = await removeOrphanTags()
    if (orphans.length > 0) {
      ElMessage.warning({
        message: `检测到 ${orphans.length} 个标签对应的文件已被删除，已自动清除`,
        duration: 4000
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
const REVIEW_REMINDER_FIRED_KEY = 'MINDMAP_REVIEW_REMINDER_FIRED' // 持久化当天已推送标记，跨进程重启不重复提醒

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
  try { localStorage.setItem(REVIEW_REMINDER_FIRED_KEY, stamp) } catch { /* 忽略存储失败 */ }
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
  // 启动时恢复「当天已推送」标记，避免同一天重复提醒（跨进程重启持久化）
  try { reviewReminderLastFired = localStorage.getItem(REVIEW_REMINDER_FIRED_KEY) || '' } catch { reviewReminderLastFired = '' }
  checkReviewReminder()
  reviewReminderTimer = setInterval(checkReviewReminder, 30000)
}

onMounted(() => {
  initMindMapInstance()
  loadLayoutTemplates()
  window.addEventListener('keydown', handleKeyDown)
  // 多窗口拖拽/缩放
  window.addEventListener('mousemove', onGlobalMouseMove)
  window.addEventListener('mouseup', onGlobalMouseUp)
  // 关闭前保护：有未落盘修改时先保存再退出
  window.addEventListener('beforeunload', onBeforeUnload)
  // 延迟后台重建搜索索引，不影响启动速度
  setTimeout(() => { rebuildSearchIndex() }, 3000)
  // 启动时检测孤儿复习任务（文件可能在上次关闭期间被外部删除）
  setTimeout(() => { checkOrphanReviewItems() }, 1500)
  // 每日复习定时提醒（30 秒轮询，跨天/修改配置自动生效）
  startReviewReminder()

  // 双击 .smm 文件拉起应用：接收主进程转发的文件路径并打开
  if (window.electronAPI?.onOpenFile) {
    window.electronAPI.onOpenFile((filePath) => {
      if (!filePath) return
      nextTick(() => {
        if (fileTreeRef.value && fileTreeRef.value.openFileByPath) {
          fileTreeRef.value.openFileByPath(filePath)
        } else {
          currentFilePath.value = filePath
        }
      })
    })
  }

  // 注册定时任务触发监听器
  // 当 Windows Task Scheduler 在指定时间启动应用时，main.js 发送 task:scheduledTrigger 事件
  // 此处直接在 App 层监听，确保即使 TaskSchedulerPanel 未打开也能接收触发
  if (taskSchedulerService.isAvailable()) {
    taskSchedulerService.onScheduledTrigger((taskId) => {
      onScheduledTaskTrigger(taskId)
    })
  }

  // 外部 Agent HTTP API：复用 ChatPanel 后台处理，不写入用户对话，也不打断前台
  if (window.electronAPI?.agentApi?.onRequest) {
    window.electronAPI.agentApi.onRequest(async ({ id, message, source }) => {
      try {
        const reply = await chatPanelRef.value?.processExternalMessage(message, source || 'agent')
        window.electronAPI.agentApi.sendResponse(id, reply || '(AI 未返回内容)')
      } catch (err) {
        window.electronAPI.agentApi.sendResponse(id, null, err?.message || 'AI 处理失败')
      }
    })
  }

  // MCP 服务端请求：外部 AI 客户端通过 /mcp 端点列出/调用本程序全部工具
  if (window.electronAPI?.mcpServer?.onRequest) {
    window.electronAPI.mcpServer.onRequest(async ({ id, kind, toolName, args, ctx }) => {
      try {
        if (kind === 'list-tools') {
          const tools = chatPanelRef.value?.listMcpTools?.() || []
          window.electronAPI.mcpServer.sendResponse(id, { ok: true, tools })
        } else if (kind === 'call-tool') {
          const result = await chatPanelRef.value?.callMcpTool?.(toolName, args || {}, ctx || {})
          window.electronAPI.mcpServer.sendResponse(id, { ok: true, result })
        } else {
          window.electronAPI.mcpServer.sendResponse(id, { ok: false, error: `未知请求类型: ${kind}` })
        }
      } catch (err) {
        window.electronAPI.mcpServer.sendResponse(id, { ok: false, error: err?.message || 'MCP 工具执行失败' })
      }
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
  window.removeEventListener('mousemove', onGlobalMouseMove)
  window.removeEventListener('mouseup', onGlobalMouseUp)
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
  height: 26px;
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
  height: 22px;
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

/* AI面板折叠按钮：展开态为紧贴面板左侧的窄条小按钮（透明底、无圆角，仅箭头）；收起态绝对定位浮在屏幕右边缘，不占布局宽度 */
.ai-collapse-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 36px;
  flex-shrink: 0;
  align-self: center;
  background: transparent;
  border: none;
  border-radius: 0;
  cursor: pointer;
  color: var(--text-tertiary);
  transition: color 0.2s ease, transform 0.2s ease, background 0.2s ease;
  z-index: 20;
}

.ai-collapse-btn:hover {
  color: var(--apple-blue);
  background: rgba(0, 0, 0, 0.1);
  transform: translateX(-2px);
}

/* 收起态：绝对定位浮在屏幕右边缘（不占 flex 布局宽度），仅显示箭头图标本身 */
.ai-collapse-btn.collapsed {
  position: absolute;
  right: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 14px;
  height: 36px;
  background: transparent;
  border-radius: 0;
}
.ai-collapse-btn.collapsed:hover {
  background: rgba(0, 0, 0, 0.08);
  transform: translateY(-50%);
  color: var(--apple-blue);
}

.ai-float-ball {
  position: fixed;
  right: 22px;
  bottom: 88px;
  z-index: 700;
  width: 40px;
  height: 40px;
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
.ai-float-ball.in-fullscreen {
  z-index: 6000; /* 高于全屏导图的 z-index: 5000 */
}

.ai-float-ball.active {
  background: var(--apple-blue, #007aff);
  color: #fff;
}

.floating-chat-close {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 670;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.12);
  color: #fff;
  font-size: 15px;
  line-height: 1;
  cursor: pointer;
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
.sidebar.collapsed.wide-mode {
  width: 0;
  border-right: none;
}

.sidebar.wide-mode {
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

.segmented-control.four-segments .segment-indicator {
  width: calc(25% - 1px);
}

.segmented-control.four-segments .segment-btn {
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

.doc-view-area {
  width: 100%;
  height: 100%;
  overflow: hidden;
}

/* ============================================
   多窗口画布（需求2：Obsidian 式分屏布局）
   ============================================ */
.split-pane {
  position: absolute;
  display: flex;
  flex-direction: column;
  background: var(--card-bg, #fff);
  border: 1px solid var(--border-color, rgba(0, 0, 0, 0.08));
  border-radius: 8px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.06);
  overflow: hidden;
  min-width: 0;
  min-height: 0;
  z-index: 1;
}
.split-pane.active {
  border-color: var(--apple-blue, #007aff);
  box-shadow: 0 4px 16px rgba(0, 122, 255, 0.14);
  z-index: 2;
}

.split-pane.fullscreen {
  position: fixed;
  inset: 0;
  z-index: 6000;
  border-radius: 0;
  border: none;
}
.split-pane.fullscreen .pane-titlebar {
  display: none;
}

.pane-titlebar {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 6px 0 12px;
  background: rgba(0, 0, 0, 0.03);
  border-bottom: 1px solid var(--border-color, rgba(0, 0, 0, 0.06));
  user-select: none;
  flex-shrink: 0;
}
.pane-type-badge {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 4px;
  background: rgba(0, 122, 255, 0.12);
  color: var(--apple-blue, #007aff);
  flex-shrink: 0;
}
.pane-title {
  flex: 1;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pane-close {
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--text-tertiary);
  font-size: 15px;
  line-height: 1;
  cursor: pointer;
  flex-shrink: 0;
}
.pane-close:hover {
  background: rgba(255, 59, 48, 0.12);
  color: #ff3b30;
}

/* 关键：pane-body 必须为 flex 容器，否则 MindMapEditor 的 flex:1 会塌缩为 0 高度（空白窗口根因） */
.pane-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  position: relative;
  overflow: hidden;
  min-height: 0;
  min-width: 0;
}

/* 拖拽标签到 pane 边缘时的分屏高亮指示 */
.pane-drop-indicator {
  position: absolute;
  background: rgba(0, 122, 255, 0.14);
  border: 2px dashed var(--apple-blue, #007aff);
  z-index: 30;
  pointer-events: none;
  border-radius: 6px;
}
.pane-drop-indicator.left {
  left: 0; top: 0; width: 50%; height: 100%;
  border-left: none; border-top: none; border-bottom: none;
}
.pane-drop-indicator.right {
  right: 0; top: 0; width: 50%; height: 100%;
  border-right: none; border-top: none; border-bottom: none;
}
.pane-drop-indicator.top {
  left: 0; top: 0; width: 100%; height: 50%;
  border-top: none; border-left: none; border-right: none;
}
.pane-drop-indicator.bottom {
  left: 0; bottom: 0; width: 100%; height: 50%;
  border-bottom: none; border-left: none; border-right: none;
}
/* 拖 pane 标题栏交换位置：整个目标 pane 高亮 */
.pane-drop-indicator.swap {
  left: 4px; top: 4px; right: 4px; bottom: 4px;
  width: auto; height: auto;
  border: 2px dashed var(--apple-blue, #007aff);
  background: rgba(0, 122, 255, 0.08);
}

/* 分割条（拖动调整分屏比例） */
.split-divider {
  position: absolute;
  z-index: 40;
  background: transparent;
}
.split-divider::before {
  content: '';
  position: absolute;
  background: var(--border-color-strong, rgba(0, 0, 0, 0.12));
  transition: background 0.12s ease;
}
.split-divider.vertical {
  cursor: col-resize;
}
.split-divider.vertical::before {
  top: 0; bottom: 0; left: 50%; width: 1px; transform: translateX(-50%);
}
.split-divider.horizontal {
  cursor: row-resize;
}
.split-divider.horizontal::before {
  left: 0; right: 0; top: 50%; height: 1px; transform: translateY(-50%);
}
.split-divider:hover::before,
.split-divider:active::before {
  background: var(--apple-blue, #007aff);
}

/* ============================================
   布局模板弹窗
   ============================================ */
.layout-dialog {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.layout-save-row {
  display: flex;
  gap: 10px;
}
.layout-save-row .el-input {
  flex: 1;
}
.layout-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: 320px;
  overflow-y: auto;
}
.layout-empty {
  text-align: center;
  color: var(--text-tertiary);
  font-size: 13px;
  padding: 24px 0;
}
.layout-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid var(--border-color, rgba(0, 0, 0, 0.06));
  border-radius: 8px;
  background: var(--card-bg, rgba(255, 255, 255, 0.72));
}
.layout-item-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.layout-item-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.layout-item-meta {
  font-size: 12px;
  color: var(--text-secondary);
}
.layout-item-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

/* ============================================
   AI Panel
   ============================================ */
.ai-panel {
  width: var(--ai-panel-width);
  flex-shrink: 0;
  overflow: hidden;
  transition: width 0.15s ease;
}

.ai-panel.collapsed {
  width: 0;
}

.ai-panel.floating-chat {
  position: fixed;
  right: 16px;
  bottom: 80px;
  z-index: 650;
  width: min(280px, calc(100vw - 24px));
  height: min(420px, calc(100vh - 96px));
  border-radius: 18px;
  box-shadow: 0 14px 46px rgba(0, 0, 0, 0.24);
  overflow: hidden;
}

/* 全屏导图/大纲覆盖层 z-index 为 5000，悬浮对话需要比它更高，
   否则点击悬浮球后球消失、对话面板却被盖住，看起来像没有展开 */
.ai-panel.floating-chat.in-fullscreen {
  z-index: 6000;
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

/* ============ 单 pane 模式：隐藏边框和阴影（更简洁） ============ */
.split-pane.single-pane {
  border: none;
  border-radius: 0;
  box-shadow: none;
}

/* ============ 右下角全局按钮组（视图切换 + 全屏，共用一套） ============ */
/* 默认跟随主内容区（absolute），全屏模式下固定到视口（fixed） */
.global-bottom-right-actions {
  position: absolute;
  right: 16px;
  bottom: 16px;
  z-index: 7000;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px;
  background: rgba(255, 255, 255, 0.92);
  border-radius: 10px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.14);
  backdrop-filter: blur(8px);
}

.global-action-btn {
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: #666;
  cursor: pointer;
  transition: background 0.15s, color 0.15s, transform 0.15s;
}
.global-action-btn:hover {
  background: rgba(0, 122, 255, 0.1);
  color: #007aff;
  transform: scale(1.06);
}
.global-action-btn.active {
  background: rgba(0, 122, 255, 0.15);
  color: #007aff;
}

/* 全屏模式下配色加深 + 固定到视口 */
.global-bottom-right-actions.in-fullscreen {
  position: fixed;
  bottom: 16px;
  background: rgba(0, 0, 0, 0.5);
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.3);
}
.global-bottom-right-actions.in-fullscreen .global-action-btn {
  color: #ffffff;
}
.global-bottom-right-actions.in-fullscreen .global-action-btn:hover {
  background: rgba(255, 255, 255, 0.15);
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

/* 标签模式容器：搜索框 + 标签列表 */
.tag-mode-wrapper {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.tag-mode-wrapper .tag-sidebar {
  flex: 1;
  min-height: 0;
}

/* 添加标签悬浮窗 */
.add-tag-popover {
  position: fixed;
  z-index: 3200;
  width: 340px;
  max-width: calc(100vw - 32px);
  background: #fff;
  border: 1px solid rgba(0, 0, 0, 0.1);
  border-radius: 10px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.18);
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.add-tag-pop-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.add-tag-pop-title {
  font-size: 14px;
  font-weight: 600;
  color: #1d1d1f;
}
.add-tag-pop-close {
  border: none;
  background: none;
  color: #999;
  font-size: 13px;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
}
.add-tag-pop-close:hover {
  background: #f2f2f2;
  color: #333;
}
.add-tag-pop-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.add-tag-loc {
  padding: 6px 10px;
  border-radius: 6px;
  background: #f5f7fa;
  color: #606266;
  font-size: 12px;
  word-break: break-all;
}
.add-tag-input {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid #e0e0e6;
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 13px;
  line-height: 1.5;
  color: #333;
  outline: none;
  font-family: inherit;
}
.add-tag-input:focus {
  border-color: #a8bfff;
  box-shadow: 0 0 0 2px rgba(41, 128, 185, 0.12);
}
.add-tag-textarea {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid #e0e0e6;
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 13px;
  line-height: 1.6;
  color: #333;
  outline: none;
  font-family: inherit;
  resize: vertical;
}
.add-tag-textarea:focus {
  border-color: #a8bfff;
  box-shadow: 0 0 0 2px rgba(41, 128, 185, 0.12);
}
.add-tag-pop-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.add-tag-btn {
  border: 1px solid #e0e0e6;
  background: #fff;
  color: #555;
  font-size: 12px;
  padding: 5px 14px;
  border-radius: 6px;
  cursor: pointer;
}
.add-tag-btn:hover {
  border-color: #c9c9d4;
  background: #fafafa;
}
.add-tag-btn.primary {
  background: #2980b9;
  border-color: #2980b9;
  color: #fff;
}
.add-tag-btn.primary:hover {
  background: #2472a6;
}
.tag-pop-enter-active,
.tag-pop-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}
.tag-pop-enter-from,
.tag-pop-leave-to {
  opacity: 0;
  transform: scale(0.96);
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

/* ============ 全屏节点搜索框（Ctrl+F） ============ */
.node-search-bar {
  position: fixed;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 6000;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  background: #fff;
  border: 1px solid #dcdfe6;
  border-radius: 10px;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.16);
  min-width: 360px;
}

.node-search-input {
  flex: 1;
  border: none;
  outline: none;
  font-size: 13.5px;
  padding: 5px 6px;
  color: #303133;
  background: transparent;
  min-width: 0;
}

.node-search-count {
  font-size: 12px;
  color: #909399;
  white-space: nowrap;
  min-width: 56px;
  text-align: center;
}

.node-search-btn {
  border: 1px solid #dcdfe6;
  background: #fff;
  border-radius: 6px;
  width: 26px;
  height: 26px;
  cursor: pointer;
  font-size: 13px;
  color: #606266;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.node-search-btn:hover:not(:disabled) {
  border-color: var(--apple-blue, #007aff);
  color: var(--apple-blue, #007aff);
}

.node-search-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>

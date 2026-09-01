<template>
  <div class="chat-panel-root">
  <div v-if="thinkingSeconds >= 25 && (aiStatus === 'thinking' || aiStatus === 'calling')" class="thinking-progress-banner" data-testid="thinking-progress">
    <span class="thinking-progress-icon">⏳</span>
    <span class="thinking-progress-text">
      AI 正在思考…… 已 {{ thinkingSeconds }} 秒
      <template v-if="thinkingSeconds >= 60">· 可点右上角停止</template>
    </span>
  </div>
  <div v-if="showNetworkBanner && !networkOnline" class="network-offline-banner" data-testid="network-offline-banner">
    <span class="network-offline-icon">📡</span>
    <span class="network-offline-text">网络不可用，联网搜索/网页读取/远程 AI 暂时不可用。</span>
    <button class="network-offline-recheck" @click="forceRecheckNetwork" title="重新检测网络">重新检测</button>
    <button class="network-offline-close" @click="dismissNetworkBanner" title="关闭提示">×</button>
  </div>
  <div v-if="mcpStatusList.length" class="mcp-status-banner-wrap" data-testid="mcp-status-banner">
    <div v-for="issue in mcpStatusList" :key="issue.id" class="mcp-status-banner">
      <span class="mcp-status-icon">⚠️</span>
      <span class="mcp-status-text">
        MCP「{{ issue.serverName }}」{{ issue.status === 'exit' ? '已停止' : '异常' }}{{ issue.reason ? '：' + issue.reason : '' }}
      </span>
      <button class="mcp-status-close" @click="dismissMcpIssue(issue.id)" title="关闭提示">×</button>
    </div>
  </div>
  <div class="chat-panel">
    <!-- 头部 -->
    <header class="chat-header">
      <div class="header-left">
        <h3 class="chat-title">AI 助手</h3>
        <div class="status-indicator">
          <span class="status-dot" :class="aiStatus === 'thinking' || aiStatus === 'calling' ? 'thinking' : 'online'"></span>
          <span class="status-text">{{ statusText }}</span>
        </div>
      </div>
      <div v-if="!compact" class="header-right">
        <el-dropdown v-if="mindMapWindows.length" trigger="click" @command="onAiBindCommand">
          <button
            class="header-icon-btn ai-bind-btn"
            :class="{ locked: aiBindLocked }"
            :title="aiBindLocked ? 'AI 已锁定到：' + aiBindTargetName + '（点击切换）' : 'AI 目标：跟随当前窗口（点击切换）'"
          >
            <svg viewBox="0 0 20 20" fill="none" width="16" height="16">
              <circle cx="10" cy="10" r="2.6" :fill="aiBindLocked ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="1.5"/>
              <circle cx="10" cy="10" r="7" stroke="currentColor" stroke-width="1.5"/>
            </svg>
          </button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="__auto__" :class="{ 'is-selected': !aiBindLocked }">
                跟随当前窗口
              </el-dropdown-item>
              <el-dropdown-item
                v-for="w in mindMapWindows"
                :key="w.fileId"
                :command="w.fileId"
                :class="{ 'is-selected': aiBindLocked && aiBindFileId === w.fileId }"
              >
                {{ w.fileName }}
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
        <button class="header-icon-btn" @click="toggleLogPanel" :class="{ active: logPanelVisible }" title="运行日志">
          <svg viewBox="0 0 20 20" fill="none" width="16" height="16">
            <path d="M4 5h12M4 10h12M4 15h8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
        </button>
      </div>
    </header>

    <!-- 消息区域 -->
    <div class="chat-messages" ref="messagesRef" @scroll="onMessagesScroll">
      <!-- 欢迎消息 -->
      <div v-if="messages.length === 0" class="welcome-message">
        <div class="welcome-icon">
          <svg viewBox="0 0 48 48" fill="none">
            <circle cx="24" cy="24" r="22" fill="rgba(0,122,255,0.08)" />
            <path
              d="M24 14C18.5 14 14 18.5 14 24C14 25.4 14.3 26.7 14.8 27.9L14 32L18.3 31.3C19.5 31.8 20.7 32 22 32C27.5 32 32 27.5 32 22C32 16.5 29.5 14 24 14Z"
              fill="var(--apple-blue)"
            />
            <circle cx="20" cy="24" r="1.5" fill="#fff" />
            <circle cx="24" cy="24" r="1.5" fill="#fff" />
            <circle cx="28" cy="24" r="1.5" fill="#fff" />
          </svg>
        </div>
        <p class="welcome-title">AI 助手已就绪</p>
        <p class="welcome-desc">我可以帮你生成思维导图、扩展节点、总结内容等。</p>
      </div>

      <!-- 消息列表 -->
      <div
        v-for="msg in messages"
        :key="msg.id"
        :class="['message', msg.role, msg.isAiAction ? 'ai-action' : '']"
      >
        <!-- 用户消息 -->
        <div v-if="msg.role === 'user'" class="message-content user-content" :class="{ 'is-ai-action': msg.isAiAction }">
          <span v-if="msg.isAiAction" class="ai-action-icon" aria-hidden="true">⚡</span>
          <span class="ai-action-text">{{ msg.content }}</span>
          <!-- 已发送的图片：点击放大预览，双击用系统默认程序打开 -->
          <div v-if="msg.images && msg.images.length" class="msg-images">
            <img
              v-for="(im, i) in msg.images"
              :key="i"
              :src="im.src"
              :alt="im.name"
              class="msg-thumb"
              :title="`${im.name}\n单击放大预览 / 双击打开文件`"
              @click="previewImage(im.src)"
              @dblclick.prevent="openFileByPath(im.path)"
            />
          </div>
          <!-- 已发送的附件：单击打开所在文件夹，双击打开文件 -->
          <div v-if="msg.files && msg.files.length" class="msg-attachments">
            <span
              v-for="f in msg.files"
              :key="f.path"
              class="msg-file-chip"
              :title="`${f.path}\n单击打开所在文件夹 / 双击打开文件`"
              @click="openFileLocation(f.path)"
              @dblclick.prevent="openFileByPath(f.path)"
            >
              <svg class="file-chip-icon" viewBox="0 0 16 16" width="11" height="11">
                <path fill="currentColor" d="M3 1.5h6L13 5.5v9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-12a1 1 0 0 1 1-1zm5.5 1v3.5H12z"/>
              </svg>
              <span class="file-chip-name">{{ f.fileName }}</span>
              <span class="file-chip-ext">{{ f.ext }}</span>
            </span>
          </div>
          <!-- 已发送的引用节点：原子胶囊，点击定位到导图节点 -->
          <div v-if="msg.refs && msg.refs.length" class="msg-refs">
            <span
              v-for="r in msg.refs"
              :key="r.id"
              class="ref-chip msg-ref-chip"
              :title="`${r.title}\n点击定位到导图节点`"
              @click="jumpToRef(r)"
            >
              <svg class="ref-chip-icon" viewBox="0 0 16 16" width="11" height="11">
                <path fill="currentColor" d="M3 1.5h6L13 5.5v9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-12a1 1 0 0 1 1-1zm5.5 1v3.5H12z"/>
              </svg>
              <span class="ref-chip-file">{{ r.fileName }}</span>
              <span class="ref-chip-sep">›</span>
              <span class="ref-chip-text">{{ r.label }}</span>
              <span class="ref-chip-kind">{{ r.kindLabel }}</span>
            </span>
          </div>
          <!-- 已发送的 Skill / MCP 原子胶囊 -->
          <div v-if="msg.skills && msg.skills.length" class="msg-refs">
            <span
              v-for="s in msg.skills"
              :key="s.id"
              class="ref-chip msg-ref-chip"
              title="已引用 Skill"
            >
              <span class="ref-chip-file">Skill</span>
              <span class="ref-chip-sep">›</span>
              <span class="ref-chip-text">{{ s.name }}</span>
            </span>
          </div>
          <div v-if="msg.mcps && msg.mcps.length" class="msg-refs">
            <span
              v-for="m in msg.mcps"
              :key="m.id"
              class="ref-chip msg-ref-chip"
              title="已引用 MCP"
            >
              <span class="ref-chip-file">MCP</span>
              <span class="ref-chip-sep">›</span>
              <span class="ref-chip-text">{{ m.name }}</span>
            </span>
          </div>
          <div v-if="msg.tools && msg.tools.length" class="msg-refs">
            <span
              v-for="t in msg.tools"
              :key="t.id"
              class="ref-chip msg-ref-chip"
              title="已引用工具"
            >
              <span class="ref-chip-file">工具</span>
              <span class="ref-chip-sep">›</span>
              <span class="ref-chip-text">{{ t.name }}</span>
            </span>
          </div>
        </div>

        <!-- AI 消息 -->
        <div v-else class="message-content assistant-content">
          <!-- Markdown 渲染内容（review #13.4：超长自动折叠） -->
          <div v-if="msg.content" class="md-content" :class="{ 'show-raw': msg.showRaw }">
            <template v-if="isAiMessageLong(msg) && !msg.expanded && !msg.showRaw">
              <div class="md-collapsed">{{ previewAiContent(msg) }}</div>
              <button class="md-collapse-toggle" @click="toggleAiExpanded(msg)">展开 ▾ （共 {{ stripThinkBlocks(msg.content).split(String.fromCharCode(10)).length }} 行）</button>
            </template>
            <template v-else>
            <div v-if="msg.showRaw" class="md-raw-text">{{ stripThinkBlocks(msg.content) }}</div>
            <div
              v-else
              v-html="renderMarkdown(stripThinkBlocks(msg.content))"
              @click="handleLinkClick"
              @contextmenu="handleMdContextMenu"
            ></div>
            </template>
            <!-- 显示原文/渲染切换按钮 -->
            <button
              v-if="msg.content && msg.content.includes('\n')"
              class="md-toggle-raw"
              @click="msg.showRaw = !msg.showRaw"
            >
              {{ msg.showRaw ? '显示渲染' : '显示原文' }}
            </button>
          </div>
          <!-- 危险确认快捷回复：AI 请求用户回复“确认/取消”时直接渲染按钮 -->
          <div v-if="confirmOptionsFor(msg).length" class="confirm-quick-replies">
            <span class="confirm-quick-label">请选择：</span>
            <button
              v-for="opt in confirmOptionsFor(msg)"
              :key="opt"
              class="confirm-quick-btn"
              :class="{ primary: opt !== '取消' }"
              @click="quickReplyDanger(msg, opt)"
            >{{ opt }}</button>
          </div>
          <!-- 导出的图片直接显示在消息中（已自动保存到默认保存目录） -->
          <div v-if="msg.image" class="msg-image-wrap">
            <img
              :src="msg.image"
              class="msg-image"
              :alt="msg.imageFileName || '导出图片'"
              title="点击放大预览，右键保存到指定位置"
              @click="previewImage(msg.image)"
              @contextmenu.prevent="saveImageAs(msg)"
            />
            <div v-if="msg.imageFileName" class="msg-image-name">{{ msg.imageFileName }}（已自动保存，点击放大 / 右键另存）</div>
          </div>
          <!-- AI 生成的文件：单击打开所在文件夹，双击打开文件 -->
          <div v-if="msg.files && msg.files.length" class="msg-attachments">
            <span
              v-for="f in msg.files"
              :key="f.path"
              class="msg-file-chip"
              :title="`${f.path}\n单击打开所在文件夹 / 双击打开文件`"
              @click="openFileLocation(f.path)"
              @dblclick.prevent="openFileByPath(f.path)"
            >
              <svg class="file-chip-icon" viewBox="0 0 16 16" width="11" height="11">
                <path fill="currentColor" d="M3 1.5h6L13 5.5v9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-12a1 1 0 0 1 1-1zm5.5 1v3.5H12z"/>
              </svg>
              <span class="file-chip-name">{{ f.fileName }}</span>
              <span class="file-chip-ext">{{ f.ext }}</span>
            </span>
          </div>
          <!-- 快捷点选：AI 提问选项渲染为可点击按钮，最后一条 AI 消息且空闲时显示 -->
          <div v-if="quickPicksFor(msg)" class="quick-picks">
            <div class="qp-caption">
              {{ quickPicksFor(msg).mode === 'multi' ? '可多选，勾选后点击提交：' : '点击选项快速回复：' }}
            </div>
            <div class="qp-options">
              <button
                v-for="(opt, oi) in quickPicksFor(msg).options"
                :key="oi"
                class="qp-option"
                :class="{ active: (msg.quickPickSelected || []).includes(oi) }"
                @click="onQuickPickClick(msg, oi)"
              >{{ opt }}</button>
              <button
                v-if="quickPicksFor(msg).mode === 'multi' && (msg.quickPickSelected || []).length > 0"
                class="qp-submit"
                @click="submitQuickPicks(msg)"
              >提交（{{ (msg.quickPickSelected || []).length }} 项）</button>
            </div>
            <div class="qp-other">
              <input
                v-model="msg.quickPickOther"
                class="qp-other-input"
                placeholder="其他（可补充说明，可不填）"
                @keyup.enter="submitQuickPickOther(msg)"
              />
              <button
                v-if="quickPicksFor(msg).mode === 'multi'"
                class="qp-other-send"
                title="发送输入框内容（可与勾选项合并提交）"
                @click="submitQuickPickOther(msg)"
              >发送</button>
            </div>
          </div>
          <!-- 工具调用状态（消息最下方）：超过2项自动折叠，点击可展开 -->
          <div v-if="msg.toolCalls && msg.toolCalls.length > 0" class="tool-calls">
            <button
              v-if="msg.toolCalls.length > 2"
              class="tool-calls-toggle"
              @click="msg.toolsExpanded = !msg.toolsExpanded"
            >
              <span class="tct-arrow" :class="{ open: msg.toolsExpanded }">&#9656;</span>
              <span v-if="msg.toolsExpanded">收起工具调用（{{ msg.toolCalls.length }} 项）</span>
              <span v-else>工具调用 {{ msg.toolCalls.length }} 项 · {{ toolCallProgress(msg) }} · 点击展开</span>
            </button>
            <template v-if="msg.toolCalls.length <= 2 || msg.toolsExpanded">
              <div
                v-for="(tc, i) in msg.toolCalls"
                :key="i"
                class="tool-call-item"
                :class="tc.status"
              >
                <span class="tool-call-icon">
                  <span v-if="tc.status === 'calling'" class="tool-spinner"></span>
                  <span v-else-if="tc.status === 'done'" class="tool-check">&#10003;</span>
                  <span v-else-if="tc.status === 'error'" class="tool-error">&#10007;</span>
                  <span v-else-if="tc.status === 'stopped'" class="tool-stopped">&#9632;</span>
                </span>
                <span class="tool-call-name">{{ tc.displayName || tc.name }}</span>
                <span v-if="tc.summary" class="tool-call-summary">{{ tc.summary }}</span>
                <span class="tool-call-status">{{ toolStatusText(tc.status) }}</span>
              </div>
            </template>
          </div>
          <!-- 一键撤销本次 AI 的全部导图操作 -->
          <button
            v-if="msg.undoSteps > 0"
            class="undo-txn-btn"
            title="撤销本轮 AI 对导图做的全部操作"
            @click="undoAiTransaction(msg)"
          >
            <svg viewBox="0 0 16 16" fill="none" width="12" height="12">
              <path d="M3 7h7a3.5 3.5 0 110 7H6" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M5.5 4.5L3 7l2.5 2.5" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            撤销本次 AI 全部操作
          </button>
          <!-- Skill 沉淀卡片（review bug：在消息列表中渲染，可编辑、可保存、可一键试用） -->
          <div v-if="msg.skillCard" class="skill-card" :class="['skill-card-' + msg.skillCard.status]">
            <div class="skill-card-header">
              <span class="skill-card-icon">⚡</span>
              <span class="skill-card-title">Skill 沉淀</span>
              <span class="skill-card-status">
                <template v-if="msg.skillCard.status === 'analyzing'">分析中...</template>
                <template v-else-if="msg.skillCard.status === 'ready'">可保存</template>
                <template v-else-if="msg.skillCard.status === 'saving'">保存中...</template>
                <template v-else-if="msg.skillCard.status === 'saved'">已保存</template>
                <template v-else-if="msg.skillCard.status === 'not_feasible'">不可行</template>
                <template v-else-if="msg.skillCard.status === 'failed'">失败</template>
                <template v-else-if="msg.skillCard.status === 'discarded'">已放弃</template>
              </span>
            </div>
            <!-- 可行性原因 -->
            <div v-if="msg.skillCard.status === 'not_feasible' || msg.skillCard.reason" class="skill-card-reason">
              <strong>AI 评估：</strong>{{ msg.skillCard.reason || (msg.skillCard.parsed && msg.skillCard.parsed.reason) || '（无）' }}
            </div>
            <!-- 用户额外要求 -->
            <div v-if="msg.skillCard.requirements" class="skill-card-reason">
              <strong>用户额外要求：</strong>{{ msg.skillCard.requirements }}
            </div>
            <!-- 可编辑字段：name / description / instructions -->
            <template v-if="msg.skillCard.status === 'ready' || msg.skillCard.status === 'saving' || msg.skillCard.status === 'saved' || msg.skillCard.status === 'failed'">
              <div class="skill-card-field">
                <label>名称</label>
                <input
                  v-model="msg.skillCardName"
                  type="text"
                  class="skill-card-input"
                  :disabled="msg.skillCard.status === 'saving' || msg.skillCard.status === 'saved'"
                  maxlength="40"
                  placeholder="Skill 名称（≤40 字）"
                />
              </div>
              <div class="skill-card-field">
                <label>说明</label>
                <input
                  v-model="msg.skillCardDesc"
                  type="text"
                  class="skill-card-input"
                  :disabled="msg.skillCard.status === 'saving' || msg.skillCard.status === 'saved'"
                  maxlength="200"
                  placeholder="Skill 用途简述（≤200 字）"
                />
              </div>
              <div class="skill-card-field">
                <label>指令（Instructions）</label>
                <textarea
                  v-model="msg.skillCardInstructions"
                  class="skill-card-textarea"
                  :disabled="msg.skillCard.status === 'saving' || msg.skillCard.status === 'saved'"
                  maxlength="10000"
                  rows="8"
                  placeholder="给未来 AI 执行的逐步指令"
                ></textarea>
              </div>
            </template>
            <!-- 错误信息 -->
            <div v-if="msg.skillCard.status === 'failed' && msg.skillCard.error" class="skill-card-error">
              {{ msg.skillCard.error }}
            </div>
            <!-- 已保存后展示 Skill id 与跳转入口 -->
            <div v-if="msg.skillCard.status === 'saved' && msg.skillCard.savedSkill" class="skill-card-saved">
              <span class="skill-card-saved-tag">ID: {{ msg.skillCard.savedSkill.id }}</span>
              <span class="skill-card-saved-tag">来源: AI 沉淀</span>
            </div>
            <!-- 操作按钮 -->
            <div v-if="msg.skillCard.status === 'ready'" class="skill-card-actions">
              <button class="skill-card-btn primary" @click="saveSkillCard(msg)">💾 保存</button>
              <button class="skill-card-btn" @click="trySkillCard(msg)" title="把 instructions 当作新指令发给 AI 演练">▶ 一键试用</button>
              <button class="skill-card-btn danger" @click="discardSkillCard(msg)">✕ 取消</button>
            </div>
          </div>
        </div>
        <!-- 重新生成按钮（review #13.3） -->
        <button
          v-if="msg.role === 'assistant'"
          class="msg-regen-btn"
          @click.stop="regenerateAiMessage(msg)"
          :title="'复制上一条用户消息并自动发送'"
          data-testid="regenerate-btn"
        >
          <svg viewBox="0 0 16 16" fill="none" width="14" height="14">
            <path d="M2 8a6 6 0 1 1 1.76 4.24M2 13v-3h3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>


        <!-- 复制按钮 -->
        <button
          class="msg-copy-btn"
          @click.stop="copyMessage(msg)"
          :title="copiedMsgId === msg.id ? '已复制' : '复制'"
        >
          <svg v-if="copiedMsgId !== msg.id" viewBox="0 0 16 16" fill="none" width="14" height="14">
            <rect x="5" y="5" width="9" height="9" rx="1.5" stroke="currentColor" stroke-width="1.3"/>
            <path d="M11 5V3.5A1.5 1.5 0 009.5 2h-6A1.5 1.5 0 002 3.5v6A1.5 1.5 0 003.5 11H5" stroke="currentColor" stroke-width="1.3" fill="none"/>
          </svg>
          <svg v-else viewBox="0 0 16 16" fill="none" width="14" height="14">
            <path d="M4 8l3 3 5-6" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </div>

      <!-- 思考中动画 -->
      <div v-if="aiStatus === 'thinking'" class="message assistant thinking">
        <div class="typing-dots">
          <span class="dot"></span>
          <span class="dot"></span>
          <span class="dot"></span>
        </div>
      </div>
    </div>

    <!-- Todo 原子胶囊：悬浮在记忆/历史/新建对话工具栏上方 -->
    <div
      v-if="activePlan && activePlan.steps && activePlan.steps.length > 0"
      class="plan-float"
      @mouseenter="planHover = true"
      @mouseleave="planHover = false"
      @click="planHover = !planHover"
    >
      <div class="plan-float-capsule">
        <span class="plan-float-icon">☑</span>
        <span class="plan-float-text">Todo</span>
        <span class="plan-float-progress">{{ activePlan.done.length }}/{{ activePlan.steps.length }}</span>
      </div>
      <Transition name="plan-pop">
        <div v-if="planHover" class="plan-float-panel">
          <div
            v-for="(step, i) in activePlan.steps"
            :key="i"
            class="plan-float-step"
            :class="{ done: activePlan.done.includes(i + 1) }"
          >
            <span class="plan-float-check">{{ activePlan.done.includes(i + 1) ? '✓' : '' }}</span>
            <span class="plan-float-step-text">{{ step }}</span>
          </div>
        </div>
      </Transition>
    </div>

    <!-- 工具栏：记忆设置 / 历史记录 / 新建对话 -->
    <div class="chat-toolbar" :class="{ 'compact-toolbar': compact }">
      <button v-if="!compact" class="toolbar-btn" @click="showMemoryDialog = true" title="设置永久记忆，AI将严格遵守">
        <svg viewBox="0 0 20 20" fill="none" width="14" height="14">
          <path d="M10 2L3 5v5c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V5l-7-3z" stroke="currentColor" stroke-width="1.5" fill="none"/>
          <path d="M7 10l2 2 4-4" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <span>记忆设置</span>
      </button>
      <button v-if="!compact" class="toolbar-btn" @click="toggleHistoryPanel" title="查看历史对话记录">
        <svg viewBox="0 0 20 20" fill="none" width="14" height="14">
          <circle cx="10" cy="10" r="7.5" stroke="currentColor" stroke-width="1.5" fill="none"/>
          <path d="M10 5v5l3 2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
        <span>历史记录</span>
      </button>
      <!-- 快速入口：创建 Skill / 工具 / MCP（点击后 AI 自动加载引导 Skill 并开启交互） -->
      <button class="toolbar-btn create-ability-btn" @click="invokeBuiltinGuide" title="让 AI 引导你创建 Skill、自定义工具或 MCP 服务">
        <svg viewBox="0 0 20 20" fill="none" width="14" height="14">
          <!-- 加号 + 小方块（表示新增能力条目） -->
          <rect x="3" y="3" width="14" height="14" rx="3" stroke="currentColor" stroke-width="1.4" fill="none"/>
          <path d="M10 7v6M7 10h6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
        </svg>
        <span>创建能力</span>
      </button>
      <button class="toolbar-btn primary" @click="newConversation" title="开始新的对话">
        <svg viewBox="0 0 20 20" fill="none" width="14" height="14">
          <path d="M10 4v12M4 10h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
        <span>新建对话</span>
      </button>
                  <!-- 深度思考：侧边栏模式移至输入框右下角（上拉式），悬浮窗模式移至底部 Skill 按钮旁 -->
      <div v-if="false" class="deep-thinking-switcher" :class="{ active: deepThinkingEnabled }">
        <button
          class="toolbar-btn deep-thinking-btn deep-thinking-btn-compact"
          :class="{ on: deepThinkingEnabled }"
          @click.stop="toggleDeepThinkingMenu"
          :title="deepThinkingEnabled ? `深度思考 ${deepThinkingEffort}` : `深度思考（点击开启）`"
        >
          <span class="deep-thinking-icon-text">{{ deepThinkingEnabled ? (deepThinkingEffort === 'low' ? 'L' : deepThinkingEffort === 'medium' ? 'M' : 'H') : '' }}</span>
        </button>
        <Transition name="model-dropdown">
          <div v-if="deepThinkingMenuVisible" class="deep-thinking-menu" @click.stop>
            <div class="deep-thinking-option" :class="{ active: deepThinkingEffort === 'low' }" @click="setDeepThinkingEffort('low')">
              <span>Low</span>
              <span v-if="deepThinkingEffort === 'low'" class="deep-thinking-check">&#10003;</span>
            </div>
            <div class="deep-thinking-option" :class="{ active: deepThinkingEffort === 'medium' }" @click="setDeepThinkingEffort('medium')">
              <span>Medium</span>
              <span v-if="deepThinkingEffort === 'medium'" class="deep-thinking-check">&#10003;</span>
            </div>
            <div class="deep-thinking-option" :class="{ active: deepThinkingEffort === 'high' }" @click="setDeepThinkingEffort('high')">
              <span>High</span>
              <span v-if="deepThinkingEffort === 'high'" class="deep-thinking-check">&#10003;</span>
            </div>
          </div>
        </Transition>
      </div>
      <!-- 悬浮窗模式：模型切换放到"新建对话"右边，方便看清当前模型（侧边窗模式仍在底部） -->
      <div v-if="compact" class="model-switcher toolbar-model-switcher">
        <button class="model-switch-btn" @click="toggleModelDropdown" :disabled="fetchingModels" title="点击切换模型">
          <svg viewBox="0 0 16 16" fill="none" width="13" height="13">
            <rect x="2" y="3" width="12" height="10" rx="2" stroke="currentColor" stroke-width="1.3" fill="none"/>
            <circle cx="6" cy="7" r="1.2" fill="currentColor"/>
            <path d="M2 11l3-2.5L7 10l3-3 4 3.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
          </svg>
          <span class="model-name">{{ currentModelName || '未选择模型' }}</span>
          <svg v-if="fetchingModels" class="model-spinner" viewBox="0 0 16 16" fill="none" width="12" height="12">
            <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5" stroke-dasharray="20 10" stroke-linecap="round"/>
          </svg>
          <svg v-else class="model-chevron" :class="{ open: modelDropdownVisible }" viewBox="0 0 12 12" fill="none" width="10" height="10">
            <path d="M3 5l3 3 3-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
        <Transition name="model-dropdown">
          <div v-if="modelDropdownVisible" class="model-dropdown">
            <div class="model-dropdown-header">
              <span>可用模型</span>
              <button class="model-refresh-btn" @click="fetchAvailableModels" :disabled="fetchingModels">
                {{ fetchingModels ? '检测中...' : '刷新' }}
              </button>
            </div>
            <div class="model-dropdown-list">
              <div
                v-for="m in availableModels"
                :key="m"
                class="model-option"
                :class="{ active: m === currentModelName }"
                @click="switchModel(m)"
              >
                <span class="model-option-name">{{ m }}</span>
                <span v-if="m === currentModelName" class="model-option-check">&#10003;</span>
              </div>
              <div v-if="availableModels.length === 0 && !fetchingModels" class="model-empty">
                未检测到模型，请在设置中配置
              </div>
            </div>
            <div class="model-dropdown-footer">
              <button class="model-manual-btn" @click="modelDropdownVisible = false">关闭</button>
            </div>
          </div>
        </Transition>
      </div>
    </div>

    <!-- 历史记录面板 -->
    <Transition name="history-slide">
      <div v-if="historyPanelVisible" class="history-panel">
        <div class="history-panel-header">
          <span class="history-title">历史记录</span>
          <div class="history-header-actions">
            <button
              v-if="conversations.length > 0"
              class="history-clear-btn"
              @click="confirmClearAll"
              title="清空所有历史记录"
            >
              清空全部
            </button>
            <button class="history-close" @click="historyPanelVisible = false">&#10005;</button>
          </div>
        </div>
        <div class="history-list">
          <div
            v-for="conv in conversations"
            :key="conv.id"
            class="history-item"
            :class="{ active: currentConversation && conv.id === currentConversation.id }"
            @click="loadConversation(conv.id)"
          >
            <div class="history-item-content">
              <div class="history-item-title">{{ conv.title || '新对话' }}</div>
              <div class="history-item-time">{{ formatTime(conv.updatedAt) }}</div>
            </div>
            <button
              class="history-item-delete"
              @click.stop="confirmDeleteConversation(conv.id, conv.title)"
              title="删除此记录"
            >
              <svg viewBox="0 0 16 16" fill="none" width="14" height="14">
                <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
              </svg>
            </button>
          </div>
          <div v-if="conversations.length === 0" class="history-empty">
            暂无历史记录
          </div>
        </div>
      </div>
    </Transition>

    <!-- 清空确认弹窗 -->
    <el-dialog
      v-model="showClearConfirm"
      title="确认清空"
      width="360px"
      :close-on-click-modal="true"
      align-center
    >
      <p style="font-size: 14px; color: var(--text-primary); margin: 0;">
        确定要清空所有历史记录吗？此操作不可撤销。
      </p>
      <template #footer>
        <button class="dialog-btn cancel" @click="showClearConfirm = false">取消</button>
        <button class="dialog-btn confirm" style="background: #ff3b30;" @click="doClearAll">清空</button>
      </template>
    </el-dialog>

    <!-- 删除单条确认弹窗 -->
    <el-dialog
      v-model="showDeleteConfirm"
      title="确认删除"
      width="360px"
      :close-on-click-modal="true"
      align-center
    >
      <p style="font-size: 14px; color: var(--text-primary); margin: 0;">
        确定要删除"{{ deleteTargetTitle }}"吗？
      </p>
      <template #footer>
        <button class="dialog-btn cancel" @click="showDeleteConfirm = false">取消</button>
        <button class="dialog-btn confirm" style="background: #ff3b30;" @click="doDeleteConversation">删除</button>
      </template>
    </el-dialog>

    <!-- 记忆设置弹窗 -->
    <el-dialog
      v-model="showMemoryDialog"
      title="记忆设置"
      width="460px"
      :close-on-click-modal="true"
      align-center
    >
      <div class="memory-dialog-content">
        <p class="memory-hint">在此输入的内容将作为永久记忆，AI 将严格遵守这些指令。</p>
        <textarea
          v-model="memoryText"
          class="memory-textarea"
          rows="8"
          placeholder="例如：&#10;- 回答时使用简洁的中文&#10;- 生成思维导图时每个节点不超过15个字&#10;- 优先使用逻辑结构布局"
        ></textarea>
      </div>
      <template #footer>
        <button class="dialog-btn cancel" @click="showMemoryDialog = false">取消</button>
        <button class="dialog-btn confirm" @click="saveMemorySettings">保存</button>
      </template>
    </el-dialog>

    <!-- 危险操作二次确认弹窗 -->
    <el-dialog
      v-model="dangerDialog.visible"
      title="危险操作确认"
      width="400px"
      :close-on-click-modal="false"
      align-center
      @close="onDangerCancel"
    >
      <div class="danger-dialog-content">
        <div class="danger-icon-wrap">
          <svg viewBox="0 0 24 24" fill="none" width="26" height="26">
            <path d="M12 3L2.5 20h19L12 3z" stroke="#ff9500" stroke-width="1.8" fill="none" stroke-linejoin="round"/>
            <path d="M12 9.5v4.5" stroke="#ff9500" stroke-width="1.8" stroke-linecap="round"/>
            <circle cx="12" cy="16.8" r="0.9" fill="#ff9500"/>
          </svg>
        </div>
        <p class="danger-tool-name">AI 请求执行：{{ dangerDialog.displayName }}</p>
        <p class="danger-reason">{{ dangerDialog.reason }}</p>
        <p v-if="dangerDialog.argSummary" class="danger-args">参数：{{ dangerDialog.argSummary }}</p>
        <label class="danger-remember">
          <input type="checkbox" v-model="dangerDialog.remember" />
          <span>不再确认此工具（加入白名单，可在设置中移除）</span>
        </label>
      </div>
      <template #footer>
        <button class="dialog-btn cancel" @click="onDangerCancel">取消</button>
        <button class="dialog-btn confirm" style="background: #ff9500;" @click="onDangerConfirm">仍然执行</button>
      </template>
    </el-dialog>

    <!-- 输入区域（支持拖入本地文件，drop 后生成文件胶囊随消息发送） -->
    <div
      class="chat-input-area"
      :class="{ 'file-drag-over': fileDragActive }"
      @dragenter="onFileDragEnter"
      @dragover="onFileDragOver"
      @dragleave="onFileDragLeave"
      @drop="onFileDrop"
    >
      <!-- 排队消息：AI 运行期间发送的消息在这里展示，可编辑/删除 -->
      <div v-if="messageQueue.length" class="queued-messages">
        <div v-for="(q, i) in messageQueue" :key="i" class="queued-message">
          <span class="queued-index">#{{ i + 1 }}</span>
          <span class="queued-text">{{ q.text }}</span>
          <button class="queued-btn" @click="editQueuedMessage(i)">编辑</button>
          <button class="queued-btn danger" @click="removeQueuedMessage(i)">删除</button>
        </div>
      </div>
      <!-- AI 续写/新增子节点提问：快捷回复按钮 -->
      <div v-if="pendingContinue" class="quick-reply-bar">
        <span class="quick-reply-label">
          {{ pendingContinue.waiting === 'ref' ? '参考资料：' : (pendingContinue.waiting === 'depth' ? '层级要求：' : (pendingContinue.mode === 'add-child' ? '其他要求：' : '续写要求：')) }}
        </span>
        <button
          class="quick-reply-btn"
          @click="quickReplyContinue(pendingContinue.waiting === 'ref' ? '无参考资料' : (pendingContinue.waiting === 'depth' ? '无层级要求' : (pendingContinue.mode === 'add-child' ? '无其他要求' : '无续写要求')))"
        >
          {{ pendingContinue.waiting === 'ref' ? '无参考资料' : (pendingContinue.waiting === 'depth' ? '无层级要求' : (pendingContinue.mode === 'add-child' ? '无其他要求' : '无续写要求')) }}
        </button>
        <button class="quick-reply-btn cancel" @click="quickReplyContinue('__CANCEL__')">{{ pendingContinue.mode === 'add-child' ? '取消新增' : '取消续写' }}</button>
        <span class="quick-reply-hint">有则填入输入框发送，无则点击快捷回复</span>
      </div>
      <!-- 后台任务运行提示（飞书/微信/定时任务处理中，不阻塞主界面发送） -->
      <div v-if="backgroundRunning.size > 0" class="bg-task-bar">
        <span class="bg-task-spinner"></span>
        <span class="bg-task-text">
          正在处理{{ backgroundSourceLabel }}消息...
        </span>
        <span class="bg-task-hint">（后台任务与主对话并行，互不影响）</span>
      </div>
      <!-- 拖入文件胶囊（drop 添加，整体删除：空输入框按 Backspace/Delete 或点 ×；双击打开文件，右键打开所在文件夹） -->
      <div v-if="attachedFiles.length" class="attached-files">
        <span
          v-for="(f, i) in attachedFiles"
          :key="f.id"
          class="file-chip"
          :title="`${f.path}\n双击打开文件 / 右键打开所在文件夹`"
          @dblclick.prevent="openFileByPath(f.path)"
          @contextmenu.prevent="openFileLocation(f.path)"
        >
          <svg class="file-chip-icon" viewBox="0 0 16 16" width="11" height="11">
            <path fill="currentColor" d="M3 1.5h6L13 5.5v9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-12a1 1 0 0 1 1-1zm5.5 1v3.5H12z"/>
          </svg>
          <span class="file-chip-name">{{ f.fileName }}</span>
          <span class="file-chip-ext">{{ f.ext }}</span>
          <button class="ref-chip-close" title="移除文件" @click="removeAttachedFile(i)">×</button>
        </span>
      </div>
      <!-- 引用节点胶囊（整体删除：空输入框按 Backspace/Delete 或点 ×） -->
      <div v-if="attachedRefs.length" class="attached-refs">
        <span
          v-for="(r, i) in attachedRefs"
          :key="r.id"
          class="ref-chip"
          :title="r.title"
        >
          <svg class="ref-chip-icon" viewBox="0 0 16 16" width="11" height="11">
            <path fill="currentColor" d="M3 1.5h6L13 5.5v9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-12a1 1 0 0 1 1-1zm5.5 1v3.5H12z"/>
          </svg>
          <span class="ref-chip-file">{{ r.fileName }}</span>
          <span class="ref-chip-sep">›</span>
          <span class="ref-chip-text">{{ r.label }}</span>
          <span class="ref-chip-kind">{{ r.kindLabel }}</span>
          <button class="ref-chip-close" title="移除引用" @click="removeAttachedRef(i)">×</button>
        </span>
      </div>
      <!-- Skills 原子胶囊 -->
      <div v-if="attachedSkills.length" class="attached-refs">
        <span
          v-for="(s, i) in attachedSkills"
          :key="s.id"
          class="ref-chip skill-chip"
          :title="s.description || s.name"
        >
          <svg class="ref-chip-icon" viewBox="0 0 16 16" width="11" height="11">
            <path fill="currentColor" d="M5 3h8l3 3v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zm5.5 1v3.5H14z"/>
          </svg>
          <span class="ref-chip-file">Skill</span>
          <span class="ref-chip-sep">›</span>
          <span class="ref-chip-text">{{ s.name }}</span>
          <button class="ref-chip-close" title="移除 Skill" @click="removeAttachedSkill(i)">×</button>
        </span>
      </div>
      <!-- @ 技能选择弹层 -->
      <div v-if="skillPickerVisible" class="skill-picker">
        <div class="skill-picker-title">选择 Skill</div>
        <button
          v-for="s in filteredSkills"
          :key="s.id"
          class="skill-picker-item"
          @click="selectSkill(s)"
        >{{ s.name }}<span v-if="s.description" class="skill-picker-desc">{{ s.description }}</span></button>
      </div>
      <div v-if="mcpPickerVisible" class="skill-picker mcp-picker">
        <div class="skill-picker-title">选择 MCP 服务</div>
        <button
          v-for="m in filteredMcps"
          :key="m.id"
          @click="selectMcp(m)"
          class="skill-picker-item"
        >{{ m.name }}<span v-if="m.description" class="skill-picker-desc">{{ m.description }}</span></button>
        <div v-if="filteredMcps.length === 0" class="skill-picker-desc" style="padding: 8px 12px;">无可用 MCP 服务</div>
      </div>
      <!-- / 工具选择弹层 -->
      <div v-if="toolPickerVisible" class="skill-picker tool-picker">
        <div class="skill-picker-title">选择工具</div>
        <button
          v-for="t in filteredToolOptions"
          :key="t.id"
          class="skill-picker-item"
          @click="selectTool(t)"
        >{{ t.name }}<span v-if="t.description" class="skill-picker-desc">{{ t.description }}</span></button>
        <div v-if="filteredToolOptions.length === 0" class="skill-picker-desc" style="padding: 8px 12px;">无可用工具</div>
      </div>
      <!-- 工具原子胶囊 -->
      <div v-if="attachedTools.length" class="attached-refs">
        <span
          v-for="(t, i) in attachedTools"
          :key="t.id"
          class="ref-chip tool-chip"
          :title="t.description || t.name"
        >
          <span class="ref-chip-file">工具</span>
          <span class="ref-chip-sep">›</span>
          <span class="ref-chip-text">{{ t.name }}</span>
          <button class="ref-chip-close" title="移除工具" @click="removeAttachedTool(i)">×</button>
        </span>
      </div>
      <!-- 输入框 + 右下角深度思考上拉按钮（侧边栏模式） -->
      <div class="chat-input-wrap">
        <textarea
          ref="textareaRef"
          v-model="inputText"
          class="chat-input"
          rows="3"
          placeholder="输入问题或指令...（可直接拖入文件）"
          @keydown.enter.exact.prevent="sendMessage"
          @keydown.enter.shift.exact="onShiftEnter"
          @keydown.delete="onInputKeydownDelete"
          @paste="onPaste"
          @input="onInputDetect"
        ></textarea>
        <!-- 侧边栏模式：输入框右下角深度思考上拉选择器 -->
        <div v-if="!compact" class="input-deep-thinking-pullup" :class="{ active: deepThinkingEnabled }">
          <button
            class="pullup-btn"
            :class="{ on: deepThinkingEnabled }"
            @click.stop="toggleDeepThinkingPullup"
            :title="deepThinkingEnabled ? `深度思考：${effortLabel(deepThinkingEffort)}（点击切换档位）` : '点击开启深度思考'"
          >
            <svg v-if="!deepThinkingEnabled" viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M8 2a5 5 0 0 1 5 5c0 2-1 3.5-2 4.5V13H5v-1.5C4 10.5 3 9 3 7a5 5 0 0 1 5-5z"/>
              <path d="M6 13h4"/>
            </svg>
            <span v-else class="pullup-level">{{ deepThinkingEffort === 'low' ? 'L' : deepThinkingEffort === 'medium' ? 'M' : 'H' }}</span>
          </button>
          <Transition name="pullup-menu">
            <div v-if="deepThinkingPullupVisible" class="pullup-menu" @click.stop>
              <div class="pullup-menu-title">深度思考</div>
              <!-- review bug：原模板在关闭状态下打开菜单没有任何可点击项（"开启"按钮缺失），现在补上 -->
              <div v-if="!deepThinkingEnabled" class="pullup-option pullup-enable" @click="enableDeepThinkingPullup">
                <span>开启深度思考</span>
                <span class="pullup-check">⚡</span>
              </div>
              <template v-else>
                <div class="pullup-option" :class="{ active: deepThinkingEffort === 'low' }" @click="setDeepThinkingPullupEffort('low')">
                  <span>轻量 · Low</span>
                  <span v-if="deepThinkingEffort === 'low'" class="pullup-check">&#10003;</span>
                </div>
                <div class="pullup-option" :class="{ active: deepThinkingEffort === 'medium' }" @click="setDeepThinkingPullupEffort('medium')">
                  <span>中等 · Medium</span>
                  <span v-if="deepThinkingEffort === 'medium'" class="pullup-check">&#10003;</span>
                </div>
                <div class="pullup-option" :class="{ active: deepThinkingEffort === 'high' }" @click="setDeepThinkingPullupEffort('high')">
                  <span>深度 · High</span>
                  <span v-if="deepThinkingEffort === 'high'" class="pullup-check">&#10003;</span>
                </div>
                <div class="pullup-divider"></div>
                <div class="pullup-option pullup-disable" @click="disableDeepThinkingPullup">
                  <span>关闭深度思考</span>
                </div>
              </template>
            </div>
          </Transition>
        </div>
      </div>

      <!-- 已附加的 MCP 服务标签 -->
      <div v-if="attachedMcps.length > 0" class="attached-skills">
        <span v-for="(m, i) in attachedMcps" :key="m.id" class="attached-skill-tag">
          🔌 {{ m.name }}
          <button @click="removeAttachedMcp(i)" class="attached-skill-remove">&times;</button>
        </span>
      </div>
      <!-- 拖拽悬停提示浮层 -->
      <div v-if="fileDragActive" class="file-drag-hint">
        <svg viewBox="0 0 16 16" width="15" height="15">
          <path fill="currentColor" d="M3 1.5h6L13 5.5v9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-12a1 1 0 0 1 1-1zm5.5 1v3.5H12zM6 10h4v1.2H6z"/>
        </svg>
        松开鼠标，将文件添加到对话
      </div>

      <!-- 底部工具栏：模型切换 + 发送/图片按钮 -->
      <div class="input-bottom-bar">
        <!-- 模型切换（侧边窗模式显示在底部；悬浮窗模式已移到工具栏"新建对话"右边） -->
        <div v-if="!compact" class="model-switcher">
          <button
            class="model-switch-btn"
            @click="toggleModelDropdown"
            :disabled="fetchingModels"
            title="点击切换模型"
          >
            <svg viewBox="0 0 16 16" fill="none" width="13" height="13">
              <rect x="2" y="3" width="12" height="10" rx="2" stroke="currentColor" stroke-width="1.3" fill="none"/>
              <circle cx="6" cy="7" r="1.2" fill="currentColor"/>
              <path d="M2 11l3-2.5L7 10l3-3 4 3.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
            </svg>
            <span class="model-name">{{ currentModelName || '未选择模型' }}</span>
            <svg v-if="fetchingModels" class="model-spinner" viewBox="0 0 16 16" fill="none" width="12" height="12">
              <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5" stroke-dasharray="20 10" stroke-linecap="round"/>
            </svg>
            <svg v-else class="model-chevron" :class="{ open: modelDropdownVisible }" viewBox="0 0 12 12" fill="none" width="10" height="10">
              <path d="M3 5l3 3 3-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>

          <!-- 模型列表下拉 -->
          <Transition name="model-dropdown">
            <div v-if="modelDropdownVisible" class="model-dropdown">
              <div class="model-dropdown-header">
                <span>可用模型</span>
                <button class="model-refresh-btn" @click="fetchAvailableModels" :disabled="fetchingModels">
                  {{ fetchingModels ? '检测中...' : '刷新' }}
                </button>
              </div>
              <div class="model-dropdown-list">
                <div
                  v-for="m in availableModels"
                  :key="m"
                  class="model-option"
                  :class="{ active: m === currentModelName }"
                  @click="switchModel(m)"
                >
                  <span class="model-option-name">{{ m }}</span>
                  <span v-if="m === currentModelName" class="model-option-check">&#10003;</span>
                </div>
                <div v-if="availableModels.length === 0 && !fetchingModels" class="model-empty">
                  未检测到模型，请在设置中配置
                </div>
              </div>
              <div class="model-dropdown-footer">
                <button class="model-manual-btn" @click="modelDropdownVisible = false">关闭</button>
              </div>
            </div>
          </Transition>
        </div>

        <!-- 知识库模式：开启后 AI 严格基于左侧目录树索引内容回答 -->
        <button
          class="kb-mode-btn"
          :class="{ active: knowledgeMode }"
          :disabled="knowledgeLoading"
          :title="knowledgeMode ? '知识库模式已开启：AI 将严格基于左侧目录树内文件内容回答' : '开启知识库模式：AI 将严格基于左侧目录树内文件内容回答'"
          @click="toggleKnowledgeMode"
        >
          <svg viewBox="0 0 20 20" fill="none" width="15" height="15">
            <path d="M4 3.5A1.5 1.5 0 015.5 2H16v13.5H5.5A1.5 1.5 0 004 17V3.5z" stroke="currentColor" stroke-width="1.4"/>
            <path d="M4 17a2 2 0 002 2h10v-18H6a2 2 0 00-2 2v14z" stroke="currentColor" stroke-width="1.4"/>
            <path d="M7.5 5h6M7.5 8h6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
          </svg>
          <span class="kb-mode-text">知识库</span>
        </button>
        <button
          class="kb-mode-btn"
          :class="{ active: distillingSkill }"
          :disabled="distillingSkill"
          title="分析当前对话，尝试沉淀为可复用 Skill"
          @click="generateSkillFromConversation"
        >
          <svg viewBox="0 0 20 20" fill="none" width="15" height="15">
            <path d="M5 3h8l3 3v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" stroke="currentColor" stroke-width="1.4"/>
            <path d="M8 10h5M8 13h4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
          </svg>
          <span class="kb-mode-text">Skill</span>
        </button>

        <!-- 悬浮窗模式：深度思考按钮放在 Skill 按钮右边 -->
        <div v-if="compact" class="deep-thinking-switcher bottom-bar-deep-thinking" :class="{ active: deepThinkingEnabled }">
          <button
            class="toolbar-btn deep-thinking-btn deep-thinking-btn-compact"
            :class="{ on: deepThinkingEnabled }"
            @click.stop="toggleDeepThinkingMenu"
            :title="deepThinkingEnabled ? `深度思考 ${deepThinkingEffort}` : `深度思考（点击开启）`"
          >
            <span class="deep-thinking-icon-text">{{ deepThinkingEnabled ? (deepThinkingEffort === 'low' ? 'L' : deepThinkingEffort === 'medium' ? 'M' : 'H') : '' }}</span>
          </button>
          <Transition name="model-dropdown">
            <div v-if="deepThinkingMenuVisible" class="deep-thinking-menu" @click.stop>
              <!-- review bug：关闭状态下打开菜单也需要"开启"入口（之前完全没有可点的项） -->
              <div v-if="!deepThinkingEnabled" class="deep-thinking-option" @click="enableDeepThinkingPullup">
                <span>开启深度思考</span>
                <span class="deep-thinking-check">⚡</span>
              </div>
              <template v-else>
                <div class="deep-thinking-option" :class="{ active: deepThinkingEffort === 'low' }" @click="setDeepThinkingEffort('low')">
                  <span>Low</span>
                  <span v-if="deepThinkingEffort === 'low'" class="deep-thinking-check">&#10003;</span>
                </div>
                <div class="deep-thinking-option" :class="{ active: deepThinkingEffort === 'medium' }" @click="setDeepThinkingEffort('medium')">
                  <span>Medium</span>
                  <span v-if="deepThinkingEffort === 'medium'" class="deep-thinking-check">&#10003;</span>
                </div>
                <div class="deep-thinking-option" :class="{ active: deepThinkingEffort === 'high' }" @click="setDeepThinkingEffort('high')">
                  <span>High</span>
                  <span v-if="deepThinkingEffort === 'high'" class="deep-thinking-check">&#10003;</span>
                </div>
                <div class="deep-thinking-divider"></div>
                <div class="deep-thinking-option" @click="disableDeepThinking">
                  <span>关闭深度思考</span>
                </div>
              </template>
            </div>
          </Transition>
        </div>

        <!-- 图片+发送按钮 -->
        <div class="input-actions">
          <!-- 信任模式开关 -->
          <button
            class="add-image-btn trust-toggle"
            :class="{ active: trustMode }"
            @click="toggleTrustMode"
            :title="trustMode ? '信任模式已开启：所有操作直接执行，不再弹窗确认' : '信任模式已关闭：危险操作需确认'"
          >
            <svg viewBox="0 0 20 20" fill="none" width="16" height="16">
              <!-- 信任模式开启：开锁（锁环抬起） -->
              <path v-if="trustMode" d="M6.5 8V6a3.5 3.5 0 016.8-1.2"
                :stroke="'#ff9500'" stroke-width="1.6" stroke-linecap="round" fill="none"/>
              <!-- 信任模式关闭：闭锁（锁环完整） -->
              <path v-else d="M6.5 8V6a3.5 3.5 0 017 0v2"
                :stroke="'currentColor'" stroke-width="1.6" stroke-linecap="round" fill="none"/>
              <rect x="4.5" y="8" width="11" height="8" rx="2"
                :stroke="trustMode ? '#ff9500' : 'currentColor'"
                :fill="trustMode ? 'rgba(255,149,0,0.18)' : 'none'"
                stroke-width="1.6"/>
            </svg>
          </button>
          <button
            class="add-image-btn"
            @click="selectImage"
            title="选择图片作为附件（发送后 AI 自动识别）"
          >
            <svg viewBox="0 0 20 20" fill="none">
              <path d="M10 4v12M4 10h12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
          </button>
          <!-- 运行中显示停止按钮，空闲时显示发送按钮 -->
          <button
            v-if="aiStatus === 'thinking' || aiStatus === 'calling'"
            class="send-btn stop-btn"
            title="停止 AI 运行"
            @click="stopGeneration"
          >
            <svg viewBox="0 0 20 20" fill="none">
              <rect x="5" y="5" width="10" height="10" rx="2" fill="currentColor"/>
            </svg>
          </button>
          <button
            v-if="messageQueue.length > 0"
            class="send-btn jump-btn"
            title="立即发送队列中的消息（中断当前回复）"
            @click="jumpQueue"
          >
            <svg viewBox="0 0 20 20" fill="none">
              <path d="M11 2L4 12h5l-1 6 7-10h-5l1-6z" fill="currentColor"/>
            </svg>
          </button>
          <button
            v-if="!(aiStatus === 'thinking' || aiStatus === 'calling') && messageQueue.length === 0"
            class="send-btn"
            :class="{ disabled: !canSend }"
            :disabled="!canSend"
            @click="sendMessage"
          >
            <svg viewBox="0 0 20 20" fill="none">
              <path
                d="M3 10L17 3L10 17L8.5 11.5L3 10Z"
                fill="currentColor"
              />
            </svg>
          </button>
        </div>
      </div>

      <input
        ref="imageInputRef"
        type="file"
        accept="image/*"
        style="display: none"
        @change="onImageSelected"
      />
    </div>

    <!-- 图片放大预览遮罩 -->
    <Teleport to="body">
      <Transition name="img-preview">
        <div v-if="imagePreviewSrc" class="img-preview-mask" @click="imagePreviewSrc = null">
          <img :src="imagePreviewSrc" class="img-preview-img" @click.stop alt="图片预览" />
          <button class="img-preview-close" title="关闭" @click="imagePreviewSrc = null">✕</button>
        </div>
      </Transition>
    </Teleport>
  </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Setting } from '@element-plus/icons-vue'
import { treeToText, treeToSkeletonText, countNodes } from '../utils/treeUtils'
import { parseMarkdownToTree } from '../utils/markdownParser'
import { createUid } from 'simple-mind-map/src/utils'
import { aiService, buildBaseURL, resetWebSearchTask, createAIService } from '../services/aiService'
import { uploadFileForProvider } from '../services/fileUploadService'
import { handleToolCall, aiTools, getCoreTools, DANGEROUS_TOOLS, TOOL_METADATA, buildToolCatalogText } from '../services/toolHandler'
import { useMindMapStore } from '../stores/mindMapStore'
import { useDeepThinkingStore } from '../stores/deepThinkingStore'
import { stripDynamicContext } from '../composables/useChatSend'
import { isTrustMode, setTrustMode } from '../utils/trustMode'
import { formatMemoryText } from '../utils/aiMemory'
import { addToReviewPlan } from '../utils/reviewPlan'
import { renderMarkdown, getMarkdownCSS } from '../utils/markdownRenderer'
import { stripThinkBlocks } from '../utils/thinkFilter'
import { initCloze, applyClozeStyles, toggleAllCloze, isClozeHiddenAll } from '../utils/cloze'
import { getDragFilePath, clearDragFilePath } from '../utils/dragState'
import { smartClozeNodes, smartClozeFullMap } from '../utils/aiCloze'
import { parseDocument } from '../services/docParseService'
import { ConcurrencyLimiter } from '../utils/concurrencyLimiter'
import {
  createConversation,
  loadConversations,
  saveConversation,
  deleteConversation,
  clearAllConversations,
  getConversationById,
  getCurrentConversationId,
  setCurrentConversationId,
  loadMemory,
  saveMemory,
  generateTitle
} from '../utils/conversationStore'
import { addLog } from '../utils/logStore'
import { getContextWindow, estimateTokens, estimateToolsTokens, COMPRESS_THRESHOLD_RATIO, KEEP_RECENT_ROUNDS } from '../utils/contextWindow'
import { searchService } from '../services/searchService'
import {
  thirdPartyChannels as tpChannels,
  pushThirdPartyMessage,
  pushThirdPartyNotice as tpPushNotice,
  getThirdPartyChannel as tpGetChannel
} from '../utils/thirdPartyStore'

const props = defineProps({
  mindMap: {
    type: Object,
    default: null
  },
  activeNode: {
    type: Object,
    default: null
  },
  currentFilePath: {
    type: String,
    default: ''
  },
  currentFileName: {
    type: String,
    default: ''
  },
  compact: {
    type: Boolean,
    default: false
  },
  // 多窗口 AI 绑定：可选窗口列表 + 当前锁定目标
  mindMapWindows: {
    type: Array,
    default: () => []
  },
  aiBindFileId: {
    type: String,
    default: ''
  },
  aiBindLocked: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['tool-call-status', 'toggle-log-panel', 'log-updated', 'conversation-changed', 'file-created', 'external-file-created', 'file-deleted', 'switch-view', 'open-settings', 'file-renamed', 'update-ai-bind'])

// AI 绑定目标名称（锁定到某窗口时显示）
const aiBindTargetName = computed(() => {
  const w = (props.mindMapWindows || []).find(x => x.fileId === props.aiBindFileId)
  return w ? w.fileName : ''
})

// 切换 AI 绑定目标：__auto__ = 跟随当前窗口，其余为锁定到指定窗口
const onAiBindCommand = (cmd) => {
  if (cmd === '__auto__') {
    emit('update-ai-bind', { fileId: '', locked: false })
  } else {
    emit('update-ai-bind', { fileId: cmd, locked: true })
  }
}

const messagesRef = ref(null)
const textareaRef = ref(null)
const imageInputRef = ref(null)
const messages = ref([])
const inputText = ref('')
const aiStatus = ref('idle')
const planHover = ref(false)
const activePlan = computed(() => {
  for (let i = messages.value.length - 1; i >= 0; i--) {
    const m = messages.value[i]
    if (m && m.role === 'assistant' && m.plan && Array.isArray(m.plan.steps) && m.plan.steps.length > 0) {
      return m.plan
    }
  }
  return null
})
// 后台任务运行状态：Set<source>（多通道并行，各自独立；不影响主界面发送按钮）
const backgroundRunning = ref(new Set())
const backgroundSourceLabel = computed(() => {
  const map = { feishu: '飞书', wechat: '微信', task: '定时任务', agent: '外部 Agent' }
  const list = [...backgroundRunning.value].map(s => map[s] || s)
  return list.join('、') || '外部 Agent'
})
// 信任模式：开启后所有危险操作跳过弹窗确认，直接执行
const trustMode = ref(isTrustMode())
const toggleTrustMode = () => {
  trustMode.value = !trustMode.value
  setTrustMode(trustMode.value)
  ElMessage.info(trustMode.value ? '信任模式已开启：所有操作将直接执行，不再弹窗确认' : '信任模式已关闭：危险操作将恢复确认')
}
// 全局AI锁：标记是否有AI调用在运行（前台或后台），用于防止并发
let aiLockToken = 0
const acquireAILock = (source) => {
  if (aiLockToken !== 0) return 0 // 已被占用
  aiLockToken = ++runSeq
  return aiLockToken
}
const releaseAILock = (token) => {
  if (token === aiLockToken) aiLockToken = 0
}
const isAIBusy = () => aiLockToken !== 0

// 是否可发送：有文字、有引用胶囊或有拖入文件胶囊
const canSend = computed(() => inputText.value.trim() !== '' || attachedRefs.value.length > 0 || attachedFiles.value.length > 0 || attachedSkills.value.length > 0 || attachedMcps.value.length > 0 || attachedTools.value.length > 0)

// 对话管理
const currentConversation = ref(null)
// 文件-对话映射：fileId -> conversationId，实现切换文件时自动切换对话
const fileConversationMap = ref(new Map())
// 反向映射：conversationId -> fileId，用于提示当前对话绑定哪个文件
const conversationFileMap = ref(new Map())
const conversations = ref([])
const historyPanelVisible = ref(false)

// 对话上下文压缩：累积摘要（超阈值时把更早历史压成摘要，随对话持久化到 currentConversation.summary）
const conversationSummary = ref('')
// 摘要覆盖水位线：已并入摘要的消息条数（发送时整块跳过这些消息——滑动窗口截断，
// 既避免已压缩内容重复发送，又让请求前缀 [system,摘要] 逐字节稳定，最大化前缀缓存命中）
const summaryCoveredCount = ref(0)

// 记忆设置
const showMemoryDialog = ref(false)
const memoryText = ref('')

// 日志面板
const logPanelVisible = ref(false)

// 复制消息状态
const copiedMsgId = ref(null)

// 模型切换
const currentModelName = ref('')
const availableModels = ref([])
const modelDropdownVisible = ref(false)

// 深度思考开关：使用全局 store 持久化，UI 仅控制菜单显隐与档位
const deepThinkingStore = useDeepThinkingStore()
const deepThinkingEnabled = computed(() => deepThinkingStore.enabled)
const deepThinkingEffort = computed(() => deepThinkingStore.effort)
const deepThinkingEfforts = deepThinkingStore.VALID_EFFORTS
const deepThinkingMenuVisible = ref(false)
const toggleDeepThinkingMenu = () => {
  // review bug：原逻辑是"已关闭则强制开启"，违反用户预期——明明关了深度思考，点一下又被自动开了。
  // 新逻辑：点击只是切换菜单显隐，不改 enabled 状态；档位变更在 setDeepThinkingEffort 里单独处理。
  deepThinkingMenuVisible.value = !deepThinkingMenuVisible.value
}
const setDeepThinkingEffort = (v) => {
  // 选择档位 = 用户主动开启（如果当前是关闭的）
  deepThinkingStore.setEffort(v)
  if (!deepThinkingStore.enabled) deepThinkingStore.setEnabled(true)
  deepThinkingMenuVisible.value = false
}
const disableDeepThinking = () => {
  deepThinkingStore.setEnabled(false)
  deepThinkingMenuVisible.value = false
}

// 输入框右下角上拉式深度思考选择器（侧边栏模式）
const deepThinkingPullupVisible = ref(false)
const toggleDeepThinkingPullup = () => {
  // review bug：同上，关闭状态点按钮不应被自动开启
  deepThinkingPullupVisible.value = !deepThinkingPullupVisible.value
}
const setDeepThinkingPullupEffort = (v) => {
  deepThinkingStore.setEffort(v)
  if (!deepThinkingStore.enabled) deepThinkingStore.setEnabled(true)
  deepThinkingPullupVisible.value = false
}
const disableDeepThinkingPullup = () => {
  deepThinkingStore.setEnabled(false)
  deepThinkingPullupVisible.value = false
}
// review bug：补充"开启深度思考"入口（关闭状态下打开菜单时显示）
const enableDeepThinkingPullup = () => {
  deepThinkingStore.setEnabled(true)
  deepThinkingPullupVisible.value = false
}
const effortLabel = (v) => ({ low: '轻量 (low)', medium: '中等 (medium)', high: '深度 (high)' }[v] || v)
const fetchingModels = ref(false)
const knowledgeMode = ref(false)
const knowledgeLoading = ref(false)

// 生成唯一消息 ID
let msgIdCounter = 0
const genMsgId = () => `msg_${Date.now()}_${msgIdCounter++}`

// 工具名称中文映射
const toolNameMap = {
  generate_mindmap: '生成导图',
  expand_node: '扩展节点',
  set_mindmap_data: '更新导图',
  summarize_node: '添加概要',
  search_nodes: '搜索节点',
  update_node_text: '修改节点',
  delete_node: '删除节点',
  change_layout: '切换布局',
  export_mindmap: '导出',
  get_mindmap_info: '获取信息',
  insert_sibling_node: '插入兄弟节点',
  insert_child_node: '插入子节点',
  insert_parent_node: '插入父节点',
  move_node_up: '上移节点',
  move_node_down: '下移节点',
  toggle_node_expand: '展开/收起',
  remove_node_only: '仅删除节点',
  copy_node: '复制节点',
  cut_node: '剪切节点',
  paste_node: '粘贴节点',
  set_node_text: '设置节点文本',
  set_node_style: '设置节点样式',
  search_web: '联网搜索',
  audit_mindmap: '导图诊断',
  refactor_mindmap: '导图重构',
  research_to_mindmap: '研究导图',
  read_webpage: '读取网页',
  get_location: '获取位置',
  ocr_recognize: 'OCR识别',
  search_knowledge_base: '知识库搜索',
  ai_continue_children: 'AI续写子节点',
  parallel_ai_workers: '并行子Agent',
  ai_recite_rewrite: 'AI背诵改写',
  ai_cloze: 'AI智能挖空',
  ai_cloze_full_map: 'AI全文挖空',
  ai_quiz: 'AI出题（新文件）',
  ai_quiz_append: 'AI出题（挂到节点）',
  update_node_text: '修改节点文本',
  batch_text_style: '批量文字样式',
  focus_node: '定位节点',
  query_node_styles: '查询节点样式',
  get_review_schedule: '查询复习计划',
  get_today_review_status: '今日复习状态',
  delete_review_plan: '删除复习计划',
  format_painter: '格式刷',
  set_node_note: '节点备注',
  outer_frame: '外框',
  associative_line: '关联线',
  undo: '撤销',
  redo: '重做',
  upload_to_feishu: '上传飞书',
  save_mindmap: '保存导图',
  new_mindmap: '新建导图',
  get_mindmap_content: '获取导图内容',
  add_to_review: '添加复习',
  search_knowledge_base: '知识库搜索',
  read_mindmap_file: '读取导图文件',
  read_node_image: '识别节点图片',
  semantic_search: '语义检索',
  activate_tools: '激活工具',
  move_node: '移动节点',
  merge_nodes: '合并节点',
  scheduled_task: '定时任务',
  find_related: '关联推荐',
  memory: '长期记忆',
  context_window: '上下文窗口',
  feishu_list_files: '飞书文件列表',
  feishu_get_doc_content: '读取飞书文档',
  feishu_delete_file: '删除飞书文件',
  feishu_rename_file: '重命名飞书文件',
  upload_mindmap_to_feishu_doc: '上传飞书文档',
  upload_file_to_feishu: '上传文件到飞书',
  send_feishu_message: '发送飞书消息',
  send_wechat_message: '发送微信消息',
  send_wechat_image: '发送微信图片',
  send_feishu_image: '发送飞书图片',
  send_wechat_file: '发送微信文件',
  send_feishu_file: '发送飞书文件',
  get_mindmap_content: '获取导图内容',
  select_node: '选中节点',
  set_node_style: '设置节点样式',
  batch_node_actions: '批量节点操作',
  search_nodes: '搜索节点',
  search_web: '联网搜索',
  read_webpage: '读取网页',
  get_location: '获取位置'
}

// ========== 危险操作统一二次确认 ==========
const WHITELIST_KEY = 'mindmap_ai_tool_whitelist'
const loadWhitelist = () => {
  try { return new Set(JSON.parse(localStorage.getItem(WHITELIST_KEY) || '[]')) } catch { return new Set() }
}
const saveWhitelist = (set) => {
  try { localStorage.setItem(WHITELIST_KEY, JSON.stringify([...set])) } catch {}
}

const dangerDialog = ref({
  visible: false,
  toolName: '',
  displayName: '',
  reason: '',
  argSummary: '',
  remember: false
})
let dangerResolve = null

/**
 * 危险工具执行前弹窗确认（白名单内直接放行）
 * @returns {Promise<boolean>} 是否放行
 */
const confirmDangerousTool = (toolName, args) => {
  let dangerReason = DANGEROUS_TOOLS[toolName]
  if (toolName === 'batch_node_actions' && args?.dry_run !== true) {
    const estimatedCount = (Array.isArray(args?.steps) ? args.steps : []).reduce((total, step) => {
      const targets = step?.targets || {}
      if (Array.isArray(targets.uids)) return total + targets.uids.length
      if (targets.mode === 'all') return total + 20
      return total + 1
    }, 0)
    if (estimatedCount >= 20) dangerReason = `大规模批量修改（预计影响 ${estimatedCount}+ 个节点），请先 dry_run 或确认执行`
  }
  if (!dangerReason) return Promise.resolve(true)
  if (trustMode.value) return Promise.resolve(true)
  if (loadWhitelist().has(toolName)) return Promise.resolve(true)
  dangerDialog.value = {
    visible: true,
    toolName,
    displayName: toolNameMap[toolName] || toolName,
    reason: dangerReason,
    argSummary: summarizeToolArgs(toolName, args) || JSON.stringify(args).slice(0, 120),
    remember: false
  }
  return new Promise((resolve) => { dangerResolve = resolve })
}

const onDangerConfirm = () => {
  if (dangerDialog.value.remember) {
    const wl = loadWhitelist()
    wl.add(dangerDialog.value.toolName)
    saveWhitelist(wl)
  }
  dangerDialog.value.visible = false
  if (dangerResolve) { dangerResolve(true); dangerResolve = null }
}

const onDangerCancel = () => {
  dangerDialog.value.visible = false
  if (dangerResolve) { dangerResolve(false); dangerResolve = null }
}

// 停止运行/切换会话时关闭悬挂中的确认弹窗并拒绝放行，否则弹窗永远等不到本轮的执行者
const dismissDangerDialog = () => {
  if (dangerDialog.value.visible) {
    dangerDialog.value.visible = false
    if (dangerResolve) { dangerResolve(false); dangerResolve = null }
  }
}

// ========== 工具参数摘要（流式状态栏显示"正在做什么"） ==========
const summarizeToolArgs = (name, args = {}) => {
  try {
    const n = (s) => String(s || '').replace(/<[^>]+>/g, '').trim()
    switch (name) {
      case 'select_node':
        if (args.keyword) return `关键词「${n(args.keyword).slice(0, 20)}」`
        if (Array.isArray(args.uids)) return `${args.uids.length} 个指定节点`
        if (args.mode) return (args.mode === 'leaves' ? '全部终末节点' : '终末节点的父节点')
        return ''
      case 'batch_node_actions':
        return Array.isArray(args.steps) ? `${args.steps.length} 个批量步骤` : ''
      case 'parallel_ai_workers':
        return Array.isArray(args.tasks) ? `${args.tasks.length} 个并行子 Agent` : ''
      case 'ai_cloze':
        if (args.targets?.mode) return (args.targets.mode === 'leaves' ? '全部终末节点' : '终末节点的父节点')
        if (args.targets?.keyword) return `关键词「${n(args.targets.keyword).slice(0, 20)}」`
        return ''
      case 'search_nodes':
      case 'search_knowledge_base':
      case 'audit_mindmap':
      case 'refactor_mindmap':
      case 'research_to_mindmap':
        return n(args.topic).slice(0, 30)
      case 'search_web':
      case 'semantic_search':
      case 'find_related':
      case 'read_mindmap_file':
        return args.keyword ? `「${n(args.keyword).slice(0, 20)}」` : (args.filePath ? n(args.filePath).slice(0, 40) : '')
      case 'set_node_style': {
        const keys = Object.keys(args).filter(k => args[k] !== undefined && args[k] !== null && args[k] !== '')
        return keys.length ? keys.map(k => `${k}=${String(args[k]).slice(0, 12)}`).join(' ') : ''
      }
      case 'expand_node':
        return Array.isArray(args.nodes) ? `${args.nodes.length} 个节点` : ''
      case 'update_node_text':
        return n(args.text).slice(0, 24)
      case 'generate_mindmap':
        return n(args.markdown).slice(0, 24)
      case 'move_node':
        return `节点 → 新父节点`
      case 'merge_nodes':
        return Array.isArray(args.uids) ? `${args.uids.length} 个节点` : ''
      case 'scheduled_task':
        return args.action || 'list'
      case 'memory':
        return args.action || 'get'
      case 'activate_tools':
        return Array.isArray(args.names) ? args.names.slice(0, 3).join(', ') + (args.names.length > 3 ? '…' : '') : ''
      case 'upload_to_feishu':
      case 'upload_mindmap_to_feishu_doc':
        return '当前导图'
      case 'upload_file_to_feishu':
        return n(args.filePath).slice(0, 40)
      default:
        return ''
    }
  } catch {
    return ''
  }
}

// ========== AI 任务事务撤销：一键回退本条消息内 AI 对导图做的全部操作 ==========
// 撤销快照（消息id → 本轮 AI 操作开始前的导图节点树深拷贝）。放在内存 Map 而非消息体中，
// 避免写入 localStorage 导致体积膨胀；快照仅在当前会话内存中有效，随应用关闭/会话切换自然失效。
const aiUndoSnapshots = new Map()
// 快照体积较大，内存优先：只保留最近 3 轮 AI 操作的撤销快照，更早的自动淘汰
const AI_UNDO_SNAPSHOT_MAX = 3

const captureMindMapSnapshot = () => {
  try {
    const snapshot = props.mindMap?.getData()
    return snapshot && Object.keys(snapshot).length ? snapshot : null
  } catch { return null }
}

const undoAiTransaction = async (msg) => {
  if (!msg) return
  const mindMap = props.mindMap
  const snapshot = aiUndoSnapshots.get(msg.id)
  aiUndoSnapshots.delete(msg.id)
  msg.undoSteps = 0
  if (!mindMap) {
    ElMessage.warning('思维导图实例未初始化，无法撤销')
    return
  }
  if (!snapshot) {
    ElMessage.info('没有可撤销的 AI 操作（快照已失效或被后续操作覆盖）')
    return
  }
  // AI 工具大多走 setData 更新画布，会清空命令历史栈，因此不能用命令栈步数回退；
  // 这里用开始前快照整体还原。注意不能直接用 updateData：它内部是纯 render（不清空画布），
  // 当本轮 AI 前后节点结构差异大时会残留旧连线/节点形成「重影」。
  // 改用 renderer.setData + reRender（clearDraw + clearCache + render）干净重绘，
  // 再手动 addHistory 保留命令栈，撤销后仍可 Ctrl+Z 回到撤销前。
  try {
    if (mindMap.renderer && typeof mindMap.renderer.setData === 'function' && typeof mindMap.reRender === 'function') {
      mindMap.renderer.setData(snapshot)
      mindMap.reRender()
      if (mindMap.command && typeof mindMap.command.addHistory === 'function') {
        mindMap.command.addHistory()
      }
    } else if (typeof mindMap.updateData === 'function') {
      mindMap.updateData(snapshot)
    } else {
      mindMap.setData(snapshot)
    }
  } catch (e) {
    console.error('撤销 AI 操作失败:', e)
    ElMessage.error(`撤销失败：${e?.message || '未知错误'}`)
    return
  }

  // 删除本轮 AI 生成的文件（新增 .smm / 导出图片 / markdown / pdf 等），避免撤销后留下孤儿文件。
  // 但「原地覆盖保存」返回的当前文件路径不是新文件，必须跳过，否则撤销会把正在编辑的源文件删掉
  const createdFiles = Array.isArray(msg.files) ? msg.files.slice() : []
  msg.files = []
  const curPath = String(props.currentFilePath || '').replace(/[\\/]+/g, '/').replace(/\/+$/g, '')
  let removedCount = 0
  for (const f of createdFiles) {
    if (!f || !f.path) continue
    if (curPath && String(f.path).replace(/[\\/]+/g, '/').replace(/\/+$/g, '') === curPath) continue
    try {
      const ok = await window.electronAPI?.fs?.remove?.(f.path)
      if (ok !== false) removedCount++
    } catch (e) {
      // 文件可能已被用户移动/删除，忽略
    }
  }
  if (removedCount > 0) emit('file-deleted')

  ElMessage.success(
    removedCount > 0
      ? `已撤销本次 AI 操作，并删除 ${removedCount} 个生成文件`
      : '已撤销本次 AI 的全部导图操作'
  )
}

// 状态文本
const statusText = computed(() => {
  switch (aiStatus.value) {
    case 'thinking': return '思考中'
    case 'calling': return '工具调用中'
    case 'done': return '已完成'
    case 'error': return '出错了'
    default: return '在线'
  }
})

// 工具状态文本
const toolStatusText = (status) => {
  switch (status) {
    case 'calling': return '使用中...'
    case 'done': return '完成'
    case 'error': return '失败'
    case 'stopped': return '已停止'
    default: return ''
  }
}

// 折叠状态下工具调用进度摘要（n/m 完成，k 进行中）
const toolCallProgress = (msg) => {
  const tcs = msg.toolCalls || []
  const finished = tcs.filter(t => t.status === 'done' || t.status === 'error' || t.status === 'stopped').length
  const calling = tcs.filter(t => t.status === 'calling').length
  return calling > 0 ? `${finished}/${tcs.length} 完成，${calling} 进行中` : `${finished}/${tcs.length} 完成`
}

/* ============================================================
 * 快捷点选：解析 AI 回复末尾的问题选项，渲染为可点击按钮
 * 支持：是/否判断、A/1 单选、- [ ] 多选；均带"其他"补充输入框
 * ============================================================ */

// 选项行匹配：A. xxx / A、xxx / (A) xxx / 1. xxx / - [ ] xxx（多选）/ - xxx
const QP_OPTION_RES = [
  { re: /^[（(]?([A-Ha-h])[)）.、:：点]\s*(.+)$/, type: 'letter' },
  { re: /^[（(]?([1-9])[)）.、:：]\s*(.+)$/, type: 'number' },
  { re: /^[-*•]\s*\[[ xX]?\]\s*(.+)$/, type: 'checkbox' },
  { re: /^[-*•]\s+(.+)$/, type: 'bullet' }
]
// 问题信号：正文需含选择类词汇才把列表行识别为选项（避免普通罗列误判）
const QP_CHOICE_SIGNAL = /(选择|选哪|哪一|哪个|哪些|请选|选一个|选几个|单选|多选|可多选|选项|请确认|确认一下|choose|option)/i
// 是/否问题信号
const QP_YESNO_SIGNAL = /(是否|要不要|需不需要|要不要|需不需|能不能|能不能|可不可以|可否|是不是|可以吗|需要吗|应该吗|建议吗|好吗|行吗|继续吗|对吗|正确吗)/
const stripMd = (s) => String(s || '')
  .replace(/\*\*(.+?)\*\*/g, '$1')
  .replace(/[*_`]+/g, '')
  .trim()

// “你是想 A，还是想 B？” 这类自然语言选择：把最后一个含“还是/或者”的问题拆成选项
const parseEitherOrQuickPicks = (text) => {
  const matches = text.match(/([^。！？\n]*(?:还是|或者)[^。！？\n]*[?？]?)/g)
  if (!matches || matches.length === 0) return null
  const sentence = matches[matches.length - 1].trim()
  if (!sentence) return null
  const parts = sentence.split(/\s*(?:还是|或者)\s*/).map(s => s.trim()).filter(Boolean)
  if (parts.length < 2) return null
  const clean = parts.map(s => s
    .replace(/^(你是想要|你是想|你想要|你想|你要|你是|想要|想|要|选择|选|是)/, '')
    .trim()
    .replace(/[?？。！\s]+$/g, '')
  ).filter(Boolean).slice(0, 6)
  if (clean.length < 2) return null
  return { mode: 'single', options: clean }
}

// 解析 AI 回复 → { mode: 'single'|'multi', options: string[] } | null
const parseQuickPicks = (content) => {
  const text = stripThinkBlocks(content || '').trim()
  if (!text || text.length > 6000) return null
  const lines = text.split('\n').map(l => l.replace(/<[^>]+>/g, '').trimEnd())
  // 从末尾向前收集选项行。允许选项块后面有少量非选项尾语（模型有时会多写一句“请告诉我”），
  // 但不会因为一行尾语就漏掉 A/B/C/D 选项。
  const opts = []
  let multi = false
  let bullets = false
  let ignoredTailLines = 0
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim()
    if (!line) {
      if (opts.length > 0) {
        ignoredTailLines++
        if (ignoredTailLines > 2) break
      }
      continue // 末尾空行跳过
    }
    let hit = null
    for (const p of QP_OPTION_RES) {
      const m = line.match(p.re)
      if (m) { hit = { p, m }; break }
    }
    if (!hit) {
      if (opts.length > 0 && ignoredTailLines < 3) {
        ignoredTailLines++
        continue
      }
      break
    }
    ignoredTailLines = 0
    let label
    if (hit.p.type === 'letter') label = `${hit.m[1].toUpperCase()}. ${stripMd(hit.m[2])}`
    else if (hit.p.type === 'number') label = `${hit.m[1]}. ${stripMd(hit.m[2])}`
    else {
      label = stripMd(hit.m[1])
      if (hit.p.type === 'checkbox') multi = true
      if (hit.p.type === 'bullet') bullets = true
    }
    if (!label || label.length > 80) break
    opts.unshift(label)
    if (opts.length >= 8) break
  }
  const questionPart = lines.slice(0, Math.max(lines.length - opts.length, 0)).join('\n')
  if (opts.length >= 2) {
    // 误判防护：无复选框时，需选项前文字（末200字符）含选择类词汇或以问号结尾，
    // 否则普通的操作步骤列表/要点罗列不会被当成选项
    const qPart = questionPart.trim()
    const hasSignal = QP_CHOICE_SIGNAL.test(qPart.slice(-200))
    const endsWithQuestion = /[?？]\s*$/.test(qPart)
    if (bullets && !multi && !hasSignal && !endsWithQuestion) return null
    if (multi || hasSignal || endsWithQuestion) {
      if (/(多选|选多个|哪些|哪几)/.test(text)) multi = true
      return { mode: multi ? 'multi' : 'single', options: opts }
    }
  }
  // 无显式选项：是/否判断题 → 自动生成 是/否（或 对/错）按钮
  // 中文一般疑问句几乎都以"吗？"结尾，作为兜底信号；再加显式信号词（是否/要不要/能不能…）
  const eitherOr = parseEitherOrQuickPicks(text)
  if (eitherOr) return eitherOr
  const tail = text.slice(-300)
  const endsWithMa = /吗\s*[?？]\s*$/.test(text)
  if ((QP_YESNO_SIGNAL.test(tail) && /[?？。]\s*$/.test(tail)) || endsWithMa) {
    return { mode: 'single', options: /(对吗|正确吗|是否正确)/.test(tail) ? ['对', '错'] : ['是', '否'] }
  }
  return null
}

// 取消息的快捷点选（仅最后一条 AI 消息、AI 空闲时显示；内容变化时重新解析）
const quickPicksFor = (msg) => {
  if (!msg || msg.role !== 'assistant') return null
  if (aiStatus.value === 'thinking' || aiStatus.value === 'calling') return null
  const last = messages.value[messages.value.length - 1]
  if (last !== msg) return null
  const len = (msg.content || '').length
  if (msg.quickPicks === undefined || msg.qpLen !== len) {
    msg.qpLen = len
    msg.quickPicks = parseQuickPicks(msg.content)
    msg.quickPickSelected = []
    msg.quickPickOther = msg.quickPickOther === undefined ? '' : msg.quickPickOther
  }
  return msg.quickPicks
}

const confirmOptionsFor = (msg) => {
  if (!msg || msg.role !== 'assistant' || !msg.content) return []
  if (aiStatus.value === 'thinking' || aiStatus.value === 'calling') return []
  const last = messages.value[messages.value.length - 1]
  if (last !== msg) return []
  const text = msg.content
  const options = []
  if (/(确认删除|确认清空|确认执行|仍然执行|确认)/.test(text)) options.push('确认删除')
  if (/(取消|暂不)/.test(text)) options.push('取消')
  if (options.length && options.includes('确认删除') && options.includes('取消')) return options
  return []
}

const quickReplyDanger = (msg, value) => {
  if (!msg || !value) return
  inputText.value = value
  sendMessage(value)
}

// 单选：点击立即发送该选项
const onQuickPickClick = (msg, oi) => {
  const picks = quickPicksFor(msg)
  if (!picks) return
  if (picks.mode === 'multi') {
    const sel = msg.quickPickSelected || (msg.quickPickSelected = [])
    const idx = sel.indexOf(oi)
    if (idx >= 0) sel.splice(idx, 1)
    else sel.push(oi)
    return
  }
  const other = (msg.quickPickOther || '').trim()
  const text = other ? `${picks.options[oi]}（补充：${other}）` : picks.options[oi]
  sendMessage(text)
}

// 多选：提交勾选项（可合并"其他"补充）
const submitQuickPicks = (msg) => {
  const picks = quickPicksFor(msg)
  if (!picks) return
  const sel = (msg.quickPickSelected || []).slice().sort((a, b) => a - b)
  if (!sel.length) return
  const chosen = sel.map(i => picks.options[i])
  const other = (msg.quickPickOther || '').trim()
  sendMessage(other ? `${chosen.join('；')}；其他：${other}` : chosen.join('；'))
}

// "其他"输入框回车/发送：单选直接发文本；多选与勾选项合并（无勾选则只发文本）
const submitQuickPickOther = (msg) => {
  const picks = quickPicksFor(msg)
  if (!picks) return
  const other = (msg.quickPickOther || '').trim()
  if (!other) return
  const sel = (msg.quickPickSelected || []).slice().sort((a, b) => a - b)
  const chosen = sel.map(i => picks.options[i])
  sendMessage(chosen.length ? `${chosen.join('；')}；其他：${other}` : `其他：${other}`)
}

// 复制消息内容到剪贴板
// 用系统默认程序打开文件（双击等效行为）
const openFileByPath = async (filePath) => {
  if (!filePath) return
  try {
    if (!window.electronAPI?.fs?.openFile) {
      ElMessage.info('仅桌面应用模式下支持打开本地文件')
      return
    }
    await window.electronAPI.fs.openFile(filePath)
  } catch (err) {
    ElMessage.error('打开文件失败: ' + (err?.message || err))
  }
}

// 在资源管理器中打开文件所在位置（文件定位选中）
const openFileLocation = async (filePath) => {
  if (!filePath) return
  try {
    if (!window.electronAPI?.fs?.showInFolder) {
      ElMessage.info('仅桌面应用模式下支持打开所在文件夹')
      return
    }
    await window.electronAPI.fs.showInFolder(filePath)
  } catch (err) {
    ElMessage.error('打开所在文件夹失败: ' + (err?.message || err))
  }
}

// 拦截 Markdown 渲染内容中的点击：链接 / 图片 / 本地文件路径
const handleLinkClick = (e) => {
  // Markdown 图片：网络图/内嵌 data 图 → 放大预览；本地路径图 → 系统默认程序打开
  const img = e.target.closest('img.md-img')
  if (img) {
    const src = img.getAttribute('src') || ''
    e.preventDefault()
    e.stopPropagation()
    if (/^(https?:|data:)/i.test(src)) {
      previewImage(src)
    } else {
      openFileByPath(src.replace(/^file:\/\//i, ''))
    }
    return
  }
  // Markdown 正文中的本地文件路径：单击打开文件
  const filePathEl = e.target.closest('.md-file-path')
  if (filePathEl) {
    e.preventDefault()
    e.stopPropagation()
    openFileByPath(filePathEl.getAttribute('data-path'))
    return
  }
  const anchor = e.target.closest('a')
  if (!anchor) return
  const href = anchor.getAttribute('href')
  if (!href) return
  e.preventDefault()
  e.stopPropagation()
  if (window.electronAPI?.openExternal) {
    window.electronAPI.openExternal(href)
  } else {
    window.open(href, '_blank')
  }
}

// Markdown 内容右键：本地文件路径 → 打开所在文件夹
const handleMdContextMenu = (e) => {
  const filePathEl = e.target.closest('.md-file-path')
  if (!filePathEl) return
  e.preventDefault()
  e.stopPropagation()
  openFileLocation(filePathEl.getAttribute('data-path'))
}

// 图片放大预览
const imagePreviewSrc = ref(null)
const previewImage = (src) => {
  imagePreviewSrc.value = src
}

// 右键保存图片到用户指定位置（Electron 保存对话框 + saveBinaryFile）
const saveImageAs = async (msg) => {
  try {
    const src = msg.image
    if (!src) return
    const isDataUrl = typeof src === 'string' && src.startsWith('data:')
    const base64 = isDataUrl ? src.substring(src.indexOf(',') + 1) : src
    const defaultName = msg.imageFileName || `image_${Date.now()}.png`

    if (window.electronAPI?.dialog?.showSaveDialog) {
      const savePath = await window.electronAPI.dialog.showSaveDialog({
        title: '保存图片',
        defaultPath: defaultName,
        filters: [
          { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] },
          { name: '所有文件', extensions: ['*'] }
        ]
      })
      if (!savePath) return
      const res = await window.electronAPI.saveBinaryFile(savePath, base64)
      if (res && res.success) {
        ElMessage.success('图片已保存')
      } else {
        ElMessage.error('保存失败: ' + (res?.error || '未知错误'))
      }
    } else {
      // 浏览器环境降级：直接触发下载
      const a = document.createElement('a')
      a.href = src
      a.download = defaultName
      a.click()
      ElMessage.success('图片已下载')
    }
  } catch (e) {
    console.error('[ChatPanel] 保存图片失败:', e)
    ElMessage.error('保存图片失败: ' + (e?.message || e))
  }
}

const copyMessage = async (msg) => {
  try {
    await navigator.clipboard.writeText(msg.content || '')
    copiedMsgId.value = msg.id
    setTimeout(() => {
      copiedMsgId.value = null
    }, 2000)
  } catch (e) {
    // Fallback
    const ta = document.createElement('textarea')
    ta.value = msg.content || ''
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
    copiedMsgId.value = msg.id
    setTimeout(() => { copiedMsgId.value = null }, 2000)
  }
}

// 滚动跟随：用户手动上滑后暂停自动滚动，回到底部附近恢复
let followBottom = true

const onMessagesScroll = () => {
  if (!messagesRef.value) return
  const el = messagesRef.value
  followBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80
}

// 滚动到底部（用户上滑查看历史时不强制滚动）
const scrollToBottom = (force = false) => {
  nextTick(() => {
    if (messagesRef.value && (force || followBottom)) {
      messagesRef.value.scrollTop = messagesRef.value.scrollHeight
    }
  })
}

/* ============================================================
 * 停止 AI 运行
 * ============================================================ */

const stopRequested = ref(false)

/* 运行代际：新一轮生成/会话切换时递增。
 * 旧回调（onDone/onError/onChunk/延时器）据此判定自己已过期并丢弃，
 * 防止陈旧的 setTimeout(aiStatus='idle') 覆盖新一轮运行状态、
 * 以及停止后旧循环的收尾回调把消息/日志落进新会话 */
let runSeq = 0
const nextRunToken = () => ++runSeq
const isCurrentRun = (token) => token === runSeq

// 代际感知的空闲复位：仅当没有更新一轮运行时才置 idle
const scheduleIdleReset = (delay = 500) => {
  const token = runSeq
  setTimeout(() => {
    if (token === runSeq) aiStatus.value = 'idle'
  }, delay)
}

const waitForFileSwitch = (filePath, timeoutMs = 2500) => new Promise((resolve) => {
  if (!filePath) { resolve(); return }
  const target = String(filePath).replace(/[\\/]+/g, '/').replace(/\/+$/, '')
  const start = Date.now()
  const timer = setInterval(() => {
    const cur = String(props.currentFilePath || '').replace(/[\\/]+/g, '/').replace(/\/+$/, '')
    if (cur === target || Date.now() - start >= timeoutMs) {
      clearInterval(timer)
      resolve()
    }
  }, 60)
})

// 中止进行中的主对话生成并令其回调全部过期（切换/新建/清空/删除会话前调用）。
// 后台任务（微信/飞书/定时/Agent）用独立 aiService 实例，不受会话切换影响，继续运行
const abortActiveGeneration = () => {
  if (aiStatus.value === 'thinking' || aiStatus.value === 'calling') {
    aiService.abort()
    runSeq++
  }
  // 关闭悬挂中的危险工具确认弹窗（生成中随时可能弹出）
  dismissDangerDialog()
}

// 立即发送：中断当前回复，把队列第一条立刻发送（插队）
const jumpQueue = () => {
  if (messageQueue.value.length === 0) return
  const next = messageQueue.value.shift()
  jumpQueued = true
  abortActiveGeneration()
  setTimeout(() => {
    jumpQueued = false
    inputText.value = next.text
    attachedRefs.value = next.refs
    attachedFiles.value = next.files
    attachedSkills.value = next.skills || []
    attachedMcps.value = next.mcps || []
    attachedTools.value = next.tools || []
    if (textareaRef.value) textareaRef.value.style.height = 'auto'
    sendMessage(next.text)
  }, 350)
}

const editQueuedMessage = (index) => {
  const item = messageQueue.value[index]
  if (!item) return
  messageQueue.value.splice(index, 1)
  inputText.value = item.text || ''
  attachedRefs.value = item.refs || []
  attachedFiles.value = item.files || []
  attachedSkills.value = item.skills || []
  attachedMcps.value = item.mcps || []
  attachedTools.value = item.tools || []
  nextTick(() => {
    if (textareaRef.value) {
      textareaRef.value.focus()
      const len = textareaRef.value.value.length
      textareaRef.value.setSelectionRange(len, len)
    }
  })
}

const removeQueuedMessage = (index) => {
  messageQueue.value.splice(index, 1)
}

const stopGeneration = () => {
  // 提问等待期（idle）也要允许停止：否则续写提问卡住且无法通过停止按钮取消
  if (aiStatus.value !== 'thinking' && aiStatus.value !== 'calling' && !pendingContinue.value) return
  // 停止时关闭悬挂中的危险工具确认弹窗（拒绝放行，本轮已终止）
  dismissDangerDialog()
  stopRequested.value = true
  aiService.abort()
  runSeq++

  // 取消等待用户回答的 AI 续写提问
  if (pendingContinue.value) {
    const p = pendingContinue.value
    pendingContinue.value = null
    try { p.resolve(null) } catch (e) {}
  }

  // 立即复位界面：退出"思考中"状态，标记进行中的工具调用为"已停止"
  const lastMsg = messages.value[messages.value.length - 1]
  if (lastMsg && lastMsg.role === 'assistant' && Array.isArray(lastMsg.toolCalls)) {
    lastMsg.toolCalls.forEach(tc => {
      if (tc.status === 'calling') tc.status = 'stopped'
    })
    if (!lastMsg.content || lastMsg.content.startsWith('正在')) {
      lastMsg.content = '（已手动停止）'
    }
  }
  aiStatus.value = 'idle'
  emit('tool-call-status', 'idle')
  addLog('abort', '用户手动停止了 AI 运行', { model: currentModelName.value }, currentConversation.value?.id)
  emit('log-updated')
  ElMessage.info('已停止 AI 运行')
}

// 自动调整 textarea 高度
const autoResize = () => {
  nextTick(() => {
    if (textareaRef.value) {
      textareaRef.value.style.height = 'auto'
      textareaRef.value.style.height = Math.min(textareaRef.value.scrollHeight, 120) + 'px'
    }
  })
}

const onShiftEnter = () => {}

watch(inputText, () => {
  autoResize()
  detectSkillMention()
})
// 滚动跟随：监听"消息数量 + 每条内容长度"组成的轻量签名，而非 deep 全量遍历。
// 长对话时流式 chunk 每flush一次都要深度遍历全部消息（含工具调用数组），是卡顿主因之一
watch(
  () => messages.value.map(m => `${m.role}:${(m.content || '').length}:${(m.toolCalls || []).length}`).join('|'),
  () => scrollToBottom()
)
// 当对话切换时通知父组件，用于日志面板按对话筛选
// 切换文件时自动切换对话（多窗口/多标签体验）
watch(() => props.currentFilePath, (newPath, oldPath) => {
  // review C.1：把活跃文件所在目录通知主进程作为路径白名单
  try {
    if (window.electronAPI && window.electronAPI.fsGuard && typeof window.electronAPI.fsGuard.setActiveFileDir === 'function' && newPath) {
      const __dir = String(newPath).replace(/[\\/]+/g, '/').replace(/\/[^\\/]+$/, '')
      window.electronAPI.fsGuard.setActiveFileDir(__dir).catch(() => {})
    }
  } catch (e) { /* ignore */ }
  if (!newPath || newPath === oldPath) return
  const fid = String(newPath).replace(/[\\/]+/g, '/').replace(/\/+$/g, '')
  if (!fid) return
  // AI 运行中：对话锁定在发起时的文件，切换文件不切对话，避免消息写进错误对话
  if (aiStatus.value === 'thinking' || aiStatus.value === 'calling') {
    const boundFileId = conversationFileMap.value.get(currentConversation.value?.id) || ''
    const boundName = boundFileId ? boundFileId.split(/[\\/]/).pop() : (props.currentFileName || '当前文件')
    ElMessage.info(`当前 AI 正在处理「${boundName}」的对话，任务完成后会自动切回该对话`)
    return
  }
  // 保存当前对话
  if (currentConversation.value && messages.value.length > 0) {
    persistConversation()
  }
  // 查找或创建该文件绑定的对话
  const existingConvId = fileConversationMap.value.get(fid)
  if (existingConvId) {
    const conv = getConversationById(existingConvId)
    if (conv) {
      conv.fileId = fid
      currentConversation.value = conv
      messages.value = conv.messages || []
      conversationSummary.value = conv.summary || ''
      summaryCoveredCount.value = conv.summaryCoveredCount || 0
      setCurrentConversationId(conv.id)
      conversationFileMap.value.set(conv.id, fid)
      emit('conversation-changed', conv.id)
      return
    }
  }
  // 无绑定对话：创建新对话并绑定到该文件
  const conv = createConversation(fid)
  currentConversation.value = conv
  messages.value = []
  conversationSummary.value = ''
  summaryCoveredCount.value = 0
  fileConversationMap.value.set(fid, conv.id)
  conversationFileMap.value.set(conv.id, fid)
  setCurrentConversationId(conv.id)
  emit('conversation-changed', conv.id)
})

watch(currentConversation, (conv) => {
  emit('conversation-changed', conv?.id || '')
}, { immediate: true })

/* ============================================================
 * 模型切换
 * ============================================================ */

/**
 * 加载当前 AI 配置中的模型名称
 * 双保险：除了顶层 model，再用 activeProfileId 找一遍对应 profile 的 model，
 * 防止主进程返回的 model 字段与 activeProfileId 不一致时仍显示旧档模型
 */
const loadCurrentModel = async () => {
  try {
    if (window.electronAPI && window.electronAPI.getAIConfig) {
      const config = await window.electronAPI.getAIConfig()
      let model = config.model || ''
      const pid = config.activeProfileId
      if (pid && Array.isArray(config.profiles)) {
        const p = config.profiles.find(x => x.id === pid)
        if (p && p.model) model = p.model
      }
      currentModelName.value = model
      // 配置已切换：清空已缓存的模型列表，下次打开下拉框重新检测新配置档的模型
      availableModels.value = []
      // 确保 aiService 下次发消息时重新从主进程加载新配置档（baseURL/profileId/model）
      aiService.resetConfig()
    }
  } catch {
    // 忽略
  }
}

/**
 * 切换模型下拉框
 */
const toggleModelDropdown = () => {
  if (fetchingModels.value) return
  modelDropdownVisible.value = !modelDropdownVisible.value
  if (modelDropdownVisible.value && availableModels.value.length === 0) {
    fetchAvailableModels()
  }
}

/**
 * 通过 Electron IPC 获取可用模型列表
 */
const fetchAvailableModels = async () => {
  fetchingModels.value = true
  try {
    let baseURL = ''
    let apiKey = ''
    let profileId = ''

    if (window.electronAPI && window.electronAPI.getAIConfig) {
      const config = await window.electronAPI.getAIConfig()
      baseURL = config.baseURL || ''
      apiKey = config.apiKey || ''
      profileId = config.activeProfileId || ''
    }

    if (!baseURL) {
      ElMessage.warning('请先在设置中配置 API 地址')
      modelDropdownVisible.value = false
      return
    }

    if (window.electronAPI && window.electronAPI.fetchModels) {
      const result = await window.electronAPI.fetchModels(baseURL, apiKey, profileId)
      if (result && result.success && result.models) {
        availableModels.value = result.models
        if (result.models.length === 0) {
          ElMessage.info('未检测到可用模型，请在设置中手动输入')
        }
      } else {
        availableModels.value = []
        ElMessage.warning(result?.error || '未检测到可用模型')
      }
    } else {
      // 浏览器降级
      const base = buildBaseURL(baseURL)
      const headers = {}
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`
      let models = []
      try {
        const resp = await fetch(`${base}/v1/models`, { headers })
        if (resp.ok) {
          const data = await resp.json()
          if (data.data && Array.isArray(data.data)) {
            models = data.data.map(m => m.id).filter(Boolean)
          }
        }
      } catch { /* CORS */ }
      if (models.length === 0) {
        try {
          const resp = await fetch(`${base}/api/tags`)
          if (resp.ok) {
            const data = await resp.json()
            if (data.models && Array.isArray(data.models)) {
              models = data.models.map(m => m.name).filter(Boolean)
            }
          }
        } catch { /* ignore */ }
      }
      availableModels.value = models
      if (models.length === 0) {
        ElMessage.info('未检测到可用模型（可能是 CORS 限制），请在设置中手动输入')
      }
    }
  } catch (e) {
    console.error('获取模型列表失败:', e)
    availableModels.value = []
  } finally {
    fetchingModels.value = false
  }
}

/**
 * 切换到指定模型并保存
 */
const switchModel = async (model) => {
  currentModelName.value = model
  modelDropdownVisible.value = false

  // 更新 aiService 配置
  aiService.model = model

  // 保存到 Electron 配置（更新活跃配置档的 model）
  try {
    if (window.electronAPI && window.electronAPI.getAIConfig) {
      const config = await window.electronAPI.getAIConfig()
      config.model = model
      const pid = config.activeProfileId
      const profile = (config.profiles || []).find(p => p.id === pid)
      if (profile) profile.model = model
      if (window.electronAPI.setAIConfig) {
        await window.electronAPI.setAIConfig(config)
      }
    }
  } catch {
    // 忽略保存错误
  }

  // 重置 aiService 初始化状态
  aiService.resetConfig()

  ElMessage.success(`已切换到模型: ${model}`)
}

/**
 * 知识库模式开关。开启后发送消息时会把检索到的左侧目录树内容注入为严格证据。
 */
const toggleKnowledgeMode = () => {
  knowledgeMode.value = !knowledgeMode.value
  if (knowledgeMode.value) {
    ElMessage.success('知识库模式已开启：AI 将严格基于左侧目录树内文件内容回答')
  } else {
    ElMessage.info('知识库模式已关闭：恢复普通对话模式')
  }
}

/**
 * 本地语义检索：不调用额外大模型，使用 query 分词扩展 + 关键词检索。
 * 语义检索逻辑与 searchService.semanticSearch 一致，供知识库模式直接引用。
 */
const retrieveKnowledgeForQuestion = async (question) => {
  const q = String(question || '').trim()
  if (!q) return { context: '', results: [] }
  if (!searchService.isAvailable()) {
    return { context: '', results: [], error: '本地知识库检索服务不可用（请使用桌面应用）' }
  }
  const tokens = [...new Set(q.toLowerCase().split(/[\s,，、。；;:：/|]+/).filter(Boolean))]
  // 中文场景：额外按相邻双字片段扩展，召回更多语义相关节点
  const cjk = q.match(/[\u4e00-\u9fa5]{2,}/g) || []
  for (const word of cjk) {
    for (let i = 0; i < word.length - 1; i++) tokens.push(word.slice(i, i + 2))
  }
  const keywords = tokens.filter(Boolean).slice(0, 8)
  const { results } = await searchService.semanticSearch(q, keywords)
  const context = results.slice(0, 20).map((r, i) =>
    `[KB${i + 1}] 文件：${r.fileName}\n路径：${r.filePath}\n内容：${r.snippet || ''}${r.nodeUid ? `\n节点UID：${r.nodeUid}` : ''}`
  ).join('\n\n')
  return { context, results }
}

/**
 * 点击外部关闭模型下拉
 */
const onGlobalClick = (e) => {
  if (skillPickerVisible.value && !e.target?.closest?.('.skill-picker') && e.target !== textareaRef.value) {
    skillPickerVisible.value = false
  }
  if (modelDropdownVisible.value) {
    const target = e.target
    if (target && !target.closest('.model-switcher')) {
      modelDropdownVisible.value = false
    }
  }
  if (deepThinkingMenuVisible.value) {
    const target = e.target
    if (target && !target.closest('.deep-thinking-switcher')) {
      deepThinkingMenuVisible.value = false
    }
  }
  if (deepThinkingPullupVisible.value) {
    const target = e.target
    if (target && !target.closest('.input-deep-thinking-pullup')) {
      deepThinkingPullupVisible.value = false
    }
  }
}

/* ============================================================
 * 日志面板
 * ============================================================ */

const toggleLogPanel = () => {
  logPanelVisible.value = !logPanelVisible.value
  emit('toggle-log-panel', logPanelVisible.value)
}

/* ============================================================
 * 对话管理
 * ============================================================ */

// 初始化对话
const initConversation = () => {
  const savedId = getCurrentConversationId()
  if (savedId) {
    const conv = getConversationById(savedId)
    if (conv) {
      currentConversation.value = conv
      messages.value = conv.messages || []
      conversationSummary.value = conv.summary || ''
      summaryCoveredCount.value = conv.summaryCoveredCount || 0
      // 绑定当前文件到该对话
      const fid = String(props.currentFilePath || '').replace(/[\\/]+/g, '/').replace(/\/+$/g, '')
      if (fid) {
        conv.fileId = fid
        fileConversationMap.value.set(fid, conv.id)
        conversationFileMap.value.set(conv.id, fid)
      }
      return
    }
  }
  // 创建新对话（绑定当前文件）
  const fid = String(props.currentFilePath || '').replace(/[\\/]+/g, '/').replace(/\/+$/g, '')
  const conv = createConversation(fid)
  currentConversation.value = conv
  messages.value = []
  conversationSummary.value = ''
  summaryCoveredCount.value = 0
  if (fid) {
    fileConversationMap.value.set(fid, conv.id)
    conversationFileMap.value.set(conv.id, fid)
  }
  setCurrentConversationId(conv.id)
}

// 保存当前对话
const persistConversation = () => {
  if (!currentConversation.value) return
  // 持久化字段与消息对象保持对称：图片、计划清单缺失会导致重载后功能静默丢失；
  // 撤销快照仅存内存（aiUndoSnapshots），不做持久化，重载后不再显示已失效的撤销按钮
  currentConversation.value.messages = messages.value.map(m => {
    const item = {
      id: m.id,
      role: m.role,
      content: m.content || '',
      toolCalls: m.toolCalls || []
    }
    if (m.image) item.image = m.image
    if (m.imageFileName) item.imageFileName = m.imageFileName
    // 附件路径胶囊轻量可持久化；用户图片为 base64 缩略（体积大），不落 localStorage
    if (m.files && m.files.length) item.files = m.files
    if (m.refs && m.refs.length) item.refs = m.refs
    if (m.plan) item.plan = m.plan
    return item
  })
  // 自动生成标题
  if (currentConversation.value.title === '新对话' && messages.value.length > 0) {
    currentConversation.value.title = generateTitle(currentConversation.value)
  }
  saveConversation(currentConversation.value)
}

// 节流保存：AI 流式输出过程中每 2 秒自动保存一次，防止中途退出丢失
let _persistTimer = null
let _persistDirty = false
const saveConversationThrottled = () => {
  _persistDirty = true
  if (_persistTimer) return
  _persistTimer = setTimeout(() => {
    _persistTimer = null
    if (_persistDirty) {
      _persistDirty = false
      persistConversation()
    }
  }, 2000)
}

// 窗口关闭前强制保存（同步方式，确保数据落盘）
const handleBeforeUnload = () => {
  if (_persistTimer) {
    clearTimeout(_persistTimer)
    _persistTimer = null
  }
  if (_persistDirty || (currentConversation.value && messages.value.length > 0)) {
    try { persistConversation() } catch (e) { console.error('关闭前保存失败:', e) }
  }
}

// 新建对话
// ============ 内置「AI 能力扩展引导」Skill ============
// 用户点击工具栏「创建能力」按钮时调用：通过调用 invoke_skill 工具（直接发送工具调用给 AI）让 AI 加载引导 Skill 并开启对话
const BUILTIN_GUIDE_SKILL_ID = '__builtin_skill_creation_guide__'
const invokeBuiltinGuide = async () => {
  // 直接以用户身份发一条消息，让 AI 自动走 invoke_skill 路径（与用户自然说"帮我写个 Skill"行为一致）
  const userMsg = '请帮我创建一个新的 AI 能力（Skill / 自定义工具 / MCP 三选一）。请先调用 invoke_skill 加载「AI 能力扩展引导」Skill（id: __builtin_skill_creation_guide__），然后按该 Skill 的引导流程与我交互。'
  if (!textareaRef.value) return
  // 强制设置输入框文本并提交（走标准的 sendMessage 逻辑）
  const ta = textareaRef.value
  ta.value = userMsg
  // 触发 input 事件让 Vue 同步 v-model
  ta.dispatchEvent(new Event('input', { bubbles: true }))
  await nextTick()
  sendMessage()
}

// 简单的意图识别：用户在主对话中请求"编写/新增 Skill/工具/MCP"时，自动通过工具调用加载引导 Skill
const detectBuiltinGuideIntent = (text) => {
  const q = String(text || '').trim()
  if (!q) return false
  // 排除明显是用户问 AI 关于如何使用 Skill 的问题
  if (/怎么用|如何使用|怎么调用/.test(q) && !/(编写|创建|新增|加个|做一个|做个|写个|接入)/.test(q)) return false
  return /(编写|创建|新增|加个|做一个|做个|写个|接入|添加).*(Skill|技能|自定义工具|工具|MCP|mcp)/i.test(q)
        || /(Skill|技能|自定义工具|MCP|mcp).*(编写|创建|新增|加个|做一个|做个|写个|接入|添加)/i.test(q)
        || /帮我(写|做|加|创)(一个|个).*(Skill|工具|MCP|mcp|技能)/i.test(q)
}

const newConversation = () => {
  // 进行中的生成先中止并丢弃回调，避免消息/日志落进新会话
  abortActiveGeneration()
  aiStatus.value = 'idle'
  emit('tool-call-status', 'idle')
  // 保存当前对话
  if (messages.value.length > 0) {
    persistConversation()
  }
  cancelPendingContinue()
  const fid = String(props.currentFilePath || '').replace(/[\\/]+/g, '/').replace(/\/+$/g, '')
  const conv = createConversation(fid)
  currentConversation.value = conv
  messages.value = []
  conversationSummary.value = ''
  summaryCoveredCount.value = 0
  if (fid) {
    fileConversationMap.value.set(fid, conv.id)
    conversationFileMap.value.set(conv.id, fid)
  }
  setCurrentConversationId(conv.id)
  // 刷新历史列表
  conversations.value = loadConversations()
  ElMessage.success('已创建新对话')
}

// 切换历史记录面板
const toggleHistoryPanel = () => {
  historyPanelVisible.value = !historyPanelVisible.value
  if (historyPanelVisible.value) {
    conversations.value = loadConversations()
  }
}

// 清空所有历史记录
const showClearConfirm = ref(false)
const confirmClearAll = () => {
  showClearConfirm.value = true
}
const doClearAll = () => {
  // 进行中的生成先中止并丢弃回调
  abortActiveGeneration()
  clearAllConversations()
  cancelPendingContinue()
  conversations.value = []
  showClearConfirm.value = false
  // 创建新对话（绑定当前文件）
  const fid = String(props.currentFilePath || '').replace(/[\\/]+/g, '/').replace(/\/+$/g, '')
  const conv = createConversation(fid)
  currentConversation.value = conv
  messages.value = []
  conversationSummary.value = ''
  summaryCoveredCount.value = 0
  if (fid) {
    fileConversationMap.value.set(fid, conv.id)
    conversationFileMap.value.set(conv.id, fid)
  }
  setCurrentConversationId(conv.id)
  ElMessage.success('已清空所有历史记录')
}

// 删除单条历史记录
const showDeleteConfirm = ref(false)
const deleteTargetId = ref(null)
const deleteTargetTitle = ref('')
const confirmDeleteConversation = (id, title) => {
  deleteTargetId.value = id
  deleteTargetTitle.value = title || '新对话'
  showDeleteConfirm.value = true
}
const doDeleteConversation = () => {
  const id = deleteTargetId.value
  // 进行中的生成先中止并丢弃回调，避免消息/日志落错会话
  abortActiveGeneration()
  deleteConversation(id)
  conversations.value = loadConversations()
  showDeleteConfirm.value = false
  // 如果删除的是当前对话，创建新对话（绑定当前文件）
  if (currentConversation.value && currentConversation.value.id === id) {
    cancelPendingContinue()
    const fid = String(props.currentFilePath || '').replace(/[\\/]+/g, '/').replace(/\/+$/g, '')
    const conv = createConversation(fid)
    currentConversation.value = conv
    messages.value = []
    conversationSummary.value = ''
    summaryCoveredCount.value = 0
    if (fid) {
      fileConversationMap.value.set(fid, conv.id)
      conversationFileMap.value.set(conv.id, fid)
    }
    setCurrentConversationId(conv.id)
  }
  ElMessage.success('已删除该记录')
}

// 加载历史对话
const loadConversation = (id) => {
  // 进行中的生成先中止并丢弃回调，避免消息/日志落错会话
  abortActiveGeneration()
  // 保存当前对话
  if (messages.value.length > 0) {
    persistConversation()
  }
  const conv = getConversationById(id)
  if (conv) {
    cancelPendingContinue()
    currentConversation.value = conv
    messages.value = conv.messages || []
    conversationSummary.value = conv.summary || ''
    summaryCoveredCount.value = conv.summaryCoveredCount || 0
    setCurrentConversationId(id)
    historyPanelVisible.value = false
  }
}

// 格式化时间
const formatTime = (timestamp) => {
  if (!timestamp) return ''
  const date = new Date(timestamp)
  const now = new Date()
  const diff = now - date
  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`
  const month = date.getMonth() + 1
  const day = date.getDate()
  return `${month}月${day}日`
}

/* ============================================================
 * 记忆设置
 * ============================================================ */

const saveMemorySettings = () => {
  saveMemory(memoryText.value)
  showMemoryDialog.value = false
  ElMessage.success('记忆已保存')
}

const distillingSkill = ref(false)
let pendingSkillDistill = false

// review bug：原版只在最后 ElMessage 弹个窗，用户根本看不到 AI 给出的内容，也没法改/试用。
// 新版：AI 评估完后，在消息列表插入一张可编辑的 Skill 卡片，4 个按钮：「保存」「一键试用」「取消」
const runSkillDistill = async (requirements = '') => {
  if (messages.value.length === 0) {
    ElMessage.warning('当前对话还没有内容')
    return
  }
  if (!window.electronAPI?.skills?.create) {
    ElMessage.warning('当前环境不支持 Skill 创建')
    return
  }
  distillingSkill.value = true
  // 先插入一条"分析中"的卡片占位（消息列表反馈，不悬浮弹窗）
  const distillMsg = {
    id: genMsgId(),
    role: 'assistant',
    content: '正在分析当前对话并生成 Skill 草案...',
    toolCalls: [],
    skillCard: {
      status: 'analyzing', // analyzing | ready | saving | saved | failed | discarded | not_feasible
      reason: '',
      parsed: null,
      requirements: String(requirements || '').trim(),
      error: ''
    },
    // review bug fix：v-model 依赖响应式字段；必须先初始化为空串，否则首次渲染时 Vue 会报
    // "Cannot assign to read only property of undefined"；同时持久化对话时这些字段也会被存储
    skillCardName: '',
    skillCardDesc: '',
    skillCardInstructions: ''
  }
  messages.value.push(distillMsg)
  scrollToBottom()
  try {
    const transcript = messages.value
      .filter(m => m && m.id !== distillMsg.id) // 排除自己
      .map(m => {
        const role = m.role === 'user' ? '用户' : 'AI'
        const text = stripDynamicContext(m.content || '')
        const tools = (m.toolCalls || []).map(tc => `[工具 ${tc.displayName || tc.name} → ${tc.status}]`).join(' ')
        return `${role}：${text}${tools ? `\n${tools}` : ''}`
      }).join('\n\n')
    const requirementText = String(requirements || '').trim()
      ? `\n用户对本次沉淀的额外要求：\n${String(requirements).trim()}\n`
      : ''
    const prompt = `请分析以下对话，判断能否沉淀为一个可复用的 Skill。\n\n要求：\n1. feasible=true 表示当前系统能力可以支持该 Skill；如果必须依赖外部未配置服务、或需要系统不存在的底层能力，则 feasible=false。\n2. 只沉淀已经验证成功的流程，失败过程不要固化为 Skill。\n3. name 短小明确，instructions 是给未来 AI 执行的逐步指令。${requirementText}\n只输出 JSON：\n{"feasible":true,"reason":"为什么可行/不可行","name":"技能名","description":"解决什么问题","instructions":"步骤1；步骤2"} \n\n当前可用工具摘要：\n${buildToolCatalogText(55)}\n\n对话内容：\n${transcript.slice(0, 18000)}`
    const choice = await aiService.chat(prompt, '你是一个技能沉淀器，只输出严格 JSON。', null, { responseFormat: 'json' })
    const content = String(choice?.message?.content || '').replace(/```json|```/g, '').trim()
    const start = content.indexOf('{')
    const end = content.lastIndexOf('}')
    if (start === -1 || end === -1) throw new Error('AI 未返回有效 JSON')
    const parsed = JSON.parse(content.slice(start, end + 1))
    distillMsg.skillCard.parsed = parsed
    if (!parsed.feasible) {
      distillMsg.content = `本次暂未沉淀 Skill：${parsed.reason || '当前能力不支持'}`
      distillMsg.skillCard.status = 'not_feasible'
      distillMsg.skillCard.reason = parsed.reason || '当前能力不支持'
      scrollToBottom()
      return
    }
    if (!parsed.name || !parsed.instructions) throw new Error('Skill 缺少名称或指令')
    // AI 评估可行 → 渲染为可编辑卡片
    distillMsg.content = '' // 卡片自带 UI，不再用 content 展示
    distillMsg.skillCard.status = 'ready'
    // 初始化可编辑字段默认值（用户在卡片里可改）
    distillMsg.skillCardName = parsed.name
    distillMsg.skillCardDesc = parsed.description || ''
    distillMsg.skillCardInstructions = parsed.instructions
    scrollToBottom()
  } catch (e) {
    console.error('沉淀 Skill 失败:', e)
    distillMsg.content = `沉淀失败：${e.message || e}`
    distillMsg.skillCard.status = 'failed'
    distillMsg.skillCard.error = e.message || String(e)
  } finally {
    distillingSkill.value = false
  }
}

// 在消息列表里"保存"卡片（review bug：可编辑保存）
const saveSkillCard = async (msg) => {
  const card = msg?.skillCard
  if (!card || card.status !== 'ready') return
  const name = String(msg.skillCardName || card.parsed?.name || '').trim().slice(0, 40)
  const description = String(msg.skillCardDesc || card.parsed?.description || '').trim().slice(0, 200)
  const instructions = String(msg.skillCardInstructions || card.parsed?.instructions || '').trim().slice(0, 10000)
  if (!name || !instructions) {
    ElMessage.warning('名称与指令不能为空')
    return
  }
  card.status = 'saving'
  card.error = ''
  try {
    const skill = await window.electronAPI.skills.create({
      name, description, instructions, autoInvoke: true, source: 'ai'
    })
    card.status = 'saved'
    card.savedSkill = skill
    msg.content = `已沉淀 Skill「${skill.name}」（id=${skill.id}）。可在 设置 → Skill 管理 查看与编辑。`
  } catch (e) {
    card.status = 'failed'
    card.error = e.message || String(e)
    msg.content = `保存失败：${card.error}`
  }
  scrollToBottom()
}

// review bug：一键试用——把当前 instructions 当成"用户新指令"发送给 AI 验证可行性
const trySkillCard = (msg) => {
  const card = msg?.skillCard
  if (!card || !card.parsed) return
  const instructions = String(msg.skillCardInstructions || card.parsed.instructions || '').trim()
  if (!instructions) return
  inputText.value = `请按以下 Skill 指令演练一次：\n\n${instructions}\n\n请按这个 Skill 的步骤依次执行，遇到问题立刻报告，最后总结这次试用是否能跑通。`
  if (textareaRef.value) {
    textareaRef.value.style.height = 'auto'
    textareaRef.value.focus()
  }
  ElMessage.success('已把 Skill 指令填入输入框，按回车即可发送试用')
}

// review bug：丢弃卡片
const discardSkillCard = (msg) => {
  if (!msg?.skillCard) return
  msg.skillCard.status = 'discarded'
  msg.content = '已放弃本次沉淀。'
}

const generateSkillFromConversation = async () => {
  if (messages.value.length === 0) {
    ElMessage.warning('当前对话还没有内容')
    return
  }
  if (!window.electronAPI?.skills?.create) {
    ElMessage.warning('当前环境不支持 Skill 创建')
    return
  }
  try {
    await ElMessageBox.confirm('是否对即将沉淀的 Skill 有额外要求？', '沉淀 Skill', {
      confirmButtonText: '有要求',
      cancelButtonText: '没有要求',
      type: 'info'
    })
    // 选择“有要求”：进入输入框，发送内容作为本次沉淀的额外要求。
    pendingSkillDistill = true
    inputText.value = ''
    if (textareaRef.value) {
      textareaRef.value.focus()
      textareaRef.value.style.height = 'auto'
    }
    ElMessage.info('请直接输入沉淀要求，然后回车发送；没有要求可点“没有要求”直接沉淀')
  } catch (action) {
    if (action === 'cancel') {
      await runSkillDistill('')
    }
  }
}

/* ============================================================
 * 发送消息
 * ============================================================ */

// ========== 对话上下文增量摘要压缩 ==========

// 精简英文系统提示词：只保留核心动作规则；工具发现走 activate_tools（按需返回目录与参数 schema）
const SYSTEM_PROMPT = `Mind-map AI assistant (.smm). Views: mindmap/outline/review. Discover inactive tools via activate_tools.

## ROUTING (match the user's DOMAIN before acting — never default to local-file search)
- 飞书云文档/云盘/云空间/飞书文件/飞书文档 → cloud storage, NOT local files. Call activate_tools(keyword="feishu"), then feishu_list_files. Do NOT use find_local_file / list_directory / search_knowledge_base for Feishu cloud items.
- 微信/飞书 推送/发送消息/发图片/发文件 → activate_tools(keyword="wechat") or (keyword="feishu"), then send_*.
- 本地文件（本地导图/本地文档）→ find_local_file / list_directory / read_local_file.
- 知识库检索（"在我的知识库/笔记里搜"）→ search_knowledge_base / semantic_search.
- 列出目录/找文件：list_directory(recursive=true) lists the whole directory tree WITHOUT any open map. Export/read a .smm by path: export_mindmap_html(file_path=), export_to_markdown(file_path=), read_mindmap_file(filePath=) — all work WITHOUT opening the file in the app.

## RULES
- Batch in ONE call. Never loop select_node+edit. Use batch_node_actions for multi-node ops. Feishu multi-file ops use array params in ONE call: feishu_delete_file(items=[{fileToken,fileType}]), feishu_rename_file(items=[{fileToken,newName,fileType}]), feishu_get_doc_content(docTokens=[...]).
- Multi-step: emit <plan> first, then <step-done>N after each. Never skip/reorder.
- Use DEDICATED tools: delete_node, insert_parent_node, batch_move_nodes, merge_nodes, outer_frame — do NOT simulate with expand_node/update_node_text.
- Editing an EXISTING map: modify in-place (update_node_text / batch_node_actions / delete_node / merge_nodes). NEVER regenerate with generate_mindmap (writes a new file; only for pasted/new content).
- Review tasks: get_today_review_status / get_review_schedule / complete_review_task / add_to_review. Never search nodes for review questions.
- ai_recite_rewrite for recitation. ai_quiz / ai_quiz_append for quizzes. mechanical_cloze for exact-text cloze. ai_cloze for smart keyword cloze.
- find_local_file returns absolute paths; open found files directly. merge_mindmap_files reads source in background. rename_mindmap_file in place. list_directory for folder listing.
- MCP: list_mcp_servers → list_mcp_tools → mcp_call_tool. Skills: list_skills / invoke_skill / create_skill (only after success).
- Include returned filePath in reply when a tool creates/renames/exports a file. Verify results; retry ≤2 on failure.
- Include returned filePath in reply when a tool creates/renames/exports a file. Verify results; retry ≤2 on failure.

## REMINDER INTENT（review #2）：当用户说「提醒我 X」「明天/3 小时后做 Y」「每天/每周 X」时，立刻调用 scheduled_task(action="create", datetime="YYYY-MM-DD HH:mm", name=..., prompt=..., cycle=...)。周期值：once / daily / weekly / monthly。datetime 必须是 24 小时制（YYYY-MM-DD HH:mm），不要传相对时间词。

## QUERY (use query_nodes, not repeated search_nodes+query_node_styles)
- query_nodes supports filters: textContains, textNotContains, textRegex, hasCloze, clozeContains, hasStyle, isLeaf, minDepth/maxDepth. Returns uid, plainText, path, clozeWords, depth.
- For "find nodes matching X and do Y": query_nodes(filters: {...}) → batch_node_actions(steps:[{targets:{uids}, condition:{...}, ...}]).
- batch_node_actions steps support condition: {textContains, textRegex, hasCloze, hasStyle} — filters nodes BEFORE applying ops.
- clear_cloze supports before/after: clear_cloze(targets:{mode:"all"}, before:"：") clears cloze only before the delimiter.

## CONTEXT
- 【拖入文件｜路径：xxx】→ retrieve_local_file (questions) or read_local_file (full text).
- 【引用节点｜uid=xxx】→ apply directly, don't re-search.
- Pasted content → generate_mindmap.
- memory(action=save) only for stable long-term preferences ("remember…", "always…").

## DOC READING (summarize a section/chapter → mindmap)
- One retrieve_local_file call is usually enough: it returns top relevant chunks covering the topic. Do NOT call retrieve repeatedly on the SAME file with slightly changed keywords — reuse the first result.
- File path wrong ("not found")? The tool auto-searches by filename; if it still fails, call find_local_file(keyword=basename) once, then use the exact returned path.
- Scanned/no-text PDF: retrieve returns a "no text layer" hint → use read_local_file (OCR fallback) instead.
- No table of contents? Use retrieve_local_file with the section title as query; do not assume a TOC exists.`

const buildSystemPromptWithSkills = async (basePrompt) => {
  try {
    const skills = await window.electronAPI?.skills?.list?.() || []
    const active = skills.filter(s => s.enabled && s.autoInvoke)
    if (!active.length) return basePrompt
    const lines = active.map((s, i) => `${i + 1}. ${s.name}（id=${s.id}）：${s.description || '无描述'}`).join('\n')
    return `${basePrompt}\n\n## ACTIVE SKILLS\nThese saved skills are relevant when their description matches the user request. When applicable, call invoke_skill(skillId) and follow the returned instructions strictly.\n${lines}`
  } catch {
    return basePrompt
  }
}

const MANUAL_COMPRESS_RE = /^(压缩对话|压缩上下文|总结对话|整理对话|压缩一下|\/compress|\/summary)$/

// 每段目标 token 上限（低于此值不分段，一次总结完，省调用费）
const SEGMENT_TOKEN_LIMIT = 10000
// 分段总结的并行度上限（分批执行，避免同时打满供应商并发限制）
const SEGMENT_CONCURRENCY = 3

// 截断文本
const firstN = (s, n) => {
  const str = String(s || '').trim()
  return str.length > n ? str.slice(0, n) + '…' : str
}

// 工具结果 → 简短摘要（剥离巨型图片数据，只留关键信息）
const briefFromResult = (result) => {
  if (!result) return ''
  try {
    if (typeof result === 'string') return firstN(result, 120)
    const obj = { ...result }
    delete obj.imageData
    return firstN(String(obj.message || JSON.stringify(obj)), 120)
  } catch { return '' }
}

// 工具调用记录 → 单行文本（保留：工具名、关键参数、成败状态、关键返回值/失败原因）
const toolCallLine = (tc) => {
  const statusMap = { done: '成功', error: '失败', stopped: '被取消', calling: '进行中' }
  const status = statusMap[tc.status] || tc.status
  const brief = tc.status === 'error'
    ? (tc.errorBrief ? `：${tc.errorBrief}` : '')
    : (tc.status === 'done' && tc.resultBrief ? `：${tc.resultBrief}` : '')
  return `[工具] ${tc.displayName || tc.name}(${tc.summary || ''}) → ${status}${brief}`
}

// 已实施的失败工具结果不应污染后续上下文：真正执行成功过/有实质回复的消息保留；
// 仅是一句“目标解析失败/JSON 异常/请重试”且无任何成功工具的临时失败消息，从发送给模型的上下文中剔除。
// review B1：原规则 `content.length > 300` 会把 AI 短回复（结构化表格往往 < 300字）误判为"无效短回复"丢弃，
// 导致用户说"用 markdown 表格输出"时，AI 上一轮的表格被丢了 → 不结合上文。
// 新规则：只在 (a) 没有任何内容 + (b) 没有任何成功工具调用 + (c) 错误信息命中时才过滤。
const shouldKeepContextMessage = (m) => {
  if (!m || m.role !== 'assistant') return true
  const tcs = m.toolCalls || []
  // 有任何成功的工具调用 → 必须保留（记录 AI 做了什么）
  if (tcs.some(tc => tc.status === 'done')) return true
  const content = String(m.content || '').trim()
  // 有文本内容（无论长短）→ 保留（用户的"结构化表格 / 短答案"都依赖上下文中的 AI 输出）
  if (content) return true
  // 都没内容也没成功工具调用 → 真的可以过滤
  return !/(目标节点解析失败|未找到对应 uid|格式异常|无法解析|没有可.*目标|没有目标节点|请重试|AI 出题失败|整理导图失败|工具.*失败)/.test(content)
}

// 消息数组 → 待总结的历史文本（用户消息 / AI 回复 + 工具调用记录）
const buildHistoryText = (msgs) => msgs.map(m => {
  if (m.role === 'user') return `用户：${m.content || ''}`
  const lines = []
  if (m.content) lines.push(`AI：${m.content}`)
  for (const tc of m.toolCalls || []) lines.push(toolCallLine(tc))
  return lines.join('\n') || 'AI：（无文本回复）'
}).join('\n\n')

// 按轮次边界分段：以 user 消息为段起点，累计 token 超上限时切新段（不把一轮对话切成两半）
const splitSegments = (msgs, limit) => {
  const segs = []
  let cur = []
  let curTokens = 0
  for (const m of msgs) {
    const t = estimateTokens(m.content || '') +
      estimateTokens((m.toolCalls || []).map(c => `${c.summary || ''}${c.errorBrief || ''}${c.resultBrief || ''}`).join(''))
    if (m.role === 'user' && cur.length > 0 && curTokens + t > limit) {
      segs.push(cur)
      cur = []
      curTokens = 0
    }
    cur.push(m)
    curTokens += t
    // 单条消息本身超限：独立成段（无法再按轮次切，交给摘要模型或降级链处理）
    if (curTokens >= limit) {
      segs.push(cur)
      cur = []
      curTokens = 0
    }
  }
  if (cur.length) segs.push(cur)
  return segs
}

// 单段 AI 总结（独立无历史调用：只含本段文本，不带对话上下文）
const summarizeSegment = async (segText) => {
  const userMsg = `Summarize the following conversation segment precisely in Chinese. You MUST preserve:
1. User's explicit intent, decisions, and stated preferences (e.g. "use PNG not SMM", "save to desktop").
2. EVERY tool call: tool name, key arguments (file paths, UIDs, format, destination, style values), outcome (success/failure), and error details if failed. This is critical for continuity.
3. Important facts, file paths, node UIDs, generated content summaries, and any data returned by tools.
4. Unfinished tasks and pending next steps.
Be concise but do NOT omit tool records or key parameters. Output the summary body only, no preface.

---
${segText}`
  const choice = await aiService.chat(
    userMsg,
    'You are a precise conversation compressor for an AI mind-map assistant. Preserve tool calls, file paths, key parameters, and user intent verbatim where critical. Output only the summary body in Chinese.',
    null,
    { temperature: 0.1 }
  )
  const text = (choice?.message?.content || '').trim()
  if (!text) throw new Error('摘要为空')
  return text
}

// 规则式降级摘要（纯代码提取，不调 AI，永不失败）：用户消息截断保留、工具记录全保留
const ruleBasedSummary = (msgs) => firstN(
  msgs.map(m => {
    if (m.role === 'user') return `用户：${firstN(m.content, 120)}`
    const parts = []
    if (m.content) parts.push(`AI：${firstN(m.content, 120)}`)
    for (const tc of m.toolCalls || []) parts.push(toolCallLine(tc))
    return parts.join('\n')
  }).join('\n'),
  3000
)

// 汇总：分段摘要（+ 旧摘要）→ 最终摘要（独立无历史调用）
const finalReduce = async (segmentSummaries, existingSummary) => {
  const combined = segmentSummaries.map((s, i) => `【Segment ${i + 1}】\n${s}`).join('\n\n')
  const userMsg = existingSummary
    ? `You have an existing conversation summary AND new segment summaries from later parts of the conversation. Merge them into ONE coherent final summary in Chinese.

Existing summary:
${existingSummary}

New segment summaries:
${combined}

Rules:
- Preserve ALL tool call records (tool name, key args, success/failure, file paths, UIDs).
- Preserve user's explicit decisions, preferences, and intents.
- Preserve file paths, generated artifacts, and important facts.
- Note unfinished tasks clearly.
- Deduplicate redundant information but never drop tool records.
- Output the final summary body only, max 800 Chinese characters.`
    : `Merge the following segment summaries into ONE coherent final summary in Chinese.

Segments:
${combined}

Rules:
- Preserve ALL tool call records (tool name, key args, success/failure, file paths, UIDs).
- Preserve user's explicit decisions, preferences, and intents.
- Preserve file paths, generated artifacts, and important facts.
- Note unfinished tasks clearly.
- Output the final summary body only, max 800 Chinese characters.`
  const choice = await aiService.chat(
    userMsg,
    'You are a precise conversation compressor. Preserve tool records, file paths, and user intent. Output only the merged summary in Chinese.',
    null,
    { temperature: 0.1 }
  )
  const text = (choice?.message?.content || '').trim()
  if (!text) throw new Error('汇总摘要为空')
  return text
}

// 压缩编排（map-reduce + 动态降级）：
// 分批并行总结 → 失败段串行重试一次 → 仍失败用规则式摘要 → 汇总失败直接拼接分段摘要
const compressHistory = async (compressMsgs, existingSummary) => {
  const segs = splitSegments(compressMsgs, SEGMENT_TOKEN_LIMIT)

  // 单段：一次 AI 总结，失败降级规则式
  if (segs.length <= 1) {
    try {
      return await summarizeSegment(buildHistoryText(compressMsgs))
    } catch {
      return ruleBasedSummary(compressMsgs)
    }
  }

  const texts = segs.map(buildHistoryText)
  const summaries = new Array(segs.length).fill(null)
  // 分批并行：allSettled 保证单段失败不拖垮整批
  for (let start = 0; start < texts.length; start += SEGMENT_CONCURRENCY) {
    const batch = texts.slice(start, start + SEGMENT_CONCURRENCY)
    const results = await Promise.allSettled(batch.map(t => summarizeSegment(t)))
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') summaries[start + i] = r.value
    })
  }
  // 失败段：串行重试一次
  for (let i = 0; i < summaries.length; i++) {
    if (!summaries[i]) {
      try { summaries[i] = await summarizeSegment(texts[i]) } catch { summaries[i] = null }
    }
  }
  // 仍失败：规则式降级摘要（保证每段都有产物，流程永不中断）
  for (let i = 0; i < summaries.length; i++) {
    if (!summaries[i]) {
      summaries[i] = `（本段 AI 总结失败，规则式提取）\n${ruleBasedSummary(segs[i])}`
    }
  }
  // 汇总：AI 合并；失败则直接拼接分段摘要（旧摘要置顶）
  try {
    return await finalReduce(summaries, existingSummary)
  } catch {
    return (existingSummary ? `${existingSummary}\n\n` : '') +
      summaries.map((s, i) => `【第${i + 1}段】\n${s}`).join('\n\n')
  }
}

// 按"保留最近 N 轮"分割历史：返回 { keep（保留原文）, compress（要压进摘要的）}
// review B2：识别"高信息密度"的结构化内容（markdown 表格 / 围栏代码块 / 标题）。
// 这些内容被压成摘要后会严重失真（用户问"用表格再输出"时 AI 拿不到原表格），
// 因此纳入"绝不压缩"白名单：splitHistoryForCompress 会把这些消息从压缩区抠出来。
const hasStructuredContent = (m) => {
  if (!m || m.role !== 'assistant') return false
  const c = String(m.content || '')
  if (!c) return false
  // markdown 表格（|...|）、围栏代码块（```）、多级标题（## / ###）、长列表（连续 5+ 行以 - 或 1. 开头）
  return /\|.+\|.+\|/.test(c) || /```[\s\S]+```/.test(c) || /\n#{1,4}\s+/.test(c) || (c.match(/^\s*(?:[-*]|\d+\.)\s+/gm) || []).length >= 5
}

// keepRounds 参数：自动压缩用 KEEP_RECENT_ROUNDS(12)，手动压缩用更激进的3轮
const splitHistoryForCompress = (history, keepRounds = KEEP_RECENT_ROUNDS) => {
  const userIndices = []
  history.forEach((m, i) => { if (m.role === 'user') userIndices.push(i) })
  if (userIndices.length <= keepRounds) {
    // 轮数不够：如果有超过1轮用户消息，保留最近1轮，其余全部压缩（兜底处理单条消息超大的情况）
    if (userIndices.length > 1) {
      const cut = userIndices[userIndices.length - 1]
      return { keep: history.slice(cut), compress: history.slice(0, cut), forced: true }
    }
    return { keep: history, compress: [] }
  }
  // review B2：基础分界 = 最近 keepRounds 轮原文。但还要把"结构化内容"（被压缩区里的表格/代码块）抠出来保留。
  const cut = userIndices[userIndices.length - keepRounds]
  const baseKeep = history.slice(cut)
  const baseCompress = history.slice(0, cut)
  // 在压缩区里找结构化 assistant 消息，把它们搬到 keep区尾部（保证 AI 下轮能看到）
  const structuredFromCompress = []
  const remainingCompress = []
  for (const m of baseCompress) {
    if (hasStructuredContent(m)) {
      structuredFromCompress.push(m)
    } else {
      remainingCompress.push(m)
    }
  }
  return {
    keep: [...baseKeep, ...structuredFromCompress],
    compress: remainingCompress
  }
}

// 发送给 API 的消息只保留 role/content。工具调用的结果摘要合并进 assistant 文本，
// 保证后续轮次模型仍能看到自己之前工具做了什么（否则纯工具轮会被剥离导致失忆）。
const toWireMessages = (msgs) => msgs
  .filter(m => m.role === 'user' || (m.content !== undefined && m.content !== null && m.content !== '') || (Array.isArray(m.toolCalls) && m.toolCalls.length > 0))
  .map(m => {
    if (m.role === 'assistant' && Array.isArray(m.toolCalls) && m.toolCalls.length > 0) {
      const toolLines = m.toolCalls
        .filter(tc => tc.status === 'done' || tc.status === 'error')
        .map(tc => {
          const name = tc.displayName || tc.name || '工具'
          const brief = tc.status === 'error' ? (tc.errorBrief || '失败') : (tc.resultBrief || tc.summary || '完成')
          return `[工具 ${name}：${brief}]`
        })
        .filter(Boolean)
      if (toolLines.length > 0) {
        const content = m.content || ''
        return { role: m.role, content: content ? `${content}\n${toolLines.join('\n')}` : toolLines.join('\n') }
      }
    }
    return { role: m.role, content: m.content }
  })

// 核心：估算上下文体积，超阈值则增量压缩；返回最终要发送的历史消息数组
// 缓存友好设计（滑动窗口）：水位线之前的消息整块跳过不再发送，请求前缀 [system, 摘要] 逐字节稳定；
// 只有水位线推进（新一次压缩）时前缀才变化一次，其余轮次全部追加式增长
// 用户提问改写：识别意图、规范化、补全上下文，让后续主 AI 更稳定地理解用户真正要做什么
const rewriteUserQuestion = async (question) => {
  const q = String(question || '').trim()
  if (!q) return question
  // 短指令（如"加粗""保存""全部挖空"）意图已明确：跳过改写，省一整轮 LLM 往返
  if (q.length <= 16) return q
  const sys = '你是用户意图识别与问题规范化专家。把用户原话改写为一条意图清晰、完整、可直接执行的指令，供后续 AI 使用。'
  const usr = '请改写下面这条用户提问。要求：\n1. 准确识别用户真正想干什么（提问 / 修改导图 / 生成内容 / 导出 / 检索 / 其它），不要臆测。\n2. 补全省略的主语、对象、目标文件或节点、期望结果，但不得编造原文没有的信息。\n3. 去掉口语化与歧义，规范化、全面化表达；如含多个诉求，拆成明确的几条。\n4. 保持原意不变，只输出改写后的内容，不要解释、不要前缀。\n\n用户原话：\n' + q
  const choice = await aiService.chat(usr, sys, null, { temperature: 0.1, max_tokens: 150 })
  const rewritten = String(choice?.message?.content || '').trim()
  return rewritten || q
}

const buildContextMessages = async (history, systemPrompt, activeTools) => {
  const window = getContextWindow(currentModelName.value)
  const threshold = window * COMPRESS_THRESHOLD_RATIO
  // 滑动窗口：只考虑水位线之后未压缩的消息
  const covered = Math.min(summaryCoveredCount.value, history.length)
  let uncovered = history.slice(covered)
  // 固定开销：system prompt + 摘要 + 工具定义（核心工具schema）+ 响应预留(~2K tokens)
  const toolsTokens = estimateToolsTokens(activeTools || [])
  const RESPONSE_RESERVE = 2000
  const baseTokens = estimateTokens(systemPrompt + '\n' + (conversationSummary.value || '')) + toolsTokens + RESPONSE_RESERVE

  const buildResult = (sum, msgs) => sum
    ? [{ role: 'system', content: `【对话历史摘要】\n${sum}` }, ...toWireMessages(msgs)]
    : toWireMessages(msgs)

  const estimateWith = (msgs) => baseTokens + estimateTokens(msgs.map(m => m.content || '').join('\n'))

  if (estimateWith(uncovered) <= threshold) {
    return buildResult(conversationSummary.value, uncovered)
  }

  // 迭代压缩：8 → 5 → 3 → 1轮逐级减少，直到压到阈值内
  let currentSummary = conversationSummary.value
  let currentCovered = covered
  const tryRounds = [KEEP_RECENT_ROUNDS, 5, 3, 1]
  for (const rounds of tryRounds) {
    const { keep, compress } = splitHistoryForCompress(uncovered, rounds)
    if (compress.length === 0) break
    currentSummary = await compressHistory(compress, currentSummary)
    currentCovered += compress.length
    uncovered = keep
    if (estimateWith(uncovered) <= threshold) break
  }
  // 最终兜底：如果仍超阈值，强制只保留最近1轮（再不行就只剩当前问题）
  if (estimateWith(uncovered) > threshold && uncovered.length > 2) {
    uncovered = uncovered.slice(-2)
  }
  conversationSummary.value = currentSummary
  summaryCoveredCount.value = currentCovered
  if (currentConversation.value) {
    currentConversation.value.summary = currentSummary
    currentConversation.value.summaryCoveredCount = currentCovered
  }
  return buildResult(currentSummary, uncovered)
}

// 手动压缩：把超出最近 N 轮的历史压成摘要（无论是否超阈值）
const manualCompress = async () => {
  // 手动压缩：剥离动态注入块（同发送逻辑），保留最近3轮原文，其余全部压缩
  // 手动压缩是用户明确要求，即使只有2-3轮也强制保留最近1轮压缩其余，解决"发不出去却提示太短"的问题
  const history = messages.value
    .filter(m => (m.role === 'user' || (m.role === 'assistant' && (m.content || (m.toolCalls && m.toolCalls.length)))) && shouldKeepContextMessage(m))
    .map(m => ({ role: m.role, content: m.role === 'user' ? stripDynamicContext(m.content) : m.content, toolCalls: m.toolCalls }))
  const covered = Math.min(summaryCoveredCount.value, history.length)
  let uncovered = history.slice(covered)
  // 手动压缩保留3轮（比自动压缩更激进），不够3轮时保留最近1轮
  const { keep, compress } = splitHistoryForCompress(uncovered, 3)
  if (compress.length === 0) {
    // 仍无可压缩内容：说明只有1轮以内对话，确实不需要压缩
    ElMessage.info('当前对话还比较短，暂不需要压缩')
    return
  }
  aiStatus.value = 'thinking'
  emit('tool-call-status', 'thinking')
  try {
    const newSummary = await compressHistory(compress, conversationSummary.value)
    conversationSummary.value = newSummary
    summaryCoveredCount.value = covered + compress.length
    if (currentConversation.value) {
      currentConversation.value.summary = newSummary
      currentConversation.value.summaryCoveredCount = summaryCoveredCount.value
    }
    persistConversation()
    addLog('compress', `对话压缩完成，摘要 ${newSummary.length} 字`, {}, currentConversation.value?.id)
    emit('log-updated')
    ElMessage.success('对话已压缩：更早的内容已汇总为摘要')
  } catch (e) {
    ElMessage.error('压缩失败: ' + e.message)
  } finally {
    aiStatus.value = 'idle'
    emit('tool-call-status', 'idle')
  }
}

const sendMessage = async (overrideText = null) => {
  // overrideText 可能是事件对象（来自 @click/@keydown），需过滤
  const rawText = (typeof overrideText === 'string') ? overrideText : inputText.value
  let text = rawText.trim()
  const refs = attachedRefs.value.slice()
  const files = attachedFiles.value.slice()
  const skills = attachedSkills.value.slice()
  const mcps = attachedMcps.value.slice()
  const tools = attachedTools.value.slice()
  // Skill 沉淀流程：点击“Skill”按钮后进入的要求输入，不当作普通聊天发送。
  if (pendingSkillDistill) {
    pendingSkillDistill = false
    inputText.value = ''
    if (textareaRef.value) textareaRef.value.style.height = 'auto'
    await runSkillDistill(text)
    return
  }
  // 手动压缩指令：输入"压缩对话"等直接触发压缩，不发消息给 AI
  if (MANUAL_COMPRESS_RE.test(text) && refs.length === 0 && files.length === 0) {
    inputText.value = ''
    if (textareaRef.value) textareaRef.value.style.height = 'auto'
    await manualCompress()
    return
  }
  if (!text && refs.length === 0 && files.length === 0 && skills.length === 0 && mcps.length === 0 && tools.length === 0) return
  // thinking（AI 输出中）与 calling（工具执行中）：加入发送队列，回复完成后自动逐条发送
  if (aiStatus.value === 'thinking' || aiStatus.value === 'calling') {
    messageQueue.value.push({ text, refs, files, skills, mcps, tools })
    inputText.value = ''
    attachedRefs.value = []
    attachedFiles.value = []
    attachedSkills.value = []
    attachedMcps.value = []
    attachedTools.value = []
    if (textareaRef.value) textareaRef.value.style.height = 'auto'
    ElMessage.info(`已加入发送队列（第 ${messageQueue.value.length} 条），当前回复完成后自动发送`)
    return
  }

  // AI 续写提问等待中：输入内容作为提问的回答，不发送给 AI（内部哨兵值不拦截）
  if (pendingContinue.value && text && text !== '__CANCEL__') {
    // 先显示用户消息，再交给提问流程（避免 AI 追问消息排在用户回答之前）
    messages.value.push({
      id: genMsgId(),
      role: 'user',
      content: text
    })
    if (submitContinueAnswer(text)) {
      inputText.value = ''
      if (textareaRef.value) {
        textareaRef.value.style.height = 'auto'
      }
      scrollToBottom(true)
      persistConversation()
      return
    }
    // 异常兜底：未被消费则回退刚显示的用户消息，走正常发送流程
    messages.value.pop()
  }

  // 引用胶囊/文件胶囊：消息列表显示简洁摘要，发送给 AI 的内容展开为完整上下文（文件路径 / 节点结构）
  const refsContext = refs.map(r => r.context).join('\n')
  // 拖入的 .smm 导图文件：自动读取大纲文本注入，让 AI 第一轮即可定位内容，无需再调 read_mindmap_file
  const fileContextParts = []
  for (const f of files) {
    const ext = (f.ext || '').toLowerCase()
    if (ext === '.smm' && window.electronAPI?.fs?.readFile) {
      try {
        const raw = await window.electronAPI.fs.readFile(f.path)
        if (raw) {
          const tree = JSON.parse(raw)
          const outline = treeToText(tree)
          fileContextParts.push(`【拖入文件｜路径：${f.path}】\n文件内容（导图大纲）：\n${String(outline).slice(0, 8000)}`)
          continue
        }
      } catch { /* 读取失败回退为路径标记 */ }
    }
    fileContextParts.push(`【拖入文件｜路径：${f.path}】`)
  }
  const filesContext = fileContextParts.join('\n')
  const clipContext = (text, max = 1200) => {
    const s = String(text || '').trim()
    return s.length > max ? `${s.slice(0, max)}\n…（内容过长已截断，需要完整指令时用 get_skill/invoke_skill 按 id 读取）` : s
  }
  const skillsContext = skills.length
    ? `【已选用 Skill】\n${skills.map(s => `@${s.name}（id=${s.id}）\n${clipContext(s.instructions, 1200)}`).join('\n\n')}`
    : ''
  const mcpsContext = mcps.length
    ? `【已选择的 MCP 服务】\n${mcps.map(m => `#${m.name}${m.description ? '：' + clipContext(m.description, 500) : ''}`).join('\n')}`
    : ''
  const toolsContext = tools.length
    ? `【已引用工具】\n${tools.map(t => `/${t.name}${t.description ? '：' + clipContext(t.description, 500) : ''}`).join('\n')}`
    : ''
  const contextParts = []
  if (filesContext) contextParts.push(filesContext)
  if (refsContext) contextParts.push(refsContext)
  if (skillsContext) contextParts.push(skillsContext)
  if (mcpsContext) contextParts.push(mcpsContext)
  if (toolsContext) contextParts.push(toolsContext)
  // 用户已通过 / @ # 显式引用工具/技能/MCP：要求 AI 首要使用它们执行，而不是自行另选方案
  if (toolsContext || skillsContext || mcpsContext) {
    contextParts.push('【执行优先级】用户已通过 /（工具）、@（技能）、#（MCP）显式引用了上述内容，请首要使用它们完成需求，不要忽略引用另选方案。')
  }
  const fullContent = contextParts.length ? `${contextParts.join('\n')}\n${text}` : text
  // 引用/文件均以原子胶囊展示（消息列表），content 仅保留用户文字；完整上下文仍通过 fullContent 发送给 AI
  const displayContent = text

  // 添加用户消息
  const userMsg = {
    id: genMsgId(),
    role: 'user',
    content: displayContent
  }
  // 引用节点：随消息附带原子胶囊数据（uid 用于点击定位到导图节点）
  if (refs.length) {
    userMsg.refs = refs.map(r => ({
      id: r.id,
      uid: r.uid,
      fileName: r.fileName,
      label: r.label,
      kindLabel: r.kindLabel,
      title: r.title
    }))
  }
  if (skills.length) {
    userMsg.skills = skills.map(s => ({ id: s.id, name: s.name, description: s.description }))
  }
  if (mcps.length) {
    userMsg.mcps = mcps.map(m => ({ id: m.id, name: m.name, description: m.description }))
  }
  if (tools.length) {
    userMsg.tools = tools.map(t => ({ id: t.id, name: t.name, description: t.description }))
  }

  // 带图/带文档消息处理：多模态启用且配置完整 → 文件走 files API 直发多模态配置档；否则图片后台本地 OCR，识别结果随消息一起发给大模型（不写入输入框）
  const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp']
  const DOC_EXTS = ['.pdf', '.docx', '.xlsx', '.pptx', '.txt', '.md', '.csv']
  const DOC_MIME = {
    pdf: 'application/pdf',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    txt: 'text/plain',
    md: 'text/markdown',
    csv: 'text/csv'
  }
  const imageFiles = files.filter(f => IMAGE_EXTS.includes((f.ext || '').toLowerCase()))
  const docFiles = files.filter(f => DOC_EXTS.includes((f.ext || '').toLowerCase()))
  let visionOverride = null
  let visionModelName = ''
  let ocrContext = ''
  if (imageFiles.length > 0 || docFiles.length > 0) {
    if (window.electronAPI && window.electronAPI.getVisionConfig) {
      try {
        const vc = await window.electronAPI.getVisionConfig()
        if (vc && vc.available && vc.baseURL && vc.model) {
          visionOverride = { baseURL: vc.baseURL, profileId: vc.profileId || '', model: vc.model, autoComplete: vc.autoComplete !== false, filesURL: vc.filesURL || '' }
          visionModelName = vc.model
        }
      } catch (e) { /* 查询失败按未启用处理，走 OCR */ }
    }
    if (!visionOverride) {
      ocrContext = await ocrImageFiles(imageFiles)
      addLog('ocr', `多模态未启用，已后台本地 OCR 识别 ${imageFiles.length} 张图片，识别结果随消息发送`, {
        images: imageFiles.map(f => f.path)
      }, currentConversation.value?.id)
      emit('log-updated')
    }
  }
  // 附件随消息展示：图片读为 base64 缩略（点击可放大/双击打开），其他文档保留路径胶囊（点击开文件夹/双击打开）
  if (files.length > 0) {
    userMsg.files = files
      .filter(f => !IMAGE_EXTS.includes((f.ext || '').toLowerCase()))
      .map(f => ({ path: f.path, fileName: f.fileName, ext: f.ext }))
    if (imageFiles.length > 0 && window.electronAPI?.fs?.readBinary) {
      const imagesForMsg = []
      for (const f of imageFiles.slice(0, 9)) {
        try {
          const r = await window.electronAPI.fs.readBinary(f.path)
          if (r && r.success && r.base64) {
            const mime = `image/${(f.ext || 'png').replace('.', '').replace('jpg', 'jpeg')}`
            imagesForMsg.push({ path: f.path, name: f.fileName, src: `data:${mime};base64,${r.base64}` })
          }
        } catch (e) { /* 读取失败跳过，不影响发送 */ }
      }
      if (imagesForMsg.length > 0) userMsg.images = imagesForMsg
    }
  }
  messages.value.push(userMsg)
  scrollToBottom()

  const sendModelName = visionModelName || currentModelName.value
  // 发送给 AI 的最终文本：拖入/引用上下文 + 用户文字 +（多模态未启用时的）OCR 识别结果
  const contentForAI = ocrContext ? `${fullContent}\n\n（以下为图片本地 OCR 识别结果，供回答参考）\n\n${ocrContext}` : fullContent

  // 记录发送日志
  addLog('send', fullContent, { model: sendModelName }, currentConversation.value?.id)
  emit('log-updated')

  inputText.value = ''
  attachedRefs.value = []
  attachedFiles.value = []
  attachedSkills.value = []

  if (textareaRef.value) {
    textareaRef.value.style.height = 'auto'
  }

  aiStatus.value = 'thinking'
  emit('tool-call-status', 'thinking')
  stopRequested.value = false
  // 新一轮运行：旧一轮（停止后未退出的循环）的回调从此全部过期
  const runToken = nextRunToken()
  resetWebSearchTask(`task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`)
  // [第一仗·止血] 绑定本次任务的目标文件：发起时当前文件路径快照，任务全程不变。
  // toolHandler 执行写工具前校验"当前文件仍 === 此值"，切走则拒绝，防跨文件误改。
  useMindMapStore().setActiveTaskFileId(props.currentFilePath || '')
  scrollToBottom(true)

  try {
    // 获取记忆内容
    const memoryContent = loadMemory()

    // 当前文件信息
    const fileInfo = props.currentFilePath
      ? `当前打开的文件：${props.currentFileName}（路径：${props.currentFilePath}）`
      : '当前没有打开任何文件。'

    // 系统提示词（精简英文铁律；工具发现与参数 schema 由 activate_tools 按需返回）
    // 每次一字不差 → 最大化前缀缓存命中
    let systemPrompt = await buildSystemPromptWithSkills(SYSTEM_PROMPT)

    // 动态上下文（日期/当前文件/导图信息/记忆）拼到最后一问末尾而非 system 头部
    let dynamicContext = `\n\n## Current time\nToday is ${(() => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') })()}. Use this date for time references.\n\n## Current file\n${fileInfo}`

    // 导图内容按需注入：默认只给文件信息+节点数+骨架（前2层），完整内容由AI主动调用get_mindmap_content获取
    // 避免每轮发送完整导图文本导致token爆炸
    if (props.mindMap && props.currentFilePath) {
      const data = props.mindMap.getData()
      const nodeCount = countNodes(data)
      const skeleton = treeToSkeletonText(data, 2) // 只取前2层骨架
      dynamicContext += `\n\n## Current mind map (file: ${props.currentFileName})\n- Total nodes: ${nodeCount}\n- Skeleton (top 2 levels):\n${skeleton || '(empty)'}\n- To read full map content, call get_mindmap_content(mode="full"); to query specific nodes call search_nodes(keyword="...") or focus_node.`
    }

    // 当前选中节点摘要：AI 无需查询即知作用目标（提示词 PIPELINE 第2步 b 证据来源）
    try {
      const sel = (props.mindMap?.renderer?.activeNodeList || []).filter(n => n && !n.isGeneralization)
      if (sel.length > 0) {
        const shown = sel.slice(0, 10).map((n, i) => {
          const t = (extractNodeText(n) || '').replace(/\s+/g, ' ').slice(0, 40)
          const uid = n.getData?.('uid') || n.data?.uid || n.uid || ''
          return `${i + 1}. "${t}"${uid ? ` (uid: ${uid})` : ''}`
        }).join('\n')
        dynamicContext += `\n\n## Current selection (${sel.length} node${sel.length > 1 ? 's' : ''}, user-selected)\n${shown}${sel.length > 10 ? '\n... (more omitted)' : ''}\nTools without explicit targets act on these selected nodes.`
      }
    } catch { /* 选中态读取失败不影响对话 */ }

    if (memoryContent && memoryContent.trim()) {
      dynamicContext += `\n\n## Permanent memory (strictly follow)\n${memoryContent}`
    }

    // 长期记忆（save_memory 工具写入的跨会话记忆）
    const aiMemoryContent = formatMemoryText()
    if (aiMemoryContent && aiMemoryContent.trim()) {
      dynamicContext += `\n\n## User long-term memory\n${aiMemoryContent}\n(Follow naturally; only save_memory when user explicitly states long-term preferences/facts.)`
    }

    // 用户直接粘贴完整导图 JSON/Markdown 数据时，明确告诉模型这是本次任务的显式数据源，
    // 不要再去询问“先打开文件”，也不要把它当历史消息忽略；同时必须判断格式是否合法。
    const looksLikeMindMapJson = /"smmVersion"\s*:|"root"\s*:\s*\{|"theme"\s*:\s*\{/.test(fullContent)
    const looksLikeMindMapMarkdown = /(^|\n)#{1,6}\s+\S/.test(fullContent) && /(^|\n)\s*[-*+]\s+\S/.test(fullContent)
    if (looksLikeMindMapJson || looksLikeMindMapMarkdown) {
      dynamicContext += `\n\n## Pasted mindmap data detected\nThe user pasted data in this message. Treat it as EXPLICIT context/source, but ALWAYS follow the user's actual request: only create/save a mindmap if the user asked to create/save one; otherwise analyze, edit, summarize, or answer based on it. Before using it, validate whether the data is well-formed JSON/outline/Markdown. If invalid, incomplete, or ambiguous, ask the user to correct or complete it.`
    }

    // 知识库模式：把左侧目录树内所有已索引文件作为严格证据注入；找不到时明确告知模型不要编造
    if (knowledgeMode.value && fullContent.trim()) {
      knowledgeLoading.value = true
      try {
        const kb = await retrieveKnowledgeForQuestion(fullContent)
        if (kb.error) {
          dynamicContext += `\n\n## Knowledge base\n${kb.error}`
        } else if (kb.results.length > 0) {
          dynamicContext += `\n\n## Knowledge base (STRICT SOURCE)\nYou are in knowledge-base mode. Answer ONLY using the retrieved content below, and cite [KB编号] for each claim. If the retrieved content is insufficient, say clearly that the knowledge base does not contain enough information; do NOT use outside knowledge.\n${kb.context}`
        } else {
          dynamicContext += `\n\n## Knowledge base\n检索完成，但知识库中没有找到与问题相关的内容。请直接回答：知识库中没有找到相关内容，不要编造。`
        }
      } catch (e) {
        dynamicContext += `\n\n## Knowledge base\n知识库检索失败：${e.message || '未知错误'}。请告知用户检索失败，不要编造知识库内容。`
      } finally {
        knowledgeLoading.value = false
      }
    }

    // 用户提问改写：识别意图、规范化，让后续主 AI 更稳定理解用户要做什么（失败或未变化则用原文）
    let contentWithRewrite = contentForAI
    if (text && text.trim()) {
      try {
        const rewritten = await rewriteUserQuestion(contentForAI)
        if (rewritten && rewritten !== contentForAI) {
          contentWithRewrite = `${contentForAI}\n\n【意图规范化改写（供执行参考，以原始问题为准）】\n${rewritten}`
        }
      } catch (e) { /* 改写失败不影响主流程 */ }
    }

    // 最后一问最终文本：引用/文件/OCR 上下文 +（含改写后的）用户文字 + 动态上下文
    const finalUserText = contentWithRewrite + dynamicContext

    // AI 回复消息占位
    const aiMsg = {
      id: genMsgId(),
      role: 'assistant',
      content: '',
      toolCalls: []
    }
    messages.value.push(aiMsg)

    let fullResponse = ''

    // 构建消息列表（当前对话的上下文；toolCalls 供压缩时保留工具成败记录，发送前会被剥离）
    // 历史 user 消息剥离动态注入块（时间/文件/导图内容/记忆）——这些每轮都不同且重复累积是 token 爆炸主因；
    // 最后一条会被 finalUserText 覆盖为最新动态内容，不受剥离影响
    const historyMsgs = messages.value
      .filter(m => (m.role === 'user' || (m.role === 'assistant' && (m.content || (m.toolCalls && m.toolCalls.length)))) && shouldKeepContextMessage(m))
      .map(m => ({ role: m.role, content: m.role === 'user' ? stripDynamicContext(m.content) : m.content, toolCalls: m.toolCalls }))
    // 最后一条用户消息替换为展开后的完整上下文（消息列表仅显示摘要；含 OCR 结果与动态上下文）
    for (let i = historyMsgs.length - 1; i >= 0; i--) {
      if (historyMsgs[i].role === 'user') {
        historyMsgs[i].content = finalUserText
        break
      }
    }
    // 默认只注入核心工具集（其余通过 activate_tools 按需激活，allTools 作为动态工具池）
    const coreTools = getCoreTools()
    // 自动激活 / 引用的工具：把用户通过斜杠引用的工具直接注入 tools，AI 无需 activate_tools 即可调用
    if (attachedTools.value.length) {
      const existing = new Set(coreTools.map(t => t.function.name))
      const refIds = attachedTools.value.map(t => t.id).filter(Boolean)
      for (const def of aiTools) {
        if (refIds.includes(def.function.name) && !existing.has(def.function.name)) {
          coreTools.push(def)
        }
      }
    }

    // 增量摘要压缩：估算上下文体积，超过模型窗口50%时把更早历史压成摘要
    const compressedHistory = await buildContextMessages(historyMsgs, systemPrompt, coreTools)
    const messagesToSend = [
      { role: 'system', content: systemPrompt },
      ...compressedHistory
    ]

    // 多模态直发：最后一条 user 消息替换为 text+图片数组（历史消息保持纯文本，避免纯文本模型收到 image_url 报错）
    if (visionOverride && (imageFiles.length > 0 || docFiles.length > 0)) {
      const parts = []
      const uploadOne = async (f, mimeType) => {
        try {
          const r = await window.electronAPI.fs.readBinary(f.path)
          if (!r || !r.success || !r.base64) return null
          try {
            const up = await uploadFileForProvider({
              baseURL: visionOverride.baseURL,
              profileId: visionOverride.profileId,
              fileName: f.fileName || (f.path ? f.path.split(/[\\/]/).pop() : 'file'),
              mimeType,
              base64: r.base64,
              customFilesURL: visionOverride.filesURL || ''
            })
            if (up && up.success && up.ref) return up.ref
            // 上传失败：记录原因与地址便于排查
            addLog('tool_call', `工具: files API 上传 [files-api]\n原因: ${up?.error || '上传失败'}，降级 base64 直发\n上传地址: ${up?.uploadURL || '未知'}`, {}, currentConversation.value?.id)
            emit('log-updated')
          } catch (err) {
            addLog('tool_call', `工具: files API 上传 [files-api]\n原因: ${err?.message || '上传异常'}，降级 base64 直发`, {}, currentConversation.value?.id)
            emit('log-updated')
          }
          return { _fallbackBase64: r.base64 }
        } catch (err) { return null }
      }
      // 图片：files API 上传，失败降级 base64 直发
      let filesApiCount = 0
      for (const f of imageFiles.slice(0, 4)) {
        const e = (f.ext || '.png').replace('.', '').toLowerCase()
        const mime = e === 'jpg' ? 'jpeg' : e
        const part = await uploadOne(f, `image/${mime}`)
        if (!part) continue
        if (part._fallbackBase64) {
          parts.push({ type: 'image_url', image_url: { url: `data:image/${mime};base64,${part._fallbackBase64}` } })
        } else {
          parts.push(part)
          filesApiCount++
        }
      }
      // 文档：files API 上传（上传失败则跳过该文档，不强行 base64 直发）
      for (const f of docFiles.slice(0, 4)) {
        const ext = (f.ext || '').replace('.', '').toLowerCase()
        const mimeType = DOC_MIME[ext] || 'application/octet-stream'
        const part = await uploadOne(f, mimeType)
        if (!part || part._fallbackBase64) continue
        parts.push(part)
        filesApiCount++
      }
      if (parts.length > 0) {
        const viaText = filesApiCount > 0
          ? (filesApiCount === parts.length ? '已通过 files API 发送' : `${filesApiCount} 个已通过 files API 发送，其余 base64 直发`)
          : '本次以 base64 直发（files API 上传失败，详见运行日志）'
        const textPart = `${finalUserText}\n\n（本条消息附带 ${parts.length} 个文件，${viaText}。请直接查看文件/图片内容回答，无需再调用 read_local_file / retrieve_local_file 重复读取；文件路径见【拖入文件】标记，需要对文件执行其他操作时再调用工具）`
        for (let i = messagesToSend.length - 1; i >= 0; i--) {
          if (messagesToSend[i].role === 'user') {
            messagesToSend[i].content = [{ type: 'text', text: textPart }, ...parts]
            break
          }
        }
      }
    }

    // 记录完整请求日志（发送给 AI 的完整消息、工具、模型，不截断）
    // 图片 base64 数据体积巨大（截图可达数十万字符），日志中剥离为占位符，避免撑爆日志与上下文
    const stripBase64FromMessages = (msgs) => {
      const strip = (content) => {
        if (Array.isArray(content)) {
          return content.map(part => {
            if (part && typeof part === 'object' && part.type === 'image_url' && part.image_url?.url) {
              const url = String(part.image_url.url)
              const idx = url.indexOf('base64,')
              return { type: 'image_url', image_url: { url: idx >= 0 ? `data:image/[已省略 ${url.length - idx - 7} 字符 base64]` : url } }
            }
            return part
          })
        }
        return content
      }
      return msgs.map(m => ({ role: m.role, content: strip(m.content) }))
    }
    addLog('send', JSON.stringify({
      messages: stripBase64FromMessages(messagesToSend),
      tools: coreTools.map(t => t.function.name),
      model: sendModelName
    }, null, 2), { model: sendModelName }, currentConversation.value?.id)
    emit('log-updated')

    // AI 任务撤销快照：本轮开始前的完整导图节点树，结束后若画布有变化则挂到消息上供一键撤销
    const baselineSnapshot = captureMindMapSnapshot()
    const runStats = { startedAt: Date.now(), toolTimeMs: 0, toolCalls: 0, searchCalls: 0, failedEngines: [] }

    // 单次对话运行（多模态直发失败后，可用相同回调以 OCR 文本重发）
    let ocrFallbackTried = false
    let visionNoToolsTried = false
    let contextOverflowRetried = false
    const attemptChat = async (msgs, override, omitTools = false) => {
      fullResponse = ''
      await aiService.chatWithCallbacks(
      {
        messages: msgs,
        tools: omitTools ? [] : coreTools,
        allTools: aiTools,
        toolMetadata: TOOL_METADATA,
        runToken,
        configOverride: override || undefined
      },
      {
        onPlan: (steps) => {
          if (!isCurrentRun(runToken)) return
          // Plan-and-Execute：模型输出任务计划清单，渲染在消息顶部
          aiMsg.plan = { steps, done: [] }
          addLog('plan', `任务清单（${steps.length} 项）：\n${steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`, {}, currentConversation.value?.id)
          emit('log-updated')
          scrollToBottom()
        },
        onStepDone: (n) => {
          if (!isCurrentRun(runToken)) return
          // 计划步骤完成：打勾并记录进度
          if (!aiMsg.plan) return
          if (!aiMsg.plan.done.includes(n)) aiMsg.plan.done.push(n)
          const stepText = aiMsg.plan.steps[n - 1] || ''
          addLog('plan_step', `完成条目 ${n}/${aiMsg.plan.steps.length}：${stepText}`, {}, currentConversation.value?.id)
          emit('log-updated')
          scrollToBottom()
        },
        onChunk: (chunk) => {
          if (!isCurrentRun(runToken)) return
          // 工具（如 AI 续写提问）结束后恢复流式输出时，重新进入思考态以显示停止按钮
          if (aiStatus.value === 'idle') {
            aiStatus.value = 'thinking'
            emit('tool-call-status', 'thinking')
          }
          fullResponse += chunk
          // review A3：节流流式输出，避免每 token 都触发 Vue 整列表 patch。
          // chunk 不断累加到本地变量 fullResponse，但 aiMsg.content 只在每 ~60ms 触发一次响应式更新，
          // 同时每字符都更新滚动（避免滚动跟不上），保存对话仍然每 chunk 节流保存。
          if (!__streamFlushPending) {
            __streamFlushPending = true
            const raf = (typeof window !== 'undefined' && window.requestAnimationFrame)
              ? window.requestAnimationFrame.bind(window)
              : (cb) => setTimeout(cb, 16)
            raf(() => {
              __streamFlushPending = false
              if (!isCurrentRun(runToken)) return
              aiMsg.content = fullResponse
              scrollToBottom()
            })
          }
          // 流式输出过程中定时保存，防止中途关闭丢失
          saveConversationThrottled()
        },
        // 自动工具发现兜底：清空已流式输出的首答，模型带新激活的工具重答
        onBeforeRetry: (hits) => {
          if (!isCurrentRun(runToken)) return
          fullResponse = ''
          aiMsg.content = ''
          aiMsg.plan = null
          aiStatus.value = 'thinking'
          emit('tool-call-status', 'thinking')
          addLog('tool_call', `工具: 自动工具发现 [auto-discovery]\n原因: 本轮未使用任何工具，系统自动检索到可能匹配的工具并已激活重试：${hits.map(h => h.name).join('、')}`, {}, currentConversation.value?.id)
          emit('log-updated')
        },
        onToolCall: async (toolCall) => {
          // 本轮已过期（用户已切换/新建会话）：不再执行任何工具
          if (!isCurrentRun(runToken)) {
            return { success: false, message: '本轮运行已被取消' }
          }
          // 用户已请求停止：不再执行新的工具
          if (stopRequested.value || aiService.isAborted()) {
            return { success: false, message: '用户已停止 AI 运行' }
          }

          const toolName = toolCall.function.name
          let toolArgs = {}
          try { toolArgs = JSON.parse(toolCall.function.arguments || '{}') } catch {}

          // 危险操作统一二次确认（白名单内静默放行，用户取消则不执行）
          const allowed = await confirmDangerousTool(toolName, toolArgs)
          if (!allowed) {
            aiMsg.toolCalls.push({
              name: toolName,
              displayName: toolNameMap[toolName] || toolName,
              status: 'stopped'
            })
            addLog('tool_rejected', `工具: ${toolNameMap[toolName] || toolName} [${toolName}]\n原因: 用户在确认弹窗中取消`, {
              toolName
            }, currentConversation.value?.id)
            emit('log-updated')
            return { success: false, message: '用户取消了本次危险操作，未执行。请不要再重复调用该工具。' }
          }

          aiStatus.value = 'calling'
          emit('tool-call-status', 'calling')

          const lastUserMsg = [...messages.value].reverse().find(m => m.role === 'user')
          const userCtx = lastUserMsg ? firstN(stripDynamicContext(lastUserMsg.content), 240) : ''

          // 添加工具调用状态到消息（summary 让用户看到"正在做什么"）
          const tcEntry = {
            name: toolName,
            displayName: toolNameMap[toolName] || toolName,
            status: 'calling',
            summary: summarizeToolArgs(toolName, toolArgs)
          }
          aiMsg.toolCalls.push(tcEntry)

          // 记录工具调用日志（中文名 + 内部名，便于用户理解与调试对照）
          addLog('tool_call', `${userCtx ? `用户请求：${userCtx}\n` : ''}工具: ${toolNameMap[toolName] || toolName} [${toolName}]\n参数: ${toolCall.function.arguments}`, {
            toolName: toolName,
            toolArgs: toolCall.function.arguments
          }, currentConversation.value?.id)
          emit('log-updated')

          const toolStartTs = Date.now()
          try {
            const result = await handleToolCall(toolCall, props.mindMap, props.activeNode, extraHandlers)
            tcEntry.status = result && result.success === false ? 'error' : 'done'
            // 关键返回值留档：压缩成摘要时保留
            tcEntry.resultBrief = briefFromResult(result)
            if (toolName === 'parallel_ai_workers' && Array.isArray(result?.workers)) {
              const workers = result.workers
              const ok = workers.filter(w => w.status === 'success').length
              tcEntry.summary = `${workers.length} 个子 Agent · 成功 ${ok} · 失败 ${workers.length - ok}`
              const workerLog = workers.map(w => {
                if (w.status === 'success') {
                  return `- [${w.id}] 成功（尝试 ${w.attempts} 次）：${firstN(w.content, 120)}`
                }
                return `- [${w.id}] 失败（尝试 ${w.attempts} 次）：${w.error}`
              }).join('\n')
              addLog('worker', `子 Agent 执行明细（${ok}/${workers.length} 成功）：\n${workerLog}`, {
                toolName,
                workers
              }, currentConversation.value?.id)
              emit('log-updated')
            }
            // 导出的图片直接显示在消息中（文件已自动保存到默认保存目录）
            if (result && result.imageData) {
              aiMsg.image = result.imageData
              aiMsg.imageFileName = result.fileName || '导出图片'
            }
            // AI 生成的文件以可点击胶囊展示（单击打开所在文件夹 / 双击打开文件）。
            // notNewFile = 原地覆盖保存当前文件，不是本轮新建文件，不展示胶囊也不计入撤销删除清单
            if (result && result.filePath && !result.notNewFile) {
              const p = String(result.filePath)
              if (!aiMsg.files) aiMsg.files = []
              if (!aiMsg.files.some(x => x.path === p)) {
                const name = result.fileName || p.split(/[\\/]/).pop() || p
                const dot = name.lastIndexOf('.')
                aiMsg.files.push({ path: p, fileName: name, ext: dot >= 0 ? name.slice(dot) : '' })
              }
            }
            // 日志中的结果剥离巨型图片数据（base64），保留路径与元信息
            const durationMs = Date.now() - toolStartTs
            runStats.toolCalls += 1
            runStats.toolTimeMs += durationMs
            if (toolName === 'search_web') {
              runStats.searchCalls += 1
              const statuses = result?.searchMeta?.engineStatuses || []
              for (const status of statuses) {
                if (!status.success && !runStats.failedEngines.includes(status.engine)) runStats.failedEngines.push(status.engine)
              }
            }
            const logResult = result && result.imageData
              ? { ...result, imageData: `[图片数据已省略，长度 ${result.imageData.length} 字符]` }
              : result
            // 记录工具返回日志（工具逻辑失败 result.success===false 归类为 tool_error，
            // 与消息卡片状态一致，用户才能在日志面板按"错误"筛出失败原因）
            const isToolFail = !!(result && result.success === false)
            addLog(isToolFail ? 'tool_error' : 'tool_result', `${userCtx ? `用户请求：${userCtx}\n` : ''}工具: ${toolNameMap[toolName] || toolName} [${toolName}]\n耗时: ${durationMs}ms\n结果: ${JSON.stringify(logResult)}`, {
              toolName: toolName,
              result: logResult,
              durationMs
            }, currentConversation.value?.id)
            emit('log-updated')
            // 写操作工具执行后统一完全重绘，避免节点位置错乱/重叠（只读工具跳过）
            const READ_ONLY_RE = /^(search_|get_|list_|read_|query_|focus_|activate_|semantic_|zoom_|context_|audit_)/
            const isWriteOp = !READ_ONLY_RE.test(toolName) && !['select_node', 'find_related', 'list_references', 'get_location', 'memory'].includes(toolName)
            if (isWriteOp && props.mindMap && typeof props.mindMap.reRender === 'function') {
              try { props.mindMap.reRender() } catch (e) {}
            }
            // AI 创建了新文件时通知 App.vue 更新文件路径和目录树。
            // externalFile（AI出题/导出等）：只生成独立文件、画布内容未切换，
            // 只刷新目录树，禁止把"当前文件"指向它（否则画布旧内容会被误存进新文件）。
            // notNewFile（原地覆盖当前文件）不触发任何 file-created 事件
            if (result && result.filePath && !result.notNewFile) {
              if (result.externalFile) {
                emit('external-file-created')
              } else {
                emit('file-created', result.filePath, result.fileName)
                if (result.switchFile) await waitForFileSwitch(result.filePath)
              }
            }
            // 不在消息中追加工具结果文本，状态指示器已经显示完成
            scrollToBottom()
            return result
          } catch (e) {
            tcEntry.status = 'error'
            // 失败原因留档（比成功保留更多细节，用户要求失败时参数与原因必须保留）
            tcEntry.errorBrief = firstN(e.message, 200)
            console.error('工具调用失败:', e)
            // 记录工具错误日志
            addLog('tool_error', `工具: ${toolCall.function.name}\n错误: ${e.message}\n堆栈: ${e.stack}`, {
              toolName: toolCall.function.name,
              error: e.message
            }, currentConversation.value?.id)
            // review bug fix：工具调用失败时，立即把错误推到 aiMsg.content（消息列表可见）。
            // 之前只在 tcEntry.status / addLog 记录错误，AI 继续对话时用户只能在日志面板看到，
            // 而且若 AI 继续成功完成本轮，错误信息永远不会出现在消息气泡里。
            if (!aiMsg.content) {
              aiMsg.content = `⚠️ 工具 ${toolNameMap[toolName] || toolName} 调用失败：${e.message || '未知错误'}`
            } else if (!aiMsg.content.includes(`工具 ${toolNameMap[toolName] || toolName} 调用失败`)) {
              // 不重复追加同一工具的失败信息（同一轮 AI 可能反复重试同一工具）
              aiMsg.content = aiMsg.content + `\n\n⚠️ 工具 ${toolNameMap[toolName] || toolName} 调用失败：${e.message || '未知错误'}`
            }
            scrollToBottom()
            emit('log-updated')
            return { success: false, message: `工具调用失败: ${e.message}` }
          }
        },
        onDone: () => {
          // 本轮已过期（会话已切换/新运行已启动）：丢弃收尾，不落库不覆盖状态
          if (!isCurrentRun(runToken)) return
          // 用户手动停止：标记未完成的工具调用并在消息中注明
          const stopped = stopRequested.value || aiService.isAborted()
          if (stopped) {
            aiMsg.toolCalls.forEach(tc => {
              if (tc.status === 'calling') tc.status = 'stopped'
            })
            aiMsg.content = fullResponse
              ? fullResponse + '\n\n（已手动停止）'
              : '（已手动停止）'
            addLog('abort', '用户手动停止了 AI 运行', {
              model: currentModelName.value
            }, currentConversation.value?.id)
            emit('log-updated')
          }
          // 事务撤销：本轮 AI 前后画布有差异时，把开始前快照挂到消息上，供"一键撤销本次 AI 操作"
          if (baselineSnapshot) {
            const finalSnapshot = captureMindMapSnapshot()
            const changed = !finalSnapshot ||
              JSON.stringify(finalSnapshot) !== JSON.stringify(baselineSnapshot)
            if (changed) {
              aiUndoSnapshots.set(aiMsg.id, baselineSnapshot)
              if (aiUndoSnapshots.size > AI_UNDO_SNAPSHOT_MAX) {
                const oldestKey = aiUndoSnapshots.keys().next().value
                aiUndoSnapshots.delete(oldestKey)
                const old = messages.value.find(m => m.id === oldestKey)
                if (old) old.undoSteps = 0
              }
              aiMsg.undoSteps = 1
            }
          }
          aiStatus.value = 'done'
          emit('tool-call-status', 'done')
          // 流程已结束（含手动停止）：清除停止标记，避免误伤语义检索等独立 AI 调用
          aiService.resetAbort()
          const totalRunMs = Date.now() - runStats.startedAt
          addLog('metrics', `运行指标：总耗时 ${totalRunMs}ms；模型耗时 ${Math.max(0, totalRunMs - runStats.toolTimeMs)}ms；工具耗时 ${runStats.toolTimeMs}ms；工具调用 ${runStats.toolCalls} 次；搜索 ${runStats.searchCalls} 次；失败引擎 ${runStats.failedEngines.length ? runStats.failedEngines.join('、') : '无'}`, {
            totalRunMs,
            modelTimeMs: Math.max(0, totalRunMs - runStats.toolTimeMs),
            toolTimeMs: runStats.toolTimeMs,
            toolCalls: runStats.toolCalls,
            searchCalls: runStats.searchCalls,
            failedEngines: runStats.failedEngines
          }, currentConversation.value?.id)
          // 记录返回日志
          addLog('receive', fullResponse, {
            model: currentModelName.value,
            toolCalls: aiMsg.toolCalls.length > 0 ? aiMsg.toolCalls.map(tc => ({
              name: tc.name,
              displayName: tc.displayName,
              status: tc.status
            })) : undefined
          }, currentConversation.value?.id)
          emit('log-updated')
          scheduleIdleReset(500)
          // 保存对话
          persistConversation()
          // 处理发送队列：当前回复完成后自动发送下一条（延时等 aiStatus 回到 idle）
          if (!jumpQueued && messageQueue.value.length > 0) {
            const next = messageQueue.value.shift()
            setTimeout(() => {
              inputText.value = next.text
              attachedRefs.value = next.refs
              attachedFiles.value = next.files
              attachedSkills.value = next.skills || []
              attachedMcps.value = next.mcps || []
              attachedTools.value = next.tools || []
              sendMessage(next.text)
            }, 600)
          }
        },
        onError: async (error) => {
          // 本轮已过期：丢弃，不渲染成新会话里的错误
          if (!isCurrentRun(runToken)) return
          // 浏览器降级路径：用户主动中止产生 AbortError，按"已停止"处理而非渲染成错误
          if (error && (error.name === 'AbortError' || error.aborted === true)) {
            aiMsg.toolCalls.forEach(tc => {
              if (tc.status === 'calling') tc.status = 'stopped'
            })
            aiMsg.content = fullResponse
              ? fullResponse + '\n\n（已手动停止）'
              : '（已手动停止）'
            aiStatus.value = 'done'
            emit('tool-call-status', 'done')
            aiService.resetAbort()
            addLog('abort', '用户手动停止了 AI 运行', {
              model: currentModelName.value
            }, currentConversation.value?.id)
            emit('log-updated')
            scheduleIdleReset(500)
            persistConversation()
            return
          }
          // 上下文溢出自动压缩重试：API返回"maximum context length"时，强制压缩后重试一次
          const errMsg = error.message || ''
          const isContextOverflow = /maximum context length|context_length_exceeded|reduce the length|context length is/i.test(errMsg)
          if (isContextOverflow && !contextOverflowRetried) {
            contextOverflowRetried = true
            addLog('compress', `上下文超出模型限制，正在自动压缩并重试...`, {}, currentConversation.value?.id)
            emit('log-updated')
            try {
              // 强制压缩：把所有历史（除了最后一条用户消息）压成摘要
              const forcedHistory = messages.value
                .filter(m => (m.role === 'user' || (m.role === 'assistant' && (m.content || (m.toolCalls && m.toolCalls.length)))) && shouldKeepContextMessage(m))
                .map(m => ({ role: m.role, content: m.role === 'user' ? stripDynamicContext(m.content) : m.content, toolCalls: m.toolCalls }))
              // 只保留最后1轮（最后一条user+之前的assistant）
              const lastUserIdx = forcedHistory.map(m => m.role).lastIndexOf('user')
              const keepMsgs = lastUserIdx > 0 ? forcedHistory.slice(lastUserIdx) : forcedHistory
              const compressMsgs = lastUserIdx > 0 ? forcedHistory.slice(0, lastUserIdx) : []
              let newSummary = conversationSummary.value
              if (compressMsgs.length > 0) {
                newSummary = await compressHistory(compressMsgs, conversationSummary.value)
                conversationSummary.value = newSummary
                summaryCoveredCount.value = compressMsgs.length
                if (currentConversation.value) {
                  currentConversation.value.summary = newSummary
                  currentConversation.value.summaryCoveredCount = summaryCoveredCount.value
                }
                persistConversation()
              }
              // 用压缩后的上下文 + 原始最后一条用户消息重建发送列表
              const rebuilt = await buildContextMessages(
                messages.value
                  .filter(m => (m.role === 'user' || (m.role === 'assistant' && (m.content || (m.toolCalls && m.toolCalls.length)))) && shouldKeepContextMessage(m))
                  .map(m => ({ role: m.role, content: m.role === 'user' ? stripDynamicContext(m.content) : m.content, toolCalls: m.toolCalls })),
                SYSTEM_PROMPT,
                coreTools
              )
              // 替换最后一条user消息为带动态上下文的finalUserText
              for (let i = rebuilt.length - 1; i >= 0; i--) {
                if (rebuilt[i].role === 'user') {
                  rebuilt[i].content = finalUserText
                  break
                }
              }
              aiMsg.content = ''
              aiMsg.toolCalls.forEach(tc => { tc.status = 'stopped' })
              aiMsg.toolCalls = []
              fullResponse = ''
              aiStatus.value = 'thinking'
              emit('tool-call-status', 'thinking')
              addLog('compress', `自动压缩完成，摘要 ${newSummary.length} 字，正在重试...`, {}, currentConversation.value?.id)
              emit('log-updated')
              await attemptChat(rebuilt, undefined)
              return
            } catch (compressErr) {
              console.error('自动压缩重试失败:', compressErr)
              // 降级到普通错误处理
            }
          }
          // 多模态直发失败：后台本地 OCR 识别后自动降级重发（结果不写入输入框，直接随消息发给大模型）
          if (visionOverride && !ocrFallbackTried) {
            // 400/422 多为参数错误——不少视觉模型（如 GLM-4V 系列）不支持 tools 参数：先去掉工具用多模态重试一次，仍失败再降级 OCR
            const st = /API error: (\d{3})/.exec(error.message || '')
            if (st && (st[1] === '400' || st[1] === '422') && !visionNoToolsTried) {
              visionNoToolsTried = true
              addLog('ocr', `多模态接口拒绝请求（${st[1]}，疑似不支持工具调用），已去除 tools 参数用多模态重试`, {
                model: visionModelName
              }, currentConversation.value?.id)
              emit('log-updated')
              aiMsg.content = ''
              aiStatus.value = 'thinking'
              emit('tool-call-status', 'thinking')
              attemptChat(messagesToSend, visionOverride, true)
              return
            }
            ocrFallbackTried = true
            addLog('ocr', `多模态直发失败（${error.message || 'AI 服务异常'}），自动降级本地 OCR 识别后重发`, {
              model: visionModelName
            }, currentConversation.value?.id)
            emit('log-updated')
            aiMsg.content = ''
            aiStatus.value = 'thinking'
            emit('tool-call-status', 'thinking')
            ;(async () => {
              try {
                const parts = await ocrImageFiles(imageFiles)
                const retryText = `${finalUserText}\n\n（多模态识别失败，以下为图片本地 OCR 识别结果，供回答参考）\n\n${parts}`
                const retryMsgs = messagesToSend.map(m => ({ ...m }))
                for (let i = retryMsgs.length - 1; i >= 0; i--) {
                  if (retryMsgs[i].role === 'user') {
                    retryMsgs[i].content = retryText
                    break
                  }
                }
                await attemptChat(retryMsgs, undefined)
              } catch (e) {
                if (!isCurrentRun(runToken)) return
                aiMsg.content = `多模态识别失败：${error.message || 'AI 服务异常'}\n本地 OCR 降级也失败：${e.message || e}`
                aiStatus.value = 'error'
                emit('tool-call-status', 'error')
                addLog('error', `OCR 降级重发失败: ${e.message || e}`, {}, currentConversation.value?.id)
                emit('log-updated')
                scheduleIdleReset(1000)
              }
            })()
            return
          }
          console.error('AI 服务错误:', error)
          // review bug fix：错误消息末尾追加"工具失败摘要"——之前如果 aiMsg.content 已被前面工具失败的 catch 设了值，
          // 这里会被覆盖；现在改成"fullResponse 优先，错误信息附加，工具失败摘要追加"
          const failedTools = (aiMsg.toolCalls || []).filter(tc => tc.status === 'error' && tc.errorBrief)
          const failedSummary = failedTools.length
            ? '\n\n—— 工具调用失败明细 ——\n' + failedTools.map(tc => `• ${tc.displayName || tc.name}: ${tc.errorBrief}`).join('\n')
            : ''
          aiMsg.content = (fullResponse || `错误: ${error.message || 'AI 服务异常'}`) + failedSummary
          aiStatus.value = 'error'
          emit('tool-call-status', 'error')
          aiService.resetAbort()
          // 记录错误日志
          addLog('error', `${error.message || 'AI 服务异常'}\n响应内容: ${fullResponse}`, {
            model: currentModelName.value
          }, currentConversation.value?.id)
          emit('log-updated')
          scheduleIdleReset(1000)
        }
      }
      )
    }
    await attemptChat(messagesToSend, visionOverride)
  } catch (error) {
    console.error('发送消息失败:', error)
    messages.value.push({
      id: genMsgId(),
      role: 'assistant',
      content: `发生错误: ${error.message || '未知错误'}`
    })
    aiStatus.value = 'error'
    emit('tool-call-status', 'error')
    // 记录错误日志
    addLog('error', `发送消息失败: ${error.message || '未知错误'}`, {
      model: currentModelName.value
    }, currentConversation.value?.id)
    emit('log-updated')
    scheduleIdleReset(1000)
  }
}

/* ============================================================
 * AI 节点操作（续写/改写/挖空）- 供 App.vue 调用
 * ============================================================ */

/* ============================================================
 * AI 续写 / 背诵改写 / 挖空（支持多节点 + 结果替换）
 * ============================================================ */

/**
 * 从节点对象中提取纯文本（去除 HTML 标签）
 * 兼容 simple-mind-map 节点和大纲节点
 */
const extractNodeText = (node) => {
  if (!node) return ''
  let text = node?.text || node?.data?.text || ''
  if (!text && typeof node?.getData === 'function') {
    text = node.getData('text') || ''
  }
  if (text && text.includes('<')) {
    const div = document.createElement('div')
    div.innerHTML = text
    text = div.innerText || div.textContent || ''
  }
  return text.trim()
}

/**
 * 获取节点的子节点文本（递归）
 */
const extractChildrenText = (node) => {
  if (!node) return ''
  const children = node.children || node?.children || []
  if (!children || children.length === 0) return ''
  const texts = []
  for (const child of children) {
    const text = extractNodeText(child)
    if (text) texts.push(text)
  }
  return texts.join('、')
}

/**
 * 获取节点的父节点
 */
const getParentNode = (node) => {
  if (!node) return null
  return node.parent || node?.parent || null
}

/**
 * 检测多个节点是否共享同一父节点（同级兄弟节点）
 * 返回共同父节点；非同级（或数量不足 2）返回 null
 */
const detectCommonParent = (nodes) => {
  if (!Array.isArray(nodes) || nodes.length < 2) return null
  const uidOf = (n) => n.uid || n?.data?.uid
  const parent = getParentNode(nodes[0])
  if (!parent) return null
  const pUid = uidOf(parent)
  for (let i = 1; i < nodes.length; i++) {
    const p = getParentNode(nodes[i])
    if (!p || uidOf(p) !== pUid) return null
  }
  return parent
}

/**
 * 获取节点的兄弟节点（同级节点，排除自身）
 */
const getSiblings = (node, allSelectedNodes) => {
  if (!node) return []
  const parent = getParentNode(node)
  if (!parent || !parent.children) return []
  const selectedSet = new Set(allSelectedNodes.map(n => n.uid || n?.data?.uid))
  return parent.children.filter(c => {
    const cuid = c.uid || c?.data?.uid
    return c && c !== node && !selectedSet.has(cuid)
  })
}

/**
 * 构建多节点上下文信息
 * - 包含每个节点的上级节点内容
 * - 包含每个节点的同级（兄弟）节点内容
 * - 包含选中节点的子节点内容
 * - 包含文件来源信息
 */
const buildNodeContext = (nodes) => {
  if (!nodes || nodes.length === 0) return { texts: [], contextInfo: '' }

  const nodeTexts = nodes.map(n => extractNodeText(n))
  let contextInfo = ''

  // 文件来源信息
  if (props.currentFileName) {
    contextInfo += `\n【文件来源】${props.currentFileName}\n`
  }

  // 每个节点的上下文：父节点 + 兄弟节点 + 子节点
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]
    const text = nodeTexts[i]
    if (!text) continue

    contextInfo += `\n--- 节点 ${i + 1} 的上下文 ---\n`
    contextInfo += `【当前节点】${text}\n`

    // 父节点
    const parent = getParentNode(node)
    if (parent) {
      const parentText = extractNodeText(parent)
      if (parentText) {
        contextInfo += `【上级节点】${parentText}\n`
      }
    }

    // 兄弟节点（同级）
    const siblings = getSiblings(node, nodes)
    if (siblings.length > 0) {
      const siblingTexts = siblings.map(s => extractNodeText(s)).filter(Boolean)
      if (siblingTexts.length > 0) {
        contextInfo += `【同级节点】${siblingTexts.join('、')}\n`
      }
    }

    // 子节点
    const childrenText = extractChildrenText(node)
    if (childrenText) {
      contextInfo += `【子节点】${childrenText}\n`
    }
  }

  // 告知 AI 哪些是用户选中的节点
  contextInfo += `\n【用户选中的节点】${nodeTexts.map((t, i) => `${i + 1}. ${t}`).join('； ')}\n`

  return { texts: nodeTexts, contextInfo }
}

/**
 * 纯文本转思维导图富文本 HTML（保证 Quill 正确解析）
 */
const toRichTextHtml = (text) => {
  if (!text) return '<p><span></span></p>'
  if (text.includes('</p>') || text.includes('<br')) return text
  const escaped = String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  return `<p><span>${escaped}</span></p>`
}

/**
 * 背诵改写专用：【记忆简写】（含括号）默认蓝色加粗；概要节点传绿色显示
 */
const toReciteRewriteHtml = (text, color = '#007aff') => {
  if (!text) return '<p><span></span></p>'
  const escaped = String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  const styled = escaped.replace(
    /【([^】]*)】/g,
    `<span style="color:${color};font-weight:bold">【$1】</span>`
  )
  return `<p><span>${styled}</span></p>`
}

/**
 * 概要（generalization）专用 HTML：第一行「简要记忆方法」绿色加粗，换行后「详细解释」普通。
 * text 为两行内容（\n 分隔）；单行时整体绿色加粗。
 */
const toGeneralizationHtml = (text) => {
  if (!text) return '<p><span></span></p>'
  const escape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const lines = String(text).split('\n').map(l => l.trim()).filter(Boolean)
  if (lines.length <= 1) {
    return `<p><span style="color:#34c759;font-weight:bold">${escape(lines[0] || '')}</span></p>`
  }
  const first = escape(lines[0])
  const rest = lines.slice(1).map(escape).join('<br/>')
  return `<p><span style="color:#34c759;font-weight:bold">${first}</span><br/>${rest}</p>`
}

/**
 * 解析 AI 续写返回的严格 JSON（容错：剥离代码块围栏、截取 JSON 主体）
 * 返回：每个节点对应的子节点数组（childList），与 nodes 一一对应
 */
const parseContinueJSON = (content, nodeCount) => {
  let raw = String(content || '').trim()
  // 推理模型可能在正文前输出 <think>...</think> 思考块，先剥离（含未闭合的情况）
  raw = raw.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, '').trim()
  raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
  const tryParse = (str) => {
    try { return JSON.parse(str) } catch (e) { return null }
  }
  let obj = tryParse(raw)
  if (!obj) {
    const s = raw.indexOf('{')
    const e = raw.lastIndexOf('}')
    if (s !== -1 && e > s) obj = tryParse(raw.slice(s, e + 1))
  }
  if (!obj) {
    const s = raw.indexOf('[')
    const e = raw.lastIndexOf(']')
    if (s !== -1 && e > s) obj = tryParse(raw.slice(s, e + 1))
  }

  // 单节点：{"children":[...]} 或直接 [...]
  if (nodeCount === 1) {
    if (Array.isArray(obj)) return [obj]
    if (obj && Array.isArray(obj.children)) return [obj.children]
    if (obj && Array.isArray(obj.items)) {
      const item = obj.items[0]
      return [(item && Array.isArray(item.children)) ? item.children : []]
    }
    return [[]]
  }

  // 多节点：{"items":[{"index":1,"children":[...]},...]}
  const result = []
  for (let i = 1; i <= nodeCount; i++) {
    let children = []
    if (obj && Array.isArray(obj.items)) {
      const item = obj.items.find(x => Number(x?.index) === i) || obj.items[i - 1]
      if (item && Array.isArray(item.children)) children = item.children
    }
    result.push(children)
  }
  return result
}

/**
 * 将 AI 返回的子节点 JSON 转为 INSERT_MULTI_CHILD_NODE 所需的数据格式
 * 限制：最多 6 个层级（层级深度遵循用户续写要求），每层最多 12 个节点，单节点文本 200 字内
 * 字段兼容：text / content / name / title 均视为节点文本
 */
const pickNodeText = (item) => {
  if (!item || typeof item !== 'object') return ''
  const t = item.text ?? item.content ?? item.name ?? item.title
  return typeof t === 'string' ? t : ''
}

const convertChildList = (list, depth = 1) => {
  if (!Array.isArray(list) || depth > 6) return []
  return list
    .filter(item => pickNodeText(item).trim())
    .slice(0, 12)
    .map(item => ({
      data: { text: toRichTextHtml(pickNodeText(item).trim().slice(0, 200)) },
      children: convertChildList(item.children, depth + 1)
    }))
}

// 高亮选中节点（右键AI操作时提醒用户）
const highlightNodes = (nodes) => {
  if (!props.mindMap || !props.mindMap.renderer) return
  const nodeArr = Array.isArray(nodes) ? nodes : [nodes]
  try {
    props.mindMap.renderer.clearActiveNode()
    nodeArr.forEach(node => {
      if (node && props.mindMap.renderer.addNodeToActiveList) {
        props.mindMap.renderer.addNodeToActiveList(node)
      }
    })
    if (props.mindMap.renderer.emitNodeActiveEvent) {
      props.mindMap.renderer.emitNodeActiveEvent()
    }
  } catch (e) {
    console.error('高亮节点失败:', e)
  }
}

// 点击消息中的引用胶囊：按 uid 定位并高亮该节点
const jumpToRef = (ref) => {
  const renderer = props.mindMap?.renderer
  if (!renderer || !ref?.uid) return
  const node = typeof renderer.findNodeByUid === 'function' ? renderer.findNodeByUid(ref.uid) : null
  if (!node) {
    ElMessage.warning('该引用节点已不存在（可能被删除或文件已切换）')
    return
  }
  try {
    if (typeof renderer.moveNodeToCenter === 'function') renderer.moveNodeToCenter(node)
    if (typeof renderer.clearActiveNode === 'function') renderer.clearActiveNode()
    if (typeof renderer.addNodeToActiveList === 'function') renderer.addNodeToActiveList(node)
    // review A1：定位节点后防抖 render
    scheduleMindMapRender()
  } catch (e) {
    console.error('定位节点失败:', e)
  }
}

/* ============================================================
 * AI 续写提问机制
 * 续写前向用户询问：1) 参考资料 2) 续写要求 3) 层级要求
 * 输入框上方显示快捷回复按钮，用户输入或点按钮后进入下一步
 * ============================================================ */

const pendingContinue = ref(null)
// { nodes, waiting: 'ref' | 'requirement' | 'depth', refAnswer, reqAnswer, depthAnswer, resolve }

const askContinueQuestions = (nodes, texts, contextInfo, mode = 'continue') => {
  return new Promise((resolve) => {
    pendingContinue.value = {
      nodes,
      mode,
      waiting: 'ref',
      refAnswer: '',
      reqAnswer: '',
      depthAnswer: '',
      resolve
    }
    const nodeSummary = texts.filter(Boolean).map((t, i) => `${i + 1}. ${t.length > 30 ? t.slice(0, 30) + '…' : t}`).join('\n')
    const verb = mode === 'add-child' ? '新增子节点' : '续写'

    messages.value.push({
      id: genMsgId(),
      role: 'assistant',
      content: `开始 AI ${verb}前，先确认将发送给 AI 的上下文：

${contextInfo.trim()}

需要${verb}的节点：
${nodeSummary}

**【问题 1/3】有没有相关的参考资料？**
- 如果有，请直接填在下方输入框内发送
- 如果没有，可点击输入框上方的「无参考资料」快捷回复`
    })
    // 等待用户回答期间释放"思考中"状态，让发送按钮可用
    aiStatus.value = 'idle'
    emit('tool-call-status', 'idle')
    persistConversation()
    scrollToBottom(true)
    nextTick(() => {
      if (textareaRef.value) textareaRef.value.focus()
    })
  })
}

/**
 * 提交续写提问的回答（用户输入发送或点击快捷按钮）
 * 返回 true 表示该消息已被提问流程消费
 */
const submitContinueAnswer = (text) => {
  const p = pendingContinue.value
  if (!p) return false
  if (text === '__CANCEL__') {
    pendingContinue.value = null
    // 取消状态由 aiMsg（工具卡片）展示，不重复追加消息
    try { p.resolve(null) } catch (e) {}
    return true
  }
  if (p.waiting === 'ref') {
    p.refAnswer = text
    p.waiting = 'depth'
    messages.value.push({
      id: genMsgId(),
      role: 'assistant',
      content: `已收到参考资料：${text.length > 100 ? text.slice(0, 100) + '…' : text}\n\n**【问题 2/3】层级深度有没有上限要求？**（如"不超过 3 层"）\n- 如果有，请直接填在下方输入框内发送\n- 如果没有，可点击输入框上方的「无层级要求」快捷回复（将按内容需要生成，层级最多不超过 6 层）\n- 层级数量由 AI 按内容需要决定，上限仅用于约束最深不超过几层`
    })
    scrollToBottom(true)
    nextTick(() => {
      if (textareaRef.value) textareaRef.value.focus()
    })
    return true
  }
  if (p.waiting === 'depth') {
    p.depthAnswer = text
    p.waiting = 'requirement'
    const verb3 = p.mode === 'add-child' ? '新增子节点' : '续写'
    const otherLabel = p.mode === 'add-child' ? '其他要求' : '续写要求'
    messages.value.push({
      id: genMsgId(),
      role: 'assistant',
      content: `已收到层级要求：${text.length > 100 ? text.slice(0, 100) + '…' : text}\n\n**【问题 3/3】有没有${verb3}的其他要求？**（如节点数量、语言风格、侧重点等）\n- 如果有，请直接填在下方输入框内发送\n- 如果没有，可点击输入框上方的「无${otherLabel}」快捷回复`
    })
    scrollToBottom(true)
    nextTick(() => {
      if (textareaRef.value) textareaRef.value.focus()
    })
    return true
  }
  if (p.waiting === 'requirement') {
    p.reqAnswer = text
    pendingContinue.value = null
    try { p.resolve({ refAnswer: p.refAnswer, reqAnswer: p.reqAnswer, depthAnswer: p.depthAnswer }) } catch (e) {}
    return true
  }
  return false
}

// 快捷回复按钮点击（同时把回复显示为用户消息）
const quickReplyContinue = (text) => {
  if (text === '__CANCEL__') {
    submitContinueAnswer('__CANCEL__')
    return
  }
  messages.value.push({
    id: genMsgId(),
    role: 'user',
    content: text
  })
  submitContinueAnswer(text)
  scrollToBottom(true)
}

// 切换/新建/清空会话时取消未完成的续写提问，防止跨会话泄漏
const cancelPendingContinue = () => {
  const p = pendingContinue.value
  if (!p) return
  pendingContinue.value = null
  try { p.resolve(null) } catch (e) {}
}

// AI 续写子节点（严格 JSON 返回，内容直接添加为子节点，层级按内容需要生成、受用户上限约束（未指定时最多 6 层），不替换原节点文本，支持 Ctrl+Z 撤销）
// 熔断：连续失败/取消累计 2 次后，本次会话内直接拒绝续写，防止 AI 工具链循环重试陷入"反复问参考资料"
let aiContinueFailStreak = 0
const AI_CONTINUE_MAX_FAILS = 2

const aiContinue = async (nodesOrNode, opts = {}) => {
  const viaTool = !!opts.viaTool
  // 熔断只拦工具链的自动重试；用户手动重新发起视为明确意图，放行并清零
  if (viaTool && aiContinueFailStreak >= AI_CONTINUE_MAX_FAILS) {
    return `续写已连续失败/取消 ${aiContinueFailStreak} 次，已停止自动重试。用户重新手动发起后才会再次续写。`
  }
  if (pendingContinue.value) {
    ElMessage.warning('请先回答上方的续写提问，或点击「取消续写」')
    return '请先回答续写提问'
  }
  // 工具内调用时外层循环已置为 calling，跳过状态守卫
  if (!viaTool && (aiStatus.value === 'thinking' || aiStatus.value === 'calling')) {
    ElMessage.warning('AI 正在处理中，请稍候...')
    return 'AI 正在处理中，请稍候'
  }

  const nodes = Array.isArray(nodesOrNode) ? nodesOrNode : [nodesOrNode]
  if (nodes.length === 0 || !nodes[0]) {
    ElMessage.warning('请先选择一个有内容的节点')
    return '没有选中节点'
  }

  const { texts, contextInfo } = buildNodeContext(nodes)
  if (!texts.some(t => t)) {
    ElMessage.warning('请先选择一个有内容的节点')
    return '选中节点没有内容'
  }

  highlightNodes(nodes)

  const isMulti = nodes.length > 1
  const nodeCountLabel = isMulti ? `${nodes.length} 个节点` : `「${texts[0].slice(0, 20)}」`
  // mode=add-child：右键"AI 新增子节点"入口（默认 3 层以内）；默认 continue：AI 续写（2~5 层）
  const mode = opts.mode === 'add-child' ? 'add-child' : 'continue'
  const actionLabel = mode === 'add-child' ? 'AI 新增子节点' : 'AI 续写子节点'

  messages.value.push({
    id: genMsgId(),
    role: 'user',
    content: actionLabel,
    isAiAction: true
  })
  const aiMsg = {
    id: genMsgId(),
    role: 'assistant',
    content: '正在分析节点上下文并生成子节点...',
    toolCalls: [{ name: 'ai_continue_children', displayName: actionLabel, status: 'calling' }]
  }
  messages.value.push(aiMsg)
  aiStatus.value = 'thinking'
  emit('tool-call-status', 'thinking')
  scrollToBottom()

  // 直接调用（按钮/右键菜单）时清除上一次遗留的停止标记；工具内调用不重置
  if (!viaTool) {
    stopRequested.value = false
    aiService.resetAbort()
    aiContinueFailStreak = 0
  }

  // ===== 询问参考资料、要求与层级要求 =====
  let refAnswer = ''
  let reqAnswer = ''
  let depthAnswer = ''
  const answers = await askContinueQuestions(nodes, texts, contextInfo, mode)
  if (!answers) {
    aiContinueFailStreak++
    aiMsg.toolCalls[0].status = 'stopped'
    aiMsg.content = mode === 'add-child'
      ? '已取消新增子节点（可随时重新发起）'
      : '已取消续写（本次会话内 AI 不会再自动发起续写，可随时重新手动发起）'
    scrollToBottom()
    persistConversation()
    return aiMsg.content
  }
  refAnswer = answers.refAnswer
  reqAnswer = answers.reqAnswer
  depthAnswer = answers.depthAnswer || ''

  aiStatus.value = 'thinking'
  emit('tool-call-status', 'thinking')
  aiMsg.content = '正在结合上下文与参考资料生成子节点...'
  scrollToBottom()

  const jsonFormat = isMulti
    ? '{"items":[{"index":1,"children":[{"text":"子节点1"},{"text":"子节点2","children":[{"text":"孙节点"}]}]},{"index":2,"children":[...]}]}（index 从 1 开始，对应每个需续写的节点）'
    : '{"children":[{"text":"子节点1"},{"text":"子节点2","children":[{"text":"孙节点1"}]}]}'

  const hasRef = refAnswer && refAnswer !== '无参考资料'
  const hasReq = reqAnswer && reqAnswer !== '无续写要求' && reqAnswer !== '无新增子节点要求' && reqAnswer !== '无其他要求'
  const hasDepth = depthAnswer && depthAnswer !== '无层级要求'
  const isAddChild = mode === 'add-child'
  const roleLabel = isAddChild ? '思维导图新增子节点助手' : '思维导图续写助手'
  const reqLabel = isAddChild ? '新增子节点要求' : '续写要求'

  // 从用户的层级回答中解析上限数字（"不超过4层"/"最多3层"/"4层"等）；
  // 解析不到上限时按无要求处理，由 AI 按内容需要生成（上限 6 层兜底）
  let depthLimit = 0
  if (hasDepth) {
    const m = String(depthAnswer).match(/(?:不超过|最多|小于|少于|上限[为是]?)\s*([1-9]\d?)|([1-9]\d?)\s*层(?:以内|之内)?/)
    if (m) depthLimit = Number(m[1] || m[2]) || 0
  }
  const depthDefault = depthLimit > 0
    ? `（上限 ${depthLimit} 层）`
    : '（无上限要求，按内容需要生成，最多不超过 6 层）'
  const depthRule = depthLimit > 0
    ? `层数不固定，由内容需要决定：内容简单就少分层，内容丰富才多分层；但任何情况下最深不得超过 ${depthLimit} 个层级`
    : '层数不固定，由内容需要决定：内容简单就少分层，内容丰富才多分层；任何情况下不超过 6 个层级'
  const prompt = `你是一个${roleLabel}。请为下面标记为 ► 的 ${nodes.length} 个节点分别生成子节点。
${contextInfo}

【用户提供的参考资料】
${hasRef ? refAnswer : '（无）'}

【用户的${reqLabel}】
${hasReq ? reqAnswer : '（无）'}

【用户的层级要求】
${hasDepth ? depthAnswer : depthDefault}

生成规则（严格遵守）：
1. 只返回严格 JSON，不要 markdown 代码块，不要任何解释文字，不要输出思考过程
2. 返回格式：${jsonFormat}
3. 层级深度：${depthRule}
4. 每个节点文本简短精炼（30 字内）
5. ${isAddChild ? '每个目标节点的第一层级只生成 1 个子节点，从第二层级开始按内容需要延伸' : '每个节点按内容需要生成 2~6 个直接子节点'}
6. 紧扣原节点语义扩展，不要偏离主题
7. ${hasRef
    ? '用户提供了参考资料：必须严格依据资料内容生成，不要过度总结、不要自由发散、不得编造资料中没有的内容'
    : '用户未提供参考资料：紧扣该节点的核心知识点（考点/重点）扩展，不要泛泛而谈、不要补充无关内容'}
8. 宁缺毋滥：如果某节点没有值得展开的重点，返回空 children，不要硬凑内容`

  // 问答等待期间（aiStatus 曾回落为 idle），前一轮对话/后台任务可能调用过 abort()
  // 留下中断标记，导致这里 chat() 被误判为"已停止"而直接报错。
  // 问答已完成、用户明确要求续写，发请求前清掉残留的中断状态。
  aiService.resetAbort()

  try {
    addLog('send', `${actionLabel}请求:\n${prompt}`, { model: currentModelName.value }, currentConversation.value?.id)
    const choice = await aiService.chat(prompt, `你是${roleLabel}，只输出严格符合要求的 JSON，不输出任何解释或代码块标记。`)
    const content = choice?.message?.content || ''
    addLog('receive', `${actionLabel}返回:\n${content}`, { model: currentModelName.value }, currentConversation.value?.id)

    if (aiService.isAborted()) {
      aiMsg.toolCalls[0].status = 'stopped'
      aiMsg.content = isAddChild ? '已停止新增子节点' : '已停止续写'
      aiStatus.value = 'done'
      emit('tool-call-status', 'done')
      return aiMsg.content
    }

    const parsed = parseContinueJSON(content, nodes.length)

    let addedNodes = 0
    let addedCount = 0
    for (let i = 0; i < nodes.length; i++) {
      const childList = convertChildList(parsed[i])
      if (childList.length === 0) continue
      try {
        props.mindMap.execCommand('INSERT_MULTI_CHILD_NODE', [nodes[i]], childList)
        addedNodes++
        addedCount += childList.length
      } catch (e) {
        console.error('添加子节点失败:', e)
      }
    }

    if (addedCount > 0) {
      // 多次渲染确保 UI 更新
      // review A1：罕见路径（异步节点插入完成后兜底 render），保留 setTimeout 等待 DOM 落位
      setTimeout(() => { try { props.mindMap.render() } catch (e) {} }, 100)
    }

    aiMsg.toolCalls[0].status = addedNodes > 0 ? 'done' : 'error'
    if (addedNodes > 0) {
      aiContinueFailStreak = 0
      aiMsg.content = isAddChild
        ? `已为 ${addedNodes} 个节点添加子节点（共 ${addedCount} 个）。原节点文本保持不变，可通过 Ctrl+Z 撤销。`
        : `已为 ${addedNodes} 个节点添加子节点（共 ${addedCount} 个，层级深度遵循续写要求）。原节点文本保持不变，可通过 Ctrl+Z 撤销。`
    } else {
      aiContinueFailStreak++
      const snippet = content.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, '').trim().slice(0, 100)
      aiMsg.content = `${isAddChild ? '新增子节点' : '续写'}失败：AI 返回内容无法解析为节点结构，节点未被修改。返回内容片段：${snippet || '（空）'}。可调整要求（如减少层级或节点数量）后重试。`
    }
    aiStatus.value = 'done'
    emit('tool-call-status', 'done')
    ElMessage.success(addedNodes > 0 ? `已添加 ${addedCount} 个子节点` : (isAddChild ? '新增子节点失败' : '续写失败'))
    return aiMsg.content
  } catch (error) {
    console.error('AI 生成子节点失败:', error)
    const stopped = error.aborted || aiService.isAborted()
    // 网络类错误给出友好提示，避免直接暴露系统异常信息
    const rawMsg = String(error?.message || error || '未知错误')
    const isNetworkErr = /fetch|network|timeout|超时|请求超时|ECONNREFUSED|ENOTFOUND|API error/i.test(rawMsg)
    const failText = isNetworkErr
      ? `网络异常，请稍后重试。（${rawMsg}）`
      : `${isAddChild ? '新增子节点' : '续写'}失败：${rawMsg}`
    aiMsg.toolCalls[0].status = stopped ? 'stopped' : 'error'
    aiMsg.content = stopped ? (isAddChild ? '已停止新增子节点' : '已停止续写') : failText
    aiStatus.value = stopped ? 'done' : 'error'
    emit('tool-call-status', stopped ? 'done' : 'error')
    if (!stopped) {
      addLog('error', `${actionLabel}失败: ${rawMsg}`, {}, currentConversation.value?.id)
      ElMessage.error(isNetworkErr ? '网络异常，请稍后重试' : (isAddChild ? '新增子节点失败' : '续写失败'))
    }
    return aiMsg.content
  } finally {
    scrollToBottom()
    // 工具内调用（viaTool）时状态与停止标记由外层主循环管理：这里复位会把外层的"已停止"清掉，导致主循环复活
    if (!viaTool) {
      setTimeout(() => {
        aiStatus.value = 'idle'
      }, 500)
      aiService.resetAbort()
    }
    persistConversation()
  }
}

/**
 * AI 新增子节点（右键菜单入口）
 * 与续写共用问答/生成/插入流程，层级按内容需要生成、受用户上限约束（未指定时最多 6 层）。
 * AI 对话中则直接调用 add_child_nodes 工具（工具层已支持 targets 直达，无需先 select_node）。
 */
const aiAddChild = async (nodesOrNode) => {
  return aiContinue(nodesOrNode, { mode: 'add-child' })
}

// AI 背诵改写（严格 JSON 格式：【记忆简写】+重点概括 + 父节点记忆概要）
// 规则：终末节点 → 改写自身；非终末节点 → 逐个改写其直接子节点（每个子节点一个模块），并为该节点生成记忆概要（支持谐音）
// 记录上次改写的目标 uid（工具内再次改写时优先复用，避免重复「选中节点」步骤）
const lastRewriteSourceUids = ref([])

const aiRewrite = async (nodesOrNode, opts = {}) => {
  const viaTool = !!opts.viaTool
  if (pendingContinue.value) {
    ElMessage.warning('请先回答上方的续写提问，或点击「取消续写」')
    return '请先回答续写提问'
  }
  // 工具内调用时外层循环已置为 calling，跳过状态守卫
  if (!viaTool && (aiStatus.value === 'thinking' || aiStatus.value === 'calling')) {
    ElMessage.warning('AI 正在处理中，请稍候...')
    return 'AI 正在处理中'
  }

  let nodes = Array.isArray(nodesOrNode) ? nodesOrNode : [nodesOrNode]
  if (nodes.length === 0 || !nodes[0]) {
    ElMessage.warning('请先选择一个有内容的节点')
    return
  }

  const texts = nodes.map(n => extractNodeText(n))
  const hasContent = texts.some(t => t) || nodes.some(n => (n.children || []).length > 0)
  if (!hasContent) {
    ElMessage.warning('请先选择一个有内容的节点')
    return
  }

  // 改写计划（需求7新逻辑）：
  // - 单节点：直接改写该节点本身，字数 <5 字不允许改写
  // - 多节点：必须是同一父节点的直接子节点，否则中止；改写选中节点并给共同父节点添加概要
  const uidOf = (n) => n.uid || n?.data?.uid
  // 记住本次改写来源节点（工具内「再改一下」可直接复用，无需重新选中）
  lastRewriteSourceUids.value = nodes.map(uidOf).filter(Boolean)

  // 单节点改写：字数限制
  if (nodes.length === 1) {
    const singleText = texts[0] || ''
    if (singleText.length < 5) {
      ElMessage.warning('该节点内容少于 5 个字，不允许背诵改写')
      return
    }
  }

  // 多节点：相关性限制——必须为同一上一级节点的直接子节点
  let commonParent = null
  if (nodes.length > 1) {
    commonParent = detectCommonParent(nodes)
    if (!commonParent) {
      ElMessage.warning('多个节点背诵改写请选择更为相近的节点。')
      return
    }
  }

  const rewriteTargets = nodes
  const generalizationNodes = commonParent ? [commonParent] : []
  if (rewriteTargets.length === 0) {
    ElMessage.warning('没有可改写的节点内容')
    return
  }

  const nodeCountLabel = nodes.length > 1 ? `${nodes.length} 个节点` : `「${(texts[0] || '').slice(0, 20)}」`
  messages.value.push({
    id: genMsgId(),
    role: 'user',
    content: 'AI 背诵改写',
    isAiAction: true
  })
  const aiMsg = {
    id: genMsgId(),
    role: 'assistant',
    content: '正在分析节点上下文并进行背诵改写...',
    toolCalls: [{ name: 'ai_recite_rewrite', displayName: 'AI 背诵改写', status: 'calling' }]
  }
  messages.value.push(aiMsg)
  aiStatus.value = 'thinking'
  emit('tool-call-status', 'thinking')
  scrollToBottom()

  // 直接调用（按钮/右键菜单）时清除上一次遗留的停止标记；工具内调用不重置
  if (!viaTool) {
    stopRequested.value = false
    aiService.resetAbort()
  }

  const generalizationCount = generalizationNodes.length
  // instruction：用户对本次改写的具体要求（或对上次改写结果的修改意见），最高优先级
  // 节点当前文本已是上次改写结果（已写回），天然携带"上次做了什么"；instruction 携带"这次要怎么调整"
  const instructionBlock = (typeof opts.instruction === 'string' && opts.instruction.trim())
    ? `\n用户对本次改写的具体要求（最高优先级，与下方规则冲突时以此为准，必须完整落实）：
${opts.instruction.trim().slice(0, 2000)}
`
    : ''

  const SYS_PROMPT = '你是背诵辅助专家，只输出严格符合要求的 JSON，不输出任何解释或代码块标记。'
  // 多节点（同一父节点的多个子节点）→ 合并成一个背诵概要挂父节点，不改写节点本身；单节点 → 改写节点本身
  const mergeMode = rewriteTargets.length > 1 && generalizationCount > 0

  try {
    if (mergeMode) {
      // ===== 多节点：合并背诵概要（不改写节点） =====
      const context = buildReciteContext(rewriteTargets, generalizationNodes)
      const prompt = buildMergeSummaryPrompt({ count: rewriteTargets.length, context, instructionBlock })
      addLog('send', `AI 背诵改写请求（合并概要）:\n${prompt}`, { model: currentModelName.value }, currentConversation.value?.id)
      const choice = await aiService.chat(prompt, SYS_PROMPT)
      const content = choice?.message?.content || ''
      addLog('receive', `AI 背诵改写返回:\n${content}`, { model: currentModelName.value }, currentConversation.value?.id)

      if (aiService.isAborted()) {
        aiMsg.toolCalls[0].status = 'stopped'
        aiMsg.content = '已停止背诵改写'
        aiStatus.value = 'done'
        emit('tool-call-status', 'done')
        return
      }

      const summary = parseMergeSummary(content)
      if (!summary) {
        aiMsg.toolCalls[0].status = 'error'
        aiMsg.content = '改写失败：AI 返回格式无法解析'
        aiStatus.value = 'error'
        emit('tool-call-status', 'error')
        ElMessage.error('改写失败')
        return
      }

      const parentNode = generalizationNodes[0]
      const ok = setNodeGeneralization(parentNode, toGeneralizationHtml(summary))
      // review A1：setNodeGeneralization 内部已 scheduleMindMapRender，这里不需要再 render
      aiMsg.toolCalls[0].status = ok ? 'done' : 'error'
      aiMsg.content = ok
        ? `已为「${extractNodeText(parentNode)}」生成背诵概要：\n${summary.replace(/\n/g, ' / ')}\n\n可通过 Ctrl+Z 撤销。`
        : '改写失败：写入概要失败'
      aiStatus.value = ok ? 'done' : 'error'
      emit('tool-call-status', ok ? 'done' : 'error')
      if (ok) ElMessage.success('已生成背诵概要')
      else ElMessage.error('改写失败')
      return aiMsg.content
    }

    // ===== 单节点：改写节点本身 =====
    const context = buildReciteContext(rewriteTargets, [])
    const prompt = buildRecitePrompt({ count: rewriteTargets.length, context, instructionBlock })
    addLog('send', `AI 背诵改写请求:\n${prompt}`, { model: currentModelName.value }, currentConversation.value?.id)
    const choice = await aiService.chat(prompt, SYS_PROMPT)
    const content = choice?.message?.content || ''
    addLog('receive', `AI 背诵改写返回:\n${content}`, { model: currentModelName.value }, currentConversation.value?.id)

    if (aiService.isAborted()) {
      aiMsg.toolCalls[0].status = 'stopped'
      aiMsg.content = '已停止背诵改写'
      aiStatus.value = 'done'
      emit('tool-call-status', 'done')
      return
    }

    const parsed = parseRewriteJSON(content, rewriteTargets.length)

    let replaced = 0
    for (let i = 0; i < rewriteTargets.length; i++) {
      const item = parsed.rewrites.find(r => Number(r.index) === i + 1) || parsed.rewrites[i]
      const newText = item && item.text ? String(item.text).trim() : ''
      if (!newText) continue
      const node = rewriteTargets[i]
      try {
        // 改写前先把原始内容记为备注（已存在备注则保留最早一版，避免多次改写相互覆盖）
        const originalText = extractNodeText(node)
        if (originalText) {
          let hasNote = false
          try { hasNote = !!(typeof node.getData === 'function' && node.getData('note')) } catch (e) {}
          if (!hasNote && typeof node.setNote === 'function') {
            node.setNote(originalText)
          }
        }
        if (typeof node.setText === 'function') {
          node.setText(toReciteRewriteHtml(newText), true)
        } else if (typeof node.setData === 'function') {
          node.setData({ text: toReciteRewriteHtml(newText), richText: true })
        }
        replaced++
      } catch (e) {
        console.error('替换节点文本失败:', e)
      }
    }

    // review A1：forEach 改完所有节点后的"一次性" render → 改为防抖 render，
    // 如果上面 setNodeGeneralization 已经在跑，会合并到同一帧
    scheduleMindMapRender()

    aiMsg.toolCalls[0].status = replaced > 0 ? 'done' : 'error'
    const summaryLines = parsed.rewrites
      .filter(r => r.text)
      .map((r, i) => `${i + 1}. ${r.text}`)
    aiMsg.content = replaced > 0
      ? `已完成 ${replaced} 个节点的背诵改写（【记忆简写】+重点概括）：\n${summaryLines.join('\n')}\n\n可通过 Ctrl+Z 撤销本次改写。`
      : '改写失败：AI 返回格式无法解析，节点未被修改'
    aiStatus.value = 'done'
    emit('tool-call-status', 'done')
    ElMessage.success(replaced > 0 ? `已改写 ${replaced} 个节点` : '改写失败')
    return aiMsg.content
  } catch (error) {
    console.error('AI 背诵改写失败:', error)
    const stopped = error.aborted || aiService.isAborted()
    aiMsg.toolCalls[0].status = stopped ? 'stopped' : 'error'
    aiMsg.content = stopped ? '已停止背诵改写' : `背诵改写失败: ${error.message}`
    aiStatus.value = stopped ? 'done' : 'error'
    emit('tool-call-status', stopped ? 'done' : 'error')
    if (!stopped) {
      addLog('error', `AI 背诵改写失败: ${error.message}`, {}, currentConversation.value?.id)
    }
    return aiMsg.content
  } finally {
    scrollToBottom()
    // 工具内调用（viaTool）时状态与停止标记由外层主循环管理：这里复位会把外层的"已停止"清掉，导致主循环复活
    if (!viaTool) {
      // 无论成功/失败/停止都复位状态，避免卡在 thinking 导致后续 AI 功能无响应
      setTimeout(() => {
        aiStatus.value = 'idle'
      }, 500)
      aiService.resetAbort()
    }
    persistConversation()
  }
}

// ============================================================
// 全局背诵改写（需求8）：主控 + 子 Agent 动态批量处理整张导图
// ============================================================
const aiRewriteFullMap = async () => {
  if (pendingContinue.value) {
    ElMessage.warning('请先回答上方的续写提问，或点击「取消续写」')
    return '请先回答续写提问'
  }
  if (aiStatus.value === 'thinking' || aiStatus.value === 'calling') {
    ElMessage.warning('AI 正在处理中，请稍候...')
    return 'AI 正在处理中'
  }
  const root = props.mindMap?.renderer?.root
  if (!root) {
    ElMessage.warning('思维导图为空，无法全局背诵改写')
    return
  }

  // 阶段一：树扫描，收集所有节点（层级路径 + 文本）
  const collect = []
  const walk = (n, level, pathArr) => {
    if (!n || n.isGeneralization) return
    const t = extractNodeText(n)
    const p = pathArr.concat(t ? [t] : [])
    if (t) collect.push({ node: n, level, text: t, path: p })
    ;(n.children || []).forEach(c => walk(c, level + 1, p))
  }
  walk(root, 0, [])
  const total = collect.length
  if (total === 0) {
    ElMessage.warning('思维导图没有可改写的内容')
    return
  }

  // 分块：≤50 整体一块；>50 按一级分支拆分
  let blocks = []
  if (total <= 50) {
    blocks = [{ name: '全文', nodes: collect }]
  } else {
    ;(root.children || []).forEach(rc => {
      if (!rc || rc.isGeneralization) return
      const nodesInBlock = []
      const walkBlock = (n, level, pathArr) => {
        if (!n || n.isGeneralization) return
        const t = extractNodeText(n)
        const p = pathArr.concat(t ? [t] : [])
        if (t) nodesInBlock.push({ node: n, level, text: t, path: p })
        ;(n.children || []).forEach(c => walkBlock(c, level + 1, p))
      }
      walkBlock(rc, 1, [extractNodeText(root)])
      if (nodesInBlock.length) blocks.push({ name: extractNodeText(rc) || '未命名分支', nodes: nodesInBlock })
    })
    if (blocks.length === 0) blocks = [{ name: '全文', nodes: collect }]
  }

  // 超大导图（>500 节点）：每个块限制 80 节点，超出部分拆成新块
  if (total > 500) {
    const capped = []
    blocks.forEach(b => {
      const parts = []
      for (let i = 0; i < b.nodes.length; i += 80) {
        parts.push(b.nodes.slice(i, i + 80))
      }
      parts.forEach((p, i) => capped.push({ name: `${b.name}（${i + 1}）`, nodes: p }))
    })
    blocks = capped
  }

  // 阶段一.2：关联预分析——仅骨架（前2层）发一次，产出全局逻辑关联图谱
  const rootText = extractNodeText(root)
  const rootChildrenText = (root.children || [])
    .filter(c => !c.isGeneralization)
    .map(c => extractNodeText(c))
    .filter(Boolean)
    .join('、')

  messages.value.push({
    id: genMsgId(),
    role: 'user',
    content: '全局背诵改写',
    isAiAction: true
  })
  const aiMsg = {
    id: genMsgId(),
    role: 'assistant',
    content: `正在分析全局关联... 共 ${blocks.length} 个分支块待处理`,
    toolCalls: [{
      name: 'ai_rewrite_full_map',
      displayName: '全局背诵改写',
      status: 'calling'
    }]
  }
  messages.value.push(aiMsg)
  aiStatus.value = 'thinking'
  emit('tool-call-status', 'thinking')
  scrollToBottom()
  stopRequested.value = false
  aiService.resetAbort()

  try {
    // 骨架关联分析
    let relationGraph = ''
    try {
      const skeletonPrompt = `你是思维导图结构分析专家。下面是思维导图的骨架（根节点 + 一级分支），请分析这些分支之间的逻辑关系（因果、并列、递进、对比等），输出全局逻辑关联图谱，简洁说明哪些分支讲同一主题、哪些存在概念交叉。只输出分析结论，200 字内。

根节点：${rootText || '（无）'}
一级分支：${rootChildrenText || '（无）'}`
      const rel = await aiService.chat(skeletonPrompt, '你是结构分析专家，只输出简洁的逻辑关联分析。')
      relationGraph = rel?.message?.content || ''
    } catch (e) {
      relationGraph = ''
    }

    // 阶段二：并行深度提取（受并发降级管控）
    const limiter = new ConcurrencyLimiter({
      maxConcurrency: 10,
      maxRetries: 2,
      log: (msg) => addLog('info', `[全局背诵改写] ${msg}`, {}, currentConversation.value?.id)
    })
    let doneBlocks = 0
    const branchResults = []
    await limiter.runAll(blocks, async (block) => {
      const lines = block.nodes.map(n => `${'  '.repeat(Math.max(0, n.level - 1))}- ${n.text}`).join('\n')
      const prompt = `你是思维导图深度分析专家。以下是导图「${props.currentFileName || ''}」中一个分支「${block.name}」的完整内容（缩进表示层级）。请深入理解该分支及关联上下文，提取：核心论点、关键词、逻辑主线，忽略冗余修饰词，保留完整语义。

${lines}

请返回严格 JSON：{"branchName": "${block.name}", "corePoints": ["核心论点1", "核心论点2"], "keywords": ["关键词1", "关键词2"]}`
      const choice = await aiService.chat(prompt, '你是深度分析专家，只输出严格 JSON，不输出解释。')
      const content = choice?.message?.content || ''
      const m = content.match(/\{[\s\S]*\}/)
      if (m) {
        try {
          const obj = JSON.parse(m[0])
          branchResults.push(obj)
          return obj
        } catch (e) {}
      }
      return { branchName: block.name, corePoints: [], keywords: [] }
    }, {
      isAborted: () => aiService.isAborted(),
      onProgress: (p) => {
        doneBlocks = p.done
        aiMsg.content = `正在分析全局关联... ${doneBlocks}/${blocks.length} 分支处理中...`
      }
    })

    if (aiService.isAborted()) {
      aiMsg.toolCalls[0].status = 'stopped'
      aiMsg.content = '已停止全局背诵改写'
      aiStatus.value = 'done'
      emit('tool-call-status', 'done')
      return aiMsg.content
    }

    // 阶段三：主控融会贯通，生成最终输出
    const branchSummary = branchResults.map(b => `【${b.branchName || '分支'}】\n核心观点：${(b.corePoints || []).join('；')}\n关键词：${(b.keywords || []).join('、')}`).join('\n\n')
    const finalPrompt = `你是思维导图背诵方法专家。下面是整张导图的全局逻辑关联图谱和各分支的深度提取结果。请据此生成三部分内容：

【关联图谱】
${relationGraph || '（无）'}

【各分支深度提取】
${branchSummary || '（无）'}

请输出 Markdown 大纲（层级不超过 4 级，根节点为一级标题），结构如下：

# 📘 全文背诵框架
## 全文逻辑框架图
（以缩进列表展示全文层级逻辑结构和章节大意）
## 易混淆/关联点辨析表
（列出易混淆概念及其区别）
## 全文背诵口诀与记忆策略
（至少 3 条串联全文核心脉络的顺口溜或逻辑链条记忆法）

直接输出 Markdown，不要代码块围栏。`
    aiMsg.content = '正在融会贯通生成全文背诵框架...'
    const finalChoice = await aiService.chat(finalPrompt, '你是背诵方法专家，输出规范 Markdown 大纲，层级不超过 4 级。')
    const finalMarkdown = finalChoice?.message?.content || ''

    if (aiService.isAborted()) {
      aiMsg.toolCalls[0].status = 'stopped'
      aiMsg.content = '已停止全局背诵改写'
      aiStatus.value = 'done'
      emit('tool-call-status', 'done')
      return aiMsg.content
    }

    // 解析并插入到根节点下
    let tree = null
    try {
      tree = parseMarkdownToTree(finalMarkdown.replace(/^#\s*/m, ''))
    } catch (e) {
      tree = null
    }
    let inserted = false
    if (tree && tree.data && tree.data.text && tree.children && tree.children.length > 0) {
      try {
        // 根标题作为框架节点标题，子节点为三个部分。
        // parseMarkdownToTree 返回的节点 text 已是富文本 HTML（<p><span>...</span></p>），直接复用，不再二次转义。
        const pickHtml = (n) => (n?.data?.text && String(n.data.text).trim()) ? String(n.data.text) : '<p><span></span></p>'
        const frameworkNode = {
          data: {
            text: toRichTextHtml('📘 全文背诵框架'),
            uid: createUid(),
            richText: true,
            borderColor: '#007aff',
            borderWidth: 2, expand: true   // review 修复：默认展开，避免新插入节点左右位置未测量导致重叠
          },
          children: tree.children.slice(0, 3).map(c => ({
            data: {
              text: pickHtml(c),
              uid: createUid(),
              richText: true,
              expand: true,
            },
            children: (c.children || []).slice(0, 30).map(cc => ({
              data: {
                text: pickHtml(cc),
                uid: createUid(),
                richText: true,
                expand: true,
              },
              children: []
            }))
          }))
        }
        props.mindMap.execCommand('INSERT_MULTI_CHILD_NODE', [root], [frameworkNode])
        inserted = true
        // 全文背诵框架含大量富文本节点，INSERT_MULTI_CHILD_NODE 仅做部分渲染，
        // 富文本节点首帧尺寸可能未测量到位；改用 reRender 完全重绘（清空节点缓存）
        // 强制重新测量与布局，避免思维导图模式下节点重叠覆盖。
        // 多阶段强制重绘（review 修复：避免「全文背诵改写」节点重叠/覆盖）
        // 同步 / rAF / setTimeout 三次强制重排，规避富文本节点首帧未测量造成的节点重叠
        const __forceRelayout = (mode) => {
          try {
            // review A1：reRender 是同步大操作（拆掉旧视图 + 重建），不防抖；
            // 这里保留同步调用，仅 render() 路径走 scheduleMindMapRender
            if (typeof props.mindMap.reRender === 'function') {
              // mode='SWITCH_VIEW' 提示 simple-mind-map 走视图切换路径（更彻底的清理 + 重测）
              props.mindMap.reRender(() => {}, mode || 'SWITCH_VIEW')
            } else if (typeof props.mindMap.render === 'function') {
              scheduleMindMapRender()
            }
          } catch (e) {}
        }
        __forceRelayout('SWITCH_VIEW')
        try {
          if (typeof requestAnimationFrame !== 'undefined') {
            requestAnimationFrame(() => {
              __forceRelayout('SWITCH_VIEW')
              setTimeout(() => __forceRelayout('SWITCH_VIEW'), 50)
            })
          } else {
            setTimeout(() => __forceRelayout('SWITCH_VIEW'), 80)
          }
        } catch (e) { /* ignore */ }
      } catch (e) {
        console.error('插入全文背诵框架节点失败:', e)
      }
    }

    aiMsg.toolCalls[0].status = inserted ? 'done' : 'error'
    aiMsg.content = inserted
      ? `已完成全局背诵改写（共 ${total} 个节点，${blocks.length} 个分支块），已在根节点下新建「📘 全文背诵框架」节点（蓝色边框），包含：全文逻辑框架图、易混淆辨析表、背诵口诀与记忆策略。可通过 Ctrl+Z 撤销。`
      : '全局背诵改写完成，但生成框架节点失败：AI 返回内容无法解析为 Markdown 大纲。'
    aiStatus.value = inserted ? 'done' : 'error'
    emit('tool-call-status', inserted ? 'done' : 'error')
    addLog('receive', aiMsg.content, { model: currentModelName.value }, currentConversation.value?.id)
    emit('log-updated')
    return aiMsg.content
  } catch (error) {
    console.error('[全局背诵改写] 失败:', error)
    const stopped = error.aborted || aiService.isAborted()
    aiMsg.toolCalls[0].status = stopped ? 'stopped' : 'error'
    aiMsg.content = stopped ? '已停止全局背诵改写' : `全局背诵改写失败：${error.message || '未知错误'}`
    aiStatus.value = stopped ? 'done' : 'error'
    emit('tool-call-status', stopped ? 'done' : 'error')
    if (!stopped) {
      addLog('error', `全局背诵改写失败: ${error.message}`, {}, currentConversation.value?.id)
      emit('log-updated')
    }
    return aiMsg.content
  } finally {
    setTimeout(() => { aiStatus.value = 'idle' }, 500)
    aiService.resetAbort()
    persistConversation()
  }
}

// review A1：AI 工作期间频繁整树 render 是"卡 + 转圈"主因之一。
// 这里用一个微任务防抖器：节点数据照常更新，但 mindMap.render() 合并到下一个 requestAnimationFrame
// 调用一次。批量场景下从 N 次 render 降到 1 次，预期 5~10 倍提速。
let __renderRafId = null
// review A3：流式输出节流标志位；onChunk 不断累加 fullResponse，但 aiMsg.content 只在 raf 触发时同步
let __streamFlushPending = false
const scheduleMindMapRender = () => {
  if (!props.mindMap || typeof props.mindMap.render !== 'function') return
  if (__renderRafId != null) return // 已有待执行的 render，跳过
  const raf = (typeof window !== 'undefined' && window.requestAnimationFrame)
    ? window.requestAnimationFrame.bind(window)
    : (cb) => setTimeout(cb, 16)
  __renderRafId = raf(() => {
    __renderRafId = null
    try { props.mindMap.render() } catch (e) { /* 渲染异常吞掉，避免影响后续 AI 流 */ }
  })
}
// 同时 flush 用于"立刻需要画面同步"的场景（如 AI 调用结束、用户点了停止）
const flushMindMapRender = () => {
  if (__renderRafId != null) {
    const cId = __renderRafId
    const cancel = (typeof window !== 'undefined' && window.cancelAnimationFrame)
      ? window.cancelAnimationFrame.bind(window)
      : clearTimeout
    cancel(cId)
    __renderRafId = null
    try { props.mindMap.render() } catch (e) { /* ignore */ }
  }
}

// 设置/更新节点记忆概要（新概要走 ADD_GENERALIZATION 命令以支持 Ctrl+Z；已有概要直接更新）
const setNodeGeneralization = (node, html) => {
  try {
    const existing = typeof node.getData === 'function' ? node.getData('generalization') : node?.data?.generalization
    const list = Array.isArray(existing) ? existing : (existing ? [existing] : [])
    if (list.length > 0) {
      // 原地更新既有概要对象，避免替换引用导致已创建的概要节点不刷新。
      // resetRichText 必须为 false，否则渲染时会剥掉【】里的绿色内联样式。
      Object.assign(list[0], { text: html, richText: true, resetRichText: false })
    } else {
      list.push({ text: html, richText: true, resetRichText: false, uid: createUid() })
    }
    node.setData({ generalization: list })
    // review A1：批量 render 防抖（取代原 props.mindMap.render()）
    scheduleMindMapRender()
    return true
  } catch (e) {
    console.error('设置记忆概要失败:', e)
    return false
  }
}

// 构建背诵改写上下文：列出上级节点 + 全部同级节点（► 标记改写目标）+ 各 ► 节点的子节点（仅用于理解）+ ◆ 概要节点。
// 注意：子节点内容仅用于帮助 AI 理解每个 ► 节点的含义，最终概要/改写仍围绕 ► 节点本身，不把子节点当独立条目展开。
const buildReciteContext = (targets, generalizationNodes = []) => {
  let ctx = ''
  if (props.currentFileName) ctx += `【文件来源】${props.currentFileName}\n`

  const uidOf = (n) => n.uid || n?.data?.uid
  const targetIndexByUid = new Map()
  targets.forEach((n, i) => targetIndexByUid.set(uidOf(n), i + 1))

  // 按父节点分组（保持目标顺序）
  const groups = []
  const groupByParentKey = new Map()
  targets.forEach(n => {
    const parent = getParentNode(n)
    const key = parent ? (uidOf(parent) || extractNodeText(parent)) : 'ROOT'
    if (!groupByParentKey.has(key)) {
      groupByParentKey.set(key, true)
      groups.push({ parent, nodes: [] })
    }
    groups.find(g => (g.parent ? (uidOf(g.parent) || extractNodeText(g.parent)) : 'ROOT') === key).nodes.push(n)
  })

  // 子节点展开（限深度，仅用于理解）：截断过长文本，避免 token 爆炸
  const subtreeOf = (node, depth, maxDepth = 2) => {
    const children = node.children || []
    if (!children.length || depth > maxDepth) return ''
    let out = ''
    for (const c of children) {
      let t = extractNodeText(c)
      if (t) {
        if (t.length > 50) t = t.slice(0, 50) + '…'
        out += `${'  '.repeat(depth)}- ${t}\n`
      }
      out += subtreeOf(c, depth + 1, maxDepth)
    }
    return out
  }

  const listed = new Set()
  groups.forEach(group => {
    const parentText = group.parent ? extractNodeText(group.parent) : ''
    ctx += `\n【上级节点】${parentText || '（无，根节点）'}\n`
    const siblings = group.parent && group.parent.children ? group.parent.children : group.nodes
    if (siblings.length > 0) {
      ctx += `【全部同级节点（带 ► 序号的为本次要改写的节点）】\n`
      siblings.forEach(c => {
        const t = extractNodeText(c)
        if (!t) return
        const idx = targetIndexByUid.get(uidOf(c))
        if (idx) {
          listed.add(idx)
          ctx += `► ${idx}. ${t}\n`
        } else {
          ctx += `  ${t}\n`
        }
      })
    }
  })

  // 各 ► 节点的子节点内容（仅用于理解节点含义）
  const withChildren = targets.filter(n => (n.children || []).length > 0)
  if (withChildren.length > 0) {
    ctx += `\n【各 ► 节点的子节点内容（仅用于理解各节点含义，输出仍围绕 ► 节点本身）】\n`
    withChildren.forEach(n => {
      const idx = targetIndexByUid.get(uidOf(n))
      const subtree = subtreeOf(n, 1)
      if (subtree) ctx += `「${extractNodeText(n)}」的子节点：\n${subtree}`
    })
  }

  // 兜底：未出现在同级列表中的目标（异常结构）
  const orphans = targets.filter((n, i) => !listed.has(i + 1))
  if (orphans.length > 0) {
    ctx += `\n【要改写的节点】\n`
    orphans.forEach(n => {
      ctx += `► ${targetIndexByUid.get(uidOf(n))}. ${extractNodeText(n)}\n`
    })
  }

  if (generalizationNodes.length > 0) {
    ctx += `\n【需要生成记忆概要的父节点（◆ 序号对应 generalizations 的 index）】\n`
    generalizationNodes.forEach((n, i) => {
      ctx += `◆ ${i + 1}. ${extractNodeText(n) || '（无文本）'}\n`
    })
  }
  return ctx
}

// ============ 背诵改写 prompt 构建（供单次/并发分组复用） ============
// 基础规则：仅改写 ► 节点（不含概要），并发分组时用，减少 token
const RECITE_RULES_BASIC = `改写规则（严格遵守）：
1. 每个 ► 节点的改写结果必须是固定格式：【记忆简写】+重点概括。【记忆简写】优先只取 1 个字；仅当 1 个字无法与同层级其他节点区分时，才扩展到 2~4 个字，绝对不要超过 4 个字。允许使用谐音字，但只允许自然易懂的谐音。重点概括部分：如果原节点文字 ≤ 12 个字，必须直接保留原节点文字，不要扩展、不要改写成更长的句子；如果原节点文字较长，才概括为 40 字内的重点概括。
2. 必须基于上级节点和同级节点的上下文理解内容，改写不得遗漏关键知识点。重点概括聚焦该节点的核心考点/得分点/易错点，不要写一般性的空话、套话。`

const RECITE_RETURN_FORMAT = `返回格式（严格 JSON，不要返回任何其他内容，不要 markdown 代码块）：
{"rewrites": [{"index": 1, "text": "【记忆简写】重点概括"}]}`

// 构建单节点改写 prompt
const buildRecitePrompt = ({ count, context, instructionBlock }) => {
  return `你是一个背诵辅助专家。请对下面思维导图中标记为 ►（带序号）的 ${count} 个节点进行背诵改写。
${instructionBlock}
${context}

${RECITE_RULES_BASIC}

${RECITE_RETURN_FORMAT}

其中 rewrites 的 index 对应 ► 序号（从 1 开始），数量必须等于 ${count}。`
}

// 多节点合并背诵概要 prompt：不改写节点本身，而是把框选的几个同级节点合并成一个多行概要挂父节点
// 第一行：记忆简写串联（方便背诵）；第二行起：逐个节点解释。子节点仅用于理解，输出仍围绕 ► 节点本身。
const buildMergeSummaryPrompt = ({ count, context, instructionBlock }) => {
  return `你是一个背诵辅助专家。请为下面思维导图中标记为 ►（带序号）的 ${count} 个同级节点，生成一个合并的「背诵概要」（不要改写这些节点本身的文字）。

${instructionBlock}
${context}

生成要求（严格遵守）：
1. 概要 text 为多行内容，用 \\n 分隔：
   - 第一行：记忆简写串联（每个 ► 节点取 1 个字，仅当 1 个字无法与其他节点区分时才扩展到 2~4 字，按顺序串联全部节点，例如「辩历系战底创」）。
   - 第二行起：每个 ► 节点一行，格式「简写=节点名：一句解释」，解释要简洁（15 字内）、突出该节点的核心考点/得分点。
2. 各 ► 节点的子节点内容仅用于理解节点含义，概要输出必须围绕 ► 节点本身，不要把子节点当作独立条目展开、不要遗漏任何 ► 节点。
3. 简写之间不得重复，优先首字串联、语义分组；谐音仅在自然顺口时使用，禁止生硬谐音、为押韵扭曲原意、编造无意义联想。

返回格式（严格 JSON，不要返回任何其他内容，不要 markdown 代码块）：
{"summary": "第一行\\n第二行\\n第三行"}`
}

// 解析合并背诵概要返回（容错：剥离思考块/代码围栏，优先取 summary 字段，其次取 generalizations[0].text，最终降级取全文）
const parseMergeSummary = (content) => {
  let raw = String(content || '').trim()
  raw = raw.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, '').trim()
  raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start !== -1 && end > start) {
    try {
      const obj = JSON.parse(raw.slice(start, end + 1))
      if (obj && typeof obj.summary === 'string' && obj.summary.trim()) return obj.summary.trim()
      if (obj && Array.isArray(obj.generalizations) && obj.generalizations[0] && obj.generalizations[0].text) {
        return String(obj.generalizations[0].text).trim()
      }
    } catch (e) { /* 继续降级 */ }
  }
  return raw
}

// 清洗改写文本：去掉 AI 输出时多余的标点前缀（冒号、空格、破折号、逗号等），
// 避免把 ":【史析】..." 之类的前缀冒号一起写入节点
const cleanRewriteText = (t) => {
  if (!t) return ''
  return String(t)
    .replace(/^[\s:：;；,，.。、\-—–·]+/, '')
    .trim()
}

// 解析背诵改写的严格 JSON 返回（容错：剥离代码块围栏、截取 JSON 主体、正则提取、降级按行解析）
const parseRewriteJSON = (content, nodeCount) => {
  let raw = String(content || '').trim()
  // 推理模型可能在正文前输出 <think>...</think> 思考块，先剥离（含未闭合的情况）
  raw = raw.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, '').trim()
  raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start !== -1 && end > start) {
    const body = raw.slice(start, end + 1)
    try {
      const obj = JSON.parse(body)
      if (obj && Array.isArray(obj.rewrites)) {
        return {
          rewrites: obj.rewrites.filter(r => r && r.text).map(r => ({ ...r, text: cleanRewriteText(r.text) })),
          generalizations: Array.isArray(obj.generalizations)
            ? obj.generalizations.filter(g => g && g.text).map(g => ({ ...g, text: cleanRewriteText(g.text) }))
            : [],
          memoryTip: typeof obj.memoryTip === 'string' ? cleanRewriteText(obj.memoryTip) : ''
        }
      }
    } catch (e) {
      // JSON 损坏（缺引号/多余字符）→ 继续正则容错提取
    }
    // 容错提取：按 "generalizations" 关键字分段，正则抓取 {index,text} 条目
    const extracted = extractIndexTextEntries(body)
    if (extracted.rewrites.length > 0) {
      return extracted
    }
  }
  // 降级：按行解析为改写结果（◆ 开头的行视为记忆概要）
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean)
  return {
    rewrites: lines.filter(l => !l.startsWith('◆')).slice(0, nodeCount).map((t, i) => ({ index: i + 1, text: cleanRewriteText(t) })),
    generalizations: lines.filter(l => l.startsWith('◆')).map((t, i) => ({ index: i + 1, text: cleanRewriteText(t.replace(/^◆\s*/, '')) })),
    memoryTip: ''
  }
}

/**
 * 容错提取 {index, text} 条目（应对 AI 返回 JSON 缺引号、text 值漏左引号等损坏）
 * 按 "generalizations" 关键字分段，分别提取 rewrites 与 generalizations
 */
const extractIndexTextEntries = (raw) => {
  const genIdx = raw.indexOf('"generalizations"')
  const rewritesPart = genIdx !== -1 ? raw.slice(0, genIdx) : raw
  const genPart = genIdx !== -1 ? raw.slice(genIdx) : ''
  const extractEntries = (part) => {
    const entries = []
    // 匹配 "index":N ... "text": "..."；text 值允许缺引号，内容不含英文引号与半角逗号
    const re = /"index"\s*:\s*(\d+)[\s\S]*?"text"\s*:\s*"?([^"]*?)"?(?=\s*[,}])/g
    let m
    while ((m = re.exec(part)) !== null) {
      const text = cleanRewriteText(m[2])
      if (text) entries.push({ index: Number(m[1]), text })
    }
    return entries
  }
  const memoryTip = (() => {
    const m = /"memoryTip"\s*:\s*"([^"]*)"/.exec(raw)
    return m ? cleanRewriteText(m[1]) : ''
  })()
  return {
    rewrites: extractEntries(rewritesPart),
    generalizations: extractEntries(genPart),
    memoryTip
  }
}

// AI 智能挖空（使用专用挖空模块，支持智能/激进模式 + 自动降级 + 批量处理）
// scope='root' 时进行全文挖空：忽略选中状态，对整张思维导图所有节点挖空
const aiCloze = async (nodesOrNode, opts = {}) => {
  const viaTool = !!opts.viaTool
  const isFullMap = opts.scope === 'root'
  if (pendingContinue.value) {
    ElMessage.warning('请先回答上方的续写提问，或点击「取消续写」')
    return '请先回答续写提问'
  }
  // 工具内调用时外层循环已置为 calling，跳过状态守卫
  if (!viaTool && (aiStatus.value === 'thinking' || aiStatus.value === 'calling')) {
    ElMessage.warning('AI 正在处理中，请稍候...')
    return 'AI 正在处理中'
  }

  // 统一转为数组（全文挖空不需要选中节点）
  const nodes = Array.isArray(nodesOrNode) ? nodesOrNode : [nodesOrNode]
  if (!isFullMap && (nodes.length === 0 || !nodes[0])) {
    ElMessage.warning('请先选择一个有内容的节点')
    return
  }

  // 初始化挖空模块（绑定 mindMap 引用）
  if (props.mindMap) {
    initCloze(props.mindMap)
  }

  if (!isFullMap) {
    highlightNodes(nodes)
  }

  // 全文挖空时，估算并行子 Agent 数量并在消息列表中展示；
  // 内容很少时仍只显示 1 个任务，内容多时按每批 10 个节点拆分。
  let fullMapCandidateCount = 0
  let workerCount = 1
  if (isFullMap && props.mindMap?.renderer?.root) {
    const walk = (n) => {
      if (!n || n.isGeneralization) return
      const t = extractNodeText(n)
      if (t) fullMapCandidateCount++
      ;(n.children || []).forEach(walk)
    }
    walk(props.mindMap.renderer.root)
    workerCount = fullMapCandidateCount <= 10
      ? 1
      : Math.min(Math.max(Math.ceil(fullMapCandidateCount / 10), 2), 5)
  }

  const isMulti = isFullMap || nodes.length > 1
  const nodeCount = isFullMap ? '整张导图' : (isMulti ? `${nodes.length} 个节点` : '该节点')

  // 添加用户消息（显示操作意图）
  messages.value.push({
    id: genMsgId(),
    role: 'user',
    content: isFullMap ? '全文挖空' : 'AI 智能挖空',
    isAiAction: true
  })

  // 添加 AI 消息占位（显示进度）；全文大图时展示“主任务 + N 路并行子 Agent”。
  const clozeToolCalls = []
  if (isFullMap && workerCount > 1) {
    clozeToolCalls.push({
      name: 'ai_cloze_full_map',
      displayName: 'AI 全文挖空',
      summary: `${workerCount} 路子 Agent 并行`,
      status: 'calling'
    })
    for (let i = 1; i <= workerCount; i++) {
      clozeToolCalls.push({
        name: `ai_cloze_worker_${i}`,
        displayName: `全文挖空子Agent ${i}`,
        status: 'calling'
      })
    }
  } else {
    clozeToolCalls.push({
      name: isFullMap ? 'ai_cloze_full_map' : 'ai_cloze',
      displayName: isFullMap ? 'AI 全文挖空' : 'AI 智能挖空',
      status: 'calling'
    })
  }
  const aiMsg = {
    id: genMsgId(),
    role: 'assistant',
    content: '',
    toolCalls: clozeToolCalls
  }
  messages.value.push(aiMsg)
  aiStatus.value = 'thinking'
  emit('tool-call-status', 'thinking')

  const finishClozeToolCalls = (status) => {
    ;(aiMsg.toolCalls || []).forEach(tc => { tc.status = status })
  }

  // 直接调用（按钮/右键菜单）时清除上一次遗留的停止标记；工具内调用不重置
  if (!viaTool) {
    stopRequested.value = false
    aiService.resetAbort()
  }

  try {
    if (!viaTool) {
      addLog('tool_call', `工具: AI智能挖空 [${isFullMap ? 'ai_cloze_full_map' : 'ai_cloze'}]\n范围: ${nodeCount}${isFullMap && workerCount > 1 ? `\n并行子 Agent: ${workerCount} 路` : ''}`, {
        toolName: isFullMap ? 'ai_cloze_full_map' : 'ai_cloze'
      }, currentConversation.value?.id)
      emit('log-updated')
    }
    let clozeFallbackUsed = false
    const progressCb = (progress) => {
      let progressText = ''
      if (progress && progress.fallback) {
        clozeFallbackUsed = true
        aiMsg.content = `正在分析${isFullMap ? '整张导图' : '节点内容'}并选择关键词进行挖空...（部分批次 AI 失败，已使用本地规则兜底）`
        scrollToBottom()
        return
      }
      if (progress && typeof progress === 'object' && progress.percent !== undefined) {
        progressText = `已完成 ${progress.done}/${progress.total} 批（${progress.percent}%）`
        if (clozeToolCalls[0]) {
          clozeToolCalls[0].summary = `并行 ${workerCount} 路 · ${progress.percent}%`
        }
        if (isFullMap && workerCount > 1) {
          const doneWorkers = Math.min(workerCount, Math.floor((progress.percent / 100) * workerCount))
          for (let i = 1; i < clozeToolCalls.length; i++) {
            clozeToolCalls[i].status = (i - 1) < doneWorkers ? 'done' : 'calling'
          }
        }
      } else {
        progressText = String(progress || '')
      }
      aiMsg.content = `正在分析${isFullMap ? '整张导图' : '节点内容'}并选择关键词进行挖空... ${progressText}`
      scrollToBottom()
    }
    const count = isFullMap
      ? await smartClozeFullMap('smart', progressCb)
      : await smartClozeNodes(nodes, 'smart', progressCb)

    if (!count) {
      finishClozeToolCalls('error')
      aiMsg.content = 'AI 智能挖空失败：没有识别到可挖空的关键词。节点文字可能过短、都是标点或没有适合挖空的实义词；请换几个内容更完整的节点重试，或手动选中文字按 Ctrl+H 挖空。'
      aiStatus.value = 'error'
      emit('tool-call-status', 'error')
      addLog('tool_result', `工具: AI智能挖空 [${isFullMap ? 'ai_cloze_full_map' : 'ai_cloze'}]\n结果: 挖空 0 个关键词（未识别到可挖空内容）`, {
        toolName: isFullMap ? 'ai_cloze_full_map' : 'ai_cloze',
        count: 0
      }, currentConversation.value?.id)
      emit('log-updated')
      return aiMsg.content
    }

    // 挖空成功
    finishClozeToolCalls('done')
    aiMsg.content = `已完成 ${nodeCount} 的智能挖空，共挖空 ${count} 个关键词。${clozeFallbackUsed ? '\n\n说明：部分节点因 AI 失败，已使用更保守的本地规则兜底挖空。' : ''}\n\n挖空内容已隐藏（半透明紫底+紫下划线），可通过画布右键菜单「显示/隐藏挖空」切换显隐状态。可通过 Ctrl+Z 撤销。`
    aiStatus.value = 'done'
    emit('tool-call-status', 'done')

    // 确保挖空样式应用
    setTimeout(() => applyClozeStyles(), 100)
    setTimeout(() => applyClozeStyles(), 300)

    addLog('receive', aiMsg.content, { model: currentModelName.value }, currentConversation.value?.id)
    if (!viaTool) {
      addLog('tool_result', `工具: AI智能挖空 [${isFullMap ? 'ai_cloze_full_map' : 'ai_cloze'}]\n${isFullMap && workerCount > 1 ? `并行子 Agent: ${workerCount} 路\n` : ''}结果: 成功挖空 ${count} 个关键词`, {
        toolName: isFullMap ? 'ai_cloze_full_map' : 'ai_cloze',
        count
      }, currentConversation.value?.id)
    }
    emit('log-updated')
    return aiMsg.content
  } catch (error) {
    console.error('[AI挖空] 失败:', error)
    const stopped = error.aborted || aiService.isAborted()
    finishClozeToolCalls(stopped ? 'stopped' : 'error')
    aiMsg.content = stopped ? '已停止 AI 挖空' : `AI 挖空失败：${error.message || '未知错误'}`
    aiStatus.value = stopped ? 'done' : 'error'
    emit('tool-call-status', stopped ? 'done' : 'error')
    if (!stopped) {
      addLog('error', `AI挖空失败: ${error.message || '未知错误'}`, { model: currentModelName.value }, currentConversation.value?.id)
      if (!viaTool) {
        addLog('tool_error', `工具: AI智能挖空 [${isFullMap ? 'ai_cloze_full_map' : 'ai_cloze'}]\n错误: ${error.message || '未知错误'}`, {
          toolName: isFullMap ? 'ai_cloze_full_map' : 'ai_cloze'
        }, currentConversation.value?.id)
      }
      emit('log-updated')
    }
    return aiMsg.content
  } finally {
    // 工具内调用（viaTool）时状态与停止标记由外层主循环管理：这里复位会把外层的"已停止"清掉，导致主循环复活
    if (!viaTool) {
      setTimeout(() => {
        aiStatus.value = 'idle'
      }, 500)
      aiService.resetAbort()
    }
    persistConversation()
  }
}

/* ============================================================
 * AI 出题（右键菜单入口）：直接调用 ai_quiz_append 工具
 * 题目+答案+解析合并为一个新子节点，答案与解析自动挖空隐藏
 * ============================================================ */

const aiQuiz = async (nodesOrNode) => {
  const nodes = (Array.isArray(nodesOrNode) ? nodesOrNode : [nodesOrNode]).filter(Boolean)
  if (nodes.length === 0) {
    ElMessage.warning('请先选择一个有内容的节点')
    return
  }
  if (aiStatus.value === 'thinking' || aiStatus.value === 'calling') {
    ElMessage.warning('AI 正在处理中，请稍候...')
    return
  }

  highlightNodes(nodes)
  const nodeCount = nodes.length > 1 ? `${nodes.length} 个节点` : '该节点'

  // 出题目标节点：保留为引用胶囊（让用户在消息列表能看到选中了哪些节点），
  // 但用户消息正文只显示原子操作名"AI 出题"，避免 prompt 泄露。
  messages.value.push({
    id: genMsgId(),
    role: 'user',
    content: 'AI 出题',
    isAiAction: true,
    refs: nodes.map((n, i) => ({
      id: `quiz-${Date.now()}-${i}`,
      uid: n.getData?.('uid') || n.uid,
      fileName: props.currentFileName || '当前导图',
      label: extractNodeText(n) || '未命名节点',
      kindLabel: '出题目标'
    }))
  })

  const aiMsg = {
    id: genMsgId(),
    role: 'assistant',
    content: '',
    toolCalls: [{
      name: 'ai_quiz_append',
      displayName: 'AI 出题',
      status: 'calling'
    }]
  }
  messages.value.push(aiMsg)
  aiStatus.value = 'thinking'
  emit('tool-call-status', 'thinking')
  aiMsg.content = `正在为 ${nodeCount} 出题，请稍候...`
  scrollToBottom()

  stopRequested.value = false
  aiService.resetAbort()

  const uids = nodes.map(n => n.getData?.('uid') || n.uid).filter(Boolean)
  const toolStartTs = Date.now()
  try {
    const result = await handleToolCall(
      { function: { name: 'ai_quiz_append', arguments: JSON.stringify({ targets: { uids } }) } },
      props.mindMap,
      props.activeNode,
      extraHandlers
    )
    const ok = !!result?.success
    aiMsg.toolCalls[0].status = ok ? 'done' : 'error'
    aiMsg.content = result?.message || 'AI 出题完成'
    aiStatus.value = ok ? 'done' : 'error'
    emit('tool-call-status', ok ? 'done' : 'error')
    // 工具逻辑失败（success===false）归类为 tool_error，与主链路及消息卡片状态一致
    addLog(ok ? 'tool_result' : 'tool_error', `用户请求：AI 出题 ${nodeCount}（${nodes.map(n => extractNodeText(n)).filter(Boolean).slice(0, 5).join('、')}）\n工具: ai_quiz_append\n耗时: ${Date.now() - toolStartTs}ms\n结果: ${JSON.stringify(result)}`, {
      toolName: 'ai_quiz_append',
      result
    }, currentConversation.value?.id)
    emit('log-updated')
    scrollToBottom()
    return aiMsg.content
  } catch (error) {
    console.error('[AI出题] 失败:', error)
    aiMsg.toolCalls[0].status = 'error'
    aiMsg.content = `AI 出题失败：${error.message || '未知错误'}`
    aiStatus.value = 'error'
    emit('tool-call-status', 'error')
    addLog('error', `AI出题失败: ${error.message || '未知错误'}`, {}, currentConversation.value?.id)
    emit('log-updated')
    return aiMsg.content
  } finally {
    setTimeout(() => {
      aiStatus.value = 'idle'
    }, 500)
    aiService.resetAbort()
    persistConversation()
  }
}

/* ============================================================
 * 一键整理导图（右键空白区域入口）：调用 reorganize_mindmap 工具，整理为新文件
 * ============================================================ */
const reorganizeMindmap = async () => {
  if (aiStatus.value === 'thinking' || aiStatus.value === 'calling') {
    ElMessage.warning('AI 正在处理中，请稍候...')
    return
  }
  if (!props.mindMap) {
    ElMessage.warning('当前没有打开的导图')
    return
  }
  messages.value.push({
    id: genMsgId(),
    role: 'user',
    content: '一键整理导图',
    isAiAction: true
  })
  const aiMsg = {
    id: genMsgId(),
    role: 'assistant',
    content: '',
    toolCalls: [{ name: 'reorganize_mindmap', displayName: '一键整理导图', status: 'calling' }]
  }
  messages.value.push(aiMsg)
  aiStatus.value = 'thinking'
  emit('tool-call-status', 'thinking')
  aiMsg.content = '正在重新梳理导图框架并生成新文件...'
  scrollToBottom()
  stopRequested.value = false
  aiService.resetAbort()
  const toolStartTs = Date.now()
  try {
    const result = await handleToolCall(
      { function: { name: 'reorganize_mindmap', arguments: JSON.stringify({}) } },
      props.mindMap,
      props.activeNode,
      extraHandlers
    )
    const ok = !!result?.success
    aiMsg.toolCalls[0].status = ok ? 'done' : 'error'
    aiMsg.content = result?.message || '整理完成'
    aiStatus.value = ok ? 'done' : 'error'
    emit('tool-call-status', ok ? 'done' : 'error')
    // 工具逻辑失败（success===false）归类为 tool_error，与主链路及消息卡片状态一致
    addLog(ok ? 'tool_result' : 'tool_error', `用户请求：一键整理导图（整理为新的导图文件）\n工具: reorganize_mindmap\n耗时: ${Date.now() - toolStartTs}ms\n结果: ${JSON.stringify(result)}`, {
      toolName: 'reorganize_mindmap',
      result
    }, currentConversation.value?.id)
    emit('log-updated')
    scrollToBottom()
    return aiMsg.content
  } catch (error) {
    aiMsg.toolCalls[0].status = 'error'
    aiMsg.content = `整理导图失败：${error.message || '未知错误'}`
    aiStatus.value = 'error'
    emit('tool-call-status', 'error')
    addLog('error', `整理导图失败: ${error.message || '未知错误'}`, {}, currentConversation.value?.id)
    emit('log-updated')
    return aiMsg.content
  } finally {
    setTimeout(() => {
      aiStatus.value = 'idle'
    }, 500)
    aiService.resetAbort()
    persistConversation()
  }
}

// 本地规则兜底：AI 语义整理失败（如 429 限流）时，将文档纯文本按行转成 Markdown 大纲（根节点用文件名），保证降级后仍有产出
const buildFallbackMarkdown = (fullText, base) => {
  const lines = String(fullText || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean)
  const out = [`# ${String(base || '文档').replace(/[\r\n]/g, ' ')}`]
  const MAX = 300
  let count = 0
  for (const line of lines) {
    if (count >= MAX) { out.push('- …（内容过多，其余部分已省略）'); break }
    if (/^#{1,6}\s+/.test(line) || /^([-*+]|\d+[.)])\s+/.test(line)) {
      out.push(line)
    } else {
      out.push(`- ${line}`)
    }
    count++
  }
  return out.join('\n')
}

// 文档转思维导图的模板化整理指令：先判断文档类型，再按对应模板生成，并用加粗/符号标注降低阅读成本
const MINDMAP_TEMPLATE_PROMPT = `You are an expert mind-map organizer. First classify the document, then build a Markdown outline with the matching template.

Classify:
1. Knowledge/points (textbook, exam, notes) → chapter → point → items
2. Process/steps → stage → step
3. Timeline/phase (history, project, review) → time/phase → event/conclusion
4. Analysis/argument → topic → argument → evidence/analysis
5. Table/tabular (xlsx/csv, Markdown tables) → header columns → data rows → cell values
6. Other → topic hierarchy

Rules:
- Use # for levels, max 6. Keep original terms/points/conclusions; no fabrication, no over-summarizing, no line-by-line copy.
- Bold key content with **...** (point name / step / time / argument / core conclusion).
- Process: prefix each step with 【流程N】.
- Timeline: bold the time, then → event.
- Analysis: after each argument, → summary.
- Table: header cells become first-level topics; each data row becomes a child; cell values become grandchildren prefixed with "列名：" to preserve column meaning. Never flatten a table into a single line.
- Keep sibling structure consistent.`

// 长文本分段：尽量在段落边界切，每段不超过 maxChars，避免硬截断在句子中间
const splitLongText = (text, maxChars) => {
  const clean = String(text || '').replace(/\r\n/g, '\n').trim()
  if (!clean) return ['']
  if (clean.length <= maxChars) return [clean]
  const chunks = []
  let cur = ''
  for (let para of clean.split(/\n{2,}/)) {
    if (cur && (cur.length + para.length + 2) > maxChars) {
      chunks.push(cur)
      cur = ''
    }
    // 单个超长段落按字符硬切（避免死循环）
    while (para.length > maxChars) {
      chunks.push(para.slice(0, maxChars))
      para = para.slice(maxChars)
    }
    cur = cur ? cur + '\n\n' + para : para
  }
  if (cur) chunks.push(cur)
  return chunks.length ? chunks : [clean]
}

// 合并多段 Markdown 大纲：第一段为主体，后续段整体降一级（#→##），作为主体的子主题
const mergeMarkdownParts = (parts) => {
  const valid = (parts || []).map(p => String(p || '').trim()).filter(Boolean)
  if (!valid.length) return ''
  if (valid.length === 1) return valid[0]
  const demote = (md) => md.split('\n').map(line => {
    const m = line.match(/^(#{1,6})\s+/)
    if (!m) return line
    const lv = m[1].length
    return '#'.repeat(Math.min(lv + 1, 6)) + line.slice(m[1].length)
  }).join('\n')
  return [valid[0], ...valid.slice(1).map(demote)].join('\n')
}

// 文档右键「AI 转换为思维导图」：原子对象显示，内部直接读取文档 + AI 语义整理 + 生成新 .smm。
// 不修改当前打开的导图、不关闭任何窗口、不生成中间 MD 文件，只刷新目录树。
const convertDocToMindmap = async (filePath, fileName) => {
  if (aiStatus.value === 'thinking' || aiStatus.value === 'calling') {
    ElMessage.warning('AI 正在处理中，请稍候...')
    return
  }
  if (!filePath) return
  const base = String(fileName || filePath.split(/[\\/]/).pop() || '文档').replace(/\.[^.]+$/, '')

  messages.value.push({
    id: genMsgId(),
    role: 'user',
    content: 'AI 转换为思维导图',
    isAiAction: true
  })
  const aiMsg = {
    id: genMsgId(),
    role: 'assistant',
    content: '',
    toolCalls: [{ name: 'convert_doc_to_mindmap', displayName: 'AI 转换为思维导图', status: 'calling' }]
  }
  messages.value.push(aiMsg)
  aiStatus.value = 'thinking'
  emit('tool-call-status', 'thinking')
  aiMsg.content = '正在读取文档内容...'
  scrollToBottom()
  stopRequested.value = false
  aiService.resetAbort()

  try {
    const systemPrompt = '你是思维导图大纲整理专家，只输出规范的 Markdown 大纲（用 # 号表示层级），不要输出任何解释或代码块围栏。'
    const DOC_MIME = {
      pdf: 'application/pdf',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      txt: 'text/plain',
      md: 'text/markdown',
      csv: 'text/csv',
      png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp'
    }
    const ext0 = String(filePath).split('.').pop().toLowerCase()
    const mimeType = DOC_MIME[ext0] || 'application/octet-stream'

    let markdown = ''

    // 1. 优先走 files API 多模态：无论扫描版/图片型 PDF 还是普通文档，都先发给视觉模型直读，
    //    只有 files API 未配置 / 不支持 / 上传或调用失败时才降级到本地文档解析。
    let visionOverride = null
    if (window.electronAPI && window.electronAPI.getVisionConfig) {
      try {
        const vc = await window.electronAPI.getVisionConfig()
        if (vc && vc.available && vc.baseURL && vc.model) {
          visionOverride = { baseURL: vc.baseURL, profileId: vc.profileId || '', model: vc.model, autoComplete: vc.autoComplete !== false, filesURL: vc.filesURL || '' }
        }
      } catch { /* 查询失败按未配置处理 */ }
    }

    if (visionOverride) {
      aiMsg.content = '已启用多模态，正在通过 files API 发送文档...'
      scrollToBottom()
      const prompt = MINDMAP_TEMPLATE_PROMPT + '\n\n（本条消息附带该文档文件，请直接查看文件内容作答，无需调用 read_local_file 等工具重复读取）'
      try {
        const r = await window.electronAPI.fs.readBinary(filePath)
        if (r && r.success && r.base64) {
          const up = await uploadFileForProvider({
            baseURL: visionOverride.baseURL,
            profileId: visionOverride.profileId,
            fileName: fileName || filePath.split(/[\\/]/).pop() || 'file',
            mimeType,
            base64: r.base64,
            customFilesURL: visionOverride.filesURL || ''
          })
          if (up && up.success && up.ref) {
            addLog('tool_call', `工具: files API 上传 [files-api]\n文件: ${fileName || filePath}\nMIME: ${mimeType}`, {}, currentConversation.value?.id)
            emit('log-updated')
            const choice = await aiService.chat([{ type: 'text', text: prompt }, up.ref], systemPrompt, null, { configOverride: visionOverride })
            markdown = String(choice?.message?.content || '').trim()
          } else {
            // files API 上传失败 → 先尝试 base64 直发（多模态 API 直接读，仅图片类文档有效），失败再本地解析兜底
            addLog('tool_call', `工具: files API 上传 [files-api]\n原因: ${up?.error || '上传失败'}，尝试 base64 直发\n上传地址: ${up?.uploadURL || '未知'}`, {}, currentConversation.value?.id)
            emit('log-updated')
            const IMG_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp']
            if (r.base64 && IMG_EXTS.includes(ext0)) {
              try {
                const mime = ext0 === 'jpg' ? 'jpeg' : ext0
                const choice = await aiService.chat([{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: `data:image/${mime};base64,${r.base64}` } }], systemPrompt, null, { configOverride: visionOverride })
                markdown = String(choice?.message?.content || '').trim()
                addLog('tool_call', `工具: 多模态 base64 直发\n结果: ${markdown ? '成功' : '无有效返回，降级本地文档解析'}`, {}, currentConversation.value?.id)
                emit('log-updated')
              } catch (e2) {
                markdown = ''
                addLog('tool_call', `工具: 多模态 base64 直发\n原因: ${e2?.message || '调用异常'}，降级本地文档解析`, {}, currentConversation.value?.id)
                emit('log-updated')
              }
            } else {
              addLog('tool_call', '工具: 多模态 base64 直发\n原因: 非图片类文档，跳过直发，降级本地文档解析', {}, currentConversation.value?.id)
              emit('log-updated')
            }
          }
        } else {
          addLog('tool_call', '工具: files API 上传 [files-api]\n原因: 读取文件二进制失败，降级本地文档解析', {}, currentConversation.value?.id)
          emit('log-updated')
        }
      } catch (e) {
        addLog('tool_call', `工具: files API 多模态 [files-api]\n原因: ${e?.message || '调用异常'}，降级本地文档解析`, {}, currentConversation.value?.id)
        emit('log-updated')
        markdown = ''
      }
    }

    // 2. 降级：files API 未配置 / 上传或调用失败 → 本地文档解析（文本提取）
    if (!markdown) {
      aiMsg.content = '多模态不可用，正在本地解析文档内容...'
      scrollToBottom()
      const res = await parseDocument(filePath)
      if (!res || !res.success || !String(res.text || '').trim()) {
        throw new Error(res?.error || '无法提取该文档的文本内容（可能是扫描版 PDF 或空文件）')
      }
      const fullText = String(res.text).trim()
      // 长文档分段处理：超长文本按段落切块，逐段 AI 整理后合并，避免截断丢信息
      const MAX_CHARS = 20000
      const chunks = splitLongText(fullText, MAX_CHARS)
      aiMsg.content = chunks.length > 1 ? `文档较长，正在分段整理（共 ${chunks.length} 段）...` : '正在用 AI 语义整理文档结构...'
      scrollToBottom()
      // 并发分段整理：用并发控制器（支持限流降级）并行处理各段，提升长文档转换速度
      const limiter = new ConcurrencyLimiter({ maxConcurrency: 4 })
      const parts = await limiter.runAll(
        chunks.map((chunk, i) => ({ chunk, i })),
        async ({ chunk, i }) => {
          const segLabel = chunks.length > 1 ? `（第 ${i + 1}/${chunks.length} 段）` : ''
          const textPrompt = `${MINDMAP_TEMPLATE_PROMPT}\n\n【文档内容${segLabel}】\n${chunk}`
          try {
            const choice = await aiService.chat(textPrompt, systemPrompt)
            const part = String(choice?.message?.content || '').trim()
            return part || buildFallbackMarkdown(chunk, `${base}（第${i + 1}段）`)
          } catch (e) {
            // 该段 AI 整理失败（如 429 限流）→ 该段本地规则兜底，保证内容仍进入导图
            return buildFallbackMarkdown(chunk, `${base}（第${i + 1}段）`)
          }
        }
      )
      markdown = mergeMarkdownParts(parts)
      if (!markdown) {
        markdown = buildFallbackMarkdown(fullText, base)
        addLog('tool_call', '工具: AI转换为思维导图\n原因: AI 语义整理全部失败，已降级本地大纲生成', {}, currentConversation.value?.id)
        emit('log-updated')
      }
    }
    if (!markdown) throw new Error('AI 未返回有效的大纲内容')

    // 3. Markdown → 树
    const tree = parseMarkdownToTree(markdown.replace(/^#\s*/m, ''))
    if (!tree || !tree.data || !tree.children || tree.children.length === 0) {
      throw new Error('AI 生成的大纲无法解析为思维导图')
    }
    const rootPlain = String(tree.data.text || '').replace(/<[^>]+>/g, '').trim()
    if (!rootPlain || rootPlain === '空导图' || rootPlain === '思维导图') {
      const safeRoot = base.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      tree.data.text = `<p><span>${safeRoot}</span></p>`
    }

    // 4. 保存 .smm（不覆盖当前画布，不生成中间 MD）
    aiMsg.content = '正在保存思维导图文件...'
    scrollToBottom()
    let saveDir = ''
    try { saveDir = (await window.electronAPI.getDefaultSaveDir?.()) || '' } catch { /* 忽略 */ }
    const outName = `${base.replace(/[<>:"/\\|?*]/g, '_').slice(0, 50)}.smm`
    let savedPath = null
    if (window.electronAPI?.saveFile) {
      const target = saveDir ? `${saveDir.replace(/[\\/]+$/, '')}\\${outName}` : outName
      const r = await window.electronAPI.saveFile(target, JSON.stringify(tree, null, 2))
      if (r && r.success) savedPath = r.filePath
    }
    if (!savedPath) throw new Error('保存 .smm 文件失败（文件系统不可用）')

    const nodeCount = countNodes(tree)
    aiMsg.toolCalls[0].status = 'done'
    aiMsg.content = `已完成「${base}」到思维导图的转换，共 ${nodeCount} 个节点。\n新文件：${savedPath}\n可在左侧目录树中打开。`
    aiStatus.value = 'done'
    emit('tool-call-status', 'done')
    addLog('tool_result', `工具: AI转换为思维导图\n结果: 成功，共 ${nodeCount} 个节点，保存为 ${savedPath}`, { toolName: 'convert_doc_to_mindmap' }, currentConversation.value?.id)
    emit('log-updated')
    // 只刷新目录树，不打开新文件、不破坏当前分屏布局
    emit('external-file-created', savedPath)
    scrollToBottom()
    return aiMsg.content
  } catch (error) {
    aiMsg.toolCalls[0].status = 'error'
    aiMsg.content = `转换失败：${error.message || '未知错误'}`
    aiStatus.value = 'error'
    emit('tool-call-status', 'error')
    addLog('tool_error', `工具: AI转换为思维导图\n错误: ${error.message || '未知错误'}`, { toolName: 'convert_doc_to_mindmap' }, currentConversation.value?.id)
    emit('log-updated')
    scrollToBottom()
    return aiMsg.content
  } finally {
    setTimeout(() => { aiStatus.value = 'idle' }, 500)
    aiService.resetAbort()
    persistConversation()
  }
}

/* ============================================================
 * 外部调用接口
 * ============================================================ */

/* ============================================================
 * 图片选择与粘贴 → 保存为附件，发送时多模态直发（失败/未启用则后台本地 OCR，结果随消息直接发给大模型，不写入输入框）
 * ============================================================ */

// 后台本地 OCR 识别图片附件（tesseract），返回拼接好的识别文本；单张失败不影响其余
const ocrImageFiles = async (imgs) => {
  const parts = []
  for (const f of imgs.slice(0, 4)) {
    const label = `【图片 ${f.fileName}${f.ext || ''} 本地 OCR 识别内容】`
    try {
      if (!(window.electronAPI && window.electronAPI.ocrImage)) {
        parts.push(`${label}\n当前环境不支持本地 OCR`)
        continue
      }
      const res = await window.electronAPI.ocrImage(f.path)
      if (res && res.success && res.text && res.text.trim()) {
        parts.push(`${label}\n[注意：以下内容通过 OCR 识别，可能存在一定误差]\n${res.text.trim()}`)
      } else {
        parts.push(`${label}\n未识别出文字${res && res.error ? '（' + res.error + '）' : ''}`)
      }
    } catch (e) {
      parts.push(`${label}\nOCR 失败: ${e.message || e}`)
    }
  }
  return parts.join('\n\n')
}

// 将图片 Blob 保存到临时目录，加入附件列表
const attachImageFile = async (file) => {
  if (!window.electronAPI?.fs?.writeBinary || !window.electronAPI?.fs?.getTempDir) {
    ElMessage.warning('当前环境不支持保存图片文件')
    return
  }
  try {
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        const result = reader.result
        if (typeof result === 'string') {
          const idx = result.indexOf(',')
          resolve(idx >= 0 ? result.slice(idx + 1) : result)
        } else {
          reject(new Error('读取图片失败'))
        }
      }
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
    const tmpRes = await window.electronAPI.fs.getTempDir()
    if (!tmpRes.success) throw new Error(tmpRes.error)
    const ext = file.type === 'image/png' ? '.png'
      : file.type === 'image/jpeg' ? '.jpg'
      : file.type === 'image/webp' ? '.webp'
      : file.type === 'image/bmp' ? '.bmp'
      : '.png'
    const fileName = `paste_${Date.now()}${ext}`
    const filePath = tmpRes.path + '\\' + fileName
    const writeRes = await window.electronAPI.fs.writeBinary(filePath, base64)
    if (!writeRes.success) throw new Error(writeRes.error)
    if (attachedFiles.value.some(x => x.path === filePath)) return
    attachedFiles.value.push({
      id: `file_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      path: filePath,
      fileName: fileName.replace(/\.[^.]+$/, ''),
      ext: ext
    })
    ElMessage.success('图片已添加为附件，发送后自动识别（多模态直发，失败自动降级本地 OCR）')
  } catch (e) {
    console.error('添加图片附件失败:', e)
    ElMessage.error('添加图片失败: ' + (e.message || '未知错误'))
  }
}

// 点击加号按钮选择图片
const selectImage = () => {
  if (imageInputRef.value) {
    imageInputRef.value.click()
  }
}

// 图片选择回调：保存为附件
const onImageSelected = async (event) => {
  const file = event.target.files && event.target.files[0]
  if (!file) return
  event.target.value = ''
  await attachImageFile(file)
}

// 粘贴事件：图片 → 保存为附件（不立即 OCR）
const onPaste = async (event) => {
  const items = event.clipboardData?.items
  if (!items) return
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      event.preventDefault()
      const file = item.getAsFile()
      if (file) {
        await attachImageFile(file)
      }
      return
    }
  }
  // 非图片粘贴，正常处理
}

// 接收外部指令文本并直接发送
const sendDirectMessage = (text) => {
  sendMessage(text)
}

// 工具调用的额外处理器（视图切换、AI功能、复习计划等）
const getActiveNodes = () => {
  const list = props.mindMap?.renderer?.activeNodeList || []
  if (list.length > 0) return list.slice()
  return props.activeNode ? [props.activeNode] : []
}

const extraHandlers = {
  // 用 getter 动态读取，避免文件切换后 currentFilePath 停留在旧值
  currentFilePath: () => props.currentFilePath || '',
  currentFileName: () => props.currentFileName || '',
  switchView: (mode) => emit('switch-view', mode),
  // rename_mindmap_file 工具重命名成功后，通知上层同步 currentFilePath（含复习计划路径 remap）
  onFileRenamed: (newPath) => {
    const oldPath = props.currentFilePath || ''
    if (oldPath && newPath && oldPath !== newPath) {
      emit('file-renamed', { oldPath, newPath })
    }
  },
  aiContinue: async (args = {}) => {
    let nodes = getActiveNodes()
    // scope=root：整篇续写（对根节点续写，即从中心主题向下扩展）
    if (args.scope === 'root') {
      const root = props.mindMap?.renderer?.root
      if (root) nodes = [root]
    }
    if (nodes.length === 0) return '没有选中节点'
    // 工具内调用：不得清除主对话循环的停止标记
    return aiContinue(nodes, { viaTool: true })
  },
  aiRewrite: async (instruction) => {
    let nodes = getActiveNodes()
    // 无当前选中时，复用上次改写来源节点（用户「再改一下」无需重新选中节点）
    if (nodes.length === 0 && lastRewriteSourceUids.value.length > 0) {
      const renderer = props.mindMap?.renderer
      const resolved = []
      for (const uid of lastRewriteSourceUids.value) {
        const n = renderer && typeof renderer.findNodeByUid === 'function' ? renderer.findNodeByUid(uid) : null
        if (n) resolved.push(n)
      }
      nodes = resolved
    }
    if (nodes.length === 0) return '没有选中节点'
    return aiRewrite(nodes, { viaTool: true, instruction })
  },
  aiCloze: async () => {
    const nodes = getActiveNodes()
    if (nodes.length === 0) return '没有选中节点'
    return aiCloze(nodes, { viaTool: true })
  },
  aiClozeFullMap: async () => {
    return aiCloze([], { viaTool: true, scope: 'root' })
  },
  addToReview: (uid) => {
    try {
      // addToReviewPlan 期望节点数据对象（uid 字符串会存成空记录）
      const node = props.mindMap?.renderer?.findNodeByUid(uid)
      if (!node) return false
      addToReviewPlan({
        nodeUid: uid,
        nodeText: extractNodeText(node),
        parentText: node.parent ? extractNodeText(node.parent) : '',
        filePath: props.currentFilePath || '',
        fileName: props.currentFileName || ''
      })
      return true
    } catch {
      // reviewPlan 不可用
      return false
    }
  }
}

/* ============================================================
 * MCP 服务端桥接（外部 AI 客户端通过 /mcp 端点调用本程序全部工具）
 * listMcpTools：把 OpenAI 格式工具定义转为 MCP inputSchema 格式
 * callMcpTool：执行单个工具（复用对话内的工具执行链路与危险确认）
 * ============================================================ */
// MCP 访问范围限制：仅允许访问左侧目录树内的文件和文件夹（增删改查均可，但路径必须在范围内）
// 目录树根 = 用户手动添加的文件夹（MINDMAP_FOLDER_ROOTS）+ 自动保存目录根（MINDMAP_AUTO_ROOT / getDefaultSaveDir）
const MCP_SCOPE_TOOLS = {
  read_local_file: ['file_path'],
  retrieve_local_file: ['file_path'],
  read_mindmap_file: ['filePath'],
  delete_local_file: ['filePath'],
  list_directory: ['dir_path'],
  import_file_as_mindmap: ['file_path', 'save_dir'],
  merge_mindmap_files: ['sourceFilePath'],
  send_wechat_file: ['filePath'],
  send_feishu_file: ['filePath'],
  find_local_file: ['dirs'],
  export_to_markdown: ['file_path'],
  export_mindmap_html: ['file_path']
}

const getMcpScopeRoots = async () => {
  const roots = []
  try {
    const stored = localStorage.getItem('MINDMAP_FOLDER_ROOTS')
    const arr = stored ? JSON.parse(stored) : []
    if (Array.isArray(arr)) roots.push(...arr.filter(p => typeof p === 'string' && p))
  } catch { /* localStorage 不可用忽略 */ }
  try {
    const auto = localStorage.getItem('MINDMAP_AUTO_ROOT')
    if (auto) roots.push(auto)
  } catch { /* 忽略 */ }
  if (window.electronAPI?.getDefaultSaveDir) {
    try {
      const saveDir = await window.electronAPI.getDefaultSaveDir()
      if (saveDir) roots.push(saveDir)
    } catch { /* 忽略 */ }
  }
  return [...new Set(roots)]
}

// 路径是否位于任一根目录内（统一分隔符+大小写，兼容 Windows 路径差异）
const isPathInRoots = (p, roots) => {
  if (!p || typeof p !== 'string') return true
  const norm = (s) => s.replace(/[\\/]+/g, '/').replace(/\/+$/, '').toLowerCase()
  const np = norm(p)
  return roots.some(r => {
    const nr = norm(r)
    return np === nr || np.startsWith(nr + '/')
  })
}

// MCP 范围校验：文件类工具的目标路径必须位于目录树根内；
// find_local_file 额外把搜索范围强制限定为目录树根（忽略默认的桌面/文档/下载等大范围搜索）
const validateMcpScope = async (toolName, args) => {
  if (toolName === 'rename_mindmap_file') {
    // 重命名当前打开的文件：要求当前文件本身在目录树范围内
    const roots = await getMcpScopeRoots()
    if (roots.length === 0) return { ok: true }
    if (!isPathInRoots(props.currentFilePath, roots)) {
      return { ok: false, path: props.currentFilePath, roots }
    }
    return { ok: true }
  }
  const fields = MCP_SCOPE_TOOLS[toolName]
  if (!fields) return { ok: true }

  const roots = await getMcpScopeRoots()
  if (roots.length === 0) return { ok: true } // 拿不到根目录信息时降级放行（浏览器模式等）

  for (const f of fields) {
    const v = args?.[f]
    if (Array.isArray(v)) {
      for (const p of v) {
        if (!isPathInRoots(p, roots)) return { ok: false, path: String(p), roots }
      }
    } else if (typeof v === 'string' && v.trim()) {
      if (!isPathInRoots(v, roots)) return { ok: false, path: v, roots }
    }
  }

  if (toolName === 'find_local_file') {
    // MCP 场景强制只搜目录树根：忽略外部传入的其他目录，也不搜桌面/文档/下载等默认范围
    args.dirs = roots
    args.onlyDirs = true
  }
  return { ok: true }
}

const listMcpTools = () => {
  const all = [...getCoreTools(), ...aiTools]
  const seen = new Set()
  const tools = []
  for (const t of all) {
    const fn = t && t.function
    if (!fn || !fn.name || seen.has(fn.name)) continue
    seen.add(fn.name)
    tools.push({
      name: fn.name,
      description: fn.description || '',
      inputSchema: fn.parameters || { type: 'object', properties: {} }
    })
  }
  return tools
}

const callMcpTool = async (toolName, args, mcpCtx = {}) => {
  // MCP 外部工具调用与主对话并行：各自独立执行，不受前台 AI 状态影响
  args = args || {}
  const caller = mcpCtx?.tokenName ? `mcp:${mcpCtx.tokenName}` : 'mcp'
  // 范围校验：MCP 仅允许访问左侧目录树内的文件和文件夹（目录树内增删改查均放行）
  const scope = await validateMcpScope(toolName, args)
  if (!scope.ok) {
    addLog('tool_rejected', `MCP 外部调用被拒绝：${toolName}（路径超出目录树范围：${scope.path}）`, { toolName, source: caller }, currentConversation.value?.id)
    emit('log-updated')
    return {
      success: false,
      message: `访问被拒绝：MCP 接口仅允许访问左侧目录树内的文件和文件夹（允许的根目录：${scope.roots.join('、')}）。请求的路径「${scope.path}」不在允许范围内，请改用目录树内的文件。`
    }
  }
  const toolCall = {
    function: {
      name: toolName,
      arguments: JSON.stringify(args)
    }
  }
  addLog('tool_call', `MCP 外部调用（${mcpCtx?.tokenName || '未署名令牌'}）：${toolNameMap[toolName] || toolName} [${toolName}]\n参数: ${toolCall.function.arguments}`, {
    toolName,
    source: caller
  }, currentConversation.value?.id)
  emit('log-updated')

  // 危险工具保持与对话内一致的二次确认（用户在电脑前点确认/白名单/信任模式放行）
  const allowed = await confirmDangerousTool(toolName, args || {})
  if (!allowed) {
    addLog('tool_rejected', `MCP 外部调用被拒绝：${toolName}（用户在确认弹窗中取消）`, { toolName, source: caller }, currentConversation.value?.id)
    emit('log-updated')
    return { success: false, message: '用户在确认弹窗中取消了本次危险操作，未执行。' }
  }

  const result = await handleToolCall(toolCall, props.mindMap, props.activeNode, extraHandlers)
  // 工具失败（success===false）归类为 tool_error，与对话内工具链路一致，日志面板按"错误"可筛出
  const isToolFail = !!(result && result.success === false)
  addLog(isToolFail ? 'tool_error' : 'tool_result', `MCP 外部调用结果：${toolName}\n${typeof result === 'string' ? result : JSON.stringify(result).slice(0, 500)}`, {
    toolName,
    source: caller,
    result
  }, currentConversation.value?.id)
  emit('log-updated')
  return result
}

// ========== 第三方调用消息中心（飞书 / 微信 / 定时 三端隔离） ==========
// 状态已抽到 utils/thirdPartyStore.js（与 SettingsView 中内嵌面板共享）
const thirdPartyChannels = tpChannels
const thirdPartyTotalUnread = computed(() =>
  Object.values(thirdPartyChannels).reduce((s, c) => s + (c.unread || 0), 0)
)
const activeThirdPartyChannel = ref('wechat')
const getThirdPartyChannel = (source) => tpGetChannel(source)

const selectThirdPartyChannel = (key) => {
  activeThirdPartyChannel.value = key
  if (thirdPartyChannels[key]) thirdPartyChannels[key].unread = 0
}
const clearThirdPartyChannel = (key) => {
  if (thirdPartyChannels[key]) {
    thirdPartyChannels[key].messages = []
    thirdPartyChannels[key].unread = 0
  }
}

// 向指定端推送系统提示（如定时任务触发）
const pushThirdPartyNotice = (source, text) => {
  tpPushNotice(source, text)
}

const formatTpTime = (ts) => {
  try {
    const d = new Date(ts)
    const pad = n => String(n).padStart(2, '0')
    return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  } catch { return '' }
}

/**
 * 处理外部消息（飞书 / 微信 / 定时任务 / 外部 Agent，含工具调用）
 * 各来源使用自己独立的会话上下文（thirdPartyChannels[source]），不写入用户界面对话，避免上下文污染
 * 通道内串行（保持消息顺序），通道间并行（各自独立 aiService 实例，与主对话、其他通道互不影响）
 * 返回 Promise<string>，让调用方获取最终回复
 */
const channelRunChains = new Map()
// 后台任务独立代际令牌：不与主对话的全局 runSeq 混用，避免后台任务递增 runSeq 误杀主对话
let bgRunSeq = 0
const nextBgRunToken = () => ++bgRunSeq

const processExternalMessage = async (text, source = 'task', extLogger = null) => {
  // 通道内排队：链接到该通道上一个任务（若存在），保持同一通道消息顺序
  const prev = channelRunChains.get(source) || Promise.resolve()
  const run = prev.then(() => runExternalMessage(text, source, extLogger))
  // 存一个吞错的链尾，避免某个任务 reject 后整条队列断裂
  channelRunChains.set(source, run.then(() => {}, () => {}))
  return run
}

const runExternalMessage = async (text, source, extLogger) => {
  // 写入该端自己的会话（共享store，SettingsView中内嵌面板也会显示）
  const channel = getThirdPartyChannel(source)
  pushThirdPartyMessage(source, { role: 'user', content: text, time: Date.now() })

  addLog('send', text, { model: currentModelName.value, source }, currentConversation.value?.id)
  emit('log-updated')

  // 独立 aiService 实例：与主对话、其他通道的后台任务完全隔离，实现通道间真正并行
  const svc = createAIService()
  try {
    await svc.ensureInitialized()
  } catch (e) {
    return `错误: ${e.message || 'AI 服务初始化失败'}`
  }

  // 标记后台运行状态（Set 记录运行中的通道）
  backgroundRunning.value.add(source)
  const bgRunToken = nextBgRunToken()

  const memoryContent = loadMemory()
  const fileInfo = props.currentFilePath
    ? `当前打开的文件：${props.currentFileName}（路径：${props.currentFilePath}）`
    : '当前没有打开任何文件。'

  // 系统提示词（精简英文铁律，同 sendMessage，保证前缀缓存一致）
  let systemPrompt = await buildSystemPromptWithSkills(SYSTEM_PROMPT)

  // 动态上下文（同 sendMessage，前缀缓存一致）
  let dynamicContext = `\n\n## Current time\nToday is ${(() => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') })()}. Use this date for time references.\n\n## Current file\n${fileInfo}`

  // 导图按需注入：骨架+节点数
  if (props.mindMap && props.currentFilePath) {
    const data = props.mindMap.getData()
    const nodeCount = countNodes(data)
    const skeleton = treeToSkeletonText(data, 2)
    dynamicContext += `\n\n## Current mind map (file: ${props.currentFileName})\n- Total nodes: ${nodeCount}\n- Skeleton (top 2 levels):\n${skeleton || '(empty)'}\n- To read full map content, call get_mindmap_content(mode="full").`
  }

  if (memoryContent && memoryContent.trim()) {
    dynamicContext += `\n\n## Permanent memory (strictly follow)\n${memoryContent}`
  }

  const extMemory = formatMemoryText()
  if (extMemory && extMemory.trim()) {
    dynamicContext += `\n\n## User long-term memory\n${extMemory}`
  }

  // 该端的 AI 回复条目（第三方面板展示，内容流式填充）
  const aiEntry = { role: 'assistant', content: '', toolCalls: [], time: Date.now() }
  channel.messages.push(aiEntry)

  let fullResponse = ''

  // 上下文只取该端自己的会话（与用户界面对话、其他端完全隔离）
  // 历史 user 消息剥离动态注入块，防止重复累积
  const historyList = channel.messages
    .filter(m => (m.role === 'user' || m.role === 'assistant') && m.content)
    .map(m => ({ role: m.role, content: m.role === 'user' ? stripDynamicContext(m.content) : m.content }))
  // 最后一问附加动态上下文（日期/文件/导图内容/记忆），system 保持纯固定内容以命中前缀缓存
  for (let i = historyList.length - 1; i >= 0; i--) {
    if (historyList[i].role === 'user') {
      historyList[i].content = text + dynamicContext
      break
    }
  }
  const messagesToSend = [
    { role: 'system', content: systemPrompt },
    ...historyList
  ]

  // 外部消息运行同样纳入代际管理：会话切换/新建/用户打断时其回调一并过期
  const runToken = bgRunToken
  resetWebSearchTask(`background_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`)

  return new Promise((resolve) => {
    // chatWithCallbacks 启动阶段（配置初始化/网络）抛错时 Promise 永不 resolve：
    // 外层 App.vue 会一直 await，第三方侧无回复。必须在此兜底
    svc.chatWithCallbacks(
      { messages: messagesToSend, tools: getCoreTools(), allTools: aiTools, runToken },
      {
        onChunk: (chunk) => {
          fullResponse += chunk
          aiEntry.content = fullResponse
        },
        // 自动工具发现兜底：清空已流式输出的首答，模型带新激活的工具重答
        onBeforeRetry: (hits) => {
          fullResponse = ''
          aiEntry.content = ''
        },
        onToolCall: async (toolCall) => {
          // 定时任务默认最高权限（危险操作直接放行）；其他外部通道需信任模式/白名单放行
          const isTrustedExternal = source === 'task' || trustMode.value || loadWhitelist().has(toolCall.function.name)
          if (DANGEROUS_TOOLS[toolCall.function.name] && !isTrustedExternal) {
            aiEntry.toolCalls.push({
              name: toolCall.function.name,
              displayName: toolNameMap[toolCall.function.name] || toolCall.function.name,
              status: 'stopped'
            })
            return { success: false, message: '外部消息不允许执行危险操作（删除/覆盖/上传外发）。请用户在应用内发起该操作并确认。' }
          }
          // 后台任务进行中：不修改 aiStatus，仅保持 backgroundRunning 标记
          const tcEntry = {
            name: toolCall.function.name,
            displayName: toolNameMap[toolCall.function.name] || toolCall.function.name,
            status: 'calling',
            summary: (() => {
              try { return summarizeToolArgs(toolCall.function.name, JSON.parse(toolCall.function.arguments || '{}')) } catch { return '' }
            })()
          }
          aiEntry.toolCalls.push(tcEntry)
          if (extLogger) {
            extLogger('tool_call', `${toolCall.function.name}: ${toolCall.function.arguments || ''}`)
          }
          try {
            const result = await handleToolCall(toolCall, props.mindMap, props.activeNode, extraHandlers)
            tcEntry.status = 'done'
            // 关键返回值留档：压缩成摘要时保留
            tcEntry.resultBrief = briefFromResult(result)
            if (result && result.filePath && !result.notNewFile) {
              if (result.externalFile) {
                emit('external-file-created')
              } else {
                emit('file-created', result.filePath, result.fileName)
              }
            }
            if (extLogger) {
              extLogger('tool_result', `${toolCall.function.name}: ${result?.message || JSON.stringify(result)}`)
            }
            return result
          } catch (e) {
            tcEntry.status = 'error'
            tcEntry.errorBrief = firstN(e.message, 200)
            if (extLogger) {
              extLogger('tool_error', `${toolCall.function.name}: ${e.message}`)
            }
            return { success: false, message: `工具调用失败: ${e.message}` }
          }
        },
        onDone: () => {
          // 后台任务完成：清除该通道的后台状态，不修改 aiStatus（它应该保持 idle）
          backgroundRunning.value.delete(source)
          svc.resetAbort()
          if (extLogger) {
            extLogger('send', fullResponse || '(AI 未返回内容)')
          }
          resolve(fullResponse || '(AI 未返回内容)')
        },
        onError: (error) => {
          // 用户主动中止不渲染成错误（后台任务被中止时 AbortError 走这里）
          if (error && (error.name === 'AbortError' || error.aborted === true)) {
            backgroundRunning.value.delete(source)
            svc.resetAbort()
            resolve('（已被用户操作中断）')
            return
          }
          console.error('AI 服务错误:', error)
          aiEntry.content = fullResponse || `错误: ${error.message || 'AI 服务异常'}`
          backgroundRunning.value.delete(source)
          svc.resetAbort()
          resolve(aiEntry.content)
        }
      }
    ).catch((err) => {
      // 启动失败（如 AI 配置未初始化）：复位状态并回复错误，避免调用方永久挂起
      console.error('外部消息 AI 初始化失败:', err)
      aiEntry.content = `错误: ${err.message || 'AI 服务初始化失败'}`
      backgroundRunning.value.delete(source)
      svc.resetAbort()
      resolve(aiEntry.content)
    })
  })
}

// ========== 输入框引用胶囊（右键"将节点添加到 AI 对话"） ==========
// 输入框只显示简洁的蓝色高亮胶囊，发送时才展开为完整上下文（文件名+上级+同级/子树）
const attachedRefs = ref([])
const attachedSkills = ref([])
const skillPickerVisible = ref(false)
const skillQuery = ref('')
const allSkills = ref([])
const filteredSkills = computed(() => {
  const q = skillQuery.value.trim().toLowerCase()
  const enabled = allSkills.value.filter(s => s.enabled)
  return q ? enabled.filter(s => s.name.toLowerCase().includes(q) || (s.description || '').toLowerCase().includes(q)) : enabled
})

const loadSkillPicker = async () => {
  try { allSkills.value = await window.electronAPI?.skills?.list?.() || [] } catch { allSkills.value = [] }
}

const detectSkillMention = () => {
  const value = inputText.value || ''
  const atIdx = value.lastIndexOf('@')
  if (atIdx >= 0 && !value.slice(atIdx + 1).includes(' ')) {
    skillQuery.value = value.slice(atIdx + 1)
    skillPickerVisible.value = true
    loadSkillPicker()
  } else {
    skillPickerVisible.value = false
  }
}

// MCP 选择器
const mcpPickerVisible = ref(false)
const mcpQuery = ref('')
const allMcps = ref([])
const attachedMcps = ref([])
const filteredMcps = computed(() => {
  const q = mcpQuery.value.trim().toLowerCase()
  return q ? allMcps.value.filter(m => m.name.toLowerCase().includes(q) || (m.description || '').toLowerCase().includes(q)) : allMcps.value
})

const loadMcpPicker = async () => {
  try {
    const servers = await window.electronAPI?.mcp?.list?.() || []
    allMcps.value = servers.filter(s => s.enabled !== false).map(s => ({
      id: s.id || s.name,
      name: s.name || s.id,
      description: s.description || ''
    }))
  } catch { allMcps.value = [] }
}

const detectMcpMention = () => {
  const value = inputText.value || ''
  const hashIdx = value.lastIndexOf('#')
  if (hashIdx >= 0 && !value.slice(hashIdx + 1).includes(' ')) {
    mcpQuery.value = value.slice(hashIdx + 1)
    mcpPickerVisible.value = true
    loadMcpPicker()
  } else {
    mcpPickerVisible.value = false
  }
}

const onInputDetect = () => {
  detectSkillMention()
  detectMcpMention()
  detectToolMention()
}

const selectMcp = (mcp) => {
  if (!attachedMcps.value.some(m => m.id === mcp.id)) {
    attachedMcps.value.push({ id: mcp.id, name: mcp.name, description: mcp.description })
  }
  const value = inputText.value || ''
  const hashIdx = value.lastIndexOf('#')
  if (hashIdx >= 0) inputText.value = value.slice(0, hashIdx).trimEnd()
  mcpPickerVisible.value = false
  mcpQuery.value = ''
}

const removeAttachedMcp = (index) => {
  attachedMcps.value.splice(index, 1)
}

// / 工具选择器（内置工具 + 自定义工具）
const toolPickerVisible = ref(false)
const toolQuery = ref('')
const allToolOptions = ref([])
const attachedTools = ref([])
const filteredToolOptions = computed(() => {
  const q = toolQuery.value.trim().toLowerCase()
  return q
    ? allToolOptions.value.filter(t => t.name.toLowerCase().includes(q) || (t.description || '').toLowerCase().includes(q))
    : allToolOptions.value
})

const loadToolPicker = async () => {
  const builtins = (aiTools || []).map(t => ({
    id: t.function?.name || '',
    name: toolNameMap[t.function?.name] || t.function?.name || '',
    description: t.function?.description || '',
    category: 'builtin'
  })).filter(t => t.id && t.name)
  let customs = []
  try {
    const list = await window.electronAPI?.customTools?.list?.() || []
    customs = list.filter(t => t && t.id).map(t => ({
      id: t.id,
      name: t.name || t.id,
      description: t.description || '',
      category: 'custom'
    }))
  } catch (e) {
    customs = []
  }
  allToolOptions.value = [...builtins, ...customs]
}

const detectToolMention = () => {
  const value = inputText.value || ''
  const slashIdx = value.lastIndexOf('/')
  if (slashIdx >= 0 && !value.slice(slashIdx + 1).includes(' ')) {
    toolQuery.value = value.slice(slashIdx + 1)
    toolPickerVisible.value = true
    loadToolPicker()
  } else {
    toolPickerVisible.value = false
  }
}

const selectTool = (tool) => {
  if (!attachedTools.value.some(t => t.id === tool.id)) {
    attachedTools.value.push({ id: tool.id, name: tool.name, description: tool.description, category: tool.category })
  }
  const value = inputText.value || ''
  const slashIdx = value.lastIndexOf('/')
  if (slashIdx >= 0) inputText.value = value.slice(0, slashIdx).trimEnd()
  toolPickerVisible.value = false
  toolQuery.value = ''
}

const removeAttachedTool = (index) => {
  attachedTools.value.splice(index, 1)
}

const selectSkill = (skill) => {
  if (!attachedSkills.value.some(s => s.id === skill.id)) {
    attachedSkills.value.push({ id: skill.id, name: skill.name, description: skill.description, instructions: skill.instructions })
  }
  const value = inputText.value || ''
  const atIdx = value.lastIndexOf('@')
  if (atIdx >= 0) inputText.value = value.slice(0, atIdx).trimEnd()
  skillPickerVisible.value = false
  skillQuery.value = ''
}

const removeAttachedSkill = (index) => {
  attachedSkills.value.splice(index, 1)
}

// ========== 输入框文件胶囊（本地文件拖入输入区，发送时展开为【拖入文件｜路径：…】上下文） ==========
const attachedFiles = ref([])
// AI 发送队列：AI 正在回复时用户继续发消息，自动排队，回复完成后逐条发送
const messageQueue = ref([])
// 插队标志：用户点「立即发送」中断当前回复时置位，避免 onDone 重复处理队列
let jumpQueued = false
// 拖拽悬停高亮：dragenter/dragleave 在子元素间会成对冒泡，用计数器归零判断真正离开
const fileDragActive = ref(false)
let fileDragDepth = 0

const removeAttachedFile = (index) => {
  attachedFiles.value.splice(index, 1)
}

const dragHasFiles = (e) => {
  const types = Array.from(e.dataTransfer?.types || [])
  // Files: 系统文件拖入; text/plain: 文件树拖入; getDragFilePath: 模块变量后备
  return types.includes('Files') || types.includes('text/plain') || !!getDragFilePath()
}

const onFileDragEnter = (e) => {
  if (!dragHasFiles(e)) return
  fileDragDepth++
  fileDragActive.value = true
}

const onFileDragOver = (e) => {
  if (!dragHasFiles(e)) return
  e.preventDefault() // 必须阻止默认行为，drop 事件才能触发
  fileDragActive.value = true
}

const onFileDragLeave = () => {
  fileDragDepth = Math.max(0, fileDragDepth - 1)
  if (fileDragDepth === 0) fileDragActive.value = false
}

const onFileDrop = (e) => {
  e.preventDefault()
  fileDragDepth = 0
  fileDragActive.value = false

  // 先检查是否从左侧文件树拖入（自定义 MIME 类型 + 模块变量后备）
  const treePath = e.dataTransfer?.getData('application/x-mindmap-file')
    || e.dataTransfer?.getData('text/plain')
    || getDragFilePath()
  clearDragFilePath()
  if (treePath) {
    const name = treePath.split(/[\\/]/).pop() || '未命名'
    if (attachedFiles.value.some(x => x.path === treePath)) {
      ElMessage.info('该文件已添加')
      return
    }
    attachedFiles.value.push({
      id: `file_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      path: treePath,
      fileName: name.replace(/\.[^.]+$/, ''),
      ext: (name.match(/\.[^.]+$/) || [''])[0].toLowerCase()
    })
    ElMessage.success(`已添加文件：${name}`)
    return
  }

  // Electron 渲染进程的 File 对象带 path 属性（完整绝对路径），换电脑也是真实路径
  const dropped = Array.from(e.dataTransfer?.files || [])
  const valid = dropped.map(f => {
    const path = f.path || (window.electronAPI?.getPathForFile ? window.electronAPI.getPathForFile(f) : '')
    return path ? { file: f, path } : null
  }).filter(Boolean)
  if (!valid.length) {
    ElMessage.warning('未识别到文件路径，请拖入本地文件')
    return
  }
  let added = 0
  for (const item of valid) {
    const f = item.file
    const path = item.path
    const name = f.name || String(path).split(/[\\/]/).pop()
    if (attachedFiles.value.some(x => x.path === path)) continue // 同一文件不重复添加
    attachedFiles.value.push({
      id: `file_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      path,
      fileName: name.replace(/\.[^.]+$/, ''),
      ext: (name.match(/\.[^.]+$/) || [''])[0].toLowerCase()
    })
    added++
  }
  if (added) ElMessage.success(`已添加 ${added} 个文件，输入指令后发送（直接回车则让 AI 自动处理）`)
}

const removeAttachedRef = (index) => {
  attachedRefs.value.splice(index, 1)
}

// 输入框为空时按 Backspace/Delete 整体删除最后一个胶囊（先删文件胶囊，再删引用胶囊）
const onInputKeydownDelete = (e) => {
  if (inputText.value === '') {
    if (attachedFiles.value.length > 0) {
      e.preventDefault()
      attachedFiles.value.pop()
    } else if (attachedRefs.value.length > 0) {
      e.preventDefault()
      attachedRefs.value.pop()
    }
  }
}

// 递归构建子树文本（缩进列表）
const buildSubtreeText = (node, depth) => {
  const children = node.children || []
  if (!children.length) return ''
  let out = ''
  for (const c of children) {
    const t = extractNodeText(c)
    if (!t) continue
    out += `${'  '.repeat(depth)}- ${t}\n`
    out += buildSubtreeText(c, depth + 1)
  }
  return out
}

// 构建引用节点的完整上下文：
// 终末级节点 → 上级节点 + 全部同级节点（► 标注被引用的）
// 非终末级节点 → 上级节点 + 被引用节点 + 全部子树
// 所有情况都包含文件名
const buildReferenceContext = (node, selectedNodes = [node]) => {
  const fileName = props.currentFileName || '未命名文件'
  const uid = node.uid || node?.data?.uid || ''
  const text = extractNodeText(node)
  const selectedSet = new Set(selectedNodes.map(n => n.uid || n?.data?.uid))

  let ctx = `\n【引用节点｜文件：${fileName}】\n`
  const parent = getParentNode(node)
  const parentText = parent ? extractNodeText(parent) : ''
  if (parentText) ctx += `上级节点：${parentText}\n`

  const children = node.children || []
  if (children.length > 0) {
    ctx += `被引用节点（uid=${uid}）：${text}\n该节点的全部子节点：\n${buildSubtreeText(node, 1)}`
  } else {
    const siblings = parent && parent.children ? parent.children : [node]
    const lines = siblings
      .map(c => {
        const t = extractNodeText(c)
        if (!t) return ''
        const mark = selectedSet.has(c.uid || c?.data?.uid) ? '► ' : '  '
        return `${mark}${t}`
      })
      .filter(Boolean)
    ctx += `被引用节点（uid=${uid}）及其全部同级节点（► 为被引用节点）：\n${lines.join('\n')}\n`
  }
  return ctx
}

// 将节点添加为输入框引用胶囊（不自动发送），供右键菜单"将节点添加到 AI 对话"使用
const addToInput = (nodesOrNode) => {
  const nodes = Array.isArray(nodesOrNode) ? nodesOrNode : [nodesOrNode]
  const valid = nodes.filter(Boolean)
  if (valid.length === 0) {
    ElMessage.warning('请先选中节点')
    return
  }

  highlightNodes(valid)

  let added = 0
  for (const node of valid) {
    const text = extractNodeText(node)
    if (!text) continue
    const hasChildren = (node.children || []).length > 0
    attachedRefs.value.push({
      id: genMsgId(),
      uid: node.uid || node?.data?.uid || '',
      fileName: props.currentFileName || '未命名',
      label: text.length > 24 ? text.slice(0, 24) + '…' : text,
      kindLabel: hasChildren ? '含子树' : '含同级',
      title: `${props.currentFileName || '未命名'} › ${text}`,
      context: buildReferenceContext(node, valid)
    })
    added++
  }
  if (added === 0) {
    ElMessage.warning('选中节点没有文本内容')
    return
  }
  nextTick(() => {
    if (textareaRef.value) {
      textareaRef.value.focus()
      const len = textareaRef.value.value.length
      textareaRef.value.setSelectionRange(len, len)
    }
  })
}

// 将文档选中的文字添加为输入框引用胶囊（不自动发送），供文档右键「添加到 AI 助手对话框」使用
const addTextToInput = (text, source) => {
  const clean = String(text || '').trim()
  if (!clean) {
    ElMessage.warning('没有选中文字')
    return
  }
  const fileName = String(source || '文档')
  attachedRefs.value.push({
    id: genMsgId(),
    uid: '',
    fileName,
    label: clean.length > 24 ? clean.slice(0, 24) + '…' : clean,
    kindLabel: '参考资料',
    title: `${fileName} › ${clean}`,
    context: `\n【引用参考资料｜文件：${fileName}】\n${clean}\n（以上是用户从文档中选中的文字，作为引用参考资料，请据此作答，不要忽略。）`
  })
  nextTick(() => {
    if (textareaRef.value) {
      textareaRef.value.focus()
      const len = textareaRef.value.value.length
      textareaRef.value.setSelectionRange(len, len)
    }
  })
}

// 全局拦截文件拖放的默认导航（Chromium 默认会把拖入文件直接在窗口打开，导致应用被替换）；
// 输入区自己的 drop handler 先行处理，冒泡到这里再次 preventDefault 无害
const onGlobalDragOver = (e) => e.preventDefault()
const onGlobalDrop = (e) => e.preventDefault()

// MCP/自定义工具状态监视：主进程推送进程异常时，顶部 banner 给用户即时提示。
// 状态项会带 1.5 分钟自动消失（避免陈旧通知），用户也可手动关闭。
const mcpStatusList = ref([])
const dismissMcpIssue = (id) => {
  mcpStatusList.value = mcpStatusList.value.filter(m => m.id !== id)
}
const mcpIssueTimeoutMs = 90 * 1000
let __mcpStatusUnsub = null

// 网络断开状态（review #14/#22）：主进程每 30s 心跳；离线时顶部横幅 + 联网工具短路
const networkOnline = ref(true)
const networkLatencyMs = ref(0)
const networkFailStreak = ref(0)
// 横幅显示控制：仅短暂提示，不常驻挤压内容
const showNetworkBanner = ref(false)
let __networkBannerTimer = null
const dismissNetworkBanner = () => {
  showNetworkBanner.value = false
  if (__networkBannerTimer) { try { clearTimeout(__networkBannerTimer) } catch (e) {} __networkBannerTimer = null }
}
const showNetworkBannerBriefly = () => {
  showNetworkBanner.value = true
  if (__networkBannerTimer) { try { clearTimeout(__networkBannerTimer) } catch (e) {} }
  __networkBannerTimer = setTimeout(() => {
    showNetworkBanner.value = false
    __networkBannerTimer = null
  }, 5000)
}
const forceRecheckNetwork = async () => {
  try {
    if (window.electronAPI && window.electronAPI.network && typeof window.electronAPI.network.checkNow === 'function') {
      await window.electronAPI.network.checkNow()
    }
  } catch (e) {}
}
let __networkStatusUnsub = null
// 进度感（review #13.1）：AI thinking 时显示已用秒数，>25s 显提示，>60s 显可停止
const thinkingSeconds = ref(0)
let __thinkingTimer = null
const startThinkingTimer = () => {
  stopThinkingTimer()
  thinkingSeconds.value = 0
  __thinkingTimer = setInterval(() => {
    thinkingSeconds.value++
  }, 1000)
}
const stopThinkingTimer = () => {
  if (__thinkingTimer) { try { clearInterval(__thinkingTimer) } catch (e) {} __thinkingTimer = null }
  thinkingSeconds.value = 0
}
const watchedAiStatus = computed(() => aiStatus.value)
watch(watchedAiStatus, (s) => {
  if (s === 'thinking' || s === 'calling') startThinkingTimer()
  else stopThinkingTimer()
}, { immediate: true })

// AI 输出折叠（review #13.4）：超长 AI 回复（>COLLAPSE_LINES 行）默认折叠，显示前 COLLAPSE_PREVIEW_LINES
// 阈值由「行数 + 字符数」共同决定：行数 ≥ 12 或字符 ≥ 3000 时折叠，避免短消息被折、长消息反而显示
const COLLAPSE_LINES = 12
const COLLAPSE_PREVIEW_LINES = 8
const COLLAPSE_CHARS = 3000
const COLLAPSE_PREVIEW_CHARS = 1600
const isAiMessageLong = (msg) => {
  if (!msg || msg.role !== 'assistant' || !msg.content) return false
  // 去除 <think> 块后计算显示行数
  const text = stripThinkBlocks ? stripThinkBlocks(msg.content) : msg.content
  if (!text) return false
  // 短消息（< 8 行 且 < 1500 字）一律不折叠，避免短问答被强行截断
  const lineCount = text.split('\n').length
  const charCount = text.length
  if (lineCount <= 8 && charCount < 1500) return false
  return lineCount > COLLAPSE_LINES || charCount > COLLAPSE_CHARS
}
const previewAiContent = (msg) => {
  const text = stripThinkBlocks ? stripThinkBlocks(msg.content) : msg.content
  const lines = (text || '').split('\n')
  // 优先按字符截断（接近上限时按字符截），避免只截到一半就被截断。
  // 文本量较小时按行截；超过字符阈值时按字符截
  if ((text || '').length > COLLAPSE_PREVIEW_CHARS && lines.length > COLLAPSE_PREVIEW_LINES) {
    return (text || '').slice(0, COLLAPSE_PREVIEW_CHARS) + '…'
  }
  return lines.slice(0, COLLAPSE_PREVIEW_LINES).join('\n')
}
const toggleAiExpanded = (msg) => { msg.expanded = !msg.expanded }
// 重生成（review #13.3）：找到上一条 user 消息，重发
const __regeneratingSet = ref(new Set())
const isRegenerating = (msgId) => __regeneratingSet.value.has(msgId)
const regenerateAiMessage = async (msg) => {
  if (!msg) return
  // 找到本 AI 消息之前的最后一条 user 消息
  const idx = messages.value.findIndex(m => m.id === msg.id)
  if (idx < 1) { ElMessage.warning('找不到可重新生成的用户消息'); return }
  const prev = messages.value[idx - 1]
  if (!prev || prev.role !== 'user') { ElMessage.warning('上一条不是用户消息，无法重新生成'); return }
  // 删除本 AI 消息（保留 user）
  messages.value = messages.value.filter(m => m.id !== msg.id)
  persistConversation()
  // 复制 user 内容到输入框，等价手动复制
  inputText.value = prev.content || ''
  attachedRefs.value = Array.isArray(prev.refs) ? [...(prev.refs || [])] : []
  attachedFiles.value = Array.isArray(prev.files) ? [...(prev.files || [])] : []
  attachedSkills.value = Array.isArray(prev.skills) ? [...(prev.skills || [])] : []
  attachedMcps.value = Array.isArray(prev.mcps) ? [...(prev.mcps || [])] : []
  attachedTools.value = Array.isArray(prev.tools) ? [...(prev.tools || [])] : []
  // 自动发送（nextTick 让上方的设置生效）
  nextTick(() => sendMessage(inputText.value))
}



onMounted(() => {
    // 订阅网络状态（review #14/#22）
    try {
      if (window.electronAPI && window.electronAPI.network && typeof window.electronAPI.network.onStatusChange === 'function') {
        __networkStatusUnsub = window.electronAPI.network.onStatusChange((payload) => {
          try {
            if (!payload || typeof payload.online !== 'boolean') return
            const wasOffline = !networkOnline.value
            networkOnline.value = payload.online
            networkLatencyMs.value = Number(payload.latencyMs) || 0
            networkFailStreak.value = Number(payload.failStreak) || 0
            if (!payload.online && !wasOffline) {
              showNetworkBannerBriefly()
              ElMessage.warning('网络似乎不可用，部分功能（联网搜索/网页读取/AI 请求）将不可用')
            } else if (payload.online && wasOffline) {
              dismissNetworkBanner()
              ElMessage.success('网络已恢复')
            }
          } catch (e) {}
        })
        Promise.resolve(window.electronAPI.network.getState()).then((initState) => {
          if (initState && typeof initState.online === 'boolean') {
            networkOnline.value = initState.online
            networkLatencyMs.value = Number(initState.latencyMs) || 0
            networkFailStreak.value = Number(initState.failStreak) || 0
            // 启动时已离线则短暂提示一次
            if (!initState.online) showNetworkBannerBriefly()
          }
        }).catch(() => {})
      }
    } catch (e) { /* ignore */ }
    // 渲染层兜底：window online/offline 事件（比主进程心跳快）
    try {
      if (typeof navigator !== 'undefined') {
        networkOnline.value = navigator.onLine !== false
        window.addEventListener('online', () => {
          networkOnline.value = true
          dismissNetworkBanner()
          ElMessage.success('网络已恢复')
        }, { passive: true })
        window.addEventListener('offline', () => {
          networkOnline.value = false
          showNetworkBannerBriefly()
          ElMessage.warning('网络似乎不可用')
        }, { passive: true })
      }
    } catch (e) { /* ignore */ }
    // 订阅主进程 MCP 状态事件
    try {
      if (window.electronAPI && window.electronAPI.mcp && typeof window.electronAPI.mcp.onStatusChange === 'function') {
        __mcpStatusUnsub = window.electronAPI.mcp.onStatusChange((payload) => {
          try {
            if (!payload || !payload.id) return
            const id = String(payload.at || Date.now()) + ':' + payload.id
            const item = {
              id,
              kind: 'mcp',
              serverId: payload.id,
              serverName: payload.name || payload.id,
              status: payload.status,
              reason: payload.reason,
              code: payload.code,
              createdAt: Date.now()
            }
            // 去重：同一 serverId 在 timeout 之前只显示一条最新
            mcpStatusList.value = [
              item,
              ...mcpStatusList.value.filter(m => m.serverId !== item.serverId)
            ].slice(0, 6)
            // 自动清理
            setTimeout(() => dismissMcpIssue(id), mcpIssueTimeoutMs)
            ElMessage.warning('MCP 服务「' + item.serverName + '」' + (item.status === 'exit' ? '已停止' : '异常') + '：' + (item.reason || ('code=' + (item.code ?? ''))))
          } catch (e) {}
        })
      }
    } catch (e) { /* 主进程未就绪时静默忽略 */ }

  initConversation()
  // 注入 AI 请求/返回日志钩子：子 Agent、工序内部 AI 调用都会记录到运行日志
  aiService.setLogCallback((type, text) => {
    addLog(type, text, {}, currentConversation.value?.id)
    emit('log-updated')
  })
  memoryText.value = loadMemory()
  conversations.value = loadConversations()
  // 恢复文件-对话绑定：从持久化的 conversation.fileId 重建映射，保证切换文件/重启后能找回对应对话
  for (const conv of conversations.value) {
    if (conv.fileId) {
      // 列表按 updatedAt 倒序，第一个（最新）绑定生效，避免旧对话覆盖新对话
      if (!fileConversationMap.value.has(conv.fileId)) {
        fileConversationMap.value.set(conv.fileId, conv.id)
      }
    }
    if (!conversationFileMap.value.has(conv.id)) {
      conversationFileMap.value.set(conv.id, conv.fileId || '')
    }
  }
  loadCurrentModel()
  loadSkillPicker()
  loadToolPicker()
  window.addEventListener('click', onGlobalClick)
  window.addEventListener('dragover', onGlobalDragOver)
  window.addEventListener('drop', onGlobalDrop)
  window.addEventListener('beforeunload', handleBeforeUnload)
})

  if (__mcpStatusUnsub) { try { __mcpStatusUnsub() } catch (e) {} __mcpStatusUnsub = null }
  if (__networkStatusUnsub) { try { __networkStatusUnsub() } catch (e) {} __networkStatusUnsub = null }
onBeforeUnmount(() => {
  window.removeEventListener('click', onGlobalClick)
  window.removeEventListener('dragover', onGlobalDragOver)
  window.removeEventListener('drop', onGlobalDrop)
  window.removeEventListener('beforeunload', handleBeforeUnload)
  // 组件卸载时强制保存一次，防止数据丢失
  handleBeforeUnload()
})

defineExpose({
  messages,
  aiStatus,
  aiContinue,
  aiAddChild,
  aiRewrite,
  aiCloze,
  aiQuiz,
  aiRewriteFullMap,
  reorganizeMindmap,
  convertDocToMindmap,
  sendDirectMessage,
  processExternalMessage,
  pushThirdPartyNotice,
  addToInput,
  addTextToInput,
  setLogPanelVisible: (visible) => { logPanelVisible.value = visible },
  reloadModel: loadCurrentModel,
  listMcpTools,
  callMcpTool
  // openThirdPartyPanel 已迁移到 SettingsView 内嵌的 ThirdPartyPanel 组件，不再需要
})
</script>

<style scoped>

.thinking-progress-banner {
  padding: 6px 12px;
  background: rgba(64, 158, 255, 0.08);
  border-bottom: 1px solid rgba(64, 158, 255, 0.2);
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: #409eff;
}
.thinking-progress-banner .thinking-progress-icon { font-size: 14px; }
.thinking-progress-banner .thinking-progress-text { flex: 1; }

.md-collapsed {
  max-height: 200px;
  overflow: hidden;
  position: relative;
  -webkit-mask-image: linear-gradient(to bottom, black 50%, transparent 100%);
  mask-image: linear-gradient(to bottom, black 50%, transparent 100%);
}
.md-collapse-toggle {
  display: inline-block;
  margin-top: 6px;
  font-size: 12px;
  color: #409eff;
  background: transparent;
  border: 1px solid rgba(64, 158, 255, 0.3);
  border-radius: 4px;
  padding: 2px 10px;
  cursor: pointer;
}
.md-collapse-toggle:hover { background: rgba(64, 158, 255, 0.08); }

.msg-regen-btn {
  position: absolute;
  right: 38px;
  top: 8px;
  background: transparent;
  border: 1px solid rgba(0,0,0,0.06);
  border-radius: 4px;
  padding: 4px 6px;
  cursor: pointer;
  color: #909399;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.msg-regen-btn:hover { color: #409eff; background: rgba(64,158,255,0.08); }
.msg-regen-btn:active { transform: rotate(180deg); transition: transform 0.3s; }

.chat-panel-root {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
}

.network-offline-banner {
  position: absolute;
  top: 8px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 2000;
  padding: 8px 14px;
  background: rgba(255, 204, 102, 0.95);
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
  color: #8a6d2a;
  white-space: nowrap;
  animation: bannerSlideDown 0.3s ease;
}
@keyframes bannerSlideDown {
  from { opacity: 0; transform: translateX(-50%) translateY(-8px); }
  to { opacity: 1; transform: translateX(-50%) translateY(0); }
}
.network-offline-banner .network-offline-icon { font-size: 14px; }
.network-offline-banner .network-offline-text { flex: 1; }
.network-offline-banner .network-offline-recheck {
  background: rgba(255, 255, 255, 0.5);
  border: 1px solid rgba(138, 109, 42, 0.3);
  border-radius: 4px;
  color: #8a6d2a;
  cursor: pointer;
  padding: 2px 8px;
  font-size: 11.5px;
}
.network-offline-banner .network-offline-recheck:hover { background: rgba(255, 255, 255, 0.8); }
.network-offline-banner .network-offline-close {
  background: transparent;
  border: none;
  color: #8a6d2a;
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  padding: 0 2px;
  opacity: 0.7;
}
.network-offline-banner .network-offline-close:hover { opacity: 1; }

.mcp-status-banner-wrap {
  padding: 8px 12px;
  background: rgba(245, 108, 108, 0.08);
  border-bottom: 1px solid rgba(245, 108, 108, 0.25);
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.mcp-status-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: #c45656;
}
.mcp-status-banner .mcp-status-icon { font-size: 15px; }
.mcp-status-banner .mcp-status-text { flex: 1; }
.mcp-status-banner .mcp-status-close {
  background: transparent;
  border: none;
  color: #c45656;
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  padding: 0 4px;
}
.mcp-status-banner .mcp-status-close:hover { color: #f56c6c; }
.chat-panel {
  width: 100%;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background-color: var(--ai-panel-bg);
  -webkit-backdrop-filter: var(--blur-amount) var(--blur-saturate);
  backdrop-filter: var(--blur-amount) var(--blur-saturate);
  border-left: 1px solid var(--border-color);
  position: relative;
}

/* ========== Header ========== */
.chat-header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-color);
}

.header-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.chat-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.status-indicator {
  display: flex;
  align-items: center;
  gap: 5px;
}

.status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}

.status-dot.online {
  background-color: var(--apple-green);
  box-shadow: 0 0 0 2px rgba(52, 199, 89, 0.2);
}

.status-dot.thinking {
  background-color: var(--apple-orange);
  animation: pulse 1.2s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% {
    opacity: 1;
    box-shadow: 0 0 0 2px rgba(255, 149, 0, 0.2);
  }
  50% {
    opacity: 0.5;
    box-shadow: 0 0 0 4px rgba(255, 149, 0, 0.1);
  }
}

.status-text {
  font-size: 12px;
  color: var(--text-secondary);
}

/* ========== Messages ========== */
.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.welcome-message {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 40px 20px;
  gap: 8px;
}

.welcome-icon {
  width: 56px;
  height: 56px;
  margin-bottom: 8px;
}

.welcome-icon svg {
  width: 100%;
  height: 100%;
}

.welcome-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
}

.welcome-desc {
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.5;
  max-width: 240px;
}

/* Message bubbles */
.message {
  display: flex;
  max-width: 100%;
  position: relative;
  animation: msg-fade-in var(--transition-standard);
}

.message.user {
  justify-content: flex-end;
}

.message.assistant {
  justify-content: flex-start;
}

.message-content {
  max-width: 88%;
  font-size: 10px;
  line-height: 1.6;
  word-break: break-word;
  padding-right: 32px;
}

.user-content {
  padding: 10px 14px;
  background-color: var(--bubble-user);
  color: #fff;
  border-radius: var(--radius-lg);
  border-bottom-right-radius: var(--radius-xs);
  white-space: pre-wrap;
}

/* AI 触发的菜单操作（如一键整理、AI 出题、AI 背诵改写 等）：
 * 只显示原子操作名 + 操作图标，避免大段 prompt 文本污染聊天列表。 */
.user-content.is-ai-action {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background-color: rgba(139, 92, 246, 0.08);
  color: #7c3aed;
  border: 1px dashed rgba(139, 92, 246, 0.35);
  font-weight: 500;
  padding: 6px 12px;
  border-radius: 16px;
  white-space: nowrap;
  align-self: flex-end;
}
.user-content.is-ai-action .ai-action-icon {
  font-size: 13px;
  line-height: 1;
}
.user-content.is-ai-action .ai-action-text {
  font-size: 12.5px;
}
.message.ai-action .message-content.is-ai-action {
  background-color: rgba(139, 92, 246, 0.08);
  color: #7c3aed;
}

.assistant-content {
  padding: 10px 14px;
  background-color: var(--bubble-ai);
  color: var(--text-primary);
  border-radius: var(--radius-lg);
  border-bottom-left-radius: var(--radius-xs);
}

.msg-copy-btn {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  cursor: pointer;
  border-radius: 4px;
  opacity: 0;
  transition: opacity 0.2s, background 0.2s;
  color: var(--text-secondary, #86868b);
  z-index: 5;
}
.message:hover .msg-copy-btn {
  opacity: 1;
}
.msg-copy-btn:hover {
  background: rgba(0,0,0,0.06);
}
/* 用户消息气泡为蓝色背景，复制图标使用浅色以保证可见性 */
.message.user .msg-copy-btn {
  color: rgba(255, 255, 255, 0.75);
}
.message.user .msg-copy-btn:hover {
  background: rgba(255, 255, 255, 0.18);
}

@keyframes msg-fade-in {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* ========== 任务计划清单（Plan-and-Execute） ========== */
.plan-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 10px;
  margin-bottom: 8px;
  background: rgba(124, 58, 237, 0.06);
  border: 1px solid rgba(124, 58, 237, 0.22);
  border-radius: 8px;
}

.plan-header {
  display: flex;
  align-items: center;
  gap: 5px;
  color: #7c3aed;
  margin-bottom: 2px;
}

.plan-title {
  font-size: 12px;
  font-weight: 600;
  color: #7c3aed;
}

.plan-progress {
  margin-left: auto;
  font-size: 11px;
  font-weight: 600;
  color: #7c3aed;
  background: rgba(124, 58, 237, 0.12);
  border-radius: 10px;
  padding: 1px 8px;
}

.plan-step {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  color: var(--text-secondary, #555);
  transition: color 0.25s;
}

.plan-step-check {
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 600;
  color: #9ca3af;
  border: 1.2px solid #d1d5db;
  border-radius: 50%;
  transition: all 0.25s;
}

.plan-step.done {
  color: #059669;
}

.plan-step.done .plan-step-check {
  color: #fff;
  background: #059669;
  border-color: #059669;
}

.plan-step.done .plan-step-text {
  text-decoration: line-through;
  text-decoration-color: rgba(5, 150, 105, 0.5);
}

/* ========== Todo 原子胶囊 ========== */
.plan-float {
  position: relative;
  z-index: 30;
  display: flex;
  justify-content: center;
  pointer-events: auto;
}

.plan-float-capsule {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  border-radius: 999px;
  background: rgba(0, 122, 255, 0.12);
  border: 1px solid rgba(0, 122, 255, 0.28);
  color: var(--apple-blue, #007aff);
  font-size: 12px;
  cursor: pointer;
  user-select: none;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
}

.plan-float-icon {
  font-size: 13px;
}

.plan-float-progress {
  font-weight: 700;
}

.plan-float-panel {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%);
  width: min(420px, calc(100vw - 32px));
  max-height: 300px;
  overflow-y: auto;
  padding: 10px 12px;
  background: #fff;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 12px;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.14);
}

.plan-float-step {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 6px 0;
  border-bottom: 1px solid rgba(0, 0, 0, 0.05);
  font-size: 13px;
  color: var(--text-primary);
}

.plan-float-step:last-child {
  border-bottom: none;
}

.plan-float-step.done {
  color: var(--text-tertiary);
}

.plan-float-step.done .plan-float-step-text {
  text-decoration: line-through;
}

.plan-float-check {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  margin-top: 1px;
  border: 1px solid rgba(0, 122, 255, 0.45);
  border-radius: 4px;
  color: #fff;
  background: transparent;
  font-size: 11px;
  flex-shrink: 0;
}

.plan-float-step.done .plan-float-check {
  background: var(--apple-blue, #007aff);
  border-color: var(--apple-blue, #007aff);
}

.plan-pop-enter-active,
.plan-pop-leave-active {
  transition: opacity 0.12s ease, transform 0.12s ease;
}

.plan-pop-enter-from,
.plan-pop-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(4px);
}

/* ========== Tool Call Status ========== */
.tool-calls {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 8px;
}

.tool-call-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  background: rgba(0, 0, 0, 0.04);
  border-radius: 6px;
  font-size: 12px;
}

/* 工具调用折叠开关（超过2项时显示） */
.tool-calls-toggle {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 4px 8px;
  background: rgba(0, 122, 255, 0.06);
  border: 1px solid rgba(0, 122, 255, 0.2);
  border-radius: 6px;
  font-size: 12px;
  color: var(--apple-blue, #007aff);
  cursor: pointer;
  width: fit-content;
  transition: background 0.15s;
}

.tool-calls-toggle:hover {
  background: rgba(0, 122, 255, 0.12);
}

.tct-arrow {
  font-size: 10px;
  display: inline-block;
  transition: transform 0.15s;
}

.tct-arrow.open {
  transform: rotate(90deg);
}

/* 快捷点选区域 */
.quick-picks {
  margin-top: 10px;
  padding: 8px 10px;
  background: rgba(0, 122, 255, 0.04);
  border: 1px solid rgba(0, 122, 255, 0.15);
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.confirm-quick-replies {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
}

.confirm-quick-label {
  font-size: 12px;
  color: var(--text-secondary, #666);
}

.confirm-quick-btn {
  border: 1px solid rgba(0, 122, 255, 0.25);
  background: #fff;
  color: var(--apple-blue, #007aff);
  border-radius: 8px;
  padding: 4px 10px;
  font-size: 12px;
  cursor: pointer;
}

.confirm-quick-btn.primary {
  background: var(--apple-blue, #007aff);
  color: #fff;
}

.qp-caption {
  font-size: 11px;
  color: var(--text-secondary);
}

.qp-options {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.qp-option {
  padding: 5px 12px;
  background: var(--bg-color, #fff);
  border: 1px solid rgba(0, 122, 255, 0.35);
  border-radius: 14px;
  font-size: 12.5px;
  color: var(--text-primary);
  cursor: pointer;
  transition: all 0.15s;
  max-width: 100%;
  text-align: left;
}

.qp-option:hover {
  background: rgba(0, 122, 255, 0.1);
}

.qp-option.active {
  background: var(--apple-blue, #007aff);
  border-color: var(--apple-blue, #007aff);
  color: #fff;
}

.qp-submit,
.qp-other-send {
  padding: 5px 14px;
  background: var(--apple-blue, #007aff);
  border: none;
  border-radius: 14px;
  font-size: 12.5px;
  color: #fff;
  cursor: pointer;
  transition: opacity 0.15s;
}

.qp-submit:hover,
.qp-other-send:hover {
  opacity: 0.85;
}

.qp-other {
  display: flex;
  gap: 6px;
  align-items: center;
}

.qp-other-input {
  flex: 1;
  min-width: 0;
  padding: 5px 10px;
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 8px;
  font-size: 12.5px;
  background: var(--bg-color, #fff);
  color: var(--text-primary);
  outline: none;
}

.qp-other-input:focus {
  border-color: var(--apple-blue, #007aff);
}

.tool-call-item.done {
  background: rgba(52, 199, 89, 0.06);
}

.tool-call-item.error {
  background: rgba(255, 59, 48, 0.06);
}

.tool-call-icon {
  width: 14px;
  height: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.tool-spinner {
  width: 12px;
  height: 12px;
  border: 1.5px solid rgba(0, 122, 255, 0.2);
  border-top-color: var(--apple-blue);
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
  display: inline-block;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.tool-check {
  color: var(--apple-green);
  font-size: 13px;
}

.tool-error {
  color: var(--apple-red);
  font-size: 13px;
}

.tool-call-name {
  color: var(--text-primary);
  font-weight: 500;
}

.tool-call-status {
  color: var(--text-secondary);
  margin-left: auto;
}

.tool-call-item.calling .tool-call-status {
  color: var(--apple-blue);
}

.tool-call-item.done .tool-call-status {
  color: var(--apple-green);
}

.tool-call-item.error .tool-call-status {
  color: var(--apple-red);
}

/* 工具参数摘要：让用户看到"正在给 12 个节点上色" */
.tool-call-summary {
  color: var(--text-secondary);
  font-size: 11px;
  opacity: 0.85;
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-left: 6px;
}

/* 一键撤销本次 AI 全部操作 */
.undo-txn-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-top: 6px;
  padding: 3px 10px;
  border: 1px solid var(--border-color, #d1d1d6);
  border-radius: 10px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 11px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.undo-txn-btn:hover {
  color: var(--apple-orange, #ff9500);
  border-color: var(--apple-orange, #ff9500);
  background: rgba(255, 149, 0, 0.06);
}

/* ========== Markdown Content ========== */
.assistant-content :deep(.md-content) {
  font-size: 10px;
  line-height: 1.6;
}

.assistant-content :deep(.md-content p) {
  margin: 4px 0;
}

.assistant-content :deep(.md-content p:first-child) {
  margin-top: 0;
}

.assistant-content :deep(.md-content p:last-child) {
  margin-bottom: 0;
}

.assistant-content :deep(.md-content h1),
.assistant-content :deep(.md-content h2),
.assistant-content :deep(.md-content h3),
.assistant-content :deep(.md-content h4),
.assistant-content :deep(.md-content h5),
.assistant-content :deep(.md-content h6) {
  margin: 8px 0 4px;
  font-weight: 600;
}

.assistant-content :deep(.md-content h1) { font-size: 14px; }
.assistant-content :deep(.md-content h2) { font-size: 13px; }
.assistant-content :deep(.md-content h3) { font-size: 12px; }

.assistant-content :deep(.md-content .md-inline-code) {
  padding: 1px 5px;
  background: rgba(0,0,0,0.06);
  border-radius: 4px;
  font-family: 'SF Mono', 'Fira Code', monospace;
  font-size: 12px;
}

.assistant-content :deep(.md-content .md-code-block) {
  margin: 6px 0;
  padding: 8px 10px;
  background: rgba(0,0,0,0.06);
  border-radius: 6px;
  overflow-x: auto;
  font-size: 12px;
}

.assistant-content :deep(.md-content .md-list) {
  margin: 4px 0;
  padding-left: 18px;
}

.assistant-content :deep(.md-content .md-list li) {
  margin: 2px 0;
}

.assistant-content :deep(.md-content .md-quote) {
  margin: 6px 0;
  padding: 4px 10px;
  border-left: 3px solid rgba(0,122,255,0.3);
  background: rgba(0,0,0,0.03);
  border-radius: 0 4px 4px 0;
}

.assistant-content :deep(.md-content .md-hr) {
  border: none;
  border-top: 1px solid rgba(0,0,0,0.1);
  margin: 8px 0;
}

.assistant-content :deep(.md-content a) {
  color: var(--apple-blue, #007aff);
}

/* ========== Markdown Toggle Raw ========== */
.assistant-content :deep(.md-toggle-raw) {
  display: inline-block;
  margin-top: 6px;
  padding: 2px 10px;
  font-size: 11px;
  font-family: var(--font-family);
  color: var(--text-tertiary);
  background: rgba(0, 0, 0, 0.04);
  border: 1px solid rgba(0, 0, 0, 0.06);
  border-radius: 12px;
  cursor: pointer;
  transition: background-color var(--transition-fast), color var(--transition-fast);
}

.assistant-content :deep(.md-toggle-raw:hover) {
  background: rgba(0, 0, 0, 0.08);
  color: var(--text-secondary);
}

.assistant-content :deep(.md-raw-text) {
  white-space: pre-wrap;
  word-break: break-word;
  font-family: 'SF Mono', 'Fira Code', monospace;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-secondary);
}

/* ========== Markdown Table ========== */
.assistant-content :deep(.md-content .md-table-wrap) {
  margin: 6px 0;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  max-width: 100%;
}

.assistant-content :deep(.md-content table) {
  border-collapse: collapse;
  width: auto;
  min-width: 100%;
  font-size: 13px;
}

.assistant-content :deep(.md-content th),
.assistant-content :deep(.md-content td) {
  border: 1px solid rgba(0,0,0,0.1);
  padding: 4px 8px;
  text-align: left;
  white-space: nowrap;
}

.assistant-content :deep(.md-content th) {
  background: rgba(0,0,0,0.04);
  font-weight: 600;
}

.assistant-content :deep(.md-content tr:nth-child(even)) {
  background: rgba(0,0,0,0.02);
}

/* ========== Typing Dots ========== */
.typing-dots {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 12px 16px;
  background-color: var(--bubble-ai);
  border-radius: var(--radius-lg);
  border-bottom-left-radius: var(--radius-xs);
}

.typing-dots .dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background-color: var(--text-tertiary);
  animation: typing-bounce 1.3s ease-in-out infinite;
}

.typing-dots .dot:nth-child(2) { animation-delay: 0.15s; }
.typing-dots .dot:nth-child(3) { animation-delay: 0.3s; }

@keyframes typing-bounce {
  0%, 60%, 100% {
    transform: translateY(0);
    opacity: 0.4;
  }
  30% {
    transform: translateY(-6px);
    opacity: 1;
  }
}

/* ========== Toolbar (记忆/历史/新建) ========== */
.chat-toolbar {
  display: flex;
  gap: 4px;
  padding: 8px 10px;
  border-top: 1px solid var(--border-color);
  flex-shrink: 0;
}

.toolbar-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 30px;
  padding: 0 8px;
  font-size: 11px;
  font-family: var(--font-family);
  color: var(--text-primary);
  background-color: rgba(0, 0, 0, 0.05);
  border: none;
  border-radius: var(--radius-full);
  cursor: pointer;
  transition: background-color var(--transition-fast),
    transform var(--transition-fast);
  white-space: nowrap;
  flex-shrink: 0;
}

.toolbar-btn:hover {
  background-color: rgba(0, 0, 0, 0.08);
}

.toolbar-btn:active {
  background-color: rgba(0, 0, 0, 0.12);
  transform: scale(0.96);
}

.toolbar-btn.primary {
  background-color: var(--apple-blue);
  color: #fff;
}

.toolbar-btn.primary:hover {
  background-color: #0066d6;
}

/* 信任模式按钮 */
.toolbar-btn.primary svg {
  color: #fff;
}

.toolbar-btn svg {
  color: var(--apple-blue);
}

/* 底部栏信任模式按钮 */
.add-image-btn.trust-toggle.active {
  background: rgba(255, 149, 0, 0.12);
}
.add-image-btn.trust-toggle.active svg {
  color: #ff9500;
}

/* ========== History Panel ========== */
.history-panel {
  position: absolute;
  bottom: 100px;
  left: 12px;
  right: 12px;
  max-height: 320px;
  background: rgba(255, 255, 255, 0.95);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  backdrop-filter: blur(20px) saturate(180%);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.16);
  z-index: 50;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.history-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-color);
}

.history-header-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.history-clear-btn {
  font-size: 12px;
  color: #ff3b30;
  background: transparent;
  border: none;
  padding: 4px 10px;
  border-radius: 6px;
  cursor: pointer;
  transition: background-color var(--transition-fast);
  font-family: var(--font-family);
}

.history-clear-btn:hover {
  background: rgba(255, 59, 48, 0.1);
}

.history-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.history-close {
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  font-size: 14px;
  color: var(--text-secondary);
  cursor: pointer;
  border-radius: 6px;
}

.history-close:hover {
  background: rgba(0, 0, 0, 0.06);
}

.history-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px;
}

.history-item {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px 12px;
  border-radius: 8px;
  cursor: pointer;
  transition: background-color var(--transition-fast);
}

.history-item:hover {
  background: rgba(0, 0, 0, 0.04);
}

.history-item.active {
  background: rgba(0, 122, 255, 0.08);
}

.history-item-content {
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

.history-item-delete {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  color: var(--text-tertiary);
  opacity: 0;
  transition: opacity var(--transition-fast), background-color var(--transition-fast), color var(--transition-fast);
}

.history-item:hover .history-item-delete {
  opacity: 1;
}

.history-item-delete:hover {
  background: rgba(255, 59, 48, 0.1);
  color: #ff3b30;
}

.history-item-title {
  font-size: 13px;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.history-item-time {
  font-size: 11px;
  color: var(--text-tertiary);
  margin-top: 2px;
}

.history-empty {
  padding: 24px;
  text-align: center;
  font-size: 13px;
  color: var(--text-tertiary);
}

.history-slide-enter-active,
.history-slide-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.history-slide-enter-from,
.history-slide-leave-to {
  opacity: 0;
  transform: translateY(10px);
}

/* ========== Memory Dialog ========== */
.memory-dialog-content {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.memory-hint {
  font-size: 13px;
  color: var(--text-secondary);
  margin: 0;
}

.memory-textarea {
  width: 100%;
  padding: 10px 12px;
  font-size: 13px;
  font-family: var(--font-family);
  color: var(--text-primary);
  background-color: var(--input-bg);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  outline: none;
  resize: vertical;
  line-height: 1.5;
}

.memory-textarea:focus {
  border-color: var(--apple-blue);
  box-shadow: var(--focus-ring);
}

/* ========== Danger Confirm Dialog ========== */
.danger-dialog-content {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
}

.danger-icon-wrap {
  align-self: center;
  margin-bottom: 4px;
}

.danger-tool-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.danger-reason {
  font-size: 13px;
  color: var(--text-secondary);
  margin: 0;
  line-height: 1.5;
}

.danger-args {
  font-size: 12px;
  color: var(--text-secondary);
  margin: 0;
  padding: 6px 10px;
  background: var(--input-bg, rgba(0, 0, 0, 0.04));
  border-radius: 6px;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.danger-remember {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-secondary);
  cursor: pointer;
  margin-top: 2px;
}

.danger-remember input[type='checkbox'] {
  accent-color: var(--apple-blue, #007aff);
  width: 14px;
  height: 14px;
}

.dialog-btn {
  height: 32px;
  padding: 0 16px;
  font-size: 13px;
  font-family: var(--font-family);
  border: none;
  border-radius: 8px;
  cursor: pointer;
  transition: background-color var(--transition-fast);
}

.dialog-btn.cancel {
  background: rgba(0, 0, 0, 0.06);
  color: var(--text-primary);
}

.dialog-btn.cancel:hover {
  background: rgba(0, 0, 0, 0.1);
}

.dialog-btn.confirm {
  background: var(--apple-blue);
  color: #fff;
}

.dialog-btn.confirm:hover {
  background: #0066d6;
}

/* ========== Header Right ========== */
.header-right {
  display: flex;
  align-items: center;
  gap: 4px;
}

.header-icon-btn {
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  color: var(--text-secondary);
  transition: background-color var(--transition-fast), color var(--transition-fast);
}

.header-icon-btn:hover {
  background: rgba(0, 0, 0, 0.06);
  color: var(--text-primary);
}

.header-icon-btn.active {
  background: rgba(0, 122, 255, 0.1);
  color: var(--apple-blue);
}

.header-icon-btn.ai-bind-btn.locked {
  background: rgba(0, 122, 255, 0.12);
  color: var(--apple-blue);
}

:deep(.el-dropdown-menu__item.is-selected) {
  color: var(--apple-blue);
  font-weight: 600;
  background: rgba(0, 122, 255, 0.08);
}

/* ========== Input Area ========== */
.chat-input-area {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 16px 16px;
  border-top: 1px solid var(--border-color);
  flex-shrink: 0;
}

.queued-messages {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.queued-message {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-radius: 8px;
  background: rgba(0, 122, 255, 0.06);
  border: 1px solid rgba(0, 122, 255, 0.14);
  font-size: 12px;
}

.queued-index {
  color: var(--apple-blue, #007aff);
  font-weight: 700;
}

.queued-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.queued-btn {
  border: none;
  background: transparent;
  color: var(--apple-blue, #007aff);
  cursor: pointer;
  font-size: 11px;
}

.queued-btn.danger {
  color: #ff3b30;
}

/* ========== 引用节点胶囊 ========== */
.attached-refs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  max-height: 96px;
  overflow-y: auto;
}

.skill-picker {
  position: absolute;
  bottom: 100%;
  left: 12px;
  right: 12px;
  max-height: 220px;
  overflow-y: auto;
  padding: 6px;
  background: #fff;
  border: 1px solid rgba(0, 0, 0, 0.1);
  border-radius: 10px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.14);
  z-index: 20;
}

.skill-picker-title {
  font-size: 11px;
  color: var(--text-secondary);
  padding: 2px 6px 4px;
}

.skill-picker-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  width: 100%;
  padding: 5px 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-primary);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}

.skill-picker-item:hover {
  background: rgba(0, 122, 255, 0.08);
}

.skill-picker-desc {
  color: var(--text-tertiary);
  font-size: 11px;
}

/* ========== 拖入文件胶囊 ========== */
.attached-files {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  max-height: 96px;
  overflow-y: auto;
}

.file-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 280px;
  padding: 3px 8px;
  font-size: 12px;
  color: #059669;
  background: rgba(16, 185, 129, 0.1);
  border: 1px solid rgba(16, 185, 129, 0.45);
  border-radius: 999px;
  cursor: default;
}

.file-chip-icon {
  flex-shrink: 0;
}

/* ========== 消息内附件/图片（用户已发送 + AI 生成文件） ========== */
.msg-images {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 6px;
}

.msg-thumb {
  max-width: 180px;
  max-height: 140px;
  border-radius: 8px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  cursor: zoom-in;
  object-fit: cover;
}

/* review bug：消息容器宽度限制——AI 返回的文件消息如果文件名很长，会突破消息框宽度溢出
   这里给 .message-content 设最大宽度 + 内部附件容器允许换行，并让 chip 自身有限宽 + ellipsis */
.message-content {
  max-width: 100%;
  overflow-wrap: anywhere;
  word-break: break-word;
}
.msg-attachments {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 6px;
  max-width: 100%;
  overflow: hidden; /* 兜底：极端情况下整体容器不溢出 */
}
.msg-file-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: min(280px, calc(100% - 8px));
  padding: 3px 8px;
  font-size: 12px;
  color: #0369a1;
  background: rgba(14, 165, 233, 0.1);
  border: 1px solid rgba(14, 165, 233, 0.45);
  border-radius: 999px;
  cursor: pointer;
  user-select: none;
  transition: background-color 0.15s;
  overflow: hidden; /* 兜底：芯片自身不溢出 */
}
.msg-file-chip:hover {
  background: rgba(14, 165, 233, 0.2);
}
.file-chip-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
  max-width: 200px;
}
.file-chip-icon {
  flex-shrink: 0;
}
.file-chip-ext {
  flex-shrink: 0;
  font-size: 10px;
  opacity: 0.75;
}

/* review bug：Skill 沉淀卡片（消息列表内反馈，可编辑 / 可保存 / 可一键试用） */
.skill-card {
  margin-top: 12px;
  padding: 12px 14px;
  border-radius: 10px;
  border: 1px solid rgba(139, 92, 246, 0.35);
  background: linear-gradient(135deg, rgba(139, 92, 246, 0.06), rgba(59, 130, 246, 0.06));
  max-width: 100%;
  box-sizing: border-box;
  word-break: break-word;
  overflow-wrap: anywhere;
}
.skill-card-analyzing {
  border-style: dashed;
  opacity: 0.85;
}
.skill-card-ready {
  border-color: rgba(34, 197, 94, 0.55);
  background: linear-gradient(135deg, rgba(34, 197, 94, 0.06), rgba(59, 130, 246, 0.06));
}
.skill-card-saving {
  opacity: 0.85;
}
.skill-card-saved {
  border-color: rgba(34, 197, 94, 0.7);
  background: linear-gradient(135deg, rgba(34, 197, 94, 0.12), rgba(34, 197, 94, 0.04));
}
.skill-card-not_feasible {
  border-color: rgba(245, 158, 11, 0.55);
  background: rgba(245, 158, 11, 0.06);
}
.skill-card-failed {
  border-color: rgba(239, 68, 68, 0.55);
  background: rgba(239, 68, 68, 0.06);
}
.skill-card-discarded {
  opacity: 0.5;
  border-style: dashed;
}
.skill-card-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
  font-weight: 600;
  font-size: 13px;
  color: #6d28d9;
}
.skill-card-icon {
  font-size: 16px;
}
.skill-card-title {
  flex: 1;
}
.skill-card-status {
  font-size: 12px;
  padding: 2px 10px;
  border-radius: 999px;
  background: rgba(139, 92, 246, 0.15);
  color: #6d28d9;
}
.skill-card-ready .skill-card-status {
  background: rgba(34, 197, 94, 0.18);
  color: #15803d;
}
.skill-card-saved .skill-card-status {
  background: rgba(34, 197, 94, 0.25);
  color: #15803d;
}
.skill-card-not_feasible .skill-card-status {
  background: rgba(245, 158, 11, 0.2);
  color: #b45309;
}
.skill-card-failed .skill-card-status {
  background: rgba(239, 68, 68, 0.2);
  color: #b91c1c;
}
.skill-card-reason {
  margin: 6px 0;
  padding: 8px 10px;
  background: rgba(255, 255, 255, 0.6);
  border-radius: 6px;
  font-size: 12px;
  line-height: 1.6;
  color: #475569;
  white-space: pre-wrap;
  word-break: break-word;
}
.skill-card-field {
  margin: 8px 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.skill-card-field label {
  font-size: 12px;
  font-weight: 500;
  color: #475569;
}
.skill-card-input,
.skill-card-textarea {
  width: 100%;
  padding: 6px 10px;
  border: 1px solid rgba(139, 92, 246, 0.35);
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.85);
  color: #1f2937;
  font-family: inherit;
  font-size: 13px;
  box-sizing: border-box;
  resize: vertical;
}
.skill-card-input:focus,
.skill-card-textarea:focus {
  outline: none;
  border-color: rgba(139, 92, 246, 0.75);
  background: #fff;
}
.skill-card-input:disabled,
.skill-card-textarea:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}
.skill-card-textarea {
  min-height: 120px;
  font-family: ui-monospace, 'Cascadia Code', Menlo, Consolas, monospace;
  font-size: 12px;
  line-height: 1.5;
}
.skill-card-error {
  margin-top: 8px;
  padding: 6px 10px;
  background: rgba(239, 68, 68, 0.1);
  color: #b91c1c;
  border-radius: 6px;
  font-size: 12px;
}
.skill-card-saved {
  margin-top: 8px;
  display: flex;
  gap: 8px;
}
.skill-card-saved-tag {
  font-size: 11px;
  padding: 2px 8px;
  background: rgba(34, 197, 94, 0.2);
  color: #15803d;
  border-radius: 999px;
}
.skill-card-actions {
  margin-top: 12px;
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.skill-card-btn {
  padding: 6px 14px;
  border-radius: 6px;
  border: 1px solid rgba(139, 92, 246, 0.35);
  background: rgba(255, 255, 255, 0.85);
  color: #6d28d9;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s;
}
.skill-card-btn:hover {
  background: rgba(139, 92, 246, 0.1);
  border-color: rgba(139, 92, 246, 0.6);
}
.skill-card-btn.primary {
  background: rgba(34, 197, 94, 0.15);
  border-color: rgba(34, 197, 94, 0.6);
  color: #15803d;
}
.skill-card-btn.primary:hover {
  background: rgba(34, 197, 94, 0.3);
}
.skill-card-btn.danger {
  background: rgba(239, 68, 68, 0.08);
  border-color: rgba(239, 68, 68, 0.45);
  color: #b91c1c;
}
.skill-card-btn.danger:hover {
  background: rgba(239, 68, 68, 0.18);
}

/* 拖拽悬停：输入区绿色虚线高亮 */
.chat-input-area.file-drag-over {
  position: relative;
  background: rgba(16, 185, 129, 0.05);
  outline: 1.5px dashed rgba(16, 185, 129, 0.6);
  outline-offset: -4px;
}

.file-drag-hint {
  position: absolute;
  inset: 0;
  z-index: 5;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  color: #059669;
  background: rgba(255, 255, 255, 0.85);
  pointer-events: none; /* 不拦截 drop 事件落到容器 */
  border-radius: 4px;
}

/* ========== AI 续写提问快捷回复 ========== */
.quick-reply-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  padding: 7px 9px;
  background: linear-gradient(135deg, rgba(139, 92, 246, 0.08), rgba(59, 130, 246, 0.08));
  border: 1px solid rgba(139, 92, 246, 0.35);
  border-radius: 8px;
}

/* 后台任务运行提示条 */
.bg-task-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: rgba(255, 149, 0, 0.08);
  border: 1px solid rgba(255, 149, 0, 0.3);
  border-radius: 8px;
  font-size: 12px;
}

.bg-task-spinner {
  width: 12px;
  height: 12px;
  border: 2px solid #ff9500;
  border-top-color: transparent;
  border-radius: 50%;
  animation: bg-spin 0.8s linear infinite;
  flex-shrink: 0;
}

@keyframes bg-spin {
  to { transform: rotate(360deg); }
}

.bg-task-text {
  color: #b8740a;
  font-weight: 500;
}

.bg-task-hint {
  color: #a8a29e;
  font-size: 11px;
  margin-left: auto;
}

.quick-reply-label {
  flex-shrink: 0;
  font-size: 12px;
  font-weight: 600;
  color: #7c3aed;
}

.quick-reply-btn {
  flex-shrink: 0;
  padding: 4px 12px;
  font-size: 12px;
  line-height: 1.4;
  color: #7c3aed;
  background: rgba(139, 92, 246, 0.1);
  border: 1px solid rgba(139, 92, 246, 0.45);
  border-radius: 999px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
  user-select: none;
}

.quick-reply-btn:hover {
  background: rgba(139, 92, 246, 0.22);
}

.quick-reply-btn.cancel {
  color: #64748b;
  background: transparent;
  border-color: rgba(100, 116, 139, 0.4);
}

.quick-reply-btn.cancel:hover {
  background: rgba(100, 116, 139, 0.12);
}

.quick-reply-hint {
  font-size: 11px;
  color: #94a3b8;
  margin-left: auto;
  white-space: nowrap;
}

.ref-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 100%;
  padding: 4px 8px;
  font-size: 12px;
  line-height: 1.4;
  color: #1d4ed8;
  background: rgba(59, 130, 246, 0.12);
  border: 1px solid rgba(59, 130, 246, 0.45);
  border-radius: 8px;
  user-select: none;
  white-space: nowrap;
}

.ref-chip-icon {
  flex-shrink: 0;
  opacity: 0.75;
}

.ref-chip-file {
  flex-shrink: 0;
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 600;
}

.ref-chip-sep {
  flex-shrink: 0;
  opacity: 0.6;
}

.ref-chip-text {
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 180px;
}

.ref-chip-kind {
  flex-shrink: 0;
  padding: 0 5px;
  font-size: 10px;
  color: #3b82f6;
  background: rgba(59, 130, 246, 0.12);
  border-radius: 6px;
}

.ref-chip-close {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  margin-left: 2px;
  padding: 0;
  font-size: 13px;
  line-height: 1;
  color: #3b82f6;
  background: transparent;
  border: none;
  border-radius: 50%;
  cursor: pointer;
}

.ref-chip-close:hover {
  color: #fff;
  background: rgba(59, 130, 246, 0.7);
}

/* ========== 消息列表内的引用节点胶囊 ========== */
.msg-refs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 6px;
}

.msg-ref-chip {
  cursor: pointer;
  transition: background-color 0.15s, border-color 0.15s;
}

.msg-ref-chip:hover {
  background: rgba(59, 130, 246, 0.22);
  border-color: rgba(59, 130, 246, 0.7);
}

/* 用户消息（蓝色气泡）内的引用胶囊改用白色半透明，避免蓝底叠蓝字看不清 */
.user-content .ref-chip {
  color: #fff;
  background: rgba(255, 255, 255, 0.16);
  border-color: rgba(255, 255, 255, 0.55);
}

.user-content .ref-chip .ref-chip-kind {
  color: #fff;
  background: rgba(255, 255, 255, 0.24);
}

.user-content .msg-ref-chip:hover {
  background: rgba(255, 255, 255, 0.28);
  border-color: rgba(255, 255, 255, 0.82);
}

/* ========== Input Bottom Bar ========== */
.input-bottom-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

/* ========== Model Switcher ========== */
.model-switcher {
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
  max-width: 120px;
}

/* 悬浮窗工具栏内的模型切换：不占满剩余空间，下拉框向下弹出（工具栏在顶部） */
.toolbar-model-switcher {
  flex: 1 1 auto;
  min-width: 0;
  max-width: none;
}
.toolbar-model-switcher .model-switch-btn {
  width: 100%;
  min-width: 0;
}
.toolbar-model-switcher .model-name {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 11px;
}
.toolbar-model-switcher .model-dropdown {
  top: calc(100% + 6px);
  bottom: auto;
  left: auto;
  right: 0;
  width: 200px;
  max-width: calc(100vw - 32px);
  max-height: 240px;
}

/* 悬浮窗模式：缩小"创建能力"和"新建对话"按钮（图标+文字变紧凑） */
.chat-toolbar.compact-toolbar .toolbar-btn.create-ability-btn,
.chat-toolbar.compact-toolbar .toolbar-btn.primary {
  padding: 0 6px;
  font-size: 10.5px;
  height: 28px;
  gap: 3px;
}
.chat-toolbar.compact-toolbar .toolbar-btn.create-ability-btn svg,
.chat-toolbar.compact-toolbar .toolbar-btn.primary svg {
  width: 13px;
  height: 13px;
}

.model-switch-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding: 0 10px;
  font-size: 12px;
  font-family: var(--font-family);
  color: var(--text-secondary);
  background-color: rgba(0, 0, 0, 0.04);
  border: 1px solid rgba(0, 0, 0, 0.06);
  border-radius: 8px;
  cursor: pointer;
  transition: background-color var(--transition-fast), border-color var(--transition-fast);
  max-width: 100%;
}

.model-switch-btn:hover:not(:disabled) {
  background-color: rgba(0, 0, 0, 0.06);
  border-color: rgba(0, 0, 0, 0.1);
}

.model-switch-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.model-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 70px;
  color: var(--text-primary);
  font-weight: 500;
}

.kb-mode-btn {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 4px;
  height: 28px;
  width: 28px;
  padding: 0;
  justify-content: center;
  font-size: 12px;
  font-family: var(--font-family);
  color: var(--text-secondary);
  background-color: rgba(0, 0, 0, 0.04);
  border: 1px solid rgba(0, 0, 0, 0.06);
  border-radius: 8px;
  cursor: pointer;
  transition: background-color var(--transition-fast), border-color var(--transition-fast), color var(--transition-fast);
  white-space: nowrap;
}

.kb-mode-btn:hover:not(:disabled) {
  background-color: rgba(0, 122, 255, 0.08);
  border-color: rgba(0, 122, 255, 0.2);
  color: var(--apple-blue);
}

.kb-mode-btn.active {
  background-color: rgba(0, 122, 255, 0.12);
  border-color: rgba(0, 122, 255, 0.32);
  color: var(--apple-blue);
}

.kb-mode-btn:disabled {
  opacity: 0.6;
  cursor: wait;
}

.kb-mode-text {
  display: none;
}

.model-spinner {
  animation: spin 1s linear infinite;
  color: var(--apple-blue);
}

.model-chevron {
  color: var(--text-tertiary);
  transition: transform 0.2s;
}

.model-chevron.open {
  transform: rotate(180deg);
}

/* Model Dropdown */
.model-dropdown {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 0;
  width: 240px;
  max-height: 320px;
  background: rgba(255, 255, 255, 0.98);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  backdrop-filter: blur(20px) saturate(180%);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12);
  z-index: 100;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.model-dropdown-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border-color);
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
}

.model-refresh-btn {
  font-size: 11px;
  color: var(--apple-blue);
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 2px 8px;
  border-radius: 6px;
  transition: background-color 0.2s;
}

.model-refresh-btn:hover:not(:disabled) {
  background: rgba(0, 122, 255, 0.08);
}

.model-refresh-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.model-dropdown-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px;
}

.model-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-radius: 8px;
  cursor: pointer;
  transition: background-color 0.15s;
  font-size: 13px;
}

.model-option:hover {
  background: rgba(0, 0, 0, 0.04);
}

.model-option.active {
  background: rgba(0, 122, 255, 0.08);
}

/* 深度思考开关：脑子图标按钮 + 强度菜单 */
.deep-thinking-switcher {
  position: relative;
  display: inline-flex;
}
.toolbar-btn.deep-thinking-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  transition: color 0.15s, background 0.15s;
}
.toolbar-btn.deep-thinking-btn.on {
  color: #8b5cf6;
  background: rgba(139, 92, 246, 0.10);
}
.toolbar-btn.deep-thinking-btn.on:hover {
  background: rgba(139, 92, 246, 0.16);
}
.deep-thinking-menu {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 2200;
  min-width: 180px;
  background: #fff;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 10px;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.10);
  padding: 6px;
}
.deep-thinking-menu-header {
  font-size: 11px;
  color: #999;
  padding: 4px 10px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.deep-thinking-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-radius: 8px;
  cursor: pointer;
  transition: background-color 0.15s;
  font-size: 13px;
}
.deep-thinking-option:hover {
  background: rgba(139, 92, 246, 0.06);
}
.deep-thinking-option.active {
  background: rgba(139, 92, 246, 0.10);
  color: #8b5cf6;
}
.deep-thinking-check {
  color: #8b5cf6;
  font-weight: bold;
}
.deep-thinking-menu-foot {
  border-top: 1px solid rgba(0, 0, 0, 0.06);
  padding: 6px;
  margin-top: 4px;
}
.deep-thinking-foot-btn {
  width: 100%;
  padding: 6px 10px;
  border: none;
  background: transparent;
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
  color: #666;
  transition: background 0.15s;
}
.deep-thinking-foot-btn:hover {
  background: rgba(0, 0, 0, 0.04);
  color: #333;
}

/* 底部工具栏中的深度思考按钮（悬浮窗模式）：菜单向上弹出 */
.bottom-bar-deep-thinking .deep-thinking-menu {
  top: auto;
  bottom: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
}

/* ============ 输入框 + 右下角深度思考上拉按钮（侧边栏模式） ============ */
.chat-input-wrap {
  position: relative;
  display: flex;
}

.input-deep-thinking-pullup {
  position: absolute;
  right: 8px;
  bottom: 6px;
  z-index: 10;
}
.pullup-btn {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.04);
  color: #999;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
  font-size: 11px;
  font-weight: 600;
}
.pullup-btn:hover {
  background: rgba(0, 0, 0, 0.08);
  color: #666;
}
.pullup-btn.on {
  background: rgba(139, 92, 246, 0.12);
  color: #8b5cf6;
}
.pullup-btn.on:hover {
  background: rgba(139, 92, 246, 0.18);
}
.pullup-level {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.5px;
}

/* 上拉菜单 */
.pullup-menu {
  position: absolute;
  bottom: calc(100% + 6px);
  right: 0;
  z-index: 2200;
  min-width: 160px;
  background: #fff;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 10px;
  box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.10);
  padding: 6px;
}
.pullup-menu-title {
  font-size: 11px;
  color: #999;
  padding: 4px 10px 6px;
  letter-spacing: 0.5px;
}
.pullup-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 7px 12px;
  border-radius: 7px;
  cursor: pointer;
  transition: background-color 0.15s;
  font-size: 12.5px;
  color: var(--text-primary);
}
.pullup-option:hover {
  background: rgba(139, 92, 246, 0.06);
}
.pullup-option.active {
  background: rgba(139, 92, 246, 0.10);
  color: #8b5cf6;
}
.pullup-check {
  color: #8b5cf6;
  font-weight: bold;
  font-size: 12px;
}
.pullup-divider {
  height: 1px;
  background: rgba(0, 0, 0, 0.06);
  margin: 4px 6px;
}
.pullup-option.pullup-disable {
  color: #ff3b30;
}
.pullup-option.pullup-disable:hover {
  background: rgba(255, 59, 48, 0.06);
}

/* 上拉菜单过渡动画 */
.pullup-menu-enter-active,
.pullup-menu-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}
.pullup-menu-enter-from,
.pullup-menu-leave-to {
  opacity: 0;
  transform: translateY(6px);
}

.model-option-name {
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.model-option-check {
  color: var(--apple-blue);
  font-size: 13px;
  flex-shrink: 0;
  margin-left: 8px;
}

.model-empty {
  padding: 20px;
  text-align: center;
  font-size: 12px;
  color: var(--text-tertiary);
}

.model-dropdown-footer {
  padding: 8px 14px;
  border-top: 1px solid var(--border-color);
  display: flex;
  justify-content: flex-end;
}

.model-manual-btn {
  font-size: 12px;
  padding: 4px 12px;
  background: rgba(0, 0, 0, 0.05);
  border: none;
  border-radius: 6px;
  cursor: pointer;
  color: var(--text-secondary);
  transition: background-color 0.2s;
}

.model-manual-btn:hover {
  background: rgba(0, 0, 0, 0.1);
}

/* Model dropdown animation */
.model-dropdown-enter-active,
.model-dropdown-leave-active {
  transition: opacity 0.2s, transform 0.2s;
}

.model-dropdown-enter-from,
.model-dropdown-leave-to {
  opacity: 0;
  transform: translateY(6px);
}

/* Input actions (moved into bottom bar) */
.input-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  margin-left: auto;
}

.chat-input {
  flex: 1;
  min-height: 36px;
  max-height: 120px;
  padding: 8px 12px;
  font-size: 12.5px;
  font-family: var(--font-family);
  color: var(--text-primary);
  background-color: var(--input-bg);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  outline: none;
  resize: none;
  line-height: 1.5;
  transition: border-color var(--transition-fast),
    box-shadow var(--transition-fast), background-color var(--transition-fast);
}

.chat-input::placeholder {
  color: var(--text-tertiary);
}

.chat-input:hover {
  background-color: rgba(0, 0, 0, 0.04);
}

.chat-input:focus {
  border-color: var(--apple-blue);
  box-shadow: var(--focus-ring);
  background-color: #fff;
}

.send-btn {
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: var(--apple-blue);
  color: #fff;
  border: none;
  border-radius: 50%;
  cursor: pointer;
  transition: background-color var(--transition-fast),
    transform var(--transition-fast), opacity var(--transition-fast);
}

/* OCR 加号按钮 */
.add-image-btn {
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: rgba(0, 0, 0, 0.05);
  color: var(--text-secondary);
  border: none;
  border-radius: 50%;
  cursor: pointer;
  transition: background-color var(--transition-fast),
    transform var(--transition-fast);
}

.add-image-btn:hover:not(:disabled) {
  background-color: rgba(0, 0, 0, 0.1);
  color: var(--text-primary);
}

.add-image-btn:active:not(:disabled) {
  transform: scale(0.92);
}

.add-image-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.add-image-btn svg {
  width: 18px;
  height: 18px;
}

.add-image-btn.processing {
  background-color: rgba(0, 122, 255, 0.1);
}

.mini-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(0, 122, 255, 0.2);
  border-top-color: var(--apple-blue);
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
  display: inline-block;
}

.send-btn:hover {
  background-color: #0066d6;
}

.send-btn:active {
  background-color: #0055b3;
  transform: scale(0.92);
}

.send-btn.disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.send-btn svg {
  width: 18px;
  height: 18px;
  margin-left: 2px;
}

/* 停止按钮（运行中替代发送按钮） */
.send-btn.stop-btn {
  background-color: #ff3b30;
}

.send-btn.stop-btn:hover {
  background-color: #e0342b;
}

.send-btn.stop-btn:active {
  background-color: #c72e26;
}

.send-btn.stop-btn svg {
  width: 14px;
  height: 14px;
  margin-left: 0;
}

/* 插队按钮（有排队消息时显示，立即发送队列消息） */
.send-btn.jump-btn {
  background-color: #ff9500;
}

.send-btn.jump-btn:hover {
  background-color: #e08600;
}

.send-btn.jump-btn:active {
  background-color: #c77600;
}

.send-btn.jump-btn svg {
  width: 14px;
  height: 14px;
  margin-left: 0;
}

/* 工具调用"已停止"图标 */
.tool-stopped {
  color: #86868b;
  font-size: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.tool-call-item.stopped .tool-call-status {
  color: #86868b;
}

/* 消息中的导出图片 */
.msg-image-wrap {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.msg-image {
  max-width: 100%;
  border-radius: 8px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  display: block;
  cursor: zoom-in;
}

.msg-image-name {
  font-size: 11px;
  color: var(--text-secondary, #86868b);
}

/* 图片放大预览遮罩 */
.img-preview-mask {
  position: fixed;
  inset: 0;
  z-index: 4000;
  background: rgba(0, 0, 0, 0.72);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: zoom-out;
}

.img-preview-img {
  max-width: 92vw;
  max-height: 88vh;
  border-radius: 6px;
  box-shadow: 0 12px 48px rgba(0, 0, 0, 0.5);
  object-fit: contain;
}

.img-preview-close {
  position: absolute;
  top: 16px;
  right: 20px;
  width: 36px;
  height: 36px;
  border: none;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.16);
  color: #fff;
  font-size: 16px;
  cursor: pointer;
  transition: background 0.15s;
}

.img-preview-close:hover {
  background: rgba(255, 255, 255, 0.3);
}

.img-preview-enter-active,
.img-preview-leave-active {
  transition: opacity 0.18s ease;
}

.img-preview-enter-from,
.img-preview-leave-to {
  opacity: 0;
}

/* ========== Scrollbar ========== */
.chat-messages::-webkit-scrollbar {
  width: 6px;
}

.chat-messages::-webkit-scrollbar-track {
  background: transparent;
}

.chat-messages::-webkit-scrollbar-thumb {
  background-color: rgba(0, 0, 0, 0.12);
  border-radius: var(--radius-full);
}

.chat-messages::-webkit-scrollbar-thumb:hover {
  background-color: rgba(0, 0, 0, 0.2);
}

.history-list::-webkit-scrollbar {
  width: 5px;
}

.history-list::-webkit-scrollbar-thumb {
  background-color: rgba(0, 0, 0, 0.12);
  border-radius: var(--radius-full);
}
/* ========== 第三方调用消息中心 ========== */
/* 头部入口按钮上的未读气泡 */
.header-icon-btn {
  position: relative;
}
.tp-badge {
  position: absolute;
  top: -3px;
  right: -4px;
  min-width: 15px;
  height: 15px;
  padding: 0 4px;
  border-radius: 8px;
  background: #ff3b30;
  color: #fff;
  font-size: 10px;
  font-weight: 600;
  line-height: 15px;
  text-align: center;
  box-sizing: border-box;
  animation: tp-badge-pop 0.25s ease-out;
  pointer-events: none;
}
@keyframes tp-badge-pop {
  0% { transform: scale(0.4); opacity: 0; }
  70% { transform: scale(1.15); }
  100% { transform: scale(1); opacity: 1; }
}

.third-party-panel {
  position: absolute;
  top: 60px;
  left: 12px;
  right: 12px;
  bottom: 100px;
  background: rgba(255, 255, 255, 0.96);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  backdrop-filter: blur(20px) saturate(180%);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.16);
  z-index: 60;
  display: flex;
  overflow: hidden;
}

.tp-sidebar {
  flex-shrink: 0;
  width: 112px;
  border-right: 1px solid var(--border-color);
  padding: 12px 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.tp-sidebar-title {
  font-size: 11px;
  color: #8e8e93;
  padding: 0 8px 6px;
}
.tp-channel {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  border-radius: 8px;
  font-size: 13px;
  color: #3a3a3c;
  cursor: pointer;
  transition: background-color var(--transition-fast);
}
.tp-channel:hover {
  background: rgba(0, 0, 0, 0.04);
}
.tp-channel.active {
  background: rgba(0, 122, 255, 0.12);
  color: var(--apple-blue);
  font-weight: 600;
}
.tp-channel-unread {
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 8px;
  background: #ff3b30;
  color: #fff;
  font-size: 10px;
  font-weight: 600;
  line-height: 16px;
  text-align: center;
  box-sizing: border-box;
}

.tp-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.tp-main-header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border-color);
}
.tp-main-titles {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}
.tp-main-title {
  font-size: 14px;
  font-weight: 600;
  color: #1c1c1e;
}
.tp-main-info {
  font-size: 11px;
  color: #8e8e93;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tp-main-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}
.tp-clear-btn {
  font-size: 12px;
  color: #ff3b30;
  background: transparent;
  border: none;
  padding: 4px 10px;
  border-radius: 6px;
  cursor: pointer;
  transition: background-color var(--transition-fast);
}
.tp-clear-btn:hover {
  background: rgba(255, 59, 48, 0.08);
}
.tp-close-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #8e8e93;
  cursor: pointer;
  transition: background-color var(--transition-fast);
}
.tp-close-btn:hover {
  background: rgba(0, 0, 0, 0.06);
  color: #1c1c1e;
}

.tp-messages {
  flex: 1;
  overflow-y: auto;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.tp-empty {
  margin: auto;
  font-size: 13px;
  color: #8e8e93;
}
.tp-msg {
  display: flex;
  flex-direction: column;
  max-width: 100%;
}
.tp-msg.user {
  align-items: flex-end;
}
.tp-msg.assistant {
  align-items: flex-start;
}
.tp-bubble {
  max-width: 86%;
  padding: 8px 12px;
  border-radius: 12px;
  font-size: 13px;
  line-height: 1.55;
  word-break: break-word;
}
.tp-msg.user .tp-bubble {
  background: var(--apple-blue);
  color: #fff;
  border-bottom-right-radius: 4px;
}
.tp-msg.assistant .tp-bubble {
  background: rgba(0, 0, 0, 0.05);
  color: #1c1c1e;
  border-bottom-left-radius: 4px;
}
.tp-bubble .md-content {
  font-size: 13px;
}
.tp-bubble .md-content :deep(p) {
  margin: 4px 0;
}
.tp-bubble .md-content :deep(p:first-child) {
  margin-top: 0;
}
.tp-bubble .md-content :deep(p:last-child) {
  margin-bottom: 0;
}
.tp-time {
  font-size: 10px;
  color: #aeaeb2;
  margin-top: 3px;
  padding: 0 4px;
}
.tp-notice {
  align-self: center;
  max-width: 92%;
  padding: 5px 12px;
  border-radius: 10px;
  background: rgba(255, 159, 10, 0.14);
  color: #b25e00;
  font-size: 12px;
  line-height: 1.5;
  text-align: center;
}
.tp-notice-time {
  display: block;
  font-size: 10px;
  color: #c98a3d;
  margin-top: 2px;
}
.tp-tool-calls {
  margin-top: 6px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.tp-tool-call {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: #6e6e73;
}
.tp-tool-call.done .tool-check {
  color: #34c759;
}
.tp-tool-call.error .tool-error {
  color: #ff3b30;
}
.tp-tool-call.stopped .tool-stopped {
  color: #ff9f0a;
}
.tp-tool-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>



<template>
  <div class="task-scheduler-panel" v-if="visible">
    <!-- ========== 头部 ========== -->
    <div class="ts-header">
      <span class="ts-title">AI 定时任务</span>
      <div class="ts-header-actions">
        <button
          class="ts-log-btn"
          :class="{ active: runLogVisible }"
          title="定时任务运行日志"
          @click="toggleRunLog"
        >
          <svg viewBox="0 0 20 20" fill="none" width="14" height="14">
            <path d="M4 5h12M4 10h12M4 15h8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
          运行日志
        </button>
        <button class="ts-close" @click="$emit('close')">✕</button>
      </div>
    </div>

    <!-- 面板级运行日志（格式与 AI 对话日志一致） -->
    <PanelRunLog
      v-if="runLogVisible"
      source="task"
      :refreshSignal="runLogRefreshSignal"
      @close="runLogVisible = false"
    />

    <!-- ========== 内容区域 ========== -->
    <div class="ts-body">
      <!-- 浏览器模式警告 -->
      <div v-if="!apiAvailable" class="browser-mode-warning">
        定时任务功能仅在桌面应用模式下可用。请使用
        <code>npm run electron:dev</code> 启动应用。
      </div>

      <!-- ========== 创建/编辑任务表单 ========== -->
      <div class="ts-section" v-if="apiAvailable">
        <div class="section-title">
          {{ editingTaskId ? '编辑定时任务' : '新建定时任务' }}
          <span v-if="editingTaskId" class="editing-badge">编辑中</span>
        </div>

        <!-- 任务名称 -->
        <div class="form-row">
          <label>任务名称</label>
          <input
            v-model="newTask.name"
            placeholder="例如：每日总结"
            class="form-input"
            maxlength="50"
          />
        </div>

        <!-- AI 提示词 -->
        <div class="form-row form-row-column">
          <label>AI 提示词</label>
          <textarea
            v-model="newTask.prompt"
            rows="3"
            class="form-input form-textarea"
            placeholder="定时触发时发送给 AI 的提示词..."
            @input="onPromptInput"
          ></textarea>
        </div>

        <!-- 引用原子胶囊 -->
        <div v-if="promptSkills.length || promptMcps.length || promptTools.length" class="ts-mention-chips">
          <span v-for="(s, i) in promptSkills" :key="'s'+s.id" class="ts-mention-chip">
            @{{ s.name }}<button class="ts-mention-remove" @click="removePromptSkill(i)">×</button>
          </span>
          <span v-for="(m, i) in promptMcps" :key="'m'+m.id" class="ts-mention-chip">
            #{{ m.name }}<button class="ts-mention-remove" @click="removePromptMcp(i)">×</button>
          </span>
          <span v-for="(t, i) in promptTools" :key="'t'+t.id" class="ts-mention-chip">
            /{{ t.name }}<button class="ts-mention-remove" @click="removePromptTool(i)">×</button>
          </span>
        </div>

        <!-- 引用选择弹层 -->
        <div v-if="promptSkillPickerVisible" class="ts-mention-picker">
          <div class="ts-mention-title">选择 Skill</div>
          <button v-for="s in filteredPromptSkills" :key="s.id" class="ts-mention-item" @click="selectPromptSkill(s)">
            {{ s.name }}<span v-if="s.description">{{ s.description }}</span>
          </button>
        </div>
        <div v-if="promptMcpPickerVisible" class="ts-mention-picker">
          <div class="ts-mention-title">选择 MCP</div>
          <button v-for="m in filteredPromptMcps" :key="m.id" class="ts-mention-item" @click="selectPromptMcp(m)">
            {{ m.name }}<span v-if="m.description">{{ m.description }}</span>
          </button>
        </div>
        <div v-if="promptToolPickerVisible" class="ts-mention-picker">
          <div class="ts-mention-title">选择工具</div>
          <button v-for="t in filteredPromptTools" :key="t.id" class="ts-mention-item" @click="selectPromptTool(t)">
            {{ t.name }}<span v-if="t.description">{{ t.description }}</span>
          </button>
        </div>

        <!-- 周期类型 -->
        <div class="form-row">
          <label>重复周期</label>
          <select v-model="newTask.cycle" class="form-input">
            <option value="once">仅一次</option>
            <option value="daily">每天</option>
            <option value="weekly">每周</option>
            <option value="monthly">每月</option>
          </select>
        </div>

        <!-- 触发时间 -->
        <div class="form-row">
          <label>触发时间</label>
          <input
            v-model="newTask.datetime"
            type="datetime-local"
            class="form-input"
          />
        </div>

        <!-- 启用开关 -->
        <div class="form-actions">
          <label class="enable-toggle">
            <input type="checkbox" v-model="newTask.enabled" />
            <span>{{ editingTaskId ? '启用任务' : '创建后启用' }}</span>
          </label>
          <button
            v-if="editingTaskId"
            class="btn-secondary"
            @click="cancelEdit"
            :disabled="creating"
          >
            取消
          </button>
          <button
            class="btn-primary"
            @click="saveTask"
            :disabled="creating || !isFormValid"
          >
            {{ creating
              ? (editingTaskId ? '保存中...' : '创建中...')
              : (editingTaskId ? '保存修改' : '创建任务') }}
          </button>
        </div>

        <!-- 创建结果提示 -->
        <div
          v-if="createResult"
          class="result-message"
          :class="createResult.success ? 'success' : 'error'"
        >
          {{ createResult.message }}
        </div>
      </div>

      <!-- ========== 任务列表 ========== -->
      <div class="ts-section" v-if="apiAvailable">
        <div class="section-title">
          已创建任务
          <span class="task-count" v-if="tasks.length > 0">({{ tasks.length }})</span>
        </div>

        <!-- 空状态 -->
        <div v-if="tasks.length === 0 && !loadingTasks" class="empty-state">
          暂无定时任务，请在上方创建
        </div>

        <!-- 加载中 -->
        <div v-if="loadingTasks" class="empty-state">
          加载中...
        </div>

        <!-- 任务卡片 -->
        <div
          v-for="task in tasks"
          :key="task.taskId"
          class="task-card"
          :class="{ disabled: !task.enabled, editing: editingTaskId === task.taskId }"
        >
          <div class="task-card-header">
            <span class="task-name" :title="task.name">{{ task.name }}</span>
            <span class="task-badge" :class="task.cycle">{{ cycleLabel(task.cycle) }}</span>
          </div>
          <div class="task-prompt" :title="task.prompt">
            {{ truncateText(task.prompt, 60) }}
          </div>
          <div class="task-next-run" v-if="getNextRunText(task)" :class="{ expired: getNextRunText(task) === '已过期' }">
            <svg viewBox="0 0 16 16" fill="none" width="12" height="12" class="task-icon-svg">
              <path d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zm3 7.3H8V5.4a.5.5 0 0 0-1 0V9.8h4a.5.5 0 0 0 0-1z" fill="currentColor"/>
            </svg>
            下次执行：{{ getNextRunText(task) }}
          </div>
          <div class="task-card-footer">
            <span class="task-datetime">
              <svg viewBox="0 0 16 16" fill="none" width="12" height="12" class="task-icon-svg">
                <circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.2"/>
                <path d="M8 4.5V8l2.5 1.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
              </svg>
              {{ formatDatetime(task.datetime) }}
            </span>
            <div class="task-actions">
              <button
                class="btn-small btn-edit"
                @click="editTask(task)"
                :disabled="busyTaskId === task.taskId"
                title="编辑"
              >
                编辑
              </button>
              <button
                class="btn-small"
                :class="task.enabled ? 'btn-toggle-off' : 'btn-toggle-on'"
                @click="toggleTask(task)"
                :disabled="busyTaskId === task.taskId"
                :title="task.enabled ? '禁用' : '启用'"
              >
                {{ task.enabled ? '禁用' : '启用' }}
              </button>
              <button
                class="btn-small btn-danger"
                @click="deleteTask(task)"
                :disabled="busyTaskId === task.taskId"
                title="删除"
              >
                {{ busyTaskId === task.taskId ? '处理中…' : '删除' }}
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- ========== 同步按钮 ========== -->
      <div class="ts-section" v-if="apiAvailable && tasks.length > 0">
        <div class="section-title">同步到 Windows 任务计划程序</div>
        <p class="sync-hint">
          将上方任务注册到 Windows 自带的任务计划程序（Task Scheduler）。
          到达设定时间后由系统自动启动本应用并触发对应 AI 任务，同时清理计划程序中残留的孤立任务。
        </p>
        <button
          class="btn-secondary btn-full"
          @click="syncTasks"
          :disabled="syncing"
        >
          {{ syncing ? '同步中...' : '同步到 Windows 任务计划程序' }}
        </button>
        <div
          v-if="syncResult"
          class="result-message"
          :class="syncResult.success ? 'success' : 'error'"
        >
          {{ syncResult.message }}
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { taskSchedulerService } from '../services/taskSchedulerService'
import { addPanelLog } from '../utils/panelLogStore'
import PanelRunLog from './PanelRunLog.vue'
import { aiTools } from '../services/toolHandler'

const props = defineProps({
  visible: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['close'])

// 面板运行日志（与 AI 对话运行日志同构）
const runLogVisible = ref(false)
const runLogRefreshSignal = ref(0)
const toggleRunLog = () => {
  runLogVisible.value = !runLogVisible.value
  if (runLogVisible.value) runLogRefreshSignal.value++
}
const panelLog = (type, content) => {
  addPanelLog('task', type, content)
  if (runLogVisible.value) runLogRefreshSignal.value++
}

// ========== 响应式状态 ==========

// API 是否可用（仅在 Electron 桌面模式下可用）
const apiAvailable = ref(taskSchedulerService.isAvailable())

// 任务列表
const tasks = ref([])
const loadingTasks = ref(false)

// 新建任务表单
const newTask = reactive({
  name: '',
  prompt: '',
  cycle: 'once',
  datetime: getDefaultDatetime(),
  enabled: true
})

// 提示词引用：@Skill / #MCP / /工具
const promptSkills = ref([])
const promptMcps = ref([])
const promptTools = ref([])

const promptSkillPickerVisible = ref(false)
const promptMcpPickerVisible = ref(false)
const promptToolPickerVisible = ref(false)
const promptSkillQuery = ref('')
const promptMcpQuery = ref('')
const promptToolQuery = ref('')
const promptAllSkills = ref([])
const promptAllMcps = ref([])
const promptAllTools = ref([])

const filteredPromptSkills = computed(() => {
  const q = promptSkillQuery.value.trim().toLowerCase()
  return q ? promptAllSkills.value.filter(s => s.name.toLowerCase().includes(q) || (s.description || '').toLowerCase().includes(q)) : promptAllSkills.value
})
const filteredPromptMcps = computed(() => {
  const q = promptMcpQuery.value.trim().toLowerCase()
  return q ? promptAllMcps.value.filter(m => m.name.toLowerCase().includes(q) || (m.description || '').toLowerCase().includes(q)) : promptAllMcps.value
})
const filteredPromptTools = computed(() => {
  const q = promptToolQuery.value.trim().toLowerCase()
  return q ? promptAllTools.value.filter(t => t.name.toLowerCase().includes(q) || (t.description || '').toLowerCase().includes(q)) : promptAllTools.value
})

// 编辑状态：为空字符串表示新建模式，否则为正在编辑的任务 ID
const editingTaskId = ref('')

// 操作状态
const creating = ref(false)
const createResult = ref(null)
const syncing = ref(false)
const syncResult = ref(null)
// 正在执行删除/启停操作的任务 ID，防止重复点击
const busyTaskId = ref('')

// ========== 计算属性 ==========

// 表单是否有效
const isFormValid = computed(() => {
  return (
    newTask.name.trim() !== '' &&
    (newTask.prompt.trim() !== '' || promptSkills.value.length > 0 || promptMcps.value.length > 0 || promptTools.value.length > 0) &&
    newTask.datetime !== ''
  )
})

// ========== 方法 ==========

/**
 * 获取默认日期时间（当前时间 + 1 小时，取整到最近的 5 分钟）
 */
function getDefaultDatetime() {
  const now = new Date()
  now.setHours(now.getHours() + 1)
  now.setMinutes(Math.ceil(now.getMinutes() / 5) * 5, 0, 0)
  // 转换为 datetime-local 格式 "YYYY-MM-DDTHH:mm"
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  const hours = String(now.getHours()).padStart(2, '0')
  const minutes = String(now.getMinutes()).padStart(2, '0')
  return `${year}-${month}-${day}T${hours}:${minutes}`
}

async function loadPromptSkillOptions() {
  try {
    const list = await window.electronAPI?.skills?.list?.() || []
    promptAllSkills.value = list.filter(s => s && s.id && s.enabled !== false).map(s => ({
      id: s.id, name: s.name || s.id, description: s.description || '', instructions: s.instructions || ''
    }))
  } catch { promptAllSkills.value = [] }
}

async function loadPromptMcpOptions() {
  try {
    const list = await window.electronAPI?.mcp?.list?.() || []
    promptAllMcps.value = list.filter(m => m && m.id && m.enabled !== false).map(m => ({
      id: m.id, name: m.name || m.id, description: m.description || ''
    }))
  } catch { promptAllMcps.value = [] }
}

async function loadPromptToolOptions() {
  const builtins = (aiTools || []).map(t => ({
    id: t.function?.name || '',
    name: t.function?.name || '',
    description: t.function?.description || ''
  })).filter(t => t.id)
  let customs = []
  try {
    const list = await window.electronAPI?.customTools?.list?.() || []
    customs = list.filter(t => t && t.id).map(t => ({ id: t.id, name: t.name || t.id, description: t.description || '' }))
  } catch { customs = [] }
  promptAllTools.value = [...builtins, ...customs]
}

function closePromptPickers() {
  promptSkillPickerVisible.value = false
  promptMcpPickerVisible.value = false
  promptToolPickerVisible.value = false
}

function onPromptInput() {
  const value = newTask.prompt || ''
  const atIdx = value.lastIndexOf('@')
  const hashIdx = value.lastIndexOf('#')
  const slashIdx = value.lastIndexOf('/')
  const latest = Math.max(atIdx, hashIdx, slashIdx)
  const trigger = latest === atIdx ? '@' : latest === hashIdx ? '#' : latest === slashIdx ? '/' : ''
  closePromptPickers()
  if (!trigger) return
  const query = value.slice(latest + 1)
  if (query.includes(' ')) return
  if (trigger === '@') {
    promptSkillQuery.value = query
    promptSkillPickerVisible.value = true
    loadPromptSkillOptions()
  } else if (trigger === '#') {
    promptMcpQuery.value = query
    promptMcpPickerVisible.value = true
    loadPromptMcpOptions()
  } else {
    promptToolQuery.value = query
    promptToolPickerVisible.value = true
    loadPromptToolOptions()
  }
}

function removeTriggerToken(trigger) {
  const value = newTask.prompt || ''
  const idx = value.lastIndexOf(trigger)
  if (idx >= 0) newTask.prompt = value.slice(0, idx).trimEnd()
}

function selectPromptSkill(s) {
  if (!promptSkills.value.some(x => x.id === s.id)) promptSkills.value.push(s)
  removeTriggerToken('@')
  closePromptPickers()
}

function selectPromptMcp(m) {
  if (!promptMcps.value.some(x => x.id === m.id)) promptMcps.value.push(m)
  removeTriggerToken('#')
  closePromptPickers()
}

function selectPromptTool(t) {
  if (!promptTools.value.some(x => x.id === t.id)) promptTools.value.push(t)
  removeTriggerToken('/')
  closePromptPickers()
}

function removePromptSkill(i) { promptSkills.value.splice(i, 1) }
function removePromptMcp(i) { promptMcps.value.splice(i, 1) }
function removePromptTool(i) { promptTools.value.splice(i, 1) }

function buildTaskPrompt() {
  const parts = [newTask.prompt.trim()]
  if (promptSkills.value.length) parts.push(`【已选用 Skill】\n${promptSkills.value.map(s => `@${s.name}（id=${s.id}）\n${s.instructions || ''}`).join('\n\n')}`)
  if (promptMcps.value.length) parts.push(`【已选择的 MCP 服务】\n${promptMcps.value.map(m => `#${m.name}${m.description ? '：' + m.description : ''}`).join('\n')}`)
  if (promptTools.value.length) parts.push(`【已引用工具】\n${promptTools.value.map(t => `/${t.name}${t.description ? '：' + t.description : ''}`).join('\n')}`)
  return parts.filter(Boolean).join('\n')
}

/**
 * 加载所有任务
 * 对存储数据做防御性校验：格式异常时清空列表而不是阻塞界面
 */
async function loadTasks() {
  if (!apiAvailable.value) return
  loadingTasks.value = true
  try {
    const stored = await taskSchedulerService.getAll()
    const list = stored && typeof stored === 'object' ? Object.values(stored) : []
    tasks.value = list
      .filter(t => t && t.taskId)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
  } catch (err) {
    console.error('[定时任务] 加载任务失败:', err)
    tasks.value = []
  } finally {
    loadingTasks.value = false
  }
}

/**
 * 重置表单为新建默认值，并退出编辑模式
 */
function resetForm() {
  editingTaskId.value = ''
  newTask.name = ''
  newTask.prompt = ''
  newTask.cycle = 'once'
  newTask.datetime = getDefaultDatetime()
  newTask.enabled = true
  promptSkills.value = []
  promptMcps.value = []
  promptTools.value = []
}

/**
 * 进入编辑模式：把任务数据载入表单
 */
function editTask(task) {
  if (busyTaskId.value) return
  editingTaskId.value = task.taskId
  newTask.name = task.name || ''
  newTask.prompt = task.prompt || ''
  newTask.cycle = task.cycle || 'once'
  // datetime-local 输入框要求 "YYYY-MM-DDTHH:mm"，存储值可能是 "YYYY-MM-DD HH:mm"
  const dt = String(task.datetime || '').replace(' ', 'T')
  const m = dt.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/)
  newTask.datetime = m ? m[0] : getDefaultDatetime()
  newTask.enabled = task.enabled !== false
  promptSkills.value = []
  promptMcps.value = []
  promptTools.value = []
  createResult.value = null
  // 表单在面板顶部，滚动上去方便用户直接修改
  document.querySelector('.ts-body')?.scrollTo({ top: 0, behavior: 'smooth' })
}

/**
 * 取消编辑，回到新建模式
 */
function cancelEdit() {
  resetForm()
  createResult.value = null
}

/**
 * 保存任务：editingTaskId 存在时更新，否则新建
 */
async function saveTask() {
  if (!isFormValid.value) return
  creating.value = true
  createResult.value = null
  const isEdit = !!editingTaskId.value
  const payload = {
    name: newTask.name.trim(),
    prompt: buildTaskPrompt(),
    datetime: newTask.datetime,
    cycle: newTask.cycle,
    enabled: newTask.enabled
  }
  try {
    const result = isEdit
      ? await taskSchedulerService.update({ ...payload, taskId: editingTaskId.value })
      : await taskSchedulerService.create(payload)
    if (result.success) {
      createResult.value = { success: true, message: isEdit ? '任务已更新' : '任务创建成功' }
      panelLog('info', `${isEdit ? '更新' : '创建'}任务「${payload.name}」成功（${cycleLabel(payload.cycle)} ${payload.datetime}）`)
      resetForm()
      await loadTasks()
    } else {
      const action = isEdit ? '更新' : '创建'
      createResult.value = { success: false, message: `${action}失败: ${briefError(result.error)}` }
      panelLog('error', `${action}任务「${payload.name}」失败: ${briefError(result.error)}`)
    }
    // 5 秒后清除提示（失败信息较长，停留久一点便于阅读）
    setTimeout(() => { createResult.value = null }, 5000)
  } catch (err) {
    const action = isEdit ? '更新' : '创建'
    console.error(`[定时任务] ${action}失败:`, err)
    createResult.value = { success: false, message: `${action}失败: ${briefError(err.message)}` }
    panelLog('error', `${action}任务「${payload.name}」失败: ${briefError(err.message)}`)
  } finally {
    creating.value = false
  }
}

/**
 * 截断过长的错误信息（schtasks 报错可能包含整条命令行）
 */
function briefError(msg) {
  const s = String(msg || '未知错误')
  return s.length > 160 ? s.slice(0, 160) + '…' : s
}

/**
 * 删除任务
 * 注意：禁用原生 confirm()/alert()——它们在 Electron 渲染进程中运行嵌套原生消息循环，
 * 对话框一旦被弹到窗口后面（或与 DevTools 冲突），整个渲染进程会永久阻塞，
 * 表现为界面卡死且"软重启"按钮也无法响应。一律改用页面内异步组件 ElMessageBox/ElMessage。
 */
async function deleteTask(task) {
  if (busyTaskId.value) return
  try {
    await ElMessageBox.confirm(`确定要删除任务"${task.name}"吗？`, '删除确认', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning'
    })
  } catch {
    return
  }
  busyTaskId.value = task.taskId
  try {
    const result = await taskSchedulerService.delete(task.taskId)
    if (result && result.success === false) {
      ElMessage.error('删除失败: ' + (result.error || '未知错误'))
      panelLog('error', `删除任务「${task.name}」失败: ${result.error || '未知错误'}`)
    } else {
      ElMessage.success('任务已删除')
      panelLog('info', `删除任务「${task.name}」成功`)
      if (editingTaskId.value === task.taskId) resetForm()
      await loadTasks()
    }
  } catch (err) {
    console.error('[定时任务] 删除失败:', err)
    ElMessage.error('删除失败: ' + err.message)
    panelLog('error', `删除任务「${task.name}」失败: ${err.message}`)
  } finally {
    busyTaskId.value = ''
  }
}

/**
 * 切换任务启用/禁用状态
 */
async function toggleTask(task) {
  if (busyTaskId.value) return
  busyTaskId.value = task.taskId
  try {
    const updated = { ...task, enabled: !task.enabled }
    const result = await taskSchedulerService.update(updated)
    if (result.success) {
      panelLog('info', `任务「${task.name}」已${updated.enabled ? '启用' : '暂停'}`)
      await loadTasks()
    } else {
      ElMessage.error('更新失败: ' + (result.error || '未知错误'))
      panelLog('error', `任务「${task.name}」启停失败: ${result.error || '未知错误'}`)
    }
  } catch (err) {
    console.error('[定时任务] 切换状态失败:', err)
    ElMessage.error('更新失败: ' + err.message)
    panelLog('error', `任务「${task.name}」启停失败: ${err.message}`)
  } finally {
    busyTaskId.value = ''
  }
}

/**
 * 同步本地任务到 Windows Task Scheduler
 */
async function syncTasks() {
  syncing.value = true
  syncResult.value = null
  try {
    const result = await taskSchedulerService.syncAll(tasks.value)
    if (result.success) {
      syncResult.value = {
        success: true,
        message: `同步完成：创建 ${result.created} 个，删除 ${result.deleted} 个`
      }
      panelLog('info', `同步 Windows 计划程序完成：创建 ${result.created} 个，删除 ${result.deleted} 个`)
    } else {
      const failedText = result.failed ? `${result.failed} 个任务失败：` : ''
      syncResult.value = {
        success: false,
        message: `同步失败：${failedText}${result.error || '未知错误'}`
      }
      panelLog('error', `同步 Windows 计划程序失败：${failedText}${result.error || '未知错误'}`)
    }
    setTimeout(() => { syncResult.value = null }, 6000)
  } catch (err) {
    console.error('[定时任务] 同步失败:', err)
    syncResult.value = { success: false, message: `同步失败: ${err.message}` }
    panelLog('error', `同步 Windows 计划程序失败: ${err.message}`)
  } finally {
    syncing.value = false
  }
}

/**
 * 周期标签
 */
function cycleLabel(cycle) {
  const labels = {
    once: '一次',
    daily: '每日',
    weekly: '每周',
    monthly: '每月'
  }
  return labels[cycle] || cycle
}

/**
 * 截断文本
 */
function truncateText(text, maxLen) {
  if (!text) return ''
  return text.length > maxLen ? text.substring(0, maxLen) + '...' : text
}

/**
 * 格式化日期时间显示
 */
function formatDatetime(dt) {
  if (!dt) return '未设置'
  // 兼容 "YYYY-MM-DDTHH:mm" 和 "YYYY-MM-DD HH:mm" 格式
  const normalized = String(dt).replace('T', ' ')
  const m = normalized.match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/)
  if (!m) return normalized
  return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}`
}

/**
 * 计算任务的下次执行时间
 * 与 electron/ipc/taskScheduler.js 的 schtasks 参数保持一致：
 * once=daily 一次/每天 HH:mm；weekly 固定周一；monthly 每月 day 日
 */
function getNextRunTime(task) {
  if (!task.datetime) return null
  const normalized = String(task.datetime).replace('T', ' ')
  const m = normalized.match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/)
  if (!m) return null
  const hh = parseInt(m[4], 10)
  const mm = parseInt(m[5], 10)
  const day = parseInt(m[3], 10)
  const now = new Date()

  const withTime = (d) => {
    const r = new Date(d.getFullYear(), d.getMonth(), d.getDate(), hh, mm, 0, 0)
    return r
  }

  if (task.cycle === 'once') {
    const scheduled = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, day, hh, mm, 0, 0)
    return scheduled > now ? scheduled : null
  }

  if (task.cycle === 'daily') {
    let next = withTime(now)
    if (next <= now) next = new Date(next.getTime() + 24 * 3600 * 1000)
    return next
  }

  if (task.cycle === 'weekly') {
    // schtasks /d MON：每周一执行
    let next = withTime(now)
    const weekday = next.getDay() // 0=周日
    let diff = (1 - weekday + 7) % 7
    if (diff === 0 && next <= now) diff = 7
    next = new Date(next.getTime() + diff * 24 * 3600 * 1000)
    return next
  }

  if (task.cycle === 'monthly') {
    const daysIn = (y, mo) => new Date(y, mo + 1, 0).getDate()
    let next = new Date(now.getFullYear(), now.getMonth(), Math.min(day, daysIn(now.getFullYear(), now.getMonth())), hh, mm, 0, 0)
    if (next <= now) {
      const y = now.getFullYear()
      const mo = now.getMonth() + 1
      next = new Date(y, mo, Math.min(day, daysIn(y, mo)), hh, mm, 0, 0)
    }
    return next
  }

  return null
}

/**
 * 下次执行时间的显示文本
 */
function getNextRunText(task) {
  if (!task.enabled) return ''
  const next = getNextRunTime(task)
  if (!next) return '已过期'
  const p = (n) => String(n).padStart(2, '0')
  return `${next.getFullYear()}-${p(next.getMonth() + 1)}-${p(next.getDate())} ${p(next.getHours())}:${p(next.getMinutes())}`
}

// 注意：定时任务触发监听仅在 App.vue 常驻注册一处。
// 此处不再重复注册，否则面板打开时同一次触发会被消费两次（AI 双倍执行、双倍扣费）。

// ========== 生命周期 ==========

watch(
  () => props.visible,
  (newVal) => {
    if (newVal) {
      // 面板打开时刷新任务列表
      apiAvailable.value = taskSchedulerService.isAvailable()
      loadTasks()
    } else {
      // 面板关闭时退出编辑模式，避免下次打开残留旧数据
      resetForm()
      createResult.value = null
    }
  }
)

onMounted(() => {
  if (props.visible) {
    loadTasks()
  }
})
</script>

<style scoped>
.task-scheduler-panel {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  /* 日志覆盖层（PanelRunLog）以此为定位基准 */
  position: relative;
  background-color: var(--ai-panel-bg);
  -webkit-backdrop-filter: var(--blur-amount) var(--blur-saturate);
  backdrop-filter: var(--blur-amount) var(--blur-saturate);
  border-left: 1px solid var(--border-color);
}

/* ========== Header ========== */
.ts-header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-color);
}

.ts-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
}

.ts-header-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.ts-log-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  background: transparent;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  font-size: 12px;
  color: var(--text-secondary);
  cursor: pointer;
  transition: background-color var(--transition-fast), color var(--transition-fast);
}

.ts-log-btn:hover {
  background: rgba(0, 0, 0, 0.06);
  color: var(--text-primary);
}

.ts-log-btn.active {
  background: rgba(0, 122, 255, 0.1);
  color: #007aff;
  border-color: rgba(0, 122, 255, 0.3);
}

.ts-close {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  font-size: 14px;
  color: var(--text-secondary);
  cursor: pointer;
  border-radius: 6px;
  transition: background-color var(--transition-fast), color var(--transition-fast);
}

.ts-close:hover {
  background: rgba(0, 0, 0, 0.06);
  color: var(--text-primary);
}

/* ========== Body ========== */
.ts-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* ========== Section ========== */
.ts-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
  background-color: var(--card-bg);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
}

.section-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  display: flex;
  align-items: center;
  gap: 4px;
}

.task-count {
  font-size: 12px;
  font-weight: 400;
  color: var(--text-secondary);
}

.editing-badge {
  padding: 1px 8px;
  font-size: 11px;
  font-weight: 500;
  color: var(--apple-orange, #ff9500);
  background-color: rgba(255, 149, 0, 0.1);
  border-radius: var(--radius-full);
}

.sync-hint {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.6;
  margin: 0 0 10px 0;
}

/* ========== Browser Mode Warning ========== */
.browser-mode-warning {
  padding: 10px 12px;
  font-size: 12px;
  color: #856404;
  background-color: rgba(255, 193, 7, 0.1);
  border: 1px solid rgba(255, 193, 7, 0.2);
  border-radius: var(--radius-sm);
  line-height: 1.5;
}

.browser-mode-warning code {
  padding: 1px 4px;
  background-color: rgba(0, 0, 0, 0.06);
  border-radius: 3px;
  font-family: monospace;
  font-size: 11px;
}

/* ========== Form ========== */
.form-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.form-row.form-row-column {
  flex-direction: column;
  align-items: stretch;
  gap: 6px;
}

.form-row label {
  flex-shrink: 0;
  width: 70px;
  font-size: 13px;
  color: var(--text-secondary);
  font-family: var(--font-family);
}

.form-input {
  flex: 1;
  min-width: 0;
  height: 32px;
  padding: 0 10px;
  font-size: 13px;
  font-family: var(--font-family);
  color: var(--text-primary);
  background-color: var(--input-bg);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  outline: none;
  transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
}

.form-input:focus {
  border-color: var(--apple-blue);
  box-shadow: var(--focus-ring);
}

textarea.form-input,
.form-textarea {
  height: auto;
  min-height: 60px;
  padding: 8px 10px;
  line-height: 1.5;
  resize: vertical;
}

select.form-input {
  cursor: pointer;
  -webkit-appearance: none;
  -moz-appearance: none;
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath fill='%2386868B' d='M0 0l5 6 5-6z'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 10px center;
  padding-right: 28px;
}

/* datetime-local 样式调整 */
input[type="datetime-local"].form-input {
  font-family: var(--font-family);
}

/* ========== Form Actions ========== */
.form-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 4px;
}

.enable-toggle {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 13px;
  color: var(--text-secondary);
  cursor: pointer;
  font-family: var(--font-family);
}

.enable-toggle input[type="checkbox"] {
  width: 16px;
  height: 16px;
  accent-color: var(--apple-blue);
  cursor: pointer;
}

/* ========== Buttons ========== */
.btn-primary {
  height: 32px;
  padding: 0 16px;
  font-size: 13px;
  font-family: var(--font-family);
  background-color: var(--apple-blue);
  color: #fff;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background-color var(--transition-fast), transform var(--transition-fast);
}

.btn-primary:hover {
  background-color: #0066d6;
}

.btn-primary:active {
  transform: scale(0.97);
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-secondary {
  height: 32px;
  padding: 0 16px;
  font-size: 13px;
  font-family: var(--font-family);
  background-color: rgba(0, 0, 0, 0.06);
  color: var(--text-primary);
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background-color var(--transition-fast), transform var(--transition-fast);
}

.btn-secondary:hover {
  background-color: rgba(0, 0, 0, 0.1);
}

.btn-secondary:active {
  transform: scale(0.97);
}

.btn-secondary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-full {
  width: 100%;
}

.btn-small {
  flex-shrink: 0;
  height: 28px;
  padding: 0 10px;
  font-size: 12px;
  font-family: var(--font-family);
  background-color: rgba(0, 0, 0, 0.05);
  color: var(--text-secondary);
  border: none;
  border-radius: var(--radius-full);
  cursor: pointer;
  transition: background-color var(--transition-fast), color var(--transition-fast), transform var(--transition-fast);
}

.btn-small:hover {
  background-color: rgba(0, 0, 0, 0.08);
  color: var(--text-primary);
}

.btn-small:active {
  transform: scale(0.96);
}

.btn-small:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
}

.btn-toggle-on {
  color: var(--apple-green);
}

.btn-toggle-on:hover {
  background-color: rgba(52, 199, 89, 0.1);
  color: var(--apple-green);
}

.btn-edit {
  color: var(--apple-blue);
}

.btn-edit:hover {
  background-color: rgba(0, 122, 255, 0.1);
  color: var(--apple-blue);
}

.btn-danger {
  color: var(--apple-red);
}

.btn-danger:hover {
  background-color: rgba(255, 59, 48, 0.08);
  color: var(--apple-red);
}

/* ========== Result Message ========== */
.result-message {
  padding: 8px 12px;
  font-size: 12px;
  font-family: var(--font-family);
  border-radius: var(--radius-sm);
  line-height: 1.5;
  animation: msg-fade-in var(--transition-standard);
}

.result-message.success {
  background-color: rgba(52, 199, 89, 0.08);
  color: var(--apple-green);
}

.result-message.error {
  background-color: rgba(255, 59, 48, 0.08);
  color: var(--apple-red);
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

/* ========== Empty State ========== */
.empty-state {
  padding: 24px 12px;
  text-align: center;
  font-size: 13px;
  color: var(--text-tertiary);
}

/* ========== Task Card ========== */
.task-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px;
  background: rgba(0, 0, 0, 0.02);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  transition: opacity var(--transition-fast), background-color var(--transition-fast);
}

.task-card:hover {
  background: rgba(0, 0, 0, 0.04);
}

.task-card.disabled {
  opacity: 0.5;
}

.task-card.editing {
  opacity: 1;
  border-color: var(--apple-orange, #ff9500);
  background-color: rgba(255, 149, 0, 0.05);
}

.task-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.task-name {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-badge {
  flex-shrink: 0;
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 500;
  color: var(--text-secondary);
  background-color: rgba(0, 0, 0, 0.06);
  border-radius: var(--radius-full);
}

.task-badge.daily {
  color: var(--apple-blue);
  background-color: rgba(0, 122, 255, 0.1);
}

.task-badge.weekly {
  color: var(--apple-purple);
  background-color: rgba(175, 82, 222, 0.1);
}

.task-badge.monthly {
  color: var(--apple-orange);
  background-color: rgba(255, 149, 0, 0.1);
}

.task-badge.once {
  color: var(--text-secondary);
  background-color: rgba(0, 0, 0, 0.06);
}

.task-prompt {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.task-next-run {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-family: var(--font-family);
  color: var(--apple-blue);
  background-color: rgba(0, 122, 255, 0.08);
  padding: 3px 8px;
  border-radius: var(--radius-full);
  align-self: flex-start;
}

.task-next-run.expired {
  color: var(--apple-orange, #ff9500);
  background-color: rgba(255, 149, 0, 0.1);
}

.task-card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.task-datetime {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--text-tertiary);
  font-family: var(--font-family);
}

.task-icon-svg {
  flex-shrink: 0;
}

.task-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

.ts-mention-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

.ts-mention-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  background: rgba(0, 122, 255, 0.1);
  color: var(--apple-blue);
  border-radius: 999px;
  font-size: 12px;
}

.ts-mention-remove {
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
}

.ts-mention-picker {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 8px;
  padding: 8px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  background: #fff;
  max-height: 220px;
  overflow-y: auto;
}

.ts-mention-title {
  font-size: 11px;
  color: var(--text-tertiary);
}

.ts-mention-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 6px 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  text-align: left;
  color: var(--text-primary);
  cursor: pointer;
}

.ts-mention-item:hover {
  background: rgba(0, 122, 255, 0.08);
}

.ts-mention-item span {
  font-size: 11px;
  color: var(--text-tertiary);
}
</style>

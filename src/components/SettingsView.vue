<template>
  <div class="settings-view">
    <div class="settings-layout">
      <nav class="settings-toc">
        <ul>
          <li
            v-for="s in tocSections"
            :key="s.id"
            :class="{ active: s.id === activeSection }"
            @click="scrollToSection(s.id)"
          >
            {{ s.label }}
          </li>
        </ul>
      </nav>
      <div class="settings-content">
    <!-- 模型提供商预设 -->
    <div id="sec-ai-config" class="settings-section">
      <h3>AI 模型配置</h3>

      <!-- 配置档管理（基础大模型） -->
      <div class="profile-bar">
        <el-select
          v-model="activeProfileId"
          placeholder="选择配置档"
          class="profile-select"
          @change="onProfileSwitch"
        >
          <el-option
            v-for="p in baseProfiles"
            :key="p.id"
            :label="p.name || '未命名'"
            :value="p.id"
          />
        </el-select>
        <el-button size="small" @click="addProfile">新增</el-button>
        <el-button
          size="small"
          :disabled="baseProfiles.length <= 1"
          @click="deleteActiveProfile"
        >删除</el-button>
      </div>

      <!-- 当前配置档编辑 -->
      <el-form v-if="activeProfile" label-position="top" class="settings-form">
        <el-form-item label="配置档名称">
          <el-input v-model="activeProfile.name" placeholder="如：OpenAI、DeepSeek、中转站" />
        </el-form-item>

        <el-form-item label="API 地址 (Base URL)">
          <el-select
            v-model="selectedProvider"
            placeholder="快速选择 API 服务商（可选）"
            class="provider-preset-select"
            @change="selectProvider"
          >
            <el-option
              v-for="p in presetOptions"
              :key="p.id"
              :label="p.name"
              :value="p.id"
            />
          </el-select>
          <div v-if="selectedProvider === 'openai_proxy'" class="proxy-hint">
            <span>填写中转站、代理商或模型供应商的 OpenAI 兼容 API 地址。</span>
            <span class="proxy-example">示例：https://api.your-proxy.com 或 https://relay.example.com/v1</span>
          </div>
          <div class="url-input-row">
            <el-input
              v-model="activeProfile.baseURL"
              :placeholder="baseURLPlaceholder"
              @blur="onBaseURLBlur"
            />
            <el-tooltip
              content="开启：自动补全 /v1/chat/completions 等后缀；关闭：按填写的地址原样请求（适配自带独立后缀的厂商）"
              placement="top"
            >
              <div class="url-switch">
                <span class="url-switch-label">补全</span>
                <el-switch v-model="activeProfile.autoComplete" size="small" />
              </div>
            </el-tooltip>
          </div>
        </el-form-item>
        <el-form-item label="API Key">
          <el-input
            v-model="activeProfile.apiKey"
            type="password"
            show-password
            placeholder="sk-..."
          />
        </el-form-item>
        <el-form-item label="模型名称">
          <el-select
            v-model="activeProfile.model"
            filterable
            allow-create
            placeholder="选择或输入模型名称"
            :loading="fetchingModels"
            @visible-change="onModelDropdownVisible"
          >
            <el-option
              v-for="m in allModels"
              :key="m"
              :label="m"
              :value="m"
            />
          </el-select>
          <div v-if="fetchedModels.length > 0" class="model-hint">
            已检测到 {{ fetchedModels.length }} 个可用模型
          </div>
          <div v-else-if="!fetchingModels && activeProfile.baseURL" class="model-hint manual-hint">
            未自动检测到模型列表，可直接输入模型名称（如 gpt-4o、deepseek-chat 等）
          </div>
        </el-form-item>
      </el-form>
      <div v-else class="profile-empty">请先新增一个配置档</div>

      <div class="settings-actions">
        <el-button @click="testConnection" :loading="testing">测试连接</el-button>
        <el-button type="primary" @click="saveConfig('base')">保存配置</el-button>
      </div>

      <!-- 测试结果 -->
      <div
        v-if="testResult"
        :class="['test-result', testResult.success ? 'success' : 'error']"
      >
        {{ testResult.message }}
      </div>
    </div>

    <!-- AI temperature 设置 -->
    <div id="sec-temperature" class="settings-section">
      <h3>AI temperature 设置</h3>
      <p class="vision-desc">
        temperature 控制生成结果的随机性：数值越低回答越稳定、越贴近事实；数值越高越有创造性、发散性。
      </p>
      <div class="temperature-row">
        <el-slider
          v-model="temperature"
          :min="0"
          :max="2"
          :step="0.1"
          :show-tooltip="true"
          style="flex: 1;"
        />
        <span class="temperature-value">{{ temperature.toFixed(1) }}</span>
      </div>
      <div class="settings-actions" style="margin-top: 8px;">
        <el-button type="primary" @click="saveTemperature">保存 temperature</el-button>
      </div>
    </div>

    <!-- 多模态（视觉）识别配置 -->
    <div id="sec-vision" class="settings-section">
      <h3>多模态识别（扫描版 PDF / 图片）</h3>
      <p class="vision-desc">
        识别扫描版 PDF 或图片文字时，优先使用多模态大模型（更快更准）；未开启或失败时自动降级为本地 OCR。
        多模态使用下方独立配置档（独立 API 地址 / Key / 模型），与上方基础大模型配置互不影响。
      </p>

      <div class="vision-row">
        <span class="vision-row-label">启用多模态识别</span>
        <el-switch v-model="visionConfig.enabled" @change="onVisionEnabledChange" />
      </div>

      <template v-if="visionConfig.enabled">
        <!-- 多模态配置档管理（与基础配置档保存在同一列表，此处仅显示多模态档） -->
        <div class="profile-bar">
          <el-select
            v-model="visionConfig.activeProfileId"
            placeholder="选择多模态配置档"
            class="profile-select"
          >
            <el-option
              v-for="p in visionProfiles"
              :key="p.id"
              :label="(p.name || '未命名') + '（多模态）'"
              :value="p.id"
            >
              <span class="vision-opt-name">{{ p.name || '未命名' }}</span>
              <span class="vision-opt-tag">多模态</span>
            </el-option>
          </el-select>
          <el-button size="small" @click="addVisionProfile">新增</el-button>
          <el-button
            size="small"
            :disabled="visionProfiles.length <= 1"
            @click="deleteActiveVisionProfile"
          >删除</el-button>
        </div>

        <!-- 当前多模态配置档编辑（独立输入框） -->
        <el-form v-if="activeVisionProfile" label-position="top" class="settings-form vision-form">
          <el-form-item label="配置档名称">
            <el-input v-model="activeVisionProfile.name" placeholder="如：Qwen-VL、GLM-4V、GPT-4o" />
          </el-form-item>
          <el-form-item label="API 地址 (Base URL)">
            <div class="url-input-row">
              <el-input
                v-model="activeVisionProfile.baseURL"
                placeholder="留空则沿用基础模型的 API 地址"
                @blur="onVisionBaseURLBlur"
              />
              <el-tooltip
                content="开启：自动补全 /v1/chat/completions 等后缀；关闭：按填写的地址原样请求（适配自带独立后缀的厂商）"
                placement="top"
              >
                <div class="url-switch">
                  <span class="url-switch-label">补全</span>
                  <el-switch v-model="activeVisionProfile.autoComplete" size="small" />
                </div>
              </el-tooltip>
            </div>
            <div v-if="!activeVisionProfile.baseURL && activeProfile && activeProfile.baseURL" class="inherit-hint">
              将沿用基础模型的地址：{{ activeProfile.baseURL }}（含补全开关设置）
            </div>
          </el-form-item>
          <el-form-item label="API Key">
            <el-input
              v-model="activeVisionProfile.apiKey"
              type="password"
              show-password
              placeholder="留空则沿用基础模型的 API Key"
            />
            <div v-if="!activeVisionProfile.apiKey && activeProfile && activeProfile.apiKey" class="inherit-hint">
              将沿用基础模型的 API Key
            </div>
          </el-form-item>
          <el-form-item label="多模态模型名称">
            <div class="vision-model-row">
              <el-select
                v-model="activeVisionProfile.model"
                filterable
                allow-create
                placeholder="先检测再选择，或手动输入"
                class="vision-model-select"
                @visible-change="onVisionDropdownOpen"
              >
                <el-option v-for="m in visionModelOptions" :key="m" :label="m" :value="m">
                  <span class="vision-opt-name">{{ m }}</span>
                  <span v-if="isModelRetired(m)" class="vision-opt-tag tag-retired">已下线</span>
                  <span v-else-if="isVisionByAPI(m)" class="vision-opt-tag">多模态·接口标识</span>
                  <span v-else-if="isVisionModel(m)" class="vision-opt-tag tag-rule">多模态·内置规则</span>
                </el-option>
              </el-select>
              <el-button :loading="detectingVision" @click="detectVisionModels">检测模型</el-button>
              <el-button :loading="testingVision" @click="testCurrentVisionModel">测试识图</el-button>
            </div>
            <div v-if="visionFetchedModels.length > 0" class="model-hint">
              已检测到 {{ visionFetchedModels.length }} 个模型，其中 {{ visionMatchedCount }} 个支持多模态（多模态模型已置顶；「接口标识」来自服务商元数据，「内置规则」为跨平台知识库识别）
            </div>
            <div v-else-if="!detectingVision && activeVisionProfile.baseURL" class="model-hint manual-hint">
              未检测模型列表时可直接输入模型名称（如 qwen-vl-max、glm-4v-plus、gpt-4o），输入后可点「测试识图」验证可用性
            </div>
          </el-form-item>
        </el-form>
        <div v-else class="profile-empty">请先新增一个多模态配置档</div>

        <!-- 多模态配置专属保存按钮（保存整个配置，但主要目的是提交当前多模态档的修改） -->
        <div class="settings-actions">
          <el-button type="primary" @click="saveVisionConfig">保存多模态配置</el-button>
        </div>
      </template>

      <p class="vision-tip">
        说明：多模态配置档与基础配置档保存在同一列表中（标有「多模态」），仅用于图片 / 扫描件识别，不影响 AI 对话所用的基础大模型。
      </p>
    </div>

    <!-- AI 安全与记忆 -->
    <div id="sec-safety" class="settings-section">
      <h3>AI 安全与记忆</h3>

      <!-- 信任模式 -->
      <div class="safety-block trust-block">
        <div class="trust-header">
          <div>
            <div class="safety-block-title">信任模式</div>
            <p class="safety-block-desc">开启后，所有危险操作（删除/外发/覆盖等）将直接执行，不再弹窗确认。对话窗口和设置面板任一开启即全局生效。</p>
          </div>
          <label class="switch" title="切换信任模式">
            <input type="checkbox" v-model="trustMode" @change="onTrustModeChange" />
            <span class="switch-slider"></span>
          </label>
        </div>
      </div>

      <!-- 危险操作白名单 -->
      <div class="safety-block">
        <div class="safety-block-title">危险操作白名单</div>
        <p class="safety-block-desc">
          白名单内的工具执行时不再弹窗确认。勾选确认弹窗中的"不再确认此工具"即可加入。
        </p>
        <div v-if="whitelist.length === 0" class="safety-empty">暂无白名单工具，所有危险操作都会先弹窗确认</div>
        <div v-else class="whitelist-list">
          <div v-for="name in whitelist" :key="name" class="whitelist-item">
              <span class="whitelist-name">{{ displayNameOf(name) }}</span>
              <span class="whitelist-key">{{ name }}</span>
              <button class="whitelist-remove" @click="removeFromWhitelist(name)">移除</button>
            </div>
        </div>
      </div>

      <!-- AI 长期记忆 -->
      <div class="safety-block">
        <div class="safety-block-title">AI 长期记忆</div>
        <p class="safety-block-desc">
          AI 通过"记住…"指令保存的跨会话记忆，每次对话自动生效。
        </p>
        <div v-if="memoryFacts.length === 0" class="safety-empty">暂无长期记忆</div>
        <template v-else>
          <div class="whitelist-list">
            <div v-for="fact in memoryFacts" :key="fact.id" class="whitelist-item">
              <el-tooltip placement="top" :show-after="250">
                <span class="whitelist-name memory-fact-text">{{ fact.content }}</span>
                <template #content>
                  <div class="memory-tooltip-body">{{ fact.content }}</div>
                </template>
              </el-tooltip>
              <span class="whitelist-key">{{ fact.type }} · {{ fact.createdAt }}</span>
              <button class="whitelist-remove" @click="removeMemoryFactItem(fact.id)">删除</button>
            </div>
          </div>
          <el-button size="small" plain type="danger" class="clear-memory-btn" @click="clearAllMemory">
            清空全部记忆
          </el-button>
        </template>
      </div>
    </div>

    <!-- 系统 -->
    <div id="sec-system" class="settings-section">
      <h3>系统</h3>
      <div class="safety-block">
        <div class="auto-launch-row">
          <div class="auto-launch-info">
            <div class="safety-block-title">开机自启动</div>
            <p class="safety-block-desc">启用后，登录 Windows 时自动启动本应用（写入注册表启动项）。</p>
          </div>
          <el-switch
            v-model="autoLaunch"
            :loading="autoLaunchLoading"
            @change="onAutoLaunchChange"
          />
        </div>
      </div>
      <div class="safety-block">
        <div class="auto-launch-row">
          <div class="auto-launch-info">
            <div class="safety-block-title">默认保存目录</div>
            <p class="safety-block-desc">AI 创建导图、导出文件等操作默认保存到此目录。与左侧目录树的「设置保存位置」是同一个设置，数据互通。</p>
          </div>
          <div class="save-dir-controls">
            <el-input v-model="saveDir" class="save-dir-input" placeholder="默认保存目录" readonly />
            <el-button size="small" @click="selectSaveDir">选择目录</el-button>
            <el-button size="small" type="primary" :disabled="!saveDir" @click="applySaveDir">保存</el-button>
          </div>
        </div>
      </div>
      <div class="safety-block">
        <div class="auto-launch-row">
          <div class="auto-launch-info">
            <div class="safety-block-title">本地 HTTP 服务</div>
            <p class="safety-block-desc">开启后可通过浏览器或平板访问并操作当前主程序界面；访问需要输入 Token 鉴权，Token 有效期 60 天。</p>
          </div>
          <el-switch
            v-model="httpServerEnabled"
            :loading="httpServerLoading"
            @change="onHttpServerChange"
          />
        </div>
        <div v-if="httpServerStatus && httpServerStatus.running" class="http-server-info">
          <div v-for="addr in httpServerStatus.addresses" :key="addr" class="http-server-address">
            <span class="http-server-address-text">{{ addr }}</span>
            <el-button size="small" @click="copyText(addr)">复制地址</el-button>
          </div>
          <div class="http-server-token-row">
            <span class="http-server-token-label">Token</span>
            <code class="http-server-token">{{ httpServerStatus.token }}</code>
            <el-button size="small" @click="copyText(httpServerStatus.token)">复制 Token</el-button>
          </div>
          <div class="http-server-expire">
            Token 有效期至：{{ formatHttpTokenExpiry(httpServerStatus.tokenExpiresAt) }}
          </div>
          <div class="http-server-quality-row">
            <span class="http-server-token-label">画面质量</span>
            <el-select v-model="httpServerQuality" size="small" style="width: 120px" @change="onHttpServerQualityChange">
              <el-option label="流畅优先" value="low" />
              <el-option label="均衡" value="medium" />
              <el-option label="清晰优先" value="high" />
            </el-select>
          </div>
        </div>
      </div>
    </div>

    <!-- MCP 服务管理 -->
    <div id="sec-mcp" class="settings-section">
      <h3>MCP 服务</h3>
      <p class="vision-desc">可添加多个 MCP 服务，保存后 AI 可通过 mcp_call_tool 调用。当前优先支持 HTTP/SSE 服务；stdio 服务仅保存配置。</p>
      <div class="profile-bar">
        <el-button size="small" @click="showMcpForm = !showMcpForm">{{ showMcpForm ? '收起新增' : '新增 MCP' }}</el-button>
      </div>
      <el-form v-if="showMcpForm" label-position="top" class="settings-form">
        <el-form-item label="名称"><el-input v-model="newMcp.name" placeholder="如：文件服务" /></el-form-item>
        <el-form-item label="传输方式">
          <el-select v-model="newMcp.transport"><el-option label="HTTP/SSE" value="http" /><el-option label="stdio（暂仅保存）" value="stdio" /></el-select>
        </el-form-item>
        <el-form-item v-if="newMcp.transport === 'http'" label="URL"><el-input v-model="newMcp.url" placeholder="http://127.0.0.1:3000/mcp" /></el-form-item>
        <el-form-item v-else label="命令"><el-input v-model="newMcp.command" placeholder="npx" /></el-form-item>
        <el-button type="primary" size="small" @click="addMcp">保存新增</el-button>
      </el-form>
      <div v-for="s in mcpServers" :key="s.id" class="mcp-skill-row">
        <el-input v-model="s.name" class="mini" />
        <el-input v-if="s.transport === 'http'" v-model="s.url" class="mini" />
        <el-input v-else v-model="s.command" class="mini" />
        <el-switch v-model="s.enabled" size="small" />
        <el-button size="small" @click="saveMcp(s)">保存</el-button>
        <el-button size="small" @click="testMcp(s)">测试</el-button>
        <el-button size="small" type="danger" @click="removeMcp(s.id)">删除</el-button>
      </div>
    </div>

    <!-- Skills 管理 -->
    <div id="sec-skills" class="settings-section">
      <h3>Skills</h3>
      <p class="vision-desc">可维护多个技能。AI 可读取并执行技能指令；也可由 AI 根据对话沉淀为新技能。</p>
      <div class="profile-bar">
        <el-button size="small" @click="showSkillForm = !showSkillForm">{{ showSkillForm ? '收起新增' : '新增 Skill' }}</el-button>
      </div>
      <el-form v-if="showSkillForm" label-position="top" class="settings-form">
        <el-form-item label="名称"><el-input v-model="newSkill.name" /></el-form-item>
        <el-form-item label="描述"><el-input v-model="newSkill.description" /></el-form-item>
        <el-form-item label="指令"><el-input v-model="newSkill.instructions" type="textarea" :rows="4" /></el-form-item>
        <el-button type="primary" size="small" @click="addSkill">保存新增</el-button>
      </el-form>
      <div v-for="s in skills" :key="s.id" class="skill-row">
        <el-input v-model="s.name" class="mini" />
        <el-input v-model="s.description" class="mini" />
        <el-input v-model="s.instructions" type="textarea" :rows="2" class="grow" />
        <el-switch v-model="s.enabled" size="small" />
        <el-switch v-model="s.autoInvoke" size="small" title="自动调用" />
        <el-button size="small" @click="saveSkill(s)">保存</el-button>
        <el-button size="small" type="danger" @click="removeSkill(s.id)">删除</el-button>
      </div>
    </div>

    <!-- 三方集成：FeishuPanel 直接内嵌 -->
    <div id="sec-integrations" class="settings-section">
      <h3>三方集成</h3>
      <p style="color: var(--text-secondary); font-size: 13px; margin-bottom: 12px;">
        配置飞书、微信等第三方平台的连接与推送能力。
      </p>
      <FeishuPanel :embedded="true" :visible="true" />
    </div>

    <!-- 消息中心：第三方消息面板直接内嵌 -->
    <div id="sec-messages" class="settings-section">
      <h3>消息中心</h3>
      <p style="color: var(--text-secondary); font-size: 13px; margin-bottom: 12px;">
        来自微信端、飞书端、定时任务的第三方调用消息记录（独立上下文，不影响当前对话）。
      </p>
      <ThirdPartyPanel />
    </div>

    <div id="sec-about" class="settings-section">
      <h3>关于</h3>
      <p>my-mindmap agent v1.0.0</p>
      <p>基于 simple-mind-map + Vue3 + Electron</p>
      <p>本项目由 bubu-lzy 结合 AI 工具制作，基于思维导图二创。若有疑问请联系 2995136355@qq.com</p>
    </div>
      </div><!-- .settings-content -->
    </div><!-- .settings-layout -->
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { ElMessage } from 'element-plus'
import { aiService, providerPresets, autoCompleteURL, buildBaseURL, isVisionModel } from '../services/aiService'
import { DANGEROUS_TOOLS } from '../services/toolHandler'
import { isTrustMode, setTrustMode } from '../utils/trustMode'
import FeishuPanel from './FeishuPanel.vue'
import ThirdPartyPanel from './ThirdPartyPanel.vue'
import { getMemoryFacts, removeMemoryFact as deleteMemoryFact, clearMemoryFacts } from '../utils/aiMemory'

const emit = defineEmits(['saved'])

// ========== 危险操作白名单管理 ==========
const WHITELIST_KEY = 'mindmap_ai_tool_whitelist'
const dangerousToolNames = {
  new_mindmap: '新建导图（清空画布）',
  delete_node: '删除节点',
  feishu_delete_file: '删除飞书文件',
  upload_to_feishu: '上传导图到飞书',
  upload_mindmap_to_feishu_doc: '导图转飞书文档',
  upload_file_to_feishu: '上传本地文件到飞书'
}
const whitelist = ref([])

// ========== 信任模式 ==========
const trustMode = ref(isTrustMode())
const onTrustModeChange = () => {
  setTrustMode(trustMode.value)
  ElMessage.info(trustMode.value ? '信任模式已开启：所有操作将直接执行，不再弹窗确认' : '信任模式已关闭：危险操作将恢复确认')
}

const displayNameOf = (name) => dangerousToolNames[name] || DANGEROUS_TOOLS[name] || name

const loadWhitelist = () => {
  try { whitelist.value = JSON.parse(localStorage.getItem(WHITELIST_KEY) || '[]') } catch { whitelist.value = [] }
}

const removeFromWhitelist = (name) => {
  whitelist.value = whitelist.value.filter(n => n !== name)
  localStorage.setItem(WHITELIST_KEY, JSON.stringify(whitelist.value))
  ElMessage.success(`已移除「${displayNameOf(name)}」，下次执行将重新确认`)
}

// ========== AI 长期记忆管理 ==========
const memoryFacts = ref([])
const loadMemoryFacts = () => { memoryFacts.value = getMemoryFacts() }

const removeMemoryFactItem = (id) => {
  deleteMemoryFact(id)
  loadMemoryFacts()
  ElMessage.success('已删除该条长期记忆')
}

const clearAllMemory = () => {
  clearMemoryFacts()
  loadMemoryFacts()
  ElMessage.success('已清空全部长期记忆')
}

// ========== 开机自启动 ==========
const autoLaunch = ref(false)
const autoLaunchLoading = ref(false)
const httpServerEnabled = ref(false)
const httpServerLoading = ref(false)
const httpServerStatus = ref(null)
const httpServerQuality = ref('medium')
const saveDir = ref('')

const loadAutoLaunch = async () => {
  try {
    if (window.electronAPI?.autoLaunch?.get) {
      autoLaunch.value = await window.electronAPI.autoLaunch.get()
    }
  } catch (e) {
    // 浏览器模式忽略
  }
}

const loadSaveDir = async () => {
  try {
    if (window.electronAPI?.getDefaultSaveDir) {
      saveDir.value = await window.electronAPI.getDefaultSaveDir() || ''
    }
  } catch {
    // 浏览器模式忽略
  }
}

const loadHttpServer = async () => {
  if (!(window.electronAPI?.httpServer?.getStatus)) return
  try {
    const status = await window.electronAPI.httpServer.getStatus()
    httpServerStatus.value = status
    httpServerEnabled.value = !!status.enabled
    httpServerQuality.value = status.quality || 'medium'
  } catch (e) {
    console.warn('读取 HTTP 服务状态失败:', e)
  }
}

const onHttpServerQualityChange = async (quality) => {
  if (!(window.electronAPI?.httpServer?.setQuality)) return
  try {
    const status = await window.electronAPI.httpServer.setQuality(quality)
    httpServerStatus.value = status
    httpServerQuality.value = status.quality || 'medium'
    ElMessage.success('远程画面质量已更新')
  } catch (e) {
    httpServerQuality.value = httpServerStatus.value?.quality || 'medium'
    ElMessage.error('画面质量设置失败: ' + e.message)
  }
}

const onHttpServerChange = async (enabled) => {
  if (!(window.electronAPI?.httpServer?.setEnabled)) {
    httpServerEnabled.value = !enabled
    return
  }
  httpServerLoading.value = true
  try {
    const status = await window.electronAPI.httpServer.setEnabled(enabled)
    httpServerStatus.value = status
    httpServerEnabled.value = !!status.enabled
    ElMessage.success(enabled ? '本地 HTTP 服务已开启' : '本地 HTTP 服务已关闭')
  } catch (e) {
    httpServerEnabled.value = !enabled
    ElMessage.error(`HTTP 服务设置失败: ${e.message || '未知错误'}`)
  } finally {
    httpServerLoading.value = false
  }
}

const copyText = async (text) => {
  if (!text) return
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(String(text))
    } else {
      const ta = document.createElement('textarea')
      ta.value = String(text)
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    }
    ElMessage.success('已复制')
  } catch (e) {
    ElMessage.error('复制失败')
  }
}

const formatHttpTokenExpiry = (ts) => {
  if (!ts) return '未知'
  return new Date(ts).toLocaleString()
}

const selectSaveDir = async () => {
  if (!window.electronAPI?.fs?.selectFolder) {
    ElMessage.warning('当前为浏览器模式，无法选择目录（请使用桌面应用）')
    return
  }
  const dir = await window.electronAPI.fs.selectFolder()
  if (dir) saveDir.value = dir
}

const applySaveDir = async () => {
  const dir = String(saveDir.value || '').trim()
  if (!dir) return
  if (!window.electronAPI?.setSaveDir) {
    ElMessage.warning('当前为浏览器模式，无法保存目录（请使用桌面应用）')
    return
  }
  try {
    const next = await window.electronAPI.setSaveDir(dir)
    if (next) {
      saveDir.value = next
      ElMessage.success('默认保存目录已更新，并同步到左侧目录树')
      emit('saved')
    }
  } catch (e) {
    ElMessage.error('保存目录失败: ' + (e.message || ''))
  }
}

const onAutoLaunchChange = async (enabled) => {
  if (!(window.electronAPI?.autoLaunch?.set)) {
    ElMessage.warning('当前为浏览器模式，无法设置开机自启动（请使用桌面应用）')
    autoLaunch.value = !enabled
    return
  }
  autoLaunchLoading.value = true
  try {
    const res = await window.electronAPI.autoLaunch.set(enabled)
    if (res && res.success) {
      autoLaunch.value = res.enabled
      ElMessage.success(res.enabled ? '已开启开机自启动' : '已关闭开机自启动')
    } else {
      autoLaunch.value = !enabled
      ElMessage.error('设置失败: ' + (res?.error || '未知错误'))
    }
  } catch (e) {
    autoLaunch.value = !enabled
    ElMessage.error('设置失败: ' + e.message)
  } finally {
    autoLaunchLoading.value = false
  }
}

// 提供商预设数据（与 aiService.providerPresets 保持一致）
const providers = providerPresets

// 下拉框可选项（排除"自定义"，自定义通过手动编辑 baseURL 实现）
const presetOptions = computed(() =>
  providers.filter((p) => p.id !== 'custom')
)

// 当前选中的提供商
const selectedProvider = ref('')

// 当前提供商预设模型列表
const currentModels = ref([])

// 从 API 自动检测到的模型列表
const fetchedModels = ref([])

// 是否正在获取模型列表
const fetchingModels = ref(false)

// 合并后的模型列表（去重）
const allModels = computed(() => {
  const set = new Set([...currentModels.value, ...fetchedModels.value])
  return Array.from(set)
})

// Base URL 输入框占位提示
const baseURLPlaceholder = computed(() => {
  if (selectedProvider.value === 'openai_proxy') {
    return 'https://api.your-proxy.com'
  }
  if (selectedProvider.value === 'custom') {
    return 'https://your-api-endpoint.com'
  }
  return 'https://api.openai.com'
})

// 配置表单
const config = ref({
  profiles: [],
  activeProfileId: '',
  temperature: 0.7
})

// 当前活跃的配置档（computed）
const activeProfileId = computed({
  get: () => config.value.activeProfileId,
  set: (v) => { config.value.activeProfileId = v }
})
// AI temperature（生成随机性，0~2，默认 0.7）
const temperature = computed({
  get: () => Number(config.value.temperature ?? 0.7),
  set: (v) => { config.value.temperature = Number(v) }
})
// 基础配置档列表（AI 对话用，不含多模态档）
const baseProfiles = computed(() =>
  config.value.profiles.filter(p => p.type !== 'vision')
)
const activeProfile = computed(() =>
  baseProfiles.value.find(p => p.id === config.value.activeProfileId) || null
)

// 多模态（视觉）识别配置：独立的配置档列表，与基础档共用 config.profiles，以 type 区分
const visionConfig = ref({
  enabled: false,
  activeProfileId: ''
})
// 上次已保存配置的快照：分区保存时，另一区域的配置档沿用快照内容，不被当前 UI 中未保存的修改带走
const savedSnapshot = ref(null)
const visionProfiles = computed(() =>
  config.value.profiles.filter(p => p.type === 'vision')
)
const activeVisionProfile = computed(() =>
  visionProfiles.value.find(p => p.id === visionConfig.value.activeProfileId) || null
)
// 检测到的模型列表（从多模态配置档的 URL/Key 拉取，匹配多模态关键词的标出）
const visionFetchedModels = ref([])
const visionMatchedCount = ref(0)
const detectingVision = ref(false)
// 接口元数据：{ [modelId]: { visionFromAPI, status } }，来自 /models 的 modalities 字段
const visionModelMeta = ref({})
const testingVision = ref(false)
// 上次成功检测时的地址|Key 签名：下拉框展开时据此判断是否需要重新检测
let visionLastFetchSig = ''

// 接口元数据判定为多模态（火山方舟等平台在 /models 中返回 input_modalities）
const isVisionByAPI = (m) => {
  const meta = visionModelMeta.value[m]
  return !!(meta && meta.visionFromAPI)
}
// 已下架/退役模型（接口 status 标记）
const isModelRetired = (m) => {
  const meta = visionModelMeta.value[m]
  return !!(meta && /retiring|shutdown|deprecated|offline/i.test(meta.status || ''))
}
// 综合判定：接口元数据或内置知识库规则（排除已下线）
const isVisionCapable = (m) => !isModelRetired(m) && (isVisionByAPI(m) || isVisionModel(m))
// 下拉列表排序：多模态模型置顶，已下线沉底，其余保持原序
const visionModelOptions = computed(() => {
  const rank = (m) => (isModelRetired(m) ? 2 : isVisionCapable(m) ? 0 : 1)
  return [...visionFetchedModels.value]
    .map((m, i) => ({ m, i }))
    .sort((a, b) => rank(a.m) - rank(b.m) || a.i - b.i)
    .map((x) => x.m)
})

// 实测探测当前多模态配置：发真实小图验证模型是否真的可用
const testCurrentVisionModel = async () => {
  const profile = activeVisionProfile.value
  if (!profile) {
    ElMessage.warning('请先新增一个多模态配置档')
    return
  }
  // 空值回退：多模态档 URL/Key 留空 → 沿用当前基础档（与主进程 resolveVisionProfile 行为一致）
  const baseP = activeProfile.value
  const baseURL = (profile.baseURL || baseP?.baseURL || '').trim()
  const apiKey = (profile.apiKey || baseP?.apiKey || '').trim()
  const model = (profile.model || '').trim()
  const autoComplete = profile.baseURL
    ? profile.autoComplete !== false
    : baseP?.autoComplete !== false
  if (!baseURL || !model) {
    ElMessage.warning('请先填写 API 地址（或留空沿用基础模型地址）和多模态模型名称')
    return
  }
  if (!(window.electronAPI && window.electronAPI.testVisionModel)) {
    ElMessage.warning('当前为浏览器模式，无法测试（请使用桌面应用）')
    return
  }
  testingVision.value = true
  try {
    const result = await window.electronAPI.testVisionModel(baseURL, apiKey, model, autoComplete)
    if (result && result.success) {
      ElMessage.success(result.message || '该模型可用于图片识别')
    } else {
      ElMessage({ type: 'error', message: '测试失败：' + (result?.error || '未知错误'), duration: 8000 })
    }
  } catch (e) {
    ElMessage.error('测试失败: ' + e.message)
  } finally {
    testingVision.value = false
  }
}

// 测试状态
const testing = ref(false)

// 测试结果
const testResult = ref(null)

/**
 * URL 输入框失焦时自动补全（补全开关关闭时仅去末尾斜杠，不追加路径）
 */
const onBaseURLBlur = () => {
  if (activeProfile.value && activeProfile.value.baseURL) {
    activeProfile.value.baseURL = autoCompleteURL(activeProfile.value.baseURL, activeProfile.value.autoComplete !== false)
  }
}

/**
 * 加载已保存的配置
 */
const loadConfig = async () => {
  try {
    if (window.electronAPI && window.electronAPI.getAIConfig) {
      const saved = await window.electronAPI.getAIConfig()
      config.value.temperature = Number.isFinite(Number(saved.temperature)) ? Number(saved.temperature) : 0.7
      // 主进程已迁移为统一 profiles 结构（含 type 字段）
      if (saved.profiles && Array.isArray(saved.profiles) && saved.profiles.length > 0) {
        config.value.profiles = saved.profiles.map(p => ({
          ...p,
          type: p.type === 'vision' ? 'vision' : 'base',
          // URL 补全开关默认开启（旧配置无此字段）
          autoComplete: p.autoComplete !== false,
          // 加载即规范化：自愈旧版写入的双重版本路径（/v4/v1/chat/completions → /v4/chat/completions）；补全关闭的档位原样保留
          baseURL: p.baseURL ? autoCompleteURL(p.baseURL, p.autoComplete !== false) : ''
        }))
        // activeProfileId 必须指向基础档
        if (baseProfiles.value.some(p => p.id === saved.activeProfileId)) {
          config.value.activeProfileId = saved.activeProfileId
        } else {
          config.value.activeProfileId = baseProfiles.value[0]?.id || ''
        }
      } else {
        // 空配置：创建默认基础配置档
        config.value.profiles = [{
          id: 'default',
          name: '默认配置',
          type: 'base',
          baseURL: saved.baseURL || '',
          apiKey: saved.apiKey || '',
          model: saved.model || '',
          autoComplete: true
        }]
        config.value.activeProfileId = 'default'
      }
      // 加载多模态配置（独立配置档结构）
      const savedVision = saved.vision || {}
      visionConfig.value = {
        enabled: !!savedVision.enabled,
        activeProfileId: savedVision.activeProfileId || ''
      }
      // 尝试匹配已知提供商
      if (activeProfile.value) {
        const match = providers.find((p) => p.baseURL === activeProfile.value.baseURL)
        if (match) {
          selectedProvider.value = match.id
          currentModels.value = match.models
        } else {
          selectedProvider.value = 'custom'
          currentModels.value = []
        }
      }
      // 初始化已保存快照（分区保存的合并基准；其余设置项均有各自的自动保存，不经由本快照）
      savedSnapshot.value = {
        profiles: JSON.parse(JSON.stringify(config.value.profiles)),
        activeProfileId: config.value.activeProfileId,
        vision: { enabled: !!visionConfig.value.enabled, activeProfileId: visionConfig.value.activeProfileId || '' }
      }
    }
  } catch (e) {
    console.error('加载配置失败:', e)
  }
}

// ========== 配置档管理 ==========
function genProfileId() {
  return 'p_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6)
}

const addProfile = () => {
  const id = genProfileId()
  config.value.profiles.push({ id, name: '', baseURL: '', apiKey: '', model: '', type: 'base', autoComplete: true })
  config.value.activeProfileId = id
  selectedProvider.value = 'custom'
  currentModels.value = []
  fetchedModels.value = []
}

const deleteActiveProfile = () => {
  if (baseProfiles.value.length <= 1) return
  const idx = config.value.profiles.findIndex(p => p.id === config.value.activeProfileId)
  if (idx === -1) return
  config.value.profiles.splice(idx, 1)
  config.value.activeProfileId = baseProfiles.value[0].id
}

// ========== 多模态配置档管理 ==========
const onVisionBaseURLBlur = () => {
  if (activeVisionProfile.value && activeVisionProfile.value.baseURL) {
    activeVisionProfile.value.baseURL = autoCompleteURL(activeVisionProfile.value.baseURL, activeVisionProfile.value.autoComplete !== false)
  }
}

const addVisionProfile = () => {
  const id = genProfileId()
  config.value.profiles.push({ id, name: '', baseURL: '', apiKey: '', model: '', type: 'vision', autoComplete: true })
  visionConfig.value.activeProfileId = id
  visionFetchedModels.value = []
  visionMatchedCount.value = 0
  visionModelMeta.value = {}
}

const deleteActiveVisionProfile = () => {
  if (visionProfiles.value.length <= 1) return
  const idx = config.value.profiles.findIndex(p => p.id === visionConfig.value.activeProfileId)
  if (idx === -1) return
  config.value.profiles.splice(idx, 1)
  visionConfig.value.activeProfileId = visionProfiles.value[0]?.id || ''
  visionFetchedModels.value = []
  visionMatchedCount.value = 0
  visionModelMeta.value = {}
}

const onProfileSwitch = () => {
  const p = activeProfile.value
  if (!p) return
  const match = providers.find((x) => x.baseURL === p.baseURL)
  if (match) {
    selectedProvider.value = match.id
    currentModels.value = match.models
  } else {
    selectedProvider.value = 'custom'
    currentModels.value = []
  }
  fetchedModels.value = []
}

/**
 * 选择提供商预设
 * 通过 el-select 的 change 事件触发，参数为所选 provider 的 id
 */
const selectProvider = (providerId) => {
  const provider = providers.find((p) => p.id === providerId)
  if (!provider || !activeProfile.value) return
  selectedProvider.value = provider.id
  activeProfile.value.baseURL = provider.baseURL
  currentModels.value = provider.models
  fetchedModels.value = []
  if (
    provider.models.length &&
    !provider.models.includes(activeProfile.value.model)
  ) {
    activeProfile.value.model = ''
  }
}

/**
 * 自动检测可用模型列表
 * 通过 Electron 主进程代理请求，避免 CORS 限制
 */
const fetchModels = async () => {
  if (!activeProfile.value) return
  if (!activeProfile.value.baseURL) return
  // Ollama 不需要 API Key
  if (selectedProvider.value !== 'ollama' && !activeProfile.value.apiKey) return

  fetchingModels.value = true
  try {
    // 优先使用 Electron IPC（避免 CORS 限制）
    if (window.electronAPI && window.electronAPI.fetchModels) {
      const result = await window.electronAPI.fetchModels(
        activeProfile.value.baseURL,
        activeProfile.value.apiKey
      )
      if (result && result.success && result.models) {
        fetchedModels.value = result.models
      } else {
        fetchedModels.value = []
      }
    } else {
      // 浏览器环境降级：直接 fetch（可能遇到 CORS 限制）
      const headers = {}
      if (activeProfile.value.apiKey) {
        headers['Authorization'] = `Bearer ${activeProfile.value.apiKey}`
      }
      const base = buildBaseURL(activeProfile.value.baseURL)
      let models = []
      try {
        const resp = await fetch(`${base}/v1/models`, { headers })
        if (resp.ok) {
          const data = await resp.json()
          if (data.data && Array.isArray(data.data)) {
            models = data.data.map((m) => m.id).filter(Boolean)
          }
        }
      } catch {
        // CORS 或网络错误，静默处理
      }
      if (models.length === 0) {
        try {
          const resp = await fetch(`${base}/api/tags`)
          if (resp.ok) {
            const data = await resp.json()
            if (data.models && Array.isArray(data.models)) {
              models = data.models.map((m) => m.name).filter(Boolean)
            }
          }
        } catch {
          // Ollama 接口也不可用
        }
      }
      fetchedModels.value = models
    }
  } catch {
    fetchedModels.value = []
  } finally {
    fetchingModels.value = false
  }
}

/**
 * 模型下拉框可见性变化时触发
 */
const onModelDropdownVisible = (visible) => {
  if (visible && fetchedModels.value.length === 0) {
    fetchModels()
  }
}

/**
 * 测试 AI API 连接
 * 临时设置配置进行测试，不影响已保存的配置
 */
const testConnection = async () => {
  if (!activeProfile.value || !activeProfile.value.baseURL) {
    testResult.value = { success: false, message: '请先填写 API 地址' }
    return
  }
  if (!activeProfile.value.model) {
    testResult.value = { success: false, message: '请先选择或输入模型名称' }
    return
  }

  testing.value = true
  testResult.value = null

  try {
    // 临时设置配置用于测试（不持久化）
    aiService.setConfig({
      baseURL: activeProfile.value.baseURL,
      apiKey: activeProfile.value.apiKey,
      model: activeProfile.value.model,
      autoComplete: activeProfile.value.autoComplete !== false
    })
    const result = await aiService.testConnection()
    testResult.value = result
    // 测试完毕后重置，使下次真实对话重新从已保存配置初始化
    aiService.resetConfig()
  } catch (e) {
    testResult.value = { success: false, message: `连接失败: ${e.message}` }
  } finally {
    testing.value = false
  }
}

/**
 * 开启多模态识别时：尚无多模态配置档则自动新增一个
 */
const onVisionEnabledChange = (enabled) => {
  if (enabled && visionProfiles.value.length === 0) {
    addVisionProfile()
  }
}

/**
 * 检测多模态配置档 URL/Key 下的模型列表
 * 全部模型均可选，匹配关键词库的标出「多模态」；提示语区分总数与多模态数
 * silent=true 时为下拉框展开自动触发：前置条件不满足只静默跳过，不弹警告
 */
const visionFetchSignature = () => {
  const profile = activeVisionProfile.value
  if (!profile) return null
  const baseP = activeProfile.value
  return `${(profile.baseURL || baseP?.baseURL || '').trim()}|${(profile.apiKey || baseP?.apiKey || '').trim()}`
}

const detectVisionModels = async (silent = false) => {
  const profile = activeVisionProfile.value
  if (!profile) {
    if (!silent) ElMessage.warning('请先新增一个多模态配置档')
    return
  }
  // 空值回退：多模态档 URL/Key 留空 → 沿用当前基础档
  const baseP = activeProfile.value
  const baseURL = (profile.baseURL || baseP?.baseURL || '').trim()
  const apiKey = (profile.apiKey || baseP?.apiKey || '').trim()
  if (!baseURL) {
    if (!silent) ElMessage.warning('请先填写 API 地址（或留空沿用基础模型地址）')
    return
  }
  const isOllama = baseURL.includes('localhost') || baseURL.includes('127.0.0.1') || baseURL.includes('ollama')
  if (!isOllama && !apiKey) {
    if (!silent) ElMessage.warning('请先填写 API Key（或留空沿用基础模型的 Key）')
    return
  }
  if (!(window.electronAPI && window.electronAPI.fetchModels)) {
    if (!silent) ElMessage.warning('当前为浏览器模式，无法检测模型（请使用桌面应用）')
    return
  }
  if (detectingVision.value) return
  detectingVision.value = true
  try {
    const result = await window.electronAPI.fetchModels(baseURL, apiKey)
    if (result && result.success && Array.isArray(result.models)) {
      const all = result.models
      // 接口元数据（modalities/status）存入映射，供标签与排序使用
      const meta = {}
      if (Array.isArray(result.details)) {
        for (const d of result.details) {
          if (d && d.id) meta[d.id] = d
        }
      }
      visionModelMeta.value = meta
      visionFetchedModels.value = all
      visionLastFetchSig = visionFetchSignature()
      // 综合识别：接口元数据标记 或 内置知识库规则
      const matched = all.filter((m) => (meta[m] && meta[m].visionFromAPI) || isVisionModel(m))
      visionMatchedCount.value = matched.length
      if (silent) return
      if (matched.length > 0) {
        ElMessage.success(`检测到 ${matched.length} 个支持多模态的模型（共 ${all.length} 个，已标出）`)
      } else {
        ElMessage.warning(`检测到 ${all.length} 个模型，但未匹配到已知多模态模型，可手动选择/输入`)
      }
    } else {
      visionFetchedModels.value = []
      visionMatchedCount.value = 0
      if (!silent) ElMessage.error(result?.error || '未检测到可用模型')
    }
  } catch (e) {
    visionFetchedModels.value = []
    visionMatchedCount.value = 0
    console.error('多模态模型自动检测失败:', e)
    if (!silent) ElMessage.error('检测失败: ' + e.message)
  } finally {
    detectingVision.value = false
  }
}

/**
 * 下拉框展开时自动检测模型列表：
 * 未检测过、或地址/Key 与上次检测时不同（含切换配置档）才重新拉取，其余直接用缓存
 */
const onVisionDropdownOpen = (visible) => {
  if (!visible) return
  const sig = visionFetchSignature()
  if (!sig || !sig.split('|')[0]) return
  if (visionFetchedModels.value.length > 0 && sig === visionLastFetchSig) return
  detectVisionModels(true)
}

/**
 * 保存配置（分区提交，两类模型档互不影响；其余设置项均有各自的自动保存）
 * - 'base'（基础模型区按钮）：只提交基础档；多模态档与其开关沿用上次已保存内容
 * - 'vision'（多模态区按钮）：只提交多模态档与启用开关；基础档沿用上次已保存内容
 */
const saveConfig = async (scope = 'base') => {
  try {
    if (!(window.electronAPI && window.electronAPI.setAIConfig)) {
      ElMessage.warning('当前为浏览器模式，无法保存 AI 配置（请使用桌面应用）')
      return
    }
    // 当前 UI 配置档（baseURL 自动补全——补全关闭的档位原样保留、type 归一化）
    const uiProfiles = config.value.profiles.map(p => ({
      ...p,
      type: p.type === 'vision' ? 'vision' : 'base',
      autoComplete: p.autoComplete !== false,
      baseURL: p.baseURL ? autoCompleteURL(p.baseURL, p.autoComplete !== false) : ''
    }))
    const uiBase = uiProfiles.filter(p => p.type !== 'vision')
    const uiVision = uiProfiles.filter(p => p.type === 'vision')
    const snap = savedSnapshot.value
    const hasSnap = !!(snap && Array.isArray(snap.profiles))
    let profiles, activeProfileId, visionState
    if (scope === 'vision' && hasSnap) {
      // 多模态保存：基础档取快照（UI 中未保存的基础修改不被带走）
      profiles = [...snap.profiles.filter(p => p.type !== 'vision'), ...uiVision]
      activeProfileId = snap.activeProfileId || uiBase[0]?.id || ''
      visionState = { enabled: !!visionConfig.value.enabled, activeProfileId: visionConfig.value.activeProfileId || '' }
    } else if (hasSnap) {
      // 基础保存：多模态档与开关取快照（UI 中未保存的多模态修改不被带走）
      profiles = [...uiBase, ...snap.profiles.filter(p => p.type === 'vision')]
      activeProfileId = config.value.activeProfileId
      visionState = snap.vision || { enabled: false, activeProfileId: '' }
    } else {
      // 无快照的极端情况退回全量保存，避免误清另一类配置档
      profiles = uiProfiles
      activeProfileId = config.value.activeProfileId
      visionState = { enabled: !!visionConfig.value.enabled, activeProfileId: visionConfig.value.activeProfileId || '' }
    }
    // 深克隆为纯数据：profiles 可能携带 Vue 响应式 Proxy，IPC 结构化克隆无法处理
    // （会抛 "An object could not be cloned"）；配置字段均为字符串/布尔，JSON 序列化无损失
    const savedConfig = JSON.parse(JSON.stringify({ profiles, activeProfileId, vision: visionState }))
    await window.electronAPI.setAIConfig(savedConfig)
    savedSnapshot.value = JSON.parse(JSON.stringify(savedConfig))
    // 只回写本次作用域的配置档；另一作用域 UI 中未保存的修改保持原样，等待各自按钮提交
    if (scope === 'vision' && hasSnap) {
      config.value.profiles = [...config.value.profiles.filter(p => p.type !== 'vision'), ...uiVision]
    } else if (hasSnap) {
      config.value.profiles = [...uiBase, ...config.value.profiles.filter(p => p.type === 'vision')]
    } else {
      config.value.profiles = uiProfiles
    }
    aiService.resetConfig()
    ElMessage.success(scope === 'vision' ? '多模态配置已保存' : '基础模型配置已保存')
    emit('saved')
  } catch (e) {
    ElMessage.error('保存失败: ' + e.message)
  }
}

const saveTemperature = async () => {
  if (!(window.electronAPI && window.electronAPI.setAIConfig)) {
    ElMessage.warning('当前为浏览器模式，无法保存 AI 配置（请使用桌面应用）')
    return
  }
  try {
    const snap = savedSnapshot.value
    const profiles = snap && Array.isArray(snap.profiles)
      ? snap.profiles
      : config.value.profiles.map(p => ({
          ...p,
          type: p.type === 'vision' ? 'vision' : 'base',
          autoComplete: p.autoComplete !== false
        }))
    const activeProfileId = snap ? snap.activeProfileId : config.value.activeProfileId
    const visionState = snap
      ? snap.vision
      : { enabled: !!visionConfig.value.enabled, activeProfileId: visionConfig.value.activeProfileId || '' }
    const savedConfig = JSON.parse(JSON.stringify({
      profiles,
      activeProfileId,
      vision: visionState,
      temperature: Number(config.value.temperature ?? 0.7)
    }))
    await window.electronAPI.setAIConfig(savedConfig)
    aiService.resetConfig()
    ElMessage.success('AI temperature 已保存')
    emit('saved')
  } catch (e) {
    ElMessage.error('保存失败: ' + e.message)
  }
}

const saveVisionConfig = () => saveConfig('vision')

// ========== MCP 管理 ==========
const mcpServers = ref([])
const showMcpForm = ref(false)
const newMcp = ref({ name: '', transport: 'http', url: '', command: '', args: [], headers: {}, enabled: true })

const loadMcp = async () => {
  if (!window.electronAPI?.mcp?.list) return
  try { mcpServers.value = await window.electronAPI.mcp.list() } catch (e) {}
}

const addMcp = async () => {
  if (!window.electronAPI?.mcp?.create) return
  try {
    await window.electronAPI.mcp.create(newMcp.value)
    newMcp.value = { name: '', transport: 'http', url: '', command: '', args: [], headers: {}, enabled: true }
    showMcpForm.value = false
    await loadMcp()
    ElMessage.success('MCP 服务已添加')
  } catch (e) { ElMessage.error('新增 MCP 失败: ' + e.message) }
}

const saveMcp = async (server) => {
  if (!window.electronAPI?.mcp?.update) return
  try { await window.electronAPI.mcp.update(server.id, server); ElMessage.success('MCP 服务已保存') } catch (e) { ElMessage.error('保存失败: ' + e.message) }
}

const removeMcp = async (id) => {
  if (!window.electronAPI?.mcp?.remove) return
  try { await window.electronAPI.mcp.remove(id); await loadMcp(); ElMessage.success('MCP 服务已删除') } catch (e) { ElMessage.error('删除失败: ' + e.message) }
}

const testMcp = async (server) => {
  if (!window.electronAPI?.mcp?.listTools) return
  try {
    const tools = await window.electronAPI.mcp.listTools(server.id)
    ElMessage.success(`连接成功，发现 ${tools.length} 个工具`)
  } catch (e) { ElMessage.error('连接失败: ' + e.message) }
}

// ========== Skills 管理 ==========
const skills = ref([])
const showSkillForm = ref(false)
const newSkill = ref({ name: '', description: '', instructions: '', enabled: true, autoInvoke: false, source: 'manual' })

const loadSkills = async () => {
  if (!window.electronAPI?.skills?.list) return
  try { skills.value = await window.electronAPI.skills.list() } catch (e) {}
}

const addSkill = async () => {
  if (!window.electronAPI?.skills?.create) return
  try {
    await window.electronAPI.skills.create(newSkill.value)
    newSkill.value = { name: '', description: '', instructions: '', enabled: true, autoInvoke: false, source: 'manual' }
    showSkillForm.value = false
    await loadSkills()
    ElMessage.success('Skill 已添加')
  } catch (e) { ElMessage.error('新增 Skill 失败: ' + e.message) }
}

const saveSkill = async (skill) => {
  if (!window.electronAPI?.skills?.update) return
  try { await window.electronAPI.skills.update(skill.id, skill); ElMessage.success('Skill 已保存') } catch (e) { ElMessage.error('保存失败: ' + e.message) }
}

const removeSkill = async (id) => {
  if (!window.electronAPI?.skills?.remove) return
  try { await window.electronAPI.skills.remove(id); await loadSkills(); ElMessage.success('Skill 已删除') } catch (e) { ElMessage.error('删除失败: ' + e.message) }
}

// ========== 侧边目录导航 ==========
const tocSections = [
  { id: 'sec-ai-config', label: 'AI 模型配置' },
  { id: 'sec-temperature', label: 'AI temperature 设置' },
  { id: 'sec-vision', label: '多模态识别' },
  { id: 'sec-safety', label: 'AI 安全与记忆' },
  { id: 'sec-system', label: '系统' },
  { id: 'sec-mcp', label: 'MCP 服务' },
  { id: 'sec-skills', label: 'Skills' },
  { id: 'sec-integrations', label: '三方集成' },
  { id: 'sec-messages', label: '消息中心' },
  { id: 'sec-about', label: '关于' }
]
const activeSection = ref('sec-ai-config')

const scrollToSection = (id) => {
  const el = document.getElementById(id)
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    activeSection.value = id
  }
}

let tocObserver = null

const setupTocObserver = () => {
  const ids = tocSections.map(s => s.id)
  const els = ids.map(id => document.getElementById(id)).filter(Boolean)
  if (els.length === 0) return
  tocObserver = new IntersectionObserver((entries) => {
    // 找出当前在视口顶部区域最靠前的 section
    const visible = entries
      .filter(e => e.isIntersecting)
      .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
    if (visible.length > 0) {
      activeSection.value = visible[0].target.id
    }
  }, { rootMargin: '-80px 0px -70% 0px' })
  els.forEach(el => tocObserver.observe(el))
}

onMounted(() => {
  loadConfig()
  loadWhitelist()
  loadMemoryFacts()
  loadAutoLaunch()
  loadSaveDir()
  loadHttpServer()
  loadMcp()
  loadSkills()
  setupTocObserver()
})

onBeforeUnmount(() => {
  if (tocObserver) { tocObserver.disconnect(); tocObserver = null }
})
</script>

<style>
/* 长期记忆悬浮全文（el-tooltip 内容 Teleport 到 body，需全局样式） */
.memory-tooltip-body {
  max-width: 480px;
  max-height: 300px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-all;
  line-height: 1.6;
  font-size: 12.5px;
}
</style>

<style scoped>
.settings-view {
  width: 100%;
  /* 弹窗(el-dialog)父级高度为 auto，height:100% 会失效导致整个弹窗随页面滚动、目录 sticky 失效；
     用 max-height 限定后本容器成为真正滚动容器，左侧目录 sticky 吸顶生效 */
  height: auto;
  max-height: 70vh;
  overflow-y: auto;
  padding: 0;
  background: linear-gradient(180deg, #f5f5f7 0%, #ffffff 100%);
}

.settings-layout {
  display: flex;
  min-height: 100%;
}

/* ---------- 侧边粘性目录 ---------- */
.settings-toc {
  position: sticky;
  top: 24px;
  width: 150px;
  min-width: 150px;
  height: fit-content;
  padding: 12px 0;
  margin: 24px 0 0 24px;
  background: transparent;
}

.settings-toc ul {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.settings-toc li {
  padding: 8px 14px;
  font-size: 13px;
  color: #86868b;
  cursor: pointer;
  border-radius: 8px;
  transition: all 0.2s ease;
  line-height: 1.4;
  border-left: 2px solid transparent;
}

.settings-toc li:hover {
  color: #1d1d1f;
  background: rgba(0, 0, 0, 0.04);
}

.settings-toc li.active {
  color: #007aff;
  font-weight: 600;
  background: rgba(0, 122, 255, 0.08);
  border-left-color: #007aff;
}

/* ---------- 设置内容区 ---------- */
.settings-content {
  flex: 1;
  min-width: 0;
  padding: 24px;
}

/* ---------- 设置区块 ---------- */
.settings-section {
  background: rgba(255, 255, 255, 0.72);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid rgba(0, 0, 0, 0.06);
  border-radius: 16px;
  padding: 24px;
  margin-bottom: 20px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
}

.settings-section h3 {
  font-size: 17px;
  font-weight: 600;
  color: #1d1d1f;
  margin: 0 0 18px 0;
  letter-spacing: -0.02em;
}

.settings-action-btn {
  display: inline-flex;
  align-items: center;
  padding: 10px 18px;
  background: linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%);
  color: #fff;
  border: none;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: transform 0.15s ease, box-shadow 0.15s ease;
  box-shadow: 0 2px 8px rgba(124, 58, 237, 0.3);
}
.settings-action-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 14px rgba(124, 58, 237, 0.4);
}
.settings-action-btn:active {
  transform: translateY(0);
}

/* ---------- AI 安全与记忆 ---------- */
.safety-block {
  margin-bottom: 18px;
}

/* 信任模式区块 */
.trust-block {
  padding: 14px 16px;
  background: rgba(255, 149, 0, 0.04);
  border: 1px solid rgba(255, 149, 0, 0.2);
  border-radius: 10px;
}
.trust-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.trust-header .safety-block-desc {
  margin-bottom: 0;
}

.safety-block:last-child {
  margin-bottom: 0;
}

.safety-block-title {
  font-size: 13px;
  font-weight: 600;
  color: #1d1d1f;
  margin-bottom: 4px;
}

.safety-block-desc {
  font-size: 12px;
  color: #86868b;
  margin: 0 0 10px 0;
  line-height: 1.5;
}

.safety-empty {
  font-size: 12px;
  color: #86868b;
  padding: 10px 12px;
  background: rgba(0, 0, 0, 0.03);
  border-radius: 8px;
}

.whitelist-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.whitelist-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: rgba(0, 0, 0, 0.03);
  border-radius: 8px;
}

.whitelist-name {
  font-size: 13px;
  color: #1d1d1f;
  flex: 1;
  min-width: 0;
}

.memory-fact-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: default;
}

.whitelist-key {
  font-size: 11px;
  color: #86868b;
  flex-shrink: 0;
}

.whitelist-remove {
  flex-shrink: 0;
  height: 24px;
  padding: 0 10px;
  font-size: 12px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #007aff;
  cursor: pointer;
  transition: background-color 0.15s ease;
}

.whitelist-remove:hover {
  background: rgba(0, 122, 255, 0.1);
}

.clear-memory-btn {
  margin-top: 10px;
}

.auto-launch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.auto-launch-info {
  flex: 1;
  min-width: 120px;
  word-break: normal;
  overflow-wrap: break-word;
}

.save-dir-controls {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.save-dir-input {
  width: 320px;
  max-width: 320px;
}
.save-dir-input :deep(.el-input__inner) {
  text-overflow: ellipsis;
  overflow: hidden;
  white-space: nowrap;
}

.http-server-info {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.http-server-address {
  display: flex;
  align-items: center;
  gap: 8px;
}

.http-server-address-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  color: var(--apple-blue, #007aff);
}

.http-server-token-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.http-server-token-label {
  font-size: 13px;
  color: #666;
  flex-shrink: 0;
}

.http-server-token {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: #333;
  background: rgba(0, 0, 0, 0.04);
  border-radius: 6px;
  padding: 5px 8px;
}

.http-server-expire {
  font-size: 12px;
  color: #999;
}

.http-server-quality-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.section-desc {
  font-size: 13px;
  color: #86868b;
  line-height: 1.6;
  margin: 0;
}

/* ---------- 配置档管理栏 ---------- */
.profile-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 16px;
}

.profile-select {
  flex: 1;
  min-width: 0;
}

.profile-empty {
  padding: 24px;
  text-align: center;
  color: #86868b;
  font-size: 13px;
}

/* ---------- 提供商预设下拉框 ---------- */
.provider-preset-select {
  width: 100%;
  margin-bottom: 10px;
}

/* ---------- 第三方/中转站 URL 提示 ---------- */
.proxy-hint {
  margin-bottom: 10px;
  padding: 10px 12px;
  background: rgba(0, 122, 255, 0.06);
  border: 1px solid rgba(0, 122, 255, 0.15);
  border-radius: 10px;
  font-size: 12px;
  line-height: 1.6;
  color: #0066cc;
}

.proxy-hint span {
  display: block;
}

.proxy-example {
  margin-top: 4px;
  color: #86868b;
  font-family: 'SF Mono', 'Fira Code', monospace;
  font-size: 11px;
}

/* ---------- URL 输入行（输入框 + 补全开关） ---------- */
.url-input-row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
}

.url-input-row .el-input {
  flex: 1;
  min-width: 0;
}

.url-switch {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-shrink: 0;
  padding: 0 2px;
}

.url-switch-label {
  font-size: 12px;
  color: #86868b;
  white-space: nowrap;
}

/* 空值回退提示（多模态档留空沿用基础档） */
.inherit-hint {
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.5;
  color: #86868b;
  word-break: break-all;
}

/* ---------- 表单 ---------- */
.settings-form {
  margin-bottom: 20px;
}

.settings-form :deep(.el-form-item__label) {
  font-size: 13px;
  font-weight: 500;
  color: #1d1d1f;
  padding-bottom: 6px;
}

.settings-form :deep(.el-input__wrapper),
.settings-form :deep(.el-select .el-input__wrapper) {
  border-radius: 10px;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.1) inset;
  transition: box-shadow 0.25s;
}

.settings-form :deep(.el-input__wrapper:hover) {
  box-shadow: 0 0 0 1px rgba(0, 122, 255, 0.3) inset;
}

.settings-form :deep(.el-input__wrapper.is-focus) {
  box-shadow: 0 0 0 2px #007aff inset;
}

/* ---------- 操作按钮 ---------- */
.settings-actions {
  display: flex;
  gap: 12px;
}

/* 模型检测提示 */
.model-hint {
  font-size: 12px;
  color: #34c759;
  margin-top: 4px;
  padding-left: 2px;
}

.model-hint.manual-hint {
  color: #86868b;
}

/* ---------- 多模态识别配置 ---------- */
.vision-desc {
  font-size: 12.5px;
  color: #86868b;
  line-height: 1.6;
  margin: 0 0 10px;
}

.temperature-row {
  display: flex;
  align-items: center;
  gap: 16px;
}

.temperature-value {
  min-width: 42px;
  text-align: right;
  font-size: 14px;
  font-weight: 600;
  color: #1d1d1f;
  font-variant-numeric: tabular-nums;
}

.vision-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 0 12px;
}

.vision-row-label {
  font-size: 13.5px;
  font-weight: 600;
  color: #1d1d1f;
}

.vision-model-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}

.vision-model-select {
  flex: 1;
  min-width: 0;
}

.vision-form {
  margin-top: 4px;
}

.vision-opt-name {
  float: left;
}

.vision-opt-tag {
  float: right;
  font-size: 11px;
  color: #007aff;
  background: rgba(0, 122, 255, 0.1);
  border-radius: 4px;
  padding: 0 6px;
  margin-left: 8px;
  line-height: 18px;
}

/* 内置规则识别的多模态标签（区别于接口元数据） */
.vision-opt-tag.tag-rule {
  color: #34c759;
  background: rgba(52, 199, 89, 0.12);
}

/* 已下线/退役模型标签 */
.vision-opt-tag.tag-retired {
  color: #8e8e93;
  background: rgba(142, 142, 147, 0.12);
}

.vision-tip {
  font-size: 12px;
  color: #86868b;
  line-height: 1.6;
  margin: 8px 0 0;
}

.settings-actions :deep(.el-button) {
  border-radius: 980px;
  padding: 10px 24px;
  font-size: 14px;
  font-weight: 500;
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}

.settings-actions :deep(.el-button:not(.el-button--primary)) {
  background: rgba(120, 120, 128, 0.08);
  border: none;
  color: #007aff;
}

.settings-actions :deep(.el-button:not(.el-button--primary):hover) {
  background: rgba(120, 120, 128, 0.16);
}

.settings-actions :deep(.el-button--primary) {
  background: #007aff;
  border: none;
}

.settings-actions :deep(.el-button--primary:hover) {
  background: #0066d6;
}

/* ---------- 测试结果 ---------- */
.test-result {
  margin-top: 16px;
  padding: 12px 16px;
  border-radius: 12px;
  font-size: 13px;
  line-height: 1.5;
  animation: fadeIn 0.3s ease;
}

.test-result.success {
  background: rgba(52, 199, 89, 0.1);
  color: #248a3d;
  border: 1px solid rgba(52, 199, 89, 0.2);
}

.test-result.error {
  background: rgba(255, 59, 48, 0.08);
  color: #d70015;
  border: 1px solid rgba(255, 59, 48, 0.15);
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* ---------- 关于区块文字 ---------- */
.settings-section p {
  font-size: 13px;
  color: #86868b;
  line-height: 1.8;
  margin: 0;
}

.mcp-skill-row,
.skill-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 0;
  border-bottom: 1px solid rgba(0, 0, 0, 0.05);
}

.mcp-skill-row .mini,
.skill-row .mini {
  width: 150px;
  flex: 0 0 auto;
}

.skill-row .grow {
  flex: 1 1 auto;
  min-width: 180px;
}

/* ---------- 滚动条 ---------- */
.settings-view::-webkit-scrollbar {
  width: 6px;
}

.settings-view::-webkit-scrollbar-track {
  background: transparent;
}

.settings-view::-webkit-scrollbar-thumb {
  background-color: rgba(0, 0, 0, 0.15);
  border-radius: 3px;
}

.settings-view::-webkit-scrollbar-thumb:hover {
  background-color: rgba(0, 0, 0, 0.25);
}
</style>

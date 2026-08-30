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
      <div v-else-if="configLoading" class="profile-empty">配置加载中...</div>
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

    <!-- AI 请求超时设置 -->
    <div id="sec-timeout" class="settings-section">
      <h3>AI 请求超时设置</h3>
      <p class="vision-desc">
        部分模型（如推理型大模型）响应较慢，可在此调整 AI 请求的最长等待时间（秒）。默认 300 秒（5 分钟），范围 30~3600 秒。
      </p>
      <div class="temperature-row">
        <el-input-number
          v-model="aiTimeoutSeconds"
          :min="30"
          :max="3600"
          :step="30"
          style="flex: 1;"
        />
        <span class="temperature-value">秒</span>
      </div>
      <div class="settings-actions" style="margin-top: 8px;">
        <el-button type="primary" @click="saveAiTimeout">保存超时</el-button>
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
          <el-form-item label="Files API 地址（文件上传端点）">
            <el-input
              v-model="activeVisionProfile.filesURL"
              placeholder="留空则按厂商自动推导内置端点"
            />
            <div class="model-hint manual-hint">
              用于把图片 / PDF 等文件上传到模型服务的 files 端点。留空走内置推导；内置不可用或上传失败时，可在此手动指定（如 https://api.openai.com/v1/files）。
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
          <div class="lan-access-row">
            <span class="lan-access-label">允许局域网访问</span>
            <el-switch
              :model-value="httpServerStatus.lanAccess"
              :loading="httpServerLoading"
              @change="onHttpLanAccessChange"
            />
            <span class="lan-access-hint">默认仅本机(127.0.0.1)可访问；开启后局域网内其他设备可访问</span>
          </div>
          <div v-for="addr in httpServerStatus.addresses" :key="addr" class="http-server-address">
            <span class="http-server-address-text">{{ addr }}</span>
            <el-button size="small" @click="copyText(addr)">复制地址</el-button>
          </div>
          <div class="http-server-token-row">
            <span class="http-server-token-label">Token</span>
            <code class="http-server-token">{{ maskToken(httpServerStatus.token) }}</code>
            <el-button size="small" @click="copyTokenWithAuth(httpServerStatus.token)">复制 Token</el-button>
          </div>
          <div class="http-server-expire">
            Token 有效期至：{{ formatHttpTokenExpiry(httpServerStatus.tokenExpiresAt) }}
          </div>
          <div class="http-server-skill-row">
            <el-button size="small" @click="copyHttpSkill">复制 Agent 调用 Skill（含 Token）</el-button>
          </div>
          <div class="http-server-mcp-row">
            <div class="http-server-mcp-info">
              <div class="http-server-mcp-title">MCP 接口（外部 AI 客户端接入）</div>
              <p class="http-server-mcp-desc">把下方 JSON 粘贴到 Trae / Claude Desktop / Cursor 等客户端的 MCP 配置中，即可让外部 AI 直接安装并调用本程序的全部工具（思维导图、文件、任务等）。</p>
              <div class="http-server-mcp-url-row">
                <span class="http-server-token-label">MCP 端点</span>
                <code class="http-server-token">{{ mcpInstallInfo.mcpUrl }}</code>
                <el-button size="small" @click="copyText(mcpInstallInfo.mcpUrl)">复制</el-button>
              </div>
            </div>
            <el-button size="small" type="primary" @click="copyMcpInstallJson">复制 MCP 安装 JSON（含 Token）</el-button>
          </div>
        </div>
      </div>

      <div class="safety-block">
        <div class="auto-launch-row">
          <div class="auto-launch-info">
            <div class="safety-block-title">屏幕共享（仅查看）</div>
            <p class="safety-block-desc">开启后生成独立的只读访问地址，多人可通过浏览器查看当前屏幕画面，但不能进行任何操作；访问需要独立 Token 鉴权。</p>
          </div>
          <el-switch
            v-model="httpViewOnlyEnabled"
            :loading="httpViewOnlyLoading"
            @change="onHttpViewOnlyChange"
          />
        </div>
        <div v-if="httpViewOnlyStatus && httpViewOnlyStatus.running" class="http-server-info">
          <div class="lan-access-row">
            <span class="lan-access-label">允许局域网访问</span>
            <el-switch
              :model-value="httpViewOnlyStatus.lanAccess"
              :loading="httpViewOnlyLoading"
              @change="onHttpViewOnlyLanAccessChange"
            />
            <span class="lan-access-hint">默认仅本机(127.0.0.1)可访问；开启后局域网内其他设备可访问</span>
          </div>
          <div v-for="addr in httpViewOnlyStatus.addresses" :key="addr" class="http-server-address">
            <span class="http-server-address-text">{{ addr }}</span>
            <el-button size="small" @click="copyText(addr)">复制地址</el-button>
          </div>
          <div class="http-server-token-row">
            <span class="http-server-token-label">Token</span>
            <code class="http-server-token">{{ maskToken(httpViewOnlyStatus.token) }}</code>
            <el-button size="small" @click="copyTokenWithAuth(httpViewOnlyStatus.token)">复制 Token</el-button>
          </div>
          <div class="http-server-expire">
            Token 有效期至：{{ formatHttpTokenExpiry(httpViewOnlyStatus.tokenExpiresAt) }}
          </div>
          <div class="http-server-address">
            <span class="http-server-address-text">分享地址（浏览器打开后输入 Token 即可查看）</span>
            <el-button size="small" @click="copyText(viewOnlyShareLink)">复制链接</el-button>
          </div>
        </div>
      </div>
    </div>

    <!-- 全局 Token 管理 -->
    <div id="sec-token" class="settings-section">
      <h3>全局 Token 管理</h3>
      <p class="vision-desc">集中管理所有 Token。Token 默认掩码显示，「查看」明文与「重置」需验证全局访问密码；「复制」仅复制掩码，绝不复制明文。</p>
      <div v-if="!passwordGateEnabled" class="token-lock-hint">
        请先在「全局管理访问密码」目录中设置密码，才能管理 Token。
      </div>
      <div v-else-if="!tokenUnlocked" class="token-lock-hint">
        内容已锁定。请点击左侧目录「全局 Token 管理」验证访问密码后查看。
      </div>
      <div v-else-if="!tokenOverview.length" class="token-lock-hint">
        暂无 Token。开启 HTTP 服务或创建 MCP 访问令牌后，此处会列出。
      </div>
      <div v-else class="token-overview-list">
        <div v-for="item in tokenOverview" :key="item.key" class="token-overview-row" :class="{ disabled: item.enabled === false }">
          <div class="token-overview-info">
            <div class="token-overview-name">
              {{ item.name }}
              <el-tag size="small" :type="item.enabled ? 'success' : 'info'" style="margin-left: 6px">{{ item.enabled ? '启用中' : '已停用' }}</el-tag>
            </div>
            <code class="token-overview-value">{{ revealedTokens[item.key] || item.masked }}</code>
          </div>
          <div class="token-overview-actions">
            <el-switch :model-value="item.enabled" @change="toggleTokenService(item)" />
            <el-button size="small" :disabled="item.has === false" @click="revealTokenItem(item)">查看</el-button>
            <el-button size="small" :disabled="item.has === false" @click="copyPlainToken(item)">复制</el-button>
            <el-button size="small" type="danger" :disabled="item.has === false" @click="resetTokenItem(item)">重置</el-button>
          </div>
        </div>
      </div>
    </div>

    <!-- 全局管理访问密码 -->
    <div id="sec-password" class="settings-section">
      <h3>全局管理访问密码</h3>
      <p class="vision-desc">设置全局管理访问密码后，才能查看明文、重置 Token 等敏感操作。修改密码需输入原密码。</p>
      <div class="safety-block">
        <div class="auto-launch-row">
          <div class="auto-launch-info">
            <div class="safety-block-title">访问密码</div>
            <p class="safety-block-desc">{{ passwordGateDesc }}</p>
          </div>
          <el-button size="small" :type="passwordGateEnabled ? 'default' : 'primary'" @click="openPasswordDialog">
            {{ passwordGateEnabled ? '修改密码' : '设置密码' }}
          </el-button>
        </div>
      </div>
    </div>

    <!-- MCP 服务管理 -->
    <div id="sec-mcp" class="settings-section">
      <h3>MCP 服务</h3>
      <p class="vision-desc">可添加多个 MCP 服务，保存后 AI 可通过 mcp_call_tool 调用。当前优先支持 HTTP/SSE 服务；stdio 服务仅保存配置。</p>
      <div class="profile-bar">
        <el-button size="small" @click="showMcpForm = !showMcpForm">{{ showMcpForm ? '收起新增' : '新增 MCP' }}</el-button>
        <el-button size="small" @click="showMcpImport = !showMcpImport">{{ showMcpImport ? '收起 JSON 导入' : '粘贴 JSON 配置' }}</el-button>
      </div>
      <div v-if="showMcpImport" class="mcp-import-area">
        <el-input
          v-model="mcpImportText"
          type="textarea"
          :rows="7"
          placeholder='{"mcpServers":{"drawio":{"command":"npx","args":["-y","@drawio/mcp"]}}}'
        />
        <el-button type="primary" size="small" :disabled="!mcpImportText.trim()" @click="importMcpJson">导入 JSON</el-button>
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
        <el-button size="small" @click="testMcp(s, { overrideTimeoutMs: 60000 })">再试一次(60秒超时)</el-button>
        <el-button size="small" type="danger" @click="removeMcp(s.id)">删除</el-button>
      </div>

      <!-- MCP 访问令牌（多令牌 + 每令牌工具权限） -->
      <div class="mcp-token-block">
        <div class="mcp-token-head">
          <div class="mcp-token-head-text">
            <div class="mcp-token-title">访问令牌（每个令牌独立限定工具权限）</div>
            <p class="mcp-token-desc">为外部 AI / MCP 客户端创建独立令牌，每个令牌只能调用勾选的工具；上方 HTTP 服务的主 Token 始终拥有全部权限，与这些令牌分开存放、互不影响。</p>
          </div>
          <el-button size="small" type="primary" @click="openTokenCreate">新增令牌</el-button>
        </div>
        <div v-if="!mcpTokens.length" class="mcp-token-empty">暂无访问令牌，点击「新增令牌」创建第一个受限权限令牌</div>
        <div v-for="t in mcpTokens" :key="t.id" class="mcp-token-row" :class="{ disabled: t.enabled === false }">
          <div class="mcp-token-main">
            <div class="mcp-token-name-line">
              <span class="mcp-token-name" :title="t.name">{{ t.name }}</span>
              <el-tag size="small" :type="t.enabled === false ? 'info' : 'success'">{{ t.enabled === false ? '已停用' : '启用中' }}</el-tag>
              <span class="mcp-token-tools" :title="tokenPermTooltip(t)">{{ tokenPermSummary(t) }}</span>
            </div>
            <div class="mcp-token-meta">
              <code class="mcp-token-value" :title="revealedMcpTokens[t.id] || maskToken(t.token)">{{ revealedMcpTokens[t.id] || maskToken(t.token) }}</code>
              <span class="mcp-token-time">{{ formatTokenTime(t.createdAt) }} 创建 · {{ t.lastUsedAt ? formatTokenTime(t.lastUsedAt) + ' 最近使用' : '从未使用' }}</span>
            </div>
          </div>
          <div class="mcp-token-actions">
            <el-button size="small" @click="revealMcpToken(t)">查看</el-button>
            <el-button size="small" @click="copyTokenWithAuth(t.token)">复制</el-button>
            <el-button size="small" @click="copyTokenInstallJson(t)">安装 JSON</el-button>
            <el-button size="small" @click="openTokenEdit(t)">编辑</el-button>
            <el-button size="small" @click="toggleTokenEnabled(t)">{{ t.enabled === false ? '启用' : '停用' }}</el-button>
            <el-button size="small" type="danger" @click="removeToken(t)">删除</el-button>
          </div>
        </div>
      </div>
    </div>

    <!-- Skills 管理 -->
    <div id="sec-skills" class="settings-section">
      <h3>Skills</h3>
      <p class="vision-desc">可维护多个技能。AI 可读取并执行技能指令；也可由 AI 根据对话沉淀为新技能。</p>
      <div class="profile-bar">
        <el-button size="small" @click="showSkillForm = !showSkillForm">{{ showSkillForm ? '收起新增' : '新增 Skill' }}</el-button>
        <el-button size="small" type="primary" @click="downloadSkillCreationGuide" title="把 SKILL.md 形式的「AI 能力扩展引导」下载到本地，方便分享给其他 AI 或备份">下载 Skill 创建指南</el-button>
        <el-button size="small" @click="openSkillDir">打开 Skill 目录</el-button>
      </div>
      <div
        class="custom-tools-drop skill-drop"
        @dragover.prevent="skillDragOver = true"
        @dragleave.prevent="skillDragOver = false"
        @drop.prevent="onSkillDrop"
      >
        <span>将 Skill 文件 / 文件夹拖到这里快速导入</span>
        <span class="custom-tools-drop-hint">支持 .zip 压缩包、.md 文档，以及包含 SKILL.md 的文件夹</span>
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
        <div class="skill-switches">
          <span class="skill-switch-label">启用</span>
          <el-switch v-model="s.enabled" size="small" />
          <span class="skill-switch-label">自动</span>
          <el-switch v-model="s.autoInvoke" size="small" title="自动调用" />
        </div>
        <el-button size="small" @click="saveSkill(s)">保存</el-button>
        <el-button size="small" type="danger" @click="removeSkill(s.id)">删除</el-button>
      </div>
    </div>

    <!-- 自定义工具目录 -->
    <div id="sec-custom-tools" class="settings-section">
      <h3>工具目录</h3>
      <p class="vision-desc">
        将自定义工具按规范放到工具目录后，AI 即可通过 list_custom_tools / call_custom_tool 调用。
      </p>
      <div class="profile-bar">
        <el-button size="small" @click="openCustomToolsDir">打开工具目录</el-button>
        <el-button size="small" @click="downloadCustomToolsSpec">下载编写规范</el-button>
        <el-button size="small" @click="loadCustomTools">刷新工具</el-button>
      </div>
      <div
        class="custom-tools-drop"
        @dragover.prevent="customToolDragOver = true"
        @dragleave.prevent="customToolDragOver = false"
        @drop.prevent="onCustomToolFolderDrop"
      >
        <span>将工具文件夹拖到这里快速添加</span>
        <span class="custom-tools-drop-hint">请拖入包含 tool.json 和 tool.js 的文件夹</span>
      </div>
      <div v-if="customTools.length === 0" class="mcp-skill-row" style="padding: 12px 0; color: var(--text-secondary);">
        暂未发现自定义工具。点击“下载编写规范”后按规范创建工具，再刷新即可。
      </div>
      <div v-for="t in customTools" :key="t.id" class="mcp-skill-row">
        <div class="mcp-skill-name">
          <span class="mcp-skill-title">{{ t.name || t.id }}</span>
          <span class="mcp-skill-id">{{ t.id }}<template v-if="!t.hasScript"> · 缺少 tool.js</template></span>
        </div>
        <div class="mcp-skill-desc">{{ t.description || '无描述' }}</div>
        <div class="skill-switches">
          <span class="skill-switch-label">启用</span>
          <el-switch v-model="t.enabled" size="small" @change="updateCustomTool(t, 'enabled', $event)" />
          <span class="skill-switch-label">自动</span>
          <el-switch v-model="t.autoInvoke" size="small" @change="updateCustomTool(t, 'autoInvoke', $event)" />
        </div>
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
      <p>my-mindmap agent v2.0.0</p>
      <p>基于 simple-mind-map + Vue3 + Electron</p>
      <p>本项目由 bubu-lzy 结合 AI 工具制作，基于思维导图二创。若有疑问请联系 2995136355@qq.com</p>
      <p>
        项目地址：
        <a
          href="https://github.com/bubu-LZY/my-mindmap-agent"
          class="about-link"
          @click.prevent="openExternalLink('https://github.com/bubu-LZY/my-mindmap-agent')"
        >https://github.com/bubu-LZY/my-mindmap-agent</a>
      </p>
      <p>
        项目介绍页：
        <a
          href="https://bubu-lzy.github.io/my-mindmap-agent/"
          class="about-link"
          @click.prevent="openExternalLink('https://bubu-lzy.github.io/my-mindmap-agent/')"
        >https://bubu-lzy.github.io/my-mindmap-agent/</a>
      </p>
    </div>
      </div><!-- .settings-content -->
    </div><!-- .settings-layout -->

    <!-- MCP 访问令牌：新建/编辑弹窗 -->
    <el-dialog v-model="tokenDialogVisible" :title="tokenDialog.isCreate ? '新增访问令牌' : '编辑访问令牌'" width="720px" append-to-body destroy-on-close>
      <el-form label-position="top" class="token-form">
        <el-form-item label="令牌名称">
          <el-input v-model="tokenDialog.name" placeholder="如：Trae 客户端（只读）" maxlength="30" show-word-limit />
        </el-form-item>
        <el-form-item>
          <div class="token-alltools-row">
            <el-checkbox v-model="tokenDialog.allTools">全部工具（不限制，等同主 Token 权限）</el-checkbox>
            <span v-if="!tokenDialog.isCreate" class="token-rotate-row">
              <el-checkbox v-model="tokenDialog.rotate">重置令牌值（令牌疑似泄露时勾选）</el-checkbox>
            </span>
          </div>
        </el-form-item>
        <el-form-item v-if="!tokenDialog.allTools" label="可用工具范围">
          <div class="token-perm-groups">
            <div class="token-perm-toolbar">
              <el-button size="small" text type="primary" @click="setReadonlyPermTools">只读类别</el-button>
              <el-button size="small" text type="primary" @click="setEditPermTools">编辑类别</el-button>
              <el-button size="small" text @click="setAllPermTools(true)">全选</el-button>
              <el-button size="small" text @click="setAllPermTools(false)">清空</el-button>
              <span class="token-perm-count">已选 {{ tokenSelectedCount }} / {{ tokenTotalCount }} 个工具</span>
            </div>
            <div v-for="g in tokenDialog.groups" :key="g.category" class="token-perm-group">
              <div class="token-perm-group-head">
                <span class="token-perm-group-title">{{ cnCategory(g.category) }}</span>
                <span class="token-perm-group-count">{{ checkedCountOfGroup(g) }}/{{ g.tools.length }}</span>
                <el-button size="small" text @click="toggleGroup(g)">{{ isGroupAllChecked(g) ? '取消全选' : '全选' }}</el-button>
              </div>
              <el-checkbox-group v-model="tokenDialog.checked" class="token-perm-group-body">
                <el-checkbox v-for="tool in g.tools" :key="tool.name" :value="tool.name" :title="tool.cnName ? tool.cnName + '（' + tool.name + '）' : tool.name">
                  <span class="token-tool-cn">{{ tool.cnName || tool.name }}</span>
                  <span v-if="tool.cnName" class="token-tool-en">{{ tool.name }}</span>
                </el-checkbox>
              </el-checkbox-group>
            </div>
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button size="small" @click="tokenDialogVisible = false">取消</el-button>
        <el-button size="small" type="primary" :disabled="!tokenDialog.name.trim()" @click="saveTokenDialog">保存</el-button>
      </template>
    </el-dialog>

    <!-- 密码门禁设置对话框 -->
    <el-dialog v-model="passwordDialogVisible" :title="passwordGateEnabled ? '修改密码' : '设置密码'" width="420px" append-to-body destroy-on-close @closed="resetPasswordForm">
      <el-form label-position="top">
        <el-form-item v-if="passwordGateEnabled" label="当前密码">
          <el-input v-model="passwordForm.oldPassword" type="password" show-password placeholder="请输入当前密码" />
        </el-form-item>
        <el-form-item label="新密码">
          <el-input v-model="passwordForm.newPassword" type="password" show-password placeholder="至少 6 位" />
        </el-form-item>
        <el-form-item label="确认新密码">
          <el-input v-model="passwordForm.confirmPassword" type="password" show-password placeholder="再次输入新密码" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button size="small" @click="passwordDialogVisible = false">取消</el-button>
        <el-button size="small" type="primary" :loading="passwordSaving" @click="savePassword">保存</el-button>
      </template>
    </el-dialog>

    <!-- 操作即验证弹窗（查看/重置 Token 前校验全局访问密码） -->
    <el-dialog v-model="authDialogVisible" title="验证访问密码" width="380px" append-to-body destroy-on-close>
      <el-form label-position="top">
        <el-form-item label="请输入全局访问密码">
          <el-input v-model="authPassword" type="password" show-password placeholder="访问密码" @keyup.enter="submitAuth" />
        </el-form-item>
      </el-form>
      <div v-if="authError" class="auth-error-text">{{ authError }}</div>
      <template #footer>
        <el-button size="small" @click="authDialogVisible = false">取消</el-button>
        <el-button size="small" type="primary" :loading="authVerifying" @click="submitAuth">验证</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { ElMessage } from 'element-plus'
import { aiService, providerPresets, autoCompleteURL, buildBaseURL, isVisionModel } from '../services/aiService'
import { DANGEROUS_TOOLS, getMcpToolPermissions } from '../services/toolHandler'
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
// 仅查看端口（多人共享只读查看屏幕）
const httpViewOnlyEnabled = ref(false)
const httpViewOnlyLoading = ref(false)
const httpViewOnlyStatus = ref(null)
const saveDir = ref('')

// ========== 密码门禁 ==========
const passwordGateEnabled = ref(false)
const passwordDialogVisible = ref(false)
const passwordSaving = ref(false)
const passwordForm = ref({ oldPassword: '', newPassword: '', confirmPassword: '' })
const passwordGateDesc = computed(() => passwordGateEnabled.value
  ? '已设置访问密码：启动需验证，30 分钟无操作后重新验证；连续 3 次输错锁定 5 分钟。'
  : '未设置密码：可设置访问密码，防止他人未经授权使用本应用。')

const loadPasswordGate = async () => {
  try {
    if (window.electronAPI?.passwordGate?.isEnabled) {
      const r = await window.electronAPI.passwordGate.isEnabled()
      passwordGateEnabled.value = !!r?.enabled
    }
  } catch (e) { /* 浏览器模式忽略 */ }
  // 仅在已设置密码时加载 token 汇总（未设密码则 Token 管理处于锁定态，不读取明文）
  if (passwordGateEnabled.value) {
    loadTokenOverview()
  }
}

const openPasswordDialog = () => {
  passwordForm.value = { oldPassword: '', newPassword: '', confirmPassword: '' }
  passwordDialogVisible.value = true
}

const resetPasswordForm = () => {
  passwordForm.value = { oldPassword: '', newPassword: '', confirmPassword: '' }
}

const savePassword = async () => {
  if (!(window.electronAPI?.passwordGate?.setPassword)) {
    ElMessage.warning('当前环境不支持该功能')
    return
  }
  const np = passwordForm.value.newPassword
  const cp = passwordForm.value.confirmPassword
  if (!np) { ElMessage.warning('请输入新密码'); return }
  if (np.length < 6) { ElMessage.warning('密码长度至少 6 位'); return }
  if (np !== cp) { ElMessage.warning('两次输入的新密码不一致'); return }
  passwordSaving.value = true
  try {
    const r = await window.electronAPI.passwordGate.setPassword(passwordForm.value.oldPassword, np)
    if (r?.success) {
      passwordGateEnabled.value = true
      passwordDialogVisible.value = false
      ElMessage.success('密码已设置')
      loadTokenOverview()
    } else {
      ElMessage.error(r?.error || '设置失败')
    }
  } catch (e) {
    ElMessage.error('设置失败：' + (e.message || e))
  } finally {
    passwordSaving.value = false
  }
}

// ========== 全局 Token 管理 ==========
// 操作即验证：查看/重置等敏感操作前弹密码校验
const authDialogVisible = ref(false)
const authPassword = ref('')
const authError = ref('')
const authVerifying = ref(false)
let authOnSuccess = null
// 已临时展示明文的 token（key -> 明文），10 秒后自动恢复掩码
const revealedTokens = ref({})
// Token 汇总列表
const tokenOverview = ref([])
// 本次设置会话内是否已解锁「全局 Token 管理」（退出设置重新进入后重置，需重新验证密码）
const tokenUnlocked = ref(false)

const requireAuth = (onSuccess) => {
  authOnSuccess = onSuccess
  authPassword.value = ''
  authError.value = ''
  authDialogVisible.value = true
}

const submitAuth = async () => {
  const pwd = authPassword.value
  if (!pwd) { authError.value = '请输入访问密码'; return }
  if (!(window.electronAPI?.passwordGate?.verifyPassword)) {
    authDialogVisible.value = false
    ElMessage.warning('当前环境不支持密码验证')
    return
  }
  authVerifying.value = true
  authError.value = ''
  try {
    const r = await window.electronAPI.passwordGate.verifyPassword(pwd)
    if (r?.success) {
      authDialogVisible.value = false
      authPassword.value = ''
      const cb = authOnSuccess
      authOnSuccess = null
      cb?.()
    } else {
      authError.value = r?.locked ? '尝试次数过多，已锁定 5 分钟' : (r?.error || '密码错误')
      authPassword.value = ''
    }
  } catch (e) {
    authError.value = '验证失败：' + (e.message || e)
  } finally {
    authVerifying.value = false
  }
}

// 汇总所有 token（仅掩码显示；明文不常驻前端，仅在"查看"验证密码后临时获取）
const loadTokenOverview = async () => {
  const list = []
  // HTTP 主 token（始终显示，含启用/停用状态）
  try {
    if (window.electronAPI?.httpServer?.getStatus) {
      const s = await window.electronAPI.httpServer.getStatus()
      const has = !!s?.token
      list.push({ key: 'http', name: 'HTTP 远程服务 Token', masked: has ? maskToken(s.token) : '未生成', enabled: !!s?.enabled, toggleType: 'http', has })
    }
  } catch (e) {}
  // 屏幕共享（仅查看）token
  try {
    if (window.electronAPI?.httpViewOnly?.getStatus) {
      const s = await window.electronAPI.httpViewOnly.getStatus()
      const has = !!s?.token
      list.push({ key: 'viewOnly', name: '屏幕共享（仅查看）Token', masked: has ? maskToken(s.token) : '未生成', enabled: !!s?.enabled, toggleType: 'viewOnly', has })
    }
  } catch (e) {}
  // MCP 访问令牌
  try {
    if (window.electronAPI?.mcpTokens?.list) {
      const r = await window.electronAPI.mcpTokens.list()
      for (const t of (r?.tokens || [])) {
        list.push({ key: 'mcp:' + t.id, name: `MCP 访问令牌：${t.name || '未命名'}`, masked: maskToken(t.token), mcpId: t.id, enabled: t.enabled !== false, toggleType: 'mcp' })
      }
    }
  } catch (e) {}
  tokenOverview.value = list
}

// 通过接口临时获取明文 token（不常驻内存）
const fetchPlainToken = async (item) => {
  try {
    if (item.key === 'http') {
      const s = await window.electronAPI.httpServer.getStatus()
      return s?.token || ''
    } else if (item.key === 'viewOnly') {
      const s = await window.electronAPI.httpViewOnly.getStatus()
      return s?.token || ''
    } else if (item.mcpId) {
      const r = await window.electronAPI.mcpTokens.list()
      return (r?.tokens || []).find(t => t.id === item.mcpId)?.token || ''
    }
  } catch (e) {}
  return ''
}

// 查看明文：验证密码后临时获取明文并短暂展示，10 秒后恢复掩码
const revealTokenItem = (item) => {
  requireAuth(async () => {
    const plain = await fetchPlainToken(item)
    if (!plain) { ElMessage.error('获取明文失败'); return }
    revealedTokens.value = { ...revealedTokens.value, [item.key]: plain }
    setTimeout(() => {
      const next = { ...revealedTokens.value }
      delete next[item.key]
      revealedTokens.value = next
    }, 10000)
  })
}

// 复制明文 token：进入「全局 Token 管理」已通过密码验证（解锁），直接复制明文，无需重复验证
const copyPlainToken = async (item) => {
  const plain = await fetchPlainToken(item)
  if (!plain) { ElMessage.error('获取 token 失败'); return }
  copyText(plain)
}

// 复制明文 token：需密码验证通过后才复制（用于 HTTP/屏幕共享/MCP 等处的「复制 Token」按钮）
const copyTokenWithAuth = (token) => {
  if (!token) return
  requireAuth(() => {
    copyText(token)
  })
}

// 重置 token：验证密码后立即失效旧 token
const resetTokenItem = (item) => {
  requireAuth(async () => {
    try {
      if (item.key === 'http') {
        if (window.electronAPI?.httpServer?.resetToken) {
          const s = await window.electronAPI.httpServer.resetToken()
          ElMessage.success('HTTP Token 已重置')
        }
      } else if (item.key === 'viewOnly') {
        if (window.electronAPI?.httpViewOnly?.resetToken) {
          await window.electronAPI.httpViewOnly.resetToken()
          ElMessage.success('仅查看 Token 已重置')
        }
      } else if (item.mcpId) {
        if (window.electronAPI?.mcpTokens?.update) {
          await window.electronAPI.mcpTokens.update(item.mcpId, { rotate: true })
          ElMessage.success('MCP Token 已重置')
        }
      }
      await loadTokenOverview()
    } catch (e) {
      ElMessage.error('重置失败：' + (e.message || e))
    }
  })
}

// 启用/停用 token：HTTP/仅查看联动服务开关，MCP 联动令牌 enabled
const toggleTokenService = async (item) => {
  const enabling = !item.enabled
  try {
    if (item.toggleType === 'http') {
      if (enabling && !passwordGateEnabled.value) {
        ElMessage.warning('请先在「全局管理访问密码」中设置密码，才能开启本地 HTTP 服务')
        return
      }
      if (!(window.electronAPI?.httpServer?.setEnabled)) return
      const s = await window.electronAPI.httpServer.setEnabled(enabling)
      item.enabled = !!s?.enabled
    } else if (item.toggleType === 'viewOnly') {
      if (enabling && !passwordGateEnabled.value) {
        ElMessage.warning('请先在「全局管理访问密码」中设置密码，才能开启屏幕共享')
        return
      }
      if (!(window.electronAPI?.httpViewOnly?.setEnabled)) return
      const s = await window.electronAPI.httpViewOnly.setEnabled(enabling)
      item.enabled = !!s?.enabled
    } else if (item.toggleType === 'mcp') {
      if (!(window.electronAPI?.mcpTokens?.update)) return
      const res = await window.electronAPI.mcpTokens.update(item.mcpId, { enabled: enabling })
      if (!res?.success) { ElMessage.error(res?.error || '操作失败'); return }
      item.enabled = enabling
    }
    await loadTokenOverview()
  } catch (e) {
    ElMessage.error('操作失败：' + (e.message || e))
  }
}

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
    if (status.running) loadMcpInstallInfo()
  } catch (e) {
    console.warn('读取 HTTP 服务状态失败:', e)
  }
}

const loadHttpViewOnly = async () => {
  if (!(window.electronAPI?.httpViewOnly?.getStatus)) return
  try {
    const status = await window.electronAPI.httpViewOnly.getStatus()
    httpViewOnlyStatus.value = status
    httpViewOnlyEnabled.value = !!status.enabled
  } catch (e) {
    console.warn('读取仅查看端口状态失败:', e)
  }
}

const viewOnlyShareLink = computed(() => {
  const status = httpViewOnlyStatus.value
  if (!status || !status.running) return ''
  const base = status.addresses && status.addresses[0] ? status.addresses[0] : ''
  return base || ''
})

const onHttpViewOnlyChange = async (enabled) => {
  // 开启本地 token 相关功能前必须先设置全局管理访问密码
  if (enabled && !passwordGateEnabled.value) {
    httpViewOnlyEnabled.value = false
    ElMessage.warning('请先在「全局管理访问密码」中设置密码，才能开启屏幕共享')
    return
  }
  if (!(window.electronAPI?.httpViewOnly?.setEnabled)) {
    httpViewOnlyEnabled.value = !enabled
    ElMessage.warning('当前环境不支持该功能')
    return
  }
  httpViewOnlyLoading.value = true
  try {
    const status = await window.electronAPI.httpViewOnly.setEnabled(enabled)
    httpViewOnlyStatus.value = status
    httpViewOnlyEnabled.value = !!status.enabled
    if (status.enabled) ElMessage.success('屏幕共享（仅查看）已开启')
    else ElMessage.success('屏幕共享（仅查看）已关闭')
  } catch (e) {
    httpViewOnlyEnabled.value = !enabled
    ElMessage.error('操作失败：' + (e.message || e))
  } finally {
    httpViewOnlyLoading.value = false
  }
}

// 仅查看端口允许局域网访问开关
const onHttpViewOnlyLanAccessChange = async (lanAccess) => {
  if (!(window.electronAPI?.httpViewOnly?.setLanAccess)) {
    ElMessage.warning('当前环境不支持该功能')
    return
  }
  httpViewOnlyLoading.value = true
  try {
    const status = await window.electronAPI.httpViewOnly.setLanAccess(lanAccess)
    httpViewOnlyStatus.value = status
    ElMessage.success(lanAccess ? '已开启局域网访问' : '已关闭局域网访问，仅本机可访问')
  } catch (e) {
    ElMessage.error('操作失败：' + (e.message || e))
  } finally {
    httpViewOnlyLoading.value = false
  }
}

// MCP 安装配置（外部 AI 客户端接入本程序工具）
const mcpInstallInfo = ref({ running: false, mcpUrl: '', installConfig: null, lanUrls: [] })
const loadMcpInstallInfo = async () => {
  if (!(window.electronAPI?.mcpServer?.getInstallConfig)) return
  try {
    const info = await window.electronAPI.mcpServer.getInstallConfig()
    mcpInstallInfo.value = info || { running: false, mcpUrl: '', installConfig: null, lanUrls: [] }
  } catch (e) {
    console.warn('读取 MCP 安装配置失败:', e)
  }
}

const copyMcpInstallJson = async () => {
  const info = mcpInstallInfo.value
  if (!info.running || !info.installConfig) {
    ElMessage.warning('请先开启本地 HTTP 服务')
    return
  }
  const json = JSON.stringify(info.installConfig, null, 2)
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(json)
    } else {
      const ta = document.createElement('textarea')
      ta.value = json
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    }
    ElMessage.success('已复制 MCP 安装 JSON（含 Token），粘贴到外部 AI 客户端的 MCP 配置即可')
  } catch (e) {
    ElMessage.error('复制失败')
  }
}

// ========== MCP 访问令牌管理（多令牌 + 每令牌工具权限） ==========
const mcpTokens = ref([])
const tokenDialogVisible = ref(false)
const tokenDialog = ref({ isCreate: true, id: '', name: '', allTools: false, rotate: false, groups: [], checked: [] })

const tokenPermGroupsRaw = (() => {
  try {
    const groups = getMcpToolPermissions()
    const out = []
    for (const [category, tools] of groups) out.push({ category, tools })
    return out
  } catch (e) {
    console.warn('读取 MCP 工具权限清单失败:', e)
    return []
  }
})()
const tokenTotalCount = tokenPermGroupsRaw.reduce((n, g) => n + g.tools.length, 0)

const tokenSelectedCount = computed(() => tokenDialog.value.checked.length)

const loadMcpTokens = async () => {
  if (!(window.electronAPI?.mcpTokens?.list)) return
  try {
    const res = await window.electronAPI.mcpTokens.list()
    mcpTokens.value = (res?.tokens || []).map(t => ({ ...t }))
  } catch (e) {
    console.warn('读取 MCP 访问令牌失败:', e)
  }
}

const formatTokenTime = (ts) => {
  if (!ts) return '-'
  try {
    const d = new Date(ts)
    const p = (x) => String(x).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
  } catch {
    return '-'
  }
}

const tokenPermSummary = (t) => {
  const allowed = t.allowedTools
  if (!Array.isArray(allowed) || !allowed.length) return '无可用工具'
  if (allowed.includes('*')) return '全部工具'
  return `${allowed.length} 个工具`
}

const tokenPermTooltip = (t) => {
  const allowed = t.allowedTools
  if (!Array.isArray(allowed) || !allowed.length) return '该令牌未勾选任何工具，调用任何工具都会被拒绝'
  if (allowed.includes('*')) return '该令牌可调用全部工具'
  return '可调用：' + allowed.join('、')
}

// 工具类目 → 中文（令牌权限勾选界面用）
const CATEGORY_CN = {
  AI: 'AI 智能', Assoc: '关联', Context: '上下文', Custom: '自定义', Discovery: '探索',
  Edit: '编辑', Export: '导出', Feishu: '飞书', File: '文件', KB: '知识库', MCP: 'MCP',
  Memory: '记忆', Meta: '元信息', Mindmap: '思维导图', 'Node Ops': '节点操作', Push: '推送',
  Query: '查询', Refs: '引用', Research: '研究', Scheduler: '定时任务', Skills: '技能',
  Study: '学习', Style: '样式', View: '视图', Web: '网络', Other: '其他'
}
const cnCategory = (cat) => CATEGORY_CN[cat] || String(cat || '其他')

const buildTokenDialog = (isCreate, entry) => {
  const allowed = Array.isArray(entry?.allowedTools) ? entry.allowedTools : []
  const allTools = allowed.includes('*')
  const checked = allTools ? [] : allowed.filter(x => x !== '*')
  const known = new Set()
  for (const g of tokenPermGroupsRaw) for (const t of g.tools) known.add(t.name)
  const groups = tokenPermGroupsRaw.map(g => ({ category: g.category, tools: g.tools.map(t => ({ ...t })) }))
  const unknown = checked.filter(n => !known.has(n))
  tokenDialog.value = {
    isCreate,
    id: entry?.id || '',
    name: entry?.name || '',
    allTools,
    rotate: false,
    groups,
    checked: unknown.length ? [...checked] : checked
  }
  if (unknown.length) {
    // 旧数据里勾选的工具在当前清单中不存在（版本间工具变动），归入 Other 组展示，避免静默丢失
    tokenDialog.value.groups.push({
      category: 'Other（历史勾选）',
      tools: unknown.map(n => ({ name: n, desc: '' }))
    })
  }
  tokenDialogVisible.value = true
}

const openTokenCreate = () => buildTokenDialog(true, null)
const openTokenEdit = (t) => buildTokenDialog(false, t)

const checkedCountOfGroup = (g) => g.tools.reduce((n, tool) => n + (tokenDialog.value.checked.includes(tool.name) ? 1 : 0), 0)
const isGroupAllChecked = (g) => g.tools.length > 0 && g.tools.every(tool => tokenDialog.value.checked.includes(tool.name))

const toggleGroup = (g) => {
  const set = new Set(tokenDialog.value.checked)
  if (isGroupAllChecked(g)) g.tools.forEach(tool => set.delete(tool.name))
  else g.tools.forEach(tool => set.add(tool.name))
  tokenDialog.value.checked = [...set]
}

const setAllPermTools = (on) => {
  if (on) {
    const all = []
    for (const g of tokenDialog.value.groups) g.tools.forEach(tool => all.push(tool.name))
    tokenDialog.value.checked = all
  } else {
    tokenDialog.value.checked = []
  }
}

// 只读工具：查询/读取/查看，不修改任何数据（按工具名前缀判断）
const READONLY_TOOL_PREFIXES = ['get_', 'query_', 'search_', 'list_', 'read_', 'retrieve_', 'audit_', 'find_']
// find_replace_text 为编辑（替换文本），虽以 find_ 开头但需排除
const READONLY_TOOL_EXCLUDE = ['find_replace_text']
const isReadonlyTool = (name) => {
  if (READONLY_TOOL_EXCLUDE.includes(name)) return false
  return READONLY_TOOL_PREFIXES.some(p => name.startsWith(p))
}

// 快捷勾选只读类工具
const setReadonlyPermTools = () => {
  const names = tokenPermGroupsRaw.flatMap(g => g.tools.map(t => t.name)).filter(isReadonlyTool)
  tokenDialog.value.checked = [...names]
}

// 快捷勾选编辑类工具（非只读）
const setEditPermTools = () => {
  const names = tokenPermGroupsRaw.flatMap(g => g.tools.map(t => t.name)).filter(n => !isReadonlyTool(n))
  tokenDialog.value.checked = [...names]
}

const saveTokenDialog = async () => {
  // 创建/管理本地访问令牌前必须先设置全局管理访问密码
  if (!passwordGateEnabled.value) {
    ElMessage.warning('请先在「全局管理访问密码」中设置密码，才能创建/管理访问令牌')
    return
  }
  const api = window.electronAPI?.mcpTokens
  if (!api) { ElMessage.error('当前环境不支持令牌管理'); return }
  const d = tokenDialog.value
  const name = d.name.trim()
  if (!name) { ElMessage.warning('请填写令牌名称'); return }
  const allowedTools = d.allTools ? ['*'] : [...new Set(d.checked)]
  if (!d.allTools && !allowedTools.length) {
    ElMessage.warning('未勾选任何工具，该令牌将无法调用任何工具；如需全部权限请勾选「全部工具」')
    return
  }
  try {
    let res
    if (d.isCreate) {
      res = await api.create({ name, allowedTools })
    } else {
      const patch = { name, allowedTools }
      if (d.rotate) patch.rotate = true
      res = await api.update(d.id, patch)
    }
    if (!res?.success) { ElMessage.error(res?.error || '保存失败'); return }
    tokenDialogVisible.value = false
    let copied = false
    if (d.isCreate && res.token?.token) copied = await silentCopyText(res.token.token)
    await loadMcpTokens()
    loadTokenOverview() // 同步刷新「全局 Token 管理」汇总
    ElMessage.success(d.isCreate ? (copied ? '令牌已创建，令牌值已复制到剪切板' : '令牌已创建，请手动复制令牌值') : '令牌已更新')
  } catch (e) {
    ElMessage.error('保存失败: ' + (e.message || '未知错误'))
  }
}

// 已临时展示明文的 MCP 令牌（id -> 明文），10 秒后恢复掩码
const revealedMcpTokens = ref({})

// 查看 MCP 令牌明文：验证密码后短暂展示，10 秒后恢复掩码
const revealMcpToken = (t) => {
  requireAuth(() => {
    revealedMcpTokens.value = { ...revealedMcpTokens.value, [t.id]: t.token }
    setTimeout(() => {
      const next = { ...revealedMcpTokens.value }
      delete next[t.id]
      revealedMcpTokens.value = next
    }, 10000)
  })
}

const toggleTokenEnabled = async (t) => {
  const api = window.electronAPI?.mcpTokens
  if (!api) return
  try {
    const next = t.enabled === false
    const res = await api.update(t.id, { enabled: next })
    if (!res?.success) { ElMessage.error(res?.error || '操作失败'); return }
    t.enabled = next
    ElMessage.success(next ? `「${t.name}」已启用` : `「${t.name}」已停用`)
  } catch (e) {
    ElMessage.error('操作失败: ' + (e.message || '未知错误'))
  }
}

const removeToken = async (t) => {
  const api = window.electronAPI?.mcpTokens
  if (!api) return
  try {
    const { ElMessageBox } = await import('element-plus')
    await ElMessageBox.confirm(`确定删除令牌「${t.name}」？使用该令牌的外部客户端将立即失去访问权限。`, '删除令牌', { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' })
  } catch { return }
  try {
    const res = await api.remove(t.id)
    if (!res?.success) { ElMessage.error(res?.error || '删除失败'); return }
    await loadMcpTokens()
    loadTokenOverview()
    ElMessage.success(`令牌「${t.name}」已删除`)
  } catch (e) {
    ElMessage.error('删除失败: ' + (e.message || '未知错误'))
  }
}

const copyTokenInstallJson = async (t) => {
  const api = window.electronAPI?.mcpTokens
  if (!api?.installConfig) return
  try {
    const res = await api.installConfig(t.id)
    if (!res?.success || !res.installConfig) {
      ElMessage.warning(res?.running === false || !res?.port ? '请先开启本地 HTTP 服务' : (res?.error || '生成安装配置失败'))
      return
    }
    const json = JSON.stringify(res.installConfig, null, 2)
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(json)
    } else {
      const ta = document.createElement('textarea')
      ta.value = json
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    }
    ElMessage.success(`已复制「${t.name}」的 MCP 安装 JSON（仅含该令牌勾选的工具权限）`)
  } catch (e) {
    ElMessage.error('复制失败: ' + (e.message || '未知错误'))
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
  // 开启本地 token 相关功能前必须先设置全局管理访问密码
  if (enabled && !passwordGateEnabled.value) {
    httpServerEnabled.value = false
    ElMessage.warning('请先在「全局管理访问密码」中设置密码，才能开启本地 HTTP 服务')
    return
  }
  if (!(window.electronAPI?.httpServer?.setEnabled)) {
    httpServerEnabled.value = !enabled
    return
  }
  httpServerLoading.value = true
  try {
    const status = await window.electronAPI.httpServer.setEnabled(enabled)
    httpServerStatus.value = status
    httpServerEnabled.value = !!status.enabled
    if (enabled) {
      await loadMcpInstallInfo()
    } else {
      mcpInstallInfo.value = { running: false, mcpUrl: '', installConfig: null, lanUrls: [] }
    }
    ElMessage.success(enabled ? '本地 HTTP 服务已开启' : '本地 HTTP 服务已关闭')
  } catch (e) {
    httpServerEnabled.value = !enabled
    ElMessage.error(`HTTP 服务设置失败: ${e.message || '未知错误'}`)
  } finally {
    httpServerLoading.value = false
  }
}

// 允许局域网访问开关（修改后主进程会重启服务以应用新监听地址）
const onHttpLanAccessChange = async (lanAccess) => {
  if (!(window.electronAPI?.httpServer?.setLanAccess)) {
    ElMessage.warning('当前环境不支持该功能')
    return
  }
  httpServerLoading.value = true
  try {
    const status = await window.electronAPI.httpServer.setLanAccess(lanAccess)
    httpServerStatus.value = status
    await loadMcpInstallInfo()
    ElMessage.success(lanAccess ? '已开启局域网访问' : '已关闭局域网访问，仅本机可访问')
  } catch (e) {
    ElMessage.error(`局域网访问设置失败: ${e.message || '未知错误'}`)
  } finally {
    httpServerLoading.value = false
  }
}

// 掩码显示敏感令牌：显示前 4 位 + **** + 后 4 位
const maskToken = (token) => {
  if (!token || typeof token !== 'string') return ''
  if (token.length <= 8) return '****'
  return token.slice(0, 4) + '****' + token.slice(-4)
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

// 静默复制（不弹提示）：用于创建令牌后自动复制令牌值，避免与后续成功提示叠加
const silentCopyText = async (text) => {
  if (!text) return false
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
    return true
  } catch {
    return false
  }
}

const copyHttpSkill = async () => {
  const status = httpServerStatus.value
  if (!status || !status.running || !status.token) {
    ElMessage.warning('请先开启本地 HTTP 服务')
    return
  }
  const addr = (status.addresses && status.addresses[0]) || `http://127.0.0.1:${status.port}`
  const token = status.token
  const skill = `---
name: my-mindmap-agent-api
description: Call the local my-mindmap agent over HTTP to execute mind-map and AI tasks from another agent.
---

# my-mindmap-agent API

Base URL: ${addr}
Token: ${token}

## Call

POST ${addr}/api/agent/chat

Headers:
Content-Type: application/json
Authorization: Bearer ${token}

Body:
{"message":"你的指令","source":"other-agent"}

Example:
curl -X POST "${addr}/api/agent/chat" -H "Content-Type: application/json" -H "Authorization: Bearer ${token}" -d '{"message":"生成一张关于时间管理的思维导图","source":"other-agent"}'

## Status check
GET ${addr}/api/status?token=${token}

## Rules
- Main app must be running and HTTP service enabled.
- Main window closed => HTTP 503. A minimized window remains online and controllable.
- Token invalid/expired => HTTP 401.
- Timeout at least 120 seconds.
- If the task creates/saves/renames/moves/exports/modifies a file, the final reply must include the absolute filePath.
`
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(skill)
    } else {
      const ta = document.createElement('textarea')
      ta.value = skill
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    }
    ElMessage.success('已将此技能和token复制到剪切板中，请注意使用安全')
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

// 在默认浏览器中打开外部链接（关于页面的项目地址/项目介绍页）
const openExternalLink = async (url) => {
  if (!url) return
  try {
    if (window.electronAPI && typeof window.electronAPI.openExternal === 'function') {
      await window.electronAPI.openExternal(url)
    } else if (typeof window !== 'undefined') {
      window.open(url, '_blank', 'noopener,noreferrer')
    }
  } catch (e) {
    console.error('打开外部链接失败:', e)
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
// 配置是否已从主进程加载完成（加载中避免误显示「请先新增一个配置档」）
const configLoading = ref(true)

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

// AI 请求超时时长（秒，默认 300 = 5 分钟）
const aiTimeoutSeconds = ref(300)
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
  // 掩码 key 的归属档：多模态档自身有 key 用自身 id，否则回退基础档 id（供主进程查真实 key）
  const profileId = profile.apiKey ? profile.id : baseP?.id || ''
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
    const result = await window.electronAPI.testVisionModel(baseURL, apiKey, model, autoComplete, profileId)
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
      if (window.electronAPI.getAiTimeout) {
        const t = Number(await window.electronAPI.getAiTimeout())
        aiTimeoutSeconds.value = Number.isFinite(t) && t > 0 ? t : 300
      }
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
  } finally {
    configLoading.value = false
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
  config.value.profiles.push({ id, name: '', baseURL: '', apiKey: '', model: '', type: 'vision', autoComplete: true, filesURL: '' })
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
        activeProfile.value.apiKey,
        activeProfile.value.id
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
    // 临时设置配置用于测试（不持久化）；apiKey 由主进程按 profileId 注入，前端只传档 id
    aiService.setConfig({
      baseURL: activeProfile.value.baseURL,
      profileId: activeProfile.value.id,
      model: activeProfile.value.model,
      autoComplete: activeProfile.value.autoComplete !== false
    })
    // 用户刚填的明文 key（非掩码）直接用于测试；掩码则走主进程按 profileId 注入
    const rawKey = activeProfile.value.apiKey || ''
    const result = await aiService.testConnection(rawKey.includes('****') ? '' : rawKey)
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
  // 掩码 key 的归属档：多模态档自身有 key 用自身 id，否则回退基础档 id
  const profileId = profile.apiKey ? profile.id : baseP?.id || ''
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
    const result = await window.electronAPI.fetchModels(baseURL, apiKey, profileId)
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

const saveAiTimeout = async () => {
  if (!(window.electronAPI && window.electronAPI.setAiTimeout)) {
    ElMessage.warning('当前为浏览器模式，无法保存 AI 超时配置（请使用桌面应用）')
    return
  }
  try {
    const s = Math.min(Math.max(Number(aiTimeoutSeconds.value) || 300, 30), 3600)
    aiTimeoutSeconds.value = s
    await window.electronAPI.setAiTimeout(s)
    ElMessage.success(`AI 请求超时已保存（${s} 秒）`)
  } catch (e) {
    ElMessage.error('保存失败: ' + e.message)
  }
}

const saveVisionConfig = () => saveConfig('vision')

// ========== MCP 管理 ==========
const mcpServers = ref([])
const showMcpForm = ref(false)
const showMcpImport = ref(false)
const mcpImportText = ref('')
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

const importMcpJson = async () => {
  if (!window.electronAPI?.mcp?.list || !window.electronAPI?.mcp?.create || !window.electronAPI?.mcp?.update) return
  let parsed
  try {
    parsed = JSON.parse(mcpImportText.value)
  } catch (e) {
    ElMessage.error('JSON 解析失败：' + e.message)
    return
  }
  const source = parsed && typeof parsed === 'object'
    ? (parsed.mcpServers || parsed.servers || parsed)
    : null
  if (!source || typeof source !== 'object') {
    ElMessage.error('JSON 中未找到 mcpServers 或 servers')
    return
  }
  const existing = await window.electronAPI.mcp.list()
  let created = 0
  let updated = 0
  try {
    for (const [name, raw] of Object.entries(source)) {
      if (!raw || typeof raw !== 'object') continue
      const cfg = {
        name,
        transport: raw.url ? 'http' : 'stdio',
        url: raw.url || '',
        command: raw.command || '',
        args: Array.isArray(raw.args) ? raw.args.map(String) : [],
        env: raw.env && typeof raw.env === 'object' ? raw.env : {},
        headers: raw.headers && typeof raw.headers === 'object' ? raw.headers : {},
        enabled: raw.disabled !== true
      }
      const found = existing.find(s => s.name === name)
      if (found) {
        await window.electronAPI.mcp.update(found.id, cfg)
        updated++
      } else {
        await window.electronAPI.mcp.create(cfg)
        created++
      }
    }
  } catch (e) {
    ElMessage.error('导入失败：' + e.message)
    return
  }
  mcpImportText.value = ''
  showMcpImport.value = false
  await loadMcp()
  ElMessage.success(`已导入 MCP 配置：新增 ${created} 个，更新 ${updated} 个`)
}

const saveMcp = async (server) => {
  if (!window.electronAPI?.mcp?.update) return
  try { await window.electronAPI.mcp.update(server.id, server); ElMessage.success('MCP 服务已保存') } catch (e) { ElMessage.error('保存失败: ' + e.message) }
}

const removeMcp = async (id) => {
  if (!window.electronAPI?.mcp?.remove) return
  try { await window.electronAPI.mcp.remove(id); await loadMcp(); ElMessage.success('MCP 服务已删除') } catch (e) { ElMessage.error('删除失败: ' + e.message) }
}

// 测试单条 MCP 服务：首次拉取失败（主进程内部已自动按 60 秒重试一次）若仍失败，
// 在界面上提供"再试一次（60 秒超时）"按钮方便用户手动重试。
const testMcp = async (server, opts = {}) => {
  if (!window.electronAPI?.mcp?.listTools) return
  const overrideTimeoutMs = Number(opts.overrideTimeoutMs)
  try {
    const tools = await window.electronAPI.mcp.listTools(server.id, Number.isFinite(overrideTimeoutMs) && overrideTimeoutMs > 0 ? overrideTimeoutMs : 0)
    if (Number.isFinite(overrideTimeoutMs) && overrideTimeoutMs > 0) {
      ElMessage.success(`重试连接成功，发现 ${tools.length} 个工具（已临时使用 ${Math.round(overrideTimeoutMs / 1000)} 秒超时）`)
    } else {
      ElMessage.success(`连接成功，发现 ${tools.length} 个工具`)
    }
  } catch (e) {
    const msg = (e && e.message) ? e.message : '未知错误'
    // 区分：超时错误展示详细提示 + 重试按钮；其他错误直接显示
    const isTimeout = /超时|timeout/i.test(msg) || (e && e.code === 'MCP_TIMEOUT')
    if (isTimeout) {
      ElMessage({
        type: 'error',
        message: msg + '\n\n可点「再试一次（60 秒超时）」继续拉取',
        duration: 12000,
        dangerouslyUseHTMLString: false
      })
    } else {
      ElMessage.error('连接失败: ' + msg)
    }
  }
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
    await window.electronAPI.skills.create({ ...newSkill.value })
    newSkill.value = { name: '', description: '', instructions: '', enabled: true, autoInvoke: false, source: 'manual' }
    showSkillForm.value = false
    await loadSkills()
    ElMessage.success('Skill 已添加')
  } catch (e) { ElMessage.error('新增 Skill 失败: ' + e.message) }
}

const saveSkill = async (skill) => {
  if (!window.electronAPI?.skills?.update) return
  try { await window.electronAPI.skills.update(skill.id, { ...skill }); ElMessage.success('Skill 已保存') } catch (e) { ElMessage.error('保存失败: ' + e.message) }
}

const removeSkill = async (id) => {
  if (!window.electronAPI?.skills?.remove) return
  try { await window.electronAPI.skills.remove(id); await loadSkills(); ElMessage.success('Skill 已删除') } catch (e) { ElMessage.error('删除失败: ' + e.message) }
}

const skillDragOver = ref(false)

const openSkillDir = async () => {
  if (!window.electronAPI?.skills?.openDir) return
  try {
    const res = await window.electronAPI.skills.openDir()
    if (res && !res.ok) ElMessage.error(`打开目录失败：${res.error || '未知错误'}`)
  } catch (e) { ElMessage.error('打开 Skill 目录失败') }
}

// 下载「AI 能力扩展引导」Skill 的 SKILL.md 到用户选定的位置（用于分享给其他 AI 或备份）
const downloadSkillCreationGuide = async () => {
  if (!window.electronAPI?.skills?.getBuiltinGuideContent || !window.electronAPI?.dialog?.showSaveDialog) {
    ElMessage.error('当前环境不支持导出 Skill 文档')
    return
  }
  try {
    const r = await window.electronAPI.skills.getBuiltinGuideContent()
    if (!r || !r.ok) { ElMessage.error('读取内置指南失败：' + (r && r.error || '未知错误')); return }
    const target = await window.electronAPI.dialog.showSaveDialog({
      title: '保存 Skill 创建指南',
      defaultPath: 'SKILL.md',
      filters: [{ name: 'Markdown', extensions: ['md'] }]
    })
    if (!target || target.canceled || !target.filePath) return
    const content = String(r.content || '')
    // 复用 save-file：传绝对路径即可写到任意位置
    if (window.electronAPI.saveFile) {
      const res = await window.electronAPI.saveFile(target.filePath, content, { overwrite: true })
      if (res && res.success) {
        ElMessage.success(`已下载到：${res.filePath || target.filePath}`)
        return
      }
      ElMessage.error('保存失败：' + (res && res.error || '未知错误'))
      return
    }
    // 兜底：fetch + showSaveDialog 已经在主进程给了路径，但前端没原生 fs；用 fs:writeFile
    if (window.electronAPI.fs && window.electronAPI.fs.writeFile) {
      const ok = await window.electronAPI.fs.writeFile(target.filePath, content)
      if (ok) ElMessage.success(`已下载到：${target.filePath}`)
      else ElMessage.error('保存失败')
      return
    }
    ElMessage.error('当前环境不支持保存文件')
  } catch (e) {
    ElMessage.error('下载失败：' + (e.message || '未知错误'))
  }
}

const readFileAsBase64 = (file) => new Promise((res, rej) => {
  const fr = new FileReader()
  fr.onload = () => res(String(fr.result || '').split(',')[1] || '')
  fr.onerror = rej
  fr.readAsDataURL(file)
})

// 递归读取目录 entry，产出 [{ name, relativePath, base64 }]
const readSkillEntry = (dirEntry, parentPath = '') => new Promise((resolve, reject) => {
  const reader = dirEntry.createReader()
  const all = []
  const readBatch = () => {
    reader.readEntries(async (entries) => {
      if (!entries.length) {
        const out = []
        for (const e of all) {
          if (e.isFile) {
            const file = await new Promise((res, rej) => e.file((f) => res(f), rej))
            const base64 = await readFileAsBase64(file)
            out.push({ name: e.name, relativePath: parentPath ? `${parentPath}/${e.name}` : e.name, base64 })
          } else if (e.isDirectory) {
            const sub = await readSkillEntry(e, parentPath ? `${parentPath}/${e.name}` : e.name)
            out.push(...sub)
          }
        }
        resolve(out)
        return
      }
      all.push(...entries)
      readBatch()
    }, reject)
  }
  readBatch()
})

const onSkillDrop = async (event) => {
  skillDragOver.value = false
  if (!window.electronAPI?.skills?.import) { ElMessage.error('当前环境不支持 Skill 导入'); return }
  const collected = []
  try {
    const items = Array.from(event.dataTransfer?.items || [])
    const entries = items
      .filter(it => it.kind === 'file')
      .map(it => (typeof it.webkitGetAsEntry === 'function' ? it.webkitGetAsEntry() : null))
      .filter(Boolean)
    if (entries.length) {
      for (const entry of entries) {
        if (entry.isFile) {
          const file = await new Promise((res, rej) => entry.file((f) => res(f), rej))
          collected.push({ name: entry.name, relativePath: entry.name, base64: await readFileAsBase64(file) })
        } else if (entry.isDirectory) {
          const sub = await readSkillEntry(entry, entry.name)
          collected.push(...sub)
        }
      }
    } else {
      for (const file of Array.from(event.dataTransfer?.files || [])) {
        collected.push({ name: file.name, relativePath: file.name, base64: await readFileAsBase64(file) })
      }
    }
    if (!collected.length) { ElMessage.warning('未识别到可导入的文件'); return }
    const hasMd = collected.some(f => /\.md$/i.test(f.name))
    const hasZip = collected.some(f => /\.zip$/i.test(f.name))
    if (!hasMd && !hasZip) {
      ElMessage.warning('未发现 .md 或 .zip 文件，请拖入 Skill 文档、压缩包或包含 SKILL.md 的文件夹')
      return
    }
    const res = await window.electronAPI.skills.import(collected)
    if (!res?.ok) throw new Error(res?.error || '导入失败')
    ElMessage.success(`成功导入 ${res.count || 0} 个 Skill`)
    await loadSkills()
  } catch (e) {
    ElMessage.error(`导入 Skill 失败：${e.message || '未知错误'}`)
  }
}

// ========== 自定义工具目录管理 ==========
const customTools = ref([])
const customToolDragOver = ref(false)

const loadCustomTools = async () => {
  if (!window.electronAPI?.customTools?.list) return
  try {
    customTools.value = await window.electronAPI.customTools.list()
  } catch (e) {
    customTools.value = []
  }
}

const openCustomToolsDir = async () => {
  if (!window.electronAPI?.customTools?.openDir) return
  try {
    const res = await window.electronAPI.customTools.openDir()
    if (res && !res.ok) ElMessage.error(`打开目录失败：${res.error || '未知错误'}`)
  } catch (e) {
    ElMessage.error('打开工具目录失败')
  }
}

const downloadCustomToolsSpec = async () => {
  if (!window.electronAPI?.customTools?.saveSpec) return
  try {
    const res = await window.electronAPI.customTools.saveSpec()
    if (!res || !res.ok) {
      ElMessage.error(`保存规范失败：${res?.error || '未知错误'}`)
      return
    }
    ElMessage.success(`编写规范已保存到工具目录：${res.path}`)
    await openCustomToolsDir()
  } catch (e) {
    ElMessage.error('下载编写规范失败')
  }
}

const updateCustomTool = async (tool, field, value) => {
  if (!window.electronAPI?.customTools?.update) return
  try {
    await window.electronAPI.customTools.update(tool.id, { [field]: value })
    ElMessage.success('工具设置已保存')
    await loadCustomTools()
  } catch (e) {
    ElMessage.error(`保存工具设置失败：${e.message || '未知错误'}`)
    await loadCustomTools()
  }
}

const onCustomToolFolderDrop = async (event) => {
  customToolDragOver.value = false
  const items = Array.from(event.dataTransfer?.items || [])
  const entry = items.find(item => item.kind === 'file' && typeof item.webkitGetAsEntry === 'function')?.webkitGetAsEntry()
  if (!entry || !entry.isDirectory) {
    ElMessage.warning('请拖入一个工具文件夹（文件夹内需包含 tool.json 和 tool.js）')
    return
  }
  const files = []
  const readEntry = (dirEntry, parentPath = '') => new Promise((resolve, reject) => {
    const reader = dirEntry.createReader()
    const all = []
    const readBatch = () => {
      reader.readEntries(async (entries) => {
        if (!entries.length) {
          for (const e of all) {
            if (e.isFile) {
              const file = await new Promise((res, rej) => e.file((f) => res(f), rej))
              const data = await new Promise((res, rej) => {
                const fr = new FileReader()
                fr.onload = () => res(String(fr.result || '').split(',')[1] || '')
                fr.onerror = rej
                fr.readAsDataURL(file)
              })
              files.push({ relativePath: parentPath ? `${parentPath}/${e.name}` : e.name, base64: data })
            } else if (e.isDirectory) {
              await readEntry(e, parentPath ? `${parentPath}/${e.name}` : e.name)
            }
          }
          resolve()
          return
        }
        all.push(...entries)
        readBatch()
      }, reject)
    }
    readBatch()
  })
  try {
    await readEntry(entry)
    if (!files.some(f => /(^|\/)tool\.json$/i.test(f.relativePath))) {
      ElMessage.warning('该文件夹中没有 tool.json，请放入规范要求的工具文件夹')
      return
    }
    const res = await window.electronAPI.customTools.importFolder(entry.name, files)
    if (!res?.ok) throw new Error(res?.error || '导入失败')
    ElMessage.success(`已导入工具文件夹：${res.dir}`)
    await loadCustomTools()
  } catch (e) {
    ElMessage.error(`导入工具失败：${e.message || '未知错误'}`)
  }
}

// ========== 侧边目录导航 ==========
const tocSections = [
  { id: 'sec-ai-config', label: 'AI 模型配置' },
  { id: 'sec-temperature', label: 'AI temperature 设置' },
  { id: 'sec-vision', label: '多模态识别' },
  { id: 'sec-safety', label: 'AI 安全与记忆' },
  { id: 'sec-system', label: '系统' },
  { id: 'sec-token', label: '全局 Token 管理' },
  { id: 'sec-password', label: '全局管理访问密码' },
  { id: 'sec-mcp', label: 'MCP 服务' },
  { id: 'sec-skills', label: 'Skills' },
  { id: 'sec-custom-tools', label: '工具目录' },
  { id: 'sec-integrations', label: '三方集成' },
  { id: 'sec-messages', label: '消息中心' },
  { id: 'sec-about', label: '关于' }
]
const activeSection = ref('sec-ai-config')

const scrollToSection = (id) => {
  const doScroll = () => {
    const el = document.getElementById(id)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      activeSection.value = id
    }
  }
  // 进入「全局 Token 管理」目录：未设密码直接滚动（显示锁定提示）；
  // 已设密码但未解锁 → 先验证密码，验证通过后解锁并加载；已解锁 → 直接滚动（不再重复验证）
  if (id === 'sec-token') {
    if (!passwordGateEnabled.value) {
      doScroll()
      return
    }
    if (tokenUnlocked.value) {
      doScroll()
      return
    }
    requireAuth(() => { loadTokenOverview(); tokenUnlocked.value = true; doScroll() })
    return
  }
  doScroll()
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
  loadPasswordGate()
  loadSaveDir()
  loadHttpServer()
  loadHttpViewOnly()
  loadMcp()
  loadMcpTokens()
  loadSkills()
  loadCustomTools()
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
  /* 性能：开启 GPU 合成层，让滚动只在合成线程跑，不触发主线程 reflow */
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
  padding: 0;
  background: linear-gradient(180deg, #f5f5f7 0%, #ffffff 100%);
  /* 自定义滚动条：更细，不抢视觉 */
  scrollbar-gutter: stable;
}
.settings-view::-webkit-scrollbar { width: 8px; }
.settings-view::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.18); border-radius: 4px; }
.settings-view::-webkit-scrollbar-thumb:hover { background: rgba(0,0,0,0.32); }

.settings-layout {
  display: flex;
  min-height: 100%;
}

/* ---------- 侧边粘性目录 ---------- */
.settings-toc {
  position: sticky;
  top: 12px;
  width: 150px;
  min-width: 150px;
  align-self: flex-start;
  height: fit-content;
  max-height: calc(100vh - 24px);
  padding: 12px 0;
  margin: 12px 0 0 16px;
  background: transparent;
  /* contain: paint 让 sticky 元素只在自己的合成层重绘 */
  contain: layout paint;
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
  transition: background-color 0.2s, color 0.2s, border-color 0.2s, background-position 0.2s;
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
  background: #ffffff;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 12px;
  padding: 24px;
  margin-bottom: 16px;
  /* 关键性能优化：contain 隔离每节渲染区域，避免 14 节叠加触发全页重绘 */
  contain: layout style paint;
  /* 提前合成层（仅在 GPU 内存允许时生效），避免 scroll 时逐帧重绘 */
  content-visibility: auto;
  contain-intrinsic-size: auto 600px;
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

.lan-access-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
}
.lan-access-label {
  font-size: 13px;
  color: var(--text-primary, #1d1d1f);
  font-weight: 500;
}
.lan-access-hint {
  font-size: 12px;
  color: var(--text-tertiary, #a1a1a6);
}

.token-lock-hint {
  padding: 14px 16px;
  background: #fff7e6;
  border: 1px solid #ffe4b3;
  border-radius: 8px;
  color: #b87700;
  font-size: 13px;
  line-height: 1.6;
}
.token-overview-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.token-overview-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 14px;
  border: 1px solid var(--border-color, #e4e4e9);
  border-radius: 8px;
}
.token-overview-row.disabled {
  opacity: 0.6;
}
.token-overview-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.token-overview-name {
  font-size: 13px;
  color: var(--text-primary, #1d1d1f);
  font-weight: 500;
}
.token-overview-value {
  font-size: 12px;
  color: var(--text-secondary, #6e6e73);
  word-break: break-all;
  background: #f5f5f7;
  padding: 3px 8px;
  border-radius: 4px;
}
.token-overview-actions {
  flex-shrink: 0;
  display: flex;
  gap: 6px;
}
.auth-error-text {
  color: #ff3b30;
  font-size: 12.5px;
  margin-top: 8px;
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

.http-server-skill-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
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
  transition: background-color 0.2s, color 0.2s, border-color 0.2s, box-shadow 0.2s;
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

/* 关于区块的可点击链接 */
.about-link {
  color: #007aff;
  cursor: pointer;
  text-decoration: underline;
  word-break: break-all;
}
.about-link:hover {
  color: #0066d6;
  text-decoration: none;
}

.mcp-skill-row,
.skill-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 0;
  border-bottom: 1px solid rgba(0, 0, 0, 0.05);
}

.mcp-import-area {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 8px 0;
}

.custom-tools-drop {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  margin: 10px 0;
  padding: 16px;
  border: 1px dashed rgba(0, 122, 255, 0.35);
  border-radius: 10px;
  background: rgba(0, 122, 255, 0.04);
  color: var(--text-secondary, #6e6e73);
  font-size: 13px;
  text-align: center;
}

.custom-tools-drop:hover {
  border-color: rgba(0, 122, 255, 0.7);
  background: rgba(0, 122, 255, 0.08);
}

.custom-tools-drop-hint {
  font-size: 11px;
  color: var(--text-tertiary, #a1a1a6);
}

.mcp-skill-row .mini,
.skill-row .mini {
  width: 150px;
  flex: 0 0 auto;
}

/* ========== MCP 访问令牌管理 ========== */
.mcp-token-block {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid rgba(0, 0, 0, 0.06);
}

.mcp-token-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}

.mcp-token-head-text {
  flex: 1 1 auto;
  min-width: 0;
}

.mcp-token-title {
  font-weight: 600;
  font-size: 13.5px;
  color: var(--text-primary, #1d1d1f);
}

.mcp-token-desc {
  margin: 3px 0 0;
  font-size: 12px;
  line-height: 1.55;
  color: var(--text-secondary, #6e6e73);
}

.mcp-token-empty {
  padding: 14px;
  border: 1px dashed rgba(0, 0, 0, 0.12);
  border-radius: 8px;
  color: var(--text-tertiary, #a1a1a6);
  font-size: 12.5px;
  text-align: center;
}

.mcp-token-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid rgba(0, 0, 0, 0.05);
}

.mcp-token-row.disabled {
  opacity: 0.55;
}

.mcp-token-main {
  flex: 1 1 auto;
  min-width: 0;
}

.mcp-token-name-line {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.mcp-token-name {
  font-weight: 600;
  font-size: 13px;
  color: var(--text-primary, #1d1d1f);
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mcp-token-tools {
  font-size: 11.5px;
  color: var(--text-secondary, #6e6e73);
  background: rgba(0, 122, 255, 0.08);
  padding: 1px 7px;
  border-radius: 10px;
  cursor: default;
}

.mcp-token-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 4px;
  flex-wrap: wrap;
}

.mcp-token-value {
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 11px;
  color: var(--text-secondary, #6e6e73);
  background: rgba(0, 0, 0, 0.04);
  padding: 2px 6px;
  border-radius: 4px;
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mcp-token-time {
  font-size: 11px;
  color: var(--text-tertiary, #a1a1a6);
}

.mcp-token-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
}

/* 令牌弹窗 */
.token-form {
  max-height: 60vh;
  overflow-y: auto;
  padding-right: 4px;
}

.token-alltools-row {
  display: flex;
  align-items: center;
  gap: 18px;
  flex-wrap: wrap;
}

.token-rotate-row {
  display: inline-flex;
  align-items: center;
}

.token-perm-groups {
  width: 100%;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 8px;
  padding: 8px;
  max-height: 42vh;
  overflow-y: auto;
}

.token-perm-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding-bottom: 8px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
  margin-bottom: 6px;
}

.token-perm-count {
  margin-left: auto;
  font-size: 12px;
  color: var(--text-secondary, #6e6e73);
}

.token-perm-group {
  padding: 6px 0;
  border-bottom: 1px dashed rgba(0, 0, 0, 0.05);
}

.token-perm-group:last-child {
  border-bottom: none;
}

.token-perm-group-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.token-perm-group-title {
  font-weight: 600;
  font-size: 12.5px;
  color: var(--text-primary, #1d1d1f);
}

.token-perm-group-count {
  font-size: 11px;
  color: var(--text-tertiary, #a1a1a6);
}

.token-perm-group-head .el-button {
  margin-left: auto;
}

.token-perm-group-body {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
}

.token-perm-group-body .el-checkbox {
  margin-right: 0;
  font-size: 12px;
}

.token-perm-group-body .el-checkbox__label {
  font-size: 12px;
  padding-left: 5px;
}

.token-tool-cn {
  font-size: 12px;
  color: var(--text-primary, #1d1d1f);
}

.token-tool-en {
  font-size: 10.5px;
  color: var(--text-tertiary, #a1a1a6);
  margin-left: 5px;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
}


.skill-row .grow {
  flex: 1 1 auto;
  min-width: 180px;
}

.skill-row {
  flex-wrap: wrap;
}

.skill-switches {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: 0 0 auto;
}

.skill-switch-label {
  font-size: 11px;
  color: #86868b;
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

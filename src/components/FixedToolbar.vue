<template>
  <div v-if="mindMap" class="fixed-toolbar" ref="toolbarRef">
    <!-- 文字颜色 -->
    <div class="ft-group">
      <button
        class="ft-btn"
        :class="{ disabled: !hasSelection }"
        title="文字颜色"
        @click="togglePanel('color')"
      >
        <span class="ft-icon-color">A</span>
        <span class="ft-caret"></span>
      </button>
      <div v-if="panel === 'color'" class="ft-panel">
        <div class="ft-panel-grid">
          <button
            v-for="c in textColors"
            :key="'fc' + c.value"
            class="ft-swatch"
            :style="{ background: c.value }"
            :title="c.label"
            @click="onColor(c.value)"
          ></button>
          <button class="ft-swatch ft-swatch-reset" title="恢复默认颜色" @click="onColor('')">A</button>
        </div>
      </div>
    </div>

    <!-- 高亮背景 -->
    <div class="ft-group">
      <button
        class="ft-btn"
        :class="{ disabled: !hasSelection }"
        title="高亮背景"
        @click="togglePanel('highlight')"
      >
        <span class="ft-glyph-hl">H</span>
        <span class="ft-caret"></span>
      </button>
      <div v-if="panel === 'highlight'" class="ft-panel">
        <div class="ft-panel-grid">
          <button
            v-for="c in highlightColors"
            :key="'fh' + c.value"
            class="ft-swatch"
            :style="{ background: c.value }"
            :title="c.label"
            @click="onHighlight(c.value)"
          ></button>
          <button class="ft-swatch ft-swatch-reset" title="取消高亮" @click="onHighlight('')">&#10005;</button>
        </div>
      </div>
    </div>

    <!-- 节点背景色 -->
    <div class="ft-group">
      <button
        class="ft-btn"
        :class="{ disabled: !hasSelection }"
        title="节点背景色"
        @click="togglePanel('nodeBg')"
      >
        <span class="ft-node-bg-icon"></span>
        <span class="ft-caret"></span>
      </button>
      <div v-if="panel === 'nodeBg'" class="ft-panel">
        <div class="ft-panel-grid">
          <button
            v-for="c in nodeBgColors"
            :key="c"
            class="ft-swatch"
            :style="{ background: c }"
            :title="c"
            @click="onNodeBackground(c)"
          ></button>
          <button class="ft-swatch ft-swatch-reset" title="恢复默认背景" @click="onNodeBackground('')">✕</button>
        </div>
      </div>
    </div>

    <span class="ft-divider"></span>

    <!-- 加粗 -->
    <button
      class="ft-btn ft-text-btn bold"
      :class="{ disabled: !hasSelection }"
      title="加粗"
      @click="onToggleFormat('bold')"
    >B</button>

    <!-- 下划线 -->
    <button
      class="ft-btn ft-text-btn underline"
      :class="{ disabled: !hasSelection }"
      title="下划线"
      @click="onToggleFormat('underline')"
    >U</button>

    <span class="ft-divider"></span>

    <!-- 字体 -->
    <div class="ft-group">
      <button
        class="ft-btn ft-font-btn"
        :class="{ disabled: !hasSelection }"
        title="字体"
        @click="togglePanel('font')"
      >
        <span>字体</span>
        <span class="ft-caret"></span>
      </button>
      <div v-if="panel === 'font'" class="ft-panel ft-panel-list">
        <button
          v-for="f in fontList"
          :key="f.value"
          class="ft-list-item"
          :style="{ fontFamily: f.value }"
          @click="onFont(f.value)"
        >{{ f.label }}</button>
        <button class="ft-list-item ft-list-reset" @click="onFont('')">默认字体</button>
      </div>
    </div>

    <!-- 字号 -->
    <div class="ft-group">
      <button
        class="ft-btn ft-font-btn"
        :class="{ disabled: !hasSelection }"
        title="字号"
        @click="togglePanel('fontSize')"
      >
        <span class="ft-size-preview">{{ fontSizeLabel }}</span>
        <span class="ft-caret"></span>
      </button>
      <div v-if="panel === 'fontSize'" class="ft-panel ft-panel-list">
        <button
          v-for="s in fontSizeList"
          :key="s"
          class="ft-list-item"
          @click="onFontSize(s)"
        >{{ s }}px</button>
        <button class="ft-list-item ft-list-reset" @click="onFontSize('')">默认字号</button>
      </div>
    </div>

    <span class="ft-divider"></span>

    <!-- 关联线 -->
    <button
      class="ft-btn"
      :class="{ disabled: !hasSelection, active: assocCreating }"
      title="关联线：从选中节点画线到目标节点（Esc 取消）"
      @click="onAssocLine"
    >
      <svg viewBox="0 0 24 24" width="13" height="13">
        <path d="M9 15l6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-dasharray="3 2" />
        <circle cx="6" cy="18" r="2.5" fill="none" stroke="currentColor" stroke-width="2" />
        <circle cx="18" cy="6" r="2.5" fill="none" stroke="currentColor" stroke-width="2" />
      </svg>
    </button>

    <!-- 格式刷 -->
    <button
      class="ft-btn"
      :class="{ active: painting }"
      title="格式刷：点击源节点后，点击其他节点应用格式（Esc 结束）"
      @click="onPainter"
    >
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M18.37 2.63 14 7l-1.59-1.59a2 2 0 0 0-2.82 0L8 7l9 9 1.59-1.59a2 2 0 0 0 0-2.82L17 10l4.37-4.37a2.12 2.12 0 1 0-3-3Z" />
        <path d="M9 8c-2 3-4 3.5-7 4l8 10c2-1 6-5 6-7" />
        <path d="M14.5 17.5 4.5 15" />
      </svg>
    </button>

    <!-- 外框 -->
    <button
      class="ft-btn"
      :class="{ disabled: !hasSelection }"
      title="外框：为选中节点及其子节点添加外框"
      @click="onOuterFrame"
    >
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2.5" />
        <path d="M8 3v18M3 8h18" stroke-width="1.2" opacity="0.5" />
      </svg>
    </button>

    <!-- 概要 -->
    <button
      class="ft-btn"
      :class="{ disabled: !hasSelection }"
      title="概要：为选中节点添加概要"
      @click="onGeneralization"
    >
      <span class="ft-brace">}</span>
    </button>

    <!-- 备注 -->
    <button
      class="ft-btn"
      :class="{ disabled: !hasSelection }"
      title="备注：为选中节点添加/编辑备注"
      @click="onNote"
    >
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M4 4h16v13H9l-5 4V4z" />
        <path d="M8 9h8M8 12.5h5" stroke-width="1.4" />
      </svg>
    </button>

    <!-- 一键隐藏全部挖空 -->
    <button
      class="ft-btn"
      :class="{ active: clozeHidden }"
      title="一键隐藏全部挖空"
      @click="onHideAllCloze"
    >
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none">
        <path d="M3 13.5c2 1.8 4.5 3 9 3s7-1.2 9-3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
        <circle cx="12" cy="14" r="2.6" fill="currentColor" />
        <path d="M5.5 10.5L4 9M12 8.5V6.5M18.5 10.5L20 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
      </svg>
    </button>

    <!-- 一键取消隐藏全部挖空 -->
    <button
      class="ft-btn"
      :class="{ active: !clozeHidden }"
      title="一键取消隐藏全部挖空"
      @click="onShowAllCloze"
    >
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none">
        <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" />
        <circle cx="12" cy="12" r="3" fill="currentColor" />
      </svg>
    </button>

    <span class="ft-divider"></span>

    <!-- 主题 -->
    <div class="ft-group">
      <button
        class="ft-btn ft-font-btn"
        title="主题样式"
        @click="togglePanel('theme')"
      >
        <span>主题</span>
        <span class="ft-caret"></span>
      </button>
      <div v-if="panel === 'theme'" class="ft-panel ft-panel-list">
        <button
          v-for="t in themeList"
          :key="t"
          class="ft-list-item"
          @click="onTheme(t)"
        >{{ themeLabels[t] || t }}</button>
      </div>
    </div>

    <!-- 导出（最右侧） -->
    <div class="ft-group">
      <button
        class="ft-btn"
        title="导出"
        @click="togglePanel('export')"
      >
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none">
          <path d="M12 15V4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
          <path d="M7.5 8.5L12 4l4.5 4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
          <path d="M5 16v3c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2v-3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
        </svg>
        <span class="ft-caret"></span>
      </button>
      <div v-if="panel === 'export'" class="ft-panel ft-panel-list">
        <button v-for="item in exportList" :key="item.type" class="ft-list-item" @click="onExport(item.type)">
          {{ item.label }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { ElMessage } from 'element-plus'
import { textColors, highlightColors, nodeBgColorValues, applyTextStyleToNodes, copyRichTextStyles } from '../utils/textStyle'
import { toggleAllCloze, setAllClozeHidden, isClozeHiddenAll, setNodesClozeHidden, nodeHasCloze, isUidClozeHidden } from '../utils/cloze'
import { wechatService } from '../services/wechatService'
import { feishuService } from '../services/feishuService'
import { buildInteractiveHtml } from '../utils/svgExport'

const props = defineProps({
  mindMap: { type: Object, default: null },
  activeNodes: { type: Array, default: () => [] }
})

const emit = defineEmits(['node-note'])

const toolbarRef = ref(null)
const panel = ref(null) // 'color' | 'highlight' | 'font' | 'fontSize' | 'export' | null
const assocCreating = ref(false)
const painting = ref(false)
// 格式刷源节点（自定义补充：simple-mind-map painter 只复制节点级样式，这里额外记录源节点以复制文字级样式）
const painterSourceNode = ref(null)
const exporting = ref(false)
const fontSizeLabel = ref('字号')

const hasSelection = computed(() => props.activeNodes.length > 0)

const fontList = [
  { label: '微软雅黑', value: '微软雅黑, Microsoft YaHei' },
  { label: '宋体', value: '宋体, SimSun, Songti SC' },
  { label: '黑体', value: '黑体, SimHei, Heiti SC' },
  { label: '楷体', value: '楷体, 楷体_GB2312, SimKai, STKaiti' },
  { label: '隶书', value: '隶书, SimLi' },
  { label: 'Arial', value: 'arial, helvetica, sans-serif' },
  { label: 'Times New Roman', value: 'times new roman' },
  { label: 'Andale Mono', value: 'andale mono' },
  { label: 'Comic Sans MS', value: 'comic sans ms' },
  { label: 'Impact', value: 'impact, chicago' }
]

const fontSizeList = [12, 14, 16, 18, 20, 24, 28, 32, 40, 48]

const themeList = ['blueRoot', 'light', 'dark', 'warm', 'green', 'purple', 'minimal']
const themeLabels = {
  blueRoot: '蓝色（默认）',
  light: '浅色',
  dark: '深色',
  warm: '暖橙',
  green: '绿色',
  purple: '紫色',
  minimal: '极简黑白'
}

const nodeBgColors = nodeBgColorValues

const exportList = [
  { type: 'copy-md', label: '复制 Markdown 文本' },
  { type: 'png', label: 'PNG 图片' },
  { type: 'html', label: 'HTML 文件' },
  { type: 'pdf', label: 'PDF 文件' },
  { type: 'pdf-wechat', label: '导出 PDF 并发送到微信' },
  { type: 'pdf-feishu', label: '导出 PDF 并发送到飞书' },
  { type: 'json', label: 'JSON 数据' },
  { type: 'smm', label: 'SMM 导图文件' },
  { type: 'md', label: 'Markdown 文件' },
  { type: 'xmind', label: 'XMind 文件' }
]

const togglePanel = (type) => {
  if (type !== 'export' && type !== 'theme' && !hasSelection.value) return
  panel.value = panel.value === type ? null : type
}

const closePanel = () => { panel.value = null }

const onColor = (c) => {
  applyTextStyleToNodes(props.mindMap, props.activeNodes, 'color:' + c)
  closePanel()
}

const onHighlight = (c) => {
  applyTextStyleToNodes(props.mindMap, props.activeNodes, 'highlight:' + c)
  closePanel()
}

const onFont = (f) => {
  applyTextStyleToNodes(props.mindMap, props.activeNodes, 'font:' + f)
  closePanel()
}

const onFontSize = (s) => {
  if (s) fontSizeLabel.value = s + ''
  else fontSizeLabel.value = '字号'
  applyTextStyleToNodes(props.mindMap, props.activeNodes, 'fontsize:' + s)
  closePanel()
}

const onTheme = (theme) => {
  const mm = props.mindMap
  if (!mm) return
  try {
    mm.setTheme(theme)
    mm.render()
    try { localStorage.setItem('mindmap_theme', theme) } catch (e) {}
    ElMessage.success(`主题已切换为「${themeLabels[theme] || theme}」`)
  } catch (e) {
    console.error('[FixedToolbar] 切换主题失败:', e)
    ElMessage.error('切换主题失败: ' + e.message)
  } finally {
    closePanel()
  }
}

const onNodeBackground = (color) => {
  if (!hasSelection.value) return
  const mm = props.mindMap
  if (!mm) return
  for (const node of props.activeNodes) {
    try {
      mm.execCommand('SET_NODE_STYLES', node, { fillColor: color || 'transparent' })
    } catch (e) {
      console.error('[FixedToolbar] 设置节点背景失败:', e)
    }
  }
  closePanel()
}

const onToggleFormat = (action) => {
  if (!hasSelection.value) return
  applyTextStyleToNodes(props.mindMap, props.activeNodes, action)
}

// 显示/隐藏全部挖空（睁眼=显示，闭眼=隐藏）
const clozeHidden = ref(isClozeHiddenAll())

const onHideAllCloze = () => {
  try {
    clozeHidden.value = setAllClozeHidden(true)
    ElMessage.success('已一键隐藏全部挖空')
  } catch (e) {
    console.error('[FixedToolbar] 隐藏挖空失败:', e)
  }
}

const onShowAllCloze = () => {
  try {
    clozeHidden.value = setAllClozeHidden(false)
    ElMessage.success('已一键取消隐藏全部挖空')
  } catch (e) {
    console.error('[FixedToolbar] 显示挖空失败:', e)
  }
}

const onToggleCloze = () => {
  try {
    // 智能作用域：选中节点里有挖空内容时仅作用于这些节点；未选中（或选中的都没有挖空）时作用于全局
    const selected = (props.activeNodes || []).filter(Boolean)
    const withCloze = selected.filter(nodeHasCloze)
    if (withCloze.length > 0) {
      const allHidden = withCloze.every(n => isUidClozeHidden(n.uid))
      const targetHidden = !allHidden // 任一可见 → 全部隐藏；全部隐藏 → 全部显示
      setNodesClozeHidden(withCloze, targetHidden)
      clozeHidden.value = targetHidden
      ElMessage.success(targetHidden
        ? `已隐藏 ${withCloze.length} 个选中节点的挖空`
        : `已显示 ${withCloze.length} 个选中节点的挖空`)
    } else {
      clozeHidden.value = toggleAllCloze()
    }
  } catch (e) {
    console.error('[FixedToolbar] 挖空切换失败:', e)
  }
}

// 其他入口（右键菜单/快捷键/AI 工具）切换挖空时同步图标状态
const onClozeStateChanged = (e) => {
  clozeHidden.value = !!(e?.detail?.hiddenAll)
}

// 关联线：从选中节点开始画线，点击目标节点完成（Esc 取消）
const onAssocLine = () => {
  const mm = props.mindMap
  if (!mm?.associativeLine) return
  try {
    mm.associativeLine.createLineFromActiveNode()
    assocCreating.value = true
  } catch (e) {
    console.error('[FixedToolbar] 关联线启动失败:', e)
  }
}

// 格式刷：开启后点击其他节点应用格式（节点级样式走 simple-mind-map painter，文字级样式走 copyRichTextStyles）
const onPainter = () => {
  const mm = props.mindMap
  if (!mm?.painter) return
  if (props.activeNodes.length === 0) {
    ElMessage.warning('请先选中一个节点作为格式源')
    return
  }
  try {
    painterSourceNode.value = props.activeNodes[0]
    mm.painter.startPainter()
    painting.value = true
    try { ElMessage.info('格式刷已开启：点击其他节点应用格式，Esc 结束') } catch (e) {}
  } catch (e) {
    painterSourceNode.value = null
    console.error('[FixedToolbar] 格式刷启动失败:', e)
  }
}

// 结束格式刷（Esc 或点击空白触发）
const stopPainter = () => {
  try { props.mindMap?.painter?.endPainter() } catch (e) {}
  painterSourceNode.value = null
  painting.value = false
}

// 概要：使用命令栈（可撤销），自动进入概要文本编辑
const onGeneralization = () => {
  if (!hasSelection.value) return
  try {
    props.mindMap.execCommand('ADD_GENERALIZATION')
  } catch (e) {
    console.error('[FixedToolbar] 添加概要失败:', e)
  }
}

// 外框：为选中节点（及其子节点）添加外框
const onOuterFrame = () => {
  if (!hasSelection.value) return
  const mm = props.mindMap
  if (!mm?.outerFrame) return
  try {
    mm.outerFrame.addOuterFrame(props.activeNodes, {
      radius: 6,
      strokeWidth: 2,
      strokeColor: '#0984e3',
      strokeDasharray: '5,5',
      fill: 'rgba(9,132,227,0.06)'
    })
  } catch (e) {
    console.error('[FixedToolbar] 添加外框失败:', e)
  }
}

// 备注：通知父组件打开节点旁悬浮窗（父组件负责定位与保存）
const onNote = () => {
  if (!hasSelection.value) return
  emit('node-note', props.activeNodes)
}

// 导出文件名：优先根节点文本
const exportFileName = () => {
  try {
    const data = props.mindMap.getData()
    const root = Array.isArray(data) ? data[0] : data
    const text = String(root?.data?.text || '').replace(/<[^>]+>/g, '').trim()
    return (text.slice(0, 30) || '思维导图').replace(/[\\/:*?"<>|]/g, '_')
  } catch (e) {
    return '思维导图'
  }
}

// 导出：全部走 doExport 插件（统一返回 data:url），a 标签触发下载
const onExport = async (type) => {
  closePanel()
  const mm = props.mindMap
  if (!mm || exporting.value) return

  // 一键复制 Markdown 文本到剪贴板（不生成文件）
  if (type === 'copy-md') {
    exporting.value = true
    try {
      const mod = await import('simple-mind-map/src/parse/markdown.js')
      const markdown = mod.default || mod
      const mdText = markdown.transformToMarkdown(mm.getData())
      if (!mdText) throw new Error('Markdown 转换结果为空')
      await navigator.clipboard.writeText(mdText)
      ElMessage.success('已复制 Markdown 文本到剪贴板')
    } catch (e) {
      console.error('[FixedToolbar] 复制 Markdown 失败:', e)
      ElMessage.error(`复制失败: ${e.message}`)
    } finally {
      exporting.value = false
    }
    return
  }

  if (!mm.doExport) return
  exporting.value = true
  const name = exportFileName()
  try {
    if (type === 'pdf-wechat' || type === 'pdf-feishu') {
      const url = await mm.doExport.pdf(name)
      if (!url) throw new Error('导出数据为空')
      const base64 = String(url).includes(',') ? String(url).substring(String(url).indexOf(',') + 1) : String(url)
      const fileName = `${name}.pdf`
      const saved = await window.electronAPI?.saveBinaryFile?.(fileName, base64)
      if (!saved || !saved.success || !saved.filePath) {
        throw new Error(saved?.error || 'PDF 保存失败')
      }
      if (type === 'pdf-wechat') {
        const cfg = await wechatService.getConfig()
        if (!cfg || !cfg.hasToken) {
          throw new Error('微信尚未登录，请先在设置中完成微信扫码登录')
        }
        await wechatService.sendFile('', saved.filePath)
        ElMessage.success(`PDF 已导出并发送到微信：${fileName}`)
      } else {
        const cfg = await feishuService.getConfig()
        if (!cfg || !cfg.appId || !cfg.hasSecret) {
          throw new Error('飞书尚未配置，请先在设置中配置飞书 App ID 和 App Secret')
        }
        let chatId = cfg.defaultChatId || ''
        if (!chatId) {
          const chats = await feishuService.listChats()
          const list = (chats && (chats.items || chats.chats)) || []
          if (list.length > 0) chatId = list[0].chat_id
        }
        if (!chatId) throw new Error('没有可用的飞书群聊，请先在设置中选择默认推送群')
        await feishuService.sendFile(chatId, saved.filePath)
        ElMessage.success(`PDF 已导出并发送到飞书：${fileName}`)
      }
      return
    }
    let url
    switch (type) {
      case 'png': url = await mm.doExport.png(name, false); break
      case 'html': url = await buildInteractiveHtml(await mm.doExport.svg(name), name); break
      case 'pdf': url = await mm.doExport.pdf(name); break
      case 'json': url = await mm.doExport.json(name, false); break
      case 'smm': url = await mm.doExport.smm(name, false); break
      case 'md': url = await mm.doExport.md(); break
      case 'xmind': url = await mm.doExport.xmind(name); break
      default: return
    }
    if (!url) throw new Error('导出数据为空')
    const a = document.createElement('a')
    a.href = url
    a.download = `${name}.${type}`
    a.click()
    ElMessage.success(`已导出：${name}.${type}`)
  } catch (e) {
    console.error('[FixedToolbar] 导出失败:', e)
    ElMessage.error(`导出失败: ${e.message}`)
  } finally {
    exporting.value = false
  }
}

const onDocClick = (e) => {
  if (panel.value && toolbarRef.value && !toolbarRef.value.contains(e.target)) closePanel()
}

const syncStates = () => {
  const mm = props.mindMap
  if (!mm) return
  try { assocCreating.value = !!mm.associativeLine?.creatingStartNode } catch (e) {}
  try { painting.value = !!mm.painter?.isInPainter } catch (e) {}
}

const onPainterStart = () => { painting.value = true }
const onPainterEnd = () => {
  painting.value = false
  painterSourceNode.value = null
}
// node_click：格式刷进行中时，补复制文字级样式（粗体/颜色/斜体/下划线/删除线/高亮）
const onNodeClick = (node) => {
  syncStates()
  if (!painting.value || !painterSourceNode.value || !node) return
  if (node.uid === painterSourceNode.value.uid) return
  try {
    copyRichTextStyles(props.mindMap, painterSourceNode.value, [node])
  } catch (e) {
    console.error('[FixedToolbar] 格式刷复制文字样式失败:', e)
  }
}

// ESC 结束格式刷
const onKeydown = (e) => {
  if (e.key === 'Escape' && painting.value) {
    e.preventDefault()
    stopPainter()
  }
}

const bindEvents = (mm) => {
  if (!mm) return
  mm.on('painter_start', onPainterStart)
  mm.on('painter_end', onPainterEnd)
  mm.on('node_click', onNodeClick)
  syncStates()
}

const unbindEvents = (mm) => {
  if (!mm) return
  mm.off('painter_start', onPainterStart)
  mm.off('painter_end', onPainterEnd)
  mm.off('node_click', onNodeClick)
}

watch(() => props.mindMap, (mm, old) => {
  unbindEvents(old)
  bindEvents(mm)
})

onMounted(() => {
  document.addEventListener('click', onDocClick, true)
  window.addEventListener('cloze-state-changed', onClozeStateChanged)
  window.addEventListener('keydown', onKeydown)
  bindEvents(props.mindMap)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick, true)
  window.removeEventListener('cloze-state-changed', onClozeStateChanged)
  window.removeEventListener('keydown', onKeydown)
  unbindEvents(props.mindMap)
})
</script>

<style scoped>
.fixed-toolbar {
  position: absolute;
  top: 8px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 100;
  display: flex;
  align-items: center;
  gap: 1px;
  padding: 3px 6px;
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(0, 0, 0, 0.06);
  border-radius: 9px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.12);
  user-select: none;
}

.ft-group {
  position: relative;
  display: flex;
}

.ft-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 3px;
  min-width: 26px;
  height: 24px;
  padding: 0 4px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #444;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
  /* 工具栏为 absolute 居中定位，可用宽度受限时按钮会被压缩导致"字体"等文字竖排换行 */
  white-space: nowrap;
  flex-shrink: 0;
}

.ft-btn:hover {
  background: rgba(0, 0, 0, 0.06);
  color: #111;
}

.ft-btn.active {
  background: rgba(0, 122, 255, 0.12);
  color: var(--apple-blue, #007aff);
}

.ft-btn.disabled {
  opacity: 0.32;
  cursor: not-allowed;
}

.ft-btn.disabled:hover {
  background: transparent;
  color: #444;
}

.ft-text-btn.bold {
  font-weight: 700;
  font-family: Georgia, serif;
}

.ft-text-btn.underline {
  text-decoration: underline;
  font-family: Georgia, serif;
}

.ft-brace {
  font-family: Georgia, 'Times New Roman', serif;
  font-weight: 700;
  font-size: 17px;
  line-height: 1;
}

.ft-icon-color {
  font-weight: 600;
  font-size: 13px;
  font-family: Georgia, serif;
  background: linear-gradient(135deg, #e74c3c, #2980b9);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.ft-node-bg-icon {
  width: 11px;
  height: 11px;
  border-radius: 3px;
  border: 1px solid rgba(0, 0, 0, 0.18);
  background:
    linear-gradient(135deg, transparent 48%, rgba(0, 0, 0, 0.14) 49%, rgba(0, 0, 0, 0.14) 51%, transparent 52%),
    #ffffff;
}

/* 高亮图标：与节点选中文字后悬浮工具条(TextToolbar)的高亮图标保持一致 */
.ft-glyph-hl {
  font-weight: 600;
  font-size: 13px;
  font-family: Georgia, serif;
  line-height: 1;
  background: linear-gradient(transparent 55%, #ffe066 55%);
  padding: 0 1px;
}

.ft-font-btn {
  font-size: 12px;
  padding: 0 5px;
}

.ft-size-preview {
  min-width: 26px;
  text-align: center;
}

.ft-caret {
  width: 0;
  height: 0;
  border-left: 3px solid transparent;
  border-right: 3px solid transparent;
  border-top: 3.5px solid currentColor;
  opacity: 0.6;
}

.ft-divider {
  width: 1px;
  height: 14px;
  margin: 0 4px;
  background: rgba(0, 0, 0, 0.1);
  flex-shrink: 0;
}

.ft-panel {
  position: absolute;
  top: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
  padding: 6px;
  background: #fff;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 8px;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.15);
  white-space: nowrap;
}

.ft-panel-grid {
  display: flex;
  align-items: center;
  gap: 5px;
}

.ft-swatch {
  width: 17px;
  height: 17px;
  border: none;
  border-radius: 50%;
  cursor: pointer;
  transition: transform 0.12s, box-shadow 0.12s;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.12);
}

.ft-swatch:hover {
  transform: scale(1.18);
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.2), 0 2px 6px rgba(0, 0, 0, 0.2);
}

.ft-swatch-reset {
  background: #f5f5f7;
  color: #666;
  font-size: 10px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
}

.ft-panel-list {
  display: flex;
  flex-direction: column;
  gap: 1px;
  max-height: 260px;
  overflow-y: auto;
}

.ft-list-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-width: 110px;
  padding: 4px 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #333;
  font-size: 12.5px;
  text-align: left;
  cursor: pointer;
  transition: background 0.1s;
}

.ft-list-item:hover {
  background: rgba(0, 122, 255, 0.08);
  color: var(--apple-blue, #007aff);
}

.ft-list-reset {
  color: #999;
  border-top: 1px solid rgba(0, 0, 0, 0.06);
  border-radius: 0 0 6px 6px;
  margin-top: 2px;
}
</style>

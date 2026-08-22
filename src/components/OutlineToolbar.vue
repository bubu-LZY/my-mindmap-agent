<template>
  <!-- mousedown.prevent：点击工具栏不夺走节点编辑焦点，否则 blur 先于 click 清空目标节点导致按钮禁用 -->
  <div class="fixed-toolbar" ref="toolbarRef" @mousedown.prevent>
    <!-- 文字颜色 -->
    <div class="ft-group">
      <button class="ft-btn" :class="{ disabled }" title="文字颜色" @click="togglePanel('color')">
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
            @click="onAction('color:' + c.value)"
          ></button>
          <button class="ft-swatch ft-swatch-reset" title="恢复默认颜色" @click="onAction('color:')">A</button>
        </div>
      </div>
    </div>

    <!-- 高亮背景 -->
    <div class="ft-group">
      <button class="ft-btn" :class="{ disabled }" title="高亮背景" @click="togglePanel('highlight')">
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
            @click="onAction('highlight:' + c.value)"
          ></button>
          <button class="ft-swatch ft-swatch-reset" title="取消高亮" @click="onAction('highlight:')">&#10005;</button>
        </div>
      </div>
    </div>

    <span class="ft-divider"></span>

    <!-- 加粗 / 斜体 / 下划线 / 删除线 -->
    <button class="ft-btn ft-text-btn bold" :class="{ disabled }" title="加粗" @click="onAction('bold')">B</button>
    <button class="ft-btn ft-text-btn italic" :class="{ disabled }" title="斜体" @click="onAction('italic-on')">I</button>
    <button class="ft-btn ft-text-btn underline" :class="{ disabled }" title="下划线" @click="onAction('underline')">U</button>
    <button class="ft-btn ft-text-btn strike" :class="{ disabled }" title="删除线" @click="onAction('strikethrough')">S</button>

    <!-- 格式刷：复制选中文字/节点的格式，应用到其他文字 -->
    <button
      class="ft-btn ft-painter-btn"
      :class="{ active: painterActive, disabled: !painterActive && disabled }"
      :title="painterActive ? '格式刷已开启：选中文字或点击节点应用（ESC 取消）' : '格式刷：复制选中文字的格式，刷到其他文字'"
      @click="onPainterClick"
    >
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M15.5 3.5l5 5L11 18l-5-5L15.5 3.5z" />
        <path d="M6 13l-2.2 2.2c-1.2 1.2-1.2 3.1 0 4.2 1.2 1.2 3.1 1.2 4.2 0L10 17.5" />
        <path d="M14.5 19.5l5.5-5.5" />
      </svg>
    </button>

    <span class="ft-divider"></span>

    <!-- 字体 -->
    <div class="ft-group">
      <button class="ft-btn ft-font-btn" :class="{ disabled }" title="字体" @click="togglePanel('font')">
        <span>字体</span>
        <span class="ft-caret"></span>
      </button>
      <div v-if="panel === 'font'" class="ft-panel ft-panel-list">
        <button
          v-for="f in fontList"
          :key="f.value"
          class="ft-list-item"
          :style="{ fontFamily: f.value }"
          @click="onAction('font:' + f.value)"
        >{{ f.label }}</button>
        <button class="ft-list-item ft-list-reset" @click="onAction('font:')">默认字体</button>
      </div>
    </div>

    <!-- 字号 -->
    <div class="ft-group">
      <button class="ft-btn ft-font-btn" :class="{ disabled }" title="字号" @click="togglePanel('fontSize')">
        <span class="ft-size-preview">{{ fontSizeLabel }}</span>
        <span class="ft-caret"></span>
      </button>
      <div v-if="panel === 'fontSize'" class="ft-panel ft-panel-list">
        <button v-for="s in fontSizeList" :key="s" class="ft-list-item" @click="onFontSize(s)">{{ s }}px</button>
        <button class="ft-list-item ft-list-reset" @click="onFontSize('')">默认字号</button>
      </div>
    </div>

    <span class="ft-divider"></span>

    <!-- 概要 -->
    <button class="ft-btn" :class="{ disabled }" title="概括：为选中节点添加概括（显示在节点旁〔〕中，点击可编辑）" @click="emitAction('gen')">
      <span class="ft-brace">}</span>
    </button>

    <!-- 备注 -->
    <button class="ft-btn" :class="{ disabled }" title="备注：为选中节点添加/编辑备注" @click="emitAction('note')">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M4 4h16v13H9l-5 4V4z" />
        <path d="M8 9h8M8 12.5h5" stroke-width="1.4" />
      </svg>
    </button>

    <!-- 一键隐藏全部挖空 -->
    <button class="ft-btn" :class="{ active: clozeHidden }" title="一键隐藏全部挖空" @click="emitAction('hide-cloze')">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none">
        <path d="M3 13.5c2 1.8 4.5 3 9 3s7-1.2 9-3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
        <circle cx="12" cy="14" r="2.6" fill="currentColor" />
        <path d="M5.5 10.5L4 9M12 8.5V6.5M18.5 10.5L20 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
      </svg>
    </button>

    <!-- 一键取消隐藏全部挖空 -->
    <button class="ft-btn" :class="{ active: !clozeHidden }" title="一键取消隐藏全部挖空" @click="emitAction('show-cloze')">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none">
        <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" />
        <circle cx="12" cy="12" r="3" fill="currentColor" />
      </svg>
    </button>

    <span class="ft-divider"></span>

    <!-- 导出（数据类格式；图片类导出请切换到思维导图模式） -->
    <div class="ft-group">
      <button class="ft-btn" title="导出" @click="togglePanel('export')">
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none">
          <path d="M12 15V4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
          <path d="M7.5 8.5L12 4l4.5 4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
          <path d="M5 16v3c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2v-3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
        </svg>
        <span class="ft-caret"></span>
      </button>
      <div v-if="panel === 'export'" class="ft-panel ft-panel-list">
        <button v-for="item in exportList" :key="item.type" class="ft-list-item" @click="emitExport(item.type)">
          {{ item.label }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { textColors, highlightColors } from '../utils/textStyle'

const props = defineProps({
  disabled: { type: Boolean, default: true },
  clozeHidden: { type: Boolean, default: false },
  // 格式刷激活态（开启后按钮高亮；点击 = 取消，不受 disabled 限制）
  painterActive: { type: Boolean, default: false }
})

const emit = defineEmits(['apply', 'note', 'gen', 'toggle-cloze', 'hide-cloze', 'show-cloze', 'export', 'format-painter'])

const toolbarRef = ref(null)
const panel = ref(null)
const fontSizeLabel = ref('字号')

const fontList = [
  { label: '微软雅黑', value: 'Microsoft YaHei' },
  { label: '宋体', value: 'SimSun' },
  { label: '黑体', value: 'SimHei' },
  { label: '楷体', value: 'KaiTi' },
  { label: '仿宋', value: 'FangSong' },
  { label: 'Arial', value: 'Arial' },
  { label: 'Times New Roman', value: 'Times New Roman' },
  { label: 'Courier New', value: 'Courier New' },
  { label: 'Georgia', value: 'Georgia' }
]

const fontSizeList = [12, 14, 16, 18, 20, 24, 28, 32, 40, 48]

// 图片类导出（png/svg/pdf）依赖可见画布，大纲模式不提供
const exportList = [
  { type: 'copy-md', label: '复制 Markdown 文本' },
  { type: 'json', label: 'JSON 数据' },
  { type: 'smm', label: 'SMM 导图文件' },
  { type: 'md', label: 'Markdown 文件' },
  { type: 'xmind', label: 'XMind 文件' }
]

const togglePanel = (type) => {
  if (type !== 'export' && props.disabled) return
  panel.value = panel.value === type ? null : type
}

const closePanel = () => { panel.value = null }

const onAction = (action) => {
  emit('apply', action)
  closePanel()
}

const onFontSize = (s) => {
  fontSizeLabel.value = s ? String(s) : '字号'
  onAction('fontsize:' + s)
}

const emitAction = (name) => {
  if (props.disabled) return
  emit(name)
}

// 格式刷：激活态点击 = 取消（不受 disabled 限制）；非激活时需要可用目标
const onPainterClick = () => {
  if (props.painterActive || !props.disabled) emit('format-painter')
}

const emitExport = (type) => {
  closePanel()
  emit('export', type)
}

const onDocClick = (e) => {
  if (panel.value && toolbarRef.value && !toolbarRef.value.contains(e.target)) closePanel()
}

onMounted(() => document.addEventListener('click', onDocClick))
onBeforeUnmount(() => document.removeEventListener('click', onDocClick))
</script>

<style scoped>
.fixed-toolbar {
  position: relative;
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

.ft-group { position: relative; display: flex; }

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
  white-space: nowrap;
  flex-shrink: 0;
}
.ft-btn:hover { background: rgba(0, 0, 0, 0.06); color: #111; }
.ft-btn.active { background: rgba(0, 122, 255, 0.12); color: var(--apple-blue, #007aff); }
.ft-btn.disabled { opacity: 0.32; cursor: not-allowed; }
.ft-btn.disabled:hover { background: transparent; color: #444; }

.ft-text-btn.bold { font-weight: 700; font-family: Georgia, serif; }
.ft-text-btn.italic { font-style: italic; font-family: Georgia, serif; }
.ft-text-btn.underline { text-decoration: underline; font-family: Georgia, serif; }
.ft-text-btn.strike { text-decoration: line-through; font-family: Georgia, serif; }

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

/* 高亮图标：与节点选中文字后悬浮工具条(TextToolbar)的高亮图标保持一致 */
.ft-glyph-hl {
  font-weight: 600;
  font-size: 13px;
  font-family: Georgia, serif;
  line-height: 1;
  background: linear-gradient(transparent 55%, #ffe066 55%);
  padding: 0 1px;
}

.ft-font-btn { font-size: 12px; padding: 0 5px; }
.ft-size-preview { min-width: 26px; text-align: center; }

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
  z-index: 20;
}

.ft-panel-grid { display: flex; align-items: center; gap: 5px; }

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
.ft-list-item:hover { background: rgba(0, 122, 255, 0.08); color: var(--apple-blue, #007aff); }
.ft-list-reset {
  color: #999;
  border-top: 1px solid rgba(0, 0, 0, 0.06);
  border-radius: 0 0 6px 6px;
  margin-top: 2px;
}
</style>

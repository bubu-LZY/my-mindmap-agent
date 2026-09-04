<template>
  <div class="markdown-editor" :class="{ 'is-fullscreen': fullscreen }">
    <div class="markdown-editor-toolbar">
      <span class="markdown-editor-title">Markdown 模式</span>
      <span v-if="dirty" class="markdown-dirty">未同步</span>
      <span class="markdown-spacer"></span>
      <button
        class="markdown-toolbar-btn primary"
        :disabled="!dirty"
        @click="applyMarkdown(false)"
      >
        同步到导图
      </button>
    </div>

    <div class="markdown-editor-body">
      <MdEditor
        v-model="mdText"
        class="markdown-md-editor"
        :toolbars="toolbars"
        :preview-theme="'github'"
        :code-theme="'atom'"
        @onSave="() => applyMarkdown(false)"
      />
    </div>
  </div>
</template>

<script setup>
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { ElMessage } from 'element-plus'
import { MdEditor } from 'md-editor-v3'
import 'md-editor-v3/lib/style.css'
import { treeToMarkdown, parseMarkdownToTree } from '../utils/markdownParser'

const props = defineProps({
  mindMap: { type: Object, default: null },
  mindMapData: { type: Object, default: null },
  fileId: { type: String, default: '' },
  visible: { type: Boolean, default: true },
  fullscreen: { type: Boolean, default: false }
})

const emit = defineEmits(['apply', 'fullscreen-change'])

const mdText = ref('')
const dirty = ref(false)
let lastApplied = ''

const toolbars = [
  'bold',
  'italic',
  'strikeThrough',
  'title',
  'sub',
  'sup',
  'quote',
  'unorderedList',
  'orderedList',
  'task',
  'code',
  'table',
  'link',
  'image',
  'revoke',
  'next',
  'save',
  'preview'
]

const clozeSpanToMarker = (html) => String(html || '')
  .replace(/<span\b[^>]*class=["'][^"']*smm-cloze[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi, '[==$1==]')

const clozeMarkerToSpan = (text) => String(text || '')
  .replace(/\[==([\s\S]+?)==\]/g, '<span class="smm-cloze">$1</span>')

const buildMarkdown = (data) => {
  if (!data) return ''
  let clone = null
  try {
    clone = JSON.parse(JSON.stringify(data))
  } catch {
    clone = data
  }
  const walk = (node) => {
    if (!node) return
    if (node.data && typeof node.data.text === 'string') {
      node.data.text = clozeSpanToMarker(node.data.text)
    }
    if (Array.isArray(node.children)) node.children.forEach(walk)
  }
  walk(clone)
  return treeToMarkdown(clone)
}

const resolveData = () => props.mindMapData || (props.mindMap && typeof props.mindMap.getData === 'function' ? props.mindMap.getData() : null)

// 组件创建时即用数据初始化，避免编辑器先以空值挂载、再程序化塞入全文，
// 否则 CodeMirror 会把“全文写入”记成一步可撤销操作，导致 CTRL+Z 一步退回空白。
const initialText = buildMarkdown(resolveData())
mdText.value = initialText
lastApplied = initialText

const refreshFromData = () => {
  if (dirty.value) return
  const next = buildMarkdown(resolveData())
  // 内容未变时不重复赋值，避免重置编辑器的撤销历史。
  if (next === mdText.value && next === lastApplied) return
  lastApplied = next
  mdText.value = next
}

watch(() => props.mindMapData, refreshFromData)
watch(() => props.visible, (visible) => {
  if (visible) refreshFromData()
})

onMounted(() => {
  refreshFromData()
})

onBeforeUnmount(() => {
  if (dirty.value) {
    try {
      applyMarkdown(true)
    } catch {
      // 卸载阶段不再弹窗打扰用户
    }
  }
})

// 用 watch 而不是 @onChange 来检测未同步状态：@onChange 的触发时机先于 v-model
// 更新，读 mdText 会拿到旧值，导致“未同步”时有时无、切模式不提示、删除不生效。
watch(mdText, (val) => {
  dirty.value = String(val ?? '') !== lastApplied
})

const applyMarkdown = (silent = false) => {
  const text = String(mdText.value || '').trim()
  if (!text) {
    if (!silent) ElMessage.warning('Markdown 内容为空，未同步')
    return
  }

  try {
    const tree = parseMarkdownToTree(text)
    const walk = (node) => {
      if (!node) return
      if (node.data && typeof node.data.text === 'string') {
        node.data.text = clozeMarkerToSpan(node.data.text)
      }
      if (Array.isArray(node.children)) node.children.forEach(walk)
    }
    walk(tree)

    emit('apply', { tree, fileId: props.fileId || '' })
    lastApplied = mdText.value
    dirty.value = false

    if (!silent) {
      ElMessage.success('已同步到思维导图')
    }
  } catch (error) {
    if (!silent) {
      ElMessage.error(`Markdown 解析失败：${error?.message || error}`)
    }
  }
}

const discardChanges = () => {
  dirty.value = false
  lastApplied = mdText.value
}

defineExpose({
  isDirty: () => dirty.value,
  apply: (silent = true) => applyMarkdown(silent),
  discard: discardChanges
})
</script>

<style scoped>
.markdown-editor {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  background: #fbfbfd;
  color: #1d1d1f;
  overflow: hidden;
}

.markdown-editor.is-fullscreen {
  position: fixed;
  inset: 0;
  z-index: 6500;
}

.markdown-editor-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.08);
  background: #fff;
  flex: 0 0 auto;
  z-index: 2;
}

.markdown-editor-title {
  font-size: 13px;
  font-weight: 600;
}

.markdown-dirty {
  font-size: 12px;
  color: #b45309;
  background: rgba(245, 158, 11, 0.12);
  padding: 1px 6px;
  border-radius: 999px;
}

.markdown-spacer {
  flex: 1;
}

.markdown-toolbar-btn {
  border: 1px solid rgba(0, 0, 0, 0.12);
  background: #fff;
  color: #1d1d1f;
  border-radius: 8px;
  padding: 5px 10px;
  font-size: 12px;
  cursor: pointer;
}

.markdown-toolbar-btn.primary {
  background: #0a84ff;
  border-color: #0a84ff;
  color: #fff;
}

.markdown-toolbar-btn.primary:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.markdown-editor-body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.markdown-md-editor {
  height: 100%;
}
</style>

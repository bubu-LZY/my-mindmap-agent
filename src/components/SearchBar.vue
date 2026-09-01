<template>
  <div class="search-bar-container">
    <div class="search-input-wrapper">
      <svg class="search-icon" viewBox="0 0 24 24" width="16" height="16">
        <path fill="currentColor" d="M9.5,3A6.5,6.5 0 0,1 16,9.5C16,11.11 15.41,12.59 14.44,13.73L14.71,14H15.5L20.5,19L19,20.5L14,15.5V14.71L13.73,14.44C12.59,15.41 11.11,16 9.5,16A6.5,6.5 0 0,1 3,9.5A6.5,6.5 0 0,1 9.5,3M9.5,5C7,5 5,7 5,9.5C5,12 7,14 9.5,14C12,14 14,12 14,9.5C14,7 12,5 9.5,5Z" />
      </svg>
      <input
        ref="inputRef"
        v-model="query"
        class="search-input"
        placeholder="搜索文件名或内容..."
        @input="onInput"
        @focus="showResults = true"
        @blur="onBlur"
        @keydown.enter.exact.prevent="onEnter"
        @keydown.esc="showResults = false"
      />
      <span v-if="currentSearchRunning" class="semantic-spinner" :title="searching ? '关键词搜索中' : '语义检索中'"></span>
      <button v-if="query" class="clear-btn" @click="clearSearch">✕</button>
    </div>

    <Transition name="search-dropdown">
      <div v-if="showResults && (hasAnyResult || searching || semanticSearching || searched)" class="search-results">
        <!-- 第一层 tab：关键词 / 语义 -->
        <div class="search-tabs">
          <button
            class="search-tab"
            :class="{ active: activeMode === 'keyword' }"
            @mousedown.prevent="onModeChange('keyword')"
          >关键词</button>
          <button
            class="search-tab"
            :class="{ active: activeMode === 'semantic' }"
            @mousedown.prevent="onModeChange('semantic')"
          >语义
            <span v-if="semanticSearching" class="semantic-spinner tab-spinner"></span>
          </button>
        </div>
        <!-- 第二层 tab：当前文件 / 全局文件 -->
        <div class="search-subtabs">
          <button
            class="search-subtab"
            :class="{ active: activeScope === 'current' }"
            @mousedown.prevent="onScopeChange('current')"
          >当前文件 <span class="tab-count">{{ countByModeAndScope(activeMode, 'current') }}</span></button>
          <button
            class="search-subtab"
            :class="{ active: activeScope === 'global' }"
            @mousedown.prevent="onScopeChange('global')"
          >全局文件 <span class="tab-count">{{ countByModeAndScope(activeMode, 'global') }}</span></button>
        </div>

        <!-- 结果状态提示 -->
        <div v-if="visibleItems.length === 0 && !currentSearchRunning" class="search-status">
          {{ activeScope === 'current' && !currentFilePath ? '当前未打开文件，请先打开一个文件' : '未找到匹配内容' }}
        </div>

        <div
          v-for="item in visibleItems"
          :key="item.filePath + '::' + item.nodeUid + '::' + (item.semanticWord || '')"
          class="search-result-item"
          @mousedown.prevent="openResult(item)"
        >
          <div class="result-file-name">
            <span
              v-if="item.isTag"
              class="tag-atomic"
            >标签</span>
            <span class="result-file-name-text">{{ item.fileName }}</span>
            <span class="result-file-name-tags">
              <span
                v-if="item.semanticWord"
                class="semantic-tag"
                :title="'语义匹配: ' + item.semanticWord + (item.similarity != null ? '（' + item.similarity + '%）' : '')"
              >语义</span>
              <span v-if="item.similarity != null" class="similarity-badge" title="近似匹配值">{{ item.similarity }}%</span>
            </span>
          </div>
          <div class="result-snippet" v-html="item.safeSnippet"></div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup>
import { ref, computed, nextTick, watch } from 'vue'
import { searchService } from '../services/searchService'
import { getTags } from '../utils/tagStore'
import { sanitizeSafeHtml } from '../utils/sanitizeHtml'

const props = defineProps({
  currentFilePath: { type: String, default: '' }
})
const emit = defineEmits(['open-file'])

const inputRef = ref(null)
const query = ref('')
// 两套结果分别存储，互不干扰
const keywordResultsAll = ref([])     // 全局关键词命中（未过滤当前文件）
const semanticResultsAll = ref([])    // 全局语义命中
const keywordSearching = ref(false)
const semanticSearching = ref(false)
const semanticRan = ref(false)        // 用户是否已触发过一次语义检索（避免每次切 tab 都重跑）
const showResults = ref(false)
const searched = ref(false)
const activeMode = ref('keyword')     // 'keyword' | 'semantic'
const activeScope = ref('global')     // 'global' | 'current'
let debounceTimer = null
let semanticSeq = 0

// 兼容旧引用：让模板里 searching 表示"当前模式下还在搜索中"
const searching = computed(() => activeMode.value === 'keyword' ? keywordSearching.value : false)
const currentSearchRunning = computed(() => keywordSearching.value || semanticSearching.value)

// 标签搜索：匹配标签名 + 备注，结果项带 isTag 标记
const searchTags = (q) => {
  try {
    const tags = getTags()
    if (!tags || !tags.length) return []
    const ql = q.toLowerCase()
    const results = []
    for (const tag of tags) {
      const name = String(tag.tag || '').toLowerCase()
      const note = String(tag.note || '').toLowerCase()
      const hitName = name.includes(ql)
      const hitNote = note.includes(ql)
      if (!hitName && !hitNote) continue
      const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      const mark = (s) => {
        const e = esc(s)
        const eq = esc(q).replace(/[.*+?^${}()|[\]\\]/g, '\\\\$&')
        return e.replace(new RegExp(eq, 'gi'), (m) => `<mark>${m}</mark>`)
      }
      const snippet = hitNote
        ? (hitName ? `标签「${mark(tag.tag)}」 备注：${mark(tag.note)}` : `标签「${esc(tag.tag)}」 备注：${mark(tag.note)}`)
        : `标签「${mark(tag.tag)}」`
      results.push({
        filePath: tag.filePath,
        fileName: tag.fileName,
        nodeUid: tag.nodeUid || '',
        fileType: 'tag',
        snippet,
        isTag: true,
        tagId: tag.id,
        tagText: tag.tag,
        tagNote: tag.note,
        page: tag.page,
        scrollTop: tag.scrollTop
      })
    }
    return results
  } catch { return [] }
}

const runKeywordSearch = async (q) => {
  const res = await searchService.search(q)
  // eslint-disable-next-line no-console
  console.log('[SearchBar DEBUG] q=', JSON.stringify(q), 'results.length=', (res?.results || []).length, 'first.filePath=', res?.results?.[0]?.filePath?.slice(-30))
  return (res && res.results) || []
}

// 语义检索：向量检索 + BM25 RRF 融合；embedding 不可用时自动降级纯 BM25
const runSemanticSearch = async (q) => {
  const seq = ++semanticSeq
  try {
    const res = await searchService.semanticSearch(q)
    if (seq !== semanticSeq) return []
    const items = (res?.results || []).map((r, i) => ({
      ...r,
      source: 'semantic',
      semanticWord: r.vectorScore ? '向量匹配' : '语义相关',
      similarity: r.vectorScore ? Math.round(r.vectorScore * 100) : null
    }))
    return items
  } catch (err) {
    console.error('[搜索] 语义检索失败:', err)
    return []
  }
}

const doKeywordSearch = async (q) => {
  if (!q) return []
  keywordSearching.value = true
  try {
    const [hits, tagHits] = await Promise.all([
      runKeywordSearch(q),
      Promise.resolve(searchTags(q))
    ])
    // 标签结果带 isTag=true；普通命中用 source='keyword' 标记用于区分计数
    const items = [
      ...tagHits.map(t => ({ ...t, source: 'keyword' })),
      ...hits.map(h => ({ ...h, source: 'keyword' }))
    ]
    return items
  } catch (err) {
    console.error('[搜索] 关键词搜索失败:', err)
    return []
  } finally {
    keywordSearching.value = false
  }
}

const doSemanticSearch = async () => {
  const q = query.value.trim()
  if (!q) return
  semanticSearching.value = true
  const myQ = q
  try {
    const items = await runSemanticSearch(q)
    // 守卫：query 已变更则丢弃本次结果，避免旧回调覆盖新结果
    if (query.value.trim() !== myQ) return
    semanticResultsAll.value = items
  } finally {
    semanticSearching.value = false
    semanticRan.value = true
  }
}

const doSearch = async () => {
  const q = query.value.trim()
  if (!q) {
    keywordResultsAll.value = []
    semanticResultsAll.value = []
    searched.value = false
    semanticRan.value = false
    return
  }
  showResults.value = true
  searched.value = true
  // 每次查询都重跑关键词；同时异步触发语义（用户已经习惯语义并行追加，不再需要手动点）
  // 关键：doKeywordSearch 异步等待期间用户可能继续输入，doSearch 也会被再次触发；
  // 因此用本轮的 q 快照做守卫，回调时仅当 query 仍是本轮的 q 才覆盖结果，
  // 避免晚到的并发回调把更新后的结果覆盖回旧结果（"有时候灵有时候不灵"的根因）。
  const myQ = q
  const items = await doKeywordSearch(myQ)
  // 守卫：query 已变更（用户继续输入），丢弃本次结果
  if (query.value.trim() !== myQ) return
  keywordResultsAll.value = items
  // 语义不阻塞关键词展示；切到语义 tab 时也能立即看到结果
  if (!semanticRan.value && !semanticSearching.value) {
    doSemanticSearch()
  }
}

// 当前 scope 下的关键词/语义结果
// 关键：DB 里的 file_path 是反斜杠形式，App.vue 通过 normalizeFileId 把 currentFilePath 转成正斜杠，
// 直接 it.filePath === props.currentFilePath 永远不匹配；统一用 normalize 后再比较。
function normalizeFilePath(p) {
  if (!p) return ''
  return String(p).replace(/[\\\/]+/g, '/').replace(/\/+$/, '')
}
function filterByScope(items, scope) {
  if (scope === 'current') {
    if (!props.currentFilePath) return []
    const target = normalizeFilePath(props.currentFilePath)
    return items.filter(it => normalizeFilePath(it.filePath) === target)
  }
  return items
}
const keywordItems = computed(() => filterByScope(keywordResultsAll.value, activeScope.value))
const semanticItems = computed(() =>
  filterByScope(semanticResultsAll.value, activeScope.value)
    .slice()
    .sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0))
)

const currentVisible = computed(() => activeMode.value === 'keyword' ? keywordItems.value : semanticItems.value)
const visibleItems = computed(() => currentVisible.value.map(item => ({
  ...item,
  safeSnippet: sanitizeSafeHtml(item.snippet || '')
})))

const hasAnyResult = computed(() => keywordResultsAll.value.length > 0 || semanticResultsAll.value.length > 0)

function countByModeAndScope(mode, scope) {
  if (mode === 'keyword') return filterByScope(keywordResultsAll.value, scope).length
  return filterByScope(semanticResultsAll.value, scope).length
}

const onModeChange = (mode) => {
  if (activeMode.value === mode) return
  activeMode.value = mode
  // doSearch 默认已经异步触发过语义，这里只补一次兜底（用户清空后又输入不会自动跑，
  // 此时切到语义 tab 仍能立即看到结果）
  if (mode === 'semantic' && !semanticRan.value && query.value.trim() && !semanticSearching.value && semanticResultsAll.value.length === 0) {
    triggerSemantic()
  }
}

const onScopeChange = (scope) => {
  if (activeScope.value === scope) return
  activeScope.value = scope
}

// 用户主动点击「立即触发语义检索」或切到语义 tab 时调用
const triggerSemantic = async () => {
  const q = query.value.trim()
  if (!q || semanticSearching.value) return
  await doSemanticSearch()
}

// 当前打开文件变化时，重新过滤但不需要重跑
watch(() => props.currentFilePath, () => {
  // activeScope 是 computed 依赖 props，无需重搜
})

const onInput = () => {
  if (debounceTimer) clearTimeout(debounceTimer)
  if (!query.value.trim()) {
    keywordResultsAll.value = []
    semanticResultsAll.value = []
    searched.value = false
    semanticRan.value = false
    return
  }
  debounceTimer = setTimeout(doSearch, 300)
}

const onEnter = () => {
  if (debounceTimer) clearTimeout(debounceTimer)
  doSearch()
}

const openResult = (item) => {
  emit('open-file', {
    filePath: item.filePath,
    nodeUid: item.nodeUid,
    fileType: item.fileType,
    isTag: item.isTag,
    page: item.page,
    scrollTop: item.scrollTop
  })
  showResults.value = false
}

const clearSearch = () => {
  query.value = ''
  keywordResultsAll.value = []
  semanticResultsAll.value = []
  searched.value = false
  semanticRan.value = false
  semanticSeq++
  semanticSearching.value = false
}

const onBlur = () => {
  setTimeout(() => { showResults.value = false }, 200)
}

const focus = () => {
  nextTick(() => {
    inputRef.value?.focus()
    inputRef.value?.select()
  })
}

defineExpose({ focus })
</script>

<style scoped>
.search-bar-container {
  position: relative;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border-color, #e5e5e5);
}

.search-input-wrapper {
  display: flex;
  align-items: center;
  background: var(--search-bg, #f5f5f7);
  border-radius: 8px;
  padding: 0 8px;
  height: 32px;
  transition: box-shadow 0.2s;
}

.search-input-wrapper:focus-within {
  box-shadow: 0 0 0 2px rgba(0, 122, 255, 0.2);
}

.search-icon {
  color: var(--text-secondary, #86868b);
  flex-shrink: 0;
}

.search-input {
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  font-size: 13px;
  padding: 0 6px;
  color: var(--text-primary, #1d1d1f);
}

.search-input::placeholder {
  color: var(--text-secondary, #86868b);
}

.semantic-spinner {
  width: 12px;
  height: 12px;
  flex-shrink: 0;
  margin-right: 4px;
  border: 2px solid rgba(0, 122, 255, 0.2);
  border-top-color: #007aff;
  border-radius: 50%;
  animation: semantic-spin 0.8s linear infinite;
}

@keyframes semantic-spin {
  to { transform: rotate(360deg); }
}

.clear-btn {
  border: none;
  background: transparent;
  cursor: pointer;
  color: var(--text-secondary, #86868b);
  font-size: 12px;
  padding: 2px 4px;
  border-radius: 4px;
}

.clear-btn:hover {
  background: rgba(0, 0, 0, 0.06);
}

.search-results {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  max-height: 460px;
  overflow-y: auto;
  background: var(--popover-bg, #ffffff);
  border: 1px solid var(--border-color, #e5e5e5);
  border-top: none;
  border-radius: 0 0 8px 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
  z-index: 100;
}

.search-status {
  padding: 12px 14px;
  font-size: 12px;
  color: var(--text-secondary, #86868b);
  text-align: center;
}

.run-semantic-link {
  color: var(--apple-blue, #007aff);
  text-decoration: underline;
  cursor: pointer;
}

.search-tabs {
  display: flex;
  gap: 4px;
  padding: 8px 10px 0;
  background: var(--search-bg, #fafafa);
  border-bottom: 1px solid var(--border-color, #f0f0f0);
  position: sticky;
  top: 0;
  z-index: 2;
}

.search-tab {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  border: 1px solid var(--border-color, #e5e5e5);
  border-bottom: none;
  background: var(--popover-bg, #ffffff);
  color: var(--text-secondary, #86868b);
  font-size: 12px;
  font-weight: 600;
  line-height: 24px;
  padding: 0 10px;
  border-radius: 6px 6px 0 0;
  cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}

.search-tab:hover {
  color: var(--text-primary, #1d1d1f);
}

.search-tab.active {
  background: var(--popover-bg, #ffffff);
  border-color: var(--border-color, #e5e5e5);
  border-bottom: 1px solid var(--popover-bg, #ffffff);
  color: var(--apple-blue, #007aff);
  margin-bottom: -1px;
}

.search-subtabs {
  display: flex;
  gap: 6px;
  padding: 6px 10px 8px;
  background: var(--search-bg, #fafafa);
  border-bottom: 1px solid var(--border-color, #f0f0f0);
  position: sticky;
  top: 32px;
  z-index: 2;
}

.search-subtab {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  border: 1px solid var(--border-color, #e5e5e5);
  background: var(--popover-bg, #ffffff);
  color: var(--text-secondary, #86868b);
  font-size: 12px;
  line-height: 22px;
  padding: 0 10px;
  border-radius: 5px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}

.search-subtab:hover {
  color: var(--text-primary, #1d1d1f);
}

.search-subtab.active {
  background: var(--apple-blue, #007aff);
  border-color: var(--apple-blue, #007aff);
  color: #ffffff;
}

.tab-count {
  font-size: 10px;
  line-height: 14px;
  padding: 0 5px;
  border-radius: 7px;
  background: rgba(0, 0, 0, 0.06);
  color: var(--text-secondary, #86868b);
}

.search-subtab.active .tab-count {
  background: rgba(255, 255, 255, 0.25);
  color: #ffffff;
}

.tab-spinner {
  width: 10px;
  height: 10px;
  border-width: 1.5px;
}

.search-result-item {
  padding: 8px 14px;
  cursor: pointer;
  border-bottom: 1px solid var(--border-color, #f0f0f0);
  transition: background 0.15s;
}

.search-result-item:hover {
  background: var(--hover-bg, #f5f5f7);
}

.search-result-item:last-child {
  border-bottom: none;
}

.result-file-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--apple-blue, #007aff);
  margin-bottom: 2px;
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.result-file-name-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}
.tag-atomic {
  display: inline-block;
  flex-shrink: 0;
  padding: 0 6px;
  font-size: 10px;
  font-weight: 600;
  line-height: 18px;
  border-radius: 4px;
  color: #409eff;
  background: rgba(64, 158, 255, 0.12);
}

.result-file-name-tags {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.similarity-badge {
  display: inline-block;
  padding: 0 5px;
  font-size: 10px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  line-height: 16px;
  border-radius: 8px;
  color: #7c4dff;
  background: rgba(124, 77, 255, 0.12);
}

.semantic-tag {
  display: inline-block;
  padding: 0 5px;
  font-size: 10px;
  font-weight: 500;
  line-height: 16px;
  border-radius: 3px;
  color: #7c4dff;
  background: rgba(124, 77, 255, 0.1);
  vertical-align: 1px;
}

.result-snippet {
  font-size: 11px;
  color: var(--text-secondary, #86868b);
  line-height: 1.4;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.result-snippet :deep(mark) {
  background: rgba(255, 213, 79, 0.3);
  color: inherit;
  font-weight: 600;
  border-radius: 2px;
  padding: 0 1px;
}

.search-dropdown-enter-active,
.search-dropdown-leave-active {
  transition: opacity 0.2s, transform 0.2s;
}

.search-dropdown-enter-from,
.search-dropdown-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>

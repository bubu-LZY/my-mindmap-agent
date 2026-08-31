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
      <span v-if="semanticSearching" class="semantic-spinner" title="语义检索中"></span>
      <button v-if="query" class="clear-btn" @click="clearSearch">✕</button>
    </div>

    <Transition name="search-dropdown">
      <div v-if="showResults && (results.length > 0 || searching || semanticSearching || searched)" class="search-results">
        <template v-if="results.length">
          <div class="search-tabs">
            <button
              class="search-tab"
              :class="{ active: activeTab === 'keyword' }"
              @mousedown.prevent="activeTab = 'keyword'"
            >关键词 <span class="tab-count">{{ keywordItems.length }}</span></button>
            <button
              class="search-tab"
              :class="{ active: activeTab === 'semantic' }"
              @mousedown.prevent="activeTab = 'semantic'"
            >语义
              <span class="tab-count">{{ semanticItems.length }}</span>
              <span v-if="semanticSearching" class="semantic-spinner tab-spinner"></span>
            </button>
          </div>
          <div v-if="activeTab === 'semantic' && !semanticItems.length" class="search-status">
            {{ semanticSearching ? '语义检索中...' : (semanticTimeout ? '语义检索超时（模型响应慢），关键词结果不受影响' : '暂无语义匹配结果') }}
          </div>
          <div
            v-for="item in safeTabItems"
            :key="item.filePath + '::' + item.nodeUid"
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
        </template>
        <div v-else-if="searching" class="search-status">关键词搜索中...</div>
        <div v-else-if="semanticSearching" class="search-status">语义检索中...</div>
        <div v-else-if="query.trim()" class="search-status">未找到匹配内容</div>
      </div>
    </Transition>
  </div>
</template>

<script setup>
import { ref, computed, nextTick } from 'vue'
import { searchService } from '../services/searchService'
import { aiService } from '../services/aiService'
import { getTags } from '../utils/tagStore'
import { sanitizeSafeHtml } from '../utils/sanitizeHtml'

const emit = defineEmits(['open-file'])

const inputRef = ref(null)
const query = ref('')
const results = ref([])
const searching = ref(false)
const semanticSearching = ref(false)
const semanticTimeout = ref(false)
const showResults = ref(false)
const searched = ref(false)
const activeTab = ref('keyword')
let debounceTimer = null
let semanticSeq = 0

const keywordItems = computed(() => results.value.filter(r => !r.semanticWord))
// 语义结果按相似度从高到低排序（同分保持命中顺序）
const semanticItems = computed(() =>
  results.value
    .filter(r => r.semanticWord)
    .sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0))
)
const tabItems = computed(() => activeTab.value === 'keyword' ? keywordItems.value : semanticItems.value)

// 安全消毒后的搜索结果（避免 XSS）
const safeTabItems = computed(() =>
  tabItems.value.map(item => ({
    ...item,
    safeSnippet: sanitizeSafeHtml(item.snippet || '')
  }))
)

const runKeywordSearch = async (q) => {
  const res = await searchService.search(q)
  return (res && res.results) || []
}

// 标签搜索：匹配标签名 + 备注，结果项带 isTag 标记（渲染层显示「标签」原子标识）
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
      // 命中词高亮：优先展示备注命中，否则标签名
      const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      const mark = (s) => {
        const e = esc(s)
        const eq = esc(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
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

// 语义检索：让 AI 将查询扩展为带相关度分数的关键词，再对扩展词做本地检索
// 模型调用带 12s 超时，避免模型挂起导致转圈永不结束
const runSemanticSearch = async (q, keywordResults) => {
  const seq = ++semanticSeq
  const seen = new Set(keywordResults.map(r => `${r.filePath}::${r.nodeUid}`))
  try {
    const system = '你是搜索查询扩展助手。将用户的搜索意图扩展为若干同义词、相关词、上下位词（中文），只返回一个 JSON 数组，不要任何其他内容。数组元素 3-6 个，每个元素格式为 {"word":"扩展词","score":相关度}，score 为 0-100 的整数，表示该扩展词与原查询的语义相关度，越相关分数越高，不包含原查询本身。'
    const chatPromise = aiService.chat(`搜索词：${q}`, system)
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        const err = new Error('语义检索超时')
        err.semanticTimeout = true
        reject(err)
      }, 12000)
    })
    const choice = await Promise.race([chatPromise, timeoutPromise])
    const content = choice?.message?.content || ''
    const match = content.match(/\[[\s\S]*?\]/)
    if (!match) return []
    let words = []
    try {
      words = JSON.parse(match[0])
    } catch (e) {
      return []
    }
    if (!Array.isArray(words)) return []
    // 兼容两种格式：{"word","score"} 对象数组（标准）与纯字符串数组（降级按顺序递减给分）
    words = words.map(w => {
      if (typeof w === 'string') return { word: w.trim(), score: null }
      if (w && typeof w === 'object' && typeof w.word === 'string') {
        let s = Number(w.score)
        if (Number.isFinite(s)) {
          if (s > 0 && s <= 1) s = s * 100
          s = Math.max(0, Math.min(100, Math.round(s)))
        } else {
          s = null
        }
        return { word: w.word.trim(), score: s }
      }
      return null
    }).filter(w => w && w.word).slice(0, 6)
    words.forEach((w, i) => { if (w.score == null) w.score = Math.max(50, 90 - i * 8) })
    // 按分数降序遍历：同一结果被多个扩展词命中时，先命中的即为最高分
    words.sort((a, b) => b.score - a.score)

    const semanticItems = []
    for (const { word, score } of words) {
      if (seq !== semanticSeq) return semanticItems // 查询已更新，丢弃过期结果
      const res = await searchService.search(word)
      for (const item of (res?.results || [])) {
        const key = `${item.filePath}::${item.nodeUid}`
        if (seen.has(key)) continue
        seen.add(key)
        semanticItems.push({ ...item, semanticWord: word, similarity: score })
        if (semanticItems.length >= 20) break
      }
      if (semanticItems.length >= 20) break
    }
    return semanticItems
  } catch (err) {
    if (err?.semanticTimeout) {
      semanticTimeout.value = true
      console.warn('[搜索] 语义检索超时，已放弃本次模型调用')
    } else {
      console.error('[搜索] 语义检索失败:', err)
    }
    return []
  }
}

const doSearch = async () => {
  const q = query.value.trim()
  if (!q) {
    results.value = []
    searched.value = false
    semanticSeq++
    semanticSearching.value = false
    semanticTimeout.value = false
    return
  }
  searching.value = true
  showResults.value = true
  activeTab.value = 'keyword'
  semanticTimeout.value = false
  try {
    const keywordResults = await runKeywordSearch(q)
    // 防过期：查询期间输入可能已变化
    if (query.value.trim() !== q) return
    // 标签结果（标签名 + 备注命中）排在关键词结果前面
    const tagResults = searchTags(q)
    results.value = [...tagResults, ...keywordResults]
  } catch (err) {
    console.error('[搜索] 失败:', err)
    results.value = []
  } finally {
    searching.value = false
    searched.value = true
  }

  // 语义增强（异步，不阻塞关键词结果展示）
  semanticSearching.value = true
  const baseResults = results.value
  runSemanticSearch(q, baseResults).then(semanticItems => {
    if (query.value.trim() !== q) return
    results.value = [...baseResults, ...semanticItems]
  }).finally(() => {
    if (query.value.trim() === q) semanticSearching.value = false
  })
}

const onInput = () => {
  if (debounceTimer) clearTimeout(debounceTimer)
  if (!query.value.trim()) {
    results.value = []
    searched.value = false
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
  results.value = []
  searched.value = false
  semanticSeq++
  semanticSearching.value = false
  semanticTimeout.value = false
}

const onBlur = () => {
  setTimeout(() => {
    showResults.value = false
  }, 200)
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
  max-height: 400px;
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

.search-tabs {
  display: flex;
  gap: 4px;
  padding: 8px 10px 6px;
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
  background: var(--popover-bg, #ffffff);
  color: var(--text-secondary, #86868b);
  font-size: 12px;
  line-height: 22px;
  padding: 0 10px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}

.search-tab:hover {
  color: var(--text-primary, #1d1d1f);
}

.search-tab.active {
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

.search-tab.active .tab-count {
  background: rgba(255, 255, 255, 0.25);
  color: #ffffff;
}

.tab-spinner {
  width: 10px;
  height: 10px;
  border-width: 1.5px;
}

.search-tab .semantic-spinner {
  border-color: rgba(0, 122, 255, 0.25);
  border-top-color: #007aff;
}

.search-tab.active .semantic-spinner {
  border-color: rgba(255, 255, 255, 0.35);
  border-top-color: #ffffff;
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

<template>
  <div
    class="floating-browser"
    :style="{ left: pos.x + 'px', top: pos.y + 'px', width: size.w + 'px', height: size.h + 'px' }"
    @mousedown.stop
    @dragenter="onBrowserDragEnter"
    @dragleave="onBrowserDragLeave"
    @dragover="onBrowserDragOver"
    @drop="onBrowserDrop"
  >
    <div
      class="fb-header"
      @pointerdown="onDragStart"
      @pointermove="onDragMove"
      @pointerup="onDragEnd"
      @pointercancel="onDragEnd"
    >
      <div class="fb-title">
        <svg viewBox="0 0 16 16" fill="none" width="13" height="13">
          <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.3"/>
          <path d="M2.5 8h11M8 2.5c-2 1.7-2 9.3 0 11 2-1.7 2-9.3 0-11z" stroke="currentColor" stroke-width="1.3"/>
        </svg>
        <span>浏览器</span>
      </div>
      <div class="fb-header-actions">
        <button class="fb-icon-btn" title="后退" @click.stop="goBack">←</button>
        <button class="fb-icon-btn" title="前进" @click.stop="goForward">→</button>
        <button class="fb-icon-btn" title="刷新" @click.stop="reload">↻</button>
        <button class="fb-icon-btn" title="快速收藏当前页" @click.stop="quickAddCurrent">★</button>
        <button class="fb-icon-btn" title="关闭" @click.stop="close">×</button>
      </div>
    </div>

    <!-- 标签栏 -->
    <div class="fb-tabs">
      <div
        v-for="t in tabs"
        :key="t.id"
        class="fb-tab"
        :class="{ active: t.id === activeTabId }"
        :title="t.url"
        @click="activateTab(t.id)"
      >
        <span class="fb-tab-dot" :class="{ loading: t.loading }"></span>
        <span class="fb-tab-title">{{ t.title || '新标签页' }}</span>
        <button class="fb-tab-close" title="关闭标签" @click.stop="closeTab(t.id)">×</button>
      </div>
      <button class="fb-tab-add" title="新建标签页" @click="newTab">+</button>
    </div>

    <!-- 收藏栏 + 地址栏 -->
    <div class="fb-toolbar">
      <div class="fb-bookmarks">
        <button
          v-for="s in sites"
          :key="s.url"
          class="fb-bookmark"
          :class="{ active: activeTab && activeTab.url.startsWith(s.url) }"
          :title="s.name"
          @click="openBookmark(s, $event)"
        >
          <span class="fb-bookmark-dot">{{ s.name.slice(0, 1) }}</span>
          <span class="fb-bookmark-name">{{ s.name }}</span>
          <button
            v-if="!DEFAULT_SITES.some(d => d.url === s.url)"
            class="fb-bookmark-remove"
            title="删除该收藏"
            @click.stop="removeSite(s)"
          >×</button>
        </button>
        <button class="fb-bookmark fb-bookmark-add" title="添加常用网页" @click="addingSite = !addingSite">+</button>
      </div>
      <div v-if="addingSite" class="fb-add-row">
        <input v-model="newSiteName" class="fb-add-input" placeholder="名称" />
        <input v-model="newSiteUrl" class="fb-add-input fb-add-url" placeholder="网址" @keydown.enter="addSite" />
        <button class="fb-icon-btn" title="保存" @click="addSite">✓</button>
      </div>
      <div class="fb-address-row">
        <input
          v-model="addressInput"
          class="fb-address"
          placeholder="输入网址，回车打开"
          @keydown.enter="openAddress"
        />
        <button class="fb-icon-btn" title="打开" @click="openAddress">→</button>
      </div>
    </div>

    <!-- 每个标签页对应一个 webview，v-show 保留页面状态 -->
    <div class="fb-webview-wrap">
      <webview
        v-for="t in tabs"
        :key="t.id"
        v-show="t.id === activeTabId"
        :ref="el => setWebviewRef(t.id, el)"
        :src="t.url"
        class="fb-webview"
        partition="persist:ai-web-browser"
        allowpopups
        @page-title-updated="e => onTitleUpdated(t.id, e)"
        @did-start-loading="t.loading = true"
        @did-stop-loading="t.loading = false"
      ></webview>
      <!-- 应用内文件拖拽覆盖层：只覆盖网页区域，提示用户拖到当前网页输入框上方 -->
      <div
        v-if="appDragOver"
        class="fb-drop-overlay"
        @dragover.prevent.stop="onBrowserDragOver"
        @dragleave="onBrowserDragLeave"
        @drop.prevent.stop="onBrowserDrop"
      >
        <div class="fb-drop-box">
          <svg viewBox="0 0 24 24" fill="none" width="30" height="30">
            <path d="M12 16V4M12 4L7.5 8.5M12 4l4.5 4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M5 14v4a2 2 0 002 2h10a2 2 0 002-2v-4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
          </svg>
          <div class="fb-drop-title">松开鼠标，上传到当前网页输入框</div>
          <div class="fb-drop-desc">.smm 文件会自动转为 Markdown 后上传</div>
        </div>
      </div>
    </div>
    <div
      class="fb-resize-handle"
      @pointerdown.prevent="onResizeStart"
      @pointermove="onResizeMove"
      @pointerup="onResizeEnd"
      @pointercancel="onResizeEnd"
    ></div>

  </div>
</template>

<script setup>
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { treeToMarkdown } from '../utils/markdownParser'
import { getDragFilePath, clearDragFilePath } from '../utils/dragState'

const emit = defineEmits(['close'])

const DEFAULT_SITES = [
  { name: 'DeepSeek', url: 'https://chat.deepseek.com/' },
  { name: '豆包', url: 'https://www.doubao.com/chat/' },
  { name: 'Kimi', url: 'https://kimi.moonshot.cn/' },
  { name: '通义', url: 'https://tongyi.aliyun.com/' }
]

const CUSTOM_SITES_KEY = 'floating_browser_custom_sites'
const LAST_TABS_KEY = 'floating_browser_tabs'

const loadCustomSites = () => {
  try {
    const list = JSON.parse(localStorage.getItem(CUSTOM_SITES_KEY) || '[]')
    return Array.isArray(list) ? list.filter(s => s && s.name && s.url) : []
  } catch { return [] }
}

const loadTabs = () => {
  try {
    const list = JSON.parse(localStorage.getItem(LAST_TABS_KEY) || '[]')
    if (Array.isArray(list) && list.length) {
      return list.filter(t => t && t.url).slice(0, 12).map(t => ({
        id: t.id || genTabId(),
        url: t.url,
        title: t.title || '',
        loading: false
      }))
    }
  } catch {}
  return [{ id: genTabId(), url: DEFAULT_SITES[0].url, title: '', loading: false }]
}

let tabSeq = 0
const genTabId = () => 'bt_' + Date.now() + '_' + (++tabSeq)

const sites = ref([...DEFAULT_SITES, ...loadCustomSites()])
const tabs = ref(loadTabs())
const activeTabId = ref(tabs.value[0]?.id || '')
const addressInput = ref(tabs.value[0]?.url || DEFAULT_SITES[0].url)
const addingSite = ref(false)
const newSiteName = ref('')
const newSiteUrl = ref('')
const webviewRefs = {}
const zoomFactors = {}
const appDragOver = ref(false)

const pos = ref({ x: Math.max(20, (window.innerWidth - 720) / 2), y: 70 })
const size = ref({ w: 720, h: 500 })
let dragOffset = null
let resizeStart = null
let appDragDepth = 0

const activeTab = computed(() => tabs.value.find(t => t.id === activeTabId.value) || tabs.value[0] || null)

watch(activeTabId, () => {
  const t = activeTab.value
  if (t) addressInput.value = t.url
})

const persistTabs = () => {
  localStorage.setItem(LAST_TABS_KEY, JSON.stringify(tabs.value.map(t => ({ id: t.id, url: t.url, title: t.title }))))
}

const setWebviewRef = (id, el) => {
  if (el) {
    webviewRefs[id] = el
    el.addEventListener('wheel', (e) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      const current = zoomFactors[id] ?? 1
      const next = Math.max(0.5, Math.min(3, current + (e.deltaY < 0 ? 0.1 : -0.1)))
      zoomFactors[id] = next
      try { el.setZoomFactor?.(next) } catch (err) {}
    }, { passive: false })
  } else {
    delete webviewRefs[id]
    delete zoomFactors[id]
  }
}

const getActiveWebview = () => webviewRefs[activeTabId.value]

const normalizeUrl = (value, fallback) => {
  const v = String(value || '').trim()
  if (!v) return fallback || DEFAULT_SITES[0].url
  if (/^https?:\/\//i.test(v)) return v
  if (/^[a-z0-9.-]+\.[a-z]{2,}/i.test(v)) return 'https://' + v
  return 'https://www.google.com/search?q=' + encodeURIComponent(v)
}

const openInActiveTab = (url) => {
  const t = activeTab.value
  if (!t) return
  t.url = url
  t.title = ''
  addressInput.value = url
  persistTabs()
}

const openBookmark = (site, e) => {
  // Ctrl/Cmd + 点击：在新标签页打开；普通点击：在当前标签页打开
  if (e && (e.ctrlKey || e.metaKey)) {
    newTab(site.url)
  } else {
    openInActiveTab(site.url)
  }
}

const newTab = (url) => {
  const t = { id: genTabId(), url: url || DEFAULT_SITES[0].url, title: '', loading: false }
  tabs.value.push(t)
  activeTabId.value = t.id
  addressInput.value = t.url
  persistTabs()
}

const activateTab = (id) => {
  activeTabId.value = id
}

const closeTab = (id) => {
  const idx = tabs.value.findIndex(t => t.id === id)
  if (idx < 0) return
  tabs.value.splice(idx, 1)
  delete webviewRefs[id]
  if (tabs.value.length === 0) {
    close()
    return
  }
  if (activeTabId.value === id) {
    activeTabId.value = tabs.value[Math.max(0, idx - 1)].id
  }
  persistTabs()
}

const onTitleUpdated = (id, e) => {
  const t = tabs.value.find(x => x.id === id)
  if (t && e?.title) {
    t.title = e.title
    persistTabs()
  }
}

const openAddress = () => {
  const t = activeTab.value
  if (!t) return
  const url = normalizeUrl(addressInput.value, t.url)
  t.url = url
  t.title = ''
  addressInput.value = url
  persistTabs()
}

const quickAddCurrent = () => {
  const t = activeTab.value
  if (!t || !t.url) return
  const host = (() => { try { return new URL(t.url).hostname.replace(/^www\./, '') } catch { return t.url } })()
  const name = (t.title && t.title.trim() ? t.title : host).slice(0, 24)
  if (sites.value.some(s => s.url === t.url)) return
  sites.value.push({ name, url: t.url })
  persistCustomSites()
}

const persistCustomSites = () => {
  const customs = sites.value.filter(s => !DEFAULT_SITES.some(d => d.url === s.url))
  localStorage.setItem(CUSTOM_SITES_KEY, JSON.stringify(customs))
}

const addSite = () => {
  const name = newSiteName.value.trim()
  const raw = newSiteUrl.value.trim()
  if (!name || !raw) return
  const url = normalizeUrl(raw, DEFAULT_SITES[0].url)
  if (sites.value.some(s => s.url === url)) {
    newSiteName.value = ''
    newSiteUrl.value = ''
    addingSite.value = false
    return
  }
  sites.value.push({ name, url })
  persistCustomSites()
  newSiteName.value = ''
  newSiteUrl.value = ''
  addingSite.value = false
  openInActiveTab(url)
}

const removeSite = (site) => {
  if (DEFAULT_SITES.some(d => d.url === site.url)) return
  sites.value = sites.value.filter(s => s.url !== site.url)
  persistCustomSites()
}

const goBack = () => { try { getActiveWebview()?.back?.() } catch (e) {} }
const goForward = () => { try { getActiveWebview()?.forward?.() } catch (e) {} }
const reload = () => { try { getActiveWebview()?.reload?.() } catch (e) {} }
const close = () => { emit('close') }

const onDragStart = (e) => {
  // 点击头部按钮时不启动拖拽，避免 pointer capture 吃掉按钮的 click 事件
  if (e.target && e.target.closest && e.target.closest('button, input, .fb-site, .fb-bookmark')) return
  const rect = e.currentTarget.closest('.floating-browser')?.getBoundingClientRect()
  if (!rect) return
  dragOffset = { x: e.clientX - rect.left, y: e.clientY - rect.top }
  try { e.currentTarget.setPointerCapture?.(e.pointerId) } catch (err) {}
}

const onDragMove = (e) => {
  if (!dragOffset) return
  pos.value = {
    x: Math.max(0, e.clientX - dragOffset.x),
    y: Math.max(0, e.clientY - dragOffset.y)
  }
}

const onDragEnd = (e) => {
  dragOffset = null
  try { e.currentTarget.releasePointerCapture?.(e.pointerId) } catch (err) {}
}

const onResizeStart = (e) => {
  resizeStart = { x: e.clientX, y: e.clientY, w: size.value.w, h: size.value.h }
  try { e.currentTarget.setPointerCapture?.(e.pointerId) } catch (err) {}
}

const onResizeMove = (e) => {
  if (!resizeStart) return
  size.value = {
    w: Math.max(360, resizeStart.w + (e.clientX - resizeStart.x)),
    h: Math.max(280, resizeStart.h + (e.clientY - resizeStart.y))
  }
}

const onResizeEnd = (e) => {
  resizeStart = null
  try { e.currentTarget.releasePointerCapture?.(e.pointerId) } catch (err) {}
}

const isAppFileDrag = () => {
  const p = getDragFilePath()
  return !!p && !p.includes('://')
}

const onBrowserDragEnter = (e) => {
  if (!isAppFileDrag()) return
  appDragDepth++
  appDragOver.value = true
}

const onBrowserDragLeave = (e) => {
  if (!isAppFileDrag()) return
  appDragDepth = Math.max(0, appDragDepth - 1)
  if (appDragDepth === 0) appDragOver.value = false
}

const onBrowserDragOver = (e) => {
  // 只接管应用内文件树拖拽；系统文件拖拽留给 webview 原生处理（用于直接上传）
  if (isAppFileDrag()) {
    e.preventDefault()
    appDragOver.value = true
  }
}

const readFileText = async (path) => {
  if (!window.electronAPI?.fs?.readFile) return ''
  const raw = await window.electronAPI.fs.readFile(path)
  if (typeof raw === 'string') return raw
  if (raw && typeof raw.text === 'function') return raw.text()
  if (raw && raw.base64) {
    const bytes = Uint8Array.from(atob(raw.base64), c => c.charCodeAt(0))
    return new TextDecoder().decode(bytes)
  }
  return ''
}

const smmToMarkdown = (text) => {
  try {
    const tree = JSON.parse(text)
    if (tree && tree.data) return treeToMarkdown(tree)
  } catch (e) {}
  return text
}

const bytesToBase64 = (bytes) => {
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

const onBrowserDrop = async (e) => {
  appDragDepth = 0
  appDragOver.value = false
  if (!isAppFileDrag()) return
  e.preventDefault()
  const filePath = getDragFilePath()
  clearDragFilePath()
  if (!filePath) return
  try {
    const raw = await readFileText(filePath)
    if (!raw) return
    const ext = String(filePath.split('.').pop() || '').toLowerCase()
    const isSmm = ext === 'smm'
    const text = isSmm ? smmToMarkdown(raw) : raw
    const fileName = isSmm ? filePath.split(/[\\/]/).pop().replace(/\.smm$/i, '.md') : filePath.split(/[\\/]/).pop()
    const bytes = new TextEncoder().encode(text)
    const base64 = bytesToBase64(bytes)
    const wv = getActiveWebview()
    if (!wv) return
    const rect = wv.getBoundingClientRect()
    if (
      e.clientX < rect.left ||
      e.clientX > rect.right ||
      e.clientY < rect.top ||
      e.clientY > rect.bottom
    ) {
      appDragOver.value = false
      return
    }
    const gx = Math.max(0, Math.min(rect.width, e.clientX - rect.left))
    const gy = Math.max(0, Math.min(rect.height, e.clientY - rect.top))
    const code = `(function(){
      try {
        var bytes = Uint8Array.from(atob(${JSON.stringify(base64)}), function(c){ return c.charCodeAt(0); });
        var file = new File([bytes], ${JSON.stringify(fileName)}, { type: 'text/markdown' });
        var dt = new DataTransfer();
        dt.items.add(file);
        var target = document.elementFromPoint(${Math.round(gx)}, ${Math.round(gy)}) || document.body;
        var opts = { bubbles: true, cancelable: true, composed: true, dataTransfer: dt };
        target.dispatchEvent(new DragEvent('dragover', opts));
        target.dispatchEvent(new DragEvent('drop', opts));
        return true;
      } catch (err) { return String(err && err.message || err); }
    })()`
    const res = await wv.executeJavaScript(code, true).catch(err => String(err?.message || err))
    if (res !== true) {
      // 站点不接受合成拖拽时，保留原文件内容到剪贴板作为兜底？这里只记录调试信息，不打断用户
      console.warn('[浏览器] 拖拽注入上传未生效:', res)
    }
  } catch (err) {
    console.warn('[浏览器] 处理应用内文件拖拽失败:', err)
  }
}

onBeforeUnmount(() => {
  for (const el of Object.values(webviewRefs)) {
    try { el?.stop?.() } catch (e) {}
  }
})
</script>

<style scoped>
.floating-browser {
  position: fixed;
  z-index: 7200;
  max-width: calc(100vw - 40px);
  max-height: calc(100vh - 40px);
  display: flex;
  flex-direction: column;
  background: #fff;
  border: 1px solid rgba(0, 0, 0, 0.1);
  border-radius: 14px;
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.22);
  overflow: hidden;
}
.fb-resize-handle {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 18px;
  height: 18px;
  cursor: nwse-resize;
  background: linear-gradient(135deg, transparent 50%, rgba(0, 0, 0, 0.18) 50%);
  border-radius: 0 0 14px 0;
  z-index: 2;
}
.fb-drop-overlay {
  position: absolute;
  inset: 0;
  z-index: 6;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 122, 255, 0.12);
  border: 2px dashed rgba(0, 122, 255, 0.6);
  border-radius: 14px;
  pointer-events: auto;
}
.fb-drop-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 18px 24px;
  background: rgba(255, 255, 255, 0.96);
  border-radius: 14px;
  color: #007aff;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.16);
}
.fb-drop-title {
  font-size: 14px;
  font-weight: 600;
  color: #1c1c1e;
}
.fb-drop-desc {
  font-size: 12px;
  color: #6b7280;
}
.fb-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 30px;
  padding: 0 8px;
  background: #f5f6f8;
  cursor: move;
  flex-shrink: 0;
}
.fb-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  color: #1c1c1e;
  user-select: none;
}
.fb-header-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}
.fb-icon-btn {
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #3a3a3c;
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
}
.fb-icon-btn:hover {
  background: rgba(0, 0, 0, 0.07);
}
.fb-tabs {
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 3px 6px 0;
  overflow-x: auto;
  flex-shrink: 0;
  background: #fafafa;
}
.fb-tab {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: 180px;
  padding: 3px 6px;
  border: 1px solid transparent;
  border-radius: 6px 6px 0 0;
  color: #6b7280;
  font-size: 11px;
  cursor: pointer;
  user-select: none;
  background: #f0f1f3;
}
.fb-tab.active {
  background: #fff;
  border-color: rgba(0, 0, 0, 0.06);
  border-bottom-color: #fff;
  color: #1c1c1e;
  font-weight: 600;
}
.fb-tab-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #34c759;
  flex-shrink: 0;
}
.fb-tab-dot.loading {
  background: #ff9500;
  animation: pulse 1.2s ease-in-out infinite;
}
.fb-tab-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 110px;
}
.fb-tab-close {
  width: 12px;
  height: 12px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: #9aa5b1;
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
}
.fb-tab-close:hover {
  background: rgba(0, 0, 0, 0.08);
  color: #1c1c1e;
}
.fb-tab-add {
  width: 22px;
  height: 22px;
  flex-shrink: 0;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: #007aff;
  font-size: 15px;
  line-height: 1;
  cursor: pointer;
}
.fb-tab-add:hover {
  background: rgba(0, 122, 255, 0.1);
}
.fb-toolbar {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 5px 8px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
  flex-shrink: 0;
}
.fb-bookmarks {
  display: flex;
  gap: 5px;
  flex-wrap: wrap;
}
.fb-bookmark {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px 2px 4px;
  border: 1px solid rgba(0, 122, 255, 0.18);
  border-radius: 999px;
  background: rgba(0, 122, 255, 0.06);
  color: #2563eb;
  font-size: 11px;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}
.fb-bookmark:hover {
  background: rgba(0, 122, 255, 0.14);
  border-color: rgba(0, 122, 255, 0.4);
}
.fb-bookmark.active {
  background: rgba(0, 122, 255, 0.18);
  border-color: rgba(0, 122, 255, 0.5);
  color: #0b57d0;
  font-weight: 600;
}
.fb-bookmark-dot {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: rgba(0, 122, 255, 0.18);
  color: #0b57d0;
  font-size: 9px;
  font-weight: 700;
  flex-shrink: 0;
}
.fb-bookmark-name {
  white-space: nowrap;
}
.fb-bookmark-remove {
  width: 12px;
  height: 12px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: rgba(37, 99, 235, 0.55);
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
}
.fb-bookmark-remove:hover {
  background: rgba(0, 122, 255, 0.18);
  color: #0b57d0;
}
.fb-bookmark-add {
  padding: 3px 9px;
  font-weight: 700;
}
.fb-add-row {
  display: flex;
  gap: 6px;
}
.fb-add-input {
  height: 24px;
  padding: 0 8px;
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 7px;
  font-size: 11px;
  outline: none;
  color: #1c1c1e;
}
.fb-add-input:focus {
  border-color: rgba(0, 122, 255, 0.5);
}
.fb-add-url {
  flex: 1;
}
.fb-address-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.fb-address {
  flex: 1;
  height: 24px;
  padding: 0 8px;
  border: 1px solid rgba(0, 0, 0, 0.1);
  border-radius: 7px;
  font-size: 11px;
  color: #1c1c1e;
  outline: none;
}
.fb-address:focus {
  border-color: rgba(0, 122, 255, 0.5);
}
.fb-webview-wrap {
  flex: 1;
  min-height: 0;
  position: relative;
}
.fb-webview {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border: none;
}
</style>

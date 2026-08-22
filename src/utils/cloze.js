/**
 * 挖空功能状态管理
 * 节点富文本中被挖空的内容包裹在 <span class="smm-cloze"> 中
 * 隐藏时：文字透明 + 半透明紫底 + 紫下划线
 * 显示时：文字可见 + 紫下划线
 *
 * 状态持久化到 localStorage，含 hiddenAll 和 nodeOverrideMap
 */

let hiddenAll = true
const nodeOverrideMap = new Map()
let mindMapRef = null
let clozeObserver = null
let clozeObserverTimer = null
let clozeRenderHandler = null

const CLOZE_STATE_KEY = 'SIMPLE_MIND_MAP_CLOZE_STATE'

/* ==================== 持久化 ==================== */

export const saveClozeState = () => {
  const state = {
    hiddenAll,
    overrides: Object.fromEntries(nodeOverrideMap)
  }
  try {
    localStorage.setItem(CLOZE_STATE_KEY, JSON.stringify(state))
  } catch (e) {}
}

export const loadClozeState = () => {
  try {
    const raw = localStorage.getItem(CLOZE_STATE_KEY)
    if (!raw) return
    const state = JSON.parse(raw)
    hiddenAll = state.hiddenAll !== undefined ? state.hiddenAll : true
    nodeOverrideMap.clear()
    if (state.overrides) {
      for (const [uid, hidden] of Object.entries(state.overrides)) {
        nodeOverrideMap.set(uid, hidden)
      }
    }
  } catch (e) {}
}

export const applyClozeStateFromStorage = () => {
  loadClozeState()
  applyClozeStyles()
}

/* ==================== 初始化 / 销毁 ==================== */

export const initCloze = (mindMap) => {
  destroyCloze()
  mindMapRef = mindMap
  loadClozeState()
  // 注入CSS样式，确保 .smm-cloze 在 SVG foreignObject 中正确渲染
  if (typeof mindMap.appendCss === 'function') {
    mindMap.appendCss('cloze', `
      .smm-cloze {
        border-radius: 2px;
      }
      /* 隐藏态：挖空 span 及其所有后代全部透明。
         后代可能自带 color 内联样式（先设字色再挖空），仅靠外层 transparent 继承会被其自身样式覆盖，导致文字藏不住 */
      .smm-cloze-hidden,
      .smm-cloze-hidden * {
        color: transparent !important;
      }
    `)
  }
  // 监听渲染完成事件，在每次渲染后重新应用样式（保存引用，销毁时解绑防止重复注册）
  if (typeof mindMap.on === 'function') {
    clozeRenderHandler = () => {
      setTimeout(() => applyClozeStyles(), 50)
      setTimeout(() => applyClozeStyles(), 200)
    }
    mindMap.on('node_tree_render_end', clozeRenderHandler)
  }
  startClozeObserver()
  // initCloze 可能被 AI 挖空等功能重复调用，内部 destroyCloze 会解绑点击监听，这里必须重新注册
  setupClozeClickHandler(mindMap)
}

export const destroyCloze = () => {
  if (clozeRenderHandler && mindMapRef && typeof mindMapRef.off === 'function') {
    try {
      mindMapRef.off('node_tree_render_end', clozeRenderHandler)
    } catch (e) {}
  }
  clozeRenderHandler = null
  if (clozeObserverTimer) {
    clearTimeout(clozeObserverTimer)
    clozeObserverTimer = null
  }
  if (clozeObserver) {
    try {
      clozeObserver.disconnect()
    } catch (e) {}
    clozeObserver = null
  }
  if (clozeClickContainer) {
    if (clozeClickHandler) {
      try {
        clozeClickContainer.removeEventListener('click', clozeClickHandler, true)
      } catch (e) {}
    }
    if (clozeDblclickHandler) {
      try {
        clozeClickContainer.removeEventListener('dblclick', clozeDblclickHandler, true)
      } catch (e) {}
    }
  }
  clozeClickHandler = null
  clozeDblclickHandler = null
  clozeClickContainer = null
}

const startClozeObserver = (retries = 20) => {
  if (clozeObserver) return
  if (!mindMapRef) return

  // 尝试获取思维导图容器
  const container = mindMapRef.el || document.querySelector('.mind-map-container')
  if (!container) {
    if (retries > 0) {
      setTimeout(() => startClozeObserver(retries - 1), 500)
    }
    return
  }
  clozeObserver = new MutationObserver(() => {
    if (clozeObserverTimer) clearTimeout(clozeObserverTimer)
    clozeObserverTimer = setTimeout(applyClozeStyles, 100)
  })
  clozeObserver.observe(container, { childList: true, subtree: true })
}

/* ==================== 状态查询 ==================== */

export const isClozeHiddenAll = () => hiddenAll

const isNodeClozeHidden = (uid) => {
  if (nodeOverrideMap.has(uid)) return nodeOverrideMap.get(uid)
  return hiddenAll
}

export const nodeHasCloze = (node) => {
  const text = (typeof node?.getData === 'function' ? node.getData('text') : node?.text) || ''
  return typeof text === 'string' && text.includes('smm-cloze')
}

/* ==================== 样式应用 ==================== */

const applyClozeStylesToElement = (el, uid, hidden) => {
  if (!el) return
  el.classList.toggle('smm-cloze-hidden', hidden)
  el.setAttribute('data-cloze-uid', uid)
  el.style.setProperty('cursor', 'pointer', 'important')
  // 统一深紫色（#7c3aed），下划线用 background-image 渐变（SVG foreignObject 中渲染最可靠）
  // border-bottom 显式置 none：思维导图 CSS 带 border-bottom 下划线兜底，叠加渐变线会显粗
  if (hidden) {
    el.style.setProperty('color', 'transparent', 'important')
    el.style.setProperty('background-color', 'rgba(124, 58, 237, 0.18)', 'important')
    el.style.setProperty('background-image', 'linear-gradient(#7c3aed, #7c3aed)', 'important')
    el.style.setProperty('background-position', '0 100%', 'important')
    el.style.setProperty('background-size', '100% 3px', 'important')
    el.style.setProperty('background-repeat', 'no-repeat', 'important')
    el.style.setProperty('border-bottom', 'none', 'important')
    el.style.setProperty('padding-bottom', '2px', 'important')
  } else {
    el.style.setProperty('background-color', 'rgba(124, 58, 237, 0.13)', 'important')
    el.style.setProperty('background-image', 'linear-gradient(#7c3aed, #7c3aed)', 'important')
    el.style.setProperty('background-position', '0 100%', 'important')
    el.style.setProperty('background-size', '100% 3px', 'important')
    el.style.setProperty('background-repeat', 'no-repeat', 'important')
    el.style.setProperty('border-bottom', 'none', 'important')
    el.style.setProperty('padding-bottom', '2px', 'important')
    el.style.removeProperty('color')
  }
}

// 嵌套挖空的内层 span：不重复叠加下划线/底色（叠加会导致线变粗、颜色加深），
// 只跟随外层做透明隐藏
const applyNestedClozeStylesToElement = (el, hidden) => {
  if (!el) return
  el.classList.toggle('smm-cloze-hidden', hidden)
  if (hidden) {
    el.style.setProperty('color', 'transparent', 'important')
  } else {
    el.style.removeProperty('color')
  }
  // border-bottom 用置 none 而非 removeProperty：
  // 移除后思维导图 CSS 的 border-bottom 下划线会重新生效，与外层渐变线叠加显粗
  el.style.setProperty('border-bottom', 'none', 'important')
  el.style.removeProperty('background-color')
  el.style.removeProperty('background-image')
  el.style.removeProperty('background-position')
  el.style.removeProperty('background-size')
  el.style.removeProperty('background-repeat')
  el.style.removeProperty('padding-bottom')
}

// 是否为嵌套的内层挖空（自身外层还存在 .smm-cloze 祖先）
const isNestedClozeEl = (el) => {
  const outer = el.parentElement?.closest?.('.smm-cloze')
  return !!outer && outer !== el
}

// 供大纲视图等外部复用（HTML 环境与 foreignObject 均适用）
export { applyClozeStylesToElement, applyNestedClozeStylesToElement, isNestedClozeEl }

// 按 uid 查询挖空隐藏状态（大纲视图使用）
export const isUidClozeHidden = (uid) => isNodeClozeHidden(uid)

// 按 uid 切换挖空显隐（大纲视图点击挖空文字时使用）
export const toggleClozeByUid = (uid) => {
  if (!uid) return null
  const cur = isNodeClozeHidden(uid)
  nodeOverrideMap.set(uid, !cur)
  saveClozeState()
  applyClozeStyles()
  window.dispatchEvent(new CustomEvent('cloze-state-changed', { detail: { hiddenAll, uid } }))
  return !cur
}

export const applyClozeStyles = () => {
  if (!mindMapRef || !mindMapRef.renderer) return
  const root = mindMapRef.renderer.root
  if (!root) return

  // 主路径：通过 renderer 树遍历
  const walk = (node) => {
    if (node._textData && node._textData.node && node._textData.node.node) {
      const el = node._textData.node.node
      // 在节点 <g> 上标记 uid，供点击挖空切换显隐时定位节点
      if (el.getAttribute('data-uid') !== node.uid) {
        el.setAttribute('data-uid', node.uid)
      }
      const clozeEls = el.querySelectorAll('.smm-cloze')
      if (clozeEls.length > 0) {
        const hidden = isNodeClozeHidden(node.uid)
        clozeEls.forEach(span => {
          if (isNestedClozeEl(span)) {
            applyNestedClozeStylesToElement(span, hidden)
          } else {
            applyClozeStylesToElement(span, node.uid, hidden)
          }
        })
      }
    }
    if (node.children) {
      node.children.forEach(walk)
    }
  }
  walk(root)

  // 兜底：直接在容器 DOM 中查找所有 .smm-cloze 元素
  const container = mindMapRef.el || document.querySelector('.mind-map-container')
  if (container) {
    const allClozeEls = container.querySelectorAll('.smm-cloze')
    allClozeEls.forEach(span => {
      if (isNestedClozeEl(span)) {
        const outerUid = span.closest('[data-cloze-uid]')?.getAttribute('data-cloze-uid') || ''
        const hidden = outerUid ? isNodeClozeHidden(outerUid) : hiddenAll
        applyNestedClozeStylesToElement(span, hidden)
        return
      }
      let uid = span.getAttribute('data-cloze-uid')
      if (!uid) {
        const nodeEl = span.closest('[data-uid]')
        uid = nodeEl?.getAttribute('data-uid') || ''
      }
      if (uid) {
        const hidden = isNodeClozeHidden(uid)
        applyClozeStylesToElement(span, uid, hidden)
      } else {
        // 没有找到 uid，仅应用全局隐藏状态
        applyClozeStylesToElement(span, '', hiddenAll)
      }
    })
  }
}

/* ==================== 切换挖空显隐 ==================== */

const findNodeByUid = (root, uid) => {
  if (!root) return null
  if (root.uid === uid) return root
  if (root.children) {
    for (const child of root.children) {
      const found = findNodeByUid(child, uid)
      if (found) return found
    }
  }
  return null
}

let clozeClickHandler = null
let clozeDblclickHandler = null
let clozeClickContainer = null
// 双击去抖：双击的第二次单击不再切换，净效果为切换一次
const clozeLastToggleTs = new Map()

export const setupClozeClickHandler = (mindMap) => {
  const container = mindMap.el || document.querySelector('.mind-map-container')
  if (!container) {
    console.warn('[cloze] setupClozeClickHandler: container not found')
    return
  }
  // 容器变化（编辑器重建）时先解绑旧监听，避免失效或重复触发
  if (clozeClickHandler && clozeClickContainer && clozeClickContainer !== container) {
    try {
      clozeClickContainer.removeEventListener('click', clozeClickHandler, true)
    } catch (e) {}
    try {
      clozeClickContainer.removeEventListener('dblclick', clozeDblclickHandler, true)
    } catch (e) {}
    clozeClickHandler = null
    clozeDblclickHandler = null
  }
  if (clozeClickHandler) return

  const findClozeTarget = (e) => {
    const t = e.target
    if (!t || typeof t.closest !== 'function') return null
    return t.closest('.smm-cloze')
  }

  // 双击挖空文本：阻止进入编辑模式（切换显隐由单击完成）
  clozeDblclickHandler = (e) => {
    const clozeEl = findClozeTarget(e)
    if (!clozeEl) return
    e.preventDefault()
    e.stopPropagation()
  }

  clozeClickHandler = (e) => {
    // 仅当点击发生在真实可见的编辑框内部时忽略（编辑态挖空由 Ctrl+H 处理）
    const rt = mindMap.richText
    if (rt && rt.textEditNode && rt.textEditNode.contains &&
        rt.textEditNode.style.display !== 'none' &&
        rt.textEditNode.contains(e.target)) {
      return
    }
    const clozeEl = findClozeTarget(e)
    if (!clozeEl) return

    e.preventDefault()
    e.stopPropagation()

    // 定位 uid：优先 span 上的 data-cloze-uid，其次向上找带 data-uid 的节点 <g>
    let uid = clozeEl.getAttribute('data-cloze-uid')
    if (!uid) {
      const nodeEl = clozeEl.closest?.('[data-uid]')
      uid = nodeEl?.getAttribute('data-uid') || ''
    }

    if (!uid || !mindMap.renderer || !mindMap.renderer.root) {
      console.warn('[cloze] click handler: uid not found or renderer not ready', { uid, hasRenderer: !!mindMap.renderer })
      return
    }

    // 双击去抖：双击的第二次单击直接吞掉，整体只切换一次
    const now = Date.now()
    const last = clozeLastToggleTs.get(uid) || 0
    if (now - last < 320) {
      clozeLastToggleTs.delete(uid)
      return
    }
    clozeLastToggleTs.set(uid, now)

    const node = findNodeByUid(mindMap.renderer.root, uid)
    if (node) {
      // 点击挖空文字同时激活所在节点：否则点击事件被拦截后节点不会进入选中态，
      // 后续 Ctrl+H 手动挖空等操作会作用于残留的旧选中节点
      try {
        const r = mindMap.renderer
        if (r && Array.isArray(r.activeNodeList) && !r.activeNodeList.includes(node)) {
          if (typeof r.clearActiveNode === 'function') r.clearActiveNode()
          if (typeof r.addNodeToActiveList === 'function') r.addNodeToActiveList(node)
          if (typeof r.emitNodeActiveEvent === 'function') r.emitNodeActiveEvent()
        }
      } catch (e) {}
      toggleNodeCloze(node)
    } else {
      console.warn('[cloze] click handler: node not found for uid', uid)
    }
  }
  container.addEventListener('click', clozeClickHandler, true)
  container.addEventListener('dblclick', clozeDblclickHandler, true)
  clozeClickContainer = container
  console.log('[cloze] click handler registered on container')
}

export const toggleNodeCloze = (node) => {
  const cur = isNodeClozeHidden(node.uid)
  nodeOverrideMap.set(node.uid, !cur)
  applyClozeStyles()
  saveClozeState()
  // 多次确保渲染完成
  requestAnimationFrame(() => {
    applyClozeStyles()
    requestAnimationFrame(applyClozeStyles)
  })
  setTimeout(applyClozeStyles, 100)
  setTimeout(applyClozeStyles, 300)
}

export const setNodesClozeHidden = (nodeList, hidden) => {
  if (!nodeList || nodeList.length === 0) return
  nodeList.forEach(node => {
    nodeOverrideMap.set(node.uid, hidden)
  })
  applyClozeStyles()
  saveClozeState()
  requestAnimationFrame(() => {
    applyClozeStyles()
    requestAnimationFrame(applyClozeStyles)
  })
  setTimeout(applyClozeStyles, 100)
  setTimeout(applyClozeStyles, 300)
}

export const toggleAllCloze = () => {
  hiddenAll = !hiddenAll
  nodeOverrideMap.clear()
  applyClozeStyles()
  saveClozeState()
  // 通知大纲视图等其他组件
  window.dispatchEvent(new CustomEvent('cloze-state-changed', { detail: { hiddenAll } }))
  return hiddenAll
}

// 定向设置全局挖空显隐（一键隐藏 / 一键取消隐藏），并清空 per-node 覆盖值
export const setAllClozeHidden = (hidden) => {
  hiddenAll = !!hidden
  nodeOverrideMap.clear()
  applyClozeStyles()
  saveClozeState()
  window.dispatchEvent(new CustomEvent('cloze-state-changed', { detail: { hiddenAll } }))
  return hiddenAll
}

export const resetClozeState = () => {
  nodeOverrideMap.clear()
}

// 设置全局挖空显隐开关（不触碰 per-node 覆盖值），并立即持久化。
// AI 出题等生成"默认应隐藏"的新内容时调用 setGlobalClozeHidden(true)，
// 防止用户历史全局开关停留在"显示"位导致新挖空内容直接明文展示
export const setGlobalClozeHidden = (hidden) => {
  hiddenAll = hidden
  saveClozeState()
  applyClozeStyles()
}

/**
 * 导出 PDF/SVG 前临时强制显示所有挖空内容，返回可恢复的状态快照。
 * 导出结束后用 restoreClozeStateForExport 恢复，不改变用户的真实显隐设置。
 */
export const forceShowAllClozeForExport = () => {
  const snapshot = {
    hiddenAll,
    overrides: new Map(nodeOverrideMap)
  }
  hiddenAll = false
  nodeOverrideMap.clear()
  applyClozeStyles()
  return snapshot
}

export const restoreClozeStateForExport = (snapshot) => {
  if (!snapshot) return
  hiddenAll = snapshot.hiddenAll
  nodeOverrideMap.clear()
  if (snapshot.overrides) {
    snapshot.overrides.forEach((value, key) => {
      nodeOverrideMap.set(key, value)
    })
  }
  saveClozeState()
  applyClozeStyles()
}

/* ==================== 选区挖空（编辑态） ==================== */

/**
 * 切换当前文本编辑中选区的挖空格式
 * 使用 smm-cloze blot（占用 quill formula 槽位，见 MindMapEditor.vue 注册）
 */
export const toggleSelectionCloze = () => {
  if (!mindMapRef || !mindMapRef.richText) return null
  const rt = mindMapRef.richText
  if (!rt.showTextEdit) return null
  const quill = rt.quill
  if (!quill) return null

  let range = quill.getSelection(true)
  if (!range || range.length === 0) {
    range = rt.range || null
  }
  if (!range || range.length === 0) return null

  const formats = quill.getFormat(range.index, range.length) || {}
  const isClozed = !!formats.formula
  // Quill 2 API：第三参为格式对象（Quill 1 的 (name, value) 传法会把字符串当对象遍历字符下标，静默失效）
  quill.formatText(range.index, range.length, { formula: !isClozed }, 'user')
  try {
    quill.setSelection(range.index, range.length, 'user')
  } catch (e) {}
  // 新添加的挖空默认显示（紫色下划线），之后通过鼠标左键单击切换显隐
  if (!isClozed && rt.node && rt.node.uid) {
    nodeOverrideMap.set(rt.node.uid, false)
    saveClozeState()
  }
  return isClozed ? 'removed' : 'added'
}

/* ==================== 非编辑态全节点挖空 ==================== */

/**
 * 把当前选中节点的全部文本内容包裹在 <span class="smm-cloze"> 中
 * 如果已有挖空则取消（toggle 语义）
 */
export const clozeWholeNode = () => {
  if (!mindMapRef || !mindMapRef.renderer) return null
  const activeNodes = mindMapRef.renderer.activeNodeList
  if (!activeNodes || activeNodes.length === 0) return null

  let addedCount = 0
  let removedCount = 0

  activeNodes.forEach(node => {
    if (!node) return
    if (mindMapRef.renderer.root === node) return

    let text = node.getData('text') || ''
    const hasCloze = /<span[^>]*class=["'][^"']*smm-cloze[^"']*["'][^>]*>/.test(text)

    if (hasCloze) {
      // 取消全部挖空（平衡匹配，避免嵌套 span 被截断导致字体/样式丢失）
      text = removeClozeSpansBalanced(text).replace(
        /<code\b[^>]*>([\s\S]*?)<\/code>/gi,
        '$1'
      )
      node.setText(text)
      nodeOverrideMap.delete(node.uid)
      removedCount++
    } else {
      // 全部挖空
      const isRichText = !!node.getData('richText')
      if (isRichText && typeof text === 'string' && text.includes('<')) {
        text = text.replace(
          /(<p[^>]*>)([\s\S]*?)(<\/p>)/gi,
          (m, open, inner, close) =>
            open + '<span class="smm-cloze">' + inner + '</span>' + close
        )
      } else {
        const escaped = String(text)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
        text = '<p><span class="smm-cloze">' + escaped + '</span></p>'
      }
      node.setText(text, true)
      nodeOverrideMap.set(node.uid, false)
      addedCount++
    }
  })

  if (addedCount === 0 && removedCount === 0) return null
  mindMapRef.render()
  applyClozeStyles()
  saveClozeState()

  if (addedCount > 0 && removedCount === 0) return 'added'
  if (removedCount > 0 && addedCount === 0) return 'removed'
  return 'mixed'
}

/* ==================== 编解码工具 ==================== */

const CLOZE_SPAN_OPEN_RE = /<span\b[^>]*class=["'][^"']*smm-cloze[^"']*["'][^>]*>/i

/**
 * 平衡移除所有挖空 span（保留内部内容）
 * 挖空 span 内部可能嵌套带样式的子 span（如 font-size），
 * 简单的非贪婪正则会在第一个 </span> 处截断，导致 HTML 结构损坏、样式丢失
 */
export const removeClozeSpansBalanced = (html) => {
  if (typeof html !== 'string' || !html.includes('smm-cloze')) return html
  let result = ''
  let rest = html
  while (rest) {
    const m = CLOZE_SPAN_OPEN_RE.exec(rest)
    if (!m) {
      result += rest
      break
    }
    result += rest.slice(0, m.index)
    const contentStart = m.index + m[0].length
    const tagRe = /<\/?span\b[^>]*>/gi
    tagRe.lastIndex = contentStart
    let depth = 1
    let closeTag = null
    let t
    while ((t = tagRe.exec(rest))) {
      depth += t[0].startsWith('</') ? -1 : 1
      if (depth === 0) {
        closeTag = t
        break
      }
    }
    if (!closeTag) {
      // 未闭合的挖空标签，原样保留剩余内容
      result += rest.slice(m.index)
      break
    }
    result += rest.slice(contentStart, closeTag.index)
    rest = rest.slice(closeTag.index + closeTag[0].length)
  }
  return result
}

export const encodeClozeInHtml = (html) =>
  html.replace(/<code\b([^>]*)>([\s\S]*?)<\/code>/gi, '<span class="smm-cloze">$2</span>')

export const decodeClozeFromHtml = (html) =>
  html.replace(/<span class="smm-cloze">([\s\S]*?)<\/span>/g, '<code>$1</code>')

/* ==================== 清除挖空 ==================== */

export const clearNodeCloze = (node) => {
  let text = node.getData('text') || ''
  if (typeof text !== 'string' || !text.includes('smm-cloze')) return
  text = removeClozeSpansBalanced(text)
  node.setText(text, !!node.getData('richText'))
}

export const clearAllCloze = () => {
  if (!mindMapRef || !mindMapRef.renderer) return 0
  const root = mindMapRef.renderer.root
  if (!root) return 0
  let count = 0
  const walk = (node) => {
    const text = node.getData('text') || ''
    if (typeof text === 'string' && text.includes('smm-cloze')) {
      clearNodeCloze(node)
      count++
    }
    if (node.children) {
      node.children.forEach(walk)
    }
  }
  walk(root)
  if (count > 0) {
    mindMapRef.render()
    setTimeout(() => applyClozeStyles(), 100)
  }
  return count
}

/* ==================== 大纲语法转换 ==================== */

/**
 * 将 [==text==] 语法转换为 <span class="smm-cloze">text</span>
 * 同时保留已有的 <span class="smm-cloze"> 标签
 */
export const convertOutlineClozeSyntax = (text) => {
  if (typeof text !== 'string') return text
  return text.replace(/\[==([\s\S]+?)==\]/g, '<span class="smm-cloze">$1</span>')
}

/**
 * 大纲显示用：保留 <span class="smm-cloze"> HTML 标签，不做转换
 * 这样大纲视图中可以通过 CSS 显示紫色下划线样式
 * 用户手动输入的 [==text==] 语法仍由 convertOutlineClozeSyntax 处理
 */
export const revertOutlineClozeSyntax = (text) => {
  // 不再转换为 [==text==]，直接保留 HTML span
  return text
}

/* ==================== 获取当前思维导图引用 ==================== */

export const getMindMapRef = () => mindMapRef

/* ==================== 挖空版本管理 ==================== */

const VERSIONS_STORAGE_KEY = 'smm_cloze_versions'

export const getCurrentClozeState = () => {
  if (!mindMapRef || !mindMapRef.renderer) return {}
  const root = mindMapRef.renderer.root
  if (!root) return {}
  const state = {}
  const walk = (node) => {
    const text = node.getData('text') || ''
    if (typeof text === 'string' && text.includes('smm-cloze')) {
      const div = document.createElement('div')
      div.innerHTML = text
      const clozeEls = div.querySelectorAll('.smm-cloze')
      if (clozeEls.length > 0) {
        state[node.uid] = Array.from(clozeEls).map(el => el.textContent)
      }
    }
    if (node.children) {
      node.children.forEach(walk)
    }
  }
  walk(root)
  return state
}

export const getClozeVersions = (filePath) => {
  try {
    const raw = localStorage.getItem(VERSIONS_STORAGE_KEY)
    if (!raw) return []
    const versions = JSON.parse(raw)
    const list = Array.isArray(versions) ? versions : []
    if (filePath !== undefined) {
      return list.filter(v => v.filePath === filePath)
    }
    return list
  } catch (e) {
    return []
  }
}

// 版本列表上限：超出后丢弃最旧的，防止 localStorage 配额溢出
const MAX_CLOZE_VERSIONS = 50

export const saveClozeVersion = (name, filePath) => {
  const state = getCurrentClozeState()
  const versions = getClozeVersions()
  const version = {
    id: 'clz_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
    name: name || `版本 ${versions.length + 1}`,
    timestamp: Date.now(),
    clozes: state,
    filePath: filePath || ''
  }
  versions.push(version)
  while (versions.length > MAX_CLOZE_VERSIONS) {
    versions.shift()
  }
  try {
    localStorage.setItem(VERSIONS_STORAGE_KEY, JSON.stringify(versions))
  } catch (e) {
    // 配额溢出：逐步丢弃最旧版本重试，最多尝试一半
    for (let keep = Math.floor(versions.length / 2); keep > 0; keep = Math.floor(keep / 2)) {
      versions.splice(0, versions.length - keep)
      try {
        localStorage.setItem(VERSIONS_STORAGE_KEY, JSON.stringify(versions))
        break
      } catch (e2) {
        // 继续减半重试
      }
    }
  }
  return version
}

// DeepSeek 网页版专用 preload 脚本
// 全自动 Agent 模式
// 通过 ipcRenderer 与主进程通信，主进程转发到渲染进程
//
// 致谢：
// 本模块的代码检测与防循环机制设计参考了 @wangyongpeng90 的开源项目
// https://github.com/wangyongpeng90/cuckoo-code
// 感谢开源社区的贡献！

const { contextBridge, ipcRenderer } = require('electron')

// ========== 通过 contextBridge 安全暴露接口 ==========
contextBridge.exposeInMainWorld('__deepseek_agent__', {
  send: (channel, data) => {
    ipcRenderer.send('deepseek:' + channel, data)
  },
  invoke: (channel, data) => {
    return ipcRenderer.invoke('deepseek:' + channel, data)
  },
  on: (channel, callback) => {
    const listener = (event, ...args) => callback(...args)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  }
})

// ========== 状态 ==========
// ========== 状态管理 ==========
const STORAGE_KEYS = {
  SEND_DELAY_MIN: 'mma_send_delay_min',
  SEND_DELAY_MAX: 'mma_send_delay_max',
  SUMMARIES: 'mma_summaries',
}

// 从 localStorage 读取数值，带默认值
function loadNumber(key, def) {
  try {
    const v = localStorage.getItem(key)
    if (v !== null && !isNaN(Number(v))) return Number(v)
  } catch (e) {}
  return def
}

const state = {
  initialized: false,
  toolCalls: [],
  nextId: 1,
  detectedHashes: new Set(),
  isAutoRunning: true,
  lastAIMessage: '',
  conversationId: '',
  logExpanded: false,
  sendDelayMin: loadNumber(STORAGE_KEYS.SEND_DELAY_MIN, 200),   // 发送延迟最小值（ms）
  sendDelayMax: loadNumber(STORAGE_KEYS.SEND_DELAY_MAX, 3000),  // 发送延迟最大值（ms）
  manualInputSelector: null, // 手动捕获的输入框选择器
  manualSendSelector: null,  // 手动捕获的发送按钮选择器
  summaries: [],      // 对话总结列表
  summaryExpanded: false, // 总结面板是否展开
  isSendingMessage: false, // 正在发送消息（防止扫描自己刚发的内容）
  lastSendTime: 0,    // 上次发送时间（冷却期内不扫描）
}

// 修改类工具列表（初始化阶段和非用户明确指令时禁止执行）
const WRITE_TOOLS = new Set([
  'add_child_nodes', 'update_node_text', 'delete_node', 'batch_node_actions',
  'save_mindmap', 'new_mindmap', 'ai_cloze', 'ai_cloze_full_map',
  'ai_cloze_review', 'clear_cloze', 'select_node', 'focus_node',
  'zoom_control'
])

// 查询类工具（只读，任何时候都可以执行）
const READ_TOOLS = new Set([
  'search_nodes', 'get_all_nodes', 'query_nodes', 'list_tools',
  'get_tool_detail', 'list_directory', 'find_local_file',
  'read_mindmap_file', 'semantic_search'
])

// 统计当前对话中的用户消息数（用于判断是否处于初始化阶段）
function countUserMessages() {
  try {
    const messages = document.querySelectorAll('[data-role="user"], [data-author="user"], .user-message, .message-user')
    return messages.length
  } catch (e) {
    return 999 // 检测失败时放行，避免误拦截
  }
}

// ========== 发送频率限流（防止触发 DeepSeek 消息频率限制） ==========
const MIN_SEND_INTERVAL = 6000 // 最小发送间隔 6 秒
let sendQueue = [] // 待发送消息队列
let sendQueueTimer = null // 队列处理定时器
let lastActualSendTime = 0 // 实际最后一次发送的时间戳

// 加入发送队列（自动按最小间隔发送）
function enqueueSend(text, priority = false) {
  const item = { text, priority, id: Date.now() + Math.random() }
  
  if (priority) {
    // 高优先级插在最前面（比如初始化消息）
    sendQueue.unshift(item)
  } else {
    sendQueue.push(item)
  }
  
  console.log(`[🧠 Agent] 发送队列: 新增 1 条，当前队列长度 ${sendQueue.length}`)
  
  // 启动队列处理（如果没在运行）
  if (!sendQueueTimer) {
    processSendQueue()
  }
  
  return new Promise((resolve) => {
    item._resolve = resolve
  })
}

// 处理发送队列
function processSendQueue() {
  if (sendQueue.length === 0) {
    sendQueueTimer = null
    return
  }
  
  const now = Date.now()
  const timeSinceLastSend = now - lastActualSendTime
  
  if (timeSinceLastSend < MIN_SEND_INTERVAL && lastActualSendTime > 0) {
    // 距离上次发送太近，等待
    const waitTime = MIN_SEND_INTERVAL - timeSinceLastSend
    console.log(`[🧠 Agent] 发送限流: 距离上次发送仅 ${timeSinceLastSend}ms，等待 ${waitTime}ms 后继续`)
    sendQueueTimer = setTimeout(() => {
      sendQueueTimer = null
      processSendQueue()
    }, waitTime + 500) // 多等 500ms 更安全
    return
  }
  
  // 可以发送了，取出第一条
  const item = sendQueue.shift()
  console.log(`[🧠 Agent] 发送队列: 取出 1 条，剩余 ${sendQueue.length} 条`)
  
  // 直接调用底层发送（不走 injectAndSend 的 randomDelay，因为限流已经够慢了）
  doRawSend(item.text).then((success) => {
    lastActualSendTime = Date.now()
    if (item._resolve) item._resolve(success)
    
    // 继续处理下一条
    if (sendQueue.length > 0) {
      sendQueueTimer = setTimeout(() => {
        sendQueueTimer = null
        processSendQueue()
      }, MIN_SEND_INTERVAL + 500)
    } else {
      sendQueueTimer = null
    }
  })
}

// 底层发送（直接填内容+点击发送，不含限流）
async function doRawSend(text) {
  const input = findInput()
  if (!input) {
    console.warn('[🧠 Agent] doRawSend: 未找到输入框')
    addSystemLog('发送失败', '未找到输入框', 'error')
    return false
  }
  
  input.focus()
  
  let setSuccess = false
  
  if (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT') {
    try {
      const proto = input.tagName === 'TEXTAREA'
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype
      const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value').set
      nativeSetter.call(input, text)
      input.dispatchEvent(new Event('input', { bubbles: true }))
      setSuccess = true
    } catch (err) {
      input.value = text
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
      setSuccess = true
    }
  } else if (input.isContentEditable || input.getAttribute('contenteditable') === 'true') {
    try {
      document.execCommand('selectAll', false, null)
      document.execCommand('insertText', false, text)
      setSuccess = true
    } catch (err) {
      console.error('[🧠 Agent] doRawSend: contenteditable 方式失败:', err.message)
    }
  }
  
  if (!setSuccess) {
    addSystemLog('发送失败', '内容填入失败', 'error')
    return false
  }
  
  // 稍微等一下让输入框稳定
  await sleep(300)
  
  const sendBtn = findSendButton()
  if (sendBtn) {
    sendBtn.click()
    state.lastSendTime = Date.now()
    state.isSendingMessage = true
    setTimeout(() => { state.isSendingMessage = false }, 3000)
    return true
  }
  
  // 兜底：模拟 Enter
  if (input) {
    const opts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true, isComposing: false }
    input.dispatchEvent(new KeyboardEvent('keydown', opts))
    input.dispatchEvent(new KeyboardEvent('keypress', opts))
    input.dispatchEvent(new KeyboardEvent('keyup', opts))
    state.lastSendTime = Date.now()
    state.isSendingMessage = true
    setTimeout(() => { state.isSendingMessage = false }, 3000)
    return true
  }
  
  addSystemLog('发送失败', '未找到可用的发送按钮', 'error')
  return false
}

// 保存发送延迟设置
function saveSendDelay() {
  try {
    localStorage.setItem(STORAGE_KEYS.SEND_DELAY_MIN, String(state.sendDelayMin))
    localStorage.setItem(STORAGE_KEYS.SEND_DELAY_MAX, String(state.sendDelayMax))
  } catch (e) {}
}

// ========== 页面加载后初始化 ==========
window.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    injectStyles()
    injectBottomBar()
    injectToolDetector()
    injectConversationDetector()
    // 取消自动初始化，改为手动点击初始化按钮
    // autoInit()
    console.log('[🧠 MindMap Agent] 已加载（等待手动初始化）')
  }, 2000)
})

// ========== 样式注入（苹果风格 + 2x2 布局）==========
function injectStyles() {
  const style = document.createElement('style')
  style.id = 'mma-styles'
  style.textContent = `
    /* 整体页面缩放（DeepSeek 字体太大，缩小到 85%） */
    html {
      zoom: 0.85;
    }
    @media (max-width: 1200px) {
      html { zoom: 0.8; }
    }
    
    /* 悬浮球 - 收起状态 */
    #mma-fab {
      position: fixed;
      bottom: 16px;
      right: 16px;
      width: 40px;
      height: 40px;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(20px) saturate(180%);
      -webkit-backdrop-filter: blur(20px) saturate(180%);
      color: #1d1d1f;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 18px;
      cursor: pointer;
      z-index: 2147483647;
      box-shadow: 
        0 4px 16px rgba(0, 0, 0, 0.12),
        0 2px 6px rgba(0, 0, 0, 0.08),
        0 0 0 0.5px rgba(0, 0, 0, 0.06);
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      user-select: none;
      -webkit-user-select: none;
    }
    #mma-fab:hover {
      transform: scale(1.08);
      box-shadow: 
        0 6px 20px rgba(0, 0, 0, 0.15),
        0 3px 8px rgba(0, 0, 0, 0.1),
        0 0 0 0.5px rgba(0, 0, 0, 0.08);
    }
    #mma-fab:active {
      transform: scale(0.95);
    }
    #mma-fab .mma-fab-badge {
      position: absolute;
      top: -2px;
      right: -2px;
      min-width: 18px;
      height: 18px;
      padding: 0 5px;
      border-radius: 9px;
      background: #ff3b30;
      color: white;
      font-size: 10px;
      font-weight: 600;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 2px solid white;
    }
    
    /* 底部工具栏容器 - 弹出状态 */
    #mma-bottom-bar {
      position: fixed;
      bottom: 16px;
      right: 16px;
      z-index: 2147483646;
      pointer-events: none;
      opacity: 0;
      transform: translateY(10px) scale(0.95);
      transform-origin: bottom right;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    }
    #mma-bottom-bar.show {
      opacity: 1;
      transform: translateY(0) scale(1);
      pointer-events: auto;
    }
    #mma-bottom-bar.show > * {
      pointer-events: auto;
    }
    
    /* 工具栏卡片 - 苹果风格 */
    .mma-toolbar-card {
      background: rgba(255, 255, 255, 0.85);
      backdrop-filter: blur(20px) saturate(180%);
      -webkit-backdrop-filter: blur(20px) saturate(180%);
      border: 1px solid rgba(0, 0, 0, 0.08);
      border-radius: 16px;
      padding: 10px;
      box-shadow: 
        0 8px 32px rgba(0, 0, 0, 0.12),
        0 2px 8px rgba(0, 0, 0, 0.08),
        inset 0 1px 0 rgba(255, 255, 255, 0.8);
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      width: 280px;
      font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', Roboto, sans-serif;
    }
    
    /* 顶部状态栏 */
    .mma-status-bar {
      grid-column: 1 / -1;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 4px 0 2px;
      font-size: 11px;
      color: #86868b;
    }
    .mma-status-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #c7c7cc;
      transition: all 0.3s;
    }
    .mma-status-dot.running {
      background: #007aff;
      box-shadow: 0 0 8px rgba(0, 122, 255, 0.6);
      animation: mma-pulse 1.5s ease-in-out infinite;
    }
    .mma-status-dot.done {
      background: #34c759;
    }
    .mma-status-dot.error {
      background: #ff3b30;
    }
    @keyframes mma-pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.5; transform: scale(1.2); }
    }
    
    /* 苹果风格按钮 */
    .mma-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 5px;
      padding: 10px 14px;
      border: none;
      border-radius: 12px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.15s cubic-bezier(0.4, 0, 0.2, 1);
      user-select: none;
      -webkit-user-select: none;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .mma-btn:active {
      transform: scale(0.96);
    }
    
    /* 主按钮 - 蓝色 */
    .mma-btn-primary {
      background: linear-gradient(180deg, #0a84ff 0%, #007aff 100%);
      color: white;
      box-shadow: 
        0 1px 3px rgba(0, 122, 255, 0.3),
        inset 0 1px 0 rgba(255, 255, 255, 0.3);
    }
    .mma-btn-primary:hover {
      background: linear-gradient(180deg, #1a8fff 0%, #0a84ff 100%);
    }
    
    /* 次按钮 - 灰色 */
    .mma-btn-secondary {
      background: rgba(120, 120, 128, 0.12);
      color: #1d1d1f;
    }
    .mma-btn-secondary:hover {
      background: rgba(120, 120, 128, 0.18);
    }
    
    /* 成功按钮 - 绿色 */
    .mma-btn-success {
      background: rgba(52, 199, 89, 0.15);
      color: #34c759;
    }
    .mma-btn-success:hover {
      background: rgba(52, 199, 89, 0.22);
    }
    
    /* 警告按钮 - 橙色 */
    .mma-btn-warning {
      background: rgba(255, 149, 0, 0.15);
      color: #ff9500;
    }
    .mma-btn-warning:hover {
      background: rgba(255, 149, 0, 0.22);
    }
    
    /* 自动模式开关按钮 */
    .mma-btn-toggle {
      position: relative;
      padding-right: 32px;
    }
    .mma-btn-toggle .toggle-switch {
      position: absolute;
      right: 10px;
      top: 50%;
      transform: translateY(-50%);
      width: 28px;
      height: 16px;
      border-radius: 8px;
      background: rgba(120, 120, 128, 0.24);
      transition: all 0.2s;
    }
    .mma-btn-toggle .toggle-switch::after {
      content: '';
      position: absolute;
      top: 2px;
      left: 2px;
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background: white;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
      transition: all 0.2s;
    }
    .mma-btn-toggle.on .toggle-switch {
      background: #34c759;
    }
    .mma-btn-toggle.on .toggle-switch::after {
      left: 14px;
    }
    
    /* 日志徽标 */
    .mma-btn-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 16px;
      height: 16px;
      padding: 0 5px;
      border-radius: 8px;
      background: #ff3b30;
      color: white;
      font-size: 10px;
      font-weight: 600;
    }
    
    /* 延迟设置行 */
    .mma-delay-row {
      grid-column: 1 / -1;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 4px 2px;
    }
    .mma-delay-label {
      font-size: 10px;
      color: #86868b;
      white-space: nowrap;
      flex-shrink: 0;
    }
    .mma-delay-input {
      flex: 1;
      width: 100%;
      padding: 5px 8px;
      border: 1px solid rgba(0, 0, 0, 0.08);
      border-radius: 8px;
      font-size: 11px;
      background: rgba(120, 120, 128, 0.08);
      color: #1d1d1f;
      text-align: center;
      outline: none;
      transition: all 0.15s;
    }
    .mma-delay-input:focus {
      background: white;
      border-color: #007aff;
    }
    .mma-delay-sep {
      font-size: 10px;
      color: #c7c7cc;
      flex-shrink: 0;
    }
    
    /* 元素捕获行（第4行） */
    .mma-picker-row {
      grid-column: 1 / -1;
      display: flex;
      gap: 6px;
      padding: 2px 4px 6px;
    }
    .mma-picker-btn {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      padding: 6px 8px;
      border: 1px solid rgba(0, 0, 0, 0.08);
      border-radius: 8px;
      font-size: 10px;
      background: rgba(120, 120, 128, 0.08);
      color: #1d1d1f;
      cursor: pointer;
      transition: all 0.15s;
      white-space: nowrap;
    }
    .mma-picker-btn:hover {
      background: rgba(0, 122, 255, 0.1);
      border-color: #007aff;
      color: #007aff;
    }
    .mma-picker-btn.active {
      background: rgba(52, 199, 89, 0.15);
      border-color: #34c759;
      color: #34c759;
    }
    .mma-picker-btn.picking {
      background: rgba(255, 149, 0, 0.15);
      border-color: #ff9500;
      color: #ff9500;
      animation: pulse 1s infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.6; }
    }
    
    /* 元素选择器高亮 */
    .mma-element-highlight {
      outline: 2px solid #ff9500 !important;
      outline-offset: 2px;
      background: rgba(255, 149, 0, 0.1) !important;
      cursor: crosshair !important;
    }
    .mma-element-picking * {
      cursor: crosshair !important;
    }
    
    /* 日志面板 */
    #mma-log-panel {
      position: fixed;
      bottom: 180px;
      left: 50%;
      transform: translateX(-50%) translateY(10px);
      width: 320px;
      max-height: 360px;
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(20px) saturate(180%);
      -webkit-backdrop-filter: blur(20px) saturate(180%);
      border: 1px solid rgba(0, 0, 0, 0.08);
      border-radius: 16px;
      box-shadow: 
        0 12px 40px rgba(0, 0, 0, 0.15),
        0 4px 12px rgba(0, 0, 0, 0.08);
      z-index: 2147483647;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      opacity: 0;
      pointer-events: none;
      transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
      font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', Roboto, sans-serif;
    }
    #mma-log-panel.show {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
      pointer-events: auto;
    }
    
    /* 总结面板（和日志面板共用样式，加个 id 区分） */
    #mma-summary-panel {
      position: fixed;
      bottom: 180px;
      left: 50%;
      transform: translateX(-50%) translateY(10px);
      width: 340px;
      max-height: 420px;
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(20px) saturate(180%);
      -webkit-backdrop-filter: blur(20px) saturate(180%);
      border: 1px solid rgba(0, 0, 0, 0.08);
      border-radius: 16px;
      box-shadow: 
        0 12px 40px rgba(0, 0, 0, 0.15),
        0 4px 12px rgba(0, 0, 0, 0.08);
      z-index: 2147483647;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      opacity: 0;
      pointer-events: none;
      transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
      font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', Roboto, sans-serif;
    }
    #mma-summary-panel.show {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
      pointer-events: auto;
    }
    
    .mma-summary-item {
      padding: 10px 14px;
      border-bottom: 1px solid rgba(0, 0, 0, 0.06);
      cursor: pointer;
      transition: background 0.15s;
    }
    .mma-summary-item:hover {
      background: rgba(0, 122, 255, 0.06);
    }
    .mma-summary-item:last-child {
      border-bottom: none;
    }
    .mma-summary-title {
      font-size: 13px;
      font-weight: 600;
      color: #1d1d1f;
      margin-bottom: 4px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .mma-summary-meta {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 11px;
      color: #86868b;
    }
    .mma-summary-send {
      background: rgba(0, 122, 255, 0.12);
      color: #007aff;
      border: none;
      padding: 3px 10px;
      border-radius: 6px;
      font-size: 11px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.15s;
    }
    .mma-summary-send:hover {
      background: rgba(0, 122, 255, 0.2);
    }
    .mma-summary-preview {
      font-size: 11px;
      color: #86868b;
      margin-top: 4px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    
    .mma-log-header {
      padding: 12px 16px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-shrink: 0;
      border-bottom: 1px solid rgba(0, 0, 0, 0.06);
    }
    .mma-log-title {
      font-size: 13px;
      font-weight: 600;
      color: #1d1d1f;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .mma-log-count {
      background: rgba(0, 122, 255, 0.12);
      color: #007aff;
      padding: 1px 7px;
      border-radius: 10px;
      font-size: 10px;
      font-weight: 600;
    }
    .mma-log-close {
      width: 24px;
      height: 24px;
      border-radius: 50%;
      background: rgba(120, 120, 128, 0.12);
      border: none;
      color: #86868b;
      cursor: pointer;
      font-size: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.15s;
    }
    .mma-log-close:hover {
      background: rgba(120, 120, 128, 0.2);
    }
    
    .mma-log-body {
      flex: 1;
      overflow-y: auto;
      padding: 8px;
    }
    
    .mma-log-empty {
      text-align: center;
      padding: 40px 20px;
      color: #c7c7cc;
      font-size: 12px;
    }
    
    /* 工具日志卡片 */
    .mma-log-card {
      background: white;
      border: 1px solid rgba(0, 0, 0, 0.06);
      border-radius: 10px;
      padding: 8px 10px;
      margin-bottom: 6px;
      font-size: 11px;
    }
    .mma-log-card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 5px;
    }
    .mma-log-name {
      font-weight: 600;
      color: #007aff;
      font-size: 11px;
    }
    .mma-log-badge {
      font-size: 9px;
      padding: 2px 7px;
      border-radius: 10px;
      font-weight: 500;
    }
    .mma-log-badge.pending { background: #fff4e5; color: #ff9500; }
    .mma-log-badge.running { background: #e5f0ff; color: #007aff; }
    .mma-log-badge.done { background: #e8f9ed; color: #34c759; }
    .mma-log-badge.error { background: #ffebeb; color: #ff3b30; }
    
    .mma-log-params {
      background: #f5f5f7;
      padding: 5px 7px;
      border-radius: 6px;
      font-family: 'SF Mono', 'Consolas', 'Monaco', monospace;
      font-size: 10px;
      max-height: 50px;
      overflow: auto;
      color: #424245;
      white-space: pre-wrap;
      word-break: break-all;
      line-height: 1.4;
      margin-bottom: 5px;
    }
    
    .mma-log-result {
      padding: 5px 7px;
      border-radius: 6px;
      font-family: 'SF Mono', 'Consolas', 'Monaco', monospace;
      font-size: 10px;
      max-height: 70px;
      overflow: auto;
      white-space: pre-wrap;
      word-break: break-all;
      line-height: 1.4;
    }
    .mma-log-result.success {
      background: #e8f9ed;
      color: #248a3d;
    }
    .mma-log-result.error {
      background: #ffebeb;
      color: #d70015;
    }
    .mma-log-result.log-info {
      background: #f0f5ff;
      color: #0055d4;
      font-size: 11px;
      padding: 6px 10px;
    }
    .mma-log-badge.log {
      background: #e5eaf0;
      color: #606266;
    }
    
    .mma-log-footer {
      padding: 8px 12px;
      border-top: 1px solid rgba(0, 0, 0, 0.06);
      font-size: 10px;
      color: #86868b;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-shrink: 0;
    }
    .mma-log-clear {
      color: #ff3b30;
      cursor: pointer;
      font-size: 10px;
      opacity: 0.8;
    }
    .mma-log-clear:hover {
      opacity: 1;
    }
    
    /* Toast */
    .mma-toast {
      position: fixed;
      top: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(0, 0, 0, 0.8);
      color: white;
      padding: 8px 16px;
      border-radius: 10px;
      font-size: 12px;
      z-index: 2147483647;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      animation: mma-toast-in 0.25s ease;
      backdrop-filter: blur(10px);
    }
    @keyframes mma-toast-in {
      from { opacity: 0; transform: translate(-50%, -10px); }
      to { opacity: 1; transform: translate(-50%, 0); }
    }
    @keyframes mma-toast-out {
      from { opacity: 1; transform: translate(-50%, 0); }
      to { opacity: 0; transform: translate(-50%, -10px); }
    }
  `
  document.head.appendChild(style)
}

// ========== 底部工具栏注入（2x2 苹果风格）==========
function injectBottomBar() {
  // 悬浮球
  const fab = document.createElement('div')
  fab.id = 'mma-fab'
  fab.innerHTML = '⚙️'
  fab.title = '思维导图助手（可拖动）'
  fab.draggable = false
  
  // 拖动功能
  let isDragging = false
  let dragStartX = 0
  let dragStartY = 0
  let fabStartX = 0
  let fabStartY = 0
  let hasMoved = false
  
  // 获取页面缩放比例（html 上的 zoom）
  function getPageZoom() {
    const html = document.documentElement
    const zoom = parseFloat(getComputedStyle(html).zoom) || 1
    return zoom
  }
  
  // 恢复保存的位置
  try {
    const savedPos = localStorage.getItem('mma_fab_pos')
    if (savedPos) {
      const pos = JSON.parse(savedPos)
      if (pos.right !== undefined) { fab.style.right = pos.right + 'px' }
      if (pos.bottom !== undefined) { fab.style.bottom = pos.bottom + 'px' }
      if (pos.left !== undefined) { fab.style.left = pos.left + 'px'; fab.style.right = 'auto' }
      if (pos.top !== undefined) { fab.style.top = pos.top + 'px'; fab.style.bottom = 'auto' }
    }
  } catch(e) {}
  
  fab.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return
    isDragging = true
    hasMoved = false
    const zoom = getPageZoom()
    // 关键：页面有 zoom 缩放时，clientX/Y 是视口像素（物理像素），
    // 而 getBoundingClientRect() 和 style.left 是 CSS 像素（受 zoom 影响）
    // 需要统一到 CSS 像素坐标系：CSS 像素 = 视口像素 / zoom
    dragStartX = e.clientX / zoom
    dragStartY = e.clientY / zoom
    
    const rect = fab.getBoundingClientRect()
    // getBoundingClientRect 返回的也是 CSS 像素
    fabStartX = rect.left
    fabStartY = rect.top
    
    e.preventDefault()
    e.stopPropagation()
  })
  
  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return
    
    const zoom = getPageZoom()
    // 将鼠标坐标转换为 CSS 像素
    const mouseX = e.clientX / zoom
    const mouseY = e.clientY / zoom
    const dx = mouseX - dragStartX
    const dy = mouseY - dragStartY
    
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      hasMoved = true
    }
    
    if (hasMoved) {
      let newLeft = fabStartX + dx
      let newTop = fabStartY + dy
      
      // 限制在视口内（window.innerWidth 也是 CSS 像素）
      const maxLeft = window.innerWidth - fab.offsetWidth - 4
      const maxTop = window.innerHeight - fab.offsetHeight - 4
      newLeft = Math.max(4, Math.min(maxLeft, newLeft))
      newTop = Math.max(4, Math.min(maxTop, newTop))
      
      fab.style.left = newLeft + 'px'
      fab.style.top = newTop + 'px'
      fab.style.right = 'auto'
      fab.style.bottom = 'auto'
      
      // 面板跟随
      const bar = document.getElementById('mma-bottom-bar')
      if (bar) {
        bar.style.right = 'auto'
        bar.style.left = newLeft + 'px'
        bar.style.bottom = 'auto'
        bar.style.top = (newTop + fab.offsetHeight + 8) + 'px'
        bar.style.transformOrigin = 'top left'
      }
    }
  })
  
  document.addEventListener('mouseup', (e) => {
    if (!isDragging) return
    isDragging = false
    
    if (hasMoved) {
      // 拖动结束，保存位置（用 getBoundingClientRect 的值，是 CSS 像素）
      try {
        const rect = fab.getBoundingClientRect()
        localStorage.setItem('mma_fab_pos', JSON.stringify({
          left: rect.left,
          top: rect.top
        }))
      } catch(e) {}
      e.preventDefault()
      e.stopPropagation()
    }
  })
  
  fab.addEventListener('click', (e) => {
    if (hasMoved) {
      // 拖动过，不触发点击
      e.preventDefault()
      e.stopPropagation()
      return
    }
    e.stopPropagation()
    const bar = document.getElementById('mma-bottom-bar')
    if (bar.classList.contains('show')) {
      bar.classList.remove('show')
    } else {
      bar.classList.add('show')
    }
  })
  document.body.appendChild(fab)
  
  // 工具栏面板
  const bar = document.createElement('div')
  bar.id = 'mma-bottom-bar'
  bar.innerHTML = `
    <div class="mma-toolbar-card">
      <!-- 状态栏 -->
      <div class="mma-status-bar">
        <div class="mma-status-dot" id="mma-status-dot"></div>
        <span id="mma-status-text">就绪</span>
      </div>
      
      <!-- 第一行 -->
      <button class="mma-btn mma-btn-primary" id="mma-btn-init">
        🔄 初始化
      </button>
      <button class="mma-btn mma-btn-toggle on" id="mma-auto-toggle">
        <span>自动执行</span>
        <div class="toggle-switch"></div>
      </button>
      
      <!-- 第二行 -->
      <button class="mma-btn mma-btn-secondary" id="mma-btn-summary">
        📝 总结对话
      </button>
      <button class="mma-btn mma-btn-secondary" id="mma-btn-log">
        📋 日志 <span class="mma-btn-badge" id="mma-log-badge" style="display:none">0</span>
      </button>
      
      <!-- 第三行：发送延迟设置 -->
      <div class="mma-delay-row">
        <span class="mma-delay-label">⏱️ 发送延迟</span>
        <input type="number" class="mma-delay-input" id="mma-delay-min" value="200" min="100" max="5000" step="100" title="最小延迟(ms)">
        <span class="mma-delay-sep">~</span>
        <input type="number" class="mma-delay-input" id="mma-delay-max" value="3000" min="100" max="10000" step="100" title="最大延迟(ms)">
        <span class="mma-delay-label">ms</span>
      </div>
      
      <!-- 第四行：元素捕获 -->
      <div class="mma-picker-row">
        <button class="mma-picker-btn" id="mma-picker-input" title="点击后再点击页面上的输入框">
          🎯 捕获输入框
        </button>
        <button class="mma-picker-btn" id="mma-picker-send" title="点击后再点击页面上的发送按钮">
          🎯 捕获发送按钮
        </button>
      </div>
      
      <!-- 第五行：调试工具 -->
      <div class="mma-picker-row">
        <button class="mma-picker-btn" id="mma-test-send" title="发送一条测试消息验证配置">
          ✅ 测试发送
        </button>
        <button class="mma-picker-btn" id="mma-test-ipc" title="测试 IPC 通信是否正常">
          📡 测试IPC
        </button>
      </div>

      <!-- 第六行：扫描工具 -->
      <div class="mma-picker-row">
        <button class="mma-picker-btn mma-btn-primary" id="mma-scan-tools" title="手动扫描最新 AI 消息中的 mymindmap 工具调用">
          🔍 扫描工具
        </button>
        <button class="mma-picker-btn" id="mma-open-devtools" title="打开开发者工具调试">
          🔧 调试工具
        </button>
      </div>
    </div>
  `
  document.body.appendChild(bar)
  
  // 日志面板
  const logPanel = document.createElement('div')
  logPanel.id = 'mma-log-panel'
  logPanel.innerHTML = `
    <div class="mma-log-header">
      <div class="mma-log-title">🔧 工具调用 <span class="mma-log-count" id="mma-log-count">0</span></div>
      <button class="mma-log-close" onclick="document.getElementById('mma-log-panel').classList.remove('show')">✕</button>
    </div>
    <div class="mma-log-body" id="mma-log-body">
      <div class="mma-log-empty">暂无工具调用</div>
    </div>
    <div class="mma-log-footer">
      <span>mymindmap 代码块触发</span>
      <span class="mma-log-clear" id="mma-log-clear">清空</span>
    </div>
  `
  document.body.appendChild(logPanel)
  
  // 总结列表面板
  const summaryPanel = document.createElement('div')
  summaryPanel.id = 'mma-summary-panel'
  summaryPanel.innerHTML = `
    <div class="mma-log-header">
      <div class="mma-log-title">📝 对话总结 <span class="mma-log-count" id="mma-summary-count">0</span></div>
      <div style="display:flex;gap:8px;align-items:center;">
        <button class="mma-log-close" id="mma-gen-summary" title="生成新总结" style="width:auto;padding:4px 10px;font-size:11px;border-radius:6px;background:rgba(0,122,255,0.12);color:#007aff;">+ 新总结</button>
        <button class="mma-log-close" onclick="document.getElementById('mma-summary-panel').classList.remove('show')">✕</button>
      </div>
    </div>
    <div class="mma-log-body" id="mma-summary-body">
      <div class="mma-log-empty">暂无总结记录</div>
    </div>
    <div class="mma-log-footer">
      <span>自动捕获 markdown 总结</span>
      <span class="mma-log-clear" id="mma-summary-clear">清空</span>
    </div>
  `
  document.body.appendChild(summaryPanel)
  
  // 绑定事件
  document.getElementById('mma-btn-init').onclick = () => {
    console.log('[🧠 Agent] 手动点击初始化')
    state.initialized = false
    state.detectedHashes.clear()
    state.lastAIMessage = ''
    
    // 点击初始化后，自动收起面板变成悬浮球
    const bar = document.getElementById('mma-bottom-bar')
    if (bar && bar.classList.contains('show')) {
      bar.classList.remove('show')
    }
    
    autoInit()
  }
  
  const autoToggle = document.getElementById('mma-auto-toggle')
  autoToggle.onclick = () => {
    state.isAutoRunning = !state.isAutoRunning
    autoToggle.classList.toggle('on', state.isAutoRunning)
    
    if (!state.isAutoRunning) {
      // 关闭自动执行时：清空所有待执行队列，标记已有的 pending 为 skipped
      let skippedCount = 0
      state.toolCalls.forEach(tc => {
        if (tc.status === 'pending') {
          tc.status = 'skipped'
          skippedCount++
        }
      })
      if (skippedCount > 0) {
        renderLogPanel()
        updateLogBadge()
      }
      updateStatus('已暂停', 'warning')
      addSystemLog('自动执行', `已暂停，跳过 ${skippedCount} 个待执行工具`, 'warning')
    } else {
      updateStatus('就绪', '')
      // 开启时如果有待执行的（手动添加的），继续执行
      const pending = state.toolCalls.filter(t => t.status === 'pending' && !t.isSystem)
      if (pending.length > 0) {
        executeTool(pending[0].id)
      }
    }
    
    showToast(state.isAutoRunning ? '已开启自动执行' : '已关闭自动执行')
  }
  
  document.getElementById('mma-btn-summary').onclick = (e) => {
    e.stopPropagation()
    const panel = document.getElementById('mma-summary-panel')
    if (panel) {
      state.summaryExpanded = !state.summaryExpanded
      panel.classList.toggle('show', state.summaryExpanded)
      if (state.summaryExpanded) {
        renderSummaryPanel()
        // 同时关闭日志面板
        const logPanel = document.getElementById('mma-log-panel')
        if (logPanel) {
          logPanel.classList.remove('show')
          state.logExpanded = false
        }
      }
      updateSummaryBadge()
    }
  }
  
  // 总结面板清空按钮
  const summaryClear = document.getElementById('mma-summary-clear')
  if (summaryClear) {
    summaryClear.onclick = (e) => {
      e.stopPropagation()
      if (state.summaries.length === 0) return
      if (confirm('确定清空所有总结记录吗？')) {
        state.summaries = []
        try { localStorage.removeItem(STORAGE_KEYS.SUMMARIES) } catch (e) {}
        updateSummaryBadge()
        renderSummaryPanel()
      }
    }
  }
  
  // 生成新总结按钮
  const genSummaryBtn = document.getElementById('mma-gen-summary')
  if (genSummaryBtn) {
    genSummaryBtn.onclick = (e) => {
      e.stopPropagation()
      // 关闭面板，然后触发生成总结
      const panel = document.getElementById('mma-summary-panel')
      if (panel) {
        panel.classList.remove('show')
        state.summaryExpanded = false
      }
      summarizeConversation()
    }
  }
  
  // 加载保存的总结
  loadSummaries()
  
  document.getElementById('mma-btn-log').onclick = (e) => {
    e.stopPropagation()
    console.log('[🧠 Agent] 点击日志按钮，当前状态:', state.logExpanded)
    toggleLogPanel()
  }
  
  document.getElementById('mma-log-clear').onclick = () => {
    state.toolCalls = []
    state.nextId = 1
    state.detectedHashes.clear()
    renderLogPanel()
    updateLogBadge()
  }
  
  // 延迟设置
  const delayMinInput = document.getElementById('mma-delay-min')
  const delayMaxInput = document.getElementById('mma-delay-max')
  // 初始化输入框值（从持久化读取）
  delayMinInput.value = state.sendDelayMin
  delayMaxInput.value = state.sendDelayMax
  
  delayMinInput.addEventListener('change', () => {
    let val = parseInt(delayMinInput.value) || 200
    val = Math.max(100, Math.min(val, state.sendDelayMax))
    state.sendDelayMin = val
    delayMinInput.value = val
    saveSendDelay()
  })
  
  delayMaxInput.addEventListener('change', () => {
    let val = parseInt(delayMaxInput.value) || 3000
    val = Math.max(state.sendDelayMin, Math.min(val, 10000))
    state.sendDelayMax = val
    delayMaxInput.value = val
    saveSendDelay()
  })
  
  // 元素捕获功能
  let pickingType = null // 'input' or 'send'
  let hoveredElement = null
  
  const pickerInputBtn = document.getElementById('mma-picker-input')
  const pickerSendBtn = document.getElementById('mma-picker-send')
  
  // 更新按钮状态
  function updatePickerButtons() {
    if (state.manualInputSelector) {
      pickerInputBtn.classList.add('active')
      pickerInputBtn.innerHTML = '✅ 输入框已捕获'
    } else {
      pickerInputBtn.classList.remove('active')
      pickerInputBtn.innerHTML = '🎯 捕获输入框'
    }
    if (state.manualSendSelector) {
      pickerSendBtn.classList.add('active')
      pickerSendBtn.innerHTML = '✅ 发送按钮已捕获'
    } else {
      pickerSendBtn.classList.remove('active')
      pickerSendBtn.innerHTML = '🎯 捕获发送按钮'
    }
  }
  
  function startPicking(type) {
    pickingType = type
    document.body.classList.add('mma-element-picking')
    if (type === 'input') {
      pickerInputBtn.classList.add('picking')
      pickerInputBtn.innerHTML = '👆 点击输入框'
    } else {
      pickerSendBtn.classList.add('picking')
      pickerSendBtn.innerHTML = '👆 点击发送按钮'
    }
    addSystemLog('元素捕获', `请点击页面上的${type === 'input' ? '输入框' : '发送按钮'}`, 'info')
  }
  
  function stopPicking() {
    if (hoveredElement) {
      hoveredElement.classList.remove('mma-element-highlight')
      hoveredElement = null
    }
    document.body.classList.remove('mma-element-picking')
    pickerInputBtn.classList.remove('picking')
    pickerSendBtn.classList.remove('picking')
    pickingType = null
    updatePickerButtons()
  }
  
  // 鼠标悬停高亮
  document.addEventListener('mouseover', (e) => {
    if (!pickingType) return
    if (e.target.closest('#mma-bottom-bar, #mma-log-panel')) return
    if (hoveredElement) hoveredElement.classList.remove('mma-element-highlight')
    hoveredElement = e.target
    e.target.classList.add('mma-element-highlight')
  }, true)
  
  // 点击捕获
  document.addEventListener('click', (e) => {
    if (!pickingType) return
    if (e.target.closest('#mma-bottom-bar, #mma-log-panel')) return
    
    e.preventDefault()
    e.stopPropagation()
    
    // 向上查找最合适的目标元素：
    // - 捕获发送按钮时，优先找 button/a/[role="button"] 等可点击元素
    // - 捕获输入框时，优先找 input/textarea/[contenteditable] 等输入元素
    let target = e.target
    if (pickingType === 'send') {
      const clickable = target.closest('button, a, [role="button"], [data-action], .btn, .send-btn, .submit-btn')
      if (clickable) target = clickable
    } else if (pickingType === 'input') {
      const inputEl = target.closest('input, textarea, [contenteditable="true"], [role="textbox"]')
      if (inputEl) target = inputEl
    }
    
    const selector = getUniqueSelector(target)
    
    if (pickingType === 'input') {
      state.manualInputSelector = selector
      try { localStorage.setItem('mma_input_selector', selector) } catch(e) {}
      addSystemLog('捕获成功', `输入框: ${selector}`, 'success')
      showToast('输入框捕获成功！')
    } else {
      state.manualSendSelector = selector
      try { localStorage.setItem('mma_send_selector', selector) } catch(e) {}
      addSystemLog('捕获成功', `发送按钮: ${selector}`, 'success')
      showToast('发送按钮捕获成功！')
    }
    
    stopPicking()
    return false
  }, true)
  
  // ESC 取消
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && pickingType) {
      stopPicking()
      addSystemLog('取消捕获', '用户取消', 'info')
    }
  })
  
  pickerInputBtn.onclick = (e) => {
    e.stopPropagation()
    if (pickingType === 'input') {
      stopPicking()
    } else {
      if (state.manualInputSelector) {
        // 重新捕获
        state.manualInputSelector = null
        try { localStorage.removeItem('mma_input_selector') } catch(e) {}
        updatePickerButtons()
      }
      startPicking('input')
    }
  }
  
  pickerSendBtn.onclick = (e) => {
    e.stopPropagation()
    if (pickingType === 'send') {
      stopPicking()
    } else {
      if (state.manualSendSelector) {
        state.manualSendSelector = null
        try { localStorage.removeItem('mma_send_selector') } catch(e) {}
        updatePickerButtons()
      }
      startPicking('send')
    }
  }
  
  // 测试发送按钮
  const testSendBtn = document.getElementById('mma-test-send')
  testSendBtn.onclick = async (e) => {
    e.stopPropagation()
    addSystemLog('测试发送', '开始发送测试消息...', 'info')
    const success = await injectAndSend('测试消息：如果能看到这条消息，说明输入框和发送按钮配置正确！✅')
    if (success) {
      addSystemLog('测试发送', '发送成功！', 'success')
      showToast('测试发送成功！')
    } else {
      addSystemLog('测试发送', '发送失败，请检查输入框和发送按钮配置', 'error')
      showToast('测试发送失败')
    }
  }
  
  // 测试 IPC 按钮
  const testIpcBtn = document.getElementById('mma-test-ipc')
  testIpcBtn.onclick = async (e) => {
    e.stopPropagation()
    addSystemLog('IPC 测试', '开始测试 IPC 通信...', 'info')
    await testInvoke()
  }
  
  // 扫描工具按钮
  const scanBtn = document.getElementById('mma-scan-tools')
  scanBtn.onclick = (e) => {
    e.stopPropagation()
    if (typeof window.__agent_scan__ === 'function') {
      window.__agent_scan__()
    } else {
      addSystemLog('扫描', '扫描功能未就绪', 'error')
    }
  }
  
  // 调试工具按钮（打开开发者工具）
  const devtoolsBtn = document.getElementById('mma-open-devtools')
  devtoolsBtn.onclick = (e) => {
    e.stopPropagation()
    try {
      ipcRenderer.send('deepseek:open-devtools', {})
      showToast('开发者工具已打开（如未显示，请在任务栏查找）')
      addSystemLog('调试工具', '开发者工具已打开', 'info')
    } catch(err) {
      showToast('打开开发者工具失败')
      addSystemLog('调试工具', '打开失败: ' + err.message, 'error')
    }
  }
  
  // 加载保存的选择器
  try {
    const savedInput = localStorage.getItem('mma_input_selector')
    if (savedInput) state.manualInputSelector = savedInput
    const savedSend = localStorage.getItem('mma_send_selector')
    if (savedSend) state.manualSendSelector = savedSend
    updatePickerButtons()
    if (savedInput || savedSend) {
      addSystemLog('已加载配置', `输入框: ${savedInput ? '✅' : '❌'} 发送按钮: ${savedSend ? '✅' : '❌'}`, 'info')
    }
  } catch(e) {}
}

// ========== 状态更新 ==========
function updateStatus(text, type = '') {
  const dot = document.getElementById('mma-status-dot')
  const txt = document.getElementById('mma-status-text')
  if (dot && txt) {
    dot.className = 'mma-status-dot ' + type
    txt.textContent = text
  }
}

// ========== 日志面板 ==========
function toggleLogPanel() {
  const panel = document.getElementById('mma-log-panel')
  state.logExpanded = !state.logExpanded
  panel.classList.toggle('show', state.logExpanded)
  if (state.logExpanded) {
    renderLogPanel()
    const badge = document.getElementById('mma-log-badge')
    if (badge) badge.style.display = 'none'
  }
}

function updateLogBadge() {
  const badge = document.getElementById('mma-log-badge')
  const count = document.getElementById('mma-log-count')
  // 只统计真实工具调用（排除系统日志）
  const realCalls = state.toolCalls.filter(t => !t.isSystem)
  const pendingCount = realCalls.filter(t => t.status === 'pending' || t.status === 'running').length
  
  if (badge) {
    if (pendingCount > 0 && !state.logExpanded) {
      badge.style.display = 'inline-flex'
      badge.textContent = pendingCount
    } else {
      badge.style.display = 'none'
    }
  }
  if (count) {
    count.textContent = realCalls.length
  }
}

// ========== 总结列表功能 ==========
function updateSummaryBadge() {
  const badge = document.getElementById('mma-summary-badge')
  const count = document.getElementById('mma-summary-count')
  if (badge) {
    if (state.summaries.length > 0 && !state.summaryExpanded) {
      badge.style.display = 'inline-flex'
      badge.textContent = state.summaries.length
    } else {
      badge.style.display = 'none'
    }
  }
  if (count) {
    count.textContent = state.summaries.length
  }
}

function renderSummaryPanel() {
  const body = document.getElementById('mma-summary-body')
  if (!body) return
  
  if (state.summaries.length === 0) {
    body.innerHTML = '<div class="mma-log-empty">暂无总结记录</div>'
    return
  }
  
  body.innerHTML = state.summaries.slice().reverse().map((s, idx) => {
    const realIdx = state.summaries.length - 1 - idx
    return `
      <div class="mma-summary-item">
        <div class="mma-summary-title">${escapeHtml(s.title)}</div>
        <div class="mma-summary-preview">${escapeHtml(s.preview)}</div>
        <div class="mma-summary-meta">
          <span>${escapeHtml(s.time)}</span>
          <button class="mma-summary-send" onclick="window._mmaSendSummary(${realIdx})">发送给 AI</button>
        </div>
      </div>
    `
  }).join('')
}

// 暴露到全局（onclick 用）
window._mmaSendSummary = function(idx) {
  const summary = state.summaries[idx]
  if (!summary) return
  
  // 关闭总结面板
  const panel = document.getElementById('mma-summary-panel')
  if (panel) panel.classList.remove('show')
  state.summaryExpanded = false
  
  // 把总结内容注入到输入框并发送
  const content = `这是之前对话的总结，请基于此继续：

${summary.content}`
  
  injectAndSend(content)
  addSystemLog('总结', `已发送总结：${summary.title}`, 'info')
  showToast('已发送总结')
}

// 保存总结（从 AI 消息中检测 markdown 总结）
// 从 AI 消息 DOM 中检测并保存 markdown 总结
function saveSummaryFromAIMessage(markdownEl, messageText) {
  let found = false
  
  // 方法1：从 pre 元素中找语言为 markdown 的代码块（最可靠）
  if (markdownEl && markdownEl.querySelectorAll) {
    const pres = markdownEl.querySelectorAll('pre')
    for (const pre of pres) {
      const lang = getCodeBlockLang(pre)
      if (lang === 'markdown') {
        const content = (pre.textContent || '').trim()
        if (content.length > 50) {
          if (trySaveSummary(content)) {
            found = true
          }
        }
      }
    }
  }
  
  // 方法2：兜底从文本正则匹配（防止某些渲染方式不同）
  if (!found && messageText) {
    const patterns = [
      /```markdown\s*([\s\S]*?)```/gi,
      /```\s*([\s\S]*?)```/gi  // 无语言标记的代码块也试一下
    ]
    for (const re of patterns) {
      let match
      while ((match = re.exec(messageText)) !== null) {
        const content = match[1].trim()
        if (content.length > 50 && trySaveSummary(content)) {
          found = true
        }
      }
    }
  }
  
  return found
}

// 尝试保存一条总结（判断内容是否真的是总结，去重）
function trySaveSummary(content) {
  // 判断是不是总结：包含总结关键词
  const isSummary = /对话总结|已完成的工作|进行中的工作|待处理的事项|📋|总结报告|工作小结|对话小结/i.test(content)
  if (!isSummary || content.length < 50) return false
  
  // 从内容中提取标题
  let title = '对话总结'
  const titleMatch = content.match(/##\s*[📋✅📝]?\s*(.+?)(?:\n|$)/)
  if (titleMatch) {
    title = titleMatch[1].trim()
  }
  
  // 去重：和最近一条总结内容对比（前 100 字）
  const lastSummary = state.summaries[state.summaries.length - 1]
  if (lastSummary && lastSummary.content.substring(0, 100) === content.substring(0, 100)) {
    return false // 重复了，跳过
  }
  
  // 提取预览（前 60 字）
  const preview = content.replace(/[#*\n`]/g, ' ').replace(/\s+/g, ' ').substring(0, 60) + '...'
  
  // 保存
  const now = new Date()
  const timeStr = `${now.getMonth() + 1}/${now.getDate()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  
  state.summaries.push({
    title,
    content,
    preview,
    time: timeStr,
    timestamp: Date.now()
  })
  
  // 最多保存 20 条
  if (state.summaries.length > 20) {
    state.summaries.shift()
  }
  
  // 持久化
  try {
    localStorage.setItem(STORAGE_KEYS.SUMMARIES, JSON.stringify(state.summaries))
  } catch (e) {}
  
  updateSummaryBadge()
  renderSummaryPanel()
  showToast('已保存总结')
  addSystemLog('总结', `自动捕获到新总结：${title}`, 'info')
  
  return true
}

// 加载保存的总结
function loadSummaries() {
  try {
    const saved = localStorage.getItem(STORAGE_KEYS.SUMMARIES)
    if (saved) {
      state.summaries = JSON.parse(saved)
      updateSummaryBadge()
    }
  } catch (e) {}
}

function renderLogPanel() {
  const body = document.getElementById('mma-log-body')
  if (!body) return
  
  if (state.toolCalls.length === 0) {
    body.innerHTML = '<div class="mma-log-empty">暂无工具调用</div>'
    return
  }
  
  body.innerHTML = state.toolCalls.slice().reverse().map(tc => {
    const badgeMap = {
      pending: { text: '待执行', cls: 'pending' },
      running: { text: '执行中', cls: 'running' },
      done: { text: '已完成', cls: 'done' },
      error: { text: '失败', cls: 'error' },
      skipped: { text: '已跳过', cls: 'pending' },
      log: { text: '日志', cls: 'log' } // 系统日志状态
    }
    const badge = badgeMap[tc.status] || badgeMap.pending
    
    let resultHtml = ''
    if (tc.status === 'done') {
      const resultStr = JSON.stringify(tc.result, null, 2)
      resultHtml = `<div class="mma-log-result success">${escapeHtml(resultStr.substring(0, 800))}${resultStr.length > 800 ? '...' : ''}</div>`
    } else if (tc.status === 'error') {
      resultHtml = `<div class="mma-log-result error">❌ ${escapeHtml(tc.error || '未知错误')}</div>`
    } else if (tc.status === 'log' && tc.isSystem) {
      // 系统日志显示消息内容
      const msg = tc.params?.message || ''
      resultHtml = `<div class="mma-log-result log-info">${escapeHtml(msg.substring(0, 500))}</div>`
    }
    
    return `
      <div class="mma-log-card">
        <div class="mma-log-card-header">
          <span class="mma-log-name">🔧 ${escapeHtml(tc.name)}</span>
          <span class="mma-log-badge ${badge.cls}">${badge.text}</span>
        </div>
        <div class="mma-log-params">${escapeHtml(JSON.stringify(tc.params, null, 2))}</div>
        ${resultHtml}
      </div>
    `
  }).join('')
}

// 初始化防抖：防止短时间内重复触发
let initCooldown = false

// ========== 自动初始化 ==========
async function autoInit() {
  if (initCooldown) {
    console.log('[🧠 Agent] 初始化冷却中，跳过')
    return
  }
  if (state.initialized) {
    console.log('[🧠 Agent] 已初始化，跳过')
    return
  }
  
  initCooldown = true
  state.initialized = true
  
  updateStatus('初始化中...', 'running')
  addSystemLog('初始化', '开始初始化，请求导图上下文...', 'info')
  showToast('正在初始化 Agent...')
  
  console.log('[🧠 Agent] 请求导图上下文...')
  // 请求渲染进程把导图上下文发过来
  try {
    ipcRenderer.send('deepseek:request-context', {})
    addSystemLog('初始化', 'IPC 请求已发送，等待主程序响应...', 'info')
  } catch(e) {
    addSystemLog('初始化', `IPC 发送失败: ${e.message}`, 'error')
    updateStatus('初始化失败', 'error')
    initCooldown = false
    return
  }
  
  // 3秒后解除冷却
  setTimeout(() => { initCooldown = false }, 3000)
}

// 主进程确认收到 IPC 消息
ipcRenderer.on('deepseek:ipc-ack', (event, data) => {
  addSystemLog('IPC 确认', `主进程已收到: ${data.channel}`, 'success')
  console.log('[🧠 Agent] 主进程确认收到:', data.channel)
})

// 主进程 ping 测试：收到后回 pong
ipcRenderer.on('deepseek:main-ping', (event, data) => {
  console.log('[🧠 Agent] 收到主进程 ping，时间戳:', data.ts)
  addSystemLog('Ping 测试', '收到主进程 ping，回 pong', 'success')
  ipcRenderer.send('deepseek:view-pong', { ts: Date.now(), pingTs: data.ts })
})

// invoke 测试：测试双向同步通信
async function testInvoke() {
  try {
    console.log('[🧠 Agent] 测试 invoke...')
    const result = await ipcRenderer.invoke('deepseek:ping', { test: 'hello' })
    console.log('[🧠 Agent] invoke 返回:', JSON.stringify(result))
    addSystemLog('Invoke 测试', `成功: ${JSON.stringify(result)}`, 'success')
  } catch(e) {
    console.error('[🧠 Agent] invoke 失败:', e.message)
    addSystemLog('Invoke 测试', `失败: ${e.message}`, 'error')
  }
}

// ========== 新建对话检测 ==========
function injectConversationDetector() {
  let lastUrl = location.href
  let lastMessageCount = 0
  let stableCount = 0  // 连续稳定次数
  let isFirstCheck = true  // 首次检测不触发
  let newConvCooldown = false // 新对话检测冷却
  
  const convTimer = setInterval(() => {
    // 检测 URL 变化（更严格：只有 /chat/ 开头的 pathname 变化才算新对话）
    try {
      const currentPath = new URL(location.href).pathname
      const lastPath = new URL(lastUrl).pathname
      if (currentPath !== lastPath && lastUrl !== location.href) {
        lastUrl = location.href
        if (!isFirstCheck && !newConvCooldown) {
          // 只有 pathname 包含 /chat/ 或类似对话路径才算新对话
          if (currentPath.includes('/chat/') || currentPath.includes('/c/') || currentPath.includes('/conversation/')) {
            handleNewConversation('URL变化')
            newConvCooldown = true
            setTimeout(() => { newConvCooldown = false }, 30000) // 30秒冷却
          }
        }
        isFirstCheck = false
        return
      }
    } catch(e) {}
    isFirstCheck = false
    
    // 检测消息数量骤减（用 .ds-message 精确选择器，减少到 0 才算新对话）
    const messages = document.querySelectorAll('.ds-message')
    const count = messages.length
    
    if (lastMessageCount > 2 && count === 0 && !newConvCooldown) {
      stableCount++
      if (stableCount >= 5) {
        handleNewConversation('消息数量归零')
        stableCount = 0
        lastMessageCount = count
        newConvCooldown = true
        setTimeout(() => { newConvCooldown = false }, 30000) // 30秒冷却
      }
    } else {
      stableCount = 0
      lastMessageCount = count
    }
  }, 5000)
  
  // 页面卸载时清理，防止内存泄漏
  window.addEventListener('beforeunload', () => {
    clearInterval(convTimer)
  }, { once: true })
}

function handleNewConversation(reason = '未知') {
  console.log('[🧠 Agent] 检测到新对话，原因:', reason)
  addSystemLog('新对话', `检测到新对话（${reason}），准备重新初始化`, 'info')
  state.initialized = false
  state.detectedHashes.clear()
  state.lastAIMessage = ''
  
  // 清理所有运行中工具的超时计时器，防止旧对话的结果回来干扰
  state.toolCalls.forEach(tc => {
    if (tc._timeoutId) clearTimeout(tc._timeoutId)
  })
  state.toolCalls = []
  state.nextId = 1
  
  // 重置初始化冷却（新对话应该允许立即初始化）
  initCooldown = false
  
  // 重置稳定性校验和已处理消息（原项目做法）
  lastContentHash = ''
  lastContentFirstSeen = 0
  if (stableTimer) { clearTimeout(stableTimer); stableTimer = null }
  isProcessing = false
  // processedMessages 是 WeakSet，无法清空，但新对话消息节点都是新的，不影响
  
  renderLogPanel()
  updateLogBadge()
  
  // 取消新对话自动初始化，改为手动点击
  // setTimeout(() => {
  //   autoInit()
  // }, 1500)
  addSystemLog('新对话', '检测到新对话，请点击"初始化"按钮手动初始化', 'info')
  showToast('检测到新对话，请点击初始化')
}

// ========== 总结对话 ==========
async function summarizeConversation() {
  updateStatus('生成总结中...', 'running')
  
  const summaryPrompt = `请总结我们当前这段对话的内容，**必须用 \`\`\`markdown 代码块包裹输出**，格式如下：

\`\`\`markdown
## 📋 对话总结

### 已完成的工作
- [列出已经完成的事项]

### 进行中的工作
- [列出正在进行但还没完成的事项]

### 待处理的事项
- [列出计划中但还没开始的事项]

### 可能存在的风险/问题
- [列出可能存在的风险、问题或需要注意的地方]

### 当前状态
- 文件：[当前操作的文件名]
- 进度：[整体进度描述]
\`\`\`

**重要要求**：
1. 所有总结内容必须放在 \`\`\`markdown 和 \`\`\` 之间
2. 不要在代码块外面写任何额外内容
3. 用简洁清晰的语言总结，不要遗漏重要信息
4. 方便用户一键复制保存`
  
  const success = await injectAndSend(summaryPrompt)
  if (success) {
    showToast('已发送总结请求')
  } else {
    updateStatus('就绪', '')
  }
}

// ========== 接收来自渲染进程的消息 ==========

// 接收导图上下文 → 自动注入系统提示词 + 上下文
ipcRenderer.on('mindmap-context', async (event, context) => {
  console.log('[🧠 Agent] 收到导图上下文，长度:', context?.length || 0)
  addSystemLog('收到上下文', `上下文长度: ${context?.length || 0} 字符`, 'info')
  
  const initMessage = buildInitMessage(context)
  addSystemLog('注入消息', `消息长度: ${initMessage.length} 字符，准备发送...`, 'info')
  
  const success = await injectAndSend(initMessage)
  
  if (success) {
    updateStatus('已初始化', 'done')
    addSystemLog('初始化完成', '消息已成功发送', 'success')
    setTimeout(() => updateStatus('就绪', ''), 2000)
    showToast('Agent 初始化完成')
  } else {
    updateStatus('初始化失败', 'error')
    addSystemLog('初始化失败', 'injectAndSend 返回 false，请检查输入框/发送按钮配置', 'error')
    showToast('初始化失败，请手动点击初始化')
  }
})

// 接收工具执行结果 → 自动回传给 AI
ipcRenderer.on('tool-result', (event, data) => {
  const { toolId, result, error } = data
  const tc = state.toolCalls.find(t => t.id === toolId)
  if (tc) {
    // 清除超时计时器
    if (tc._timeoutId) {
      clearTimeout(tc._timeoutId)
      tc._timeoutId = null
    }
    
    if (error) {
      tc.status = 'error'
      tc.error = error
      updateStatus(`${tc.name} 失败`, 'error')
    } else {
      tc.status = 'done'
      tc.result = result
      updateStatus(`${tc.name} 完成`, 'done')
    }
    renderLogPanel()
    updateLogBadge()
    
    // 自动执行模式下，无论成功失败都回传给 AI（让 AI 知道结果）
    if (state.isAutoRunning) {
      setTimeout(() => {
        sendResultToAI(tc.name, tc.status === 'done' ? tc.result : null, tc.status === 'error' ? tc.error : null)
      }, 800)
    }
  }
})

// ========== 系统提示词 + 上下文 ==========
function buildInitMessage(context) {
  // 根据文件类型动态调整身份描述
  const ctx = context || ''
  let roleDesc = '你是一个专业的 AI 助手，运行在「我的思维导图」桌面应用中。你可以调用工具来操作当前文件。'
  let capabilityHint = ''
  
  if (ctx.includes('文件类型：思维导图')) {
    roleDesc = '你是一个专业的思维导图 AI 助手，运行在「我的思维导图」桌面应用中。你可以调用工具来操作当前绑定的思维导图文件。'
  } else if (ctx.includes('文件类型：PDF')) {
    roleDesc = '你是一个专业的文档分析 AI 助手，运行在「我的思维导图」桌面应用中。当前绑定了一个 PDF 文档，你可以阅读、分析、总结这份文档，也可以调用工具进行其他操作。'
    capabilityHint = '> 💡 当前是 PDF 文档，**只读不可直接编辑**。你可以分析、总结、问答，或把内容转成思维导图。'
  } else if (ctx.includes('文件类型：Word') || ctx.includes('文件类型：docx')) {
    roleDesc = '你是一个专业的文档分析 AI 助手，运行在「我的思维导图」桌面应用中。当前绑定了一个 Word 文档，你可以阅读、分析、总结这份文档，也可以调用工具进行其他操作。'
    capabilityHint = '> 💡 当前是 Word 文档，**只读不可直接编辑**。你可以分析、总结、问答，或把内容转成思维导图。'
  } else if (ctx.includes('文件类型：Excel') || ctx.includes('文件类型：CSV') || ctx.includes('表格')) {
    roleDesc = '你是一个专业的数据处理 AI 助手，运行在「我的思维导图」桌面应用中。当前绑定了一个表格文件，你可以分析数据、总结规律，也可以调用工具进行其他操作。'
    capabilityHint = '> 💡 当前是表格文件，**只读不可直接编辑**。你可以数据分析、统计汇总，或把内容转成思维导图。'
  } else if (ctx.includes('文件类型：PowerPoint') || ctx.includes('pptx')) {
    roleDesc = '你是一个专业的演示文稿分析 AI 助手，运行在「我的思维导图」桌面应用中。当前绑定了一个 PPT 文档，你可以阅读、分析、总结这份演示文稿，也可以调用工具进行其他操作。'
    capabilityHint = '> 💡 当前是 PPT 文档，**只读不可直接编辑**。你可以分析、总结、问答，或把内容转成思维导图。'
  } else if (ctx.includes('文件类型：Markdown') || ctx.includes('文件类型：纯文本') || ctx.includes('md') || ctx.includes('txt')) {
    roleDesc = '你是一个专业的文本处理 AI 助手，运行在「我的思维导图」桌面应用中。当前绑定了一个文本文档，你可以阅读、分析、编辑、改写这份文档。'
    capabilityHint = '> 💡 当前是文本文档，你可以直接分析内容并给出建议，也可以把内容转成思维导图。'
  }
  
  const lines = [
    roleDesc,
    '',
    '## 📌 当前绑定文件信息',
    '',
    ctx || '（暂无打开的文件）',
    '',
  ]
  
  if (capabilityHint) {
    lines.push(capabilityHint)
    lines.push('')
  }
  
  lines.push(
    '## 🔧 如何调用工具',
    '',
    '请使用 ```mymindmap 代码块来输出工具调用，格式如下：'
  )
  
  return lines.join('\n') + `
\`\`\`mymindmap
{
  "tool": "工具名",
  "params": {
    "参数名": "参数值"
  }
}
\`\`\`

**重要规则**：
- 只有 \`\`\`mymindmap 代码块中的内容才会被识别为工具调用
- 普通 \`\`\`json 或其他代码块不会被执行
- **一次消息最多输出 2 个 mymindmap 代码块**，太多会触发消息频率限制导致失败
- 工具执行结果会自动发送回来，你可以基于结果继续推理
- 操作节点前先用 search_nodes 获取节点 uid
- **⚡ 优先使用批量工具**：batch_node_actions 可以一次执行多个节点操作（添加/删除/更新/移动），比单个调用快 10 倍以上，大大减少消息往返
- **如果不确定有哪些工具，或者不确定工具的参数，请先调用 list_tools 查看所有工具，再用 get_tool_detail 查询具体用法**

### 🛠️ 元工具（查询工具本身）

**list_tools** - 列出所有可用工具（必用！不了解工具时先查这个）
- 参数: category(可选，按分类筛选), verbose(可选，是否显示参数)
- 示例: \`{ "tool": "list_tools", "params": {} }\`

**get_tool_detail** - 获取某个工具的详细参数说明
- 参数: tool_name (必填，工具名)
- 示例: \`{ "tool": "get_tool_detail", "params": { "tool_name": "search_nodes" } }\`

### 多工具调用示例（一次输出多个代码块，会依次执行）

\`\`\`mymindmap
{
  "tool": "search_nodes",
  "params": {
    "keyword": "第一章"
  }
}
\`\`\`

\`\`\`mymindmap
{
  "tool": "add_child_nodes",
  "params": {
    "targets": { "uids": ["节点uid"] },
    "children": [
      { "text": "子节点1" },
      { "text": "子节点2" }
    ]
  }
}
\`\`\`

## 📋 可用工具列表（含参数示例）

### ⭐ 批量操作（优先使用，效率最高）

**batch_node_actions** - 批量节点操作（强烈推荐，一次执行多个操作，效率最高）
- 参数:
  - steps (数组，必填): 操作步骤列表，每步有 targets + 操作类型
    - targets (对象): 该步骤的目标节点（uids/keyword/mode）
    - set_style (对象): 批量设置节点样式（fillColor / textColor / bold / italic / shape / fontSize 等）
    - text_style (对象): 仅设置匹配的文本片段样式（color/regex/text + style）
    - ai_cloze (布尔): true = 对目标节点执行 AI 智能挖空
    - update_texts (数组): 每个节点不同的文本 [{uid, text}, ...]
    - wrap_text (对象): 用前缀/后缀包裹文本 {prefix, suffix}
    - replace_text (对象): 查找替换文本 {find, replacement, regex, flags}
    - clear_cloze (对象): 清除挖空 {before, after}
    - condition (对象): 额外筛选条件（textContains / hasCloze / minDepth 等）
  - dry_run (布尔，可选): true = 预览不修改，大规模操作前先预览
- 示例（批量设置叶子父节点红色 + 叶子节点挖空）:
\`\`\`
{ "tool": "batch_node_actions", "params": { "steps": [
  { "targets": { "mode": "leaf_parents" }, "set_style": { "textColor": "#ff3b30" } },
  { "targets": { "mode": "leaves" }, "ai_cloze": true }
], "dry_run": true } }
\`\`\`
- 示例（批量更新 2 个节点文本）:
\`\`\`
{ "tool": "batch_node_actions", "params": { "steps": [
  { "targets": { "uids": ["uid1", "uid2"] }, "update_texts": [
    { "uid": "uid1", "text": "新文本1" },
    { "uid": "uid2", "text": "新文本2" }
  ] }
] } }
\`\`\`

### 节点操作

> 💡 **targets 参数说明**：大多数节点工具都使用 targets 对象来选择目标节点，支持三种方式：
> - uids: 指定 UID 列表，如 { "uids": ["uid1", "uid2"] }
> - keyword: 按关键词匹配，如 { "keyword": "第一章" }
> - mode: 按结构模式，可选 "leaves"（所有叶子）、"leaf_parents"（叶子的父节点）、"all"（所有节点）
> - **不传 targets 则操作当前选中的节点**

**search_nodes** - 搜索节点（获取 uid，操作前必用）
- 参数:
  - keyword (字符串): 单个搜索关键词
  - keywords (数组，可选): 多个关键词（推荐，避免重复调用）
  - mode (字符串，可选): "any"=匹配任意一个（默认）、"all"=匹配所有
  - max_results (数字，可选): 最大返回数，默认 200
- 示例: \`{ "tool": "search_nodes", "params": { "keyword": "心理学" } }\`
- 示例（多关键词）: \`{ "tool": "search_nodes", "params": { "keywords": ["第一章", "导论"], "mode": "any" } }\`

**add_child_nodes** - 批量添加子节点（支持嵌套，一次性创建整棵子树！）
- 参数:
  - targets (对象，可选): 目标父节点集合，**不传则对当前选中节点操作**
    - uids (数组): 节点 UID 列表
    - keyword (字符串): 按关键词匹配节点
    - mode (字符串): 按模式匹配，可选 "leaves"、"leaf_parents"
  - children (数组，必填): 子节点树（支持嵌套 children，一次性创建多层）
    - text (字符串): 节点文本（必填）
    - children (数组): 下一级子节点（递归嵌套）
  - afterInsert (字符串，可选): 插入后行为："select" / "focus" / "none"，默认 select
- 示例（一次性创建 3 层结构）:
\`\`\`
{
  "tool": "add_child_nodes",
  "params": {
    "targets": { "uids": ["根节点uid"] },
    "children": [
      {
        "text": "1. 用户输入",
        "children": [
          { "text": "用户名" },
          { "text": "密码" },
          { "text": "验证码" }
        ]
      },
      {
        "text": "2. 前端验证",
        "children": [
          { "text": "格式校验" },
          { "text": "非空校验" }
        ]
      }
    ]
  }
}
\`\`\`
- 💡 **重要技巧**：children 里可以继续嵌套 children，一次性创建完整的多层结构！

**update_node_text** - 更新节点文本（支持批量）
- 参数（三选一）:
  - updates (数组): 每个节点不同的文本，格式 [{uid, text}, ...]
  - text + targets: 相同文本应用到 targets 指定的所有节点
  - 都不传: 更新当前选中的节点
- 示例（批量更新多个节点）:
\`\`\`
{ "tool": "update_node_text", "params": { "updates": [
  { "uid": "uid1", "text": "新文本1" },
  { "uid": "uid2", "text": "新文本2" }
] } }
\`\`\`
- 示例（对选中节点设置相同文本）: \`{ "tool": "update_node_text", "params": { "text": "新内容" } }\`

**delete_node** - 删除节点
- 参数:
  - targets (对象，可选): 要删除的节点集合，**不传则删除当前选中节点**
    - uids (数组): 节点 UID 列表
    - keyword (字符串): 按关键词匹配节点
    - mode (字符串): 按模式匹配，可选 "leaves"、"leaf_parents"、"all"
- ⚠️ 删除多个节点前请确认
- 示例: \`{ "tool": "delete_node", "params": { "targets": { "uids": ["uid1"] } } }\`

**select_node** - 批量选中节点
- 参数（任选其一）:
  - keyword (字符串): 选中所有文本包含该关键词的节点
  - uids (数组): 选中指定 UID 列表的节点
  - mode (字符串): 按结构模式选择："leaves" / "leaf_parents" / "level_range"
  - minDepth / maxDepth (数字): mode=level_range 时使用（root=0）
  - includeChildren (布尔): 是否同时选中所有子节点，默认 false
- 示例: \`{ "tool": "select_node", "params": { "mode": "leaves" } }\`
- 示例: \`{ "tool": "select_node", "params": { "keyword": "马克思主义" } }\`

**focus_node** - 聚焦节点（滚动到视野中心并高亮）
- 参数（二选一）:
  - uid (字符串): 节点 UID
  - keyword (字符串): 关键词（第一个匹配的节点）
- 示例: \`{ "tool": "focus_node", "params": { "uid": "abc123" } }\`
- 示例: \`{ "tool": "focus_node", "params": { "keyword": "重点内容" } }\`

### 挖空工具

> ⚠️ **注意**：挖空工具（ai_cloze、ai_cloze_review 等）**不支持 file_path 后台模式**，必须打开文件后才能操作。它们依赖 AI 模型调用，需要配置 AI API。

**ai_cloze** - 智能挖空（关键词挖空，保留上下文线索）
- 参数:
  - targets (对象，可选): 目标节点集合，**不传则对当前选中的节点操作**
    - uids (数组): 节点 UID 列表
    - keyword (字符串): 按关键词匹配节点
    - mode (字符串): 按模式匹配，可选 "leaves"（所有叶子节点）、"leaf_parents"（所有叶子的父节点）
- 示例（对指定 UID 列表挖空）:
\`\`\`
{ "tool": "ai_cloze", "params": { "targets": { "uids": ["uid1", "uid2"] } } }
\`\`\`
- 示例（对所有叶子节点挖空）:
\`\`\`
{ "tool": "ai_cloze", "params": { "targets": { "mode": "leaves" } } }
\`\`\`
- 示例（按关键词匹配节点挖空）:
\`\`\`
{ "tool": "ai_cloze", "params": { "targets": { "keyword": "马克思" } } }
\`\`\`
- 💡 **全文挖空技巧**：用 ai_cloze_full_map 一键全文挖空，或用 get_all_nodes + ai_cloze

**ai_cloze_full_map** - 全文挖空（对整个导图所有节点挖空，一键完成）
- 说明：直接对当前打开的导图所有节点执行智能挖空，不需要手动传 UID 列表
- 示例: \`{ "tool": "ai_cloze_full_map", "params": {} }\`
- 💡 **这是全文挖空最快的方式**

**ai_cloze_review** - 审查挖空质量（移除不合理的挖空，补充遗漏的关键词）
- 参数:
  - targets (对象，可选): 目标节点集合，不传则审查当前选中节点
    - uids (数组): 节点 UID 列表
    - keyword (字符串): 按关键词匹配节点
    - mode (字符串): 按模式匹配，可选 "leaves"、"leaf_parents"、"all"

**clear_cloze** - 清除挖空标记
- 参数:
  - targets (对象，必填): 要清除挖空的节点集合
    - uids (数组): 节点 UID 列表
    - keyword (字符串): 按关键词匹配节点
    - mode (字符串): 按模式匹配，"all"=清除整张图
  - before (字符串，可选): 只清除分隔符之前的挖空
  - after (字符串，可选): 只清除分隔符之后的挖空
- 示例（清除整张图的挖空）: \`{ "tool": "clear_cloze", "params": { "targets": { "mode": "all" } } }\`

### 文件操作

> 📁 **默认保存目录**：C:\我的mindmap
> - 创建新文件时，如果用户没有指定路径，**直接用默认目录，不要问用户**
> - 保存思维导图时也是保存到这个目录
> - 你可以先调用 list_directory("C:\\我的mindmap") 查看当前目录结构
> - 文件名如果用户没指定，就根据内容自动起一个合适的中文名
> - **不要用相对路径**（如 "文件名.smm"），那样会保存到安装目录，没有写入权限

**new_mindmap** - 新建思维导图（创建并自动打开，默认保存到 C:\我的mindmap）
- 参数:
  - rootText (字符串，可选): 根节点文本，默认"中心主题"
  - save_dir (字符串，可选): 保存目录，默认 C:\我的mindmap
- 示例（最简单用法）:
\`\`\`
{ "tool": "new_mindmap", "params": { "rootText": "登录流程" } }
\`\`\`
- 返回字段:
  - filePath: 创建的文件完整路径
  - rootUid: 根节点 UID（可直接用于添加子节点）
  - autoOpened: 是否已自动打开文件
- 说明: 创建文件后会自动在应用中打开，**创建成功后可以直接用 add_child_nodes 添加子节点**！

**save_mindmap** - 保存当前导图
- 参数:
  - fileName (字符串，可选): 新文件名（不含扩展名）。不传则用根节点文本作为文件名（另存为新文件时）
  - save_dir (字符串，可选): 保存目录。有当前打开文件时默认保存到当前文件所在目录；无打开文件时保存到默认目录（C:\我的mindmap）
  - new_file (布尔，可选): true=强制另存为新文件
- 💡 **重要**：不传 fileName / save_dir / new_file 时 = 直接覆盖保存当前文件（原地保存，最常用）
- 💡 只想保存当前文件的修改 → 直接调用 \`save_mindmap\` 不传任何参数
- 示例（原地覆盖保存）: \`{ "tool": "save_mindmap", "params": {} }\`
- 示例（另存为新文件到当前目录）: \`{ "tool": "save_mindmap", "params": { "fileName": "副本", "new_file": true } }\`

**export_mindmap_html** - 导出交互式 HTML
- 参数:
  - mode (字符串，可选): "single"=单导图视图（默认）、"full"=全视图三模式
  - file_name (字符串，可选): 文件名（不含扩展名），默认用根节点文本
  - file_path (字符串，可选): 指定 .smm 文件路径，后台导出无需打开

**export_to_markdown** - 导出 Markdown
- 参数:
  - file_name (字符串，可选): 文件名（不含扩展名）
  - file_path (字符串，可选): 指定单个 .smm 文件路径，后台导出
  - file_paths (数组，可选): 多个 .smm 文件路径，批量导出

**read_mindmap_file** - 读取 .smm 文件
- 参数: file_path (字符串，文件完整路径)
- 示例: \`{ "tool": "read_mindmap_file", "params": { "file_path": "C:\\\\我的mindmap\\\\测试.smm" } }\`

**list_directory** - 列出目录
- 参数:
  - path (字符串，目录路径)
  - recursive (布尔，是否递归)
- 示例: \`{ "tool": "list_directory", "params": { "path": "C:\\\\我的mindmap", "recursive": false } }\`

**find_local_file** - 查找本地文件（自动搜索桌面/文档/下载/默认目录）
- 参数:
  - keyword (字符串，可选): 文件名关键词，不传则搜所有文件
  - path (字符串，可选): 指定搜索目录
  - exts (数组，可选): 按扩展名筛选，如 ["smm", "md", "pdf"]
- 示例（搜索所有导图文件）: \`{ "tool": "find_local_file", "params": { "exts": ["smm"] } }\`
- 示例（按关键词搜索）: \`{ "tool": "find_local_file", "params": { "keyword": "导论", "exts": ["smm", "md"] } }\`

### 查询工具

**get_all_nodes** - 获取全部节点（一键拿到所有节点的 UID 和文本）
- 参数:
  - file_path (字符串，可选): 指定 .smm 文件路径，后台模式，无需打开文件
  - include_text (布尔，可选): 是否包含节点文本，默认 true
  - max_depth (数字，可选): 最大深度，0=不限制，默认 0
- 示例（获取当前导图全部节点）: \`{ "tool": "get_all_nodes", "params": {} }\`
- 示例（后台获取指定文件全部节点）:
\`\`\`
{ "tool": "get_all_nodes", "params": { "file_path": "C:\\我的mindmap\\笔记.smm" } }
\`\`\`
- 返回字段:
  - total: 节点总数
  - leafCount: 叶子节点数
  - maxLevel: 最大层级
  - rootUid: 根节点 UID
  - nodes: 节点数组，每个元素含 uid/text/depth/parentUid/isRoot
- 💡 **使用场景**：批量操作前获取所有 UID、全文挖空、统计分析、遍历整个导图结构

### 视图操作

**zoom_control** - 视图缩放控制
- 参数:
  - action (字符串，必填): "in"=放大、"out"=缩小、"fit"=适应屏幕、"reset"=重置
- 示例: \`{ "tool": "zoom_control", "params": { "action": "in" } }\`
- 示例: \`{ "tool": "zoom_control", "params": { "action": "fit" } }\`

**semantic_search** - 语义搜索
- 参数: query (字符串，搜索查询)
- 示例: \`{ "tool": "semantic_search", "params": { "query": "记忆方法" } }\`

## 🎯 工作流程

1. 先了解当前文件结构（已在上方提供）
2. 需要操作节点时，先用 search_nodes 搜索获取 uid
3. **需要所有节点 UID 时用 get_all_nodes**：一键获取全部节点，比逐个搜索快 100 倍
4. **构建导图时尽量一次性创建多层结构**：add_child_nodes 的 children 支持嵌套，不要一层一层地加
5. **优先使用批量工具**：batch_node_actions 一次可以执行多个操作
6. **全文挖空用 ai_cloze_full_map**：一键对整个导图挖空，不要一个个节点挖
7. 输出 mymindmap 代码块调用工具（可以一次输出多个，按顺序执行）
8. 等待工具执行结果自动返回
9. 基于结果继续分析，如需更多操作继续输出 mymindmap 代码块

## ⚠️ 重要注意事项（铁律，必须严格遵守）

- **🚫 严禁主动操作导图**：在用户没有明确提出具体需求之前，绝对不要调用任何修改类工具（add_child_nodes / update_node_text / delete_node / batch_node_actions / save_mindmap 等）。即使导图是空白的，也不能自己创建内容。
- **🚫 初始化阶段不要调用工具**：首次加载时只做自我介绍，不要调用 search_nodes / get_all_nodes 等任何工具。工具只有在用户明确需要时才能调用。
- **🚫 严禁自作主张**：用户说"你好""在吗"或只是打个招呼时，礼貌回应即可，不要主动开始干活。永远等待用户明确说出他想要什么。
- **UID 只对当前绑定文件有效**：每个 .smm 文件的节点 UID 都是独立的。切换文件后，之前获取的 UID 全部失效，必须重新调用 get_all_nodes 或 search_nodes 获取新的 UID
- **保存文件默认原地覆盖**：直接调用 save_mindmap 不传任何参数 = 保存到当前绑定文件。只有需要另存为新文件时才传 fileName / save_dir / new_file
- **不确定节点文本时用 get_all_nodes**：search_nodes 搜不到时不要盲目换关键词猜，直接用 get_all_nodes 拿到全部节点列表后再筛选
- **占位节点检测**：get_all_nodes 会自动检测"分支主题"、"中心主题"等模板占位节点并返回 placeholderNodes 列表。发现占位节点时应主动提醒用户并询问是否需要补充内容

现在请确认你已理解以上所有规则（尤其是前面三条铁律），简要回复你能做什么，**但不要调用任何工具，不要主动创建内容，等待用户下一步指示**。`
}

// ========== 全局工具函数（提取代码块语言） ==========
// 从 pre 元素提取代码块的语言标记（小写）
function getCodeBlockLang(pre) {
  if (!pre) return ''
  // 1. pre 元素的 data-language 属性
  let lang = pre.getAttribute('data-language') || ''
  // 2. 父元素的 data-language
  if (!lang) {
    const parentDiv = pre.closest('div[data-language]')
    if (parentDiv) lang = parentDiv.getAttribute('data-language') || ''
  }
  // 3. code 元素的 language-* class
  if (!lang) {
    const codeEl = pre.querySelector('code')
    const els = [codeEl, pre].filter(Boolean)
    for (const el of els) {
      const clsList = Array.from(el.classList || []).find(c => c.startsWith('language-'))
      if (clsList) { lang = clsList.replace('language-', ''); break }
    }
  }
  // 4. .md-code-block-banner 里的 span 文本
  if (!lang) {
    const block = pre.closest('.md-code-block')
    if (block) {
      const banner = block.querySelector('.md-code-block-banner')
      if (banner) {
        const spans = banner.querySelectorAll('span')
        for (const span of spans) {
          if (span.closest('button')) continue
          const t = (span.textContent || '').trim()
          if (/^[a-zA-Z0-9_+#.-]{1,20}$/.test(t)) { lang = t; break }
        }
      }
    }
  }
  return (lang || '').toLowerCase()
}

// ========== 工具调用检测（只识别 mymindmap 代码块）==========
function injectToolDetector() {
  let checkTimer = null
  
  function scheduleCheck() {
    if (checkTimer) clearTimeout(checkTimer)
    checkTimer = setTimeout(checkForToolCalls, 1000)
  }
  
  // 判断节点是否位于用户消息区域内
  function isUserMessage(node) {
    let current = node
    while (current) {
      const role = current.getAttribute?.('data-role') || current.getAttribute?.('data-author') || ''
      if (role === 'user' || role === 'human') return true
      const cls = current.className || ''
      if (typeof cls === 'string' && (cls.includes('user-message') || cls.includes('message-user') || cls.includes('human'))) {
        return true
      }
      current = current.parentElement
    }
    return false
  }
  
  // 提取代码块的语言标记（小写）
  function getCodeBlockLanguage(pre) {
    if (!pre) return ''
    
    // 1. 先看 pre 元素的 data-language 属性
    let lang = pre.getAttribute('data-language') || ''
    console.log(`[🧠 Agent] getCodeBlockLanguage: 检查 pre[data-language] = "${lang}"`)
    
    // 2. 再往上找 div[data-language]
    if (!lang) {
      const parentDiv = pre.closest('div[data-language]')
      if (parentDiv) {
        lang = parentDiv.getAttribute('data-language') || ''
        console.log(`[🧠 Agent] getCodeBlockLanguage: 从父 div[data-language] 获得 = "${lang}"`)
      }
    }
    
    // 3. 再看 code 元素的 language-* class
    if (!lang) {
      const codeEl = pre.querySelector('code')
      const els = [codeEl, pre].filter(Boolean)
      for (const el of els) {
        const clsList = Array.from(el.classList).find(c => c.startsWith('language-'))
        if (clsList) {
          lang = clsList.replace('language-', '')
          console.log(`[🧠 Agent] getCodeBlockLanguage: 从 language-* class 获得 = "${lang}"`)
          break
        }
      }
    }
    
    // 4. 再找 .md-code-block-banner 里的 span 文本
    if (!lang) {
      const block = pre.closest('.md-code-block')
      if (block) {
        const banner = block.querySelector('.md-code-block-banner')
        if (banner) {
          const spans = banner.querySelectorAll('span')
          for (const span of spans) {
            if (span.closest('button')) continue
            const t = (span.textContent || '').trim()
            if (/^[a-zA-Z0-9_+#.-]{1,20}$/.test(t)) {
              lang = t
              console.log(`[🧠 Agent] getCodeBlockLanguage: 从 md-code-block-banner span 获得 = "${lang}"`)
              break
            }
          }
        }
      }
    }
    
    const result = (lang || '').toLowerCase()
    console.log(`[🧠 Agent] getCodeBlockLanguage: 最终语言 = "${result}"`)
    return result
  }
  
  function getLastAIMessage() {
    // 优先用 .ds-message 选择器找消息
    const messages = document.querySelectorAll('.ds-message')
    console.log(`[🧠 Agent] getLastAIMessage: 找到 ${messages.length} 个 .ds-message 元素`)
    
    const aiMessages = []
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i]
      const role = msg.getAttribute?.('data-role') || msg.getAttribute?.('data-author') || ''
      const userMsg = isUserMessage(msg)
      
      if (userMsg) {
        console.log(`[🧠 Agent] getLastAIMessage: 消息[${i}] 是用户消息 (role="${role}")，跳过`)
        continue
      }
      
      // 找 markdown 容器
      const markdown = msg.querySelector(':scope > .ds-markdown')
      if (markdown) {
        const text = (markdown.innerText || '').trim()
        if (text.length > 0) {
          aiMessages.push({ el: msg, markdown, text })
          console.log(`[🧠 Agent] getLastAIMessage: 消息[${i}] 是 AI 消息，长度 ${text.length}`)
        } else {
          console.log(`[🧠 Agent] getLastAIMessage: 消息[${i}] 是 AI 消息但内容为空`)
        }
      } else {
        console.log(`[🧠 Agent] getLastAIMessage: 消息[${i}] 未找到 .ds-markdown，role="${role}"`)
      }
    }
    
    console.log(`[🧠 Agent] getLastAIMessage: 筛选出 ${aiMessages.length} 条有内容的 AI 消息`)
    
    if (aiMessages.length === 0) return null
    
    // 返回最后一条 AI 消息的 markdown 容器
    const last = aiMessages[aiMessages.length - 1]
    console.log(`[🧠 Agent] getLastAIMessage: 返回最后一条 AI 消息，内容长度: ${last.text.length}`)
    return last.markdown
  }
  
  function parseToolCalls(markdownEl) {
    const calls = []
    if (!markdownEl) {
      console.log('[🧠 Agent] parseToolCalls: markdownEl 为空，直接返回')
      return calls
    }
    
    const text = markdownEl.innerText || ''
    console.log(`[🧠 Agent] parseToolCalls: markdown 文本总长度: ${text.length}`)
    
    // ========== 第一优先级：文本正则匹配（最可靠，不依赖 DOM 结构）==========
    // 直接从纯文本中提取 ```mymindmap 代码块，不依赖语言标记是否被正确识别
    const textPatterns = [
      /```mymindmap\s*\n([\s\S]*?)\n```/g,
      /```mymindmap\s*```\s*\n([\s\S]*?)\n```/g,  // 兼容可能的格式
    ]
    
    for (const re of textPatterns) {
      let m
      while ((m = re.exec(text)) !== null) {
        try {
          const codeStr = m[1].trim()
          const obj = JSON.parse(codeStr)
          const name = obj.tool || obj.name
          const params = obj.params || obj.arguments || obj.args || {}
          if (name && typeof name === 'string' && name.length > 1) {
            calls.push({ name, params })
            console.log(`[🧠 Agent] parseToolCalls: ✅ 从文本正则匹配到工具: ${name}`)
          }
        } catch(e) {
          console.log(`[🧠 Agent] parseToolCalls: 文本正则匹配 JSON 解析失败: ${e.message}`)
        }
      }
    }
    
    // 如果从文本中已经找到了，就不再走 DOM 路径（避免重复）
    if (calls.length > 0) {
      console.log(`[🧠 Agent] parseToolCalls: 文本正则已找到 ${calls.length} 个工具调用，跳过 DOM 解析`)
      return calls
    }
    
    // ========== 第二优先级：DOM pre 元素解析（兜底）==========
    console.log('[🧠 Agent] parseToolCalls: 文本正则未找到，尝试 DOM pre 元素解析')
    
    // 找所有 pre 元素
    const pres = markdownEl.querySelectorAll('pre')
    console.log(`[🧠 Agent] parseToolCalls: 找到 ${pres.length} 个 pre 元素`)
    
    for (let i = 0; i < pres.length; i++) {
      const pre = pres[i]
      const lang = getCodeBlockLanguage(pre)
      const blockText = pre.textContent || ''
      const preview = blockText.substring(0, 50).replace(/\n/g, '\\n')
      console.log(`[🧠 Agent] parseToolCalls: pre[${i}] 语言="${lang}", 内容前50字: ${preview}`)
      
      // 如果语言是 'mymindmap' 或 'json'，尝试解析 JSON
      // 兜底：即使语言识别不出来，只要内容看起来像工具调用 JSON（有 tool 字段），也尝试解析
      const looksLikeToolCall = /"tool"\s*:/.test(blockText)
      if (lang === 'mymindmap' || lang === 'json' || looksLikeToolCall) {
        console.log(`[🧠 Agent] parseToolCalls: pre[${i}] 语言="${lang}"${looksLikeToolCall ? '，检测到 tool 字段兜底匹配' : ''}，尝试解析 JSON`)
        try {
          const obj = JSON.parse(blockText.trim())
          const name = obj.tool || obj.name
          const params = obj.params || obj.arguments || obj.args || {}
          if (name && typeof name === 'string' && name.length > 1) {
            // 额外校验：name 必须是合理的工具名（字母数字下划线），防止误识别普通 JSON
            if (/^[a-zA-Z][a-zA-Z0-9_]*$/.test(name) || /^[a-zA-Z][a-zA-Z0-9_]*_[a-zA-Z0-9_]+/.test(name)) {
              calls.push({ name, params })
              console.log(`[🧠 Agent] parseToolCalls: ✅ 从 pre 直接解析到工具: ${name}`)
            }
          }
        } catch(e) {
          console.log(`[🧠 Agent] parseToolCalls: pre[${i}] 直接 JSON 解析失败: ${e.message}，尝试提取 JSON 对象`)
          // 尝试提取 JSON 对象
          const match = blockText.match(/\{[\s\S]*\}/)
          if (match) {
            try {
              const obj = JSON.parse(match[0])
              const name = obj.tool || obj.name
              const params = obj.params || obj.arguments || obj.args || {}
              if (name && typeof name === 'string' && name.length > 1) {
                if (/^[a-zA-Z][a-zA-Z0-9_]*$/.test(name) || /^[a-zA-Z][a-zA-Z0-9_]*_[a-zA-Z0-9_]+/.test(name)) {
                  calls.push({ name, params })
                  console.log(`[🧠 Agent] parseToolCalls: ✅ 从 pre 提取 JSON 解析到工具: ${name}`)
                }
              }
            } catch(e2) {
              console.log(`[🧠 Agent] parseToolCalls: pre[${i}] 提取 JSON 也失败: ${e2.message}`)
            }
          }
        }
      }
    }
    
    // 再兜底：文本里找 "mymindmap" 关键词附近的 JSON
    if (calls.length === 0 && text.includes('mymindmap')) {
      console.log('[🧠 Agent] parseToolCalls: 文本中包含 mymindmap 关键词，尝试宽松匹配...')
      const idx = text.indexOf('mymindmap')
      const afterText = text.substring(idx, idx + 1000)
      const jsonMatch = afterText.match(/\{[\s\S]*?"tool"[\s\S]*?\}/)
      if (jsonMatch) {
        try {
          const obj = JSON.parse(jsonMatch[0])
          const name = obj.tool || obj.name
          const params = obj.params || obj.arguments || obj.args || {}
          if (name && typeof name === 'string' && name.length > 1) {
            calls.push({ name, params })
            console.log(`[🧠 Agent] parseToolCalls: ✅ 宽松匹配到工具: ${name}`)
          }
        } catch(e) {
          console.log(`[🧠 Agent] parseToolCalls: 宽松匹配 JSON 解析失败: ${e.message}`)
        }
      }
    }

    // ========== 终极兜底：全页搜索 mymindmap 代码块 ==========
    // 如果上面的方法都失败了，直接在整个页面里搜
    if (calls.length === 0) {
      try {
        const fullText = document.body.innerText || ''
        if (fullText.includes('mymindmap')) {
          console.log(`[🧠 Agent] parseToolCalls: ⚠️ 消息元素内未找到，但全页文本包含 mymindmap！尝试全页提取...`)
          // 用更宽松的正则，匹配 ```mymindmap 和后面的 JSON
          const fullPattern = /```mymindmap\s*\n?([\s\S]*?)\n?```/g
          let fm
          while ((fm = fullPattern.exec(fullText)) !== null) {
            try {
              const codeStr = fm[1].trim()
              const obj = JSON.parse(codeStr)
              const name = obj.tool || obj.name
              const params = obj.params || obj.arguments || obj.args || {}
              if (name && typeof name === 'string' && name.length > 1) {
                calls.push({ name, params })
                console.log(`[🧠 Agent] parseToolCalls: ✅ 全页扫描匹配到工具: ${name}`)
              }
            } catch(e) {
              // JSON 解析失败，尝试提取第一个完整的 JSON 对象
              const jsonMatch = fm[1].match(/\{[\s\S]*\}/)
              if (jsonMatch) {
                try {
                  const obj = JSON.parse(jsonMatch[0])
                  const name = obj.tool || obj.name
                  const params = obj.params || obj.arguments || obj.args || {}
                  if (name && typeof name === 'string' && name.length > 1) {
                    calls.push({ name, params })
                    console.log(`[🧠 Agent] parseToolCalls: ✅ 全页扫描提取 JSON 匹配到工具: ${name}`)
                  }
                } catch(e2) {
                  console.log(`[🧠 Agent] parseToolCalls: 全页扫描 JSON 解析失败: ${e2.message}`)
                }
              }
            }
          }
          if (calls.length === 0) {
            console.log(`[🧠 Agent] parseToolCalls: 全页扫描也没解析到。前 300 字上下文: ${fullText.substring(fullText.indexOf('mymindmap'), fullText.indexOf('mymindmap') + 300).replace(/\n/g, '\\n')}`)
          }
        } else {
          // 连 mymindmap 这个词都没有
          // 试试终极兜底：直接在全页文本里找包含 "tool" 字段的 JSON 对象
          // 这是为了应对 DeepSeek 渲染代码块时去掉了 ``` 标记的情况
          console.log('[🧠 Agent] parseToolCalls: 全文无 mymindmap 关键词，尝试终极兜底：搜索含 tool 字段的 JSON 对象...')
          
          // 找所有看起来像工具调用的 JSON（有 "tool" 字段和 "params" 字段）
          const jsonPattern = /\{"tool"\s*:\s*"([^"]+)"[\s\S]*?\}/g
          let jm
          let foundFromJson = 0
          while ((jm = jsonPattern.exec(fullText)) !== null && foundFromJson < 10) {
            try {
              // 尝试找完整的 JSON 对象（平衡大括号）
              let depth = 0
              let end = -1
              for (let i = jm.index; i < fullText.length; i++) {
                if (fullText[i] === '{') depth++
                else if (fullText[i] === '}') {
                  depth--
                  if (depth === 0) { end = i; break }
                }
              }
              if (end > jm.index) {
                const jsonStr = fullText.substring(jm.index, end + 1)
                const obj = JSON.parse(jsonStr)
                const name = obj.tool || obj.name
                const params = obj.params || obj.arguments || obj.args || {}
                if (name && typeof name === 'string' && name.length > 1) {
                  // 校验：必须是合理的工具名（避免误识别其他 JSON）
                  if (/^[a-zA-Z][a-zA-Z0-9_]*$/.test(name) || /^[a-zA-Z][a-zA-Z0-9_]*_[a-zA-Z0-9_]+/.test(name)) {
                    calls.push({ name, params })
                    foundFromJson++
                    console.log(`[🧠 Agent] parseToolCalls: ✅ 终极兜底 JSON 匹配到工具: ${name}`)
                  }
                }
              }
            } catch(e) {
              // 跳过解析失败的
            }
          }
          
          if (calls.length === 0) {
            // 还是没找到，打印调试信息
            const htmlPreview = markdownEl.innerHTML ? markdownEl.innerHTML.substring(0, 500).replace(/\n/g, ' ') : '(无 innerHTML)'
            console.log(`[🧠 Agent] parseToolCalls: ⚠️ 终极兜底也没找到。消息元素 HTML 前 500 字: ${htmlPreview}`)
            // 也看看全页有多少个 code 元素
            const allCodes = document.querySelectorAll('code')
            const allPres = document.querySelectorAll('pre')
            console.log(`[🧠 Agent] parseToolCalls: 全页 pre 元素: ${allPres.length} 个，code 元素: ${allCodes.length} 个`)
          }
        }
      } catch(e) {
        console.log(`[🧠 Agent] parseToolCalls: 全页扫描异常: ${e.message}`)
      }
    }
    
    console.log(`[🧠 Agent] parseToolCalls: 共解析到 ${calls.length} 个工具调用`)
    return calls
  }
  
  function hash(str) {
    let h = 0
    for (let i = 0; i < str.length; i++) {
      h = ((h << 5) - h) + str.charCodeAt(i)
      h |= 0
    }
    return String(h)
  }
  
  // 判断 AI 是否回复完成
  function isAIResponseComplete() {
    try {
      // 方法1：检测生成中停止按钮（正在生成时有 enabled 的停止按钮，生成完后变 disabled 或消失）
      // 原项目的做法：找到 disabled 的停止按钮 + ≥2个操作按钮 = 完成
      const stopBtnDisabled = document.querySelector(
        '.ds-button.ds-button--primary.ds-button--filled.ds-button--circle.ds-button--m.ds-button--icon-relative-m.ds-button--disabled'
      )
      const stopBtnActive = document.querySelector(
        '.ds-button.ds-button--primary.ds-button--filled.ds-button--circle.ds-button--m.ds-button--icon-relative-m:not(.ds-button--disabled)'
      )
      
      // 如果有活跃的停止按钮（未禁用），说明 AI 正在生成，肯定未完成
      if (stopBtnActive) {
        return false
      }
      
      // 方法2：检测最后一条 AI 消息的操作按钮数量（≥2个说明已完成）
      const messages = document.querySelectorAll('.ds-message')
      if (messages.length === 0) return false
      
      // 从后往前找第一条 AI 消息
      let lastAIMsg = null
      for (let i = messages.length - 1; i >= 0; i--) {
        if (!isUserMessage(messages[i])) {
          lastAIMsg = messages[i]
          break
        }
      }
      if (!lastAIMsg) return false
      
      const scope = lastAIMsg.parentElement || lastAIMsg
      const actionButtons = scope.querySelectorAll('[role="button"].ds-button--iconLabelTertiary')
      const btnCount = actionButtons.length
      
      // 原项目判断逻辑：操作按钮≥2 且 停止按钮已禁用 → 完成
      const complete = btnCount >= 2 && !!stopBtnDisabled
      
      return complete
    } catch (err) {
      console.error('[🧠 Agent] isAIResponseComplete: 检测出错:', err.message)
      // 出错时默认认为未完成（更安全，防止流式半截内容被误处理）
      return false
    }
  }
  
  // 稳定性校验相关变量
  let stableTimer = null
  let lastContentHash = ''
  let lastContentFirstSeen = 0 // 当前 hash 首次出现的时间戳（用于兜底判断 AI 是否完成）
  
  // 已处理过的消息节点（避免重复处理，原项目核心机制）
  const processedMessages = new WeakSet()
  
  // 执行中标志位（防止重入）
  let isProcessing = false
  
  // 从消息 DOM 中提取干净文本（剔除工具栏按钮文字，原项目做法）
  function getCleanText(markdownEl) {
    if (!markdownEl) return ''
    // 克隆节点并移除可能的工具栏/按钮元素，避免"复制""下载"等按钮文字污染内容
    const clone = markdownEl.cloneNode(true)
    const selectorsToRemove = [
      'button', '[role="button"]',
      '[class*="toolbar"]', '[class*="copy"]', '[class*="download"]',
      '[class*="code-block-header"]', '[class*="code-block-banner"]',
      '[class*="action"]', '[class*="header"]'
    ]
    selectorsToRemove.forEach(sel => {
      try { clone.querySelectorAll(sel).forEach(el => el.remove()) } catch(e) {}
    })
    return (clone.textContent || clone.innerText || '').trim()
  }
  
  function checkForToolCalls(isManual = false) {
    // 快速路径：AI 正在生成中 → 直接跳过（节省大量 DOM 查询）
    if (!isManual) {
      const isGenerating = document.querySelector(
        '.ds-button.ds-button--primary.ds-button--filled.ds-button--circle.ds-button--m.ds-button--icon-relative-m:not(.ds-button--disabled)'
      )
      if (isGenerating) return
    }
    
    console.log(`[🧠 Agent] checkForToolCalls: 开始检查，isManual=${isManual}`)
    
    // 防重入：正在处理中不重复触发
    if (!isManual && isProcessing) {
      console.log('[🧠 Agent] checkForToolCalls: 正在处理中，跳过')
      return
    }
    
    // 防循环：发送消息后 3 秒内不自动扫描（防止扫到自己刚发的内容）
    if (!isManual) {
      const timeSinceSend = Date.now() - state.lastSendTime
      if (timeSinceSend < 3000) {
        console.log(`[🧠 Agent] checkForToolCalls: 发送冷却中（${timeSinceSend}ms < 3000ms），跳过`)
        return
      }
    }
    
    const messages = document.querySelectorAll('.ds-message')
    if (messages.length === 0) {
      if (isManual) {
        addSystemLog('扫描', '未找到任何 AI 消息', 'warning')
        showToast('未找到 AI 消息')
      }
      return
    }
    
    // 从后往前找第一条有实际内容的 AI 消息
    let lastMessage = null
    let markdownEl = null
    let scannedCount = 0
    let userMsgCount = 0
    let emptyMsgCount = 0
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]
      scannedCount++
      if (isUserMessage(msg)) { userMsgCount++; continue }
      const md = msg.querySelector(':scope > .ds-markdown')
      if (md && (md.textContent || '').trim().length > 0) {
        lastMessage = msg
        markdownEl = md
        break
      }
      emptyMsgCount++
    }
    
    // 手动扫描时输出诊断信息
    if (isManual) {
      const diag = `共${messages.length}条消息，扫描${scannedCount}条，用户消息${userMsgCount}条，无内容${emptyMsgCount}条`
      console.log(`[🧠 Agent] 扫描诊断: ${diag}`)
      if (markdownEl) {
        const t = getCleanText(markdownEl)
        console.log(`[🧠 Agent] 扫描诊断: 找到消息，长度 ${t.length}，前100字: ${t.substring(0, 100)}`)
      }
    }
    
    if (!markdownEl) {
      if (isManual) {
        addSystemLog('扫描', '未找到有内容的 AI 消息', 'warning')
        showToast('未找到 AI 消息')
      }
      return
    }
    
    const text = getCleanText(markdownEl)
    if (text.length < 30 && !isManual) {
      return
    }
    
    // 非手动模式下，先判断 AI 回复是否完成
    if (!isManual) {
      const complete = isAIResponseComplete()
      if (!complete) {
        // 兜底：如果内容已经稳定了 5 秒以上，认为 AI 已经完成（防止选择器失效）
        const stableTime = lastContentHash === h ? (Date.now() - lastContentFirstSeen) : 0
        if (stableTime < 5000) {
          console.log(`[🧠 Agent] checkForToolCalls: AI 回复尚未完成（UI未检测到完成，稳定${stableTime}ms < 5000ms），跳过`)
          return
        }
        console.log(`[🧠 Agent] checkForToolCalls: UI未检测到完成，但内容已稳定${stableTime}ms，兜底认为已完成`)
      }
    }
    
    const h = hash(text)
    
    // 非手动模式下，稳定性校验：内容 800ms 内没变化才认为稳定
    if (!isManual) {
      if (h === state.lastAIMessage) {
        return
      }
      
      // 如果内容有变化，重置稳定计时器
      if (h !== lastContentHash) {
        lastContentHash = h
        lastContentFirstSeen = Date.now()
        if (stableTimer) clearTimeout(stableTimer)
        stableTimer = setTimeout(() => {
          stableTimer = null
          state.lastAIMessage = h
          processedMessages.add(lastMessage)  // 标记为已处理
          isProcessing = true
          try {
            processToolCalls(markdownEl, text, false)
          } finally {
            isProcessing = false
          }
        }, 800)
        return
      }
      
      // 内容 hash 没变但还在等待稳定中，跳过
      if (stableTimer) return
    }
    
    // 手动模式直接处理
    if (isManual) {
      state.lastAIMessage = h
      processedMessages.add(lastMessage)
      isProcessing = true
      try {
        processToolCalls(markdownEl, text, true)
      } finally {
        isProcessing = false
      }
    }
  }
  
  function processToolCalls(markdownEl, text, isManual) {
    console.log(`[🧠 Agent] processToolCalls: 开始处理，内容长度: ${text.length}, isManual=${isManual}`)
    
    // 自动检测并保存 markdown 总结
    saveSummaryFromAIMessage(markdownEl, text)
    
    if (isManual) {
      addSystemLog('扫描', `最新消息长度: ${text.length} 字`, 'info')
      console.log('[🧠 Agent] processToolCalls: 最新消息内容前300字:', text.substring(0, 300))
    }
    
    const calls = parseToolCalls(markdownEl)
    
    if (isManual) {
      addSystemLog('扫描', `解析到 ${calls.length} 个 mymindmap 工具调用`, calls.length > 0 ? 'success' : 'warning')
      showToast(calls.length > 0 ? `找到 ${calls.length} 个工具调用，立即执行` : '未找到工具调用')
    }
    
    if (calls.length === 0) {
      console.log('[🧠 Agent] processToolCalls: 未解析到工具调用')
      return
    }
    
    let newCalls = 0
    for (const call of calls) {
      const callHash = hash(call.name + JSON.stringify(call.params))
      // 手动扫描模式下，跳过已检测检查（强制重新执行）
      if (!isManual && state.detectedHashes.has(callHash)) {
        console.log(`[🧠 Agent] processToolCalls: 跳过已检测过的工具: ${call.name}`)
        continue
      }
      state.detectedHashes.add(callHash)
      
      const id = state.nextId++
      const tc = { id, name: call.name, params: call.params, status: 'pending' }
      state.toolCalls.push(tc)
      newCalls++
      console.log(`[🧠 Agent] processToolCalls: ✅ 检测到新的 mymindmap 工具调用: ${call.name}`)
    }
    
    if (newCalls > 0) {
      console.log(`[🧠 Agent] processToolCalls: 共发现 ${newCalls} 个新工具调用`)
      renderLogPanel()
      updateLogBadge()
      updateStatus(`检测到 ${newCalls} 个工具调用`, 'running')
      if (!isManual) {
        showToast(`检测到 ${newCalls} 个工具调用`)
      }
      
      // 手动扫描或自动运行模式下，立即执行第一个待处理工具
      if (isManual || state.isAutoRunning) {
        setTimeout(() => {
          const pending = state.toolCalls.filter(t => t.status === 'pending' && !t.isSystem)
          if (pending.length > 0) {
            console.log(`[🧠 Agent] processToolCalls: 立即执行第一个待处理工具: ${pending[0].name}`)
            executeTool(pending[0].id)
          }
        }, 300)
      }
    } else {
      console.log('[🧠 Agent] processToolCalls: 没有新的工具调用（全部已检测过）')
      if (isManual) {
        addSystemLog('扫描', '没有新的工具调用（可能已执行过）', 'warning')
      }
    }
  }
  
  // 暴露手动扫描函数
  window.__agent_scan__ = () => checkForToolCalls(true)
  
  const observer = new MutationObserver(scheduleCheck)
  observer.observe(document.body, {
    childList: true,
    subtree: true
    // 不监听 characterData：AI 流式输出时字符变化极频繁，只靠子节点变化+轮询足够
    // 这样可以大幅减少 MutationObserver 的触发次数
  })
  
  // 降低轮询频率，减少误触发
  const pollTimer = setInterval(checkForToolCalls, 4000)
  
  // 页面卸载时清理，防止内存泄漏（多次导航后累积）
  window.addEventListener('beforeunload', () => {
    observer.disconnect()
    clearInterval(pollTimer)
    if (checkTimer) clearTimeout(checkTimer)
    if (stableTimer) clearTimeout(stableTimer)
    isProcessing = false
  }, { once: true })
}

// ========== 执行工具 ==========
const TOOL_EXECUTE_TIMEOUT = 30000 // 工具执行超时 30 秒

function executeTool(toolId) {
  const tc = state.toolCalls.find(t => t.id === toolId)
  if (!tc || tc.status !== 'pending') return
  
  // 执行前检查：如果自动执行已关闭，跳过
  if (!state.isAutoRunning) {
    console.log('[🧠 Agent] 自动执行已关闭，跳过工具:', tc.name)
    tc.status = 'skipped'
    renderLogPanel()
    updateLogBadge()
    return
  }

  // 🛡️ 初始化阶段硬拦截：用户还没说过话时，禁止执行修改类工具
  // 防止 AI 在自我介绍阶段就自作主张修改导图
  const userMsgCount = countUserMessages()
  const isWriteTool = WRITE_TOOLS.has(tc.name)
  if (userMsgCount === 0 && isWriteTool) {
    const warnMsg = `初始化阶段拦截：用户尚未发送任何消息，禁止执行修改类工具「${tc.name}」。请等待用户明确提出需求后再操作。`
    console.warn('[🧠 Agent]', warnMsg)
    tc.status = 'blocked'
    tc.error = warnMsg
    updateStatus(`${tc.name} 已拦截`, 'warning')
    renderLogPanel()
    updateLogBadge()
    addSystemLog('已拦截', `初始化阶段禁止修改：${tc.name}`, 'warning')
    // 回传给 AI，明确告知被拦截的原因
    sendResultToAI(tc.name, null, warnMsg)
    return
  }
  
  tc.status = 'running'
  updateStatus(`执行中: ${tc.name}`, 'running')
  renderLogPanel()
  updateLogBadge()
  
  console.log('[🧠 Agent] 执行工具:', tc.name, tc.params)
  
  // 设置超时保护（30秒没回来就认为失败，防止队列死锁）
  tc._timeoutId = setTimeout(() => {
    const currentTc = state.toolCalls.find(t => t.id === toolId)
    if (currentTc && currentTc.status === 'running') {
      currentTc.status = 'error'
      currentTc.error = `工具执行超时（${TOOL_EXECUTE_TIMEOUT/1000}秒），可能是操作太复杂或无响应`
      updateStatus(`${tc.name} 超时`, 'error')
      renderLogPanel()
      updateLogBadge()
      addSystemLog('超时', `${tc.name} 执行超时，已自动跳过`, 'error')
      
      // 超时也回传给 AI
      if (state.isAutoRunning) {
        sendResultToAI(tc.name, null, currentTc.error)
      }
    }
  }, TOOL_EXECUTE_TIMEOUT)
  
  ipcRenderer.send('deepseek:execute-tool', {
    toolId: tc.id,
    name: tc.name,
    params: tc.params
  })
}

// ========== 结果回传给 AI ==========
async function sendResultToAI(toolName, result, error = null) {
  let resultText
  if (error) {
    resultText = `工具 ${toolName} 执行失败：

\`\`\`
${error}
\`\`\`

请检查参数是否正确，或尝试其他方式继续。**注意：只有在用户明确有需求时才继续调用工具，不要主动操作。**`
  } else {
    resultText = `工具 ${toolName} 执行结果：

\`\`\`json
${JSON.stringify(result, null, 2)}
\`\`\`

以上是工具执行结果。请根据用户的实际需求决定下一步：如果用户的需求已经满足，直接总结说明即可；如果确实还需要调用工具才能完成用户需求，再继续输出 mymindmap 代码块。**注意：一次消息最多输出 2 个工具调用，太多会触发频率限制。不要主动做用户没要求的事。**`
  }

  // 使用发送队列（自动限流，防止触发 DeepSeek 频率限制）
  enqueueSend(resultText).then((success) => {
    if (success) {
      console.log('[🧠 Agent] 结果已自动回传给 AI')
    } else {
      console.warn('[🧠 Agent] 结果回传 AI 失败')
      addSystemLog('回传失败', `${toolName} 结果未能自动发送给 AI，请手动复制`, 'error')
    }
  })
  
  // 无论发送成功失败，都尝试继续执行下一个待处理工具（防止队列卡住）
  // 注意：发送是异步排队的，但工具执行是串行的，所以这里可以立即开始下一个工具
  // 下一个工具执行完成时，结果会追加到发送队列尾部，自然形成间隔
  setTimeout(() => {
    const pending = state.toolCalls.filter(t => t.status === 'pending' && !t.isSystem)
    if (pending.length > 0 && state.isAutoRunning) {
      executeTool(pending[0].id)
    } else if (pending.length === 0) {
      updateStatus('就绪', '')
    }
  }, 1000)
}

// ========== 输入框操作 ==========
async function injectAndSend(text) {
  console.log(`[🧠 Agent] injectAndSend 开始，文本长度: ${text.length}`)
  
  const input = findInput()
  if (!input) {
    console.warn('[🧠 Agent] injectAndSend: 未找到输入框')
    addSystemLog('发送失败', '未找到输入框，请检查元素捕获配置', 'error')
    showToast('未找到输入框')
    return false
  }
  console.log(`[🧠 Agent] injectAndSend: 找到输入框，tag=${input.tagName}, class=${input.className?.substring?.(0, 50) || 'N/A'}`)
  
  input.focus()
  console.log('[🧠 Agent] injectAndSend: 输入框已聚焦')
  
  let setSuccess = false
  
  if (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT') {
    // React 兼容：使用原生 value setter
    try {
      const proto = input.tagName === 'TEXTAREA'
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype
      const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value').set
      nativeSetter.call(input, text)
      input.dispatchEvent(new Event('input', { bubbles: true }))
      setSuccess = true
      console.log('[🧠 Agent] injectAndSend: 使用 nativeSetter 方式设置 textarea/input 内容成功')
    } catch (err) {
      console.error('[🧠 Agent] injectAndSend: nativeSetter 方式失败，回退到直接赋值:', err.message)
      input.value = text
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
      setSuccess = true
    }
  } else if (input.isContentEditable || input.getAttribute('contenteditable') === 'true') {
    // contenteditable：使用 execCommand('insertText')
    try {
      document.execCommand('selectAll', false, null)
      document.execCommand('insertText', false, text)
      setSuccess = true
      console.log('[🧠 Agent] injectAndSend: 使用 execCommand insertText 方式设置 contenteditable 内容成功')
    } catch (err) {
      console.error('[🧠 Agent] injectAndSend: execCommand 方式失败:', err.message)
    }
  }
  
  if (!setSuccess) {
    console.warn('[🧠 Agent] injectAndSend: 内容填入失败')
    addSystemLog('发送失败', '内容填入失败', 'error')
    return false
  }
  
  const delay = randomDelay()
  console.log(`[🧠 Agent] injectAndSend: 内容已填入，等待 ${delay}ms 后发送...`)
  await sleep(delay)
  
  // 发送：优先点击发送按钮，兜底模拟 Enter 键
  const sendBtn = findSendButton()
  if (sendBtn) {
    console.log('[🧠 Agent] injectAndSend: 找到发送按钮，执行点击')
    sendBtn.click()
    console.log('[🧠 Agent] injectAndSend: 发送按钮点击完成')
    state.lastSendTime = Date.now()
    state.isSendingMessage = true
    setTimeout(() => { state.isSendingMessage = false }, 3000)
    return true
  }
  
  console.log('[🧠 Agent] injectAndSend: 未找到发送按钮，尝试模拟 Enter 键')
  if (input) {
    const opts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true, isComposing: false }
    input.dispatchEvent(new KeyboardEvent('keydown', opts))
    input.dispatchEvent(new KeyboardEvent('keypress', opts))
    input.dispatchEvent(new KeyboardEvent('keyup', opts))
    console.log('[🧠 Agent] injectAndSend: 已通过 Enter 键序列触发发送')
    state.lastSendTime = Date.now()
    state.isSendingMessage = true
    setTimeout(() => { state.isSendingMessage = false }, 3000)
    return true
  }
  
  addSystemLog('发送失败', '未找到可用的发送按钮，内容已填入请手动发送', 'error')
  showToast('已填入内容，请按发送')
  return false
}

function findInput() {
  // 优先使用手动捕获的选择器
  if (state.manualInputSelector) {
    try {
      const el = document.querySelector(state.manualInputSelector)
      if (el && el.offsetWidth > 0 && el.offsetHeight > 0) {
        console.log(`[🧠 Agent] findInput: 使用手动选择器成功: ${state.manualInputSelector}`)
        return el
      } else {
        console.log(`[🧠 Agent] findInput: 手动选择器未找到可见元素: ${state.manualInputSelector}`)
        addSystemLog('查找输入框', `手动选择器未找到元素，已自动降级: ${state.manualInputSelector}`, 'warning')
      }
    } catch(e) {
      console.error('[🧠 Agent] findInput: 手动选择器错误:', e.message)
      addSystemLog('查找输入框', `选择器错误: ${e.message}`, 'error')
    }
  }
  
  const selectors = [
    'textarea[placeholder*="message"]',
    'textarea[placeholder*="Message"]',
    'textarea[placeholder*="输入"]',
    'textarea[placeholder*="输入消息"]',
    'textarea[placeholder*="ask"]',
    'textarea[placeholder*="Ask"]',
    'textarea[placeholder*="提问"]',
    'textarea[placeholder*="发送"]',
    'textarea[placeholder*="send"]',
    'textarea[placeholder*="deepseek"]',
    'textarea[placeholder*="DeepSeek"]',
    'textarea.chat-input',
    'textarea',
    'div[contenteditable="true"]',
    '[role="textbox"]',
  ]
  
  for (const sel of selectors) {
    try {
      const el = document.querySelector(sel)
      if (el && el.offsetWidth > 0 && el.offsetHeight > 0) {
        console.log(`[🧠 Agent] findInput: 通过选择器 "${sel}" 找到输入框，tag=${el.tagName}`)
        return el
      }
    } catch(e) {}
  }
  
  console.log('[🧠 Agent] findInput: 未找到任何可见输入框')
  return null
}

function findSendButton() {
  // 优先使用手动捕获的选择器
  if (state.manualSendSelector) {
    try {
      const el = document.querySelector(state.manualSendSelector)
      if (el) {
        // 如果找到的不是 button，向上找最近的可点击元素
        let btn = el.tagName === 'BUTTON' || el.tagName === 'A' || el.getAttribute('role') === 'button'
          ? el
          : el.closest('button, a, [role="button"], [data-action], .btn, .ds-button')
        if (btn && btn.offsetWidth > 0 && btn.offsetHeight > 0 && !btn.disabled) {
          console.log(`[🧠 Agent] findSendButton: 使用手动选择器成功: ${state.manualSendSelector}`)
          return btn
        }
      }
      console.log(`[🧠 Agent] findSendButton: 手动选择器未找到可用按钮: ${state.manualSendSelector}`)
      addSystemLog('查找发送按钮', `手动选择器失效，已自动降级: ${state.manualSendSelector}`, 'warning')
    } catch(e) {
      console.error('[🧠 Agent] findSendButton: 手动选择器错误:', e.message)
    }
  }
  
  // DeepSeek 发送按钮定位策略：
  // 1. 先找输入框所在的容器，在容器附近找 button
  const input = findInput()
  if (input) {
    // 从输入框向上找工具栏/发送区域容器
    let container = input.parentElement
    for (let i = 0; i < 5 && container; i++) {
      // 在容器内找主要按钮
      const btns = container.querySelectorAll('button.ds-button--primary, button[type="submit"], button[aria-label*="send" i], button[aria-label*="发送"]')
      for (const btn of btns) {
        if (btn.offsetWidth > 0 && btn.offsetHeight > 0 && !btn.disabled) {
          console.log('[🧠 Agent] findSendButton: 通过输入框容器找到发送按钮')
          return btn
        }
      }
      container = container.parentElement
    }
  }
  
  const selectors = [
    // DeepSeek 特有的按钮类名
    'button.ds-button--primary[type="submit"]',
    'button.ds-button--primary.ds-button--filled',
    '.ds-input-area button.ds-button--primary',
    '.chat-input-area button[type="submit"]',
    // 通用的发送按钮
    'button[type="submit"]',
    'button[aria-label*="send" i]',
    'button[aria-label*="发送"]',
    'button[title*="send" i]',
    'button[title*="发送"]',
    'button[data-action="send"]',
    'button[data-type="send"]',
    '.send-btn',
    '.submit-btn',
    '[data-testid="send"]',
    '[data-testid="send-button"]',
  ]
  
  for (const sel of selectors) {
    try {
      const btn = document.querySelector(sel)
      if (btn && btn.offsetWidth > 0 && btn.offsetHeight > 0 && !btn.disabled) {
        console.log(`[🧠 Agent] findSendButton: 通过选择器 "${sel}" 找到发送按钮`)
        return btn
      }
    } catch(e) {}
  }
  
  console.log('[🧠 Agent] findSendButton: 未找到可见且可用的发送按钮')
  return null
}

// ========== 工具函数 ==========
function escapeHtml(text) {
  const div = document.createElement('div')
  div.textContent = String(text ?? '')
  return div.innerHTML
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// 随机延迟（在设定范围内取随机值）
function randomDelay() {
  const min = state.sendDelayMin || 800
  const max = state.sendDelayMax || 1500
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function showToast(msg) {
  const toast = document.createElement('div')
  toast.className = 'mma-toast'
  toast.textContent = msg
  document.body.appendChild(toast)
  
  setTimeout(() => {
    toast.style.animation = 'mma-toast-out 0.25s ease forwards'
    setTimeout(() => toast.remove(), 250)
  }, 2000)
}

// 添加系统日志
function addSystemLog(title, content, type = 'info') {
  const id = state.nextId++
  state.toolCalls.unshift({
    id,
    name: title,
    params: { message: content },
    status: type === 'error' ? 'error' : type === 'success' ? 'done' : 'log', // info 用 log 状态，不是 pending
    result: type === 'error' ? content : '',
    error: type === 'error' ? content : '',
    isSystem: true,
    systemType: type
  })
  // 限制日志条数
  if (state.toolCalls.length > 100) {
    state.toolCalls = state.toolCalls.slice(0, 100)
  }
  try { renderLogPanel() } catch(e) {}
  try { updateLogBadge() } catch(e) {}
}

// 生成元素的唯一 CSS 选择器
function getUniqueSelector(el) {
  if (!(el instanceof Element)) return ''
  
  // 优先用 id
  if (el.id) return '#' + el.id
  
  // 优先用 class
  if (el.className && typeof el.className === 'string') {
    const classes = el.className.trim().split(/\s+/).filter(c => c && !c.startsWith('mma-'))
    if (classes.length > 0) {
      const classSel = el.tagName.toLowerCase() + '.' + classes.slice(0, 3).join('.')
      try {
        if (document.querySelectorAll(classSel).length === 1) return classSel
      } catch(e) {}
    }
  }
  
  // 用属性
  const attrs = ['data-testid', 'aria-label', 'name', 'type', 'role']
  for (const attr of attrs) {
    const val = el.getAttribute(attr)
    if (val) {
      const attrSel = `${el.tagName.toLowerCase()}[${attr}="${val}"]`
      try {
        if (document.querySelectorAll(attrSel).length === 1) return attrSel
      } catch(e) {}
    }
  }
  
  // 用父元素 + nth-child
  const parent = el.parentElement
  if (parent) {
    const siblings = Array.from(parent.children)
    const index = siblings.indexOf(el) + 1
    const parentSel = getUniqueSelector(parent)
    return `${parentSel} > ${el.tagName.toLowerCase()}:nth-child(${index})`
  }
  
  return el.tagName.toLowerCase()
}

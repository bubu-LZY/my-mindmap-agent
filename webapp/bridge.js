/*
 * 在线演示（GitHub Pages）专用桥接层。
 *
 * 桌面版由 electron/preload.js 通过 contextBridge 注入 window.electronAPI；浏览器里没有主进程，
 * 文件树、打开/保存、AI 请求全部会因缺少 electronAPI 而退化，页面只能停在欢迎页。
 *
 * 这里按 electron/preload.js + electron/ipc/fileManager.js 的真实契约实现同一套 API
 * （同名方法、同参数、同返回结构），底层换成 localStorage 里的虚拟文件系统，
 * 于是在线版跑的是同一份前端代码、同一套界面与交互，而不是另做一份仿制品。
 *
 * 只实现"离线能跑通"的部分：
 *   - 已实现：默认保存目录、文件树 listDir/exists、打开 readFile/openFile、保存 writeFile/saveFile、
 *             新建/重命名/删除/移动、复制粘贴所需的读写、示例数据
 *   - 仅作展示：AI 对话返回固定文案（不发起真实请求）；更新/三方集成/云盘/MCP/OCR 等依赖主进程
 *              或凭据的能力不在此定义，前端自身的 `window.electronAPI?.xxx` 守卫会提示或忽略
 *
 * 在 Electron 中运行时 window.electronAPI 已存在，本文件立即返回，不做任何事。
 */
(function () {
  if (typeof window === 'undefined') return
  if (window.electronAPI) return

  var ROOT = '/我的mindmap'
  var LS_KEY = 'MM_WEB_DEMO_FS_V1'
  var MAX_VERSIONS = 0 // 在线演示不做版本快照

  /* ============================================================
   * 路径工具（与主进程的 path 行为保持一致：\ 与 / 等价，根目录外不可访问）
   * ============================================================ */
  var normalize = function (p) {
    var s = String(p == null ? '' : p).replace(/\\/g, '/')
    s = s.replace(/\/{2,}/g, '/')
    if (s.length > 1) s = s.replace(/\/+$/, '')
    return s
  }
  var basename = function (p) {
    var s = normalize(p)
    var i = s.lastIndexOf('/')
    return i < 0 ? s : s.slice(i + 1)
  }
  var dirname = function (p) {
    var s = normalize(p)
    var i = s.lastIndexOf('/')
    if (i < 0) return ''
    return i === 0 ? '/' : s.slice(0, i)
  }
  var join = function (dir, name) {
    var d = normalize(dir)
    return d === '/' ? '/' + name : d + '/' + name
  }
  var isUnderRoot = function (p) {
    var s = normalize(p)
    return s === ROOT || s.indexOf(ROOT + '/') === 0
  }
  // 与 fileManager.js 的 isSupportFile 保持一致：目录树里可见的文件类型
  var isSupportFile = function (name) {
    return /\.(smm|md|json|pdf|docx|pptx|xlsx|xls|csv|tsv|txt|log|html|xml)$/i.test(name)
  }

  /* ============================================================
   * 虚拟文件系统（localStorage 持久化，刷新后编辑不丢）
   * ============================================================ */
  var vfs = null

  var saveVfs = function () {
    try { localStorage.setItem(LS_KEY, JSON.stringify(vfs)) } catch (e) { /* 容量超限忽略 */ }
  }
  var loadVfs = function () {
    try {
      var raw = localStorage.getItem(LS_KEY)
      if (raw) {
        var parsed = JSON.parse(raw)
        if (parsed && parsed.files && parsed.dirs) {
          parsed.binaries = parsed.binaries || {}
          parsed.mtime = parsed.mtime || {}
          return parsed
        }
      }
    } catch (e) { /* 损坏则重建 */ }
    return null
  }

  var uidSeq = 0
  var makeUid = function () { return 'demo-' + Date.now().toString(36) + '-' + (uidSeq++) }
  var esc = function (s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }
  var node = function (text) {
    return { data: { text: '<p><span>' + esc(text) + '</span></p>', uid: makeUid(), richText: true }, children: [] }
  }
  // 缩进文本 → 真实 .smm 树（与主进程写入的 { data:{text,uid,richText}, children } 结构一致）
  var outlineToSmm = function (title, outline) {
    var root = node(title)
    var stack = [{ level: -1, node: root }]
    outline.split('\n').forEach(function (raw) {
      if (!raw.trim()) return
      var indent = raw.match(/^[ \t]*/)[0].replace(/\t/g, '  ').length
      var level = Math.floor(indent / 2)
      var text = raw.trim().replace(/^[-*]\s*/, '')
      if (!text) return
      var n = node(text)
      while (stack.length > 1 && stack[stack.length - 1].level >= level) stack.pop()
      stack[stack.length - 1].node.children.push(n)
      stack.push({ level: level, node: n })
    })
    return JSON.stringify(root, null, 2)
  }

  var SEED = [
    {
      path: ROOT + '/计算机基础/计算机网络基础.smm',
      title: '计算机网络基础',
      outline: [
        '- OSI 七层模型',
        '  - 物理层',
        '    - 比特流传输',
        '    - 电气特性',
        '  - 数据链路层',
        '    - 帧封装与差错控制',
        '  - 网络层',
        '    - IP 路由与分组转发',
        '  - 传输层',
        '    - TCP 可靠传输',
        '    - UDP 无连接',
        '- TCP/IP 协议簇',
        '  - 三次握手建立连接',
        '  - 四次挥手释放连接',
        '  - 滑动窗口流量控制',
        '- 应用层协议',
        '  - HTTP/HTTPS',
        '  - DNS 域名解析'
      ].join('\n')
    },
    {
      path: ROOT + '/计算机基础/操作系统原理.smm',
      title: '操作系统原理',
      outline: [
        '- 进程管理',
        '  - 进程与线程',
        '    - PCB 进程控制块',
        '  - 进程调度算法',
        '    - 先来先服务 FCFS',
        '    - 时间片轮转 RR',
        '    - 多级反馈队列',
        '  - 进程同步与互斥',
        '    - 信号量 PV 操作',
        '- 内存管理',
        '  - 分页存储管理',
        '    - 页表与快表 TLB',
        '  - 虚拟内存',
        '- 文件系统',
        '  - 文件存储结构',
        '  - 磁盘调度算法'
      ].join('\n')
    },
    {
      path: ROOT + '/读书笔记/深度工作.smm',
      title: '《深度工作》读书笔记',
      outline: [
        '- 核心观点',
        '  - 深度工作 = 高质量产出',
        '  - 浮浅工作 = 低价值消耗',
        '- 实践方法',
        '  - 专注时间排程',
        '  - 远离社交媒体',
        '  - 拒绝无效会议',
        '- 个人启发',
        '  - 用 AI 把杂事自动化',
        '  - 留大块时间给深度工作'
      ].join('\n')
    }
  ]

  var SEED_DOCS = [
    {
      path: ROOT + '/读书笔记/深度工作-摘要.md',
      content: [
        '# 《深度工作》摘要',
        '',
        '## 核心观点',
        '',
        '深度工作指在无干扰状态下专注进行的职业活动，能把认知能力推向极限，',
        '创造新价值、提升技能且难以复制。浮浅工作则是事务性、易被打断的消耗。',
        '',
        '## 实践方法',
        '',
        '- 固定专注时间块，把深度工作排进日程',
        '- 主动减少社交媒体与即时消息的干扰',
        '- 拒绝无明确议题的会议',
        '',
        '> 本文件用于演示「文档查看器」视图：Markdown 可原样阅读，也可在空白处右键让 AI 转成思维导图。'
      ].join('\n')
    }
  ]

  var buildSeed = function () {
    var files = {}
    var dirs = [ROOT, ROOT + '/计算机基础', ROOT + '/读书笔记']
    var mtime = {}
    var now = Date.now()
    SEED.forEach(function (item, i) {
      files[item.path] = outlineToSmm(item.title, item.outline)
      mtime[item.path] = now - i * 60000
    })
    SEED_DOCS.forEach(function (item) {
      files[item.path] = item.content
      mtime[item.path] = now
    })
    return { files: files, dirs: dirs, binaries: {}, mtime: mtime }
  }

  var ensureVfs = function () {
    if (vfs) return
    vfs = loadVfs()
    if (!vfs) {
      vfs = buildSeed()
      saveVfs()
    }
    if (vfs.dirs.indexOf(ROOT) < 0) vfs.dirs.push(ROOT)
  }

  var ensureDirChain = function (filePath) {
    var dir = dirname(filePath)
    if (dir && vfs.dirs.indexOf(dir) < 0) vfs.dirs.push(dir)
  }

  var exists = function (p) {
    ensureVfs()
    var s = normalize(p)
    return Object.prototype.hasOwnProperty.call(vfs.files, s) || vfs.dirs.indexOf(s) >= 0
  }

  // 同名时自动改名（与主进程 uniquePath 行为一致：a.smm → a (1).smm）
  var uniquePath = function (filePath) {
    var dir = dirname(filePath)
    var base = basename(filePath)
    var dot = base.lastIndexOf('.')
    var stem = dot > 0 ? base.slice(0, dot) : base
    var ext = dot > 0 ? base.slice(dot) : ''
    var candidate = filePath
    var i = 1
    while (exists(candidate)) {
      candidate = join(dir, stem + ' (' + i + ')' + ext)
      i++
    }
    return candidate
  }

  var listDir = function (dirPath) {
    ensureVfs()
    var d = normalize(dirPath)
    if (!isUnderRoot(d)) return []
    var dirsOut = []
    var filesOut = []
    var seen = {}
    var push = function (name, isDir, full) {
      if (!name || name.charAt(0) === '.' || seen[name]) return
      seen[name] = true
      if (isDir) {
        dirsOut.push({ name: name, path: full, isDir: true })
      } else if (isSupportFile(name)) {
        filesOut.push({ name: name, path: full, isDir: false, mtime: vfs.mtime[full] || Date.now() })
      }
    }
    Object.keys(vfs.files).forEach(function (p) {
      if (dirname(p) === d) push(basename(p), false, p)
    })
    vfs.dirs.forEach(function (p) {
      if (p !== d && dirname(p) === d) push(basename(p), true, p)
    })
    var byName = function (a, b) { return a.name.localeCompare(b.name, 'zh-CN') }
    // 与主进程一致：文件在前，文件夹在后
    return filesOut.sort(byName).concat(dirsOut.sort(byName))
  }

  var readText = function (filePath) {
    ensureVfs()
    var s = normalize(filePath)
    if (!exists(s)) throw new Error('文件不存在: ' + s)
    return vfs.files[s] == null ? '' : vfs.files[s]
  }

  var writeText = function (filePath, content) {
    ensureVfs()
    var s = normalize(filePath)
    if (!isUnderRoot(s)) throw new Error('在线演示版只允许写入演示目录 ' + ROOT)
    ensureDirChain(s)
    vfs.files[s] = typeof content === 'string' ? content : JSON.stringify(content, null, 2)
    vfs.mtime[s] = Date.now()
    saveVfs()
    return true
  }

  var removePath = function (p) {
    ensureVfs()
    var s = normalize(p)
    if (vfs.files[s] != null) {
      delete vfs.files[s]
      delete vfs.mtime[s]
    }
    vfs.dirs = vfs.dirs.filter(function (d) { return d !== s && d.indexOf(s + '/') !== 0 })
    Object.keys(vfs.files).forEach(function (f) {
      if (f.indexOf(s + '/') === 0) { delete vfs.files[f]; delete vfs.mtime[f] }
    })
    saveVfs()
    return true
  }

  /* ============================================================
   * electronAPI：文件管理（旧接口，preload.js 顶层）
   * ============================================================ */
  var api = {}

  api.getPathForFile = function () { return '' }

  api.legacyStorageRead = function () { return null }

  api.openExternal = function (url) {
    try { window.open(String(url), '_blank', 'noopener,noreferrer') } catch (e) { /* 忽略 */ }
    return true
  }

  api.openDevTools = function () { return false }

  api.restartApp = function () {
    window.location.reload()
    return true
  }

  // 与 fileManager.js 的 save-file 一致：绝对路径按原样、相对路径落到默认保存目录；
  // 未开启 overwrite 且已存在时自动改名；返回 { success, filePath }
  api.saveFile = function (filename, data, opts) {
    try {
      var target = normalize(filename)
      if (target.charAt(0) !== '/') target = join(ROOT, basename(target))
      if (!(opts && opts.overwrite) && exists(target)) target = uniquePath(target)
      writeText(target, data)
      return Promise.resolve({ success: true, filePath: target })
    } catch (e) {
      return Promise.resolve({ success: false, error: e.message })
    }
  }

  api.saveBinaryFile = function (filename, base64) {
    try {
      ensureVfs()
      var target = normalize(filename)
      if (target.charAt(0) !== '/') target = join(ROOT, basename(target))
      if (exists(target)) target = uniquePath(target)
      vfs.binaries[target] = String(base64 || '').replace(/^data:[^;]+;base64,/, '')
      vfs.mtime[target] = Date.now()
      ensureDirChain(target)
      saveVfs()
      return Promise.resolve({ success: true, filePath: target })
    } catch (e) {
      return Promise.resolve({ success: false, error: e.message })
    }
  }

  // 与 fileManager.js 的 open-file 一致：文本文件返回 { success, data, isMarkdown, fileName }
  api.openFile = function (filePath) {
    try {
      var s = normalize(filePath)
      var content = readText(s)
      var ext = (basename(s).split('.').pop() || '').toLowerCase()
      if (ext === 'md' || ext === 'markdown') {
        return Promise.resolve({ success: true, data: content, isMarkdown: true, isXmind: false, fileName: basename(s) })
      }
      var data
      try { data = JSON.parse(content) } catch (e) { data = content }
      return Promise.resolve({ success: true, data: data, isMarkdown: false, isXmind: false, fileName: basename(s) })
    } catch (e) {
      return Promise.resolve({ success: false, error: e.message })
    }
  }

  // 在线演示没有系统文件选择框：交给用户直接用左侧文件树的「新建/导入」
  api.selectFile = function () {
    return Promise.resolve({ success: false, canceled: true })
  }

  api.printToPdf = function () {
    return Promise.resolve({ success: false, error: '在线演示版不支持导出 PDF' })
  }

  api.listFiles = function () {
    var files = listDir(ROOT).filter(function (i) { return !i.isDir }).map(function (i) {
      return { name: i.name, path: i.path, mtime: i.mtime }
    })
    return Promise.resolve({ success: true, files: files })
  }

  api.onOpenFile = function () { return function () {} }

  api.getDefaultSaveDir = function () { return Promise.resolve(ROOT) }

  api.listFileVersions = function () { return Promise.resolve([]) }
  api.restoreFileVersion = function () { return Promise.resolve({ success: false, error: '在线演示版不做版本快照' }) }

  api.getUserDirs = function () {
    return Promise.resolve({ home: ROOT, desktop: ROOT, documents: ROOT, downloads: ROOT, saveDir: ROOT })
  }

  /* ============================================================
   * electronAPI.fs（文件树新接口）
   * ============================================================ */
  api.fs = {
    // 无系统对话框：直接返回演示目录
    selectFolder: function () { return Promise.resolve(ROOT) },
    listDir: function (dirPath) { return Promise.resolve(listDir(dirPath)) },
    readFile: function (filePath) { return Promise.resolve(readText(filePath)) },
    readBinary: function (filePath) {
      ensureVfs()
      var s = normalize(filePath)
      if (vfs.binaries[s]) {
        return Promise.resolve({ success: true, base64: vfs.binaries[s], size: 0, fileName: basename(s) })
      }
      return Promise.resolve({ success: false, error: '在线演示版只提供示例数据，无法读取本地二进制文件' })
    },
    writeFile: function (filePath, content) { writeText(filePath, content); return Promise.resolve(true) },
    writeBinary: function (filePath, base64) {
      return api.saveBinaryFile(filePath, base64).then(function (r) {
        return r.success ? { success: true, path: r.filePath } : { success: false, error: r.error }
      })
    },
    getTempDir: function () { return Promise.resolve({ success: true, path: ROOT + '/.tmp' }) },
    rename: function (oldPath, newPath) {
      ensureVfs()
      var from = normalize(oldPath)
      var to = normalize(newPath)
      if (exists(to)) return Promise.reject(new Error('目标名称已存在'))
      if (vfs.files[from] != null) {
        vfs.files[to] = vfs.files[from]
        vfs.mtime[to] = Date.now()
        delete vfs.files[from]
        delete vfs.mtime[from]
      }
      vfs.dirs.forEach(function (d, i) { if (d === from) vfs.dirs[i] = to })
      saveVfs()
      return Promise.resolve(to)
    },
    // 在线演示没有资源管理器：静默成功，不抛错打断交互
    showInFolder: function () { return Promise.resolve(true) },
    remove: function (rawPath) { removePath(rawPath); return Promise.resolve(true) },
    mkdir: function (dirPath) {
      ensureVfs()
      var target = uniquePath(normalize(dirPath))
      if (vfs.dirs.indexOf(target) < 0) vfs.dirs.push(target)
      saveVfs()
      return Promise.resolve(target)
    },
    createFile: function (filePath, content) {
      ensureVfs()
      var target = uniquePath(normalize(filePath))
      var rootName = basename(target).replace(/\.[^.]+$/, '') || '中心主题'
      var defaultContent = content || JSON.stringify({
        data: { text: '<p><span>' + esc(rootName) + '</span></p>', uid: makeUid(), richText: true },
        children: []
      }, null, 2)
      writeText(target, defaultContent)
      return Promise.resolve(target)
    },
    move: function (src, destDir) {
      ensureVfs()
      var from = normalize(src)
      var target = join(destDir, basename(from))
      if (target === from) return Promise.resolve(from)
      if (exists(target)) return Promise.reject(new Error('目标位置已存在同名文件或文件夹'))
      if (vfs.files[from] != null) {
        vfs.files[target] = vfs.files[from]
        vfs.mtime[target] = Date.now()
        delete vfs.files[from]
        delete vfs.mtime[from]
      }
      vfs.dirs.forEach(function (d, i) { if (d === from) vfs.dirs[i] = target })
      saveVfs()
      return Promise.resolve(target)
    },
    exists: function (filePath) { return Promise.resolve(exists(filePath)) },
    stat: function (filePath) {
      ensureVfs()
      var s = normalize(filePath)
      if (!exists(s)) return Promise.resolve({ success: false, error: '文件不存在' })
      var content = vfs.files[s]
      return Promise.resolve({
        success: true,
        mtime: new Date(vfs.mtime[s] || Date.now()).toISOString(),
        size: typeof content === 'string' ? content.length : 0
      })
    },
    absPath: function (rawPath) {
      var s = normalize(rawPath)
      return Promise.resolve(s.charAt(0) === '/' ? s : join(ROOT, s))
    },
    findFile: function () {
      return Promise.resolve({ success: true, files: [] })
    }
  }

  /* ============================================================
   * AI：仅作展示
   * 前端 aiService 的 _isElectron() 以 window.electronAPI.aiChat 是否存在为准，
   * 这里给出同名接口但返回固定文案，避免在线版向用户配置的第三方地址发真实请求。
   * ============================================================ */
  var DEMO_REPLY = [
    '这是**在线演示版**，AI 能力仅作展示 🙂',
    '',
    '你可以先在左侧文件树打开示例导图，体验四视图（思维导图 / 大纲 / 关联图 / Markdown）、',
    '右键节点菜单、标签、复习计划、多分屏与多标签等本地功能 —— 这些都不依赖 AI，在线版可完整操作。',
    '',
    '需要真正使用 AI（生成导图、扩展、背诵改写、挖空、出题、知识库问答、联网搜索）时，',
    '请下载桌面版，在「设置 → AI 模型配置」里填入自己的 API Key 即可。'
  ].join('\n')

  api.getAIConfig = function () {
    return Promise.resolve({
      baseURL: '',
      activeProfileId: '',
      model: '（在线演示版）',
      autoComplete: true,
      temperature: 0.7,
      thinking: { enabled: false, level: 'medium' },
      profiles: []
    })
  }
  api.setAIConfig = function () { return Promise.resolve(true) }
  api.getAiTimeout = function () { return Promise.resolve(300) }
  api.setAiTimeout = function () { return Promise.resolve(true) }
  api.fetchModels = function () { return Promise.resolve({ success: false, error: '在线演示版仅作展示' }) }
  api.testVisionModel = function () { return Promise.resolve({ success: false, error: '在线演示版仅作展示' }) }
  api.getVisionConfig = function () { return Promise.resolve({}) }
  api.getEmbeddingConfig = function () { return Promise.resolve({}) }
  api.embedding = function () { return Promise.resolve({ success: false, error: '在线演示版仅作展示' }) }

  api.aiChat = function () {
    return Promise.resolve({
      success: true,
      data: {
        id: 'demo',
        object: 'chat.completion',
        model: 'demo',
        choices: [{ index: 0, message: { role: 'assistant', content: DEMO_REPLY }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
      }
    })
  }

  // 与主进程一致：onData 收到的是 SSE 文本片段
  api.aiChatStream = function (url, headers, body, onData, onDone) {
    var pieces = DEMO_REPLY.match(/[\s\S]{1,12}/g) || []
    var i = 0
    var cancelled = false
    var timer = setInterval(function () {
      if (cancelled) return
      if (i >= pieces.length) {
        clearInterval(timer)
        try { onData('data: [DONE]\n\n') } catch (e) { /* 忽略 */ }
        try { onDone() } catch (e) { /* 忽略 */ }
        return
      }
      var evt = 'data: ' + JSON.stringify({ choices: [{ index: 0, delta: { content: pieces[i++] } }] }) + '\n\n'
      try { onData(evt) } catch (e) { /* 忽略 */ }
    }, 24)
    return { cancel: function () { cancelled = true; clearInterval(timer) } }
  }

  api.aiUploadFile = function () { return Promise.resolve({ success: false, error: '在线演示版仅作展示' }) }

  /* ============================================================
   * 其余依赖主进程的能力：给出空实现，避免未加守卫的调用报错
   * ============================================================ */
  var noop = function () { return Promise.resolve(null) }
  var unsubscribe = function () { return function () {} }

  api.updater = {
    getState: function () { return Promise.resolve({ status: 'idle' }) },
    check: function () { return Promise.resolve({ status: 'idle' }) },
    download: noop,
    cancel: noop,
    install: noop,
    openReleasePage: function () {
      return api.openExternal('https://github.com/bubu-LZY/my-mindmap-agent/releases/latest')
    },
    onState: unsubscribe
  }

  api.autoLaunch = { get: function () { return Promise.resolve(false) }, set: function () { return Promise.resolve(true) } }
  api.httpServer = { getStatus: function () { return Promise.resolve({ enabled: false }) } }
  api.httpViewOnly = { getStatus: function () { return Promise.resolve({ enabled: false }) } }
  api.cloudSync = { getConfig: function () { return Promise.resolve({}) } }
  api.mcpServer = { onRequest: unsubscribe, getInstallConfig: noop }
  api.mcpTokens = { list: function () { return Promise.resolve([]) } }
  api.mcp = { list: function () { return Promise.resolve([]) } }
  api.skills = { list: function () { return Promise.resolve([]) } }
  api.customTools = { list: function () { return Promise.resolve([]) } }
  api.passwordGate = { isEnabled: function () { return Promise.resolve(false) }, validateSession: function () { return Promise.resolve(true) } }

  api.onOcrProgress = unsubscribe
  api.deskCalendar = { onStatus: unsubscribe, onQuery: unsubscribe }

  window.electronAPI = api

  // 便于排查：明确告知当前运行在在线演示桥接层
  console.info('[web-demo] 在线演示版已启用浏览器桥接层（虚拟文件系统 + AI 仅作展示）')
})()

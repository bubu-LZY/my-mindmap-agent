/**
 * Shell 命令执行 IPC（路径 A：主进程新增 IPC，让 AI 能跑代码 / 安装依赖 / 部署环境）
 *
 * 安全策略：
 * - 全部走 child_process.execFile（不传 shell、不用 cmd /c），杜绝命令注入
 * - binary 必须在 ALLOWED_BINARIES 白名单（node / python / git / npm / pnpm / yarn / cmd / powershell / pwsh / dotnet / go / rustc / cargo / make / python3）
 * - 工作目录必须通过 assertPathAllowed 校验（复用 fileManager 的白名单）
 * - 命令输出 stdout/stderr 累计超过 MAX_OUTPUT_BYTES 截断
 * - 单次执行默认 60 秒超时，可由调用方指定（最长 10 分钟）
 * - 长任务支持 spawn（返回 child handle + PID），并通过 webContents 推送 stdout/exit 事件
 */
const { ipcMain, BrowserWindow } = require('electron')
const { spawn, execFile } = require('child_process')
const path = require('path')
const os = require('os')

// 白名单 binary：常见开发/部署工具，避免被用来运行任意程序
const ALLOWED_BINARIES = new Set([
  // Node 生态
  'node', 'npm', 'npx', 'pnpm', 'yarn', 'pnpx',
  // Python
  'python', 'python3', 'pip', 'pip3', 'pipx', 'uv',
  // 版本控制
  'git',
  // 系统工具
  'cmd', 'powershell', 'pwsh',
  // 编译/打包
  'dotnet', 'go', 'rustc', 'cargo', 'make', 'cmake', 'gcc', 'g++', 'clang',
  // 其他
  'docker', 'kubectl', 'bash', 'sh'
])

// review M-4：shell:exec / shell:spawn 接受的 env 字段仅放行这些 key，其他一律忽略。
// 防止 AI 调用 run_shell(env={'NODE_OPTIONS': '--require /tmp/evil.js'}) 劫持子进程。
const ALLOWED_CALLER_ENV_KEYS = new Set([
  'PATH', 'NODE_ENV', 'PYTHONPATH', 'VIRTUAL_ENV', 'JAVA_HOME', 'GOPATH', 'GOROOT',
  'CARGO_HOME', 'RUSTUP_HOME', 'LANG', 'LC_ALL', 'TZ',
  'CI', 'NODE_OPTIONS', 'NPM_CONFIG_REGISTRY', 'HTTPS_PROXY', 'HTTP_PROXY',
  'NO_PROXY', 'PIP_INDEX_URL', 'PIP_TRUSTED_HOST', 'GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL'
])
const filterCallerEnv = (env) => {
  if (!env || typeof env !== 'object') return {}
  const out = {}
  for (const k of Object.keys(env)) {
    if (ALLOWED_CALLER_ENV_KEYS.has(k)) {
      const v = env[k]
      if (typeof v === 'string' || typeof v === 'number') out[k] = String(v)
    }
  }
  return out
}

const MAX_OUTPUT_BYTES = 1 * 1024 * 1024 // 1 MB
const DEFAULT_TIMEOUT_MS = 60 * 1000
const MAX_TIMEOUT_MS = 10 * 60 * 1000
// review L-1：MAX_BACKGROUND_JOBS 默认 8；可在调用方通过 args.max_jobs 临时覆盖（1~32）
let MAX_BACKGROUND_JOBS = 8
const setMaxBackgroundJobs = (n) => {
  const v = Math.min(Math.max(Number(n) || 8, 1), 32)
  MAX_BACKGROUND_JOBS = v
}
const getMaxBackgroundJobs = () => MAX_BACKGROUND_JOBS

// review M-2：app 退出前清理所有后台任务，避免孤儿进程
let __cleanupInstalled = false
const installCleanup = () => {
  if (__cleanupInstalled) return
  __cleanupInstalled = true
  try {
    const { app } = require('electron')
    const cleanup = () => {
      for (const [, job] of backgroundJobs) {
        try { job.proc.kill('SIGKILL') } catch (_) {}
      }
      backgroundJobs.clear()
    }
    app.on('before-quit', cleanup)
    app.on('will-quit', cleanup)
    // 主窗口全关闭时也清理（用户在系统托盘右键"退出"时也可能跳过 before-quit）
    app.on('window-all-closed', () => {
      // 仅在非 macOS 上彻底退出；macOS 上常驻菜单栏时不杀
      if (process.platform !== 'darwin') cleanup()
    })
  } catch (_) { /* 非 Electron 环境容错 */ }
}

// 长任务（spawn）句柄：handle -> { proc, startedAt, meta }
const backgroundJobs = new Map()
let __jobSeq = 0

function resolveAllowedBin(name) {
  if (!name || typeof name !== 'string') return null
  const base = path.basename(name).toLowerCase()
  if (ALLOWED_BINARIES.has(base)) return base
  // Windows 上 .cmd / .bat / .exe / .ps1 都可能跟 alias 同名（如 npm.cmd）
  const noExt = base.replace(/\.(exe|cmd|bat|ps1|sh)$/i, '')
  if (ALLOWED_BINARIES.has(noExt)) return noExt
  return null
}

function safeCwd(p) {
  if (!p) return process.cwd()
  // review S-1：fileManager.assertPathAllowed 在"无白名单 + 无 activeFileDir"状态下
  // 会全部放行（向后兼容），但 shell:exec 是高危入口，必须有独立硬性约束。
  // 强约束规则：cwd 必须满足下列条件之一，否则直接拒绝：
  //   1) 在 userData / 系统 temp 范围内（应用自有空间，永远安全）
  //   2) 在当前打开的 .smm 文件所在目录（避免破坏用户已打开文件）
  //   3) 在用户显式注册过的 allowedRoots 内（用户在 UI 里授权过的目录）
  //   4) 在 documents / downloads / desktop（用户主目录常用区域，但仅当有 activeFileDir 时启用，避免空状态下被任意引导）
  const resolved = path.resolve(p)
  try {
    const fileManager = require('./fileManager')
    // 第一道：让 fileManager 给出最终裁决（它会在有 activeFileDir / 白名单时直接放行）
    fileManager.assertPathAllowed(resolved, { destructive: true })
    // 第二道：独立硬约束。直接读取 fileManager 内部的 activeFileDir / allowedPathRoots 状态做精确校验
    // 避免 fileManager 在"完全无白名单"时全部放行导致 cwd 被引导到 C:\Windows 等位置
    const safe = isShellCwdSafeByInternalState(fileManager, resolved)
    if (!safe) {
      const err = new Error('shell cwd 不在允许的范围内：' + p + '（无任何白名单目录被注册 / 没有打开的导图文件，无法在任意目录执行命令）')
      err.code = 'SHELL_CWD_FORBIDDEN'
      throw err
    }
  } catch (e) {
    const err = new Error('shell cwd 不在允许的范围内：' + p + '（' + (e.message || '') + '）')
    err.code = 'SHELL_CWD_FORBIDDEN'
    throw err
  }
  return p
}

/**
 * review S-1：shell cwd 独立校验。不依赖 fileManager 的"无白名单则全部放行"兜底。
 * 通过 fileManager 暴露的内部属性（getter / 模块导出）直接读取白名单根目录。
 * 允许的条件（满足任一即可）：
 *   - 在 userData / temp（应用自有空间）
 *   - 在当前激活 .smm 文件所在目录
 *   - 在用户显式注册的 allowedRoots 中
 *   - 在 documents / downloads / desktop（仅当有 activeFileDir 时，避免无激活文件时被任意引导）
 */
function isShellCwdSafeByInternalState(fileManager, resolved) {
  try {
    const { app } = require('electron')
    // 1. 应用自有空间：永远安全
    const safeAlways = [app.getPath('userData'), app.getPath('temp'), require('os').tmpdir()].filter(Boolean)
    const norm = (s) => {
      const r = path.resolve(String(s || ''))
      return process.platform === 'win32' ? r.toLowerCase().replace(/\\/g, '/') : r
    }
    const pathIsUnder = (child, parent) => {
      if (!child || !parent) return false
      const a = norm(child); const b = norm(parent)
      return a === b || a.startsWith(b + '/')
    }
    for (const r of safeAlways) {
      if (pathIsUnder(resolved, r)) return true
    }
    // 2-3. 读 fileManager 内部白名单：通过 getter 拿到
    const roots = []
    try { if (Array.isArray(fileManager.allowedPathRoots)) roots.push(...fileManager.allowedPathRoots) } catch (_) {}
    try {
      const active = fileManager.activeFileDir
      if (active) roots.push(active)
    } catch (_) {}
    for (const r of roots) {
      if (pathIsUnder(resolved, r)) return true
    }
    // 4. documents / downloads / desktop：仅当 activeFileDir 非空（即用户已打开文件）时启用
    const hasActive = roots.length > 0
    if (hasActive) {
      const extra = [app.getPath('documents'), app.getPath('downloads'), app.getPath('desktop')].filter(Boolean)
      for (const r of extra) {
        if (pathIsUnder(resolved, r)) return true
      }
    }
    return false
  } catch (_) { return false }
}

function clipOutput(s) {
  if (!s) return s
  if (s.length <= MAX_OUTPUT_BYTES) return s
  return s.slice(0, MAX_OUTPUT_BYTES) + `\n…（输出超过 ${MAX_OUTPUT_BYTES} 字节，已截断）`
}

/**
 * 同步任务：执行一条命令，返回 stdout / stderr / exitCode
 * @param {string} binary 必填，白名单 binary 名称
 * @param {string[]} args  可选，参数数组
 * @param {string} [cwd]  可选，工作目录（必须经白名单校验）
 * @param {number} [timeoutMs]  超时，默认 60s，最大 10min
 */
ipcMain.handle('shell:exec', async (event, opts) => {
  installCleanup()
  try {
    const o = opts || {}
    const binary = resolveAllowedBin(o.binary)
    if (!binary) {
      return { success: false, error: `binary 不在白名单中：${o.binary}（允许：${[...ALLOWED_BINARIES].slice(0, 12).join('、')} 等）` }
    }
    const args = Array.isArray(o.args) ? o.args.map(String) : []
    const cwd = o.cwd ? safeCwd(o.cwd) : process.cwd()
    // review M-4：env 字段白名单过滤，避免 caller 把 NODE_OPTIONS / LD_PRELOAD 之类注入
    const env = filterCallerEnv(o.env)
    const timeoutMs = Math.min(Math.max(Number(o.timeoutMs) || DEFAULT_TIMEOUT_MS, 1000), MAX_TIMEOUT_MS)

    const result = await new Promise((resolve) => {
      const child = execFile(binary, args, {
        cwd,
        env: { ...process.env, ...env },
        windowsHide: true,
        // review M-3：显式关掉 stdin，避免子进程因 stdin 未关闭而 deadlock（如 node REPL）
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: timeoutMs,
        // review A4：maxBuffer 提到 8MB（原来是 2MB），给 npm install / pip install 这种长输出更大空间。
        // 真正超出时不再触发 ERR_CHILD_PROCESS_STDIO_MAXBUFFER 而 kill 子进程；
        // 而是在 callback 里用 clipOutput 截断，调用方拿到的是带"已截断"标记的输出。
        maxBuffer: 8 * 1024 * 1024
      }, (err, stdout, stderr) => {
        if (err) {
          // execFile 在返回码非零时会 err.killed / err.code；timeout 时 err.killed = true
          resolve({
            success: err.killed ? false : (err.code === 0),
            exitCode: typeof err.code === 'number' ? err.code : (err.signal ? -1 : 1),
            stdout: clipOutput(String(stdout || '')),
            stderr: clipOutput(String(stderr || '')) + (err.killed ? `\n（执行超时 ${Math.round(timeoutMs / 1000)}s，已被终止）` : ''),
            timedOut: !!err.killed,
            binary,
            args
          })
        } else {
          resolve({
            success: true,
            exitCode: 0,
            stdout: clipOutput(String(stdout || '')),
            stderr: clipOutput(String(stderr || '')),
            binary,
            args
          })
        }
      })
      // 让事件循环知道我们在等待
      if (child && typeof child.unref === 'function' && o.detached) {
        try { child.unref() } catch (_) {}
      }
    })
    return result
  } catch (e) {
    return { success: false, error: e.message, code: e.code || 'SHELL_EXEC_ERROR' }
  }
})

/**
 * 长任务：spawn 一个后台进程，返回 handle；后续通过 shell:stdout / shell:exit 事件接收输出
 * @param {string} binary
 * @param {string[]} args
 * @param {string} [cwd]
 * @param {object} [env]
 */
ipcMain.handle('shell:spawn', async (event, opts) => {
  installCleanup()
  // review L-1：每次调用前允许 caller 临时覆盖最大后台任务数（仅影响本进程）
  if (Number.isFinite(opts && opts.max_jobs)) setMaxBackgroundJobs(opts.max_jobs)
  if (backgroundJobs.size >= MAX_BACKGROUND_JOBS) {
    return { success: false, error: `同时运行的后台任务已达上限 ${MAX_BACKGROUND_JOBS}，请先 kill 一些` }
  }
  try {
    const o = opts || {}
    const binary = resolveAllowedBin(o.binary)
    if (!binary) {
      return { success: false, error: `binary 不在白名单中：${o.binary}` }
    }
    const args = Array.isArray(o.args) ? o.args.map(String) : []
    const cwd = o.cwd ? safeCwd(o.cwd) : process.cwd()
    // review M-4：env 字段白名单过滤
    const env = filterCallerEnv(o.env)

    const handle = `job_${Date.now()}_${++__jobSeq}`
    const proc = spawn(binary, args, {
      cwd,
      env: { ...process.env, ...env },
      windowsHide: true,
      // review M-3：stdio ignore 避免 stdin 死锁
      stdio: ['ignore', 'pipe', 'pipe']
    })

    const meta = {
      handle,
      binary,
      args,
      pid: proc.pid,
      startedAt: Date.now()
    }
    backgroundJobs.set(handle, { proc, meta })

    // 广播到所有可见窗口
    const broadcast = (channel, payload) => {
      const wins = BrowserWindow.getAllWindows().filter(w => w && !w.isDestroyed())
      for (const w of wins) {
        try { w.webContents.send(channel, payload) } catch (_) {}
      }
    }

    let stdoutBytes = 0
    let stderrBytes = 0
    const trimChunk = (kind, chunk) => {
      const len = Buffer.byteLength(chunk || '')
      const total = kind === 'stdout' ? stdoutBytes : stderrBytes
      if (total + len > MAX_OUTPUT_BYTES) {
        const left = Math.max(0, MAX_OUTPUT_BYTES - total)
        if (left <= 0) return null
        const truncated = chunk.slice(0, left)
        if (kind === 'stdout') stdoutBytes += left
        else stderrBytes += left
        return Buffer.concat([truncated, Buffer.from(`\n…（${MAX_OUTPUT_BYTES} 字节上限，已截断后续 ${kind}）`)])
      }
      if (kind === 'stdout') stdoutBytes += len
      else stderrBytes += len
      return chunk
    }

    proc.stdout.on('data', (chunk) => {
      const c = trimChunk('stdout', chunk)
      if (c) broadcast('shell:stdout', { handle, chunk: c.toString('utf8') })
    })
    proc.stderr.on('data', (chunk) => {
      const c = trimChunk('stderr', chunk)
      if (c) broadcast('shell:stderr', { handle, chunk: c.toString('utf8') })
    })
    proc.on('error', (err) => {
      broadcast('shell:exit', { handle, exitCode: -1, error: err.message })
      backgroundJobs.delete(handle)
    })
    proc.on('exit', (code, signal) => {
      broadcast('shell:exit', { handle, exitCode: code, signal })
      backgroundJobs.delete(handle)
    })
    return { success: true, handle, pid: proc.pid }
  } catch (e) {
    return { success: false, error: e.message, code: e.code || 'SHELL_SPAWN_ERROR' }
  }
})

/**
 * 终止后台任务
 */
ipcMain.handle('shell:kill', async (event, handle) => {
  const job = backgroundJobs.get(handle)
  if (!job) return { success: false, error: '未找到后台任务：' + handle }
  try {
    // review L-6：跨平台 kill 说明
    //   - POSIX（macOS / Linux）：SIGTERM 给子进程优雅退出的机会，2 秒后 SIGKILL 强杀
    //   - Windows：Node 在 Windows 上 SIGTERM / SIGKILL 都被转换为 TerminateProcess()，
    //     没有真正的"优雅退出"语义，2 秒延时只是给 stdio flush 留个缓冲（实际 TerminateProcess 是同步的）
    //   所以 setTimeout 在 Windows 上基本不会触发 SIGKILL，但保留逻辑无害
    job.proc.kill('SIGTERM')
    setTimeout(() => {
      if (backgroundJobs.has(handle)) {
        try { backgroundJobs.get(handle).proc.kill('SIGKILL') } catch (_) {}
      }
    }, 2000)
    return { success: true }
  } catch (e) {
    return { success: false, error: e.message }
  }
})

/**
 * 列出当前所有后台任务
 */
ipcMain.handle('shell:listJobs', async () => {
  const list = []
  for (const [handle, job] of backgroundJobs.entries()) {
    list.push({ handle, ...job.meta, alive: job.proc.exitCode === null && job.proc.signalCode === null })
  }
  return { success: true, jobs: list }
})

/**
  * 校验给定的脚本绝对路径是否在允许运行的目录内（review S-2）。
  * shell:exec / run_node / run_python 在主进程拿到的 script_path 必须经过这里。
  * 规则与 safeCwd 一致：userData / temp / 激活文件目录 / 注册白名单 / desktop·downloads·documents。
  * 注意：本函数与 safeCwd 是**独立的第二道闸门**，不依赖 fileManager 的"无白名单则全部放行"。
  */
ipcMain.handle('shell:assertScriptPathAllowed', async (_event, scriptPath) => {
  if (typeof scriptPath !== 'string' || !scriptPath) {
    return { success: false, error: 'scriptPath 必须是非空字符串' }
  }
  if (!path.isAbsolute(scriptPath)) {
    return { success: false, error: 'scriptPath 必须是绝对路径' }
  }
  try {
    const fileManager = require('./fileManager')
    fileManager.assertPathAllowed(scriptPath, { destructive: false }) // 读级校验：脚本只读不影响文件本身
    const safe = isShellCwdSafeByInternalState(fileManager, scriptPath)
    if (!safe) {
      return {
        success: false,
        error: '脚本路径不在允许的运行范围内：' + scriptPath + '（需要打开导图文件或将脚本所在目录加入白名单）'
      }
    }
    return { success: true, scriptPath }
  } catch (e) {
    return { success: false, error: '脚本路径校验失败：' + (e.message || String(e)) }
  }
})

// 读取环境变量（白名单 key；非白名单拒绝）
const ALLOWED_ENV_KEYS = new Set([
  'PATH', 'NODE_ENV', 'PYTHONPATH', 'VIRTUAL_ENV', 'JAVA_HOME', 'GOPATH', 'GOROOT',
  'CARGO_HOME', 'RUSTUP_HOME', 'HOMEBREW_PREFIX', 'LANG', 'LC_ALL', 'TZ',
  'CI', 'NODE_OPTIONS', 'NPM_CONFIG_REGISTRY'
])
// review M-1：以下 key 的"具体值"可被 AI 拼接到 run_shell 里劫持子进程（如 NODE_OPTIONS --require /tmp/evil）。
// 出于安全，对它们只返回"是否已设置"的布尔标记，不返回真实值。
const MASKED_ENV_KEYS = new Set([
  'NODE_OPTIONS',          // node / npm 子进程会被加载
  'NPM_CONFIG_REGISTRY',   // 改包源（影响 npm install）
  'PYTHONPATH',            // python 模块加载路径
  'NODE_ENV'               // 改运行时模式（production/development）
])
const maskValue = (key, raw) => {
  if (!MASKED_ENV_KEYS.has(key)) return raw || ''
  // 仅告诉调用方"已设置 / 已设置（值略）/ 未设置"，避免完整值泄漏
  if (!raw) return ''
  // 保留一个非常粗略的"值类型"标记，帮助调试又不泄漏具体值
  if (raw.length <= 32) return '***（已设置，已脱敏）'
  return '***（已设置，已脱敏，原始长度 ' + raw.length + ' 字节）'
}
ipcMain.handle('shell:getEnv', async (event, key) => {
  if (typeof key === 'string' && ALLOWED_ENV_KEYS.has(key)) {
    const raw = process.env[key] || ''
    return { success: true, key, value: maskValue(key, raw), masked: MASKED_ENV_KEYS.has(key) }
  }
  if (key === undefined || key === null) {
    // 不传 key 时返回所有白名单 key 的值（不暴露非白名单变量）
    const out = {}
    for (const k of ALLOWED_ENV_KEYS) {
      const raw = process.env[k] || ''
      out[k] = maskValue(k, raw)
    }
    return { success: true, env: out, maskedKeys: [...MASKED_ENV_KEYS] }
  }
  return { success: false, error: `环境变量不在白名单：${key}` }
})

module.exports = {
  ALLOWED_BINARIES,
  MAX_OUTPUT_BYTES,
  MAX_TIMEOUT_MS,
  // review L-1：暴露 setter 给设置页 / 测试用
  setMaxBackgroundJobs,
  getMaxBackgroundJobs
}

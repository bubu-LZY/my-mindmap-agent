# 更新日志 / Changelog

记录项目的所有重要变更。版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。

## [4.19.4] - 2026-09-13

### 修复

- **点「初始化」后连环给 AI 发消息、AI 没写代码却在执行工具**：网页模式的初始化提示词里带着 `mymindmap` 示例代码块（`list_tools`、`get_tool_detail`、`search_nodes` 等真实示例）。这条消息一旦被当成 AI 回复来解析，示例就会被当成真实工具调用去执行，执行结果再回传给 AI，于是又触发下一轮扫描，表现成"点完初始化就连续发消息"。现在四道闸门一起兜：
  - 解析前硬拦截「用户消息 / 我们自己刚发出去的消息」：按文本指纹比对（含去掉代码块围栏、去掉空白的归一化形式，页面的角色标记失效也挡得住）
  - 工具名校验收紧为 ASCII 小写 + 下划线，`{"tool": "工具名"}` 这类占位符不再被当成工具执行
  - 跨消息兜底只扫「当前这一轮」的 AI 消息，历史轮次里的旧工具调用不再被重放
  - 初始化阶段（用户还没发过消息）一个工具都不执行，且**不把拦截结果回传给 AI**（回传正是连环发消息的燃料）；点初始化后 15 秒内不做自动扫描
- **扫描器的「完成度兜底」判断必然抛异常**：`checkForToolCalls` 在「UI 未检测到 AI 回复完成」的分支里引用了尚未声明的 `h`（`const` 暂时性死区），该分支必然抛 `ReferenceError`，导致「内容稳定 5 秒即认为完成」的兜底从未生效。现在内容指纹提前计算
- **打开其他面板后 DeepSeek 网页版仍浮在最上层**：显式登记浮层总会漏（新增面板、第三方组件自带的下拉/气泡、右键菜单、全屏节点搜索……）。现在新增兜底闸门（`utils/deepSeekAutoOverlayGuard.js`）：监听整个文档，只要有「高层浮层」与 DeepSeek 面板区域相交就自动隐藏原生层，浮层消失后自动恢复；全屏节点搜索框也单独登记进闸门

### 优化

- **展开/收起右侧 AI 助手不再卡顿**：网页模式的原生 BrowserView 在宽度动画的每一帧都要 `setBounds` + `addBrowserView`/`removeBrowserView`，界面明显掉帧。现在侧边窗做宽度动画期间先隐藏原生层（`transitionstart` → `transitionend` 一次性对齐位置，另带 600ms 兜底），显隐与位置只在真正变化时才走 IPC；位置同步也不再捕获监听页面上所有滚动
- **compact 布局等动画结束再切换**：ChatPanel 体积大，`compact` 一变整棵子树就要重渲染。现在推迟到宽度动画（180ms）结束后再切，动画期间只管走宽度

## [4.19.3] - 2026-09-12

### 修复

- **设置目录与内容顺序不一致**：侧边目录的数组顺序与模板中 `sec-*` 区块的实际顺序不同（例如「深度思考模式」与「AI temperature 设置」互换、`MCP 服务 / Skills / 工具目录 / 官方扩展文档` 被排在「AI 安全与记忆」之后）。滚动高亮改按文档位置判定后，顺序错位的区块会被整段跳过（滚到 Embedding 直接跳到「AI 安全与记忆」，中间的 MCP、Skills、官方扩展文档全部漏判）。现在目录数组严格按模板顺序排列（19 项逐一对齐），并保留「按文档位置排序」作为兜底
- **拖动画布平移后多选节点全部丢失**：按住 Ctrl 多选若干节点后，若用右键拖动平移画布，`simple-mind-map` 会在 `contextmenu` 阶段先清空激活列表，而平移分支随即 `return`，被清空的多选再也没恢复。平移不是「取消选择」的语义，现在在按下时快照多选节点，平移结束后按快照恢复并重新派发 `node_active`，工具栏的激活列表同步回多选状态
- **思维导图工具条被右侧 AI 助手面板遮住**：可拖动工具条吸附为横条时约需 500px 宽，AI 面板展开或分屏把画布压窄后，超出的部分被父容器 `overflow: hidden` 从右边界裁掉（看起来像被面板盖住，只能手动拖出来）。现在定位时若首选方向放不下就自动换到另一方向（横条 ↔ 竖条），空间恢复后仍按用户原本的吸附方向显示
- **标签栏清空按钮需悬浮才出现**：一键清空按钮原本 `display: none`，只在鼠标悬浮标签栏时显示。现改为常驻显示在最前面并用红色文字标识这是销毁类操作；按钮移出滚动容器，标签再多也不会把它顶走，也不会有标签从它左侧透出来
- **DeepSeek 网页免费版悬浮球跟手性差、有些位置拖不到**：页面有 `html { zoom }` 缩放，`getBoundingClientRect()` 返回视觉像素（= 布局像素 × zoom），而 `style.left/top`、`offsetWidth`、`window.innerWidth` 都是布局像素。原实现把视觉像素当布局像素做起点，每次按下球都会瞬移 `(1/zoom - 1)` 倍的位置且越靠边偏得越多。现在全程只在布局像素里换算（鼠标位移先除以 zoom），拖动期间关掉过渡与 hover 缩放，拖拽用 rAF 合并写样式；恢复保存位置时夹回可见区域，避免旧版本存下的视觉像素或上次更大的窗口尺寸把球留在视口外
- **DeepSeek 网页模式遮挡其他界面**：网页模式的画面由主进程 `BrowserView`（原生层）渲染，永远盖在 DOM 之上，`z-index` 压不住。此前只有「设置」接了隐藏逻辑，打开复习总览、记事本、消息中心、快捷键、布局、定时任务、全屏截图、节点备注时仍会被盖住。现在新增统一的浮层闸门（`utils/deepSeekOverlayGate.js`）：各浮层按唯一 reason 登记，全部关闭后才恢复显示；用集合而非布尔量，避免多个浮层同时打开时被先关闭的一方抢先恢复

### 优化

- **顶栏按钮间距与文件名居中**：消息中心 / 记事本 / 浏览器 / 快捷键 / 定时任务 / 布局 / 设置 的按钮间距由 4px 收到 2px、字号 12px→11px、内边距 10px→7px；顶栏左右各放一个等分占位，文件名真正落在水平中线（刷新按钮改为绝对定位，不再参与宽度分配）；按钮改为不压缩、标签不折行，窄窗口下优先让文件名出省略号
- **顶部标签宽度收窄**：普通标签 160px→132px，多屏组合标签 200px→168px，间距与内边距同步收紧

## [4.19.2] - 2026-09-12

### 优化

- **设置界面滚动卡顿**：弹窗遮罩 `.el-overlay` 上有一层覆盖整个视口的 `backdrop-filter: blur(20px)`，弹窗内每重绘一帧都要把底层整个应用（思维导图 + 多个毛玻璃面板）重新模糊合成；同时弹窗打开时被 40% 黑遮罩盖住、完全看不见的底层毛玻璃仍在逐帧重算。去掉这两处模糊后，设置面板滚动帧耗时（p50）从约 48ms 降到约 22ms
- **设置区块本身的重绘开销**：19 个设置区块各自带一层 `backdrop-filter`，全部移除（底色本就接近纯白，视觉几乎无差别）；滚动高亮不再每帧对 19 个区块调用 `getBoundingClientRect` 触发强制同步布局，改为缓存各区块 `offsetTop` 后按位置判定，并用 `ResizeObserver` 在内容高度变化时重新量取

### 修复

- **设置目录末尾两项需要点两次才跳转**：「关于」等末尾区块在滚到底时顶不到容器顶部（`数据备份` / `关于` 的 `offsetTop` 超过 `maxScroll`），任何「取视口最上方区块」的规则都选不到它们，旧实现的高亮会被中间区块冲掉。现在点击目录后把高亮锁定在点击项，等用户自己滚动（滚轮 / 触摸 / 拖动滚动条）才解锁并交回位置判定，滚到底再兜底到最后一个区块
- **目录顺序与文档顺序不一致会漏判区块**：滚动高亮改位置判定后，必须按文档位置排序，否则提前 `break` 会漏掉中间的区块（目录顺序与 DOM 顺序并不一致）
- **在线演示环境手动保存会静默下载文件**：浏览器模式下的保存降级会 `download` 一个 `mind-map.json`，用户在演示页点保存或按 Ctrl+S 就会莫名落下一个 Web 端再也打不开的文件；改为提示「在线演示版不支持保存到本地」（桌面版不受影响）

## [4.19.1] - 2026-09-12

### 修复

- **Linux 自动更新选错安装形态**：产物名切词用 `[^a-z0-9]+` 作分隔符，把 electron-builder 的 Linux x64 命名 `x86_64` 切成 `x86` + `64`，而 `x86` 属于 ia32 架构别名，导致 AppImage 被判为「异构架构」直接排除——Linux 用户只能匹配到 `.deb`（需手动安装），拿不到可静默自替换的 AppImage。改为比对前先归一化复合写法（`x86_64` / `x86-64` → `x64`，`aarch64` → `arm64`）
- **发布流水线把安装包与构建日志打进源码 zip**：生成源码 zip 的步骤排在 `download-artifact` 之后，资产落盘目录被一起打包，源码包从 1.5MB 膨胀到 1.4GB；且 `vite-build.log` / `ebuild.log` 含本机绝对路径，进入公开产物属隐私泄露。已调整步骤顺序，并在打包脚本中排除根级资产目录、`*.log` 与临时发布说明

### 构建 / CI

- **Intel macOS 构建改用 `macos-15-intel`**：`macos-13` 已于 2025-12 退役，该 runner 标签不再有机器可分配，任务会一直处于排队状态且不报错
- 发布流程补充：先以 `workflow_dispatch` 干跑验证四个平台都能分到 runner，再推 tag 正式发布

### 测试

- 选包逻辑改用**线上 Release 真实资产名**做回归：新增覆盖 `win32/x64`、`darwin/x64`、`darwin/arm64`、`linux/x64` 命中，以及 `win32/ia32`、`linux/arm64` 回退下载页、源码 zip 不被误选等场景

## [4.19.0] - 2026-09-12

### 新增功能

- **应用内自动更新**：检测到新版本后可在程序内后台下载安装包，下完提示「重启并安装」，点击后自动完成覆盖安装并重启，不再需要手动去 Release 页面下载
  - Windows：调用 NSIS 安装包静默安装（`--updated /S --force-run`），装完自动拉起新版本
  - macOS：`hdiutil` 挂载 dmg → `ditto` 覆盖 `/Applications` 下的应用 → 重启；任一步失败回退为打开 dmg 由用户拖入
  - Linux：AppImage 原地原子替换后重启；deb/rpm 交给系统包管理器打开
  - 下载全程在主进程进行，右下角进度卡片显示百分比、已下载大小与速度，支持取消，设置页「关于」内也能查看进度与重试
- **按系统与架构自动匹配安装包**：从 Release 资产中按平台 + 架构（x64 / arm64 / x86_64 等别名）打分匹配唯一产物；无匹配产物时（如 32 位 Windows、Intel Mac）自动回退到 Release 下载页
- **多平台安装包**：新增 macOS（dmg + zip，Intel 与 Apple Silicon）与 Linux（AppImage + deb）打包配置，Windows 保持 x64 NSIS
- **CI 三平台构建发布**：推 `v*` tag 即在 windows / macos-13 / macos-14 / ubuntu 四路并行构建，产物连同源码 zip 自动上传 Release 并标记 latest

### 安全加固

- 下载地址一律由主进程根据 GitHub Release API 响应推导，不接受渲染层传入的 URL；仅允许 https 且限定 GitHub 下载域，重定向逐跳校验、最多 5 跳
- 落盘前校验文件大小与 sha256（Release API 提供 digest 时），不通过即删除；文件名取 basename 并过滤路径分隔符，统一落在 `userData/updates`
- 安装前复核「只能执行本次下载到 updates 目录里的文件」；退出时清理半截安装包
- 安装器 `customInit` 的进程占用确认框加 `/SD IDYES`，静默更新不再被这个弹窗挂住

### 修复

- 设置页「检查更新」由「跳转下载页」改为触发后台下载流程；「今日不再提醒」对自动检测仍然生效，手动检查不受其限制

## [4.18.0] - 2026-09-12

### 安全修复（高危）

- **任意文件读写与 RCE 路径收口**：自定义工具加载改为白名单校验 + 路径归一化（`resolveInside`），彻底封堵 Zip Slip 式目录穿越；归档解压对绝对路径与盘符一律重定位进目标目录而不是抛错
- **SSRF 全链路封堵**：7 条出站请求路径统一走 DNS 解析后的地址分类，覆盖云实例元数据（`169.254.169.254`、`100.100.100.200`、`169.254.170.2`）、IPv4-mapped IPv6、6to4、Teredo，并逐跳校验重定向
- **XSS 提权面收敛**：约 22 处 `innerHTML` 改写为 `DOMParser` 惰性文档解析（脱离浏览上下文，脚本不执行）
- **云盘同步凭据出渲染进程**：WebDAV 密码改为主进程 `safeStorage`（Windows DPAPI）加密存储，`getConfig` 只回传掩码；`rclone:sync` 不再接受渲染层传入的 `rclonePath`（原先等于给了 XSS 一个任意 exe 执行原语），并校验路径必须是裸命令名或 `.exe`

### 性能优化

- **日志写入不再卡主线程**：日志存储改内存缓存 + 800ms 合并写盘。原先每条日志都要 `getItem → JSON.parse 全量 → push → JSON.stringify 全量 → setItem`，1000 条 × 单条 20KB 时是兆级同步序列化，一次 AI 任务上百条日志即拖垮主线程（与日志面板开没开无关）
- **日志面板渲染收敛**：四个统计各自全量 `filter` 合并为一次遍历；渲染上限 300 条并提示未渲染条数（统计与复制仍含全部）；日志数组改 `shallowRef`
- **思维导图实例改浅响应**：实例与激活节点改 `shallowRef` + `markRaw`，去掉深层 Proxy 开销；同时修掉后台实例无法注销导致持续泄漏的问题（深响应式下引用比较恒为 false）
- **AI 工具结果预算按类型分配**：文本型工具 12K 字符、结构型 400、总预算 20~40K。原先统一 3000 会把 `read_local_file` 的正文拦腰截断，模型拿到半截内容反而凭想象补全

### 稳定性修复

- **危险工具确认弹窗改 FIFO 队列**：只读工具并行执行时确认回调会并发触发，原先单槽实现第二次覆盖第一次的 `resolve`，导致该 Promise 永不 settle、Agent 直接挂死
- **补齐 `tool_call_id`**：流式与非流式两个收敛点统一生成缺失的工具调用 id，避免整轮请求被 400
- **计划步数夹紧**：计划步数上限 40 轮，防止几百步的计划把 Agent 循环变成事实上跑不完的任务
- **工具匹配阈值修正**：原先两处「高置信」过滤按 0.6 / 0.5 比较，而打分函数返回整数（最低命中 2、命中工具名 3），过滤恒真、形同虚设，语义兜底检索路径成为死代码
- **地理位置兜底源改 HTTPS**：`http://ip-api.com` 免费档只有 HTTP（HTTPS 实测 403），明文请求泄露使用行为且可被中间人篡改为假定位；改用 `https://ipwho.is`
- **机器人自启恢复**：改等 `mainWindow` 而非 `getAllWindows()[0]`，后者在存在截图/OCR 辅助窗口时可能取错对象
- **搜索配额过期回收**：`searchBudgets` 原先只判过期不删除，长时间运行按任务数无上限堆积

## [4.17.0] - 2026-09-11

### 性能优化（前端启动与运行流畅度）

- **代码分割，主包瘦身 89%**：原 24 个组件 + 全部依赖挤在 5.27MB（gzip 1.74MB）单个 JS 文件里，启动需单线程解析 5MB JavaScript，是启动慢与操作卡顿的主要来源。现主包降至 579KB（gzip 199KB），其余拆为并行加载的独立块：
  - `element-plus`（1,032KB）、`simple-mind-map`（1,235KB）、`tool-handler`（940KB）独立分块，与主包并行加载；版本升级时未变化的依赖块直接走本地缓存，二次启动更快
  - `md-editor`（872KB）、`pdfjs`、`xlsx`、`exceljs`、`force-graph`、`highlight.js` 等按需加载，用到才拉取
- **11 个低频组件异步化**：SettingsView、TaskSchedulerPanel、GraphView、MarkdownEditor、DocViewer、OcrScreenshot、ShortcutCenter、ReviewView、TagView、FloatingNotepad、FloatingMessageCenter 改为 `defineAsyncComponent`，首次使用时才加载，启动路径显著变轻
- 体检确认运行时链路健康无需改动：AI 流式输出已有 rAF 节流 + markdown 渲染缓存；布局深度 watcher 已有 rAF 节流；5 处高频 mousemove 均有早退守卫/节流且卸载时正确清理；轮询定时器均为 30 秒低频或短命自清

## [4.16.7] - 2026-09-11

### UI 修复

- **修复 Todo 胶囊泄漏到 DeepSeek 网页模式**：API 聊天界面的"Plan-and-Execute 任务清单"悬浮胶囊（☑ Todo N/M）原只要 `activePlan` 存在就渲染、未检查 `chatMode`——用户曾在 API 模式生成过任务计划后切换到 DeepSeek 网页模式，胶囊仍悬浮在网页面板边上，看起来像 DeepSeek 页面自身弹出的组件。现胶囊仅在 API 模式（`chatMode === 'api'`）显示，切换到网页模式自动隐藏。

## [4.16.6] - 2026-09-11

### DeepSeek 面板工具检测修复

- **修复初始化后“幽灵工具调用”**：`parseToolCalls` 终极兜底原扫描 `document.body.innerText` 全页文本，会把用户消息（初始化系统提示词）里的 `mymindmap` 示例块误识别成 AI 的工具调用并自动执行。现改为只收集 AI 消息文本（`collectAIMessagesText`），绝不包含用户消息；并补充工具名格式校验（字母数字下划线），拦截 `"tool": "工具名"` 这类中文占位符。
- **修复修改类工具被永久误拦截**：`countUserMessages()` 原用 `[data-role="user"]` / `.user-message` 选择器统计用户消息，在 DeepSeek 真实 DOM（`.ds-message` + `human` 标记）上恒返回 0，导致用户发出明确需求后 `delete_node` / `add_child_nodes` 等仍被“初始化阶段拦截”。现改用 `.ds-message` + `isUserMessage()` 统一判定；`isUserMessage` 提升为顶层函数供两处复用，消除判定标准漂移。
- **保留防自作主张设计**：按开头特征排除系统注入的初始化提示词——初始化后 AI 自我介绍阶段调用修改类工具仍会被拦截，用户发出真实需求后立即放行。

## [4.16.5] - 2026-09-11

### 搜索与语义检索质量（AI 工具链）

- **Baidu 搜索结果过滤**：剔除 `link=null` 的无效结果与百度聚合页（相关搜索/聚合卡片），仅保留 `/link?url=` 真实跳转结果；同步修正摘要与标题的对齐逻辑。
- **语义检索路径归一化**：`db:indexFile` / `db:indexDocument` / `db:removeFile` 入口统一 `\` → `/` 分隔符；启动时自动迁移旧库中因分隔符混用产生的重复索引；RRF 融合去重 key 归一化，BM25 与向量库对同一文件正确合并名次。
- **向量权重下调**：RRF 融合中向量名次分权重 1.2 → 0.8，避免无关语义近似结果（如知识库中无关文件）压过 BM25 精确匹配。
- **当前文件优先**：`semantic_search` 工具自动传入当前打开文件路径，命中当前导图的内容排序强加权靠前。
- **搜索预算放开**：`search_web` 每任务上限 2 → 6 次（深度研究 10 次），避免任务中途无法继续联网检索。
- **意图改写防截断**：改写链路 `max_tokens` 150 → 400，并注入当前导图主题，防止截断重试与语义漂移（口语被臆测成无关领域）。
- **完整 UUID 输出**：`query_nodes` 结果输出完整 UUID，避免 AI 错误使用 8 位短 UID。

## [4.8.2] - 2026-09-05

### 安全（Security）

- **自定义工具独立子进程沙箱**：`tool.js` 不再在主进程内 `import()` 执行，改为写入临时目录后由独立子进程（`child_process.fork`）执行。工具代码即使直接 `import('fs')` / `import('child_process')`，也只能操作子进程自己的 Node，无法触碰主进程、渲染进程、localStorage 或应用其它资源。
- 工具与主进程之间仅保留最小 RPC：文件读写（主进程继续做路径白名单校验）、PowerShell（仅 `manifest.powershell===true` 时开放）、`http.fetch`（子进程原生 fetch）。执行结果经 JSON 序列化回传，主进程继续统一做超时保护（默认 30s / 上限 120s）。

## [4.8.1] - 2026-09-05

本批主要围绕「Markdown 与多视图统一、渲染性能、多分屏体验、后台 AI、安全加固」进行修复。

### Markdown / 多视图统一

- 未同步检测从 `@onChange` 改为 `watch(mdText)`，修复“有时提示、有时不提示、删除不生效”的问题。
- Markdown 编辑器组件创建时即初始化数据，避免空值挂载导致 CTRL+Z 一步清空全部内容。
- 引用语法 `[文字](mindmap-file:...)` / `[文字](mindmap-node:...)` 支持往返，并在导图/大纲还原为 `smm-ref` 原子块。
- 大纲把裸引用链接统一包成 `.ref-tag` 原子块，Backspace/Delete 一下整块删除，不再逐字删。
- 表格/代码块节点在大纲只读，点击给出「请切换到 Markdown 模式编辑」提示。

### 渲染 / 性能

- 关联图超大节点保护：超过 1500 节点只渲染前 1500 个并提示；缩放过低时隐藏深层文字、保留前几层；根节点与一级节点初始距离缩短。
- 关联图支持右键 / 中键（滚轮键）拖动平移画布，并阻止右键弹系统菜单。
- 修复思维导图节点编辑时文字重影（编辑器透明露出原节点文字）。
- 大纲「展开所有 / 收起所有」真实展开到末级 / 收起到根。
- 设置左侧目录支持独立滚动。

### 多分屏

- 多分屏合并为「多屏：A…｜B…」组合标签（前三个字 + 蓝色竖杠分隔）。

### 安全 / 后台 AI

- 后台指定路径修改文件后，系统提示词强制要求自动 `save_mindmap` 写回，不再反问是否保存。
- 自定义工具执行增加超时保护（默认 30s，上限 120s），异常包装为 `success:false`。
- 修复飞书机器人长连接读加密后 `appSecret` 密文导致连不上的回归（统一走 `decryptFields`）。
- 内置 `example-timeout` 自定义工具示例，便于验证超时保护。

### 浏览器 / 其它

- 修复目录树拖文件进浏览器时提示框闪烁消失、合成拖拽 `dataTransfer` 读不到导致未上传的问题；`.smm` 自动转 Markdown 上传。
- 飞书「访问开发者后台」链接改走 `shell.openExternal`，在默认浏览器打开。
- Todo 气泡样式改为窄高的小气泡，并加防遮挡处理。

## [3.0.0] - 2026-08-31

本次大版本在「安全 / 体验 / 性能」三方面做了系统性加固，同时新增了多个 AI Agent 能力。

### 安全（Security）

- **fsGuard 路径白名单持久化**：之前 `__allowedPathRoots` / `__activeFileDir` 是进程内 Map / 字符串，重启程序后丢失，导致 FileTree 已添加的目录无法再次访问。已迁移到 `electron-store` 持久化（`fsGuardAllowedRoots` / `fsGuardActiveFileDir`）。FileTree 的 `addFolder` / `syncSaveDirRoot` / `onMounted` 三处都会自动把 folderRoots 同步注册到 fsGuard。
- **`shell:exec` 独立 cwd 校验**（修复高危漏洞 S-1）：原版依赖 `fileManager.assertPathAllowed` 在「无白名单 + 无 activeFileDir」时全部放行，新版 shellExec.js 内部对 cwd 做独立硬约束：必须命中 userData / temp / 激活文件目录 / 已注册白名单 / 桌面·文档·下载 之一才放行。
- **`run_node` / `run_python` 脚本路径校验**：新增 `shell:assertScriptPathAllowed` IPC；`run_node` / `run_python` 在调用 shell:exec 之前先校验 `script_path` 是否在白名单内，防止 AI 把任意目录下的恶意脚本通过 node/python 执行。
- **用户 MCP 服务对外暴露（外部 Agent 可调用）**：`/mcp` 端点的 `tools/list` 现在会把用户在设置里添加的 stdio / HTTP MCP 服务工具合并后下发（命名规范 `mcp__<serverId>__<toolName>`），`tools/call` 用前缀正则识别并路由到 `mcpManager.callTool`。修复了 `listTools` 未未导出导致的"外部 Agent 看不到用户 MCP 工具" bug。外部 Agent（Trae / Claude Desktop / Cursor）可通过 `/mcp` 端点直接调用本程序 + 用户添加的 MCP 服务。
- **shell_exec / spawn env 白名单合并**：env 字段只放行 `PATH` / `NODE_ENV` / `PYTHONPATH` / `JAVA_HOME` / `HTTPS_PROXY` 等 21 个白名单 key，杜绝 AI 用 `NODE_OPTIONS=--require /tmp/evil.js` 劫持子进程。
- **`shell:spawn` `stdio: ['ignore', 'pipe', 'pipe']`** 显式关掉 stdin，避免 node REPL 等场景下 stdin 死锁。
- **`shell_get_env` 脱敏**：`NODE_OPTIONS` / `NPM_CONFIG_REGISTRY` / `PYTHONPATH` / `NODE_ENV` 这 4 个 key 只返回"已设置 / 长度"标记，不返回真实值。
- **后 before-quit 清理后台任务**：`app.on('before-quit')` / `will-quit` / `window-all-closed` 三处清理 backgroundJobs，避免孤儿进程。
- **`shell:exec` maxBuffer 从 2MB 提升到 8MB**：给 npm install / pip install 等长输出更大空间，超出时由 `clipOutput` 截断而非 kill 子进程。

### 性能 / 体验（Performance & UX）

- **AI 工作时频繁整树重渲染 优化**：`setNodeGeneralization` 内的 `mindMap.render()` 改为 `scheduleMindMapRender()`（requestAnimationFrame 防抖），批量场景下从 N 次 render 降到 1 次。批量改节点（背诵改写 / 出题 / 挖空）提速明显。
- **AI 流式响应 优化**：每 token 不再触发 `aiMsg.content = fullResponse`（Vue 重 patch），改为本地变量累加 + 每帧 raf 同步一次到响应式对象，UI 渲染开销显著下降。
- **主进程 22 处同步 fs 调用改异步**：`fs.existsSync` / `mkdirSync` / `writeFileSync` / `readdirSync` / `statSync` 全部改成 `await asyncExists` / `asyncMkdir` / `asyncWriteFile` / `asyncReaddir` / `asyncStat`，保留 `getDefaultSaveDir` 的同步 fallback（高频入口，牵连全链路）。`list-files` 把 N 个 stat 改成 `Promise.all` 并行（速度提升 5~10 倍）。
- **AI 上下文管理**：`KEEP_RECENT_ROUNDS` 从 8 提升到 12；新增 `hasStructuredContent` 检测，含 markdown 表格 / 围栏代码块 / 多级标题 / 长列表的 AI 消息会从压缩区"抠出来"保留原文。
- **`shouldKeepContextMessage` 过短过滤修复**：原规则 `content.length > 300` 会把 AI 短回复（结构化表格往往 < 300 字）误判为"无效短回复"丢弃，导致用户说"用 markdown 表格再输出"时 AI 拿不到上轮表格。新规则只在"无内容 + 无成功工具 + 错误信息命中"时才过滤。
- **Export 工具描述强化**（防误匹配）：`export_to_markdown` / `export_mindmap_html` / `export_mindmap_pdf` / `export_outline_pdf` 四个工具的描述都加了 ⚠️ 强约束："仅当用户明确要求导出/保存为文件时才调用本工具；用户说 markdown 表格 / 列表 / 代码块时直接用文字回答"。
- **大代码文件提示**：`read_local_file` 对 >500KB 的代码文件自动追加"建议用 offset/max_chars 分次读取"的提示。
- **fileManager `maxBuffer` 优化**等。

### 新增能力（New Capabilities）

- **`run_shell` 工具**：允许在白名单 binary（node / npm / pnpm / python / git / docker / kubectl 等 31 个）里执行命令，最长 10 分钟；cwd 必须命中白名单（独立校验）。
- **`run_node` / `run_python` 工具**：执行本地脚本，绝对路径 + 主进程 fsGuard 双重校验。
- **`spawn_shell` 长任务流式工具**：后台启动进程，通过 `shell:stdout` / `shell:stderr` / `shell:exit` 事件推送输出，配合 `shell_kill_background_job` 终止；支持开发服务器 / 长任务训练等场景。
- **`shell_get_env` / `shell:listJobs` / `shell:kill` 工具**：查看 / 管理后台任务。

### Bug 修复

- **深度思考按钮关闭后被强制开启**：`toggleDeepThinkingMenu` / `toggleDeepThinkingPullup` 不再在关闭状态下 `setEnabled(true)`；同时为关闭状态补"开启深度思考"菜单入口（之前打开菜单根本没有任何可点的项）。
- **"沉淀 Skill"按钮只有悬浮弹窗**：原版 `ElMessage.success('已沉淀')` 3 秒消失，用户看不到 AI 给出的内容也没法改/试用。新版在消息列表插入可编辑卡片，5 个状态（analyzing / ready / saving / saved / not_feasible / failed / discarded），name / description / instructions 可编辑，提供 4 个按钮：「💾 保存」「▶ 一键试用」「✕ 取消」「🔄 重试」。
- **文件名过长超出消息框**：`.message-content` 加 `max-width: 100%; overflow-wrap: anywhere`，`、`.msg-file-chip` 改 `max-width: min(280px, calc(100% - 8px))`，文件名 ellipsis 不溢出。
- **fs:listDir 错误静默吞错**：返回 `{ error, items }` 让前端能反馈"该目录已被 fsGuard 拒绝"。

### 工程改进（Tooling）

- **新增 Skill: `ai-card-feature-fix-loop`**：把"AI 操作只有悬浮弹窗"这类问题的标准修复模式沉淀为可复用 skill，路径 `.trae/skills/ai-card-feature-fix-loop/SKILL.md`。
- **`COMMON_CODE_EXTS` 抽公共常量**：`read_local_file` / `retrieve_local_file` 共用一份代码扩展名列表，避免两份独立维护造成不一致。
- **`shellExec.js` 暴露 `setMaxBackgroundJobs` / `getMaxBackgroundJobs`**：供设置页 / 测试调整后台任务上限。

## [2.x]

历史 2.x 版本的更新日志未保留在仓库中，请参考 git commit history。

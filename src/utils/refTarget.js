/**
 * 引用目标判定（悬浮预览与引用跳转共用，避免两处规则不一致）
 *
 * 三种目标：
 * - mindmap：思维导图（.smm / .json / .xmind）—— 程序可编辑，动作是「去编辑」
 * - markdown：Markdown（.md / .markdown）—— 多数由「导出 Markdown」从导图转换而来
 *   · 存在同名 .smm（同目录或默认保存位置）→ 直接编辑那份导图
 *   · 内容本身是导图大纲（多级标题/嵌套列表）→ 转成 .smm 后编辑（源文件不动）
 *   · 其余 → 只读查看
 * - doc：PDF / Word / Excel / PPT / CSV / 纯文本等 —— 程序无编辑能力，动作是「去查看」
 */

export const MIND_MAP_EXTS = ['smm', 'json', 'xmind']
export const MARKDOWN_EXTS = ['md', 'markdown']
export const DOC_EXTS = ['pdf', 'docx', 'pptx', 'xlsx', 'xls', 'csv', 'tsv', 'txt', 'log', 'html', 'xml']

/** 取小写扩展名（无扩展名返回空串） */
export function getFileExt(filePath) {
  const name = String(filePath || '').split(/[\\/]/).pop() || ''
  const idx = name.lastIndexOf('.')
  return idx > 0 ? name.slice(idx + 1).toLowerCase() : ''
}

/** 取文件名（含扩展名） */
export function getBaseName(filePath) {
  return String(filePath || '').split(/[\\/]/).pop() || ''
}

/**
 * 按扩展名判定引用目标类型
 * @returns {'mindmap'|'markdown'|'doc'}
 */
export function getRefKind(filePath) {
  const ext = getFileExt(filePath)
  if (MIND_MAP_EXTS.includes(ext)) return 'mindmap'
  if (MARKDOWN_EXTS.includes(ext)) return 'markdown'
  return 'doc'
}

/**
 * 查找 Markdown 对应的同名思维导图
 * @returns {string} 命中的 .smm 绝对路径，未命中返回空串
 */
export async function findMarkdownSourceMap(mdPath) {
  const base = getBaseName(mdPath).replace(/\.(md|markdown)$/i, '')
  if (!base) return ''
  const str = String(mdPath)
  const sep = str.includes('\\') ? '\\' : '/'
  const lastSep = str.lastIndexOf(sep)
  const dir = lastSep > 0 ? str.substring(0, lastSep) : ''

  const candidates = []
  if (dir) candidates.push(`${dir}${sep}${base}.smm`)
  try {
    const saveDir = await window.electronAPI?.getDefaultSaveDir?.()
    if (saveDir) {
      const s = String(saveDir).includes('\\') ? '\\' : '/'
      candidates.push(`${String(saveDir).replace(/[\\/]+$/, '')}${s}${base}.smm`)
    }
  } catch { /* 保存目录不可用时忽略 */ }

  const seen = new Set()
  for (const p of candidates) {
    if (!p || seen.has(p)) continue
    seen.add(p)
    try {
      const r = await window.electronAPI?.fs?.exists?.(p)
      if (r && r.exists) return p
    } catch { /* 单个候选查询失败继续下一个 */ }
  }
  return ''
}

/**
 * 判断一份 Markdown 是否「像导图大纲」：有层级结构且不是平铺长文。
 * 命中则视为导图导出物，可以还原成思维导图编辑。
 * @returns {Promise<object|null>} 解析出的导图树，不像导图时返回 null
 */
export async function parseMindMapLikeOutline(mdText) {
  const text = String(mdText || '')
  if (!text.trim()) return null
  try {
    const { parseMarkdownToTree } = await import('./markdownParser')
    const tree = parseMarkdownToTree(text)
    if (!tree || typeof tree !== 'object') return null

    let nodes = 0
    let maxDepth = 1
    const walk = (node, depth) => {
      if (!node) return
      nodes++
      if (depth > maxDepth) maxDepth = depth
      for (const child of node.children || []) walk(child, depth + 1)
    }
    walk(tree, 1)

    // 至少 3 个节点，且具备真正的层级（三级以上结构，或含 2 个以上标题）
    const headings = (text.match(/^[ \t]{0,3}#{1,6}[ \t]+\S/gm) || []).length
    if (nodes >= 3 && (maxDepth >= 3 || headings >= 2)) return tree
    return null
  } catch {
    return null
  }
}

/**
 * 解析引用的最终动作
 * @param {string} filePath 引用指向的文件路径
 * @param {{ mdText?: string }} opts mdText：调用方已读到的 md 内容，传入可省一次读文件
 * @returns {Promise<{action: 'edit'|'view', filePath: string, source: 'self'|'md'|'md-outline', tree: object|null}>}
 *   action='edit'  → 思维导图，可编辑（filePath 为实际要打开的导图路径；
 *                    source='md-outline' 时 tree 已解析好，调用方落盘为 .smm 后打开）
 *   action='view'  → 只读文档，用文档查看器打开
 */
export async function resolveRefAction(filePath, opts = {}) {
  const kind = getRefKind(filePath)

  if (kind === 'mindmap') {
    return { action: 'edit', filePath, source: 'self', tree: null }
  }

  if (kind === 'markdown') {
    // 1) 已存在同名导图：直接编辑那份导图，不新建文件
    const smm = await findMarkdownSourceMap(filePath)
    if (smm) return { action: 'edit', filePath: smm, source: 'md', tree: null }

    // 2) 内容本身是导图大纲：由调用方落盘为同名 .smm 后编辑（原 md 保持不变）
    let text = opts.mdText
    if (typeof text !== 'string') {
      try {
        text = await window.electronAPI?.fs?.readFile?.(filePath)
      } catch {
        text = ''
      }
    }
    const tree = await parseMindMapLikeOutline(typeof text === 'string' ? text : '')
    if (tree) {
      return { action: 'edit', filePath, source: 'md-outline', tree, mdText: String(text || '') }
    }

    // 3) 普通 Markdown：只读查看
    return { action: 'view', filePath, source: 'md', tree: null }
  }

  return { action: 'view', filePath, source: 'self', tree: null }
}

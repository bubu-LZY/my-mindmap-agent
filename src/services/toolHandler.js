/**
 * AI 工具调用处理器
 * 定义 AI 可用的工具（OpenAI function calling 格式）和处理函数
 * 覆盖思维导图编辑器的全部核心功能
 */

import { parseMarkdownToTree, treeToMarkdown } from '../utils/markdownParser'
import { createUid, checkIsNodeStyleDataKey } from 'simple-mind-map/src/utils'
import { treeToText, getNodePath, countNodes, getMaxDepth, treeToSkeletonText, treeToUidList } from '../utils/treeUtils'
import { searchWeb, readWebpage, aiService } from './aiService'
import { searchService } from './searchService'
import { applyTextStyleToNodes, applyTextStyleToTextRanges, analyzeNodeTextStyles, copyRichTextStyles, colorNameToFamily, applyTextStyleToTextRangesByColor, normalizeTextColor, normalizeHighlightColor, normalizeNodeFillColor } from '../utils/textStyle'
import { addMemoryFact, getMemoryFacts, removeMemoryFact } from '../utils/aiMemory'
// review #1：持久记忆工具（基于 utils/memoryStore.js）
import { addMemory, searchMemory, listMemory, deleteMemory, toggleMemory } from '../utils/memoryStore'
// review #5：对原文本快照（在改写前留下原内容供用户对照）
import { snapshotBeforeTextChange } from '../utils/nodeSnapshot'
import { taskSchedulerService } from './taskSchedulerService'
import {
  getReviewPlan, getToday, CYCLES, isInReviewPlan,
  removeByFilePath, removeByNodeUid, clearReviewPlan,
  markCycleCompleted, markCycleUncompleted
} from '../utils/reviewPlan'
import {
  toggleAllCloze, toggleClozeByUid, setAllClozeHidden, setNodesClozeHidden, isClozeHiddenAll,
  nodeHasCloze, isUidClozeHidden, clearNodeCloze, clearNodeClozePartial, applyClozeStyles, setGlobalClozeHidden
} from '../utils/cloze'
import { useMindMapStore } from '../stores/mindMapStore'
import { parseDocument, chunkText } from './docParseService'
import { pdfToImages } from '../utils/pdfToImage'
import { listAllContextWindows, queryContextWindow, setContextWindow, deleteContextWindow } from '../utils/contextWindow'
import { parseOpmlToTree, parseFreemindToTree } from '../utils/xmlOutlineParser'
import { parseXmindBase64 } from '../utils/xmindParser'
import { isReferenceLink, parseReferenceLink, fileExists as refFileExists, scanFiles as refScanFiles } from './referenceService'
import { injectInteractiveSvg, buildInteractiveHtml } from '../utils/svgExport'
import { buildTriModeHtml } from '../utils/triModeExport'
import { renderSvgFromData } from '../utils/offscreenRender'
import { safeExportSvg } from '../utils/safeExportSvg'
import { uploadFileForProvider } from './fileUploadService'

// review L-7：代码文件扩展名公共常量。read_local_file 与 retrieve_local_file 共用一份，
// 避免两份独立维护造成不一致（之前 read_local_file 多 bash/zsh，retrieve_local_file 缺）。
const COMMON_CODE_EXTS = [
  'py', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'vue',
  'sh', 'bash', 'zsh',
  'rb', 'go', 'rs', 'java', 'kt', 'swift',
  'c', 'cpp', 'cc', 'h', 'hpp', 'cs', 'php', 'scala',
  'sql', 'yaml', 'yml', 'toml', 'ini', 'conf',
  'gradle', 'groovy', 'lua', 'perl', 'pl', 'r', 'dart'
]

// 中文别名映射：把常见中文意图词翻译成英文关键词，用于 activate_tools / semantic_tool_search 的中文匹配
// 覆盖：飞书/微信/导出/挖空/复习/定时/知识库/云盘/图片/搜索/布局/样式等高频领域
export const TOOL_ALIAS_MAP = {
  '飞书': ['feishu'], '飞书云文档': ['feishu'], '飞书云盘': ['feishu'], '飞书文档': ['feishu'], '飞书文件': ['feishu'], '云文档': ['feishu'], '云盘': ['feishu'], '云空间': ['feishu'],
  '微信': ['wechat'], '企业微信': ['wechat'],
  '导出': ['export'], '导入': ['import'],
  '挖空': ['cloze'], '填空': ['cloze'], '背诵': ['recite'], '记忆': ['recite'],
  '复习': ['review'], '复习计划': ['review'],
  '定时': ['scheduled'], '定时任务': ['scheduled'],
  '知识库': ['knowledge'], '语义搜索': ['semantic'],
  '图片': ['image'], '图像': ['image'], '截图': ['image'],
  '搜索': ['search'], '联网': ['web'], '网页': ['web'],
  '布局': ['layout'], '样式': ['style'], '主题': ['theme'], '视图': ['view'], '大纲': ['outline'], '关联图': ['graph'],
  '思维导图': ['mindmap'], '导图': ['mindmap']
}

// 根据中文别名扩展出英文关键词集合（用于工具检索匹配）
function expandAliasKeywords(keyword) {
  const out = [keyword]
  for (const [zh, enList] of Object.entries(TOOL_ALIAS_MAP)) {
    if (keyword.includes(zh)) out.push(...enList)
  }
  return [...new Set(out)]
}

/**
 * 通过 files API 多模态读取本地文件（PDF / 图片等）
 * 优先调用视觉模型直读；未配置 / 上传失败 / 调用失败时返回 null，由调用方降级到本地文档解析或 OCR。
 * @param {string} filePath 本地文件绝对路径
 * @param {string} fileName 文件名（含扩展名）
 * @param {string} mimeType 文件 MIME 类型
 * @param {string} readPrompt 提取指令
 * @returns {Promise<{ text: string, source: string } | null>}
 */
async function readLocalFileViaVisionAPI(filePath, fileName, mimeType, readPrompt) {
  let visionOverride = null
  if (window.electronAPI && window.electronAPI.getVisionConfig) {
    try {
      const vc = await window.electronAPI.getVisionConfig()
      if (vc && vc.available && vc.baseURL && vc.model) {
        visionOverride = {
          baseURL: vc.baseURL,
          profileId: vc.profileId || '',
          model: vc.model,
          autoComplete: vc.autoComplete !== false,
          filesURL: vc.filesURL || ''
        }
      }
    } catch { /* 查询失败按未配置处理 */ }
  }
  if (!visionOverride) return null

  if (!window.electronAPI?.fs?.readBinary) return null
  const r = await window.electronAPI.fs.readBinary(filePath)
  if (!r || !r.success || !r.base64) return null

  const up = await uploadFileForProvider({
    baseURL: visionOverride.baseURL,
    profileId: visionOverride.profileId,
    fileName: fileName || filePath.split(/[\\/]/).pop() || 'file',
    mimeType,
    base64: r.base64,
    customFilesURL: visionOverride.filesURL || ''
  })
  if (!up || !up.success || !up.ref) return null

  const systemPrompt = '你是文档内容提取助手，请忠实、完整地提取文件中的文字内容；若是扫描版或图片，先识别文字再输出。不要添加解释、前言或总结。'
  const choice = await aiService.chat(
    [{ type: 'text', text: readPrompt }, up.ref],
    systemPrompt,
    null,
    { configOverride: visionOverride }
  )
  const outText = String(choice?.message?.content || '').trim()
  if (!outText) return null

  return { text: outText, source: `多模态识别（files API ${mimeType}）` }
}

// 共享：文字级富文本样式参数（set_node_style / batch_node_actions / batch_text_style 通用）
const richTextStyleProps = {
  textColor: { type: 'string', description: 'Text color; any color name/hex is normalized to the app palette (e.g. #007aff blue)' },
  highlightColor: { type: 'string', description: 'Text highlight background color; normalized to the app palette (e.g. rgba(255,230,0,0.25) yellow)' },
  bold: { type: 'boolean', description: 'Bold: true=on, false=off' },
  italic: { type: 'boolean', description: 'Italic: true=on, false=off' },
  underline: { type: 'boolean', description: 'Underline: true=add, false=remove' },
  strikethrough: { type: 'boolean', description: 'Strikethrough: true=add, false=remove' },
  fontFamily: { type: 'string', description: 'Font family (e.g. "Microsoft YaHei", "SimSun", "KaiTi")' },
  textFontSize: { type: 'number', description: 'Font size in px (e.g. 16)' }
}

// 共享：目标节点集合参数（uids / keyword / mode）
const targetNodesProps = {
  uids: { type: 'array', items: { type: 'string' }, description: 'Node uid list (get from search_nodes, or from the nodes field returned by generate_mindmap/import_file_as_mindmap)' },
  keyword: { type: 'string', description: 'Keyword: matches all nodes whose text contains it' },
  mode: { type: 'string', enum: ['leaves', 'leaf_parents', 'all', 'level_range'], description: 'all=all nodes; leaves=all leaf nodes; leaf_parents=parents of all leaf nodes; level_range=filter by minDepth/maxDepth' },
  minDepth: { type: 'number', description: 'Only keep nodes at this depth or deeper. Root=0, level-1 children=1, level-2 children=2. Example: minDepth=1 excludes root.' },
  maxDepth: { type: 'number', description: 'Only keep nodes at this depth or shallower. Example: maxDepth=2 means root, level 1 and level 2 only.' },
  includeChildren: { type: 'boolean', description: 'Also cover all descendants of keyword/uids matched nodes (e.g. to style a whole branch at once); default false' }
}

const escHtml = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function ensureRichText(node) {
  if (!node) return
  if (!node.data) node.data = {}
  if (!node.data.uid) node.data.uid = createUid()
  if (!node.data.richText) node.data.richText = true
  if (node.data.text && !node.data.text.startsWith('<')) {
    node.data.text = `<p><span>${escHtml(node.data.text)}</span></p>`
  }
  if (!node.data.text) {
    node.data.text = '<p><span></span></p>'
  }
  if (node.children) {
    node.children = node.children.filter(c => c && c.data)
    node.children.forEach(ensureRichText)
  }
}

// 导出后按需在资源管理器中定位文件（export_* 工具的 open_folder 参数）
const revealIfAsked = async (args, filePath) => {
  if (!args?.open_folder || !filePath) return
  try {
    if (window.electronAPI?.fs?.showInFolder) await window.electronAPI.fs.showInFolder(filePath)
  } catch { /* 打开资源管理器失败不影响导出结果 */ }
}

// 生成/导入导图后构建 uid 映射（文本 + 结构化数组），供 AI 直接引用 uids，避免反复 search_nodes
function buildUidMap(treeData, maxCount = 200) {
  const { list, truncated, total } = treeToUidList(treeData, maxCount)
  const text = list.map(n => `${n.uid} | ${n.path}`).join('\n')
  return { nodes: list, list, text, truncated, total }
}

// 把生成的导图保存为新 .smm 文件；只落盘，不改动任何已打开画布。
const saveGeneratedMindmap = async (treeData, fallbackName) => {
  const rawRootText = treeData?.data?.text || ''
  const rootText = rawRootText.replace(/<[^>]+>/g, '').trim() || fallbackName
  const safeName = rootText.replace(/[<>:"/\\|?*]/g, '_').slice(0, 50)
  const fileName = `${safeName}.smm`
  const saveData = JSON.stringify(treeData, null, 2)
  if (window.electronAPI?.saveFile) {
    const result = await window.electronAPI.saveFile(fileName, saveData)
    if (result && result.success) return { filePath: result.filePath, fileName }
  }
  return { filePath: null, fileName }
}

// 工具目录（用于 query_tools 返回）
const toolCatalog = [
  { name: 'generate_mindmap', category: 'Mindmap', desc: 'Generate a BRAND-NEW mindmap from Markdown content and auto-save as .smm to the default save dir. Only for pasted/new content — do NOT use it to edit or restructure an existing map (use update_node_text / batch_node_actions / delete_node / merge_nodes / insert_parent_node instead).' },
  { name: 'get_mindmap_content', category: 'Mindmap', desc: 'Get full content of the current mindmap (plain text)' },
  { name: 'get_mindmap_info', category: 'Mindmap', desc: 'Get stats of the current mindmap (node count, depth, etc.)' },
  { name: 'save_mindmap', category: 'Mindmap', desc: 'Save the current mindmap to a file' },
  { name: 'new_mindmap', category: 'Mindmap', desc: 'Create a new blank mindmap' },
  { name: 'expand_node', category: 'Node Ops', desc: 'Add child/sibling nodes with plain texts to target nodes (targets supported; omit = current selection)' },
  { name: 'add_child_nodes', category: 'Node Ops', desc: 'Add AI-generated child nodes (multi-level subtree) to target parents in ONE call; ask user for levels (default <=3) and reference materials first' },
  { name: 'update_node_text', category: 'Node Ops', desc: 'Update node text: per-node updates=[{uid,text}] in one call, or same text on targets/selection' },
  { name: 'delete_node', category: 'Node Ops', desc: 'Delete nodes: targets (uids/keyword/mode) deletes all matched in one call; omit = delete current selection' },
  { name: 'select_node', category: 'Node Ops', desc: 'Batch-select nodes: keyword matches all / uids list / structural mode (leaf_parents=parents of leaves, leaves=leaves); other tools then act on all selected at once' },
  { name: 'insert_parent_node', category: 'Node Ops', desc: 'Insert a parent node above given nodes: targets (uids/keyword/mode) inserts one per matched node; omit = selected node' },
  { name: 'set_node_style', category: 'Node Ops', desc: 'Batch-set node styles (color, highlight, bold, italic, underline, strikethrough, font, size, fill, shape); returns the actually-applied count' },
  { name: 'batch_text_style', category: 'Node Ops', desc: 'Batch-set rich-text styles on matched text snippets inside nodes (substring or regex), e.g. bold/red all 【】 content map-wide' },
  { name: 'batch_node_actions', category: 'Node Ops', desc: 'Batch node operations (first choice for multi-node tasks): one call picks nodes per step via targets (uids/keyword/mode) and finishes style setting, smart cloze, etc. in batches; no need to select_node first' },
  { name: 'summarize_node', category: 'Node Ops', desc: 'Add a summary (generalization) to nodes: targets (uids/keyword/mode) adds same summary to all matched in one call; omit = selected node' },
  { name: 'search_nodes', category: 'Node Ops', desc: 'Search nodes containing a keyword (results include path/uid/parent info)' },
  { name: 'query_nodes', category: 'Node Ops', desc: 'Advanced node query with rich filters (text/style/cloze/structure). Replaces multiple search_nodes+query_node_styles. Returns uid, text, clozeWords, path, depth.' },
  { name: 'find_replace_text', category: 'Edit', desc: 'Find & replace text across nodes (literal or regex, preview supported, formatting preserved, scope via targets uids/keyword/mode)' },
  { name: 'change_layout', category: 'View', desc: 'Switch layout structure' },
  { name: 'set_theme', category: 'View', desc: 'Switch theme style' },
  { name: 'switch_view', category: 'View', desc: 'Switch view mode (outline/mindmap/review)' },
  { name: 'zoom_control', category: 'View', desc: 'Zoom the canvas' },
  { name: 'undo', category: 'Edit', desc: 'Undo the last operation' },
  { name: 'redo', category: 'Edit', desc: 'Redo the last undone operation' },
  { name: 'export_mindmap', category: 'Export', desc: 'Export the mindmap to a given format (saved straight to the default save dir, no dialog). Note: "export/save the map" means the .smm file, not an image' },
  { name: 'upload_to_feishu', category: 'Feishu', desc: 'Save the current mindmap as .smm and upload it to Feishu Drive (uploads the mindmap file itself, not an image or plain doc)' },
  { name: 'upload_mindmap_to_feishu_doc', category: 'Feishu', desc: 'Convert the current mindmap to a Feishu online doc (node levels become heading levels) and upload; returns a doc link' },
  { name: 'upload_file_to_feishu', category: 'Feishu', desc: 'Upload a given local file of any format to Feishu Drive; returns file token and link' },
  { name: 'feishu_list_files', category: 'Feishu', desc: 'List files and folders in a Feishu Drive folder (default root "我的空间")' },
  { name: 'feishu_get_doc_content', category: 'Feishu', desc: 'Get the plain text of a Feishu online doc (docx)' },
  { name: 'feishu_delete_file', category: 'Feishu', desc: 'Delete a file in Feishu Drive (moved to trash)' },
  { name: 'feishu_rename_file', category: 'Feishu', desc: 'Rename a file in Feishu Drive' },
  { name: 'send_feishu_message', category: 'Push', desc: 'Send a text message to a Feishu group chat (default push chat, or a named chat); use when the user says push to Feishu' },
  { name: 'send_wechat_message', category: 'Push', desc: 'Send a text message to WeChat (default contact = the WeChat user who last chatted with the bot); use when the user says push to WeChat' },
  { name: 'send_wechat_image', category: 'Push', desc: 'Send an image file to WeChat (default contact); use when the user wants to send an image to WeChat; filePath = local image path' },
  { name: 'send_feishu_image', category: 'Push', desc: 'Send an image file to a Feishu group chat (default push chat, or a named chat); use when the user wants to send an image to Feishu; filePath = local image path' },
  { name: 'send_wechat_file', category: 'Push', desc: 'Send a file (any format like PDF/Excel, ≤30MB) to WeChat (default contact); use when the user wants to send a file to WeChat; filePath = local file path' },
  { name: 'send_feishu_file', category: 'Push', desc: 'Send a file (any format like PDF/Excel, ≤30MB) to a Feishu group chat (default push chat, or a named chat); use when the user wants to send a file to Feishu; filePath = local file path' },
  { name: 'delete_local_file', category: 'File', desc: 'Delete a file on the local disk (to system trash or permanently). Use when the user asks to delete a local mindmap file / local file; always confirm with the user first' },
  // 编辑外部文档（任何格式：JSON / Markdown / 代码 / txt / csv 等纯文本类文件）
  { name: 'edit_local_file', category: 'File', desc: 'Edit a local text file in place (JSON / Markdown / code / txt / csv / etc). Use when the user wants to modify the content of an external file. Supports two modes: (1) replace_in_file (precise old_text → new_text, safest); (2) write_full_file (overwrite entire file). Auto-creates the file if it does not exist when write_full_file is used' },
  { name: 'append_local_file', category: 'File', desc: 'Append content to the end of a local text file. Use when the user wants to add new lines / entries without overwriting existing content (e.g. append to a log, list, CSV row). Auto-creates the file if it does not exist' },
  { name: 'read_local_file_lines', category: 'File', desc: 'Read a specific line range of a local text file (start_line / end_line, 1-based, inclusive). Use for large files when only a small section needs to be viewed' },
  // 代码执行 / 部署（路径 A：主进程新增 shell:exec / shell:spawn IPC，binary 走白名单）
  { name: 'run_shell', category: 'Shell', desc: 'Run an allowed command on the local machine (synchronous, up to 10 minutes). Allowed binaries: node/npm/npx/pnpm/yarn/python/python3/pip/git/cmd/powershell/go/rustc/cargo/make/docker etc. cwd must be inside an allowed directory (userData / temp / open-file-dir / desktop / downloads / documents). Returns stdout / stderr / exitCode.' },
  { name: 'run_node', category: 'Shell', desc: 'Run a local Node.js script: pass script_path (absolute) and optional args. Equivalent to `node script_path [args]`' },
  { name: 'run_python', category: 'Shell', desc: 'Run a local Python script: pass script_path (absolute) and optional args. Equivalent to `python script_path [args]`' },
  { name: 'spawn_shell', category: 'Shell', desc: 'Spawn a long-running command as a background job (e.g. dev server). Returns a handle to subscribe stdout/stderr/exit via shell events. Use shell:kill(handle) to terminate.' },
  { name: 'shell_get_env', category: 'Shell', desc: 'Read whitelisted environment variables (PATH / NODE_ENV / PYTHONPATH etc). Other env vars are blocked for security.' },
  { name: 'clear_mindmap', category: 'Edit', desc: 'Clear all nodes of the current mindmap, keeping one empty root (confirm with the user before clearing)' },
  { name: 'ai_continue_children', category: 'AI', desc: 'AI continue children: AI generates child nodes and attaches them for the selected node (or the whole map with scope=root); depth per user request, default 2~5, max 6; keeps original text; Ctrl+Z undoable' },
  { name: 'ai_recite_rewrite', category: 'AI', desc: 'AI recitation rewrite: 【memory shorthand】+summary; short original text is preserved verbatim, longer text summarized; natural homophones only; targets (uids/keyword/mode) sets rewrite scope; Ctrl+Z undoable' },
  { name: 'ai_cloze', category: 'AI', desc: 'AI smart cloze: pick keywords to blank out (fill-in-blank) for one or more selected nodes, keeping context clues for review' },
  { name: 'mechanical_cloze', category: 'AI', desc: 'Mechanical cloze: blank every occurrence of an exact text/regex in target nodes directly, without AI analysis' },
  { name: 'ai_cloze_full_map', category: 'AI', desc: 'AI full-map cloze: blank keywords across the whole opened map (all nodes), ignoring selection; for full self-test review' },
  { name: 'parallel_ai_workers', category: 'AI', desc: 'Split a heavy AI job into multiple independent subtasks and run them concurrently, then aggregate the results; use for large map generation/rewrite/cloze/content production' },
  { name: 'add_to_review', category: 'Study', desc: 'Add nodes to the review plan: targets (uids/keyword/mode) adds all matched in one call; omit = current selection; already-planned nodes skipped' },
  { name: 'get_review_schedule', category: 'Study', desc: 'Query the review plan by date or date range and memory cycle (1/3/7/15/31 days), with completion status and overdue items; always query this tool for review questions; vague mentions of 任务/计划/安排 (e.g. 本周任务) usually mean this review plan, not scheduled_task; convert relative time words like 今天/明天/昨天 to YYYY-MM-DD before passing date/start_date/end_date' },
  { name: 'get_today_review_status', category: 'Study', desc: 'Get the review plan and completion status for today (list + progress stats); export=true also saves a Markdown file to the default save dir' },
  { name: 'complete_review_task', category: 'Study', desc: 'Review check-in: mark today-due (or given cycle/date) review items remembered/forgot; single item or all at once; supports checking in future dates early. Works with the id and cycle from get_today_review_status' },
  { name: 'delete_review_plan', category: 'Study', desc: 'Delete review-plan tasks: by filePath (all tasks of that file), by nodeUid (single task), or all=true for everything; asks the user to confirm before executing' },
  { name: 'toggle_cloze_visibility', category: 'Study', desc: 'Toggle cloze answer show/hide (whole map or given nodes) for recitation self-test' },
  { name: 'list_cloze_nodes', category: 'Study', desc: 'List all nodes with cloze marks (uid, text, visibility)' },
  { name: 'clear_cloze', category: 'Study', desc: 'Clear cloze marks via targets (uids/keyword/mode, all=whole map); supports before/after to only clear one side of a delimiter; undoable' },
  { name: 'ai_quiz', category: 'AI', desc: 'AI quiz into a new map file: generate self-test questions (single/multiple/short answer) from selected nodes/subtree/whole map, saved as 主题【AI出题】.smm next to the source map; answers and explanations auto-cloze-hidden, click to reveal; current map untouched; use when the user wants questions in a new file' },
  { name: 'ai_quiz_append', category: 'AI', desc: 'AI quiz appended: generate one question per selected node (fill-blank or choice by default) and append 【question+answer+explanation】 merged as one new child node; type tag 【选择】【填空】 bold blue; answer and explanation each on one line, auto-cloze-hidden; original untouched; one batch call; Ctrl+Z undoable' },
  { name: 'audit_mindmap', category: 'Mindmap', desc: 'Audit map structure and quality without modifying it' },
  { name: 'refactor_mindmap', category: 'Mindmap', desc: 'Safe mindmap refactor with dry-run and safe fixes' },
  { name: 'reorganize_mindmap', category: 'Mindmap', desc: 'Reorganize the current mindmap into a more rational framework and save as a NEW .smm file (original node text strictly preserved, only structure regrouped)' },
  { name: 'research_to_mindmap', category: 'Research', desc: 'Research a topic and generate a cited mindmap with verified sources' },
  { name: 'search_web', category: 'Web', desc: 'Web search for real-time info' },
  { name: 'read_webpage', category: 'Web', desc: 'Read the full body text of a webpage (follow up web search when the summary is not enough)' },
  { name: 'get_location', category: 'Web', desc: 'Get the current location (IP-based, free, no key) so weather/local search matches the actual city' },
  { name: 'search_knowledge_base', category: 'KB', desc: 'Search content and filenames of all indexed mindmap files and documents (PDF/DOCX/XLSX/CSV/MD/TXT auto-indexed); cross-file node and chunk search' },
  { name: 'semantic_search', desc: 'Semantic search: retrieve similar files, nodes and document chunks from the local SQLite knowledge base (BM25 Chinese ranking) using multiple AI-intent keywords', category: 'KB' },
  { name: 'semantic_tool_search', category: 'Discovery', desc: 'Semantically find the best tool, custom tool, MCP server, or Skill for the user request (unified local scoring)' },
  { name: 'read_mindmap_file', category: 'KB', desc: 'Read the content of a mindmap file at a given path' },
  { name: 'read_node_image', category: 'KB', desc: 'Recognize text/content in the image attached to a mindmap node (multimodal first, local OCR fallback)' },
  { name: 'activate_tools', category: 'Meta', desc: 'Activate tools by names list OR by keyword (auto-finds matching tools from the catalog, activates them, and returns their full parameter definitions); without params returns the full catalog. Only a subset of tools is active by default; inactive tools MUST be activated with this tool first' },
  { name: 'list_mcp_servers', category: 'MCP', desc: 'List configured MCP servers (id, name, transport, url/command, enabled)' },
  { name: 'list_mcp_tools', category: 'MCP', desc: 'List tools exposed by one MCP server' },
  { name: 'mcp_call_tool', category: 'MCP', desc: 'Call a tool on a configured MCP server' },
  { name: 'update_mcp_server', category: 'MCP', desc: 'Update a configured MCP server (name/url/command/args/env/headers/enabled/transport)' },
  { name: 'list_custom_tools', category: 'Custom', desc: 'List custom tools placed in the custom-tools directory' },
  { name: 'call_custom_tool', category: 'Custom', desc: 'Call a custom tool by id' },
  { name: 'update_custom_tool', category: 'Custom', desc: 'Update a custom tool (name/description/enabled/autoInvoke)' },
  { name: 'list_skills', category: 'Skills', desc: 'List saved skills (name, description, enabled, autoInvoke)' },
  { name: 'get_skill', category: 'Skills', desc: 'Get one saved skill including its full instructions' },
  { name: 'invoke_skill', category: 'Skills', desc: 'Invoke a saved skill by returning its full instructions for immediate execution' },
  { name: 'create_skill', category: 'Skills', desc: 'Create or update a reusable skill from a successful workflow or known pitfall' },
  { name: 'update_skill', category: 'Skills', desc: 'Update an existing skill' },
  { name: 'delete_skill', category: 'Skills', desc: 'Delete a saved skill' },
  { name: 'context_window', category: 'Context', desc: 'Per-model context window table: list, get one, set override, delete override' },
  { name: 'move_node', category: 'Node Ops', desc: 'Move a node under another node (cross-branch restructure); Ctrl+Z undoable' },
  { name: 'batch_move_nodes', category: 'Node Ops', desc: 'Move multiple nodes under one parent in one call (targets + target_parent_uid); Ctrl+Z undoable' },
  { name: 'duplicate_nodes', category: 'Node Ops', desc: 'Clone nodes (with subtrees) under a target parent; fresh uids; Ctrl+Z undoable' },
  { name: 'sort_children', category: 'Node Ops', desc: 'Sort the direct children of a node (text / reverse / custom uid order)' },
  { name: 'read_node_subtree', category: 'Node Ops', desc: 'Read the full subtree content of one node as indented text (uid or keyword)' },
  { name: 'get_node_detail', category: 'Query', desc: 'Inspect one node: text/uid/parent/children/styles/note/cloze/summary' },
  { name: 'rename_mindmap_file', category: 'File', desc: 'Rename the currently open .smm file on disk' },
  { name: 'merge_nodes', category: 'Node Ops', desc: 'Merge multiple nodes into one (text concat, children merged); NOT undoable with Ctrl+Z' },
  { name: 'focus_node', category: 'Node Ops', desc: 'Locate a node on the canvas (scroll to center and highlight); param uid or keyword' },
  { name: 'query_node_styles', category: 'Query', desc: 'Style audit: find what got color/bold/italic/underline/strikethrough/fontSize/cloze/fill/note/outer-frame; returns a uid list for locating' },
  { name: 'set_node_note', category: 'Node Ops', desc: 'Set/clear node note (hover the icon to view)' },
  { name: 'associative_line', category: 'Assoc', desc: 'Associative lines: add (from/to/text), remove (from/to or all), list' },
  { name: 'outer_frame', category: 'Node Ops', desc: 'Outer frame around sibling nodes: add (targets/config) or remove (targets or all)' },
  { name: 'format_painter', category: 'Style', desc: 'Format painter: copy the source node format onto a target node set; optionally copy text-level styles too' },
  { name: 'merge_mindmap_files', category: 'Mindmap', desc: 'Merge another .smm map file (or a given branch of it) under a node of the current map; cross-file knowledge consolidation' },
  { name: 'export_subtree', category: 'Export', desc: 'Export the selected/given subtree: smm=standalone map file; png/jpg/svg=image (jpg saved as png; saved to default dir and sent into chat); ask the user first if the format is unspecified' },
  { name: 'export_to_markdown', category: 'Export', desc: 'SMM → .md FILE only (saves to default save dir). NEVER call this just because the user said "markdown表格/列表/代码块" in chat — those are inline reply formats, not file exports. Only call when user explicitly asks to save/export/conver the map to a file (导出/保存/转成 md 文件/save as markdown/export markdown). For inline markdown replies, just answer with markdown directly.' },
  { name: 'export_mindmap_html', category: 'Export', desc: 'Map to interactive HTML: single mindmap view, or full-view 3-mode HTML (mindmap+outline+graph); can read a file by path without opening it' },
  { name: 'export_mindmap_pdf', category: 'Export', desc: 'Map to PDF: export the whole mindmap (canvas graphic) as a .pdf file (default save dir)' },
  { name: 'export_outline_pdf', category: 'Export', desc: 'Outline to PDF: typeset the indented outline text into a PDF doc (default save dir), good for printing' },
  { name: 'save_text_file', category: 'Export', desc: 'Save arbitrary generated text/markdown/HTML/JSON content directly to the default save dir. Use whenever the AI has composed a document (e.g. quiz HTML) that should be exported as a file instead of printed in chat' },
  { name: 'find_related', category: 'KB', desc: 'Related content: find things related to a keyword in the local KB and current map, and suggest how to link them into the current map' },
  { name: 'memory', category: 'Memory', desc: 'Long-term memory: save (only for explicit long-term intent), get (list all), forget (delete by id)' },
  { name: 'add_memory', category: 'Memory', desc: 'Add a long-term memory item (review #1). Prefer this over the legacy memory tool: content (text, ≤500 chars), category in (preference|fact|context|instruction), source optional auto|manual. Returns success or error.' },
  { name: 'search_memory', category: 'Memory', desc: 'Search long-term memory by keyword (review #1): query (string), limit optional int (default 8). Returns up to N items with content + category.' },
  { name: 'list_memory', category: 'Memory', desc: 'List long-term memory items (review #1). Optional filters: category (preference|fact|context|instruction), enabledOnly (bool), limit (int). Returns total + items.' },
  { name: 'delete_memory', category: 'Memory', desc: 'Delete a long-term memory item by id (review #1). Use sparingly; usually list_memory first to find the id.' },
  { name: 'toggle_memory', category: 'Memory', desc: 'Enable/disable a long-term memory item by id (review #1). Disabled items are skipped in search_memory and not auto-injected as system context.' },
  { name: 'read_local_file', category: 'KB', desc: 'Read a local document in full: txt/md/json direct, docx/xlsx/xls/csv/tsv/pdf text extraction, images auto-OCR, .smm to outline text; required when analyzing local files the user references' },
  { name: 'retrieve_local_file', category: 'KB', desc: 'Fast semantic retrieval inside a local document: extract text once (cached) then return only the chunks most relevant to the user query; use for large PDF/docx/xlsx/txt instead of reading the whole file' },
  { name: 'list_directory', category: 'File', desc: 'List entries of a local folder (subfolders + files with dates); default = folder of the current file' },
  { name: 'find_local_file', category: 'KB', desc: 'Search local common dirs (Desktop/Documents/Downloads/default save dir/app dir) by filename keyword, returns full paths; use when only the filename is known or a read reports "not found"' },
  { name: 'import_file_as_mindmap', category: 'Mindmap', desc: 'Import an external-format file as a mindmap and save .smm: Markdown/OPML/FreeMind(.mm)/XMind/txt' },
  { name: 'list_references', category: 'Refs', desc: 'Reference list & broken-link check: list @file/#node references in the current map (or all files) and verify the referenced file/node still exists' },
  { name: 'scheduled_task', category: 'Scheduler', desc: 'AI scheduled tasks: create / list / update / delete (action param)' },
]


// ============ 容错 JSON 解析（review 修复：AI 出题返回被 max_tokens 截断时仍能尽量提取题目） ============
function parseQuizResponse(raw) {
  if (!raw) return []
  const trimmed = String(raw).trim()
  if (!trimmed) return []

  // 栈式闭合：按 LIFO 顺序补齐未闭合的字符串/数组/对象（review 修复：处理被 max_tokens 截断的不完整 JSON）
  function heal(text) {
    const stack = []
    let inStr = false, strCh = '', esc = false
    for (let i = 0; i < text.length; i++) {
      const ch = text[i]
      if (inStr) {
        if (esc) { esc = false; continue }
        if (ch === String.fromCharCode(92)) { esc = true; continue }
        if (ch === strCh) inStr = false
        continue
      }
      if (ch === '"' || ch === "'") { inStr = true; strCh = ch; continue }
      if (ch === '{' || ch === '[') stack.push(ch)
      else if (ch === '}' || ch === ']') {
        if (stack.length) {
          const top = stack[stack.length - 1]
          if ((ch === '}' && top === '{') || (ch === ']' && top === '[')) stack.pop()
        }
      }
    }
    let suffix = ''
    if (inStr) suffix += strCh
    while (stack.length) {
      const t = stack.pop()
      suffix += (t === '{' ? '}' : ']')
    }
    return text + suffix
  }

  function extractQs(p) {
    if (Array.isArray(p)) return p.filter(function (q) { return q && q.question })
    if (p && Array.isArray(p.questions)) return p.questions.filter(function (q) { return q && q.question })
    return []
  }

  // 1) 完整解析
  try { return extractQs(JSON.parse(trimmed)) } catch (e) {}

  const first = trimmed.indexOf('{')
  if (first < 0) return []

  // 2) 从末尾倒数找最近的 '}' 切片再尝试 heal
  for (let end = trimmed.length; end > first; end--) {
    if (trimmed[end - 1] !== '}') continue
    const sub = trimmed.slice(first, end)
    try { return extractQs(JSON.parse(sub)) } catch (e) {}
    try { return extractQs(JSON.parse(heal(sub))) } catch (e) {}
  }

  // 3) per-object salvage：从最外层每个 {...} 拉出来单独 parse，无法解析的通过 heal 修复
  const out = []
  let depth = 0, start = -1, inStr2 = false, strCh2 = '', esc2 = false
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i]
    if (inStr2) {
      if (esc2) { esc2 = false; continue }
      if (ch === String.fromCharCode(92)) { esc2 = true; continue }
      if (ch === strCh2) inStr2 = false
      continue
    }
    if (ch === '"') { inStr2 = true; strCh2 = '"'; continue }
    if (ch === '{') {
      if (depth === 0) start = i
      depth++
    } else if (ch === '}') {
      depth--
      if (depth === 0 && start >= 0) {
        const objStr = trimmed.slice(start, i + 1)
        try {
          const obj = JSON.parse(objStr)
          if (obj && obj.question) out.push(obj)
        } catch (e) {}
        start = -1
      }
    }
  }
  // 还残留未闭合的顶层对象 → heal 后再试
  if (depth > 0 && start >= 0) {
    const objStr = trimmed.slice(start)
    try {
      const obj = JSON.parse(heal(objStr))
      if (obj && obj.question) out.push(obj)
    } catch (e) {}
  }
  return out
}






// 工具调度元数据：不随 OpenAI tools schema 发给模型，避免供应商拒绝未知字段；调度器用它在本地决策。
export const TOOL_METADATA = {
  search_web: { cost: 'high', risk: 'low', cacheable: true, readOnly: true, maxCallsPerTask: 2, timeoutMs: 6000 },
  read_webpage: { cost: 'medium', risk: 'low', cacheable: true, readOnly: true, maxCallsPerTask: 4, timeoutMs: 8000 },
  get_location: { cost: 'low', risk: 'low', cacheable: true, readOnly: true, maxCallsPerTask: 1 },
  search_knowledge_base: { cost: 'low', risk: 'low', cacheable: true, readOnly: true },
  semantic_search: { cost: 'medium', risk: 'low', cacheable: true, readOnly: true },
  audit_mindmap: { cost: 'low', risk: 'low', cacheable: true, readOnly: true },
  refactor_mindmap: { cost: 'high', risk: 'medium', cacheable: false, readOnly: false },
  reorganize_mindmap: { cost: 'high', risk: 'low', cacheable: false, readOnly: false },
  research_to_mindmap: { cost: 'very_high', risk: 'medium', cacheable: false, readOnly: false },
  batch_node_actions: { cost: 'medium', risk: 'medium', cacheable: false, readOnly: false },
  ai_continue_children: { cost: 'high', risk: 'medium', cacheable: false, readOnly: false },
  generate_mindmap: { cost: 'high', risk: 'medium', cacheable: false, readOnly: false }
  ,
  parallel_ai_workers: { cost: 'high', risk: 'low', cacheable: false, readOnly: true }
}
// 工具目录 → 系统提示词紧凑目录（名称+截断描述，按类目分组）。
// 让模型开局即知全部工具名，直接 activate_tools(names) 激活，省掉目录浏览轮次
// 统一语义检索：工具 / 自定义工具 / MCP / Skill 全量注册，本地加权打分。
// 不依赖原生 sqlite-vec：向量或元数据均可在 JS 内计算，后续可无缝接 embedding。
export async function semanticToolSearch(query, limit = 10) {
  const q = String(query || '').trim().toLowerCase()
  if (!q) return []
  const tokens = q.split(/[\s,，、/|]+/).filter(Boolean)
  // 中文别名扩展：把"飞书/导出/挖空/复习"等意图词翻译成英文关键词，避免中文匹配不到工具
  const expanded = []
  for (const t of tokens) expanded.push(...expandAliasKeywords(t))
  const tokensSet = [...new Set(expanded)]

  const builtins = (aiTools || []).map(t => ({
    kind: 'tool',
    id: t.function?.name || '',
    name: t.function?.name || '',
    description: t.function?.description || '',
    enabled: true,
    autoInvoke: false
  })).filter(x => x.id)

  let custom = []
  try {
    custom = ((await window.electronAPI?.customTools?.list?.()) || []).map(t => ({
      kind: 'custom_tool',
      id: t.id,
      name: t.name || t.id,
      description: t.description || '',
      enabled: t.enabled !== false,
      autoInvoke: t.autoInvoke === true
    }))
  } catch (e) { custom = [] }

  let skills = []
  try {
    skills = ((await window.electronAPI?.skills?.list?.()) || []).map(s => ({
      kind: 'skill',
      id: s.id,
      name: s.name || s.id,
      description: s.description || '',
      enabled: s.enabled !== false,
      autoInvoke: s.autoInvoke === true
    }))
  } catch (e) { skills = [] }

  let mcps = []
  try {
    mcps = ((await window.electronAPI?.mcp?.list?.()) || []).map(m => ({
      kind: 'mcp',
      id: m.id,
      name: m.name || m.id,
      description: m.description || `${m.transport || ''} ${m.url || m.command || ''}`.trim(),
      enabled: m.enabled !== false,
      autoInvoke: false
    }))
  } catch (e) { mcps = [] }

  const pool = [...builtins, ...custom, ...skills, ...mcps]
  const scored = pool.map(item => {
    const hay = `${item.name} ${item.description}`.toLowerCase()
    let score = 0
    for (const token of tokensSet) {
      if (item.name.toLowerCase().includes(token)) score += 6
      if ((item.description || '').toLowerCase().includes(token)) score += 3
      if (hay.includes(token)) score += 1
    }
    if (item.enabled === false) score -= 3
    if (item.autoInvoke === true) score += 1
    return { ...item, score }
  }).filter(x => x.score > 0).sort((a, b) => b.score - a.score).slice(0, limit)
  return scored
}

// 工具目录（按类目分组）：设置页"访问令牌管理"勾选每令牌可用工具范围用
export function getToolCatalogForPermissions() {
  return toolCatalog.map(({ name, category, desc }) => ({ name, category, desc }))
}

export function buildToolCatalogText(maxDescLen = 90) {
  const byCat = new Map()
  for (const t of toolCatalog) {
    const cat = t.category || 'Other'
    if (!byCat.has(cat)) byCat.set(cat, [])
    byCat.get(cat).push(t)
  }
  const parts = []
  for (const [cat, tools] of byCat) {
    parts.push(`[${cat}]`)
    for (const t of tools) {
      const desc = t.desc.length > maxDescLen ? t.desc.slice(0, maxDescLen) + '…' : t.desc
      parts.push(`- ${t.name}: ${desc}`)
    }
  }
  return parts.join('\n')
}

// ========== 工具分级注入：默认只激活常用核心工具，其余通过 activate_tools 按需激活 ==========
// 选择依据：覆盖「读导图 → 选中 → 改文本/样式 → 生成 → 保存/撤销 → 检索 → 翻手册」的最短闭环
// 核心工具集：最常用、最可能首轮需要的工具（~15个，约2-3K tokens）
// 其他所有工具（微信/飞书发送、导出导入、挖空、复习、定时任务、样式设置、上下文窗口等）
// 通过 activate_tools(names=[...] 或 keyword) 一次查找+激活
export const CORE_TOOL_NAMES = [
  // 工具发现（必须永远可用）
  'activate_tools',
  'semantic_tool_search',
  // 导图读取
  'get_mindmap_content',
  'get_mindmap_info',
  // 节点基础操作
  'update_node_text',
  'select_node',
  'focus_node',
  'search_nodes',
  'query_node_styles',
  'batch_node_actions',
  'delete_node',
  'insert_parent_node',
  'batch_move_nodes',
  'merge_nodes',
  'outer_frame',
  'rename_mindmap_file',
  'delete_local_file',
  'edit_local_file',
  'append_local_file',
  'read_local_file_lines',
  'run_shell',
  'run_node',
  'run_python',
  'spawn_shell',
  'shell_get_env',
  'list_directory',
  'list_mcp_servers',
  'list_mcp_tools',
  'mcp_call_tool',
  'update_mcp_server',
  'list_custom_tools',
  'call_custom_tool',
  'update_custom_tool',
  'list_skills',
  'get_skill',
  'invoke_skill',
  'create_skill',
  'update_skill',
  'delete_skill',
  // 文件
  'save_mindmap',
  'read_local_file',
  'retrieve_local_file',
  'find_local_file',
  'save_text_file',
  // 搜索
  'search_knowledge_base',
  'read_node_image',
  // 挖空学习（高频，免去工具发现两轮往返）
  'clear_cloze',
  'toggle_cloze_visibility',
  'list_cloze_nodes',
  'ai_cloze',
  'mechanical_cloze',
  'ai_cloze_full_map',
  'ai_recite_rewrite',
  'ai_quiz_append',
  'add_to_review',
  'get_today_review_status',
  'get_review_schedule',
  'complete_review_task',
  'audit_mindmap',
  'refactor_mindmap',
  'reorganize_mindmap',
  'research_to_mindmap',
  'search_web',
  'read_webpage',
  // 生成/扩展（高频AI能力）
  'generate_mindmap',
  'ai_continue_children',
  'parallel_ai_workers',
  // 高频批处理（避免逐节点 select_node 循环的关键工具）
  'add_child_nodes',
  'expand_node',
  'find_replace_text'
]

// 工具名称排序函数（保证工具定义序列化字节一致，最大化前缀缓存命中）
const sortTools = (tools) => tools.slice().sort((a, b) => a.function.name.localeCompare(b.function.name))

export function getCoreTools() {
  return sortTools(getToolsByNames(CORE_TOOL_NAMES))
}

export function getToolsByNames(names) {
  const set = new Set(names)
  return sortTools(aiTools.filter(t => set.has(t.function.name)))
}

// ========== 危险操作清单：执行前统一走二次确认（ChatPanel 弹窗 + 用户白名单） ==========
export const DANGEROUS_TOOLS = {
  new_mindmap: '创建新导图会清空当前画布（未保存内容将丢失）',
  delete_node: '删除选中节点（含全部子孙节点）',
  clear_mindmap: '清空当前思维导图的所有节点（不可撤销）',
  merge_nodes: '合并多个节点（文本拼接、子节点归并），不可用 Ctrl+Z 撤销',
  delete_local_file: '删除本地磁盘文件（不可恢复）',
  delete_review_plan: '删除复习计划任务（按文件/节点/全部）',
  feishu_delete_file: '删除飞书云盘中的文件（移入回收站）',
  upload_to_feishu: '把当前导图上传到飞书云空间（对外发送）',
  upload_mindmap_to_feishu_doc: '把当前导图转为飞书在线文档上传（对外发送）',
  upload_file_to_feishu: '上传本地文件到飞书云盘（对外发送）',
  send_feishu_message: '发送消息到飞书群聊（对外发送）',
  send_wechat_message: '发送消息到微信联系人（对外发送）',
  send_wechat_image: '发送图片到微信联系人（对外发送）',
  send_feishu_image: '发送图片到飞书群聊（对外发送）',
  send_wechat_file: '发送文件到微信联系人（对外发送）',
  send_feishu_file: '发送文件到飞书群聊（对外发送）',
  research_to_mindmap: '生成研究导图会覆盖当前画布（未保存内容将丢失）',
  import_file_as_mindmap: '导入外部文件并打开时会覆盖当前画布（未保存内容将丢失）'
}

// ========== AI 工具定义（OpenAI function calling 格式） ==========
export const aiTools = [
  {
    type: 'function',
    function: {
      name: 'generate_mindmap',
      description: 'Generate a complete mindmap from a topic or content. Pass Markdown content (# = root, ## = level-1 branches, ### = level-2); a mindmap is built and auto-saved as .smm to the default save dir (user can change it via the "设置保存位置" button in the directory tree). This is the primary way to create mindmaps.',
      parameters: {
        type: 'object',
        properties: {
          markdown: { type: 'string', description: 'Mindmap content in Markdown; use # ## ### for levels' }
        },
        required: ['markdown']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_mindmap_content',
      description: 'Get current mindmap content (indented text). Large maps (>150 nodes) return stats + a two-level skeleton by default to save context, deeper levels folded; pass mode=full for complete content; to drill into one branch prefer search_nodes.',
      parameters: {
        type: 'object',
        properties: {
          mode: { type: 'string', enum: ['auto', 'skeleton', 'full'], description: 'auto=full text for small maps / skeleton for large (default), skeleton=force skeleton, full=full text' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_mindmap_info',
      description: 'Get stats of the current mindmap (node count, max depth, etc.)',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'save_mindmap',
      description: 'Save the current mindmap to a file (.smm). Without fileName/save_dir it overwrites the current file in place; to create a NEW file, pass fileName (and optionally save_dir).',
      parameters: {
        type: 'object',
        properties: {
          fileName: { type: 'string', description: 'New file name (no extension) when you want to save as a NEW file' },
          save_dir: { type: 'string', description: 'Save directory (absolute path); empty = default save dir' },
          new_file: { type: 'boolean', description: 'Set true to force saving as a new file instead of overwriting the current file' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'new_mindmap',
      description: 'Create a new blank mindmap',
      parameters: {
        type: 'object',
        properties: {
          rootText: { type: 'string', description: 'Root node text' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'expand_node',
      description: 'Add child or sibling nodes with plain texts. Prefer targets={uids/keyword/mode} to name the parent/sibling nodes directly (NO select_node needed beforehand); omitted targets = all currently selected nodes. For AI-generated multi-level subtrees use add_child_nodes instead (one call, nested children).',
      parameters: {
        type: 'object',
        properties: {
          nodes: { type: 'array', items: { type: 'string' }, description: 'List of node texts to add' },
          direction: { type: 'string', enum: ['child', 'sibling'], description: 'child=child node, sibling=sibling node' },
          targets: {
            type: 'object',
            description: 'Parent/sibling node set (omit = currently selected nodes)',
            properties: targetNodesProps
          }
        },
        required: ['nodes', 'direction']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'add_child_nodes',
      description: 'Add AI-generated multi-level child subtree to target parents in ONE call. Ask user levels (default <=3) and reference materials first, then pass nested children. Never loop expand_node.',
      parameters: {
        type: 'object',
        properties: {
          targets: {
            type: 'object',
            description: 'Parent node set to add children under (uids/keyword/mode); omit = currently selected nodes',
            properties: targetNodesProps
          },
          children: {
            type: 'array',
            description: 'Nested child tree inserted under every parent, e.g. [{text:"A",children:[{text:"A1"},{text:"A2"}]},{text:"B"}]. The children of each item uses the same {text, children} structure recursively.',
            items: {
              type: 'object',
              properties: {
                text: { type: 'string', description: 'Node text' },
                children: {
                  type: 'array',
                  description: 'Next-level child nodes (same nested structure, keep total depth within what the user asked)',
                  items: { type: 'object', description: '{text, children:[...]} recursively' }
                }
              },
              required: ['text']
            }
          },
          afterInsert: { type: 'string', enum: ['select', 'focus', 'none'], description: 'After insertion: select = make new first-level nodes the active selection; focus = also scroll canvas to them; none = keep current selection. Default select' }
        },
        required: ['children']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'update_node_text',
      description: 'Update whole node text. updates=[{uid,text}] sets different text per node in one call; targets+text sets the same text; both omitted = selection. To wrap/decorate existing text use batch_node_actions.wrap_text.',
      parameters: {
        type: 'object',
        properties: {
          updates: {
            type: 'array',
            description: 'Per-node text updates (batch in one call)',
            items: {
              type: 'object',
              properties: {
                uid: { type: 'string', description: 'Node uid' },
                text: { type: 'string', description: 'New text of this node' }
              },
              required: ['uid', 'text']
            }
          },
          text: { type: 'string', description: 'New node text (used with targets / current selection; ignored when updates is given)' },
          targets: {
            type: 'object',
            description: 'Target node set (omit = currently selected nodes; ignored when updates is given)',
            properties: targetNodesProps
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'delete_node',
      description: 'Delete nodes. Pass targets (uids/keyword/mode) to delete ALL matched nodes in one call (no need to select first); omit targets to delete the currently selected nodes. The root node is never deleted. Always confirm with the user before deleting multiple nodes.',
      parameters: {
        type: 'object',
        properties: {
          targets: {
            type: 'object',
            description: 'Which nodes to delete (optional; omit = currently selected)',
            properties: {
              uids: { type: 'array', items: { type: 'string' }, description: 'Node uid list to delete (from search_nodes)' },
              keyword: { type: 'string', description: 'Delete all nodes whose text contains this keyword' },
              mode: { type: 'string', enum: ['leaves', 'leaf_parents', 'all'], description: 'all=all nodes; leaves=all leaf nodes; leaf_parents=parents of all leaf nodes' }
            }
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'select_node',
      description: 'Select nodes in one call: keyword (all matches) / uids (exact list) / mode (leaf_parents, leaves, level_range). Other tools then act on the selection. Never loop per-node.',
      parameters: {
        type: 'object',
        properties: {
          keyword: { type: 'string', description: 'Search keyword: selects all nodes whose text contains it (multiple allowed)' },
          uids: { type: 'array', items: { type: 'string' }, description: 'Node uid list (from search_nodes results); selects exactly these nodes' },
          mode: { type: 'string', enum: ['leaf_parents', 'leaves', 'level_range'], description: 'Structural batch select: leaf_parents=parents of all leaf nodes (deduped); leaves=all leaf nodes; level_range=select nodes by minDepth/maxDepth (root=0)' },
          minDepth: { type: 'number', description: 'For mode=level_range: minimum depth (root=0)' },
          maxDepth: { type: 'number', description: 'For mode=level_range: maximum depth (root=0)' },
          includeChildren: { type: 'boolean', description: 'Also select all descendants of matched nodes; default false' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'insert_parent_node',
      description: 'Insert a parent node above given nodes. Pass targets (uids/keyword/mode) to insert one parent node per matched node in one call; omit targets to insert above the currently selected node.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Parent node text' },
          targets: {
            type: 'object',
            description: 'Which nodes to insert a parent above (optional; omit = currently selected)',
            properties: {
              uids: { type: 'array', items: { type: 'string' }, description: 'Node uid list' },
              keyword: { type: 'string', description: 'All nodes whose text contains this keyword' },
              mode: { type: 'string', enum: ['leaves', 'leaf_parents', 'all'], description: 'all=all nodes; leaves=all leaf nodes; leaf_parents=parents of all leaf nodes' }
            }
          }
        },
        required: ['text']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'set_node_style',
      description: 'Batch-set WHOLE-node styles. targets (uids/keyword/mode) covers all in one call; omit = selection. Text-level: textColor/highlightColor/bold/italic/underline/strikethrough/fontFamily/textFontSize. Node-level: fillColor/shape/fontSize. For partial-text styling use batch_node_actions.text_style. Never loop per-node.',
      parameters: {
        type: 'object',
        properties: {
          targets: {
            type: 'object',
            description: 'Target node set (applies directly to these nodes, ignores current selection)',
            properties: targetNodesProps
          },
          fillColor: { type: 'string', description: 'Node background fill color; normalized to the app node-fill palette (e.g. #91d5ff blue)' },
          borderColor: { type: 'string', description: 'Node border line color (e.g. #007aff blue / 红 / 绿); set "transparent" or "" to remove border. Pairs with borderWidth.' },
          borderWidth: { type: 'number', description: 'Node border line width in px (default 2, max 8); only meaningful with borderColor.' },
          ...richTextStyleProps,
          shape: { type: 'string', enum: ['rectangle', 'roundedRectangle', 'diamond', 'parallelogram', 'roundedOuterRectangle'], description: 'Node shape' },
          fontSize: { type: 'number', description: 'Node font size (e.g. 14); empty = unchanged' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'batch_text_style',
      description: 'Batch rich-text styling on matched text snippets only (rest unchanged). E.g. bold/red all 【】 content ({regex:"【[^】]*】",textColor:"blue"}). targets picks nodes; match via color/regex/text. Never loop per-node.',
      parameters: {
        type: 'object',
        properties: {
          targets: {
            type: 'object',
            description: 'Target node set',
            properties: targetNodesProps
          },
          match: {
            type: 'object',
            description: 'Optional nested match object. You can also put color/regex/text directly at top level.',
            properties: {
              color: { type: 'string', description: 'Match by text color family: pass a family name (红/橙/黄/绿/青/蓝/紫/粉/黑/白/灰) or any color value/color name; it is auto-classified into a family and hits all similar colors in that family. For "turn all red text black" style requests' },
              regex: { type: 'string', description: 'Regex without surrounding slashes, e.g. "【[^】]*】" matches all bracketed content' },
              text: { type: 'string', description: 'Exact substring match (all occurrences), e.g. "马克思主义"' }
            }
          },
          style: {
            type: 'object',
            description: 'Optional nested style object. You can also put textColor/highlightColor/bold/etc. directly at top level.',
            properties: richTextStyleProps
          },
          color: { type: 'string', description: 'Match by text color family: 红/橙/黄/绿/青/蓝/紫/粉/黑/白/灰 or a color value' },
          regex: { type: 'string', description: 'Regex without surrounding slashes, e.g. "【[^】]*】"' },
          text: { type: 'string', description: 'Exact substring match (all occurrences)' },
          ...richTextStyleProps
        },
        required: ['targets']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_review_schedule',
      description: 'Query review plan by date/date range and memory cycle (1/3/7/15/31 days), with progress and overdue items. Always use for review questions. When the user says 任务/计划/安排/复习 without other context (e.g. 本周任务, 这周要做什么), it usually refers to this review plan, NOT scheduled_task. Convert 今天/明天/昨天 to YYYY-MM-DD before passing dates.',
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'Single date (YYYY-MM-DD); default today' },
          start_date: { type: 'string', description: 'Range start (YYYY-MM-DD). date is ignored when start_date/end_date are given' },
          end_date: { type: 'string', description: 'Range end (YYYY-MM-DD); defaults to same as start_date (single day)' },
          cycle: { type: 'number', description: 'Only this memory cycle: 1/3/7/15/31 (days); omit = all cycles' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_today_review_status',
      description: 'Get completion status of the review plan for today: due list (with check-in id and cycle number), progress stats, overdue items. Use when the user asks how the review for today went. export=true also exports the plan for today as a Markdown file to the default save dir.',
      parameters: {
        type: 'object',
        properties: {
          export: { type: 'boolean', description: 'true=also export the plan for today as a Markdown file (default false)' },
          file_name: { type: 'string', description: 'Export file name (no extension); default "今日复习计划_日期"' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'complete_review_task',
      description: 'Review check-in: mark today-due review items remembered (completed) or forgot (undo check-in / keep for review). Use when the user says review done / check in / these are remembered / item X not remembered. Single item: item_id + cycle (from the get_today_review_status list); all at once: all_today=true. Returns latest progress after check-in.',
      parameters: {
        type: 'object',
        properties: {
          item_id: { type: 'string', description: 'Review item id (id of each entry in the get_today_review_status list; optional when all_today=true)' },
          cycle: { type: 'number', description: 'Cycle days (1/3/7/15/31); omit = check in all cycles of that item due that day' },
          result: { type: 'string', enum: ['remembered', 'forgot'], description: 'remembered=remembered (check-in done, default); forgot=forgotten (undo check-in / mark for review again; item stays in the plan)' },
          all_today: { type: 'boolean', description: 'true=check in all due items of the day at once (default false)' },
          date: { type: 'string', description: 'Check-in date YYYY-MM-DD, default today. Pass to check in a future date early (e.g. trip/advance review) or backfill a past day; with all_today=true it checks in all due items of that date' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'delete_review_plan',
      description: 'Delete review-plan tasks: by filePath (all tasks of that file), by nodeUid (single task), or all=true (delete all). Use when the user asks to delete/cancel/remove review tasks; a second confirmation with the user happens before executing.',
      parameters: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: 'Absolute file path: deletes all review tasks of that file' },
          nodeUid: { type: 'string', description: 'Node uid: deletes the single task of that node' },
          all: { type: 'boolean', description: 'true=delete all review plans' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'toggle_cloze_visibility',
      description: 'Toggle cloze answer show/hide (for recitation self-test). Without targets it applies to the whole map: show=true reveals all answers, false hides all, omit toggles the current state; with targets it toggles only the given nodes.',
      parameters: {
        type: 'object',
        properties: {
          show: { type: 'boolean', description: 'true=show answers, false=hide, omit=toggle' },
          targets: {
            type: 'object',
            description: 'Only toggle the cloze of these nodes (omit = whole map)',
            properties: targetNodesProps
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_cloze_nodes',
      description: 'List all nodes with cloze marks in the current map (uid, text, current visibility) to audit cloze coverage.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'clear_cloze',
      description: 'Clear cloze marks: targets picks the nodes (uids/keyword/mode, mode:"all"=clear whole map); text restores to original afterwards; Ctrl+Z undoable. Use before/after to only clear cloze on one side of a delimiter (e.g. before:"：" clears cloze only in text before the colon).',
      parameters: {
        type: 'object',
        properties: {
          targets: {
            type: 'object',
            description: 'Node set to clear cloze marks from',
            properties: targetNodesProps
          },
          before: { type: 'string', description: 'Only clear cloze in the text BEFORE this delimiter (e.g. "：" to clear cloze before colons). The delimiter and text after it keep their cloze.' },
          after: { type: 'string', description: 'Only clear cloze in the text AFTER this delimiter. The delimiter and text before it keep their cloze.' }
        },
        required: ['targets']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'ai_quiz',
      description: 'Generate a quiz as a NEW map file from selected nodes/subtree/whole map: single/multiple/short-answer questions, saved as 主题【AI出题】.smm next to the source map. Answers/explanations auto-cloze-hidden. Questions strictly from map text. Use for 出题/生成题目; never hand-write via generate_mindmap.',
      parameters: {
        type: 'object',
        properties: {
          targets: {
            type: 'object',
            description: 'Question scope (omit = selected nodes; whole map if none selected)',
            properties: targetNodesProps
          },
          count: { type: 'number', description: 'Number of questions, default 10' },
          types: {
            type: 'array',
            items: { type: 'string', enum: ['single', 'multiple', 'short_answer'] },
            description: 'Question types (single=single choice, multiple=multiple choice, short_answer=short answer); default mix of all three'
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'ai_quiz_append',
      description: 'Append one quiz question per target node as a new child (type tag 【选择】【填空】 bold blue; answer+explanation each one line, auto-cloze-hidden). Original untouched. For a standalone quiz file use ai_quiz. Batch, Ctrl+Z undoable.',
      parameters: {
        type: 'object',
        properties: {
          targets: {
            type: 'object',
            description: 'Target nodes to quiz (omit = selected nodes)',
            properties: targetNodesProps
          },
          types: {
            type: 'array',
            items: { type: 'string', enum: ['fill_blank', 'choice'] },
            description: 'Types (fill_blank=fill-in-blank, choice=choice); default mix of both, fill-blank preferred'
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'focus_node',
      description: 'Locate a node on the canvas: scroll it to center and highlight. Use when the user says take me to / locate / find some node. Pass uid or keyword, one of the two (keyword = first node whose text contains it).',
      parameters: {
        type: 'object',
        properties: {
          uid: { type: 'string', description: 'Node uid' },
          keyword: { type: 'string', description: 'Keyword (first matching node)' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'merge_mindmap_files',
      description: 'Merge another .smm map file (or a given branch of it) under a given node of the current map, for cross-file knowledge consolidation (e.g. merge a chapter of "史纲" into "政治总纲"). Merges a copy; source file unchanged; node uids regenerated to avoid conflicts; NOT undoable with Ctrl+Z — to roll back, do not save and reopen the file.',
      parameters: {
        type: 'object',
        properties: {
          sourceFilePath: { type: 'string', description: 'Source .smm file path (find it via search_knowledge_base first)' },
          sourceNodeUid: { type: 'string', description: 'Optional: merge only the subtree of this uid in the source file; omit = all level-1 branches under the source root' },
          targetUid: { type: 'string', description: 'Optional: merge under this node of the current map; omit = under root' }
        },
        required: ['sourceFilePath']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'export_subtree',
      description: 'Export the whole subtree of the selected/given node. format pick one (MUST ask the user first if unspecified): smm=save as a standalone .smm map file; png/jpg/svg=export a subtree image (jpg is saved as png; auto-saved to the default dir and the image is sent into chat for direct viewing).',
      parameters: {
        type: 'object',
        properties: {
          format: { type: 'string', enum: ['smm', 'png', 'jpg', 'svg'], description: 'Export format' },
          uid: { type: 'string', description: 'Subtree root uid (omit = selected node; root if none selected)' },
          keyword: { type: 'string', description: 'Subtree root keyword (first match)' },
          open_folder: { type: 'boolean', description: 'true = reveal the exported file in the system file explorer after saving' }
        },
        required: ['format']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'query_node_styles',
      description: 'Style audit: find what in the map has which style — text color/highlight, bold, italic, underline, strikethrough, fontSize, cloze marks, node fill, note, outer frame. Use for questions like which nodes are red / bold / have font size / have notes; returns a uid list (usable with focus_node to locate).',
      parameters: {
        type: 'object',
        properties: {
          targets: {
            type: 'object',
            description: 'Query scope (omit = whole map)',
            properties: targetNodesProps
          },
          styleTypes: {
            type: 'array',
            items: { type: 'string', enum: ['color', 'highlight', 'bold', 'italic', 'underline', 'strikethrough', 'fontSize', 'cloze', 'nodeFill', 'note', 'outerFrame'] },
            description: 'Only these style types (omit = all)'
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'set_node_note',
      description: 'Set/clear node note: notes show as an icon next to the node, hover to view. targets picks the node set; note is the note text (empty string clears); one uniform setting for the whole set.',
      parameters: {
        type: 'object',
        properties: {
          targets: { type: 'object', description: 'Target nodes (uids/keyword/mode; omit = selected nodes)', properties: targetNodesProps },
          note: { type: 'string', description: 'Note text (multiline supported); empty string = clear the note' }
        },
        required: ['note']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'associative_line',
      description: 'Associative lines between nodes. action=add: draw a line from one node to another (uid or keyword, optional label like 导致/对比/相关). action=remove: delete lines by from/to or all=true. action=list: list all lines (start→end, label).',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['add', 'remove', 'list'], description: 'add / remove / list' },
          from: { type: 'string', description: 'Start node uid or keyword (for add/remove)' },
          to: { type: 'string', description: 'End node uid or keyword (for add/remove)' },
          text: { type: 'string', description: 'Line label (for add, optional)' },
          all: { type: 'boolean', description: 'For remove: delete all lines' }
        },
        required: ['action']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'outer_frame',
      description: 'Outer frame around a group of sibling nodes (outline bracket + canvas border). action=add: frame the targets node set (must be siblings; auto-split by contiguity), config customizes color/line style. action=remove: remove frames for targets or all=true.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['add', 'remove'], description: 'add or remove' },
          targets: { type: 'object', description: 'Target nodes (uids/keyword/mode)', properties: targetNodesProps },
          config: {
            type: 'object',
            description: 'Frame style (optional, for add)',
            properties: {
              strokeColor: { type: 'string', description: 'Border color, default #0984e3' },
              strokeWidth: { type: 'number', description: 'Border width, default 2' },
              radius: { type: 'number', description: 'Corner radius, default 5' },
              strokeDasharray: { type: 'string', description: 'Dash pattern, default "5,5"; "none"=solid' },
              fill: { type: 'string', description: 'Fill color, default rgba(9,132,227,0.05)' },
              text: { type: 'string', description: 'Frame label (optional)' }
            }
          },
          all: { type: 'boolean', description: 'For remove: remove all frames on the map' }
        },
        required: ['action']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'format_painter',
      description: 'Format painter: copy the format of the source node (node styles: fill/shape/border/font size, etc.) onto the targets node set. copy_text_styles=true also copies text-level styles (color/bold/italic/underline/strikethrough/highlight/font size).',
      parameters: {
        type: 'object',
        properties: {
          source: { type: 'string', description: 'Source node uid or keyword' },
          targets: { type: 'object', description: 'Target node set (uids/keyword/mode)', properties: targetNodesProps },
          copy_text_styles: { type: 'boolean', description: 'Also copy text-level styles (default false = node-level styles only)' }
        },
        required: ['source', 'targets']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'export_to_markdown',
      // review B3：原描述歧义——AI 把"用 markdown 表格输出"误识别为"导出当前导图为 MD 文件"。
// 强化：明确"仅当用户明确要求导出/保存为文件时才调用本工具；用户说 markdown 表格 / 列表 / 代码块时直接用文字回答"。
description: '⚠️ IMPORTANT: This tool is ONLY for saving the mindmap as a .md file on disk. Do NOT call it just because the user said "用 markdown 表格 / 列表 / 代码块输出" in chat — those are inline reply formats, not file exports. Call this tool ONLY when the user explicitly asks to save/export/convert the map to a markdown file (e.g. 导出/保存/转成 md 文件/save as markdown/export markdown). By default exports the currently open map; pass file_path to export any .smm file WITHOUT opening it (MCP/external calls). Returns the saved path and a content preview.',
      parameters: {
        type: 'object',
        properties: {
          file_name: { type: 'string', description: 'File name (no extension); default = root node text' },
          file_path: { type: 'string', description: 'Optional absolute path of a .smm file to export. Omit to export the currently open map.' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'export_mindmap_html',
      // review B3：同上 export_to_markdown 的强约束
      description: '⚠️ IMPORTANT: ONLY call this tool when the user explicitly asks to save/export the mindmap as an HTML file on disk (导出HTML/导出全视图/三模式HTML). Do NOT call when user wants an HTML snippet as inline chat reply. mode=single = single mindmap view (zoom/pan + cloze toggle); mode=full = full-view 3-mode HTML (mindmap + outline + graph tabs). By default exports the currently open map; pass file_path to export any .smm file WITHOUT opening it. Returns the saved path.',
      parameters: {
        type: 'object',
        properties: {
          mode: { type: 'string', enum: ['single', 'full'], description: 'single = single mindmap HTML (default); full = full-view 3-mode HTML (导图+大纲+关联图)' },
          file_name: { type: 'string', description: 'File name (no extension); default = root node text' },
          file_path: { type: 'string', description: 'Optional absolute path of a .smm file to export. Omit to export the currently open map.' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'export_mindmap_pdf',
      // review B3：同上
      description: '⚠️ IMPORTANT: ONLY call when user explicitly asks to export the mindmap as a PDF file on disk (导图转pdf/导图导出pdf). Export the current mindmap (canvas graphic with full nodes and links) as a PDF file saved to the default save dir.',
      parameters: {
        type: 'object',
        properties: {
          file_name: { type: 'string', description: 'File name (no extension); default = root node text' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'export_outline_pdf',
      // review B3：同上
      description: '⚠️ IMPORTANT: ONLY call when user explicitly asks to export the outline as a PDF file on disk (大纲转pdf/大纲导出pdf). Export the outline of the current map (indented hierarchy text, not the canvas graphic) as a typeset PDF document saved to the default save dir, good for printing and reading.',
      parameters: {
        type: 'object',
        properties: {
          file_name: { type: 'string', description: 'File name (no extension); default = root node text' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'save_text_file',
      description: 'Save any AI-generated document content (HTML/Markdown/plain text/JSON/CSV) directly to the default save dir. Use whenever the user asks to export generated content as a file, especially custom HTML documents, quiz pages, or reports that are not natively supported by other export tools. Always return the saved filePath.',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'Full file content to save' },
          file_name: { type: 'string', description: 'File name WITHOUT extension, e.g. 马克思教材自测题' },
          extension: { type: 'string', enum: ['html', 'md', 'txt', 'json', 'csv'], description: 'File extension; default html' },
          overwrite: { type: 'boolean', description: 'true=overwrite if same file exists; default true' }
        },
        required: ['content', 'file_name']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'batch_node_actions',
      description: 'First choice for multi-node tasks: finish in ONE call (never loop select_node). Each step picks nodes via targets; ops per step: set_style, text_style, ai_cloze, wrap_text, update_texts, replace_text. Multiple steps run in order. Example: steps=[{targets:{mode:"leaf_parents"},set_style:{textColor:"#ff3b30"}},{targets:{mode:"leaves"},ai_cloze:true}].',
      parameters: {
        type: 'object',
        properties: {
          steps: {
            type: 'array',
            description: 'Steps executed in order (1~5), each with its own targets',
            items: {
              type: 'object',
              properties: {
          dry_run: {
            type: 'boolean',
            description: 'Preview target nodes and changes without modifying the map. Required before large-scale edits; rerun with false after confirmation.'
          },
                targets: {
                  type: 'object',
                  description: 'Target node set of this step',
                  properties: targetNodesProps
                },
                condition: {
                  type: 'object',
                  description: 'Extra filter applied AFTER targets resolve. Only nodes passing ALL specified conditions are kept. Use for "only nodes whose text contains X" or "only nodes whose text matches a regex" scenarios.',
                  properties: {
                    textContains: { type: 'string', description: 'Only keep nodes whose plain text contains this substring (case-insensitive)' },
                    textNotContains: { type: 'string', description: 'Exclude nodes whose plain text contains this substring' },
                    textRegex: { type: 'string', description: 'Only keep nodes whose plain text matches this JS regex (e.g. "^\\d+\\.")' },
                    hasCloze: { type: 'boolean', description: 'true = only nodes with cloze marks; false = only nodes without cloze marks' },
                    hasStyle: { type: 'string', description: 'Only nodes with this style type (e.g. "bold", "italic", "underline", "color", "highlight", "cloze", "nodeFill", "note")' },
                    minDepth: { type: 'number', description: 'Only nodes at or deeper than this depth (root=0)' },
                    maxDepth: { type: 'number', description: 'Only nodes at or shallower than this depth (root=0)' }
                  }
                },
                set_style: {
                  type: 'object',
                  description: 'Batch-set styles of all target nodes of this step (at least one; applies to all text in the node)',
                  properties: {
                    fillColor: { type: 'string', description: 'Node background fill color; normalized to app node-fill palette (e.g. #91d5ff blue)' },
                    ...richTextStyleProps,
                    shape: { type: 'string', enum: ['rectangle', 'roundedRectangle', 'diamond', 'parallelogram', 'roundedOuterRectangle'], description: 'Node shape' },
                    fontSize: { type: 'number', description: 'Node font size (e.g. 14)' }
                  }
                },
                text_style: {
                  type: 'object',
                  description: 'Style only the matched text snippets inside the target nodes of this step, leaving other text unchanged. Match range: color (by text color family), regex, or text substring. Apply styles directly at top level or inside style. Example for "make text inside 【】 blue": {"regex":"【[^】]*】","textColor":"blue"}.',
                  properties: {
                    color: { type: 'string', description: 'Match by text color family: pass a family name (红/橙/黄/绿/青/蓝/紫/粉/黑/白/灰) or a color value; hits all similar colors of that family. For "turn all red text black" style requests' },
                    regex: { type: 'string', description: 'Regex match (e.g. "【[^】]*】")' },
                    text: { type: 'string', description: 'Substring match (all occurrences)' },
                    style: { type: 'object', description: 'Styles (at least one). If omitted, put style fields directly on text_style', properties: richTextStyleProps },
                    ...richTextStyleProps
                  }
                },
                ai_cloze: { type: 'boolean', description: 'true=run AI smart cloze on all target nodes of this step (auto keyword picking, keeps context clues)' },
                update_texts: {
                  type: 'array',
                  description: 'Set DIFFERENT text per node in this step (rich text formatting of the node is reset to plain): [{uid, text}, ...]. Pair with step targets (targets selects the step scope; uids here name per-node text). One call replaces N update_node_text calls.',
                  items: {
                    type: 'object',
                    properties: {
                      uid: { type: 'string', description: 'Target node uid' },
                      text: { type: 'string', description: 'New text for that node' }
                    },
                    required: ['uid', 'text']
                  }
                },
                wrap_text: {
                  type: 'object',
                  description: 'Wrap EXISTING text of every target node with prefix/suffix while KEEPING all rich text formatting. First choice for decorating, e.g. adding 【】/quotes/markers around node text. E.g. adding 【】 around text: {prefix:"【", suffix:"】"} - NOT update_node_text (which loses formatting).',
                  properties: {
                    prefix: { type: 'string', description: 'Text inserted before existing content' },
                    suffix: { type: 'string', description: 'Text appended after existing content' }
                  }
                },
                replace_text: {
                  type: 'object',
                  description: 'Find & replace text ONLY within the target nodes of this step (whole-node scope, keeps rich text formatting). Cheaper than find_replace_text when the scope is already known.',
                  properties: {
                    find: { type: 'string', description: 'Text to find' },
                    replacement: { type: 'string', description: 'Replacement text (empty = delete matches)' },
                    regex: { type: 'boolean', description: 'true = treat find as JS regex source, default false = literal substring' },
                    flags: { type: 'string', description: 'Regex flags when regex=true, default "g"' }
                  }
                },
                clear_cloze: {
                  type: 'object',
                  description: 'Clear cloze marks from target nodes. Without before/after = clear all cloze; with before/after = only clear cloze on one side of the delimiter.',
                  properties: {
                    before: { type: 'string', description: 'Only clear cloze in text BEFORE this delimiter (e.g. "：")' },
                    after: { type: 'string', description: 'Only clear cloze in text AFTER this delimiter' }
                  }
                }
              },
              required: ['targets']
            }
          }
        },
        required: ['steps']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'summarize_node',
      description: 'Add a summary (generalization) to nodes. Pass targets (uids/keyword/mode) to add the same summary to all matched nodes in one call; omit targets to add to the first selected node.',
      parameters: {
        type: 'object',
        properties: {
          summary: { type: 'string', description: 'Summary text' },
          targets: {
            type: 'object',
            description: 'Which nodes to add the summary to (optional; omit = selected node)',
            properties: {
              uids: { type: 'array', items: { type: 'string' }, description: 'Node uid list' },
              keyword: { type: 'string', description: 'All nodes whose text contains this keyword' },
              mode: { type: 'string', enum: ['leaves', 'leaf_parents', 'all'], description: 'all=all nodes; leaves=all leaf nodes; leaf_parents=parents of all leaf nodes' }
            }
          }
        },
        required: ['summary']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_nodes',
      description: 'Search nodes containing one or more keywords in ONE call (use keywords array to avoid repeated search_nodes). Each result carries node path, uid, parentPath and parentUid. mode=all requires all keywords, mode=any (default) returns nodes matching any keyword.',
      parameters: {
        type: 'object',
        properties: {
          keyword: { type: 'string', description: 'Single search keyword' },
          keywords: { type: 'array', items: { type: 'string' }, description: 'Multiple search keywords; preferred over repeated calls' },
          mode: { type: 'string', enum: ['any', 'all'], description: 'any=match any keyword (default); all=match all keywords' },
          max_results: { type: 'number', description: 'Maximum results to return, default 200' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'query_nodes',
      description: 'Advanced node query with rich filters (AND logic). Replaces multiple search_nodes + query_node_styles calls. Filters: textContains/textNotContains/textRegex/textStartsWith/hasCloze/clozeContains/hasStyle/hasNote/isLeaf/minDepth/maxDepth. Returns full node info: uid, plainText, path, clozeWords, styles, depth. Use for "find all nodes where X and do Y" patterns.',
      parameters: {
        type: 'object',
        properties: {
          filters: {
            type: 'object',
            description: 'Filter conditions (AND logic). All specified conditions must match.',
            properties: {
              textContains: { type: 'string', description: 'Plain text contains this substring (case-insensitive)' },
              textNotContains: { type: 'string', description: 'Plain text does NOT contain this substring' },
              textRegex: { type: 'string', description: 'Plain text matches this JS regex (e.g. "：")' },
              textStartsWith: { type: 'string', description: 'Plain text starts with this prefix' },
              hasCloze: { type: 'boolean', description: 'true = only nodes with cloze marks; false = only without' },
              clozeContains: { type: 'string', description: 'Cloze words contain this substring (e.g. "社会" finds nodes where cloze words include "社会")' },
              hasStyle: { type: 'string', description: 'Node has this style type: bold/italic/underline/color/highlight/cloze/nodeFill/note' },
              hasNote: { type: 'boolean', description: 'true = has note; false = no note' },
              isLeaf: { type: 'boolean', description: 'true = leaf node (no children); false = has children' },
              minDepth: { type: 'number', description: 'Minimum depth (root=0)' },
              maxDepth: { type: 'number', description: 'Maximum depth (root=0)' }
            }
          },
          scope: {
            type: 'object',
            description: 'Narrow the search scope (omit = whole map). Applied BEFORE filters.',
            properties: targetNodesProps
          },
          limit: { type: 'number', description: 'Max results to return (default 200, max 500)' },
          returnFields: {
            type: 'array',
            items: { type: 'string', enum: ['uid', 'plainText', 'path', 'clozeWords', 'styles', 'depth', 'isLeaf', 'hasNote', 'rawHtml'] },
            description: 'Only return these fields (default all except rawHtml). rawHtml includes the node HTML text.'
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'find_replace_text',
      description: 'Find & replace text across nodes. preview=true lists matches without changing. If matches split by inline styles cannot be replaced, use search_nodes + update_node_text.',
      parameters: {
        type: 'object',
        properties: {
          find: { type: 'string', description: 'Text to find' },
          replacement: { type: 'string', description: 'Replacement text (empty string = delete matches)' },
          regex: { type: 'boolean', description: 'true = treat find as a JS regex source, e.g. "进行时|过去时"; default false = literal substring' },
          flags: { type: 'string', description: 'Regex flags when regex=true, default "g" (use "gi" for case-insensitive)' },
          preview: { type: 'boolean', description: 'true = only list matching nodes, do not modify' },
          targets: {
            type: 'object',
            description: 'Scope (omit = whole map)',
            properties: {
              uids: { type: 'array', items: { type: 'string' }, description: 'Only these node uids' },
              keyword: { type: 'string', description: 'Only nodes whose text contains this keyword' },
              mode: { type: 'string', enum: ['all', 'leaves', 'leaf_parents'], description: 'Structural scope (all=all nodes, leaves=leaf nodes, leaf_parents=parents of leaves)' }
            }
          }
        },
        required: ['find', 'replacement']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'change_layout',
      description: 'Switch the layout structure of the mindmap',
      parameters: {
        type: 'object',
        properties: {
          layout: {
            type: 'string',
            enum: ['mindMap', 'logicalStructure', 'organizationStructure', 'catalogOrganization', 'timeline', 'fishbone'],
            description: 'Layout type'
          }
        },
        required: ['layout']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'set_theme',
      description: 'Switch the theme style of the mindmap',
      parameters: {
        type: 'object',
        properties: {
          theme: { type: 'string', description: 'Theme name, e.g. classic, dark, forest, neon, candy, earth, sunlight, autumn' }
        },
        required: ['theme']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'switch_view',
      description: 'Switch view mode',
      parameters: {
        type: 'object',
        properties: {
          mode: { type: 'string', enum: ['outline', 'mindmap', 'review'], description: 'outline=outline mode, mindmap=mindmap mode, review=review mode' }
        },
        required: ['mode']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'zoom_control',
      description: 'Zoom the mindmap canvas',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['in', 'out', 'fit', 'reset'], description: 'in=zoom in, out=zoom out, fit=fit screen, reset=reset zoom' }
        },
        required: ['action']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'undo',
      description: 'Undo the last operation',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'redo',
      description: 'Redo the last undone operation',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'export_mindmap',
      description: 'Export the mindmap to a given format, saved directly to the default save dir without a dialog. Note: when the user says "export/save/send me the map" they mean the .smm file (export json — same content), NOT an image; use png/svg only when the user explicitly asks for an image. Images are auto-saved and shown in the chat.',
      parameters: {
        type: 'object',
        properties: {
          format: { type: 'string', enum: ['png', 'svg', 'pdf', 'json', 'markdown', 'xmind'], description: 'Export format. Use json (i.e. .smm) for the map file; png/svg only when the user explicitly wants an image; xmind = XMind 2020+ file' },
          open_folder: { type: 'boolean', description: 'true = reveal the exported file in the system file explorer after saving' }
        },
        required: ['format']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'upload_to_feishu',
      description: 'Upload the current mindmap to Feishu Drive. First saves the current mindmap as .smm, then uploads the mindmap file itself (not converted to an image or plain doc). Use when the user says upload to Feishu / back up to Feishu.',
      parameters: {
        type: 'object',
        properties: {
          fileName: { type: 'string', description: 'File name (no extension); empty = root node text' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'upload_mindmap_to_feishu_doc',
      description: 'Convert the current mindmap to a Feishu online doc and upload: node levels become heading levels (root → H1, children → H2/H3, etc.), returns an accessible doc link. Use when the user says turn the map into a Feishu doc / view it as a document in Feishu. Note: this uploads an online doc, NOT the .smm file (that is upload_to_feishu).',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Doc title; empty = root node text' },
          folderToken: { type: 'string', description: 'Target folder token; empty = "我的空间" root (find folder tokens via feishu_list_files)' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'upload_file_to_feishu',
      description: 'Upload a given local file to Feishu Drive (any format: images, archives, docs, anything); returns the file token and accessible link. Use when the user says upload this file to Feishu. The file path can come from the local file list, KB search results, or the save dir.',
      parameters: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: 'Full path of the local file' },
          folderToken: { type: 'string', description: 'Target folder token; empty = "我的空间" root' }
        },
        required: ['filePath']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'feishu_list_files',
      description: 'List all files and subfolders of a Feishu Drive folder. Without folderToken it lists the "我的空间" root. Returns name/type/token etc.; tokens can be used to upload into a folder or read a doc.',
      parameters: {
        type: 'object',
        properties: {
          folderToken: { type: 'string', description: 'Folder token; empty = root "我的空间"' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'feishu_get_doc_content',
      description: 'Get the plain text content of Feishu online doc(s) (docx type). Use when the user wants to view Feishu doc(s) or the AI needs to read uploaded doc(s) for analysis. docToken comes from feishu_list_files results or upload/import returned tokens. For batch read, pass docTokens array to read many docs in ONE call.',
      parameters: {
        type: 'object',
        properties: {
          docToken: { type: 'string', description: 'Feishu doc token (single doc). Omit when using docTokens.' },
          docTokens: { type: 'array', description: 'Batch doc token list. Prefer this for reading multiple docs in one call.', items: { type: 'string', description: 'Feishu doc token' } }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'feishu_delete_file',
      description: 'Delete file(s) in Feishu Drive (moved to trash, recoverable). Use when the user explicitly asks to delete a Feishu file; confirm with the user before deleting. For batch delete, pass the items array (each item = {fileToken, fileType}) to delete many in ONE call. IMPORTANT: fileType MUST be the exact "type" value returned by feishu_list_files (docx/doc/sheet/bitable/file/folder); do NOT guess or default it, otherwise deletion fails.',
      parameters: {
        type: 'object',
        properties: {
          fileToken: { type: 'string', description: 'File token (single file). Omit when using items.' },
          fileType: { type: 'string', enum: ['file', 'doc', 'docx', 'sheet', 'bitable', 'folder'], description: 'File type. Use the "type" field from feishu_list_files result (not the displayed Chinese name).' },
          items: { type: 'array', description: 'Batch delete list. Each item = {fileToken, fileType}. Prefer this for deleting multiple files in one call.', items: { type: 'object', properties: { fileToken: { type: 'string', description: 'File token' }, fileType: { type: 'string', enum: ['file', 'doc', 'docx', 'sheet', 'bitable', 'folder'], description: 'File type from feishu_list_files "type" field' } }, required: ['fileToken', 'fileType'] } }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'feishu_rename_file',
      description: 'Rename file(s)/doc(s) in Feishu Drive. Use when the user asks to change a Feishu file name. fileType MUST be the exact "type" value returned by feishu_list_files (do NOT guess or default it). For batch rename, pass items (each = {fileToken, newName, fileType}) to rename many in ONE call.',
      parameters: {
        type: 'object',
        properties: {
          fileToken: { type: 'string', description: 'File token (single file). Omit when using items.' },
          newName: { type: 'string', description: 'New file name (with extension). Omit when using items.' },
          fileType: { type: 'string', enum: ['file', 'doc', 'docx', 'sheet', 'bitable'], description: 'File type from feishu_list_files "type" field' },
          items: { type: 'array', description: 'Batch rename list. Each item = {fileToken, newName, fileType}. Prefer this for renaming multiple files in one call.', items: { type: 'object', properties: { fileToken: { type: 'string', description: 'File token' }, newName: { type: 'string', description: 'New file name (with extension)' }, fileType: { type: 'string', enum: ['file', 'doc', 'docx', 'sheet', 'bitable'], description: 'File type from feishu_list_files "type" field' } }, required: ['fileToken', 'newName', 'fileType'] } }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'send_feishu_message',
      description: 'Send a text message to a Feishu group chat. Use when the user says push to Feishu / send to a Feishu group / send results to Feishu. Without a chat specified it goes to the default push chat (set in the third-party links panel); chatName sends by group name.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Message text to send (multiline supported)' },
          chatName: { type: 'string', description: 'Target group name (optional; matches chat by name; empty = default push chat)' },
          chatId: { type: 'string', description: 'Target group chat_id (optional; takes precedence over chatName)' }
        },
        required: ['text']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'send_wechat_message',
      description: 'Send a text message to WeChat. Use when the user says push to WeChat / send to WeChat / send results to WeChat. Goes to the default contact (the WeChat user who last chatted with the bot); WeChat QR login must be done in the third-party links panel first.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Message text to send (multiline supported)' },
          toUserId: { type: 'string', description: 'Target contact ID (optional; default contact if empty)' }
        },
        required: ['text']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'send_wechat_image',
      description: 'Send an image to WeChat. Use when the user wants to send an image/PNG/screenshot to WeChat: pass the local image file path as filePath (e.g. the filePath returned by export_mindmap format=png); the image is sent as-is into the WeChat chat. NEVER send a text path instead of the image. WeChat QR login must be done in the third-party links panel first.',
      parameters: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: 'Full path of the local image (png/jpg, up to 10MB)' },
          toUserId: { type: 'string', description: 'Target contact ID (optional; default contact if empty)' }
        },
        required: ['filePath']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'send_feishu_image',
      description: 'Send an image to a Feishu group chat. Use when the user wants to send an image/PNG/screenshot to Feishu: pass the local image file path as filePath (e.g. the filePath returned by export_mindmap format=png); the image is sent directly into the chat. NEVER send a text path instead of the image.',
      parameters: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: 'Full path of the local image (png/jpg)' },
          chatName: { type: 'string', description: 'Target group name (optional; matches chat by name; empty = default push chat)' },
          chatId: { type: 'string', description: 'Target group chat_id (optional; takes precedence over chatName)' }
        },
        required: ['filePath']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'send_wechat_file',
      description: 'Send a file to WeChat (any format: PDF/Excel/Word/Zip, up to 30MB). Use when the user wants to send a file to WeChat: pass the full local file path as filePath (e.g. an exported .smm/.pdf/.md); the file is sent as a file message into the WeChat chat. NEVER send a text path instead of the file. WeChat QR login must be done in the third-party links panel first.',
      parameters: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: 'Full path of the local file' },
          toUserId: { type: 'string', description: 'Target contact ID (optional; default contact if empty)' }
        },
        required: ['filePath']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'send_feishu_file',
      description: 'Send a file to a Feishu group chat (any format: PDF/Excel/Word/Zip, up to 30MB). Use when the user wants to send a file to Feishu: pass the full local file path as filePath (e.g. an exported .smm/.pdf/.md); the file is sent as a file message into the chat. NEVER send a text path instead of the file.',
      parameters: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: 'Full path of the local file' },
          chatName: { type: 'string', description: 'Target group name (optional; matches chat by name; empty = default push chat)' },
          chatId: { type: 'string', description: 'Target group chat_id (optional; takes precedence over chatName)' }
        },
        required: ['filePath']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'delete_local_file',
      description: 'Delete a file on the local disk (moved to system trash, recoverable). Use when the user explicitly asks to delete a local mindmap file / local file; MUST confirm with the user before deleting. filePath is the absolute path of the file.',
      parameters: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: 'Absolute path of the local file to delete' }
        },
        required: ['filePath']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'edit_local_file',
      description: 'Edit a local text file in place. Two modes: (1) replace_in_file — precise old_text → new_text replacement (safest, requires the old_text to match exactly once; use unique surrounding context to disambiguate); (2) write_full_file — overwrite the entire file with new content. Works on any text file (JSON / Markdown / code / txt / csv / log / etc). For binary files (PDF/Excel/Word/images), use save_text_file / send_wechat_file etc instead.',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'Absolute path of the local file to edit' },
          mode: { type: 'string', enum: ['replace_in_file', 'write_full_file'], description: 'replace_in_file = partial edit (default, safest); write_full_file = overwrite the entire file' },
          old_text: { type: 'string', description: 'For replace_in_file: the exact existing text to replace (must match exactly once in the file). Include enough surrounding context to be unique' },
          new_text: { type: 'string', description: 'For replace_in_file: the text to insert in place of old_text. For write_full_file: the complete new file content' }
        },
        required: ['file_path', 'mode', 'new_text']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'append_local_file',
      description: 'Append content to the end of a local text file. Auto-creates the file if it does not exist. Use when the user wants to add new lines / entries without overwriting existing content (e.g. append to a log, list, CSV row).',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'Absolute path of the local file to append to' },
          content: { type: 'string', description: 'Content to append at the end of the file' },
          newline: { type: 'boolean', description: 'If true (default), prepend a newline before content so the appended text starts on a new line' }
        },
        required: ['file_path', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_local_file_lines',
      description: 'Read a specific line range of a local text file (start_line / end_line, 1-based, inclusive). Use for large files when only a small section needs to be viewed (returns up to max_chars chars).',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'Absolute path of the local text file' },
          start_line: { type: 'number', description: 'First line to read (1-based, default 1)' },
          end_line: { type: 'number', description: 'Last line to read (inclusive, default: end of file)' },
          max_chars: { type: 'number', description: 'Max chars returned, default 50000' }
        },
        required: ['file_path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'run_shell',
      description: 'Run an allowed command synchronously (up to 10 minutes). Allowed binaries include: node / npm / npx / pnpm / yarn / python / python3 / pip / git / cmd / powershell / go / rustc / cargo / make / docker / bash / sh. cwd must be inside an allowed directory (userData / temp / open-file-dir / desktop / downloads / documents). Returns stdout / stderr / exitCode. To run a script, prefer run_node or run_python.',
      parameters: {
        type: 'object',
        properties: {
          binary: { type: 'string', description: 'Allowed binary name (e.g. "npm", "git", "python")' },
          args: { type: 'array', items: { type: 'string' }, description: 'Arguments array (safer than a single command string)' },
          cwd: { type: 'string', description: 'Working directory (absolute path, must be inside an allowed directory)' },
          env: { type: 'object', description: 'Extra environment variables to set (merged with process.env)' },
          timeoutMs: { type: 'number', description: 'Timeout in milliseconds (default 60000, max 600000 = 10 minutes)' }
        },
        required: ['binary']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'run_node',
      description: 'Run a local Node.js script (equivalent to `node script_path [args]`). The script file path must be inside an allowed directory. Returns stdout / stderr / exitCode.',
      parameters: {
        type: 'object',
        properties: {
          script_path: { type: 'string', description: 'Absolute path to the Node.js script (.js / .mjs / .cjs)' },
          args: { type: 'array', items: { type: 'string' }, description: 'Arguments to pass to the script' },
          cwd: { type: 'string', description: 'Working directory (absolute path, default: directory of script_path)' },
          timeoutMs: { type: 'number', description: 'Timeout in milliseconds (default 60000, max 600000)' }
        },
        required: ['script_path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'run_python',
      description: 'Run a local Python script (equivalent to `python script_path [args]`). The script file path must be inside an allowed directory. Returns stdout / stderr / exitCode.',
      parameters: {
        type: 'object',
        properties: {
          script_path: { type: 'string', description: 'Absolute path to the Python script (.py)' },
          args: { type: 'array', items: { type: 'string' }, description: 'Arguments to pass to the script' },
          cwd: { type: 'string', description: 'Working directory (absolute path, default: directory of script_path)' },
          timeoutMs: { type: 'number', description: 'Timeout in milliseconds (default 60000, max 600000)' }
        },
        required: ['script_path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'spawn_shell',
      description: 'Spawn a long-running command as a background job. Use for dev servers, watch mode, etc. Returns a handle; subscribe to shell:stdout / shell:stderr / shell:exit events to stream output. Max 8 concurrent jobs.',
      parameters: {
        type: 'object',
        properties: {
          binary: { type: 'string', description: 'Allowed binary name (same whitelist as run_shell)' },
          args: { type: 'array', items: { type: 'string' }, description: 'Arguments array' },
          cwd: { type: 'string', description: 'Working directory' },
          env: { type: 'object', description: 'Extra environment variables' }
        },
        required: ['binary']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'shell_get_env',
      description: 'Read whitelisted environment variables. Allowed keys: PATH / NODE_ENV / PYTHONPATH / VIRTUAL_ENV / JAVA_HOME / GOPATH / GOROOT / CARGO_HOME / RUSTUP_HOME / LANG / LC_ALL / TZ / CI / NODE_OPTIONS / NPM_CONFIG_REGISTRY. Other keys are blocked.',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Environment variable name. If omitted, returns all whitelisted vars.' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'clear_mindmap',
      description: 'Clear all nodes of the current mindmap, keeping one empty root. Use when the user asks to clear the map / clear the canvas / delete all nodes / start over; MUST confirm with the user before clearing.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'ai_continue_children',
      description: 'AI generates and attaches child nodes (original text kept). Ask user: reference material, levels, other requirements. First added level = ONE node. Depth default 2~5 (max 6). scope=selected (default) / scope=root (whole map). Ctrl+Z undoable.',
      parameters: {
        type: 'object',
        properties: {
          scope: { type: 'string', enum: ['selected', 'root'], description: 'Scope: selected=currently selected node (default); root=whole map (continue from root)' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'ai_recite_rewrite',
      description: 'AI recitation rewrite: 【memory shorthand】+summary. Short original text (<=12 chars) must keep the original text verbatim; longer text uses a concise summary. Shorthand <=4 chars; natural homophones only, no forced puns. Leaf nodes rewrite themselves; non-leaf nodes rewrite each direct child + a mnemonic. targets picks node set; omit = selection. Re-call with full feedback in instruction when user comments on last rewrite. Ctrl+Z undoable.',
      parameters: {
        type: 'object',
        properties: {
          instruction: { type: 'string', description: '(Optional) The user original request/feedback for this rewrite, e.g. "简写再短一点" "概括要包含时间线". Followed with top priority when provided' },
          targets: {
            type: 'object',
            description: 'Which nodes to rewrite (optional; omit = currently selected, or reuse last rewrite nodes)',
            properties: {
              uids: { type: 'array', items: { type: 'string' }, description: 'Node uid list (from search_nodes)' },
              keyword: { type: 'string', description: 'All nodes whose text contains this keyword' },
              mode: { type: 'string', enum: ['leaves', 'leaf_parents', 'all'], description: 'all=all nodes; leaves=all leaf nodes; leaf_parents=parents of all leaf nodes' }
            }
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'ai_cloze',
      description: 'AI smart cloze: blank keywords in nodes for self-test, keeping context clues. targets (uids/keyword/mode, e.g. mode=leaves) hits all in one call; omit = selection. Never loop per-node.',
      parameters: {
        type: 'object',
        properties: {
          targets: {
            type: 'object',
            description: 'Target node set (blanks these directly, ignores current selection)',
            properties: {
              uids: { type: 'array', items: { type: 'string' }, description: 'Node uid list (get from search_nodes)' },
              keyword: { type: 'string', description: 'Keyword: matches all nodes whose text contains it' },
              mode: { type: 'string', enum: ['leaves', 'leaf_parents'], description: 'leaves=all leaf nodes; leaf_parents=parents of all leaf nodes (deduped)' }
            }
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'ai_cloze_full_map',
      description: 'AI full-map cloze: blank keywords across the whole opened map (all nodes), ignoring current selection; picks keywords per node to create fill-in-blanks for full self-test review. Use when the user says 全文挖空/整张图挖空/全导图挖空/全部挖空.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'mechanical_cloze',
      description: 'Mechanical cloze: directly blank every occurrence of an exact text or regex in target nodes. No AI analysis, no keyword picking. Use when the user specifies the exact content to blank, e.g. 把“马克思主义”全部挖空 or 用正则挖空所有数字.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Exact text to blank; required when regex is empty' },
          regex: { type: 'string', description: 'Regular expression to blank; e.g. \\d+' },
          flags: { type: 'string', description: 'Regex flags, default gi' },
          targets: {
            type: 'object',
            description: 'Which nodes to blank; omit = currently selected nodes',
            properties: targetNodesProps
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'parallel_ai_workers',
      description: 'Split a heavy AI job into self-contained concurrent subtasks (full-map cloze/rewrite, many branches/files). Each task gets explicit instruction+context and returns text/JSON only (does not modify map); aggregate results then apply with normal map tools.',
      parameters: {
        type: 'object',
        properties: {
          tasks: {
            type: 'array',
            description: 'Independent subtasks to run in parallel (usually 2~12; do not create too many tiny tasks). Each task should produce a complete result that can be merged later.',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Short stable id, e.g. "1", "section-a"' },
                instruction: { type: 'string', description: 'What this worker should do or return' },
                context: { type: 'string', description: 'All information this worker needs to complete the task' },
                response_format: { type: 'string', enum: ['text', 'json'], description: 'Expected result format; json means return a JSON object only' }
              },
              required: ['id', 'instruction', 'context']
            }
          },
          concurrency: { type: 'number', description: 'Max parallel workers, default 3, max 5 (keep low for API concurrency limits)' },
          retry: { type: 'number', description: 'Retry count for failed workers, default 2, max 3' }
        },
        required: ['tasks']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'add_to_review',
      description: 'Add nodes to the review plan in ONE call. Pass targets (uids/keyword/mode) to add all matched nodes directly (no need to select first); omit targets to add the currently selected nodes. Nodes already in the plan are skipped.',
      parameters: {
        type: 'object',
        properties: {
          targets: {
            type: 'object',
            description: 'Which nodes to add to review (optional; omit = currently selected)',
            properties: {
              uids: { type: 'array', items: { type: 'string' }, description: 'Node uid list (from search_nodes)' },
              keyword: { type: 'string', description: 'All nodes whose text contains this keyword' },
              mode: { type: 'string', enum: ['leaves', 'leaf_parents', 'all'], description: 'all=all nodes; leaves=all leaf nodes; leaf_parents=parents of all leaf nodes' }
            }
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'audit_mindmap',
      description: 'Audit the current mindmap structure without modifying it. Detects empty/long/duplicate/wide/deep/vague nodes and returns a quality score. Use FIRST for optimize/organize/check map requests. By default it returns issues only; set include_nodes=true only when the node list is needed.',
      parameters: { type: 'object', properties: { include_nodes: { type: 'boolean', description: 'Return the full node list; default false to save context' } } }
    }
  },
  {
    type: 'function',
    function: {
      name: 'refactor_mindmap',
      description: 'Safely refactor the current mindmap. Default is dry-run and changes nothing; apply=true executes only safe fixes. Use after audit_mindmap.',
      parameters: {
        type: 'object',
        properties: { apply: { type: 'boolean', description: 'false/default = preview; true = execute safe changes' } }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'reorganize_mindmap',
      description: 'Reorganize current map into a better framework, saved as NEW 主题【整理框架】.smm next to source. Preserves every original node text; only regroup/reorder/reclassify/merge-similar. Current map unchanged.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'research_to_mindmap',
      description: 'Research a topic and create a cited mindmap: search -> rank -> read top pages -> source-linked nodes. It replaces the current canvas, so confirm unsaved work first.',
      parameters: {
        type: 'object',
        properties: {
          topic: { type: 'string', description: 'Research topic or question' },
          max_sources: { type: 'number', description: 'Maximum sources, 2-8; default 5' }
        },
        required: ['topic']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_web',
      description: 'Web search for real-time info (weather, news, latest data, etc.)',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search keywords' },
          deep_research: { type: 'boolean', description: 'true only when the user explicitly asks for deep/systematic research; raises the search budget' },
          verify: { type: 'boolean', description: 'false disables automatic webpage verification for factual queries; default true' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_location',
      description: 'IP-based location (country/province/city/ISP). For weather/local-life without a city, search_web auto-locates; use this directly only when needed. City-level precision; proxy may return exit city.',
      parameters: {
        type: 'object',
        properties: {},
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_webpage',
      description: 'Read the full body text of a webpage. Web search results only have titles and summaries; when a summary is not enough to answer the user (exact temperature values, detailed news, full steps), open the link from the search results with this tool and read the body. Returns plain text body (auto-truncated when very long).',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Full URL of the webpage to read (http/https)' }
        },
        required: ['url']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_knowledge_base',
      description: 'Search all indexed local content (mindmap files + documents read by AI: PDF/DOCX/XLSX/CSV/MD/TXT auto-indexed). Can search node content inside mindmap files (cross-file), document chunks and filenames. Use when the answer may not be in the currently opened mindmap. Returns matching filenames, file paths, node/chunk content and node uid.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search keyword' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'semantic_search',
      description: 'Semantic search over the local KB (mindmaps + auto-indexed PDF/DOCX/XLSX/CSV/MD/TXT documents, BM25 Chinese ranking): expand intent into 3~6 keywords (synonyms/related terms), merge/dedupe/rank by hit count. Suited for fuzzy questions (vs search_knowledge_base exact match). Returns related files, nodes and document chunks.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The user original question or core query' },
          keywords: {
            type: 'array',
            items: { type: 'string' },
            description: 'Intent-expanded keyword list (3~6); include synonyms, hypernyms/hyponyms and varied phrasings of related terms to boost recall'
          }
        },
        required: ['query', 'keywords']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'semantic_tool_search',
      description: 'Find the best matching built-in tool, custom tool, MCP server, or saved Skill for a user request. Use this when many tools/MCPs/Skills exist and the user asks which tool/capability to use, or when the request does not clearly map to one known tool name.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'User request or capability description' },
          limit: { type: 'number', description: 'Max results, default 10' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_mindmap_file',
      description: 'Read the full content of a mindmap file (.smm) at a given path. Use when the details of a file are needed. Returns tree-structure text.',
      parameters: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: 'Full file path' }
        },
        required: ['filePath']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_node_image',
      description: 'Read and recognize the image attached to a mindmap node. The image may contain text/diagrams; this tool uses the configured multimodal vision model first and automatically falls back to local OCR when vision is disabled or fails. Use when the user asks what a node image says or asks to extract text from a node image.',
      parameters: {
        type: 'object',
        properties: {
          uid: { type: 'string', description: 'Node uid' },
          keyword: { type: 'string', description: 'Alternative: first node whose text contains this keyword' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'retrieve_local_file',
      description: 'Fast semantic retrieval inside a local document (txt/md/json/log/html/xml/docx/xlsx/xls/csv/tsv/pdf). Extracts text once (cached in-session) and returns only the top chunks most relevant to the user query — do NOT read the whole file. Pass file_path (absolute path, e.g. from the 【拖入文件｜路径：xxx】 marker) and query (the user\'s actual question). Best for large PDF/docx/xlsx/xls/txt when the user drops a file and asks a question; use read_local_file only when the user needs the FULL content or an OCR-scanned PDF.',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'Absolute path of the local document' },
          query: { type: 'string', description: 'The user question/intent, used to rank relevant chunks' },
          top_k: { type: 'number', description: 'Number of relevant chunks to return, default 6, max 12' }
        },
        required: ['file_path', 'query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'activate_tools',
      description: 'Activate inactive tools and get their full parameter schemas. names=["a","b"] for exact names; keyword="pdf" to auto-find matches; no param returns the full catalog. Activate all needed tools in ONE call, then call them next turn.',
      parameters: {
        type: 'object',
        properties: {
          names: {
            type: 'array',
            items: { type: 'string' },
            description: 'Exact tool names to activate, e.g. ["upload_to_feishu","ai_cloze"]'
          },
          keyword: {
            type: 'string',
            description: 'Keyword: auto-find matching tools in the catalog (name/description/category) and activate them; use when unsure of exact names'
          },
          limit: { type: 'number', description: 'Max tools a keyword match may activate, default 6' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'move_node',
      description: 'Move a node under another node for cross-branch restructure (e.g. move "贫血" from "血液系统" to "消化系统"). All descendants of the moved node move together. Ctrl+Z undoable. If the uid is unknown, find it with search_nodes first.',
      parameters: {
        type: 'object',
        properties: {
          uid: { type: 'string', description: 'uid of the node to move' },
          targetParentUid: { type: 'string', description: 'Target parent node uid (the node is appended to the end of its children)' }
        },
        required: ['uid', 'targetParentUid']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'batch_move_nodes',
      description: 'Move multiple nodes under one target parent in a single call. Pass targets (uids/keyword/mode) + target_parent_uid. Root/self/descendant/not-found nodes are skipped safely. Ctrl+Z undoable.',
      parameters: {
        type: 'object',
        properties: {
          targets: {
            type: 'object',
            description: 'Which nodes to move',
            properties: {
              uids: { type: 'array', items: { type: 'string' }, description: 'Node uid list' },
              keyword: { type: 'string', description: 'All nodes whose text contains this keyword' },
              mode: { type: 'string', enum: ['leaves', 'leaf_parents', 'all'], description: 'all=all nodes; leaves=all leaf nodes; leaf_parents=parents of all leaf nodes' }
            }
          },
          target_parent_uid: { type: 'string', description: 'Target parent node uid (moved nodes are appended to its children)' }
        },
        required: ['target_parent_uid']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'duplicate_nodes',
      description: 'Duplicate (clone) nodes including their subtrees and append the copies under a target parent. Pass uids (or rely on current selection) + target_parent_uid. Copies get fresh uids. Ctrl+Z undoable.',
      parameters: {
        type: 'object',
        properties: {
          uids: { type: 'array', items: { type: 'string' }, description: 'Source node uids to clone (omit = current selection)' },
          target_parent_uid: { type: 'string', description: 'Parent node to append the copies under' }
        },
        required: ['target_parent_uid']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'sort_children',
      description: 'Sort the direct children of a node. by=text (alphabetical by plain text), by=reverse (reverse current order), or by=custom with order=[uid,...] for explicit order (unlisted children keep their order at the end).',
      parameters: {
        type: 'object',
        properties: {
          uid: { type: 'string', description: 'Parent node uid whose children to sort' },
          by: { type: 'string', enum: ['text', 'reverse', 'custom'], description: 'Sort mode' },
          order: { type: 'array', items: { type: 'string' }, description: 'Explicit uid order (required when by=custom)' }
        },
        required: ['uid', 'by']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_node_subtree',
      description: 'Read the full subtree content of one node as indented text (with level markers). Use to inspect a specific branch before editing. Pass uid, or keyword to match the first node.',
      parameters: {
        type: 'object',
        properties: {
          uid: { type: 'string', description: 'Node uid' },
          keyword: { type: 'string', description: 'Alternative: first node whose text contains this keyword' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_node_detail',
      description: 'Get the full details of one node: text, uid, parent, direct children (with uids), styles (color/fill/bold/italic/size), note, cloze status, summary. Use to inspect a node before editing.',
      parameters: {
        type: 'object',
        properties: {
          uid: { type: 'string', description: 'Node uid' },
          keyword: { type: 'string', description: 'Alternative: first node whose text contains this keyword' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'rename_mindmap_file',
      description: 'Rename the currently open mindmap file (.smm) on disk. Pass new_name (with or without .smm extension). The app switches to the new path.',
      parameters: {
        type: 'object',
        properties: {
          new_name: { type: 'string', description: 'New file name (without path; .smm auto-appended if missing)' }
        },
        required: ['new_name']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'merge_nodes',
      description: 'Merge multiple nodes into one: texts concatenated in order, children of all nodes merged under the merged node, the other nodes deleted. For duplicate nodes (e.g. merging three duplicate "细胞凋亡"). NOT undoable with Ctrl+Z — to roll back, do not save and reopen the file.',
      parameters: {
        type: 'object',
        properties: {
          uids: { type: 'array', items: { type: 'string' }, description: 'uid list of nodes to merge (at least 2; the first is the kept node)' },
          separator: { type: 'string', description: 'Text join separator, default "、" (set "newline" to join with line breaks)' }
        },
        required: ['uids']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'scheduled_task',
      description: 'AI scheduled tasks (app wakes at the trigger time and prompt is sent to the AI). action=create: name/prompt/datetime(YYYY-MM-DD HH:mm)/cycle(once|daily|weekly|monthly) required. action=list: list all tasks with taskId. action=update: change name/prompt/datetime/cycle/enabled by task_id (only changed fields). action=delete: remove by task_id (confirm first). Example: user says 每天晚上8点提醒我复习 -> action=create, name=晚间复习提醒, prompt=汇总复习计划完成情况, datetime=today 20:00, cycle=daily. NOTE: this is for creating/removing app automation triggers, NOT for querying study plans. When the user asks about 本周任务/复习计划/待复习/学习安排, use get_review_schedule instead.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['create', 'list', 'update', 'delete'], description: 'create / list / update / delete' },
          name: { type: 'string', description: 'Task name (create/update)' },
          prompt: { type: 'string', description: 'Prompt sent to AI on trigger (create/update)' },
          datetime: { type: 'string', description: 'Trigger time YYYY-MM-DD HH:mm (create/update)' },
          cycle: { type: 'string', enum: ['once', 'daily', 'weekly', 'monthly'], description: 'Repeat cycle (create/update)' },
          enabled: { type: 'boolean', description: 'true=enable, false=pause (update)' },
          task_id: { type: 'string', description: 'Task ID (update/delete)' }
        },
        required: ['action']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'find_related',
      description: 'Related content: find things related to a keyword in the local knowledge base (all indexed maps) and the current map; returns a source list and linking suggestions (for "what else in my KB relates to X" questions).',
      parameters: {
        type: 'object',
        properties: {
          keyword: { type: 'string', description: 'Keyword to find related content for' },
          count: { type: 'number', description: 'Max items per source, default 8' }
        },
        required: ['keyword']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'memory',
      description: 'Long-term memory management. action=save: store a stable user preference/habit/fact, ONLY when the user explicitly expresses long-term intent ("记住…", "以后都…", "我总是…", "我喜欢…"); never save one-off commands or temporary queries. action=get: list all saved memories. action=forget: delete one memory by id (only after user consent).',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['save', 'get', 'forget'], description: 'save=store, get=list all, forget=delete one' },
          content: { type: 'string', description: 'For save: what to remember (one sentence)' },
          type: { type: 'string', enum: ['preference', 'habit', 'knowledge', 'fact'], description: 'For save: memory category' },
          id: { type: 'string', description: 'For forget: id of the entry (from a previous get)' }
        },
        required: ['action']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_local_file',
      description: 'Read a local document in full: txt/md/json/log (direct), docx (text extraction), xlsx/xls/csv/tsv (Excel/CSV tables, each row becomes one tab-separated line), pdf (text extraction; scanned PDF auto-OCR via page_start/page_end or ocr_all), images (auto OCR), smm (outline text). Use when user @-references or asks to analyze a local file.',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'Absolute file path (from a reference link or list_files result)' },
          max_chars: { type: 'number', description: 'Max chars returned, default 50000; for long docs read the front part first, then read in segments as needed' },
          offset: { type: 'number', description: 'Start reading from this char (pair with max_chars to page through long docs), default 0' },
          page_start: { type: 'number', description: 'First page when the PDF goes OCR (1-based, default 1)' },
          page_end: { type: 'number', description: 'Last page when the PDF goes OCR (inclusive). If set, OCR exactly page_start~page_end; default 8 pages' },
          ocr_all: { type: 'boolean', description: 'When the PDF goes OCR, recognize all pages (takes precedence over page_end)' }
        },
        required: ['file_path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_mcp_servers',
      description: 'List configured MCP servers. Returns id, name, transport, url/command, enabled.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_mcp_tools',
      description: 'List tools exposed by one MCP server. Use before mcp_call_tool when the server tools are unknown.',
      parameters: {
        type: 'object',
        properties: { serverId: { type: 'string', description: 'MCP server id from list_mcp_servers' } },
        required: ['serverId']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'mcp_call_tool',
      description: 'Call a tool on a configured MCP server. Returns the raw MCP tool result.',
      parameters: {
        type: 'object',
        properties: {
          serverId: { type: 'string', description: 'MCP server id from list_mcp_servers' },
          toolName: { type: 'string', description: 'Tool name from list_mcp_tools' },
          arguments: { type: 'object', description: 'Tool arguments object' }
        },
        required: ['serverId', 'toolName']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'update_mcp_server',
      description: 'Update a configured MCP server (e.g. change its URL/port, command, args, headers, or enable/disable). Only provided fields are changed; others stay.',
      parameters: {
        type: 'object',
        properties: {
          serverId: { type: 'string', description: 'MCP server id from list_mcp_servers' },
          name: { type: 'string', description: 'New display name (optional)' },
          url: { type: 'string', description: 'New URL for http/sse transport (optional)' },
          command: { type: 'string', description: 'New command for stdio transport (optional)' },
          args: { type: 'array', items: { type: 'string' }, description: 'New args for stdio transport (optional)' },
          env: { type: 'object', description: 'New env vars (optional)' },
          headers: { type: 'object', description: 'New headers (optional)' },
          enabled: { type: 'boolean', description: 'Enable or disable (optional)' }
        },
        required: ['serverId']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_custom_tools',
      description: 'List custom tools from the custom-tools directory. Returns id, name, description, category, enabled, autoInvoke, parameters, hasScript.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'call_custom_tool',
      description: 'Call a custom tool by id. Arguments must match the tool\'s parameters schema from list_custom_tools. Use this for user-added tools.',
      parameters: {
        type: 'object',
        properties: {
          toolId: { type: 'string', description: 'Custom tool id from list_custom_tools' },
          arguments: { type: 'object', description: 'Tool arguments object' }
        },
        required: ['toolId']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'update_custom_tool',
      description: 'Update a custom tool by id (name/description/enabled/autoInvoke). Only provided fields are changed. Use when the user asks to change a saved tool.',
      parameters: {
        type: 'object',
        properties: {
          toolId: { type: 'string', description: 'Custom tool id from list_custom_tools' },
          name: { type: 'string', description: 'New display name (optional)' },
          description: { type: 'string', description: 'New description (optional)' },
          enabled: { type: 'boolean', description: 'Enable or disable (optional)' },
          autoInvoke: { type: 'boolean', description: 'Auto-invoke flag (optional)' }
        },
        required: ['toolId']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_skills',
      description: 'List saved skills with name/description/enabled/autoInvoke. Use to decide whether a known workflow exists.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_skill',
      description: 'Get a saved skill including its full instructions.',
      parameters: {
        type: 'object',
        properties: { skillId: { type: 'string', description: 'Skill id from list_skills' } },
        required: ['skillId']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'invoke_skill',
      description: 'Invoke a saved skill by returning its full instructions for immediate execution.',
      parameters: {
        type: 'object',
        properties: { skillId: { type: 'string', description: 'Skill id from list_skills' } },
        required: ['skillId']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_skill',
      description: 'Create a reusable skill from a successful workflow or known pitfall. The user can later invoke it manually or let AI auto-invoke it.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Short skill name' },
          description: { type: 'string', description: 'What this skill solves' },
          instructions: { type: 'string', description: 'Step-by-step instructions for future runs' },
          autoInvoke: { type: 'boolean', description: 'true=AI may auto-use this skill when relevant' }
        },
        required: ['name', 'instructions']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'update_skill',
      description: 'Update an existing skill.',
      parameters: {
        type: 'object',
        properties: {
          skillId: { type: 'string', description: 'Skill id from list_skills' },
          name: { type: 'string', description: 'New name' },
          description: { type: 'string', description: 'New description' },
          instructions: { type: 'string', description: 'New instructions' },
          autoInvoke: { type: 'boolean', description: 'Whether AI may auto-use this skill' }
        },
        required: ['skillId']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'delete_skill',
      description: 'Delete a saved skill.',
      parameters: {
        type: 'object',
        properties: { skillId: { type: 'string', description: 'Skill id from list_skills' } },
        required: ['skillId']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'context_window',
      description: 'Per-model context window table used for token estimation/compression. action=list: list all records (builtin + user overrides); action=get: query one model window (value + source); action=set: write/update a user override for one model; action=delete: remove the user override (falls back to builtin/default).',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['list', 'get', 'set', 'delete'], description: 'list all / get one / set override / delete override' },
          model: { type: 'string', description: 'Model name (required for get/set/delete)' },
          context_window: { type: 'number', description: 'Context window size in tokens (required for set), e.g. 128000' }
        },
        required: ['action']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_directory',
      description: 'List the entries of a local folder. By default lists one level (subfolders + supported files with modified dates). Set recursive=true to recursively list ALL subdirectories and files (directory tree). Default dir = folder of the currently open file; in MCP/external calls it falls back to the directory-tree roots. Use to browse what exists in a folder (find_local_file only matches keywords and shows no folder structure).',
      parameters: {
        type: 'object',
        properties: {
          dir_path: { type: 'string', description: 'Absolute folder path; omit = folder of the currently open file, or the directory-tree roots if no file is open' },
          recursive: { type: 'boolean', description: 'true = recursively list all subdirectories (directory tree); default false = one level' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'find_local_file',
      description: 'Find local files by filename keyword and return absolute paths. For directory listing use list_directory. If user asks to open a found file, set open=true and ALWAYS include the returned path in your reply. Never guess paths.',
      parameters: {
        type: 'object',
        properties: {
          keyword: { type: 'string', description: 'Filename keyword (partial match, case-insensitive), e.g. "认知心理学" or "导论-马克思主义". Omit to list files under dirs (default common dirs)' },
          exts: { type: 'array', items: { type: 'string' }, description: 'Extension filter array, e.g. ["md","smm","pdf"]; empty = no filter' },
          dirs: { type: 'array', items: { type: 'string' }, description: 'Extra dirs to search (absolute paths); default searches Desktop/Documents/Downloads/default save dir/app dir' },
          open: { type: 'boolean', description: 'true=open the first matching file with the system default app after finding it (for user requests like 打开/查看文件)' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'import_file_as_mindmap',
      description: 'Import an external-format file as a mindmap and save it as .smm: supports Markdown(.md), OPML outline(.opml), FreeMind(.mm), XMind(.xmind), plain text(.txt, split into nodes per line). Use when the user says import / convert to a map / turn this file into a mindmap — instead of hand-copying content with generate_mindmap.',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'Absolute source file path' },
          open: { type: 'boolean', description: 'true=load onto the current canvas right after import (replaces canvas content; unsaved content is lost — use with care); default false = only save the .smm file, canvas untouched' },
          save_dir: { type: 'string', description: 'Save directory (default: the folder of the source file)' }
        },
        required: ['file_path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_references',
      description: 'Reference list & broken-link check: list the @file/#node references in nodes (which node references which node of which file) and check each referenced file/node still exists (deleted/renamed/moved files create broken links). Use for "which nodes reference this file / what files did I reference / are there broken links".',
      parameters: {
        type: 'object',
        properties: {
          scope: { type: 'string', enum: ['current', 'all'], description: 'current=current map only (default); all=scan all map files under the save dir' },
          file_path: { type: 'string', description: 'Only list nodes referencing this file (optional filter)' }
        }
      }
    }
  },

]

// 工具名 → 中文名映射（用于访问令牌权限勾选界面等面向用户的展示）
export const TOOL_NAME_MAP = {
  generate_mindmap: '生成导图',
  expand_node: '扩展节点',
  set_mindmap_data: '更新导图数据',
  summarize_node: '添加概要',
  search_nodes: '搜索节点',
  update_node_text: '修改节点文本',
  delete_node: '删除节点',
  change_layout: '切换布局',
  export_mindmap: '导出导图',
  get_mindmap_info: '获取导图信息',
  insert_sibling_node: '插入兄弟节点',
  insert_child_node: '插入子节点',
  insert_parent_node: '插入父节点',
  move_node_up: '上移节点',
  move_node_down: '下移节点',
  toggle_node_expand: '展开/收起节点',
  remove_node_only: '仅删除节点',
  copy_node: '复制节点',
  cut_node: '剪切节点',
  paste_node: '粘贴节点',
  set_node_text: '设置节点文本',
  set_node_style: '设置节点样式',
  search_web: '联网搜索',
  audit_mindmap: '导图诊断',
  refactor_mindmap: '导图重构',
  research_to_mindmap: '研究生成导图',
  read_webpage: '读取网页',
  get_location: '获取位置',
  ocr_recognize: 'OCR 识别',
  search_knowledge_base: '知识库搜索',
  ai_continue_children: 'AI 续写子节点',
  parallel_ai_workers: '并行子 Agent',
  ai_recite_rewrite: 'AI 背诵改写',
  ai_cloze: 'AI 智能挖空',
  ai_cloze_full_map: 'AI 全文挖空',
  ai_quiz: 'AI 出题（新文件）',
  ai_quiz_append: 'AI 出题（挂到节点）',
  batch_text_style: '批量文字样式',
  focus_node: '定位节点',
  query_node_styles: '查询节点样式',
  get_review_schedule: '查询复习计划',
  get_today_review_status: '今日复习状态',
  delete_review_plan: '删除复习计划',
  format_painter: '格式刷',
  set_node_note: '节点备注',
  outer_frame: '外框',
  associative_line: '关联线',
  undo: '撤销',
  redo: '重做',
  upload_to_feishu: '上传到飞书',
  save_mindmap: '保存导图',
  new_mindmap: '新建导图',
  get_mindmap_content: '获取导图内容',
  add_to_review: '添加复习',
  read_mindmap_file: '读取导图文件',
  read_node_image: '识别节点图片',
  semantic_search: '语义检索',
  activate_tools: '激活工具',
  move_node: '移动节点',
  merge_nodes: '合并节点',
  scheduled_task: '定时任务',
  find_related: '关联推荐',
  memory: '长期记忆',
  context_window: '上下文窗口',
  feishu_list_files: '飞书文件列表',
  feishu_get_doc_content: '读取飞书文档',
  feishu_delete_file: '删除飞书文件',
  feishu_rename_file: '重命名飞书文件',
  upload_mindmap_to_feishu_doc: '上传导图为飞书文档',
  upload_file_to_feishu: '上传文件到飞书',
  send_feishu_message: '发送飞书消息',
  send_wechat_message: '发送微信消息',
  send_wechat_image: '发送微信图片',
  send_feishu_image: '发送飞书图片',
  send_wechat_file: '发送微信文件',
  send_feishu_file: '发送飞书文件',
  select_node: '选中节点',
  batch_node_actions: '批量节点操作',
  read_local_file: '读取本地文件',
  save_text_file: '保存文本文件',
  delete_local_file: '删除本地文件',
  find_local_file: '查找本地文件',
  retrieve_local_file: '检索本地文件',
  list_directory: '列出目录',
  import_file_as_mindmap: '导入文件为导图',
  export_to_markdown: '导出 Markdown',
  export_mindmap_html: '导出 HTML（含全视图）',
  export_mindmap_pdf: '导出导图 PDF',
  export_outline_pdf: '导出大纲 PDF',
  export_subtree: '导出子树',
  merge_mindmap_files: '合并导图文件',
  clear_mindmap: '清空导图',
  clear_cloze: '清除挖空',
  toggle_cloze_visibility: '切换挖空可见性',
  list_cloze_nodes: '列出挖空节点',
  mechanical_cloze: '机械挖空',
  complete_review_task: '完成复习任务',
  add_child_nodes: '批量添加子节点',
  rename_mindmap_file: '重命名导图文件',
  duplicate_nodes: '复制节点（多选）',
  sort_children: '子节点排序',
  read_node_subtree: '读取节点子树',
  get_node_detail: '获取节点详情',
  query_nodes: '查询节点',
  set_theme: '设置主题',
  switch_view: '切换视图',
  zoom_control: '缩放控制',
  list_references: '列出引用',
  find_replace_text: '查找替换文本',
  create_skill: '创建技能',
  update_skill: '更新技能',
  get_skill: '获取技能',
  delete_skill: '删除技能',
  list_skills: '列出技能',
  invoke_skill: '调用技能',
  list_custom_tools: '列出自定义工具',
  call_custom_tool: '调用自定义工具',
  list_mcp_servers: '列出 MCP 服务',
  list_mcp_tools: '列出 MCP 工具',
  mcp_call_tool: '调用 MCP 工具',
  semantic_tool_search: '语义工具搜索'
}

// MCP 访问令牌权限勾选列表：与 ChatPanel.listMcpTools 同源（getCoreTools + aiTools），
// 类目与描述取自工具目录（目录没有的归 Other），保证勾选列表与 MCP 实际下发的工具完全一致
export function getMcpToolPermissions() {
  const byName = new Map()
  for (const t of toolCatalog) byName.set(t.name, t)
  const groups = new Map()
  const seen = new Set()
  for (const t of [...getCoreTools(), ...aiTools]) {
    const name = t?.function?.name
    if (!name || seen.has(name)) continue
    seen.add(name)
    const meta = byName.get(name) || {}
    const cat = meta.category || 'Other'
    if (!groups.has(cat)) groups.set(cat, [])
    groups.get(cat).push({ name, cnName: TOOL_NAME_MAP[name] || '', desc: meta.desc || '' })
  }
  return groups
}

// ========== 批量操作共享助手 ==========
// 节点富文本 → 纯文本
function nodePlainText(html) {
  return String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// 关键词匹配用文本归一化：去除 HTML 标签、所有空白与零宽/不可见字符（零宽空格 U+200B、零宽连接符 U+200C/200D、
// 左右标记 U+200E/200F、词连接符 U+2060、软连字符 U+00AD 等），解决节点文本中混入零宽/全角/连续空格导致关键词无法命中。
function normalizeForMatch(str) {
  return String(str || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, '')
    .replace(/[\u00AD\u200B-\u200F\u2028\u2029\u202F\u205F\u2060\u3000\uFEFF]/g, '')
    .replace(/\s+/g, '')
    .toLowerCase()
}

// 本地文档文本提取缓存：path → { success, text, source, noTextLayer? }（拖入文件后语义检索/多次读取避免重复解析，加速）
const localDocTextCache = new Map()
// 缓存上限：最多缓存 20 个文档，单文档文本最多 2MB（超大文档不缓存全文，避免内存被挤爆）
const LOCAL_DOC_CACHE_MAX = 20
const LOCAL_DOC_CACHE_MAX_TEXT = 2 * 1024 * 1024

// 写缓存：超大文本不缓存；超过条数淘汰最早插入的（近似 FIFO，足够控制内存）
function setLocalDocCache(key, value) {
  const textLen = value?.text?.length || 0
  if (textLen > LOCAL_DOC_CACHE_MAX_TEXT) return
  if (localDocTextCache.has(key)) localDocTextCache.delete(key)
  localDocTextCache.set(key, value)
  while (localDocTextCache.size > LOCAL_DOC_CACHE_MAX) {
    const oldest = localDocTextCache.keys().next().value
    localDocTextCache.delete(oldest)
  }
}

// 路径自动纠错：文件不存在时，用文件名做模糊搜索（桌面/文档/下载/默认保存目录等常用目录），
// 命中唯一文件则返回其路径，命中多个返回候选列表，未命中返回 null。
// 目的：消除模型"猜错路径 → 报文件不存在 → 再 find_local_file"的多余往返（高频文档场景）。
async function resolveFilePathAuto(filePath) {
  const norm = String(filePath || '').trim()
  if (!norm) return { resolved: null, candidates: [], searched: false }
  try {
    if (!window.electronAPI?.fs?.findFile) return { resolved: null, candidates: [], searched: false }
    const exists = await window.electronAPI.fs.exists(norm)
    if (exists) return { resolved: norm, candidates: [], searched: false }
    const baseName = norm.split(/[/\\]/).pop().replace(/\.[^.]+$/, '')
    if (!baseName) return { resolved: null, candidates: [], searched: false }
    const r = await window.electronAPI.fs.findFile({ keyword: baseName, maxResults: 8 })
    if (!r?.success || !Array.isArray(r.results) || r.results.length === 0) {
      return { resolved: null, candidates: [], searched: true }
    }
    // 优先按扩展名匹配，其次按 basename 精确匹配
    const ext = norm.split('.').pop().toLowerCase()
    let matches = r.results
    if (ext && ext !== 'pdf' && ext !== 'docx' && ext !== 'xlsx' && ext !== 'txt' && ext !== 'md') {
      // 无明确扩展名时全部候选
    } else if (ext) {
      const extMatches = r.results.filter(f => f.path.toLowerCase().endsWith('.' + ext))
      if (extMatches.length) matches = extMatches
    }
    if (matches.length === 1) return { resolved: matches[0].path, candidates: [], searched: true }
    return { resolved: null, candidates: matches.map(m => m.path), searched: true }
  } catch {
    return { resolved: null, candidates: [], searched: false }
  }
}

// 从本地文档提取文本（txt/md/docx/pdf 文本层），带缓存；不处理 OCR 扫描版（走 read_local_file 兜底）
// review A5：大代码文件提示。完全精确的"按 offset 字节读文件"需要在主进程新增 IPC（fs:readFileRange），
// 为了"保证功能正常运行"且改动可控，这里做最小化改动：保留全文件 readFile 行为（向后兼容），
// 但当全文超过 500KB 时，在 message 里提示 AI 改用 offset/max_chars 分次读取（避免一次 IPC 几百 KB 阻塞）。
const CODE_FILE_HINT_THRESHOLD = 500 * 1024 // 500KB
const _codeFileSizeCache = new Map() // filePath -> { size, at }
async function getCodeFileSize(filePath) {
  const cached = _codeFileSizeCache.get(filePath)
  if (cached && Date.now() - cached.at < 60000) return cached.size
  try {
    const stat = await window.electronAPI.fs.stat(filePath)
    const size = typeof stat === 'number' ? stat : (stat?.size || 0)
    _codeFileSizeCache.set(filePath, { size, at: Date.now() })
    return size
  } catch (_) { return 0 }
}

async function extractLocalDocTextCached(filePath, ext) {
  const key = filePath
  if (localDocTextCache.has(key)) return localDocTextCache.get(key)
  let result = { success: false, error: '不支持的格式' }
  try {
    // 统一走 docParseService：PDF(pdfjs) / DOCX(mammoth) / XLSX(exceljs) / CSV·TSV(papaparse) / 文本直读
    if (['txt', 'md', 'markdown', 'json', 'log', 'csv', 'tsv', 'html', 'xml', 'docx', 'pdf', 'xlsx', 'xls', 'pptx'].includes(ext)) {
      const res = await parseDocument(filePath)
      result = res.success
        ? { success: true, text: res.text, source: res.type, meta: res.meta }
        : { success: false, error: res.error, noTextLayer: ext === 'pdf' }
    }
  } catch (e) {
    result = { success: false, error: e.message || String(e) }
  }
  if (result.success) setLocalDocCache(key, result)
  return result
}

// 预热文本缓存：文档在查看器中打开时提取文本后写入缓存，
// 让 Agent 后续 read_local_file / retrieve_local_file 直接命中，无需重新解析全文（加速读取）
export function warmLocalDocTextCache(filePath, ext, text, meta) {
  if (!filePath || !text) return
  setLocalDocCache(filePath, { success: true, text, source: ext, meta: meta || {} })
}

// 后台索引文档到知识库（fire-and-forget，失败静默）：BM25 入库 + 本地向量索引
async function indexDocumentInBackground(filePath, fileName, ext, text) {
  try {
    if (!searchService.isAvailable()) return
    const docExts = ['docx', 'xlsx', 'xls', 'csv', 'tsv', 'pdf', 'pptx', 'ppt', 'txt', 'md', 'markdown', 'json', 'log', 'html', 'xml']
    if (!docExts.includes(ext)) return
    const chunks = chunkText(String(text || ''))
    if (!chunks.length) return
    let mtime = ''
    if (window.electronAPI?.fs?.stat) {
      const st = await window.electronAPI.fs.stat(filePath)
      if (st?.success) mtime = st.mtime
    }
    const r = await searchService.indexDocument(filePath, fileName, 'doc', chunks, mtime)
    // BM25 入库成功且非跳过（内容有更新）时追加向量索引（E5 本地推理，异步慢速）
    if (r?.success && !r?.skipped) {
      searchService.indexDocumentVectors(filePath, fileName, mtime, chunks.slice(0, 500))
    }
  } catch { /* 索引失败不影响读取 */ }
}

// 把全文按段落切分为约 chunkSize 字的片段（保留段落边界）
function chunkDocument(text, chunkSize = 700) {
  const raw = String(text || '')
  const paras = raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean)
  const chunks = []
  let cur = ''
  for (const p of paras) {
    if (cur && (cur + '\n' + p).length > chunkSize) {
      chunks.push(cur)
      cur = p
    } else {
      cur = cur ? cur + '\n' + p : p
    }
  }
  if (cur.trim()) chunks.push(cur)
  return chunks
}

// 由用户问题生成检索词：去除标点/空白后的词项 + 中文相邻二字组（bigram）
function buildQueryTerms(query) {
  const q = normalizeForMatch(query)
  const terms = [...new Set(q.split(/[\s,，。；;、/|：:？?！!（）()【】[\]'"“”‘’]+/).filter(t => t.length >= 2))]
  const ngrams = []
  for (let i = 0; i < q.length - 1; i++) {
    const pair = q.slice(i, i + 2)
    if (/[\u4e00-\u9fff]{2}/.test(pair)) ngrams.push(pair)
  }
  return { terms, ngrams: [...new Set(ngrams)] }
}

// 中文数字 → 整数（支持 一~九十九、百；阿拉伯数字直转）
function zhNumToInt(s) {
  const t = String(s || '').trim()
  if (!t) return -1
  if (/^\d+$/.test(t)) return parseInt(t, 10)
  const map = { '零': 0, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 }
  let n = 0
  if (t.includes('十')) {
    const parts = t.split('十')
    n = (parts[0] ? (map[parts[0]] ?? 1) : 1) * 10 + (parts[1] ? (map[parts[1]] ?? 0) : 0)
  } else if (t.includes('百')) {
    const parts = t.split('百')
    n = (map[parts[0]] ?? 1) * 100 + (parts[1] ? zhNumToInt(parts[1]) : 0)
  } else {
    n = map[t] ?? -1
  }
  return n
}

// 从 query 中解析目标章节号：{ chapter, section }（无则为 null）
function parseChapterQuery(query) {
  const q = String(query || '')
  const chapter = q.match(/第\s*([一二三四五六七八九十百零两\d]+)\s*章/)
  const section = q.match(/第\s*([一二三四五六七八九十百零两\d]+)\s*节/)
  return {
    chapter: chapter ? zhNumToInt(chapter[1]) : null,
    section: section ? zhNumToInt(section[1]) : null
  }
}

// 章节标题行判断：归一化后以「第X章」「第X节」开头（PDF 提取文本可能带字符间空格）
const CHAPTER_LINE_RE = /^第[一二三四五六七八九十百零两\d]+章/
const SECTION_LINE_RE = /^第[一二三四五六七八九十百零两\d]+节/

// 按章节定位提取连续内容：query 含「第X章/第X节」时，返回该章节标题到下一同级标题之间的完整原文。
// 文档无目录/章节标题（如纯文本、无层级 PDF）时返回 null，由调用方降级为语义检索。
function extractSectionByHeading(fullText, query) {
  const { chapter, section } = parseChapterQuery(query)
  if (chapter == null && section == null) return null
  const lines = String(fullText || '').split(/\r?\n/)
  const parsed = [] // { idx, norm, chapter, section }
  let curChapter = null
  let curSection = null
  for (let i = 0; i < lines.length; i++) {
    const norm = normalizeForMatch(lines[i])
    const c = norm.match(CHAPTER_LINE_RE)
    const s = norm.match(SECTION_LINE_RE)
    if (c) {
      const n = zhNumToInt(norm.slice(1, norm.indexOf('章')))
      if (n >= 0) { curChapter = n; curSection = null }
    } else if (s) {
      const n = zhNumToInt(norm.slice(1, norm.indexOf('节')))
      if (n >= 0) curSection = n
    }
    parsed.push({ idx: i, norm, chapter: curChapter, section: curSection })
  }

  // 目标：匹配 chapter（若指定）与 section（若指定）
  const target = parsed.filter(p =>
    (chapter == null || p.chapter === chapter) &&
    (section == null || p.section === section)
  )
  if (!target.length) return null

  // 取目标连续区间的起止行（中间可能有换页等杂质，但尽量连续）
  const startIdx = target[0].idx
  let endIdx = target[target.length - 1].idx
  // 向后延伸直到遇到下一同级标题（下一章/下一节），截断区间
  const isTitle = (p) => p.norm.match(CHAPTER_LINE_RE) || p.norm.match(SECTION_LINE_RE)
  for (let i = endIdx + 1; i < lines.length; i++) {
    if (isTitle(parsed[i])) break
    endIdx = i
  }
  const content = lines.slice(startIdx, endIdx + 1).map(s => s.trim()).filter(Boolean).join('\n')
  if (!content) return null
  return content
}

// 根据问题对片段打分，返回 topK 个最相关片段
function retrieveRelevantChunks(fullText, query, topK = 6) {
  const { terms, ngrams } = buildQueryTerms(query)
  const chunks = chunkDocument(fullText)
  return chunks.map((text, i) => {
    const norm = normalizeForMatch(text)
    let score = 0
    for (const t of terms) if (t && norm.includes(t)) score += 5
    for (const ng of ngrams) if (ng && norm.includes(ng)) score += 1
    return { i, text, score }
  }).filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
}

// 按 targets（uids/keyword/mode）解析目标节点集合，供 select_node / set_node_style / ai_cloze / batch_node_actions 复用
function resolveTargetNodes(mindMap, targets = {}) {
  const keywordRaw = String(targets.keyword || '').trim()
  const keyword = normalizeForMatch(keywordRaw)
  const uidList = Array.isArray(targets.uids) ? targets.uids.filter(Boolean) : []
  const mode = targets.mode || ''
  const includeChildren = !!targets.includeChildren

  const uidSet = new Set(uidList)
  const plainText = nodePlainText

  const found = []
  const seen = new Set()
  const root = mindMap?.renderer?.root
  if (!root) return { nodes: [], error: '思维导图未初始化' }

  // 显式 uid/keyword 优先级最高：即使模型同时误传 mode=all，也不能忽略 uids 去操作整图。
  const hasExplicitTargets = uidList.length > 0 || !!keyword
  if (hasExplicitTargets) {
    const baseNodes = []
    const addUnique = (node) => {
      const uid = node.getData?.('uid') || node.uid
      if (uid && !seen.has(uid)) {
        seen.add(uid)
        found.push(node)
      }
    }
    const walk = (node) => {
      if (!node || node.isGeneralization) return
      const uid = node.getData?.('uid') || node.uid
      const text = plainText(node.getData?.('text'))
      const matched = (uid && uidSet.has(uid)) || (keyword && normalizeForMatch(text).includes(keyword))
      if (matched && uid) {
        baseNodes.push(node)
        addUnique(node)
      }
      ;(node.children || []).forEach(walk)
    }
    walk(root)
    // uid 未命中时兜底：AI 可能误把节点文本当作 uid 传入，把 uid 值当文本关键词再匹配一次
    if (found.length === 0 && uidList.length > 0) {
      const uidKeywords = uidList.map(u => normalizeForMatch(u))
      const walkByText = (node) => {
        if (!node || node.isGeneralization) return
        const uid = node.getData?.('uid') || node.uid
        const text = normalizeForMatch(plainText(node.getData?.('text')))
        if (uidKeywords.some(k => k && text.includes(k)) && uid) {
          baseNodes.push(node)
          addUnique(node)
        }
        ;(node.children || []).forEach(walkByText)
      }
      walkByText(root)
    }

    if (baseNodes.length === 0) {
      const active = (mindMap?.renderer?.activeNodeList || []).filter(n => n && !n.isGeneralization)
      if (active.length > 0) return { nodes: active, error: null }
      return { nodes: [], error: keywordRaw ? `未找到包含"${keywordRaw}"的节点` : '未找到对应 uid 的节点' }
    }

    // 显式 targets 与结构范围组合：uids/keyword 先定位基点，再按 mode 展开
    if (mode === 'leaves' || mode === 'leaf_parents') {
      const expanded = []
      const expandedSeen = new Set()
      const addExpanded = (node) => {
        const uid = node.getData?.('uid') || node.uid
        if (uid && !expandedSeen.has(uid)) {
          expandedSeen.add(uid)
          expanded.push(node)
        }
      }
      const collectStructure = (node, parent) => {
        if (!node || node.isGeneralization) return
        const children = (node.children || []).filter(c => !c.isGeneralization)
        const isLeaf = children.length === 0
        if (mode === 'leaves' && isLeaf) addExpanded(node)
        if (mode === 'leaf_parents' && isLeaf && parent) addExpanded(parent)
        children.forEach(c => collectStructure(c, node))
      }
      for (const base of baseNodes) {
        if (includeChildren) {
          collectStructure(base, null)
        } else if (mode === 'leaves') {
          const children = (base.children || []).filter(c => !c.isGeneralization)
          if (children.length === 0) addExpanded(base)
        } else {
          const children = (base.children || []).filter(c => !c.isGeneralization)
          if (children.length === 0) {
            const parent = (() => {
              const uid = base.getData?.('uid') || base.uid
              let res = null
              const walkP = (n, p) => {
                if (!n || res) return
                if ((n.getData?.('uid') || n.uid) === uid) { res = p; return }
                ;(n.children || []).forEach(c => walkP(c, n))
              }
              walkP(root, null)
              return res
            })()
            if (parent) addExpanded(parent)
          }
        }
      }
      if (expanded.length) return { nodes: expanded, error: null }
      return { nodes: [], error: mode === 'leaves' ? '指定范围内未找到终末节点' : '指定范围内未找到终末节点的父节点' }
    }

    // 普通展开：includeChildren 时返回基点及其全部后代
    if (includeChildren) {
      const collectSubtree = (node) => {
        ;(node.children || []).forEach(c => {
          addUnique(c)
          collectSubtree(c)
        })
      }
      baseNodes.forEach(collectSubtree)
    }
    return { nodes: found, error: null }
  }

  if (mode === 'level_range') {
    const minDepth = Number.isFinite(Number(targets.minDepth)) ? Number(targets.minDepth) : 0
    const maxDepth = Number.isFinite(Number(targets.maxDepth)) ? Number(targets.maxDepth) : Number.MAX_SAFE_INTEGER
    const walkLevel = (node, depth) => {
      if (!node || node.isGeneralization) return
      if (depth >= minDepth && depth <= maxDepth) {
        const uid = node.getData?.('uid') || node.uid
        if (uid && !seen.has(uid)) {
          seen.add(uid)
          found.push(node)
        }
      }
      ;(node.children || []).forEach(c => walkLevel(c, depth + 1))
    }
    walkLevel(root, 0)
    if (found.length === 0) {
      return { nodes: [], error: `层级 ${minDepth}~${maxDepth} 内没有节点` }
    }
  } else if (mode === 'all') {
    // 全部节点（batch_text_style 常用：对整图内匹配文字片段做样式）
    const walkAll = (node) => {
      if (!node || node.isGeneralization) return
      const uid = node.getData?.('uid') || node.uid
      if (uid && !seen.has(uid)) {
        seen.add(uid)
        found.push(node)
      }
      (node.children || []).forEach(walkAll)
    }
    walkAll(root)
    if (found.length === 0) {
      return { nodes: [], error: '导图没有任何节点' }
    }
  } else if (mode === 'leaf_parents' || mode === 'leaves') {
    // 结构化批量：leaves=全部终末节点；leaf_parents=全部终末节点的父节点（去重）
    const walkMode = (node, parent) => {
      if (!node || node.isGeneralization) return
      const children = (node.children || []).filter(c => !c.isGeneralization)
      const uid = node.getData?.('uid') || node.uid
      const isLeaf = children.length === 0
      if (mode === 'leaves' && isLeaf && uid && !seen.has(uid)) {
        seen.add(uid)
        found.push(node)
      }
      if (mode === 'leaf_parents' && isLeaf && parent) {
        const puid = parent.getData?.('uid') || parent.uid
        if (puid && !seen.has(puid)) {
          seen.add(puid)
          found.push(parent)
        }
      }
      children.forEach(c => walkMode(c, node))
    }
    walkMode(root, null)
    if (found.length === 0) {
      return { nodes: [], error: mode === 'leaves' ? '未找到终末节点（导图可能为空）' : '未找到终末节点的父节点' }
    }
  } else {
    // 模型漏传 targets 时，回落到当前选中节点；大多数工具的自然作用目标就是当前选区。
    const active = (mindMap?.renderer?.activeNodeList || []).filter(n => n && !n.isGeneralization)
    if (active.length > 0) {
      return { nodes: active, error: null }
    }
    return { nodes: [], error: '请提供 keyword、uids 或 mode 至少一项，或先选中节点' }
  }
  return { nodes: found, error: null }
}

// 按 uid 或关键词解析单个节点（uid 优先精确匹配，否则文本包含的第一个节点）
function resolveNodeByUidOrKeyword(mindMap, val) {
  if (!val) return null
  const root = mindMap?.renderer?.root
  if (!root) return null
  const kw = String(val).toLowerCase()
  let byKeyword = null
  const walk = (node) => {
    if (!node || node.isGeneralization) return
    const uid = node.getData?.('uid') || node.uid
    if (uid === val) {
      byKeyword = node
      return
    }
    if (!byKeyword) {
      const text = nodePlainText(node.getData?.('text') || '').toLowerCase()
      if (text.includes(kw)) byKeyword = node
    }
    (node.children || []).forEach(walk)
  }
  walk(root)
  return byKeyword
}

// 复刻 AssociativeLine.removeLine 的数据清理逻辑（插件只支持删除激活线）
function removeAssocLineFromData(mindMap, fromNode, toNode) {
  const toUid = toNode.getData?.('uid') || toNode.uid
  const data = fromNode.getData()
  const targets = Array.isArray(data.associativeLineTargets) ? data.associativeLineTargets : []
  const idx = targets.indexOf(toUid)
  if (idx === -1) return false
  const points = Array.isArray(data.associativeLinePoint) ? data.associativeLinePoint : []
  const offsets = Array.isArray(data.associativeLineTargetControlOffsets) ? data.associativeLineTargetControlOffsets : []
  const textMap = data.associativeLineText || {}
  const styleMap = data.associativeLineStyle || {}
  const newTextMap = {}
  Object.keys(textMap).forEach((k) => { if (k !== toUid) newTextMap[k] = textMap[k] })
  const newStyleMap = {}
  Object.keys(styleMap).forEach((k) => { if (k !== toUid) newStyleMap[k] = styleMap[k] })
  mindMap.execCommand('SET_NODE_DATA', fromNode, {
    associativeLineTargets: targets.filter((_, i) => i !== idx),
    associativeLinePoint: points.filter((_, i) => i !== idx),
    associativeLineTargetControlOffsets: offsets.filter((_, i) => i !== idx),
    associativeLineText: newTextMap,
    associativeLineStyle: newStyleMap
  })
  return true
}

// 收集全图关联线：[{ fromNode, toNode, fromUid, toUid, text }]
function collectAssocLines(mindMap) {
  const lines = []
  const uidToNode = new Map()
  const walk = (node) => {
    if (!node || node.isGeneralization) return
    const uid = node.getData?.('uid') || node.uid
    if (uid) uidToNode.set(uid, node)
    const targets = node.getData?.('associativeLineTargets') || []
    const textMap = node.getData?.('associativeLineText') || {}
    for (const toUid of targets) {
      lines.push({ fromNode: node, fromUid: uid, toUid, text: textMap[toUid] || '' })
    }
    (node.children || []).forEach(walk)
  }
  walk(mindMap?.renderer?.root)
  for (const l of lines) l.toNode = uidToNode.get(l.toUid) || null
  return lines
}

// 把节点集合设置为当前选中（simple-mind-map 实际 API），后续依赖 activeNodeList 的功能即可批量作用
function setActiveNodes(mindMap, nodes) {
  if (typeof mindMap.renderer.clearActiveNode === 'function') mindMap.renderer.clearActiveNode()
  for (const node of nodes) {
    if (typeof mindMap.renderer.addNodeToActiveList === 'function') {
      mindMap.renderer.addNodeToActiveList(node)
    }
  }
  if (typeof mindMap.renderer.emitNodeActiveEvent === 'function') mindMap.renderer.emitNodeActiveEvent()
}

// 在节点富文本 HTML 的首尾文本处插入前后缀（保留全部行内样式），供 batch_node_actions.wrap_text 使用
// 解决"给 N 个节点文本加【】"这类包裹需求：update_node_text 会重置格式，此函数不丢格式
function wrapNodeTextHtml(html, prefix, suffix) {
  const pre = escHtml(String(prefix ?? ''))
  const suf = escHtml(String(suffix ?? ''))
  const src = String(html || '')
  if (!src.trim()) return `<p><span>${pre}${suf}</span></p>`
  if (!/<[a-z][\s\S]*>/i.test(src)) {
    // 纯文本节点（无 HTML 标签）
    return `<p><span>${pre}${escHtml(src)}${suf}</span></p>`
  }
  try {
    const wrapEl = document.createElement('div')
    wrapEl.innerHTML = src
    const walker = document.createTreeWalker(wrapEl, NodeFilter.SHOW_TEXT)
    const textNodes = []
    while (walker.nextNode()) textNodes.push(walker.currentNode)
    if (textNodes.length > 0) {
      const first = textNodes[0]
      first.nodeValue = pre + first.nodeValue
      const last = textNodes[textNodes.length - 1]
      last.nodeValue = last.nodeValue + suf
    } else {
      // 没有文本节点（如仅含 <br>/<img>）：前后缀插入首/末元素内部
      const firstEl = wrapEl.firstElementChild
      if (!firstEl) return `<p><span>${pre}${suf}</span></p>`
      firstEl.insertBefore(document.createTextNode(pre), firstEl.firstChild)
      const lastEl = wrapEl.lastElementChild || firstEl
      lastEl.appendChild(document.createTextNode(suf))
    }
    return wrapEl.innerHTML
  } catch (e) {
    return src
  }
}

// 在节点富文本 HTML 中查找替换（字面量或正则），保留行内样式；供 find_replace_text 与 batch_node_actions.replace_text 共用
function replaceHtmlFind(html, find, replacement, regex, flags) {
  const src = String(html || '')
  let count = 0
  if (regex) {
    let re
    try {
      re = new RegExp(find, flags || 'g')
    } catch (err) {
      return { out: src, count: 0, error: `正则表达式无效: ${err.message}` }
    }
    const out = src.replace(re, () => { count++; return replacement })
    return { out, count }
  }
  const escForHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  let out = src
  const literal = (s, needle) => {
    const c = s.split(needle).length - 1
    if (c > 0) { count += c; return s.split(needle).join(replacement) }
    return s
  }
  out = literal(out, find)
  const esc = escForHtml(find)
  if (esc !== find) out = literal(out, esc)
  return { out, count }
}

// 对节点集合批量应用样式，返回明细（与 set_node_style 原逻辑一致）
// 归一化节点边框颜色：接受颜色名/十六进制，统一为合法 CSS 颜色
function normalizeBorderColor(color) {
  const c = String(color || '').trim()
  if (!c) return '#007aff'
  // 常见中文颜色名映射
  const map = {
    红: '#f5222d', 橙: '#fa8c16', 黄: '#fadb14', 绿: '#52c41a', 青: '#13c2c2',
    蓝: '#007aff', 紫: '#722ed1', 粉: '#eb2f96', 黑: '#303133', 白: '#ffffff', 灰: '#8c8c8c'
  }
  if (map[c]) return map[c]
  // 已是合法颜色（#开头 或 rgb( / 颜色名），直接返回
  if (/^#[0-9a-fA-F]{3,8}$/.test(c) || /^rgb/i.test(c) || /^[a-z]+$/i.test(c)) return c
  return '#007aff'
}

function applyNodeStyles(mindMap, nodes, styleArgs = {}) {
  const details = []

  // 节点级样式：背景填充色 / 形状 / 字号 / 边框
  const nodeStyle = {}
  if (styleArgs.fillColor) nodeStyle.fillColor = normalizeNodeFillColor(styleArgs.fillColor)
  if (styleArgs.shape) nodeStyle.shape = styleArgs.shape
  if (styleArgs.fontSize) nodeStyle.fontSize = styleArgs.fontSize
  // 边框：borderColor + borderWidth 成对设置；borderColor 为 transparent 或空表示移除边框
  if (styleArgs.borderColor !== undefined) {
    const bc = String(styleArgs.borderColor || '').trim()
    if (!bc || bc === 'transparent' || bc === 'none') {
      nodeStyle.borderColor = 'transparent'
      nodeStyle.borderWidth = 0
    } else {
      nodeStyle.borderColor = normalizeBorderColor(bc)
      const bw = Number(styleArgs.borderWidth)
      nodeStyle.borderWidth = Number.isFinite(bw) && bw > 0 ? Math.min(bw, 8) : 2
    }
  }
  if (Object.keys(nodeStyle).length > 0) {
    let styleOk = 0
    for (const node of nodes) {
      try {
        // setStyles(对象) 才是批量版本；setStyle(属性名, 值) 传对象会写入垃圾键 '[object Object]'
        node.setStyles(nodeStyle)
        styleOk++
      } catch (e) {
        console.error('[applyNodeStyles] setStyles 失败:', e)
      }
    }
    mindMap.render()
    details.push(styleOk > 0
      ? `节点背景/形状/字号/边框已应用到 ${styleOk}/${nodes.length} 个节点`
      : '节点背景/形状/字号/边框未生效（setStyle 全部失败）')
  }

  // 文本级样式：颜色 / 高亮 / 加粗 / 斜体 / 下划线 / 删除线 / 字体 / 字号（写入富文本 HTML）
  if (styleArgs.textColor) {
    const c = applyTextStyleToNodes(mindMap, nodes, 'color:' + normalizeTextColor(styleArgs.textColor))
    details.push(c > 0
      ? `文字颜色已应用到 ${c}/${nodes.length} 个节点`
      : `文字颜色未生效（目标节点均为空文本或已是该色）`)
  }
  if (styleArgs.highlightColor) {
    const c = applyTextStyleToNodes(mindMap, nodes, 'highlight:' + normalizeHighlightColor(styleArgs.highlightColor))
    details.push(c > 0
      ? `高亮已应用到 ${c}/${nodes.length} 个节点`
      : `高亮未生效（目标节点均为空文本或已是该色）`)
  }
  const boolTextStyles = [
    { key: 'bold', on: 'bold-on', off: 'bold-off', label: '加粗' },
    { key: 'italic', on: 'italic-on', off: 'italic-off', label: '斜体' },
    { key: 'underline', on: 'underline-on', off: 'underline-off', label: '下划线' },
    { key: 'strikethrough', on: 'strikethrough-on', off: 'strikethrough-off', label: '删除线' }
  ]
  for (const s of boolTextStyles) {
    if (styleArgs[s.key] === undefined) continue
    const enable = !!styleArgs[s.key]
    const c = applyTextStyleToNodes(mindMap, nodes, enable ? s.on : s.off)
    const label = enable ? s.label : '取消' + s.label
    details.push(c > 0
      ? `${label}已应用到 ${c}/${nodes.length} 个节点`
      : `${label}未生效（目标节点均为空文本或已是目标状态）`)
  }
  if (styleArgs.fontFamily) {
    const c = applyTextStyleToNodes(mindMap, nodes, 'font:' + styleArgs.fontFamily)
    details.push(c > 0
      ? `字体 ${styleArgs.fontFamily} 已应用到 ${c}/${nodes.length} 个节点`
      : `字体未生效（目标节点均为空文本）`)
  }
  if (styleArgs.textFontSize) {
    const c = applyTextStyleToNodes(mindMap, nodes, 'fontsize:' + styleArgs.textFontSize)
    details.push(c > 0
      ? `文字字号 ${styleArgs.textFontSize}px 已应用到 ${c}/${nodes.length} 个节点`
      : `文字字号未生效（目标节点均为空文本）`)
  }
  return details
}

// 富文本样式参数对象 → applyRichTextAction 动作数组（batch_text_style / batch_node_actions.text_style 共用）
function styleArgsToActions(styleArgs = {}) {
  const src = {
    ...(styleArgs && typeof styleArgs.style === 'object' ? styleArgs.style : {}),
    ...(styleArgs || {})
  }
  const actions = []
  if (src.textColor) actions.push('color:' + normalizeTextColor(src.textColor))
  if (src.highlightColor) actions.push('highlight:' + normalizeHighlightColor(src.highlightColor))
  const boolMap = [
    ['bold', 'bold-on', 'bold-off'],
    ['italic', 'italic-on', 'italic-off'],
    ['underline', 'underline-on', 'underline-off'],
    ['strikethrough', 'strikethrough-on', 'strikethrough-off']
  ]
  for (const [key, on, off] of boolMap) {
    if (src[key] !== undefined) actions.push(src[key] ? on : off)
  }
  if (src.fontFamily) actions.push('font:' + src.fontFamily)
  if (src.textFontSize) actions.push('fontsize:' + src.textFontSize)
  return actions
}

// 相对路径转绝对路径（按主进程工作目录解析）；已是绝对路径或解析失败时原样返回
async function toAbsPath(p) {
  if (typeof p !== 'string' || !p.trim()) return p
  if (/^([a-zA-Z]:[\\/]|\\\\|\/\/)/.test(p)) return p
  try {
    const abs = window.electronAPI?.fs?.absPath ? await window.electronAPI.fs.absPath(p) : ''
    return abs || p
  } catch {
    return p
  }
}

function analyzeMindMapTree(treeData) {
  const issues = []
  const nodes = []
  let maxDepth = 0
  const walk = (node, depth, path) => {
    const text = nodePlainText(node?.data?.text || node?.text || '').trim()
    const uid = node?.data?.uid || node?.uid || ''
    const currentPath = path.concat(text || '(空节点)')
    const childCount = Array.isArray(node?.children) ? node.children.length : 0
    maxDepth = Math.max(maxDepth, depth)
    nodes.push({ uid, text, depth, childCount, path: currentPath.join(' > ') })
    if (!text) issues.push({ type: 'empty_node', severity: 'high', uid, path: currentPath.join(' > '), suggestion: '补充或删除空节点' })
    if (text.length > 60) issues.push({ type: 'long_node', severity: 'medium', uid, path: currentPath.join(' > '), suggestion: '拆分为父子结构' })
    if (childCount > 12) issues.push({ type: 'wide_node', severity: 'medium', uid, path: currentPath.join(' > '), suggestion: '增加分组层' })
    if (depth > 6) issues.push({ type: 'deep_branch', severity: 'low', uid, path: currentPath.join(' > '), suggestion: '合并过度细分层级' })
    if (childCount === 1 && depth > 1) issues.push({ type: 'chain_node', severity: 'low', uid, path: currentPath.join(' > '), suggestion: '压缩单子节点链' })
    if (childCount === 0 && text.length > 40) issues.push({ type: 'long_leaf', severity: 'medium', uid, path: currentPath.join(' > '), suggestion: '长叶子应结构化拆分' })
    if (/^(其他|其它|待补充|临时|杂项)$/.test(text)) issues.push({ type: 'vague_node', severity: 'medium', uid, path: currentPath.join(' > '), suggestion: '改为明确主题' })
    const seen = new Map()
    for (const child of node?.children || []) {
      const childText = nodePlainText(child?.data?.text || child?.text || '').trim().toLowerCase()
      if (childText && seen.has(childText)) {
        issues.push({ type: 'duplicate_sibling', severity: 'medium', uid: child?.data?.uid || child?.uid || '', path: currentPath.concat(nodePlainText(child?.data?.text || child?.text || '').trim()).join(' > '), suggestion: '合并重复兄弟节点' })
      } else if (childText) seen.set(childText, true)
      walk(child, depth + 1, currentPath)
    }
  }
  walk(treeData, 1, [])
  const weights = { high: 12, medium: 6, low: 2 }
  const score = Math.max(0, 100 - issues.reduce((total, issue) => total + weights[issue.severity], 0))
  return { nodes, issues, maxDepth, score }
}

function safeRefactorMindMapTree(treeData) {
  const changes = []
  const walk = (node, path) => {
    if (!node) return
    const currentPath = path.concat(nodePlainText(node?.data?.text || node?.text || '').trim() || '(空节点)')
    if (typeof node.data?.text === 'string') {
      const trimmed = node.data.text.trim()
      if (trimmed && trimmed !== node.data.text && !trimmed.startsWith('<')) {
        changes.push({ uid: node.data.uid || '', path: currentPath.join(' > '), action: 'trim_text', before: node.data.text, after: trimmed })
        node.data.text = trimmed
      }
    }
    if (Array.isArray(node.children) && node.children.length > 1) {
      const byText = new Map()
      const kept = []
      for (const child of node.children) {
        const key = nodePlainText(child?.data?.text || child?.text || '').trim().toLowerCase()
        if (!key) { kept.push(child); continue }
        if (byText.has(key)) {
          const primary = byText.get(key)
          primary.children = [...(primary.children || []), ...(child.children || [])]
          changes.push({ uid: child?.data?.uid || '', path: currentPath.concat(nodePlainText(child?.data?.text || child?.text || '').trim()).join(' > '), action: 'merge_duplicate_sibling', mergedInto: primary?.data?.uid || '' })
        } else {
          byText.set(key, child)
          kept.push(child)
        }
      }
      node.children = kept
    }
    for (const child of node.children || []) walk(child, currentPath)
  }
  walk(treeData, [])
  return changes
}

// ========== 工具处理函数 ==========
// 兼容不同模型输出：优先标准 JSON，失败后从 markdown/代码块/前后杂讯中提取 JSON 对象或数组。
function parseToolCallArgs(raw) {
  if (raw == null) return {}
  const text = String(raw).trim()
  try {
    return JSON.parse(text)
  } catch {
    // ignore
  }
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) {
    try {
      return JSON.parse(fence[1].trim())
    } catch {
      // ignore
    }
  }
  const objStart = text.indexOf('{')
  const objEnd = text.lastIndexOf('}')
  if (objStart !== -1 && objEnd > objStart) {
    try {
      return JSON.parse(text.slice(objStart, objEnd + 1))
    } catch {
      // ignore
    }
  }
  const arrStart = text.indexOf('[')
  const arrEnd = text.lastIndexOf(']')
  if (arrStart !== -1 && arrEnd > arrStart) {
    try {
      return JSON.parse(text.slice(arrStart, arrEnd + 1))
    } catch {
      // ignore
    }
  }
  return {}
}

// 从模型回复中稳健提取 JSON 对象：支持代码块围栏、前后说明、常见尾逗号/省略号修复。
function extractJsonObject(text) {
  const raw = String(text || '').trim()
  if (!raw) return null
  const tryParse = (s) => {
    try {
      const val = JSON.parse(s)
      return val && typeof val === 'object' ? val : null
    } catch {
      return null
    }
  }
  let cleaned = raw.replace(/```(?:json)?/gi, '').trim()
  let val = tryParse(cleaned)
  if (val) return val
  const objStart = cleaned.indexOf('{')
  const objEnd = cleaned.lastIndexOf('}')
  if (objStart !== -1 && objEnd > objStart) {
    const candidate = cleaned.slice(objStart, objEnd + 1)
    val = tryParse(candidate)
    if (val) return val
    const repaired = candidate
      .replace(/,\s*([}\]])/g, '$1')
      .replace(/,(\s*\.\.\.)/g, '$1')
      .replace(/\.\.\./g, '')
    val = tryParse(repaired)
    if (val) return val
  }
  return null
}

// ========== 全局工具参数归一化：让不同模型的不同写法都落到同一套参数上 ==========
const ARG_ALIASES = {
  关键词: 'keyword',
  查询: 'query',
  文本: 'text',
  正则: 'regex',
  查找: 'find',
  替换为: 'replacement',
  文件路径: 'filePath',
  任务ID: 'taskId',
  文字颜色: 'textColor',
  高亮颜色: 'highlightColor',
  节点背景色: 'fillColor',
  file_path: 'filePath',
  task_id: 'taskId',
  target_parent_uid: 'targetParentUid',
  parent_uid: 'parentUid',
  new_name: 'newName',
  open_folder: 'openFolder',
  save_dir: 'saveDir',
  chat_id: 'chatId',
  to_user_id: 'toUserId',
  receive_id: 'receiveId',
  receive_id_type: 'receiveIdType',
  msg_type: 'msgType',
  folder_token: 'folderToken',
  file_token: 'fileToken',
  page_start: 'pageStart',
  page_end: 'pageEnd',
  max_chars: 'maxChars',
  ocr_all: 'ocrAll',
  source_file_path: 'sourceFilePath',
  target_file_path: 'targetFilePath'
}

const TARGET_ALIASES = {
  节点uid: 'uids',
  节点UID: 'uids',
  节点ID: 'uids',
  目标节点: 'uids',
  uid: 'uids',
  node_uid: 'uids',
  target_uid: 'uids',
  target_uids: 'uids',
  node_uids: 'uids',
  uids: 'uids',
  min_depth: 'minDepth',
  max_depth: 'maxDepth'
}

const ARRAY_KEYS = new Set([
  'uids', 'ids', 'nodes', 'files', 'steps', 'updates', 'keywords',
  'names', 'tasks', 'children', 'questions', 'choices', 'targets'
])

const BOOLEAN_KEYS = new Set([
  'enabled', 'overwrite', 'apply', 'dry_run', 'open_folder', 'openFolder',
  'includeChildren', 'include_children', 'regex', 'deepResearch',
  'externalFile', 'notNewFile', 'ocr_all', 'ocrAll'
])

const NUMBER_KEYS = new Set([
  'fontSize', 'textFontSize', 'offset', 'max_chars', 'maxChars',
  'page_start', 'pageStart', 'page_end', 'pageEnd', 'limit', 'count',
  'levels', 'depth', 'scale', 'width', 'height'
])

const coerceArray = (key, value) => {
  if (Array.isArray(value)) return value
  if (value == null) return value
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return []
    try {
      const parsed = JSON.parse(trimmed)
      if (Array.isArray(parsed)) return parsed
    } catch {}
    if (key === 'keywords') {
      return trimmed.split(/[,，、\s]+/).filter(Boolean)
    }
    if (key === 'uids' || key === 'ids') {
      return trimmed.split(/[,，、\s]+/).filter(Boolean)
    }
    return [trimmed]
  }
  return [value]
}

const coerceBoolean = (value) => {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase()
    if (['true', 'yes', 'on', '1', 'y'].includes(v)) return true
    if (['false', 'no', 'off', '0', 'n'].includes(v)) return false
  }
  return value
}

const coerceNumber = (value) => {
  if (typeof value === 'number') return value
  if (typeof value === 'string' && value.trim() !== '' && !isNaN(Number(value))) {
    return Number(value)
  }
  return value
}

const normalizeTargetsObject = (targets) => {
  if (!targets || typeof targets !== 'object' || Array.isArray(targets)) return targets
  const out = {}
  for (const [k, v] of Object.entries(targets)) {
    const key = TARGET_ALIASES[k] || k
    if (key === 'uids') out[key] = coerceArray(key, v)
    else if (key === 'minDepth' || key === 'maxDepth') out[key] = coerceNumber(v)
    else out[key] = v
  }
  return out
}

const normalizeScalarArg = (key, value) => {
  if (typeof value === 'string') value = value.trim()
  if (BOOLEAN_KEYS.has(key)) value = coerceBoolean(value)
  if (NUMBER_KEYS.has(key)) value = coerceNumber(value)
  if (ARRAY_KEYS.has(key)) value = coerceArray(key, value)
  if (key === 'textColor') value = normalizeTextColor(value)
  if (key === 'highlightColor') value = normalizeHighlightColor(value)
  if (key === 'fillColor') value = normalizeNodeFillColor(value)
  return value
}

function normalizeToolArgs(name, args = {}) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return {}
  const out = {}
  for (const [rawKey, value] of Object.entries(args)) {
    const key = ARG_ALIASES[rawKey] || rawKey
    if (key === 'targets') {
      out[key] = normalizeTargetsObject(value)
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      out[key] = normalizeToolArgs('', value)
    } else if (Array.isArray(value)) {
      out[key] = value.map(item => {
        if (item && typeof item === 'object' && !Array.isArray(item)) {
          return normalizeToolArgs('', item)
        }
        return normalizeScalarArg('', item)
      })
    } else {
      out[key] = normalizeScalarArg(key, value)
    }
  }
  // 很多模型会把节点范围写在顶层（uids/keyword/mode），但工具统一从 targets 读取。
  // 对节点目标类工具自动合并，避免“只处理到当前选中节点/第一个节点”的偏差。
  if ([
    'delete_node', 'insert_parent_node', 'batch_move_nodes', 'outer_frame',
    'set_node_style', 'batch_text_style', 'ai_cloze', 'ai_quiz',
    'ai_quiz_append', 'add_to_review', 'clear_cloze',
    'toggle_cloze_visibility', 'format_painter', 'find_replace_text'
  ].includes(name)) {
    if (!out.targets || typeof out.targets !== 'object' || Array.isArray(out.targets)) {
      out.targets = {}
    }
    if (out.uids !== undefined && out.targets.uids === undefined) out.targets.uids = coerceArray('uids', out.uids)
    if (out.keyword !== undefined && out.targets.keyword === undefined) out.targets.keyword = out.keyword
    if (out.mode !== undefined && out.targets.mode === undefined) out.targets.mode = out.mode
  }
  return out
}

export async function handleToolCall(toolCall, mindMap, activeNode, extraHandlers = {}) {
  const name = toolCall.function.name
  let args = normalizeToolArgs(name, parseToolCallArgs(toolCall.function.arguments))

  // 调用方传入的实例可能是一次性快照（启动时容器隐藏导致快照为 null 且永不更新）。
  // 兜底从全局注册表（MindMapEditor 创建实例后写入）惰性获取，保证导图类工具始终可用
  if (!mindMap) {
    try {
      const store = useMindMapStore()
      if (store.mindMapInstance) mindMap = store.mindMapInstance
    } catch (e) { /* pinia 未就绪时保持 null，由各工具自行报错 */ }
  }

  // [修订·多实例] 任务绑定 fileId 后，优先从多实例表取"绑定的独立实例"操作，
  // 用户切走文件时任务仍在绑定实例上继续改，不串台、不停手。
  // fileId 归一化（统一分隔符为 /、去末尾分隔符），与 openInTab 注册进 instances 表的 key 保持一致；
  // 否则原始路径(C:\...)与归一化 key(C:/...)对不上，getInstance 返回 null，工具回退用当前激活实例→切换即串台。
  try {
    const taskStore = useMindMapStore()
    const rawFid = taskStore.activeTaskFileId
    const normFid = String(rawFid || '').replace(/[\\\/]+/g, '/').replace(/\/+$/g, '')
    if (normFid && typeof taskStore.getInstance === 'function') {
      const bound = taskStore.getInstance(normFid)
      if (bound) mindMap = bound
    }
  } catch (e) { /* store 未就绪时不阻断 */ }

  switch (name) {
    case 'audit_mindmap': {
      try {
        if (!mindMap) return { success: false, message: '当前没有打开的思维导图。请先调用 find_local_file(exts=["smm"]) 搜索本地导图文件（自动覆盖桌面/文档/下载/默认保存目录），再用 read_mindmap_file(filePath=...) 直接读取文件内容后继续。' }
        const analysis = analyzeMindMapTree(mindMap.getData())
        const summary = {
          nodeCount: analysis.nodes.length,
          maxDepth: analysis.maxDepth,
          issueCount: analysis.issues.length,
          highCount: analysis.issues.filter(issue => issue.severity === 'high').length,
          mediumCount: analysis.issues.filter(issue => issue.severity === 'medium').length,
          lowCount: analysis.issues.filter(issue => issue.severity === 'low').length,
          qualityScore: analysis.score
        }
        const issueText = analysis.issues.slice(0, 50).map((issue, index) =>
          `${index + 1}. [${issue.severity}] ${issue.type}：${issue.path}${issue.uid ? `（uid:${issue.uid}）` : ''} -> ${issue.suggestion}`
        ).join('\n')
        return {
          success: true,
          message: `导图质量评分：${analysis.score}/100。共 ${analysis.nodes.length} 个节点、最大 ${analysis.maxDepth} 层、${analysis.issues.length} 个问题。\n\n${issueText || '未发现明显结构问题。'}\n\n建议：先运行 refactor_mindmap(dry_run=true)。`,
          summary,
          issues: analysis.issues,
          nodes: args.include_nodes === true ? analysis.nodes : undefined
        }
      } catch (e) {
        return { success: false, message: `导图诊断失败: ${e.message}` }
      }
    }

    case 'refactor_mindmap': {
      try {
        if (!mindMap) return { success: false, message: '当前没有打开的思维导图。请先调用 find_local_file(exts=["smm"]) 搜索本地导图文件（自动覆盖桌面/文档/下载/默认保存目录），再用 read_mindmap_file(filePath=...) 直接读取文件内容后继续。' }
        const treeData = mindMap.getData()
        const analysis = analyzeMindMapTree(treeData)
        const apply = args.apply === true
        const changes = safeRefactorMindMapTree(treeData)
        if (apply) {
          ensureRichText(treeData)
          mindMap.setData(treeData)
          mindMap.render()
        }
        return {
          success: true,
          dryRun: !apply,
          applied: apply,
          qualityScore: analysis.score,
          plannedChanges: changes,
          unresolvedIssues: analysis.issues.filter(issue => issue.type !== 'duplicate_sibling'),
          message: apply ? `已应用 ${changes.length} 项安全重构。` : `Dry-run 完成：可安全修复 ${changes.length} 项，未修改导图；设置 apply=true 可执行。`
        }
      } catch (e) {
        return { success: false, message: `导图重构失败: ${e.message}` }
      }
    }

    case 'reorganize_mindmap': {
      try {
        if (!mindMap) return { success: false, message: '当前没有打开的思维导图。请先调用 find_local_file(exts=["smm"]) 搜索本地导图文件（自动覆盖桌面/文档/下载/默认保存目录），再用 read_mindmap_file(filePath=...) 直接读取文件内容后继续。' }
        const treeData = mindMap.getData()
        const contentText = treeToText(treeData)
        if (!contentText.trim()) return { success: false, message: '当前导图没有任何内容可整理' }
        const topicName = nodePlainText(treeData?.data?.text || '') || '思维导图'

        const sys = '你是思维导图结构整理专家。根据用户提供的原始导图内容，重新梳理出一个更合理的框架结构。必须严格遵守原文内容，禁止随意增删改、禁止编造、禁止过度总结替换原文，只调整层级归属、分类归纳、排序、分组、合并同类项，使结构更清晰、层级更合理。只输出 JSON，不要任何解释文字。'
        const usr = '请把下面这份思维导图内容重新整理成一个框架更合理的层级结构。\n\n严格要求：\n1. 严格保留原文每个节点的文字内容，禁止增删改、禁止编造、禁止过度总结替换原文\n2. 可以调整：节点的层级归属、分类归纳、排序、分组、合并同类项、把过宽的结构拆分或把过深的层级归纳\n3. 根主题保持原文不变\n4. 只输出 JSON，不要输出任何解释、前言或代码块\n\n输出 JSON 格式：\n{"root":"根主题文字","children":[{"text":"一级节点","children":[{"text":"二级节点","children":[]}]}]}\n\n原始导图内容：\n' + contentText.slice(0, 16000)

        let choice = await aiService.chat(usr, sys, null, { responseFormat: 'json' })
        let parsed = extractJsonObject(choice?.message?.content || '')
        if (!parsed) {
          const retryUsr = '请重新输出，且必须只输出一个 JSON 对象。不要输出代码块、解释或省略号。如果原文内容过多，可以合并同类项，但不能编造原文。\n\n原始导图内容：\n' + contentText.slice(0, 12000)
          choice = await aiService.chat(retryUsr, sys, null, { responseFormat: 'json' })
          parsed = extractJsonObject(choice?.message?.content || '')
        }
        if (!parsed) return { success: false, message: 'AI 整理返回的 JSON 格式异常，请重试' }
        if (!Array.isArray(parsed.children)) return { success: false, message: 'AI 整理结果缺少 children 数组，请重试' }

        const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        const buildNode = (n) => {
          const text = n && (n.text || n.name || '')
          if (!text) return null
          const node = { data: { text: '<p><span>' + esc(text) + '</span></p>' }, children: [] }
          const kids = Array.isArray(n.children) ? n.children : []
          for (const k of kids) {
            const child = buildNode(k)
            if (child) node.children.push(child)
          }
          return node
        }
        const rootText = parsed.root || parsed.name || topicName
        const newTree = { data: { text: '<p><span>' + esc(rootText) + '</span></p>' }, children: [] }
        const kids = Array.isArray(parsed.children) ? parsed.children : []
        for (const k of kids) {
          const child = buildNode(k)
          if (child) newTree.children.push(child)
        }
        ensureRichText(newTree)

        const safeTopic = String(rootText).replace(/[<>:"/\\|?*【】]/g, '').slice(0, 40).trim() || '思维导图'
        const fileName = safeTopic + '【整理框架】.smm'
        let targetPath = fileName
        try {
          const store = useMindMapStore()
          if (store.currentFilePath) targetPath = store.currentFilePath.replace(/[\\/][^\\/]+$/, '') + '/' + fileName
        } catch (e) {}
        const saveData = JSON.stringify(newTree, null, 2)
        if (!window.electronAPI?.saveFile) return { success: false, message: '文件保存功能不可用' }
        const result = await window.electronAPI.saveFile(targetPath, saveData)
        if (!result || !result.success) return { success: false, message: '保存失败：' + (result?.error || '未知错误') }

        const newNodeCount = countNodes(newTree)
        return {
          success: true,
          message: '已重新整理导图框架并保存为新文件「' + fileName + '」（' + result.filePath + '）。整理后共 ' + newNodeCount + ' 个节点。原导图未改动，可在左侧文件目录中打开查看。',
          filePath: result.filePath,
          fileName,
          externalFile: true
        }
      } catch (e) {
        return { success: false, message: '整理框架失败: ' + e.message }
      }
    }

    case 'research_to_mindmap': {
      try {
        const topic = String(args.topic || '').trim()
        if (!topic) return { success: false, message: '请提供研究主题 topic' }
        const maxSources = Math.max(2, Math.min(Number(args.max_sources) || 5, 8))
        const results = await searchWeb(topic, { deepResearch: true, limit: maxSources })
        if (!results.length) return { success: false, message: `未找到关于“${topic}”的可靠来源` }
        const sources = []
        for (const result of results.slice(0, maxSources)) {
          let excerpt = result.verifiedExcerpt || result.snippet || ''
          if (!result.verifiedExcerpt && sources.length < 3) {
            try {
              const page = await readWebpage(result.link)
              excerpt = String(page.content || '').replace(/\s+/g, ' ').slice(0, 800)
            } catch (error) { excerpt = result.snippet || '' }
          }
          sources.push({ ref: result.ref, title: result.title, link: result.link, engine: result.engine, publishedDate: result.publishedDate || '', excerpt })
        }
        const markdown = `# ${topic}\n## 核心发现\n${sources.map(source => `### [${source.ref}] ${source.title}\n- ${source.excerpt.slice(0, 220)}`).join('\n')}\n\n## 证据与来源\n${sources.map(source => `### [${source.ref}] ${source.title}\n- 日期：${source.publishedDate || '未知'}\n- 来源：${source.link}`).join('\n')}\n\n## 待验证问题\n- 需要人工确认数据口径\n- 需要交叉验证冲突信息\n`
        const treeData = parseMarkdownToTree(markdown)
        ensureRichText(treeData)
        const { filePath, fileName } = await saveGeneratedMindmap(treeData, `${topic.replace(/[<>:"/\\|?*]/g, '_').slice(0, 50)} - research`)
        const uidMap = buildUidMap(treeData)
        return {
          success: true,
          message: `已生成“${topic}”研究导图，包含 ${sources.length} 个带引用来源的节点。${filePath ? `\n文件：${filePath}` : ''}`,
          filePath,
          fileName,
          sources,
          nodes: uidMap.nodes
        }
      } catch (e) {
        return { success: false, message: `研究导图生成失败: ${e.message}` }
      }
    }

        case 'generate_mindmap': {
      try {
        if (!args.markdown || !args.markdown.trim()) return { success: false, message: 'Markdown 内容为空' }
        const treeData = parseMarkdownToTree(args.markdown)
        ensureRichText(treeData)
        const { filePath, fileName } = await saveGeneratedMindmap(treeData, '思维导图')
        const uidMap = buildUidMap(treeData)
        const uidSection = uidMap.text
          ? `\n\n节点UID清单（可直接用于 batch_node_actions / select_node 的 uids 参数）：\n${uidMap.text}${uidMap.truncated ? `\n（共 ${uidMap.total} 个节点，以上仅列出前 ${uidMap.nodes.length} 个，其余用 search_nodes 定位）` : ''}`
          : ''
        return {
          success: true,
          message: (filePath ? `思维导图已生成并保存：${fileName}` : '思维导图已生成') + uidSection,
          filePath,
          fileName,
          nodes: uidMap.nodes,
          switchFile: !!filePath
        }
      } catch (e) {
        console.error('generate_mindmap error:', e)
        return { success: false, message: `生成思维导图失败: ${e.message}` }
      }
    }

    case 'get_mindmap_content': {
      try {
        if (!mindMap) return { success: false, message: '当前没有打开的思维导图。请先调用 find_local_file(exts=["smm"]) 搜索本地导图文件（自动覆盖桌面/文档/下载/默认保存目录），再用 read_mindmap_file(filePath=...) 直接读取文件内容后继续。' }
        const treeData = mindMap.getData()
        const nodeCount = countNodes(treeData)
        const mode = args.mode || 'auto'
        // 分级加载：大图默认只给骨架（统计+前两层），防止几千节点撑爆上下文
        const useSkeleton = mode === 'skeleton' || (mode === 'auto' && nodeCount > 150)
        if (useSkeleton) {
          const skeleton = treeToSkeletonText(treeData, 2)
          const maxDepth = getMaxDepth(treeData)
          return {
            success: true,
            message: `当前导图共 ${nodeCount} 个节点、最大 ${maxDepth} 层，已返回前 2 层骨架（深层节点已折叠）：\n\n${skeleton}\n（需要细节时：用 search_nodes 按关键词定位节点；或传 mode=full 获取全文，但大图会占用大量上下文）`
          }
        }
        const content = treeToText(treeData)
        return { success: true, message: content || '（空思维导图）' }
      } catch (e) {
        return { success: false, message: `获取内容失败: ${e.message}` }
      }
    }

    case 'get_mindmap_info': {
      try {
        if (!mindMap) return { success: false, message: '当前没有打开的思维导图。请先调用 find_local_file(exts=["smm"]) 搜索本地导图文件（自动覆盖桌面/文档/下载/默认保存目录），再用 read_mindmap_file(filePath=...) 直接读取文件内容后继续。' }
        const treeData = mindMap.getData()
        const nodeCount = countNodes(treeData)
        const maxDepth = getMaxDepth(treeData)
        return {
          success: true,
          message: `当前思维导图信息：\n- 节点总数：${nodeCount}\n- 最大深度：${maxDepth} 层`,
          nodeCount,
          maxDepth
        }
      } catch (e) {
        return { success: false, message: `获取导图信息失败: ${e.message}` }
      }
    }

    case 'save_mindmap': {
      try {
        if (!mindMap) return { success: false, message: '当前没有打开的思维导图。请先调用 find_local_file(exts=["smm"]) 搜索本地导图文件（自动覆盖桌面/文档/下载/默认保存目录），再用 read_mindmap_file(filePath=...) 直接读取文件内容后继续。' }
        const treeData = mindMap.getData()
        const saveData = JSON.stringify(treeData, null, 2)
        // 当前打开的是 .smm 文件时，优先原地覆盖保存，避免「每次修改都另存一个导图」
        const curPath = typeof extraHandlers.currentFilePath === 'function'
          ? extraHandlers.currentFilePath()
          : (extraHandlers.currentFilePath || '')
        // 用户明确要另存为新文件时，不再原地覆盖当前文件。
        const wantsNewFile = !!(args.fileName || args.save_dir || args.new_file)
        if (!wantsNewFile && curPath && /\.smm$/i.test(curPath) && window.electronAPI?.saveFile) {
          const result = await window.electronAPI.saveFile(curPath, saveData, { overwrite: true })
          if (result && result.success) {
            const base = String(curPath).split(/[\\/]/).pop()
            // notNewFile：原地覆盖当前文件，不是新文件，ChatPanel 不应把它当作「本轮新建文件」展示/记录
            return { success: true, message: `已保存到当前文件：${base}`, filePath: result.filePath, fileName: base, notNewFile: true }
          }
        }
        const rawRootText = treeData?.data?.text || ''
        const rootText = args.fileName || rawRootText.replace(/<[^>]+>/g, '').trim() || '思维导图'
        const safeName = rootText.replace(/[<>:"/\\|?*]/g, '_').slice(0, 50)
        const fileName = `${safeName}.smm`
        if (window.electronAPI?.saveFile) {
          const targets = []
          if (args.save_dir) {
            const dir = String(args.save_dir).replace(/[\\/]+$/, '')
            targets.push(dir + (/\\/.test(dir) ? '\\' : '/') + fileName)
          }
          targets.push(fileName) // 默认保存目录
          const errors = []
          for (const t of targets) {
            try {
              // overwrite 覆盖同名文件，避免产生「文件名 (1).smm」的连环副本
              const result = await window.electronAPI.saveFile(t, saveData, { overwrite: true })
              if (result && result.success) {
                return { success: true, message: `已保存：${result.filePath}`, filePath: result.filePath, fileName }
              }
              if (result && result.error) errors.push(result.error)
            } catch (e) {
              errors.push(e.message)
            }
          }
          return { success: false, message: `保存失败：${errors.join('；') || '无法访问文件系统'}` }
        }
        return { success: false, message: '保存失败：无法访问文件系统（未运行在 Electron 环境）' }
      } catch (e) {
        return { success: false, message: `保存失败: ${e.message}` }
      }
    }

    case 'new_mindmap': {
      try {
        if (!mindMap) return { success: false, message: '当前没有打开的思维导图。请先调用 find_local_file(exts=["smm"]) 搜索本地导图文件（自动覆盖桌面/文档/下载/默认保存目录），再用 read_mindmap_file(filePath=...) 直接读取文件内容后继续。' }
        const rootText = args.rootText || '中心主题'
        const treeData = {
          data: { text: `<p><span>${escHtml(rootText)}</span></p>`, uid: createUid(), richText: true },
          children: []
        }
        mindMap.setData(treeData)
        return { success: true, message: `已创建新思维导图，根节点：${rootText}` }
      } catch (e) {
        return { success: false, message: `创建失败: ${e.message}` }
      }
    }

    case 'expand_node': {
      try {
        // 目标节点：优先 targets（uids/keyword/mode）直接解析，避免 select_node -> expand_node 的低效循环
        let parents
        if (args.targets && (args.targets.uids || args.targets.keyword || args.targets.mode)) {
          const { nodes, error } = resolveTargetNodes(mindMap, args.targets)
          if (error) return { success: false, message: `目标节点解析失败：${error}` }
          parents = nodes.filter(n => !n.isGeneralization)
        } else {
          parents = (mindMap.renderer.activeNodeList || []).filter(n => !n.isGeneralization)
        }
        if (!parents.length) {
          return { success: false, message: '没有目标节点。请通过 targets（uids/keyword/mode）一次指定全部目标，或先选中节点' }
        }
        const texts = (Array.isArray(args.nodes) ? args.nodes : [])
          .map(t => String(t ?? '').trim()).filter(Boolean)
        if (!texts.length) return { success: false, message: '请提供要添加的节点文本（nodes）' }

        if (args.direction === 'child') {
          // 子节点：每个父节点一次命令插入全部文本（INSERT_MULTI_CHILD_NODE）
          for (const parent of parents) {
            try {
              const childList = texts.map(text => ({
                data: { text: `<p><span>${escHtml(text)}</span></p>`, uid: createUid(), richText: true },
                children: []
              }))
              setActiveNodes(mindMap, [parent])
              mindMap.execCommand('INSERT_MULTI_CHILD_NODE', [parent], childList)
            } catch (err) {
              console.error('expand_node 插入子节点失败:', err)
            }
          }
        } else {
          // 兄弟节点：保持目标为选中态，逐条插入
          for (const text of texts) {
            setActiveNodes(mindMap, parents)
            mindMap.execCommand('INSERT_NODE', false, [], {
              text: `<p><span>${escHtml(text)}</span></p>`,
              uid: createUid(),
              richText: true
            })
          }
        }
        // 恢复全部目标节点为选中态（重新取实例，避免渲染后旧实例失效）
        const reselect = parents
          .map(p => (typeof mindMap.renderer.findNodeByUid === 'function'
            ? mindMap.renderer.findNodeByUid(p.getData?.('uid') || p.uid)
            : null))
          .filter(Boolean)
        if (reselect.length) setActiveNodes(mindMap, reselect)
        const label = args.direction === 'child' ? '子' : '兄弟'
        return { success: true, message: `已为 ${parents.length} 个节点各添加 ${texts.length} 个${label}节点，目标节点保持选中（无需再 select_node）` }
      } catch (e) {
        return { success: false, message: `扩展节点失败: ${e.message}` }
      }
    }

    case 'add_child_nodes': {
      try {
        if (!mindMap) return { success: false, message: '当前没有打开的思维导图。请先调用 find_local_file(exts=["smm"]) 搜索本地导图文件（自动覆盖桌面/文档/下载/默认保存目录），再用 read_mindmap_file(filePath=...) 直接读取文件内容后继续。' }
        // 父节点：优先 targets（uids/keyword/mode），否则当前选中节点；多父节点在一次调用内全部处理
        let parents
        if (args.targets && (args.targets.uids || args.targets.keyword || args.targets.mode)) {
          const { nodes, error } = resolveTargetNodes(mindMap, args.targets)
          if (error) return { success: false, message: `父节点解析失败：${error}` }
          parents = nodes.filter(n => !n.isGeneralization)
        } else {
          parents = (mindMap.renderer.activeNodeList || []).filter(n => !n.isGeneralization)
        }
        if (!parents.length) {
          return { success: false, message: '没有目标父节点。请通过 targets（uids/keyword/mode）指定，或先选中节点' }
        }
        let rawChildren = args.children
        if (typeof rawChildren === 'string') {
          const parsedChildren = parseToolCallArgs(rawChildren)
          if (Array.isArray(parsedChildren)) rawChildren = parsedChildren
          else if (parsedChildren && Array.isArray(parsedChildren.children)) rawChildren = parsedChildren.children
          else rawChildren = []
        }
        rawChildren = Array.isArray(rawChildren) ? rawChildren : []
        if (rawChildren.length === 0) return { success: false, message: '请提供 children（要添加的子节点树）' }

        // 每个父节点单独构建一棵子树：uid 必须各自独立，不能跨父节点复用同一份 childList。
        // 同时丢弃空文本节点；若模型把父节点文本重复放在子树第一层，自动剥离该重复根，避免“空壳+重复”。
        const buildChildList = (items) => {
          const out = []
          for (const item of items) {
            const text = String(item?.text ?? '').trim()
            const kids = Array.isArray(item?.children) ? item.children : []
            if (!text && kids.length > 0) {
              out.push(...buildChildList(kids))
              continue
            }
            if (!text) continue
            out.push({
              data: {
                text: `<p><span>${escHtml(text)}</span></p>`,
                uid: createUid(),
                richText: true
              },
              children: buildChildList(kids)
            })
          }
          return out
        }
        const stripDuplicateRoot = (items, parentText) => {
          if (!Array.isArray(items) || items.length !== 1 || !parentText) return items
          const first = items[0]
          const firstText = String(first?.text ?? '').trim()
          const normalized = (s) => s.replace(/\s+/g, '').toLowerCase()
          if (normalized(firstText) === normalized(parentText) && Array.isArray(first?.children) && first.children.length > 0) {
            return first.children
          }
          return items
        }
        const countTree = (items) => items.reduce((s, it) => s + 1 + countTree(Array.isArray(it?.children) ? it.children : []), 0)

        const firstChildUids = []
        let okParents = 0
        for (const parent of parents) {
          try {
            const parentText = nodePlainText(parent.getData?.('text') || '')
            const childrenForParent = buildChildList(stripDuplicateRoot(rawChildren, parentText))
            const childList = childrenForParent
            if (childList.length === 0) continue
            setActiveNodes(mindMap, [parent])
            mindMap.execCommand('INSERT_MULTI_CHILD_NODE', [parent], childList)
            okParents++
            if (childList[0]) firstChildUids.push(childList[0].data.uid)
          } catch (err) {
            console.error('add_child_nodes 插入失败:', err)
          }
        }
        if (okParents === 0) {
          return { success: false, message: `子节点插入失败（${parents.length} 个父节点均未成功），可尝试减少层级或节点数量后重试` }
        }

        const after = args.afterInsert || 'select'
        if (after !== 'none' && firstChildUids.length > 0) {
          setTimeout(() => {
            try {
              const fresh = firstChildUids
                .map(uid => (typeof mindMap.renderer.findNodeByUid === 'function' ? mindMap.renderer.findNodeByUid(uid) : null))
                .filter(Boolean)
              if (fresh.length > 0) {
                setActiveNodes(mindMap, fresh)
                if (after === 'focus' && typeof mindMap.renderer.moveNodeToCenter === 'function') {
                  mindMap.renderer.moveNodeToCenter(fresh[0])
                }
              }
              if (typeof mindMap.render === 'function') mindMap.render()
            } catch (e) { /* 忽略选中失败，插入本身已成功 */ }
          }, 100)
        }

        const total = okParents * countTree(rawChildren)
        const parentLabel = parents.length > 1
          ? `${okParents}/${parents.length} 个父节点`
          : `节点「${nodePlainText(parents[0].getData?.('text')).slice(0, 20)}」`
        return {
          success: true,
          message: `已为 ${parentLabel} 添加子树（共 ${total} 个新节点），可通过 Ctrl+Z 撤销`
        }
      } catch (e) {
        return { success: false, message: `新增子节点失败: ${e.message}` }
      }
    }

    case 'update_node_text': {
      try {
        // 模式1：updates=[{uid,text}] 一次调用逐节点设置不同文本（批量改名首选，禁止逐节点循环调用本工具）
        if (Array.isArray(args.updates) && args.updates.length > 0) {
          let updated = 0
          const missing = []
          args.updates.forEach(u => {
            if (!u || !u.uid || u.text == null) return
            const node = typeof mindMap.renderer.findNodeByUid === 'function'
              ? mindMap.renderer.findNodeByUid(String(u.uid))
              : null
            if (node && !node.isGeneralization) {
              // review #5：改写前快照原文本到 node.note，最多保留 5 条历史
              try { snapshotBeforeTextChange(node, 'ai_rewrite') } catch (e) {}
              node.setText(`<p><span>${escHtml(String(u.text))}</span></p>`)
              updated++
            } else {
              missing.push(String(u.uid).slice(0, 8))
            }
          })
          let msg = updated > 0 ? `已按 updates 一次更新 ${updated} 个节点的文本` : 'updates 中没有命中的节点'
          if (missing.length) msg += `；未找到 uid：${missing.join('、')}`
          return { success: updated > 0, message: msg }
        }
        // 模式2/3：同一文本 -> targets 或当前全部选中节点
        if (args.text == null || String(args.text) === '') {
          return { success: false, message: '请提供 text（所有目标设为同一文本）或 updates=[{uid,text}]（逐节点不同文本）' }
        }
        let targets
        if (args.targets && (args.targets.uids || args.targets.keyword || args.targets.mode)) {
          const { nodes, error } = resolveTargetNodes(mindMap, args.targets)
          if (error) return { success: false, message: `目标节点解析失败：${error}` }
          targets = nodes.filter(n => !n.isGeneralization)
        } else {
          targets = (mindMap.renderer.activeNodeList || []).filter(n => !n.isGeneralization)
        }
        if (!targets.length) {
          return { success: false, message: '没有目标节点。请提供 updates=[{uid,text}]、targets（uids/keyword/mode），或先选中节点' }
        }
        targets.forEach(n => {
          // review #5：改写前快照原文本到 node.note
          try { snapshotBeforeTextChange(n, 'ai_rewrite') } catch (e) {}
          n.setText(`<p><span>${escHtml(String(args.text))}</span></p>`)
        })
        return { success: true, message: targets.length > 1 ? `已更新 ${targets.length} 个节点的文本` : '节点文本已更新' }
      } catch (e) {
        return { success: false, message: `更新节点文本失败: ${e.message}` }
      }
    }

    case 'delete_node': {
      try {
        // targets 直达批量删除（避免先 select_node 再删的低效循环）；省略则删除当前选中
        let targetNodes
        if (args.targets && (args.targets.uids || args.targets.keyword || args.targets.mode)) {
          const { nodes, error } = resolveTargetNodes(mindMap, args.targets)
          if (error) return { success: false, message: `目标节点解析失败：${error}` }
          targetNodes = nodes.filter(n => !n.isGeneralization && !n.isRoot)
        } else {
          targetNodes = (mindMap.renderer.activeNodeList || []).filter(n => !n.isGeneralization && !n.isRoot)
        }
        if (!targetNodes.length) return { success: false, message: '没有要删除的节点（根节点不可删除）' }

        // 删除会使节点实例失效，逐轮按 uid 重新定位后再删
        let deleted = 0
        for (const n of targetNodes) {
          try {
            const uid = n.getData?.('uid') || n.uid
            const cur = typeof mindMap.renderer.findNodeByUid === 'function'
              ? mindMap.renderer.findNodeByUid(uid) : null
            if (!cur) continue
            setActiveNodes(mindMap, [cur])
            mindMap.execCommand('REMOVE_NODE')
            deleted++
          } catch (err) { console.error('删除节点失败:', err) }
        }
        return { success: true, message: `已删除 ${deleted} 个节点${targetNodes.length > 1 ? '（可通过 Ctrl+Z 撤销）' : ''}` }
      } catch (e) {
        return { success: false, message: `删除节点失败: ${e.message}` }
      }
    }

    case 'select_node': {
      try {
        const mode = args.mode || ''
        const { nodes: found, error } = resolveTargetNodes(mindMap, args)
        if (error) return { success: false, message: error }

        setActiveNodes(mindMap, found)
        // 视口移动到第一个匹配节点，方便用户看到选中结果
        if (typeof mindMap.renderer.moveNodeToCenter === 'function') {
          mindMap.renderer.moveNodeToCenter(found[0])
        }

        const preview = found.slice(0, 15)
          .map((n, i) => `${i + 1}. ${nodePlainText(n.getData?.('text')).slice(0, 30)}`)
          .join('\n')
        const modeLabel = mode === 'leaf_parents' ? '终末节点的父节点' : mode === 'leaves' ? '终末节点' : '节点'
        return {
          success: true,
          message: `已选中全部${modeLabel}，共 ${found.length} 个：\n${preview}${found.length > 15 ? '\n...' : ''}\n后续工具将同时作用于这些节点。`
        }
      } catch (e) {
        return { success: false, message: `选中节点失败: ${e.message}` }
      }
    }

    case 'insert_parent_node': {
      try {
        // targets 直达批量插入父节点（避免先 select_node 循环）
        let targetNodes
        if (args.targets && (args.targets.uids || args.targets.keyword || args.targets.mode)) {
          const { nodes, error } = resolveTargetNodes(mindMap, args.targets)
          if (error) return { success: false, message: `目标节点解析失败：${error}` }
          targetNodes = nodes.filter(n => !n.isGeneralization && !n.isRoot)
        } else {
          targetNodes = (mindMap.renderer.activeNodeList || []).filter(n => !n.isGeneralization && !n.isRoot)
        }
        if (!targetNodes.length) return { success: false, message: '没有目标节点（根节点不能插入父节点）' }

        // 逐个插入：INSERT_PARENT_NODE 作用于当前激活节点；每轮按 uid 重新定位实时实例，避免旧引用失效
        let inserted = 0
        for (const n of targetNodes) {
          try {
            const uid = n.getData?.('uid') || n.uid
            const cur = typeof mindMap.renderer.findNodeByUid === 'function'
              ? mindMap.renderer.findNodeByUid(uid) : null
            if (!cur) continue
            setActiveNodes(mindMap, [cur])
            mindMap.execCommand('INSERT_PARENT_NODE', false, [], {
              text: `<p><span>${escHtml(args.text)}</span></p>`,
              uid: createUid(),
              richText: true
            })
            inserted++
          } catch (err) { console.error('插入父节点失败:', err) }
        }
        return { success: true, message: `已为 ${inserted} 个节点插入父节点（可通过 Ctrl+Z 撤销）` }
      } catch (e) {
        return { success: false, message: `插入父节点失败: ${e.message}` }
      }
    }

    case 'set_node_style': {
      try {
        // 优先直接解析 targets（批量一步到位，无需先 select_node）；否则作用于全部当前选中节点
        let targetNodes
        if (args.targets && (args.targets.uids || args.targets.keyword || args.targets.mode)) {
          const { nodes, error } = resolveTargetNodes(mindMap, args.targets)
          if (error) return { success: false, message: `目标节点解析失败：${error}` }
          targetNodes = nodes.filter(n => !n.isGeneralization)
        } else {
          targetNodes = (mindMap.renderer.activeNodeList || []).filter(n => !n.isGeneralization)
        }
        if (!targetNodes.length) {
          return { success: false, message: '没有目标节点。请通过 targets（uids/keyword/mode）一次指定全部目标，或先框选/批量选中节点' }
        }

        const details = applyNodeStyles(mindMap, targetNodes, args)
        if (details.length === 0) {
          return { success: false, message: '未提供任何样式参数：请至少填写 textColor/highlightColor/bold/italic/underline/strikethrough/fontFamily/textFontSize/fillColor/borderColor/shape/fontSize 之一' }
        }
        const applied = details.some(d => !d.includes('未生效') && !d.includes('全部失败'))
        return applied
          ? { success: true, message: `共 ${targetNodes.length} 个目标节点处理结果：${details.join('；')}` }
          : { success: false, message: `样式未生效：${details.join('；')}。请检查目标节点是否有文本内容，或通过 targets（uids/keyword/mode）重新指定目标。` }
      } catch (e) {
        return { success: false, message: `设置样式失败: ${e.message}` }
      }
    }

    case 'batch_text_style': {
      try {
        if (!mindMap) return { success: false, message: '当前没有打开的思维导图。请先调用 find_local_file(exts=["smm"]) 搜索本地导图文件（自动覆盖桌面/文档/下载/默认保存目录），再用 read_mindmap_file(filePath=...) 直接读取文件内容后继续。' }
        const { nodes, error } = resolveTargetNodes(mindMap, args.targets || {})
        if (error) return { success: false, message: `目标节点解析失败：${error}` }
        const targetNodes = nodes.filter(n => !n.isGeneralization)
        if (!targetNodes.length) return { success: false, message: '没有目标节点' }

        const match = args.match || {}
        const matchColor = (args.color || match.color || '').trim()
        const matchRegex = (args.regex || match.regex || '').trim()
        const matchText = (args.text || match.text || '').trim()
        if (!matchColor && !matchRegex && !matchText) {
          return { success: false, message: '缺少匹配范围：请提供 color（按颜色匹配）、regex（如 "【[^】]*】"）或 text（子串）至少一项' }
        }
        const actions = styleArgsToActions(args.style || args)
        if (actions.length === 0) {
          return { success: false, message: '缺少目标样式：请提供 textColor/highlightColor/bold/italic/underline/strikethrough/fontFamily/textFontSize 中的至少一项，或把它们放进 style 对象' }
        }

        let changed = 0
        let matched = 0
        let styleError = ''
        if (matchColor) {
          // 按文字颜色（色系）匹配：归类相近颜色，命中该色系所有文字片段
          const family = colorNameToFamily(matchColor)
          if (!family) {
            return { success: false, message: `无法识别颜色"${matchColor}"，请用色系名（红/橙/黄/绿/青/蓝/紫/粉/黑/白/灰）或颜色值` }
          }
          const r = applyTextStyleToTextRangesByColor(mindMap, targetNodes, family, actions)
          changed = r.changed
          matched = r.matched
        } else {
          const r = applyTextStyleToTextRanges(mindMap, targetNodes, matchText, matchRegex, actions)
          changed = r.changed
          matched = r.matched
          styleError = r.error || ''
        }
        if (styleError) return { success: false, message: `文字样式失败：${styleError}` }
        if (changed === 0) {
          const matchLabel = matchColor ? `${matchColor}色系` : `/${matchRegex || matchText}/`
          return { success: false, message: `在 ${targetNodes.length} 个目标节点中未匹配到 ${matchLabel} 的文字片段，请检查匹配规则` }
        }
        return { success: true, message: `已在 ${changed} 个节点（共 ${targetNodes.length} 个目标）中匹配 ${matched} 处文字片段并应用样式` }
      } catch (e) {
        return { success: false, message: `批量文字样式失败: ${e.message}` }
      }
    }

    case 'batch_node_actions': {
      try {
        const steps = Array.isArray(args.steps) ? args.steps : []
        if (steps.length === 0) return { success: false, message: '请提供 steps 操作步骤列表' }
        if (steps.length > 50) return { success: false, message: '步骤过多（单次最多 50 步），请拆分为多次调用' }

        if (args.dry_run === true) {
          const plannedChanges = []
          for (let i = 0; i < steps.length; i++) {
            const step = steps[i] || {}
            const { nodes, error } = resolveTargetNodes(mindMap, step.targets || {})
            if (error) {
              plannedChanges.push({ step: i + 1, error })
              continue
            }
            const targetNodes = nodes.filter(node => !node.isGeneralization)
            // 条件过滤（dry-run 也需要展示过滤后的节点）
            if (step.condition && targetNodes.length > 0) {
              const cond = step.condition
              const filtered = targetNodes.filter(n => {
                const plain = nodePlainText(n.getData?.('text') || '')
                if (cond.textContains && !plain.toLowerCase().includes(cond.textContains.toLowerCase())) return false
                if (cond.textNotContains && plain.toLowerCase().includes(cond.textNotContains.toLowerCase())) return false
                if (cond.textRegex) {
                  try { if (!new RegExp(cond.textRegex, 'i').test(plain)) return false } catch (e) { return false }
                }
                if (cond.hasCloze === true && !nodeHasCloze(n)) return false
                if (cond.hasCloze === false && nodeHasCloze(n)) return false
                return true
              })
              targetNodes.length = 0
              targetNodes.push(...filtered)
            }
            const changes = []
            if (step.set_style) changes.push({ operation: 'set_style', value: step.set_style })
            if (step.text_style) changes.push({ operation: 'text_style', value: step.text_style })
            if (step.ai_cloze) changes.push({ operation: 'ai_cloze' })
            if (Array.isArray(step.update_texts)) changes.push({ operation: 'update_texts', value: step.update_texts })
            if (step.wrap_text) changes.push({ operation: 'wrap_text', value: step.wrap_text })
            if (step.replace_text) changes.push({ operation: 'replace_text', value: step.replace_text })
            if (step.clear_cloze) changes.push({ operation: 'clear_cloze', value: step.clear_cloze })
            plannedChanges.push({
              step: i + 1,
              targetCount: targetNodes.length,
              sampleTargets: targetNodes.slice(0, 10).map(node => ({
                uid: node.data?.uid || node.uid || '',
                text: nodePlainText(node.getData?.('text')).slice(0, 80)
              })),
              changes
            })
          }
          return {
            success: true,
            dryRun: true,
            plannedChanges,
            message: `批量操作 dry-run 完成：${steps.length} 个步骤，未修改任何节点。请确认 plannedChanges 后重新调用并将 dry_run 设为 false。`
          }
        }

        const stepResults = []
        let allOk = true
        for (let i = 0; i < steps.length; i++) {
          const step = steps[i] || {}
          const { nodes, error } = resolveTargetNodes(mindMap, step.targets || {})
          if (error) {
            allOk = false
            stepResults.push(`第${i + 1}步未执行：${error}`)
            continue
          }
          const targetNodes = nodes.filter(n => !n.isGeneralization)
          // 条件过滤：在 targets 基础上进一步筛选
          if (step.condition && targetNodes.length > 0) {
            const cond = step.condition
            const filtered = targetNodes.filter(n => {
              const plain = nodePlainText(n.getData?.('text') || '')
              if (cond.textContains && !plain.toLowerCase().includes(cond.textContains.toLowerCase())) return false
              if (cond.textNotContains && plain.toLowerCase().includes(cond.textNotContains.toLowerCase())) return false
              if (cond.textRegex) {
                try { if (!new RegExp(cond.textRegex, 'i').test(plain)) return false } catch (e) { return false }
              }
              if (cond.hasCloze === true && !nodeHasCloze(n)) return false
              if (cond.hasCloze === false && nodeHasCloze(n)) return false
              if (cond.hasStyle) {
                const styles = analyzeNodeTextStyles(n)
                const styleMap = { bold: 'bold', italic: 'italic', underline: 'underline', color: 'textColor', highlight: 'highlightColor', cloze: 'cloze', nodeFill: 'nodeFill', note: 'note' }
                const key = styleMap[cond.hasStyle]
                if (key && !styles[key]) return false
              }
              return true
            })
            if (filtered.length < targetNodes.length) {
              stepResults.push(`第${i + 1}步条件过滤：${targetNodes.length} → ${filtered.length} 个节点`)
            }
            targetNodes.length = 0
            targetNodes.push(...filtered)
          }
          if (!targetNodes.length) {
            allOk = false
            stepResults.push(`第${i + 1}步未执行：命中的节点均不可操作`)
            continue
          }
          const first = nodePlainText(targetNodes[0].getData?.('text')).slice(0, 20)
          const parts = [`命中 ${targetNodes.length} 个节点（${first}${targetNodes.length > 1 ? ' 等' : ''}）`]

          if (step.set_style && Object.keys(step.set_style).length > 0) {
            const details = applyNodeStyles(mindMap, targetNodes, step.set_style)
            if (details.length === 0) {
              parts.push('set_style 未提供任何样式参数')
            } else {
              parts.push(details.join('；'))
              if (details.every(d => d.includes('未生效'))) allOk = false
            }
          }

          if (step.text_style) {
            const ts = step.text_style
            const matchColor = (ts.color || ts.match?.color || '').trim()
            const matchRegex = (ts.regex || ts.match?.regex || '').trim()
            const matchText = (ts.text || ts.match?.text || '').trim()
            const actions = styleArgsToActions(ts.style || ts)
            if (!matchColor && !matchRegex && !matchText) {
              allOk = false
              parts.push('text_style 缺少匹配范围：请提供 color/regex/text 至少一项')
            } else if (actions.length === 0) {
              allOk = false
              parts.push('text_style 未提供样式参数：请提供 textColor/highlightColor/bold 等样式')
            } else if (matchColor) {
              const family = colorNameToFamily(matchColor)
              if (!family) {
                allOk = false
                parts.push(`无法识别颜色"${matchColor}"`)
              } else {
                const result = applyTextStyleToTextRangesByColor(mindMap, targetNodes, family, actions)
                if (result.changed === 0) {
                  allOk = false
                  parts.push(`未匹配到 ${matchColor} 色系的文字片段`)
                } else {
                  parts.push(`文字片段样式已应用到 ${result.changed} 个节点的 ${result.matched} 处`)
                }
              }
            } else {
              const result = applyTextStyleToTextRanges(mindMap, targetNodes, matchText, matchRegex, actions)
              if (result.error) {
                allOk = false
                parts.push(`文字片段样式失败：${result.error}`)
              } else if (result.changed === 0) {
                allOk = false
                parts.push(`未匹配到 /${matchRegex || matchText}/ 的文字片段`)
              } else {
                parts.push(`文字片段样式已应用到 ${result.changed} 个节点的 ${result.matched} 处`)
              }
            }
          }

          if (step.ai_cloze) {
            if (extraHandlers.aiCloze) {
              setActiveNodes(mindMap, targetNodes)
              const result = await extraHandlers.aiCloze()
              const ok = result && !/失败|没有选中|正在处理/.test(result)
              if (!ok) allOk = false
              parts.push(ok ? `挖空完成：${String(result || '').split('\n')[0]}` : `挖空未完成：${result}`)
            } else {
              allOk = false
              parts.push('AI挖空功能不可用')
            }
          }

          if (Array.isArray(step.update_texts) && step.update_texts.length > 0) {
            let updated = 0
            const missingUids = []
            step.update_texts.forEach(({ uid, text }) => {
              const target = targetNodes.find(node => (node.data?.uid || node.uid) === uid)
              if (!target) {
                missingUids.push(uid)
                return
              }
              target.setText(text)
              updated++
            })
            if (missingUids.length) allOk = false
            parts.push(updated ? `已更新 ${updated} 个节点文本` + (missingUids.length ? `；${missingUids.length} 个 uid 未命中` : '') : `uid 未命中：${missingUids.join(', ')}`)
          }

          if (step.wrap_text && (step.wrap_text.prefix || step.wrap_text.suffix)) {
            let wrapped = 0
            targetNodes.forEach(node => {
              try {
                const html = String(node.getData?.('text') || '')
                if (!html) return
                node.setText(`${step.wrap_text.prefix || ''}${html}${step.wrap_text.suffix || ''}`)
                wrapped++
              } catch (err) {
                console.error('wrap_text 失败:', err)
              }
            })
            if (wrapped === 0) {
              allOk = false
              parts.push('wrap_text 未生效（目标节点可能为空文本）')
            } else {
              parts.push(`wrap_text 已为 ${wrapped} 个节点包裹文本（保留原有格式）`)
            }
          }

          if (step.replace_text && step.replace_text.find) {
            const replaceTask = step.replace_text
            let changedCount = 0
            let occurrenceCount = 0
            let regexError = ''
            targetNodes.forEach(node => {
              try {
                const html = String(node.getData?.('text') || '')
                const { out, count, error } = replaceHtmlFind(html, String(replaceTask.find), String(replaceTask.replacement ?? ''), replaceTask.regex === true, replaceTask.flags)
                if (error) { regexError = error; return }
                if (count > 0 && out !== html) {
                  node.setText(out)
                  changedCount++
                  occurrenceCount += count
                }
              } catch (err) {
                console.error('replace_text 失败:', err)
              }
            })
            if (regexError) {
              allOk = false
              parts.push(`replace_text 失败：${regexError}`)
            } else if (changedCount === 0) {
              parts.push(`replace_text 未匹配到"${String(replaceTask.find).slice(0, 20)}"`)
            } else {
              parts.push(`replace_text 已在 ${changedCount} 个节点替换 ${occurrenceCount} 处`)
            }
          }

          if (step.clear_cloze) {
            const cc = step.clear_cloze
            const delimiter = cc.before || cc.after || ''
            const side = cc.before ? 'before' : (cc.after ? 'after' : '')
            let cleared = 0
            for (const n of targetNodes) {
              if (n.isGeneralization) continue
              const text = n.getData?.('text') || ''
              if (!text.includes('smm-cloze')) continue
              try {
                if (delimiter && side) {
                  if (clearNodeClozePartial(n, delimiter, side)) cleared++
                } else {
                  clearNodeCloze(n)
                  cleared++
                }
              } catch (err) {
                console.warn('[batch clear_cloze] 单节点清除失败:', err)
              }
            }
            if (cleared > 0) {
              mindMap.render()
              applyClozeStyles()
            }
            const scopeDesc = delimiter ? `（${side === 'before' ? delimiter + '前' : delimiter + '后'}）` : ''
            parts.push(cleared > 0 ? `clear_cloze 已清除 ${cleared} 个节点${scopeDesc}的挖空` : 'clear_cloze 未找到匹配的挖空标记')
          }

          if (!step.set_style && !step.text_style && !step.ai_cloze && !step.update_texts && !step.wrap_text && !step.replace_text && !step.clear_cloze) {
            parts.push('未指定任何操作（set_style / text_style / ai_cloze / update_texts / wrap_text / replace_text / clear_cloze 至少一项）')
          }
          stepResults.push(`第${i + 1}步：${parts.join('；')}`)
        }

        return {
          success: allOk,
          message: `批量操作${allOk ? '完成' : '部分未成功'}（共 ${steps.length} 步）：\n${stepResults.join('\n')}`
        }
      } catch (e) {
        return { success: false, message: `批量操作失败: ${e.message}` }
      }
    }

        case 'summarize_node': {
      try {
        // targets 直达批量加概要（避免先 select_node 循环）；省略则作用于第一个选中节点
        let targetNodes
        if (args.targets && (args.targets.uids || args.targets.keyword || args.targets.mode)) {
          const { nodes, error } = resolveTargetNodes(mindMap, args.targets)
          if (error) return { success: false, message: `目标节点解析失败：${error}` }
          targetNodes = nodes.filter(n => !n.isGeneralization)
        } else {
          targetNodes = (mindMap.renderer.activeNodeList || []).filter(n => !n.isGeneralization)
          if (targetNodes.length) targetNodes = [targetNodes[0]]
        }
        if (!targetNodes.length) return { success: false, message: '没有目标节点' }
        for (const node of targetNodes) {
          node.setData({ generalization: [{ text: args.summary }] })
        }
        mindMap.render()
        return { success: true, message: `已为 ${targetNodes.length} 个节点添加概要` }
      } catch (e) {
        return { success: false, message: `添加概要失败: ${e.message}` }
      }
    }

    case 'search_nodes': {
      try {
        if (!mindMap) return { success: false, message: '当前没有打开的思维导图。请先调用 find_local_file(exts=["smm"]) 搜索本地导图文件（自动覆盖桌面/文档/下载/默认保存目录），再用 read_mindmap_file(filePath=...) 直接读取文件内容后继续。' }
        const treeData = mindMap.getData()
        const rawKeywords = []
        if (args.keyword) rawKeywords.push(String(args.keyword))
        if (Array.isArray(args.keywords)) args.keywords.forEach((k) => rawKeywords.push(String(k)))
        const keywords = [...new Set(rawKeywords.map((k) => normalizeForMatch(k)).filter(Boolean))]
        if (!keywords.length) return { success: false, message: '请至少提供一个 keyword 或 keywords 参数' }
        const mode = args.mode === 'all' ? 'all' : 'any'
        const maxResults = Math.min(Math.max(Number(args.max_results) || 200, 1), 1000)
        const results = []
        function traverse(node, parents) {
          const rawText = node.data?.text || node.text || ''
          const plain = rawText.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim()
          // 关键词已被 normalizeForMatch 去掉全部空白，节点文本也必须同样归一化后匹配，
          // 否则含空格的检索词（如“第一章 世界的物质性及发展规律”）会因空格差异而漏配
          const text = normalizeForMatch(rawText)
          const matched = mode === 'all'
            ? keywords.every((keyword) => text.includes(keyword))
            : keywords.some((keyword) => text.includes(keyword))
          if (matched && results.length < maxResults) {
            const uid = node.data?.uid || node.uid
            // 直接用递归路径拼接，避免命中多时 getNodePath 全树 O(n) 遍历导致 O(n²)
            const path = parents.map(p => p.text).concat([plain]).join(' > ')
            const parentPath = parents.length ? parents.map(p => p.text).join(' / ') : ''
            const parentUid = parents.length ? parents[parents.length - 1].uid : ''
            results.push({ uid: uid || '', path, parentPath, parentUid })
          }
          const nextParents = parents.concat([{ text: plain || '（空）', uid: node.data?.uid || node.uid || '' }])
          if (node.children) node.children.forEach(c => traverse(c, nextParents))
        }
        traverse(treeData, [])
        return {
          success: true,
          message: results.length
            ? `找到 ${results.length} 个匹配节点${results.length >= maxResults ? '（已达 max_results 上限）' : ''}：\n${results.map((r, i) => `${i + 1}. ${r.path}${r.uid ? `（uid: ${r.uid}）` : ''}`).join('\n')}`
            : '未找到匹配的节点',
          results
        }
      } catch (e) {
        return { success: false, message: `搜索节点失败: ${e.message}` }
      }
    }

    case 'query_nodes': {
      try {
        if (!mindMap) return { success: false, message: '当前没有打开的思维导图。请先调用 find_local_file(exts=["smm"]) 搜索本地导图文件（自动覆盖桌面/文档/下载/默认保存目录），再用 read_mindmap_file(filePath=...) 直接读取文件内容后继续。' }
        const filters = args.filters || {}
        const limit = Math.min(Math.max(Number(args.limit) || 200, 1), 500)
        const returnFields = Array.isArray(args.returnFields) && args.returnFields.length > 0
          ? new Set(args.returnFields) : new Set(['uid', 'plainText', 'path', 'clozeWords', 'depth', 'isLeaf'])

        // 1. 确定搜索范围
        let scopeNodes
        if (args.scope && (args.scope.uids || args.scope.keyword || args.scope.mode)) {
          const r = resolveTargetNodes(mindMap, args.scope)
          if (r.error) return { success: false, message: `范围解析失败：${r.error}` }
          scopeNodes = r.nodes
        } else {
          scopeNodes = []
          const walkAll = (n) => {
            if (!n || n.isGeneralization) return
            scopeNodes.push(n)
            ;(n.children || []).forEach(walkAll)
          }
          walkAll(mindMap.renderer.root)
        }

        // 2. 预编译过滤器
        const textContains = filters.textContains ? normalizeForMatch(filters.textContains) : ''
        const textNotContains = filters.textNotContains ? normalizeForMatch(filters.textNotContains) : ''
        let textRegex = null
        if (filters.textRegex) {
          try { textRegex = new RegExp(filters.textRegex, 'i') } catch (e) {
            return { success: false, message: `textRegex 正则语法错误: ${e.message}` }
          }
        }
        const textStartsWith = filters.textStartsWith || ''
        const wantHasCloze = filters.hasCloze
        const clozeContains = filters.clozeContains ? filters.clozeContains.toLowerCase() : ''
        const wantHasStyle = filters.hasStyle || ''
        const wantHasNote = filters.hasNote
        const wantIsLeaf = filters.isLeaf
        const minDepth = Number.isFinite(Number(filters.minDepth)) ? Number(filters.minDepth) : -1
        const maxDepth = Number.isFinite(Number(filters.maxDepth)) ? Number(filters.maxDepth) : 999

        // 3. 遍历节点 + 过滤
        const results = []
        const nodeDepthMap = new Map()
        const calcDepth = (node) => {
          if (nodeDepthMap.has(node)) return nodeDepthMap.get(node)
          let d = 0
          let p = node.parent
          while (p && p !== mindMap.renderer.root) { d++; p = p.parent }
          nodeDepthMap.set(node, d)
          return d
        }

        for (const n of scopeNodes) {
          if (n.isGeneralization) continue
          const plain = nodePlainText(n.getData?.('text') || '')
          const normText = normalizeForMatch(plain)
          const uid = n.getData?.('uid') || n.uid

          // 文本过滤
          if (textContains && !normText.includes(textContains)) continue
          if (textNotContains && normText.includes(textNotContains)) continue
          if (textRegex && !textRegex.test(plain)) continue
          if (textStartsWith && !plain.startsWith(textStartsWith)) continue

          // 挖空过滤
          const hasCloze = nodeHasCloze(n)
          if (wantHasCloze === true && !hasCloze) continue
          if (wantHasCloze === false && hasCloze) continue

          // 挖空词过滤
          let clozeWords = []
          if (hasCloze || clozeContains || returnFields.has('clozeWords')) {
            const audit = analyzeNodeTextStyles(n.getData?.('text') || '')
            clozeWords = audit?.cloze || []
            if (clozeContains && !clozeWords.some(w => w.toLowerCase().includes(clozeContains))) continue
          }

          // 样式过滤
          if (wantHasStyle) {
            const audit = analyzeNodeTextStyles(n.getData?.('text') || '')
            const styleMap = { bold: 'bold', italic: 'italic', underline: 'underline', color: 'colors', highlight: 'highlights', cloze: 'cloze', nodeFill: 'nodeFill', note: 'note' }
            const key = styleMap[wantHasStyle]
            if (key) {
              if (key === 'nodeFill') {
                if (!(n.getData?.('style') || {}).fillColor) continue
              } else if (key === 'note') {
                if (!n.getData?.('note')) continue
              } else if (audit) {
                const val = audit[key]
                if (Array.isArray(val) ? val.length === 0 : Object.keys(val).length === 0) continue
              } else {
                continue
              }
            }
          }

          // 备注过滤
          if (wantHasNote === true && !n.getData?.('note')) continue
          if (wantHasNote === false && n.getData?.('note')) continue

          // 结构过滤
          const children = (n.children || []).filter(c => !c.isGeneralization)
          if (wantIsLeaf === true && children.length > 0) continue
          if (wantIsLeaf === false && children.length === 0) continue

          // 深度过滤
          const depth = calcDepth(n)
          if (depth < minDepth || depth > maxDepth) continue

          // 构造结果
          const entry = {}
          if (returnFields.has('uid')) entry.uid = uid
          if (returnFields.has('plainText')) entry.plainText = plain.slice(0, 200)
          if (returnFields.has('path')) {
            const parts = []
            let cur = n
            while (cur && cur !== mindMap.renderer.root) {
              parts.unshift(nodePlainText(cur.getData?.('text') || '').slice(0, 30))
              cur = cur.parent
            }
            entry.path = parts.join(' > ')
          }
          if (returnFields.has('clozeWords') && clozeWords.length) entry.clozeWords = clozeWords
          if (returnFields.has('depth')) entry.depth = depth
          if (returnFields.has('isLeaf')) entry.isLeaf = children.length === 0
          if (returnFields.has('hasNote')) entry.hasNote = !!n.getData?.('note')
          if (returnFields.has('rawHtml')) entry.rawHtml = (n.getData?.('text') || '').slice(0, 500)
          if (returnFields.has('styles')) {
            const audit = analyzeNodeTextStyles(n.getData?.('text') || '')
            if (audit) {
              const s = {}
              if (Object.keys(audit.colors).length) s.color = Object.keys(audit.colors)
              if (Object.keys(audit.highlights).length) s.highlight = Object.keys(audit.highlights)
              if (audit.bold.length) s.bold = true
              if (audit.italic.length) s.italic = true
              if (audit.underline.length) s.underline = true
              if (audit.cloze.length) s.cloze = audit.cloze
              const st = n.getData?.('style') || {}
              if (st.fillColor) s.nodeFill = st.fillColor
              if (Object.keys(s).length) entry.styles = s
            }
          }
          results.push(entry)
          if (results.length >= limit) break
        }

        const total = results.length
        const sample = results.slice(0, 50)
        const summary = sample.map((r, i) => {
          const parts = [`${i + 1}.`]
          if (r.plainText) parts.push(r.plainText.slice(0, 60))
          if (r.clozeWords?.length) parts.push(`[挖空: ${r.clozeWords.join('、')}]`)
          if (r.uid) parts.push(`uid=${r.uid.slice(0, 8)}`)
          return parts.join(' ')
        }).join('\n')

        return {
          success: true,
          total,
          message: `查询到 ${total} 个节点${total > limit ? `（已截断到 ${limit}）` : ''}：\n${summary}`,
          results: sample
        }
      } catch (e) {
        return { success: false, message: `查询节点失败: ${e.message}` }
      }
    }

    case 'change_layout': {
      try {
        if (!mindMap) return { success: false, message: '当前没有打开的思维导图。请先调用 find_local_file(exts=["smm"]) 搜索本地导图文件（自动覆盖桌面/文档/下载/默认保存目录），再用 read_mindmap_file(filePath=...) 直接读取文件内容后继续。' }
        mindMap.setLayout(args.layout)
        mindMap.render()
        return { success: true, message: `布局已切换为：${args.layout}` }
      } catch (e) {
        return { success: false, message: `切换布局失败: ${e.message}` }
      }
    }

    case 'set_theme': {
      try {
        if (!mindMap) return { success: false, message: '当前没有打开的思维导图。请先调用 find_local_file(exts=["smm"]) 搜索本地导图文件（自动覆盖桌面/文档/下载/默认保存目录），再用 read_mindmap_file(filePath=...) 直接读取文件内容后继续。' }
        mindMap.setTheme(args.theme)
        mindMap.render()
        return { success: true, message: `主题已切换为：${args.theme}` }
      } catch (e) {
        return { success: false, message: `切换主题失败: ${e.message}` }
      }
    }

    case 'switch_view': {
      try {
        if (extraHandlers.switchView) {
          extraHandlers.switchView(args.mode)
          return { success: true, message: `已切换到${args.mode === 'outline' ? '大纲' : args.mode === 'review' ? '复习' : '思维导图'}模式` }
        }
        return { success: false, message: '视图切换功能不可用' }
      } catch (e) {
        return { success: false, message: `切换视图失败: ${e.message}` }
      }
    }

    case 'zoom_control': {
      try {
        if (!mindMap) return { success: false, message: '当前没有打开的思维导图。请先调用 find_local_file(exts=["smm"]) 搜索本地导图文件（自动覆盖桌面/文档/下载/默认保存目录），再用 read_mindmap_file(filePath=...) 直接读取文件内容后继续。' }
        switch (args.action) {
          case 'in': mindMap.view.enlarge(); break
          case 'out': mindMap.view.narrow(); break
          case 'fit': mindMap.view.fit(); break
          case 'reset': mindMap.view.reset(); break
        }
        return { success: true, message: `缩放操作：${args.action}` }
      } catch (e) {
        return { success: false, message: `缩放失败: ${e.message}` }
      }
    }

    case 'undo': {
      try {
        if (!mindMap) return { success: false, message: '当前没有打开的思维导图。请先调用 find_local_file(exts=["smm"]) 搜索本地导图文件（自动覆盖桌面/文档/下载/默认保存目录），再用 read_mindmap_file(filePath=...) 直接读取文件内容后继续。' }
        mindMap.execCommand('BACK')
        return { success: true, message: '已撤销' }
      } catch (e) {
        return { success: false, message: `撤销失败: ${e.message}` }
      }
    }

    case 'redo': {
      try {
        if (!mindMap) return { success: false, message: '当前没有打开的思维导图。请先调用 find_local_file(exts=["smm"]) 搜索本地导图文件（自动覆盖桌面/文档/下载/默认保存目录），再用 read_mindmap_file(filePath=...) 直接读取文件内容后继续。' }
        mindMap.execCommand('FORWARD')
        return { success: true, message: '已重做' }
      } catch (e) {
        return { success: false, message: `重做失败: ${e.message}` }
      }
    }

    case 'export_mindmap': {
      try {
        if (!mindMap) return { success: false, message: '当前没有打开的思维导图。请先调用 find_local_file(exts=["smm"]) 搜索本地导图文件（自动覆盖桌面/文档/下载/默认保存目录），再用 read_mindmap_file(filePath=...) 直接读取文件内容后继续。' }
        // simple-mind-map 不支持 jpg（export 会返回 null 产出空文件），统一按 png 导出
        const format = args.format === 'jpg' ? 'png' : (args.format || 'png')
        // 导出文件名
        const treeData = mindMap.getData()
        const rawRootText = treeData?.data?.text || ''
        const rootText = rawRootText.replace(/<[^>]+>/g, '').trim() || '思维导图'
        const safeName = rootText.replace(/[<>:"/\\|?*]/g, '_').slice(0, 50)
        const fileName = `${safeName}.${format === 'markdown' ? 'md' : format}`

        if (format === 'json') {
          const data = JSON.stringify(treeData, null, 2)
          if (window.electronAPI?.saveFile) {
            const result = await window.electronAPI.saveFile(fileName, data)
            if (result && result.success) {
              await revealIfAsked(args, result.filePath)
              return { success: true, message: `已导出并保存：${fileName}`, filePath: result.filePath, fileName, externalFile: true }
            }
          }
          return { success: false, message: '导出JSON失败' }
        }

        if (format === 'markdown') {
          const md = treeToMarkdown(treeData)
          if (window.electronAPI?.saveFile) {
            const result = await window.electronAPI.saveFile(fileName, md)
            if (result && result.success) {
              await revealIfAsked(args, result.filePath)
              return { success: true, message: `已导出并保存：${fileName}`, filePath: result.filePath, fileName, externalFile: true }
            }
          }
          return { success: false, message: '导出Markdown失败' }
        }

        if (format === 'xmind') {
          // XMind 2020+ 格式：zip 包内含 content.json + metadata.json
          const JSZip = (await import('jszip')).default
          let idSeq = 0
          const toTopic = (n) => {
            const title = String(n?.data?.text || '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim() || '未命名主题'
            const children = (n?.children || []).map(toTopic)
            return { id: `t${++idSeq}`, title, children: { attached: children, detached: [] } }
          }
          const sheet = { id: 'sheet1', class: 'sheet', title: rootText, rootTopic: toTopic(treeData) }
          const zip = new JSZip()
          zip.file('content.json', JSON.stringify([sheet]))
          zip.file('metadata.json', JSON.stringify({ dataStructureVersion: '2.0', creator: { name: 'my-mindmap agent', version: '2.0.0' } }))
          const base64 = await zip.generateAsync({ type: 'base64', compression: 'DEFLATE' })
          if (!window.electronAPI?.saveBinaryFile) return { success: false, message: '文件保存功能不可用' }
          const r = await window.electronAPI.saveBinaryFile(fileName, base64)
          if (!r || !r.success) return { success: false, message: `保存失败：${r?.error || '未知错误'}` }
          await revealIfAsked(args, r.filePath)
          return { success: true, message: `已导出 XMind 文件（XMind 2020+ 格式，共 ${countNodes(treeData)} 个节点）：${r.filePath}`, filePath: r.filePath, fileName, externalFile: true }
        }

        // 图片格式：导出为 data URL（不触发下载对话框），自动保存到默认保存目录并显示在消息中
        if (mindMap.export) {
          let dataUrl = await mindMap.export(format, false)
          if (format === 'svg') dataUrl = await injectInteractiveSvg(dataUrl)
          // mindMap.export 内部吞异常，出错时返回 undefined：必须判空，否则会写出 0 字节空文件并假报成功
          if (!dataUrl) {
            return { success: false, message: `导出失败：${format.toUpperCase()} 生成失败（渲染未产出数据，可能是画布过大或渲染未完成，可稍后重试）` }
          }
          let filePath = null

          try {
            if (window.electronAPI?.saveBinaryFile) {
              const r = await window.electronAPI.saveBinaryFile(fileName, dataUrl)
              if (r && r.success) filePath = r.filePath
            }
          } catch (saveErr) {
            console.warn('导出图片自动保存失败:', saveErr)
          }

          await revealIfAsked(args, filePath)
          return {
            success: true,
            message: filePath
              ? `已导出并自动保存到：${filePath}（图片显示在消息中）`
              : `已导出为 ${format} 格式`,
            imageFormat: format,
            imageData: dataUrl,
            filePath,
            fileName,
            externalFile: filePath ? true : undefined
          }
        }
        return { success: false, message: '导出功能不可用' }
      } catch (e) {
        console.error('export_mindmap error:', e)
        return { success: false, message: `导出失败: ${e.message}` }
      }
    }

    case 'upload_to_feishu': {
      try {
        if (!mindMap) return { success: false, message: '当前没有打开的思维导图。请先调用 find_local_file(exts=["smm"]) 搜索本地导图文件（自动覆盖桌面/文档/下载/默认保存目录），再用 read_mindmap_file(filePath=...) 直接读取文件内容后继续。' }
        const feishu = window.electronAPI?.feishu
        if (!feishu || typeof feishu.uploadFile !== 'function') {
          return { success: false, message: '飞书功能不可用：请先在设置中配置飞书 App ID 和 App Secret' }
        }

        // 先保存当前思维导图为 .smm 文件（上传的是思维导图文件本身）
        const treeData = mindMap.getData()
        const rawRootText = treeData?.data?.text || ''
        const rootText = rawRootText.replace(/<[^>]+>/g, '').trim() || '思维导图'
        const safeName = (args.fileName || rootText).replace(/[<>:"/\\|?*]/g, '_').slice(0, 50)
        const fileName = `${safeName}.smm`
        let filePath = null
        if (window.electronAPI?.saveFile) {
          const r = await window.electronAPI.saveFile(fileName, JSON.stringify(treeData, null, 2))
          if (r && r.success) filePath = r.filePath
        }
        if (!filePath) {
          return { success: false, message: '保存 .smm 文件失败，无法上传' }
        }

        const uploadResult = await feishu.uploadFile(filePath, 'explorer', '')
        const url = uploadResult?.url || ''
        const permNote = uploadResult?.permission
          ? ''
          : '\n注意：未能自动开启链接分享权限，如链接无法访问，请在飞书云空间中手动开启分享。'
        return {
          success: true,
          message: `已将思维导图文件 ${fileName} 上传到飞书云空间（我的空间根目录）。\n文件令牌：${uploadResult?.file_token || '未知'}\n文件类型：file（后续删除/重命名时 fileType 传 "file"）${url ? `\n访问链接：${url}` : ''}${permNote}`,
          filePath,
          fileName,
          feishuFileToken: uploadResult?.file_token || '',
          feishuFileType: 'file',
          feishuUrl: url,
          permission: uploadResult?.permission || null
        }
      } catch (e) {
        console.error('upload_to_feishu error:', e)
        return { success: false, message: `上传飞书失败: ${e.message}` }
      }
    }

    case 'upload_mindmap_to_feishu_doc': {
      try {
        if (!mindMap) return { success: false, message: '当前没有打开的思维导图。请先调用 find_local_file(exts=["smm"]) 搜索本地导图文件（自动覆盖桌面/文档/下载/默认保存目录），再用 read_mindmap_file(filePath=...) 直接读取文件内容后继续。' }
        const feishu = window.electronAPI?.feishu
        if (!feishu || typeof feishu.importMarkdownDoc !== 'function') {
          return { success: false, message: '飞书功能不可用：请先在设置中配置飞书 App ID 和 App Secret' }
        }

        // 思维导图 → Markdown（节点层级 → 标题层级）
        const treeData = mindMap.getData()
        const rawRootText = treeData?.data?.text || ''
        const rootText = rawRootText.replace(/<[^>]+>/g, '').trim() || '思维导图'
        const markdown = treeToMarkdown(treeData)
        if (!markdown.trim()) return { success: false, message: '当前思维导图为空，无法转换' }

        const title = (args.title || rootText).replace(/[<>:"/\\|?*]/g, '_').slice(0, 80)
        const result = await feishu.importMarkdownDoc(markdown, title, args.folderToken || '')
        const url = result?.url || ''
        const permNote = result?.permission
          ? ''
          : '\n注意：未能自动开启链接分享权限，如链接无法访问，请在飞书中手动开启分享。'
        return {
          success: true,
          message: `已将思维导图《${title}》转换为飞书在线文档并上传（节点层级已转为标题层级）。\n文档令牌：${result?.token || '未知'}\n文件类型：docx（后续删除/重命名时 fileType 传 "docx"）${url ? `\n文档链接：${url}` : ''}${permNote}`,
          feishuDocToken: result?.token || '',
          feishuFileType: 'docx',
          feishuUrl: url,
          title
        }
      } catch (e) {
        console.error('upload_mindmap_to_feishu_doc error:', e)
        return { success: false, message: `思维导图转飞书文档失败: ${e.message}` }
      }
    }

    case 'upload_file_to_feishu': {
      try {
        const feishu = window.electronAPI?.feishu
        if (!feishu || typeof feishu.uploadDriveFile !== 'function') {
          return { success: false, message: '飞书功能不可用：请先在设置中配置飞书 App ID 和 App Secret' }
        }
        const filePath = (args.filePath || '').trim()
        if (!filePath) return { success: false, message: '缺少文件路径参数 filePath' }

        const result = await feishu.uploadDriveFile(filePath, args.folderToken || '')
        const url = result?.url || ''
        const fileName = filePath.split(/[/\\]/).pop()
        const permNote = result?.permission
          ? ''
          : '\n注意：未能自动开启链接分享权限，如链接无法访问，请在飞书云空间中手动开启分享。'
        return {
          success: true,
          message: `已将文件 ${fileName} 上传到飞书云盘。\n文件令牌：${result?.file_token || '未知'}\n文件类型：file（后续删除/重命名时 fileType 传 "file"）${url ? `\n访问链接：${url}` : ''}${permNote}`,
          filePath,
          fileName,
          feishuFileToken: result?.file_token || '',
          feishuFileType: 'file',
          feishuUrl: url
        }
      } catch (e) {
        console.error('upload_file_to_feishu error:', e)
        return { success: false, message: `上传文件到飞书云盘失败: ${e.message}` }
      }
    }

    case 'feishu_list_files': {
      try {
        const feishu = window.electronAPI?.feishu
        if (!feishu || typeof feishu.listFiles !== 'function') {
          return { success: false, message: '飞书功能不可用：请先在设置中配置飞书 App ID 和 App Secret' }
        }
        let folderToken = (args.folderToken || '').trim()
        // 未指定文件夹时，先取根目录 token
        if (!folderToken && typeof feishu.getRootFolder === 'function') {
          const root = await feishu.getRootFolder()
          folderToken = root?.token || ''
        }
        const data = await feishu.listFiles(folderToken)
        const files = data?.files || []
        if (files.length === 0) {
          return { success: true, message: '该文件夹下没有文件' }
        }
        const formatted = files.map((f, i) => {
          const typeMap = { doc: '文档(doc)', docx: '文档(docx)', sheet: '表格', bitable: '多维表格', file: '云盘文件', folder: '文件夹' }
          const typeName = typeMap[f.type] || f.type || '未知'
          const url = f.type === 'docx' ? `https://www.feishu.cn/docx/${f.token}` : (f.type === 'folder' ? '' : `https://www.feishu.cn/file/${f.token}`)
          return `${i + 1}. ${f.name}（${typeName}）\n   token: ${f.token}\n   type: ${f.type || 'file'}${url ? `\n   链接: ${url}` : ''}`
        }).join('\n')
        return {
          success: true,
          message: `飞书云盘文件列表（共 ${files.length} 项）：\n\n${formatted}\n\n提示：删除/重命名时，fileType 需使用上方每项的 "type" 值（如 docx/sheet/folder）。`,
          files
        }
      } catch (e) {
        console.error('feishu_list_files error:', e)
        return { success: false, message: `获取飞书云盘文件列表失败: ${e.message}` }
      }
    }

    case 'feishu_get_doc_content': {
      try {
        const feishu = window.electronAPI?.feishu
        if (!feishu || typeof feishu.getDocContent !== 'function') {
          return { success: false, message: '飞书功能不可用：请先在设置中配置飞书 App ID 和 App Secret' }
        }
        // 组装待读列表：优先 docTokens 批量；否则单文档 docToken
        const tokens = []
        if (Array.isArray(args.docTokens) && args.docTokens.length > 0) {
          for (const t of args.docTokens) if (t && String(t).trim()) tokens.push(String(t).trim())
        } else {
          const docToken = (args.docToken || '').trim()
          if (!docToken) return { success: false, message: '缺少文档 token 参数 docToken（或批量 docTokens）' }
          tokens.push(docToken)
        }
        if (tokens.length === 0) return { success: false, message: '没有可读取的文档（docTokens 或 docToken 为空）' }

        const parts = []
        const failed = []
        for (const t of tokens) {
          try {
            const data = await feishu.getDocContent(t)
            const content = data?.content || ''
            if (!content) {
              parts.push(`【文档 ${t}】内容为空或无法读取（注意：仅支持 docx 在线文档）`)
            } else {
              const trimmed = content.length > 5000 ? content.slice(0, 5000) + '\n...（内容过长已截断）' : content
              parts.push(`【文档 ${t}】\n${trimmed}`)
            }
          } catch (e) {
            failed.push({ docToken: t, error: e.message })
          }
        }
        let msg = tokens.length === 1
          ? `文档内容：\n\n${parts[0] || ''}`
          : `已读取 ${parts.length} 篇文档：\n\n${parts.join('\n\n---\n\n')}`
        if (failed.length > 0) msg += `\n\n失败 ${failed.length} 篇：\n${failed.map(f => `- ${f.docToken}: ${f.error}`).join('\n')}`
        return { success: failed.length === 0, message: msg }
      } catch (e) {
        console.error('feishu_get_doc_content error:', e)
        return { success: false, message: `获取飞书文档内容失败: ${e.message}` }
      }
    }

    case 'feishu_delete_file': {
      try {
        const feishu = window.electronAPI?.feishu
        if (!feishu || typeof feishu.deleteFile !== 'function') {
          return { success: false, message: '飞书功能不可用：请先在设置中配置飞书 App ID 和 App Secret' }
        }
        // 组装待删除列表：优先 items 批量；否则单文件 fileToken
        const targets = []
        if (Array.isArray(args.items) && args.items.length > 0) {
          for (const it of args.items) {
            const t = (it && it.fileToken) || ''
            if (t) targets.push({ fileToken: t, fileType: (it && it.fileType) || 'file' })
          }
        } else {
          const fileToken = (args.fileToken || '').trim()
          if (!fileToken) return { success: false, message: '缺少文件 token 参数 fileToken（或批量 items）' }
          targets.push({ fileToken, fileType: args.fileType || 'file' })
        }
        if (targets.length === 0) return { success: false, message: '没有可删除的文件（items 或 fileToken 为空）' }

        const ok = []
        const failed = []
        for (const t of targets) {
          try {
            await feishu.deleteFile(t.fileToken, t.fileType)
            ok.push(t.fileToken)
          } catch (e) {
            failed.push({ fileToken: t.fileToken, fileType: t.fileType, error: e.message })
          }
        }
        let msg = `已删除 ${ok.length} 个飞书文件（已移入回收站，可在飞书回收站恢复）`
        if (failed.length > 0) msg += `\n\n失败 ${failed.length} 个：\n${failed.map(f => `- token=${f.fileToken}（type=${f.fileType}）: ${f.error}`).join('\n')}`
        return { success: failed.length === 0, message: msg, deleted: ok, failed }
      } catch (e) {
        console.error('feishu_delete_file error:', e)
        return { success: false, message: `删除飞书文件失败: ${e.message}` }
      }
    }

    case 'feishu_rename_file': {
      try {
        const feishu = window.electronAPI?.feishu
        if (!feishu || typeof feishu.renameFile !== 'function') {
          return { success: false, message: '飞书功能不可用：请先在设置中配置飞书 App ID 和 App Secret' }
        }
        // 组装待重命名列表：优先 items 批量；否则单文件 fileToken
        const targets = []
        if (Array.isArray(args.items) && args.items.length > 0) {
          for (const it of args.items) {
            const ft = (it && it.fileToken) || ''
            const nn = (it && it.newName) || ''
            if (ft && nn) targets.push({ fileToken: ft, newName: nn, fileType: (it && it.fileType) || 'file' })
          }
        } else {
          const fileToken = (args.fileToken || '').trim()
          const newName = (args.newName || '').trim()
          if (!fileToken || !newName) return { success: false, message: '缺少参数 fileToken 或 newName（或批量 items）' }
          targets.push({ fileToken, newName, fileType: args.fileType || 'file' })
        }
        if (targets.length === 0) return { success: false, message: '没有可重命名的文件（items 或 fileToken 为空）' }

        const ok = []
        const failed = []
        for (const t of targets) {
          try {
            await feishu.renameFile(t.fileToken, t.newName, t.fileType)
            ok.push({ fileToken: t.fileToken, newName: t.newName })
          } catch (e) {
            failed.push({ fileToken: t.fileToken, newName: t.newName, error: e.message })
          }
        }
        let msg = `已重命名 ${ok.length} 个飞书文件`
        if (failed.length > 0) msg += `\n\n失败 ${failed.length} 个：\n${failed.map(f => `- token=${f.fileToken} → ${f.newName}: ${f.error}`).join('\n')}`
        return { success: failed.length === 0, message: msg, renamed: ok, failed }
      } catch (e) {
        console.error('feishu_rename_file error:', e)
        return { success: false, message: `重命名飞书文件失败: ${e.message}` }
      }
    }

    case 'send_feishu_message': {
      try {
        const feishu = window.electronAPI?.feishu
        if (!feishu || typeof feishu.sendMessage !== 'function') {
          return { success: false, message: '飞书功能不可用：请先在三方链接面板配置飞书 App ID 和 App Secret' }
        }
        const text = (args.text || '').trim()
        if (!text) return { success: false, message: '缺少参数 text（消息内容）' }

        // 确定目标群聊：chatId > chatName 匹配 > 默认推送群聊 > 第一个群聊
        let chatId = (args.chatId || '').trim()
        let chatName = ''
        if (!chatId && args.chatName) {
          const want = String(args.chatName).trim()
          const chats = await feishu.listChats()
          const list = chats.items || chats.chats || []
          const hit = list.find(c => c.name === want) || list.find(c => (c.name || '').includes(want))
          if (!hit) {
            return { success: false, message: `未找到名为"${want}"的飞书群聊。可用群聊：${list.map(c => c.name).join('、') || '（无）'}` }
          }
          chatId = hit.chat_id
          chatName = hit.name
        }
        if (!chatId) {
          const config = await feishu.getConfig()
          chatId = config.defaultChatId || ''
          if (!chatId) {
            const chats = await feishu.listChats()
            const list = chats.items || chats.chats || []
            if (list.length === 0) {
              return { success: false, message: '没有可用的飞书群聊：请先将机器人拉入群聊，并在三方链接面板设置默认推送群聊' }
            }
            chatId = list[0].chat_id
            chatName = list[0].name
          }
        }
        await feishu.sendMessage(chatId, 'chat_id', 'text', JSON.stringify({ text }))
        return { success: true, message: `已发送飞书消息${chatName ? `到群「${chatName}」` : ''}` }
      } catch (e) {
        console.error('send_feishu_message error:', e)
        return { success: false, message: `发送飞书消息失败: ${e.message}` }
      }
    }

    case 'send_wechat_message': {
      try {
        const wechat = window.electronAPI?.wechat
        if (!wechat || typeof wechat.sendMessage !== 'function') {
          return { success: false, message: '微信功能不可用：请使用桌面应用（npm run electron:dev）并重启' }
        }
        const config = await wechat.getConfig()
        if (!config.hasToken) {
          return { success: false, message: '微信未登录：请先在三方链接面板扫码登录微信' }
        }
        const text = (args.text || '').trim()
        if (!text) return { success: false, message: '缺少参数 text（消息内容）' }
        const res = await wechat.sendMessage((args.toUserId || '').trim(), text)
        if (res.success) {
          return { success: true, message: '已发送微信消息到默认联系人' }
        }
        return { success: false, message: `发送微信消息失败: ${res.error || '未知错误'}` }
      } catch (e) {
        console.error('send_wechat_message error:', e)
        return { success: false, message: `发送微信消息失败: ${e.message}` }
      }
    }

    case 'send_wechat_image': {
      try {
        const wechat = window.electronAPI?.wechat
        if (!wechat || typeof wechat.sendImage !== 'function') {
          return { success: false, message: '微信发图功能不可用：请重启应用后重试' }
        }
        const config = await wechat.getConfig()
        if (!config.hasToken) {
          return { success: false, message: '微信未登录：请先在三方链接面板扫码登录微信' }
        }
        const filePath = (args.filePath || '').trim()
        if (!filePath) return { success: false, message: '缺少参数 filePath（图片文件路径）' }
        const res = await wechat.sendImage((args.toUserId || '').trim(), filePath)
        if (res.success) {
          return { success: true, message: `已发送图片到微信：${res.fileName || filePath}` }
        }
        return { success: false, message: `发送微信图片失败: ${res.error || '未知错误'}` }
      } catch (e) {
        console.error('send_wechat_image error:', e)
        return { success: false, message: `发送微信图片失败: ${e.message}` }
      }
    }

    case 'send_feishu_image': {
      try {
        const feishu = window.electronAPI?.feishu
        if (!feishu || typeof feishu.sendImage !== 'function') {
          return { success: false, message: '飞书功能不可用：请先在三方链接面板配置飞书 App ID 和 App Secret' }
        }
        const filePath = (args.filePath || '').trim()
        if (!filePath) return { success: false, message: '缺少参数 filePath（图片文件路径）' }

        // 确定目标群聊：chatId > chatName 匹配 > 默认推送群聊 > 第一个群聊（与 send_feishu_message 一致）
        let chatId = (args.chatId || '').trim()
        let chatName = ''
        if (!chatId && args.chatName) {
          const want = String(args.chatName).trim()
          const chats = await feishu.listChats()
          const list = chats.items || chats.chats || []
          const hit = list.find(c => c.name === want) || list.find(c => (c.name || '').includes(want))
          if (!hit) {
            return { success: false, message: `未找到名为"${want}"的飞书群聊。可用群聊：${list.map(c => c.name).join('、') || '（无）'}` }
          }
          chatId = hit.chat_id
          chatName = hit.name
        }
        if (!chatId) {
          const config = await feishu.getConfig()
          chatId = config.defaultChatId || ''
          if (!chatId) {
            const chats = await feishu.listChats()
            const list = chats.items || chats.chats || []
            if (list.length === 0) {
              return { success: false, message: '没有可用的飞书群聊：请先将机器人拉入群聊，并在三方链接面板设置默认推送群聊' }
            }
            chatId = list[0].chat_id
            chatName = list[0].name
          }
        }
        const res = await feishu.sendImage(chatId, filePath)
        if (res.success) {
          return { success: true, message: `已发送图片到飞书${chatName ? `群「${chatName}」` : ''}` }
        }
        return { success: false, message: `发送飞书图片失败: ${res.error || '未知错误'}` }
      } catch (e) {
        console.error('send_feishu_image error:', e)
        return { success: false, message: `发送飞书图片失败: ${e.message}` }
      }
    }

    case 'send_wechat_file': {
      try {
        const wechat = window.electronAPI?.wechat
        if (!wechat || typeof wechat.sendFile !== 'function') {
          return { success: false, message: '微信发文件功能不可用：请重启应用后重试' }
        }
        const config = await wechat.getConfig()
        if (!config.hasToken) {
          return { success: false, message: '微信未登录：请先在三方链接面板扫码登录微信' }
        }
        const filePath = (args.filePath || '').trim()
        if (!filePath) return { success: false, message: '缺少参数 filePath（文件路径）' }
        const res = await wechat.sendFile((args.toUserId || '').trim(), filePath)
        if (res.success) {
          return { success: true, message: `已发送文件到微信：${res.fileName || filePath}` }
        }
        return { success: false, message: `发送微信文件失败: ${res.error || '未知错误'}` }
      } catch (e) {
        console.error('send_wechat_file error:', e)
        return { success: false, message: `发送微信文件失败: ${e.message}` }
      }
    }

    case 'send_feishu_file': {
      try {
        const feishu = window.electronAPI?.feishu
        if (!feishu || typeof feishu.sendFile !== 'function') {
          return { success: false, message: '飞书功能不可用：请先在三方链接面板配置飞书 App ID 和 App Secret' }
        }
        const filePath = (args.filePath || '').trim()
        if (!filePath) return { success: false, message: '缺少参数 filePath（文件路径）' }

        // 确定目标群聊：chatId > chatName 匹配 > 默认推送群聊 > 第一个群聊（与 send_feishu_message 一致）
        let chatId = (args.chatId || '').trim()
        let chatName = ''
        if (!chatId && args.chatName) {
          const want = String(args.chatName).trim()
          const chats = await feishu.listChats()
          const list = chats.items || chats.chats || []
          const hit = list.find(c => c.name === want) || list.find(c => (c.name || '').includes(want))
          if (!hit) {
            return { success: false, message: `未找到名为"${want}"的飞书群聊。可用群聊：${list.map(c => c.name).join('、') || '（无）'}` }
          }
          chatId = hit.chat_id
          chatName = hit.name
        }
        if (!chatId) {
          const config = await feishu.getConfig()
          chatId = config.defaultChatId || ''
          if (!chatId) {
            const chats = await feishu.listChats()
            const list = chats.items || chats.chats || []
            if (list.length === 0) {
              return { success: false, message: '没有可用的飞书群聊：请先将机器人拉入群聊，并在三方链接面板设置默认推送群聊' }
            }
            chatId = list[0].chat_id
            chatName = list[0].name
          }
        }
        const res = await feishu.sendFile(chatId, filePath)
        if (res.success) {
          return { success: true, message: `已发送文件到飞书${chatName ? `群「${chatName}」` : ''}：${filePath.split(/[\\/]/).pop() || filePath}` }
        }
        return { success: false, message: `发送飞书文件失败: ${res.error || '未知错误'}` }
      } catch (e) {
        console.error('send_feishu_file error:', e)
        return { success: false, message: `发送飞书文件失败: ${e.message}` }
      }
    }

    case 'ai_continue_children': {
      try {
        const scope = args.scope === 'root' ? 'root' : 'selected'
        const targetNodes = scope === 'root'
          ? (mindMap?.root ? [mindMap.root] : [])
          : (mindMap?.renderer?.activeNodeList || []).filter(node => node && !node.isGeneralization)
        if (!targetNodes.length) return { success: false, message: '没有可评估的续写目标节点' }

        const assessments = targetNodes.slice(0, 20).map(node => {
          const rawText = node.getData?.('text') || node.data?.text || node.text || ''
          const text = nodePlainText(rawText).trim()
          const children = node.children || []
          const childTexts = children.map(child => nodePlainText(child.data?.text || child.text || '').trim()).filter(Boolean)
          const reasons = []
          if (text.length >= 4) reasons.push('节点主题明确')
          if (children.length === 0) reasons.push('当前为叶节点，缺少子结构')
          if (children.length > 0 && children.length < 4) reasons.push(`已有 ${children.length} 个子节点，仍有扩展空间`)
          if (childTexts.some(value => value.length > 30)) reasons.push('存在过长子节点，可拆分下级')
          if (new Set(childTexts.map(value => value.toLowerCase())).size !== childTexts.length) reasons.push('存在重复子节点，扩展前建议先整理')
          if (text.length > 0 && text.length < 4 && children.length === 0) reasons.push('主题过短，续写可能产生空泛内容')
          const score = Math.max(0, Math.min(100,
            35 + Math.min(30, text.length * 2) + (children.length === 0 ? 20 : Math.max(0, 20 - children.length * 3)) - (childTexts.some(value => value.length > 30) ? 10 : 0)
          ))
          return {
            uid: node.data?.uid || node.uid || '',
            text: text.slice(0, 80),
            childCount: children.length,
            score,
            shouldExpand: score >= 45,
            reasons,
            source: 'current_mindmap_node_context'
          }
        })
        const worthExpanding = assessments.filter(item => item.shouldExpand)
        if (!worthExpanding.length) {
          return {
            success: true,
            expanded: false,
            assessments,
            message: '扩展价值评估：当前目标节点信息不足或已有结构较完整，未执行续写。建议先补充主题描述或先运行 audit_mindmap。'
          }
        }

        if (extraHandlers.aiContinue) {
          const result = await extraHandlers.aiContinue(args)
          let message = result || 'AI续写完成'
          if (/取消/.test(message)) {
            message += '【用户已主动取消续写：不要再调用 ai_continue_children 或其他续写工具，直接结束本轮任务】'
          } else if (/失败|已停止自动重试|请先回答/.test(message)) {
            message += '【续写未成功：不要自动重试续写工具，向用户说明情况后结束本轮任务】'
          }
          const ok = result && !/失败|没有选中|正在处理|已停止自动重试|请先回答/.test(result)
          return {
            success: !!ok,
            message: message + `\n\n扩展评估：${worthExpanding.length}/${assessments.length} 个目标值得扩展；依据为当前导图节点文本、子节点数量与结构（来源：current_mindmap_node_context）。`,
            expanded: !!ok,
            assessments
          }
        }
        return { success: false, message: 'AI续写功能不可用', assessments }
      } catch (e) {
        return { success: false, message: `AI续写失败: ${e.message}` }
      }
    }

        case 'ai_recite_rewrite': {
      try {
        // targets 指定改写范围：先激活目标节点，再走背诵改写流程（避免先 select_node）
        if (args.targets && (args.targets.uids || args.targets.keyword || args.targets.mode)) {
          const { nodes, error } = resolveTargetNodes(mindMap, args.targets)
          if (error) return { success: false, message: `目标节点解析失败：${error}` }
          const targetNodes = nodes.filter(n => !n.isGeneralization)
          if (!targetNodes.length) return { success: false, message: '命中的节点均不可操作' }
          setActiveNodes(mindMap, targetNodes)
        }
        if (extraHandlers.aiRewrite) {
          // instruction：用户对改写的修改意见（反馈后重写场景），透传给改写流程作为最高优先级要求
          const result = await extraHandlers.aiRewrite(args.instruction)
          const ok = result && !/失败|没有选中|正在处理/.test(result)
          return { success: !!ok, message: result || 'AI背诵改写完成' }
        }
        return { success: false, message: 'AI背诵改写功能不可用' }
      } catch (e) {
        return { success: false, message: `AI背诵改写失败: ${e.message}` }
      }
    }

    case 'ai_cloze': {
      try {
        // targets 直接指定目标节点（批量一步到位，无需先 select_node）
        if (args.targets && (args.targets.uids || args.targets.keyword || args.targets.mode)) {
          const { nodes, error } = resolveTargetNodes(mindMap, args.targets)
          if (error) return { success: false, message: `目标节点解析失败：${error}` }
          const targetNodes = nodes.filter(n => !n.isGeneralization)
          if (!targetNodes.length) return { success: false, message: '命中的节点均不可操作' }
          setActiveNodes(mindMap, targetNodes)
        }
        if (extraHandlers.aiCloze) {
          const result = await extraHandlers.aiCloze()
          const ok = result && !/失败|没有选中|正在处理/.test(result)
          return { success: !!ok, message: result || 'AI挖空完成' }
        }
        return { success: false, message: 'AI挖空功能不可用' }
      } catch (e) {
        return { success: false, message: `AI挖空失败: ${e.message}` }
      }
    }

    case 'ai_cloze_full_map': {
      try {
        if (extraHandlers.aiClozeFullMap) {
          const result = await extraHandlers.aiClozeFullMap()
          const ok = result && !/失败|没有选中|正在处理/.test(result)
          return { success: !!ok, message: result || 'AI全文挖空完成' }
        }
        return { success: false, message: 'AI全文挖空功能不可用' }
      } catch (e) {
        return { success: false, message: `AI全文挖空失败: ${e.message}` }
      }
    }

    case 'mechanical_cloze': {
      try {
        if (!mindMap) return { success: false, message: '当前没有打开的思维导图。请先调用 find_local_file(exts=["smm"]) 搜索本地导图文件（自动覆盖桌面/文档/下载/默认保存目录），再用 read_mindmap_file(filePath=...) 直接读取文件内容后继续。' }
        const exactText = String(args.text || '').trim()
        const regexText = String(args.regex || '').trim()
        if (!exactText && !regexText) return { success: false, message: '请提供 text（精确文本）或 regex（正则）至少一项' }

        let targetNodes
        if (args.targets && (args.targets.uids || args.targets.keyword || args.targets.mode)) {
          const { nodes, error } = resolveTargetNodes(mindMap, args.targets)
          if (error) return { success: false, message: `目标节点解析失败：${error}` }
          targetNodes = nodes.filter(n => !n.isGeneralization)
        } else {
          targetNodes = (mindMap.renderer.activeNodeList || []).filter(n => !n.isGeneralization)
        }
        if (!targetNodes.length) return { success: false, message: '没有可挖空的目标节点，请指定 targets 或先选中节点' }

        const flags = String(args.flags || 'gi')
        const buildMatcher = () => regexText
          ? new RegExp(regexText, flags)
          : null

        const wrapHtmlText = (html) => {
          if (!html || typeof html !== 'string') return html
          const container = document.createElement('div')
          container.innerHTML = html
          const applyTextNode = (node) => {
            const val = node.nodeValue || ''
            if (!val) return
            const ranges = []
            if (regexText) {
              const re = buildMatcher()
              let m
              while ((m = re.exec(val)) !== null) {
                if (m[0] === '') { re.lastIndex++; continue }
                ranges.push([m.index, m.index + m[0].length])
                if (m.index === re.lastIndex) re.lastIndex++
              }
            } else if (exactText) {
              let idx = val.indexOf(exactText)
              while (idx !== -1) {
                ranges.push([idx, idx + exactText.length])
                idx = val.indexOf(exactText, idx + exactText.length)
              }
            }
            if (!ranges.length) return
            const frag = document.createDocumentFragment()
            let last = 0
            for (const [start, end] of ranges) {
              if (start > last) frag.appendChild(document.createTextNode(val.slice(last, start)))
              const span = document.createElement('span')
              span.className = 'smm-cloze smm-cloze-hidden'
              span.textContent = val.slice(start, end)
              frag.appendChild(span)
              last = end
            }
            if (last < val.length) frag.appendChild(document.createTextNode(val.slice(last)))
            node.parentNode.replaceChild(frag, node)
          }
          const walk = (el) => {
            for (const child of Array.from(el.childNodes)) {
              if (child.nodeType === Node.TEXT_NODE) applyTextNode(child)
              else if (child.nodeType === Node.ELEMENT_NODE) walk(child)
            }
          }
          walk(container)
          return container.innerHTML
        }

        const changedNodes = []
        let occurrences = 0
        for (const node of targetNodes) {
          const original = node.getData?.('text') || ''
          const next = wrapHtmlText(original)
          if (!next || next === original) continue
          const count = (next.match(/smm-cloze/g) || []).length - (original.match(/smm-cloze/g) || []).length
          occurrences += Math.max(0, count)
          if (typeof node.setText === 'function') node.setText(next, true)
          else node.setData({ text: next, richText: true })
          changedNodes.push(node)
        }
        if (!changedNodes.length) return { success: false, message: '目标节点中没有匹配到指定内容' }
        mindMap.render()
        try {
          setNodesClozeHidden(changedNodes, true)
          applyClozeStyles()
        } catch (e) {}
        return {
          success: true,
          message: `已机械挖空 ${occurrences} 处内容，涉及 ${changedNodes.length} 个节点（无需 AI 分析）。可通过 Ctrl+Z 撤销。`,
          changedNodes: changedNodes.length,
          occurrences,
          uids: changedNodes.map(n => n.getData?.('uid') || n.uid)
        }
      } catch (e) {
        return { success: false, message: `机械挖空失败: ${e.message}` }
      }
    }

    case 'parallel_ai_workers': {
      try {
        const tasks = Array.isArray(args.tasks) ? args.tasks.filter(t => t && t.instruction && t.context) : []
        if (!tasks.length) return { success: false, message: '请提供 tasks 数组，每项至少包含 id、instruction、context' }
        const concurrency = Math.min(Math.max(Number(args.concurrency) || 3, 1), 5)
        const maxRetries = Math.min(Math.max(Number(args.retry) || 2, 0), 3)
        const runOne = async (task) => {
          let lastError = '未知错误'
          for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
              const isJson = task.response_format === 'json'
              const systemPrompt = isJson
                ? '你是一个并行工作子 Agent。只输出一个合法的 JSON 对象，不要输出代码块、解释或多余文字。'
                : '你是一个并行工作子 Agent。请直接输出结果，不要输出多余解释。'
              const user = `${task.instruction}\n\n【任务上下文】\n${task.context}`
              const choice = await aiService.chat(
                user,
                systemPrompt,
                null,
                isJson ? { responseFormat: 'json' } : undefined
              )
              const content = String(choice?.message?.content || '').trim()
              if (content) {
                return { id: task.id, status: 'success', content, attempts: attempt + 1 }
              }
              lastError = '子 Agent 返回空内容'
            } catch (e) {
              lastError = e.message || String(e)
            }
            if (attempt < maxRetries) {
              await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)))
            }
          }
          return { id: task.id, status: 'error', error: lastError, attempts: maxRetries + 1 }
        }

        const workers = []
        let idx = 0
        while (idx < tasks.length) {
          const chunk = tasks.slice(idx, idx + concurrency)
          const chunkResults = await Promise.all(chunk.map(runOne))
          workers.push(...chunkResults)
          idx += chunk.length
        }
        const okCount = workers.filter(w => w.status === 'success').length
        return {
          success: okCount > 0,
          message: `已并行执行 ${tasks.length} 个子任务，成功 ${okCount} 个。请基于下面 workers 的结果进行汇总，并用普通导图工具应用最终修改。`,
          workers
        }
      } catch (e) {
        return { success: false, message: `并行子 Agent 执行失败: ${e.message}` }
      }
    }

    case 'add_to_review': {
      try {
        if (!mindMap?.renderer) return { success: false, message: '请先打开一个思维导图文件，再使用添加复习功能' }
        // targets 直达批量加入复习（避免先 select_node 循环）
        let targetNodes
        if (args.targets && (args.targets.uids || args.targets.keyword || args.targets.mode)) {
          const { nodes, error } = resolveTargetNodes(mindMap, args.targets)
          if (error) return { success: false, message: `目标节点解析失败：${error}` }
          targetNodes = nodes.filter(n => !n.isGeneralization)
        } else {
          targetNodes = (mindMap.renderer.activeNodeList || []).filter(n => !n.isGeneralization)
        }
        if (!targetNodes.length) {
          return { success: false, message: '没有目标节点。请通过 targets（uids/keyword/mode）一次指定全部目标，或先选中节点' }
        }
        if (!extraHandlers.addToReview) {
          return { success: false, message: '复习计划功能不可用' }
        }
        // 多节点：一次性全部添加（已在计划中的跳过并说明）
        let added = 0
        let dup = 0
        let failed = 0
        for (const node of targetNodes) {
          const uid = node.data?.uid || node.uid
          if (!uid) { failed++; continue }
          if (isInReviewPlan(uid)) { dup++; continue }
          // handler 返回布尔：false 说明节点查不到或写入失败，不得假报成功
          const ok = extraHandlers.addToReview(uid)
          if (ok === false) { failed++; continue }
          added++
        }
        const parts = []
        if (added > 0) parts.push(`已添加 ${added} 个节点到复习计划`)
        if (dup > 0) parts.push(`${dup} 个节点已在计划中，未重复添加`)
        if (failed > 0) parts.push(`${failed} 个节点添加失败`)
        return { success: added > 0 || dup > 0, message: parts.join('；') || '添加失败' }
      } catch (e) {
        return { success: false, message: `添加复习失败: ${e.message}` }
      }
    }

    case 'get_review_schedule': {
      try {
        const dateRe = /^\d{4}-\d{2}-\d{2}$/
        // 查询窗口：start_date/end_date 范围优先，其次 date 单日，默认今天
        let startDate = String(args.start_date || '').trim()
        let endDate = String(args.end_date || '').trim()
        if (startDate) {
          if (!dateRe.test(startDate)) return { success: false, message: 'start_date 格式应为 YYYY-MM-DD' }
          if (endDate && !dateRe.test(endDate)) return { success: false, message: 'end_date 格式应为 YYYY-MM-DD' }
          if (!endDate) endDate = startDate
          if (endDate < startDate) [startDate, endDate] = [endDate, startDate]
        } else {
          const dateStr = String(args.date || getToday()).trim()
          if (!dateRe.test(dateStr)) return { success: false, message: 'date 格式应为 YYYY-MM-DD' }
          startDate = endDate = dateStr
        }

        // 周期筛选：1/3/7/15/31（天）→ 对应 CYCLES 条目
        let cycleLabel = ''
        if (args.cycle !== undefined && args.cycle !== null && args.cycle !== '') {
          cycleLabel = String(args.cycle).replace(/天$/, '').trim() + '天'
          if (!CYCLES.some(c => c.label === cycleLabel)) {
            return { success: false, message: `cycle 仅支持 ${CYCLES.map(c => c.label).join('/')}（单位天）` }
          }
        }

        const all = getReviewPlan()

        // 窗口内到期任务（可再按周期过滤），按日期分组
        const byDate = new Map()
        let matched = 0
        let matchedDone = 0
        for (const it of all) {
          for (const c of it.cycles || []) {
            if (!c.reviewDate || c.reviewDate < startDate || c.reviewDate > endDate) continue
            if (cycleLabel && c.label !== cycleLabel) continue
            matched++
            if (c.completed) matchedDone++
            if (!byDate.has(c.reviewDate)) byDate.set(c.reviewDate, [])
            byDate.get(c.reviewDate).push({ it, c })
          }
        }

        const dateBlocks = Array.from(byDate.keys()).sort().map(d => {
          const rows = byDate.get(d)
          const doneN = rows.filter(r => r.c.completed).length
          const lines = rows.map((r, i) =>
            `${i + 1}. [${r.c.label}] ${(r.it.nodeText || '(节点已删除，文本缺失)').slice(0, 40)} ${r.c.completed ? '✅已完成' : '⬜待复习'}`
          )
          return `【${d}】${doneN}/${rows.length} 完成\n${lines.join('\n')}`
        })

        // 逾期落后项：复习日期早于窗口起点且未完成（遵循同一周期筛选）
        const overdue = []
        for (const it of all) {
          for (const c of it.cycles || []) {
            if (!c.completed && c.reviewDate && c.reviewDate < startDate) {
              if (cycleLabel && c.label !== cycleLabel) continue
              overdue.push(`[${c.label}] ${(it.nodeText || '(文本缺失)').slice(0, 30)}（原定 ${c.reviewDate}）`)
            }
          }
        }

        // 全部计划的周期分布
        const dist = CYCLES.map(cy => {
          const total = (all || []).filter(it => (it.cycles || []).some(c => c.cycle === cy.cycle)).length
          const done = (all || []).filter(it => (it.cycles || []).some(c => c.cycle === cy.cycle && c.completed)).length
          return `${cy.label}周期：${done}/${total} 完成`
        }).join('；')

        // 结构化数据，方便程序化调用（如同步到日历）
        const items = []
        for (const [date, rows] of byDate.entries()) {
          for (const r of rows) {
            items.push({
              id: r.it.id,
              title: r.it.nodeText || '(节点已删除，文本缺失)',
              date: r.c.reviewDate,
              cycle: r.c.cycle,
              cycleLabel: r.c.label,
              completed: !!r.c.completed,
              isOverdue: false,
              sourceFile: r.it.filePath || ''
            })
          }
        }
        // 逾期项也加入 items
        const overdueItems = []
        for (const it of all) {
          for (const c of it.cycles || []) {
            if (!c.completed && c.reviewDate && c.reviewDate < startDate) {
              if (cycleLabel && c.label !== cycleLabel) continue
              overdueItems.push({
                id: it.id,
                title: it.nodeText || '(文本缺失)',
                date: c.reviewDate,
                cycle: c.cycle,
                cycleLabel: c.label,
                completed: false,
                isOverdue: true,
                sourceFile: it.filePath || ''
              })
            }
          }
        }

        const rangeLabel = startDate === endDate ? startDate : `${startDate} ~ ${endDate}`
        const cycleSuffix = cycleLabel ? `，${cycleLabel}周期` : ''
        const parts = [
          `【${rangeLabel} 复习安排${cycleSuffix}】共 ${matched} 项，已完成 ${matchedDone} 项` +
            (matched > 0 ? `\n${dateBlocks.join('\n\n')}` : '（该范围内没有到期的复习项）'),
          dist ? `各周期总进度：${dist}` : '',
          overdue.length > 0 ? `⚠️ 逾期未复习 ${overdue.length} 项：\n${overdue.slice(0, 15).join('\n')}${overdue.length > 15 ? `\n...等共 ${overdue.length} 项` : ''}` : ''
        ].filter(Boolean)

        return {
          success: true,
          message: parts.join('\n\n'),
          itemCount: matched,
          overdueCount: overdue.length,
          items,
          overdueItems
        }
      } catch (e) {
        return { success: false, message: `查询复习计划失败: ${e.message}` }
      }
    }

    case 'get_today_review_status': {
      try {
        const today = getToday()
        const all = getReviewPlan()

        // 今日到期任务
        const todayRows = []
        for (const it of all) {
          for (const c of it.cycles || []) {
            if (c.reviewDate === today) todayRows.push({ it, c })
          }
        }
        const doneCount = todayRows.filter(r => r.c.completed).length
        const pct = todayRows.length > 0 ? Math.round((doneCount / todayRows.length) * 100) : 0

        // 逾期落后项（今日之前到期未完成）
        const overdue = []
        const overdueItems = []
        for (const it of all) {
          for (const c of it.cycles || []) {
            if (!c.completed && c.reviewDate && c.reviewDate < today) {
              overdue.push(`[${c.label}] ${(it.nodeText || '(文本缺失)').slice(0, 30)}（原定 ${c.reviewDate}）`)
              overdueItems.push({
                id: it.id,
                title: it.nodeText || '(文本缺失)',
                date: c.reviewDate,
                cycle: c.cycle,
                cycleLabel: c.label,
                completed: false,
                isOverdue: true,
                sourceFile: it.filePath || ''
              })
            }
          }
        }

        const listLines = todayRows.map((r, i) =>
          `${i + 1}. [${r.c.label}] ${(r.it.nodeText || '(节点已删除，文本缺失)').slice(0, 40)} ${r.c.completed ? '✅已完成' : '⬜待复习'}（id:${r.it.id} 周期:${r.c.cycle}）`
        )
        const parts = [
          `【今日（${today}）复习完成状态】`,
          `完成进度：${doneCount}/${todayRows.length}${todayRows.length > 0 ? `（${pct}%）` : ''}` +
            (todayRows.length > 0 ? `\n${listLines.join('\n')}` : '\n（今天没有到期的复习项）'),
          overdue.length > 0 ? `⚠️ 逾期未复习 ${overdue.length} 项：\n${overdue.slice(0, 15).join('\n')}${overdue.length > 15 ? `\n...等共 ${overdue.length} 项` : ''}` : ''
        ].filter(Boolean)

        // 可选：导出今日复习计划为 Markdown 文件
        let exportMsg = ''
        if (args.export) {
          if (!window.electronAPI?.saveFile) {
            exportMsg = '\n\n（导出失败：文件保存接口不可用，需在应用内运行）'
          } else {
            const mdLines = [
              `# 今日复习计划（${today}）`,
              '',
              '## 完成进度',
              `- 已完成：${doneCount} / ${todayRows.length}${todayRows.length > 0 ? `（${pct}%）` : ''}`,
              ''
            ]
            if (todayRows.length > 0) {
              mdLines.push('## 复习清单', '', '| # | 周期 | 节点内容 | 状态 |', '|---|------|---------|------|')
              todayRows.forEach((r, i) => {
                const text = String(r.it.nodeText || '(节点已删除，文本缺失)').replace(/\|/g, '\\|')
                mdLines.push(`| ${i + 1} | ${r.c.label} | ${text} | ${r.c.completed ? '✅ 已完成' : '⬜ 待复习'} |`)
              })
              mdLines.push('')
            }
            if (overdue.length > 0) {
              mdLines.push('## 逾期未复习', '')
              overdue.forEach(o => mdLines.push(`- ${o}`))
              mdLines.push('')
            }
            const safeName = String(args.file_name || `今日复习计划_${today}`).slice(0, 60).replace(/[\\/:*?"<>|]/g, '_').trim() || `今日复习计划_${today}`
            const result = await window.electronAPI.saveFile(`${safeName}.md`, mdLines.join('\n'), { overwrite: true })
            exportMsg = result?.success
              ? `\n\n已导出今日复习计划：${result.filePath}`
              : `\n\n导出失败：${result?.error || '未知错误'}`
          }
        }

        return {
          success: true,
          message: parts.join('\n\n') + exportMsg,
          itemCount: todayRows.length,
          completedCount: doneCount,
          overdueCount: overdue.length,
          items: todayRows.map(r => ({
            id: r.it.id,
            title: r.it.nodeText || '(节点已删除，文本缺失)',
            date: today,
            cycle: r.c.cycle,
            cycleLabel: r.c.label,
            completed: !!r.c.completed,
            isOverdue: false,
            sourceFile: r.it.filePath || ''
          })),
          overdueItems
        }
      } catch (e) {
        return { success: false, message: `获取今日复习状态失败: ${e.message}` }
      }
    }

    case 'complete_review_task': {
      try {
        const today = getToday()
        const dateArg = String(args.date || '').trim()
        const targetDate = /^\d{4}-\d{2}-\d{2}$/.test(dateArg) ? dateArg : today
        const dateLabel = targetDate === today ? '今日' : targetDate
        const remembered = args.result !== 'forgot'
        const allToday = args.all_today === true
        const cycleArg = args.cycle !== undefined ? Number(args.cycle) : null
        const itemId = String(args.item_id || args.itemId || '').trim()

        // 定位目标：all_today → 指定日期全部待复习项；否则按 item_id（须存在且该日有到期周期）
        const all = getReviewPlan()
        const targets = [] // { item, cycleNums: [] }
        if (allToday) {
          for (const it of all) {
            const due = (it.cycles || []).filter(c => c.reviewDate === targetDate && !c.completed)
            if (due.length > 0) targets.push({ item: it, cycleNums: due.map(c => c.cycle) })
          }
          if (targets.length === 0) {
            return { success: true, message: `${dateLabel}没有待复习项，无需打卡。（已完成或该日无到期项）` }
          }
        } else {
          if (!itemId) {
            return { success: false, message: '请提供 item_id（get_today_review_status 清单中每项的 id），或用 all_today=true 全部打卡' }
          }
          const it = all.find(i => i.id === itemId)
          if (!it) return { success: false, message: `未找到复习项 ${itemId}，请以 get_today_review_status 返回的最新 id 为准` }
          let dueNums = (it.cycles || []).filter(c => c.reviewDate === targetDate).map(c => c.cycle)
          if (cycleArg !== null) {
            if (!CYCLES.some(c => c.cycle === cycleArg)) {
              return { success: false, message: `周期只能是 ${CYCLES.map(c => c.cycle).join('/')} 天` }
            }
            const cycleInfo = (it.cycles || []).find(c => c.cycle === cycleArg)
            if (!cycleInfo) return { success: false, message: `该复习项没有 ${cycleArg} 天周期` }
            if (cycleInfo.reviewDate !== targetDate) {
              return { success: false, message: `周期 ${cycleArg} 天不在${dateLabel}到期（${cycleInfo.reviewDate}），可用 date 参数指定对应日期打卡` }
            }
            dueNums = [cycleArg]
          }
          if (dueNums.length === 0) {
            return { success: false, message: `该复习项${dateLabel}没有到期周期，不能打卡。可用 get_review_schedule 查询其到期日，或用 date 参数指定到期日期。` }
          }
          targets.push({ item: it, cycleNums: dueNums })
        }

        let done = 0
        const names = []
        for (const t of targets) {
          for (const num of t.cycleNums) {
            if (remembered) markCycleCompleted(t.item.id, num)
            else markCycleUncompleted(t.item.id, num)
            done++
          }
          if (names.length < 10) names.push(`${(t.item.nodeText || '').slice(0, 25)}（${t.cycleNums.join('/')}天）`)
        }

        // 打卡后的最新进度
        const after = getReviewPlan()
        let total = 0, completed = 0
        for (const it of after) {
          for (const c of it.cycles || []) {
            if (c.reviewDate === targetDate) { total++; if (c.completed) completed++ }
          }
        }
        const actionLabel = remembered ? '✅ 已记住' : '↩️ 标记为未记住（保留在计划中）'
        const scopeLabel = allToday ? `${dateLabel}全部待复习项` : `${names.join('、')}`
        return {
          success: true,
          message: `打卡完成：${scopeLabel} 共 ${done} 个周期 → ${actionLabel}。\n${dateLabel}最新进度：${completed}/${total}${total > 0 ? `（${Math.round(completed / total * 100)}%）` : ''}`,
          markedCount: done,
          todayTotal: total,
          todayCompleted: completed
        }
      } catch (e) {
        return { success: false, message: `复习打卡失败: ${e.message}` }
      }
    }

    case 'delete_review_plan': {
      try {
        const all = args.all === true
        const filePath = (args.filePath || '').trim()
        const nodeUid = (args.nodeUid || '').trim()

        // 三种删除方式互斥，优先级：all > filePath > nodeUid
        let count = 0
        let desc = ''
        if (all) {
          count = clearReviewPlan()
          desc = '全部复习计划'
        } else if (filePath) {
          count = removeByFilePath(filePath)
          const fileName = filePath.split(/[/\\]/).pop()
          desc = `文件"${fileName}"的全部复习任务`
        } else if (nodeUid) {
          count = removeByNodeUid(nodeUid)
          desc = `节点 ${nodeUid} 的复习任务`
        } else {
          return { success: false, message: '请指定删除方式：filePath（按文件）、nodeUid（按节点）或 all=true（全部）' }
        }

        if (count === 0) {
          return { success: true, message: `未找到 ${desc} 对应的复习计划（可能已不存在）`, removedCount: 0 }
        }
        return { success: true, message: `已删除 ${desc}，共移除 ${count} 个复习任务`, removedCount: count }
      } catch (e) {
        return { success: false, message: `删除复习计划失败: ${e.message}` }
      }
    }

    case 'toggle_cloze_visibility': {
      try {
        if (!mindMap) return { success: false, message: '当前没有打开的思维导图。请先调用 find_local_file(exts=["smm"]) 搜索本地导图文件（自动覆盖桌面/文档/下载/默认保存目录），再用 read_mindmap_file(filePath=...) 直接读取文件内容后继续。' }
        const wantShow = args.show === undefined ? null : !!args.show

        if (args.targets && (args.targets.uids || args.targets.keyword || args.targets.mode)) {
          const { nodes, error } = resolveTargetNodes(mindMap, args.targets)
          if (error) return { success: false, message: `目标节点解析失败：${error}` }
          const clozeNodes = nodes.filter(n => !n.isGeneralization && nodeHasCloze(n))
          if (!clozeNodes.length) return { success: false, message: '目标节点中没有挖空标记' }
          if (wantShow === null) {
            for (const n of clozeNodes) toggleClozeByUid(n.getData?.('uid') || n.uid)
            return { success: true, message: `已翻转 ${clozeNodes.length} 个节点的挖空显隐` }
          }
          setNodesClozeHidden(clozeNodes, !wantShow)
          return { success: true, message: `已${wantShow ? '显示' : '隐藏'} ${clozeNodes.length} 个节点的挖空答案` }
        }

        // 全图
        if (wantShow === null) {
          toggleAllCloze()
        } else {
          setAllClozeHidden(!wantShow)
        }
        const hidden = isClozeHiddenAll()
        return { success: true, message: hidden ? '已隐藏全部挖空答案（自测模式）' : '已显示全部挖空答案' }
      } catch (e) {
        return { success: false, message: `切换挖空显隐失败: ${e.message}` }
      }
    }

    case 'list_cloze_nodes': {
      try {
        if (!mindMap) return { success: false, message: '当前没有打开的思维导图。请先调用 find_local_file(exts=["smm"]) 搜索本地导图文件（自动覆盖桌面/文档/下载/默认保存目录），再用 read_mindmap_file(filePath=...) 直接读取文件内容后继续。' }
        const found = []
        const nodes = []
        const walk = (node) => {
          if (!node || node.isGeneralization) return
          if (nodeHasCloze(node)) {
            const uid = node.getData?.('uid') || node.uid
            const plain = nodePlainText(node.getData?.('text') || '')
            const hidden = isUidClozeHidden(uid)
            // 提取挖空词
            const audit = analyzeNodeTextStyles(node.getData?.('text') || '')
            const clozeWords = audit?.cloze || []
            found.push(`${hidden ? '隐藏' : '显示'} | ${plain.slice(0, 60)} | 挖空词: ${clozeWords.join('、') || '（解析失败）'} | uid=${uid}`)
            nodes.push({ uid, text: plain.slice(0, 60), hidden, clozeWords })
          }
          (node.children || []).forEach(walk)
        }
        walk(mindMap.renderer.root)
        if (!found.length) return { success: true, message: '当前导图没有任何挖空标记', nodes }
        return { success: true, message: `共 ${found.length} 个节点含挖空：\n${found.join('\n')}`, nodes, count: nodes.length }
      } catch (e) {
        return { success: false, message: `列出挖空节点失败: ${e.message}` }
      }
    }

    case 'clear_cloze': {
      try {
        if (!mindMap) return { success: false, message: '当前没有打开的思维导图。请先调用 find_local_file(exts=["smm"]) 搜索本地导图文件（自动覆盖桌面/文档/下载/默认保存目录），再用 read_mindmap_file(filePath=...) 直接读取文件内容后继续。' }
        const { nodes, error } = resolveTargetNodes(mindMap, args.targets || {})
        if (error) return { success: false, message: `目标节点解析失败：${error}` }
        const delimiter = args.before || args.after || ''
        const side = args.before ? 'before' : (args.after ? 'after' : '')
        let cleared = 0
        for (const n of nodes) {
          if (n.isGeneralization) continue
          const text = n.getData?.('text') || ''
          if (!text.includes('smm-cloze')) continue
          try {
            if (delimiter && side) {
              if (clearNodeClozePartial(n, delimiter, side)) cleared++
            } else {
              clearNodeCloze(n)
              cleared++
            }
          } catch (err) {
            console.warn('[clear_cloze] 单节点清除失败:', err)
          }
        }
        if (cleared > 0) {
          mindMap.render()
          applyClozeStyles()
        }
        const scopeDesc = delimiter ? `（仅${side === 'before' ? '清除' + delimiter + '前' : '清除' + delimiter + '后的'}挖空）` : ''
        return cleared > 0
          ? { success: true, message: `已清除 ${cleared} 个节点的挖空标记${scopeDesc}（支持 Ctrl+Z 撤销）` }
          : { success: false, message: '目标节点中没有匹配的挖空标记，无需清除' }
      } catch (e) {
        return { success: false, message: `清除挖空失败: ${e.message}` }
      }
    }

    case 'ai_quiz': {
      try {
        if (!mindMap) return { success: false, message: '当前没有打开的思维导图。请先调用 find_local_file(exts=["smm"]) 搜索本地导图文件（自动覆盖桌面/文档/下载/默认保存目录），再用 read_mindmap_file(filePath=...) 直接读取文件内容后继续。' }
        // 出题范围：targets > 选中节点 > 整图
        let scopeNodes = []
        let topicName = ''
        let contentText = ''
        if (args.targets && (args.targets.uids || args.targets.keyword || args.targets.mode)) {
          const { nodes, error } = resolveTargetNodes(mindMap, args.targets)
          if (error) return { success: false, message: `目标节点解析失败：${error}` }
          scopeNodes = nodes.filter(n => !n.isGeneralization)
        } else {
          const active = mindMap.renderer.activeNodeList || []
          scopeNodes = active.filter(n => !n.isGeneralization)
        }
        if (scopeNodes.length > 0) {
          // renderer 的 Node 实例数据在 nodeData 上（无 .data 属性），须先 getPureData() 转纯数据再转文本
          contentText = scopeNodes.slice(0, 5).map(n => {
            try {
              return treeToText(typeof n.getPureData === 'function' ? n.getPureData() : n)
            } catch (e) {
              return ''
            }
          }).filter(Boolean).join('\n\n')
          topicName = nodePlainText(scopeNodes[0].getData?.('text') || '') || '自测'
        } else {
          const tree = mindMap.getData()
          contentText = treeToText(tree)
          topicName = nodePlainText(tree?.data?.text || '') || '整图自测'
        }
        if (!contentText.trim()) return { success: false, message: '出题范围没有任何文本内容' }

        const count = Math.min(Math.max(parseInt(args.count, 10) || 10, 1), 30)
        const typeNames = { single: '单选题', multiple: '多选题', short_answer: '简答题' }
        const types = Array.isArray(args.types) && args.types.length
          ? args.types.filter(t => typeNames[t]).map(t => typeNames[t])
          : ['单选题', '多选题', '简答题']

        const sys = '你是出题专家。根据用户提供的思维导图内容出自测题，严格基于原文，不引入外部知识，只出核心考点/重点题。只输出 JSON，不要任何其他文字。'
        const usr = `基于以下思维导图内容，出 ${count} 道题（题型混合：${types.join('、')}）。

输出 JSON 格式：
{"title":"主题名","questions":[{"type":"单选题|多选题|简答题","question":"题干","options":["A. xxx","B. xxx","C. xxx","D. xxx"],"answer":"答案（如 B / ACD / 文字答案）","explanation":"简要解析"}]}

要求：题干考察核心考点/得分点/易错点，不要考偏门细节或抠字眼；题干和答案必须能在原文中找到依据；干扰项要合理；简答题 answer 给出原文要点。options 仅选择题需要，简答题为空数组。

思维导图内容：
${contentText.slice(0, 9000)}`

        const choice = await aiService.chat(usr, sys, null, { responseFormat: 'json' })
        const rawResponse = String(choice?.message?.content || '').replace(/```json|```/g, '').trim()
        // ai_quiz 期望 { title, questions } 结构。先尝试完整解析，再容错提取 questions 数组
        let quiz = null
        try { quiz = JSON.parse(rawResponse) } catch (e) {
          // 容错：仅拿到 questions 数组时，title 兜底用 topicName（后续代码处理）
          const arr = parseQuizResponse(rawResponse)
          if (arr.length) quiz = { title: null, questions: arr }
        }
        const questions = Array.isArray(quiz?.questions) ? quiz.questions.filter(q => q && q.question) : []
        if (!quiz || !questions.length) {
          return { success: false, message: 'AI 出题返回内容无法解析（可能被截断）：\n预览：' + rawResponse.slice(0, 250) }
        }

        // 组装自测导图：根=主题；每题一级子节点；选项、答案+解析（合并一个节点，内容挖空隐藏）为二级
        const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        const mk = (text) => ({ data: { text: `<p><span>${esc(text)}</span></p>` }, children: [] })
        const root = mk(`${quiz.title || topicName}【AI出题】（共${questions.length}题）`)
        questions.forEach((q, i) => {
          const qNode = mk(`Q${i + 1}.（${q.type || '单选题'}）${q.question}`)
          for (const opt of q.options || []) qNode.children.push(mk(opt))
          // 答案与解析合并为同一个子节点（各占一行），内容部分分别挖空隐藏
          const lines = []
          const ansText = q.answer != null ? String(q.answer).trim() : ''
          const expText = q.explanation != null ? String(q.explanation).trim() : ''
          if (ansText) lines.push(`<span>✅ 答案：<span class="smm-cloze smm-cloze-hidden">${esc(ansText)}</span></span>`)
          if (expText) lines.push(`<span>💡 解析：<span class="smm-cloze smm-cloze-hidden">${esc(expText)}</span></span>`)
          if (lines.length) qNode.children.push({ data: { text: `<p>${lines.join('<br>')}</p>` }, children: [] })
          root.children.push(qNode)
        })
        ensureRichText(root)
        // 收集含挖空 span 的节点 uid，显式写入隐藏覆盖值（localStorage 按 uid 持久化）：
        // 用户之后打开该文件时，即使全局挖空开关处于"显示答案"状态，答案/解析也默认隐藏
        const clozeUidList = []
        const walkCollect = (n) => {
          if (typeof n?.data?.text === 'string' && n.data.text.includes('smm-cloze') && n.data.uid) {
            clozeUidList.push({ uid: n.data.uid })
          }
          ;(n?.children || []).forEach(walkCollect)
        }
        walkCollect(root)
        // 双保险：① 按 uid 写入"隐藏"覆盖值（打开文件后 per-node 生效）
        // ② 全局挖空开关强制回"隐藏"——用户历史全局开关若停留在"显示"位，
        //    覆盖值未命中时新文件的答案/解析会明文展示
        try { if (clozeUidList.length) setNodesClozeHidden(clozeUidList, true) } catch (e) {}
        try { setGlobalClozeHidden(true) } catch (e) {}

        const safeTopic = (quiz.title || topicName).replace(/[<>:"/\\|?*【】]/g, '').slice(0, 40).trim() || '自测'
        const fileName = `${safeTopic}【AI出题】.smm`
        // 保存到原导图所在文件夹（无当前文件路径时回退默认保存目录）
        let targetPath = fileName
        try {
          const store = useMindMapStore()
          if (store.currentFilePath) targetPath = store.currentFilePath.replace(/[\\/][^\\/]+$/, '') + '/' + fileName
        } catch (e) {}
        const saveData = JSON.stringify(root, null, 2)
        if (!window.electronAPI?.saveFile) return { success: false, message: '文件保存功能不可用' }
        const result = await window.electronAPI.saveFile(targetPath, saveData)
        if (!result || !result.success) return { success: false, message: `保存失败：${result?.error || '未知错误'}` }

        const typeCount = {}
        questions.forEach(q => { typeCount[q.type || '单选题'] = (typeCount[q.type || '单选题'] || 0) + 1 })
        return {
          success: true,
          message: `已生成自测导图「${fileName}」并保存到原导图所在文件夹（${result.filePath}）。共 ${questions.length} 题：${Object.entries(typeCount).map(([t, c]) => `${t} ${c} 道`).join('、')}。答案与解析已合并为一个子节点并自动挖空隐藏（默认不可见，点击挖空处可查看），无需再调用挖空工具。可在左侧文件目录中打开查看，不影响当前导图。`,
          filePath: result.filePath,
          fileName,
          // 生成的是独立文件，画布内容未切换：调用方不得把"当前文件"指向它
          externalFile: true
        }
      } catch (e) {
        return { success: false, message: `AI 出题失败: ${e.message}` }
      }
    }

    case 'ai_quiz_append': {
      try {
        if (!mindMap) return { success: false, message: '当前没有打开的思维导图。请先调用 find_local_file(exts=["smm"]) 搜索本地导图文件（自动覆盖桌面/文档/下载/默认保存目录），再用 read_mindmap_file(filePath=...) 直接读取文件内容后继续。' }
        // 目标节点：targets > 当前选中节点
        let targetNodes = []
        if (args.targets && (args.targets.uids || args.targets.keyword || args.targets.mode)) {
          const { nodes, error } = resolveTargetNodes(mindMap, args.targets)
          if (error) return { success: false, message: `目标节点解析失败：${error}` }
          targetNodes = nodes.filter(n => !n.isGeneralization)
        } else {
          targetNodes = (mindMap.renderer.activeNodeList || []).filter(n => !n.isGeneralization)
        }
        if (!targetNodes.length) return { success: false, message: '没有可出题的目标节点，请先选中要出题的节点' }
        // 防止一次性出题节点过多导致提示词过大、AI 输出超限，单次最多 40 个
        let truncated = false
        if (targetNodes.length > 40) {
          targetNodes = targetNodes.slice(0, 40)
          truncated = true
        }

        // 题型：默认填空 + 选择（优先填空）
        const typeNames = { fill_blank: '填空题', choice: '选择题' }
        const types = Array.isArray(args.types) && args.types.length
          ? args.types.filter(t => typeNames[t]).map(t => typeNames[t])
          : ['填空题', '选择题']

        // 收集每个节点内容（含整个子树作为出题上下文：非叶子节点基于「父节点 + 全部后代」整体出题）
        const nodeInfos = targetNodes.map((n, i) => {
          const text = nodePlainText(n.getData?.('text') || '').slice(0, 300)
          const collectSubtree = (node, out = []) => {
            for (const c of (node.children || [])) {
              if (c.isGeneralization) continue
              const t = nodePlainText(c.getData?.('text') || '')
              if (t) out.push(t)
              collectSubtree(c, out)
            }
            return out
          }
          const children = collectSubtree(n).slice(0, 40)
          return { index: i + 1, text, children }
        }).filter(info => info.text)
        if (!nodeInfos.length) return { success: false, message: '目标节点都没有文本内容' }
        // 记录目标节点 uid：AI 调用耗时较长，期间画布可能重渲染导致旧节点引用失效，插入前按 uid 重新取回实时引用
        const targetUids = targetNodes.map(n => n.getData?.('uid') || n.uid)
        // 记录当前文档根节点 uid：AI 等待期间用户可能切换文件，返回后据此识别目标是否已随旧文件整体失效
        const rootUidAtStart = (() => { try { return mindMap.renderer.root?.getData?.('uid') || null } catch (e) { return null } })()

        const sys = '你是出题专家。根据用户提供的知识点，为每个知识点出一道题（填空题或选择题），并给出答案和解析。严格基于原文，不引入外部知识，题干考察该知识点的核心考点/得分点。只输出 JSON 对象，不要任何其他文字。'
        const block = nodeInfos.map(info => {
          const childTxt = info.children.length ? `\n   子节点：${info.children.join('；')}` : ''
          return `${info.index}. ${info.text}${childTxt}`
        }).join('\n\n')
        const usr = `下面有 ${nodeInfos.length} 个知识点（已编号）。请为【每个编号的知识点】各出【1 道题】（共 ${nodeInfos.length} 道，绝不为知识点下的子内容额外出题），题型以 ${types.join('、')} 为主（优先填空题，其次单选题）。

输出 JSON 对象（不要数组、不要 Markdown、不要任何其他文字）：
{"questions":[{"index":1,"type":"填空","question":"题干（空处用____表示）","options":[],"answer":"答案","explanation":"简要解析"}]}

要求：
- questions 数组长度等于 ${nodeInfos.length}，与知识点一一对应、顺序一致
- index 与知识点编号一致
- 填空题 options 为空数组；选择题 options 为 4 个选项，answer 为正确选项字母（如 B）
- 题干考察该知识点的核心考点/得分点/易错点，不要考偏门细节；题干与答案必须能在原文找到依据
- 解析(explanation)≤50 字，宁短勿长；explanation 超长会被服务端截断、整个返回 JSON 解析失败、出题整体报错
- 解析按要点列（如"①发现矛盾 ②分析矛盾"），不要写完整长句
- 不要漏掉任何知识点

知识点：
${block}`

        const choice = await aiService.chat(usr, sys, null, { responseFormat: 'json' })
        const rawResponse = String(choice?.message?.content || '').replace(/```json|```/g, '').trim()
        const list = parseQuizResponse(rawResponse)
        const validQuestions = Array.isArray(list) ? list.filter(q => q && q.question) : []
        if (!validQuestions.length) {
          return {
            success: false,
            message: 'AI 出题返回内容无法解析（可能被 max_tokens 截断）：\n内容预览：' + rawResponse.slice(0, 250) + '\n建议：① 减少单次出题节点数（≤10 个）；② 设置解析(explanation)≤50 字。'
          }
        }

        // 优先按 index 映射，数量一致时按顺序兜底
        const byIndex = new Map()
        for (const q of validQuestions) {
          if (q && q.question && Number.isFinite(Number(q.index))) byIndex.set(Number(q.index), q)
        }

        const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

        // AI 调用期间画布可能重渲染导致旧节点实例失效，插入前按 uid 重新取回实时引用
        // 保留 null 占位以维持与 nodeInfos 的索引对齐：若 filter 掉空位，后续按下标取节点会整体移位、题目挂错节点
        const liveNodes = targetUids.map(uid => { try { return mindMap.renderer.findNodeByUid(uid) } catch (e) { return null } })

        // 文件切换检测：根节点 uid 变化，或全部目标 uid 查不到，说明目标是另一个文件的节点，明确报错而非笼统"请重试"
        const rootUidNow = (() => { try { return mindMap.renderer.root?.getData?.('uid') || null } catch (e) { return null } })()
        if ((rootUidAtStart && rootUidNow && rootUidAtStart !== rootUidNow) || liveNodes.every(n => !n)) {
          return {
            success: false,
            message: '检测到出题期间当前导图已被切换或替换，原目标节点已全部失效，本次未添加任何题目。请在目标导图处于打开状态时重新执行出题。'
          }
        }

        let added = 0
        const addedNames = []
        const failures = []
        const createdUids = []
        nodeInfos.forEach((info, i) => {
          // 映射题目：优先按 index，缺失时按顺序兜底（即使数量不一致也取第 i 条）
          const q = byIndex.get(info.index) || validQuestions[i] || null
          const node = liveNodes[i]
          if (!q || !q.question || !node) { failures.push(info.text.slice(0, 12)); return }
          const isChoice = /选/.test(String(q.type || ''))
          // 题型标签【选择】/【填空】蓝色加粗（#007aff 与工具栏"蓝色"一致）
          const parts = []
          parts.push(`<span style="color: #007aff; font-weight: bold;">【${isChoice ? '选择' : '填空'}】</span>${esc(q.question)}`)
          if (isChoice) for (const opt of q.options || []) parts.push(esc(opt))
          // 答案与解析在同一节点内、各自单独一行，内容挖空（前缀保留可见）
          if (q.answer != null && String(q.answer).trim() !== '') parts.push(`答案：<span class="smm-cloze">${esc(q.answer)}</span>`)
          if (q.explanation != null && String(q.explanation).trim() !== '') parts.push(`解析：<span class="smm-cloze">${esc(q.explanation)}</span>`)
          const html = `<p><span>${parts.join('<br>')}</span></p>`
          const quizUid = createUid()
          try {
            // 直接在节点数据树上追加子节点（与 insertChildNode 核心逻辑一致），避免命令系统差异
            if (!node.nodeData) node.nodeData = { data: {}, children: [] }
            if (!node.nodeData.children) node.nodeData.children = []
            node.nodeData.children.push({
              data: { text: html, uid: quizUid, richText: true },
              children: []
            })
            try { node.setData({ expand: true }) } catch (e) {}
            createdUids.push(quizUid)
            added++
            addedNames.push(info.text.slice(0, 20))
          } catch (e) {
            failures.push(`${info.text.slice(0, 12)}(${e.message})`)
          }
        })

        if (added === 0) return { success: false, message: '没有成功添加任何题目子节点，请重试' }
        // 直接改数据树后需完全重绘（render 仅部分刷新，新节点可能不显示或布局错乱）
        try {
          if (typeof mindMap.reRender === 'function') mindMap.reRender()
          else mindMap.render()
        } catch (e) {
          mindMap.render()
        }
        // 题目节点的答案/解析挖空默认隐藏（显式写入节点覆盖值，不受全局显隐开关影响）
        try {
          const quizNodes = createdUids
            .map(uid => mindMap.renderer.findNodeByUid(uid))
            .filter(Boolean)
          if (quizNodes.length) setNodesClozeHidden(quizNodes, true)
        } catch (e) {}
        // 手动记录历史（用未节流的 originAddHistory），确保本次出题可 Ctrl+Z 撤销
        try {
          if (mindMap.command && typeof mindMap.command.originAddHistory === 'function') {
            mindMap.command.originAddHistory()
          }
        } catch (e) {}
        // 列出实际命中的节点名，让 AI 与用户能立即核对出题范围是否与预期一致
        const nameList = addedNames.length > 5
          ? addedNames.slice(0, 5).join('、') + ` 等 ${addedNames.length} 个节点`
          : addedNames.join('、')
        let msg = `已为 ${added} 个节点各追加 1 道题（${nameList}），题型：${types.join('、')}。题型标签蓝色加粗，答案与解析已自动挖空并隐藏（各占一行），点击挖空文字可查看。`
        if (truncated) msg += ` 目标节点超过 40 个，本次仅处理前 40 个。`
        if (failures.length) msg += ` 未生成的节点：${failures.join('、')}。`
        msg += ' 可通过 Ctrl+Z 撤销本次出题。'
        return { success: true, message: msg, createdUids, addedCount: added, failures }
      } catch (e) {
        return { success: false, message: `AI 出题追加失败: ${e.message}` }
      }
    }

    case 'focus_node': {
      try {
        if (!mindMap) return { success: false, message: '当前没有打开的思维导图。请先调用 find_local_file(exts=["smm"]) 搜索本地导图文件（自动覆盖桌面/文档/下载/默认保存目录），再用 read_mindmap_file(filePath=...) 直接读取文件内容后继续。' }
        let node = null
        if (args.uid) {
          node = mindMap.renderer.findNodeByUid(args.uid)
          if (!node) return { success: false, message: `uid=${args.uid} 未找到节点，请先用 search_nodes 查询` }
        } else if (args.keyword) {
          const kw = args.keyword.trim()
          const kwLower = kw.toLowerCase()
          const walk = (n) => {
            if (!n || node) return
            if (!n.isGeneralization && nodePlainText(n.getData?.('text') || '').toLowerCase().includes(kwLower)) {
              node = n
              return
            }
            (n.children || []).forEach(walk)
          }
          walk(mindMap.renderer.root)
          if (!node) return { success: false, message: `没有找到包含"${kw}"的节点` }
        } else {
          const active = mindMap.renderer.activeNodeList || []
          if (!active.length) return { success: false, message: '请提供 uid 或 keyword' }
          node = active[0]
        }
        if (typeof mindMap.renderer.moveNodeToCenter === 'function') {
          mindMap.renderer.moveNodeToCenter(node)
        }
        if (typeof mindMap.renderer.clearActiveNode === 'function') mindMap.renderer.clearActiveNode()
        if (typeof mindMap.renderer.addNodeToActiveList === 'function') {
          mindMap.renderer.addNodeToActiveList(node)
        }
        mindMap.render()
        return { success: true, message: `已定位并选中节点「${nodePlainText(node.getData?.('text') || '').slice(0, 40)}」（uid=${node.getData?.('uid') || node.uid}）` }
      } catch (e) {
        return { success: false, message: `定位节点失败: ${e.message}` }
      }
    }

    case 'merge_mindmap_files': {
      try {
        if (!mindMap) return { success: false, message: '当前没有打开的思维导图。请先调用 find_local_file(exts=["smm"]) 搜索本地导图文件（自动覆盖桌面/文档/下载/默认保存目录），再用 read_mindmap_file(filePath=...) 直接读取文件内容后继续。' }
        const srcPath = (args.sourceFilePath || '').trim()
        if (!srcPath) return { success: false, message: '请提供 sourceFilePath' }
        if (!window.electronAPI?.fs?.readFile) return { success: false, message: '文件读取功能不可用' }
        const content = await window.electronAPI.fs.readFile(srcPath)
        let srcTree
        try {
          srcTree = JSON.parse(content)
        } catch {
          return { success: false, message: '源文件不是有效的 .smm 导图（JSON 解析失败）' }
        }
        if (!srcTree || !srcTree.data) return { success: false, message: '源文件缺少节点数据' }

        // 定位源子树
        let srcRoots = []
        if (args.sourceNodeUid) {
          const findIn = (n) => {
            if (!n) return null
            if (n.data?.uid === args.sourceNodeUid) return n
            for (const c of n.children || []) {
              const r = findIn(c)
              if (r) return r
            }
            return null
          }
          const hit = findIn(srcTree)
          if (!hit) return { success: false, message: `源文件中未找到 uid=${args.sourceNodeUid} 的节点` }
          srcRoots = [hit]
        } else {
          srcRoots = (srcTree.children || []).filter(c => c && c.data)
          if (!srcRoots.length) return { success: false, message: '源导图没有一级分支可合并' }
        }

        // 深拷贝 + 重新生成全部 uid（避免与当前导图冲突）
        const cloneRenew = (n) => {
          const copy = JSON.parse(JSON.stringify(n))
          const renew = (node) => {
            if (node.data) {
              node.data.uid = createUid()
              node.data.richText = true
              if (!node.data.text || !String(node.data.text).startsWith('<')) {
                node.data.text = `<p><span>${String(node.data.text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;')}</span></p>`
              }
            }
            ;(node.children || []).forEach(renew)
          }
          renew(copy)
          return copy
        }

        // 目标节点（数据树定位）
        const treeData = mindMap.getData()
        let targetData = treeData
        if (args.targetUid) {
          const findData = (n) => {
            if (!n) return null
            if (n.data?.uid === args.targetUid) return n
            for (const c of n.children || []) {
              const r = findData(c)
              if (r) return r
            }
            return null
          }
          targetData = findData(treeData)
          if (!targetData) return { success: false, message: `当前导图中未找到 uid=${args.targetUid} 的目标节点` }
        }
        targetData.children = targetData.children || []
        for (const src of srcRoots) targetData.children.push(cloneRenew(src))

        mindMap.setData(treeData)
        applyClozeStyles()

        // 定位到目标节点便于查看
        const targetLive = mindMap.renderer.findNodeByUid(args.targetUid || treeData.data?.uid)
        if (targetLive && typeof mindMap.renderer.moveNodeToCenter === 'function') {
          mindMap.renderer.moveNodeToCenter(targetLive)
        }
        const srcName = srcPath.replace(/^.*[\\/]/, '')
        return {
          success: true,
          message: `已把「${srcName}」的 ${srcRoots.length} 个分支合并到「${nodePlainText(targetData.data?.text || '').slice(0, 30) || '根节点'}」下（副本合并，源文件不变；已重新生成节点 uid。注意：合并操作不可用 Ctrl+Z 撤销，如需回退请勿保存并重新打开文件）`
        }
      } catch (e) {
        return { success: false, message: `合并导图失败: ${e.message}` }
      }
    }

    case 'export_subtree': {
      try {
        if (!mindMap) return { success: false, message: '当前没有打开的思维导图。请先调用 find_local_file(exts=["smm"]) 搜索本地导图文件（自动覆盖桌面/文档/下载/默认保存目录），再用 read_mindmap_file(filePath=...) 直接读取文件内容后继续。' }
        const format = (args.format || '').toLowerCase()
        if (!['smm', 'png', 'jpg', 'svg'].includes(format)) {
          return { success: false, message: 'format 必须是 smm/png/jpg/svg 之一；用户未指定时应先询问用户要导出为独立导图文件还是图片' }
        }
        // simple-mind-map 不支持 jpg（export 会返回 null 产出空文件），统一按 png 导出
        const exportFormat = format === 'jpg' ? 'png' : format

        // 定位子树根：uid > keyword > 选中 > 根
        let node = null
        if (args.uid) {
          node = mindMap.renderer.findNodeByUid(args.uid)
          if (!node) return { success: false, message: `uid=${args.uid} 未找到节点` }
        } else if (args.keyword) {
          const kw = args.keyword.trim()
          const kwLower = kw.toLowerCase()
          const walk = (n) => {
            if (!n || node) return
            if (!n.isGeneralization && nodePlainText(n.getData?.('text') || '').toLowerCase().includes(kwLower)) { node = n; return }
            ;(n.children || []).forEach(walk)
          }
          walk(mindMap.renderer.root)
          if (!node) return { success: false, message: `没有找到包含"${kw}"的节点` }
        } else {
          const active = (mindMap.renderer.activeNodeList || []).filter(n => !n.isGeneralization)
          node = active[0] || mindMap.renderer.root
        }

        // 深拷贝子树（renderer 节点 → 数据节点）
        const cloneSubtree = (n) => {
          const copy = { data: JSON.parse(JSON.stringify(n.getData() || {})) }
          copy.children = (n.children || []).filter(c => c && !c.isGeneralization).map(cloneSubtree)
          return copy
        }
        const subtree = cloneSubtree(node)
        ensureRichText(subtree)

        const rootText = nodePlainText(node.getData?.('text') || '') || '子树'
        const safeName = rootText.replace(/[<>:"/\\|?*]/g, '_').slice(0, 50)

        if (format === 'smm') {
          const fileName = `${safeName}.smm`
          if (!window.electronAPI?.saveFile) return { success: false, message: '文件保存功能不可用' }
          const r = await window.electronAPI.saveFile(fileName, JSON.stringify(subtree, null, 2))
          if (!r || !r.success) return { success: false, message: `保存失败：${r?.error || '未知错误'}` }
          await revealIfAsked(args, r.filePath)
          return {
            success: true,
            message: `已把「${rootText.slice(0, 40)}」子树（${countNodes(subtree)} 个节点）导出为独立导图：${fileName}（${r.filePath}）`,
            filePath: r.filePath,
            fileName,
            externalFile: true
          }
        }

        // 图片格式：库原生单节点导出（不切换整图数据，保留 Ctrl+Z 撤销历史）
        if (!mindMap.doExport) return { success: false, message: '导出插件未注册' }
        let dataUrl
        if (exportFormat === 'svg') {
          // 库 svg() 不支持 node 参数，用插件内部公开方法手动组装单节点 SVG
          const doExport = mindMap.doExport
          if (typeof doExport.getSvgData !== 'function' || typeof doExport.fixSvgStrAndToBlob !== 'function') {
            return { success: false, message: '导出插件版本不支持单节点 SVG 导出' }
          }
          if (typeof doExport.handleNodeExport === 'function') doExport.handleNodeExport(node)
          const { node: svgNode } = await doExport.getSvgData(node)
          if (typeof doExport.drawBackgroundToSvg === 'function') {
            await doExport.drawBackgroundToSvg(svgNode)
          }
          dataUrl = await doExport.fixSvgStrAndToBlob(svgNode.svg())
        } else {
          // png(name, transparent, node)：原生单节点导出
          dataUrl = await mindMap.doExport.png(safeName, false, node)
        }
        // 导出可能失败返回空：必须判空，否则会写出 0 字节空文件并假报成功
        if (!dataUrl) {
          return { success: false, message: `导出失败：${exportFormat.toUpperCase()} 生成失败（渲染未产出数据，可能是画布过大，可稍后重试）` }
        }
        const fileName = `${safeName}.${exportFormat}`
        let filePath = null
        if (exportFormat === 'svg' && /^data:image\/svg\+xml/i.test(dataUrl)) {
          const svgText = decodeURIComponent(dataUrl.replace(/^data:image\/svg\+xml(;charset=[^,]+)?,/i, ''))
          if (window.electronAPI?.saveFile) {
            const r = await window.electronAPI.saveFile(fileName, svgText)
            if (r && r.success) filePath = r.filePath
          }
        } else if (window.electronAPI?.saveBinaryFile) {
          const r = await window.electronAPI.saveBinaryFile(fileName, dataUrl)
          if (r && r.success) filePath = r.filePath
        }
        await revealIfAsked(args, filePath)
        return {
          success: true,
          message: `已导出「${rootText.slice(0, 40)}」子树为 ${exportFormat.toUpperCase()} 图片${filePath ? `并保存到：${filePath}` : ''}（图片显示在消息中）`,
          imageFormat: exportFormat,
          imageData: dataUrl,
          filePath,
          fileName
        }
      } catch (e) {
        return { success: false, message: `导出子树失败: ${e.message}` }
      }
    }

    case 'search_web': {
      try {
        let query = args.query || ''
        if (!query.trim()) return { success: false, message: '搜索关键词为空' }
        // 固定流程（代码层替代 prompt 规则）：天气/本地生活类查询未指定城市时，先 IP 定位再拼入城市
        if (/天气|气温|降雨|降雪|湿度|空气质量|穿衣|紫外线|洗车|限行|附近/.test(query) && !/(市|省|区|县|镇)$/.test(query.trim()) && window.electronAPI?.getLocation) {
          try {
            const loc = await window.electronAPI.getLocation()
            if (loc?.success && (loc.city || loc.province)) {
              const city = loc.city || loc.province
              if (!query.includes(city)) query = `${city} ${query}`
            }
          } catch {}
        }
        const results = await searchWeb(query, { deepResearch: args.deep_research === true })
        if (!results || results.length === 0) {
          return { success: true, message: `搜索"${query}"未找到结果` }
        }
        const searchMeta = results.searchMeta || {}
        const engineStatuses = searchMeta.engineStatuses || []
        const engineSummary = engineStatuses.length
          ? `（引擎：${engineStatuses.map(status => `${status.engine} ${status.success ? `${status.count}条` : '失败'}`).join('；')}；预算：${searchMeta.searchBudget ? `${searchMeta.searchBudget.count}/${searchMeta.searchBudget.limit}` : '-'}）\n\n`
          : ''
        let formatted = results.map((result) =>
          `[${result.ref}] [${result.engine || 'DuckDuckGo'}] ${result.title}` +
          `\n   ${result.link}` +
          `\n   日期：${result.publishedDate || '未知'}；相关度：${result.score}` +
          `\n   ${result.snippet || ''}`
        ).join('\n\n')

        // 数值型事实自动核查：读取排序前二的来源（并行抓取），给模型正文证据而不是只依赖摘要。
        const factualQuery = /天气|气温|降雨|新闻|价格|报价|数据|汇率|股价|政策/.test(query)
        if (factualQuery && args.verify !== false) {
          const verifyTargets = results.slice(0, 2)
          await Promise.all(verifyTargets.map(async (result) => {
            try {
              const page = await readWebpage(result.link)
              const excerpt = String(page.content || '').replace(/\s+/g, ' ').slice(0, 600)
              result.verifiedExcerpt = excerpt
              result.verifiedTitle = page.title || result.title
            } catch (error) {
              result.verificationError = error.message
            }
          }))
          const verified = verifyTargets
            .filter(r => r.verifiedExcerpt)
            .map(r => `[${r.ref}] ${r.verifiedTitle}\n${r.verifiedExcerpt}`)
          if (verified.length) formatted += `\n\n已自动核查的正文证据：\n\n${verified.join('\n\n')}`
        }

        return {
          success: true,
          message: `搜索"${query}"的结果${engineSummary}${formatted}\n\n回答时必须使用 [编号] 引用来源；数值结论必须来自摘要或已核查正文。`,
          searchResults: results,
          searchMeta
        }
      } catch (e) {
        return { success: false, message: `联网搜索失败: ${e.message}` }
      }
    }

        case 'read_webpage': {
      try {
        const url = String(args.url || '').trim()
        if (!/^https?:\/\//i.test(url)) return { success: false, message: '请提供 http/https 开头的完整链接' }
        const page = await readWebpage(url)
        const head = `已读取网页${page.title ? `「${page.title}」` : ''}正文：\n\n`
        const tail = page.truncated ? '\n\n（正文过长，已截断，前文为主要内容）' : ''
        return { success: true, message: head + page.content + tail }
      } catch (e) {
        return { success: false, message: `网页读取失败: ${e.message}` }
      }
    }

    case 'get_location': {
      try {
        if (!window.electronAPI?.getLocation) return { success: false, message: '定位功能不可用' }
        const loc = await window.electronAPI.getLocation()
        if (!loc || !loc.success) return { success: false, message: `定位失败: ${loc?.error || '未知错误'}` }
        return {
          success: true,
          message: `当前位置（IP定位）：${loc.country || ''}${loc.province || ''}${loc.city || ''}；运营商：${loc.isp || '未知'}；IP：${loc.ip || '未知'}。提示：IP 定位精度到城市级，若用户开着代理，结果可能是代理出口城市。`
        }
      } catch (e) {
        return { success: false, message: `定位失败: ${e.message}` }
      }
    }

    case 'search_knowledge_base': {
      try {
        const query = args.query || ''
        if (!query.trim()) return { success: false, message: '搜索关键词为空' }
        if (!searchService.isAvailable()) {
          return { success: false, message: '知识库检索服务不可用' }
        }
        const res = await searchService.search(query)
        const results = res.results || []
        if (results.length === 0) {
          return { success: true, message: `在知识库中搜索"${query}"未找到匹配内容` }
        }
        const formatted = results.map((r, i) =>
          `${i + 1}. 文件：${r.fileName}\n   路径：${r.filePath}\n   内容：${(r.snippet || '').replace(/<[^>]+>/g, '')}\n   节点UID：${r.nodeUid || ''}`
        ).join('\n\n')
        return {
          success: true,
          message: `知识库搜索"${query}"找到 ${results.length} 条结果：\n\n${formatted}`,
          searchResults: results
        }
      } catch (e) {
        return { success: false, message: `知识库搜索失败: ${e.message}` }
      }
    }

    case 'semantic_search': {
      try {
        const query = args.query || ''
        const keywords = Array.isArray(args.keywords)
          ? args.keywords.map(k => String(k || '').trim()).filter(Boolean)
          : []
        if (!query.trim() && keywords.length === 0) {
          return { success: false, message: '缺少查询内容：请提供 query 和扩展关键词 keywords' }
        }
        if (!searchService.isAvailable()) {
          return { success: false, message: '语义检索服务不可用（本地 SQLite 知识库未启用，请在桌面应用中运行）' }
        }

        // 混合语义检索：BM25 关键词 + 本地向量余弦（E5），RRF 融合排序；向量不可用自动降级 BM25
        const terms = [...new Set([...keywords, query.trim()].filter(Boolean))]
        const { results: ranked } = await searchService.semanticSearch(query, keywords)

        if (ranked.length === 0) {
          return {
            success: true,
            message: `语义检索"${query}"（关键词：${terms.join('、')}）未找到匹配内容。建议：1) 换一组更通用的关键词重试；2) 确认相关文件已被 AI 读取过或手动打开过（本地索引库包含已索引的思维导图与文档）`
          }
        }

        // 按文件聚合展示
        const byFile = new Map()
        for (const r of ranked) {
          if (!byFile.has(r.fileName)) byFile.set(r.fileName, [])
          byFile.get(r.fileName).push(r)
        }
        const fileSections = [...byFile.entries()].map(([fileName, items], fi) => {
          const nodes = items.slice(0, 10).map((r) => {
            const hitInfo = r.hitTerms?.length ? `命中：${r.hitTerms.join('、')}` : (r.vectorRank ? '向量语义命中' : '命中')
            return `   [KB${r.ref}] ${r.snippet}（${hitInfo}；相关度：${r.score}）${r.nodeUid ? ` [uid:${r.nodeUid}]` : ''}`
          }).join('\n')
          const more = items.length > 10 ? `\n   ...等共 ${items.length} 处命中` : ''
          return `${fi + 1}. 文件：${fileName}\n   路径：${items[0].filePath}\n${nodes}${more}`
        }).join('\n\n')

        return {
          success: true,
          message: `语义检索"${query}"（关键词：${terms.join('、')}）共命中 ${ranked.length} 条（按相关度排序；回答时必须引用 [KB编号]）：\n\n${fileSections}`,
          searchResults: ranked,
          keywords: terms
        }
      } catch (e) {
        return { success: false, message: `语义检索失败: ${e.message}` }
      }
    }

    case 'semantic_tool_search': {
      try {
        if (!args.query) return { success: false, message: '请提供 query' }
        const limit = Math.min(Math.max(Number(args.limit) || 10, 1), 30)
        const hits = await semanticToolSearch(args.query, limit)
        if (!hits.length) return { success: true, message: `没有找到与「${args.query}」匹配的工具、MCP、Skill 或自定义工具。` }
        const text = hits.map((h, i) =>
          `${i + 1}. [${h.kind}] ${h.name}${h.id ? `（id=${h.id}）` : ''}${h.description ? `：${h.description}` : ''}（score=${h.score}）`
        ).join('\n')
        return { success: true, message: `为「${args.query}」找到 ${hits.length} 个候选：\n\n${text}`, results: hits }
      } catch (e) {
        return { success: false, message: `语义工具检索失败: ${e.message}` }
      }
    }

    case 'read_mindmap_file': {
      try {
        const filePath = args.filePath || ''
        if (!filePath.trim()) return { success: false, message: '文件路径为空' }
        if (!window.electronAPI?.fs?.readFile) {
          return { success: false, message: '文件系统不可用' }
        }
        const content = await window.electronAPI.fs.readFile(filePath)
        if (!content) return { success: false, message: `无法读取文件：${filePath}` }
        let treeData
        try {
          treeData = JSON.parse(content)
        } catch {
          return { success: false, message: `文件格式错误：${filePath}` }
        }
        const text = treeToText(treeData)
        const fileName = filePath.split(/[/\\]/).pop()
        return {
          success: true,
          message: `文件"${fileName}"的内容：\n\n${text}`,
          filePath,
          fileName
        }
      } catch (e) {
        return { success: false, message: `读取文件失败: ${e.message}` }
      }
    }

    case 'read_node_image': {
      try {
        if (!mindMap) return { success: false, message: '当前没有打开的思维导图。请先调用 find_local_file(exts=["smm"]) 搜索本地导图文件（自动覆盖桌面/文档/下载/默认保存目录），再用 read_mindmap_file(filePath=...) 直接读取文件内容后继续。' }
        let node = null
        if (args.uid) {
          node = mindMap.renderer.findNodeByUid(args.uid)
          if (!node) return { success: false, message: `未找到 uid=${args.uid} 的节点` }
        } else if (args.keyword) {
          const kw = String(args.keyword).trim().toLowerCase()
          const walk = (n) => {
            if (!n || node) return
            if (!n.isGeneralization && nodePlainText(n.getData?.('text') || '').toLowerCase().includes(kw)) { node = n; return }
            ;(n.children || []).forEach(walk)
          }
          walk(mindMap.renderer.root)
          if (!node) return { success: false, message: `没有找到包含「${kw}」的节点` }
        } else {
          const active = mindMap.renderer.activeNodeList || []
          if (!active.length) return { success: false, message: '请提供 uid 或 keyword' }
          node = active[0]
        }
        const data = node.getData?.() || node.data || {}
        const imageSrc = data.image || ''
        if (!imageSrc) return { success: false, message: '该节点没有图片' }

        let base64 = ''
        if (/^data:image\/[^;]+;base64,/i.test(imageSrc)) {
          base64 = imageSrc.replace(/^data:image\/[^;]+;base64,/i, '')
        } else if (/^data:image\/[^;]+,/i.test(imageSrc)) {
          base64 = imageSrc.substring(imageSrc.indexOf(',') + 1)
        } else if (window.electronAPI?.fs?.readBinary) {
          const bin = await window.electronAPI.fs.readBinary(imageSrc)
          if (!bin || !bin.success) return { success: false, message: `读取节点图片失败: ${bin?.error || '未知错误'}` }
          base64 = bin.base64
        } else {
          return { success: false, message: '节点图片不是可识别的 base64 数据，且当前环境无法读取本地图片' }
        }
        if (!window.electronAPI?.ocrSmart) return { success: false, message: '图片识别服务不可用（请使用桌面应用）' }
        const ocr = await window.electronAPI.ocrSmart(base64, 'chi_sim+eng')
        if (!ocr || !ocr.success) return { success: false, message: `识别节点图片失败: ${ocr?.error || '未知错误'}` }
        const sourceText = ocr.source === 'ai_vision'
          ? '多模态识图'
          : (ocr.source === 'ocr' ? '本地 OCR' : (ocr.source || '识图'))
        const fallback = ocr.fallback_from
          ? `（${ocr.fallback_from === 'ai_vision' ? '多模态识别失败' : '识别失败'}后降级：${ocr.fallback_reason || ''}）`
          : ''
        return {
          success: true,
          message: `节点图片识别结果（来源：${sourceText}${fallback}）：\n\n${ocr.text}`,
          source: ocr.source,
          text: ocr.text,
          fallback_from: ocr.fallback_from,
          fallback_reason: ocr.fallback_reason
        }
      } catch (e) {
        return { success: false, message: `识别节点图片失败: ${e.message}` }
      }
    }

    case 'delete_local_file': {
      try {
        const filePath = (args.filePath || '').trim()
        if (!filePath) return { success: false, message: '文件路径为空' }
        if (!window.electronAPI?.fs?.remove) {
          return { success: false, message: '文件系统不可用，无法删除本地文件' }
        }
        // fs:exists 返回布尔值
        if (window.electronAPI.fs.exists) {
          const existsFlag = await window.electronAPI.fs.exists(filePath)
          if (existsFlag === false) {
            return { success: false, message: `文件不存在：${filePath}` }
          }
        }
        await window.electronAPI.fs.remove(filePath)
        const fileName = filePath.split(/[/\\]/).pop()
        return { success: true, message: `已删除本地文件：${fileName}（已移入系统回收站，可恢复）` }
      } catch (e) {
        return { success: false, message: `删除本地文件失败: ${e.message}` }
      }
    }

    case 'edit_local_file': {
      try {
        const filePath = String(args.file_path || args.filePath || '').trim()
        if (!filePath) return { success: false, message: '请提供 file_path（文件绝对路径）' }
        const mode = String(args.mode || '').trim() || 'replace_in_file'
        const newText = typeof args.new_text === 'string' ? args.new_text : ''
        if (mode !== 'replace_in_file' && mode !== 'write_full_file') {
          return { success: false, message: `mode 必须是 replace_in_file 或 write_full_file，当前：${mode}` }
        }
        if (!window.electronAPI?.fs) {
          return { success: false, message: '文件系统不可用，无法编辑本地文件' }
        }
        const fileName = filePath.split(/[/\\]/).pop() || filePath
        // 拒绝读 config.json（同 read_local_file 的安全策略，避免泄漏密钥）
        if (fileName.toLowerCase() === 'config.json') {
          return { success: false, message: '该文件是应用自身的敏感配置，禁止 AI 写入。如需修改模型/MCP/工具配置，请在设置中操作。' }
        }

        if (mode === 'write_full_file') {
          // 直接覆盖写入（文件不存在则自动创建）
          if (window.electronAPI.fs.createFile) {
            await window.electronAPI.fs.createFile(filePath, newText)
          } else if (window.electronAPI.fs.writeFile) {
            await window.electronAPI.fs.writeFile(filePath, newText)
          } else {
            return { success: false, message: '主进程未提供文件写入接口' }
          }
          const stat = window.electronAPI.fs.stat ? await window.electronAPI.fs.stat(filePath) : null
          return {
            success: true,
            message: `已覆盖写入：${filePath}${stat?.size ? `（${stat.size} 字节）` : ''}`,
            filePath,
            mode: 'write_full_file',
            size: stat?.size ?? null
          }
        }

        // replace_in_file：先读取全文，定位 old_text 并校验唯一性
        const oldText = typeof args.old_text === 'string' ? args.old_text : ''
        if (!oldText) return { success: false, message: 'replace_in_file 模式必须提供 old_text' }
        const exists = window.electronAPI.fs.exists ? await window.electronAPI.fs.exists(filePath) : true
        if (exists === false) {
          return { success: false, message: `文件不存在：${filePath}。如需新建文件，请用 mode=write_full_file` }
        }
        const content = await window.electronAPI.fs.readFile(filePath)
        const occurrences = content.split(oldText).length - 1
        if (occurrences === 0) {
          return {
            success: false,
            message: `old_text 在文件中未找到。请确认 old_text 与文件内容完全一致（含空格/换行/缩进）。如需新建，请用 mode=write_full_file`,
            filePath
          }
        }
        if (occurrences > 1) {
          return {
            success: false,
            message: `old_text 在文件中匹配到 ${occurrences} 处。请在 old_text 中加入更多上下文，使其唯一`,
            filePath
          }
        }
        const updated = content.replace(oldText, newText)
        if (window.electronAPI.fs.createFile) {
          await window.electronAPI.fs.createFile(filePath, updated)
        } else {
          await window.electronAPI.fs.writeFile(filePath, updated)
        }
        return {
          success: true,
          message: `已替换 1 处内容：${filePath}`,
          filePath,
          mode: 'replace_in_file'
        }
      } catch (e) {
        return { success: false, message: `编辑本地文件失败: ${e.message}` }
      }
    }

    case 'append_local_file': {
      try {
        const filePath = String(args.file_path || '').trim()
        if (!filePath) return { success: false, message: '请提供 file_path（文件绝对路径）' }
        const content = typeof args.content === 'string' ? args.content : ''
        if (!content) return { success: false, message: 'content 不能为空' }
        if (!window.electronAPI?.fs) {
          return { success: false, message: '文件系统不可用，无法追加内容' }
        }
        const fileName = filePath.split(/[/\\]/).pop() || filePath
        if (fileName.toLowerCase() === 'config.json') {
          return { success: false, message: '该文件是应用自身的敏感配置，禁止 AI 写入。' }
        }
        const exists = window.electronAPI.fs.exists ? await window.electronAPI.fs.exists(filePath) : false
        let finalContent = content
        if (exists && args.newline !== false) {
          // 自动追加换行，确保新内容独立成行（除非文件本来就是空或以换行结尾）
          const cur = await window.electronAPI.fs.readFile(filePath)
          if (cur && !cur.endsWith('\n')) finalContent = '\n' + content
        }
        if (exists) {
          const cur = exists ? await window.electronAPI.fs.readFile(filePath) : ''
          finalContent = (cur || '') + (cur && !cur.endsWith('\n') && args.newline !== false ? '\n' : '') + content
        }
        if (window.electronAPI.fs.createFile) {
          await window.electronAPI.fs.createFile(filePath, finalContent)
        } else if (window.electronAPI.fs.writeFile) {
          await window.electronAPI.fs.writeFile(filePath, finalContent)
        } else {
          return { success: false, message: '主进程未提供文件写入接口' }
        }
        return {
          success: true,
          message: `${exists ? '已追加内容到' : '已创建并写入'}${filePath}（新增 ${content.length} 字符）`,
          filePath
        }
      } catch (e) {
        return { success: false, message: `追加本地文件失败: ${e.message}` }
      }
    }

    case 'read_local_file_lines': {
      try {
        const filePath = String(args.file_path || '').trim()
        if (!filePath) return { success: false, message: '请提供 file_path' }
        if (!window.electronAPI?.fs?.readFile) {
          return { success: false, message: '文件系统不可用' }
        }
        const exists = await window.electronAPI.fs.exists(filePath)
        if (exists === false) return { success: false, message: `文件不存在：${filePath}` }
        const content = await window.electronAPI.fs.readFile(filePath)
        const lines = content.split(/\r?\n/)
        const totalLines = lines.length
        const start = Math.max(1, Number(args.start_line) || 1)
        const end = Math.min(totalLines, Number(args.end_line) || totalLines)
        if (start > end) {
          return { success: false, message: `起始行 ${start} 大于结束行 ${end}` }
        }
        const maxChars = Math.min(Math.max(Number(args.max_chars) || 50000, 200), 200000)
        let sliced = lines.slice(start - 1, end).join('\n')
        let truncated = false
        if (sliced.length > maxChars) {
          sliced = sliced.slice(0, maxChars) + '\n…（内容过长已截断）'
          truncated = true
        }
        return {
          success: true,
          message: `文件 ${filePath} 第 ${start}~${end} 行（共 ${totalLines} 行${truncated ? '，已截断' : ''}）：\n${sliced}`,
          filePath,
          start_line: start,
          end_line: end,
          total_lines: totalLines
        }
      } catch (e) {
        return { success: false, message: `读取文件行范围失败: ${e.message}` }
      }
    }

    case 'run_shell': {
      try {
        if (!window.electronAPI?.shell?.exec) {
          return { success: false, message: 'Shell 执行功能不可用（请使用桌面应用）' }
        }
        const binary = String(args.binary || '').trim()
        if (!binary) return { success: false, message: '请提供 binary（白名单内的可执行文件名）' }
        const result = await window.electronAPI.shell.exec({
          binary,
          args: Array.isArray(args.args) ? args.args.map(String) : [],
          cwd: args.cwd ? String(args.cwd) : undefined,
          env: args.env && typeof args.env === 'object' ? args.env : undefined,
          timeoutMs: args.timeoutMs ? Number(args.timeoutMs) : undefined
        })
        if (!result || result.error) {
          return { success: false, message: `执行失败：${result?.error || '未知错误'}${result?.code ? `（code=${result.code}）` : ''}` }
        }
        const head = `已执行 ${binary} ${(result.args || []).join(' ')}（退出码 ${result.exitCode}${result.timedOut ? '，超时已被终止' : ''}）：\n`
        const body = (result.stdout || '') + (result.stderr ? '\n--- stderr ---\n' + result.stderr : '')
        return {
          success: result.success && result.exitCode === 0,
          message: head + (body || '（无输出）'),
          exitCode: result.exitCode,
          timedOut: result.timedOut,
          stdout: result.stdout,
          stderr: result.stderr
        }
      } catch (e) {
        return { success: false, message: `执行命令失败: ${e.message}` }
      }
    }

    case 'run_node': {
      try {
        if (!window.electronAPI?.shell?.exec) {
          return { success: false, message: 'Shell 执行功能不可用（请使用桌面应用）' }
        }
        const scriptPath = String(args.script_path || '').trim()
        if (!scriptPath) return { success: false, message: '请提供 script_path（脚本绝对路径）' }
        // review S-2：script_path 必须绝对路径 + 经主进程白名单校验
        const allowRes = await window.electronAPI.shell.assertScriptPathAllowed(scriptPath)
        if (!allowRes || !allowRes.success) {
          return { success: false, message: `脚本路径被拒绝：${allowRes?.error || '未知原因'}。请确认脚本在已打开导图所在目录、用户数据目录、桌面/文档/下载，或在设置中将其目录加入白名单。` }
        }
        const cwd = args.cwd ? String(args.cwd) : scriptPath.replace(/[\\/][^\\/]*$/, '')
        const result = await window.electronAPI.shell.exec({
          binary: 'node',
          args: [scriptPath, ...(Array.isArray(args.args) ? args.args.map(String) : [])],
          cwd,
          timeoutMs: args.timeoutMs ? Number(args.timeoutMs) : undefined
        })
        if (!result || result.error) {
          return { success: false, message: `执行失败：${result?.error || '未知错误'}` }
        }
        const head = `已执行 node ${scriptPath}（退出码 ${result.exitCode}${result.timedOut ? '，超时已被终止' : ''}）：\n`
        const body = (result.stdout || '') + (result.stderr ? '\n--- stderr ---\n' + result.stderr : '')
        return {
          success: result.success && result.exitCode === 0,
          message: head + (body || '（无输出）'),
          exitCode: result.exitCode,
          timedOut: result.timedOut,
          stdout: result.stdout,
          stderr: result.stderr
        }
      } catch (e) {
        return { success: false, message: `执行 Node 脚本失败: ${e.message}` }
      }
    }

    case 'run_python': {
      try {
        if (!window.electronAPI?.shell?.exec) {
          return { success: false, message: 'Shell 执行功能不可用（请使用桌面应用）' }
        }
        const scriptPath = String(args.script_path || '').trim()
        if (!scriptPath) return { success: false, message: '请提供 script_path（脚本绝对路径）' }
        // review S-2：script_path 必须绝对路径 + 经主进程白名单校验
        const allowRes = await window.electronAPI.shell.assertScriptPathAllowed(scriptPath)
        if (!allowRes || !allowRes.success) {
          return { success: false, message: `脚本路径被拒绝：${allowRes?.error || '未知原因'}。请确认脚本在已打开导图所在目录、用户数据目录、桌面/文档/下载，或在设置中将其目录加入白名单。` }
        }
        const cwd = args.cwd ? String(args.cwd) : scriptPath.replace(/[\\/][^\\/]*$/, '')
        const result = await window.electronAPI.shell.exec({
          binary: 'python',
          args: [scriptPath, ...(Array.isArray(args.args) ? args.args.map(String) : [])],
          cwd,
          timeoutMs: args.timeoutMs ? Number(args.timeoutMs) : undefined
        })
        if (!result || result.error) {
          return { success: false, message: `执行失败：${result?.error || '未知错误'}` }
        }
        const head = `已执行 python ${scriptPath}（退出码 ${result.exitCode}${result.timedOut ? '，超时已被终止' : ''}）：\n`
        const body = (result.stdout || '') + (result.stderr ? '\n--- stderr ---\n' + result.stderr : '')
        return {
          success: result.success && result.exitCode === 0,
          message: head + (body || '（无输出）'),
          exitCode: result.exitCode,
          timedOut: result.timedOut,
          stdout: result.stdout,
          stderr: result.stderr
        }
      } catch (e) {
        return { success: false, message: `执行 Python 脚本失败: ${e.message}` }
      }
    }

    case 'spawn_shell': {
      try {
        if (!window.electronAPI?.shell?.spawn) {
          return { success: false, message: 'Shell spawn 功能不可用（请使用桌面应用）' }
        }
        const binary = String(args.binary || '').trim()
        if (!binary) return { success: false, message: '请提供 binary' }
        const result = await window.electronAPI.shell.spawn({
          binary,
          args: Array.isArray(args.args) ? args.args.map(String) : [],
          cwd: args.cwd ? String(args.cwd) : undefined,
          env: args.env && typeof args.env === 'object' ? args.env : undefined
        })
        if (!result || !result.success) {
          return { success: false, message: `启动后台任务失败：${result?.error || '未知错误'}` }
        }
        return {
          success: true,
          message: `已启动后台任务：${binary}（handle=${result.handle}，pid=${result.pid}）。输出通过 shell:stdout/stderr/exit 事件流推送。需要终止时调用 shell_kill_background_job。`,
          handle: result.handle,
          pid: result.pid
        }
      } catch (e) {
        return { success: false, message: `spawn 任务失败: ${e.message}` }
      }
    }

    case 'shell_get_env': {
      try {
        if (!window.electronAPI?.shell?.getEnv) {
          return { success: false, message: 'shell:getEnv 不可用（请使用桌面应用）' }
        }
        const result = await window.electronAPI.shell.getEnv(args.key ? String(args.key) : null)
        if (!result || !result.success) {
          return { success: false, message: result?.error || '读取环境变量失败' }
        }
        if (args.key) {
          return { success: true, message: `${args.key} = ${result.value || '（未设置）'}`, key: args.key, value: result.value }
        }
        const lines = Object.entries(result.env || {}).map(([k, v]) => `${k} = ${v || '（未设置）'}`).join('\n')
        return { success: true, message: lines || '（未配置任何白名单环境变量）', env: result.env }
      } catch (e) {
        return { success: false, message: `读取环境变量失败: ${e.message}` }
      }
    }

    case 'shell_kill_background_job': {
      try {
        if (!window.electronAPI?.shell?.kill) {
          return { success: false, message: 'shell:kill 不可用（请使用桌面应用）' }
        }
        const handle = String(args.handle || '').trim()
        if (!handle) return { success: false, message: '请提供 handle' }
        const result = await window.electronAPI.shell.kill(handle)
        if (!result || !result.success) {
          return { success: false, message: `终止任务失败：${result?.error || '未知错误'}` }
        }
        return { success: true, message: `已终止后台任务 ${handle}` }
      } catch (e) {
        return { success: false, message: `终止任务失败: ${e.message}` }
      }
    }

    case 'clear_mindmap': {
      try {
        if (!mindMap) return { success: false, message: '当前没有打开的思维导图。请先调用 find_local_file(exts=["smm"]) 搜索本地导图文件（自动覆盖桌面/文档/下载/默认保存目录），再用 read_mindmap_file(filePath=...) 直接读取文件内容后继续。' }
        const emptyTree = {
          data: { text: '<p><span>中心主题</span></p>', uid: createUid(), richText: true },
          children: []
        }
        mindMap.setData(emptyTree)
        return { success: true, message: '已清空当前思维导图（仅保留空的根节点）' }
      } catch (e) {
        return { success: false, message: `清空导图失败: ${e.message}` }
      }
    }

    // 元工具：names 精确激活 / keyword 自动查找并激活 / 无参返回完整目录。
    case 'activate_tools': {
      try {
        const names = (Array.isArray(args.names) ? args.names : (args.names ? [args.names] : [])).filter(Boolean)
        const keyword = String(args.keyword || '').trim().toLowerCase()
        const limit = Math.max(1, Number(args.limit) || 6)
        const activated = []
        const notFound = []
        const customActivations = []
        const customList = await window.electronAPI?.customTools?.list?.() || []
        const findCustom = (n) => {
          const q = String(n).trim()
          return customList.find(t => t.id === q || t.name === q) || null
        }

        if (names.length > 0) {
          for (const n of names) {
            const def = aiTools.find(t => t.function.name === n)
            if (def) {
              activated.push(n)
            } else {
              const custom = findCustom(n)
              if (custom && !customActivations.some(c => c.id === custom.id)) customActivations.push(custom)
              else if (!custom) notFound.push(n)
            }
          }
        }

        // keyword：目录（名称/描述/类目）匹配，命中即激活，免去先查目录再激活的一轮往返
        if (keyword) {
          // 扩展关键词：原始关键词 + 中文别名对应的英文词（若中文关键词未直接命中）
          const keywords = expandAliasKeywords(keyword)
          const matchedSet = new Set()
          for (const kw of keywords) {
            const matched = toolCatalog.filter(t =>
              t.name === 'activate_tools' ? false : (
                t.name.toLowerCase().includes(kw) ||
                t.desc.toLowerCase().includes(kw) ||
                (t.category || '').toLowerCase().includes(kw)
              )
            )
            for (const m of matched) matchedSet.add(m.name)
            if (matchedSet.size >= limit) break
          }
          const matched = [...matchedSet].slice(0, limit)
          for (const m of matched) {
            if (!activated.includes(m) && aiTools.some(t => t.function.name === m)) activated.push(m)
          }
          for (const kw of keywords) {
            for (const c of customList) {
              if (
                (c.id || '').toLowerCase().includes(kw) ||
                (c.name || '').toLowerCase().includes(kw) ||
                (c.description || '').toLowerCase().includes(kw) ||
                (c.category || '').toLowerCase().includes(kw)
              ) {
                if (!customActivations.some(x => x.id === c.id)) customActivations.push(c)
              }
            }
          }
        }

        // 无参：返回完整紧凑目录（与系统提示词内嵌目录一致），供模型挑选后精确激活
        if (activated.length === 0 && customActivations.length === 0 && !keyword) {
          return {
            success: true,
            message: `完整工具目录：\n\n${buildToolCatalogText()}${customList.length ? `\n\n自定义工具：\n${customList.map(c => `- ${c.name}（id=${c.id}，用 call_custom_tool 调用）`).join('\n')}` : ''}\n\n用 activate_tools(names=["工具名"]) 一次性激活需要的工具。`
          }
        }

        if (activated.length === 0 && customActivations.length === 0) {
          return {
            success: false,
            message: keyword
              ? `关键词 "${args.keyword}" 未匹配到任何工具。请换中文或英文关键词（如 飞书/导出/挖空/复习/定时任务/feishu/export/cloze），或调用 activate_tools() 不带参数查看完整目录。`
              : `未找到工具: ${notFound.join(', ')}。请用 activate_tools(keyword="中文或英文关键词") 查找，或不带参数查看完整目录。`
          }
        }

        const defs = getToolsByNames(activated).filter(Boolean).map(t =>
          `${t.function.name}: ${t.function.description}\n参数: ${JSON.stringify(t.function.parameters)}`
        ).join('\n\n')
        const customDefs = customActivations.map(c =>
          `自定义工具 ${c.name}（id=${c.id}）：使用 call_custom_tool(toolId="${c.id}", arguments={...}) 调用。参数 Schema：${JSON.stringify(c.parameters || {})}`
        ).join('\n\n')
        let msg = `已激活 ${activated.length + customActivations.length} 个工具，本会话内可直接调用：\n\n${[defs, customDefs].filter(Boolean).join('\n\n')}`
        if (notFound.length > 0) msg += `\n\n未找到（请检查名称，可用 keyword 模糊查找）: ${notFound.join(', ')}`
        return { success: true, message: msg, activatedTools: activated, customTools: customActivations }
      } catch (e) {
        return { success: false, message: `激活工具失败: ${e.message}` }
      }
    }

    case 'list_mcp_servers': {
      try {
        const list = await window.electronAPI?.mcp?.list?.() || []
        return {
          success: true,
          message: list.length
            ? `已配置 ${list.length} 个 MCP 服务：\n${list.map((s, i) => `${i + 1}. ${s.name} [${s.transport}] ${s.url || s.command || ''}（${s.enabled ? '启用' : '停用'}，id=${s.id}）`).join('\n')}`
            : '尚未配置 MCP 服务。',
          servers: list
        }
      } catch (e) { return { success: false, message: `读取 MCP 服务失败: ${e.message}` } }
    }

    case 'list_mcp_tools': {
      try {
        if (!args.serverId) return { success: false, message: '请提供 serverId' }
        const tools = await window.electronAPI?.mcp?.listTools?.(args.serverId) || []
        return { success: true, message: `MCP 服务提供 ${tools.length} 个工具：\n${tools.map((t, i) => `${i + 1}. ${t.name}：${t.description || ''}`).join('\n')}`, tools }
      } catch (e) { return { success: false, message: `读取 MCP 工具失败: ${e.message}` } }
    }

    case 'mcp_call_tool': {
      try {
        if (!args.serverId || !args.toolName) return { success: false, message: '请提供 serverId 和 toolName' }
        if (!window.electronAPI?.mcp?.callTool) return { success: false, message: 'MCP 调用功能不可用' }
        const result = await window.electronAPI?.mcp?.callTool?.(args.serverId, args.toolName, args.arguments || {})
        return { success: true, message: JSON.stringify(result, null, 2), result }
      } catch (e) { return { success: false, message: `MCP 调用失败: ${e.message}` } }
    }

    case 'update_mcp_server': {
      try {
        if (!args.serverId) return { success: false, message: '请提供 serverId' }
        if (!window.electronAPI?.mcp?.update) return { success: false, message: 'MCP 更新功能不可用' }
        const patch = {}
        for (const k of ['name', 'url', 'command', 'args', 'env', 'headers', 'enabled', 'transport']) {
          if (args[k] !== undefined) patch[k] = args[k]
        }
        if (!Object.keys(patch).length) return { success: false, message: '没有提供任何要更新的字段' }
        const server = await window.electronAPI.mcp.update(args.serverId, patch)
        return { success: true, message: `已更新 MCP 服务「${server.name}」`, server }
      } catch (e) { return { success: false, message: `更新 MCP 服务失败: ${e.message}` } }
    }

    case 'list_custom_tools': {
      try {
        const list = await window.electronAPI?.customTools?.list?.() || []
        return {
          success: true,
          message: list.length
            ? `发现 ${list.length} 个自定义工具：\n${list.map((t, i) => `${i + 1}. ${t.name || t.id}（id=${t.id}，${t.enabled === false ? '停用' : '启用'}，${t.autoInvoke === true ? '自动调用' : '手动调用'}）${t.description ? '：' + t.description : ''}`).join('\n')}`
            : '尚未发现自定义工具。',
          tools: list
        }
      } catch (e) { return { success: false, message: `读取自定义工具失败: ${e.message}` } }
    }

    case 'call_custom_tool': {
      try {
        if (!args.toolId) return { success: false, message: '请提供 toolId' }
        if (!window.electronAPI?.customTools?.call) return { success: false, message: '自定义工具调用功能不可用' }
        const meta = {
          currentFilePath: typeof extraHandlers?.currentFilePath === 'function' ? extraHandlers.currentFilePath() : '',
          currentFileName: typeof extraHandlers?.currentFileName === 'function' ? extraHandlers.currentFileName() : ''
        }
        const result = await window.electronAPI.customTools.call(args.toolId, args.arguments || {}, meta)
        if (result && result.success === false) {
          return { success: false, message: result.message || '自定义工具执行失败', result }
        }
        return { success: true, message: result?.message || JSON.stringify(result), result }
      } catch (e) { return { success: false, message: `自定义工具调用失败: ${e.message}` } }
    }

    case 'update_custom_tool': {
      try {
        if (!args.toolId) return { success: false, message: '请提供 toolId' }
        if (!window.electronAPI?.customTools?.update) return { success: false, message: '自定义工具更新功能不可用' }
        const patch = {}
        for (const k of ['name', 'description', 'enabled', 'autoInvoke']) {
          if (args[k] !== undefined) patch[k] = args[k]
        }
        if (!Object.keys(patch).length) return { success: false, message: '没有提供任何要更新的字段' }
        const tool = await window.electronAPI.customTools.update(args.toolId, patch)
        return { success: true, message: `已更新自定义工具「${tool.name || tool.id}」`, tool }
      } catch (e) { return { success: false, message: `更新自定义工具失败: ${e.message}` } }
    }

    case 'list_skills': {
      try {
        const list = await window.electronAPI?.skills?.list?.() || []
        return {
          success: true,
          message: list.length
            ? `已保存 ${list.length} 个 Skill：\n${list.map((s, i) => `${i + 1}. ${s.name}：${s.description || '（无描述）'}（${s.enabled ? '启用' : '停用'}${s.autoInvoke ? '，自动调用' : ''}，id=${s.id}）`).join('\n')}`
            : '尚未保存 Skill。',
          skills: list
        }
      } catch (e) { return { success: false, message: `读取 Skill 失败: ${e.message}` } }
    }

    case 'get_skill': {
      try {
        if (!args.skillId) return { success: false, message: '请提供 skillId' }
        const list = await window.electronAPI?.skills?.list?.() || []
        const skill = list.find(s => s.id === args.skillId)
        if (!skill) return { success: false, message: '未找到该 Skill' }
        if (skill.enabled === false) return { success: false, message: '该 Skill 已停用' }
        return { success: true, message: `【${skill.name}】\n${skill.description || '（无描述）'}\n\n指令：\n${skill.instructions || '（无指令）'}`, skill }
      } catch (e) { return { success: false, message: `读取 Skill 失败: ${e.message}` } }
    }

    case 'invoke_skill': {
      try {
        if (!args.skillId) return { success: false, message: '请提供 skillId' }
        const list = await window.electronAPI?.skills?.list?.() || []
        const skill = list.find(s => s.id === args.skillId)
        if (!skill) return { success: false, message: '未找到该 Skill' }
        if (skill.enabled === false) return { success: false, message: '该 Skill 已停用' }
        return {
          success: true,
          message: `已调用 Skill「${skill.name}」。请严格按以下指令执行：\n\n${skill.instructions || '（无指令）'}`,
          skill
        }
      } catch (e) { return { success: false, message: `调用 Skill 失败: ${e.message}` } }
    }

    case 'create_skill': {
      try {
        if (!args.name || !args.instructions) return { success: false, message: '请提供 name 和 instructions' }
        const skill = await window.electronAPI?.skills?.create?.({
          name: args.name,
          description: args.description || '',
          instructions: args.instructions,
          autoInvoke: args.autoInvoke === true,
          source: 'ai'
        })
        return { success: true, message: `已创建 Skill「${skill.name}」（id=${skill.id}）`, skill }
      } catch (e) { return { success: false, message: `创建 Skill 失败: ${e.message}` } }
    }

    case 'update_skill': {
      try {
        if (!args.skillId) return { success: false, message: '请提供 skillId' }
        const patch = {}
        for (const k of ['name', 'description', 'instructions', 'autoInvoke', 'enabled']) {
          if (args[k] !== undefined) patch[k] = args[k]
        }
        const skill = await window.electronAPI?.skills?.update?.(args.skillId, patch)
        return { success: true, message: `已更新 Skill「${skill.name}」`, skill }
      } catch (e) { return { success: false, message: `更新 Skill 失败: ${e.message}` } }
    }

    case 'delete_skill': {
      try {
        if (!args.skillId) return { success: false, message: '请提供 skillId' }
        await window.electronAPI?.skills?.remove?.(args.skillId)
        return { success: true, message: 'Skill 已删除' }
      } catch (e) { return { success: false, message: `删除 Skill 失败: ${e.message}` } }
    }

    case 'add_memory': {
      try {
        if (!args.content || typeof args.content !== 'string') return { success: false, message: '请提供 content' }
        const r = addMemory(args.content, args.category, args.source || 'manual')
        return {
          success: r.success,
          message: r.success ? (r.dedup ? '记忆已存在且内容相同，自动更新使用计数（id=' + (r.item && r.item.id) + '）' : '已保存记忆（id=' + (r.item && r.item.id) + '，category=' + (r.item && r.item.category) + '）') : (r.error || '添加失败'),
          item: r.item
        }
      } catch (e) { return { success: false, message: '添加记忆失败: ' + e.message } }
    }
    case 'search_memory': {
      try {
        if (!args.query || typeof args.query !== 'string') return { success: false, message: '请提供 query' }
        const limit = Math.min(Math.max(Number(args.limit) || 8, 1), 32)
        const r = searchMemory(args.query, limit)
        if (!r.items.length) return { success: true, message: '没有匹配的记忆', items: [] }
        const lines = r.items.map(it => '【' + it.category + '】' + (it.enabled === false ? '（已禁用）' : '') + ' ' + it.content)
        return { success: true, message: '找到 ' + r.items.length + ' 条相关记忆：\n' + lines.join('\n'), items: r.items }
      } catch (e) { return { success: false, message: '搜索记忆失败: ' + e.message } }
    }
    case 'list_memory': {
      try {
        const r = listMemory({ category: args.category, enabledOnly: args.enabledOnly === true, limit: args.limit ? Number(args.limit) : undefined })
        if (!r.items.length) return { success: true, message: '当前没有记忆项（共 0 条）' }
        const lines = r.items.map(it => '【' + it.category + '】' + (it.enabled === false ? '（已禁用）' : '') + ' ' + it.content)
        return { success: true, message: '当前共 ' + r.items.length + ' 条记忆：\n' + lines.join('\n'), items: r.items, total: r.total }
      } catch (e) { return { success: false, message: '列出记忆失败: ' + e.message } }
    }
    case 'delete_memory': {
      try {
        if (!args.id) return { success: false, message: '请提供 id' }
        const r = deleteMemory(args.id)
        return { success: r.success, message: r.success ? '已删除记忆' : '未找到该 id' }
      } catch (e) { return { success: false, message: '删除记忆失败: ' + e.message } }
    }
    case 'toggle_memory': {
      try {
        if (!args.id) return { success: false, message: '请提供 id' }
        const r = toggleMemory(args.id, args.enabled !== false)
        return { success: r.success, message: r.success ? ('已' + (args.enabled !== false ? '启用' : '禁用')) : (r.error || '未找到') }
      } catch (e) { return { success: false, message: '切换记忆失败: ' + e.message } }
    }

        case 'move_node': {
      try {
        if (!mindMap) return { success: false, message: '当前没有打开的思维导图。请先调用 find_local_file(exts=["smm"]) 搜索本地导图文件（自动覆盖桌面/文档/下载/默认保存目录），再用 read_mindmap_file(filePath=...) 直接读取文件内容后继续。' }
        if (!args.uid || !args.targetParentUid) return { success: false, message: '请提供 uid 和 targetParentUid' }
        const node = mindMap.renderer.findNodeByUid(args.uid)
        const target = mindMap.renderer.findNodeByUid(args.targetParentUid)
        if (!node) return { success: false, message: `未找到 uid 为 ${args.uid} 的节点，请先用 search_nodes 查询` }
        if (!target) return { success: false, message: `未找到目标父节点 ${args.targetParentUid}` }
        if (node.isRoot) return { success: false, message: '根节点不能移动' }
        if (node === target) return { success: false, message: '不能移动到自身' }
        // 目标不能是被移动节点的子孙（会造成环）
        let p = target.parent
        while (p) {
          if (p === node) return { success: false, message: '不能把节点移动到它自己的子孙节点下' }
          p = p.parent
        }
        const nodeText = String(node.getData?.('text') || '').replace(/<[^>]+>/g, '').trim()
        const targetText = String(target.getData?.('text') || '').replace(/<[^>]+>/g, '').trim()
        mindMap.execCommand('MOVE_NODE_TO', node, target)
        if (typeof mindMap.renderer.moveNodeToCenter === 'function') {
          mindMap.renderer.moveNodeToCenter(node)
        }
        return { success: true, message: `已把「${nodeText}」移动到「${targetText}」下面（支持 Ctrl+Z 撤销）` }
      } catch (e) {
        return { success: false, message: `移动节点失败: ${e.message}` }
      }
    }

    case 'batch_move_nodes': {
      try {
        if (!mindMap) return { success: false, message: '当前没有打开的思维导图。请先调用 find_local_file(exts=["smm"]) 搜索本地导图文件（自动覆盖桌面/文档/下载/默认保存目录），再用 read_mindmap_file(filePath=...) 直接读取文件内容后继续。' }
        let sourceNodes
        if (args.targets && (args.targets.uids || args.targets.keyword || args.targets.mode)) {
          const { nodes, error } = resolveTargetNodes(mindMap, args.targets)
          if (error) return { success: false, message: `目标节点解析失败：${error}` }
          sourceNodes = nodes.filter(n => !n.isGeneralization)
        } else {
          sourceNodes = (mindMap.renderer.activeNodeList || []).filter(n => !n.isGeneralization)
        }
        if (!sourceNodes.length) return { success: false, message: '没有要移动的节点' }
        const targetUid = args.target_parent_uid || args.targetParentUid
        if (!targetUid) return { success: false, message: '请提供 target_parent_uid' }
        let moved = 0
        let skipped = 0
        for (const n of sourceNodes) {
          try {
            if (n.isRoot) { skipped++; continue }
            const uid = n.getData?.('uid') || n.uid
            const cur = mindMap.renderer.findNodeByUid(uid)
            const target = mindMap.renderer.findNodeByUid(targetUid)
            if (!cur || !target) { skipped++; continue }
            if (cur === target) { skipped++; continue }
            // 环检测：目标不能是被移动节点的子孙
            let p = target.parent
            let isDescendant = false
            while (p) { if (p === cur) { isDescendant = true; break } p = p.parent }
            if (isDescendant) { skipped++; continue }
            mindMap.execCommand('MOVE_NODE_TO', cur, target)
            moved++
          } catch (err) { skipped++; console.error('批量移动单节点失败:', err) }
        }
        return { success: true, message: `已移动 ${moved} 个节点${skipped ? `，跳过 ${skipped} 个（根/自身/子孙/未找到）` : ''}（支持 Ctrl+Z 撤销）` }
      } catch (e) {
        return { success: false, message: `批量移动失败: ${e.message}` }
      }
    }

    case 'duplicate_nodes': {
      try {
        if (!mindMap) return { success: false, message: '当前没有打开的思维导图。请先调用 find_local_file(exts=["smm"]) 搜索本地导图文件（自动覆盖桌面/文档/下载/默认保存目录），再用 read_mindmap_file(filePath=...) 直接读取文件内容后继续。' }
        let sourceNodes
        if (Array.isArray(args.uids) && args.uids.length) {
          sourceNodes = args.uids.map(uid => mindMap.renderer.findNodeByUid(uid)).filter(Boolean)
        } else {
          sourceNodes = (mindMap.renderer.activeNodeList || []).filter(n => !n.isGeneralization && !n.isRoot)
        }
        if (!sourceNodes.length) return { success: false, message: '没有要复制的节点（根节点不能复制）' }
        const targetParent = mindMap.renderer.findNodeByUid(args.target_parent_uid)
        if (!targetParent) return { success: false, message: `未找到目标父节点 ${args.target_parent_uid}` }
        // 深拷贝并重新生成全部 uid（避免与源节点冲突）
        const cloneWithNewUids = (pure) => {
          const copy = JSON.parse(JSON.stringify(pure))
          const walk = (n) => {
            if (n && typeof n === 'object') {
              if (n.data) n.data.uid = createUid()
              if (Array.isArray(n.children)) n.children.forEach(walk)
            }
          }
          walk(copy)
          return copy
        }
        const childList = sourceNodes.map(n => {
          const pure = typeof n.getPureData === 'function' ? n.getPureData() : n
          return cloneWithNewUids(pure)
        })
        setActiveNodes(mindMap, [targetParent])
        mindMap.execCommand('INSERT_MULTI_CHILD_NODE', [targetParent], childList)
        return { success: true, message: `已复制 ${sourceNodes.length} 个节点（含子树）到目标父节点下（支持 Ctrl+Z 撤销）` }
      } catch (e) {
        return { success: false, message: `复制节点失败: ${e.message}` }
      }
    }

    case 'sort_children': {
      try {
        if (!mindMap) return { success: false, message: '当前没有打开的思维导图。请先调用 find_local_file(exts=["smm"]) 搜索本地导图文件（自动覆盖桌面/文档/下载/默认保存目录），再用 read_mindmap_file(filePath=...) 直接读取文件内容后继续。' }
        const node = mindMap.renderer.findNodeByUid(args.uid)
        if (!node) return { success: false, message: `未找到 uid=${args.uid} 的节点` }
        const children = (node.children || []).filter(c => !c.isGeneralization)
        if (children.length < 2) return { success: false, message: '该节点的子节点不足 2 个，无需排序' }
        // 直接操作数据树（setData 全量刷新，简单可靠）
        const treeData = mindMap.getData()
        const targetUid = node.getData?.('uid') || node.uid
        let parentData = null
        const findData = (root) => {
          if (root?.data?.uid === targetUid) return root
          for (const c of root?.children || []) {
            const r = findData(c)
            if (r) return r
          }
          return null
        }
        parentData = findData(treeData)
        if (!parentData) return { success: false, message: '数据树中未找到该节点' }
        const kids = parentData.children || []
        const plain = (n) => nodePlainText(n.data?.text || n.text || '')
        let modeLabel = '文本'
        if (args.by === 'custom') {
          const order = Array.isArray(args.order) ? args.order : []
          if (!order.length) return { success: false, message: 'by=custom 需要提供 order 数组（uid 顺序）' }
          modeLabel = '自定义顺序'
          kids.sort((a, b) => {
            const ia = order.indexOf(a.data?.uid)
            const ib = order.indexOf(b.data?.uid)
            if (ia >= 0 && ib >= 0) return ia - ib
            if (ia >= 0) return -1
            if (ib >= 0) return 1
            return 0
          })
        } else if (args.by === 'reverse') {
          kids.reverse()
          modeLabel = '反转'
        } else {
          kids.sort((a, b) => plain(a).localeCompare(plain(b), 'zh'))
        }
        mindMap.setData(treeData)
        return { success: true, message: `已按${modeLabel}排序 ${kids.length} 个子节点` }
      } catch (e) {
        return { success: false, message: `排序失败: ${e.message}` }
      }
    }

    case 'read_node_subtree': {
      try {
        if (!mindMap) return { success: false, message: '当前没有打开的思维导图。请先调用 find_local_file(exts=["smm"]) 搜索本地导图文件（自动覆盖桌面/文档/下载/默认保存目录），再用 read_mindmap_file(filePath=...) 直接读取文件内容后继续。' }
        let node = null
        if (args.uid) {
          node = mindMap.renderer.findNodeByUid(args.uid)
          if (!node) return { success: false, message: `未找到 uid=${args.uid} 的节点，请先用 search_nodes 查询` }
        } else if (args.keyword) {
          const kw = String(args.keyword).trim().toLowerCase()
          const walk = (n) => {
            if (!n || node) return
            if (!n.isGeneralization && nodePlainText(n.getData?.('text') || '').toLowerCase().includes(kw)) { node = n; return }
            (n.children || []).forEach(walk)
          }
          walk(mindMap.renderer.root)
          if (!node) return { success: false, message: `没有找到包含「${kw}」的节点` }
        } else {
          const active = mindMap.renderer.activeNodeList || []
          if (!active.length) return { success: false, message: '请提供 uid 或 keyword' }
          node = active[0]
        }
        const pure = typeof node.getPureData === 'function' ? node.getPureData() : node
        const text = treeToText(pure)
        const cnt = countNodes(pure)
        return { success: true, message: `节点「${nodePlainText(node.getData?.('text') || '').slice(0, 40)}」（uid=${node.getData?.('uid') || node.uid}）子树共 ${cnt} 个节点：\n\n${text}` }
      } catch (e) {
        return { success: false, message: `读取子树失败: ${e.message}` }
      }
    }

    case 'get_node_detail': {
      try {
        if (!mindMap) return { success: false, message: '当前没有打开的思维导图。请先调用 find_local_file(exts=["smm"]) 搜索本地导图文件（自动覆盖桌面/文档/下载/默认保存目录），再用 read_mindmap_file(filePath=...) 直接读取文件内容后继续。' }
        let node = null
        if (args.uid) {
          node = mindMap.renderer.findNodeByUid(args.uid)
          if (!node) return { success: false, message: `未找到 uid=${args.uid} 的节点` }
        } else if (args.keyword) {
          const kw = String(args.keyword).trim().toLowerCase()
          const walk = (n) => {
            if (!n || node) return
            if (!n.isGeneralization && nodePlainText(n.getData?.('text') || '').toLowerCase().includes(kw)) { node = n; return }
            (n.children || []).forEach(walk)
          }
          walk(mindMap.renderer.root)
          if (!node) return { success: false, message: `没有找到包含「${kw}」的节点` }
        } else {
          const active = mindMap.renderer.activeNodeList || []
          if (!active.length) return { success: false, message: '请提供 uid 或 keyword' }
          node = active[0]
        }
        const data = node.getData() || {}
        const parent = node.parent
        const children = (node.children || []).filter(c => !c.isGeneralization)
        const generalization = Array.isArray(data.generalization) ? data.generalization : (data.generalization ? [data.generalization] : [])
        const detail = {
          uid: data.uid || node.uid,
          text: nodePlainText(data.text).slice(0, 200),
          isRoot: !!node.isRoot,
          parent: parent ? `${nodePlainText(parent.getData?.('text') || '').slice(0, 40)} (uid: ${parent.getData?.('uid') || parent.uid})` : '(root)',
          childCount: children.length,
          children: children.slice(0, 20).map(c => `${nodePlainText(c.getData?.('text') || '').slice(0, 30)} (uid: ${c.getData?.('uid') || c.uid})`),
          note: data.note || '',
          hasCloze: !!nodeHasCloze(node),
          hasSummary: generalization.length > 0,
          summary: generalization.map(g => nodePlainText(g?.text || '')).filter(Boolean).join('；') || '',
          hasImage: !!data.image,
          textStyles: analyzeNodeTextStyles(data.text || ''),
          style: {
            fillColor: data.fillColor || '',
            textColor: data.color || '',
            bold: data.fontWeight === 'bold',
            italic: data.fontStyle === 'italic',
            fontSize: data.fontSize || ''
          }
        }
        return { success: true, message: JSON.stringify(detail, null, 2) }
      } catch (e) {
        return { success: false, message: `获取节点详情失败: ${e.message}` }
      }
    }

    case 'rename_mindmap_file': {
      try {
        const curPath = typeof extraHandlers.currentFilePath === 'function'
          ? extraHandlers.currentFilePath() : (extraHandlers.currentFilePath || '')
        if (!curPath) return { success: false, message: '当前没有打开的文件' }
        const fsApi = window.electronAPI?.fs
        if (!fsApi || typeof fsApi.rename !== 'function') return { success: false, message: '文件重命名功能不可用' }
        let newName = String(args.new_name || '').trim().replace(/[<>:"/\\|?*]/g, '_')
        if (!newName) return { success: false, message: '请提供 new_name' }
        if (!/\.smm$/i.test(newName)) newName += '.smm'
        const dir = curPath.slice(0, curPath.lastIndexOf('\\') + 1)
        const newPath = dir + newName
        if (newPath.toLowerCase() === curPath.toLowerCase()) return { success: false, message: '新名称与当前文件名相同' }
        try {
          await fsApi.rename(curPath, newPath)
        } catch (err) {
          return { success: false, message: `重命名失败: ${err.message}` }
        }
        if (typeof extraHandlers.onFileRenamed === 'function') {
          try { extraHandlers.onFileRenamed(newPath) } catch (e) { /* 上层同步失败不影响重命名结果 */ }
        }
        return { success: true, message: `文件已重命名为「${newName}」`, newFilePath: newPath }
      } catch (e) {
        return { success: false, message: `重命名失败: ${e.message}` }
      }
    }

    case 'merge_nodes': {
      try {
        if (!mindMap) return { success: false, message: '当前没有打开的思维导图。请先调用 find_local_file(exts=["smm"]) 搜索本地导图文件（自动覆盖桌面/文档/下载/默认保存目录），再用 read_mindmap_file(filePath=...) 直接读取文件内容后继续。' }
        const uids = (Array.isArray(args.uids) ? args.uids : [args.uids]).filter(Boolean)
        if (uids.length < 2) return { success: false, message: '合并至少需要 2 个节点 uid' }
        const sep = args.separator === 'newline' ? '\n' : (args.separator || '、')
        const nodes = uids.map(uid => mindMap.renderer.findNodeByUid(uid))
        if (nodes.some(n => !n)) {
          return { success: false, message: `有 ${nodes.filter(n => !n).length} 个 uid 未找到对应节点，请先用 search_nodes 查询` }
        }
        if (nodes.some(n => n.isRoot)) return { success: false, message: '根节点不能参与合并' }
        const plainText = (n) => String(n.getData?.('text') || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
        const keep = nodes[0]
        const others = nodes.slice(1)
        const mergedText = nodes.map(plainText).filter(Boolean).join(sep)
        if (!mergedText) return { success: false, message: '这些节点都没有文本，无需合并' }

        // 子节点先归并到保留节点（数据树操作 + 渲染），再删多余节点、改文本（均入命令栈可撤销）
        const treeData = mindMap.getData()
        const findData = (node, root) => {
          if (root.data?.uid === node.getData?.('uid')) return root
          for (const c of root.children || []) {
            const r = findData(node, c)
            if (r) return r
          }
          return null
        }
        let movedChildren = 0
        const keepData = findData(keep, treeData)
        for (const other of others) {
          const otherData = findData(other, treeData)
          if (!otherData || !keepData) continue
          if (otherData.parent === keepData) continue // 已是保留节点的子节点，随删除自然归位
          for (const c of otherData.children || []) {
            keepData.children = keepData.children || []
            keepData.children.push(c)
            movedChildren++
          }
          otherData.children = []
        }
        mindMap.setData(treeData)

        // 选中并删除多余节点（REMOVE_NODE 走命令栈）
        if (typeof mindMap.renderer.clearActiveNode === 'function') mindMap.renderer.clearActiveNode()
        for (const other of others) {
          const live = mindMap.renderer.findNodeByUid(other.getData?.('uid'))
          if (live && typeof mindMap.renderer.addNodeToActiveList === 'function') {
            mindMap.renderer.addNodeToActiveList(live)
          }
        }
        mindMap.execCommand('REMOVE_NODE')

        // 保留节点改为合并文本（setText 第二参数 true = 入命令栈）
        const keepLive = mindMap.renderer.findNodeByUid(keep.getData?.('uid'))
        if (keepLive && typeof keepLive.setText === 'function') {
          keepLive.setText(`<p><span>${mergedText.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>')}</span></p>`, true)
        }
        mindMap.render()
        if (typeof mindMap.renderer.moveNodeToCenter === 'function' && keepLive) {
          mindMap.renderer.moveNodeToCenter(keepLive)
        }
        return {
          success: true,
          message: `已合并 ${nodes.length} 个节点为「${mergedText.slice(0, 60)}」${movedChildren > 0 ? `，归并 ${movedChildren} 个子节点` : ''}（注意：本操作不可用 Ctrl+Z 撤销，如需回退请勿保存并重新打开文件）`
        }
      } catch (e) {
        return { success: false, message: `合并节点失败: ${e.message}` }
      }
    }

    case 'scheduled_task': {
      try {
        const action = args.action || 'list'
        if (!taskSchedulerService.isAvailable()) return { success: false, message: '当前环境不支持定时任务（需要 Electron 环境）' }
        if (action === 'create') {
          if (!args.name || !args.prompt || !args.datetime || !args.cycle) return { success: false, message: '请提供 name、prompt、datetime、cycle 四个参数' }
          if (!/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(args.datetime)) return { success: false, message: 'datetime 格式应为 YYYY-MM-DD HH:mm，如 2026-08-15 20:00' }
          if (!['once', 'daily', 'weekly', 'monthly'].includes(args.cycle)) return { success: false, message: 'cycle 只能是 once / daily / weekly / monthly' }
          const result = await taskSchedulerService.create({ name: String(args.name).slice(0, 50), prompt: String(args.prompt), datetime: args.datetime.replace('T', ' ').slice(0, 16), cycle: args.cycle })
          if (result && result.success) {
            const cycleLabel = { once: '单次', daily: '每天', weekly: '每周', monthly: '每月' }[args.cycle]
            return { success: true, message: `定时任务已创建：「${args.name}」 ${cycleLabel} ${args.datetime.slice(11)} 触发。触发时将自动打开应用并让 AI 执行：${args.prompt.slice(0, 60)}` }
          }
          return { success: false, message: `创建定时任务失败: ${result?.message || result?.error || '未知错误'}` }
        }
        if (action === 'delete') {
          const taskId = String(args.task_id || args.taskId || '').trim()
          if (!taskId) return { success: false, message: '请提供 task_id（从 action=list 获取）' }
          const all = await taskSchedulerService.getAll()
          const existing = (all || {})[taskId]
          const result = await taskSchedulerService.delete(taskId)
          if (result && result.success) return { success: true, message: `已删除定时任务${existing ? `「${existing.name}」` : ' ' + taskId}，该任务将不再触发。` }
          return { success: false, message: `删除定时任务失败: ${result?.error || '未知错误'}` }
        }
        if (action === 'update') {
          const taskId = String(args.task_id || args.taskId || '').trim()
          if (!taskId) return { success: false, message: '请提供 task_id（从 action=list 获取）' }
          const all = await taskSchedulerService.getAll()
          const existing = (all || {})[taskId]
          if (!existing) return { success: false, message: `未找到任务 ${taskId}，请先调用 action=list 确认 taskId` }
          const next = { taskId, name: String(args.name || existing.name).slice(0, 50), prompt: String(args.prompt || existing.prompt), datetime: String(args.datetime || existing.datetime).replace('T', ' ').slice(0, 16), cycle: args.cycle || existing.cycle, enabled: typeof args.enabled === 'boolean' ? args.enabled : existing.enabled !== false }
          if (!/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(next.datetime)) return { success: false, message: 'datetime 格式应为 YYYY-MM-DD HH:mm，如 2026-08-15 20:00' }
          if (!['once', 'daily', 'weekly', 'monthly'].includes(next.cycle)) return { success: false, message: 'cycle 只能是 once / daily / weekly / monthly' }
          const result = await taskSchedulerService.update(next)
          if (result && result.success) {
            const changes = []
            if (args.name && args.name !== existing.name) changes.push(`名称→「${next.name}」`)
            if (args.prompt && args.prompt !== existing.prompt) changes.push('提示词已更新')
            if (args.datetime && next.datetime !== existing.datetime) changes.push(`时间→${next.datetime}`)
            if (args.cycle && args.cycle !== existing.cycle) changes.push(`周期→${next.cycle}`)
            if (typeof args.enabled === 'boolean') changes.push(args.enabled ? '已启用' : '已暂停')
            return { success: true, message: `定时任务「${next.name}」已更新${changes.length ? '：' + changes.join('、') : ''}。` }
          }
          let rollbackNote = ''
          try {
            const rb = await taskSchedulerService.create({ name: existing.name, prompt: existing.prompt, datetime: existing.datetime, cycle: existing.cycle, enabled: existing.enabled !== false })
            rollbackNote = rb && rb.success ? '（原任务已自动重建恢复，taskId 可能已变化，请重新 list 确认）' : '（回滚失败，原任务配置：' + `${existing.name} / ${existing.datetime} / ${existing.cycle}，可用 action=create 手动重建）`
          } catch {
            rollbackNote = '（回滚异常，可用 action=create 按 taskSchedulerService 记录重建）'
          }
          return { success: false, message: `更新定时任务失败: ${result?.error || '未知错误'}${rollbackNote}` }
        }
        const all = await taskSchedulerService.getAll()
        let systemIds = []
        try { systemIds = await taskSchedulerService.list() } catch { /* ignore */ }
        const tasks = Object.values(all || {})
        if (tasks.length === 0) return { success: true, message: '当前没有任何定时任务。可用 action=create 创建。' }
        const cycleLabel = { once: '单次', daily: '每天', weekly: '每周', monthly: '每月' }
        const idSet = new Set(systemIds || [])
        const lines = tasks.sort((a, b) => String(a.datetime || '').localeCompare(String(b.datetime || ''))).map(t => {
          const status = t.enabled === false ? '已暂停' : (idSet.has(t.taskId) ? '启用中' : '⚠️系统任务缺失（可用 update 修复重建）')
          return `- [${t.taskId}] ${t.name}\n  时间：${t.datetime}（${cycleLabel[t.cycle] || t.cycle}）｜状态：${status}\n  提示词：${String(t.prompt || '').slice(0, 80)}`
        })
        return { success: true, message: `共 ${tasks.length} 个定时任务（taskId 用于 action=update/delete）：\n\n${lines.join('\n\n')}`, tasks }
      } catch (e) {
        return { success: false, message: `定时任务操作失败: ${e.message}` }
      }
    }

    case 'find_local_file': {
      try {
        if (!window.electronAPI?.fs?.findFile) {
          return { success: false, message: '文件搜索不可用' }
        }
        const keyword = String(args.keyword || '').trim()
        const dirs = Array.isArray(args.dirs) && args.dirs.length ? args.dirs : undefined
        const r = await window.electronAPI.fs.findFile({
          keyword: keyword || '*',
          exts: Array.isArray(args.exts) ? args.exts : undefined,
          dirs,
          // onlyDirs=true 时只搜 dirs 指定目录，不再追加桌面/文档/下载等默认范围（MCP 范围限制）
          onlyDirs: args.onlyDirs === true,
          listMode: !keyword
        })
        if (!r || !r.success) {
          return { success: false, message: `搜索失败：${r?.error || '文件系统不可用'}` }
        }
        const list = r.results || []
        if (list.length === 0) {
          return {
            success: true,
            message: `常用目录（${(r.searchedDirs || []).join('、')}）里没有找到文件名含"${keyword || '*'}"${args.exts ? `且扩展名为 ${args.exts.join('/')}` : ''}的文件。${r.timedOut ? '（部分目录较大，搜索超时截断，可换更具体的关键词重试）' : ''}可让用户确认文件名或提供路径。`
          }
        }
        const lines = list.map((f, i) => `${i + 1}. ${f.path}（${f.size} 字节，${f.mtime}）`)
        if (args.open && list[0]?.path && window.electronAPI?.fs?.openFile) {
          try { await window.electronAPI.fs.openFile(list[0].path) } catch (e) {}
        }
        return {
          success: true,
          message: `找到 ${list.length} 个匹配文件：\n${lines.join('\n')}${r.timedOut ? '\n（部分目录较大，结果可能不全）' : ''}\n完整路径已在上方列出；${args.open && list[0] ? `已自动打开：${list[0].path}` : '如需打开，请用 open=true 或使用系统默认程序打开。'}`
        }
      } catch (e) {
        return { success: false, message: `文件搜索失败: ${e.message}` }
      }
    }

    case 'context_window': {
      try {
        const action = args.action || 'list'
        if (action === 'set') {
          const r = setContextWindow(args.model, args.context_window)
          if (!r.success) return { success: false, message: r.error }
          return { success: true, message: `已将模型「${r.model}」的上下文窗口设为 ${r.context_window} token（写入用户自定义层）` }
        }
        if (action === 'delete') {
          const r = deleteContextWindow(args.model)
          if (!r.success) return { success: false, message: r.error }
          return { success: true, message: `已删除模型「${r.model}」的自定义窗口记录，将回退到内置表或兜底默认值` }
        }
        if (action === 'get') {
          const r = queryContextWindow(args.model)
          if (!r.success) return { success: false, message: r.error }
          const srcLabel = { user: '用户自定义', builtin: '内置参考值', default: '兜底默认值' }[r.source] || r.source
          return { success: true, message: `模型「${r.model}」的上下文窗口为 ${r.context_window} token（来源：${srcLabel}）` }
        }
        const all = listAllContextWindows()
        if (all.length === 0) return { success: true, message: '模型窗口表为空' }
        const user = all.filter(x => x.source === 'user')
        const builtin = all.filter(x => x.source === 'builtin')
        const fmt = (x) => `${x.model}=${x.context_window}`
        return {
          success: true,
          message: `模型上下文窗口表（共 ${all.length} 个，单位 token）\n\n【用户自定义 ${user.length} 个】\n${user.length ? user.map(fmt).join('、') : '无'}\n\n【内置参考值 ${builtin.length} 个】\n${builtin.map(fmt).join('、')}`
        }
      } catch (e) {
        return { success: false, message: `窗口操作失败: ${e.message}` }
      }
    }

    case 'retrieve_local_file': {
      try {
        const filePath = String(args.file_path || args.filePath || '').trim()
        const query = String(args.query || args.question || '').trim()
        if (!filePath) return { success: false, message: '请提供 file_path（文件绝对路径）' }
        if (!query) return { success: false, message: '请提供 query（用户的问题）用于语义检索' }
        if (!window.electronAPI?.fs?.readFile) return { success: false, message: '文件系统不可用' }
        let resolvedPath = filePath
        const exists = await window.electronAPI.fs.exists(filePath)
        if (!exists) {
          // 路径自动纠错：用文件名模糊搜索，唯一命中直接继续，多个命中返回候选，未命中才报错
          const auto = await resolveFilePathAuto(filePath)
          if (auto.resolved) {
            resolvedPath = auto.resolved
          } else if (auto.candidates && auto.candidates.length > 1) {
            return { success: false, message: `文件不存在：${filePath}。已按文件名自动搜索，找到多个候选（请选一个使用）：\n${auto.candidates.map((p, i) => `${i + 1}. ${p}`).join('\n')}` }
          } else if (auto.candidates && auto.candidates.length === 1) {
            resolvedPath = auto.candidates[0]
          } else {
            return { success: false, message: '文件不存在：' + filePath }
          }
        }
        const ext = resolvedPath.split('.').pop().toLowerCase()
        const supported = ['txt', 'md', 'markdown', 'json', 'log', 'csv', 'tsv', 'html', 'xml', 'docx', 'pdf', 'xlsx', 'xls']
        // 代码文件走纯文本读取
        const codeExts = COMMON_CODE_EXTS
        if (!supported.includes(ext) && !codeExts.includes(ext)) return { success: false, message: '语义检索暂不支持 .' + ext + '，请改用 read_local_file 读取' }
        let res = await extractLocalDocTextCached(resolvedPath, ext)
        if (!res.success) {
          // 扫描版/图片型 PDF 无文本层：优先走 files API 多模态读取全文，再据此语义检索
          if (res.noTextLayer && ext === 'pdf') {
            const fileName = resolvedPath.split(/[\\/]/).pop()
            const visionRes = await readLocalFileViaVisionAPI(resolvedPath, fileName, 'application/pdf',
              '请提取该 PDF 文件中的全部文字内容，按原文顺序逐页输出，保留标题层级与段落结构；若是扫描版，请先识别页面中的文字。不要添加解释或总结。')
            if (visionRes) {
              res = { success: true, text: visionRes.text, source: visionRes.source }
            } else {
              return { success: false, message: '该 PDF 没有可提取的文本层（扫描版/图片型），且 files API 多模态不可用，无法语义检索。可用 read_local_file 走 OCR 兜底（较慢），或改用 docx/md 版本。' }
            }
          } else {
            return { success: false, message: '文本提取失败：' + res.error }
          }
        }
        const topK = Math.min(Math.max(Number(args.top_k) || 6, 1), 12)
        // 章节感知：query 含「第X章/第X节」且文档有对应标题时，直接返回该章节连续完整内容（优于碎片语义检索）
        const sectionText = extractSectionByHeading(res.text, query)
        if (sectionText) {
          return {
            success: true,
            message: '已从「' + resolvedPath + '」中定位到目标章节，返回其完整内容：\n\n' + sectionText + '\n\n（以上为该章节连续原文，通常足以完成总结/生成，无需再次检索。）'
          }
        }
        const hits = retrieveRelevantChunks(res.text, query, topK)
        if (!hits.length) {
          return { success: true, message: '已在「' + resolvedPath + '」全文范围内检索，未找到与「' + query + '」明显相关的内容。可换关键词重试，或用 read_local_file 查看全文。' }
        }
        const totalChunks = chunkDocument(res.text).length
        const blocks = hits.map((h, idx) => '【相关片段 ' + (idx + 1) + '】\n' + h.text).join('\n\n---\n\n')
        return {
          success: true,
          message: '已从「' + resolvedPath + '」（共 ' + totalChunks + ' 个片段）中语义检索到 ' + hits.length + ' 个与「' + query + '」最相关的片段：\n\n' + blocks + '\n\n（以上片段已覆盖该主题的核心内容，通常足以完成总结/生成，无需对同一文件重复检索；确需补充细节时再换关键词检索一次。）'
        }
      } catch (e) {
        return { success: false, message: '语义检索失败: ' + (e.message || e) }
      }
    }

    case 'read_local_file': {
      try {
        const filePath = String(args.file_path || args.filePath || '').trim()
        if (!filePath) return { success: false, message: '请提供 file_path（文件绝对路径）' }
        // 安全防护：禁止读取应用自身的敏感配置文件（config.json 含 API 密钥、飞书 appSecret、微信/机器人 token 等）
        const _base = filePath.split(/[/\\]/).pop().toLowerCase()
        if (_base === 'config.json') {
          return { success: false, message: '该文件是应用自身的敏感配置（含 API 密钥、机器人令牌等），禁止 AI 读取。如需修改模型/MCP/工具配置，请使用专用工具（list_mcp_servers / update_mcp_server / list_custom_tools / update_custom_tool）。' }
        }
        // 模型容易把网页链接误传给“读本地文件”：自动改走网页正文读取，避免无意义失败。
        if (/^https?:\/\//i.test(filePath)) {
          const page = await readWebpage(filePath)
          const head = `检测到 http 链接，已自动调用网页正文读取（而非本地文件读取）${page.title ? `「${page.title}」` : ''}：\n\n`
          const tail = page.truncated ? '\n\n（正文过长，已截断，前文为主要内容）' : ''
          return { success: true, message: head + page.content + tail }
        }
        if (!window.electronAPI?.fs?.readFile) {
          return { success: false, message: '文件系统不可用' }
        }
        const exists = await window.electronAPI.fs.exists(filePath)
        if (!exists) {
          const baseName = filePath.split(/[/\\]/).pop().replace(/\.[^.]+$/, '')
          return { success: false, message: `文件不存在：${filePath}。禁止继续猜测其他路径（每台电脑的用户名和目录都不同），请立即调用 find_local_file(keyword="${baseName}") 在当前电脑的常用目录中搜索定位，再用返回的 path 读取` }
        }

        const ext = filePath.split('.').pop().toLowerCase()
        const fileName = filePath.split(/[/\\]/).pop()
        const offset = Math.max(0, Number(args.offset) || 0)
        const maxChars = Math.min(Math.max(Number(args.max_chars) || 50000, 200), 200000)

        let text = '', source = ''
        if (['txt', 'md', 'markdown', 'json', 'log', 'html', 'xml'].includes(ext)) {
          text = await window.electronAPI.fs.readFile(filePath)
          source = ext === 'md' || ext === 'markdown' ? 'Markdown 文本' : '纯文本'
        } else if (ext === 'smm') {
          const content = await window.electronAPI.fs.readFile(filePath)
          let treeData
          try { treeData = JSON.parse(content) } catch {
            return { success: false, message: `文件格式错误（不是有效的 .smm）：${filePath}` }
          }
          text = treeToText(treeData)
          source = '思维导图大纲文本'
        } else if (['docx', 'xlsx', 'xls', 'csv', 'tsv', 'pptx'].includes(ext)) {
          // 统一解析器：docx(mammoth) / xlsx(exceljs) / xls(SheetJS) / csv·tsv(papaparse) / pptx(jszip+xml)；优先命中缓存
          const res = await extractLocalDocTextCached(filePath, ext)
          if (!res.success) return { success: false, message: `${ext} 解析失败: ${res.error}` }
          text = res.text
          source = ext === 'docx'
            ? 'Word 文档提取文本'
            : ext === 'xlsx'
              ? `Excel 表格（${res.meta.sheets} 个工作表 / ${res.meta.rows} 行）`
              : ext === 'xls'
                ? `Excel 表格·旧版 xls（${res.meta.sheets} 个工作表 / ${res.meta.rows} 行）`
                : ext === 'pptx'
                  ? `PowerPoint 演示文稿（${res.meta.slides} 张幻灯片）`
                  : `${ext.toUpperCase()} 表格（${res.meta.rows} 行）`
        } else if (ext === 'pdf') {
          // 优先走 files API 多模态：无论扫描版/图片型 PDF，都先发给视觉模型直读
          const visionRes = await readLocalFileViaVisionAPI(filePath, fileName, 'application/pdf',
            '请提取该 PDF 文件中的全部文字内容，按原文顺序逐页输出，保留标题层级与段落结构；若是扫描版，请先识别页面中的文字。不要添加解释或总结。')
          if (!visionRes) {
          // 降级本地文本提取：优先命中缓存（文档在查看器打开时已预提取），避免每次重新解析全文导致 Agent 读取慢
          const res = await extractLocalDocTextCached(filePath, ext)
          if (res.success) {
            text = res.text
            source = `PDF 提取文本${res.meta?.pages ? `（${res.meta.pages} 页）` : ''}`
          } else {
            // OCR 兜底：文本层不可提取（扫描版 / CID 中文 PDF）时渲染为图片逐页识别
            // 识别优先走多模态（ocr-smart 内部判断 vision.enabled），未开启/失败自动降级本地 tesseract
            if (!window.electronAPI?.ocrSmart) {
              return { success: false, message: `pdf 提取失败: ${res.error}（且当前环境不支持 OCR 兜底）` }
            }
            // 页码范围优先级：ocr_all（全文）> page_end（精确范围）> 默认 8 页
            const pageOpts = { scale: 2 }
            if (args.ocr_all) {
              pageOpts.pageEnd = 999999 // pdfToImages 内部会 clamp 到总页数
            } else {
              if (args.page_start) pageOpts.pageStart = Number(args.page_start)
              if (args.page_end != null) pageOpts.pageEnd = Number(args.page_end)
              else if (Number(args.max_chars) >= 50000) pageOpts.pageEnd = 999999
            }
            // 扫描版 PDF 转图片前重新读一次二进制（parseDocument 内部只返回文本）
            if (!window.electronAPI?.fs?.readBinary) return { success: false, message: '文件系统不支持二进制读取' }
            const binPdf = await window.electronAPI.fs.readBinary(filePath)
            if (!binPdf.success) return { success: false, message: `读取 pdf 失败: ${binPdf.error}` }
            const bufPdf = Uint8Array.from(atob(binPdf.base64), c => c.charCodeAt(0))
            const img = await pdfToImages(bufPdf.buffer, pageOpts)
            if (!img.success || !img.pages?.length) {
              return { success: false, message: `pdf 提取失败: ${res.error}（转图片也失败: ${img.error || '无页面'}）` }
            }
            const parts = []
            let visionFailedReason = null
            let cursor = 0
            const ocrWorker = async () => {
              while (cursor < img.pages.length) {
                const i = cursor++
                const ocr = await window.electronAPI.ocrSmart(img.pages[i], 'chi_sim+eng')
                if (ocr && ocr.success && ocr.text) parts.push(ocr.text.trim())
                if (ocr && ocr.fallback_from === 'ai_vision' && !visionFailedReason) {
                  visionFailedReason = ocr.fallback_reason || '多模态模型调用失败'
                }
              }
            }
            await Promise.all(Array.from({ length: Math.min(3, img.pages.length) }, () => ocrWorker()))
            if (!parts.length) {
              return { success: false, message: `pdf 提取与 OCR 均未能识别文字，可能为图片质量过低的扫描版` }
            }
            const rangeDesc = img.renderedPages === img.totalPages
              ? `全部 ${img.totalPages} 页`
              : `第 ${img.pageStart}~${img.pageEnd} 页（共 ${img.totalPages} 页）`
            const visionNote = visionFailedReason ? `；多模态失败（${visionFailedReason}），已降级本地 OCR` : ''
            text = parts.join('\n\n')
            source = `PDF 识别（${rangeDesc}${visionNote}）`
          }
          } else {
            text = visionRes.text
            source = visionRes.source
          }
        } else if (['png', 'jpg', 'jpeg', 'bmp', 'webp'].includes(ext)) {
          // 优先走 files API 多模态：无论图片是否含文字，都先发给视觉模型直读
          const imgMime = 'image/' + (ext === 'jpg' || ext === 'jpeg' ? 'jpeg' : ext)
          const visionRes = await readLocalFileViaVisionAPI(filePath, fileName, imgMime,
            '请识别该图片中的全部文字内容，按原文顺序输出；若图片中没有文字，请如实说明。不要添加解释或总结。')
          if (!visionRes) {
          // 降级本地 OCR
          if (!window.electronAPI?.ocrSmart) return { success: false, message: '多模态与 OCR 功能均不可用' }
          if (!window.electronAPI?.fs?.readBinary) return { success: false, message: '文件系统不支持二进制读取' }
          const bin = await window.electronAPI.fs.readBinary(filePath)
          if (!bin.success) return { success: false, message: `读取图片失败: ${bin.error}` }
          const res = await window.electronAPI.ocrSmart(bin.base64, 'chi_sim+eng')
          if (res && res.success && res.text) {
            text = res.text
            const srcLabel = res.source === 'ai_vision' ? '多模态识别' : 'OCR 识别'
            source = `图片 ${srcLabel} 文本`
          } else {
            const fallback = res?.fallback_reason ? `（多模态失败: ${res.fallback_reason}）` : ''
            return { success: false, message: `图片识别失败${fallback}: ${res?.error || '（图片中可能没有文字或识别失败）'}` }
          }
          } else {
            text = visionRes.text
            source = visionRes.source
          }
        } else {
          // 代码文件（.py / .js / .ts 等）走纯文本读取，避免让 AI 误以为无法读取
          const codeExts = COMMON_CODE_EXTS
          if (codeExts.includes(ext)) {
            if (!window.electronAPI?.fs?.readFile) {
              return { success: false, message: '文件系统不可用，无法读取代码文件' }
            }
            const exists = await window.electronAPI.fs.exists(filePath)
            if (!exists) {
              return { success: false, message: `文件不存在：${filePath}` }
            }
            // review A5：保留全文件 readFile 行为以保证向后兼容，但当文件 > 500KB 时在 message 提示 AI
            // 用 offset/max_chars 分次读取（避免单次 IPC 几百 KB 阻塞渲染线程）。
            text = await window.electronAPI.fs.readFile(filePath)
            const fileSize = await getCodeFileSize(filePath)
            if (fileSize > CODE_FILE_HINT_THRESHOLD) {
              // 把"请分次读取"的提示附在尾部，AI 工具 result 里能看到
              text = text + `\n\n【系统提示】文件较大（约 ${Math.round(fileSize / 1024)} KB），后续请用 read_local_file(file_path=..., offset=N, max_chars=50000) 分段读取。也可改用 read_local_file_lines(start_line=A, end_line=B) 按行精读。`
            }
            source = `代码文件（${ext}）`
          } else {
            return { success: false, message: `不支持的文件类型 .${ext}。支持：txt/md/json/log/html/xml/docx/xlsx/xls/csv/tsv/pdf/pptx/ppt/smm 及常见图片（OCR），以及代码文件：${codeExts.join('/')}` }
          }
        }

        const total = text.length
        let shown = text.slice(offset, offset + maxChars)
        let note = ''
        if (offset > 0 || offset + maxChars < total) {
          note = `\n\n【分段提示】全文共 ${total} 字符，当前返回第 ${offset}~${Math.min(offset + maxChars, total)} 字符。需要后续内容时用 offset=${Math.min(offset + maxChars, total)} 继续读取。`
        }
        // 后台索引到本地知识库：AI 读过的文档可被 search_knowledge_base / semantic_search 检索到（失败静默）
        indexDocumentInBackground(filePath, fileName, ext, text)
        return {
          success: true,
          message: `文件"${fileName}"（${source}，共 ${total} 字符）：\n\n${shown}${note}`,
          filePath,
          fileName,
          totalChars: total
        }
      } catch (e) {
        return { success: false, message: `读取文件失败: ${e.message}` }
      }
    }

    case 'import_file_as_mindmap': {
      try {
        let filePath = String(args.file_path || args.filePath || '').trim()
        if (!filePath) return { success: false, message: '请提供 file_path（源文件绝对路径）' }
        if (!window.electronAPI?.fs?.readFile) {
          return { success: false, message: '文件系统不可用' }
        }
        // 相对路径（如 test-assets\xx.md）按主进程工作目录绝对化，保证后续保存目录计算正确
        filePath = await toAbsPath(filePath) || filePath
        const exists = await window.electronAPI.fs.exists(filePath)
        if (!exists) {
          const baseName = filePath.split(/[/\\]/).pop().replace(/\.[^.]+$/, '')
          return { success: false, message: `文件不存在：${filePath}。禁止继续猜测其他路径（每台电脑的用户名和目录都不同），请立即调用 find_local_file(keyword="${baseName}") 在当前电脑的常用目录中搜索定位，再用返回的 path 导入` }
        }

        const ext = filePath.split('.').pop().toLowerCase()
        const fileName = filePath.split(/[/\\]/).pop()
        const baseName = fileName.replace(/\.[^.]+$/, '')
        let treeData = null
        let fmtLabel = ''

        if (ext === 'smm') {
          return { success: false, message: '该文件本身就是思维导图（.smm），无需导入。可直接在文件树中打开。' }
        } else if (ext === 'md' || ext === 'markdown' || ext === 'txt') {
          const content = await window.electronAPI.fs.readFile(filePath)
          treeData = parseMarkdownToTree(content)
          // 解析器无结构输入时根节点是占位名（空导图/思维导图），替换为文件名
          const rootPlain = String(treeData?.data?.text || '').replace(/<[^>]+>/g, '').trim()
          if (!rootPlain || rootPlain === '空导图' || rootPlain === '思维导图') {
            const safeRoot = baseName.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            treeData.data.text = `<p><span>${safeRoot}</span></p>`
          }
          fmtLabel = ext === 'txt' ? '纯文本（按行转节点）' : 'Markdown'
        } else if (ext === 'opml' || ext === 'xml') {
          const content = await window.electronAPI.fs.readFile(filePath)
          const res = parseOpmlToTree(content, baseName)
          if (!res.success) return { success: false, message: res.error }
          treeData = res.tree
          fmtLabel = 'OPML 大纲'
        } else if (ext === 'mm') {
          const content = await window.electronAPI.fs.readFile(filePath)
          const res = parseFreemindToTree(content, baseName)
          if (!res.success) return { success: false, message: res.error }
          treeData = res.tree
          fmtLabel = 'FreeMind'
        } else if (ext === 'xmind') {
          if (!window.electronAPI?.openFile) return { success: false, message: '文件系统不可用' }
          const opened = await window.electronAPI.openFile(filePath)
          if (!opened.success || !opened.isXmind) {
            return { success: false, message: `读取 XMind 文件失败: ${opened.error || '不是有效的 .xmind 文件'}` }
          }
          treeData = await parseXmindBase64(opened.data, fileName)
          if (!treeData) return { success: false, message: 'XMind 文件解析失败（可能版本过旧或结构特殊）' }
          fmtLabel = 'XMind'
        } else {
          return { success: false, message: `不支持的导入格式 .${ext}。支持：md / txt / opml / mm(FreeMind) / xmind` }
        }

        ensureRichText(treeData)
        const nodeCount = countNodes(treeData)
        if (nodeCount < 1) return { success: false, message: '解析后没有有效节点，导入中止' }

        // 保存 .smm：三级回落（指定目录 → 源文件所在目录 → 默认保存目录），失败时透传真实错误
        const rootText = String(treeData.data.text || '').replace(/<[^>]+>/g, '').trim() || baseName
        const safeName = rootText.replace(/[<>:"/\\|?*]/g, '_').slice(0, 50)
        const outName = `${safeName}.smm`
        const srcDir = filePath.replace(/[/\\][^/\\]+$/, '')
        const saveData = JSON.stringify(treeData, null, 2)
        const candidateDirs = []
        if (args.save_dir) candidateDirs.push(String(args.save_dir))
        candidateDirs.push(srcDir, '') // '' = 默认保存目录（纯文件名）
        let savedPath = null
        const saveErrors = []
        if (window.electronAPI?.saveFile) {
          for (const dir of candidateDirs) {
            const target = dir
              ? dir.replace(/[\\/]+$/, '') + (/\\/.test(dir) ? '\\' : '/') + outName
              : outName
            try {
              const r = await window.electronAPI.saveFile(target, saveData)
              if (r && r.success) {
                savedPath = r.filePath
                break
              }
              if (r && r.error) saveErrors.push(`${target} → ${r.error}`)
            } catch (e) {
              saveErrors.push(`${target} → ${e.message}`)
            }
          }
        }

        let extra = ''
        if (args.open) {
          if (!mindMap) {
            extra = '（画布不可用，未能打开）'
          } else {
            mindMap.setData(treeData)
            extra = '，已加载到当前画布（如需撤销可 Ctrl+Z）'
          }
        }

        const uidMap = buildUidMap(treeData)
        const uidSection = uidMap.text
          ? `\n\n节点UID清单（可直接用于 batch_node_actions / select_node 的 uids 参数）：\n${uidMap.text}${uidMap.truncated ? `\n（共 ${uidMap.total} 个节点，以上仅列出前 ${uidMap.nodes.length} 个，其余用 search_nodes 定位）` : ''}`
          : ''

        return {
          success: true,
          message: `已导入${fmtLabel}文件"${fileName}"为思维导图：${nodeCount} 个节点${savedPath ? `，已保存为 ${savedPath}` : `（保存失败，内容已在内存中。真实原因：${saveErrors.join('；') || '文件系统不可用'}）`}${extra}${uidSection}`,
          filePath: savedPath,
          fileName: outName,
          nodeCount,
          nodes: uidMap.nodes,
          saveErrors: saveErrors.length ? saveErrors : undefined
        }
      } catch (e) {
        return { success: false, message: `导入失败: ${e.message}` }
      }
    }

    case 'list_references': {
      try {
        // 收集一棵树里全部引用链接（节点富文本中的 <a href="mindmap-file:...">）
        const collectFromTree = (tree, sourceLabel, out) => {
          const walk = (node) => {
            if (!node || !node.data) return
            const html = String(node.data.text || '')
            const re = /<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi
            let m
            while ((m = re.exec(html)) !== null) {
              if (!isReferenceLink(m[1])) continue
              const ref = parseReferenceLink(m[1])
              const linkText = m[2].replace(/<[^>]+>/g, '').trim()
              out.push({
                sourceFile: sourceLabel,
                nodeUid: node.data.uid,
                nodePath: getNodePath(tree, node.data.uid) || linkText,
                linkText,
                href: m[1],
                type: ref.type,
                targetFile: ref.filePath,
                targetNodeUid: ref.nodeUid
              })
            }
            ;(node.children || []).forEach(walk)
          }
          walk(tree)
        }

        // 目标文件存在性 + 节点 uid 存在性检查（带缓存，避免重复读盘）
        const existsCache = new Map()
        const uidCache = new Map()
        const checkTarget = async (ref) => {
          if (!existsCache.has(ref.targetFile)) {
            existsCache.set(ref.targetFile, await refFileExists(ref.targetFile))
          }
          const fileOk = existsCache.get(ref.targetFile)
          if (!fileOk) return { fileOk: false, nodeOk: null }
          if (ref.type !== 'node' || !ref.targetNodeUid) return { fileOk: true, nodeOk: null }
          if (!uidCache.has(ref.targetFile)) {
            let uids = null
            try {
              const content = await window.electronAPI.fs.readFile(ref.targetFile)
              const data = JSON.parse(content)
              const set = new Set()
              const walk = (n) => {
                if (n?.data?.uid) set.add(n.data.uid)
                ;(n.children || []).forEach(walk)
              }
              walk(data)
              uids = set
            } catch {
              uids = new Set()
            }
            uidCache.set(ref.targetFile, uids)
          }
          return { fileOk: true, nodeOk: uidCache.get(ref.targetFile).has(ref.targetNodeUid) }
        }

        const filterFile = String(args.file_path || args.filePath || '').trim().toLowerCase()
        const refs = []

        // 来源一：当前导图
        if (mindMap) {
          collectFromTree(mindMap.getData(), '当前导图', refs)
        }
        // 来源二（scope=all）：保存目录下全部导图文件
        if (args.scope === 'all' && window.electronAPI?.fs?.readFile) {
          const files = await refScanFiles()
          for (const f of files) {
            if (!/\.(smm|json)$/i.test(f.name)) continue
            try {
              const content = await window.electronAPI.fs.readFile(f.path)
              const data = JSON.parse(content)
              collectFromTree(data, f.name, refs)
            } catch {
              // 跳过损坏文件
            }
          }
        }

        if (refs.length === 0) {
          return { success: true, message: args.scope === 'all' ? '所有导图文件中都没有 @文件/#节点 引用。' : '当前导图中没有 @文件/#节点 引用。' }
        }

        const filtered = filterFile
          ? refs.filter(r => r.targetFile.toLowerCase().includes(filterFile))
          : refs
        if (filtered.length === 0) {
          return { success: true, message: `没有找到指向 "${filterFile}" 的引用。` }
        }

        // 逐条断链检测
        const rows = []
        let broken = 0
        for (const r of filtered) {
          const { fileOk, nodeOk } = await checkTarget(r)
          let status = '✓ 正常'
          if (!fileOk) { status = '✗ 断链：文件不存在（可能被删除/改名/移动）'; broken++ }
          else if (nodeOk === false) { status = '✗ 断链：目标节点不存在（可能被删除）'; broken++ }
          rows.push(`- ${r.sourceFile} ｜ ${r.nodePath.slice(0, 60)} ｜ ${r.type === 'node' ? `#节点→ ${r.targetFile.split(/[/\\]/).pop()}#${String(r.targetNodeUid).slice(0, 8)}` : `@文件→ ${r.targetFile.split(/[/\\]/).pop()}`} ｜ ${status}`)
        }

        const grouped = {}
        for (const r of filtered) {
          const key = r.targetFile.split(/[/\\]/).pop()
          ;(grouped[key] = grouped[key] || []).push(r)
        }
        const summary = Object.entries(grouped)
          .map(([f, list]) => `· ${f}：被引用 ${list.length} 次`)
          .join('\n')

        let msg = `引用清单（共 ${filtered.length} 条引用，指向 ${Object.keys(grouped).length} 个文件）：\n${summary}\n\n明细：\n${rows.join('\n')}`
        if (broken > 0) msg += `\n\n⚠️ 发现 ${broken} 条断链，建议：在节点中重新 @/ 选择目标，或删除失效引用。`
        return { success: true, message: msg, references: filtered, brokenCount: broken }
      } catch (e) {
        return { success: false, message: `引用清单查询失败: ${e.message}` }
      }
    }

    case 'find_related': {
      try {
        const keyword = String(args.keyword || '').trim()
        const perSource = Math.min(Math.max(Number(args.count) || 8, 1), 20)
        const plain = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()

        // auto 模式：未提供 keyword 时，自动从当前导图提取关键词（选中节点，否则根节点 + 一级子节点）
        let autoKeywords = []
        if (!keyword && mindMap) {
          try {
            const active = mindMap.renderer.activeNodeList || []
            const texts = []
            if (active.length) {
              active.forEach(n => texts.push(plain(n.getData?.('text') || '')))
            } else {
              const treeData = mindMap.getData()
              texts.push(plain(treeData?.data?.text || ''))
              ;(treeData?.children || []).slice(0, 8).forEach(c => texts.push(plain(c?.data?.text || '')))
            }
            autoKeywords = [...new Set(texts.map(t => t.slice(0, 12)).filter(t => t.length >= 2))].slice(0, 8)
          } catch { /* 提取失败按无关键词处理 */ }
        }

        const kws = keyword ? [keyword] : autoKeywords
        if (!kws.length) return { success: false, message: '请提供 keyword，或先选中节点以自动提取关键词' }

        // 对每个关键词跨知识库搜索，汇总去重（跨文件关联发现）
        const kbLines = []
        const seenKb = new Set()
        if (searchService.isAvailable && searchService.isAvailable()) {
          for (const kw of kws.slice(0, 5)) {
            try {
              const results = await searchService.search(kw)
              for (const r of results.slice(0, Math.ceil(perSource / Math.max(1, kws.length)) + 1)) {
                const line = `- [${r.fileName || r.filePath || '文件'}] ${plain(r.content || r.text || '').slice(0, 80)}`
                if (!seenKb.has(line)) { seenKb.add(line); kbLines.push(line) }
                if (kbLines.length >= perSource) break
              }
            } catch { /* 单个关键词搜索失败跳过 */ }
            if (kbLines.length >= perSource) break
          }
        }

        // 当前导图内匹配节点
        const mapLines = []
        const seenMap = new Set()
        if (mindMap) {
          const treeData = mindMap.getData()
          const walk = (node) => {
            if (!node || !node.data) return
            const text = plain(node.data.text)
            if (text && kws.some(k => text.toLowerCase().includes(k.toLowerCase()))) {
              const line = `- ${getNodePath(treeData, node.data.uid) || text}`
              if (!seenMap.has(line)) { seenMap.add(line); mapLines.push(line) }
            }
            ;(node.children || []).forEach(walk)
          }
          walk(treeData)
        }

        if (kbLines.length === 0 && mapLines.length === 0) {
          return { success: true, message: `知识库和当前导图中都没有找到与${keyword ? `「${keyword}」` : '当前导图'}相关的内容。` }
        }
        const kwLabel = keyword ? `「${keyword}」` : `当前导图（自动关键词：${kws.slice(0, 5).join('、')}）`
        let msg = `与${kwLabel}相关的内容：`
        if (kbLines.length > 0) msg += `\n\n【本地知识库（${kbLines.length} 处，跨文件）】\n${kbLines.join('\n')}`
        if (mapLines.length > 0) msg += `\n\n【当前导图（${mapLines.length} 处）】\n${mapLines.slice(0, perSource).join('\n')}`
        msg += `\n\n关联建议：可把知识库中的相关内容用 merge_mindmap_files 合并进当前导图，或用 @ 引用该文件。`
        return { success: true, message: msg }
      } catch (e) {
        return { success: false, message: `关联查询失败: ${e.message}` }
      }
    }

    case 'memory': {
      try {
        const action = args.action || 'get'
        if (action === 'save') {
          const content = String(args.content || '').trim()
          if (!content) return { success: false, message: '请提供要记住的内容' }
          const type = ['preference', 'habit', 'knowledge', 'fact'].includes(args.type) ? args.type : 'preference'
          const fact = addMemoryFact(content, type)
          if (!fact) return { success: false, message: '保存失败：内容为空' }
          return { success: true, message: `已记住（${type}）：${fact.content}\n之后每次对话都会自动遵守这条记忆。` }
        }
        if (action === 'forget') {
          if (!args.id) return { success: false, message: '请提供要删除的记忆 id（从 action=get 获取）' }
          const ok = removeMemoryFact(args.id)
          return ok
            ? { success: true, message: '已删除该条长期记忆。' }
            : { success: false, message: `未找到 id 为 ${args.id} 的记忆条目` }
        }
        const facts = getMemoryFacts()
        if (facts.length === 0) return { success: true, message: '当前没有保存任何长期记忆。' }
        const lines = facts.map(f => `- [${f.id}] (${f.type}) ${f.content}`)
        return { success: true, message: `共 ${facts.length} 条长期记忆：\n${lines.join('\n')}` }
      } catch (e) {
        return { success: false, message: `记忆操作失败: ${e.message}` }
      }
    }

    case 'query_node_styles': {
      try {
        if (!mindMap) return { success: false, message: '当前没有打开的思维导图。请先调用 find_local_file(exts=["smm"]) 搜索本地导图文件（自动覆盖桌面/文档/下载/默认保存目录），再用 read_mindmap_file(filePath=...) 直接读取文件内容后继续。' }
        let nodes
        if (args.targets && (args.targets.uids || args.targets.keyword || args.targets.mode)) {
          const r = resolveTargetNodes(mindMap, args.targets)
          if (r.error) return { success: false, message: `查询范围解析失败：${r.error}` }
          nodes = r.nodes
        } else {
          nodes = []
          const walkAll = (n) => {
            if (!n || n.isGeneralization) return
            nodes.push(n)
            ;(n.children || []).forEach(walkAll)
          }
          walkAll(mindMap.renderer.root)
        }
        const filter = Array.isArray(args.styleTypes) && args.styleTypes.length > 0
          ? new Set(args.styleTypes) : null
        const want = (t) => !filter || filter.has(t)

        const groups = {
          colors: {}, highlights: {}, fontSizes: {},
          bold: [], italic: [], underline: [], strikethrough: [], cloze: [],
          nodeFill: {}, note: [], outerFrame: 0
        }
        const nodeLabel = (n) => `${nodePlainText(n.getData?.('text') || '').slice(0, 30)}（uid=${n.getData?.('uid') || n.uid}）`
        const pushMap = (map, key, label) => {
          if (map[key]) {
            if (map[key].length < 200) map[key] += '；' + label
          } else {
            map[key] = label
          }
        }
        const pushList = (list, label) => {
          if (list.length < 30) list.push(label)
        }

        for (const n of nodes) {
          const uid = n.getData?.('uid') || n.uid
          const label = nodeLabel(n)
          // 文字级样式（富文本内联样式）
          const audit = analyzeNodeTextStyles(n.getData?.('text') || '')
          if (audit) {
            if (want('color')) for (const [c, t] of Object.entries(audit.colors)) pushMap(groups.colors, c, `${label}：${t}`)
            if (want('highlight')) for (const [c, t] of Object.entries(audit.highlights)) pushMap(groups.highlights, c, `${label}：${t}`)
            if (want('fontSize')) for (const [s, t] of Object.entries(audit.fontSizes)) pushMap(groups.fontSizes, s, `${label}：${t}`)
            if (want('bold') && audit.bold.length) pushList(groups.bold, label)
            if (want('italic') && audit.italic.length) pushList(groups.italic, label)
            if (want('underline') && audit.underline.length) pushList(groups.underline, label)
            if (want('strikethrough') && audit.strikethrough.length) pushList(groups.strikethrough, label)
            if (want('cloze') && audit.cloze.length) pushList(groups.cloze, `${label}：${audit.cloze.slice(0, 3).join('、')}`)
          } else if (want('cloze') && nodeHasCloze(n)) {
            pushList(groups.cloze, label)
          }
          // 节点级样式
          const style = n.getData?.('style') || {}
          if (want('nodeFill') && style.fillColor) pushMap(groups.nodeFill, style.fillColor, label)
          if (want('note') && n.getData?.('note')) pushList(groups.note, `${label}：${String(n.getData('note')).slice(0, 40)}`)
          if (want('outerFrame') && n.getData?.('outerFrame')) groups.outerFrame++
        }

        const parts = []
        if (want('color')) {
          const keys = Object.keys(groups.colors)
          parts.push(keys.length ? `【文字颜色】\n${keys.map(k => `- ${k}：${groups.colors[k]}`).join('\n')}` : '【文字颜色】无')
        }
        if (want('highlight')) {
          const keys = Object.keys(groups.highlights)
          parts.push(keys.length ? `【高亮背景】\n${keys.map(k => `- ${k}：${groups.highlights[k]}`).join('\n')}` : '【高亮背景】无')
        }
        if (want('bold')) parts.push(groups.bold.length ? `【加粗】${groups.bold.length} 个节点\n${groups.bold.join('；')}` : '【加粗】无')
        if (want('italic')) parts.push(groups.italic.length ? `【斜体】${groups.italic.length} 个节点\n${groups.italic.join('；')}` : '【斜体】无')
        if (want('underline')) parts.push(groups.underline.length ? `【下划线】${groups.underline.length} 个节点\n${groups.underline.join('；')}` : '【下划线】无')
        if (want('strikethrough')) parts.push(groups.strikethrough.length ? `【删除线】${groups.strikethrough.length} 个节点\n${groups.strikethrough.join('；')}` : '【删除线】无')
        if (want('fontSize')) {
          const keys = Object.keys(groups.fontSizes)
          parts.push(keys.length ? `【字号设置】\n${keys.map(k => `- ${k}：${groups.fontSizes[k]}`).join('\n')}` : '【字号设置】无（均为默认字号）')
        }
        if (want('cloze')) parts.push(groups.cloze.length ? `【挖空标记】${groups.cloze.length} 个节点\n${groups.cloze.join('\n')}` : '【挖空标记】无')
        if (want('nodeFill')) {
          const keys = Object.keys(groups.nodeFill)
          parts.push(keys.length ? `【节点背景色】\n${keys.map(k => `- ${k}：${groups.nodeFill[k]}`).join('\n')}` : '【节点背景色】无自定义')
        }
        if (want('note')) parts.push(groups.note.length ? `【节点备注】${groups.note.length} 条\n${groups.note.join('\n')}` : '【节点备注】无')
        if (want('outerFrame')) parts.push(groups.outerFrame > 0 ? `【外框】${groups.outerFrame} 个节点带外框` : '【外框】无')

        return { success: true, message: `样式审计（共扫描 ${nodes.length} 个节点）：\n\n${parts.join('\n\n')}` }
      } catch (e) {
        return { success: false, message: `样式审计失败: ${e.message}` }
      }
    }

    case 'set_node_note': {
      try {
        if (!mindMap) return { success: false, message: '当前没有打开的思维导图。请先调用 find_local_file(exts=["smm"]) 搜索本地导图文件（自动覆盖桌面/文档/下载/默认保存目录），再用 read_mindmap_file(filePath=...) 直接读取文件内容后继续。' }
        const note = String(args.note ?? '')
        const hasTargets = args.targets && (args.targets.uids || args.targets.keyword || args.targets.mode)
        let nodes
        if (hasTargets) {
          const r = resolveTargetNodes(mindMap, args.targets)
          if (r.error) return { success: false, message: `目标节点解析失败：${r.error}` }
          nodes = r.nodes
        } else {
          nodes = mindMap.renderer.activeNodeList || []
          if (!nodes.length) return { success: false, message: '没有选中的节点，请用 targets 指定目标' }
        }
        let count = 0
        for (const n of nodes) {
          if (n.isGeneralization) continue
          try { mindMap.execCommand('SET_NODE_NOTE', n, note); count++ } catch (err) { console.warn('[set_node_note] 单节点失败:', err) }
        }
        return count > 0
          ? { success: true, message: note ? `已为 ${count} 个节点设置备注（悬停节点上的备注图标查看）` : `已清除 ${count} 个节点的备注` }
          : { success: false, message: '没有可设置备注的节点' }
      } catch (e) {
        return { success: false, message: `设置备注失败: ${e.message}` }
      }
    }

    case 'associative_line': {
      try {
        if (!mindMap) return { success: false, message: '当前没有打开的思维导图。请先调用 find_local_file(exts=["smm"]) 搜索本地导图文件（自动覆盖桌面/文档/下载/默认保存目录），再用 read_mindmap_file(filePath=...) 直接读取文件内容后继续。' }
        const action = args.action || 'list'
        if (action === 'add') {
          if (!mindMap.associativeLine) return { success: false, message: '关联线功能未启用' }
          const fromNode = resolveNodeByUidOrKeyword(mindMap, args.from)
          if (!fromNode) return { success: false, message: `未找到起始节点：${args.from}` }
          const toNode = resolveNodeByUidOrKeyword(mindMap, args.to)
          if (!toNode) return { success: false, message: `未找到目标节点：${args.to}` }
          if (fromNode === toNode) return { success: false, message: '起始和目标不能是同一个节点' }
          const toUid = toNode.getData('uid') || toNode.uid
          const targets = fromNode.getData('associativeLineTargets') || []
          if (targets.includes(toUid)) return { success: false, message: '这两个节点之间已存在关联线' }
          mindMap.associativeLine.addLine(fromNode, toNode)
          const text = String(args.text || '').trim()
          if (text) mindMap.execCommand('SET_NODE_DATA', fromNode, { associativeLineText: { ...(fromNode.getData('associativeLineText') || {}), [toUid]: text } })
          try { mindMap.associativeLine.renderAllLines() } catch (err) {}
          return { success: true, message: `已添加关联线：${nodePlainText(fromNode.getData('text')).slice(0, 20)} → ${nodePlainText(toNode.getData('text')).slice(0, 20)}${text ? `（标注：${text}）` : ''}` }
        }
        const lines = collectAssocLines(mindMap)
        if (action === 'remove') {
          if (lines.length === 0) return { success: true, message: '当前导图没有关联线' }
          let removed = 0
          if (args.all) {
            for (const l of lines) if (l.toNode) removed += removeAssocLineFromData(mindMap, l.fromNode, l.toNode) ? 1 : 0
          } else {
            const fromNode = args.from ? resolveNodeByUidOrKeyword(mindMap, args.from) : null
            const toNode = args.to ? resolveNodeByUidOrKeyword(mindMap, args.to) : null
            const toUid = args.to && !toNode ? String(args.to) : null
            const matched = lines.filter((l) => {
              if (fromNode && l.fromNode !== fromNode) return false
              if (toNode && l.toNode !== toNode) return false
              if (toUid && l.toUid !== toUid) return false
              if (!fromNode && !toNode && !toUid) return false
              return true
            })
            if (matched.length === 0) return { success: false, message: '未找到匹配的关联线' }
            for (const l of matched) if (l.toNode) removed += removeAssocLineFromData(mindMap, l.fromNode, l.toNode) ? 1 : 0
          }
          if (removed > 0) { try { mindMap.associativeLine?.renderAllLines?.() } catch (err) {}; mindMap.render() }
          return { success: true, message: removed > 0 ? `已删除 ${removed} 条关联线` : '没有可删除的关联线' }
        }
        if (lines.length === 0) return { success: true, message: '当前导图没有关联线' }
        const out = lines.map((l, i) => {
          const from = nodePlainText(l.fromNode.getData?.('text') || '').slice(0, 20)
          const to = l.toNode ? nodePlainText(l.toNode.getData?.('text') || '').slice(0, 20) : '（目标节点不存在）'
          return `${i + 1}. ${from} → ${to}${l.text ? `「${l.text}」` : ''}`
        })
        return { success: true, message: `共 ${lines.length} 条关联线：\n${out.join('\n')}` }
      } catch (e) {
        return { success: false, message: `关联线操作失败: ${e.message}` }
      }
    }

    case 'outer_frame': {
      try {
        if (!mindMap) return { success: false, message: '当前没有打开的思维导图。请先调用 find_local_file(exts=["smm"]) 搜索本地导图文件（自动覆盖桌面/文档/下载/默认保存目录），再用 read_mindmap_file(filePath=...) 直接读取文件内容后继续。' }
        if (args.action === 'remove') {
          let cleared = 0
          if (args.all) {
            const walk = (n) => {
              if (!n || n.isGeneralization) return
              if (n.getData?.('outerFrame')) { try { mindMap.execCommand('SET_NODE_DATA', n, { outerFrame: null }); cleared++ } catch (err) {} }
              (n.children || []).forEach(walk)
            }
            walk(mindMap.renderer.root)
          } else {
            const { nodes, error } = resolveTargetNodes(mindMap, args.targets || {})
            if (error) return { success: false, message: `目标节点解析失败：${error}` }
            const processed = new Set()
            for (const n of nodes) {
              const of = n.getData?.('outerFrame')
              if (!of) continue
              const groupId = of.groupId
              let list = [n]
              if (groupId && n.parent) list = (n.parent.children || []).filter((c) => c.getData?.('outerFrame')?.groupId === groupId)
              for (const child of list) {
                const cu = child.getData?.('uid') || child.uid
                if (processed.has(cu)) continue
                processed.add(cu)
                try { mindMap.execCommand('SET_NODE_DATA', child, { outerFrame: null }); cleared++ } catch (err) {}
              }
            }
          }
          if (cleared > 0) mindMap.render()
          return cleared > 0 ? { success: true, message: `已移除 ${cleared} 个节点的外框` } : { success: false, message: '目标节点没有外框' }
        }
        if (!mindMap.outerFrame) return { success: false, message: '外框功能未启用' }
        const { nodes, error } = resolveTargetNodes(mindMap, args.targets || {})
        if (error) return { success: false, message: `目标节点解析失败：${error}` }
        const valid = nodes.filter(n => !n.isRoot && !n.isGeneralization)
        if (!valid.length) return { success: false, message: '没有可添加外框的节点（根节点/概要不支持）' }
        const config = {}
        const cfg = args.config || {}
        if (cfg.strokeColor) config.strokeColor = cfg.strokeColor
        if (cfg.strokeWidth != null) config.strokeWidth = cfg.strokeWidth
        if (cfg.radius != null) config.radius = cfg.radius
        if (cfg.strokeDasharray) config.strokeDasharray = cfg.strokeDasharray
        if (cfg.fill) config.fill = cfg.fill
        if (cfg.text) config.text = cfg.text
        mindMap.execCommand('ADD_OUTER_FRAME', valid, config)
        return { success: true, message: `已为 ${valid.length} 个节点添加外框（同一父节点下的兄弟节点会自动分组连续框选）` }
      } catch (e) {
        return { success: false, message: `外框操作失败: ${e.message}` }
      }
    }

    case 'format_painter': {
      try {
        if (!mindMap) return { success: false, message: '当前没有打开的思维导图。请先调用 find_local_file(exts=["smm"]) 搜索本地导图文件（自动覆盖桌面/文档/下载/默认保存目录），再用 read_mindmap_file(filePath=...) 直接读取文件内容后继续。' }
        const source = resolveNodeByUidOrKeyword(mindMap, args.source)
        if (!source) return { success: false, message: `未找到源节点：${args.source}` }
        const { nodes, error } = resolveTargetNodes(mindMap, args.targets || {})
        if (error) return { success: false, message: `目标节点解析失败：${error}` }
        const targets = nodes.filter(n => n !== source)
        if (!targets.length) return { success: false, message: '没有可应用格式的目标节点' }

        // 节点级样式：复刻 Painter 插件的样式收集逻辑
        const style = { ...(source.effectiveStyles || {}) }
        const srcData = source.getData() || {}
        Object.keys(srcData).forEach((key) => {
          if (checkIsNodeStyleDataKey(key)) style[key] = srcData[key]
        })
        let applied = 0
        for (const n of targets) {
          try {
            mindMap.renderer._handleRemoveCustomStyles(n.getData())
            n.setStyles(style)
            applied++
          } catch (err) {
            console.warn('[format_painter] 单节点节点级样式失败:', err)
          }
        }

        // 可选：文字级样式（颜色/加粗/斜体/下划线/删除线/高亮/字号）
        let textApplied = 0
        if (args.copy_text_styles) {
          textApplied = copyRichTextStyles(mindMap, source, targets)
        }
        mindMap.render()
        return {
          success: true,
          message: `格式刷完成：已把「${nodePlainText(source.getData('text')).slice(0, 20)}」的格式应用到 ${applied} 个节点${args.copy_text_styles ? `（其中 ${textApplied} 个同时复制了文字级样式）` : ''}`
        }
      } catch (e) {
        return { success: false, message: `格式刷失败: ${e.message}` }
      }
    }

    case 'save_text_file': {
      try {
        if (!window.electronAPI?.saveFile) return { success: false, message: '文件保存接口不可用（需在应用内运行）' }
        const content = String(args.content ?? '')
        if (!content) return { success: false, message: 'content 不能为空' }
        const rawName = String(args.file_name || '').trim() || '未命名文件'
        const ext = String(args.extension || 'html').replace(/^\./, '').toLowerCase() || 'html'
        const safeName = rawName.slice(0, 80).replace(/[\\/:*?"<>|]/g, '_').trim() || '未命名文件'
        const fileName = `${safeName}.${ext}`
        const result = await window.electronAPI.saveFile(fileName, content, { overwrite: args.overwrite !== false })
        if (!result?.success) return { success: false, message: `保存失败：${result?.error || '未知错误'}` }
        return {
          success: true,
          message: `已保存文件：${result.filePath}`,
          filePath: result.filePath,
          fileName
        }
      } catch (e) {
        return { success: false, message: `保存文本文件失败: ${e.message}` }
      }
    }

    // 导出文件名：参数指定 → 根节点文本 → 默认名
    case 'export_to_markdown': {
      try {
        if (!window.electronAPI?.saveFile) {
          return { success: false, message: '文件保存接口不可用（需在应用内运行）' }
        }
        // 数据来源：优先 file_path 直接读文件（脱离当前打开的导图）；否则用当前打开的导图
        let data = null
        if (args.file_path) {
          const fp = String(args.file_path).trim()
          if (!window.electronAPI?.fs?.readFile) return { success: false, message: '文件系统不可用' }
          const content = await window.electronAPI.fs.readFile(fp)
          if (!content) return { success: false, message: `无法读取文件：${fp}` }
          try { data = JSON.parse(content) } catch { return { success: false, message: `文件格式错误（不是有效的 .smm 文件）：${fp}` } }
        } else {
          if (!mindMap) return { success: false, message: '当前没有打开的思维导图。请先用 list_directory(recursive=true) 或 find_local_file 找到 .smm 文件，再用 export_to_markdown(file_path=...) 直接导出，无需打开。' }
          data = mindMap.getData()
        }
        data = Array.isArray(data) ? data[0] : data
        const rootText = nodePlainText(data?.data?.text || data?.text || '')
        const safeName = String(args.file_name || rootText || '思维导图').slice(0, 40).replace(/[\\/:*?"<>|]/g, '_').trim() || '思维导图'

        const mod = await import('simple-mind-map/src/parse/markdown.js')
        const markdown = mod.default || mod
        const mdText = markdown.transformToMarkdown(data)
        if (!mdText) return { success: false, message: 'Markdown 转换结果为空' }
        const result = await window.electronAPI.saveFile(`${safeName}.md`, mdText, { overwrite: true })
        if (!result?.success) return { success: false, message: `保存失败：${result?.error || '未知错误'}` }
        const preview = mdText.split('\n').slice(0, 8).join('\n')
        return {
          success: true,
          message: `已导出 Markdown：${result.filePath}\n\n内容预览：\n${preview}${mdText.split('\n').length > 8 ? '\n…' : ''}`,
          filePath: result.filePath
        }
      } catch (e) {
        return { success: false, message: `导出失败: ${e.message}` }
      }
    }

    case 'export_mindmap_html': {
      try {
        if (!window.electronAPI?.saveFile) {
          return { success: false, message: '文件保存接口不可用（需在应用内运行）' }
        }
        // 数据来源：优先 file_path 直接读文件（脱离当前打开的导图）；否则用当前打开的导图
        let data = null
        let useOffscreen = false
        if (args.file_path) {
          const fp = String(args.file_path).trim()
          if (!window.electronAPI?.fs?.readFile) return { success: false, message: '文件系统不可用' }
          const content = await window.electronAPI.fs.readFile(fp)
          if (!content) return { success: false, message: `无法读取文件：${fp}` }
          try { data = JSON.parse(content) } catch { return { success: false, message: `文件格式错误（不是有效的 .smm 文件）：${fp}` } }
          useOffscreen = true // 指定了文件路径：离屏渲染，不依赖当前打开的导图
        } else {
          if (!mindMap) return { success: false, message: '当前没有打开的思维导图。请先用 list_directory(recursive=true) 或 find_local_file 找到 .smm 文件，再用 export_mindmap_html(file_path=...) 直接导出，无需打开。' }
          data = mindMap.getData()
        }
        data = Array.isArray(data) ? data[0] : data
        const rootText = nodePlainText(data?.data?.text || data?.text || '')
        const safeName = String(args.file_name || rootText || '思维导图').slice(0, 40).replace(/[\\/:*?"<>|]/g, '_').trim() || '思维导图'
        const mode = args.mode === 'full' ? 'full' : 'single'

        // 生成 SVG：离屏渲染（file_path 或当前无实例时）或复用当前实例（更贴近实时画布）
        let svgDataUrl = null
        if (!useOffscreen && mindMap) {
          try { svgDataUrl = await safeExportSvg(mindMap, safeName) } catch (e) { svgDataUrl = null }
        }
        if (!svgDataUrl) {
          svgDataUrl = await renderSvgFromData(data, { name: safeName })
        }

        let html = ''
        let fileName = safeName
        if (mode === 'full') {
          html = await buildTriModeHtml(svgDataUrl, data, safeName)
          fileName = `${safeName}-全视图模式`
        } else {
          html = await buildInteractiveHtml(svgDataUrl, safeName)
        }
        const result = await window.electronAPI.saveFile(`${fileName}.html`, html, { overwrite: true })
        if (!result?.success) return { success: false, message: `保存失败：${result?.error || '未知错误'}` }
        return {
          success: true,
          message: `已导出${mode === 'full' ? '全视图（三模式）' : '交互式'} HTML：${result.filePath}`,
          filePath: result.filePath,
          fileName: `${fileName}.html`
        }
      } catch (e) {
        return { success: false, message: `导出 HTML 失败: ${e.message}` }
      }
    }

    case 'export_mindmap_pdf':
    case 'export_outline_pdf': {
      try {
        if (!mindMap) return { success: false, message: '当前没有打开的思维导图。请先调用 find_local_file(exts=["smm"]) 搜索本地导图文件（自动覆盖桌面/文档/下载/默认保存目录），再用 read_mindmap_file(filePath=...) 直接读取文件内容后继续。' }
        if (!window.electronAPI?.saveFile || !window.electronAPI?.saveBinaryFile) {
          return { success: false, message: '文件保存接口不可用（需在应用内运行）' }
        }
        // export_outline_pdf 依赖主进程打印接口，入口先检查避免排版后才失败
        if (name === 'export_outline_pdf' && !window.electronAPI?.printToPdf) {
          return { success: false, message: 'PDF 打印接口不可用（需在应用内运行）' }
        }
        const data = mindMap.getData()
        const root = Array.isArray(data) ? data[0] : data
        const rootText = nodePlainText(root?.data?.text || root?.text || '')
        const safeName = String(args.file_name || rootText || '思维导图').slice(0, 40).replace(/[\\/:*?"<>|]/g, '_').trim() || '思维导图'

        if (name === 'export_mindmap_pdf') {
          if (!mindMap.doExport) return { success: false, message: '导出插件未注册' }
          const url = await mindMap.doExport.pdf(safeName)
          if (!url) return { success: false, message: 'PDF 生成失败：返回数据为空' }
          const result = await window.electronAPI.saveBinaryFile(`${safeName}.pdf`, url)
          if (!result?.success) return { success: false, message: `保存失败：${result?.error || '未知错误'}` }
          return { success: true, message: `已导出导图 PDF：${result.filePath}` }
        }

        // export_outline_pdf：大纲缩进文本 → 排版 HTML → 主进程打印为 PDF
        const buildOutlineHtml = (treeData, title) => {
          const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          const rows = []
          let nodeCount = 0
          const walk = (node, depth) => {
            const text = nodePlainText(node?.data?.text || node?.text || '') || '（空节点）'
            nodeCount++
            const fontSize = Math.max(11, 22 - depth * 2)
            const color = depth === 0 ? '#111' : depth === 1 ? '#1a1a1a' : '#333'
            const fontWeight = depth <= 1 ? '700' : '400'
            rows.push(`<div style="margin:${depth === 0 ? '14px' : '3px'} 0 ${depth === 0 ? '10px' : '3px'} ${depth * 22}px;font-size:${fontSize}px;color:${color};font-weight:${fontWeight};line-height:1.6;">${esc(text)}</div>`)
            ;(node?.children || []).forEach((c) => walk(c, depth + 1))
          }
          const rootNode = Array.isArray(treeData) ? treeData[0] : treeData
          if (rootNode) walk(rootNode, 0)
          return {
            html: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>body{font-family:'Microsoft YaHei','PingFang SC',sans-serif;padding:32px 40px;}h1{font-size:24px;text-align:center;margin:0 0 24px;color:#111;}</style></head><body><h1>${esc(title)}</h1>${rows.join('')}</body></html>`,
            nodeCount
          }
        }
        const { html, nodeCount } = buildOutlineHtml(data, safeName)
        const pdfRes = await window.electronAPI.printToPdf(html)
        if (!pdfRes?.success || !pdfRes.base64) {
          return { success: false, message: `大纲 PDF 生成失败：${pdfRes?.error || '未知错误'}` }
        }
        const result = await window.electronAPI.saveBinaryFile(`${safeName}_大纲.pdf`, pdfRes.base64)
        if (!result?.success) return { success: false, message: `保存失败：${result?.error || '未知错误'}` }
        return { success: true, message: `已导出大纲 PDF（共 ${nodeCount} 个节点）：${result.filePath}` }
      } catch (e) {
        return { success: false, message: `导出失败: ${e.message}` }
      }
    }

    case 'find_replace_text': {
      try {
        if (!mindMap) return { success: false, message: '当前没有打开的思维导图。请先调用 find_local_file(exts=["smm"]) 搜索本地导图文件（自动覆盖桌面/文档/下载/默认保存目录），再用 read_mindmap_file(filePath=...) 直接读取文件内容后继续。' }
        const find = String(args.find ?? '')
        if (!find) return { success: false, message: 'find 不能为空' }
        const replacement = String(args.replacement ?? '')
        const preview = args.preview === true
        let re = null
        if (args.regex === true) {
          try { re = new RegExp(find, args.flags || 'g') } catch (err) { return { success: false, message: `正则表达式无效: ${err.message}` } }
        }
        const plainOf = (html) => String(html || '')
          .replace(/<[^>]+>/g, '')
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        const escForHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

        const targets = args.targets || {}
        const kw = (targets.keyword || '').toLowerCase()
        const uidSet = new Set(targets.uids || [])
        // targets.mode 结构化范围（all/leaves/leaf_parents）：换算成 uid 集合限定替换范围
        let modeUidSet = null
        if (targets.mode) {
          const { nodes: modeNodes, error: modeErr } = resolveTargetNodes(mindMap, { mode: targets.mode })
          if (modeErr) return { success: false, message: `targets.mode 解析失败：${modeErr}` }
          modeUidSet = new Set(modeNodes.map(n => n.getData?.('uid') || n.uid))
        }
        const scopeAll = !kw && uidSet.size === 0 && !modeUidSet

        const replaceInHtml = (html) => {
          let count = 0
          if (re) {
            const out = html.replace(re, () => { count++; return replacement })
            return { out, count }
          }
          let out = html
          const literal = (s, needle) => {
            const c = s.split(needle).length - 1
            if (c > 0) { count += c; return s.split(needle).join(replacement) }
            return s
          }
          out = literal(out, find)
          const esc = escForHtml(find)
          if (esc !== find) out = literal(out, esc)
          return { out, count }
        }

        const treeData = mindMap.getData()
        const clone = JSON.parse(JSON.stringify(treeData))
        let changedNodes = 0
        let occurrences = 0
        const previewLines = []
        const modifiedSnippets = []
        const walk = (node) => {
          const uid = node?.data?.uid || ''
          const plain = plainOf(node?.data?.text)
          const inScope = scopeAll || (uidSet.size > 0 && uidSet.has(uid)) || (kw && plain.toLowerCase().includes(kw)) || (modeUidSet && uid && modeUidSet.has(uid))
          if (inScope && plain) {
            if (preview) {
              const c = re ? (plain.match(new RegExp(find, (args.flags || 'g').replace('g', '') + 'g')) || []).length : plain.split(find).length - 1
              if (c > 0) previewLines.push(`- ${plain.slice(0, 30)}（${c} 处）`)
            } else {
              const { out, count } = replaceInHtml(String(node.data.text || ''))
              if (count > 0) {
                node.data.text = out
                changedNodes++
                occurrences += count
                modifiedSnippets.push(plain.slice(0, 30))
              }
            }
          }
          ;(node?.children || []).forEach(walk)
        }
        walk(clone)
        if (preview) {
          return {
            success: true,
            message: previewLines.length
              ? `预览：共 ${previewLines.length} 个节点包含匹配（未做任何修改）\n${previewLines.slice(0, 20).join('\n')}${previewLines.length > 20 ? '\n…' : ''}`
              : '未找到匹配内容',
            matchedNodes: previewLines.length
          }
        }
        if (changedNodes === 0) {
          let plainHit = 0
          const walk2 = (node) => {
            const plain = plainOf(node?.data?.text)
            if (plain && (re ? re.test(plain) : plain.includes(find))) plainHit++
            if (re) re.lastIndex = 0
            ;(node?.children || []).forEach(walk2)
          }
          walk2(treeData)
          return {
            success: false,
            message: plainHit > 0
              ? `发现 ${plainHit} 个节点的纯文本包含匹配，但匹配内容被行内样式标签拆开，无法安全替换；可用 search_nodes 定位后用 update_node_text 逐个修改`
              : '未找到匹配内容'
          }
        }
        mindMap.setData(clone)
        return {
          success: true,
          message: `已在 ${changedNodes} 个节点中替换 ${occurrences} 处："${find.slice(0, 20)}" → "${replacement.slice(0, 20)}"${modifiedSnippets.length <= 10 ? `\n${modifiedSnippets.map((m, i) => `${i + 1}. ${m}`).join('\n')}` : ''}`,
          changedNodes,
          occurrences
        }
      } catch (e) {
        return { success: false, message: `查找替换失败: ${e.message}` }
      }
    }

    case 'list_directory': {
      try {
        const fsApi = window.electronAPI?.fs
        if (!fsApi || typeof fsApi.listDir !== 'function') return { success: false, message: '目录浏览功能不可用' }
        let dir = args.dir_path || ''
        // 未指定目录时：优先当前打开文件的目录；否则回退到目录树根（MCP/外部调用场景无打开文件也能列）
        if (!dir) {
          const store = useMindMapStore()
          if (store.currentFilePath) dir = store.currentFilePath.replace(/[\\/][^\\/]+$/, '')
        }
        const dirs = []
        if (!dir) {
          // 回退到目录树根（与文件树展示范围一致）：手动添加的文件夹 + 自动保存目录根 + 默认保存目录
          try {
            const roots = JSON.parse(localStorage.getItem('MINDMAP_FOLDER_ROOTS') || '[]')
            if (Array.isArray(roots)) dirs.push(...roots.filter(p => typeof p === 'string' && p))
          } catch { /* 忽略 */ }
          try {
            const auto = localStorage.getItem('MINDMAP_AUTO_ROOT')
            if (auto) dirs.push(auto)
          } catch { /* 忽略 */ }
          if (window.electronAPI?.getDefaultSaveDir) {
            try {
              const saveDir = await window.electronAPI.getDefaultSaveDir()
              if (saveDir) dirs.push(saveDir)
            } catch { /* 忽略 */ }
          }
        }
        // 目录根去重（统一分隔符，避免保存目录与手动添加根重复导致重复列出）
        const normPath = (s) => String(s || '').replace(/[\\/]+/g, '/').replace(/\/+$/, '').toLowerCase()
        const uniqueDirs = [...new Set(dirs.filter(Boolean))].filter((d, i, arr) => arr.findIndex(x => normPath(x) === normPath(d)) === i)

        const recursive = args.recursive === true

        // 系统/缓存目录黑名单：递归遍历时跳过这些 Chromium/Electron 缓存目录，避免卡顿
        const SKIP_DIRS = new Set([
          'cache', 'code cache', 'gpucache', 'local storage', 'session storage',
          'service worker', 'cachestorage', 'network', 'shared dictionary', 'webstorage',
          'blob_storage', 'dawncache', 'dictionaries', 'leveldb', 'index-dir',
          'mcp-runtime', 'databases', 'cache_data', 'js', 'wasm', 'snapshot_blob_storage'
        ])

        // 递归列出某目录的条目。注意：fs:listDir 返回的是扁平数组（元素含 isDir 字段），不是 {dirs, files} 对象
        const walkDir = async (d, out, depth) => {
          const list = await fsApi.listDir(d)
          const entries = Array.isArray(list) ? list : []
          for (const e of entries) {
            // 跳过系统缓存目录（顶层也不列出，避免污染目录树）
            if (e.isDir && SKIP_DIRS.has((e.name || '').toLowerCase())) continue
            out.push({ ...e, path: e.path || `${d.replace(/[\\/]+$/, '')}/${e.name}`, depth })
            if (recursive && e.isDir && depth < 12) {
              await walkDir(e.path || `${d.replace(/[\\/]+$/, '')}/${e.name}`, out, depth + 1)
            }
          }
        }

        const allEntries = []
        if (uniqueDirs.length) {
          // 多个目录树根：逐根列出
          for (const d of uniqueDirs) {
            try {
              await walkDir(d, allEntries, 0)
            } catch (e) { /* 单个根失败不影响其余 */ }
          }
          if (!allEntries.length) {
            return { success: true, message: `目录树根（${uniqueDirs.join('、')}）下没有文件` }
          }
        } else {
          if (!dir) return { success: false, message: '未指定 dir_path，且当前没有打开的文件，也没有配置目录树根目录' }
          await walkDir(dir, allEntries, 0)
        }

        if (!allEntries.length) {
          return { success: true, message: `目录 ${dir} 为空` }
        }

        const fmtDate = (ms) => { try { return new Date(ms).toISOString().slice(0, 10) } catch { return '' } }
        const files = allEntries.filter(e => !e.isDir)
        const subdirs = allEntries.filter(e => e.isDir)
        const lines = []
        if (subdirs.length) lines.push(`文件夹（${subdirs.length}）：${subdirs.map(d => d.name).join('、')}`)
        if (files.length) lines.push(`文件（${files.length}）：${files.map(f => `${f.name}${f.mtime ? ` ${fmtDate(f.mtime)}` : ''}`).join('、')}`)
        const label = uniqueDirs.length
          ? `目录树根（${uniqueDirs.join('、')}）${recursive ? '（递归）' : ''}`
          : `目录 ${dir}${recursive ? '（递归）' : ''}`
        return {
          success: true,
          message: `${label}\n${lines.join('\n') || '（空目录或没有支持的文件类型）'}`,
          dir: dir || uniqueDirs,
          subdirs,
          files
        }
      } catch (e) {
        return { success: false, message: `读取目录失败: ${e.message}` }
      }
    }

    default:
      return { success: false, message: `未知工具: ${name}` }
  }
}

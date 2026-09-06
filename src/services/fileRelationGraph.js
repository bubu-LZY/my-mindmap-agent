/**
 * 文件关系图谱服务
 * 维护文件间的关系网络，用于：
 * 1. 引用关系检测（节点中 mindmap-file: 链接）
 * 2. 主题相似度计算（共享关键词/节点文本重叠）
 * 3. 关联文件推荐（搜索时自动扩展相关文件）
 * 4. 用户手动标记文件间关联
 *
 * 关系数据持久化到 localStorage
 */

import { storage } from '../utils/storage.js'
import { FILE_PROTOCOL, NODE_PROTOCOL } from './referenceService.js'

const STORAGE_KEY = 'FILE_RELATION_GRAPH'
const MAX_RELATIONS_PER_FILE = 20 // 每个文件最多保留的关联数量

// 关系类型
export const RELATION_TYPES = {
  REFERENCE: 'reference',     // 引用关系：A 中引用了 B
  REFERENCED_BY: 'referencedBy', // 被引用：B 被 A 引用
  SIMILAR: 'similar',         // 主题相似
  MANUAL: 'manual'            // 用户手动标记
}

/* ==================== 数据结构 ==================== */

// 图谱数据：{ [filePath]: { relations: [{ target, type, weight, createdAt, updatedAt }] } }
let graphCache = null

function loadGraph() {
  if (graphCache) return graphCache
  try {
    const raw = storage.get(STORAGE_KEY)
    graphCache = raw && typeof raw === 'object' ? raw : {}
  } catch (e) {
    graphCache = {}
  }
  return graphCache
}

function saveGraph() {
  try {
    storage.set(STORAGE_KEY, graphCache || {})
  } catch (e) {
    console.error('[FileRelation] 保存关系图谱失败:', e)
  }
}

/**
 * 规范化文件路径（统一用 / 分隔，去掉末尾 /）
 */
function normPath(p) {
  return String(p || '').replace(/\\/g, '/').replace(/\/+$/, '')
}

/* ==================== 关系管理 ==================== */

/**
 * 添加或更新文件间的关系
 * @param {string} sourcePath - 源文件路径
 * @param {string} targetPath - 目标文件路径
 * @param {string} type - 关系类型（RELATION_TYPES）
 * @param {number} weight - 权重 0-1，越高越相关
 */
export function addRelation(sourcePath, targetPath, type, weight = 0.5) {
  const graph = loadGraph()
  const src = normPath(sourcePath)
  const tgt = normPath(targetPath)
  if (!src || !tgt || src === tgt) return

  if (!graph[src]) graph[src] = { relations: [] }
  const rels = graph[src].relations

  const existingIdx = rels.findIndex(r => normPath(r.target) === tgt && r.type === type)
  const now = Date.now()

  if (existingIdx >= 0) {
    rels[existingIdx].weight = Math.max(rels[existingIdx].weight, weight)
    rels[existingIdx].updatedAt = now
  } else {
    rels.push({
      target: tgt,
      type,
      weight,
      createdAt: now,
      updatedAt: now
    })
  }

  // 按权重排序，保留前 N 个
  rels.sort((a, b) => b.weight - a.weight)
  if (rels.length > MAX_RELATIONS_PER_FILE) {
    graph[src].relations = rels.slice(0, MAX_RELATIONS_PER_FILE)
  }

  saveGraph()
}

/**
 * 移除文件间的关系
 */
export function removeRelation(sourcePath, targetPath, type) {
  const graph = loadGraph()
  const src = normPath(sourcePath)
  const tgt = normPath(targetPath)
  if (!graph[src]) return

  if (type) {
    graph[src].relations = graph[src].relations.filter(
      r => !(normPath(r.target) === tgt && r.type === type)
    )
  } else {
    graph[src].relations = graph[src].relations.filter(r => normPath(r.target) !== tgt)
  }

  saveGraph()
}

/**
 * 获取文件的所有关联文件
 * @param {string} filePath - 文件路径
 * @param {object} options - { types: string[], minWeight: number, limit: number }
 * @returns {Array} 关联文件列表，按权重排序
 */
export function getRelatedFiles(filePath, options = {}) {
  const graph = loadGraph()
  const fp = normPath(filePath)
  if (!graph[fp]) return []

  const { types = null, minWeight = 0, limit = 10 } = options
  let rels = graph[fp].relations.slice()

  if (types && types.length > 0) {
    rels = rels.filter(r => types.includes(r.type))
  }
  if (minWeight > 0) {
    rels = rels.filter(r => r.weight >= minWeight)
  }

  rels.sort((a, b) => b.weight - a.weight)
  return rels.slice(0, limit)
}

/**
 * 获取文件的关联文件名（用于展示）
 */
export function getRelatedFileNames(filePath, options = {}) {
  const rels = getRelatedFiles(filePath, options)
  return rels.map(r => {
    const parts = r.target.split('/')
    return {
      path: r.target,
      name: parts[parts.length - 1] || r.target,
      type: r.type,
      weight: r.weight
    }
  })
}

/* ==================== 引用关系提取 ==================== */

/**
 * 从思维导图数据中提取所有文件引用链接
 * @param {object} treeData - 思维导图数据
 * @returns {Array<string>} 被引用的文件路径列表（去重）
 */
export function extractFileReferences(treeData) {
  const refs = new Set()
  const walk = (node) => {
    if (!node) return
    const text = node.data?.text || node.text || ''
    if (text && typeof text === 'string') {
      // 匹配 mindmap-file: 和 mindmap-node: 中的文件路径
      const fileRefs = text.match(/mindmap-(?:file|node):([^"\s<>]+)/g) || []
      for (const ref of fileRefs) {
        // 提取路径部分
        let path = ref.replace(/^mindmap-(file|node):/, '')
        // 如果是 node 引用，路径是 path:uid，去掉最后一段 uid
        if (ref.startsWith('mindmap-node:')) {
          const lastColon = path.lastIndexOf(':')
          if (lastColon > 0) {
            path = path.slice(0, lastColon)
          }
        }
        // URL 解码
        try { path = decodeURIComponent(path) } catch {}
        if (path) refs.add(path)
      }
    }
    const children = node.children || node.data?.children || []
    if (Array.isArray(children)) {
      children.forEach(walk)
    }
  }
  if (treeData) walk(treeData)
  return Array.from(refs)
}

/**
 * 从思维导图数据中提取关键词（用于主题相似度计算）
 * 简单实现：提取所有节点文本中的高频中文词和英文词
 * @param {object} treeData - 思维导图数据
 * @param {number} maxKeywords - 最大关键词数量
 * @returns {Map<string, number>} 关键词 -> 词频
 */
export function extractKeywords(treeData, maxKeywords = 50) {
  const wordFreq = new Map()
  const walk = (node) => {
    if (!node) return
    const text = node.data?.text || node.text || ''
    if (text && typeof text === 'string') {
      const plain = text.replace(/<[^>]+>/g, '').toLowerCase()
      // 提取英文词（3 字母以上）
      const enWords = plain.match(/[a-z]{3,}/g) || []
      for (const w of enWords) {
        wordFreq.set(w, (wordFreq.get(w) || 0) + 1)
      }
      // 提取中文二字词组（简单 bigram，避免分词依赖）
      const han = plain.replace(/[^\u4e00-\u9fff]/g, '')
      for (let i = 0; i + 1 < han.length; i++) {
        const bigram = han.slice(i, i + 2)
        wordFreq.set(bigram, (wordFreq.get(bigram) || 0) + 1)
      }
    }
    const children = node.children || node.data?.children || []
    if (Array.isArray(children)) {
      children.forEach(walk)
    }
  }
  if (treeData) walk(treeData)

  // 按词频排序，取前 N 个
  const sorted = Array.from(wordFreq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxKeywords)
  return new Map(sorted)
}

/**
 * 计算两个文件关键词集合的相似度（Jaccard 系数 + 词频加权）
 * @param {Map<string, number>} kw1 - 文件1的关键词
 * @param {Map<string, number>} kw2 - 文件2的关键词
 * @returns {number} 相似度 0-1
 */
export function computeKeywordSimilarity(kw1, kw2) {
  if (!kw1 || !kw2 || kw1.size === 0 || kw2.size === 0) return 0

  let intersection = 0
  let union = 0
  const allWords = new Set([...kw1.keys(), ...kw2.keys()])

  for (const word of allWords) {
    const f1 = kw1.get(word) || 0
    const f2 = kw2.get(word) || 0
    intersection += Math.min(f1, f2)
    union += Math.max(f1, f2)
  }

  return union > 0 ? intersection / union : 0
}

/* ==================== 索引集成 ==================== */

// 缓存每个文件的关键词（避免重复计算）
const keywordCache = new Map()

/**
 * 索引文件时更新关系图谱
 * - 提取引用关系
 * - 提取关键词并更新相似关系
 *
 * @param {string} filePath - 文件路径
 * @param {string} fileName - 文件名
 * @param {object} treeData - 思维导图数据
 * @param {Map<string, number>} [precomputedKeywords] - 预计算的关键词（可选）
 */
export function indexFileRelations(filePath, fileName, treeData, precomputedKeywords = null) {
  const fp = normPath(filePath)
  if (!fp || !treeData) return

  // 1. 提取并建立引用关系
  const refs = extractFileReferences(treeData)
  for (const refPath of refs) {
    const refNorm = normPath(refPath)
    if (refNorm && refNorm !== fp) {
      addRelation(fp, refNorm, RELATION_TYPES.REFERENCE, 0.8)
      addRelation(refNorm, fp, RELATION_TYPES.REFERENCED_BY, 0.8)
    }
  }

  // 2. 提取关键词并缓存
  const keywords = precomputedKeywords || extractKeywords(treeData, 50)
  keywordCache.set(fp, { keywords, fileName, updatedAt: Date.now() })

  // 3. 与已缓存的其他文件计算相似度（轻量：只和最近更新的 20 个文件比）
  if (keywordCache.size > 1) {
    const otherFiles = Array.from(keywordCache.entries())
      .filter(([p]) => p !== fp)
      .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
      .slice(0, 20)

    for (const [otherPath, otherData] of otherFiles) {
      const sim = computeKeywordSimilarity(keywords, otherData.keywords)
      if (sim >= 0.1) { // 相似度阈值，太低的不算
        addRelation(fp, otherPath, RELATION_TYPES.SIMILAR, sim)
        addRelation(otherPath, fp, RELATION_TYPES.SIMILAR, sim)
      }
    }
  }
}

/**
 * 文件被删除时清理关系
 */
export function removeFileRelations(filePath) {
  const graph = loadGraph()
  const fp = normPath(filePath)

  // 删除该文件作为源的所有关系
  delete graph[fp]

  // 删除其他文件指向该文件的关系
  for (const src of Object.keys(graph)) {
    graph[src].relations = graph[src].relations.filter(
      r => normPath(r.target) !== fp
    )
  }

  // 清关键词缓存
  keywordCache.delete(fp)

  saveGraph()
}

/* ==================== 搜索扩展 ==================== */

/**
 * 扩展搜索：基于当前搜索结果的文件，推荐关联文件
 * 用于多轮检索场景：第一轮搜到 A 文件，第二轮自动搜 A 的关联文件
 *
 * @param {Array<string>} sourceFiles - 源文件路径列表（第一轮命中的文件）
 * @param {number} maxRelated - 最多返回多少个关联文件
 * @returns {Array<{ path: string, name: string, reason: string, weight: number }>}
 */
export function expandRelatedFiles(sourceFiles, maxRelated = 5) {
  const candidates = new Map() // targetPath -> { weight, reasons }

  for (const srcFile of sourceFiles) {
    const src = normPath(srcFile)
    const rels = getRelatedFiles(src, { minWeight: 0.15, limit: 10 })

    for (const rel of rels) {
      const tgt = normPath(rel.target)
      if (sourceFiles.includes(tgt)) continue // 源文件本身跳过

      let existing = candidates.get(tgt)
      if (!existing) {
        existing = { weight: 0, reasons: [], type: rel.type }
        candidates.set(tgt, existing)
      }
      existing.weight = Math.max(existing.weight, rel.weight)
      const reasonText = rel.type === RELATION_TYPES.REFERENCE
        ? '被引用'
        : rel.type === RELATION_TYPES.REFERENCED_BY
        ? '引用了当前文件'
        : rel.type === RELATION_TYPES.MANUAL
        ? '用户标记关联'
        : '主题相似'
      if (!existing.reasons.includes(reasonText)) {
        existing.reasons.push(reasonText)
      }
    }
  }

  // 按权重排序，取前 N 个
  const result = Array.from(candidates.entries())
    .map(([path, data]) => {
      const parts = path.split('/')
      return {
        path,
        name: parts[parts.length - 1] || path,
        reason: data.reasons.join('、'),
        weight: data.weight
      }
    })
    .sort((a, b) => b.weight - a.weight)
    .slice(0, maxRelated)

  return result
}

/**
 * 获取图谱统计信息
 */
export function getGraphStats() {
  const graph = loadGraph()
  const fileCount = Object.keys(graph).length
  let relationCount = 0
  const typeCounts = {}
  for (const fp of Object.keys(graph)) {
    for (const rel of graph[fp].relations) {
      relationCount++
      typeCounts[rel.type] = (typeCounts[rel.type] || 0) + 1
    }
  }
  return {
    fileCount,
    relationCount,
    typeCounts,
    cachedKeywordFiles: keywordCache.size
  }
}

/**
 * 清空所有关系数据
 */
export function clearAllRelations() {
  graphCache = {}
  keywordCache.clear()
  saveGraph()
}

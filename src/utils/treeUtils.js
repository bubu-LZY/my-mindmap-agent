/**
 * 树形数据操作工具函数
 */

/**
 * 将树形数据转为缩进文本（用于 AI 上下文）
 * @param {object} node 树节点
 * @param {number} depth 当前深度
 * @returns {string} 缩进文本
 */
export function treeToText(node, depth = 0) {
  if (!node || !node.data) return ''
  let line = stripHtml(node.data.text)
  // 包含节点备注（note）：备注是节点的补充说明，AI 需要看到才能完整理解内容
  const note = node.data.note ? stripHtml(String(node.data.note)) : ''
  if (note) {
    line += ` 【备注：${note}】`
  }
  // 概要/概括内容：AI 需要看到 CTRL+G 添加的概要，否则无法回答相关内容
  const generalization = node.data.generalization
  const genList = Array.isArray(generalization) ? generalization : (generalization ? [generalization] : [])
  const genText = genList.map(g => stripHtml(g?.text || '')).filter(Boolean).join('；')
  if (genText) {
    line += ` 【概要：${genText}】`
  }
  // 节点图片：文本上下文中只保留“有图片”的标记，真正识别内容用 read_node_image 工具
  if (node.data.image) {
    line += ' 【图片】'
  }
  let text = '  '.repeat(depth) + '- ' + line + '\n'
  if (node.children && node.children.length > 0) {
    node.children.forEach(child => {
      text += treeToText(child, depth + 1)
    })
  }
  return text
}

/**
 * 获取从根到指定 uid 节点的路径文本
 * @param {object} treeData 树形数据
 * @param {string} uid 目标节点 uid
 * @returns {string} 路径文本，以 " > " 分隔
 */
export function getNodePath(treeData, uid) {
  const path = []
  function find(node) {
    if (node.data?.uid === uid) {
      path.push(stripHtml(node.data.text))
      return true
    }
    if (node.children) {
      for (const child of node.children) {
        if (find(child)) {
          path.unshift(stripHtml(node.data.text))
          return true
        }
      }
    }
    return false
  }
  find(treeData)
  return path.join(' > ')
}

/**
 * 获取指定 uid 节点的子树数据
 * @param {object} treeData 树形数据
 * @param {string} uid 目标节点 uid
 * @returns {object|null} 子树数据，未找到返回 null
 */
export function getNodeSubtree(treeData, uid) {
  if (treeData.data?.uid === uid) return treeData
  if (treeData.children) {
    for (const child of treeData.children) {
      const result = getNodeSubtree(child, uid)
      if (result) return result
    }
  }
  return null
}

/**
 * 统计节点数量
 * @param {object} node 树节点
 * @returns {number} 节点总数
 */
export function countNodes(node) {
  let count = 1
  if (node.children) {
    node.children.forEach(child => {
      count += countNodes(child)
    })
  }
  return count
}

/**
 * 获取最大深度
 * @param {object} node 树节点
 * @param {number} depth 当前深度
 * @returns {number} 最大深度
 */
export function getMaxDepth(node, depth = 1) {
  if (!node.children || node.children.length === 0) return depth
  return Math.max(...node.children.map(child => getMaxDepth(child, depth + 1)))
}

/**
 * 骨架模式树转文本：只展开前 maxDepth 层，更深层折叠为「节点文本（N 个子节点…）」
 * 用于大导图的分级加载，避免上下文膨胀
 * @param {object} node 树节点
 * @param {number} maxDepth 最大展开深度（根节点为第 1 层）
 * @param {number} depth 当前深度
 * @returns {string} 缩进文本
 */
export function treeToSkeletonText(node, maxDepth = 2, depth = 1) {
  if (!node || !node.data) return ''
  let text = stripHtml(node.data.text) || '（空节点）'
  // 骨架模式可见节点（未折叠）也显示备注
  const note = node.data.note ? stripHtml(String(node.data.note)) : ''
  if (note) {
    text += ` 【备注：${note}】`
  }
  const generalization = node.data.generalization
  const genList = Array.isArray(generalization) ? generalization : (generalization ? [generalization] : [])
  const genText = genList.map(g => stripHtml(g?.text || '')).filter(Boolean).join('；')
  if (genText) {
    text += ` 【概要：${genText}】`
  }
  if (node.data.image) {
    text += ' 【图片】'
  }
  const childCount = node.children ? node.children.length : 0
  if (depth >= maxDepth && childCount > 0) {
    return '  '.repeat(depth - 1) + `- ${text}（${childCount} 个子节点已折叠…）\n`
  }
  let result = '  '.repeat(depth - 1) + `- ${text}\n`
  if (childCount > 0) {
    node.children.forEach(child => {
      result += treeToSkeletonText(child, maxDepth, depth + 1)
    })
  }
  return result
}

/**
 * 去除 HTML 标签
 * @param {string} html 含 HTML 标签的文本
 * @returns {string} 纯文本
 */
function stripHtml(html) {
  if (!html) return ''
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .trim()
}

/**
 * 拍平树为节点 uid 清单：[{ uid, path }]，path 为「根 > … > 该节点」的路径文本
 * 用于生成/导入导图后把 uid 映射返回给 AI，避免 AI 反复 search_nodes 逐个拿 uid
 * @param {object} node 树节点
 * @param {number} maxCount 最多返回条数（0=不限制）；超出时 truncated=true
 * @returns {{ list: Array<{uid:string, path:string}>, truncated: boolean, total: number }}
 */
export function treeToUidList(node, maxCount = 0) {
  const list = []
  let truncated = false
  let total = 0
  const walk = (n, pathArr) => {
    if (!n || !n.data) return
    total++
    const text = stripHtml(n.data.text) || '（空）'
    const uid = n.data.uid || ''
    if (!truncated) {
      if (maxCount > 0 && list.length >= maxCount) {
        truncated = true
      } else {
        list.push({ uid, path: pathArr.concat([text]).join(' > ') })
      }
    }
    const nextArr = pathArr.concat([text])
    ;(n.children || []).forEach(c => walk(c, nextArr))
  }
  walk(node, [])
  return { list, truncated, total }
}

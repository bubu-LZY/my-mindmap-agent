/**
 * 知识库检索服务
 * 优先使用思维导图内容和本地知识库构建系统提示
 */

import { treeToText } from '../utils/treeUtils'

/**
 * 构建系统提示，优先使用思维导图内容和本地知识库
 * @param {object} mindMap simple-mind-map 实例
 * @param {string} userQuestion 用户问题
 * @returns {Promise<string>} 组合后的系统提示
 */
export async function buildSystemPrompt(mindMap, userQuestion) {
  // 1. 获取当前思维导图内容，转为扁平文本
  const data = mindMap.getData()
  const currentContext = treeToText(data)

  // 2. 检索本地知识库
  let knowledgeContext = ''
  try {
    const results = await window.electronAPI.searchKnowledgeBase(userQuestion)
    if (results && results.length > 0) {
      knowledgeContext = results
        .map(r => `【${r.filename}】\n${r.content}`)
        .join('\n---\n')
    }
  } catch (e) {
    console.error('知识库检索失败:', e)
  }

  // 3. 组合系统提示
  return `你是一个思维导图AI助手。

【当前思维导图内容】
${currentContext}

${knowledgeContext ? `【相关知识库内容】\n${knowledgeContext}` : ''}

请基于以上内容回答用户问题。优先使用思维导图和知识库中的信息。如果内部数据中没有相关信息，再使用通用知识回答。`
}

export default buildSystemPrompt

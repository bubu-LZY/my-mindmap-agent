/**
 * AI Prompt 模板集合
 */

/**
 * 生成思维导图的 Prompt
 * @param {string} topic 主题
 * @returns {string} Prompt 文本
 */
export const generateMindMapPrompt = topic => `你是一个思维导图生成助手。请根据以下主题生成一个结构化的思维导图。

要求：
1. 使用 Markdown 格式输出，# 为根节点，## 为一级分支，### 为二级分支，依此类推
2. 层级不超过4层
3. 每个节点内容简洁，不超过20个字
4. 一级分支3-7个，每个分支下有2-5个子节点
5. 只输出 Markdown 内容，不要其他说明

主题：${topic}`

/**
 * 扩展节点的 Prompt
 * @param {string} nodePath 节点路径
 * @param {string} direction 扩展方向 child | sibling
 * @returns {string} Prompt 文本
 */
export const expandNodePrompt = (nodePath, direction) => `你是一个思维导图扩展助手。请为以下路径的最后一个节点生成${direction === 'child' ? '子节点' : '兄弟节点'}。

当前节点路径：${nodePath}

要求：
1. 生成3-5个节点
2. 每个节点内容简洁，不超过15个字
3. 节点之间用换行分隔，每行一个
4. 只输出节点文本，不要编号和其他说明`

/**
 * 总结的 Prompt
 * @param {string} content 思维导图内容
 * @returns {string} Prompt 文本
 */
export const summarizePrompt = content => `请总结以下思维导图内容的核心要点（100字以内）：

${content}`

/**
 * 智能整理的 Prompt
 * @param {string} content 思维导图内容
 * @returns {string} Prompt 文本
 */
export const reorganizePrompt = content => `你是一个思维导图整理专家。请重新组织以下思维导图的节点层级，使其逻辑更清晰。

要求：
1. 合并重复或相似的节点
2. 调整层级关系，使分类更合理
3. 保持原有信息的完整性
4. 输出为 Markdown 格式（# 为根节点）

原始内容：
${content}`

/**
 * 智能问答的系统 Prompt
 * @param {string} mindMapContent 思维导图内容
 * @param {string} knowledgeContent 知识库内容
 * @returns {string} 系统 Prompt 文本
 */
export const querySystemPrompt = (mindMapContent, knowledgeContent) => `你是一个思维导图AI助手。

【当前思维导图内容】
${mindMapContent}

${knowledgeContent ? `【相关知识库内容】\n${knowledgeContent}` : ''}

请基于以上内容回答用户的问题。优先使用思维导图和知识库中的信息。如果内部数据中没有相关信息，再使用通用知识回答，并注明"以下内容来自通用知识"。`

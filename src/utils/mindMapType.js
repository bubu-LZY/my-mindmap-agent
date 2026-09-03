/**
 * 思维导图内容轻量分类器
 * 用于让右键 AI 功能（续写/新增子节点、背诵改写、挖空、出题、整理导图）按导图类型选择适配模板，
 * 而不是对所有内容套用同一个“考试复习”模板。
 *
 * 参考用途：辅助学习/考试复习、流程/步骤、时间/规划、问题分析/决策、通用知识整理。
 * 分类只依据根节点 + 一级分支（必要时再回退到全树前 2000 字），避免整图扫描拖慢速度。
 */

const stripHtml = (s) => {
  if (typeof s !== 'string') return ''
  if (!s.includes('<')) return s
  try {
    const div = document.createElement('div')
    div.innerHTML = s
    return div.textContent || div.innerText || ''
  } catch (e) {
    return String(s).replace(/<[^>]+>/g, '')
  }
}

const nodeText = (node) => {
  if (!node || typeof node !== 'object') return ''
  const raw = typeof node.getData === 'function'
    ? node.getData('text')
    : (node.data && node.data.text) || node.text
  return stripHtml(raw || '').trim()
}

/**
 * 类型定义。每种类型给出：
 * - label      中文标签（用于日志/界面提示）
 * - rule       整体约束（追加到上下文）
 * - continue   续写/新增子节点规则
 * - rewrite    背诵改写规则
 * - cloze      挖空焦点
 * - quiz       出题偏好
 * - organize   整理导图结构规则
 */
const TYPE_DEFS = {
  timeline: {
    type: 'timeline',
    label: '时间/规划',
    rule: '按时间顺序、阶段或里程碑组织；不能打乱先后关系，时间节点与对应事件必须一一对应。',
    continue: '围绕时间节点/里程碑/阶段目标展开，优先补全“时间-事件-结论/意义”，保持时间先后，不要跳序或编造年份。',
    rewrite: '聚焦时间点、里程碑和阶段结果做记忆简写与概要；记忆法优先时间轴串联或分阶段归纳，禁止为了押韵打乱时间顺序。',
    cloze: '优先挖空时间、年份、阶段、里程碑、对应事件或结论词；不挖“阶段一/第一阶段”这类仅表示顺序的标签。',
    quiz: '出题优先覆盖时间与事件对应关系、阶段划分与关键结论，题型以填空/匹配/单选为主。',
    organize: '按“时间/阶段-事件-结论/意义”归类，保持时间线，把同一时期的节点合并。'
  },
  process: {
    type: 'process',
    label: '流程/步骤',
    rule: '保持阶段-步骤-要点的层级与先后顺序；每一步要简洁、可执行，避免把顺序打乱。',
    continue: '围绕步骤展开，优先补全“操作要点-注意事项-判断标准”，严格保持先后顺序，不要新增不属于该流程的步骤。',
    rewrite: '聚焦步骤动词、关键条件和先后顺序做记忆简写与概要；记忆法优先顺序串联或口诀，谐音仅在自然顺口时使用。',
    cloze: '优先挖空关键动作、条件、先后顺序词（先/再/最后）和结果；不挖“第N步/步骤N”这类顺序标签。',
    quiz: '出题优先覆盖步骤顺序、关键操作与判断条件，题型以填空/判断/排序为主。',
    organize: '按“阶段-步骤-要点”归类，保持执行顺序，把零散操作合并到对应步骤下。'
  },
  exam: {
    type: 'exam',
    label: '考试复习知识点',
    rule: '围绕考点、得分点、易错点展开；宁可少而准，不要泛泛补充。',
    continue: '紧扣该知识点的考点、重点与易错点扩展，优先补全“定义-要点-意义/例子/易错对比”，不要补充与考试无关的背景。',
    rewrite: '聚焦考点/得分点/易错点生成记忆简写与记忆概要；记忆法优先首字串联或语义归纳，谐音仅在自然顺口时使用。',
    cloze: '优先挖空核心考点词、术语、数字、因果结论、限定词（唯一/最/基本/首要/核心/前提），不挖铺垫性描述。',
    quiz: '出题优先覆盖核心考点、得分点与易错点，题型以单选/多选/填空/简答为主。',
    organize: '按“章-节-知识点”的层级归类，保持考试复习的知识框架，合并同类项。'
  },
  analysis: {
    type: 'analysis',
    label: '分析/论证',
    rule: '按“论点-论据-结论/对策”组织，每个论点要有对应论据或简要分析，避免堆砌口号。',
    continue: '围绕论点补充论据、案例或结论，优先补全“论点-论据-结论”链条，保持论证逻辑，不偏离中心议题。',
    rewrite: '聚焦核心论点、论据关键词和结论做记忆简写与概要；记忆法优先逻辑链串联，禁止用谐音扭曲论证关系。',
    cloze: '优先挖空核心论点、结论词、因果关系词和限定词；不挖案例铺垫或一般性修饰。',
    quiz: '出题优先覆盖论点与论据对应关系、因果结论，题型以简答/单选/判断为主。',
    organize: '按“议题-论点-论据/结论”归类，合并同一论点的证据，保持论证链条。'
  },
  knowledge: {
    type: 'knowledge',
    label: '通用知识结构',
    rule: '按主题-分类-细节组织；合并同类项，保留原意，不编造内容。',
    continue: '按主题-分类-细节扩展，合并同类项，保留原意，不偏离当前主题。',
    rewrite: '聚焦核心概念和分类关系做记忆简写与概要；记忆法优先分类归纳或首字串联，避免生硬谐音。',
    cloze: '优先挖空核心术语、定义词、分类关键词和关键属性，不挖一般性描述。',
    quiz: '出题优先覆盖核心概念、分类和关键属性，题型以填空/选择为主。',
    organize: '按“主题-分类-细节”归类，把散点归入对应主题，保持层级清晰。'
  }
}

/**
 * 根据根节点 + 一级分支做轻量分类。
 * @param {object|string} input renderer 根节点 / plain tree / 纯文本
 */
export const classifyMindMap = (input) => {
  let sample = ''
  try {
    if (typeof input === 'string') {
      sample = input
    } else if (input && typeof input === 'object') {
      const parts = [nodeText(input)]
      const kids = Array.isArray(input.children) ? input.children : []
      for (let i = 0; i < kids.length && i < 12; i++) {
        const t = nodeText(kids[i])
        if (t) parts.push(t)
      }
      sample = parts.filter(Boolean).join(' ')
    }
  } catch (e) {
    sample = ''
  }

  const all = String(sample || '').replace(/\s+/g, ' ').trim()
  if (!all) return TYPE_DEFS.knowledge

  // 时间线特征优先判断，避免“历史发展阶段”被误判为普通流程。
  if (/时间|历史|年表|时间线|大事记|朝代|世纪|公元|年代|阶段目标|里程碑|进度|日程|计划|规划|项目/.test(all)) {
    return TYPE_DEFS.timeline
  }
  if (/流程|步骤|环节|操作方法|怎么做|如何操作|安装|部署|配置|施工|制作|使用步骤/.test(all)) {
    return TYPE_DEFS.process
  }
  if (/复习|考点|重点|记忆|背诵|章节|第[一二三四五六七八九十百\d]+章|知识点|考试|真题|易错|重难点|得分点/.test(all)) {
    return TYPE_DEFS.exam
  }
  if (/论点|论据|论证|原因|影响|意义|对策|措施|解决方案|问题|分析|评价|关系|对比/.test(all)) {
    return TYPE_DEFS.analysis
  }
  return TYPE_DEFS.knowledge
}

/**
 * 把分类结果转成一段可直接插入 prompt 的说明。
 * 默认带 continue 规则（续写/新增子节点最常使用）。
 */
export const mindMapTypePrompt = (typeInfo, field = 'rule') => {
  const info = typeInfo && typeInfo.type ? typeInfo : TYPE_DEFS.knowledge
  const detail = info[field] || info.rule
  return `【当前导图类型】${info.label}\n【类型适配要求】${detail}`
}

export { TYPE_DEFS }

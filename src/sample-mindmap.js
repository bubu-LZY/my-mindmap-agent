/**
 * 示例思维导图数据 — 用于浏览器版自动加载展示
 * 展示 my-mindmap-agent 的核心功能
 */
export function createSampleMindMap() {
  return {
    data: {
      text: '<p><span style="font-size:24px"><b>My-Mindmap Agent</b></span></p>',
      uid: 'root-sample',
      richText: true,
      expand: true
    },
    children: [
      {
        data: {
          text: '<p><span><b>AI 智能对话</b></span></p>',
          uid: 'n-ai',
          richText: true,
          expand: true
        },
        children: [
          { data: { text: '<p><span>接入大语言模型（GPT / Claude / 本地模型）</span></p>', uid: 'n-ai-1', richText: true }, children: [] },
          { data: { text: '<p><span>流式对话实时输出</span></p>', uid: 'n-ai-2', richText: true }, children: [] },
          { data: { text: '<p><span>AI 工具链：搜索、代码执行、OCR</span></p>', uid: 'n-ai-3', richText: true }, children: [] },
          { data: { text: '<p><span>多轮上下文记忆</span></p>', uid: 'n-ai-4', richText: true }, children: [] }
        ]
      },
      {
        data: {
          text: '<p><span><b>思维导图编辑</b></span></p>',
          uid: 'n-mindmap',
          richText: true,
          expand: true
        },
        children: [
          { data: { text: '<p><span>基于 Simple Mind Map 引擎</span></p>', uid: 'n-mm-1', richText: true }, children: [] },
          { data: { text: '<p><span>多种布局：逻辑图、思维导图、组织结构图</span></p>', uid: 'n-mm-2', richText: true }, children: [] },
          { data: { text: '<p><span>富文本编辑 + 图标/标签/备注</span></p>', uid: 'n-mm-3', richText: true }, children: [] },
          { data: { text: '<p><span>拖拽排序、批量样式、节点引用</span></p>', uid: 'n-mm-4', richText: true }, children: [] },
          { data: { text: '<p><span>导出 PNG / SVG / PDF</span></p>', uid: 'n-mm-5', richText: true }, children: [] }
        ]
      },
      {
        data: {
          text: '<p><span><b>大纲视图</b></span></p>',
          uid: 'n-outline',
          richText: true,
          expand: true
        },
        children: [
          { data: { text: '<p><span>树形大纲与思维导图双向同步</span></p>', uid: 'n-ol-1', richText: true }, children: [] },
          { data: { text: '<p><span>支持折叠/展开、拖拽排序</span></p>', uid: 'n-ol-2', richText: true }, children: [] },
          { data: { text: '<p><span>Markdown 导入导出</span></p>', uid: 'n-ol-3', richText: true }, children: [] }
        ]
      },
      {
        data: {
          text: '<p><span><b>艾宾浩斯复习</b></span></p>',
          uid: 'n-review',
          richText: true,
          expand: true
        },
        children: [
          { data: { text: '<p><span>节点挖空 + 间隔重复记忆</span></p>', uid: 'n-rv-1', richText: true }, children: [] },
          { data: { text: '<p><span>自动生成复习计划</span></p>', uid: 'n-rv-2', richText: true }, children: [] },
          { data: { text: '<p><span>每日复习提醒通知</span></p>', uid: 'n-rv-3', richText: true }, children: [] }
        ]
      },
      {
        data: {
          text: '<p><span><b>文件管理</b></span></p>',
          uid: 'n-file',
          richText: true,
          expand: true
        },
        children: [
          { data: { text: '<p><span>左侧文件树浏览本地文件</span></p>', uid: 'n-fl-1', richText: true }, children: [] },
          { data: { text: '<p><span>多标签页同时打开多个文件</span></p>', uid: 'n-fl-2', richText: true }, children: [] },
          { data: { text: '<p><span>支持 .smm / .md / .xmind 导入</span></p>', uid: 'n-fl-3', richText: true }, children: [] },
          { data: { text: '<p><span>文件拖拽到 AI 输入框即可引用</span></p>', uid: 'n-fl-4', richText: true }, children: [] }
        ]
      },
      {
        data: {
          text: '<p><span><b>可扩展能力体系</b></span></p>',
          uid: 'n-ext',
          richText: true,
          expand: true
        },
        children: [
          { data: { text: '<p><span>MCP 服务器管理</span></p>', uid: 'n-ext-1', richText: true }, children: [] },
          { data: { text: '<p><span>用户自定义 Skills 技能</span></p>', uid: 'n-ext-2', richText: true }, children: [] },
          { data: { text: '<p><span>自定义工具（Custom Tools）</span></p>', uid: 'n-ext-3', richText: true }, children: [] },
          { data: { text: '<p><span>本地 HTTP 远程服务</span></p>', uid: 'n-ext-4', richText: true }, children: [] }
        ]
      },
      {
        data: {
          text: '<p><span><b>消息推送</b></span></p>',
          uid: 'n-push',
          richText: true,
          expand: true
        },
        children: [
          { data: { text: '<p><span>飞书机器人消息推送</span></p>', uid: 'n-ps-1', richText: true }, children: [] },
          { data: { text: '<p><span>微信消息推送</span></p>', uid: 'n-ps-2', richText: true }, children: [] },
          { data: { text: '<p><span>定时任务自动执行</span></p>', uid: 'n-ps-3', richText: true }, children: [] }
        ]
      },
      {
        data: {
          text: '<p><span><b>趣味功能</b></span></p>',
          uid: 'n-fun',
          richText: true,
          expand: true
        },
        children: [
          { data: { text: '<p><span>桌面宠物猫互动</span></p>', uid: 'n-fn-1', richText: true }, children: [] },
          { data: { text: '<p><span>OCR 图片文字识别</span></p>', uid: 'n-fn-2', richText: true }, children: [] },
          { data: { text: '<p><span>联网搜索增强</span></p>', uid: 'n-fn-3', richText: true }, children: [] }
        ]
      }
    ]
  }
}

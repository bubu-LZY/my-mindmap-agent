const SAMPLE_FILES = {
  'computer-network': {
    fileName: '计算机网络基础.smm',
    nodes: [
      { id:'r', text:'计算机网络基础', level:0, isRoot:true, type:'concept' },
      { id:'1', text:'OSI 七层模型', level:1, type:'concept' },
      { id:'1.1', text:'物理层', level:2, type:'concept' },
      { id:'1.1.1', text:'比特流传输', level:3, type:'detail' },
      { id:'1.1.2', text:'电气特性', level:3, type:'detail' },
      { id:'1.2', text:'数据链路层', level:2, type:'concept' },
      { id:'1.2.1', text:'帧封装与差错控制', level:3, type:'detail' },
      { id:'1.3', text:'网络层', level:2, type:'concept' },
      { id:'1.3.1', text:'IP 路由与分组转发', level:3, type:'detail' },
      { id:'1.4', text:'传输层', level:2, type:'concept' },
      { id:'1.4.1', text:'TCP 可靠传输', level:3, type:'detail' },
      { id:'1.4.2', text:'UDP 无连接', level:3, type:'detail' },
      { id:'2', text:'TCP/IP 协议簇', level:1, type:'concept' },
      { id:'2.1', text:'三次握手建立连接', level:2, type:'detail' },
      { id:'2.2', text:'四次挥手释放连接', level:2, type:'detail' },
      { id:'2.3', text:'滑动窗口流量控制', level:2, type:'detail' },
      { id:'3', text:'应用层协议', level:1, type:'concept' },
      { id:'3.1', text:'HTTP/HTTPS', level:2, type:'detail' },
      { id:'3.2', text:'DNS 域名解析', level:2, type:'detail' }
    ],
    associations: [
      { from:'1.4.1', to:'2.1', label:'建立' }, { from:'1.4.1', to:'2.2', label:'释放' },
      { from:'1.4.1', to:'2.3', label:'控制' }, { from:'3.1', to:'1.4.1', label:'基于' }, { from:'3.2', to:'1.3.1', label:'依赖' }
    ],
    markdown: '# 计算机网络基础\n\n## OSI 七层模型\n\nOSI 模型把网络通信分为 7 层：\n\n- **物理层**：比特流传输\n- **数据链路层**：帧封装与差错控制\n- **网络层**：IP 路由与分组转发\n- **传输层**：TCP 可靠传输 / UDP 无连接\n- **会话层**\n- **表示层**\n- **应用层**：HTTP/HTTPS、DNS\n\n## TCP/IP 协议簇\n\n### 三次握手建立连接\n\n1. 客户端发送 SYN\n2. 服务端回应 SYN + ACK\n3. 客户端发送 ACK\n\n### 四次挥手释放连接\n\n略。\n\n## 应用层协议\n\n- **HTTP/HTTPS**：网页传输\n- **DNS**：域名 → IP 解析'
  },
  'operating-system': {
    fileName: '操作系统原理.smm',
    nodes: [
      { id:'r', text:'操作系统原理', level:0, isRoot:true, type:'concept' },
      { id:'1', text:'进程管理', level:1, type:'concept' },
      { id:'1.1', text:'进程与线程', level:2, type:'concept' },
      { id:'1.1.1', text:'PCB 进程控制块', level:3, type:'detail' },
      { id:'1.2', text:'进程调度算法', level:2, type:'concept' },
      { id:'1.2.1', text:'先来先服务 FCFS', level:3, type:'detail' },
      { id:'1.2.2', text:'时间片轮转 RR', level:3, type:'detail' },
      { id:'1.2.3', text:'多级反馈队列', level:3, type:'detail' },
      { id:'1.3', text:'进程同步与互斥', level:2, type:'concept' },
      { id:'1.3.1', text:'信号量 PV 操作', level:3, type:'detail' },
      { id:'2', text:'内存管理', level:1, type:'concept' },
      { id:'2.1', text:'分页存储管理', level:2, type:'concept' },
      { id:'2.1.1', text:'页表与快表 TLB', level:3, type:'detail' },
      { id:'2.2', text:'虚拟内存', level:2, type:'concept' },
      { id:'3', text:'文件系统', level:1, type:'concept' },
      { id:'3.1', text:'文件存储结构', level:2, type:'concept' },
      { id:'3.2', text:'磁盘调度算法', level:2, type:'concept' }
    ],
    associations: [{ from:'1.3', to:'2.1', label:'依赖' }],
    markdown: '# 操作系统原理\n\n## 进程管理\n\n### 进程与线程\n\nPCB（Process Control Block）是进程存在的唯一标志。\n\n### 调度算法\n\n- **FCFS**：先来先服务\n- **RR**：时间片轮转\n- **多级反馈队列**：综合 FCFS + RR\n\n### 信号量\n\nP 操作申请资源，V 操作释放资源。\n\n## 内存管理\n\n### 分页存储\n\n页表 + TLB（快表）加速地址转换。'
  },
  'reading-notes': {
    fileName: '深度工作.smm',
    nodes: [
      { id:'r', text:'《深度工作》读书笔记', level:0, isRoot:true, type:'concept' },
      { id:'1', text:'核心观点', level:1, type:'concept' },
      { id:'1.1', text:'深度工作 = 高质量产出', level:2, type:'detail' },
      { id:'1.2', text:'浮浅工作 = 低价值消耗', level:2, type:'detail' },
      { id:'2', text:'实践方法', level:1, type:'concept' },
      { id:'2.1', text:'专注时间排程', level:2, type:'method' },
      { id:'2.2', text:'远离社交媒体', level:2, type:'method' },
      { id:'2.3', text:'拒绝无效会议', level:2, type:'method' },
      { id:'3', text:'个人启发', level:1, type:'concept' },
      { id:'3.1', text:'用 AI 把杂事自动化', level:2, type:'idea' },
      { id:'3.2', text:'留大块时间给深度工作', level:2, type:'idea' }
    ],
    associations: [{ from:'2.1', to:'1.1', label:'支撑' }, { from:'3.1', to:'2.2', label:'改进' }],
    markdown: '# 《深度工作》读书笔记\n\n## 核心观点\n\n深度工作才能产生高质量产出；浮浅工作只是低价值的时间消耗。\n\n## 实践方法\n\n- 专注时间排程\n- 远离社交媒体\n- 拒绝无效会议\n\n## 个人启发\n\n- 用 AI 把杂事自动化\n- 留大块时间给深度工作'
  }
};

/* 模拟 AI 对话场景（按 ChatPanel.vue 真实交互流） */
const CHAT_SCENARIOS = {
  default: [
    { type:'user', text:'帮我把这份导图的核心脉络梳理一下' },
    { type:'tool', name:'get_mindmap_content', status:'done', text:'已读取当前导图 19 个节点、3 层' },
    { type:'tool', name:'ai_thinking', status:'done', text:'AI 正在分析结构…' },
    { type:'assistant', text:'这份《计算机网络基础》导图整体结构很清晰，我帮你梳理出三条主脉络：\n\n1. **OSI 七层模型**：从物理层 → 数据链路层 → 网络层 → 传输层，自下而上分层。\n2. **TCP/IP 协议簇**：重点是连接管理（3 次握手 / 4 次挥手）和流量控制（滑动窗口）。\n3. **应用层协议**：HTTP/DNS 等都跑在传输层之上。\n\n要不要我帮你用 AI 背诵改写一下"传输层"那块的文字？' }
  ],
  cloze: [
    { type:'user', text:'对【传输层】右键 → AI 智能挖空' },
    { type:'tool', name:'ai_cloze', status:'running', text:'【传输层】' },
    { type:'tool', name:'ai_cloze', status:'done', text:'✅ 已挖空：TCP 可靠传输、UDP 无连接（机器+AI 联合，2 个关键词）' },
    { type:'assistant', text:'挖空完成。你可以让 AI 自动把这部分加入复习计划（艾宾浩斯 1/3/7/15/31 天），也可以选择"仅规则挖空"模式不调用 AI。' },
    { type:'user', text:'加入复习计划' },
    { type:'tool', name:'add_to_review', status:'done', text:'✅ 已加入复习计划：1 天 / 3 天 / 7 天 / 15 天 / 31 天' }
  ],
  recite: [
    { type:'user', text:'帮我背诵改写【三次握手建立连接】' },
    { type:'tool', name:'ai_recite_rewrite', status:'running', text:'【三次握手建立连接】' },
    { type:'tool', name:'ai_recite_rewrite', status:'done', text:'✅ 已应用谐音 + 摘要' },
    { type:'assistant', text:'改写完成：\n\n**【记忆简写】**\n- 客 SYN → 服务 SYN+ACK → 客 ACK（谐音：客人【先】送，服务员【先答应了】，客人【安心了】）\n\n**【摘要】**\nTCP 三次握手用于建立可靠连接，确保双方收发能力同步。\n\n原文本已自动保存到备注，可一键还原。' }
  ]
};

/* ================================================================
 * 状态
 * ================================================================ */
let currentFile = 'computer-network';
let currentView = 'mindmap';
let currentChat = 'default';
let selectedNodeId = null;
let clozeHiddenGlobal = false;
let toolbarHasSelection = false;

/* ================================================================
 * 入口
 * ================================================================ */
function enterApp() { document.getElementById('heroPage').classList.add('hide'); }

/* ================================================================
 * 文件切换（左侧文件树）
 * ================================================================ */
function switchFile(key) {
  if (!SAMPLE_FILES[key]) return;
  currentFile = key;
  selectedNodeId = null;
  document.getElementById('currentFileName').textContent = SAMPLE_FILES[key].fileName;
  document.querySelectorAll('.recent-file-item, .tree-node[data-file]').forEach(el => el.classList.remove('active'));
  document.querySelectorAll(`[data-file="${key}"]`).forEach(el => el.classList.add('active'));
  renderMindmap();
  renderOutline();
  renderGraph();
  renderMarkdown();
}

/* 视图切换 */
function switchView(view) {
  currentView = view;
  document.querySelectorAll('.view-tab').forEach(el => el.classList.toggle('active', el.dataset.view === view));
  document.querySelectorAll('.view-content').forEach(el => el.classList.toggle('active', el.dataset.view === view));
}
function showView(view) { switchView(view); }

/* AI 对话场景切换 */
function switchChat(key) {
  currentChat = key;
  renderChat();
}

/* ================================================================
 * 渲染思维导图（自定义 SVG，严格还原 simple-mind-map 视觉）
 * ================================================================ */
function renderMindmap() {
  const nodes = SAMPLE_FILES[currentFile].nodes;
  const svg = document.getElementById('mmSvg');
  const nodesG = document.getElementById('mmNodes');
  const linksG = document.getElementById('mmLinks');

  const levelWidths = [180, 160, 140, 120];
  const rowHeight = 38;
  const xLeft = 30;
  const xGap = levelWidths[1] + 40;
  const positions = {};
  const levelHeights = [0, 0, 0, 0];
  nodes.forEach(n => {
    const lvl = n.level;
    const y = 40 + levelHeights[lvl] * rowHeight;
    positions[n.id] = { x: xLeft + lvl * xGap, y, w: levelWidths[lvl], h: 30 };
    levelHeights[lvl]++;
  });

  // 父节点映射（按缩进结构找最近父节点）
  const parentMap = {};
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].level > 0) {
      for (let j = i - 1; j >= 0; j--) {
        if (nodes[j].level === nodes[i].level - 1) { parentMap[nodes[i].id] = nodes[j].id; break; }
      }
    }
  }
  let linksSvg = '';
  Object.entries(parentMap).forEach(([cid, pid]) => {
    const p = positions[pid], c = positions[cid];
    const x1 = p.x + p.w, y1 = p.y + p.h / 2, x2 = c.x, y2 = c.y + c.h / 2;
    const midX = (x1 + x2) / 2;
    linksSvg += `<path d="M${x1},${y1} C${midX},${y1} ${midX},${y2} ${x2},${y2}" stroke="#d4d4d8" stroke-width="1.5" fill="none"/>`;
  });
  linksG.innerHTML = linksSvg;

  // 节点
  let nodesSvg = '';
  nodes.forEach(n => {
    const p = positions[n.id];
    const isSelected = selectedNodeId === n.id;
    const isRoot = n.isRoot;
    const fill = isRoot ? 'url(#mmRootGrad)' : '#fff';
    const stroke = isSelected ? '#007aff' : (isRoot ? 'transparent' : '#d4d4d8');
    const textColor = isRoot ? '#fff' : '#1d1d1f';
    nodesSvg += `<g class="mm-node ${isSelected ? 'selected' : ''}" data-id="${n.id}" onclick="selectNode('${n.id}', event)" oncontextmenu="openContextMenu(event, '${n.id}')">`;
    nodesSvg += `<rect class="mm-rect" x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" rx="${isRoot ? 14 : 6}" fill="${fill}" stroke="${stroke}" stroke-width="${isSelected ? 2.5 : (isRoot ? 0 : 1)}"/>`;
    if (n.level >= 3) {
      nodesSvg += `<circle cx="${p.x + 12}" cy="${p.y + p.h/2}" r="2.5" fill="#8e8e93"/>`;
    }
    const textX = n.level >= 3 ? p.x + 22 : p.x + p.w / 2;
    const textAnchor = n.level >= 3 ? 'start' : 'middle';
    // 演示用：对部分文本加 cloze span 还原挖空样式
    let displayText = escapeXml(n.text);
    if (currentFile === 'computer-network' && n.id === '1.4') {
      displayText = `传输层（<span class="${clozeHiddenGlobal ? 'mm-cloze-hidden' : 'mm-cloze'}">TCP 可靠传输</span> / <span class="${clozeHiddenGlobal ? 'mm-cloze-hidden' : 'mm-cloze'}">UDP 无连接</span>）`;
    }
    nodesSvg += `<text class="mm-node-text" x="${textX}" y="${p.y + p.h/2 + 4}" text-anchor="${textAnchor}" font-size="13" fill="${textColor}" font-weight="${isRoot ? '600' : '400'}">${displayText}</text>`;
    nodesSvg += '</g>';
  });
  nodesG.innerHTML = nodesSvg;

  const maxX = Math.max(...Object.values(positions).map(p => p.x + p.w)) + 30;
  const maxY = Math.max(...Object.values(positions).map(p => p.y + p.h)) + 30;
  svg.setAttribute('viewBox', `0 0 ${maxX} ${maxY}`);
}
function escapeXml(s) {
  return String(s).replace(/[<>&'"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','\'':'&apos;','"':'&quot;'}[c]));
}

/* 大纲 */
function renderOutline() {
  const nodes = SAMPLE_FILES[currentFile].nodes;
  document.getElementById('outlineList').innerHTML = nodes.map(n => {
    const indent = n.level * 22;
    const isSelected = selectedNodeId === n.id;
    return `<button class="outline-item ${isSelected ? 'selected' : ''}" onclick="selectNode('${n.id}', event)" oncontextmenu="openContextMenu(event, '${n.id}')" style="padding-left:${indent + 8}px">${
      n.level >= 3 ? '<span class="bullet">•</span>' : '<span class="bullet" style="opacity:0"></span>'
    }<span class="lvl">L${n.level}</span><span>${escapeXml(n.text)}</span></button>`;
  }).join('');
}

/* 关联图 */
function renderGraph() {
  const file = SAMPLE_FILES[currentFile];
  const nodes = file.nodes;
  const associations = file.associations || [];
  const cx = 300, cy = 220, r = 140;
  const positions = {};
  nodes.forEach((n, i) => {
 const angle = (i / nodes.length) * Math.PI * 2;
 positions[n.id] = { x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r };
 });
  let svg = '';
  associations.forEach(a => {
    const p = positions[a.from], t = positions[a.to];
    if (!p || !t) return;
    svg += `<line class="graph-link" x1="${p.x}" y1="${p.y}" x2="${t.x}" y2="${t.y}"/>`;
    svg += `<text class="graph-link-label" x="${(p.x+t.x)/2}" y="${(p.y+t.y)/2 - 4}" text-anchor="middle">${escapeXml(a.label || '')}</text>`;
  });
  nodes.forEach(n => {
    const p = positions[n.id];
    const isRoot = n.isRoot;
    svg += `<circle class="graph-node ${isRoot ? 'root' : ''}" cx="${p.x}" cy="${p.y}" r="${isRoot ? 28 : 22}" onclick="selectNode('${n.id}', event)" oncontextmenu="openContextMenu(event, '${n.id}')"/>`;
    svg += `<text x="${p.x}" y="${p.y + 4}" text-anchor="middle" font-size="11" fill="${isRoot ? '#fff' : '#1d1d1f'}" font-weight="${isRoot ? '600' : '400'}" style="pointer-events:none;">${escapeXml(n.text.slice(0, 6))}</text>`;
  });
  document.getElementById('graphSvg').innerHTML = svg;
}

/* Markdown */
function renderMarkdown() {
  const md = SAMPLE_FILES[currentFile].markdown || '';
  document.getElementById('markdownContent').innerHTML = md
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^- ([^\n]+)$/gm, '<li>$1</li>')
    .replace(/((?:<li>.*<\/li>\n?)+)/g, m => `<ul>${m}</ul>`)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/^/, '<p>')
    .replace(/$/, '</p>');
}

/* ================================================================
 * 节点选中
 * ================================================================ */
function selectNode(id, evt) {
  if (evt) evt.stopPropagation();
  selectedNodeId = id;
  renderMindmap();
  renderOutline();
  toolbarHasSelection = true;
  document.querySelectorAll('.ft-btn[data-needs-selection]').forEach(b => b.classList.remove('disabled'));
}
function clearSelection() {
  selectedNodeId = null;
  toolbarHasSelection = false;
  renderMindmap();
  renderOutline();
  document.querySelectorAll('.ft-btn[data-needs-selection]').forEach(b => b.classList.add('disabled'));
}

/* ================================================================
 * 右键菜单（严格按 Contextmenu.vue 节点菜单生成）
 * ================================================================ */
function openContextMenu(evt, nodeId) {
  evt.preventDefault();
  evt.stopPropagation();
  closeContextMenu();
  selectNode(nodeId, null);
  const node = SAMPLE_FILES[currentFile].nodes.find(n => n.id === nodeId);
  if (!node) return;
  const items = buildNodeMenu(node);
  const menu = document.createElement('div');
  menu.className = 'ctx-menu';
  menu.id = 'ctxMenu';
  items.forEach(it => {
    if (it.sep) {
      const sep = document.createElement('div'); sep.className = 'ctx-sep'; menu.appendChild(sep); return;
    }
    const btn = document.createElement('button');
    btn.className = 'ctx-item' + (it.danger ? ' danger' : '');
    let prefix = '';
    if (it.badge) prefix = `<span class="badge">${it.badge}</span>`;
    else if (it.ai) prefix = '<span class="ai-dot"></span>';
    else prefix = '<span class="placeholder"></span>';
    btn.innerHTML = `${prefix}<span class="label">${escapeXml(it.label)}</span>${it.shortcut ? `<span class="shortcut">${it.shortcut}</span>` : ''}`;
    btn.onclick = () => onCtxAction(it.key, nodeId);
    menu.appendChild(btn);
  });
  document.body.appendChild(menu);
  // 自适应位置
  const r = menu.getBoundingClientRect();
  const margin = 8;
  const l = (evt.clientX + r.width + margin > window.innerWidth)
    ? Math.max(margin, window.innerWidth - r.width - margin) : evt.clientX;
  const t = (evt.clientY + r.height + margin > window.innerHeight)
    ? Math.max(margin, window.innerHeight - r.height - margin) : evt.clientY;
  menu.style.left = l + 'px';
  menu.style.top = t + 'px';
}
function buildNodeMenu(node) {
  // 严格对应 Contextmenu.vue 的 nodeMenuItems
  return [
    { key:'NOTE', label: '添加备注' },
    { key:'IMAGE', label: '插入图片' },
    { sep: true },
    { key:'DELETE', label: '删除节点', shortcut:'Delete', danger:true },
    { sep: true },
    { key:'AI_CONTINUE', label: `AI 续写「${node.text}」`, ai: true },
    { key:'AI_ADD_CHILD', label: 'AI 新增子节点', ai: true },
    { key:'AI_REWRITE', label: 'AI 背诵改写此节点', badge:'改写', ai: true },
    { key:'AI_CLOZE', label: 'AI 智能挖空', badge:'挖空', ai: true },
    { key:'AI_QUIZ', label: 'AI 出题', badge:'出题', ai: true },
    { key:'AI_ADD_TO_CHAT', label: '将节点添加到 AI 对话', badge:'对话', ai: true },
    { sep: true },
    { key:'ADD_REVIEW', label: '添加复习计划', shortcut:'Ctrl+R' },
    { key:'ADD_TAG', label: '添加标签' }
  ];
}
function onCtxAction(key, nodeId) {
  closeContextMenu();
  if (key === 'AI_CLOZE') {
    showModal({
      title:'选择挖空方式',
      content:'「仅兜底挖空」直接命中内置正则/结构规则，速度快、不调用 AI；<br>「AI 介入挖空」会在规则基础上用 AI 补充和精修，更全面但较慢。',
      buttons:[
        { text:'AI 介入挖空', primary:true, onClick: ()=>{ hideModal(); simulateCloze(nodeId, true); } },
        { text:'仅兜底挖空', onClick: ()=>{ hideModal(); simulateCloze(nodeId, false); } },
        { text:'取消', secondary:true, onClick: hideModal }
      ]
    });
    return;
  }
  const text = SAMPLE_FILES[currentFile].nodes.find(n => n.id === nodeId).text;
  if (key === 'AI_CONTINUE') {
    addChatMsg({ type:'user', text:`AI 续写【${text}】` });
    simulateTool('ai_continue_children', '续写子节点中…', () => {
      addChatMsg({ type:'assistant', text:`已为「${text}」生成 2 个子节点：\n\n- 子节点 1（基于内容衍生）\n- 子节点 2（应用复习计划）` });
    });
  } else if (key === 'AI_ADD_TO_CHAT') {
    addChatMsg({ type:'user', text:`把节点【${text}】添加到对话` });
    addChatMsg({ type:'assistant', text:`已收到节点内容：\n\n> ${text}\n\n你想对它做什么？` });
  } else if (key === 'ADD_REVIEW') {
    addChatMsg({ type:'tool', name:'add_to_review', status:'done', text:`✅ 已加入复习计划：1 天 / 3 天 / 7 天 / 15 天 / 31 天（${text}）` });
  } else if (key === 'AI_REWRITE') {
    addChatMsg({ type:'user', text:`AI 背诵改写【${text}】` });
    simulateTool('ai_recite_rewrite', '应用谐音 + 摘要…', () => {
      addChatMsg({ type:'assistant', text:`已为「${text}」生成【记忆简写】+ 摘要。\n\n原文本已自动保存到备注，可一键还原。` });
    });
  } else if (key === 'AI_QUIZ') {
    addChatMsg({ type:'user', text:`AI 出题【${text}】` });
    simulateTool('ai_quiz', '生成单选 / 多选 / 填空…', () => {
      addChatMsg({ type:'assistant', text:`已为「${text}」生成 2 道单选 + 1 道填空题。` });
    });
  } else if (key === 'ADD_TAG') {
    addChatMsg({ type:'assistant', text:`标签已添加（演示版）。` });
  } else if (key === 'DELETE') {
    addChatMsg({ type:'assistant', text:`节点「${text}」删除已记录（演示版未真实删除）。` });
  } else if (key === 'NOTE') {
    addChatMsg({ type:'assistant', text:`已为「${text}」打开备注输入框（演示版）。` });
  } else if (key === 'IMAGE') {
    addChatMsg({ type:'assistant', text:`图片选择对话框已打开（演示版）。` });
  }
}
function closeContextMenu() {
  const m = document.getElementById('ctxMenu');
  if (m) m.remove();
}

/* ================================================================
 * 模拟 AI 工具调用与回复
 * ================================================================ */
function simulateTool(name, runningText, onDone) {
  addChatMsg({ type:'tool', name, status:'running', text: runningText });
  setTimeout(() => {
    const msgs = document.getElementById('chatMessages').children;
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].classList.contains('tool')) {
        msgs[i].querySelector('.tool-status').className = 'tool-status done';
        msgs[i].querySelector('.tool-status').textContent = '✓ 完成';
        return;
      }
    }
    if (onDone) onDone();
  }, 1100);
}
function simulateCloze(nodeId, withAi) {
  const text = SAMPLE_FILES[currentFile].nodes.find(n => n.id === nodeId).text;
  if (withAi) {
    simulateTool('ai_cloze', '【机器挖】+【AI 补】+【AI 复查】三步流程中…', () => {
      addChatMsg({ type:'assistant', text:`已完成「${text}」挖空：\n\n- 步骤1（机器）：识别 1 个关键词\n- 步骤2（AI 补）：补充 1 个关键词\n- 步骤3（AI 复查）：保留 2 个、移除 0 个\n\n挖空内容已隐藏（演示版显示效果）。` });
    });
  } else {
    addChatMsg({ type:'assistant', text:`已完成「${text}」规则挖空：\n\n- 仅命中内置正则，识别 1 个关键词\n- 未调用 AI，速度快` });
  }
}

/* ================================================================
 * 弹窗
 * ================================================================ */
function showModal({ title, content, buttons }) {
  const m = document.getElementById('modalContent');
  m.innerHTML = `<h3>${title}</h3><p>${content}</p><div class="modal-actions">${
    buttons.map((b, i) => `<button class="modal-btn ${b.primary ? 'primary' : ''} ${b.secondary ? 'secondary' : ''}" data-i="${i}">${escapeXml(b.text)}</button>`).join('')
  }</div>`;
  document.getElementById('modalMask').classList.add('show');
  buttons.forEach((b, i) => { m.querySelector(`[data-i="${i}"]`).onclick = b.onClick; });
}
function hideModal() { document.getElementById('modalMask').classList.remove('show'); }

/* ================================================================
 * AI 对话
 * ================================================================ */
function renderChat() {
  const msgs = CHAT_SCENARIOS[currentChat] || [];
  document.getElementById('chatMessages').innerHTML = '';
  msgs.forEach(addChatMsg);
  const sug = {
    default: ['帮我做一份 AI 复习计划', '把这份导图导出为 PDF', 'AI 出几道复习题'],
    cloze: ['加入复习计划', '改成"仅兜底挖空"模式', '查看挖空关键字列表'],
    recite: ['把这个改回原文', '应用到所有子节点', '导出背诵卡片']
  }[(currentChat)] || [];
  document.getElementById('chatSuggestions').innerHTML = sug.map(s => `<button class="chat-suggestion" onclick="useSuggestion('${escapeXml(s)}')">${escapeXml(s)}</button>`).join('');
}
function useSuggestion(t) { document.getElementById('chatInput').value = t; sendChat(); }
function addChatMsg(msg) {
  const div = document.createElement('div');
  if (msg.type === 'tool') {
    div.className = 'chat-msg tool';
    div.innerHTML = `<span class="tool-status ${msg.status === 'done' ? 'done' : 'running'}">${msg.status === 'done' ? '✓ 完成' : '⏳ 进行中'}</span> <strong>${msg.name}</strong>: ${escapeXml(msg.text)}`;
  } else {
    div.className = `chat-msg ${msg.type}`;
    let html = escapeXml(msg.text)
      .replace(/```(.+?)```/gs, '<pre><code>$1</code></pre>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/- (.+)/g, '<li>$1</li>')
      .replace(/(<li>.+<\/li>\n?)+/g, m => `<ul>${m}</ul>`);
    div.innerHTML = html;
  }
  document.getElementById('chatMessages').appendChild(div);
  document.getElementById('chatMessages').scrollTop = 1e9;
}
function sendChat() {
  const input = document.getElementById('chatInput');
  const t = input.value.trim();
  if (!t) return;
  input.value = '';
  addChatMsg({ type:'user', text: t });
  const ty = document.createElement('div');
  ty.className = 'chat-typing';
  ty.innerHTML = '<span class="dot"></span><span class="dot"></span><span class="dot"></span>';
  document.getElementById('chatMessages').appendChild(ty);
  document.getElementById('chatMessages').scrollTop = 1e9;
  setTimeout(() => {
    ty.remove();
    addChatMsg({ type:'assistant', text:`已收到："${t}"。\n\n（演示版为静态展示，未连接真实 AI；安装包内可使用完整 AI 能力。）` });
  }, 1200);
}

/* FixedToolbar 内部联动 */
function toggleClozeGlobal() {
  clozeHiddenGlobal = !clozeHiddenGlobal;
  renderMindmap();
  const btn = document.getElementById('ftClozeToggle');
  if (btn) btn.classList.toggle('active', clozeHiddenGlobal);
}

/* 启动 */
switchFile('computer-network');
renderChat();

/* 点击空白处关闭右键菜单 */
document.addEventListener('click', (e) => {
  if (!e.target.closest('.ctx-menu')) closeContextMenu();
  if (e.target === document.getElementById('mainCanvas') ||
      (e.target.classList && e.target.classList.contains('mm-node-text'))) {
    // 不做处理，让节点点击事件触发
  }
});
document.addEventListener('contextmenu', (e) => {
  if (!e.target.closest('.mm-node')) {
    e.preventDefault();
    // 画布右键（演示版空操作）
  }
});

/* 拉取最新版本号（永远不写固定版本号） */
fetch('https://api.github.com/repos/bubu-LZY/my-mindmap-agent/releases/latest')
  .then(r => r.ok ? r.json() : null)
  .then(d => {
    if (!d || !d.tag_name) return;
    const v = d.tag_name.replace(/^v/, '');
    const e = document.getElementById('latestVer');
    if (e) e.textContent = 'v' + v;
  })
  .catch(() => {});



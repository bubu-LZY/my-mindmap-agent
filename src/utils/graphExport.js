// 关联图导出为交互式 HTML
// 生成自包含的单文件 HTML，打开后可拖动节点、缩放平移

const DEPTH_COLORS = ['#0a84ff', '#30b0c7', '#34c759', '#ff9500', '#af52de', '#8e8e93', '#ff3b30']

/**
 * 从导图原始数据构建图数据（与 GraphView.vue 中的 buildFromRawData 保持一致）
 */
export function buildGraphDataFromRaw(rawData) {
  const nodes = []
  const links = []
  if (!rawData) return { nodes, links }

  const truncate = (s, n = 30) => (s.length > n ? s.slice(0, n) + '…' : s)
  const seenAssoc = new Set()

  const htmlToText = (html) => {
    if (!html) return ''
    // 浏览器端用 DOMParser，node 端用正则
    if (typeof document !== 'undefined' && document.createElement) {
      const div = document.createElement('div')
      div.innerHTML = String(html)
      return (div.textContent || '').replace(/\s+/g, ' ').trim()
    }
    return String(html).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
  }

  const walk = (nodeData, parentUid, depth) => {
    if (!nodeData || !nodeData.data) return
    const d = nodeData.data
    const uid = String(d.uid || '')
    if (!uid) return
    if (d.generalization && !d.text) return // 跳过概括节点

    const markdownTable = d.markdownTable || ''
    const isTable = !!(d.tableHtml || markdownTable)
    let text = htmlToText(d.text || '') || '未命名'
    if (isTable) {
      const rows = String(markdownTable || '').split('\n').filter(l => /^\s*\|/.test(l))
      const bodyRows = Math.max(0, rows.filter(l => !/^\|[\s:|-]+\|$/.test(l)).length - 1)
      text = `📊 表格（${bodyRows} 行）`
    }
    const note = d.note || ''
    const image = d.image?.url || d.image?.src || ''
    nodes.push({
      id: uid,
      name: truncate(text),
      fullName: text,
      depth,
      hasNote: !!note,
      note,
      hasImage: !!image,
      image
    })
    if (parentUid) {
      links.push({ source: parentUid, target: uid, type: 'tree' })
    }
    const targets = Array.isArray(d.associativeLineTargets) ? d.associativeLineTargets : []
    const textMap = d.associativeLineText || {}
    for (const toUid of targets) {
      const t = String(toUid)
      const key = [uid, t].sort().join('|')
      if (!seenAssoc.has(key)) {
        seenAssoc.add(key)
        links.push({ source: uid, target: t, type: 'assoc', label: textMap[toUid] || '' })
      }
    }
    if (Array.isArray(nodeData.children)) {
      nodeData.children.forEach(c => walk(c, uid, depth + 1))
    }
  }
  walk(rawData, null, 0)
  return { nodes, links }
}

/**
 * 生成自包含的关联图 HTML 文件
 * @param {Object} graphData - { nodes, links }
 * @param {string} title - 标题
 * @returns {string} HTML 字符串
 */
export function buildGraphHtml(graphData, title = '关联图') {
  const dataJson = JSON.stringify(graphData)
  const colorsJson = JSON.stringify(DEPTH_COLORS)

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title} - 关联图</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 100%; height: 100%; overflow: hidden; background: #fafafa; font-family: "Microsoft YaHei", "PingFang SC", sans-serif; }
  #graph { width: 100vw; height: 100vh; display: block; cursor: grab; }
  #graph:active { cursor: grabbing; }
  .header {
    position: fixed; top: 0; left: 0; right: 0; height: 48px;
    display: flex; align-items: center; justify-content: space-between;
    padding: 0 20px;
    background: rgba(255,255,255,0.85); backdrop-filter: blur(10px);
    border-bottom: 1px solid rgba(0,0,0,0.06);
    z-index: 10; pointer-events: none;
  }
  .header h1 { font-size: 15px; font-weight: 600; color: #1d1d1f; }
  .header .stats { font-size: 12px; color: #86868b; }
  .legend {
    position: fixed; bottom: 16px; left: 16px;
    background: rgba(255,255,255,0.9); border-radius: 8px;
    padding: 10px 14px; font-size: 12px; color: #1d1d1f;
    box-shadow: 0 2px 12px rgba(0,0,0,0.08);
    z-index: 10;
  }
  .legend-item { display: flex; align-items: center; gap: 8px; margin: 4px 0; }
  .legend-dot { width: 10px; height: 10px; border-radius: 50%; }
  .legend-line { width: 20px; height: 2px; }
  .tip {
    position: fixed; bottom: 16px; right: 16px;
    font-size: 11px; color: #86868b;
    z-index: 10;
  }
</style>
</head>
<body>
<div class="header">
  <h1>${title}</h1>
  <div class="stats" id="stats"></div>
</div>
<div id="graph"></div>
<div class="legend">
  <div class="legend-item">
    <div class="legend-line" style="background: rgba(0,0,0,0.18); height: 1px;"></div>
    <span>层级关系</span>
  </div>
  <div class="legend-item">
    <div class="legend-line" style="background: rgba(10,132,255,0.6);"></div>
    <span>关联线</span>
  </div>
</div>
<div class="tip">滚轮缩放 · 拖拽平移 · 拖动节点调整位置</div>

<script src="https://unpkg.com/force-graph@1.51.4/dist/force-graph.min.js"></script>
<script>
(function() {
  const data = ${dataJson};
  const COLORS = ${colorsJson};

  const statsEl = document.getElementById('stats');
  statsEl.textContent = data.nodes.length + ' 个节点 · ' + data.links.length + ' 条连线';

  const container = document.getElementById('graph');
  const w = window.innerWidth;
  const h = window.innerHeight;

  const graph = ForceGraph()(container)
    .width(w)
    .height(h)
    .backgroundColor('#fafafa')
    .nodeId('id')
    .linkSource('source')
    .linkTarget('target')
    .linkColor(function(link) {
      return link.type === 'assoc' ? 'rgba(10, 132, 255, 0.55)' : 'rgba(0, 0, 0, 0.12)';
    })
    .linkWidth(function(link) {
      return link.type === 'assoc' ? 1.5 : 0.8;
    })
    .linkDirectionalArrowLength(function(link) {
      return link.type === 'assoc' ? 4 : 0;
    })
    .linkDirectionalArrowRelPos(1)
    .linkLabel(function(link) { return link.label || ''; })
    .nodeLabel(function(node) { return node.fullName || node.name || ''; })
    .nodeVal(6)
    .enablePanInteraction(true)
    .enableZoomInteraction(true)
    .nodeCanvasObjectMode(function() { return 'replace'; })
    .nodeCanvasObject(function(node, ctx, globalScale) {
      if (node.x == null || node.y == null) return;
      var r = 5;
      var color = COLORS[(node.depth || 0) % COLORS.length];
      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, 2 * Math.PI, false);
      ctx.fillStyle = color;
      ctx.fill();
      // 备注标识（右上角小黄点）
      if (node.hasNote) {
        ctx.beginPath();
        ctx.arc(node.x + r - 1, node.y - r + 1, 2.2, 0, 2 * Math.PI, false);
        ctx.fillStyle = '#ffcc00';
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      // 图片标识（右下角小绿点）
      if (node.hasImage) {
        ctx.beginPath();
        ctx.arc(node.x + r - 1, node.y + r - 1, 2.2, 0, 2 * Math.PI, false);
        ctx.fillStyle = '#34c759';
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      if (globalScale >= 0.5 && node.name) {
        var fontSize = 12 / globalScale;
        ctx.font = fontSize + 'px "Microsoft YaHei", "PingFang SC", sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = 'rgba(40, 44, 52, 0.88)';
        ctx.fillText(node.name, node.x + r + 4, node.y);
      }
    })
    .nodePointerAreaPaint(function(node, color, ctx) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(node.x, node.y, 10, 0, 2 * Math.PI, false);
      ctx.fill();
    })
    .graphData(data);

  // 力导向参数
  try {
    graph.d3Force('charge').strength(-120);
    graph.d3Force('link').distance(function(link) {
      return link.type === 'assoc' ? 80 : 55;
    });
    graph.d3Force('center').strength(0.05);
  } catch(e) {}

  // 自适应视图
  setTimeout(function() {
    try { graph.zoomToFit(400, 40); } catch(e) {}
  }, 500);

  // 响应窗口大小
  window.addEventListener('resize', function() {
    graph.width(window.innerWidth).height(window.innerHeight);
  });
})();
</script>
</body>
</html>`
}

/**
 * 触发浏览器下载 HTML 文件
 */
export function downloadGraphHtml(graphData, fileName = 'graph') {
  const html = buildGraphHtml(graphData, fileName)
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${fileName}.html`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

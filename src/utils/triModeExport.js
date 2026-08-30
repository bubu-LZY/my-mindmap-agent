// 三模式 HTML 导出（思维导图 + 大纲 + 关联图）
// 生成自包含的单文件 HTML，支持三种视图切换 + 挖空交互

import { buildGraphDataFromRaw } from './graphExport'

/**
 * 从原始导图数据生成大纲 HTML
 */
function buildOutlineHtml(data) {
  if (!data) return ''

  const escapeHtml = (s) => String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

  // 保留 cloze span，过滤其他 HTML 标签
  // 同时保留 <br> 换行
  const textToOutlineHtml = (html) => {
    if (!html) return ''
    let s = String(html)
    // 先把 cloze span 标记成占位符，避免被过滤
    const clozeSpans = []
    s = s.replace(/<span[^>]*class="[^"]*smm-cloze[^"]*"[^>]*>([\s\S]*?)<\/span>/gi, (match, content) => {
      // 提取 cloze 内的纯文本
      const text = content.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ')
      const idx = clozeSpans.length
      clozeSpans.push(text)
      return `__CLOZE_${idx}__`
    })
    // 过滤其他 HTML 标签
    s = s.replace(/<br\s*\/?>/gi, ' ')
    s = s.replace(/<[^>]+>/g, '')
    s = s.replace(/&nbsp;/g, ' ')
    s = s.replace(/\s+/g, ' ').trim()
    // 转义
    s = escapeHtml(s)
    // 还原 cloze span
    clozeSpans.forEach((text, i) => {
      const escaped = escapeHtml(text)
      s = s.replace(
        `__CLOZE_${i}__`,
        `<span class="cloze-text">${escaped}</span>`
      )
    })
    return s || '未命名'
  }

  const items = []
  const walk = (nodeData, depth) => {
    if (!nodeData || !nodeData.data) return
    const d = nodeData.data
    if (d.generalization && !d.text) return

    const text = d.text || ''
    const hasNote = !!d.note
    const hasImage = !!(d.image?.url || d.image?.src)
    const uid = String(d.uid || '')

    const textHtml = textToOutlineHtml(text)

    const icons = []
    if (hasNote) icons.push('<span class="outline-icon note-icon" title="有备注">📝</span>')
    if (hasImage) icons.push('<span class="outline-icon img-icon" title="有图片">🖼️</span>')

    items.push(`<div class="outline-item" data-depth="${depth}" data-uid="${uid}" style="padding-left: ${depth * 24 + 8}px">
      <span class="outline-bullet" style="background: var(--depth-color-${depth % 7}, #0a84ff)"></span>
      <span class="outline-text">${textHtml}</span>
      ${icons.join('')}
    </div>`)

    if (Array.isArray(nodeData.children)) {
      nodeData.children.forEach(c => walk(c, depth + 1))
    }
  }
  walk(data, 0)
  return items.join('\n')
}

/**
 * 构建三模式 HTML
 * @param {string} svgDataUrl - 思维导图 SVG 数据（data URL）
 * @param {Object} rawData - 导图原始数据（用于大纲和关联图）
 * @param {string} title - 标题
 * @returns {Promise<string>} HTML 字符串
 */
export async function buildTriModeHtml(svgDataUrl, rawData, title = '思维导图') {
  // 构建图数据
  const graphData = buildGraphDataFromRaw(rawData)
  const graphDataJson = JSON.stringify(graphData)

  // 构建大纲 HTML
  const outlineHtml = buildOutlineHtml(rawData)

  // SVG 转文本
  const svgText = await dataUrlToSvgText(svgDataUrl)

  const colors = JSON.stringify(['#0a84ff', '#30b0c7', '#34c759', '#ff9500', '#af52de', '#8e8e93', '#ff3b30'])

  const escapeHtml = (s) => String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

  const safeTitle = escapeHtml(title)

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${safeTitle}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 100%; height: 100%; overflow: hidden; font-family: "Microsoft YaHei", "PingFang SC", sans-serif; background: #fafafa; }

  /* 顶部 Tab 切换 */
  .top-bar {
    position: fixed; top: 0; left: 0; right: 0; height: 48px;
    display: flex; align-items: center; justify-content: space-between;
    padding: 0 16px;
    background: rgba(255,255,255,0.9); backdrop-filter: blur(10px);
    border-bottom: 1px solid rgba(0,0,0,0.06);
    z-index: 100;
  }
  .top-bar .title { font-size: 14px; font-weight: 600; color: #1d1d1f; max-width: 40%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tab-group { display: flex; gap: 4px; background: #f0f0f3; padding: 3px; border-radius: 9px; }
  .tab-btn {
    padding: 6px 16px; border: none; border-radius: 7px;
    background: transparent; color: #666; font-size: 13px;
    cursor: pointer; transition: all 0.15s;
  }
  .tab-btn:hover { color: #333; }
  .tab-btn.active { background: #fff; color: #007aff; box-shadow: 0 1px 3px rgba(0,0,0,0.08); font-weight: 500; }
  .toolbar-right { display: flex; gap: 8px; align-items: center; }
  .tool-btn {
    padding: 6px 12px; border: 1px solid rgba(0,0,0,0.1); border-radius: 7px;
    background: #fff; color: #333; font-size: 12px; cursor: pointer;
    transition: all 0.15s;
  }
  .tool-btn:hover { background: #f5f5f7; border-color: rgba(0,122,255,0.3); color: #007aff; }
  .tool-btn.primary { border-color: rgba(124,58,237,0.3); color: #5b21b6; }
  .tool-btn.primary:hover { background: #f3e8ff; border-color: rgba(124,58,237,0.6); }
  .zoom-info { font-size: 12px; color: #86868b; min-width: 44px; text-align: center; }

  /* 视图容器 */
  .view-container { position: absolute; top: 48px; left: 0; right: 0; bottom: 0; overflow: hidden; }
  .view-pane { position: absolute; inset: 0; display: none; }
  .view-pane.active { display: block; }

  /* 思维导图视图 */
  #mindmap-view { background: #fafafa; }
  .mm-viewport {
    position: absolute; left: 0; top: 0;
    width: 0; height: 0;
    transform-origin: 0 0;
    cursor: grab; touch-action: none;
  }
  .mm-viewport.dragging { cursor: grabbing; }
  .mm-viewport svg { max-width: none; height: auto; display: block; }

  /* 大纲视图 */
  #outline-view { background: #fff; overflow-y: auto; overflow-x: hidden; }
  .outline-list { padding: 12px 0; }
  .outline-item {
    display: flex; align-items: center; gap: 8px;
    padding: 8px 12px 8px 0;
    border-bottom: 1px solid #f0f0f3;
    font-size: 14px; color: #1d1d1f;
    cursor: default;
    transition: background 0.15s;
  }
  .outline-item:hover { background: #f5f5f7; }
  .outline-bullet {
    flex-shrink: 0;
    width: 6px; height: 6px; border-radius: 50%;
  }
  .outline-text { flex: 1; line-height: 1.5; word-break: break-word; }
  .outline-icon { font-size: 12px; opacity: 0.6; }
  .cloze-text {
    transition: all 0.2s;
    cursor: pointer;
    /* 显示态：淡紫背景 + 紫色下划线，标记挖空位置（与应用内大纲一致） */
    background: rgba(124, 58, 237, 0.10);
    border-bottom: 2px solid rgba(124, 58, 237, 0.6);
    border-radius: 3px;
    padding: 0 2px;
  }
  .cloze-text.hidden {
    background: linear-gradient(90deg, #e9d5ff 0%, #c4b5fd 100%);
    color: transparent !important;
    border-bottom: 2px solid rgba(124, 58, 237, 0.3);
    border-radius: 4px;
    padding: 0 2px;
    user-select: none;
  }
  .outline-empty { padding: 60px 20px; text-align: center; color: #a8abb2; font-size: 13px; }

  /* 关联图视图 */
  #graph-view { background: #fafafa; }
  #graph-canvas { width: 100%; height: 100%; display: block; cursor: grab; }
  #graph-canvas:active { cursor: grabbing; }
  .graph-stats {
    position: absolute; bottom: 12px; right: 16px;
    font-size: 12px; color: #a8abb2;
    pointer-events: none;
  }
  .graph-legend {
    position: absolute; bottom: 12px; left: 16px;
    background: rgba(255,255,255,0.9); border-radius: 8px;
    padding: 10px 14px; font-size: 12px; color: #1d1d1f;
    box-shadow: 0 2px 12px rgba(0,0,0,0.08);
  }
  .legend-item { display: flex; align-items: center; gap: 8px; margin: 4px 0; }
  .legend-dot { width: 10px; height: 10px; border-radius: 50%; }
  .legend-line { width: 20px; height: 2px; }
</style>
</head>
<body>

<div class="top-bar">
  <div class="title">${safeTitle}</div>
  <div class="tab-group">
    <button class="tab-btn active" data-view="mindmap">思维导图</button>
    <button class="tab-btn" data-view="outline">大纲</button>
    <button class="tab-btn" data-view="graph">关联图</button>
  </div>
  <div class="toolbar-right">
    <span id="zoom-info" class="zoom-info">100%</span>
    <button id="zoom-out" class="tool-btn" title="缩小">−</button>
    <button id="zoom-in" class="tool-btn" title="放大">+</button>
    <button id="zoom-fit" class="tool-btn" title="适应窗口">适应</button>
    <button id="cloze-toggle" class="tool-btn primary" title="挖空显示切换">隐藏挖空</button>
  </div>
</div>

<div class="view-container">
  <!-- 思维导图视图 -->
  <div id="mindmap-view" class="view-pane active">
    <div id="mm-viewport" class="mm-viewport">
${svgText}
    </div>
  </div>

  <!-- 大纲视图 -->
  <div id="outline-view" class="view-pane">
    <div class="outline-list" id="outline-list">
${outlineHtml || '<div class="outline-empty">暂无数据</div>'}
    </div>
  </div>

  <!-- 关联图视图 -->
  <div id="graph-view" class="view-pane">
    <div id="graph-canvas"></div>
    <div class="graph-legend">
      <div class="legend-item">
        <div class="legend-line" style="background: rgba(0,0,0,0.18); height: 1px;"></div>
        <span>层级关系</span>
      </div>
      <div class="legend-item">
        <div class="legend-line" style="background: rgba(10,132,255,0.6);"></div>
        <span>关联线</span>
      </div>
      <div class="legend-item">
        <div class="legend-dot" style="background: #ffcc00;"></div>
        <span>有备注</span>
      </div>
      <div class="legend-item">
        <div class="legend-dot" style="background: #34c759;"></div>
        <span>有图片</span>
      </div>
    </div>
    <div class="graph-stats" id="graph-stats"></div>
  </div>
</div>

<script src="https://unpkg.com/force-graph@1.51.4/dist/force-graph.min.js"></script>
<script>
(function() {
  'use strict';
  var COLORS = ${colors};
  var graphData = ${graphDataJson};
  var currentView = 'mindmap';
  var graph = null;
  var graphInited = false;

  // ===== Tab 切换 =====
  var tabBtns = document.querySelectorAll('.tab-btn');
  var panes = {
    mindmap: document.getElementById('mindmap-view'),
    outline: document.getElementById('outline-view'),
    graph: document.getElementById('graph-view')
  };

  function switchView(view) {
    currentView = view;
    tabBtns.forEach(function(btn) {
      btn.classList.toggle('active', btn.dataset.view === view);
    });
    Object.keys(panes).forEach(function(k) {
      panes[k].classList.toggle('active', k === view);
    });
    if (view === 'graph' && !graphInited) {
      initGraph();
    }
    if (view === 'graph') {
      setTimeout(function() {
        try { graph.zoomToFit(300, 40); } catch(e) {}
      }, 100);
    }
    updateZoomLabel();
  }

  tabBtns.forEach(function(btn) {
    btn.addEventListener('click', function() {
      switchView(btn.dataset.view);
    });
  });

  // ===== 挖空切换 =====
  // showCloze: true=显示挖空效果（文字被遮）, false=隐藏挖空效果（文字显示）
  var clozeBtn = document.getElementById('cloze-toggle');
  var showCloze = true; // 默认显示挖空效果
  function setClozeVisible(show) {
    showCloze = show;
    clozeBtn.textContent = show ? '隐藏挖空' : '显示挖空';
    // SVG 里的挖空：smm-cloze-hidden 表示"挖空效果被隐藏"（文字显示）
    var svgClozes = document.querySelectorAll('#mindmap-view .smm-cloze');
    for (var i = 0; i < svgClozes.length; i++) {
      if (show) {
        svgClozes[i].classList.remove('smm-cloze-hidden'); // 显示挖空效果 → 移除 hidden 类
      } else {
        svgClozes[i].classList.add('smm-cloze-hidden'); // 隐藏挖空效果 → 添加 hidden 类
      }
    }
    // 大纲里的挖空：.hidden 表示文字被隐藏（挖空效果）
    var outlineClozes = document.querySelectorAll('#outline-view .cloze-text');
    for (var j = 0; j < outlineClozes.length; j++) {
      if (show) {
        outlineClozes[j].classList.add('hidden'); // 显示挖空效果 → 添加 hidden 类（文字被遮）
      } else {
        outlineClozes[j].classList.remove('hidden'); // 隐藏挖空效果 → 移除 hidden 类（文字显示）
      }
    }
  }
  // 初始状态：默认显示挖空效果（按钮文字"隐藏挖空"=点击后隐藏挖空效果）
  setClozeVisible(true);
  clozeBtn.addEventListener('click', function() {
    setClozeVisible(!showCloze);
  });

  // 大纲点击单个挖空切换显示
  var outlineList = document.getElementById('outline-list');
  outlineList.addEventListener('click', function(e) {
    var target = e.target;
    if (target.classList && target.classList.contains('cloze-text')) {
      target.classList.toggle('hidden');
    }
  });

  // ===== 思维导图缩放平移 =====
  var mmViewport = document.getElementById('mm-viewport');
  var mmSvg = mmViewport ? mmViewport.querySelector('svg') : null;
  var mmScale = 1;
  var mmTx = 0;
  var mmTy = 0;
  var MIN_SCALE = 0.05;
  var MAX_SCALE = 8;

  function applyMmTransform() {
    mmViewport.style.transform = 'translate(' + mmTx + 'px, ' + mmTy + 'px) scale(' + mmScale + ')';
    updateZoomLabel();
  }

  function updateZoomLabel() {
    var label = document.getElementById('zoom-info');
    if (!label) return;
    if (currentView === 'mindmap') {
      label.textContent = Math.round(mmScale * 100) + '%';
    } else if (currentView === 'graph') {
      try {
        var z = graph.zoom();
        label.textContent = Math.round(z.k * 100) + '%';
      } catch(e) { label.textContent = '100%'; }
    } else {
      label.textContent = '—';
    }
  }

  function fitToScreen() {
    if (!mmSvg) return;
    var bbox = mmSvg.getBBox();
    var containerW = window.innerWidth;
    var containerH = window.innerHeight - 48;
    var scaleX = containerW / bbox.width * 0.9;
    var scaleY = containerH / bbox.height * 0.9;
    mmScale = Math.min(scaleX, scaleY, 3);
    mmTx = (containerW - bbox.width * mmScale) / 2 - bbox.x * mmScale;
    mmTy = (containerH - bbox.height * mmScale) / 2 - bbox.y * mmScale;
    applyMmTransform();
  }

  // 拖拽
  var isDragging = false;
  var dragStartX = 0, dragStartY = 0;
  var startTx = 0, startTy = 0;

  mmViewport.addEventListener('mousedown', function(e) {
    if (e.button !== 0 && e.button !== 2) return;
    isDragging = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    startTx = mmTx;
    startTy = mmTy;
    mmViewport.classList.add('dragging');
    e.preventDefault();
  });
  window.addEventListener('mousemove', function(e) {
    if (!isDragging) return;
    mmTx = startTx + (e.clientX - dragStartX);
    mmTy = startTy + (e.clientY - dragStartY);
    applyMmTransform();
  });
  window.addEventListener('mouseup', function() {
    if (isDragging) {
      isDragging = false;
      mmViewport.classList.remove('dragging');
    }
  });

  // 滚轮缩放
  mmViewport.parentElement.addEventListener('wheel', function(e) {
    if (currentView !== 'mindmap') return;
    e.preventDefault();
    var delta = e.deltaY > 0 ? -0.1 : 0.1;
    var newScale = Math.min(Math.max(mmScale * (1 + delta), MIN_SCALE), MAX_SCALE);
    var rect = mmViewport.parentElement.getBoundingClientRect();
    var mouseX = e.clientX - rect.left;
    var mouseY = e.clientY - rect.top;
    var ratio = newScale / mmScale;
    mmTx = mouseX - (mouseX - mmTx) * ratio;
    mmTy = mouseY - (mouseY - mmTy) * ratio;
    mmScale = newScale;
    applyMmTransform();
  }, { passive: false });

  // 阻止右键菜单
  mmViewport.addEventListener('contextmenu', function(e) { e.preventDefault(); });

  // 缩放按钮
  document.getElementById('zoom-in').addEventListener('click', function() {
    if (currentView === 'mindmap') {
      mmScale = Math.min(mmScale * 1.2, MAX_SCALE);
      applyMmTransform();
    } else if (currentView === 'graph' && graph) {
      try {
        var z = graph.zoom();
        graph.zoom({ x: z.x, y: z.y, k: Math.min(z.k * 1.2, MAX_SCALE) }, 200);
        setTimeout(updateZoomLabel, 250);
      } catch(e) {}
    }
  });
  document.getElementById('zoom-out').addEventListener('click', function() {
    if (currentView === 'mindmap') {
      mmScale = Math.max(mmScale / 1.2, MIN_SCALE);
      applyMmTransform();
    } else if (currentView === 'graph' && graph) {
      try {
        var z = graph.zoom();
        graph.zoom({ x: z.x, y: z.y, k: Math.max(z.k / 1.2, MIN_SCALE) }, 200);
        setTimeout(updateZoomLabel, 250);
      } catch(e) {}
    }
  });
  document.getElementById('zoom-fit').addEventListener('click', function() {
    if (currentView === 'mindmap') {
      fitToScreen();
    } else if (currentView === 'graph' && graph) {
      try { graph.zoomToFit(300, 40); } catch(e) {}
    }
  });

  // 初始适应窗口
  if (mmSvg) {
    setTimeout(fitToScreen, 50);
  }

  // ===== 关联图 =====
  function initGraph() {
    if (graphInited) return;
    graphInited = true;
    var container = document.getElementById('graph-canvas');
    var w = container.clientWidth || window.innerWidth;
    var h = container.clientHeight || (window.innerHeight - 48);

    try {
      graph = ForceGraph()(container)
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
        .nodeLabel(function(node) {
          var label = node.fullName || node.name || '';
          if (node.hasNote) label += ' 📝';
          if (node.hasImage) label += ' 🖼️';
          return label;
        })
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
          // 备注标识
          if (node.hasNote) {
            ctx.beginPath();
            ctx.arc(node.x + r - 1, node.y - r + 1, 2.2, 0, 2 * Math.PI, false);
            ctx.fillStyle = '#ffcc00';
            ctx.fill();
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 1;
            ctx.stroke();
          }
          // 图片标识
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
        .graphData(graphData);

      try {
        graph.d3Force('charge').strength(-120);
        graph.d3Force('link').distance(function(link) {
          return link.type === 'assoc' ? 80 : 55;
        });
        graph.d3Force('center').strength(0.05);
      } catch(e) {}

      // 统计
      var stats = document.getElementById('graph-stats');
      if (stats) {
        stats.textContent = graphData.nodes.length + ' 个节点 · ' + graphData.links.length + ' 条连线';
      }

      // 缩放事件更新 label
      try {
        graph.onZoom(function() { updateZoomLabel(); });
      } catch(e) {}

      setTimeout(function() {
        try { graph.zoomToFit(400, 40); } catch(e) {}
      }, 300);
    } catch(e) {
      console.error('Graph init error:', e);
      container.innerHTML = '<div style="padding:40px;text-align:center;color:#999;">关联图加载失败</div>';
    }

    // 响应窗口大小
    window.addEventListener('resize', function() {
      if (graph) {
        var newW = container.clientWidth || window.innerWidth;
        var newH = container.clientHeight || (window.innerHeight - 48);
        graph.width(newW).height(newH);
      }
    });
  }

})();
</script>
</body>
</html>`
}

// data URL 转 SVG 文本（正确处理 UTF-8 中文）
function dataUrlToSvgText(dataUrl) {
  return new Promise((resolve, reject) => {
    try {
      const s = String(dataUrl || '')
      const comma = s.indexOf(',')
      const prefix = comma !== -1 ? s.slice(0, comma) : ''
      const payload = comma !== -1 ? s.slice(comma + 1) : s
      if (/;base64/i.test(prefix)) {
        const binary = atob(payload)
        const bytes = Uint8Array.from(binary, c => c.charCodeAt(0))
        resolve(new TextDecoder('utf-8').decode(bytes))
      } else {
        resolve(decodeURIComponent(payload))
      }
    } catch (e) {
      reject(e)
    }
  })
}

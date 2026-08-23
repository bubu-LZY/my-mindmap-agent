/**
 * SVG/PDF 导出辅助：
 * - PDF 导出前显示所有挖空内容；
 * - SVG 导出时注入点击挖空切换显隐的交互脚本。
 */

import {
  forceShowAllClozeForExport,
  restoreClozeStateForExport
} from './cloze'

const dataUrlToSvgText = (dataUrl) => {
  const s = String(dataUrl || '')
  const comma = s.indexOf(',')
  const prefix = comma !== -1 ? s.slice(0, comma) : ''
  const payload = comma !== -1 ? s.slice(comma + 1) : s
  if (/;base64/i.test(prefix)) {
    const binary = atob(payload)
    const bytes = Uint8Array.from(binary, c => c.charCodeAt(0))
    return new TextDecoder('utf-8').decode(bytes)
  }
  return decodeURIComponent(payload)
}

const svgTextToDataUrl = async (svgText) => {
  const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' })
  return await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

const htmlEscape = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}[c]))

export const withAllClozeVisible = async (task) => {
  const snapshot = forceShowAllClozeForExport()
  try {
    return await task()
  } finally {
    restoreClozeStateForExport(snapshot)
  }
}

export const injectInteractiveSvg = async (dataUrl) => {
  if (!dataUrl || !String(dataUrl).startsWith('data:image/svg')) return dataUrl
  try {
    const svg = dataUrlToSvgText(dataUrl)
    const script = `
<script type="text/javascript"><![CDATA[
(function(){
  function closestCloze(el){
    while(el && el !== document.documentElement){
      if(el.classList && el.classList.contains('smm-cloze')) return el;
      el = el.parentNode;
    }
    return null;
  }
  document.addEventListener('click', function(e){
    var el = closestCloze(e.target);
    if(!el) return;
    e.preventDefault();
    el.classList.toggle('smm-cloze-hidden');
  }, true);
})();
]]><\/script>`
    const injected = svg.replace(/<\/svg>\s*$/i, script + '\n</svg>')
    return await svgTextToDataUrl(injected)
  } catch (e) {
    console.warn('[svgExport] SVG 交互注入失败:', e)
    return dataUrl
  }
}

/**
 * 将交互式 SVG 包装为独立 HTML 文件（自包含，双击即可在浏览器打开）。
 * SVG 中的点击切换挖空显隐脚本保持可用。
 */
export const buildInteractiveHtml = async (svgDataUrl, title = '思维导图') => {
  const interactive = await injectInteractiveSvg(svgDataUrl)
  const svg = dataUrlToSvgText(interactive)
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${htmlEscape(title)}</title>
<style>
  html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: #f6f6f8; touch-action: none; }
  body { position: relative; user-select: none; -webkit-user-select: none; }
  .viewport {
    position: absolute;
    left: 0;
    top: 0;
    width: 0;
    height: 0;
    transform-origin: 0 0;
    cursor: grab;
    touch-action: none;
  }
  .viewport.dragging { cursor: grabbing; }
  .viewport svg { max-width: none; height: auto; display: block; }
  .cloze-toolbar {
    position: fixed;
    top: 14px;
    right: 16px;
    z-index: 10;
    display: flex;
    gap: 8px;
  }
  .cloze-toolbar button {
    padding: 7px 12px;
    border: 1px solid rgba(124, 58, 237, 0.35);
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.94);
    color: #5b21b6;
    font-size: 13px;
    cursor: pointer;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  }
  .cloze-toolbar button:hover {
    background: #f3e8ff;
    border-color: rgba(124, 58, 237, 0.6);
  }
  .view-toolbar {
    position: fixed;
    top: 14px;
    left: 16px;
    z-index: 10;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .view-toolbar button {
    width: 30px;
    height: 30px;
    border: 1px solid rgba(0, 0, 0, 0.12);
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.94);
    color: #333;
    font-size: 16px;
    line-height: 1;
    cursor: pointer;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  }
  .view-toolbar button:hover { background: #ffffff; }
  .zoom-label {
    min-width: 46px;
    text-align: center;
    font-size: 12px;
    color: #555;
    background: rgba(255, 255, 255, 0.94);
    border-radius: 8px;
    padding: 7px 6px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  }
</style>
</head>
<body>
<div class="view-toolbar">
  <button id="zoom-out" type="button" title="缩小">−</button>
  <span id="zoom-label" class="zoom-label">100%</span>
  <button id="zoom-in" type="button" title="放大">+</button>
  <button id="zoom-reset" type="button" title="适应窗口">适应</button>
</div>
<div class="cloze-toolbar">
  <button id="cloze-hide-all" type="button">隐藏全部挖空</button>
  <button id="cloze-show-all" type="button">显示全部挖空</button>
</div>
<div id="viewport" class="viewport">
${svg}
</div>
<script>
(function () {
  var setAllCloze = function (hidden) {
    var list = document.querySelectorAll('.smm-cloze');
    for (var i = 0; i < list.length; i++) {
      if (hidden) {
        list[i].classList.add('smm-cloze-hidden');
      } else {
        list[i].classList.remove('smm-cloze-hidden');
      }
    }
  };
  var hideBtn = document.getElementById('cloze-hide-all');
  var showBtn = document.getElementById('cloze-show-all');
  if (hideBtn) hideBtn.addEventListener('click', function () { setAllCloze(true); });
  if (showBtn) showBtn.addEventListener('click', function () { setAllCloze(false); });

  var viewport = document.getElementById('viewport');
  var svgEl = viewport ? viewport.querySelector('svg') : null;
  var currentScale = 1;
  var tx = 0;
  var ty = 0;
  var MIN_SCALE = 0.05;
  var MAX_SCALE = 8;

  var apply = function () {
    if (!viewport) return;
    viewport.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + currentScale + ')';
    var label = document.getElementById('zoom-label');
    if (label) label.textContent = Math.round(currentScale * 100) + '%';
  };

  var fit = function () {
    if (!svgEl || !viewport) return;
    var w = svgEl.getBoundingClientRect().width || parseFloat(svgEl.getAttribute('width')) || 1000;
    var h = svgEl.getBoundingClientRect().height || parseFloat(svgEl.getAttribute('height')) || 600;
    var padding = 40;
    currentScale = Math.min(1, (window.innerWidth - padding) / w, (window.innerHeight - padding) / h);
    if (!isFinite(currentScale) || currentScale <= 0) currentScale = 1;
    tx = (window.innerWidth - w * currentScale) / 2;
    ty = (window.innerHeight - h * currentScale) / 2;
    apply();
  };

  var zoomAt = function (factor, cx, cy) {
    var next = currentScale * factor;
    next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, next));
    var k = next / currentScale;
    tx = cx - (cx - tx) * k;
    ty = cy - (cy - ty) * k;
    currentScale = next;
    apply();
  };

  var zoomIn = document.getElementById('zoom-in');
  var zoomOut = document.getElementById('zoom-out');
  var zoomReset = document.getElementById('zoom-reset');
  if (zoomIn) zoomIn.addEventListener('click', function () { zoomAt(1.25, window.innerWidth / 2, window.innerHeight / 2); });
  if (zoomOut) zoomOut.addEventListener('click', function () { zoomAt(0.8, window.innerWidth / 2, window.innerHeight / 2); });
  if (zoomReset) zoomReset.addEventListener('click', fit);

  if (viewport) {
    viewport.addEventListener('wheel', function (e) {
      e.preventDefault();
      zoomAt(e.deltaY < 0 ? 1.1 : 0.9, e.clientX, e.clientY);
    }, { passive: false });

    viewport.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    var dragging = false;
    var startX = 0;
    var startY = 0;
    var startTx = 0;
    var startTy = 0;

    viewport.addEventListener('mousedown', function (e) {
      // 左键留给挖空点击切换；中键/右键用来拖动导图
      if (e.button !== 1 && e.button !== 2) return;
      e.preventDefault();
      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
      startTx = tx;
      startTy = ty;
      viewport.classList.add('dragging');
    });

    window.addEventListener('mousemove', function (e) {
      if (!dragging) return;
      tx = startTx + (e.clientX - startX);
      ty = startTy + (e.clientY - startY);
      apply();
    });

    window.addEventListener('mouseup', function () {
      if (!dragging) return;
      dragging = false;
      viewport.classList.remove('dragging');
    });

    var touchMode = 'none';
    var touchStartDistance = 0;
    var touchStartScale = 1;
    var touchStartTx = 0;
    var touchStartTy = 0;
    var touchStartMidX = 0;
    var touchStartMidY = 0;
    var singleTouchStartX = 0;
    var singleTouchStartY = 0;
    var singleTouchMoved = false;

    var getMidPoint = function (touches) {
      var x = (touches[0].clientX + touches[1].clientX) / 2;
      var y = (touches[0].clientY + touches[1].clientY) / 2;
      return { x: x, y: y };
    };

    var getDistance = function (touches) {
      var dx = touches[0].clientX - touches[1].clientX;
      var dy = touches[0].clientY - touches[1].clientY;
      return Math.sqrt(dx * dx + dy * dy);
    };

    viewport.addEventListener('touchstart', function (e) {
      e.preventDefault();
      if (e.touches.length === 1) {
        touchMode = 'pan';
        singleTouchStartX = e.touches[0].clientX;
        singleTouchStartY = e.touches[0].clientY;
        startTx = tx;
        startTy = ty;
        singleTouchMoved = false;
      } else if (e.touches.length === 2) {
        touchMode = 'pinch';
        var mid = getMidPoint(e.touches);
        touchStartDistance = getDistance(e.touches);
        touchStartScale = currentScale;
        touchStartTx = tx;
        touchStartTy = ty;
        touchStartMidX = mid.x;
        touchStartMidY = mid.y;
      }
    }, { passive: false });

    viewport.addEventListener('touchmove', function (e) {
      e.preventDefault();
      if (touchMode === 'pan' && e.touches.length === 1) {
        var touch = e.touches[0];
        tx = startTx + (touch.clientX - singleTouchStartX);
        ty = startTy + (touch.clientY - singleTouchStartY);
        if (Math.abs(touch.clientX - singleTouchStartX) > 6 || Math.abs(touch.clientY - singleTouchStartY) > 6) {
          singleTouchMoved = true;
        }
        apply();
      } else if (touchMode === 'pinch' && e.touches.length === 2) {
        var distance = getDistance(e.touches);
        var mid = getMidPoint(e.touches);
        var nextScale = touchStartScale * (distance / touchStartDistance);
        nextScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, nextScale));
        currentScale = nextScale;
        tx = touchStartTx + (mid.x - touchStartMidX);
        ty = touchStartTy + (mid.y - touchStartMidY);
        apply();
      }
    }, { passive: false });

    viewport.addEventListener('touchend', function () {
      touchMode = 'none';
      touchStartDistance = 0;
    });

    viewport.addEventListener('touchcancel', function () {
      touchMode = 'none';
      touchStartDistance = 0;
    });
  }

  fit();
  window.addEventListener('resize', fit);
})();
</script>
</body>
</html>`
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  return await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

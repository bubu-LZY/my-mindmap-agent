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
  html, body { margin: 0; padding: 0; min-height: 100%; background: #f6f6f8; }
  body { display: flex; justify-content: center; padding: 24px 0; }
  svg { max-width: 100%; height: auto; }
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
</style>
</head>
<body>
<div class="cloze-toolbar">
  <button id="cloze-hide-all" type="button">隐藏全部挖空</button>
  <button id="cloze-show-all" type="button">显示全部挖空</button>
</div>
${svg}
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

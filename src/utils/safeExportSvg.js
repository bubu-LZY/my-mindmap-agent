/**
 * 安全导出思维导图 SVG
 * 解决：当导图容器隐藏（如大纲模式、关联图模式）时，
 * SVG 导出尺寸异常（20x20）导致导出文件空白的问题。
 *
 * 原理：临时把整条被 display:none 隐藏的祖先链恢复可见，
 * 并把容器移到屏幕外（position:fixed），触发 resize 后再导出，导出完恢复原状。
 */

/**
 * @param {Object} mm - simple-mind-map 实例
 * @param {string} name - 导出文件名
 * @param {HTMLElement} [container] - 导图容器元素，可选。不传则从 mm.el 获取。
 * @returns {Promise<string>} SVG data URL
 */
export async function safeExportSvg(mm, name, container) {
  if (!mm) throw new Error('导图实例不存在')

  // 找到容器：simple-mind-map 实例通过 el 属性保存容器元素
  let el = container
  if (!el && mm.el) {
    el = mm.el
  }
  if (!el) {
    // 找不到容器，直接尝试导出
    return await mm.doExport.svg(name)
  }

  // 检查容器是否可见（有非零尺寸）
  const rect = el.getBoundingClientRect()
  const isVisible = rect.width > 50 && rect.height > 50

  if (isVisible) {
    // 容器可见，直接导出
    return await mm.doExport.svg(name)
  }

  // 收集所有 display:none 的祖先（v-show 通过内联 style.display 隐藏）
  const hiddenAncestors = []
  let p = el.parentElement
  while (p && p !== document.body && p !== document.documentElement) {
    if (p.style && p.style.display === 'none') {
      hiddenAncestors.push({ el: p, display: p.style.display })
    }
    p = p.parentElement
  }

  const origStyle = el.getAttribute('style') || ''

  try {
    // 1) 临时显示所有 display:none 的祖先
    for (const item of hiddenAncestors) {
      item.el.style.display = 'block'
    }
    // 2) 把容器移到屏幕外并给固定尺寸（position:fixed 脱离文档流，不影响布局）
    el.style.setProperty('display', 'block', 'important')
    el.style.setProperty('position', 'fixed', 'important')
    el.style.setProperty('left', '-99999px', 'important')
    el.style.setProperty('top', '-99999px', 'important')
    el.style.setProperty('width', '1600px', 'important')
    el.style.setProperty('height', '1200px', 'important')
    el.style.setProperty('visibility', 'hidden', 'important')
    el.style.setProperty('z-index', '-1', 'important')
    el.style.setProperty('pointer-events', 'none', 'important')

    // 3) 触发 resize，让实例按新尺寸重新布局
    try {
      mm.resize && mm.resize()
    } catch (e) {
      console.warn('[safeExportSvg] resize failed:', e.message)
    }

    // 等帧让布局稳定
    await new Promise(resolve => requestAnimationFrame(resolve))
    await new Promise(resolve => requestAnimationFrame(resolve))

    try {
      mm.resize && mm.resize()
    } catch (e) {
      // ignore
    }

    await new Promise(resolve => requestAnimationFrame(resolve))

    // 4) 导出 SVG
    return await mm.doExport.svg(name)
  } finally {
    // 恢复容器自身样式
    if (origStyle === null || origStyle === '') {
      el.removeAttribute('style')
    } else {
      el.setAttribute('style', origStyle)
    }
    // 恢复祖先的 display
    for (const item of hiddenAncestors) {
      item.el.style.display = item.display
    }
    // 再次 resize 让实例恢复到原来的状态
    try {
      mm.resize && mm.resize()
    } catch (e) {
      // ignore
    }
  }
}

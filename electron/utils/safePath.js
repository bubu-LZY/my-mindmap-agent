const path = require('path')

// 把压缩包 / 拖拽导入里带的相对路径安全地拼进目标目录。
// path.join(target, '../../../../Startup/x.bat') 会直接逃出 target（Zip Slip），
// 而 relativePath 既可能来自 zip 条目名，也可能来自渲染进程传来的载荷，两者都不可信。
// 这里先归一化分隔符、丢弃盘符与 UNC 前缀，再解析并强制校验结果仍在 base 之内。
function resolveInside(base, relPath) {
  const rel = String(relPath || '')
    .replace(/\\/g, '/')
    .replace(/^\u0000/, '')
  if (!rel.trim()) return null

  // 绝对路径与 UNC 一律降级为相对路径处理，避免整体替换掉 base
  const segments = rel
    .split('/')
    .filter((seg) => seg !== '' && seg !== '.')
    // 盘符（C:）与 UNC 主机名不能作为目录段
    .filter((seg) => !/^[a-z]:$/i.test(seg))
  if (segments.length === 0) return null

  const resolvedBase = path.resolve(base)
  const target = path.resolve(resolvedBase, segments.join(path.sep))

  const relFromBase = path.relative(resolvedBase, target)
  if (relFromBase.startsWith('..') || path.isAbsolute(relFromBase)) {
    throw new Error(`非法路径（超出目标目录范围）: ${relPath}`)
  }
  return target
}

module.exports = { resolveInside }

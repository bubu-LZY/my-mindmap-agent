/**
 * XMind 文件解析：base64（主进程读取的 .xmind 二进制）→ simple-mind-map 导图数据
 * 依赖 simple-mind-map/src/parse/xmind.js（动态加载）
 */

export const parseXmindBase64 = async (base64, name = 'map.xmind') => {
  const mod = await import('simple-mind-map/src/parse/xmind.js')
  const xmind = mod.default || mod
  const bin = atob(base64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  const file = new File([bytes], name, { type: 'application/zip' })
  const data = await xmind.parseXmindFile(file)
  return data || null
}

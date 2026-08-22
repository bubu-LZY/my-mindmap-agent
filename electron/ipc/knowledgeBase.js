const { ipcMain, app } = require('electron')
const fs = require('fs')
const path = require('path')

// 获取默认保存目录
function getDefaultSaveDir() {
  return app.defaultSaveDir || path.join(app.getPath('documents'), 'MindMapAI')
}

// 读取文件并返回文本内容
function readFileContent(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf-8')
  } catch (error) {
    return null
  }
}

// 知识库检索：遍历默认目录下的所有文件，进行关键词匹配
ipcMain.handle('search-knowledge-base', (event, query) => {
  try {
    const dir = getDefaultSaveDir()

    // 确保目录存在
    if (!fs.existsSync(dir)) {
      return { success: true, results: [] }
    }

    const keyword = (query || '').toLowerCase().trim()
    if (!keyword) {
      return { success: true, results: [] }
    }

    const files = fs.readdirSync(dir)
    const results = []

    for (const file of files) {
      if (!file.endsWith('.smm') && !file.endsWith('.json')) {
        continue
      }

      const filePath = path.join(dir, file)
      const stat = fs.statSync(filePath)

      // 跳过目录
      if (!stat.isFile()) {
        continue
      }

      const content = readFileContent(filePath)
      if (content === null) {
        continue
      }

      // 将查询关键词拆分为多个词，支持多关键词搜索
      const keywords = keyword.split(/\s+/).filter(Boolean)
      const contentLower = content.toLowerCase()
      const fileNameLower = file.toLowerCase()

      // 检查是否所有关键词都在文件名或内容中出现
      const matched = keywords.every(
        (kw) => contentLower.includes(kw) || fileNameLower.includes(kw)
      )

      if (matched) {
        results.push({
          fileName: file,
          filePath: filePath,
          preview: content.substring(0, 500)
        })
      }
    }

    return { success: true, results }
  } catch (error) {
    return { success: false, error: error.message, results: [] }
  }
})

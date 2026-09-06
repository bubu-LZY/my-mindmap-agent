const Store = require('electron-store')

const store = new Store()

// AI 请求超时时长（毫秒）：默认 5 分钟，可在设置中配置（单位秒，限制 30 秒 ~ 1 小时）
function getAiTimeoutMs() {
  const seconds = Number(store.get('aiTimeoutSeconds', 300)) || 300
  return Math.min(Math.max(seconds, 30), 3600) * 1000
}

module.exports = store
module.exports.getAiTimeoutMs = getAiTimeoutMs

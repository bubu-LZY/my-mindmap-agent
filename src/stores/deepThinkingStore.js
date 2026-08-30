/**
 * Pinia store - 管理"AI 深度思考"开关与强度（全局持久化）
 *
 * 启用后，aiService 在发请求时会按 baseURL 自动适配不同厂商的深度思考参数：
 * - OpenAI / Azure OpenAI：顶层 reasoning_effort
 * - DeepSeek：thinking: { type: 'enabled', reasoning_effort }
 * - 阿里百炼 / Qwen3：enable_thinking + reasoning_effort
 * - 其他厂商 / 不支持：静默降级（不传任何参数，仅 UI 提示）
 *
 * 不支持的模型点击开启也不会报错：见 aiService 的 buildDeepThinkingParams() 内部白名单匹配。
 */

import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

const STORAGE_KEY = 'deep_thinking_prefs'
const VALID_EFFORTS = ['low', 'medium', 'high']

const loadInitial = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { enabled: false, effort: 'high' }
    const obj = JSON.parse(raw)
    return {
      enabled: !!obj.enabled,
      effort: VALID_EFFORTS.includes(obj.effort) ? obj.effort : 'high'
    }
  } catch (e) {
    return { enabled: false, effort: 'high' }
  }
}

export const useDeepThinkingStore = defineStore('deepThinking', () => {
  const initial = loadInitial()
  const enabled = ref(initial.enabled)
  const effort = ref(initial.effort)

  // 持久化：任一字段变化都写回 localStorage
  watch([enabled, effort], ([en, ef]) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ enabled: !!en, effort: ef }))
    } catch (e) {
      // localStorage 写入失败（隐私模式 / 配额）忽略，不影响功能
    }
  }, { deep: true })

  function setEnabled(v) {
    enabled.value = !!v
  }
  function toggle() {
    enabled.value = !enabled.value
  }
  function setEffort(v) {
    if (VALID_EFFORTS.includes(v)) effort.value = v
  }

  return {
    enabled,
    effort,
    setEnabled,
    toggle,
    setEffort,
    VALID_EFFORTS
  }
})
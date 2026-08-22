/**
 * Pinia store - 管理 AI 对话状态
 */

import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useAIStore = defineStore('ai', () => {
  const messages = ref([])
  const aiStatus = ref('idle') // idle | thinking | calling | done | error
  const toolCallStatus = ref('') // '' | thinking | calling | done | error

  function addMessage(role, content) {
    messages.value.push({
      id: Date.now() + Math.random(),
      role, // 'user' | 'assistant'
      content,
      timestamp: Date.now()
    })
  }

  function updateLastMessage(content) {
    if (messages.value.length > 0) {
      messages.value[messages.value.length - 1].content = content
    }
  }

  function clearMessages() {
    messages.value = []
  }

  function setAIStatus(status) {
    aiStatus.value = status
  }

  function setToolCallStatus(status) {
    toolCallStatus.value = status
  }

  return {
    messages,
    aiStatus,
    toolCallStatus,
    addMessage,
    updateLastMessage,
    clearMessages,
    setAIStatus,
    setToolCallStatus
  }
})

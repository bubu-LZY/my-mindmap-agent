/**
 * Pinia store - 管理思维导图状态
 */

import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useMindMapStore = defineStore('mindMap', () => {
  const mindMapInstance = ref(null)
  const currentData = ref(null)
  const activeNode = ref(null)
  const activeNodeList = ref([])
  const viewMode = ref('mindmap') // 'mindmap' | 'outline'
  const isModified = ref(false)
  const currentFilePath = ref('')
  // [第一仗] 当前运行中 AI 任务绑定的 fileId（任务发起时 currentFilePath 的快照，全程不变）
  const activeTaskFileId = ref('')
  // [多实例] 每个打开文件一个独立思维导图实例：fileId -> instance。
  // 任务按 activeTaskFileId 从这里取绑定实例操作，切走文件不影响绑定实例（后台继续、不串台）。
  const instances = ref(new Map())

  function setMindMap(instance) {
    mindMapInstance.value = instance
  }

  function setData(data) {
    currentData.value = data
  }

  function setActiveNode(node, nodeList) {
    activeNode.value = node
    activeNodeList.value = nodeList || []
  }

  function setViewMode(mode) {
    viewMode.value = mode
  }

  function setModified(modified) {
    isModified.value = modified
  }

  function setFilePath(path) {
    currentFilePath.value = path
  }

  // [第一仗] 设置当前运行任务绑定的 fileId（任务发起时调用，传当前 currentFilePath；任务结束应清空）
  function setActiveTaskFileId(id) {
    activeTaskFileId.value = id || ''
  }

  // [多实例] 注册/获取/注销某文件的独立思维导图实例
  function registerInstance(fileId, instance) {
    if (fileId) instances.value.set(fileId, instance)
  }
  function getInstance(fileId) {
    return fileId ? instances.value.get(fileId) : null
  }
  function unregisterInstance(fileId) {
    if (fileId) instances.value.delete(fileId)
  }

  return {
    mindMapInstance,
    currentData,
    activeNode,
    activeNodeList,
    viewMode,
    isModified,
    currentFilePath,
    activeTaskFileId,
    instances,
    setMindMap,
    setData,
    setActiveNode,
    setViewMode,
    setModified,
    setFilePath,
    setActiveTaskFileId,
    registerInstance,
    getInstance,
    unregisterInstance
  }
})

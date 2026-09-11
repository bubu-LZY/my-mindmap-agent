/**
 * Pinia store - 管理思维导图状态
 *
 * 关于 shallowRef / markRaw（改动前请读完）：
 * simple-mind-map 的实例是一整张巨大的对象图（SVG 节点、事件监听、内部渲染树）。
 * 用 ref() 持有它，Vue 会在每次读取 .value 时把整张图递归代理成 Proxy：
 * 既白付一遍深遍历的开销，又让实例上每次属性访问都多穿一层 Proxy——这是大图卡顿的
 * 主要来源之一，而本 store 的所有消费方都是命令式读取（函数里取一次就用），
 * 没有任何模板绑定或 watch 依赖深层变化，深响应性完全是纯成本。
 *
 * 更关键的是 markRaw 修的是一个真 bug：backgroundMindMapService 用
 * `store.getInstance(id) === mm` 判断「存的是不是我这个实例」来决定要不要注销。
 * 深响应式下 getInstance 返回的是 Proxy，mm 是原始实例，两者恒不相等，
 * 于是后台实例永远注销不掉，一直泄漏。markRaw 让实例进出都保持原身份。
 */

import { defineStore } from 'pinia'
import { ref, shallowRef, triggerRef, markRaw } from 'vue'

export const useMindMapStore = defineStore('mindMap', () => {
  const mindMapInstance = shallowRef(null)
  const currentData = shallowRef(null)
  const activeNode = shallowRef(null)
  const activeNodeList = shallowRef([])
  // 下面四个都是原始值，ref 没有额外开销，保持深响应以便将来直接绑定模板
  const viewMode = ref('mindmap') // 'mindmap' | 'outline'
  const isModified = ref(false)
  const currentFilePath = ref('')
  // [第一仗] 当前运行中 AI 任务绑定的 fileId（任务发起时 currentFilePath 的快照，全程不变）
  const activeTaskFileId = ref('')
  // [多实例] 每个打开文件一个独立思维导图实例：fileId -> instance。
  // 任务按 activeTaskFileId 从这里取绑定实例操作，切走文件不影响绑定实例（后台继续、不串台）。
  // shallowRef：Map 本身的增删不需要触发深层追踪，改动后手动 triggerRef。
  const instances = shallowRef(new Map())

  // 实例一律 markRaw：保证存取前后是同一个对象引用（见文件头注释）
  const raw = (instance) => (instance && typeof instance === 'object' ? markRaw(instance) : instance)

  function setMindMap(instance) {
    mindMapInstance.value = raw(instance)
  }

  function setData(data) {
    currentData.value = data
  }

  function setActiveNode(node, nodeList) {
    activeNode.value = raw(node)
    activeNodeList.value = Array.isArray(nodeList) ? nodeList.map(raw) : []
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
    if (!fileId) return
    instances.value.set(fileId, raw(instance))
    triggerRef(instances)
  }
  function getInstance(fileId) {
    return fileId ? instances.value.get(fileId) || null : null
  }
  function unregisterInstance(fileId) {
    if (!fileId) return
    if (instances.value.delete(fileId)) triggerRef(instances)
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

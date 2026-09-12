import { ref, computed, watch, onScopeDispose } from 'vue'

/**
 * DeepSeek 网页模式的画面由主进程 BrowserView（原生层）渲染，永远盖在 DOM 之上，
 * 无法用 z-index 压制，只能在有浮层打开时主动 hide()。
 *
 * 这里用「来源集合」而不是单一布尔量：多个浮层可能同时存在（设置弹窗里再展开
 * 日志面板、下拉菜单压着消息中心等），布尔量会被先关闭的一方抢先恢复显示。
 * 每个浮层用唯一 reason 登记，一个都不剩时才恢复显示。
 */
const blockers = ref(new Set())

export const blockDeepSeekOverlay = (reason, blocked) => {
  if (blocked) blockers.value.add(reason)
  else blockers.value.delete(reason)
}

export const deepSeekOverlayBlocked = computed(() => blockers.value.size > 0)

/**
 * 把某个浮层的开关登记进闸门（组件内一行接入）。
 * 同一组件可能被挂载多份（多屏分屏下的同名视图），因此 reason 会追加实例序号：
 * 否则 A 面板的备注窗打开时，B 面板实例卸载会把 A 的登记一并抹掉。
 */
let instanceSeq = 0
export const useDeepSeekOverlayBlocker = (reason, source) => {
  const key = `${reason}#${++instanceSeq}`
  watch(source, (val) => blockDeepSeekOverlay(key, !!val), { immediate: true })
  onScopeDispose(() => blockDeepSeekOverlay(key, false))
}

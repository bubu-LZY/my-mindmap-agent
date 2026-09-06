# v4.11.3 更新日志

## 修复

- 修复大纲模式下展开所有节点/展开子节点后立即自动收起的问题
  - 原因：`restoreCollapsedState` 只做单向收起，且 `outlineExpandOverride` 在 refresh 开头就被清空，连续触发两次 refresh 时第二次失效
  - 修复：改为 `syncExpandState` 双向同步展开状态；增加 `pendingExpandOverride` 暂存机制，确保一次性展开指令完整生效

## 补充说明

- 本版本为 v4.11.2 的热修复版本，其余功能与 v4.11.2 一致

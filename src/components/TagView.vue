<template>
  <div class="tag-sidebar">
    <!-- 面板头部 -->
    <div class="panel-header">
      <span class="panel-title">标签</span>
      <span class="panel-count" v-if="tags.length > 0">{{ tags.length }} 个标签</span>
    </div>

    <!-- 标签列表 -->
    <div class="panel-body">
      <div class="tag-list">
        <div v-for="item in tags" :key="item.id" class="tag-item" @click="navigate(item)">
          <div class="tag-item-top">
            <span class="tag-chip" :title="item.tag">{{ item.tag }}</span>
            <span class="tag-file" :title="item.fileName">{{ item.fileName }}</span>
            <span class="tag-actions" @click.stop>
              <button class="tag-icon-btn" title="编辑标签/备注" @click="editTag(item)">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
              </button>
              <button class="tag-icon-btn danger" title="删除标签" @click="removeTag(item)">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </span>
          </div>
          <div class="tag-note" v-if="item.note">{{ item.note }}</div>
          <div class="tag-loc">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
              <circle cx="12" cy="10" r="3" />
            </svg>
            <span>{{ locText(item) }}</span>
          </div>
        </div>
        <div class="empty-tip" v-if="tags.length === 0">
          暂无标签<br />在文件树、节点或文档上右键「添加标签」
        </div>
      </div>
    </div>

    <!-- 编辑标签弹窗 -->
    <Teleport to="body">
      <Transition name="tag-modal">
        <div v-if="showEditor" class="tag-modal-overlay" @click.self="closeEditor">
          <div class="tag-modal-window">
            <div class="tag-modal-header">
              <span class="tag-modal-title">编辑标签</span>
              <button class="tag-modal-close" @click="closeEditor">✕</button>
            </div>
            <div class="tag-modal-body">
              <label class="tag-field-label">标签名</label>
              <input
                ref="tagInputRef"
                v-model="editForm.tag"
                class="tag-field-input"
                placeholder="输入标签名"
                @keyup.enter="saveEdit"
              />
              <label class="tag-field-label">备注（可选）</label>
              <textarea
                v-model="editForm.note"
                class="tag-field-textarea"
                placeholder="输入备注（可留空）"
                rows="3"
              ></textarea>
            </div>
            <div class="tag-modal-footer">
              <button class="tag-btn-cancel" @click="closeEditor">取消</button>
              <button class="tag-btn-save" @click="saveEdit">保存</button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick } from 'vue'
import { getTags, removeTagById, updateTag } from '../utils/tagStore'

const props = defineProps({
  visible: { type: Boolean, default: true }
})
const emit = defineEmits(['navigate'])

const tags = ref([])

// 位置描述
const locText = (item) => {
  if (item.nodeText) return '节点：' + item.nodeText
  if (item.page != null) return `第 ${item.page} 页`
  if (item.scrollTop != null) return '文档位置'
  return '文件'
}

const refresh = () => {
  tags.value = getTags()
}

// 打开标签跳转
const navigate = (item) => {
  emit('navigate', item)
}

const removeTag = (item) => {
  removeTagById(item.id)
  refresh()
}

// 编辑标签
const showEditor = ref(false)
const editForm = ref({ id: '', tag: '', note: '' })
const tagInputRef = ref(null)

const editTag = (item) => {
  editForm.value = { id: item.id, tag: item.tag, note: item.note || '' }
  showEditor.value = true
  nextTick(() => tagInputRef.value?.focus())
}

const closeEditor = () => { showEditor.value = false }

const saveEdit = () => {
  const tag = editForm.value.tag.trim()
  if (!tag) return
  updateTag(editForm.value.id, { tag, note: editForm.value.note })
  closeEditor()
  refresh()
}

watch(() => props.visible, (v) => { if (v) refresh() })

// 暴露 refresh 供父组件在添加/删除标签后刷新列表
defineExpose({ refresh })
</script>

<style>
.tag-sidebar {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.tag-sidebar .panel-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 14px;
  border-bottom: 1px solid #e4e7ed;
  flex-shrink: 0;
}
.tag-sidebar .panel-title {
  font-size: 14px;
  font-weight: 600;
  color: #303133;
}
.tag-sidebar .panel-count {
  font-size: 12px;
  color: #909399;
}
.tag-sidebar .panel-body {
  flex: 1;
  overflow: auto;
}
.tag-list {
  padding: 8px;
}
.tag-item {
  padding: 10px 12px;
  margin-bottom: 6px;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  cursor: pointer;
  background: #fff;
  transition: box-shadow 0.15s ease, border-color 0.15s ease;
}
.tag-item:hover {
  border-color: #c6e2ff;
  box-shadow: 0 2px 10px rgba(64, 158, 255, 0.12);
}
.tag-item-top {
  display: flex;
  align-items: center;
  gap: 8px;
}
.tag-chip {
  display: inline-block;
  max-width: 140px;
  padding: 2px 10px;
  border-radius: 12px;
  background: #ecf5ff;
  color: #409eff;
  font-size: 12px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex-shrink: 0;
}
.tag-file {
  flex: 1;
  font-size: 12px;
  color: #909399;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tag-actions {
  display: flex;
  gap: 2px;
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 0.15s ease;
}
.tag-item:hover .tag-actions { opacity: 1; }
.tag-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  background: transparent;
  border-radius: 5px;
  color: #909399;
  cursor: pointer;
}
.tag-icon-btn:hover { background: #f0f2f5; color: #409eff; }
.tag-icon-btn.danger:hover { background: #fef0f0; color: #f56c6c; }
.tag-note {
  margin-top: 6px;
  font-size: 12px;
  color: #606266;
  line-height: 1.5;
  word-break: break-word;
}
.tag-loc {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 6px;
  font-size: 11px;
  color: #a8abb2;
}
.empty-tip {
  padding: 40px 20px;
  text-align: center;
  font-size: 13px;
  color: #a8abb2;
  line-height: 1.8;
}

/* 编辑弹窗 */
.tag-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 10000;
  background: rgba(0, 0, 0, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
}
.tag-modal-window {
  width: 380px;
  max-width: 90vw;
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.2);
  overflow: hidden;
}
.tag-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid #ebeef5;
}
.tag-modal-title {
  font-size: 15px;
  font-weight: 600;
  color: #303133;
}
.tag-modal-close {
  border: none;
  background: transparent;
  font-size: 16px;
  color: #909399;
  cursor: pointer;
}
.tag-modal-body {
  padding: 16px;
}
.tag-field-label {
  display: block;
  margin-bottom: 6px;
  font-size: 13px;
  color: #606266;
}
.tag-field-input {
  width: 100%;
  box-sizing: border-box;
  margin-bottom: 14px;
  padding: 8px 10px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  font-size: 13px;
  outline: none;
}
.tag-field-input:focus { border-color: #409eff; }
.tag-field-textarea {
  width: 100%;
  box-sizing: border-box;
  padding: 8px 10px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  font-size: 13px;
  resize: vertical;
  font-family: inherit;
  outline: none;
}
.tag-field-textarea:focus { border-color: #409eff; }
.tag-modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 12px 16px;
  border-top: 1px solid #ebeef5;
}
.tag-btn-cancel {
  padding: 6px 16px;
  border: 1px solid #dcdfe6;
  background: #fff;
  border-radius: 6px;
  font-size: 13px;
  color: #606266;
  cursor: pointer;
}
.tag-btn-save {
  padding: 6px 16px;
  border: none;
  background: #409eff;
  border-radius: 6px;
  font-size: 13px;
  color: #fff;
  cursor: pointer;
}
.tag-btn-save:hover { background: #66b1ff; }

.tag-modal-enter-active, .tag-modal-leave-active { transition: opacity 0.2s ease; }
.tag-modal-enter-from, .tag-modal-leave-to { opacity: 0; }
</style>

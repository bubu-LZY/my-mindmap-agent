<template>
  <div class="file-tree-container">
    <!-- 顶部操作栏 -->
    <div class="tree-toolbar">
      <button class="tree-btn" @click="importFile" title="导入文件（XMind / Markdown）">
        <el-icon><Download /></el-icon>
      </button>
      <button class="tree-btn" @click="addFolder" title="添加文件夹">
        <el-icon><FolderOpened /></el-icon>
      </button>
      <button class="tree-btn" @click="refreshTree" title="刷新">
        <el-icon><Refresh /></el-icon>
      </button>
      <button class="tree-btn" @click="setSaveFolder" title="设置保存位置">
        <el-icon><FolderChecked /></el-icon>
      </button>
    </div>

    <!-- 最近打开文件 -->
    <div v-if="recentFiles.length > 0" class="recent-files">
      <div class="recent-files-title">最近打开</div>
      <div class="recent-files-list">
        <button
          v-for="f in recentFiles"
          :key="f.path"
          class="recent-file-item"
          :title="f.path"
          @click="openRecent(f.path)"
        >
          <span class="recent-file-name">{{ f.name }}</span>
          <span
            class="recent-file-open-folder"
            title="打开文件所在文件夹"
            @click.stop="showRecentFolder(f.path)"
          >
            <el-icon><FolderOpened /></el-icon>
          </span>
          <span
            class="recent-file-remove"
            title="删除这条最近打开记录"
            @click.stop="removeRecent(f.path)"
          >✕</span>
        </button>
      </div>
    </div>

    <!-- 文件树 -->
    <div class="tree-body">
      <el-tree
        ref="fileTreeRef"
        :props="treeProps"
        :load="loadNode"
        lazy
        draggable
        :allow-drop="allowDrop"
        :allow-drag="allowDragNode"
        node-key="path"
        :expand-on-click-node="true"
        :current-node-key="currentFilePath"
        @node-click="handleNodeClick"
        @node-drag-start="onTreeNodeDragStart"
        @node-drag-end="onTreeNodeDragEnd"
        @node-drop="handleNodeDrop"
        @node-expand="handleNodeExpand"
        @node-collapse="handleNodeCollapse"
      >
        <template #default="{ data }">
          <div
            class="tree-node"
            @contextmenu.prevent="onContextMenu($event, data)"
            @dragover.prevent="onNodeDragOver($event, data)"
            @drop.prevent="onNodeDropExternal($event, data)"
          >
            <span class="node-icon" v-if="data.isDir">
              <el-icon><Folder /></el-icon>
            </span>
            <span class="node-icon" v-else :style="{ color: fileIcon(data.name).color }">
              <el-icon><component :is="fileIcon(data.name).icon" /></el-icon>
            </span>

            <!-- 内联编辑模式 -->
            <template v-if="data.path === inlineEditingPath">
              <input
                class="inline-edit-input"
                v-model="inlineEditingValue"
                @keyup.enter="confirmInlineEdit(data)"
                @keyup.esc="cancelInlineEdit"
                @blur="confirmInlineEdit(data)"
                @mousedown.stop
                @click.stop
                @dragstart.stop
                @drag.stop
                ref="inlineEditInputRef"
              />
            </template>
            <!-- 正常显示 -->
            <template v-else>
              <span
                class="node-name"
                :class="{ active: data.path === currentFilePath }"
                :title="data.name"
              >{{ data.name }}</span>
              <span class="node-actions">
                <template v-if="data.isDir">
                  <span
                    class="action-icon"
                    title="新建文件"
                    @click.stop="createFile(data)"
                  >
                    <el-icon><DocumentAdd /></el-icon>
                  </span>
                  <span
                    class="action-icon"
                    title="新建文件夹"
                    @click.stop="createDir(data)"
                  >
                    <el-icon><FolderAdd /></el-icon>
                  </span>
                </template>
                <span
                  v-if="!data.isDir"
                  class="action-icon"
                  title="创建副本"
                  @click.stop="copyFile(data)"
                >
                  <el-icon><CopyDocument /></el-icon>
                </span>
                <span
                  class="action-icon"
                  title="在资源管理器中打开"
                  @click.stop="showInFolder(data)"
                >
                  <el-icon><Aim /></el-icon>
                </span>
                <span
                  class="action-icon"
                  title="重命名"
                  @click.stop="startRename(data)"
                >
                  <el-icon><EditPen /></el-icon>
                </span>
                <span
                  class="action-icon danger"
                  title="删除"
                  @click.stop="removeNode(data)"
                >
                  <el-icon><Delete /></el-icon>
                </span>
                <span
                  v-if="data.isDir && data.isRoot"
                  class="action-icon danger"
                  title="移除根目录"
                  @click.stop="removeRootFolder(data)"
                >
                  <el-icon><CircleClose /></el-icon>
                </span>
              </span>
            </template>
          </div>
        </template>
      </el-tree>

      <!-- 空状态 -->
      <div class="empty-state" v-if="folderRoots.length === 0">
        <p>暂无文件夹</p>
        <button class="add-folder-btn" @click="addFolder">添加文件夹</button>
      </div>
    </div>

    <!-- 文件树右键菜单 -->
    <Teleport to="body">
      <div
        v-if="ctxMenu.visible"
        class="file-ctx-menu"
        :style="{ left: ctxMenu.x + 'px', top: ctxMenu.y + 'px' }"
        @click.stop
        @mousedown.stop
        @contextmenu.prevent
      >
        <div class="file-ctx-item" @click="onAddTagFromContext">
          <svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M16.5 3.5l-2-2-8 8-1.2 3.2 3.2-1.2 8-8z" />
            <path d="M12.5 3.5l2 2" />
          </svg>
          添加标签
        </div>
        <div v-if="isSmmFile" class="file-ctx-item" @click="showVersionHistory">
          <svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            <path d="M7 3v3M13 3v3M7 12l3 3 3-3M10 15v-5" />
          </svg>
          历史版本
        </div>
      </div>
    </Teleport>

    <!-- 版本历史弹窗 -->
    <Teleport to="body">
      <div v-if="versionDialog.visible" class="version-dialog-mask" @click.self="versionDialog.visible = false">
        <div class="version-dialog">
          <div class="version-dialog-header">
            <span>历史版本：{{ versionDialog.fileName }}</span>
            <button class="version-dialog-close" @click="versionDialog.visible = false">×</button>
          </div>
          <div class="version-dialog-body">
            <div v-if="versionDialog.loading" class="version-empty">加载中…</div>
            <div v-else-if="!versionDialog.list.length" class="version-empty">暂无历史版本（覆盖保存后才会自动备份）</div>
            <div v-for="(v, i) in versionDialog.list" :key="v.path" class="version-item">
              <span class="version-time">{{ versionTime(v.name) }}</span>
              <button class="version-restore" @click="restoreVersion(v)">恢复</button>
            </div>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup>
import { ref, computed, nextTick, onMounted, onBeforeUnmount, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  FolderOpened, Folder, Document, DocumentAdd,
  FolderAdd, EditPen, Delete, CircleClose, Refresh, FolderChecked, Aim, CopyDocument, Download,
  Files, Grid, Reading, Memo
} from '@element-plus/icons-vue'
import { getReviewPlan, removeByFilePath } from '../utils/reviewPlan'
import { setDragFilePath, clearDragFilePath } from '../utils/dragState'

const props = defineProps({
  currentFilePath: {
    type: String,
    default: ''
  }
})

const emit = defineEmits(['open-file', 'open-doc', 'file-saved', 'file-renamed', 'file-moved', 'before-move', 'file-deleted', 'add-tag'])

const fileTreeRef = ref(null)
const inlineEditInputRef = ref(null)

// 最近打开文件（最多 5 条）
const RECENT_FILES_KEY = 'MINDMAP_RECENT_FILES'
const recentFiles = ref([])
try {
  const stored = localStorage.getItem(RECENT_FILES_KEY)
  recentFiles.value = Array.isArray(JSON.parse(stored)) ? JSON.parse(stored).slice(0, 5) : []
} catch {
  recentFiles.value = []
}

// 根文件夹列表（持久化到 localStorage）
const ROOTS_KEY = 'MINDMAP_FOLDER_ROOTS'
const folderRoots = ref([])
// 在 setup 阶段同步加载，确保 el-tree 初始化时 folderRoots 已有数据
try {
  const stored = localStorage.getItem(ROOTS_KEY)
  folderRoots.value = stored ? JSON.parse(stored) : []
} catch {
  folderRoots.value = []
}

// 内联编辑状态
const inlineEditingPath = ref('')
const inlineEditingValue = ref('')

// 展开/折叠状态追踪（持久化到 localStorage）
const EXPANDED_KEY = 'MINDMAP_EXPANDED_PATHS'
const expandedPaths = ref(new Set())
// 在 setup 阶段同步加载，确保 el-tree 初始化时展开状态已恢复
try {
  const stored = localStorage.getItem(EXPANDED_KEY)
  expandedPaths.value = new Set(stored ? JSON.parse(stored) : [])
} catch {
  expandedPaths.value = new Set()
}

const loadExpandedPaths = () => {
  try {
    const stored = localStorage.getItem(EXPANDED_KEY)
    expandedPaths.value = new Set(stored ? JSON.parse(stored) : [])
  } catch {
    expandedPaths.value = new Set()
  }
}

const saveExpandedPaths = () => {
  localStorage.setItem(EXPANDED_KEY, JSON.stringify([...expandedPaths.value]))
}

const handleNodeExpand = (data) => {
  expandedPaths.value.add(data.path)
  saveExpandedPaths()
}

const handleNodeCollapse = (data) => {
  expandedPaths.value.delete(data.path)
  saveExpandedPaths()
}

// 递归恢复展开状态
const restoreExpandedState = (fromNode) => {
  const tree = fileTreeRef.value
  if (!tree) return

  const startNode = fromNode || tree.store.root

  const walkAndRestore = (node) => {
    if (!node || !node.childNodes) return
    node.childNodes.forEach(child => {
      if (child.data && child.data.isDir && expandedPaths.value.has(child.data.path)) {
        if (child.loaded) {
          if (!child.expanded) {
            child.expanded = true
          }
          walkAndRestore(child)
        } else {
          child.expand(() => {
            walkAndRestore(child)
          })
        }
      }
    })
  }

  walkAndRestore(startNode)
}

// 重命名时更新 expandedPaths 中的路径
const updateExpandedPathsForRename = (oldPath, newPath, sep) => {
  const toUpdate = []
  expandedPaths.value.forEach(p => {
    if (p === oldPath || p.startsWith(oldPath + sep)) {
      toUpdate.push({ old: p, new: p.replace(oldPath, newPath) })
    }
  })
  toUpdate.forEach(({ old: oldP, new: newP }) => {
    expandedPaths.value.delete(oldP)
    expandedPaths.value.add(newP)
  })
  if (toUpdate.length > 0) saveExpandedPaths()
}

// 树配置
const treeProps = {
  label: 'name',
  children: 'children',
  isLeaf: (data) => !data.isDir
}

/* ============================================================
 * 文件类型 → 图标 + 颜色（目录树按扩展名区分文件类型）
 * ============================================================ */

// 根据文件名扩展名返回对应的图标组件与颜色
const fileIcon = (name) => {
  const ext = String(name || '').split('.').pop().toLowerCase()
  if (ext === 'pdf') return { icon: Files, color: '#e5484d' }
  if (['xlsx', 'xls', 'csv', 'tsv'].includes(ext)) return { icon: Grid, color: '#1d9d59' }
  if (['md', 'markdown'].includes(ext)) return { icon: Reading, color: '#4a6cf7' }
  if (['txt', 'log', 'json', 'html', 'xml'].includes(ext)) return { icon: Memo, color: '#8a8f99' }
  if (ext === 'smm') return { icon: Document, color: '#f59e0b' }
  return { icon: Document, color: 'inherit' }
}

/* ============================================================
 * 根文件夹管理
 * ============================================================ */

const loadRoots = () => {
  try {
    const stored = localStorage.getItem(ROOTS_KEY)
    folderRoots.value = stored ? JSON.parse(stored) : []
  } catch {
    folderRoots.value = []
  }
}

const saveRoots = () => {
  localStorage.setItem(ROOTS_KEY, JSON.stringify(folderRoots.value))
  // review bug fix：保存 folderRoots 时同步注册到 fsGuard 白名单。
  // 之前只存 localStorage 不注册 fsGuard，导致用户手动添加的 folderRoots
  // 后续被 AI 用 read_local_file 等工具访问时被 fsGuard 拒绝。
  if (window.electronAPI?.fsGuard?.addAllowed && folderRoots.value.length > 0) {
    window.electronAPI.fsGuard.addAllowed(folderRoots.value).catch(() => { /* ignore */ })
  }
}

const addFolder = async () => {
  if (!window.electronAPI?.fs?.selectFolder) {
    ElMessage.warning('需要在 Electron 环境中使用此功能')
    return
  }
  const folderPath = await window.electronAPI.fs.selectFolder()
  if (!folderPath) return

  // 避免重复添加
  if (folderRoots.value.includes(folderPath)) {
    ElMessage.info('该文件夹已添加')
    return
  }

  folderRoots.value.push(folderPath)
  saveRoots()
  refreshTree()
  ElMessage.success('已添加文件夹')
}

const removeRootFolder = (data) => {
  ElMessageBox.confirm(
    `确定要移除文件夹 "${data.name}" 吗？（不会删除实际文件）`,
    '提示',
    { confirmButtonText: '确定', cancelButtonText: '取消', type: 'warning' }
  ).then(() => {
    folderRoots.value = folderRoots.value.filter(p => p !== data.path)
    saveRoots()
    refreshTree()
    ElMessage.success('已移除文件夹')
  }).catch(() => {})
}

/* ============================================================
 * 指定保存目录（保存位置）管理
 * ============================================================ */

// 记录"自动加入的根目录"（桌面默认或用户指定保存目录），切换保存位置时替换而不是叠加
const AUTO_ROOT_KEY = 'MINDMAP_AUTO_ROOT'

// 同步保存目录到文件树：始终显示指定保存位置的目录，替换之前的自动根目录
// 仅在根列表实际变化时刷新，避免打断当前视图状态
const syncSaveDirRoot = (dirPath) => {
  if (!dirPath) return
  let prevAuto = ''
  try {
    prevAuto = localStorage.getItem(AUTO_ROOT_KEY) || ''
  } catch {
    prevAuto = ''
  }
  let roots = [...folderRoots.value]
  if (prevAuto && prevAuto !== dirPath) {
    roots = roots.filter(p => p !== prevAuto)
  }
  if (!roots.includes(dirPath)) {
    roots.unshift(dirPath)
  }
  localStorage.setItem(AUTO_ROOT_KEY, dirPath)
  if (JSON.stringify(roots) !== JSON.stringify(folderRoots.value)) {
    folderRoots.value = roots
    saveRoots()
    nextTick(() => refreshTree())
  }
}

// 设置保存位置按钮：选择文件夹后持久化，AI 生成文件等保存操作均使用该目录
const setSaveFolder = async () => {
  if (!window.electronAPI?.fs?.selectFolder || !window.electronAPI?.setSaveDir) {
    ElMessage.warning('需要在 Electron 环境中使用此功能')
    return
  }
  const folderPath = await window.electronAPI.fs.selectFolder()
  if (!folderPath) return
  try {
    const newDir = await window.electronAPI.setSaveDir(folderPath)
    if (newDir) {
      syncSaveDirRoot(newDir)
      ElMessage.success(`保存位置已设置为：${newDir}`)
    }
  } catch (error) {
    ElMessage.error(error.message || '设置保存位置失败')
  }
}

/* ============================================================
 * 懒加载
 * ============================================================ */

const loadNode = async (node, resolve) => {
  try {
    if (node.level === 0) {
      // 校验根文件夹是否仍然存在；接口不可用（浏览器模式）时跳过校验，
      // 否则 validRoots 恒为空数组会把已保存的根目录整体清空
      let validRoots = [...folderRoots.value]
      if (window.electronAPI?.fs?.exists) {
        const checked = []
        for (const p of folderRoots.value) {
          const exists = await window.electronAPI.fs.exists(p)
          if (exists) checked.push(p)
        }
        if (checked.length !== folderRoots.value.length) {
          folderRoots.value = checked
          saveRoots()
        }
        validRoots = checked
      }
      const rootNodes = validRoots.map(p => ({
        name: p.split(/[\\/]/).pop(),
        path: p,
        isDir: true,
        isRoot: true
      }))
      // 根节点加载后恢复展开状态
      nextTick(() => {
        setTimeout(() => restoreExpandedState(), 50)
      })
      return resolve(rootNodes)
    }

    if (!node.data.isDir) return resolve([])

    if (window.electronAPI?.fs?.listDir) {
      const list = await window.electronAPI.fs.listDir(node.data.path)
      resolve(list || [])
    } else {
      resolve([])
    }
  } catch (e) {
    console.error('加载节点失败:', e)
    resolve([])
  }
}

/* ============================================================
 * 局部刷新（保持目录展开状态）
 * ============================================================ */

const reloadParentNode = (data) => {
  const tree = fileTreeRef.value
  if (!tree) return
  const currentNode = tree.getNode(data.path)
  if (currentNode && currentNode.parent && currentNode.parent.level > 0) {
    const parentNode = currentNode.parent
    const wasExpanded = parentNode.expanded
    parentNode.loaded = false
    parentNode.loadData(() => {
      if (wasExpanded) parentNode.expanded = true
      nextTick(() => restoreExpandedState(parentNode))
    })
  } else {
    refreshTree()
  }
}

const refreshNode = (dirData, callback) => {
  const tree = fileTreeRef.value
  if (!tree) {
    if (callback) callback()
    return
  }
  const node = tree.getNode(dirData.path)
  if (node) {
    node.loaded = false
    node.expand(() => {
      nextTick(() => restoreExpandedState(node))
      if (callback) nextTick(callback)
    })
  } else {
    refreshTree()
    if (callback) nextTick(callback)
  }
}

const refreshTree = () => {
  const tree = fileTreeRef.value
  if (tree) {
    tree.store.setData([])
    nextTick(() => {
      // el-tree lazy 模式下，清空后需要重新触发加载
      tree.store.root.loaded = false
      tree.store.root.expand()
    })
  }
}

// 重命名后原地更新节点数据（避免整树刷新导致懒加载节点丢失）
// el-tree 以 data.path 作为 node-key，nodesMap 以 path 为键。
// 直接修改 data.path 不会自动更新 nodesMap 的键，需要手动迁移。
const updateNodeInPlace = (oldPath, newPath, newName, isDir) => {
  const tree = fileTreeRef.value
  if (!tree) {
    refreshTree()
    return
  }

  const node = tree.getNode(oldPath)
  if (!node) {
    // 节点未找到，回退到整树刷新
    refreshTree()
    return
  }

  const store = tree.store

  // 1. 先从 nodesMap 移除旧 key
  if (store.nodesMap) {
    delete store.nodesMap[oldPath]
  }
  // 2. 原地更新节点数据（node.key 是 getter，读取 data.path，改完自动返回 newPath）
  node.data.name = newName
  node.data.path = newPath
  // 3. 用新 key 重新注册，使 getNode(newPath) 能命中
  if (store.nodesMap) {
    store.nodesMap[newPath] = node
  }

  // 目录重命名后，子节点在磁盘上的路径已变化，需重新加载子节点以刷新路径
  if (isDir && node.loaded) {
    node.loaded = false
    if (node.expanded) {
      node.loadData(() => {
        nextTick(() => restoreExpandedState(node))
      })
    }
  }

  // 确保节点可见并选中（setCurrentKey 会自动展开父节点）
  nextTick(() => {
    tree.setCurrentKey(newPath)
  })
}

/* ============================================================
 * 文件操作
 * ============================================================ */

const handleNodeClick = (data) => {
  if (!data.isDir) {
    openFile(data.path, data.name)
  }
}

// 在资源管理器中打开：文件 → 定位并选中；文件夹 → 直接打开
const showInFolder = async (data) => {
  if (!window.electronAPI?.fs?.showInFolder) {
    ElMessage.warning('需要在桌面应用中使用此功能')
    return
  }
  try {
    await window.electronAPI.fs.showInFolder(data.path)
  } catch (error) {
    ElMessage.error(error.message || '打开失败')
  }
}

// 导入文件（XMind / Markdown）：弹出系统文件选择框，解析后作为导图打开
const importFile = async () => {
  if (!window.electronAPI?.selectFile) {
    ElMessage.info('请在 Electron 环境中使用此功能')
    return
  }
  try {
    const result = await window.electronAPI.selectFile()
    if (!result || !result.success || !result.data) return
    const filePath = result.filePath || ''
    const fileName = result.fileName || filePath.split(/[\\/]/).pop() || '未命名'
    if (result.isXmind) {
      const data = await parseXmindBase64(result.data, fileName)
      if (data) await openAsConvertedSmm(filePath, fileName, data, true)
      return
    }
    if (result.isMarkdown) {
      // Markdown 默认用文档查看器原样阅读（不转 .smm），右键空白处可 AI 转换为思维导图
      emit('open-doc', { filePath, fileName })
      return
    }
    // .smm / .json：主进程已解析为对象，直接打开
    emit('open-file', { filePath, fileName, data: result.data, isMarkdown: false, isXmind: false })
  } catch (e) {
    console.error('导入文件失败:', e)
    ElMessage.error('导入文件失败: ' + (e.message || ''))
  }
}

// 将导图数据写为 .smm（同名已存在时自动改名，不覆盖旧文件）；成功返回文件路径，失败返回 null。
// targetPath 传相对文件名时由主进程拼接默认保存目录
const writeSmmFile = async (targetPath, treeData) => {
  if (!window.electronAPI?.saveFile) return null
  try {
    const saved = await window.electronAPI.saveFile(targetPath, treeData)
    if (!saved || !saved.success) throw new Error(saved?.error || '写入失败')
    return saved.filePath
  } catch (e) {
    console.error('[FileTree] 生成 .smm 失败:', e)
    ElMessage.error(`生成 ${targetPath} 失败：${e.message || '未知错误'}`)
    return null
  }
}

// md/xmind 导入即转换：解析结果直接存为默认保存位置下的同名 .smm 并打开该 .smm，源文件保持原样不动。
// 旧逻辑在源文件同目录生成 .smm，导致 .md 原路径下凭空多出导图文件
const openAsConvertedSmm = async (srcPath, srcName, data, isXmind) => {
  if (srcPath && window.electronAPI?.saveFile) {
    const base = (srcName || '未命名').replace(/\.(md|markdown|xmind)$/i, '')
    // 传相对文件名：主进程 save-file 自动存入默认保存位置（用户指定的保存目录）
    const smmPath = await writeSmmFile(`${base}.smm`, data)
    if (smmPath) {
      const sep = smmPath.includes('\\') ? '\\' : '/'
      const dir = smmPath.substring(0, smmPath.lastIndexOf(sep))
      syncSaveDirRoot(dir)
      await nextTick()
      refreshNode({ path: dir, isDir: true })
      const smmName = smmPath.split(/[\\/]/).pop() || `${base}.smm`
      ElMessage.success(`已导入为 ${smmName}（保存位置：${dir}）`)
      emit('open-file', { filePath: smmPath, fileName: smmName, data, isMarkdown: false, isXmind: false })
      return
    }
  }
  // .smm 落盘失败时退回旧逻辑：以导入态打开源文件，首次保存时再生成 .smm
  emit('open-file', { filePath: srcPath, fileName: srcName, data, isMarkdown: !isXmind, isXmind })
}

const openFile = async (filePath, name) => {
  // 文档类文件（pdf/docx/xlsx/csv/md/txt 等）默认用文档查看器原样打开（md 支持渲染/源码切换，
  // 右键空白处可 AI 转换为思维导图）；xmind/opml 仍走"导入转换为导图"流程
  const ext = String(filePath || '').split('.').pop().toLowerCase()
  if (['pdf', 'docx', 'xlsx', 'xls', 'csv', 'tsv', 'txt', 'md', 'markdown', 'json', 'log', 'html', 'xml'].includes(ext)) {
    emit('open-doc', { filePath, fileName: name })
    return
  }
  if (!window.electronAPI?.openFile) return
  try {
    const result = await window.electronAPI.openFile(filePath)
    if (result && result.success && result.data) {
      // XMind：主进程返回 base64，渲染进程解析为导图数据
      if (result.isXmind) {
        const data = await parseXmindBase64(result.data, name)
        if (data) emit('open-file', { filePath, fileName: name, data, isMarkdown: false, isXmind: true })
        return
      }
      emit('open-file', { filePath, fileName: name, data: result.data, isMarkdown: result.isMarkdown })
    } else {
      // 打开失败不再静默：给出提示并刷新所在目录（清掉已被移动/重命名/删除的失效树节点）
      ElMessage.error(`「${name || filePath}」打开失败：文件可能已被移动、重命名或删除`)
      const sep = filePath.includes('\\') ? '\\' : '/'
      const parentDir = filePath.substring(0, filePath.lastIndexOf(sep))
      if (parentDir) refreshNode({ path: parentDir, isDir: true })
    }
  } catch (error) {
    console.error('打开文件失败:', error)
    ElMessage.error('打开文件失败: ' + (error.message || ''))
  }
}

const rememberRecentFile = (filePath) => {
  if (!filePath) return
  const name = filePath.split(/[\\/]/).pop() || filePath
  const next = [
    { path: filePath, name },
    ...recentFiles.value.filter(f => f.path && f.path !== filePath && f.name !== name)
  ].slice(0, 5)
  recentFiles.value = next
  try { localStorage.setItem(RECENT_FILES_KEY, JSON.stringify(next)) } catch {}
}

const removeRecent = (filePath) => {
  const next = recentFiles.value.filter(f => f.path !== filePath)
  recentFiles.value = next
  try { localStorage.setItem(RECENT_FILES_KEY, JSON.stringify(next)) } catch {}
}

// 重命名/移动文件时同步更新最近打开记录中的路径
const updateRecentPath = (oldPath, newPath) => {
  const next = recentFiles.value.map(f => {
    if (f.path === oldPath) return { ...f, path: newPath, name: newPath.split(/[\\/]/).pop() || f.name }
    return f
  })
  recentFiles.value = next
  try { localStorage.setItem(RECENT_FILES_KEY, JSON.stringify(next)) } catch {}
}

const openRecent = async (filePath) => {
  // 检查文件是否存在
  if (window.electronAPI?.fs?.exists) {
    const exists = await window.electronAPI.fs.exists(filePath)
    if (!exists) {
      ElMessage.warning('文件已不存在，已从最近打开中移除')
      removeRecent(filePath)
      return
    }
  }
  const name = filePath.split(/[\\/]/).pop() || '未命名'
  openFile(filePath, name)
}

const showRecentFolder = (filePath) => {
  if (!filePath) return
  const sep = filePath.includes('\\') ? '\\' : '/'
  const idx = filePath.lastIndexOf(sep)
  if (idx <= 0) return
  const dir = filePath.substring(0, idx)
  showInFolder({ path: dir, isDir: true })
}

const copyFile = async (data) => {
  if (!data || data.isDir) return
  try {
    await ElMessageBox.confirm(
      `确定创建副本「${data.name}」吗？`,
      '创建副本',
      { confirmButtonText: '创建', cancelButtonText: '取消', type: 'warning' }
    )
  } catch {
    return
  }
  const sep = data.path.includes('\\') ? '\\' : '/'
  const dir = data.path.substring(0, data.path.lastIndexOf(sep))
  const rawName = data.name || data.path.split(/[\\/]/).pop() || '未命名'
  const dot = rawName.lastIndexOf('.')
  const base = dot > 0 ? rawName.slice(0, dot) : rawName
  const ext = dot > 0 ? rawName.slice(dot) : ''
  const target = await ensureUniqueTargetPath(`${dir}${sep}${base} - 副本${ext}`)
  if (!window.electronAPI?.fs?.readBinary || !window.electronAPI?.fs?.writeBinary) {
    ElMessage.warning('当前环境不支持创建副本')
    return
  }
  try {
    const bin = await window.electronAPI.fs.readBinary(data.path)
    if (!bin || !bin.success) throw new Error(bin?.error || '读取文件失败')
    const written = await window.electronAPI.fs.writeBinary(target, bin.base64)
    if (!written || !written.success) throw new Error(written?.error || '写入副本失败')
    ElMessage.success(`已创建副本：${target.split(/[\\/]/).pop()}`)
    if (dir) refreshNode({ path: dir, isDir: true })
  } catch (e) {
    ElMessage.error('创建副本失败: ' + (e.message || ''))
  }
}

// 外部文件拖入目录树：复制到目标文件夹下
const hasExternalFiles = (e) =>
  Array.from(e.dataTransfer?.types || []).some(t => t === 'Files')

// 拖拽文件到 AI 对话输入框。
// 注意：Element Plus 的 el-tree 拖拽起点是 .el-tree-node__content（外层），
// 内层 .tree-node 的 @dragstart 不会触发，所以必须使用 node-drag-start / node-drag-end。
const onTreeNodeDragStart = (treeNode, event) => {
  const data = treeNode && treeNode.data
  if (!data || data.isDir) return
  const path = data.path || ''
  if (!path) return
  if (event && event.dataTransfer) {
    event.dataTransfer.setData('application/x-mindmap-file', path)
    event.dataTransfer.setData('text/plain', path)
    event.dataTransfer.effectAllowed = 'copyMove'
  }
  // 模块变量后备：同页拖拽时 dataTransfer.getData() 可能返回空
  setDragFilePath(path)
}

const onTreeNodeDragEnd = () => {
  clearDragFilePath()
}

const onNodeDragOver = (e, data) => {
  if (!data?.isDir) return
  if (!hasExternalFiles(e)) return
  e.dataTransfer.dropEffect = 'copy'
}

const ensureUniqueTargetPath = async (filePath) => {
  if (!window.electronAPI?.fs?.exists) return filePath
  if (!(await window.electronAPI.fs.exists(filePath))) return filePath
  const dot = filePath.lastIndexOf('.')
  const base = dot > 0 ? filePath.slice(0, dot) : filePath
  const ext = dot > 0 ? filePath.slice(dot) : ''
  for (let i = 1; i < 1000; i++) {
    const candidate = `${base} (${i})${ext}`
    if (!(await window.electronAPI.fs.exists(candidate))) return candidate
  }
  return `${base}_${Date.now()}${ext}`
}

const onNodeDropExternal = async (e, data) => {
  if (!data?.isDir) return
  if (!hasExternalFiles(e)) return
  const files = Array.from(e.dataTransfer?.files || [])
  if (files.length === 0) return
  if (!window.electronAPI?.fs?.readBinary || !window.electronAPI?.fs?.writeBinary) {
    ElMessage.warning('当前环境不支持从外部拖入文件')
    return
  }
  const sep = data.path.includes('\\') ? '\\' : '/'
  let ok = 0
  let converted = 0
  for (const file of files) {
    try {
      const srcPath = window.electronAPI.getPathForFile
        ? window.electronAPI.getPathForFile(file)
        : (file.path || '')
      if (!srcPath) continue
      const rawName = file.name || srcPath.split(/[\\/]/).pop() || '未命名文件'
      // xmind 拖入：解析后转 .smm；md 拖入：直接复制原文件（保留 md 原样，点击后用文档查看器阅读）
      if (/\.xmind$/i.test(rawName)) {
        const bin = await window.electronAPI.fs.readBinary(srcPath)
        if (bin && bin.success) {
          const treeData = await parseXmindBase64(bin.base64, rawName)
          if (treeData) {
            const base = rawName.replace(/\.xmind$/i, '')
            const smmPath = await writeSmmFile(`${data.path}${sep}${base}.smm`, treeData)
            if (smmPath) { ok++; converted++ }
          }
        }
        continue
      }
      const targetPath = await ensureUniqueTargetPath(`${data.path}${sep}${rawName}`)
      const bin = await window.electronAPI.fs.readBinary(srcPath)
      if (!bin || !bin.success) continue
      const written = await window.electronAPI.fs.writeBinary(targetPath, bin.base64)
      if (written && written.success) ok++
    } catch (err) {
      console.error('[FileTree] 外部拖入文件失败:', err)
    }
  }
  if (ok > 0) {
    const msg = converted > 0
      ? `已导入 ${ok} 个文件（${converted} 个已转为 .smm）`
      : `已导入 ${ok} 个文件`
    ElMessage.success(msg)
    refreshNode({ path: data.path, isDir: true })
  }
}

// base64 .xmind → 导图数据
const parseXmindBase64 = async (base64, name) => {
  try {
    const { parseXmindBase64: parse } = await import('../utils/xmindParser')
    return await parse(base64, name)
  } catch (e) {
    console.error('[FileTree] 解析 XMind 失败:', e)
    ElMessage.error('XMind 文件解析失败')
    return null
  }
}

const createFile = async (dirData) => {
  if (!window.electronAPI?.fs?.createFile) return
  try {
    const fileName = '新建思维导图.smm'
    const sep = dirData.path.includes('\\') ? '\\' : '/'
    const filePath = await window.electronAPI.fs.createFile(
      `${dirData.path}${sep}${fileName}`
    )
    ElMessage.success('已创建文件')
    // 重新加载父目录：避免 el-tree lazy 模式 append 导致节点层级/顺序错乱（新文件跑到子文件夹下）
    if (!expandedPaths.value.has(dirData.path)) {
      expandedPaths.value.add(dirData.path)
      saveExpandedPaths()
    }
    refreshNode({ path: dirData.path, isDir: true }, () => {
      startInlineEdit(filePath)
    })
  } catch (error) {
    ElMessage.error('创建文件失败: ' + error.message)
  }
}

const createDir = async (dirData) => {
  if (!window.electronAPI?.fs?.mkdir) return
  try {
    const dirName = '新建文件夹'
    const sep = dirData.path.includes('\\') ? '\\' : '/'
    const dirPath = await window.electronAPI.fs.mkdir(
      `${dirData.path}${sep}${dirName}`
    )
    ElMessage.success('已创建文件夹')
    // 重新加载父目录：避免 el-tree lazy 模式 append 导致节点层级/顺序错乱
    if (!expandedPaths.value.has(dirData.path)) {
      expandedPaths.value.add(dirData.path)
      saveExpandedPaths()
    }
    refreshNode({ path: dirData.path, isDir: true }, () => {
      startInlineEdit(dirPath)
    })
  } catch (error) {
    ElMessage.error('创建文件夹失败: ' + error.message)
  }
}

const startRename = (data) => {
  startInlineEdit(data.path, data.name)
}

const startInlineEdit = (path, initialName) => {
  inlineEditingPath.value = path
  inlineEditingValue.value = initialName || path.split(/[\\/]/).pop()
  // 等待渲染后聚焦
  nextTick(() => {
    const input = inlineEditInputRef.value
    if (input) {
      input.focus()
      input.select()
    }
  })
}

let inlineEditBusy = false
const confirmInlineEdit = async (data) => {
  if (inlineEditBusy) return  // 防重入：Enter 和 blur 可能同时触发
  inlineEditBusy = true
  try {
    await doConfirmInlineEdit(data)
  } finally {
    inlineEditBusy = false
  }
}

const doConfirmInlineEdit = async (data) => {
  const newName = inlineEditingValue.value.trim()
  const oldPath = inlineEditingPath.value

  if (!newName) {
    cancelInlineEdit()
    return
  }

  // 如果名称没变，直接退出
  const oldName = oldPath.split(/[\\/]/).pop()
  if (newName === oldName) {
    cancelInlineEdit()
    return
  }

  // 检查非法字符
  if (/[\\/:*?"<|]/.test(newName)) {
    ElMessage.warning('文件名不能包含 \\ / : * ? " < |')
    cancelInlineEdit()
    return
  }

  // 如果是文件且没有扩展名，自动补 .smm
  let finalName = newName
  if (!data.isDir && !/\.[a-z0-9]+$/i.test(finalName)) {
    finalName += '.smm'
  }

  // 计算新路径
  const sep = oldPath.includes('\\') ? '\\' : '/'
  const parentDir = oldPath.substring(0, oldPath.lastIndexOf(sep))
  const newPath = parentDir + sep + finalName

  // 先退出编辑态，避免输入框失焦再次触发 confirm
  cancelInlineEdit()

  if (!window.electronAPI?.fs?.rename) return

  try {
    await window.electronAPI.fs.rename(oldPath, newPath)
    ElMessage.success('重命名成功')
    // 如果是目录，更新 expandedPaths 中的路径（含子孙目录）
    if (data.isDir) {
      updateExpandedPathsForRename(oldPath, newPath, sep)
    }
    // 原地更新节点数据，避免整树刷新导致懒加载节点丢失
    updateNodeInPlace(oldPath, newPath, finalName, data.isDir)
    // 通知父组件同步 currentFilePath：否则重命名当前文件后自动保存会在旧路径重建文件
    // 同步更新最近打开记录中的路径
    updateRecentPath(oldPath, newPath)
    emit('file-renamed', { oldPath, newPath, isDir: !!data.isDir })
  } catch (error) {
    ElMessage.error('重命名失败: ' + error.message)
    reloadParentNode(data)
  }
}

const cancelInlineEdit = () => {
  inlineEditingPath.value = ''
  inlineEditingValue.value = ''
}

const removeNode = (data) => {
  // 检测该文件（或目录下文件）是否关联了复习任务：有关联时提示删除会同步删除复习计划
  const norm = (p) => String(p || '').replace(/\\/g, '/')
  const target = norm(data.path)
  const reviewItems = getReviewPlan().filter(item => {
    const fp = norm(item.filePath)
    if (data.isDir) return fp === target || fp.startsWith(target + '/')
    return fp === target
  })
  const hasReview = reviewItems.length > 0
  const message = hasReview
    ? `文件 "${data.name}" 存在 ${reviewItems.length} 个复习任务，删除后会同步删除对应的复习计划。是否确认删除？`
    : `确定要删除 "${data.name}" 吗？`

  ElMessageBox.confirm(
    message,
    '删除确认',
    { confirmButtonText: '确定', cancelButtonText: '取消', type: 'warning' }
  ).then(async () => {
    if (!window.electronAPI?.fs?.remove) return
    try {
      await window.electronAPI.fs.remove(data.path)
      // 删除对应的复习计划（文件级或目录下全部文件级）
      if (hasReview) {
        reviewItems.forEach(item => removeByFilePath(item.filePath))
      }
      ElMessage.success(hasReview ? `已删除，并同步删除 ${reviewItems.length} 个复习任务` : '已删除')
      // 从最近打开记录中移除
      if (data.isDir) {
        // 目录删除：移除该目录下所有文件的最近记录
        const dirNorm = data.path.replace(/\\/g, '/').replace(/\/+$/, '')
        recentFiles.value.filter(f => {
          const fp = (f.path || '').replace(/\\/g, '/')
          return fp === dirNorm || fp.startsWith(dirNorm + '/')
        }).forEach(f => removeRecent(f.path))
      } else {
        removeRecent(data.path)
      }
      // 清理 expandedPaths 中被删除的目录及其子路径
      if (data.isDir) {
        const toRemove = []
        expandedPaths.value.forEach(p => {
          if (p === data.path || p.startsWith(data.path + '/') || p.startsWith(data.path + '\\')) {
            toRemove.push(p)
          }
        })
        toRemove.forEach(p => expandedPaths.value.delete(p))
        if (toRemove.length > 0) saveExpandedPaths()
      }
      // 直接从树中移除节点，不重新加载父目录
      const tree = fileTreeRef.value
      const node = tree?.getNode(data.path)
      if (node) {
        tree.remove(node)
      }
      // 通知父组件：被删除的文件可能有打开的标签，需要同步关闭
      emit('file-deleted', data.path)
    } catch (error) {
      ElMessage.error('删除失败: ' + error.message)
    }
  }).catch(() => {})
}

/* ============================================================
 * 拖拽移动
 * ============================================================ */

// 内联编辑（重命名）期间禁止拖拽，避免拖动选中文字时误触文件拖拽
const allowDragNode = () => {
  return !inlineEditingPath.value
}

const allowDrop = (draggingNode, dropNode, type) => {
  // 只允许拖入文件夹内部（inner）
  if (type !== 'inner') return false
  if (!dropNode.data.isDir) return false
  // 禁止把目录拖入自身或自身的子目录（会导致目录树/复习计划路径错乱）
  const norm = p => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '')
  const src = norm(draggingNode.data.path)
  const dest = norm(dropNode.data.path)
  if (!src || !dest) return false
  if (dest === src || dest.startsWith(src + '/')) return false
  return true
}

const handleNodeDrop = async (draggingNode, dropNode) => {
  const srcPath = draggingNode.data.path
  const destDir = dropNode.data.path

  if (!window.electronAPI?.fs?.move) return

  // 移动涉及当前打开文件（文件本身或其所在目录被移动）时，先让 App 层确认：
  // 有未保存修改 → 弹「保存并移动」提示，落盘后才放行；用户取消或保存失败则中止移动
  const norm = p => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '')
  const cur = norm(props.currentFilePath)
  const src = norm(srcPath)
  const affectsCurrent = !!cur && (cur === src || cur.startsWith(src + '/'))
  if (affectsCurrent) {
    const approved = await new Promise(resolve => {
      emit('before-move', { srcPath, destDir, resolve })
    })
    if (!approved) {
      // 取消移动：el-tree 已在内部挪过节点，按磁盘真实状态还原两侧目录
      const sep = srcPath.includes('\\') ? '\\' : '/'
      const srcParent = srcPath.substring(0, srcPath.lastIndexOf(sep))
      if (srcParent) refreshNode({ path: srcParent, isDir: true })
      refreshNode({ path: destDir, isDir: true })
      return
    }
  }

  try {
    await window.electronAPI.fs.move(srcPath, destDir)
    ElMessage.success('已移动')
    // 通知父组件同步 currentFilePath 与复习计划路径（当前文件被移动/其所在目录被移动时）
    emit('file-moved', { srcPath, destDir })
    // 刷新源目录与目标目录（懒加载树不会自动重载，旧节点残留会导致点击无效）
    const sep = srcPath.includes('\\') ? '\\' : '/'
    const srcParent = srcPath.substring(0, srcPath.lastIndexOf(sep))
    if (srcParent) {
      refreshNode({ path: srcParent, isDir: true })
    }
    refreshNode({ path: destDir, isDir: true })
  } catch (error) {
    ElMessage.error('移动失败: ' + error.message)
    // 恢复树状态
    refreshTree()
  }
}

/* ============================================================
 * 右键菜单：文件节点支持「添加标签」
 * ============================================================ */
const ctxMenu = ref({ visible: false, x: 0, y: 0, data: null })

const onContextMenu = (e, data) => {
  // 仅对文件（非目录）显示「添加标签」菜单
  if (!data || data.isDir) {
    ctxMenu.value.visible = false
    return
  }
  ctxMenu.value = { visible: true, x: e.clientX, y: e.clientY, data }
}

const closeCtxMenu = () => {
  ctxMenu.value.visible = false
}

// 从右键菜单添加标签（文件级定位，非导图/文档的滚动位置）
const onAddTagFromContext = () => {
  const data = ctxMenu.value.data
  const pos = { x: ctxMenu.value.x, y: ctxMenu.value.y }
  closeCtxMenu()
  if (!data) return
  emit('add-tag', {
    filePath: data.path,
    fileName: data.name,
    fileType: 'file',
    nodeUid: '',
    nodeText: '',
    page: null,
    scrollTop: null,
    pos
  })
}

// ============ 版本历史（覆盖保存自动备份 → 列表 → 回滚） ============
const isSmmFile = computed(() => {
  const d = ctxMenu.value.data
  return !!(d && !d.isDir && String(d.path || '').toLowerCase().endsWith('.smm'))
})

const versionDialog = ref({ visible: false, loading: false, filePath: '', fileName: '', list: [] })

const versionTime = (name) => {
  const m = String(name || '').match(/(\d{4}-\d{2}-\d{2})T(\d{2}-\d{2}-\d{2})/)
  return m ? `${m[1]} ${m[2].replace(/-/g, ':')}` : name
}

const showVersionHistory = async () => {
  const data = ctxMenu.value.data
  closeCtxMenu()
  if (!data) return
  versionDialog.value = { visible: true, loading: true, filePath: data.path, fileName: data.name || '', list: [] }
  try {
    const list = await window.electronAPI?.listFileVersions?.(data.path) || []
    versionDialog.value.list = list
  } catch (e) {
    versionDialog.value.list = []
  }
  versionDialog.value.loading = false
}

const restoreVersion = async (v) => {
  const fp = versionDialog.value.filePath
  if (!fp || !v?.path) return
  try {
    await ElMessageBox.confirm('确定恢复到该历史版本吗？当前内容将被该版本覆盖。', '恢复历史版本', {
      confirmButtonText: '恢复', cancelButtonText: '取消', type: 'warning'
    })
  } catch { return }
  try {
    const r = await window.electronAPI?.restoreFileVersion?.(fp, v.path)
    if (r && r.success) {
      versionDialog.value.visible = false
      // 恢复成功后自动重新打开（带 skipAutoSave 标记，跳过自动保存，避免内存未保存修改覆盖恢复的版本）
      const name = versionDialog.value.fileName
      try {
        const read = await window.electronAPI?.openFile?.(fp)
        if (read && read.success && read.data) {
          emit('open-file', { filePath: fp, fileName: name, data: read.data, isMarkdown: false, isXmind: false, skipAutoSave: true })
          ElMessage.success('已恢复历史版本')
          return
        }
      } catch (e2) { /* 读取失败则退化为刷新目录树 */ }
      refreshTree()
      ElMessage.success('已恢复历史版本，请重新打开该文件查看')
    } else {
      ElMessage.error(r?.error || '恢复失败')
    }
  } catch (e) {
    ElMessage.error('恢复失败: ' + (e.message || ''))
  }
}

// 点击任意处关闭右键菜单（用 click 而非 mousedown，避免菜单项 click 前 DOM 已被移除）
const onGlobalClick = () => {
  if (ctxMenu.value.visible) closeCtxMenu()
}

onMounted(() => {
  document.addEventListener('click', onGlobalClick, true)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', onGlobalClick, true)
})

/* ============================================================
 * 暴露方法
 * ============================================================ */
defineExpose({
  refreshTree,
  syncSaveDirRoot,
  reloadCurrentFile: () => {
    if (props.currentFilePath) {
      const sep = props.currentFilePath.includes('\\') ? '\\' : '/'
      const parentDir = props.currentFilePath.substring(0, props.currentFilePath.lastIndexOf(sep))
      refreshNode({ path: parentDir, isDir: true })
    }
  },
  openFileByPath: (filePath) => {
    const name = filePath.split(/[\\/]/).pop() || '未命名'
    openFile(filePath, name)
  }
})

// 轮询同步展开中的目录：外部新增/删除/重命名文件后无需手动刷新即可出现在左侧目录树
let syncTimer = null
const refreshVisibleDirs = async () => {
  const tree = fileTreeRef.value
  if (!tree || !window.electronAPI?.fs?.listDir) return
  for (const path of [...expandedPaths.value]) {
    try {
      const node = tree.getNode(path)
      if (!node || !node.data?.isDir || !node.expanded) continue
      const list = await window.electronAPI.fs.listDir(path)
      const oldPaths = new Set((node.childNodes || []).map(c => c.data?.path).filter(Boolean))
      const newPaths = new Set((list || []).map(item => item.path).filter(Boolean))
      if (oldPaths.size !== newPaths.size || [...newPaths].some(p => !oldPaths.has(p)) || [...oldPaths].some(p => !newPaths.has(p))) {
        refreshNode({ path, isDir: true })
      }
    } catch {
      // 单个目录同步失败忽略
    }
  }
}

onMounted(async () => {
  // folderRoots 和 expandedPaths 已在 setup 阶段同步加载

  // 始终显示指定保存位置的目录（未指定时为桌面），替换之前的自动根目录
  if (window.electronAPI?.getDefaultSaveDir) {
    try {
      const saveDir = await window.electronAPI.getDefaultSaveDir()
      syncSaveDirRoot(saveDir)
    } catch {
      // 获取保存目录失败，忽略
    }
  }

  // review bug fix：把 FileTree 已有的 folderRoots 自动注册到 fsGuard 白名单，
  // 这样重启程序后 FileTree 的 root 目录不会被 fsGuard 拒绝（之前是进程内 Set，
  // 重启后清空，导致 FileTree 加载时 fs:exists 看起来无响应——实际上是 fsGuard 拦了）。
  if (window.electronAPI?.fsGuard?.addAllowed && folderRoots.value.length > 0) {
    try {
      await window.electronAPI.fsGuard.addAllowed(folderRoots.value)
    } catch (_) { /* 注册失败不阻塞 FileTree 渲染 */ }
  }

  syncTimer = setInterval(refreshVisibleDirs, 4000)
  rememberRecentFile(props.currentFilePath)
})

onBeforeUnmount(() => {
  if (syncTimer) {
    clearInterval(syncTimer)
    syncTimer = null
  }
})

// 监听 currentFilePath 变化以高亮当前文件
watch(() => props.currentFilePath, (newPath) => {
  if (fileTreeRef.value && newPath) {
    fileTreeRef.value.setCurrentKey(newPath)
  }
  rememberRecentFile(newPath)
})
</script>

<style scoped>
.file-tree-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.tree-toolbar {
  display: flex;
  gap: 4px;
  padding: 4px 12px 4px;
  flex-shrink: 0;
}

.tree-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  color: var(--text-secondary);
  transition: background-color var(--transition-fast), color var(--transition-fast);
}

.tree-btn:hover {
  background-color: rgba(0, 0, 0, 0.06);
  color: var(--text-primary);
}

.recent-files {
  padding: 4px 12px 6px;
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
}

.recent-files-title {
  font-size: 11px;
  color: var(--text-tertiary);
  margin-bottom: 3px;
}

.recent-files-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.recent-file-item {
  width: 100%;
  display: flex;
  align-items: center;
  padding: 2px 6px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  text-align: left;
}

.recent-file-item:hover {
  background: rgba(0, 122, 255, 0.08);
  color: var(--apple-blue);
}

.recent-file-open-folder {
  display: none;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  margin-left: auto;
  border-radius: 50%;
  font-size: 12px;
  color: var(--text-secondary);
  background: rgba(0, 0, 0, 0.05);
  flex-shrink: 0;
}

.recent-file-item:hover .recent-file-open-folder {
  display: flex;
}

.recent-file-open-folder:hover {
  background: rgba(0, 122, 255, 0.14);
  color: var(--apple-blue);
}

.recent-file-remove {
  display: none;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  margin-left: auto;
  border-radius: 50%;
  font-size: 11px;
  color: var(--text-tertiary);
  background: rgba(0, 0, 0, 0.06);
  flex-shrink: 0;
}

.recent-file-item:hover .recent-file-remove {
  display: flex;
}

.recent-file-remove:hover {
  background: rgba(255, 59, 48, 0.14);
  color: #ff3b30;
}

.recent-file-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}

.tree-body {
  flex: 1;
  overflow-y: auto;
  padding: 0 4px 8px;
}

.tree-body::-webkit-scrollbar {
  width: 6px;
}

.tree-body::-webkit-scrollbar-track {
  background: transparent;
}

.tree-body::-webkit-scrollbar-thumb {
  background-color: rgba(0, 0, 0, 0.12);
  border-radius: var(--radius-full);
}

/* 树节点 */
.tree-node {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 1;
  padding-right: 8px;
  min-width: 0;
}

.node-icon {
  flex-shrink: 0;
  font-size: 14px;
  color: var(--text-secondary);
}

.node-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  color: var(--text-primary);
  padding: 2px 0;
}

.node-name.active {
  color: var(--apple-blue);
  font-weight: 500;
}

/* 操作按钮 */
.node-actions {
  display: none;
  align-items: center;
  gap: 1px;
  flex-shrink: 0;
}

.tree-node:hover .node-actions {
  display: flex;
}

.action-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  color: var(--text-secondary);
  transition: background-color var(--transition-fast), color var(--transition-fast);
}

.action-icon:hover {
  background-color: rgba(0, 0, 0, 0.08);
  color: var(--text-primary);
}

.action-icon.danger:hover {
  background-color: rgba(255, 59, 48, 0.1);
  color: #ff3b30;
}

/* 内联编辑输入框 */
.inline-edit-input {
  flex: 1;
  height: 24px;
  padding: 0 4px;
  font-size: 13px;
  font-family: var(--font-family);
  border: 1px solid var(--apple-blue);
  border-radius: 4px;
  outline: none;
  background: #fff;
  min-width: 0;
}

/* 空状态 */
.empty-state {
  padding: 20px 16px;
  text-align: center;
  color: var(--text-tertiary);
  font-size: 13px;
}

.empty-state p {
  margin-bottom: 8px;
}

.add-folder-btn {
  padding: 4px 12px;
  font-size: 12px;
  font-family: var(--font-family);
  color: #fff;
  background-color: var(--apple-blue);
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background-color var(--transition-fast);
}

.add-folder-btn:hover {
  background-color: #0066d6;
}

/* el-tree 样式覆盖 */
:deep(.el-tree) {
  background: transparent;
  --el-tree-node-hover-bg-color: rgba(0, 0, 0, 0.04);
}

:deep(.el-tree-node__content) {
  height: 30px;
}

:deep(.el-tree-node__content:hover) {
  background-color: rgba(0, 0, 0, 0.04);
}

:deep(.el-tree-node.is-current > .el-tree-node__content) {
  background-color: rgba(0, 122, 255, 0.08);
}
</style>

<style>
/* 文件树右键菜单（Teleport 到 body，需全局样式） */
.file-ctx-menu {
  position: fixed;
  z-index: 9999;
  min-width: 140px;
  padding: 4px;
  background: rgba(255, 255, 255, 0.95);
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 10px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.14);
  user-select: none;
}
.file-ctx-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 7px;
  font-size: 13px;
  color: #303133;
  cursor: pointer;
}
.file-ctx-item:hover {
  background: #f0f7ff;
  color: #409eff;
}
.file-ctx-item svg {
  color: #409eff;
  flex-shrink: 0;
}

/* 版本历史弹窗（Teleport 到 body） */
.version-dialog-mask {
  position: fixed;
  inset: 0;
  z-index: 1500;
  background: rgba(0, 0, 0, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
}
.version-dialog {
  width: 380px;
  max-height: 70vh;
  display: flex;
  flex-direction: column;
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.2);
  overflow: hidden;
}
.version-dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  font-size: 14px;
  font-weight: 600;
  color: #303133;
  border-bottom: 1px solid rgba(0, 0, 0, 0.08);
}
.version-dialog-close {
  width: 24px;
  height: 24px;
  font-size: 18px;
  line-height: 1;
  color: #909399;
  background: transparent;
  border: none;
  cursor: pointer;
}
.version-dialog-body {
  padding: 8px 12px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.version-empty {
  padding: 20px;
  text-align: center;
  color: #909399;
  font-size: 13px;
}
.version-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.03);
}
.version-time {
  font-size: 13px;
  color: #606266;
  font-family: Consolas, Monaco, monospace;
}
.version-restore {
  padding: 4px 12px;
  font-size: 12px;
  color: #fff;
  background: #409eff;
  border: none;
  border-radius: 6px;
  cursor: pointer;
}
.version-restore:hover {
  background: #337ecc;
}
</style>

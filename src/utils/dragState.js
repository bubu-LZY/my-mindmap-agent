/**
 * 模块级拖拽状态：文件树 → AI 输入框的可靠路径传递。
 * dataTransfer.getData() 在同页拖拽时可能返回空值，
 * 因此用模块变量作为后备通道。
 */

let _dragFilePath = null

export const setDragFilePath = (path) => { _dragFilePath = path || null }
export const getDragFilePath = () => _dragFilePath
export const clearDragFilePath = () => { _dragFilePath = null }

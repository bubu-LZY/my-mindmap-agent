const { ipcMain, dialog } = require('electron')

// 保存文件对话框
ipcMain.handle('dialog:showSaveDialog', async (event, options) => {
  const result = await dialog.showSaveDialog({
    title: options?.title || '保存文件',
    defaultPath: options?.defaultPath || '',
    buttonLabel: options?.buttonLabel || '保存',
    filters: options?.filters || [
      { name: '所有文件', extensions: ['*'] }
    ]
  })
  if (result.canceled) return null
  return result.filePath
})

// 打开文件对话框
ipcMain.handle('dialog:showOpenDialog', async (event, options) => {
  const result = await dialog.showOpenDialog({
    title: options?.title || '打开文件',
    buttonLabel: options?.buttonLabel || '打开',
    filters: options?.filters || [
      { name: '所有文件', extensions: ['*'] }
    ],
    properties: options?.properties || ['openFile']
  })
  if (result.canceled) return null
  return result.filePaths
})

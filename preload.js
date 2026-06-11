const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('traceless', {
  selectFiles: () => ipcRenderer.invoke('select-files'),
  readMetadata: (filePath) => ipcRenderer.invoke('read-metadata', filePath),
  writeMetadata: (filePath, tags, overwrite) =>
    ipcRenderer.invoke('write-metadata', { filePath, tags, overwrite }),
  cleanMetadata: (filePath, overwrite) =>
    ipcRenderer.invoke('clean-metadata', { filePath, overwrite }),
  
  // Custom Titlebar
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),

  // Additional File Operations
  renameFile: (oldPath, newName) => ipcRenderer.invoke('rename-file', { oldPath, newName }),
  showItemInFolder: (filePath) => ipcRenderer.invoke('show-item-in-folder', filePath),
  copyFileToClipboard: (filePath) => ipcRenderer.invoke('copy-file-to-clipboard', filePath),
  copyTextToClipboard: (text) => ipcRenderer.invoke('copy-text-to-clipboard', text),
  showSaveDialog: (defaultPath, filters) => ipcRenderer.invoke('show-save-dialog', { defaultPath, filters }),
  saveAs: (sourcePath, targetPath, tags, cleanAll) => ipcRenderer.invoke('save-as', { sourcePath, targetPath, tags, cleanAll }),

  // Auto-Update IPC
  onUpdateStatus: (callback) => ipcRenderer.on('update-status', (_event, data) => callback(data)),
  downloadUpdate: () => ipcRenderer.send('update-download'),
  installUpdate: () => ipcRenderer.send('update-install'),
  checkForUpdate: () => ipcRenderer.send('update-check'),

  // Visual Validation Automation
  resizeWindow: (width, height) => ipcRenderer.invoke('resize-window', { width, height }),
  maximizeWindow: () => ipcRenderer.invoke('maximize-window'),
  unmaximizeWindow: () => ipcRenderer.invoke('unmaximize-window'),
  captureScreenshot: (name) => ipcRenderer.invoke('capture-screenshot', name),
});

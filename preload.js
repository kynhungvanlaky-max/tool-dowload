const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  analyzeUrl: (url, referer) => ipcRenderer.invoke('analyze-url', url, referer),
  startDownload: (data) => ipcRenderer.invoke('start-download', data),
  startAlbumDownload: (data) => ipcRenderer.invoke('start-album-download', data),
  pauseDownload: (id) => ipcRenderer.invoke('pause-download', id),
  resumeDownload: (id) => ipcRenderer.invoke('resume-download', id),
  cancelDownload: (id) => ipcRenderer.invoke('cancel-download', id),
  getHistory: () => ipcRenderer.invoke('get-history'),
  clearHistory: () => ipcRenderer.invoke('clear-history'),
  deleteHistoryItem: (id) => ipcRenderer.invoke('delete-history-item', id),
  openFileLocation: (filePath) => ipcRenderer.invoke('open-file-location', filePath),
  getDownloadDir: () => ipcRenderer.invoke('get-download-dir'),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  openFolderPicker: () => ipcRenderer.invoke('open-folder-picker'),
  openExtensionFolder: () => ipcRenderer.invoke('open-extension-folder'),
  checkServerStatus: () => ipcRenderer.invoke('check-server-status'),
  launchChromeExt: () => ipcRenderer.invoke('launch-chrome-ext'),
  copyExtensionPath: () => ipcRenderer.invoke('copy-extension-path'),
  createChromeShortcut: () => ipcRenderer.invoke('create-chrome-shortcut'),
  installChromeExtPolicy: () => ipcRenderer.invoke('install-chrome-ext-policy'),
  uninstallChromeExtPolicy: () => ipcRenderer.invoke('uninstall-chrome-ext-policy'),
  
  // Listeners
  onDownloadProgress: (callback) => ipcRenderer.on('download-progress', (event, data) => callback(data)),
  onDownloadComplete: (callback) => ipcRenderer.on('download-complete', (event, data) => callback(data)),
  onDownloadError: (callback) => ipcRenderer.on('download-error', (event, data) => callback(data)),
  onExternalLinkReceived: (callback) => ipcRenderer.on('external-link-received', (event, data) => callback(data))
});

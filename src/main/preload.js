const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  selectProjectFile: () => ipcRenderer.invoke('select-project-file'),
  getRecentProjects: () => ipcRenderer.invoke('get-recent-projects'),
  addToRecentProjects: (projectPath) => ipcRenderer.invoke('add-to-recent-projects', projectPath),
  checkDocker: () => ipcRenderer.invoke('check-docker'),
  readProjectFile: (path) => ipcRenderer.invoke('read-project-file', path),
  setupProject: (projectInfo) => ipcRenderer.invoke('setup-project', projectInfo),
  buildProject: (projectName) => ipcRenderer.invoke('build-project', projectName),
  cleanBuild: (projectName) => ipcRenderer.invoke('clean-build', projectName),
  extractBuild: (projectName) => ipcRenderer.invoke('extract-build', projectName),
  startTestServer: (outputPath) => ipcRenderer.invoke('start-test-server', outputPath),
  stopTestServer: () => ipcRenderer.invoke('stop-test-server'),
  openInVSCode: (folderPath) => ipcRenderer.invoke('open-in-vscode', folderPath),
  checkFolderExists: (folderPath) => ipcRenderer.invoke('check-folder-exists', folderPath),
  getLvConfFile: (projectName) => ipcRenderer.invoke('get-lv-conf-file', projectName),
  getLvConfTemplate: (lvglVersion) => ipcRenderer.invoke('get-lv-conf-template', lvglVersion),
  saveLvConf: (projectName, content) => ipcRenderer.invoke('save-lv-conf', projectName, content),
  loadSavedLvConf: (projectName) => ipcRenderer.invoke('load-saved-lv-conf', projectName),
  copyLvConfToDocker: (projectName, content) => ipcRenderer.invoke('copy-lv-conf-to-docker', projectName, content),
  
  // Event listeners
  onDockerOutput: (callback) => {
    ipcRenderer.on('docker-output', (event, data) => callback(data));
  },
  onLogMessage: (callback) => {
    ipcRenderer.on('log-message', (event, data) => callback(data));
  },
  onFileChanged: (callback) => {
    ipcRenderer.on('file-changed', (event, data) => callback(data));
  }
});

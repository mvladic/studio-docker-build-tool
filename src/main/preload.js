const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  selectProjectFile: () => ipcRenderer.invoke('select-project-file'),
  getRecentProjects: () => ipcRenderer.invoke('get-recent-projects'),
  addToRecentProjects: (projectPath) => ipcRenderer.invoke('add-to-recent-projects', projectPath),
  checkDocker: () => ipcRenderer.invoke('check-docker'),
  readProjectFile: (path) => ipcRenderer.invoke('read-project-file', path),
  setupProject: (projectInfo) => ipcRenderer.invoke('setup-project', projectInfo),
  buildProject: (projectInfo) => ipcRenderer.invoke('build-project', projectInfo),
  cleanBuild: () => ipcRenderer.invoke('clean-build'),
  extractBuild: () => ipcRenderer.invoke('extract-build'),
  startTestServer: (outputPath) => ipcRenderer.invoke('start-test-server', outputPath),
  stopTestServer: () => ipcRenderer.invoke('stop-test-server'),
  openInVSCode: (folderPath) => ipcRenderer.invoke('open-in-vscode', folderPath),
  checkFolderExists: (folderPath) => ipcRenderer.invoke('check-folder-exists', folderPath),
  
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

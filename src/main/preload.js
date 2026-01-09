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

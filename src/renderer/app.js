// Application State
let state = {
  projectPath: null,
  projectInfo: null,
  setupComplete: false,
  buildComplete: false,
  testRunning: false,
  operationRunning: false,
  outputPath: null,
  testUrl: null,
  showTimestamps: true,
  autoScroll: true,
  wordWrap: true,
  fileChangedSinceSetup: false,
  recentProjects: [],
  monacoEditor: null,
  monacoLoaded: false,
  lvConfOriginal: null,
  lvConfSaved: null,
  lvConfContent: null,
  lvConfModified: false,
  monacoDiffEditor: null,
  diffOriginalModel: null,
  diffModifiedModel: null,
  showingDiff: false,
  editorChangeDisposable: null
};

// DOM Elements
const elements = {
  projectPath: document.getElementById('projectPath'),
  btnSelectProject: document.getElementById('btnSelectProject'),
  btnPaste: document.getElementById('btnPaste'),
  btnRecentProjects: document.getElementById('btnRecentProjects'),
  recentProjectsMenu: document.getElementById('recentProjectsMenu'),
  projectInfo: document.getElementById('projectInfo'),
  infoLvglVersion: document.getElementById('infoLvglVersion'),
  infoFlowSupport: document.getElementById('infoFlowSupport'),
  infoProjectName: document.getElementById('infoProjectName'),
  btnOpenInVSCode: document.getElementById('btnOpenInVSCode'),
  
  setupStatus: document.getElementById('setupStatus'),
  buildStatus: document.getElementById('buildStatus'),
  testStatus: document.getElementById('testStatus'),
  
  btnSetup: document.getElementById('btnSetup'),
  btnBuild: document.getElementById('btnBuild'),
  btnRunRebuild: document.getElementById('btnRunRebuild'),
  btnTest: document.getElementById('btnTest'),
  btnStopTest: document.getElementById('btnStopTest'),
  btnRunAll: document.getElementById('btnRunAll'),
  
  tabLogs: document.getElementById('tabLogs'),
  tabLvConf: document.getElementById('tabLvConf'),
  tabPreview: document.getElementById('tabPreview'),
  tabContentLogs: document.getElementById('tabContentLogs'),
  tabContentLvConf: document.getElementById('tabContentLvConf'),
  tabContentPreview: document.getElementById('tabContentPreview'),
  lvConfContainer: document.getElementById('lvConfContainer'),
  lvConfModifiedIndicator: document.getElementById('lvConfModifiedIndicator'),
  btnShowDiff: document.getElementById('btnShowDiff'),
  btnSaveLvConf: document.getElementById('btnSaveLvConf'),
  btnRevertLvConf: document.getElementById('btnRevertLvConf'),
  btnCopyLvConf: document.getElementById('btnCopyLvConf'),
  btnRefreshLvConf: document.getElementById('btnRefreshLvConf'),
  
  fileChangeNotification: document.getElementById('fileChangeNotification'),
  btnRebuild: document.getElementById('btnRebuild'),
  btnDismiss: document.getElementById('btnDismiss'),
  
  logOutput: document.getElementById('logOutput'),
  logContainer: document.getElementById('logContainer'),
  logToolbar: document.querySelector('.log-toolbar'),
  logSearch: document.getElementById('logSearch'),
  btnCopyLog: document.getElementById('btnCopyLog'),
  btnClearLog: document.getElementById('btnClearLog'),
  btnToggleTimestamp: document.getElementById('btnToggleTimestamp'),
  btnToggleAutoscroll: document.getElementById('btnToggleAutoscroll'),
  btnToggleWrap: document.getElementById('btnToggleWrap'),
  
  testView: document.getElementById('testView'),
  testFrame: document.getElementById('testFrame'),
  testConsoleOutput: document.getElementById('testConsoleOutput')
};

// Load toggle button states from localStorage
function loadToggleStates() {
  const savedTimestamps = localStorage.getItem('showTimestamps');
  const savedAutoscroll = localStorage.getItem('autoScroll');
  const savedWordWrap = localStorage.getItem('wordWrap');
  
  if (savedTimestamps !== null) {
    state.showTimestamps = savedTimestamps === 'true';
  }
  if (savedAutoscroll !== null) {
    state.autoScroll = savedAutoscroll === 'true';
  }
  if (savedWordWrap !== null) {
    state.wordWrap = savedWordWrap === 'true';
  }
  
  // Apply states to UI
  elements.btnToggleTimestamp.classList.toggle('toggle-active', state.showTimestamps);
  elements.btnToggleAutoscroll.classList.toggle('toggle-active', state.autoScroll);
  elements.btnToggleWrap.classList.toggle('toggle-active', state.wordWrap);
  elements.logOutput.classList.toggle('no-wrap', !state.wordWrap);
}

// Initialize
async function init() {
  // Check Docker status
  await checkDockerStatus();
  
  // Load recent projects
  await loadRecentProjects();
  
  // Load toggle button states
  loadToggleStates();
  
  // Setup event listeners
  setupEventListeners();
  
  // Setup IPC listeners
  setupIPCListeners();
  
  // Setup splitter
  setupSplitter();
  
  // Setup test splitter
  setupTestSplitter();
  
  // Restore last project path
  const lastProjectPath = localStorage.getItem('lastProjectPath');
  if (lastProjectPath) {
    try {
      await loadProject(lastProjectPath);
    } catch (error) {
      logMessage('warning', `Could not restore last project: ${error.message}`);
    }
  }
  
  // Update UI
  updateUI();
}

// Check Docker status
async function checkDockerStatus() {
  const status = await window.electronAPI.checkDocker();
  
  if (!status.installed) {
    logMessage('error', 'Docker is not installed. Please install Docker Desktop from https://www.docker.com/products/docker-desktop');
    return;
  }
  
  if (!status.running) {
    logMessage('warning', 'Docker is not running. Please start Docker Desktop.');
    return;
  }
  
  logMessage('success', 'Docker is ready.');
}

// Load recent projects
async function loadRecentProjects() {
  const projects = await window.electronAPI.getRecentProjects();
  
  // Store projects for menu rendering
  state.recentProjects = projects;
}

// Setup event listeners
function setupEventListeners() {
  // Project selection
  elements.btnSelectProject.addEventListener('click', selectProjectFile);
  
  // Paste button
  elements.btnPaste.addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text && text.trim().endsWith('.eez-project')) {
        loadProject(text.trim());
      }
    } catch (err) {
      logMessage('error', 'Failed to read clipboard');
    }
  });
  
  // Check clipboard periodically to enable/disable paste button
  setInterval(async () => {
    // Always disable if operation is running or test is running
    if (state.operationRunning || state.testRunning) {
      elements.btnPaste.disabled = true;
      return;
    }
    
    try {
      const text = await navigator.clipboard.readText();
      elements.btnPaste.disabled = !text || text.trim().length === 0;
    } catch (err) {
      elements.btnPaste.disabled = true;
    }
  }, 500);
  
  // Recent projects button
  elements.btnRecentProjects.addEventListener('click', () => {
    toggleRecentProjectsMenu();
  });
  
  // Close menu when clicking outside
  document.addEventListener('click', (e) => {
    if (!elements.btnRecentProjects.contains(e.target) && 
        !elements.recentProjectsMenu.contains(e.target)) {
      elements.recentProjectsMenu.style.display = 'none';
    }
  });
  
  // Allow pasting path directly
  elements.projectPath.addEventListener('change', (e) => {
    const path = e.target.value.trim();
    if (path && path.endsWith('.eez-project') && path !== state.projectPath) {
      loadProject(path);
    }
  });
  
  elements.projectPath.addEventListener('blur', (e) => {
    const path = e.target.value.trim();
    if (path && path.endsWith('.eez-project') && path !== state.projectPath) {
      loadProject(path);
    }
  });
  
  // Action buttons
  elements.btnSetup.addEventListener('click', runSetup);
  elements.btnBuild.addEventListener('click', runBuild);
  elements.btnRunRebuild.addEventListener('click', runRebuild);
  elements.btnTest.addEventListener('click', runTest);
  elements.btnStopTest.addEventListener('click', stopTest);
  elements.btnRunAll.addEventListener('click', runAll);
  
  // Open in VS Code button
  elements.btnOpenInVSCode.addEventListener('click', openInVSCode);
  
  // Tab switching
  elements.tabLogs.addEventListener('click', () => switchTab('logs'));
  if (elements.tabLvConf) {
    elements.tabLvConf.addEventListener('click', () => switchTab('lvconf'));
  }
  elements.tabPreview.addEventListener('click', () => switchTab('preview'));
  
  // lv_conf.h toolbar
  if (elements.btnShowDiff) {
    elements.btnShowDiff.addEventListener('click', toggleDiffView);
  }
  if (elements.btnSaveLvConf) {
    elements.btnSaveLvConf.addEventListener('click', saveLvConfFile);
  }
  if (elements.btnRevertLvConf) {
    elements.btnRevertLvConf.addEventListener('click', revertLvConfFile);
  }
  if (elements.btnCopyLvConf) {
    elements.btnCopyLvConf.addEventListener('click', copyLvConfToClipboard);
  }
  if (elements.btnRefreshLvConf) {
    elements.btnRefreshLvConf.addEventListener('click', loadLvConfFile);
  }
  
  // File change notification
  elements.btnRebuild.addEventListener('click', async () => {
    // Stop test if running
    if (state.testRunning) {
      await stopTest();
    }
    
    elements.fileChangeNotification.style.display = 'none';
    state.fileChangedSinceSetup = false;
    
    // Run full sequence: Setup -> Build -> Test
    await runAll();
  });
  elements.btnDismiss.addEventListener('click', () => {
    elements.fileChangeNotification.style.display = 'none';
    state.fileChangedSinceSetup = false;
  });
  
  // Log toolbar
  elements.btnCopyLog.addEventListener('click', copyLogToClipboard);
  elements.btnClearLog.addEventListener('click', clearLog);
  elements.btnToggleTimestamp.addEventListener('click', toggleTimestamps);
  elements.btnToggleAutoscroll.addEventListener('click', toggleAutoscroll);
  elements.btnToggleWrap.addEventListener('click', toggleWordWrap);
  elements.logSearch.addEventListener('input', filterLogs);
}

// Setup IPC listeners
function setupIPCListeners() {
  // Docker output
  window.electronAPI.onDockerOutput((data) => {
    appendDockerOutput(data.text, data.type === 'stderr' ? 'warning' : 'info');
  });
  
  // Log messages
  window.electronAPI.onLogMessage((data) => {
    logMessage(data.type, data.text);
  });
  
  // Console messages from iframe (set up once globally)
  window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'console') {
      appendConsoleMessage(event.data.level, event.data.message);
    }
  });
  
  // File changed
  window.electronAPI.onFileChanged((data) => {
    // Check if it's the .eez-project file that changed
    if (data.path === state.projectPath) {
      logMessage('info', `Project file changed, reloading...`);
      const wasSetupComplete = state.setupComplete;
      // Automatically reload the project to detect LVGL version changes
      loadProject(state.projectPath);
      // If setup was complete before, show rebuild notification
      if (wasSetupComplete) {
        state.fileChangedSinceSetup = true;
        elements.fileChangeNotification.style.display = 'flex';
      }
      return;
    }
    
    // For src/ui files
    if (state.setupComplete && !state.fileChangedSinceSetup) {
      state.fileChangedSinceSetup = true;
      elements.fileChangeNotification.style.display = 'flex';
      logMessage('info', `File changed: ${data.path}`);
    }
  });
}

// Select project file
async function selectProjectFile() {
  const result = await window.electronAPI.selectProjectFile();
  
  if (result.success) {
    await loadProject(result.path);
    await loadRecentProjects();
  }
}

// Open src/ui folder in VS Code
async function openInVSCode() {
  if (!state.projectPath) return;
  
  const projectDir = state.projectPath.substring(0, state.projectPath.lastIndexOf('\\'));
  const srcUiPath = `${projectDir}\\src\\ui`;
  
  logMessage('info', `Opening ${srcUiPath} in VS Code...`);
  
  const result = await window.electronAPI.openInVSCode(srcUiPath);
  
  if (result.success) {
    logMessage('success', 'Opened in VS Code successfully.');
  } else {
    logMessage('error', `Failed to open in VS Code: ${result.error}`);
  }
}

// Check if src/ui folder exists and show/hide button
async function checkSrcUiFolderExists(folderPath) {
  const result = await window.electronAPI.checkFolderExists(folderPath);
  
  if (result.exists) {
    elements.btnOpenInVSCode.style.display = 'inline-block';
  } else {
    elements.btnOpenInVSCode.style.display = 'none';
  }
}

// Toggle recent projects menu
function toggleRecentProjectsMenu() {
  const menu = elements.recentProjectsMenu;
  
  if (menu.style.display === 'none' || !menu.style.display) {
    // Show menu
    renderRecentProjectsMenu();
    menu.style.display = 'block';
  } else {
    // Hide menu
    menu.style.display = 'none';
  }
}

// Render recent projects menu
function renderRecentProjectsMenu() {
  const menu = elements.recentProjectsMenu;
  menu.innerHTML = '';
  
  if (state.recentProjects.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'recent-menu-empty';
    empty.textContent = 'No recent projects';
    menu.appendChild(empty);
    return;
  }
  
  state.recentProjects.forEach(project => {
    const item = document.createElement('div');
    item.className = 'recent-menu-item';
    item.textContent = project;
    item.addEventListener('click', () => {
      loadProject(project);
      menu.style.display = 'none';
    });
    menu.appendChild(item);
  });
}

// Load project
async function loadProject(projectPath) {
  elements.projectPath.value = projectPath;
  
  // Check if it's a different project - if so, reset workflow state
  const isDifferentProject = state.projectPath && state.projectPath !== projectPath;
  
  state.projectPath = projectPath;
  
  // Save project path to localStorage
  localStorage.setItem('lastProjectPath', projectPath);
  
  logMessage('info', `Selected project file: ${projectPath}`);
  
  const result = await window.electronAPI.readProjectFile(projectPath);
  
  if (result.success) {
    state.projectInfo = result;
    
    // Add to recent projects
    await window.electronAPI.addToRecentProjects(projectPath);
    await loadRecentProjects();
    
    // Update project info display
    elements.infoLvglVersion.textContent = result.lvglVersion;
    elements.infoFlowSupport.textContent = result.flowSupport ? 'Yes' : 'No';
    elements.infoProjectName.textContent = result.projectName;
    elements.projectInfo.style.display = 'block';
    
    // Show VS Code button if src/ui folder exists
    const projectDir = projectPath.substring(0, projectPath.lastIndexOf('\\'));
    const srcUiPath = `${projectDir}\\src\\ui`;
    checkSrcUiFolderExists(srcUiPath);
    
    // Show lv_conf.h tab
    if (elements.tabLvConf) {
      elements.tabLvConf.style.display = 'inline-block';
    }
    
    // Reset lv_conf.h state for new project
    state.lvConfOriginal = null;
    state.lvConfSaved = null;
    state.lvConfContent = null;
    state.lvConfModified = false;
    state.showingDiff = false;
    updateLvConfUI();
    
    // Clear the container but don't clear the editor value yet
    if (elements.lvConfContainer && !state.monacoEditor) {
      elements.lvConfContainer.innerHTML = '';
    }
    
    // If currently viewing lv_conf.h tab, reload it immediately for new project
    if (elements.tabLvConf && elements.tabLvConf.classList.contains('active')) {
      loadLvConfFile();
    }
    
    logMessage('success', `Project loaded: ${result.projectName}`);
    
    // If switching to a different project, reset workflow state
    if (isDifferentProject) {
      logMessage('info', 'Different project selected - resetting workflow state.');
      
      // Stop test if running (check before resetting state)
      if (state.testRunning) {
        await stopTest();
      }
      
      state.setupComplete = false;
      state.buildComplete = false;
      state.testRunning = false;
      state.fileChangedSinceSetup = false;
      elements.fileChangeNotification.style.display = 'none';
      
      // Reset status indicators
      setStatus('setupStatus', 'pending', '');
      setStatus('buildStatus', 'pending', '');
      setStatus('testStatus', 'pending', '');
    } else {
      // Restore workflow state from build status (for initial load or same project)
      state.setupComplete = result.setupComplete || false;
      state.buildComplete = result.buildComplete || false;
      state.testRunning = false;
      state.fileChangedSinceSetup = false;
      elements.fileChangeNotification.style.display = 'none';
      
      // Update status indicators
      if (state.setupComplete) {
        setStatus('setupStatus', 'completed', '✓ Complete');
        logMessage('info', 'Previous setup detected.');
      }
      if (state.buildComplete) {
        setStatus('buildStatus', 'completed', '✓ Complete');
        logMessage('info', 'Previous build detected. Ready to test.');
      }
    }
    
    updateUI();
  } else {
    logMessage('error', `Failed to load project: ${result.error}`);
    state.projectInfo = null;
    elements.projectInfo.style.display = 'none';
    elements.btnOpenInVSCode.style.display = 'none';
    elements.tabLvConf.style.display = 'none';
    updateUI();
  }
}

// Run setup
async function runSetup() {
  if (!state.projectInfo) return;
  
  // Stop test if running
  if (state.testRunning) {
    await stopTest();
  }
  
  // Re-read project file to get latest settings (in case LVGL version changed)
  if (state.projectPath) {
    logMessage('info', 'Re-reading project file for latest settings...');
    const result = await window.electronAPI.readProjectFile(state.projectPath);
    
    if (result.success) {
      state.projectInfo = result;
      
      // Update project info display
      elements.infoLvglVersion.textContent = result.lvglVersion;
      elements.infoFlowSupport.textContent = result.flowSupport ? 'Yes' : 'No';
      elements.infoProjectName.textContent = result.projectName;
      
      logMessage('success', `Detected project: ${result.projectName} (LVGL ${result.lvglVersion})`);
    } else {
      logMessage('error', `Failed to read project: ${result.error}`);
      return;
    }
  }
  
  state.operationRunning = true;
  elements.btnSetup.disabled = true;
  setStatus('setupStatus', 'in-progress', 'Running...');
  updateUI();
  
  logMessage('info', '=== Starting Setup ===');
  
  const result = await window.electronAPI.setupProject({
    projectPath: state.projectPath,
    projectName: state.projectInfo.projectName,
    uiDir: state.projectInfo.uiDir,
    lvglVersion: state.projectInfo.lvglVersion,
    flowSupport: state.projectInfo.flowSupport
  });
  
  if (result.success) {
    state.setupComplete = true;
    state.buildComplete = false;
    state.testRunning = false;
    state.fileChangedSinceSetup = false;
    elements.fileChangeNotification.style.display = 'none';
    setStatus('setupStatus', 'completed', '✓ Complete');
    setStatus('buildStatus', 'pending', '');
    setStatus('testStatus', 'pending', '');
  } else {
    state.setupComplete = false;
    setStatus('setupStatus', 'error', '✗ Failed');
  }
  
  state.operationRunning = false;
  updateUI();
}

// Run build
async function runBuild() {
  if (!state.projectInfo || !state.setupComplete) return;
  
  // Stop test if running
  if (state.testRunning) {
    await stopTest();
  }
  
  state.operationRunning = true;
  elements.btnBuild.disabled = true;
  setStatus('buildStatus', 'in-progress', 'Building...');
  updateUI();
  
  logMessage('info', '=== Starting Build ===');
  
  const result = await window.electronAPI.buildProject(state.projectInfo.projectName);
  
  if (result.success) {
    state.buildComplete = true;
    state.testRunning = false;
    setStatus('buildStatus', 'completed', '✓ Complete');
    setStatus('testStatus', 'pending', '');
  } else {
    state.buildComplete = false;
    setStatus('buildStatus', 'error', '✗ Failed');
  }
  
  state.operationRunning = false;
  updateUI();
}

// Run rebuild (clean build directory and rebuild)
async function runRebuild() {
  if (!state.projectInfo || !state.setupComplete) return;
  
  // Stop test if running
  if (state.testRunning) {
    await stopTest();
  }
  
  state.operationRunning = true;
  elements.btnRunRebuild.disabled = true;
  setStatus('buildStatus', 'in-progress', 'Cleaning...');
  updateUI();
  
  logMessage('info', '=== Starting Rebuild ===');
  
  // Clean build directory
  logMessage('info', 'Cleaning build directory...');
  const cleanResult = await window.electronAPI.cleanBuild(state.projectInfo.projectName);
  
  if (!cleanResult.success) {
    logMessage('error', 'Failed to clean build directory');
    state.buildComplete = false;
    setStatus('buildStatus', 'error', '✗ Failed');
    state.operationRunning = false;
    elements.btnRunRebuild.disabled = false;
    updateUI();
    return;
  }
  
  // Run build
  await runBuild();
}

// Run all (Setup -> Build -> Test)
async function runAll() {
  if (!state.projectInfo) return;
  
  // Stop test if running
  if (state.testRunning) {
    await stopTest();
  }
  
  state.operationRunning = true;
  elements.btnRunAll.disabled = true;
  updateUI();
  
  const startTime = Date.now();
  logMessage('info', '=== Starting Run All (Setup -> Build -> Test) ===');
  
  // Step 1: Run Setup
  logMessage('info', 'Step 1/3: Running Setup...');
  elements.btnSetup.disabled = true;
  setStatus('setupStatus', 'in-progress', 'Running...');
  
  const setupResult = await window.electronAPI.setupProject(state.projectInfo);
  
  if (!setupResult.success) {
    logMessage('error', 'Setup failed - aborting Run All');
    state.setupComplete = false;
    setStatus('setupStatus', 'error', '✗ Failed');
    state.operationRunning = false;
    updateUI();
    return;
  }
  
  state.setupComplete = true;
  state.fileChangedSinceSetup = false;
  elements.fileChangeNotification.style.display = 'none';
  setStatus('setupStatus', 'completed', '✓ Complete');
  
  // Step 2: Run Build
  logMessage('info', 'Step 2/3: Running Build...');
  elements.btnBuild.disabled = true;
  setStatus('buildStatus', 'in-progress', 'Building...');
  
  const buildResult = await window.electronAPI.buildProject(state.projectInfo.projectName);
  
  if (!buildResult.success) {
    logMessage('error', 'Build failed - aborting Run All');
    state.buildComplete = false;
    setStatus('buildStatus', 'error', '✗ Failed');
    state.operationRunning = false;
    updateUI();
    return;
  }
  
  state.buildComplete = true;
  setStatus('buildStatus', 'completed', '✓ Complete');
  
  // Step 3: Run Test
  logMessage('info', 'Step 3/3: Starting Test...');
  elements.btnTest.disabled = true;
  setStatus('testStatus', 'in-progress', 'Extracting...');
  
  const extractResult = await window.electronAPI.extractBuild(state.projectInfo.projectName);
  
  if (!extractResult.success) {
    logMessage('error', 'Extract failed - aborting Run All');
    setStatus('testStatus', 'error', '✗ Failed');
    state.operationRunning = false;
    updateUI();
    return;
  }
  
  state.outputPath = extractResult.outputPath;
  
  setStatus('testStatus', 'in-progress', 'Starting server...');
  const serverResult = await window.electronAPI.startTestServer(state.outputPath);
  
  if (!serverResult.success) {
    logMessage('error', 'Server start failed - aborting Run All');
    setStatus('testStatus', 'error', '✗ Failed');
    state.operationRunning = false;
    updateUI();
    return;
  }
  
  state.testUrl = serverResult.url;
  state.testRunning = true;
  setStatus('testStatus', 'running', '▶ Running');
  
  // Show test view and Preview tab
  elements.testView.style.display = 'flex';
  elements.tabPreview.style.display = 'inline-block';
  switchTab('preview');
  
  // Clear console output
  elements.testConsoleOutput.innerHTML = '';
  
  // Force cache-busting reload
  elements.testFrame.src = 'about:blank';
  setTimeout(() => {
    elements.testFrame.src = `${state.testUrl}?t=${Date.now()}`;
  }, 100);
  
  elements.btnTest.style.display = 'none';
  elements.btnStopTest.style.display = 'inline-block';
  
  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  logMessage('success', `=== Run All completed successfully in ${duration}s! ===`);
  
  state.operationRunning = false;
  updateUI();
}

// Run test
async function runTest() {
  if (!state.projectInfo || !state.buildComplete) return;
  
  state.operationRunning = true;
  elements.btnTest.disabled = true;
  setStatus('testStatus', 'in-progress', 'Extracting...');
  updateUI();
  
  logMessage('info', '=== Starting Test ===');
  
  // Extract build files
  const extractResult = await window.electronAPI.extractBuild(state.projectInfo.projectName);
  
  if (!extractResult.success) {
    setStatus('testStatus', 'error', '✗ Failed');
    state.operationRunning = false;
    elements.btnTest.disabled = false;
    updateUI();
    return;
  }
  
  state.outputPath = extractResult.outputPath;
  
  // Start test server
  setStatus('testStatus', 'in-progress', 'Starting server...');
  const serverResult = await window.electronAPI.startTestServer(state.outputPath);
  
  if (serverResult.success) {
    state.testRunning = true;
    state.testUrl = serverResult.url;
    setStatus('testStatus', 'completed', '✓ Running');
    
    // Show test view and Preview tab
    elements.testView.style.display = 'flex';
    elements.tabPreview.style.display = 'inline-block';
    switchTab('preview');
    
    // Clear console output
    elements.testConsoleOutput.innerHTML = '';
    
    // Force cache-busting reload by clearing iframe and adding timestamp
    elements.testFrame.src = 'about:blank';
    setTimeout(() => {
      elements.testFrame.src = serverResult.url + '?t=' + Date.now();
    }, 100);
    
    elements.btnTest.style.display = 'none';
    elements.btnStopTest.style.display = 'inline-block';
  } else {
    setStatus('testStatus', 'error', '✗ Failed');
  }
  
  state.operationRunning = false;
  updateUI();
}

// Stop test
async function stopTest() {
  await window.electronAPI.stopTestServer();
  
  state.testRunning = false;
  state.testUrl = null;
  setStatus('testStatus', 'pending', '');
  
  // Hide test view and Preview tab
  elements.testView.style.display = 'none';
  elements.tabPreview.style.display = 'none';
  switchTab('logs');
  
  elements.btnStopTest.style.display = 'none';
  elements.btnTest.style.display = 'inline-block';
  
  logMessage('info', 'Test server stopped.');
  
  updateUI();
}

// Append console message
function appendConsoleMessage(level, message) {
  const line = document.createElement('div');
  line.className = `console-line ${level}`;
  line.textContent = `[${level.toUpperCase()}] ${message}`;
  elements.testConsoleOutput.appendChild(line);
  elements.testConsoleOutput.scrollTop = elements.testConsoleOutput.scrollHeight;
}

// Switch between tabs
function switchTab(tabName) {
  if (tabName === 'logs') {
    elements.tabLogs.classList.add('active');
    if (elements.tabLvConf) elements.tabLvConf.classList.remove('active');
    elements.tabPreview.classList.remove('active');
    elements.tabContentLogs.classList.add('active');
    elements.tabContentLogs.style.display = '';
    if (elements.tabContentLvConf) {
      elements.tabContentLvConf.classList.remove('active');
      elements.tabContentLvConf.style.display = 'none';
    }
    elements.tabContentPreview.classList.remove('active');
    elements.tabContentPreview.style.display = 'none';
  } else if (tabName === 'lvconf') {
    elements.tabLogs.classList.remove('active');
    if (elements.tabLvConf) elements.tabLvConf.classList.add('active');
    elements.tabPreview.classList.remove('active');
    elements.tabContentLogs.classList.remove('active');
    elements.tabContentLogs.style.display = 'none';
    if (elements.tabContentLvConf) {
      elements.tabContentLvConf.classList.add('active');
      elements.tabContentLvConf.style.display = '';
      // Load lv_conf.h if not already loaded (check if original content is null)
      if (!state.lvConfOriginal || !state.monacoEditor) {
        loadLvConfFile();
      } else if (state.monacoEditor) {
        // Trigger layout update when tab becomes visible
        setTimeout(() => state.monacoEditor.layout(), 0);
      }
    }
    elements.tabContentPreview.classList.remove('active');
    elements.tabContentPreview.style.display = 'none';
  } else if (tabName === 'preview') {
    elements.tabLogs.classList.remove('active');
    if (elements.tabLvConf) elements.tabLvConf.classList.remove('active');
    elements.tabPreview.classList.add('active');
    elements.tabContentLogs.classList.remove('active');
    elements.tabContentLogs.style.display = 'none';
    if (elements.tabContentLvConf) {
      elements.tabContentLvConf.classList.remove('active');
      elements.tabContentLvConf.style.display = 'none';
    }
    elements.tabContentPreview.classList.add('active');
    elements.tabContentPreview.style.display = '';
  }
}

// Update UI state
function updateUI() {
  // Disable all buttons if any operation is running
  if (state.operationRunning) {
    elements.projectPath.disabled = true;
    elements.btnSelectProject.disabled = true;
    elements.btnPaste.disabled = true;
    elements.btnRecentProjects.disabled = true;
    elements.btnSetup.disabled = true;
    elements.btnBuild.disabled = true;
    elements.btnRunRebuild.disabled = true;
    elements.btnTest.disabled = true;
    elements.btnRunAll.disabled = true;
    return;
  }
  
  // Disable all buttons if test is running (except Stop Test which is shown instead)
  if (state.testRunning) {
    elements.projectPath.disabled = true;
    elements.btnSelectProject.disabled = true;
    elements.btnPaste.disabled = true;
    elements.btnRecentProjects.disabled = true;
    elements.btnSetup.disabled = true;
    elements.btnBuild.disabled = true;
    elements.btnRunRebuild.disabled = true;
    elements.btnTest.disabled = true;
    elements.btnRunAll.disabled = true;
    return;
  }
  
  // Enable/disable buttons based on state
  elements.projectPath.disabled = false;
  elements.btnSelectProject.disabled = false;
  elements.btnRecentProjects.disabled = false;
  // btnPaste is controlled by clipboard check interval
  elements.btnSetup.disabled = !state.projectInfo;
  elements.btnBuild.disabled = !state.setupComplete;
  elements.btnRunRebuild.disabled = !state.setupComplete;
  elements.btnTest.disabled = !state.buildComplete || state.testRunning;
  elements.btnRunAll.disabled = !state.projectInfo;
  
  // Update status badges
  if (!state.projectInfo) {
    setStatus('setupStatus', 'pending', '');
    setStatus('buildStatus', 'pending', '');
    setStatus('testStatus', 'pending', '');
  }
}

// Set status badge
function setStatus(elementId, status, text) {
  const element = document.getElementById(elementId);
  element.className = `status-badge ${status}`;
  element.textContent = text;
  
  // Hide badge if no text
  if (!text) {
    element.style.display = 'none';
  } else {
    element.style.display = 'inline-block';
  }
}

// Log message
function logMessage(type, text) {
  const timestamp = new Date().toLocaleTimeString();
  const line = document.createElement('div');
  line.className = `log-line ${type}`;
  line.dataset.timestamp = timestamp;
  
  const timestampSpan = document.createElement('span');
  timestampSpan.className = 'log-timestamp';
  timestampSpan.textContent = `[${timestamp}]`;
  timestampSpan.style.display = state.showTimestamps ? 'inline' : 'none';
  
  const textNode = document.createTextNode(' ' + text);
  
  line.appendChild(timestampSpan);
  line.appendChild(textNode);
  
  elements.logOutput.appendChild(line);
  
  if (state.autoScroll) {
    elements.logContainer.scrollTop = elements.logContainer.scrollHeight;
  }
}

// Append Docker output
function appendDockerOutput(text, type = 'info') {
  const lines = text.split('\n');
  lines.forEach(line => {
    if (line.trim()) {
      logMessage(type, line);
    }
  });
}

// Copy log to clipboard
function copyLogToClipboard() {
  const logText = elements.logOutput.innerText;
  navigator.clipboard.writeText(logText).then(() => {
    // Visual feedback
    const originalText = elements.btnCopyLog.textContent;
    elements.btnCopyLog.textContent = '✓';
    setTimeout(() => {
      elements.btnCopyLog.textContent = originalText;
    }, 1000);
  }).catch(err => {
    console.error('Failed to copy log:', err);
    alert('Failed to copy log to clipboard');
  });
}

// Clear log
function clearLog() {
  elements.logOutput.innerHTML = '';
}

// Initialize Monaco Editor
function initMonacoEditor() {
  return new Promise((resolve) => {
    if (state.monacoLoaded) {
      resolve();
      return;
    }
    
    require.config({ paths: { vs: 'https://unpkg.com/monaco-editor@0.45.0/min/vs' } });
    require(['vs/editor/editor.main'], function () {
      state.monacoLoaded = true;
      resolve();
    });
  });
}

// Load lv_conf.h file
async function loadLvConfFile() {
  if (!state.projectInfo) return;
  
  // Show loading message
  if (elements.lvConfContainer) {
    elements.lvConfContainer.innerHTML = '<div style="color: #888; padding: 20px; font-family: monospace;">Loading lv_conf.h...</div>';
  }
  
  // Initialize Monaco if not already done
  await initMonacoEditor();
  
  // Always load from GitHub first (this is the "original" for comparison)
  const githubResult = await window.electronAPI.getLvConfFile(state.projectInfo.projectName);
  if (!githubResult.success) {
    elements.lvConfContainer.innerHTML = `<div style="color: #f48771; padding: 20px; font-family: monospace;">Error: ${githubResult.error}</div>`;
    return;
  }
  
  // Store GitHub version as original (for diff comparison)
  state.lvConfOriginal = githubResult.content;
  
  // Try to load saved version
  const savedResult = await window.electronAPI.loadSavedLvConf(state.projectInfo.projectName);
  
  let content = '';
  let isSaved = false;
  
  if (savedResult.success && savedResult.content && savedResult.content.trim().length > 0) {
    content = savedResult.content;
    state.lvConfSaved = savedResult.content;
    state.lvConfContent = savedResult.content;
    isSaved = true;
  } else {
    content = githubResult.content;
    state.lvConfSaved = githubResult.content;
    state.lvConfContent = githubResult.content;
  }
  
  // Clear container
  elements.lvConfContainer.innerHTML = '';
  
  // Create or update Monaco editor
  if (!state.monacoEditor) {
    state.monacoEditor = monaco.editor.create(elements.lvConfContainer, {
      value: content,
      language: 'c',
      theme: 'vs-dark',
      readOnly: false,
      automaticLayout: true,
      minimap: { enabled: true },
      scrollBeyondLastLine: false,
      fontSize: 13,
      lineNumbers: 'on',
      renderWhitespace: 'selection',
      wordWrap: 'off'
    });
  } else {
    // Dispose and recreate the editor to ensure it displays correctly
    state.monacoEditor.dispose();
    state.monacoEditor = monaco.editor.create(elements.lvConfContainer, {
      value: content,
      language: 'c',
      theme: 'vs-dark',
      readOnly: false,
      automaticLayout: true,
      minimap: { enabled: true },
      scrollBeyondLastLine: false,
      fontSize: 13,
      lineNumbers: 'on',
      renderWhitespace: 'selection',
      wordWrap: 'off'
    });
  }
  
  // Dispose previous listener if exists
  if (state.editorChangeDisposable) {
    state.editorChangeDisposable.dispose();
    state.editorChangeDisposable = null;
  }
  
  // Check if modified (compare current content to GitHub original)
  checkLvConfModified();
  
  // Listen for content changes - attach immediately
  state.editorChangeDisposable = state.monacoEditor.onDidChangeModelContent(() => {
    checkLvConfModified();
  });
}

// Check if lv_conf.h is modified
function checkLvConfModified() {
  if (!state.lvConfOriginal) return;
  
  // Get current content from editor (regular or diff)
  let currentContent = null;
  if (state.monacoEditor) {
    currentContent = state.monacoEditor.getValue();
  } else if (state.monacoDiffEditor) {
    currentContent = state.monacoDiffEditor.getModifiedEditor().getValue();
  }
  
  if (currentContent === null) return;
  
  // Store current content for UI updates
  state.lvConfContent = currentContent;
  
  // Modified means different from saved version (for Save button)
  state.lvConfModified = currentContent !== state.lvConfSaved;
  updateLvConfUI();
}

// Update lv_conf.h UI elements
function updateLvConfUI() {
  // Check if different from GitHub (for diff button and indicator)
  const isDifferentFromGitHub = state.lvConfContent !== null && state.lvConfOriginal !== null && 
    state.lvConfContent !== state.lvConfOriginal;
  
  if (elements.lvConfModifiedIndicator) {
    elements.lvConfModifiedIndicator.style.display = isDifferentFromGitHub ? 'inline' : 'none';
  }
  if (elements.btnShowDiff) {
    elements.btnShowDiff.style.display = isDifferentFromGitHub ? 'inline-block' : 'none';
    elements.btnShowDiff.textContent = state.showingDiff ? '📝 Edit' : '🔍 Show Diff';
  }
  if (elements.btnSaveLvConf) {
    elements.btnSaveLvConf.style.display = state.lvConfModified && !state.showingDiff ? 'inline-block' : 'none';
  }
  if (elements.btnRevertLvConf) {
    // Show revert button when different from GitHub (to allow reverting to original)
    elements.btnRevertLvConf.style.display = isDifferentFromGitHub ? 'inline-block' : 'none';
  }
}

// Save lv_conf.h
async function saveLvConfFile() {
  if (!state.monacoEditor || !state.projectInfo) return;
  
  const content = state.monacoEditor.getValue();
  const result = await window.electronAPI.saveLvConf(state.projectInfo.projectName, content);
  
  if (result.success) {
    logMessage('success', 'lv_conf.h saved successfully');
    
    // Update the saved version (but keep GitHub original for diff)
    state.lvConfSaved = content;
    state.lvConfContent = content;
    state.lvConfModified = false;
    updateLvConfUI();
    
    // Visual feedback
    const originalText = elements.btnSaveLvConf.textContent;
    elements.btnSaveLvConf.textContent = '✓ Saved';
    setTimeout(() => {
      elements.btnSaveLvConf.textContent = originalText;
    }, 1500);
  } else {
    logMessage('error', `Failed to save lv_conf.h: ${result.error}`);
  }
}

// Toggle between diff view and edit view
function toggleDiffView() {
  if (!state.lvConfOriginal) return;
  
  state.showingDiff = !state.showingDiff;
  
  if (state.showingDiff) {
    // Switch to diff view
    if (!state.monacoEditor) {
      console.error('Cannot show diff: monacoEditor is null');
      state.showingDiff = false;
      return;
    }
    
    const modifiedContent = state.monacoEditor.getValue();
    state.lvConfContent = modifiedContent;
    
    // Save scroll position and cursor position
    const scrollTop = state.monacoEditor.getScrollTop();
    const scrollLeft = state.monacoEditor.getScrollLeft();
    const cursorPosition = state.monacoEditor.getPosition();
    
    // Dispose listener first
    if (state.editorChangeDisposable) {
      state.editorChangeDisposable.dispose();
      state.editorChangeDisposable = null;
    }
    
    // Dispose regular editor
    state.monacoEditor.dispose();
    state.monacoEditor = null;
    
    // Replace container with a fresh one to avoid any lingering event handlers
    const parent = elements.lvConfContainer.parentNode;
    const newContainer = document.createElement('div');
    newContainer.id = 'lvConfContainer';
    newContainer.className = 'monaco-container';
    parent.replaceChild(newContainer, elements.lvConfContainer);
    elements.lvConfContainer = newContainer;
    
    // Create diff editor
    state.monacoDiffEditor = monaco.editor.createDiffEditor(elements.lvConfContainer, {
      theme: 'vs-dark',
      readOnly: true,
      automaticLayout: true,
      minimap: { enabled: true },
      scrollBeyondLastLine: false,
      fontSize: 13,
      lineNumbers: 'on',
      renderSideBySide: true,
      renderWhitespace: 'selection'
    });
    
    // Create models and store references for later disposal
    const originalModel = monaco.editor.createModel(state.lvConfOriginal, 'c');
    const modifiedModel = monaco.editor.createModel(modifiedContent, 'c');
    
    // Set original (left) and modified (right) models
    state.monacoDiffEditor.setModel({
      original: originalModel,
      modified: modifiedModel
    });
    
    // Store models for disposal
    state.diffOriginalModel = originalModel;
    state.diffModifiedModel = modifiedModel;
    
    // Restore scroll position on the modified (right) editor
    setTimeout(() => {
      const modifiedEditor = state.monacoDiffEditor.getModifiedEditor();
      modifiedEditor.setScrollTop(scrollTop);
      modifiedEditor.setScrollLeft(scrollLeft);
      if (cursorPosition) {
        modifiedEditor.setPosition(cursorPosition);
      }
    }, 100);
    
  } else {
    // Switch back to edit view
    if (!state.monacoDiffEditor) {
      console.error('Cannot switch to edit: monacoDiffEditor is null');
      state.showingDiff = true;
      return;
    }
    
    const modifiedEditor = state.monacoDiffEditor.getModifiedEditor();
    const modifiedContent = modifiedEditor.getValue();
    state.lvConfContent = modifiedContent;
    
    // Save scroll position and cursor position from the modified (right) editor
    const scrollTop = modifiedEditor.getScrollTop();
    const scrollLeft = modifiedEditor.getScrollLeft();
    const cursorPosition = modifiedEditor.getPosition();
    
    // Dispose diff models first
    if (state.diffOriginalModel) {
      state.diffOriginalModel.dispose();
      state.diffOriginalModel = null;
    }
    if (state.diffModifiedModel) {
      state.diffModifiedModel.dispose();
      state.diffModifiedModel = null;
    }
    
    // Dispose diff editor
    state.monacoDiffEditor.dispose();
    state.monacoDiffEditor = null;
    
    // Replace container with a fresh one to avoid any lingering event handlers
    const parent = elements.lvConfContainer.parentNode;
    const newContainer = document.createElement('div');
    newContainer.id = 'lvConfContainer';
    newContainer.className = 'monaco-container';
    parent.replaceChild(newContainer, elements.lvConfContainer);
    elements.lvConfContainer = newContainer;
    
    // Recreate regular editor
    state.monacoEditor = monaco.editor.create(elements.lvConfContainer, {
      value: modifiedContent,
      language: 'c',
      theme: 'vs-dark',
      readOnly: false,
      automaticLayout: true,
      minimap: { enabled: true },
      scrollBeyondLastLine: false,
      fontSize: 13,
      lineNumbers: 'on',
      renderWhitespace: 'selection',
      wordWrap: 'off'
    });
    
    // Dispose previous listener if exists
    if (state.editorChangeDisposable) {
      state.editorChangeDisposable.dispose();
      state.editorChangeDisposable = null;
    }
    
    // Attach content change listener immediately
    state.editorChangeDisposable = state.monacoEditor.onDidChangeModelContent(() => {
      checkLvConfModified();
    });
    
    // Restore scroll position and cursor position after a short delay
    setTimeout(() => {
      if (state.monacoEditor) {
        state.monacoEditor.setScrollTop(scrollTop);
        state.monacoEditor.setScrollLeft(scrollLeft);
        if (cursorPosition) {
          state.monacoEditor.setPosition(cursorPosition);
        }
        state.monacoEditor.focus();
      }
    }, 50);
  }
  
  updateLvConfUI();
}

// Revert lv_conf.h to GitHub version
async function revertLvConfFile() {
  if (!state.lvConfOriginal) return;
  
  const confirmed = confirm('Are you sure you want to discard all changes and revert to the GitHub version?');
  if (!confirmed) return;
  
  // Delete saved file by saving empty content (which will be ignored on load)
  if (state.projectInfo) {
    await window.electronAPI.saveLvConf(state.projectInfo.projectName, '');
  }
  
  // If in diff view, switch back to edit view first
  if (state.showingDiff) {
    state.showingDiff = false;
    
    // Dispose diff models
    if (state.diffOriginalModel) {
      state.diffOriginalModel.dispose();
      state.diffOriginalModel = null;
    }
    if (state.diffModifiedModel) {
      state.diffModifiedModel.dispose();
      state.diffModifiedModel = null;
    }
    
    // Dispose diff editor
    if (state.monacoDiffEditor) {
      state.monacoDiffEditor.dispose();
      state.monacoDiffEditor = null;
    }
    
    // Clear container
    elements.lvConfContainer.innerHTML = '';
    
    // Recreate regular editor with original content
    state.monacoEditor = monaco.editor.create(elements.lvConfContainer, {
      value: state.lvConfOriginal,
      language: 'c',
      theme: 'vs-dark',
      readOnly: false,
      automaticLayout: true,
      minimap: { enabled: true },
      scrollBeyondLastLine: false,
      fontSize: 13,
      lineNumbers: 'on',
      renderWhitespace: 'selection',
      wordWrap: 'off'
    });
    
    // Dispose previous listener if exists
    if (state.editorChangeDisposable) {
      state.editorChangeDisposable.dispose();
      state.editorChangeDisposable = null;
    }
    
    // Listen for content changes
    state.editorChangeDisposable = state.monacoEditor.onDidChangeModelContent(() => {
      checkLvConfModified();
    });
  } else if (state.monacoEditor) {
    // Just set the value to original
    state.monacoEditor.setValue(state.lvConfOriginal);
  }
  
  // Reset saved state to original
  state.lvConfSaved = state.lvConfOriginal;
  state.lvConfContent = state.lvConfOriginal;
  state.lvConfModified = false;
  updateLvConfUI();
  logMessage('info', 'All changes discarded - reverted to GitHub version');
}

// Copy lv_conf.h to clipboard
function copyLvConfToClipboard() {
  let codeText = '';
  
  if (state.monacoEditor) {
    codeText = state.monacoEditor.getValue();
  }
  
  if (!codeText) {
    alert('No content to copy');
    return;
  }
  
  navigator.clipboard.writeText(codeText).then(() => {
    // Visual feedback
    const originalText = elements.btnCopyLvConf.textContent;
    elements.btnCopyLvConf.textContent = '✓';
    setTimeout(() => {
      elements.btnCopyLvConf.textContent = originalText;
    }, 1000);
  }).catch(err => {
    console.error('Failed to copy code:', err);
    alert('Failed to copy to clipboard');
  });
}

// Highlight C code with line numbers
// Toggle timestamps
function toggleTimestamps() {
  state.showTimestamps = !state.showTimestamps;
  localStorage.setItem('showTimestamps', state.showTimestamps);
  elements.btnToggleTimestamp.classList.toggle('toggle-active', state.showTimestamps);
  
  const timestamps = elements.logOutput.querySelectorAll('.log-timestamp');
  timestamps.forEach(ts => {
    ts.style.display = state.showTimestamps ? 'inline' : 'none';
  });
}

// Toggle autoscroll
function toggleAutoscroll() {
  state.autoScroll = !state.autoScroll;
  localStorage.setItem('autoScroll', state.autoScroll);
  elements.btnToggleAutoscroll.classList.toggle('toggle-active', state.autoScroll);
}

// Toggle word wrap
function toggleWordWrap() {
  state.wordWrap = !state.wordWrap;
  localStorage.setItem('wordWrap', state.wordWrap);
  elements.btnToggleWrap.classList.toggle('toggle-active', state.wordWrap);
  elements.logOutput.classList.toggle('no-wrap', !state.wordWrap);
}

// Filter logs
function filterLogs() {
  const searchTerm = elements.logSearch.value.toLowerCase();
  const lines = elements.logOutput.querySelectorAll('.log-line');
  
  lines.forEach(line => {
    const text = line.textContent.toLowerCase();
    line.style.display = text.includes(searchTerm) ? 'block' : 'none';
  });
}

// Setup splitter for main panels
function setupSplitter() {
  const splitter = document.getElementById('splitter');
  const leftPanel = document.querySelector('.left-panel');
  const iframe = document.getElementById('testFrame');
  let isResizing = false;
  
  // Restore saved splitter position
  const savedWidth = localStorage.getItem('splitterWidth');
  if (savedWidth) {
    leftPanel.style.width = savedWidth + 'px';
  }
  
  splitter.addEventListener('mousedown', (e) => {
    isResizing = true;
    document.body.style.cursor = 'col-resize';
    if (iframe) {
      iframe.style.pointerEvents = 'none';
    }
    e.preventDefault();
  });
  
  document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;
    
    const newWidth = e.clientX;
    if (newWidth >= 100 && newWidth <= 800) {
      leftPanel.style.width = newWidth + 'px';
    }
  });
  
  document.addEventListener('mouseup', () => {
    if (isResizing) {
      isResizing = false;
      document.body.style.cursor = 'default';
      if (iframe) {
        iframe.style.pointerEvents = 'auto';
      }
      // Save splitter position
      const width = parseInt(leftPanel.style.width);
      if (!isNaN(width)) {
        localStorage.setItem('splitterWidth', width);
      }
    }
  });
}

// Setup splitter for test view
function setupTestSplitter() {
  const splitter = document.getElementById('testSplitter');
  const preview = document.querySelector('.test-preview');
  const testConsole = document.querySelector('.test-console');
  const iframe = document.getElementById('testFrame');
  let isResizing = false;
  
  splitter.addEventListener('mousedown', (e) => {
    isResizing = true;
    document.body.style.cursor = 'row-resize';
    if (iframe) {
      iframe.style.pointerEvents = 'none';
    }
    e.preventDefault();
  });
  
  document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;
    
    const container = document.querySelector('.test-splitter-container');
    const containerRect = container.getBoundingClientRect();
    const newPreviewHeight = e.clientY - containerRect.top;
    const newConsoleHeight = containerRect.height - newPreviewHeight - 5;
    
    if (newPreviewHeight >= 50 && newConsoleHeight >= 50) {
      preview.style.flex = 'none';
      preview.style.height = newPreviewHeight + 'px';
      testConsole.style.height = newConsoleHeight + 'px';
    }
  });
  
  document.addEventListener('mouseup', () => {
    if (isResizing) {
      isResizing = false;
      document.body.style.cursor = 'default';
      if (iframe) {
        iframe.style.pointerEvents = 'auto';
      }
    }
  });
}

// Start application
init();

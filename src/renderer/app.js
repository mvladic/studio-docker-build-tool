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
  recentProjects: []
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
  tabPreview: document.getElementById('tabPreview'),
  tabContentLogs: document.getElementById('tabContentLogs'),
  tabContentPreview: document.getElementById('tabContentPreview'),
  
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
elements.btnRecentProjects.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleRecentProjectsMenu();
  });
  
  // Keyboard navigation for combobox
  elements.projectPath.addEventListener('keydown', handleComboboxKeydown);
  
  // Open dropdown on input focus (optional - click on input)
  elements.projectPath.addEventListener('click', () => {
    if (!comboboxState.isOpen && state.recentProjects.length > 0) {
      openCombobox();
    }
  });

  // Close menu when clicking outside
  document.addEventListener('click', (e) => {
    const container = elements.projectPath.closest('.combobox-container');
    if (!container.contains(e.target)) {
      closeCombobox();
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
  elements.tabPreview.addEventListener('click', () => switchTab('preview'));
  
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
    // Filter out debug messages
    if (data.text && data.text.trim().toLowerCase().startsWith('debug:')) {
      return;
    }
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
    
    // For build destination files
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

// ComboBox state
let comboboxState = {
  highlightedIndex: -1,
  isOpen: false
};

// Open combobox dropdown
function openCombobox() {
  const menu = elements.recentProjectsMenu;
  const wrapper = elements.projectPath.closest('.combobox-input-wrapper');
  
  renderRecentProjectsMenu();
  menu.style.display = 'block';
  wrapper.classList.add('dropdown-open');
  comboboxState.isOpen = true;
  comboboxState.highlightedIndex = -1;
  
  // Scroll selected item into view
  const selectedItem = menu.querySelector('.combobox-item.selected');
  if (selectedItem) {
    selectedItem.scrollIntoView({ block: 'nearest' });
  }
}

// Close combobox dropdown
function closeCombobox() {
  const menu = elements.recentProjectsMenu;
  const wrapper = elements.projectPath.closest('.combobox-input-wrapper');
  
  menu.style.display = 'none';
  wrapper.classList.remove('dropdown-open');
  comboboxState.isOpen = false;
  comboboxState.highlightedIndex = -1;
}

// Toggle combobox dropdown
function toggleRecentProjectsMenu() {
  if (comboboxState.isOpen) {
    closeCombobox();
  } else {
    openCombobox();
  }
}

// Update highlighted item in combobox
function updateComboboxHighlight(index) {
  const menu = elements.recentProjectsMenu;
  const items = menu.querySelectorAll('.combobox-item');
  
  items.forEach((item, i) => {
    item.classList.toggle('highlighted', i === index);
  });
  
  comboboxState.highlightedIndex = index;
  
  // Scroll highlighted item into view
  if (index >= 0 && index < items.length) {
    items[index].scrollIntoView({ block: 'nearest' });
  }
}

// Handle combobox keyboard navigation
function handleComboboxKeydown(e) {
  const menu = elements.recentProjectsMenu;
  const items = menu.querySelectorAll('.combobox-item');
  const itemCount = items.length;
  
  if (!comboboxState.isOpen) {
    // Open on arrow down or enter when closed
    if (e.key === 'ArrowDown' || e.key === 'Enter') {
      e.preventDefault();
      openCombobox();
    }
    return;
  }
  
  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault();
      if (comboboxState.highlightedIndex < itemCount - 1) {
        updateComboboxHighlight(comboboxState.highlightedIndex + 1);
      } else {
        updateComboboxHighlight(0); // Wrap to top
      }
      break;
      
    case 'ArrowUp':
      e.preventDefault();
      if (comboboxState.highlightedIndex > 0) {
        updateComboboxHighlight(comboboxState.highlightedIndex - 1);
      } else {
        updateComboboxHighlight(itemCount - 1); // Wrap to bottom
      }
      break;
      
    case 'Enter':
      e.preventDefault();
      if (comboboxState.highlightedIndex >= 0 && comboboxState.highlightedIndex < itemCount) {
        const selectedProject = state.recentProjects[comboboxState.highlightedIndex];
        closeCombobox();
        loadProject(selectedProject);
      } else if (elements.projectPath.value.trim()) {
        // Load typed path
        closeCombobox();
        loadProject(elements.projectPath.value.trim());
      }
      break;
      
    case 'Escape':
      e.preventDefault();
      closeCombobox();
      break;
      
    case 'Tab':
      closeCombobox();
      break;
  }
}

// Render recent projects menu
function renderRecentProjectsMenu() {
  const menu = elements.recentProjectsMenu;
  const currentPath = state.projectPath;
  menu.innerHTML = '';
  
  if (state.recentProjects.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'combobox-empty';
    empty.textContent = 'No recent projects';
    menu.appendChild(empty);
    return;
  }
  
  state.recentProjects.forEach((project, index) => {
    const item = document.createElement('div');
    item.className = 'combobox-item';
    
    // Mark current project as selected
    if (project === currentPath) {
      item.classList.add('selected');
    }
    
    // Create text span for the project path
    const textSpan = document.createElement('span');
    textSpan.textContent = project;
    item.appendChild(textSpan);
    
    item.addEventListener('click', () => {
      closeCombobox();
      loadProject(project);
    });
    
    item.addEventListener('mouseenter', () => {
      updateComboboxHighlight(index);
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
    elements.projectInfo.style.display = 'block';
    
    // Show VS Code button if src/ui folder exists
    const projectDir = projectPath.substring(0, projectPath.lastIndexOf('\\'));
    const srcUiPath = `${projectDir}\\src\\ui`;
    checkSrcUiFolderExists(srcUiPath);
    
    logMessage('success', `Project loaded: LVGL ${result.lvglVersion} (${result.flowSupport ? 'with' : 'no'} flow support)`);
    
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
      
      logMessage('success', `Detected project: LVGL ${result.lvglVersion} (${result.flowSupport ? 'with' : 'no'} flow support)`);
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
  
  const result = await window.electronAPI.setupProject(state.projectInfo);
  
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
  
  const result = await window.electronAPI.buildProject(state.projectInfo);
  
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
  const cleanResult = await window.electronAPI.cleanBuild();
  
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
  
  const buildResult = await window.electronAPI.buildProject(state.projectInfo);
  
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
  
  const extractResult = await window.electronAPI.extractBuild();
  
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
  const extractResult = await window.electronAPI.extractBuild();
  
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
    elements.tabPreview.classList.remove('active');
    elements.tabContentLogs.classList.add('active');
    elements.tabContentLogs.style.display = '';
    elements.tabContentPreview.classList.remove('active');
    elements.tabContentPreview.style.display = 'none';
  } else if (tabName === 'preview') {
    elements.tabLogs.classList.remove('active');
    elements.tabPreview.classList.add('active');
    elements.tabContentLogs.classList.remove('active');
    elements.tabContentLogs.style.display = 'none';
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
    const trimmed = line.trim();
    if (trimmed && !trimmed.toLowerCase().startsWith('debug:')) {
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

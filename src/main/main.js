const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const { spawn } = require('child_process');
const chokidar = require('chokidar');
const express = require('express');

let mainWindow;
let fileWatcher = null;
let testServer = null;
let currentPort = null;

// Project mappings
const PROJECT_MAPPINGS = {
  '8.4.0': { false: 'v840-no-flow', true: 'v840-with-flow' },
  '9.2.2': { false: 'v922-no-flow', true: 'v922-with-flow' },
  '9.3.0': { false: 'v930-no-flow', true: 'v930-with-flow' },
  '9.4.0': { false: 'v940-no-flow', true: 'v940-with-flow' }
};

// Store recent projects
const RECENT_PROJECTS_FILE = path.join(app.getPath('userData'), 'recent-projects.json');
const WINDOW_STATE_FILE = path.join(app.getPath('userData'), 'window-state.json');
let recentProjects = [];

// Current project state
let currentProjectPath = null;
let currentProjectName = null;

// Load window state
async function loadWindowState() {
  try {
    const data = await fs.readFile(WINDOW_STATE_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    return { width: 1400, height: 900, x: undefined, y: undefined, isMaximized: false };
  }
}

// Save window state
async function saveWindowState() {
  if (!mainWindow) return;
  
  const bounds = mainWindow.getBounds();
  const state = {
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    isMaximized: mainWindow.isMaximized()
  };
  
  try {
    await fs.writeFile(WINDOW_STATE_FILE, JSON.stringify(state, null, 2));
  } catch (error) {
    // Ignore save errors
  }
}

async function createWindow() {
  const windowState = await loadWindowState();
  
  mainWindow = new BrowserWindow({
    width: windowState.width,
    height: windowState.height,
    x: windowState.x,
    y: windowState.y,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });
  
  if (windowState.isMaximized) {
    mainWindow.maximize();
  }

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  
  // Save window state on resize and move
  mainWindow.on('resize', () => saveWindowState());
  mainWindow.on('move', () => saveWindowState());
  mainWindow.on('maximize', () => saveWindowState());
  mainWindow.on('unmaximize', () => saveWindowState());
  
  // Open DevTools in development
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }
}

app.whenReady().then(async () => {
  await loadRecentProjects();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  stopFileWatcher();
  stopTestServer();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Filter out Docker noise messages
function shouldFilterDockerMessage(text) {
  const filters = [
    'Found orphan containers',
    'Container docker-build-emscripten-build-run-',
    'Container ID:',
    '--remove-orphans flag'
  ];
  
  // Check string filters
  if (filters.some(filter => text.includes(filter))) {
    return true;
  }
  
  // Filter out 64-character container IDs (hex strings on their own line)
  const isContainerId = /^[a-f0-9]{64}$/.test(text.trim());
  return isContainerId;
}

// Load recent projects from disk
async function loadRecentProjects() {
  try {
    const data = await fs.readFile(RECENT_PROJECTS_FILE, 'utf8');
    recentProjects = JSON.parse(data);
  } catch (error) {
    recentProjects = [];
  }
}

// Save recent projects to disk
async function saveRecentProjects() {
  try {
    await fs.writeFile(RECENT_PROJECTS_FILE, JSON.stringify(recentProjects, null, 2));
  } catch (error) {
    console.error('Failed to save recent projects:', error);
  }
}

// Add project to recent list
function addToRecentProjects(projectPath) {
  // Remove if already exists
  recentProjects = recentProjects.filter(p => p !== projectPath);
  // Add to beginning
  recentProjects.unshift(projectPath);
  // Keep only last 10
  recentProjects = recentProjects.slice(0, 10);
  saveRecentProjects();
}

// IPC Handlers

// Select project file
ipcMain.handle('select-project-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'EEZ Project', extensions: ['eez-project'] }
    ]
  });

  if (!result.canceled && result.filePaths.length > 0) {
    const projectPath = result.filePaths[0];
    addToRecentProjects(projectPath);
    return { success: true, path: projectPath };
  }

  return { success: false };
});

// Get recent projects
ipcMain.handle('get-recent-projects', async () => {
  return recentProjects;
});

// Add to recent projects
ipcMain.handle('add-to-recent-projects', async (event, projectPath) => {
  addToRecentProjects(projectPath);
  return { success: true };
});

// Check Docker status
ipcMain.handle('check-docker', async () => {
  return new Promise((resolve) => {
    const dockerProcess = spawn('docker', ['--version']);
    
    dockerProcess.on('close', (code) => {
      if (code === 0) {
        // Check if Docker daemon is running
        const psProcess = spawn('docker', ['ps']);
        psProcess.on('close', (psCode) => {
          resolve({
            installed: true,
            running: psCode === 0
          });
        });
      } else {
        resolve({
          installed: false,
          running: false
        });
      }
    });

    dockerProcess.on('error', () => {
      resolve({
        installed: false,
        running: false
      });
    });
  });
});

// Read and parse project file
ipcMain.handle('read-project-file', async (event, projectPath) => {
  try {
    const content = await fs.readFile(projectPath, 'utf8');
    const project = JSON.parse(content);
    
    const lvglVersion = project.settings?.general?.lvglVersion;
    const flowSupport = project.settings?.general?.flowSupport || false;
    
    if (!PROJECT_MAPPINGS[lvglVersion]) {
      throw new Error(`Unsupported LVGL version: ${lvglVersion}`);
    }
    
    const projectName = PROJECT_MAPPINGS[lvglVersion][flowSupport];
    const projectDir = path.dirname(projectPath);
    const uiDir = path.join(projectDir, 'src', 'ui');
    
    // Check if src/ui exists
    try {
      await fs.access(uiDir);
    } catch {
      throw new Error(`src/ui directory not found at: ${uiDir}`);
    }
    
    // Start file watcher immediately when project is loaded
    startFileWatcher(projectPath, uiDir);
    
    // Check if build files already exist
    const buildStatus = await checkBuildStatus(projectName);
    
    return {
      success: true,
      lvglVersion,
      flowSupport,
      projectName,
      projectDir,
      uiDir,
      setupComplete: buildStatus.setupComplete,
      buildComplete: buildStatus.buildComplete
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
});

// Run Docker command
ipcMain.handle('run-docker-command', async (event, command, args, options = {}) => {
  return new Promise((resolve) => {
    const dockerPath = path.join(__dirname, '../../docker-build');
    const env = { ...process.env, ...options.env };
    
    const dockerProcess = spawn(command, args, {
      cwd: dockerPath,
      env,
      shell: true
    });

    let output = '';
    let hasError = false;

    dockerProcess.stdout.on('data', (data) => {
      const text = data.toString();
      output += text;
      
      if (mainWindow && !shouldFilterDockerMessage(text)) {
        mainWindow.webContents.send('docker-output', {
          type: 'stdout',
          text
        });
      }
    });

    dockerProcess.stderr.on('data', (data) => {
      const text = data.toString();
      output += text;
      
      if (mainWindow && !shouldFilterDockerMessage(text)) {
        mainWindow.webContents.send('docker-output', {
          type: 'stderr',
          text
        });
      }
    });

    dockerProcess.on('error', (error) => {
      hasError = true;
      resolve({
        success: false,
        error: error.message,
        output
      });
    });

    dockerProcess.on('close', (code) => {
      resolve({
        success: !hasError && code === 0,
        code,
        output
      });
    });
  });
});

// Setup Docker project
ipcMain.handle('setup-project', async (event, projectInfo) => {
  const startTime = Date.now();
  try {
    currentProjectPath = projectInfo.projectPath;
    currentProjectName = projectInfo.projectName;
    
    const dockerPath = path.join(__dirname, '../../docker-build');
    const env = { PROJECT_VOLUME: projectInfo.projectName };
    
    // Step 1: Build Docker image
    mainWindow.webContents.send('log-message', { type: 'info', text: 'Building Docker image...\n' });
    let result = await runDockerCommand('docker-compose', ['build'], env, dockerPath);
    if (!result.success) throw new Error('Failed to build Docker image');
    
    // Step 2: Check if volume exists and has content
    mainWindow.webContents.send('log-message', { type: 'info', text: 'Checking if project is already set up...\n' });
    result = await runDockerCommand('docker-compose', [
      'run', '--rm', 'emscripten-build',
      'test', '-f', '/project/CMakeLists.txt'
    ], env, dockerPath);
    
    const projectAlreadySetup = result.success;
    
    if (!projectAlreadySetup) {
      // Step 3: Clone repository using script (only on first setup)
      mainWindow.webContents.send('log-message', { 
        type: 'info', 
        text: `First-time setup: Cloning repository from GitHub...\n` 
      });
      
      // Copy clone script to container and run it
      const containerId = await createTempContainer(env, dockerPath);
      const cloneShPath = path.join(dockerPath, 'clone.sh');
      
      await runDockerCommand('docker', ['cp', cloneShPath, `${containerId}:/tmp/clone.sh`], env, dockerPath);
      
      result = await runDockerCommand('docker', [
        'exec', containerId,
        'bash', '/tmp/clone.sh', `https://github.com/mvladic/${projectInfo.projectName}`
      ], env, dockerPath);
      
      await runDockerCommand('docker', ['stop', containerId], env, dockerPath);
      
      if (!result.success) throw new Error('Git clone failed');
      
      // Verify clone was successful by checking for CMakeLists.txt
      mainWindow.webContents.send('log-message', { type: 'info', text: 'Verifying clone...\n' });
      result = await runDockerCommand('docker-compose', [
        'run', '--rm', 'emscripten-build',
        'test', '-f', '/project/CMakeLists.txt'
      ], env, dockerPath);
      
      if (!result.success) throw new Error('Clone verification failed - CMakeLists.txt not found');
      
      // Verify .git directory was copied
      mainWindow.webContents.send('log-message', { type: 'info', text: 'Verifying git repository...\n' });
      result = await runDockerCommand('docker-compose', [
        'run', '--rm', 'emscripten-build',
        'test', '-f', '/project/.git/HEAD'
      ], env, dockerPath);
      
      if (!result.success) {
        mainWindow.webContents.send('log-message', { 
          type: 'warning', 
          text: 'Warning: .git directory not found. Git pull will not work for this volume.\n' 
        });
      } else {
        mainWindow.webContents.send('log-message', { 
          type: 'success', 
          text: 'Git repository verified successfully\n' 
        });
      }
      
      mainWindow.webContents.send('log-message', { 
        type: 'success', 
        text: 'Repository cloned successfully\n' 
      });
    } else {
      mainWindow.webContents.send('log-message', { 
        type: 'info', 
        text: 'Project already exists in Docker volume. Checking for updates...\n' 
      });
      
      // Check if it's a valid git repository by checking for .git/HEAD
      const gitCheckResult = await runDockerCommand('docker-compose', [
        'run', '--rm', 'emscripten-build',
        'test', '-f', '/project/.git/HEAD'
      ], env, dockerPath);
      
      if (gitCheckResult.success) {
        // Pull latest changes from GitHub
        mainWindow.webContents.send('log-message', { 
          type: 'info', 
          text: 'Pulling latest changes from GitHub...\n' 
        });
        
        result = await runDockerCommand('docker-compose', [
          'run', '--rm', 'emscripten-build',
          'sh', '-c', '"cd /project && git pull && git submodule update --init --recursive"'
        ], env, dockerPath);
        
        if (!result.success) {
          mainWindow.webContents.send('log-message', { 
            type: 'warning', 
            text: 'Git pull failed, continuing with existing code...\n' 
          });
        } else {
          mainWindow.webContents.send('log-message', { 
            type: 'success', 
            text: 'Latest changes pulled successfully\n' 
          });
        }
      } else {
        mainWindow.webContents.send('log-message', { 
          type: 'info', 
          text: 'No valid git repository found (project set up with older version). To enable automatic updates, delete this Docker volume and run Setup again.\n' 
        });
      }
    }
    
    // Step 4 & 5: Update build.sh and src/ui in a single container (optimization)
    mainWindow.webContents.send('log-message', { type: 'info', text: 'Updating build script and src/ui files...\n' });
    const containerId = await createTempContainer(env, dockerPath);
    mainWindow.webContents.send('log-message', { type: 'info', text: `Container ID: ${containerId}\n` });
    
    // Copy build.sh
    const buildShPath = path.join(dockerPath, 'build.sh');
    result = await runDockerCommand('docker', ['cp', buildShPath, `${containerId}:/project/build.sh`], env, dockerPath);
    if (!result.success) {
      await runDockerCommand('docker', ['stop', containerId], env, dockerPath);
      throw new Error('Failed to copy build script');
    }
    
    // Remove existing src/ui
    await runDockerCommand('docker', [
      'exec', containerId,
      'rm', '-rf', '/project/src/ui'
    ], env, dockerPath);
    
    // Copy src/ui directory - verify path exists first
    if (!projectInfo.uiDir) {
      await runDockerCommand('docker', ['stop', containerId], env, dockerPath);
      throw new Error('UI directory path is missing');
    }
    
    try {
      await fs.access(projectInfo.uiDir);
    } catch {
      await runDockerCommand('docker', ['stop', containerId], env, dockerPath);
      throw new Error(`UI directory not found: ${projectInfo.uiDir}`);
    }
    
    // Use resolved absolute path to avoid issues
    const resolvedUiDir = path.resolve(projectInfo.uiDir);
    mainWindow.webContents.send('log-message', { type: 'info', text: `Copying ${resolvedUiDir} to container...\n` });
    
    // For paths with spaces, we need to pass the command as a string instead of array
    // when using shell: true
    const cpCommand = `docker cp "${resolvedUiDir}" ${containerId}:/project/src/`;
    mainWindow.webContents.send('log-message', { type: 'info', text: `Running: ${cpCommand}\n` });
    
    result = await runDockerCommandString(cpCommand, env, dockerPath);
    
    if (!result.success) {
      await runDockerCommand('docker', ['stop', containerId], env, dockerPath);
      throw new Error('Failed to copy src/ui directory');
    }
    
    // Update timestamps to ensure CMake detects changes
    await runDockerCommand('docker', [
      'exec', containerId,
      'find', '/project/src/ui', '-type', 'f', '-exec', 'touch', '{}', '+'
    ], env, dockerPath);
    
    // Step 6: Copy modified lv_conf.h if it exists
    const lvConfDir = path.join(app.getPath('userData'), 'lv_conf');
    const lvConfPath = path.join(lvConfDir, `${projectInfo.projectName}.h`);
    
    try {
      await fs.access(lvConfPath);
      mainWindow.webContents.send('log-message', { type: 'info', text: 'Copying modified lv_conf.h...\n' });
      
      result = await runDockerCommand('docker', [
        'cp',
        lvConfPath,
        `${containerId}:/project/lv_conf.h`
      ], env, dockerPath);
      
      if (result.success) {
        mainWindow.webContents.send('log-message', { type: 'success', text: 'Modified lv_conf.h copied successfully\n' });
      } else {
        mainWindow.webContents.send('log-message', { type: 'warning', text: 'Failed to copy modified lv_conf.h, using default\n' });
      }
    } catch (error) {
      // File doesn't exist, use default from repository
      mainWindow.webContents.send('log-message', { type: 'info', text: 'Using default lv_conf.h from repository\n' });
    }
    
    // Stop container
    await runDockerCommand('docker', ['stop', containerId], env, dockerPath);
    
    // File watcher is already started when project is loaded
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    mainWindow.webContents.send('log-message', { type: 'success', text: `Setup completed successfully in ${duration}s!\n` });
    return { success: true };
    
  } catch (error) {
    mainWindow.webContents.send('log-message', { type: 'error', text: `Setup failed: ${error.message}\n` });
    return { success: false, error: error.message };
  }
});

// Build project
ipcMain.handle('build-project', async (event, projectName) => {
  const startTime = Date.now();
  try {
    const dockerPath = path.join(__dirname, '../../docker-build');
    const env = { PROJECT_VOLUME: projectName };
    
    mainWindow.webContents.send('log-message', { type: 'info', text: `Starting build for project: ${projectName}\n` });
    
    const result = await runDockerCommand('docker-compose', [
      'run', '--rm', 'emscripten-build',
      'bash', 'build.sh'
    ], env, dockerPath);
    
    if (result.success) {
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      mainWindow.webContents.send('log-message', { type: 'success', text: `Build completed successfully in ${duration}s!\n` });
      return { success: true };
    } else {
      throw new Error('Build failed');
    }
    
  } catch (error) {
    mainWindow.webContents.send('log-message', { type: 'error', text: `Build failed: ${error.message}\n` });
    return { success: false, error: error.message };
  }
});

// Clean build directory
ipcMain.handle('clean-build', async (event, projectName) => {
  const startTime = Date.now();
  try {
    const dockerPath = path.join(__dirname, '../../docker-build');
    const env = { PROJECT_VOLUME: projectName };
    
    mainWindow.webContents.send('log-message', { type: 'info', text: 'Removing build directory...\n' });
    
    const result = await runDockerCommand('docker-compose', [
      'run', '--rm', 'emscripten-build',
      'rm', '-rf', '/project/build'
    ], env, dockerPath);
    
    if (result.success) {
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      mainWindow.webContents.send('log-message', { type: 'success', text: `Build directory cleaned in ${duration}s!\n` });
      return { success: true };
    } else {
      throw new Error('Clean failed');
    }
    
  } catch (error) {
    mainWindow.webContents.send('log-message', { type: 'error', text: `Clean failed: ${error.message}\n` });
    return { success: false, error: error.message };
  }
});

// Extract build output
ipcMain.handle('extract-build', async (event, projectName) => {
  try {
    const dockerPath = path.join(__dirname, '../../docker-build');
    const outputPath = path.join(dockerPath, 'output');
    const env = { PROJECT_VOLUME: projectName };
    
    mainWindow.webContents.send('log-message', { type: 'info', text: `Output path: ${outputPath}\n` });
    
    // Clean output directory first (remove old files)
    mainWindow.webContents.send('log-message', { type: 'info', text: 'Cleaning output directory...\n' });
    try {
      await fs.rm(outputPath, { recursive: true, force: true });
      mainWindow.webContents.send('log-message', { type: 'info', text: 'Output directory cleaned.\n' });
    } catch (error) {
      mainWindow.webContents.send('log-message', { type: 'warning', text: `Clean warning: ${error.message}\n` });
    }
    
    // Create fresh output directory
    await fs.mkdir(outputPath, { recursive: true });
    
    mainWindow.webContents.send('log-message', { type: 'info', text: `Extracting build files from volume: ${projectName}\n` });
    
    // Create temp container and copy files
    const containerId = await createTempContainer(env, dockerPath);
    mainWindow.webContents.send('log-message', { type: 'info', text: `Container ID: ${containerId}\n` });
    
    const files = ['index.html', 'index.js', 'index.wasm', 'index.data'];
    for (const file of files) {
      const destPath = path.join(outputPath, file);
      const result = await runDockerCommand('docker', [
        'cp',
        `${containerId}:/project/build/${file}`,
        destPath
      ], env, dockerPath);
      
      // index.data is optional - only fail if required files are missing
      if (!result.success) {
        if (file === 'index.data') {
          mainWindow.webContents.send('log-message', { 
            type: 'info', 
            text: `${file} not found (optional file, skipping)\n` 
          });
          continue;
        }
        await runDockerCommand('docker', ['stop', containerId], env, dockerPath);
        throw new Error(`Failed to extract ${file}`);
      }
      
      // Log file info
      try {
        const stats = await fs.stat(destPath);
        mainWindow.webContents.send('log-message', { 
          type: 'info', 
          text: `Extracted ${file}: ${stats.size} bytes, modified: ${stats.mtime.toISOString()}\n` 
        });
      } catch (err) {
        mainWindow.webContents.send('log-message', { 
          type: 'warning', 
          text: `Could not stat ${file}: ${err.message}\n` 
        });
      }
    }
    
    await runDockerCommand('docker', ['stop', containerId], env, dockerPath);
    
    mainWindow.webContents.send('log-message', { type: 'success', text: 'Build files extracted successfully!\n' });
    return { success: true, outputPath };
    
  } catch (error) {
    mainWindow.webContents.send('log-message', { type: 'error', text: `Extract failed: ${error.message}\n` });
    return { success: false, error: error.message };
  }
});

// Start test server
ipcMain.handle('start-test-server', async (event, outputPath) => {
  try {
    // Stop existing server if running
    stopTestServer();
    
    // Find available port
    currentPort = await findAvailablePort(3000);
    
    // Create Express server
    const app = express();
    
    // Disable caching for all responses
    app.use((req, res, next) => {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      next();
    });
    
    // Inject console capture script into HTML
    app.get('/', async (req, res, next) => {
      try {
        const indexPath = path.join(outputPath, 'index.html');
        let html = await fs.readFile(indexPath, 'utf8');
        
        // Inject console capture script before </head>
        const captureScript = `
<script>
(function() {
  const original = {
    log: console.log,
    error: console.error,
    warn: console.warn,
    info: console.info
  };
  
  function sendToParent(type, args) {
    window.parent.postMessage({
      type: 'console',
      level: type,
      message: Array.from(args).map(arg => {
        if (typeof arg === 'object') {
          try { return JSON.stringify(arg); }
          catch { return String(arg); }
        }
        return String(arg);
      }).join(' ')
    }, '*');
  }
  
  console.log = function(...args) {
    original.log.apply(console, args);
    sendToParent('log', args);
  };
  
  console.error = function(...args) {
    original.error.apply(console, args);
    sendToParent('error', args);
  };
  
  console.warn = function(...args) {
    original.warn.apply(console, args);
    sendToParent('warn', args);
  };
  
  console.info = function(...args) {
    original.info.apply(console, args);
    sendToParent('info', args);
  };
  
  window.addEventListener('error', function(e) {
    sendToParent('error', [e.message + ' at ' + e.filename + ':' + e.lineno]);
  });
})();
</script>
`;
        
        html = html.replace('</head>', captureScript + '</head>');
        res.send(html);
      } catch (error) {
        next();
      }
    });
    
    app.use(express.static(outputPath));
    
    testServer = app.listen(currentPort, () => {
      const url = `http://localhost:${currentPort}`;
      mainWindow.webContents.send('log-message', { 
        type: 'success', 
        text: `Test server started at ${url}\n` 
      });
    });
    
    return { success: true, port: currentPort, url: `http://localhost:${currentPort}` };
    
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Stop test server
ipcMain.handle('stop-test-server', async () => {
  stopTestServer();
  return { success: true };
});

// Open folder in VS Code
ipcMain.handle('open-in-vscode', async (event, folderPath) => {
  try {
    const { exec } = require('child_process');
    const util = require('util');
    const execAsync = util.promisify(exec);
    
    // Check if VS Code is installed by trying to run 'code --version'
    try {
      await execAsync('code --version');
    } catch (error) {
      return { success: false, error: 'VS Code is not installed or not in PATH' };
    }
    
    // Open the folder in VS Code
    await execAsync(`code "${folderPath}"`);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Check if folder exists
ipcMain.handle('check-folder-exists', async (event, folderPath) => {
  try {
    const stats = await fs.stat(folderPath);
    return { exists: stats.isDirectory() };
  } catch (error) {
    return { exists: false };
  }
});

// Save modified lv_conf.h
ipcMain.handle('save-lv-conf', async (event, projectName, content) => {
  try {
    const lvConfDir = path.join(app.getPath('userData'), 'lv_conf');
    await fs.mkdir(lvConfDir, { recursive: true });
    
    const filePath = path.join(lvConfDir, `${projectName}.h`);
    await fs.writeFile(filePath, content, 'utf8');
    
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Load saved lv_conf.h
ipcMain.handle('load-saved-lv-conf', async (event, projectName) => {
  try {
    const lvConfDir = path.join(app.getPath('userData'), 'lv_conf');
    const filePath = path.join(lvConfDir, `${projectName}.h`);
    
    const content = await fs.readFile(filePath, 'utf8');
    
    // If file is empty or doesn't exist, return failure so GitHub version is loaded
    if (!content || content.trim().length === 0) {
      return { success: false, error: 'Saved file is empty' };
    }
    
    return { success: true, content };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Copy lv_conf.h to Docker volume
ipcMain.handle('copy-lv-conf-to-docker', async (event, projectName, content) => {
  try {
    const dockerPath = path.join(__dirname, '../../docker-build');
    const env = { PROJECT_VOLUME: projectName };
    const tempFile = path.join(app.getPath('temp'), 'lv_conf_temp.h');
    
    // Write content to temp file
    await fs.writeFile(tempFile, content, 'utf8');
    
    // Create temp container
    const containerId = await createTempContainer(env, dockerPath);
    
    // Copy file to container
    const result = await runDockerCommand('docker', [
      'cp',
      tempFile,
      `${containerId}:/project/lv_conf.h`
    ], env, dockerPath);
    
    // Stop container
    await runDockerCommand('docker', ['stop', containerId], env, dockerPath);
    
    // Clean up temp file
    await fs.unlink(tempFile);
    
    if (result.success) {
      return { success: true };
    } else {
      throw new Error('Failed to copy lv_conf.h to Docker volume');
    }
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Get lv_conf.h file from GitHub
ipcMain.handle('get-lv-conf-file', async (event, projectName) => {
  try {
    // Fetch from GitHub raw content
    const url = `https://raw.githubusercontent.com/mvladic/${projectName}/master/lv_conf.h`;
    
    const https = require('https');
    
    return new Promise((resolve) => {
      https.get(url, (res) => {
        let data = '';
        
        res.on('data', (chunk) => {
          data += chunk;
        });
        
        res.on('end', () => {
          if (res.statusCode === 200) {
            resolve({ success: true, content: data });
          } else if (res.statusCode === 404) {
            // Try 'main' branch instead of 'master'
            const urlMain = `https://raw.githubusercontent.com/mvladic/${projectName}/main/lv_conf.h`;
            https.get(urlMain, (res2) => {
              let data2 = '';
              
              res2.on('data', (chunk) => {
                data2 += chunk;
              });
              
              res2.on('end', () => {
                if (res2.statusCode === 200) {
                  resolve({ success: true, content: data2 });
                } else {
                  resolve({ success: false, error: 'lv_conf.h not found in repository' });
                }
              });
            }).on('error', (err) => {
              resolve({ success: false, error: err.message });
            });
          } else {
            resolve({ success: false, error: `HTTP ${res.statusCode}` });
          }
        });
      }).on('error', (err) => {
        resolve({ success: false, error: err.message });
      });
    });
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Get lv_conf_template.h from official LVGL repository
ipcMain.handle('get-lv-conf-template', async (event, lvglVersion) => {
  try {
    // Fetch from official LVGL GitHub repository
    const url = `https://raw.githubusercontent.com/lvgl/lvgl/v${lvglVersion}/lv_conf_template.h`;
    
    const https = require('https');
    
    return new Promise((resolve) => {
      https.get(url, (res) => {
        let data = '';
        
        res.on('data', (chunk) => {
          data += chunk;
        });
        
        res.on('end', () => {
          if (res.statusCode === 200) {
            resolve({ success: true, content: data });
          } else {
            resolve({ success: false, error: `lv_conf_template.h not found for LVGL v${lvglVersion}` });
          }
        });
      }).on('error', (err) => {
        resolve({ success: false, error: err.message });
      });
    });
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Helper functions

async function runDockerCommand(command, args, env, cwd) {
  return new Promise((resolve) => {
    // Log the command for debugging
    if (mainWindow) {
      const cmdLine = `${command} ${args.join(' ')}`;
      console.log('Running docker command:', cmdLine);
      mainWindow.webContents.send('log-message', { 
        type: 'debug', 
        text: `DEBUG: ${cmdLine}\n` 
      });
    }
    
    const dockerProcess = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      shell: true
    });

    let output = '';

    dockerProcess.stdout.on('data', (data) => {
      const text = data.toString();
      output += text;
      
      if (mainWindow && !shouldFilterDockerMessage(text)) {
        mainWindow.webContents.send('docker-output', { type: 'stdout', text });
      }
    });

    dockerProcess.stderr.on('data', (data) => {
      const text = data.toString();
      output += text;
      
      if (mainWindow && !shouldFilterDockerMessage(text)) {
        mainWindow.webContents.send('docker-output', { type: 'stderr', text });
      }
    });

    dockerProcess.on('close', (code) => {
      resolve({
        success: code === 0,
        code,
        output
      });
    });

    dockerProcess.on('error', (error) => {
      resolve({
        success: false,
        error: error.message,
        output
      });
    });
  });
}

// Run docker command as a single string (for commands with complex quoting)
async function runDockerCommandString(commandString, env, cwd) {
  return new Promise((resolve) => {
    if (mainWindow) {
      console.log('Running docker command string:', commandString);
      mainWindow.webContents.send('log-message', { 
        type: 'debug', 
        text: `DEBUG: ${commandString}\n` 
      });
    }
    
    const dockerProcess = spawn(commandString, [], {
      cwd,
      env: { ...process.env, ...env },
      shell: true
    });

    let output = '';

    dockerProcess.stdout.on('data', (data) => {
      const text = data.toString();
      output += text;
      
      if (mainWindow && !shouldFilterDockerMessage(text)) {
        mainWindow.webContents.send('docker-output', { type: 'stdout', text });
      }
    });

    dockerProcess.stderr.on('data', (data) => {
      const text = data.toString();
      output += text;
      
      if (mainWindow && !shouldFilterDockerMessage(text)) {
        mainWindow.webContents.send('docker-output', { type: 'stderr', text });
      }
    });

    dockerProcess.on('close', (code) => {
      resolve({
        success: code === 0,
        code,
        output
      });
    });

    dockerProcess.on('error', (error) => {
      resolve({
        success: false,
        error: error.message,
        output
      });
    });
  });
}

async function createTempContainer(env, dockerPath) {
  const result = await runDockerCommand('docker-compose', [
    'run', '-d', '--remove-orphans', 'emscripten-build',
    'sleep', '60'
  ], env, dockerPath);
  
  // Extract container ID from output
  const containerId = result.output.trim().split('\n').pop();
  return containerId;
}

function findAvailablePort(startPort) {
  return new Promise((resolve) => {
    const testServer = require('net').createServer();
    
    testServer.listen(startPort, () => {
      const port = testServer.address().port;
      testServer.close(() => resolve(port));
    });
    
    testServer.on('error', () => {
      resolve(findAvailablePort(startPort + 1));
    });
  });
}

function stopTestServer() {
  if (testServer) {
    testServer.close();
    testServer = null;
    currentPort = null;
  }
}

async function checkBuildStatus(projectName) {
  try {
    const dockerPath = path.join(__dirname, '../../docker-build');
    const env = { PROJECT_VOLUME: projectName };
    
    // Check if CMakeLists.txt exists (indicates setup was done)
    const setupResult = await runDockerCommandSilent('docker-compose', [
      'run', '--rm', '--remove-orphans', 'emscripten-build',
      'test', '-f', '/project/CMakeLists.txt'
    ], env, dockerPath);
    
    const setupComplete = setupResult.success;
    
    // Check if build output exists (index.wasm)
    const buildResult = await runDockerCommandSilent('docker-compose', [
      'run', '--rm', '--remove-orphans', 'emscripten-build',
      'test', '-f', '/project/build/index.wasm'
    ], env, dockerPath);
    
    const buildComplete = buildResult.success;
    
    return { setupComplete, buildComplete };
  } catch (error) {
    return { setupComplete: false, buildComplete: false };
  }
}

async function runDockerCommandSilent(command, args, env, cwd) {
  return new Promise((resolve) => {
    const dockerProcess = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      shell: true
    });

    let output = '';

    dockerProcess.stdout.on('data', (data) => {
      output += data.toString();
    });

    dockerProcess.stderr.on('data', (data) => {
      output += data.toString();
    });

    dockerProcess.on('close', (code) => {
      resolve({
        success: code === 0,
        code,
        output
      });
    });

    dockerProcess.on('error', (error) => {
      resolve({
        success: false,
        error: error.message,
        output
      });
    });
  });
}

function startFileWatcher(projectPath, uiDir) {
  stopFileWatcher();
  
  const watchPaths = [projectPath, uiDir];
  
  fileWatcher = chokidar.watch(watchPaths, {
    persistent: true,
    ignoreInitial: true
  });
  
  fileWatcher.on('change', (path) => {
    if (mainWindow) {
      if (path.endsWith('.eez-project')) {
        mainWindow.webContents.send('log-message', { type: 'info', text: `Project file changed: ${path}\n` });
      }
      mainWindow.webContents.send('file-changed', { path });
    }
  });
  
  fileWatcher.on('add', (path) => {
    if (mainWindow) {
      if (path.endsWith('.eez-project')) {
        mainWindow.webContents.send('log-message', { type: 'info', text: `Project file added: ${path}\n` });
      }
      mainWindow.webContents.send('file-changed', { path });
    }
  });
  
  fileWatcher.on('unlink', (path) => {
    if (mainWindow) {
      if (path.endsWith('.eez-project')) {
        mainWindow.webContents.send('log-message', { type: 'info', text: `Project file removed: ${path}\n` });
      }
      mainWindow.webContents.send('file-changed', { path });
    }
  });
}

function stopFileWatcher() {
  if (fileWatcher) {
    fileWatcher.close();
    fileWatcher = null;
  }
}

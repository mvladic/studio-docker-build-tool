const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const { spawn } = require('child_process');
const express = require('express');

let mainWindow;
let testServer = null;
let currentPort = null;

// Single repository for all LVGL versions
const REPOSITORY_NAME = 'lvgl-simulator-for-studio-docker-build';
const DOCKER_VOLUME_NAME = 'lvgl-simulator';

// Store recent projects
const RECENT_PROJECTS_FILE = path.join(app.getPath('userData'), 'recent-projects.json');
const WINDOW_STATE_FILE = path.join(app.getPath('userData'), 'window-state.json');
let recentProjects = [];

// Current project state
let currentProjectPath = null;
let currentProjectInfo = null;

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
    '--remove-orphans flag',
    'cache:INFO'
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
    const displayWidth = project.settings?.general?.displayWidth || 800;
    const displayHeight = project.settings?.general?.displayHeight || 480;
    const destinationFolder = project.settings?.build?.destinationFolder || 'src/ui';
    
    if (!lvglVersion) {
      throw new Error('LVGL version not specified in project settings');
    }
    
    const projectDir = path.dirname(projectPath);
    // Use destinationFolder from settings (convert backslashes to forward slashes)
    const normalizedDestination = destinationFolder.replace(/\\/g, '/');
    const uiDir = path.join(projectDir, normalizedDestination);
    
    // Check if destination folder exists
    try {
      await fs.access(uiDir);
    } catch {
      throw new Error(`Build destination directory not found at: ${uiDir}`);
    }
    
    // Check if build files already exist (using single volume)
    const buildStatus = await checkBuildStatus(DOCKER_VOLUME_NAME);
    
    return {
      success: true,
      lvglVersion,
      flowSupport,
      projectDir,
      uiDir,
      destinationFolder: normalizedDestination,
      displayWidth,
      displayHeight,
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
    currentProjectInfo = projectInfo;
    
    const dockerPath = path.join(__dirname, '../../docker-build');
    const env = { PROJECT_VOLUME: DOCKER_VOLUME_NAME };
    
    // Step 1: Build Docker image
    mainWindow.webContents.send('log-message', { type: 'info', text: 'Building Docker image...\n' });
    let result = await runDockerCommand('docker-compose', ['build'], env, dockerPath);
    if (!result.success) throw new Error('Failed to build Docker image');
    
    // Step 2: Check if volume exists and has content
    mainWindow.webContents.send('log-message', { type: 'info', text: 'Checking if project is already set up...\n' });
    result = await runDockerCommand('docker-compose', [
      'run', '--rm', 'emscripten-build',
      'test', '-f', '/project/build.sh'
    ], env, dockerPath);
    
    const projectAlreadySetup = result.success;
    
    let containerId;
    
    if (!projectAlreadySetup) {
      // Step 3: Clone repository using script (only on first setup)
      mainWindow.webContents.send('log-message', { 
        type: 'info', 
        text: `First-time setup: Cloning repository from GitHub...\n` 
      });
      
      // Create temp container that will be reused for file operations
      containerId = await createTempContainer(env, dockerPath);
      
      result = await runDockerCommand('docker', [
        'exec', containerId,
        'sh', '-c', `"cd /project && git clone --recursive https://github.com/mvladic/${REPOSITORY_NAME} ."`
      ], env, dockerPath);
      
      if (!result.success) {
        await runDockerCommand('docker', ['stop', containerId], env, dockerPath);
        throw new Error('Git clone failed');
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
      
      // Pull latest changes from GitHub
      mainWindow.webContents.send('log-message', { 
        type: 'info', 
        text: 'Pulling latest changes from GitHub...\n' 
      });
        
      result = await runDockerCommand('docker-compose', [
        'run', '--rm', 'emscripten-build',
        'sh', '-c', '"cd /project && git pull"'
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
    }
    
    // Step 4: Update build files (reuse container from clone if first-time setup)
    mainWindow.webContents.send('log-message', { type: 'info', text: 'Updating build files...\n' });
    if (!containerId) {
      // Create container only if we didn't create one for cloning
      containerId = await createTempContainer(env, dockerPath);
    }
    
    // Remove and recreate src directory in one command
    mainWindow.webContents.send('log-message', { type: 'info', text: 'Preparing src directory...\n' });
    await runDockerCommand('docker', [
      'exec', containerId,
      'sh', '-c', '"rm -rf /project/src && mkdir -p /project/src"'
    ], env, dockerPath);
    
    // Copy build destination directory - verify path exists first
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
    
    // Copy contents of destination folder directly into /project/src/
    // Using /. at the end copies the contents, not the folder itself
    const cpCommand = `docker cp "${resolvedUiDir}/." ${containerId}:/project/src/`;
    mainWindow.webContents.send('log-message', { type: 'info', text: `Running: ${cpCommand}\n` });
    
    result = await runDockerCommandString(cpCommand, env, dockerPath);
    
    if (!result.success) {
      await runDockerCommand('docker', ['stop', containerId], env, dockerPath);
      throw new Error('Failed to copy build destination directory');
    }
    
    // Update timestamps to ensure CMake detects changes
    await runDockerCommand('docker', [
      'exec', containerId,
      'find', '/project/src', '-type', 'f', '-name', '*.c', '-o', '-name', '*.h', '-exec', 'touch', '{}', '+'
    ], env, dockerPath);
    
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
ipcMain.handle('build-project', async (event, projectInfo) => {
  const startTime = Date.now();
  try {
    const dockerPath = path.join(__dirname, '../../docker-build');
    const env = { PROJECT_VOLUME: DOCKER_VOLUME_NAME };
    
    mainWindow.webContents.send('log-message', { type: 'info', text: `Starting build (LVGL ${projectInfo.lvglVersion}, ${projectInfo.displayWidth}x${projectInfo.displayHeight})...\n` });
    
    // Use the build.sh script with parameters
    const buildCommand = `./build.sh --lvgl=${projectInfo.lvglVersion} --display-width=${projectInfo.displayWidth} --display-height=${projectInfo.displayHeight}`;
    
    const result = await runDockerCommand('docker-compose', [
      'run', '--rm', 'emscripten-build',
      'sh', '-c', `"${buildCommand}"`
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
ipcMain.handle('clean-build', async (event) => {
  const startTime = Date.now();
  try {
    const dockerPath = path.join(__dirname, '../../docker-build');
    const env = { PROJECT_VOLUME: DOCKER_VOLUME_NAME };
    
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
ipcMain.handle('extract-build', async (event) => {
  const startTime = Date.now();
  try {
    const dockerPath = path.join(__dirname, '../../docker-build');
    const outputPath = path.join(dockerPath, 'output');
    const env = { PROJECT_VOLUME: DOCKER_VOLUME_NAME };
    
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
    
    mainWindow.webContents.send('log-message', { type: 'info', text: 'Extracting build files from Docker volume...\n' });
    
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
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    mainWindow.webContents.send('log-message', { type: 'success', text: `Build files extracted successfully in ${duration}s!\n` });
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
ipcMain.handle('open-in-eez-studio', async (event, projectPath) => {
  try {
    const { shell } = require('electron');
    
    // Use shell.openPath to open the file with the default application
    // EEZ Studio should be registered as the handler for .eez-project files
    const result = await shell.openPath(projectPath);
    
    if (result) {
      // If result is non-empty, it means there was an error
      return { success: false, error: result };
    }
    
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

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

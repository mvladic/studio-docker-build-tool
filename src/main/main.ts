import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import * as path from 'path';
import { promises as fs } from 'fs';
import { spawn, ChildProcess } from 'child_process';
import express, { Express, Request, Response, NextFunction } from 'express';
import * as http from 'http';

// Import build library functions
import {
  checkDocker,
  readProjectFile,
  setupProject,
  buildProject,
  extractBuild,
  cleanBuild,
  cleanAll,
} from '../../scripts/docker-build-lib';

// Determine if running from compiled code (production) or source (development)
const isProduction = __dirname.includes('dist');

// In production (packaged app), resources folder contains the app
// In development, we're in src/main
const appRoot = isProduction 
  ? path.join(__dirname, '../../../')  // dist/src/main -> root (in app.asar or unpacked)
  : path.join(__dirname, '../../');     // src/main -> root

// Get path to resources (docker-build files)
const getResourcePath = (relativePath: string): string => {
  if (app.isPackaged) {
    // In packaged app, extraResources are in the resources directory
    return path.join(process.resourcesPath, relativePath);
  }
  // In dev, use resources directory
  return path.join(appRoot, 'resources', relativePath);
};

// Get output path (always at root /output)
const getOutputPath = (): string => {
  if (app.isPackaged) {
    // In packaged app, use process.resourcesPath parent (app folder)
    return path.join(path.dirname(process.resourcesPath), 'output');
  }
  // In dev, use root output directory
  return path.join(appRoot, 'output');
};

let mainWindow: BrowserWindow | null = null;
let testServer: http.Server | null = null;
let currentPort: number | null = null;
let currentDockerProcess: ChildProcess | null = null;

// Single repository for all LVGL versions
const REPOSITORY_NAME = 'lvgl-simulator-for-studio-docker-build';
const DOCKER_VOLUME_NAME = 'lvgl-simulator';
const DOCKER_BUILD_PATH = getResourcePath('docker-build');

// Build configuration
const buildConfig = {
  repositoryName: REPOSITORY_NAME,
  dockerVolumeName: DOCKER_VOLUME_NAME,
  dockerBuildPath: DOCKER_BUILD_PATH,
};

// Store recent projects
const RECENT_PROJECTS_FILE = path.join(app.getPath('userData'), 'recent-projects.json');
const WINDOW_STATE_FILE = path.join(app.getPath('userData'), 'window-state.json');
let recentProjects: string[] = [];

// Current project state
let currentProjectPath: string | null = null;
let currentProjectInfo: any = null;

// Logging adapter - sends messages to renderer process
function log(message: string, type: 'info' | 'success' | 'error' | 'warning' = 'info'): void {
  if (mainWindow && mainWindow.webContents) {
    if (mainWindow) mainWindow.webContents.send('log-message', { type, text: message + '\n' });
  }
}

// Helper to get error message from unknown error
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

// Load window state
async function loadWindowState(): Promise<{ width: number; height: number; x?: number; y?: number; isMaximized: boolean }> {
  try {
    const data = await fs.readFile(WINDOW_STATE_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    return { width: 1400, height: 900, x: undefined, y: undefined, isMaximized: false };
  }
}

// Save window state
async function saveWindowState(): Promise<void> {
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
      preload: app.isPackaged
        ? path.join(__dirname, '../../../src/main/preload.js')  // In asar: dist/src/main -> src/main
        : path.join(__dirname, '../../../src/main/preload.js')  // In dev: dist/src/main -> src/main
    }
  });
  
  if (windowState.isMaximized) {
    mainWindow.maximize();
  }

  mainWindow.loadFile(
    app.isPackaged
      ? path.join(__dirname, '../../../src/renderer/index.html')  // In asar: dist/src/main -> src/renderer
      : path.join(__dirname, '../../../src/renderer/index.html')  // In dev: dist/src/main -> src/renderer
  );
  
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
function shouldFilterDockerMessage(text: string): boolean {
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
async function saveRecentProjects(): Promise<void> {
  try {
    await fs.writeFile(RECENT_PROJECTS_FILE, JSON.stringify(recentProjects, null, 2));
  } catch (error) {
    console.error('Failed to save recent projects:', error);
  }
}

// Add project to recent list
function addToRecentProjects(projectPath: string): void {
  // Remove if already exists
  recentProjects = recentProjects.filter(p => p !== projectPath);
  // Add to beginning
  recentProjects.unshift(projectPath);
  // Keep only last 10
  recentProjects = recentProjects.slice(0, 10);
  saveRecentProjects();
}

// Remove project from recent list
function removeFromRecentProjects(projectPath: string): void {
  recentProjects = recentProjects.filter(p => p !== projectPath);
  saveRecentProjects();
}

// IPC Handlers

// Select project file
ipcMain.handle('select-project-file', async () => {
  if (!mainWindow) return { canceled: true };
  
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

// Remove from recent projects
ipcMain.handle('remove-from-recent-projects', async (event, projectPath) => {
  removeFromRecentProjects(projectPath);
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
    const projectInfo = await readProjectFile(projectPath, log);
    
    // Check if build files already exist (using single volume)
    const buildStatus = await checkBuildStatus(DOCKER_VOLUME_NAME);
    
    // Set outputPath if build is complete
    const outputPath = getOutputPath();
    
    return {
      success: true,
      ...projectInfo,
      setupComplete: buildStatus.setupComplete,
      buildComplete: buildStatus.buildComplete,
      outputPath: outputPath
    };
  } catch (error: unknown) {
    return {
      success: false,
      error: getErrorMessage(error)
    };
  }
});

// Run Docker command
ipcMain.handle('run-docker-command', async (event, command, args, options = {}) => {
  return new Promise((resolve) => {
    const dockerPath = getResourcePath('docker-build');
    const env = { ...process.env, ...options.env };
    
    const dockerProcess = spawn(command, args, {
      cwd: dockerPath,
      env,
      shell: true
    });
    
    // Track the current process so it can be aborted
    currentDockerProcess = dockerProcess;

    let output = '';
    let hasError = false;

    dockerProcess.stdout.on('data', (data) => {
      const text = data.toString();
      output += text;
      
      if (mainWindow && !shouldFilterDockerMessage(text)) {
        if (mainWindow) mainWindow.webContents.send('docker-output', {
          type: 'stdout',
          text
        });
      }
    });

    dockerProcess.stderr.on('data', (data) => {
      const text = data.toString();
      output += text;
      
      if (mainWindow && !shouldFilterDockerMessage(text)) {
        if (mainWindow) mainWindow.webContents.send('docker-output', {
          type: 'stderr',
          text
        });
      }
    });

    dockerProcess.on('error', (error) => {
      hasError = true;
      resolve({
        success: false,
        error: getErrorMessage(error),
        output
      });
    });

    dockerProcess.on('close', (code) => {
      currentDockerProcess = null;
      resolve({
        success: !hasError && code === 0,
        code: code ?? undefined,
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
    
    await setupProject(projectInfo, buildConfig, log);
    
    // File watcher is already started when project is loaded
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    if (mainWindow) mainWindow.webContents.send('log-message', { type: 'success', text: `Setup completed successfully in ${duration}s!\n` });
    return { success: true };
    
  } catch (error: unknown) {
    if (mainWindow) mainWindow.webContents.send('log-message', { type: 'error', text: `Setup failed: ${getErrorMessage(error)}\n` });
    return { success: false, error: getErrorMessage(error) };
  }
});

// Build project
ipcMain.handle('build-project', async (event, projectInfo) => {
  const startTime = Date.now();
  try {
    if (mainWindow) mainWindow.webContents.send('log-message', { type: 'info', text: `Starting build (LVGL ${projectInfo.lvglVersion}, ${projectInfo.displayWidth}x${projectInfo.displayHeight})...\n` });
    
    await buildProject(projectInfo, buildConfig, log);
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    if (mainWindow) mainWindow.webContents.send('log-message', { type: 'success', text: `Build completed successfully in ${duration}s!\n` });
    return { success: true };
    
  } catch (error: unknown) {
    if (mainWindow) mainWindow.webContents.send('log-message', { type: 'error', text: `Build failed: ${getErrorMessage(error)}\n` });
    return { success: false, error: getErrorMessage(error) };
  }
});

// Clean build directory
ipcMain.handle('clean-build', async (event) => {
  const startTime = Date.now();
  try {
    if (mainWindow) mainWindow.webContents.send('log-message', { type: 'info', text: 'Removing build directory...\n' });
    
    await cleanBuild(buildConfig, log);
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    if (mainWindow) mainWindow.webContents.send('log-message', { type: 'success', text: `Build directory cleaned in ${duration}s!\n` });
    return { success: true };
    
  } catch (error: unknown) {
    if (mainWindow) mainWindow.webContents.send('log-message', { type: 'error', text: `Clean failed: ${getErrorMessage(error)}\n` });
    return { success: false, error: getErrorMessage(error) };
  }
});

// Clean project (delete entire /project directory for fresh start)
ipcMain.handle('clean-project', async (event) => {
  const startTime = Date.now();
  try {
    if (mainWindow) mainWindow.webContents.send('log-message', { type: 'info', text: 'Removing all contents from /project directory...\n' });
    
    await cleanAll(buildConfig, log);
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    if (mainWindow) mainWindow.webContents.send('log-message', { type: 'success', text: `Project directory cleaned in ${duration}s. Next build will start from scratch.\n` });
    return { success: true };
    
  } catch (error: unknown) {
    if (mainWindow) mainWindow.webContents.send('log-message', { type: 'error', text: `Clean failed: ${getErrorMessage(error)}\n` });
    return { success: false, error: getErrorMessage(error) };
  }
});

// Extract build output
ipcMain.handle('extract-build', async (event) => {
  const startTime = Date.now();
  try {
    const outputPath = getOutputPath();
    
    if (mainWindow) mainWindow.webContents.send('log-message', { type: 'info', text: `Output path: ${outputPath}\n` });
    
    await extractBuild(outputPath, buildConfig, log);
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    if (mainWindow) mainWindow.webContents.send('log-message', { type: 'success', text: `Build files extracted successfully in ${duration}s!\n` });
    return { success: true, outputPath };
    
  } catch (error: unknown) {
    if (mainWindow) mainWindow.webContents.send('log-message', { type: 'error', text: `Extract failed: ${getErrorMessage(error)}\n` });
    return { success: false, error: getErrorMessage(error) };
  }
});

// Start test server
ipcMain.handle('start-test-server', async (event, outputPath: string) => {
  try {
    // Stop existing server if running
    stopTestServer();
    
    // Find available port
    currentPort = await findAvailablePort(3000);
    
    // Create Express server
    const app: Express = express();
    
    // Disable caching for all responses
    app.use((req: Request, res: Response, next: NextFunction) => {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      next();
    });
    
    // Inject console capture script into HTML
    app.get('/', async (req: Request, res: Response, next: NextFunction) => {
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
      if (mainWindow) mainWindow.webContents.send('log-message', { 
        type: 'success', 
        text: `Test server started at ${url}\n` 
      });
    });
    
    return { success: true, port: currentPort, url: `http://localhost:${currentPort}` };
    
  } catch (error: unknown) {
    return { success: false, error: getErrorMessage(error) };
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
  } catch (error: unknown) {
    return { success: false, error: getErrorMessage(error) };
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
  } catch (error: unknown) {
    return { success: false, error: getErrorMessage(error) };
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

// Check if file exists
ipcMain.handle('check-file-exists', async (event, filePath) => {
  try {
    const stats = await fs.stat(filePath);
    return { exists: stats.isFile() };
  } catch (error) {
    return { exists: false };
  }
});

// Abort current operation
ipcMain.handle('abort-operation', async () => {
  if (currentDockerProcess) {
    try {
      // Kill the Docker process and its children
      currentDockerProcess.kill('SIGTERM');
      // Give it a moment, then force kill if needed
      setTimeout(() => {
        if (currentDockerProcess && !currentDockerProcess.killed) {
          currentDockerProcess.kill('SIGKILL');
        }
      }, 1000);
      currentDockerProcess = null;
      return { success: true };
    } catch (error: unknown) {
      return { success: false, error: getErrorMessage(error) };
    }
  }
  return { success: false, error: 'No operation running' };
});

// Helper functions

interface DockerCommandResult {
  success: boolean;
  code?: number;
  output?: string;
  error?: string;
}

async function runDockerCommand(
  command: string,
  args: string[],
  env: Record<string, string>,
  cwd: string
): Promise<DockerCommandResult> {
  return new Promise((resolve) => {
    // Log the command for debugging
    if (mainWindow) {
      const cmdLine = `${command} ${args.join(' ')}`;
      console.log('Running docker command:', cmdLine);
      if (mainWindow) mainWindow.webContents.send('log-message', { 
        type: 'debug', 
        text: `DEBUG: ${cmdLine}\n` 
      });
    }
    
    const dockerProcess = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      shell: true
    });

    // Track the current process so it can be aborted
    currentDockerProcess = dockerProcess;

    let output = '';

    dockerProcess.stdout.on('data', (data) => {
      const text = data.toString();
      output += text;
      
      if (mainWindow && !shouldFilterDockerMessage(text)) {
        if (mainWindow) mainWindow.webContents.send('docker-output', { type: 'stdout', text });
      }
    });

    dockerProcess.stderr.on('data', (data) => {
      const text = data.toString();
      output += text;
      
      if (mainWindow && !shouldFilterDockerMessage(text)) {
        if (mainWindow) mainWindow.webContents.send('docker-output', { type: 'stderr', text });
      }
    });

    dockerProcess.on('close', (code) => {
      currentDockerProcess = null;
      resolve({
        success: code === 0,
        code: code ?? undefined,
        output
      });
    });

    dockerProcess.on('error', (error) => {
      currentDockerProcess = null;
      resolve({
        success: false,
        error: getErrorMessage(error),
        output
      });
    });
  });
}

// Run docker command as a single string (for commands with complex quoting)
async function runDockerCommandString(
  commandString: string,
  env: Record<string, string>,
  cwd: string
): Promise<DockerCommandResult> {
  return new Promise((resolve) => {
    if (mainWindow) {
      console.log('Running docker command string:', commandString);
      if (mainWindow) mainWindow.webContents.send('log-message', { 
        type: 'debug', 
        text: `DEBUG: ${commandString}\n` 
      });
    }
    
    const dockerProcess = spawn(commandString, [], {
      cwd,
      env: { ...process.env, ...env },
      shell: true
    });

    // Track the current process so it can be aborted
    currentDockerProcess = dockerProcess;

    let output = '';

    dockerProcess.stdout.on('data', (data) => {
      const text = data.toString();
      output += text;
      
      if (mainWindow && !shouldFilterDockerMessage(text)) {
        if (mainWindow) mainWindow.webContents.send('docker-output', { type: 'stdout', text });
      }
    });

    dockerProcess.stderr.on('data', (data) => {
      const text = data.toString();
      output += text;
      
      if (mainWindow && !shouldFilterDockerMessage(text)) {
        if (mainWindow) mainWindow.webContents.send('docker-output', { type: 'stderr', text });
      }
    });

    dockerProcess.on('close', (code) => {
      resolve({
        success: code === 0,
        code: code ?? undefined,
        output
      });
    });

    dockerProcess.on('error', (error) => {
      resolve({
        success: false,
        error: getErrorMessage(error),
        output
      });
    });
  });
}

async function createTempContainer(env: Record<string, string>, dockerPath: string): Promise<string> {
  const result = await runDockerCommand('docker-compose', [
    'run', '-d', '--remove-orphans', 'emscripten-build',
    'sleep', '60'
  ], env, dockerPath);
  
  // Extract container ID from output
  const containerId = (result as any).output.trim().split('\n').pop();
  return containerId;
}

function findAvailablePort(startPort: number): Promise<number> {
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

function stopTestServer(): void {
  if (testServer) {
    testServer.close();
    testServer = null;
    currentPort = null;
  }
}

async function checkBuildStatus(projectName: string): Promise<{ setupComplete: boolean; buildComplete: boolean }> {
  try {
    const dockerPath = path.join(__dirname, '../../docker-build');
    const env = { PROJECT_VOLUME: projectName };
    
    // Check if CMakeLists.txt exists (indicates setup was done)
    const setupResult = await runDockerCommandSilent('docker-compose', [
      'run', '--rm', '--remove-orphans', 'emscripten-build',
      'test', '-f', '/project/CMakeLists.txt'
    ], env, dockerPath);
    
    const setupComplete = (setupResult as any).success;
    
    // Check if build output exists (index.wasm)
    const buildResult = await runDockerCommandSilent('docker-compose', [
      'run', '--rm', '--remove-orphans', 'emscripten-build',
      'test', '-f', '/project/build/index.wasm'
    ], env, dockerPath);
    
    const buildComplete = (buildResult as any).success;
    
    return { setupComplete, buildComplete };
  } catch (error) {
    return { setupComplete: false, buildComplete: false };
  }
}

async function runDockerCommandSilent(
  command: string,
  args: string[],
  env: Record<string, string>,
  cwd: string
): Promise<DockerCommandResult> {
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
        code: code ?? undefined,
        output
      });
    });

    dockerProcess.on('error', (error) => {
      resolve({
        success: false,
        error: getErrorMessage(error),
        output
      });
    });
  });
}





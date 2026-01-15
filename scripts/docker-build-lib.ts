/**
 * Docker Build Library for EEZ Projects
 * 
 * Core functionality for Docker-based builds separated from CLI interface
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawn, spawnSync } from 'child_process';

export interface BuildConfig {
  repositoryName: string;
  dockerVolumeName: string;
  dockerBuildPath: string;
}

export interface FontInfo {
  localPath: string;           // Absolute path on local system
  targetPath: string;          // Path in Docker container (/fonts/...)
  fileName: string;            // Font file name
}

export interface ProjectInfo {
  lvglVersion: string;
  flowSupport: boolean;
  projectDir: string;
  uiDir: string;
  destinationFolder: string;
  displayWidth: number;
  displayHeight: number;
  fonts: FontInfo[];           // Array of FreeType fonts to include
}

export interface CommandResult {
  success: boolean;
  output?: string;
  error?: string;
}

export type LogFunction = (message: string, type?: 'info' | 'success' | 'error' | 'warning') => void;

/**
 * Read and parse the EEZ project file
 */
export async function readProjectFile(projectPath: string, log: LogFunction): Promise<ProjectInfo> {
  log(`Reading project file: ${projectPath}`);

  if (!fs.existsSync(projectPath)) {
    throw new Error(`Project file not found: ${projectPath}`);
  }

  const content = fs.readFileSync(projectPath, 'utf8');
  const project = JSON.parse(content);

  let lvglVersion = project.settings?.general?.lvglVersion;
  const flowSupport = project.settings?.general?.flowSupport || false;
  const displayWidth = project.settings?.general?.displayWidth || 800;
  const displayHeight = project.settings?.general?.displayHeight || 480;
  const destinationFolder = project.settings?.build?.destinationFolder || 'src/ui';

  if (!lvglVersion) {
    throw new Error('LVGL version not specified in project settings');
  }

  // Map unsupported versions to supported ones
  const versionMap: Record<string, string> = {
    '8.3': '8.4.0',
    '8.3.0': '8.4.0',
    '9.0': '9.2.2',
    '9.0.0': '9.2.2',
  };

  if (versionMap[lvglVersion]) {
    log(`LVGL version ${lvglVersion} mapped to ${versionMap[lvglVersion]}`, 'info');
    lvglVersion = versionMap[lvglVersion];
  }

  const projectDir = path.dirname(projectPath);
  const normalizedDestination = destinationFolder.replace(/\\/g, '/');
  const uiDir = path.join(projectDir, normalizedDestination);

  // Check if destination folder exists
  if (!fs.existsSync(uiDir)) {
    throw new Error(`Build destination directory not found at: ${uiDir}`);
  }

  // Parse fonts
  const fonts: FontInfo[] = [];
  if (project.fonts && Array.isArray(project.fonts)) {
    for (const font of project.fonts) {
      if (font.lvglUseFreeType === true) {
        const localFontPath = path.join(projectDir, font.source.filePath.replace(/\\/g, '/'));
        const targetFontPath = font.lvglFreeTypeFilePath;
        const fontFileName = path.basename(localFontPath);

        // Validate that font file exists
        if (!fs.existsSync(localFontPath)) {
          log(`Warning: Font file not found: ${localFontPath}`, 'warning');
          continue;
        }

        fonts.push({
          localPath: localFontPath,
          targetPath: targetFontPath,
          fileName: fontFileName,
        });

        log(`Found FreeType font: ${fontFileName} -> ${targetFontPath}`);
      }
    }
  }

  if (fonts.length > 0) {
    log(`Total FreeType fonts to include: ${fonts.length}`, 'success');
  }

  log(`Detected project: LVGL ${lvglVersion} (${flowSupport ? 'with' : 'no'} flow support)`, 'success');
  log(`Display: ${displayWidth}x${displayHeight}`);
  log(`UI directory: ${uiDir}`);

  return {
    lvglVersion,
    flowSupport,
    projectDir,
    uiDir,
    destinationFolder: normalizedDestination,
    displayWidth,
    displayHeight,
    fonts,
  };
}

/**
 * Run a command and return the result
 */
function runCommand(
  command: string,
  args: string[],
  cwd: string | undefined,
  env: Record<string, string> | undefined,
  log: LogFunction
): Promise<CommandResult> {
  return new Promise((resolve) => {
    log(`Running: ${command} ${args.join(' ')}`);
    
    const mergedEnv = { ...process.env, ...env };
    const proc = spawn(command, args, {
      cwd: cwd || process.cwd(),
      env: mergedEnv,
      shell: true,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data) => {
      const text = data.toString();
      stdout += text;
      process.stdout.write(text);
    });

    proc.stderr?.on('data', (data) => {
      const text = data.toString();
      stderr += text;
      // Filter out Docker noise
      if (!shouldFilterDockerMessage(text)) {
        process.stderr.write(text);
      }
    });

    proc.on('close', (code) => {
      resolve({
        success: code === 0,
        output: stdout,
        error: stderr,
      });
    });

    proc.on('error', (error) => {
      resolve({
        success: false,
        error: error.message,
      });
    });
  });
}

/**
 * Run a command silently (suppress output)
 */
function runCommandSilent(
  command: string,
  args: string[],
  cwd: string | undefined,
  env: Record<string, string> | undefined
): Promise<CommandResult> {
  return new Promise((resolve) => {
    const mergedEnv = { ...process.env, ...env };
    const proc = spawn(command, args, {
      cwd: cwd || process.cwd(),
      env: mergedEnv,
      shell: true,
      stdio: 'pipe',
    });

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      resolve({
        success: code === 0,
        output: stdout,
        error: stderr,
      });
    });

    proc.on('error', (error) => {
      resolve({
        success: false,
        error: error.message,
      });
    });
  });
}

/**
 * Filter out Docker noise messages
 */
function shouldFilterDockerMessage(text: string): boolean {
  const filters = [
    'Found orphan containers',
    'Container docker-build-emscripten-build-run-',
    'Container ID:',
    '--remove-orphans flag',
    'cache:INFO',
  ];

  if (filters.some((filter) => text.includes(filter))) {
    return true;
  }

  // Filter out 64-character container IDs (hex strings on their own line)
  const isContainerId = /^[a-f0-9]{64}$/.test(text.trim());
  return isContainerId;
}

/**
 * Check if Docker is installed and running
 */
export async function checkDocker(log: LogFunction): Promise<boolean> {
  log('Checking Docker status...');

  // Check if Docker is installed
  const versionResult = spawnSync('docker', ['--version'], { shell: true });
  if (versionResult.status !== 0) {
    log('Docker is not installed. Please install Docker Desktop.', 'error');
    return false;
  }

  // Check if Docker daemon is running
  const psResult = spawnSync('docker', ['ps'], { shell: true });
  if (psResult.status !== 0) {
    log('Docker is not running. Please start Docker Desktop.', 'error');
    return false;
  }

  log('Docker is ready.', 'success');
  return true;
}

/**
 * Create a temporary Docker container
 */
async function createTempContainer(config: BuildConfig, env: Record<string, string>, log: LogFunction): Promise<string> {
  const result = await runCommandSilent(
    'docker-compose',
    ['run', '-d', 'emscripten-build', 'sleep', 'infinity'],
    config.dockerBuildPath,
    env
  );

  if (!result.success || !result.output) {
    throw new Error('Failed to create temporary container');
  }

  const containerId = result.output.trim();
  log(`Created temporary container: ${containerId}`);
  return containerId;
}

/**
 * Setup the Docker environment and project files
 */
export async function setupProject(projectInfo: ProjectInfo, config: BuildConfig, log: LogFunction): Promise<void> {
  const startTime = Date.now();
  log('=== Step 1/3: Setup ===');

  const env = { PROJECT_VOLUME: config.dockerVolumeName };

  // Step 1: Build Docker image
  log('Building Docker image...');
  let result = await runCommandSilent('docker-compose', ['build'], config.dockerBuildPath, env);
  if (!result.success) {
    throw new Error('Failed to build Docker image');
  }
  log('Docker image built successfully.', 'success');

  // Step 2: Check if volume exists and has content
  log('Checking if project is already set up...');
  result = await runCommandSilent(
    'docker-compose',
    ['run', '--rm', 'emscripten-build', 'test', '-f', '/project/build.sh'],
    config.dockerBuildPath,
    env
  );

  const projectAlreadySetup = result.success;

  let containerId: string | undefined;

  if (!projectAlreadySetup) {
    // Step 3: Clone repository (only on first setup)
    log('First-time setup: Cloning repository from GitHub...');

    containerId = await createTempContainer(config, env, log);

    result = await runCommand(
      'docker',
      ['exec', containerId, 'sh', '-c', `"cd /project && git clone --recursive https://github.com/eez-open/${config.repositoryName} ."`],
      config.dockerBuildPath,
      env,
      log
    );

    if (!result.success) {
      await runCommand('docker', ['stop', containerId], config.dockerBuildPath, env, log);
      throw new Error('Git clone failed');
    }

    log('Repository cloned successfully.', 'success');
  } else {
    log('Project already exists in Docker volume. Checking for updates...');

    // Pull latest changes from GitHub
    log('Pulling latest changes from GitHub...');

    result = await runCommand(
      'docker-compose',
      ['run', '--rm', 'emscripten-build', 'sh', '-c', '"cd /project && git pull"'],
      config.dockerBuildPath,
      env,
      log
    );

    if (!result.success) {
      log('Git pull failed, continuing with existing code...', 'warning');
    } else {
      log('Latest changes pulled successfully.', 'success');
    }
  }

  // Step 4: Update build files
  log('Updating build files...');
  if (!containerId) {
    containerId = await createTempContainer(config, env, log);
  }

  // Remove and recreate src directory
  log('Preparing src directory...');
  await runCommand(
    'docker',
    ['exec', containerId, 'sh', '-c', '"rm -rf /project/src && mkdir -p /project/src"'],
    config.dockerBuildPath,
    env,
    log
  );

  // Copy build destination directory
  if (!projectInfo.uiDir) {
    await runCommand('docker', ['stop', containerId], config.dockerBuildPath, env, log);
    throw new Error('UI directory path is missing');
  }

  if (!fs.existsSync(projectInfo.uiDir)) {
    await runCommand('docker', ['stop', containerId], config.dockerBuildPath, env, log);
    throw new Error(`UI directory not found: ${projectInfo.uiDir}`);
  }

  const resolvedUiDir = path.resolve(projectInfo.uiDir);
  log(`Copying ${resolvedUiDir} to container...`);

  // Copy contents of destination folder directly into /project/src/
  result = await runCommand(
    'docker',
    ['cp', `${resolvedUiDir}/.`, `${containerId}:/project/src/`],
    config.dockerBuildPath,
    env,
    log
  );

  if (!result.success) {
    await runCommand('docker', ['stop', containerId], config.dockerBuildPath, env, log);
    throw new Error('Failed to copy build destination directory');
  }

  // Update timestamps to ensure CMake detects changes
  await runCommand(
    'docker',
    ['exec', containerId, 'find', '/project/src', '-type', 'f', '(', '-name', '*.c', '-o', '-name', '*.h', ')', '-exec', 'touch', '{}', '+'],
    config.dockerBuildPath,
    env,
    log
  );

  // Copy fonts if any are specified
  if (projectInfo.fonts && projectInfo.fonts.length > 0) {
    log(`Copying ${projectInfo.fonts.length} font(s) to container...`);
    
    // Create fonts directory in container
    await runCommand(
      'docker',
      ['exec', containerId, 'mkdir', '-p', '/project/fonts'],
      config.dockerBuildPath,
      env,
      log
    );

    // Copy each font file
    for (const font of projectInfo.fonts) {
      log(`Copying font: ${font.fileName}`);
      
      // Determine target directory from targetPath
      const targetDir = path.posix.dirname(font.targetPath);
      const targetFileName = path.posix.basename(font.targetPath);
      
      // Create target directory structure in container
      await runCommand(
        'docker',
        ['exec', containerId, 'mkdir', '-p', `/project${targetDir}`],
        config.dockerBuildPath,
        env,
        log
      );

      // Copy the font file to the container
      result = await runCommand(
        'docker',
        ['cp', font.localPath, `${containerId}:/project${targetDir}/${targetFileName}`],
        config.dockerBuildPath,
        env,
        log
      );

      if (!result.success) {
        await runCommand('docker', ['stop', containerId], config.dockerBuildPath, env, log);
        throw new Error(`Failed to copy font file: ${font.fileName}`);
      }
    }

    // Create fonts manifest file for build.sh
    const fontsManifest = projectInfo.fonts.map(f => f.targetPath).join('\n');
    const manifestContent = Buffer.from(fontsManifest).toString('base64');
    
    await runCommand(
      'docker',
      ['exec', containerId, 'sh', '-c', `"echo '${manifestContent}' | base64 -d > /project/fonts.txt"`],
      config.dockerBuildPath,
      env,
      log
    );

    log('Fonts manifest created: /project/fonts.txt', 'success');
  }

  // Stop container
  await runCommand('docker', ['stop', containerId], config.dockerBuildPath, env, log);

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  log(`Setup completed successfully in ${duration}s!`, 'success');
}

/**
 * Build the project using Emscripten
 */
export async function buildProject(projectInfo: ProjectInfo, config: BuildConfig, log: LogFunction): Promise<void> {
  const startTime = Date.now();
  log('=== Step 2/3: Build ===');

  const env = { PROJECT_VOLUME: config.dockerVolumeName };

  log(`Starting build (LVGL ${projectInfo.lvglVersion}, ${projectInfo.displayWidth}x${projectInfo.displayHeight})...`);

  // Use the build.sh script with parameters
  let buildCommand = `"./build.sh --lvgl=${projectInfo.lvglVersion} --display-width=${projectInfo.displayWidth} --display-height=${projectInfo.displayHeight}`;
  
  // Add fonts parameter if fonts are present
  if (projectInfo.fonts && projectInfo.fonts.length > 0) {
    buildCommand += ' --fonts=/project/fonts.txt';
  }
  
  buildCommand += '"';

  const result = await runCommand(
    'docker-compose',
    ['run', '--rm', 'emscripten-build', 'sh', '-c', buildCommand],
    config.dockerBuildPath,
    env,
    log
  );

  if (!result.success) {
    throw new Error('Build failed');
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  log(`Build completed successfully in ${duration}s!`, 'success');
}

/**
 * Extract build output from Docker volume
 */
export async function extractBuild(outputPath: string, config: BuildConfig, log: LogFunction): Promise<void> {
  const startTime = Date.now();
  log('=== Step 3/3: Extract ===');

  const env = { PROJECT_VOLUME: config.dockerVolumeName };

  log(`Output path: ${outputPath}`);

  // Clean output directory first
  log('Cleaning output directory...');
  if (fs.existsSync(outputPath)) {
    fs.rmSync(outputPath, { recursive: true, force: true });
    log('Output directory cleaned.');
  }

  // Create fresh output directory
  fs.mkdirSync(outputPath, { recursive: true });

  log('Extracting build files from Docker volume...');

  // Create temp container and copy files
  const containerId = await createTempContainer(config, env, log);
  log(`Container ID: ${containerId}`);

  const files = ['index.html', 'index.js', 'index.wasm', 'index.data'];
  for (const file of files) {
    const destPath = path.join(outputPath, file);
    const result = await runCommand(
      'docker',
      ['cp', `${containerId}:/project/build/${file}`, destPath],
      config.dockerBuildPath,
      env,
      log
    );

    // index.data is optional - only fail if required files are missing
    if (!result.success) {
      if (file === 'index.data') {
        log(`${file} not found (optional file, skipping)`);
        continue;
      }
      await runCommand('docker', ['stop', containerId], config.dockerBuildPath, env, log);
      throw new Error(`Failed to extract ${file}`);
    }

    // Log file info
    try {
      const stats = fs.statSync(destPath);
      log(`Extracted ${file}: ${stats.size} bytes`);
    } catch (err) {
      log(`Could not stat ${file}: ${(err as Error).message}`, 'warning');
    }
  }

  await runCommand('docker', ['stop', containerId], config.dockerBuildPath, env, log);

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  log(`Build files extracted successfully in ${duration}s!`, 'success');
}

/**
 * Clean build directory
 */
export async function cleanBuild(config: BuildConfig, log: LogFunction): Promise<void> {
  const startTime = Date.now();
  log('=== Clean Build Directory ===');

  const env = { PROJECT_VOLUME: config.dockerVolumeName };

  log('Removing build directory...');

  const result = await runCommand(
    'docker-compose',
    ['run', '--rm', 'emscripten-build', 'rm', '-rf', '/project/build'],
    config.dockerBuildPath,
    env,
    log
  );

  if (!result.success) {
    throw new Error('Clean build failed');
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  log(`Build directory cleaned in ${duration}s!`, 'success');
}

/**
 * Clean all (delete entire /project directory for fresh start)
 */
export async function cleanAll(config: BuildConfig, log: LogFunction): Promise<void> {
  const startTime = Date.now();
  log('=== Clean All ===');

  const env = { PROJECT_VOLUME: config.dockerVolumeName };

  log('Removing all contents from /project directory...');

  const result = await runCommand(
    'docker-compose',
    ['run', '--rm', 'emscripten-build', 'sh', '-c', '"rm -rf /project/* /project/.*[!.]*"'],
    config.dockerBuildPath,
    env,
    log
  );

  if (!result.success) {
    throw new Error('Clean all failed');
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  log(`Project directory cleaned in ${duration}s. Next build will start from scratch.`, 'success');
}

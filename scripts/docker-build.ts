#!/usr/bin/env ts-node

/**
 * Docker Build Script for EEZ Projects
 * 
 * This script replicates the functionality of the Electron app's Build button.
 * It performs the following steps:
 * 1. Reads the EEZ project file
 * 2. Sets up the Docker environment
 * 3. Builds the project using Emscripten
 * 4. Extracts the build output to the specified folder
 * 
 * Usage:
 *   ts-node scripts/docker-build.ts <path-to-eez-project-file> <output-folder>
 * 
 * Example:
 *   ts-node scripts/docker-build.ts ./my-project.eez-project ./output
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  ProjectInfo,
  FontInfo,
  BuildConfig,
  checkDocker,
  readProjectFile,
  setupProject,
  buildProject,
  extractBuild,
  cleanBuild,
  cleanAll,
} from './docker-build-lib';

// Constants
const REPOSITORY_NAME = 'lvgl-simulator-for-studio-docker-build';
const DOCKER_VOLUME_NAME = 'lvgl-simulator';
const DOCKER_BUILD_PATH = path.join(__dirname, '../docker-build');

// ANSI color codes for console output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message: string, type: 'info' | 'success' | 'error' | 'warning' = 'info') {
  const timestamp = new Date().toISOString();
  const prefix = {
    info: `${colors.cyan}[INFO]${colors.reset}`,
    success: `${colors.green}[SUCCESS]${colors.reset}`,
    error: `${colors.red}[ERROR]${colors.reset}`,
    warning: `${colors.yellow}[WARNING]${colors.reset}`,
  };
  console.log(`${timestamp} ${prefix[type]} ${message}`);
}

/**
 * Main function
 */
async function main() {
  const args = process.argv.slice(2);

  // Parse options
  let cleanBuildFlag = false;
  let cleanAllFlag = false;
  const filteredArgs: string[] = [];

  for (const arg of args) {
    if (arg === '--clean-build') {
      cleanBuildFlag = true;
    } else if (arg === '--clean-all') {
      cleanAllFlag = true;
    } else {
      filteredArgs.push(arg);
    }
  }

  // For clean operations, we don't need project file and output folder
  if (cleanBuildFlag || cleanAllFlag) {
    if (filteredArgs.length !== 0) {
      console.error('Usage: ts-node scripts/docker-build.ts --clean-build|--clean-all');
      console.error('');
      console.error('Clean operations do not require project file or output folder arguments.');
      process.exit(1);
    }
  } else if (filteredArgs.length !== 2) {
    console.error('Usage: ts-node scripts/docker-build.ts <path-to-eez-project-file> <output-folder>');
    console.error('   or: ts-node scripts/docker-build.ts --clean-build');
    console.error('   or: ts-node scripts/docker-build.ts --clean-all');
    console.error('');
    console.error('Options:');
    console.error('  --clean-build    Remove only the build directory');
    console.error('  --clean-all      Remove entire project directory (fresh start)');
    console.error('');
    console.error('Example:');
    console.error('  ts-node scripts/docker-build.ts ./my-project.eez-project ./output');
    console.error('  ts-node scripts/docker-build.ts --clean-build');
    console.error('  ts-node scripts/docker-build.ts --clean-all');
    process.exit(1);
  }

  const [projectFilePath, outputFolder] = filteredArgs;

  try {
    const overallStartTime = Date.now();
    
    log('=== EEZ Studio Docker Build Tool ===', 'info');

    // Build configuration
    const config: BuildConfig = {
      repositoryName: REPOSITORY_NAME,
      dockerVolumeName: DOCKER_VOLUME_NAME,
      dockerBuildPath: DOCKER_BUILD_PATH,
    };

    // Check Docker
    const dockerReady = await checkDocker(log);
    if (!dockerReady) {
      process.exit(1);
    }

    // Handle clean operations
    if (cleanAllFlag) {
      await cleanAll(config, log);
      log('');
      log('=== Clean all completed successfully! ===', 'success');
      return;
    }

    if (cleanBuildFlag) {
      await cleanBuild(config, log);
      log('');
      log('=== Clean build completed successfully! ===', 'success');
      return;
    }

    // Normal build flow
    log(`Project: ${projectFilePath}`);
    log(`Output: ${outputFolder}`);
    log('');

    // Read project file
    const projectInfo = await readProjectFile(projectFilePath, log);

    // Setup project
    await setupProject(projectInfo, config, log);

    // Build project
    await buildProject(projectInfo, config, log);

    // Extract build output
    const resolvedOutputPath = path.resolve(outputFolder);
    await extractBuild(resolvedOutputPath, config, log);

    const totalDuration = ((Date.now() - overallStartTime) / 1000).toFixed(1);
    log('');
    log(`=== Build completed successfully in ${totalDuration}s! ===`, 'success');
    log(`Output files are in: ${resolvedOutputPath}`);

  } catch (error) {
    log('', 'error');
    log(`Build failed: ${(error as Error).message}`, 'error');
    process.exit(1);
  }
}

// Run main function
if (require.main === module) {
  main().catch((error) => {
    log(`Unexpected error: ${error.message}`, 'error');
    process.exit(1);
  });
}

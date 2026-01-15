# Docker Build Tools

This directory contains tools for building EEZ Studio projects using Docker and Emscripten.

## Files

- **docker-build.ts** - Command-line interface for building projects
- **docker-build-lib.ts** - Reusable library with core Docker operations

## docker-build.ts (CLI)

The main command-line script that replicates the functionality of the Electron app's Build button. This script handles:
- Command-line argument parsing
- Project file reading and validation
- Colored console output logging
- LVGL version mapping
- Calling the library functions with appropriate configuration

Use this script when you want to build projects from the command line or in CI/CD pipelines.

## docker-build-lib.ts (Library)

A reusable library containing all the core Docker operations. This module:
- Exports all build functions that can be imported elsewhere
- Accepts a logging callback for flexible logging
- Works with the `ProjectInfo` interface instead of file paths
- Accepts configuration through the `BuildConfig` interface

Use this library when you want to integrate the build functionality into other applications (like the Electron app or custom tooling).

## Prerequisites

- Docker Desktop installed and running
- Node.js and npm installed
- TypeScript dependencies installed

## Installation

Install the required dependencies:

```bash
npm install
```

## Usage

### Build a Project

```bash
npm run docker-build <path-to-eez-project-file> <output-folder>
```

Or directly with ts-node:

```bash
ts-node scripts/docker-build.ts <path-to-eez-project-file> <output-folder>
```

### Clean Operations

Clean the build directory only (keeps repository and source files):
```bash
npm run docker-build -- --clean-build
```

Clean everything (removes entire project directory for a fresh start):
```bash
npm run docker-build -- --clean-all
```

Or with ts-node:
```bash
ts-node scripts/docker-build.ts --clean-build
ts-node scripts/docker-build.ts --clean-all
```

### Examples

Build a project and output to a specific folder:
```bash
npm run docker-build ./my-project.eez-project ./build-output
```

Build with absolute paths:
```bash
npm run docker-build C:/Projects/my-app/project.eez-project C:/Projects/my-app/dist
```

Clean the build directory:
```bash
npm run docker-build -- --clean-build
```

Clean everything for a fresh start:
```bash
npm run docker-build -- --clean-all
```

## What the Script Does

### Normal Build

The script performs the following steps:

1. **Checks Docker** - Verifies that Docker is installed and running
2. **Reads Project File** - Parses the .eez-project file to extract:
   - LVGL version
   - Display dimensions (width x height)
   - Flow support settings
   - Build destination folder path
3. **Setup** - Prepares the Docker environment:
   - Builds the Docker image
   - Clones or updates the lvgl-simulator repository
   - Copies your UI source files to the Docker volume
4. **Build** - Compiles the project using Emscripten with the specified settings
5. **Extract** - Copies the built files from Docker to your output folder:
   - index.html
   - index.js
   - index.wasm
   - index.data (optional)

### Clean Build (`--clean-build`)

Removes only the `/project/build` directory from the Docker volume. This is useful when you want to do a clean rebuild but keep the repository and other files intact. The next build will recompile everything but won't need to re-clone the repository.

### Clean All (`--clean-all`)

Removes all contents from the `/project` directory in the Docker volume. This provides a completely fresh start - the next build will need to clone the repository again. Use this when you want to ensure absolutely everything is reset.

## Output

After a successful build, you'll find the following files in your output folder:
- `index.html` - Main HTML file to run the application
- `index.js` - JavaScript wrapper
- `index.wasm` - Compiled WebAssembly binary
- `index.data` - Embedded resources (if applicable)

You can open `index.html` in a web browser to test your application.

## Troubleshooting

### Docker is not running
Make sure Docker Desktop is started before running the script.

### Project file not found
Verify that the path to your .eez-project file is correct.

### Build destination directory not found
The script looks for the build destination folder specified in your project settings (usually `src/ui`). Make sure this folder exists and contains the generated UI files from EEZ Studio.

### LVGL version not supported
The script automatically maps some LVGL versions:
- 8.3 → 8.4.0
- 9.0 → 9.2.2

If your version isn't supported, the script will show an error.

## Environment

The script uses the same Docker configuration as the Electron app:
- Docker volume: `lvgl-simulator`
- Docker compose file: `docker-build/docker-compose.yml`
- Repository: `mvladic/lvgl-simulator-for-studio-docker-build`

## Using docker-build-lib.ts in Your Code

The library can be imported and used in any TypeScript/JavaScript project. Here's how:

### Basic Example

```typescript
import {
  ProjectInfo,
  BuildConfig,
  checkDocker,
  setupProject,
  buildProject,
  extractBuild,
} from './scripts/docker-build-lib';

// Create your own logging function
function myLogger(message: string, type?: 'info' | 'success' | 'error' | 'warning') {
  console.log(`[${type?.toUpperCase() || 'INFO'}] ${message}`);
}

// Define your configuration
const config: BuildConfig = {
  repositoryName: 'lvgl-simulator-for-studio-docker-build',
  dockerVolumeName: 'lvgl-simulator',
  dockerBuildPath: '/path/to/docker-build',
};

// Define your project information
const projectInfo: ProjectInfo = {
  lvglVersion: '9.2.2',
  flowSupport: false,
  projectDir: '/path/to/project',
  uiDir: '/path/to/project/src/ui',
  destinationFolder: 'src/ui',
  displayWidth: 800,
  displayHeight: 480,
};

// Use the library functions
async function build() {
  // Check if Docker is available
  const dockerReady = await checkDocker(myLogger);
  if (!dockerReady) {
    return;
  }

  // Run the build pipeline
  await setupProject(projectInfo, config, myLogger);
  await buildProject(projectInfo, config, myLogger);
  await extractBuild('/output/path', config, myLogger);
}
```

### Available Functions

All functions accept a `log` callback for outputting messages:

- **checkDocker(log)** - Verify Docker is installed and running
- **setupProject(projectInfo, config, log)** - Setup Docker environment and copy source files
- **buildProject(projectInfo, config, log)** - Compile the project with Emscripten
- **extractBuild(outputPath, config, log)** - Extract built files from Docker volume
- **cleanBuild(config, log)** - Remove build directory only
- **cleanAll(config, log)** - Remove entire project directory for fresh start

### Interfaces

```typescript
interface ProjectInfo {
  lvglVersion: string;        // e.g., "9.2.2"
  flowSupport: boolean;        // true if using EEZ Flow
  projectDir: string;          // Project root directory
  uiDir: string;              // UI source directory (absolute path)
  destinationFolder: string;   // Relative path to UI folder
  displayWidth: number;        // Display width in pixels
  displayHeight: number;       // Display height in pixels
}

interface BuildConfig {
  repositoryName: string;      // GitHub repository name
  dockerVolumeName: string;    // Docker volume name
  dockerBuildPath: string;     // Path to docker-build directory
}

type LogFunction = (
  message: string,
  type?: 'info' | 'success' | 'error' | 'warning'
) => void;
```

### Integration Example: Electron App

```typescript
// In your Electron main process
import { setupProject, buildProject, extractBuild } from './scripts/docker-build-lib';

ipcMain.handle('build-project', async (event, projectInfo) => {
  const config = {
    repositoryName: 'lvgl-simulator-for-studio-docker-build',
    dockerVolumeName: 'lvgl-simulator',
    dockerBuildPath: path.join(__dirname, '../docker-build'),
  };

  // Send log messages to renderer process
  const log = (message: string, type?: string) => {
    mainWindow.webContents.send('log-message', { text: message, type });
  };

  try {
    await setupProject(projectInfo, config, log);
    await buildProject(projectInfo, config, log);
    await extractBuild('/output/path', config, log);
    return { success: true };
  } catch (error) {
    log(error.message, 'error');
    return { success: false, error: error.message };
  }
});
```

This architecture allows the build logic to be shared between the CLI tool, Electron app, and any other tools you create.

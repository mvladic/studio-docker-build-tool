# EEZ Studio Docker Build Tool

Electron application for building EEZ Studio projects using Docker and Emscripten.

## Installation

```powershell
npm install
```

## Running the Application

```powershell
npm start
```

For development mode with DevTools:

```powershell
npm run dev
```

## Prerequisites

- Docker Desktop must be installed and running
- Windows 10/11 (macOS and Linux support planned)

## Features

- **Project Selection**: Browse and select .eez-project files with recent projects list
- **Sequential Workflow**: Setup → Build → Test with visual status indicators
- **Docker Integration**: Automated Docker volume management and builds
- **File Watching**: Automatically detects changes and prompts for rebuild
- **Test Server**: Built-in web server with live preview and console output
- **Resizable Panels**: Customizable layout with draggable splitters
- **Log Management**: Searchable, filterable logs with timestamps

## Workflow

1. **Select Project**: Choose your .eez-project file
2. **Setup**: Initialize Docker environment and copy source files
3. **Build**: Compile the project with Emscripten
4. **Test**: Extract and run the compiled WebAssembly application

## Project Structure

```
src/
  main/
    main.js          # Electron main process
    preload.js       # IPC bridge
  renderer/
    index.html       # Main UI
    app.js           # UI logic
    styles.css       # Styling
docker-build/
  Dockerfile         # Docker environment
  docker-compose.yml # Docker services
  build.sh           # Build script
```

## Troubleshooting

### Docker Not Found
- Install Docker Desktop from https://www.docker.com/products/docker-desktop
- Ensure Docker Desktop is running

### Build Failures
- Check Docker logs in the output panel
- Verify src/ui folder exists next to .eez-project file
- Ensure LVGL version is supported (8.4.0, 9.2.2, 9.3.0, 9.4.0)

### Port Conflicts
- The test server automatically finds available ports starting from 3000
- If issues persist, close other applications using those ports

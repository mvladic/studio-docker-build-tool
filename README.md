# EEZ Studio Docker Build Tool

<div align="center">
  <img src="assets/icon.png" alt="EEZ Studio Docker Build Tool" width="128" height="128">
  <p>Electron application for building EEZ Studio LVGL projects using Docker and Emscripten</p>
</div>

![Screenshot](assets/screenshot.png)

## Features

- **Run All Workflow**: One-click Setup → Build → Test sequence with automatic error handling
- **Project Management**: Browse .eez-project files with recent projects list and clipboard paste
- **Docker Integration**: Automated volume management with per-project Emscripten cache
- **File Watching**: Auto-detect changes in eez-project and src/ui, prompt for rebuild
- **Test Server**: Built-in web server with live preview, console output, and cache-busting
- **Tabbed Interface**: Separate views for build logs and test preview/console
- **Duration Tracking**: See how long each operation takes
- **Smart Logs**: Searchable, filterable logs with timestamps, word wrap, and autoscroll
- **Resizable Panels**: Customizable layout with draggable splitters
- **Persistent Settings**: Remembers last project, panel sizes, and log preferences

## Prerequisites

- **Docker Desktop**: Must be installed and running
  - Download: https://www.docker.com/products/docker-desktop
- **Supported Platforms**: Windows, macOS, Linux
- **LVGL Versions**: 8.4.0, 9.2.2, 9.3.0, 9.4.0

## Installation

```bash
npm install
```

## Running the Application

```bash
npm start
```

For development mode with DevTools:

```bash
npm run dev
```

## Building Distributables

Build for all platforms:
```bash
npm run build
```

Build for specific platform:
```bash
npm run build:win    # Windows (NSIS installer + portable)
npm run build:mac    # macOS (DMG + ZIP)
npm run build:linux  # Linux (AppImage + DEB)
```

Output will be in the `dist/` folder.

## Workflow

### Quick Start (Run All)
1. **Select Project**: Choose your .eez-project file or paste path
2. **Click "Run All"**: Automatically runs Setup → Build → Test
3. **View Results**: Switch between Logs and Preview+Console tabs

### Manual Workflow
1. **Setup**: Initialize Docker environment and copy source files
2. **Build**: Compile the project with Emscripten
3. **Test**: Extract and run the compiled WebAssembly application

### File Watching
- Changes detected in `eez-project` or `src/ui` trigger notification
- Click **Rebuild** to run full workflow automatically
- Or **Dismiss** to ignore changes

## Project Structure

```
src/
  main/
    main.js          # Electron main process
    preload.js       # IPC bridge
  renderer/
    index.html       # Main UI
    app.js           # UI logic and state management
    styles.css       # Styling
docker-build/
  Dockerfile         # Docker environment setup
  docker-compose.yml # Docker services with named volumes
  build.sh           # Emscripten build script
assets/
  icon.png           # Application icon (Linux)
  icon.ico           # Application icon (Windows)
  icon.icns          # Application icon (macOS)
```

## Docker Volumes

The tool uses named volumes for efficient builds:
- `v840-no-flow`, `v840-with-flow` - LVGL 8.4.0 caches
- `v922-no-flow`, `v922-with-flow` - LVGL 9.2.2 caches
- `v930-no-flow`, `v930-with-flow` - LVGL 9.3.0 caches
- `v940-no-flow`, `v940-with-flow` - LVGL 9.4.0 caches

Each project gets its own persistent Emscripten cache for faster rebuilds.

## Keyboard Shortcuts

- **Ctrl+V** (in project path field): Paste clipboard path
- **Search logs**: Type in search field to filter

## Troubleshooting

### Docker Not Found
- Install Docker Desktop from https://www.docker.com/products/docker-desktop
- Ensure Docker Desktop is running before launching the app

### Build Failures
- Check Docker logs in the Logs tab
- Verify `src/ui` folder exists next to .eez-project file
- Ensure LVGL version is supported (8.4.0, 9.2.2, 9.3.0, 9.4.0)
- Check that eez-project-file includes valid LVGL configuration

### Test Server Issues
- The test server automatically finds available ports starting from 3000
- If preview doesn't load, check browser console in the Console tab
- Click Stop Test and Start Test again to refresh

### Volume Cleanup
If you need to reset Docker volumes:
```bash
docker volume ls | grep 'v840\|v922\|v930\|v940'
docker volume rm <volume-name>
```

## License

MIT License - see [LICENSE](LICENSE) file for details

## Development

See [DEVELOPMENT.md](DEVELOPMENT.md) for development guidelines and architecture details.

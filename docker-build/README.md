# Docker + Emscripten Build for EEZ Projects

Fast Emscripten builds using Docker with native Linux filesystem performance.

Supports multiple LVGL projects with separate volumes:
- v840-no-flow / v840-with-flow
- v922-no-flow / v922-with-flow
- v930-no-flow / v930-with-flow
- v940-no-flow / v940-with-flow

## Prerequisites

- Docker Desktop running on Windows

## Important

**Always set `$env:PROJECT_VOLUME` before running commands** to avoid errors:
```powershell
$env:PROJECT_VOLUME="v922-with-flow"  # Choose from: v840-no-flow, v840-with-flow, v922-no-flow, v922-with-flow, v930-no-flow, v930-with-flow, v940-no-flow, v940-with-flow
```

## One-Time Setup

### 1. Build Docker Image (once for all projects)
```powershell
docker-compose build
```

### 2. Setup Projects

For each project, clone the repository and copy the build script.

**Template:**
```powershell
$env:PROJECT_VOLUME="<project-name>"
docker-compose run --rm emscripten-build bash -c "git clone --recursive https://github.com/mvladic/<project-name> ."
$containerId = docker-compose run -d emscripten-build sleep 60
docker cp build.sh ${containerId}:/project/build.sh
docker stop $containerId
```

**Examples for all projects:**

```powershell
# v840-no-flow
$env:PROJECT_VOLUME="v840-no-flow"
docker-compose run --rm emscripten-build bash -c "git clone --recursive https://github.com/mvladic/v840-no-flow ."
$containerId = docker-compose run -d emscripten-build sleep 60
docker cp build.sh ${containerId}:/project/build.sh
docker stop $containerId

# v840-with-flow
$env:PROJECT_VOLUME="v840-with-flow"
docker-compose run --rm emscripten-build bash -c "git clone --recursive https://github.com/mvladic/v840-with-flow ."
$containerId = docker-compose run -d emscripten-build sleep 60
docker cp build.sh ${containerId}:/project/build.sh
docker stop $containerId

# v922-no-flow
$env:PROJECT_VOLUME="v922-no-flow"
docker-compose run --rm emscripten-build bash -c "git clone --recursive https://github.com/mvladic/v922-no-flow ."
$containerId = docker-compose run -d emscripten-build sleep 60
docker cp build.sh ${containerId}:/project/build.sh
docker stop $containerId

# v922-with-flow
$env:PROJECT_VOLUME="v922-with-flow"
docker-compose run --rm emscripten-build bash -c "git clone --recursive https://github.com/mvladic/v922-with-flow ."
$containerId = docker-compose run -d emscripten-build sleep 60
docker cp build.sh ${containerId}:/project/build.sh
docker stop $containerId

# v930-no-flow
$env:PROJECT_VOLUME="v930-no-flow"
docker-compose run --rm emscripten-build bash -c "git clone --recursive https://github.com/mvladic/v930-no-flow ."
$containerId = docker-compose run -d emscripten-build sleep 60
docker cp build.sh ${containerId}:/project/build.sh
docker stop $containerId

# v930-with-flow
$env:PROJECT_VOLUME="v930-with-flow"
docker-compose run --rm emscripten-build bash -c "git clone --recursive https://github.com/mvladic/v930-with-flow ."
$containerId = docker-compose run -d emscripten-build sleep 60
docker cp build.sh ${containerId}:/project/build.sh
docker stop $containerId

# v940-no-flow
$env:PROJECT_VOLUME="v940-no-flow"
docker-compose run --rm emscripten-build bash -c "git clone --recursive https://github.com/mvladic/v940-no-flow ."
$containerId = docker-compose run -d emscripten-build sleep 60
docker cp build.sh ${containerId}:/project/build.sh
docker stop $containerId

# v940-with-flow
$env:PROJECT_VOLUME="v940-with-flow"
docker-compose run --rm emscripten-build bash -c "git clone --recursive https://github.com/mvladic/v940-with-flow ."
$containerId = docker-compose run -d emscripten-build sleep 60
docker cp build.sh ${containerId}:/project/build.sh
docker stop $containerId
```

## Build Project

### Build any project
```powershell
$env:PROJECT_VOLUME="v922-with-flow"  # Set your project
docker-compose run --rm emscripten-build bash build.sh
```

### Examples for different projects
```powershell
# v840-no-flow
$env:PROJECT_VOLUME="v840-no-flow"
docker-compose run --rm emscripten-build bash build.sh

# v930-with-flow
$env:PROJECT_VOLUME="v930-with-flow"
docker-compose run --rm emscripten-build bash build.sh

# v940-no-flow
$env:PROJECT_VOLUME="v940-no-flow"
docker-compose run --rm emscripten-build bash build.sh
```

Output: `index.html`, `index.js`, `index.wasm` in the `build/` directory inside the Docker volume.

**Tip:** Set the environment variable once per PowerShell session:
```powershell
$env:PROJECT_VOLUME="v922-with-flow"  # All subsequent commands use this project
docker-compose run --rm emscripten-build bash build.sh
# ... more commands for the same project
```

## Extract Build Output to Windows

```powershell
$env:PROJECT_VOLUME="v922-with-flow"  # Set your project
docker-compose run --rm emscripten-build tar -czf - build | tar -xzf - -C .
```

Or copy specific files:
```powershell
$env:PROJECT_VOLUME="v922-with-flow"
$containerId = docker-compose run -d emscripten-build sleep 10
docker cp ${containerId}:/project/build ./output
docker stop $containerId
```

## Edit Files Inside Docker Volume

**Option 1**: VS Code with Dev Containers extension
- Install "Dev Containers" extension
- Click green icon (bottom-left) → "Attach to Running Container"
- Open `/project` folder

**Option 2**: Shell into container
```powershell
$env:PROJECT_VOLUME="v922-with-flow"  # Select your project
docker-compose run --rm emscripten-build
```

## Clean Build

```powershell
$env:PROJECT_VOLUME="v922-with-flow"
docker-compose run --rm emscripten-build bash -c "rm -rf build && bash build.sh"
```

## Reset Specific Project

```powershell
docker volume rm docker-test_v922-with-flow  # Delete specific project volume
docker volume rm docker-test_v840-no-flow    # Another example
```

Or delete all volumes:
```powershell
docker-compose down -v
```

Then repeat one-time setup steps.

## List Available Projects

```powershell
docker volume ls | Select-String "docker-test"
```

You should see:
- docker-test_v840-no-flow
- docker-test_v840-with-flow
- docker-test_v922-no-flow
- docker-test_v922-with-flow
- docker-test_v930-no-flow
- docker-test_v930-with-flow
- docker-test_v940-no-flow
- docker-test_v940-with-flow

## Why Docker Volume?

Using Docker named volumes stores files in Docker's native Linux filesystem, providing **5-10x faster builds** compared to mounting Windows NTFS folders. Each project gets its own isolated volume for clean separation.

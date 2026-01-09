I did some setuping (here: C:\Work\eez\docker-test) to use Docker Desktop for testing eez-project files created with EEZ Studio.

File eez-project is JSON file which has lvglVersion string field with possible values: "8.4.0", "9.2.2", "9.3.0" and "9.4.0".

Also there is a boolean field called flowSupport.

Depending of these two fields, appropriete github project is used. For example, if lvglVersion is "8.4.0" and flowSupport is false, project https://github.com/mvladic/v840-no-flow will be used.

Also next to the eez-project file there will be src\ui directory with bunch of *.c and *.h files, like this:

```
my-project.eez-project
src\
  ui\
    screens.c
    screens.h
    ui.c
    ui.h
    ...
```

All these files will be somewhere on my local file system.

I want to write Electron application that will use Docker to build ezz-projects.

This application should be portable: Win, MacOS and Linux. But, for now I will develop it and use it on the Windows.

Here is the functional specification for this app:

- In the main renderer window there will be two panels.
- Panel on the left will be used for interaction with the user
- Panel on the right will be for the log messages or output from stdout when external tools are started like docker-compose
- There will be splitter between these two panels so that user can resize each
- On the left panel there will be:
    - Field for user to select the location of eez-project file path (for example: c:\eez-projects\my-project\my-project.eez-project)
    - Setup section
        - By pressing button in this section it will detect lvglVersion and flowSupport and select appropriete project (v840-no-flow, v840-with-flow, etc)
        - It will setup docker to use this project (see C:\Work\eez\docker-test)
        - Then it will replace the contents of the src/ui in docker volume with the context of src\ui folder on the local filesystem (next to .eez-project file)
        - In the right panel there will be output of docker-compose, copy files messages, etc
    - Build section
        - When setup is succesfully done, user can continue with build
        - By pressing button in this section it will start building the project using docker
        - In the right panel there will be output, so we can see how building progresses
    - Test section
        - When building is successfully done, user can continue with testing
        - Application should extract these files from build folder from docker volume: index.html, index.js and index.wasm
        - When button is pressed in this section it should serve this files
        - Right panel should be now splitted in two sections
            - On the top it will show index.html (maybe using iframe or something what you choose)
            - On the bottom it will show console.log messages from index.html

## Additional Requirements

### Error Handling
- When any operation fails (Docker not running, invalid files, build errors), inform the user with clear instructions on how to fix the issue
- Detect if Docker Desktop is installed and running
  - If Docker is not installed: provide instructions with link to Docker Desktop download page
  - If Docker is not running: prompt user to start Docker Desktop

### Workflow State Management
- The workflow must be sequential: Setup → Build → Test
- Each section should be disabled until the previous one completes successfully
- Show visual indicators (checkmarks, status badges) for completed steps

### File Watching
- Monitor changes to .eez-project file and src\ui folder
- When changes are detected, show a notification/banner offering to rebuild
- User can choose to rebuild or dismiss the notification

### Recent Projects
- Maintain a list of recently used .eez-project files (e.g., last 10 projects)
- Show this list in a dropdown or menu for quick access
- Store preferences in user's app data folder

### Port Management (for Test section)
- Use dynamic port allocation (find available port)
- Start with default port 3000, fallback to 3001, 3002, etc. if occupied
- Display the serving URL in the log panel (e.g., "Serving at http://localhost:3000")
- Stop the server when user closes test or switches to a different project

### Console Output Management
- Group log messages by type (errors, warnings, info, docker output)
- Provide expand/collapse functionality for each group
- Add toolbar with:
  - Search/filter textbox
  - Clear button
  - Timestamp toggle (show/hide timestamps)
  - Auto-scroll toggle (scroll to bottom on new messages)
  - Word wrap toggle

## GitHub Project Mappings

Based on lvglVersion and flowSupport fields in .eez-project file:

| lvglVersion | flowSupport | Project Name    | GitHub Repository                              |
|-------------|-------------|-----------------|-----------------------------------------------|
| 8.4.0       | false       | v840-no-flow    | https://github.com/mvladic/v840-no-flow      |
| 8.4.0       | true        | v840-with-flow  | https://github.com/mvladic/v840-with-flow    |
| 9.2.2       | false       | v922-no-flow    | https://github.com/mvladic/v922-no-flow      |
| 9.2.2       | true        | v922-with-flow  | https://github.com/mvladic/v922-with-flow    |
| 9.3.0       | false       | v930-no-flow    | https://github.com/mvladic/v930-no-flow      |
| 9.3.0       | true        | v930-with-flow  | https://github.com/mvladic/v930-with-flow    |
| 9.4.0       | false       | v940-no-flow    | https://github.com/mvladic/v940-no-flow      |
| 9.4.0       | true        | v940-with-flow  | https://github.com/mvladic/v940-with-flow    |

## Docker Configuration

The application uses Docker volumes for fast native Linux filesystem performance (5-10x faster than mounting Windows folders).

### Docker Compose Setup
- Service: `emscripten-build`
- Base image: `emscripten/emsdk:3.1.51`
- Each project variant has its own named Docker volume
- Working directory: `/project`

### Setup Process (automated by app)
1. Build Docker image (once): `docker-compose build`
2. For selected project (based on .eez-project):
   - Set `$env:PROJECT_VOLUME` to project name (e.g., "v922-with-flow")
   - Clone GitHub repository: `git clone --recursive https://github.com/mvladic/<project-name> .`
   - Copy build.sh script to container
3. Replace src/ui folder contents with user's local src\ui files

### Build Process (automated by app)
- Run: `docker-compose run --rm emscripten-build bash build.sh`
- Output: `index.html`, `index.js`, `index.wasm` in `build/` directory inside Docker volume

### Extract Build Output (automated by app)
- Use tar to extract: `docker-compose run --rm emscripten-build tar -czf - build | tar -xzf - -C .`
- Or copy files: Start temporary container, use `docker cp`, then stop container

## Technical Reference

Reference docker-build folder contains:
- `Dockerfile` - Emscripten build environment
- `docker-compose.yml` - Service and volume definitions
- `build.sh` - Build script (CMake + make)
- `README.md` - Manual operation instructions



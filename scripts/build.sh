#!/bin/bash

# Get script directory and change to it
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Parse command line arguments
LVGL_VERSION=""
DISPLAY_WIDTH=""
DISPLAY_HEIGHT=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --lvgl=*)
            LVGL_VERSION="${1#*=}"
            shift
            ;;
        --display-width=*)
            DISPLAY_WIDTH="${1#*=}"
            shift
            ;;
        --display-height=*)
            DISPLAY_HEIGHT="${1#*=}"
            shift
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Check if mandatory argument is provided
if [ -z "$LVGL_VERSION" ]; then
    echo "Error: --lvgl argument is mandatory"
    echo "Usage: ./build.sh --lvgl=<version> [--display-width=<width>] [--display-height=<height>]"
    exit 1
fi

# Set environment variables if display dimensions are provided
if [ -n "$DISPLAY_WIDTH" ]; then
    export DISPLAY_WIDTH
fi

if [ -n "$DISPLAY_HEIGHT" ]; then
    export DISPLAY_HEIGHT
fi

# Construct source directory path
SOURCE_DIR="versions/${LVGL_VERSION}"

# Check if source directory exists
if [ ! -d "$SOURCE_DIR" ]; then
    echo "Error: Directory $SOURCE_DIR does not exist"
    exit 1
fi

# Copy files from version directory to root (only if changed)
echo "Copying files from $SOURCE_DIR to root..."
for file in "$SOURCE_DIR"/*; do
    filename=$(basename "$file")
    if [ ! -f "$filename" ] || ! cmp -s "$file" "$filename"; then
        cp -f "$file" .
        echo "  Updated: $filename"
    fi
done

# Initialize submodules if not already initialized
if [ ! -f "lvgl/.git" ] || [ ! -f "lv_drivers/.git" ]; then
    echo "Initializing submodules..."
    git submodule update --init --recursive
fi

# Checkout the correct lvgl version
cd lvgl
CURRENT_VERSION=$(git describe --tags --exact-match 2>/dev/null || echo "none")
if [ "$CURRENT_VERSION" != "v${LVGL_VERSION}" ]; then
    echo "Checking out lvgl version v${LVGL_VERSION}..."
    git checkout "v${LVGL_VERSION}"
fi
cd ..

# Checkout the correct lv_drivers version (only for LVGL < 9.0)
MAJOR_VERSION=$(echo $LVGL_VERSION | cut -d. -f1)
if [ "$MAJOR_VERSION" -lt 9 ]; then
    cd lv_drivers
    # Extract major.minor version (e.g., 8.4.0 -> 8.3 for lv_drivers)
    MINOR_VERSION=$(echo $LVGL_VERSION | cut -d. -f2)
    # For lv_drivers, try to find the closest matching release branch
    TARGET_BRANCH=""
    if git show-ref --verify --quiet refs/remotes/origin/release/v${MAJOR_VERSION}.${MINOR_VERSION}; then
        TARGET_BRANCH="release/v${MAJOR_VERSION}.${MINOR_VERSION}"
    else
        # Fallback to the latest matching major.minor tag or branch available
        for version in 3 2 1 0; do
            if git show-ref --verify --quiet refs/remotes/origin/release/v${MAJOR_VERSION}.${version}; then
                TARGET_BRANCH="release/v${MAJOR_VERSION}.${version}"
                break
            fi
        done
    fi
    
    if [ -n "$TARGET_BRANCH" ]; then
        CURRENT_BRANCH=$(git symbolic-ref --short HEAD 2>/dev/null || echo "none")
        if [ "$CURRENT_BRANCH" != "$TARGET_BRANCH" ]; then
            echo "Checking out lv_drivers version $TARGET_BRANCH..."
            git checkout "$TARGET_BRANCH"
        fi
    fi
    cd ..
fi

# Set Emscripten cache directory to local project folder
export EM_CACHE="${SCRIPT_DIR}/.emscripten-cache"

# Create build directory
mkdir -p build
cd build

# Get number of CPU cores
NUM_CORES=$(nproc)

# Run emcmake cmake
echo "Running emcmake cmake..."
emcmake cmake ..
if [ $? -ne 0 ]; then
    echo "CMake configuration failed!"
    exit 1
fi

# Build with make
echo "Building with make -j$NUM_CORES..."
make -j$NUM_CORES
if [ $? -ne 0 ]; then
    echo "Build failed!"
    exit 1
fi

echo "Build completed!"

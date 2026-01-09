#!/bin/bash

set -e

# Set Emscripten cache to persist in project volume
export EM_CACHE=/project/.emscripten-cache
mkdir -p $EM_CACHE

echo "Creating build directory..."
mkdir -p build
cd build

echo "Running CMake with Emscripten..."
emcmake cmake ..

echo "Building project..."
emmake make -j$(nproc)

echo "Build completed! Output files are in the build directory."
echo "Main output: build/index.html"

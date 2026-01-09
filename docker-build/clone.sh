#!/bin/bash
set -e

REPO_URL=$1

echo "Cleaning project directory..."
cd /project
find . -mindepth 1 -delete 2>/dev/null || true

echo "Cloning from $REPO_URL..."
if ! git clone "$REPO_URL" /project; then
  echo "ERROR: Git clone failed"
  exit 1
fi

echo "Initializing submodules..."
cd /project
if ! git submodule update --init --recursive; then
  echo "ERROR: Submodule init failed"
  exit 1
fi

echo "Done!"
exit 0

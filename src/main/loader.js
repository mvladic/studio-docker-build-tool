// Loader to enable TypeScript support in Electron
const path = require('path');
const fs = require('fs');

// Check if we're in development (TypeScript files exist) or production (compiled files exist)
const mainTsPath = path.join(__dirname, 'main.ts');
const mainJsPath = path.join(__dirname, '../../dist/src/main/main.js');

if (fs.existsSync(mainJsPath)) {
  // Production: use compiled JavaScript
  require(mainJsPath);
} else if (fs.existsSync(mainTsPath)) {
  // Development: use TypeScript with ts-node
  require('ts-node/register/transpile-only');
  require('./main.ts');
} else {
  throw new Error('Main file not found in either development or production mode');
}

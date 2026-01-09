const png2icons = require('png2icons');
const fs = require('fs');
const path = require('path');

const input = fs.readFileSync(path.join(__dirname, 'assets', 'icon.png'));

// Generate ICO for Windows
const icoBuffer = png2icons.createICO(input, png2icons.BICUBIC, 0, false);
if (icoBuffer) {
  fs.writeFileSync(path.join(__dirname, 'assets', 'icon.ico'), icoBuffer);
  console.log('✓ Created icon.ico');
}

// Generate ICNS for macOS
const icnsBuffer = png2icons.createICNS(input, png2icons.BICUBIC, 0);
if (icnsBuffer) {
  fs.writeFileSync(path.join(__dirname, 'assets', 'icon.icns'), icnsBuffer);
  console.log('✓ Created icon.icns');
}

console.log('✓ All icons generated successfully!');

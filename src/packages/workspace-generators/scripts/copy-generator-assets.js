const fs = require('node:fs')
const path = require('node:path')

const SRC_DIR = path.join(__dirname, '../src')
const DIST_DIR = path.join(__dirname, '../dist')

function copyGeneratorAssets(srcDir, distDir) {
  let count = 0
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = path.join(srcDir, entry.name)
    const distPath = path.join(distDir, entry.name)
    if (entry.isDirectory()) {
      count += copyGeneratorAssets(srcPath, distPath)
    } else if (!entry.name.endsWith('.ts')) {
      fs.mkdirSync(path.dirname(distPath), { recursive: true })
      fs.copyFileSync(srcPath, distPath)
      count++
    }
  }
  return count
}

console.log(`Copied ${copyGeneratorAssets(SRC_DIR, DIST_DIR)} generator assets from src/ to dist/`)

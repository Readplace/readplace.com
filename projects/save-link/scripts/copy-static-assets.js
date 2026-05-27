/**
 * Copy Static Assets Script
 *
 * Cross-platform replacement for rsync to copy non-TypeScript files from src/ to dist/.
 * Copies: *.md
 *
 * This script exists because rsync is not available on all platforms (e.g., Windows,
 * some CI environments). Node.js fs operations work everywhere.
 */
const fs = require('fs')
const path = require('path')

const SRC_DIR = path.join(__dirname, '../src')
const DIST_DIR = path.join(__dirname, '../dist')

const EXTENSIONS = ['.md', '.html']

function shouldCopy(filePath) {
  return EXTENSIONS.some(ext => filePath.endsWith(ext))
}

function copyStaticAssets(srcDir, distDir) {
  const entries = fs.readdirSync(srcDir, { withFileTypes: true })

  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name)
    const distPath = path.join(distDir, entry.name)

    if (entry.isDirectory()) {
      copyStaticAssets(srcPath, distPath)
    } else if (shouldCopy(entry.name)) {
      fs.mkdirSync(path.dirname(distPath), { recursive: true })
      fs.copyFileSync(srcPath, distPath)
      console.log(`${path.relative(SRC_DIR, srcPath)} -> ${path.relative(DIST_DIR, distPath)}`)
    }
  }
}

console.log('Copying static assets from src/ to dist/...')
copyStaticAssets(SRC_DIR, DIST_DIR)
console.log('Done.')

/**
 * Copy Static Assets Script
 *
 * Cross-platform replacement for rsync to copy non-TypeScript files from src/ to dist/.
 * Copies: *.css, *.html, *.json, *.md, *.txt
 *
 * This script exists because rsync is not available on all platforms (e.g., Windows,
 * some CI environments). Node.js fs operations work everywhere.
 */
const fs = require('fs')
const path = require('path')

const SRC_DIR = path.join(__dirname, '../src')
const DIST_DIR = path.join(__dirname, '../dist')

const EXTENSIONS = ['.css', '.html', '.js', '.json', '.map', '.md', '.txt']
const isCI = process.env.CI === 'true'

function shouldCopy(filePath) {
  return EXTENSIONS.some(ext => filePath.endsWith(ext))
}

function copyStaticAssets(srcDir, distDir) {
  let count = 0
  const entries = fs.readdirSync(srcDir, { withFileTypes: true })

  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name)
    const distPath = path.join(distDir, entry.name)

    if (entry.isDirectory()) {
      count += copyStaticAssets(srcPath, distPath)
    } else if (shouldCopy(entry.name)) {
      fs.mkdirSync(path.dirname(distPath), { recursive: true })
      fs.copyFileSync(srcPath, distPath)
      if (!isCI) {
        console.log(`${path.relative(SRC_DIR, srcPath)} -> ${path.relative(DIST_DIR, distPath)}`)
      }
      count++
    }
  }
  return count
}

console.log('Copying static assets from src/ to dist/...')
const copied = copyStaticAssets(SRC_DIR, DIST_DIR)
console.log(`Done. Copied ${copied} files.`)

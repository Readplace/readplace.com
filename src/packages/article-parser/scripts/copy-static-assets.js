/**
 * Cross-platform copy of non-TypeScript test fixtures (HTML samples that
 * `readability-parser.test.ts` reads via `readFileSync`) from src/ to dist/
 * so jest finds them at the same relative path as the compiled .test.js.
 */
const fs = require('fs')
const path = require('path')

const SRC_DIR = path.join(__dirname, '../src')
const DIST_DIR = path.join(__dirname, '../dist')

const EXTENSIONS = ['.html']

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

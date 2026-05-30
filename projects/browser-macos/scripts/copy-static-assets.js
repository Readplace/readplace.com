/**
 * Copy non-TypeScript runtime assets into dist so the compiled app can load
 * them with the same relative paths it uses in source. tsc only emits .js/.d.ts
 * for .ts inputs; the renderer's HTML/CSS/JS and the reader stylesheet are
 * plain assets that must be carried over verbatim.
 */
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const srcRoot = path.join(projectRoot, 'src');
const distSrcRoot = path.join(projectRoot, 'dist', 'src');

const ASSET_EXTENSIONS = new Set(['.html', '.css', '.client.js', '.png']);

function isAsset(fileName) {
  if (fileName.endsWith('.client.js')) return true;
  return ASSET_EXTENSIONS.has(path.extname(fileName));
}

function copyAssets(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const sourcePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      copyAssets(sourcePath);
      continue;
    }
    if (!isAsset(entry.name)) continue;
    const relative = path.relative(srcRoot, sourcePath);
    const destination = path.join(distSrcRoot, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(sourcePath, destination);
    console.log(`[browser-macos] copied asset ${relative}`);
  }
}

copyAssets(srcRoot);

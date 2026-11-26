const path = require('path')
const { copyStaticAssets } = require('@packages/test-phase-runner')

copyStaticAssets({
  srcDir: path.join(__dirname, '../src'),
  distDir: path.join(__dirname, '../dist'),
  extensions: ['.css', '.html', '.md', '.txt'],
  log: console.log,
})

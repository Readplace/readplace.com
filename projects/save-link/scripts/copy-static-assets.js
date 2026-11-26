const path = require('path')
const { copyStaticAssets } = require('@packages/test-phase-runner')

copyStaticAssets({
  srcDir: path.join(__dirname, '../src'),
  distDir: path.join(__dirname, '../dist'),
  extensions: ['.md', '.html', '.pdf', '.json'],
  log: console.log,
})

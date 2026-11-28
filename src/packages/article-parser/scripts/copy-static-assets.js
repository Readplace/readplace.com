const path = require('path')
const { copyStaticAssets } = require('@packages/test-phase-runner')
const { Logger, consoleLogger } = require('@packages/logger')

const logger = Logger.from(consoleLogger)

copyStaticAssets({
  srcDir: path.join(__dirname, '../src'),
  distDir: path.join(__dirname, '../dist'),
  extensions: ['.html'],
  log: (message) => logger.info(message),
})

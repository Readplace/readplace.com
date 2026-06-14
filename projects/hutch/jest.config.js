const baseConfig = require('../../jest.config.base');

// jsdom is pinned to 26.x in package.json. From v27 jsdom loads, via
// html-encoding-sniffer@6, the ESM-only @exodus/bytes package; this pre-compiled,
// transform-free CommonJS Jest runtime cannot evaluate it and fails every
// jsdom-importing suite with "Unexpected token 'export'". Raising the pin first
// requires a Jest ESM (or scoped node_modules transform) strategy.
/** @type {import('jest').Config} */
module.exports = {
  ...baseConfig,
};

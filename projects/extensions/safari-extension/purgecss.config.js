const base = require('../../../purgecss.config.base.js');

/** @type {import('purgecss').UserDefinedOptions} */
module.exports = {
  ...base,
  css: [
    ...base.css,
    '../../browser-extension-core/src/**/*.styles.css',
  ],
};

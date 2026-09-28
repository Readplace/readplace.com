const base = require('../../../purgecss.config.base.js');

/** @type {import('purgecss').UserDefinedOptions} */
module.exports = {
  ...base,
  css: [
    ...base.css,
    '../browser-extension-core/src/**/*.styles.css',
  ],
  content: [
    ...base.content,
    '../browser-extension-core/src/**/*.template.html',
    '../browser-extension-core/src/popup/popup.browser.ts',
  ],
};

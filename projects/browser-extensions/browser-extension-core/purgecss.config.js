const base = require('../../../purgecss.config.base.js');

/** @type {import('purgecss').UserDefinedOptions} */
module.exports = {
  ...base,
  content: [
    ...base.content,
    '../*-extension/src/**/*.template.html',
  ],
};

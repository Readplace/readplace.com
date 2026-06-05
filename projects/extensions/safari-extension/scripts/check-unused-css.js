const { checkUnusedCss } = require('@packages/check-unused-css');
const config = require('../purgecss.config.js');

checkUnusedCss({ config });

module.exports = {
  projectName: 'Save Link',
  phases: [
    {
      type: 'jest',
      name: 'Running unit tests',
      testMatch: '**/dist/**/*.test.js',
      timeout: 10000,
    },
    {
      // e2e flag — integration tests here need binaries the sandbox lacks
      // (tesseract, pdftoppm) or real AWS credentials. Each suite also skips
      // itself when its own prerequisite is missing, so a developer without
      // them still gets a green run rather than a failure they cannot act on.
      type: 'node-test',
      name: 'Running integration tests',
      glob: 'dist/**/*.integration.js',
      e2e: true,
    },
  ],
};

module.exports = {
  projectName: 'Media Audio',
  phases: [
    {
      type: 'jest',
      name: 'Running unit tests',
      testMatch: '**/dist/**/*.test.js',
      timeout: 10000,
    },
    {
      type: 'node-test',
      name: 'Running music-metadata adapter tests',
      glob: 'dist/**/*.node-test.js',
    },
  ],
};

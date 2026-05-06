module.exports = {
  projectName: '@packages/app',
  phases: [
    {
      type: 'jest',
      name: 'Running unit tests',
      testMatch: '**/dist/**/*.test.js',
      timeout: 10000,
    },
    {
      type: 'jest',
      name: 'Running integration tests',
      testMatch: '**/dist/**/*.integration.js',
      timeout: 30000,
      passWithNoTests: true,
    },
  ],
};

// Safari E2E requires a macOS host (safaridriver), so it cannot run on the
// Linux CI runner that executes `pnpm check`. Only the portable unit phase runs
// here; the Safari end-to-end flow is exercised manually on a Mac (see README).
module.exports = {
  projectName: 'Safari Extension',
  phases: [
    {
      type: 'jest',
      name: 'Running unit tests',
      testMatch: '**/dist/**/*.test.js',
      testPathIgnorePatterns: 'dist/e2e',
      timeout: 10000,
      passWithNoTests: true,
    },
  ],
};

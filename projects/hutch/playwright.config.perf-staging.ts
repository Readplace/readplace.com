import { defineConfig, devices } from '@playwright/test'

// Deliberately not `createPlaywrightConfig`: that helper hard-codes
// `fullyParallel: true` and `trace: 'on-first-retry'`, either of which turns a
// wall-clock measurement into a measurement of contention or of tracing overhead.
export default defineConfig({
	testDir: './src/e2e',
	testMatch: '**/*.perf-staging.ts',
	outputDir: './test-results-staging/perf-failures',
	fullyParallel: false,
	workers: 1,
	forbidOnly: true,
	// A breached budget is the verdict, not a flake to retry away: a retry would
	// re-run the suite and report whichever attempt happened to pass.
	retries: 0,
	reporter: [['list']],
	globalTimeout: 30 * 60 * 1000,
	timeout: 20 * 60 * 1000,
	use: {
		baseURL: process.env.STAGING_URL,
		headless: true,
		trace: 'off',
		video: 'off',
		screenshot: 'only-on-failure',
	},
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
	webServer: undefined,
})

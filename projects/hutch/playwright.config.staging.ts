import { createPlaywrightConfig } from './playwright.config.factory'

export default createPlaywrightConfig({
	testMatch: '**/*.e2e-staging.ts',
	outputDir: './test-results-staging',
	baseURL: process.env.STAGING_URL,
	retries: 1,
	headless: true,
	timeout: 300000,
	video: 'off',
	launchOptions: undefined,
	webServer: undefined,
})

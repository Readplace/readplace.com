import { ciArtifactPaths, createPlaywrightConfig } from '@packages/e2e-harness'

const serverUrl = `http://127.0.0.1:${process.env.E2E_PORT || '0'}`

const artifacts = ciArtifactPaths({
	root: process.env.CI_ARTIFACT_ROOT,
	runId: process.env.GITHUB_RUN_ID,
	project: 'admin-dashboards',
})

export default createPlaywrightConfig({
	testMatch: '**/*.e2e-local.ts',
	outputDir: artifacts.outputDir,
	reportDir: './playwright-report',
	galleryDir: './test-results/screenshot-gallery',
	baseURL: serverUrl,
	retries: 0,
	workers: 2,
	headless: process.env.HEADLESS === 'true',
	video: 'off',
	launchOptions: {},
	webServer: {
		command: 'env -u NODE_V8_COVERAGE node dist/runtime/server.main.js',
		stdout: 'pipe',
		stderr: 'pipe',
	},
})

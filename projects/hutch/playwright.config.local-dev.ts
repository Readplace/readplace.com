import { createPlaywrightConfig } from './playwright.config.factory'

// Fallback to port 0 because knip loads this file during lint when E2E_PORT is not set
const serverUrl = `http://localhost:${process.env.E2E_PORT || '0'}`

// `env -u NODE_V8_COVERAGE` strips the env var c8 sets during coverage runs so the e2e
// server's own execution doesn't write coverage data into the jest coverage dir and
// contaminate the summary. See .claude/skills/e2e-testing/SKILL.md.
export default createPlaywrightConfig({
	testMatch: '**/*.e2e-local.ts',
	outputDir: './test-results',
	baseURL: serverUrl,
	retries: 0,
	// Headless explicitly when HEADLESS=true; also default headless in CI where
	// there is no X server (pnpm test:e2e in pnpm check would otherwise crash on
	// 'Missing X server or $DISPLAY'). Local dev keeps headed mode.
	headless: process.env.HEADLESS === 'true' || process.env.CI === 'true',
	video: 'off',
	launchOptions: {},
	webServer: {
		command: 'env -u NODE_V8_COVERAGE node dist/e2e/e2e-server.main.js',
		url: serverUrl,
		stdout: 'pipe',
		stderr: 'pipe',
	},
})

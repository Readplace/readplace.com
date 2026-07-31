import { ciArtifactPaths, createPlaywrightConfig } from '@packages/e2e-harness'

// 127.0.0.1 rather than localhost so the readiness probe reaches the loopback
// listener even where localhost resolves to ::1 first. Fallback to port 0
// because knip loads this file during lint when E2E_PORT is not set.
const serverUrl = `http://127.0.0.1:${process.env.E2E_PORT || '0'}`

const artifacts = ciArtifactPaths({
	root: process.env.CI_ARTIFACT_ROOT,
	runId: process.env.GITHUB_RUN_ID,
	project: 'inbox',
})

// `env -u NODE_V8_COVERAGE` strips the env var c8 sets during coverage runs so the
// inbox server's own execution doesn't write coverage data into the jest coverage
// dir and contaminate the summary. See .claude/skills/e2e-testing/SKILL.md.
export default createPlaywrightConfig({
	testMatch: '**/*.e2e-local.ts',
	outputDir: artifacts.outputDir,
	baseURL: serverUrl,
	retries: 0,
	// Headless explicitly when HEADLESS=true; also default headless in CI where
	// there is no X server. Local dev keeps headed mode.
	headless: process.env.HEADLESS === 'true' || process.env.CI === 'true',
	video: 'off',
	launchOptions: {},
	webServer: {
		// Probe the harness health route: the bare origin 404s (only the inbox
		// router is mounted) and every inbox route redirects an anonymous request
		// to a /login this deployable does not serve.
		command: 'env -u NODE_V8_COVERAGE node dist/e2e/e2e-server.main.js',
		url: `${serverUrl}/e2e/health`,
		stdout: 'pipe',
		stderr: 'pipe',
	},
})

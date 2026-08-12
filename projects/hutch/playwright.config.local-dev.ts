import { ciArtifactPaths, createPlaywrightConfig } from '@packages/e2e-harness'

// Fallback to port 0 because knip loads this file during lint when E2E_PORT is not set
const serverUrl = `http://localhost:${process.env.E2E_PORT || '0'}`

const artifacts = ciArtifactPaths({
	root: process.env.CI_ARTIFACT_ROOT,
	runId: process.env.GITHUB_RUN_ID,
	project: 'hutch',
})
process.env.TRANSITION_FRAMES_DIR = artifacts.transitionFramesDir

// `env -u NODE_V8_COVERAGE` strips the env var c8 sets during coverage runs so the e2e
// server's own execution doesn't write coverage data into the jest coverage dir and
// contaminate the summary. See .claude/skills/e2e-testing/SKILL.md.
export default createPlaywrightConfig({
	testMatch: '**/*.e2e-local.ts',
	outputDir: artifacts.outputDir,
	baseURL: serverUrl,
	retries: 0,
	headless: process.env.HEADLESS === 'true',
	video: 'off',
	launchOptions: {},
	webServer: {
		command: 'env -u NODE_V8_COVERAGE E2E_SAVE_PIPELINE=inline node dist/e2e/e2e-server.main.js',
		stdout: 'pipe',
		stderr: 'pipe',
	},
})

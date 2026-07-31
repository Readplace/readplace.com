import assert from 'node:assert'
import { randomUUID } from 'node:crypto'
import { defineConfig, devices } from '@playwright/test'
import { READY_NONCE_ENV, readyProbePath } from './ready-probe'

interface PlaywrightConfigOptions {
	testMatch: string
	outputDir: string
	baseURL: string | undefined
	retries: number
	headless: boolean
	timeout?: number
	video: 'off' | 'on' | 'retain-on-failure' | 'on-first-retry'
	launchOptions: { slowMo?: number } | undefined
	webServer:
		| {
				command: string
				stdout: 'pipe' | 'ignore'
				stderr: 'pipe' | 'ignore'
			}
		| undefined
}

export const createPlaywrightConfig = (options: PlaywrightConfigOptions) => {
	const readyNonce = randomUUID()
	return defineConfig({
		testDir: './src/e2e',
		testMatch: options.testMatch,
		outputDir: options.outputDir,
		fullyParallel: true,
		forbidOnly: true,
		reporter: 'html',
		retries: options.retries,
		timeout: options.timeout ?? 120000,
		expect: {
			toHaveScreenshot: {
				maxDiffPixelRatio: 0.1,
				threshold: 0.2,
				animations: 'disabled',
				caret: 'hide',
			},
		},
		use: {
			baseURL: options.baseURL,
			trace: 'on-first-retry',
			headless: options.headless,
			screenshot: 'only-on-failure',
			video: options.video,
		},
		projects: [
			{
				name: 'chromium',
				use: {
					...devices['Desktop Chrome'],
					launchOptions: options.launchOptions,
				},
			},
		],
		webServer: options.webServer
			? {
					...options.webServer,
					url: readyProbeUrl(options.baseURL, readyNonce),
					env: { [READY_NONCE_ENV]: readyNonce },
					reuseExistingServer: false,
				}
			: undefined,
	})
}

function readyProbeUrl(baseURL: string | undefined, nonce: string): string {
	assert(baseURL, 'a launched webServer needs a baseURL to build its readiness probe from')
	return `${baseURL}${readyProbePath(nonce)}`
}

import { createPopupVisualConfig } from 'browser-extension-core/popup-visual'

export default createPopupVisualConfig({
	project: 'chrome-extension',
	browser: 'chromium',
	artifactRoot: process.env.CI_ARTIFACT_ROOT,
	runId: process.env.GITHUB_RUN_ID,
	headless: process.env.HEADLESS === 'true',
})

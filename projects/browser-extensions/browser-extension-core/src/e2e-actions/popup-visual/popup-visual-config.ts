import { ciArtifactPaths, createPlaywrightConfig } from "@packages/e2e-harness";

/** The popup is a packaged page loaded over file://, so there is no server to
 * launch and no baseURL to resolve relative paths against. Environment reading
 * stays in each project's `playwright.config.*` file, which is the only place
 * allowed to touch `process.env` directly. */
export function createPopupVisualConfig(input: {
	project: string;
	browser: "chromium" | "firefox";
	artifactRoot: string | undefined;
	runId: string | undefined;
	headless: boolean;
}) {
	return createPlaywrightConfig({
		testMatch: "**/*-visual.e2e-local.ts",
		outputDir: ciArtifactPaths({
			root: input.artifactRoot,
			runId: input.runId,
			project: input.project,
		}).outputDir,
		baseURL: undefined,
		retries: 0,
		browser: input.browser,
		headless: input.headless,
		video: "off",
		launchOptions: {},
		webServer: undefined,
	});
}

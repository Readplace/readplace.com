import assert from "node:assert/strict";
import { createPlaywrightConfig } from "./playwright-config";
import { READY_NONCE_ENV, readyProbePath } from "./ready-probe";

function localConfig() {
	return createPlaywrightConfig({
		testMatch: "**/*.e2e-local.ts",
		outputDir: "./test-results/local",
		baseURL: "http://localhost:4001",
		retries: 0,
		headless: true,
		video: "retain-on-failure",
		launchOptions: { slowMo: 250 },
		webServer: {
			command: "pnpm e2e-server",
			stdout: "pipe",
			stderr: "pipe",
		},
	});
}

describe("createPlaywrightConfig", () => {
	it("starts its own server rather than adopting one already on the port", () => {
		const webServer = localConfig().webServer;
		assert(webServer && !Array.isArray(webServer), "a single webServer is configured");

		expect(webServer.command).toBe("pnpm e2e-server");
		expect(webServer.reuseExistingServer).toBe(false);
	});

	it("probes a readiness URL only the server it launched can answer", () => {
		const webServer = localConfig().webServer;
		assert(webServer && !Array.isArray(webServer), "a single webServer is configured");

		const nonce = webServer.env?.[READY_NONCE_ENV];
		assert(typeof nonce === "string", `${READY_NONCE_ENV} is handed to the server it launches`);
		expect(webServer.url).toBe(`http://localhost:4001${readyProbePath(nonce)}`);
	});

	it("gives every run a nonce of its own so a sibling run's server cannot answer", () => {
		const nonces = Array.from({ length: 5 }, () => {
			const webServer = localConfig().webServer;
			assert(webServer && !Array.isArray(webServer), "a single webServer is configured");
			return webServer.env?.[READY_NONCE_ENV];
		});

		expect(new Set(nonces).size).toBe(5);
	});

	it("runs against an already-deployed target when no server is supplied", () => {
		const config = createPlaywrightConfig({
			testMatch: "**/*.e2e-staging.ts",
			outputDir: "./test-results/staging",
			baseURL: "https://staging.readplace.com",
			retries: 2,
			headless: true,
			video: "off",
			launchOptions: undefined,
			webServer: undefined,
		});

		expect(config.webServer).toBeUndefined();
		expect(config.use?.baseURL).toBe("https://staging.readplace.com");
		expect(config.retries).toBe(2);
	});

	it("holds every suite to the same screenshot comparison tolerances", () => {
		const config = createPlaywrightConfig({
			testMatch: "**/*.e2e-local.ts",
			outputDir: "./test-results/local",
			baseURL: "http://localhost:4001",
			retries: 0,
			headless: false,
			video: "on",
			launchOptions: undefined,
			webServer: undefined,
		});

		expect(config.testDir).toBe("./src/e2e");
		expect(config.testMatch).toBe("**/*.e2e-local.ts");
		expect(config.expect?.toHaveScreenshot).toEqual({
			maxDiffPixelRatio: 0.1,
			threshold: 0.2,
			animations: "disabled",
			caret: "hide",
		});
	});

	it("names the project after the engine it runs, so each engine owns its baselines", () => {
		const shared = {
			testMatch: "**/*-visual.e2e-local.ts",
			outputDir: "./test-results/local",
			baseURL: undefined,
			retries: 0,
			headless: true,
			video: "off",
			launchOptions: undefined,
			webServer: undefined,
		} as const;

		expect(createPlaywrightConfig({ ...shared }).projects?.[0]?.name).toBe("chromium");
		expect(createPlaywrightConfig({ ...shared, browser: "firefox" }).projects?.[0]?.name).toBe(
			"firefox",
		);
		expect(createPlaywrightConfig({ ...shared, browser: "firefox" }).projects?.[0]?.use).toMatchObject(
			{ defaultBrowserType: "firefox" },
		);
	});

	it("falls back to a two-minute test timeout unless the suite asks for its own", () => {
		const shared = {
			testMatch: "**/*.e2e-local.ts",
			outputDir: "./test-results/local",
			baseURL: "http://localhost:4001",
			retries: 0,
			headless: true,
			video: "off",
			launchOptions: undefined,
			webServer: undefined,
		} as const;

		expect(createPlaywrightConfig({ ...shared }).timeout).toBe(120000);
		expect(createPlaywrightConfig({ ...shared, timeout: 45000 }).timeout).toBe(45000);
	});
});

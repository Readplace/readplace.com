import { createPlaywrightConfig } from "./playwright-config";

describe("createPlaywrightConfig", () => {
	it("starts its own server rather than adopting one already on the port", () => {
		const config = createPlaywrightConfig({
			testMatch: "**/*.e2e-local.ts",
			outputDir: "./test-results/local",
			baseURL: "http://localhost:4001",
			retries: 0,
			headless: true,
			video: "retain-on-failure",
			launchOptions: { slowMo: 250 },
			webServer: {
				command: "pnpm e2e-server",
				url: "http://localhost:4001/health",
				stdout: "pipe",
				stderr: "pipe",
			},
		});

		expect(config.webServer).toEqual({
			command: "pnpm e2e-server",
			url: "http://localhost:4001/health",
			stdout: "pipe",
			stderr: "pipe",
			reuseExistingServer: false,
		});
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

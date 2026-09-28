import assert from "node:assert/strict";
import { join } from "node:path";
import { DESIGN_SYSTEM_STYLES } from "@packages/web-shell/design-system.styles";
import { type ExtensionBuildConfig, initBuildExtension } from "./build-extension";

describe("createBuildPlan", () => {
	const projectDir = "/projects/firefox-extension";
	const corePackageJsonPath = "/projects/browser-extensions/browser-extension-core/package.json";

	function createBuildPlan(input: { config: ExtensionBuildConfig; projectDir: string; serverUrl: string; version?: string; appDomains?: readonly string[] }) {
		const { createBuildPlan } = initBuildExtension({
			resolveCorePackageJson: () => corePackageJsonPath,
		});
		return createBuildPlan({ ...input, version: input.version ?? "1.2.3", appDomains: input.appDomains ?? [] });
	}

	it("sets esbuild target from config", () => {
		const plan = createBuildPlan({
			config: { target: "firefox91", utmSource: "firefox-extension" },
			projectDir,
			serverUrl: "https://readplace.com",
		});

		expect(plan.esbuildOptions.target).toBe("firefox91");
	});

	it("uses a different target for chrome", () => {
		const plan = createBuildPlan({
			config: { target: "chrome109", utmSource: "chrome-extension" },
			projectDir,
			serverUrl: "https://readplace.com",
		});

		expect(plan.esbuildOptions.target).toBe("chrome109");
	});

	it("bundles four entry points from src/runtime", () => {
		const plan = createBuildPlan({
			config: { target: "firefox91", utmSource: "firefox-extension" },
			projectDir,
			serverUrl: "https://readplace.com",
		});

		expect(plan.esbuildOptions.entryPoints).toEqual([
			join(projectDir, "src", "runtime", "background", "background.browser.ts"),
			join(projectDir, "src", "runtime", "popup", "popup.browser.ts"),
			join(projectDir, "src", "runtime", "popup", "popup-entry.browser.ts"),
			join(projectDir, "src", "runtime", "content", "shortcut.browser.ts"),
		]);
	});

	it("outputs to dist-extension-compiled", () => {
		const plan = createBuildPlan({
			config: { target: "firefox91", utmSource: "firefox-extension" },
			projectDir,
			serverUrl: "https://readplace.com",
		});

		expect(plan.esbuildOptions.outdir).toBe(join(projectDir, "dist-extension-compiled"));
	});

	it("uses iife format for browser extension scripts", () => {
		const plan = createBuildPlan({
			config: { target: "firefox91", utmSource: "firefox-extension" },
			projectDir,
			serverUrl: "https://readplace.com",
		});

		expect(plan.esbuildOptions.format).toBe("iife");
		expect(plan.esbuildOptions.bundle).toBe(true);
	});

	it("aliases browser-extension-core to source for bundling", () => {
		const plan = createBuildPlan({
			config: { target: "firefox91", utmSource: "firefox-extension" },
			projectDir,
			serverUrl: "https://readplace.com",
		});

		expect(plan.esbuildOptions.alias["browser-extension-core"]).toBe(
			join("/projects/browser-extensions/browser-extension-core", "src", "index.ts"),
		);
	});

	it("defines __SERVER_URL__ as JSON string", () => {
		const plan = createBuildPlan({
			config: { target: "firefox91", utmSource: "firefox-extension" },
			projectDir,
			serverUrl: "https://readplace.com",
		});

		expect(plan.esbuildOptions.define.__SERVER_URL__).toBe('"https://readplace.com"');
	});

	it("defines __APP_DOMAINS__ as a JSON array of configured domains plus localhost", () => {
		const plan = createBuildPlan({
			config: { target: "firefox91", utmSource: "firefox-extension" },
			projectDir,
			serverUrl: "https://readplace.com",
			appDomains: ["readplace.com"],
		});

		expect(plan.esbuildOptions.define.__APP_DOMAINS__).toBe('["readplace.com","127.0.0.1","localhost"]');
	});

	it("includes five output directories", () => {
		const plan = createBuildPlan({
			config: { target: "firefox91", utmSource: "firefox-extension" },
			projectDir,
			serverUrl: "https://readplace.com",
		});

		const outDir = join(projectDir, "dist-extension-compiled");
		expect(plan.directories).toEqual([
			outDir,
			join(outDir, "popup"),
			join(outDir, "background"),
			join(outDir, "content"),
			join(outDir, "icons"),
		]);
	});

	it("renders the popup template from core rather than copying a per-browser one", () => {
		const plan = createBuildPlan({
			config: { target: "firefox91", utmSource: "firefox-extension" },
			projectDir,
			serverUrl: "https://readplace.com",
		});

		expect(plan.popupTemplate).toEqual({
			src: "/projects/browser-extensions/browser-extension-core/src/popup/popup.template.html",
			dest: join(projectDir, "dist-extension-compiled", "popup", "popup.template.html"),
		});
	});

	it("reads the popup's views from core, to be bundled into its runtime", () => {
		const plan = createBuildPlan({
			config: { target: "firefox91", utmSource: "firefox-extension" },
			projectDir,
			serverUrl: "https://readplace.com",
		});

		expect(plan.popupViews).toEqual({
			src: "/projects/browser-extensions/browser-extension-core/src/popup/popup-views.template.html",
		});
	});

	it("writes the popup stylesheet from core behind the shared design system", () => {
		const plan = createBuildPlan({
			config: { target: "firefox91", utmSource: "firefox-extension" },
			projectDir,
			serverUrl: "https://readplace.com",
		});

		expect(plan.popupStylesheet).toEqual({
			src: "/projects/browser-extensions/browser-extension-core/src/popup/popup.styles.css",
			dest: join(projectDir, "dist-extension-compiled", "popup", "popup.styles.css"),
		});
	});

	it("copies the manifest, the popup fonts and the icon directories", () => {
		const plan = createBuildPlan({
			config: { target: "firefox91", utmSource: "firefox-extension" },
			projectDir,
			serverUrl: "https://readplace.com",
		});

		const srcDir = join(projectDir, "src");
		const outDir = join(projectDir, "dist-extension-compiled");
		const coreDir = "/projects/browser-extensions/browser-extension-core";

		expect(plan.copies).toEqual([
			{ src: join(srcDir, "runtime", "manifest.json"), dest: join(outDir, "manifest.json"), recursive: false },
			{ src: join(coreDir, "src", "popup", "fonts"), dest: join(outDir, "popup", "fonts"), recursive: true },
			{ src: join(srcDir, "icons"), dest: join(outDir, "icons"), recursive: true },
		]);
	});

	it("throws when serverUrl is empty", () => {
		const { createBuildPlan } = initBuildExtension({
			resolveCorePackageJson: () => corePackageJsonPath,
		});

		expect(() =>
			createBuildPlan({
				config: { target: "firefox91", utmSource: "firefox-extension" },
				projectDir,
				serverUrl: "",
				version: "1.2.3",
				appDomains: [],
			}),
		).toThrow("HUTCH_SERVER_URL");
	});

	it("throws when serverUrl is undefined", () => {
		const { createBuildPlan } = initBuildExtension({
			resolveCorePackageJson: () => corePackageJsonPath,
		});

		expect(() =>
			createBuildPlan({
				config: { target: "firefox91", utmSource: "firefox-extension" },
				projectDir,
				serverUrl: undefined,
				version: "1.2.3",
				appDomains: [],
			}),
		).toThrow("HUTCH_SERVER_URL");
	});

	it("throws when version is empty", () => {
		const { createBuildPlan } = initBuildExtension({
			resolveCorePackageJson: () => corePackageJsonPath,
		});

		expect(() =>
			createBuildPlan({
				config: { target: "firefox91", utmSource: "firefox-extension" },
				projectDir,
				serverUrl: "https://readplace.com",
				version: "",
				appDomains: [],
			}),
		).toThrow("EXTENSION_VERSION");
	});

	it("throws when version is undefined", () => {
		const { createBuildPlan } = initBuildExtension({
			resolveCorePackageJson: () => corePackageJsonPath,
		});

		expect(() =>
			createBuildPlan({
				config: { target: "firefox91", utmSource: "firefox-extension" },
				projectDir,
				serverUrl: "https://readplace.com",
				version: undefined,
				appDomains: [],
			}),
		).toThrow("EXTENSION_VERSION");
	});
});

describe("initBuildExtension defaults", () => {
	it("resolves core package.json from module location by default", () => {
		const { createBuildPlan } = initBuildExtension();
		const plan = createBuildPlan({
			config: { target: "firefox91", utmSource: "firefox-extension" },
			projectDir: "/test",
			serverUrl: "https://example.com",
			version: "1.2.3",
			appDomains: [],
		});

		expect(plan.esbuildOptions.alias["browser-extension-core"]).toContain("browser-extension-core");
	});
});

describe("plan.buildExtension", () => {
	function createInMemoryDeps() {
		const createdDirs: Array<{ path: string; options: { recursive: true } }> = [];
		const copiedFiles: Array<{ src: string; dest: string; options?: { recursive?: boolean; force?: boolean } }> = [];
		const writtenFiles: Map<string, string> = new Map();
		let esbuildCallCount = 0;
		let lastEsbuildOptions: { target: string; define: Record<string, string> } | null = null;
		let manifestContent = JSON.stringify({ version: "0.0.0-managed-by-tag", host_permissions: ["https://readplace.com/*"], permissions: ["activeTab"] });

		const deps = {
			esbuild: async (options: { target: string; define: Record<string, string> }) => {
				esbuildCallCount++;
				lastEsbuildOptions = options;
			},
			mkdirSync: (path: string, options: { recursive: true }) => {
				createdDirs.push({ path, options });
			},
			cpSync: (src: string, dest: string, options?: { recursive?: boolean; force?: boolean }) => {
				copiedFiles.push({ src, dest, options });
			},
			readFileSync: (path: string, _encoding: "utf-8") => {
				if (path.endsWith("popup-views.template.html")) return '<a href="{{openReadlistHref}}">Readplace</a>';
				if (path.endsWith("popup.template.html")) return '<a href="{{brandHomeHref}}">Readplace</a>';
				if (path.endsWith("popup.styles.css")) return ".login {}";
				return manifestContent;
			},
			writeFileSync: (path: string, data: string) => {
				writtenFiles.set(path, data);
			},
			resolveCorePackageJson: () => "/projects/browser-extensions/browser-extension-core/package.json",
		};

		return {
			deps,
			createdDirs,
			copiedFiles,
			writtenFiles,
			setManifestContent: (content: string) => { manifestContent = content; },
			getEsbuildCallCount: () => esbuildCallCount,
			getLastEsbuildOptions: () => lastEsbuildOptions,
		};
	}

	it("creates output directories before building", async () => {
		const { deps, createdDirs } = createInMemoryDeps();
		const { createBuildPlan } = initBuildExtension(deps);
		const plan = createBuildPlan({
			config: { target: "firefox91", utmSource: "firefox-extension" },
			projectDir: "/projects/firefox-extension",
			serverUrl: "https://readplace.com",
			version: "1.2.3",
			appDomains: [],
		});

		await plan.buildExtension();

		expect(createdDirs.length).toBe(5);
		expect(createdDirs[0].options).toEqual({ recursive: true });
	});

	it("calls esbuild with resolved options", async () => {
		const { deps, getEsbuildCallCount, getLastEsbuildOptions } = createInMemoryDeps();
		const { createBuildPlan } = initBuildExtension(deps);
		const plan = createBuildPlan({
			config: { target: "chrome109", utmSource: "chrome-extension" },
			projectDir: "/projects/chrome-extension",
			serverUrl: "https://readplace.com",
			version: "1.2.3",
			appDomains: [],
		});

		await plan.buildExtension();

		expect(getEsbuildCallCount()).toBe(1);
		expect(getLastEsbuildOptions()?.target).toBe("chrome109");
	});

	it("copies static files after esbuild completes", async () => {
		const { deps, copiedFiles } = createInMemoryDeps();
		const { createBuildPlan } = initBuildExtension(deps);
		const plan = createBuildPlan({
			config: { target: "firefox91", utmSource: "firefox-extension" },
			projectDir: "/projects/firefox-extension",
			serverUrl: "https://readplace.com",
			version: "1.2.3",
			appDomains: [],
		});

		await plan.buildExtension();

		expect(copiedFiles.map((copy) => copy.dest)).toEqual([
			expect.stringContaining("manifest.json"),
			expect.stringContaining(join("popup", "fonts")),
			expect.stringContaining("icons"),
		]);
	});

	it("writes the popup template with the browser's own tracking source", async () => {
		const { deps, writtenFiles } = createInMemoryDeps();
		const { createBuildPlan } = initBuildExtension(deps);
		const plan = createBuildPlan({
			config: { target: "firefox91", utmSource: "firefox-extension" },
			projectDir: "/projects/firefox-extension",
			serverUrl: "https://readplace.com",
			version: "1.2.3",
			appDomains: [],
		});

		await plan.buildExtension();

		expect(writtenFiles.get(plan.popupTemplate.dest)).toBe(
			'<a href="https://readplace.com/?utm_source=firefox-extension&amp;utm_medium=extension&amp;utm_content=brand-home">Readplace</a>',
		);
	});

	it("bundles the popup's views with the browser's own tracking source", async () => {
		const { deps, getLastEsbuildOptions } = createInMemoryDeps();
		const { createBuildPlan } = initBuildExtension(deps);
		const plan = createBuildPlan({
			config: { target: "chrome109", utmSource: "chrome-extension" },
			projectDir: "/projects/chrome-extension",
			serverUrl: "https://readplace.com",
			version: "1.2.3",
			appDomains: [],
		});

		await plan.buildExtension();

		expect(getLastEsbuildOptions()?.define.__POPUP_VIEWS__).toBe(
			JSON.stringify(
				'<a href="https://readplace.com/queue?utm_source=chrome-extension&amp;utm_medium=extension&amp;utm_content=open-readlist">Readplace</a>',
			),
		);
	});

	it("writes the popup stylesheet after the shared design system, so the popup's own rules win", async () => {
		const { deps, writtenFiles } = createInMemoryDeps();
		const { createBuildPlan } = initBuildExtension(deps);
		const plan = createBuildPlan({
			config: { target: "chrome109", utmSource: "chrome-extension" },
			projectDir: "/projects/chrome-extension",
			serverUrl: "https://readplace.com",
			version: "1.2.3",
			appDomains: [],
		});

		await plan.buildExtension();

		expect(writtenFiles.get(plan.popupStylesheet.dest)).toBe(`${DESIGN_SYSTEM_STYLES}\n.login {}`);
	});

	it("passes recursive option for directory copies", async () => {
		const { deps, copiedFiles } = createInMemoryDeps();
		const { createBuildPlan } = initBuildExtension(deps);
		const plan = createBuildPlan({
			config: { target: "firefox91", utmSource: "firefox-extension" },
			projectDir: "/projects/firefox-extension",
			serverUrl: "https://readplace.com",
			version: "1.2.3",
			appDomains: [],
		});

		await plan.buildExtension();

		const iconsCopy = copiedFiles.find((c) => c.dest.endsWith("icons"));
		expect(iconsCopy?.options).toEqual({ recursive: true, force: true });

		const manifestCopy = copiedFiles.find((c) => c.dest.endsWith("manifest.json"));
		expect(manifestCopy?.options).toEqual({ force: true });
	});

	it("adds localhost host_permissions for dev builds", async () => {
		const { deps, writtenFiles, setManifestContent } = createInMemoryDeps();
		setManifestContent(JSON.stringify({ version: "0.0.0-managed-by-tag", host_permissions: ["https://readplace.com/*"] }));
		const { createBuildPlan } = initBuildExtension(deps);
		const plan = createBuildPlan({
			config: { target: "chrome109", utmSource: "chrome-extension" },
			projectDir: "/projects/chrome-extension",
			serverUrl: "http://127.0.0.1:3000",
			version: "1.2.3",
			appDomains: [],
		});

		await plan.buildExtension();

		const manifestPath = join("/projects/chrome-extension", "dist-extension-compiled", "manifest.json");
		const written = writtenFiles.get(manifestPath);
		assert(written, `Expected manifest written at ${manifestPath}`);
		const manifest = JSON.parse(written);
		expect(manifest.host_permissions).toEqual(["https://readplace.com/*", "http://127.0.0.1:3000/*"]);
	});

	it("adds localhost to permissions for Firefox MV2 dev builds", async () => {
		const { deps, writtenFiles, setManifestContent } = createInMemoryDeps();
		setManifestContent(JSON.stringify({ version: "0.0.0-managed-by-tag", permissions: ["activeTab", "tabs", "https://readplace.com/*"] }));
		const { createBuildPlan } = initBuildExtension(deps);
		const plan = createBuildPlan({
			config: { target: "firefox91", utmSource: "firefox-extension" },
			projectDir: "/projects/firefox-extension",
			serverUrl: "http://127.0.0.1:3000",
			version: "1.2.3",
			appDomains: [],
		});

		await plan.buildExtension();

		const manifestPath = join("/projects/firefox-extension", "dist-extension-compiled", "manifest.json");
		const written = writtenFiles.get(manifestPath);
		assert(written, `Expected manifest written at ${manifestPath}`);
		const manifest = JSON.parse(written);
		expect(manifest.permissions).toEqual(["activeTab", "tabs", "https://readplace.com/*", "http://127.0.0.1:3000/*"]);
	});

	it("writes version into output manifest, overriding source placeholder", async () => {
		const { deps, writtenFiles } = createInMemoryDeps();
		const { createBuildPlan } = initBuildExtension(deps);
		const plan = createBuildPlan({
			config: { target: "chrome109", utmSource: "chrome-extension" },
			projectDir: "/projects/chrome-extension",
			serverUrl: "https://readplace.com",
			version: "1.2.3",
			appDomains: [],
		});

		await plan.buildExtension();

		const manifestPath = join("/projects/chrome-extension", "dist-extension-compiled", "manifest.json");
		const written = writtenFiles.get(manifestPath);
		assert(written, `Expected manifest written at ${manifestPath}`);
		const manifest = JSON.parse(written);
		expect(manifest.version).toBe("1.2.3");
	});

	it("writes manifest with version even on production builds (no localhost permissions)", async () => {
		const { deps, writtenFiles } = createInMemoryDeps();
		const { createBuildPlan } = initBuildExtension(deps);
		const plan = createBuildPlan({
			config: { target: "chrome109", utmSource: "chrome-extension" },
			projectDir: "/projects/chrome-extension",
			serverUrl: "https://readplace.com",
			version: "1.2.3",
			appDomains: [],
		});

		await plan.buildExtension();

		const manifestPath = join("/projects/chrome-extension", "dist-extension-compiled", "manifest.json");
		const written = writtenFiles.get(manifestPath);
		assert(written, `Expected manifest written at ${manifestPath}`);
		const manifest = JSON.parse(written);
		expect(manifest.host_permissions).toEqual(["https://readplace.com/*"]);
		expect(manifest.version).toBe("1.2.3");
	});
});

describe("plan.packExtension", () => {
	function createInMemoryDeps() {
		const createdDirs: Array<{ path: string; options: { recursive: true } }> = [];

		const deps = {
			esbuild: async () => {},
			mkdirSync: (path: string, options: { recursive: true }) => {
				createdDirs.push({ path, options });
			},
			cpSync: () => {},
			readFileSync: () => "{}",
			writeFileSync: () => {},
			resolveCorePackageJson: () => "/projects/browser-extensions/browser-extension-core/package.json",
		};

		return { deps, createdDirs };
	}

	it("calls pack with sourceDir and outputPath", () => {
		const { deps } = createInMemoryDeps();
		const { createBuildPlan } = initBuildExtension(deps);
		let packCalledWith: { sourceDir: string; outputPath: string } | null = null;

		const plan = createBuildPlan({
			config: { target: "firefox91", utmSource: "firefox-extension" },
			projectDir: "/projects/firefox-extension",
			serverUrl: "https://readplace.com",
			version: "1.2.3",
			appDomains: [],
			pack: (params) => {
				packCalledWith = params;
			},
		});

		plan.packExtension("hutch-abc123.xpi");

		expect(packCalledWith).toEqual({
			sourceDir: join("/projects/firefox-extension", "dist-extension-compiled"),
			outputPath: join("/projects/firefox-extension", "dist-extension-files", "hutch-abc123.xpi"),
		});
	});

	it("creates the dist-extension-files directory", () => {
		const { deps, createdDirs } = createInMemoryDeps();
		const { createBuildPlan } = initBuildExtension(deps);

		const plan = createBuildPlan({
			config: { target: "firefox91", utmSource: "firefox-extension" },
			projectDir: "/projects/firefox-extension",
			serverUrl: "https://readplace.com",
			version: "1.2.3",
			appDomains: [],
			pack: () => {},
		});

		plan.packExtension("hutch-abc123.xpi");

		const artifactsDir = createdDirs.find((d) => d.path.endsWith("dist-extension-files"));
		expect(artifactsDir).toBeDefined();
		expect(artifactsDir?.options).toEqual({ recursive: true });
	});

	it("throws when pack callback is not provided", () => {
		const { deps } = createInMemoryDeps();
		const { createBuildPlan } = initBuildExtension(deps);

		const plan = createBuildPlan({
			config: { target: "firefox91", utmSource: "firefox-extension" },
			projectDir: "/projects/firefox-extension",
			serverUrl: "https://readplace.com",
			version: "1.2.3",
			appDomains: [],
		});

		expect(() => plan.packExtension("hutch-abc123.xpi")).toThrow();
	});
});

import assert from "node:assert";
import { cpSync as defaultCpSync, mkdirSync as defaultMkdirSync, readFileSync as defaultReadFileSync, writeFileSync as defaultWriteFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { DESIGN_SYSTEM_STYLES } from "@packages/web-shell/design-system.styles";
import { build } from "esbuild";
import { type PopupUtmSource, renderPopupTemplate } from "./popup-template";

export interface ExtensionBuildConfig {
	target: string;
	utmSource: PopupUtmSource;
}

interface EsbuildOptions {
	entryPoints: string[];
	bundle: boolean;
	format: "iife";
	outdir: string;
	outbase: string;
	target: string;
	alias: Record<string, string>;
	define: Record<string, string>;
}

interface CopyOperation {
	src: string;
	dest: string;
	recursive: boolean;
}

interface BuildExtensionDeps {
	esbuild: (options: EsbuildOptions) => Promise<unknown>;
	mkdirSync: (path: string, options: { recursive: true }) => void;
	cpSync: (src: string, dest: string, options?: { recursive?: boolean; force?: boolean }) => void;
	readFileSync: (path: string, encoding: "utf-8") => string;
	writeFileSync: (path: string, data: string) => void;
	resolveCorePackageJson: () => string;
}

interface BuildPlanInput {
	config: ExtensionBuildConfig;
	projectDir: string;
	serverUrl: string | undefined;
	version: string | undefined;
	appDomains: readonly string[];
	pack?: (params: { sourceDir: string; outputPath: string }) => void;
}

function createPlanData(input: { config: ExtensionBuildConfig; projectDir: string; serverUrl: string; appDomains: readonly string[]; corePackageJsonPath: string }): {
	esbuildOptions: EsbuildOptions;
	copies: CopyOperation[];
	popupTemplate: { src: string; dest: string };
	popupViews: { src: string };
	popupStylesheet: { src: string; dest: string };
	directories: string[];
} {
	const srcDir = join(input.projectDir, "src");
	const outDir = join(input.projectDir, "dist-extension-compiled");
	const coreDir = dirname(input.corePackageJsonPath);

	const directories = [
		outDir,
		join(outDir, "popup"),
		join(outDir, "background"),
		join(outDir, "content"),
		join(outDir, "icons"),
	];

	const esbuildOptions: EsbuildOptions = {
		entryPoints: [
			join(srcDir, "runtime", "background", "background.browser.ts"),
			join(srcDir, "runtime", "popup", "popup.browser.ts"),
			join(srcDir, "runtime", "popup", "popup-entry.browser.ts"),
			join(srcDir, "runtime", "content", "shortcut.browser.ts"),
		],
		bundle: true,
		format: "iife",
		outdir: outDir,
		outbase: join(srcDir, "runtime"),
		target: input.config.target,
		alias: {
			"browser-extension-core": join(coreDir, "src", "index.ts"),
		},
		define: {
			__SERVER_URL__: JSON.stringify(input.serverUrl),
			__APP_DOMAINS__: JSON.stringify([...input.appDomains, "127.0.0.1", "localhost"]),
		},
	};

	const copies: CopyOperation[] = [
		{ src: join(srcDir, "runtime", "manifest.json"), dest: join(outDir, "manifest.json"), recursive: false },
		{ src: join(coreDir, "src", "popup", "fonts"), dest: join(outDir, "popup", "fonts"), recursive: true },
		{ src: join(srcDir, "icons"), dest: join(outDir, "icons"), recursive: true },
	];

	const popupTemplate = {
		src: join(coreDir, "src", "popup", "popup.template.html"),
		dest: join(outDir, "popup", "popup.template.html"),
	};

	const popupViews = {
		src: join(coreDir, "src", "popup", "popup-views.template.html"),
	};

	const popupStylesheet = {
		src: join(coreDir, "src", "popup", "popup.styles.css"),
		dest: join(outDir, "popup", "popup.styles.css"),
	};

	return { esbuildOptions, copies, popupTemplate, popupViews, popupStylesheet, directories };
}

export function initBuildExtension(deps: Partial<BuildExtensionDeps> = {}) {
	const resolvedDeps: BuildExtensionDeps = {
		esbuild: deps.esbuild ?? build,
		mkdirSync: deps.mkdirSync ?? defaultMkdirSync,
		cpSync: deps.cpSync ?? defaultCpSync,
		readFileSync: deps.readFileSync ?? defaultReadFileSync,
		writeFileSync: deps.writeFileSync ?? defaultWriteFileSync,
		resolveCorePackageJson: deps.resolveCorePackageJson ?? (() => join(__dirname, "..", "..", "package.json")),
	};

	return {
		createBuildPlan(input: BuildPlanInput) {
			assert(input.serverUrl, "HUTCH_SERVER_URL environment variable is required.\nSet it before building (e.g. HUTCH_SERVER_URL=https://readplace.com)");
			assert(input.version, "EXTENSION_VERSION environment variable is required.\nSet it before building (e.g. EXTENSION_VERSION=1.2.3)");
			const serverUrl = input.serverUrl;
			const version = input.version;

			const planData = createPlanData({
				config: input.config,
				projectDir: input.projectDir,
				serverUrl,
				appDomains: input.appDomains,
				corePackageJsonPath: resolvedDeps.resolveCorePackageJson(),
			});

			return {
				...planData,
				async buildExtension(): Promise<void> {
					for (const dir of planData.directories) {
						resolvedDeps.mkdirSync(dir, { recursive: true });
					}

					const views = renderPopupTemplate({
						template: resolvedDeps.readFileSync(planData.popupViews.src, "utf-8"),
						utmSource: input.config.utmSource,
					});
					await resolvedDeps.esbuild({
						...planData.esbuildOptions,
						define: { ...planData.esbuildOptions.define, __POPUP_VIEWS__: JSON.stringify(views) },
					});

					for (const copy of planData.copies) {
						if (copy.recursive) {
							resolvedDeps.cpSync(copy.src, copy.dest, { recursive: true, force: true });
						} else {
							resolvedDeps.cpSync(copy.src, copy.dest, { force: true });
						}
					}

					const template = resolvedDeps.readFileSync(planData.popupTemplate.src, "utf-8");
					resolvedDeps.writeFileSync(
						planData.popupTemplate.dest,
						renderPopupTemplate({ template, utmSource: input.config.utmSource }),
					);

					const stylesheet = resolvedDeps.readFileSync(planData.popupStylesheet.src, "utf-8");
					resolvedDeps.writeFileSync(planData.popupStylesheet.dest, `${DESIGN_SYSTEM_STYLES}\n${stylesheet}`);

					const manifestDest = join(input.projectDir, "dist-extension-compiled", "manifest.json");
					const manifest = JSON.parse(resolvedDeps.readFileSync(manifestDest, "utf-8"));
					manifest.version = version;

					if (serverUrl.includes("127.0.0.1")) {
						const localhostPattern = `${serverUrl}/*`;

						if (Array.isArray(manifest.host_permissions)) {
							manifest.host_permissions.push(localhostPattern);
						}

						if (Array.isArray(manifest.permissions)) {
							manifest.permissions.push(localhostPattern);
						}
					}

					resolvedDeps.writeFileSync(manifestDest, `${JSON.stringify(manifest, null, 2)}\n`);

					console.log("Extension built to dist-extension-compiled/");
				},
				packExtension(filename: string): void {
					assert(input.pack, "pack callback is required — provide it in createBuildPlan input");
					const sourceDir = join(input.projectDir, "dist-extension-compiled");
					const artifactsDir = join(input.projectDir, "dist-extension-files");
					resolvedDeps.mkdirSync(artifactsDir, { recursive: true });
					input.pack({ sourceDir, outputPath: join(artifactsDir, filename) });
					console.log(`Extension packed to dist-extension-files/${filename}`);
				},
			};
		},
	};
}

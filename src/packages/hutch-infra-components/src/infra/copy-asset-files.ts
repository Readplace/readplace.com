import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

const BUNDLED_EXTENSIONS = [".ts"];

/**
 * Recursively copies non-source assets (anything not bundled by esbuild) from a
 * Lambda's source tree into its output directory, preserving the relative path
 * layout so `__dirname`-based runtime lookups resolve. Shared between the zip
 * path (HutchLambda) and the container-image build (build-ocr-image.mjs).
 */
export function copyAssetFiles(dirs: { src: string; dest: string }): void {
	for (const entry of readdirSync(dirs.src, { withFileTypes: true })) {
		const srcPath = join(dirs.src, entry.name);
		if (entry.isDirectory()) {
			const destSubdir = join(dirs.dest, entry.name);
			mkdirSync(destSubdir, { recursive: true });
			copyAssetFiles({ src: srcPath, dest: destSubdir });
		} else if (!BUNDLED_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
			copyFileSync(srcPath, join(dirs.dest, entry.name));
		}
	}
}

/**
 * Copy non-TypeScript template assets (*.html, *.css) from src/ to dist/.
 *
 * base.component / nav.component / extension-suggestion-banner read their
 * templates with readFileSync(join(__dirname, "*.template.html")), and
 * toast.styles reads toast.styles.css. tsc emits only .js/.d.ts, so these
 * assets must be mirrored into dist alongside the compiled modules for the
 * package to work at runtime and under jest (which runs the compiled dist).
 */
const fs = require("node:fs");
const path = require("node:path");

const SRC_DIR = path.join(__dirname, "../src");
const DIST_DIR = path.join(__dirname, "../dist");

const EXTENSIONS = [".html", ".css"];

function shouldCopy(filePath) {
	return EXTENSIONS.some((ext) => filePath.endsWith(ext));
}

function copyTemplates(srcDir, distDir) {
	let count = 0;
	const entries = fs.readdirSync(srcDir, { withFileTypes: true });

	for (const entry of entries) {
		const srcPath = path.join(srcDir, entry.name);
		const distPath = path.join(distDir, entry.name);

		if (entry.isDirectory()) {
			count += copyTemplates(srcPath, distPath);
		} else if (shouldCopy(entry.name)) {
			fs.mkdirSync(path.dirname(distPath), { recursive: true });
			fs.copyFileSync(srcPath, distPath);
			count++;
		}
	}
	return count;
}

const copied = copyTemplates(SRC_DIR, DIST_DIR);
console.log(`copy-templates: copied ${copied} files from src/ to dist/.`);

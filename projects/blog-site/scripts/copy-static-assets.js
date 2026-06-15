/**
 * Copy non-TypeScript files (templates, markdown posts, CSS) from src/ to dist/.
 *
 * tsc emits only .js/.d.ts; the blog components read their templates with
 * readFileSync(join(__dirname, "*.template.html")) and the posts loader reads
 * the markdown files under posts/, so those assets must be mirrored into dist
 * alongside the compiled modules.
 */
const fs = require("node:fs");
const path = require("node:path");

const SRC_DIR = path.join(__dirname, "../src");
const DIST_DIR = path.join(__dirname, "../dist");

const EXTENSIONS = [".css", ".html", ".md", ".txt"];

function shouldCopy(filePath) {
	return EXTENSIONS.some((ext) => filePath.endsWith(ext));
}

function copyStaticAssets(srcDir, distDir) {
	let count = 0;
	for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
		const srcPath = path.join(srcDir, entry.name);
		const distPath = path.join(distDir, entry.name);
		if (entry.isDirectory()) {
			count += copyStaticAssets(srcPath, distPath);
		} else if (shouldCopy(entry.name)) {
			fs.mkdirSync(path.dirname(distPath), { recursive: true });
			fs.copyFileSync(srcPath, distPath);
			count++;
		}
	}
	return count;
}

const copied = copyStaticAssets(SRC_DIR, DIST_DIR);
console.log(`blog-site copy-static-assets: copied ${copied} files from src/ to dist/.`);

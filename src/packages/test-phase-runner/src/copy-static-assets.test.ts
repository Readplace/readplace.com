import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copyStaticAssets } from "./copy-static-assets";

describe("copyStaticAssets", () => {
	let root: string;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "copy-static-assets-"));
	});

	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	it("mirrors files with a listed extension into dist at the same relative path and logs only the count", () => {
		const srcDir = join(root, "src");
		const distDir = join(root, "dist");
		mkdirSync(join(srcDir, "pages", "home"), { recursive: true });
		writeFileSync(join(srcDir, "readme.md"), "# readme");
		writeFileSync(join(srcDir, "pages", "home", "home.template.html"), "<p>home</p>");
		writeFileSync(join(srcDir, "pages", "home", "home.ts"), "export {};");
		const logged: string[] = [];

		const count = copyStaticAssets({ srcDir, distDir, extensions: [".html", ".md"], log: (message) => logged.push(message) });

		assert.equal(count, 2);
		assert.equal(readFileSync(join(distDir, "readme.md"), "utf8"), "# readme");
		assert.equal(readFileSync(join(distDir, "pages", "home", "home.template.html"), "utf8"), "<p>home</p>");
		assert.equal(existsSync(join(distDir, "pages", "home", "home.ts")), false);
		assert.deepEqual(logged, [`Copied 2 static assets from ${srcDir} to ${distDir}`]);
	});
});

import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

function copyMatching(input: { srcDir: string; distDir: string; extensions: readonly string[] }): number {
	let count = 0;
	for (const entry of readdirSync(input.srcDir, { withFileTypes: true })) {
		const srcPath = join(input.srcDir, entry.name);
		const distPath = join(input.distDir, entry.name);
		if (entry.isDirectory()) {
			count += copyMatching({ ...input, srcDir: srcPath, distDir: distPath });
		} else if (input.extensions.some((extension) => entry.name.endsWith(extension))) {
			mkdirSync(input.distDir, { recursive: true });
			copyFileSync(srcPath, distPath);
			count++;
		}
	}
	return count;
}

export function copyStaticAssets(input: {
	srcDir: string;
	distDir: string;
	extensions: readonly string[];
	log: (message: string) => void;
}): number {
	const count = copyMatching(input);
	input.log(`Copied ${count} static assets from ${input.srcDir} to ${input.distDir}`);
	return count;
}

import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * esbuild emits `index.js.map` next to `index.js`; a source map's `sources`
 * can embed environment-specific paths, so hashing it would make the tag differ
 * between the CI runner and a developer machine for byte-identical shipped code
 * — reintroducing the per-environment "drift" this tag exists to avoid. The map
 * is a derived artifact (any real code change already changes `index.js`), so
 * excluding it costs no sensitivity.
 */
function isHashableAsset(fileName: string): boolean {
	return !fileName.endsWith(".map");
}

function listAssetsSorted(root: string): string[] {
	const files: string[] = [];
	const walk = (dir: string): void => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const absolute = join(dir, entry.name);
			if (entry.isDirectory()) {
				walk(absolute);
			} else if (isHashableAsset(entry.name)) {
				files.push(relative(root, absolute));
			}
		}
	};
	walk(root);
	return files.sort();
}

export function computeImageTag(args: {
	handlerName: string;
	handlerOutputDir: string;
	dockerfileContents: Buffer;
	buildArgs: Readonly<Record<string, string>>;
}): string {
	const hash = createHash("sha256");
	for (const relativePath of listAssetsSorted(args.handlerOutputDir)) {
		hash.update(relativePath);
		hash.update("\0");
		hash.update(readFileSync(join(args.handlerOutputDir, relativePath)));
		hash.update("\0");
	}
	hash.update(args.dockerfileContents);
	hash.update(
		Object.keys(args.buildArgs)
			.sort()
			.map((key) => args.buildArgs[key])
			.join("\0"),
	);
	const contentHash = hash.digest("hex").slice(0, 12);
	return `${contentHash}-${args.handlerName}`;
}

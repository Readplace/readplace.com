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

/**
 * Computes a content-addressed image tag for one OCR handler. The tag must
 * change whenever the built image would change and stay identical otherwise —
 * ECR tags are mutable, so the tag string is the only thing Pulumi diffs to
 * decide whether to redeploy the Lambda.
 *
 * Hashes the ENTIRE handler output dir (the esbuild bundle plus every asset
 * `copyAssetFiles` copied — critically the runtime-loaded prompt `.md` files,
 * which are not inlined into `index.js`), together with the Dockerfile and the
 * curl-impersonate version build-arg. Deliberately excludes no git SHA: an
 * unchanged handler yields an unchanged tag, so unrelated pushes no longer force
 * a redeploy.
 */
export function computeImageTag(args: {
	handlerName: string;
	handlerOutputDir: string;
	dockerfileContents: Buffer;
	curlImpersonateVersion: string;
}): string {
	const hash = createHash("sha256");
	for (const relativePath of listAssetsSorted(args.handlerOutputDir)) {
		hash.update(relativePath);
		hash.update("\0");
		hash.update(readFileSync(join(args.handlerOutputDir, relativePath)));
		hash.update("\0");
	}
	hash.update(args.dockerfileContents);
	hash.update(args.curlImpersonateVersion);
	const contentHash = hash.digest("hex").slice(0, 12);
	return `${contentHash}-${args.handlerName}`;
}

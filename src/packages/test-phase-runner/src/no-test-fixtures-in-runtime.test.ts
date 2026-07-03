import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(__dirname, "..", "..", "..", "..");

/**
 * `@packages/test-fixtures` holds in-memory implementations and the test-app
 * fixture builder — test-only code. Production logic must never live there and
 * be imported back into a runtime path (a careless edit to the "test" package
 * could then change production behaviour, e.g. make OAuth tokens forgeable).
 *
 * Composition roots are the one exception: they legitimately wire the in-memory
 * implementations for local dev and e2e. Every other file under a project's
 * `src/runtime` tree must depend on real packages.
 */
const EXEMPT_SUFFIXES = [".test.ts", ".integration.ts", ".main.ts", "/app.ts", "/test-app.ts"];

function isExempt(path: string): boolean {
	return EXEMPT_SUFFIXES.some((suffix) => path.endsWith(suffix));
}

function collectTsFiles(dir: string, out: string[]): void {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			collectTsFiles(full, out);
		} else if (entry.name.endsWith(".ts")) {
			out.push(full);
		}
	}
}

function runtimeFiles(): string[] {
	const projectsDir = join(repoRoot, "projects");
	const files: string[] = [];
	for (const project of readdirSync(projectsDir, { withFileTypes: true })) {
		if (!project.isDirectory()) continue;
		const runtime = join(projectsDir, project.name, "src", "runtime");
		try {
			collectTsFiles(runtime, files);
		} catch {
			// The project has no src/runtime tree (e.g. a browser-only extension).
		}
	}
	return files;
}

describe("no @packages/test-fixtures imports in production runtime code", () => {
	it("only composition roots may import the test-only fixtures package", () => {
		const offenders = runtimeFiles()
			.filter((file) => !isExempt(file))
			.filter((file) => readFileSync(file, "utf8").includes("@packages/test-fixtures"))
			.map((file) => file.slice(repoRoot.length + 1));

		assert.deepEqual(
			offenders,
			[],
			`Production runtime code must import real packages, not @packages/test-fixtures.\n` +
				`Move the shared logic into a real workspace package and import it there.\nOffenders:\n${offenders.join("\n")}`,
		);
	});
});

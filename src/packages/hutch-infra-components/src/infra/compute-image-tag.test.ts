import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeImageTag } from "./compute-image-tag";

describe("computeImageTag", () => {
	let dir: string;

	function seed(): void {
		// The esbuild bundle.
		writeFileSync(join(dir, "index.js"), "module.exports.handler = () => 1;");
		// The esbuild source map — present in the output dir but must NOT affect the tag.
		writeFileSync(join(dir, "index.js.map"), '{"version":3,"sources":["/abs/a.ts"]}');
		// A runtime-loaded prompt asset in a nested dir (the copyAssetFiles layout).
		mkdirSync(join(dir, "runtime", "domain", "generate-summary"), { recursive: true });
		writeFileSync(join(dir, "runtime", "domain", "generate-summary", "summarize-prompt.md"), "Summarise this.");
	}

	function args() {
		return {
			handlerName: "pdf-page-ocr",
			handlerOutputDir: dir,
			dockerfileContents: Buffer.from("FROM public.ecr.aws/lambda/nodejs:22\n"),
			curlImpersonateVersion: "1.0.0",
		};
	}

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "compute-image-tag-"));
		seed();
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it("is deterministic for identical content", () => {
		assert.equal(computeImageTag(args()), computeImageTag(args()));
	});

	it("returns a 12-char hex hash suffixed with the handler name", () => {
		assert.match(computeImageTag(args()), /^[0-9a-f]{12}-pdf-page-ocr$/);
	});

	it("changes when a runtime-loaded prompt asset changes (the phantom-drift guard)", () => {
		const before = computeImageTag(args());
		writeFileSync(
			join(dir, "runtime", "domain", "generate-summary", "summarize-prompt.md"),
			"Summarise this differently.",
		);

		assert.notEqual(computeImageTag(args()), before);
	});

	it("changes when the bundled index.js changes", () => {
		const before = computeImageTag(args());
		writeFileSync(join(dir, "index.js"), "module.exports.handler = () => 2;");

		assert.notEqual(computeImageTag(args()), before);
	});

	it("ignores the esbuild source map (environment-specific, derived artifact)", () => {
		const before = computeImageTag(args());
		writeFileSync(join(dir, "index.js.map"), '{"version":3,"sources":["/other/abs/b.ts"]}');

		assert.equal(computeImageTag(args()), before);
	});

	it("changes when the Dockerfile changes", () => {
		const before = computeImageTag(args());

		assert.notEqual(
			computeImageTag({ ...args(), dockerfileContents: Buffer.from("FROM rockylinux:9\n") }),
			before,
		);
	});

	it("changes when the curl-impersonate version changes", () => {
		const before = computeImageTag(args());

		assert.notEqual(computeImageTag({ ...args(), curlImpersonateVersion: "2.0.0" }), before);
	});
});

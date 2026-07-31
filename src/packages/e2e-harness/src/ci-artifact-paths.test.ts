import assert from "node:assert/strict";
import path from "node:path";
import { ciArtifactPaths } from "./ci-artifact-paths";

describe("ciArtifactPaths", () => {
	it("keeps artifacts inside the project when no shared root is mounted", () => {
		const paths = ciArtifactPaths({ root: undefined, runId: "123", project: "hutch" });
		assert.equal(paths.outputDir, "./test-results");
		assert.equal(paths.transitionFramesDir, path.resolve("test-results", "transition-frames"));
	});

	it("treats an empty root the same as an absent one", () => {
		const paths = ciArtifactPaths({ root: "", runId: "123", project: "hutch" });
		assert.equal(paths.outputDir, "./test-results");
	});

	it("separates each project's playwright output under the run directory", () => {
		const paths = ciArtifactPaths({ root: "/frames", runId: "456", project: "inbox" });
		assert.equal(paths.outputDir, "/frames/456/playwright/inbox");
		assert.equal(paths.transitionFramesDir, "/frames/456/frames");
	});

	it("falls back to a local run directory when no run id is set", () => {
		assert.equal(
			ciArtifactPaths({ root: "/frames", runId: undefined, project: "hutch" }).outputDir,
			"/frames/local/playwright/hutch",
		);
		assert.equal(
			ciArtifactPaths({ root: "/frames", runId: "", project: "hutch" }).outputDir,
			"/frames/local/playwright/hutch",
		);
	});
});

import path from "node:path";

interface CiArtifactPathsInput {
	root: string | undefined;
	runId: string | undefined;
	project: string;
}

interface CiArtifactPaths {
	outputDir: string;
	transitionFramesDir: string;
}

/** Keyed by run id so a review reports on the frames its own run captured: the
 * reviewer consumes a directory, and reviews for concurrent runs overlap. */
export function ciArtifactPaths(input: CiArtifactPathsInput): CiArtifactPaths {
	if (input.root === undefined || input.root === "") {
		return {
			outputDir: "./test-results",
			transitionFramesDir: path.resolve("test-results", "transition-frames"),
		};
	}
	const runDir = path.join(input.root, input.runId === undefined || input.runId === "" ? "local" : input.runId);
	return {
		outputDir: path.join(runDir, "playwright", input.project),
		transitionFramesDir: path.join(runDir, "frames"),
	};
}

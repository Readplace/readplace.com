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

export function ciArtifactPaths(input: CiArtifactPathsInput): CiArtifactPaths {
	const transitionFramesDir = path.resolve("test-results", "transition-frames");
	if (input.root === undefined || input.root === "") {
		return { outputDir: "./test-results", transitionFramesDir };
	}
	const runDir = path.join(input.root, input.runId === undefined || input.runId === "" ? "local" : input.runId);
	return { outputDir: path.join(runDir, "playwright", input.project), transitionFramesDir };
}

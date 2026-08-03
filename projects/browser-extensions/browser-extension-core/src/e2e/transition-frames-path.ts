import path from "node:path";

export function transitionFramesPath(input: {
	root: string | undefined;
	runId: string | undefined;
	flow: string;
}): string {
	if (input.root === undefined)
		return path.join("test-results", "transition-frames", input.flow);
	return path.join(input.root, input.runId ?? "local", "frames", input.flow);
}

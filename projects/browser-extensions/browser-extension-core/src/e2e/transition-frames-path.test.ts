import { transitionFramesPath } from "./transition-frames-path";

describe("transitionFramesPath", () => {
	it("writes into the project's own results directory when no artifact root is set", () => {
		expect(
			transitionFramesPath({
				root: undefined,
				runId: undefined,
				flow: "extension-view-queue-chrome",
			}),
		).toBe("test-results/transition-frames/extension-view-queue-chrome");
	});

	it("keys a trail under the run it came from when an artifact root is set", () => {
		expect(
			transitionFramesPath({
				root: "/frames",
				runId: "4242",
				flow: "extension-view-queue-firefox",
			}),
		).toBe("/frames/4242/frames/extension-view-queue-firefox");
	});

	it("files a trail with no run id under a local run", () => {
		expect(
			transitionFramesPath({
				root: "/frames",
				runId: undefined,
				flow: "extension-view-queue-chrome",
			}),
		).toBe("/frames/local/frames/extension-view-queue-chrome");
	});
});

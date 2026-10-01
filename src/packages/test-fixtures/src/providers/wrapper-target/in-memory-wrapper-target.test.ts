import { initInMemoryWrapperTarget } from "./in-memory-wrapper-target";

describe("initInMemoryWrapperTarget", () => {
	it("answers only the scripted wrappers and records every call", async () => {
		const wrapperTarget = initInMemoryWrapperTarget();
		wrapperTarget.targets.set("https://tracker.example/link/1", "https://publisher.example/article");

		expect(await wrapperTarget.resolveWrapperTarget("https://tracker.example/link/1")).toBe(
			"https://publisher.example/article",
		);
		expect(await wrapperTarget.resolveWrapperTarget("https://tracker.example/link/2")).toBeUndefined();
		expect(wrapperTarget.calls).toEqual(["https://tracker.example/link/1", "https://tracker.example/link/2"]);
	});
});

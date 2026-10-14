import { initInMemoryWrapperTarget } from "./in-memory-wrapper-target";

describe("initInMemoryWrapperTarget", () => {
	it("answers only the scripted wrappers and records every call", async () => {
		const wrapperTarget = initInMemoryWrapperTarget();
		wrapperTarget.targets.set("https://tracker.example/link/1", "https://publisher.example/article");

		expect(await wrapperTarget.resolveWrapperTarget("https://tracker.example/link/1")).toEqual({ url: "https://publisher.example/article" });
		expect(await wrapperTarget.resolveWrapperTarget("https://tracker.example/link/2")).toBeUndefined();
		expect(wrapperTarget.calls).toEqual(["https://tracker.example/link/1", "https://tracker.example/link/2"]);
	});

	it("answers its own original for a URL marked unreachable, ahead of any scripted target", async () => {
		const wrapperTarget = initInMemoryWrapperTarget();
		wrapperTarget.targets.set("https://archive.ph/Ab1cD", "https://publisher.example/article");
		wrapperTarget.ownOriginals.add("https://archive.ph/Ab1cD");

		expect(await wrapperTarget.resolveWrapperTarget("https://archive.ph/Ab1cD")).toEqual({ ownOriginal: true });
		expect(wrapperTarget.calls).toEqual(["https://archive.ph/Ab1cD"]);
	});
});

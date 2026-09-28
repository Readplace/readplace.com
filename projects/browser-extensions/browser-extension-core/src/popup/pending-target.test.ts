import { parsePendingTarget } from "./pending-target";

describe("parsePendingTarget", () => {
	it("ignores anything that is not a stored target", () => {
		expect(parsePendingTarget(undefined)).toBeNull();
		expect(parsePendingTarget("https://example.com/")).toBeNull();
	});

	it("ignores a stored target without a string url", () => {
		expect(parsePendingTarget({ title: "Example" })).toBeNull();
		expect(parsePendingTarget({ url: 42 })).toBeNull();
	});

	it("titles a target that carries only its url with the url", () => {
		expect(parsePendingTarget({ url: "https://example.com/a" })).toStrictEqual({
			url: "https://example.com/a",
			title: "https://example.com/a",
		});
	});

	it("keeps the stored title", () => {
		expect(parsePendingTarget({ url: "https://example.com/a", title: "Example" })).toStrictEqual({
			url: "https://example.com/a",
			title: "Example",
		});
	});

	it("falls back to the url when the stored title is not a string", () => {
		expect(parsePendingTarget({ url: "https://example.com/a", title: 7 })).toStrictEqual({
			url: "https://example.com/a",
			title: "https://example.com/a",
		});
	});

	it("carries the tab the target was taken from", () => {
		expect(parsePendingTarget({ url: "https://example.com/a", title: "Example", tabId: 12 })).toStrictEqual({
			url: "https://example.com/a",
			title: "Example",
			tabId: 12,
		});
	});

	it("drops a tab id that is not a number", () => {
		expect(parsePendingTarget({ url: "https://example.com/a", title: "Example", tabId: "12" })).toStrictEqual({
			url: "https://example.com/a",
			title: "Example",
		});
	});
});

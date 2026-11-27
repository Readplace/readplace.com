import { saveableUrlFixture } from "./saveable-url";

describe("saveableUrlFixture", () => {
	it("returns the validated URL", () => {
		expect(saveableUrlFixture("https://example.com/post")).toBe("https://example.com/post");
	});

	it("refuses a URL that is not saveable", () => {
		expect(() => saveableUrlFixture("not a url")).toThrow("a saveable URL fixture must pass validateSaveableUrl");
	});
});

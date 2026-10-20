import { articleBody } from "./article-body";

describe("articleBody", () => {
	it("mints a body from non-empty HTML", () => {
		expect(articleBody("<p>Body</p>")).toBe("<p>Body</p>");
	});

	it("refuses empty HTML", () => {
		expect(() => articleBody("")).toThrow("an article body must be non-empty HTML");
	});
});

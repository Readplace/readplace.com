import { MarkdownPage } from "./markdown-page";

describe("MarkdownPage", () => {
	it("returns 200 with text/markdown content-type and a token estimate header", () => {
		const result = MarkdownPage("# Hello\n\nWorld").to("text/markdown");

		expect(result.statusCode).toBe(200);
		expect(result.headers["content-type"]).toBe("text/markdown; charset=utf-8");
		expect(result.body).toBe("# Hello\n\nWorld");
		expect(Number(result.headers["x-markdown-tokens"])).toBeGreaterThan(0);
	});

	it("estimates tokens at roughly one per four characters", () => {
		const body = "x".repeat(400);

		const result = MarkdownPage(body).to("text/markdown");

		expect(result.headers["x-markdown-tokens"]).toBe("100");
	});

	it("uses the provided statusCode", () => {
		const result = MarkdownPage("# Not found", 404).to("text/markdown");

		expect(result.statusCode).toBe(404);
		expect(result.body).toBe("# Not found");
	});

	it("returns 406 with empty body and no headers when text/html is requested", () => {
		const result = MarkdownPage("# Hello").to("text/html");

		expect(result.statusCode).toBe(406);
		expect(result.headers).toEqual({});
		expect(result.body).toBe("");
	});
});

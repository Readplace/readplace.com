import { HtmlPage } from "./html-page";

describe("HtmlPage", () => {
	it("returns 200 with the body and text/html content-type by default", () => {
		const result = HtmlPage("<p>Hello</p>").to("text/html");

		expect(result.statusCode).toBe(200);
		expect(result.headers).toEqual({ "content-type": "text/html; charset=utf-8" });
		expect(result.body).toBe("<p>Hello</p>");
	});

	it("uses the provided statusCode", () => {
		const result = HtmlPage("<p>Not found</p>", 404).to("text/html");

		expect(result.statusCode).toBe(404);
		expect(result.headers).toEqual({ "content-type": "text/html; charset=utf-8" });
		expect(result.body).toBe("<p>Not found</p>");
	});

	it("returns 415 with empty body and no headers for unsupported media types", () => {
		const result = HtmlPage("<p>Hello</p>").to("application/vnd.siren+json");

		expect(result.statusCode).toBe(415);
		expect(result.headers).toEqual({});
		expect(result.body).toBe("");
	});
});

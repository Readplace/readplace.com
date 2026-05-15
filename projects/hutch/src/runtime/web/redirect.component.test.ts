import { RedirectComponent } from "./redirect.component";

describe("RedirectComponent", () => {
	it("emits the status code and Location header for text/html", () => {
		const parsed = RedirectComponent({
			statusCode: 303,
			location: "/queue",
		}).to("text/html");

		expect(parsed.statusCode).toBe(303);
		expect(parsed.headers.Location).toBe("/queue");
		expect(parsed.body).toBe("");
	});

	it("emits the same response for text/markdown — redirects are media-type agnostic", () => {
		const parsed = RedirectComponent({
			statusCode: 302,
			location: "/view/https%3A%2F%2Fexample.com",
		}).to("text/markdown");

		expect(parsed.statusCode).toBe(302);
		expect(parsed.headers.Location).toBe("/view/https%3A%2F%2Fexample.com");
		expect(parsed.body).toBe("");
	});
});

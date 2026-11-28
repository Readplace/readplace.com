import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { NotFoundPage } from "./not-found.component";

function documentOf(page: ReturnType<typeof NotFoundPage>): Document {
	return new JSDOM(page.content.html).window.document;
}

describe("NotFoundPage", () => {
	it("answers 404 with a page search engines skip", () => {
		const page = NotFoundPage({ trackSource: "not-found" });

		assert.equal(page.statusCode, 404);
		assert.equal(page.seo.title, "Page Not Found — Readplace");
		assert.equal(page.seo.description, "The page you are looking for does not exist.");
		assert.equal(page.seo.robots, "noindex, nofollow");
		assert.equal(page.bodyClass, "page-not-found");
		assert.match(page.styles, /\.not-found__container/);
	});

	it("tells the reader the page is missing", () => {
		const doc = documentOf(NotFoundPage({ trackSource: "not-found" }));

		assert.equal(doc.querySelector(".not-found__title")?.textContent, "Page not found");
		assert.equal(
			doc.querySelector(".not-found__text")?.textContent,
			"The page you are looking for does not exist or has been moved.",
		);
	});

	it("links home as a primary button tracked under the caller's source", () => {
		const doc = documentOf(NotFoundPage({ trackSource: "blog-not-found" }));
		const action = doc.querySelector("a.not-found__action");

		assert(action, "the home link must render");
		assert.equal(action.textContent, "Go to homepage");
		assert.equal(action.getAttribute("class"), "btn btn--primary not-found__action");
		assert.equal(
			action.getAttribute("href"),
			"/?utm_source=blog-not-found&utm_medium=internal&utm_content=home",
		);
	});
});

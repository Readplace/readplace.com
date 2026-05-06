import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { renderReaderFailed } from "./reader-failed.component";

function parse(html: string) {
	return new JSDOM(`<!doctype html><html><body>${html}</body></html>`).window
		.document;
}

describe("renderReaderFailed", () => {
	it("renders the failure copy and a link back to the original article", () => {
		const doc = parse(renderReaderFailed({ url: "https://example.com/post" }));

		const slot = doc.querySelector("[data-test-reader-slot]");
		assert(slot, "reader slot must be rendered");
		assert.equal(slot.getAttribute("data-reader-status"), "failed");
		assert.equal(
			doc.querySelector(".article-body__reader-failed-title")?.textContent,
			"We couldn't grab this article",
		);
		const link = doc.querySelector(".article-body__reader-failed-link");
		assert.equal(link?.getAttribute("href"), "https://example.com/post");
		assert.equal(link?.getAttribute("rel"), "noopener");
	});

	it("renders an install CTA when extensionInstallUrl is provided", () => {
		const doc = parse(
			renderReaderFailed({
				url: "https://example.com/post",
				extensionInstallUrl: "/install?browser=chrome",
			}),
		);

		const installCta = doc.querySelector("[data-test-reader-failed-install]");
		assert(installCta, "install CTA must be rendered when the extension is missing");
		assert.equal(installCta.getAttribute("href"), "/install?browser=chrome");
	});

	it("omits the install CTA when extensionInstallUrl is not provided (extension already installed)", () => {
		const doc = parse(renderReaderFailed({ url: "https://example.com/post" }));

		const installCta = doc.querySelector("[data-test-reader-failed-install]");
		assert.equal(installCta, null);
	});
});

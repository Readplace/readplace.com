import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { renderReaderFailed } from "./reader-failed.component";

function parse(html: string) {
	return new JSDOM(`<!doctype html><html><body>${html}</body></html>`).window
		.document;
}

describe("renderReaderFailed", () => {
	it("renders the failure copy and a link back to the original article for variant=failed", () => {
		const doc = parse(
			renderReaderFailed({ url: "https://example.com/post", variant: "failed" }),
		);

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

	it("renders an install CTA when extensionInstallUrl is provided for variant=failed", () => {
		const doc = parse(
			renderReaderFailed({
				url: "https://example.com/post",
				variant: "failed",
				extensionInstallUrl: "/install?browser=chrome",
			}),
		);

		const installCta = doc.querySelector("[data-test-reader-failed-install]");
		assert(installCta, "install CTA must be rendered when the extension is missing");
		assert.equal(installCta.getAttribute("href"), "/install?browser=chrome");
	});

	it("omits the install CTA when extensionInstallUrl is not provided (extension already installed)", () => {
		const doc = parse(
			renderReaderFailed({ url: "https://example.com/post", variant: "failed" }),
		);

		const installCta = doc.querySelector("[data-test-reader-failed-install]");
		assert.equal(installCta, null);
	});

	it("renders the 'not a webpage' copy and the unsupported reader-status for variant=unsupported", () => {
		const doc = parse(
			renderReaderFailed({
				url: "https://example.com/document.pdf",
				variant: "unsupported",
			}),
		);

		const slot = doc.querySelector("[data-test-reader-slot]");
		assert(slot, "reader slot must be rendered");
		assert.equal(slot.getAttribute("data-reader-status"), "unsupported");
		assert.equal(
			doc.querySelector(".article-body__reader-failed-title")?.textContent,
			"This isn't a webpage we can save",
		);
	});

	it("never renders the install CTA for variant=unsupported (no browser-extension recovery path)", () => {
		const doc = parse(
			renderReaderFailed({
				url: "https://example.com/document.pdf",
				variant: "unsupported",
				extensionInstallUrl: "/install?browser=chrome",
			}),
		);

		const installCta = doc.querySelector("[data-test-reader-failed-install]");
		assert.equal(installCta, null);
	});
});

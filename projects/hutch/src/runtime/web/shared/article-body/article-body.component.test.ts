import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import type { Minutes } from "@packages/domain/article";
import { renderArticleBody } from "./article-body.component";

const baseInput = {
	title: "Hello World",
	siteName: "example.com",
	estimatedReadTime: 3 as Minutes,
	url: "https://example.com/post",
};

function parse(html: string) {
	return new JSDOM(`<!doctype html><html><body>${html}</body></html>`).window
		.document;
}

describe("renderArticleBody", () => {
	it("renders the article title, site name, reading time and content", () => {
		const html = renderArticleBody({
			...baseInput,
			content: "<p>Body copy</p>",
		});
		const doc = parse(html);

		expect(doc.querySelector("[data-test-reader-title]")?.textContent).toBe(
			"Hello World",
		);
		expect(doc.querySelector("[data-test-reader-site]")?.textContent).toBe(
			"example.com",
		);
		expect(doc.querySelector(".article-body__meta")?.textContent).toContain(
			"3 min read",
		);
		expect(
			doc.querySelector("[data-test-reader-content]")?.innerHTML.trim(),
		).toBe("<p>Body copy</p>");
	});

	it("delegates to the summary slot renderer", () => {
		const html = renderArticleBody({
			...baseInput,
			content: "<p>Body</p>",
			summary: { status: "ready", summary: "Key points." },
		});
		const doc = parse(html);

		const slot = doc.querySelector("[data-test-reader-summary]");
		assert(slot, "summary slot must be rendered inside the article body");
		expect(slot.getAttribute("data-summary-status")).toBe("ready");
	});

	it("renders the back link inside the back slot when backLink is provided", () => {
		const html = renderArticleBody({
			...baseInput,
			content: "<p>Body</p>",
			backLink: {
				topHref: "/queue?utm_content=back-top",
				bottomHref: "/queue?utm_content=back-bottom",
				label: "← Back",
			},
		});
		const doc = parse(html);

		const slot = doc.querySelector("[data-test-back-slot]");
		assert(slot, "back slot must be rendered");
		expect(slot.classList.contains("article-body__back-slot--visible")).toBe(
			true,
		);
		const link = slot.querySelector("[data-test-back-link]");
		assert(link, "back link must be rendered when backLink is provided");
		expect(link.getAttribute("href")).toBe("/queue?utm_content=back-top");
		expect(link.textContent).toBe("← Back");
	});

	it("marks the back slot as hidden when backLink is not provided", () => {
		const html = renderArticleBody({
			...baseInput,
			content: "<p>Body</p>",
		});
		const doc = parse(html);

		const slot = doc.querySelector("[data-test-back-slot]");
		assert(slot, "back slot must be rendered");
		expect(slot.classList.contains("article-body__back-slot--hidden")).toBe(
			true,
		);
	});

	it("renders the bottom back link inside the bottom back slot when backLink is provided", () => {
		const html = renderArticleBody({
			...baseInput,
			content: "<p>Body</p>",
			backLink: {
				topHref: "/queue?utm_content=back-top",
				bottomHref: "/queue?utm_content=back-bottom",
				label: "← Back",
			},
		});
		const doc = parse(html);

		const slot = doc.querySelector("[data-test-back-bottom-slot]");
		assert(slot, "bottom back slot must be rendered");
		expect(
			slot.classList.contains("article-body__back-bottom-slot--visible"),
		).toBe(true);
		const link = slot.querySelector("[data-test-back-bottom-link]");
		assert(link, "bottom back link must be rendered when backLink is provided");
		expect(link.getAttribute("href")).toBe("/queue?utm_content=back-bottom");
		expect(link.textContent).toBe("← Back");
	});

	it("marks the bottom back slot as hidden when backLink is not provided", () => {
		const html = renderArticleBody({
			...baseInput,
			content: "<p>Body</p>",
		});
		const doc = parse(html);

		const slot = doc.querySelector("[data-test-back-bottom-slot]");
		assert(slot, "bottom back slot must be rendered");
		expect(
			slot.classList.contains("article-body__back-bottom-slot--hidden"),
		).toBe(true);
	});

	it("renders independent hrefs for the top and bottom back links so they can carry distinct UTM markers", () => {
		const html = renderArticleBody({
			...baseInput,
			content: "<p>Body</p>",
			backLink: {
				topHref: "/queue?utm_source=reader&utm_content=back-top",
				bottomHref: "/queue?utm_source=reader&utm_content=back-bottom",
				label: "← Back to queue",
			},
		});
		const doc = parse(html);

		const topLink = doc.querySelector("[data-test-back-link]");
		const bottomLink = doc.querySelector("[data-test-back-bottom-link]");
		assert(topLink, "top back link must be rendered");
		assert(bottomLink, "bottom back link must be rendered");
		expect(topLink.getAttribute("href")).toBe(
			"/queue?utm_source=reader&utm_content=back-top",
		);
		expect(bottomLink.getAttribute("href")).toBe(
			"/queue?utm_source=reader&utm_content=back-bottom",
		);
	});

	it("marks the audio slot as visible when audioEnabled is true", () => {
		const html = renderArticleBody({
			...baseInput,
			content: "<p>Body</p>",
			audioEnabled: true,
		});
		const doc = parse(html);

		const slot = doc.querySelector("[data-test-audio-player]");
		assert(slot, "audio slot must be rendered");
		expect(slot.classList.contains("article-body__audio-slot--visible")).toBe(
			true,
		);
		const audio = slot.querySelector("[data-audio-element]");
		assert(audio, "audio element must be rendered when audioEnabled");
	});

	it("marks the audio slot as hidden when audioEnabled is absent", () => {
		const html = renderArticleBody({
			...baseInput,
			content: "<p>Body</p>",
		});
		const doc = parse(html);

		const slot = doc.querySelector("[data-test-audio-player]");
		assert(slot, "audio slot must be rendered");
		expect(slot.classList.contains("article-body__audio-slot--hidden")).toBe(
			true,
		);
	});

	it("renders the reader-pending slot when content is undefined and no crawl status is provided (read-after-write race)", () => {
		const html = renderArticleBody({
			...baseInput,
			content: undefined,
			readerPollUrl: "/queue/abc/reader?poll=1",
		});
		const doc = parse(html);

		const slot = doc.querySelector("[data-test-reader-slot]");
		assert(slot, "reader slot must be rendered");
		expect(slot.getAttribute("data-reader-status")).toBe("pending");
		expect(slot.getAttribute("hx-get")).toBe("/queue/abc/reader?poll=1");
	});

	it("renders the reader-pending slot with poll attributes when crawl is pending", () => {
		const html = renderArticleBody({
			...baseInput,
			content: undefined,
			crawl: { status: "pending" },
			readerPollUrl: "/queue/abc/reader?poll=1",
		});
		const doc = parse(html);

		const slot = doc.querySelector("[data-test-reader-slot]");
		assert(slot, "reader slot must be rendered");
		expect(slot.getAttribute("data-reader-status")).toBe("pending");
		expect(slot.getAttribute("hx-get")).toBe("/queue/abc/reader?poll=1");
		expect(slot.getAttribute("hx-trigger")).toBe("every 3s");
		expect(slot.getAttribute("hx-swap")).toBe("outerHTML");
	});

	it("renders the reader-failed slot when crawl status is failed", () => {
		const html = renderArticleBody({
			...baseInput,
			content: undefined,
			crawl: { status: "failed", reason: "exceeded SQS maxReceiveCount" },
		});
		const doc = parse(html);

		const slot = doc.querySelector("[data-test-reader-slot]");
		assert(slot, "reader slot must be rendered");
		expect(slot.getAttribute("data-reader-status")).toBe("failed");
		const link = slot.querySelector(".article-body__reader-failed-link");
		expect(link?.getAttribute("href")).toBe("https://example.com/post");
	});

});

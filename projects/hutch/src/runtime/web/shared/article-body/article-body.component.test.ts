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

	it("renders a mark-read form in the top slot when markReadActions is provided", () => {
		const html = renderArticleBody({
			...baseInput,
			content: "<p>Body</p>",
			markReadActions: [
				{
					position: "top",
					postUrl: "/queue/abc/status?utm_content=mark-read-top",
					label: "Mark as read",
					fields: [{ name: "status", value: "read" }],
				},
				{
					position: "bottom",
					postUrl: "/queue/abc/status?utm_content=mark-read-bottom",
					label: "Mark as read",
					fields: [{ name: "status", value: "read" }],
				},
			],
		});
		const doc = parse(html);

		const slot = doc.querySelector("[data-test-mark-read-slot]");
		assert(slot, "top mark-read slot must be rendered");
		expect(slot.classList.contains("article-body__mark-read-slot--visible")).toBe(true);

		const form = slot.querySelector("[data-test-mark-read-form]");
		assert(form, "top mark-read form must be rendered");
		expect(form.getAttribute("method")).toMatch(/post/i);
		expect(form.getAttribute("action")).toBe("/queue/abc/status?utm_content=mark-read-top");
		const hidden = form.querySelector('input[type="hidden"][name="status"]');
		assert(hidden, "form must carry the status hidden input");
		expect(hidden.getAttribute("value")).toBe("read");
		const button = form.querySelector("[data-test-mark-read-btn]");
		assert(button, "top mark-read button must be rendered");
		expect(button.textContent).toBe("Mark as read");
	});

	it("renders a mark-read form in the bottom slot when markReadActions is provided", () => {
		const html = renderArticleBody({
			...baseInput,
			content: "<p>Body</p>",
			markReadActions: [
				{
					position: "top",
					postUrl: "/queue/abc/status?utm_content=mark-read-top",
					label: "Mark as read",
					fields: [{ name: "status", value: "read" }],
				},
				{
					position: "bottom",
					postUrl: "/queue/abc/status?utm_content=mark-read-bottom",
					label: "Mark as read",
					fields: [{ name: "status", value: "read" }],
				},
			],
		});
		const doc = parse(html);

		const slot = doc.querySelector("[data-test-mark-read-bottom-slot]");
		assert(slot, "bottom mark-read slot must be rendered");
		expect(
			slot.classList.contains("article-body__mark-read-bottom-slot--visible"),
		).toBe(true);

		const form = slot.querySelector("[data-test-mark-read-bottom-form]");
		assert(form, "bottom mark-read form must be rendered");
		expect(form.getAttribute("action")).toBe(
			"/queue/abc/status?utm_content=mark-read-bottom",
		);
	});

	it("hides both mark-read slots when markReadActions is not provided", () => {
		const html = renderArticleBody({
			...baseInput,
			content: "<p>Body</p>",
		});
		const doc = parse(html);

		const top = doc.querySelector("[data-test-mark-read-slot]");
		const bottom = doc.querySelector("[data-test-mark-read-bottom-slot]");
		assert(top, "top mark-read slot must be rendered");
		assert(bottom, "bottom mark-read slot must be rendered");
		expect(top.classList.contains("article-body__mark-read-slot--hidden")).toBe(true);
		expect(
			bottom.classList.contains("article-body__mark-read-bottom-slot--hidden"),
		).toBe(true);
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

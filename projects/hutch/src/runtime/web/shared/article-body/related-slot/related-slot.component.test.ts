import assert from "node:assert/strict";
import { ReaderArticleHashIdSchema } from "@packages/domain/article";
import { JSDOM } from "jsdom";
import { renderRelatedSlot } from "./related-slot.component";

function parse(html: string) {
	return new JSDOM(`<!doctype html><html><body>${html}</body></html>`).window
		.document;
}

const firstId = ReaderArticleHashIdSchema.parse("0123456789abcdef0123456789abcdef");
const secondId = ReaderArticleHashIdSchema.parse("fedcba9876543210fedcba9876543210");
const sourceId = ReaderArticleHashIdSchema.parse("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");

function relatedHrefFor(targetId: string): string {
	return `/queue/${targetId}/view?utm_source=reader&utm_medium=internal&utm_content=related&utm_term=${sourceId.value}`;
}

function slotOf(doc: Document) {
	const slot = doc.querySelector("[data-test-reader-related]");
	assert(slot, "the related slot must always be rendered");
	return slot;
}

describe("renderRelatedSlot", () => {
	it("returns only the slot HTML (no outer page)", () => {
		const html = renderRelatedSlot({});

		expect(html.startsWith("<div")).toBe(true);
		expect(html.includes("<html")).toBe(false);
	});

	it("hides the slot while nothing has been computed", () => {
		const slot = slotOf(parse(renderRelatedSlot({})));

		expect(slot.getAttribute("data-related-status")).toBe("pending");
		expect(slot.classList.contains("article-body__related-slot--hidden")).toBe(true);
	});

	it("hides the slot when the computation was skipped", () => {
		const slot = slotOf(
			parse(
				renderRelatedSlot({
					related: { articles: { status: "skipped" }, sourceArticleId: sourceId.value },
				}),
			),
		);

		expect(slot.getAttribute("data-related-status")).toBe("skipped");
		expect(slot.classList.contains("article-body__related-slot--hidden")).toBe(true);
	});

	it("hides the slot when the computation found nothing related", () => {
		const slot = slotOf(
			parse(
				renderRelatedSlot({
					related: {
						articles: { status: "ready", items: [] },
						sourceArticleId: sourceId.value,
					},
				}),
			),
		);

		expect(slot.getAttribute("data-related-status")).toBe("ready");
		expect(slot.classList.contains("article-body__related-slot--hidden")).toBe(true);
	});

	it("shows every relation with its title, site and reason", () => {
		const doc = parse(
			renderRelatedSlot({
				related: {
					articles: {
						status: "ready",
						items: [
							{ id: firstId, title: "First", siteName: "Example", reason: "Same argument" },
							{ id: secondId, title: "Second", siteName: "Other", reason: "Follow-up" },
						],
					},
					sourceArticleId: sourceId.value,
				},
			}),
		);

		const slot = slotOf(doc);
		expect(slot.classList.contains("article-body__related-slot--visible")).toBe(true);
		const links = Array.from(doc.querySelectorAll("[data-test-related-item]"));
		expect(
			links.map((link) => ({
				id: link.getAttribute("data-test-related-item"),
				href: link.getAttribute("href"),
				title: link.querySelector(".related-slot__title")?.textContent,
				siteName: link.querySelector(".related-slot__site")?.textContent,
				reason: link.querySelector(".related-slot__reason")?.textContent,
			})),
		).toEqual([
			{
				id: firstId.value,
				href: relatedHrefFor(firstId.value),
				title: "First",
				siteName: "Example",
				reason: "Same argument",
			},
			{
				id: secondId.value,
				href: relatedHrefFor(secondId.value),
				title: "Second",
				siteName: "Other",
				reason: "Follow-up",
			},
		]);
	});

	it("boosts the relation list so each link navigates like the rest of the reader", () => {
		const doc = parse(
			renderRelatedSlot({
				related: {
					articles: {
						status: "ready",
						items: [
							{ id: firstId, title: "First", siteName: "Example", reason: "Same argument" },
						],
					},
					sourceArticleId: sourceId.value,
				},
			}),
		);

		const list = doc.querySelector(".related-slot__list");
		assert(list, "a ready slot must render the relation list");
		expect({
			boost: list.getAttribute("hx-boost"),
			target: list.getAttribute("hx-target"),
			select: list.getAttribute("hx-select"),
			swap: list.getAttribute("hx-swap"),
		}).toEqual({
			boost: "true",
			target: "main",
			select: "main",
			swap: "outerHTML show:none",
		});
	});
});

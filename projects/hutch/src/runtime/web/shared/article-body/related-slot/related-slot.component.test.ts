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
const NOW = new Date("2026-08-05T12:00:00.000Z");
const savedDaysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000);

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
					related: {
						articles: { status: "skipped" },
						sourceArticleId: sourceId.value,
						now: NOW,
					},
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
						now: NOW,
					},
				}),
			),
		);

		expect(slot.getAttribute("data-related-status")).toBe("ready");
		expect(slot.classList.contains("article-body__related-slot--hidden")).toBe(true);
	});

	it("shows every relation with its title, site, reason and when it was saved", () => {
		const doc = parse(
			renderRelatedSlot({
				related: {
					articles: {
						status: "ready",
						items: [
							{
								id: firstId,
								title: "First",
								siteName: "Example",
								reason: "Same argument",
								status: "unread",
								savedAt: savedDaysAgo(60),
							},
							{
								id: secondId,
								title: "Second",
								siteName: "Other",
								reason: "Follow-up",
								status: "read",
								savedAt: savedDaysAgo(7),
							},
						],
					},
					sourceArticleId: sourceId.value,
					now: NOW,
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
				saved: link.querySelector(".related-slot__saved")?.textContent,
			})),
		).toEqual([
			{
				id: firstId.value,
				href: relatedHrefFor(firstId.value),
				title: "First",
				siteName: "Example",
				reason: "Same argument",
				saved: "You saved this 2 months ago",
			},
			{
				id: secondId.value,
				href: relatedHrefFor(secondId.value),
				title: "Second",
				siteName: "Other",
				reason: "Follow-up",
				saved: "You saved this 1 week ago",
			},
		]);
	});

	it("marks every relation with the reader's own read state", () => {
		const doc = parse(
			renderRelatedSlot({
				related: {
					articles: {
						status: "ready",
						items: [
							{
								id: firstId,
								title: "First",
								siteName: "Example",
								reason: "Same argument",
								status: "unread",
								savedAt: savedDaysAgo(60),
							},
							{
								id: secondId,
								title: "Second",
								siteName: "Other",
								reason: "Follow-up",
								status: "read",
								savedAt: savedDaysAgo(7),
							},
						],
					},
					sourceArticleId: sourceId.value,
					now: NOW,
				},
			}),
		);

		const states = Array.from(doc.querySelectorAll("[data-test-related-item]")).map(
			(link) => {
				const badge = link.querySelector(".related-slot__status");
				assert(badge, "every relation carries its read state");
				const label = badge.querySelector(".related-slot__status-label");
				assert(label, "a read state names itself in words, not only by its shape");
				return {
					state: badge.getAttribute("data-test-read-status"),
					unread: badge.classList.contains("related-slot__status--unread"),
					read: badge.classList.contains("related-slot__status--read"),
					label: label.textContent,
				};
			},
		);

		expect(states).toEqual([
			{ state: "unread", unread: true, read: false, label: "Unread" },
			{ state: "read", unread: false, read: true, label: "Read" },
		]);
	});

	it("marks the saved time up so the client enhancer can localise it into a hover title", () => {
		const savedAt = savedDaysAgo(60);
		const doc = parse(
			renderRelatedSlot({
				related: {
					articles: {
						status: "ready",
						items: [
							{
								id: firstId,
								title: "First",
								siteName: "Example",
								reason: "Same argument",
								status: "unread",
								savedAt,
							},
						],
					},
					sourceArticleId: sourceId.value,
					now: NOW,
				},
			}),
		);

		const time = doc.querySelector(".related-slot__saved time");
		assert(time, "the saved line must carry a <time> the enhancer can find");
		expect({
			tag: time.tagName,
			datetime: time.getAttribute("datetime"),
			mode: time.getAttribute("data-local-time"),
			text: time.textContent,
		}).toEqual({
			tag: "TIME",
			datetime: savedAt.toISOString(),
			mode: "relative",
			text: "2 months ago",
		});
	});

	it("keeps ticking while the computation is still pending", () => {
		const slot = slotOf(
			parse(renderRelatedSlot({ pollUrl: "/queue/abc/related?feature=similar&poll=2" })),
		);

		expect({
			get: slot.getAttribute("hx-get"),
			trigger: slot.getAttribute("hx-trigger"),
			swap: slot.getAttribute("hx-swap"),
		}).toEqual({
			get: "/queue/abc/related?feature=similar&poll=2",
			trigger: "every 3s",
			swap: "outerHTML",
		});
	});

	it("stops ticking once the computation answered, even with nothing related", () => {
		const slot = slotOf(
			parse(
				renderRelatedSlot({
					related: {
						articles: { status: "ready", items: [] },
						sourceArticleId: sourceId.value,
						now: NOW,
					},
					pollUrl: "/queue/abc/related?feature=similar&poll=2",
				}),
			),
		);

		expect(slot.hasAttribute("hx-get")).toBe(false);
	});

	it("stops ticking once the computation was skipped", () => {
		const slot = slotOf(
			parse(
				renderRelatedSlot({
					related: {
						articles: { status: "skipped" },
						sourceArticleId: sourceId.value,
						now: NOW,
					},
					pollUrl: "/queue/abc/related?feature=similar&poll=2",
				}),
			),
		);

		expect(slot.hasAttribute("hx-get")).toBe(false);
	});

	it("never ticks when the reader was given no poll url", () => {
		const slot = slotOf(parse(renderRelatedSlot({})));

		expect(slot.hasAttribute("hx-get")).toBe(false);
	});

	it("boosts the relation list so each link navigates like the rest of the reader", () => {
		const doc = parse(
			renderRelatedSlot({
				related: {
					articles: {
						status: "ready",
						items: [
							{
								id: firstId,
								title: "First",
								siteName: "Example",
								reason: "Same argument",
								status: "unread",
								savedAt: savedDaysAgo(60),
							},
						],
					},
					sourceArticleId: sourceId.value,
					now: NOW,
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

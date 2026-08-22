import assert from "node:assert/strict";
import { QUEUE_LABEL_MAX_LENGTH, QueueSlugSchema } from "@packages/domain/queue";
import { JSDOM } from "jsdom";
import { buildQueueNav, renderQueueNav } from "./queue-nav.component";
import { DEFAULT_QUEUE, type Queue } from "./queue.nav";

const WORK: Queue = { slug: QueueSlugSchema.parse("work"), label: "Work Reading" };
const QUEUES: readonly Queue[] = [DEFAULT_QUEUE, WORK];

function renderNav(overrides: Partial<Parameters<typeof buildQueueNav>[0]> = {}): Document {
	const input = {
		queues: QUEUES,
		activeSlug: DEFAULT_QUEUE.slug,
		linkParams: [["feature", "queues"]] as const,
		newQueueAction: "/queue/queues?feature=queues",
		canCreate: true,
		...overrides,
	};
	return new JSDOM(`<main>${renderQueueNav(buildQueueNav(input))}</main>`).window.document;
}

function queueLink(doc: Document, testQueue: string): Element {
	const link = doc.querySelector(`[data-test-queue="${testQueue}"]`);
	assert(link, `the ${testQueue} queue must be rendered`);
	return link;
}

function queueLabel(doc: Document, testQueue: string): string | null {
	const label = queueLink(doc, testQueue).querySelector(".queue-nav__label");
	assert(label, `the ${testQueue} queue must carry its name in an element of its own`);
	return label.textContent;
}

function renameable(doc: Document): (string | null)[] {
	return Array.from(doc.querySelectorAll("[data-queue-rename]"), (el) =>
		el.getAttribute("data-test-queue"),
	);
}

function hrefParts(link: Element): { path: string; params: URLSearchParams } {
	const url = new URL(link.getAttribute("href") ?? "", "https://internal.invalid");
	return { path: url.pathname, params: url.searchParams };
}

describe("buildQueueNav", () => {
	it("should render one link per queue, in the order the queues are given", () => {
		const doc = renderNav();

		const rendered = Array.from(doc.querySelectorAll("[data-test-queue]")).map((el) =>
			el.getAttribute("data-test-queue"),
		);
		expect(rendered).toEqual(["default", "work"]);
	});

	it("should title each queue from the label the reader gave it", () => {
		const doc = renderNav();

		expect(queueLink(doc, "default").textContent).toBe("My Queue");
		expect(queueLink(doc, "work").textContent).toBe("Work Reading");
	});

	it("should tell assistive tech which queue the reader is on, and only that one", () => {
		const doc = renderNav({ activeSlug: WORK.slug });

		expect(queueLink(doc, "work").getAttribute("aria-current")).toBe("page");
		expect(queueLink(doc, "default").getAttribute("aria-current")).toBeNull();
	});

	it("should mark the viewed queue's tab so it reads as the selected one", () => {
		const doc = renderNav({ activeSlug: WORK.slug });

		expect(queueLink(doc, "work").getAttribute("class")).toBe(
			"queue-nav__link queue-nav__link--active",
		);
		expect(queueLink(doc, "default").getAttribute("class")).toBe("queue-nav__link");
	});

	it("should point each queue at its own listing with its own tracking token", () => {
		const doc = renderNav();

		const forDefault = hrefParts(queueLink(doc, "default"));
		expect(forDefault.path).toBe("/queue");
		expect(forDefault.params.get("queue")).toBeNull();
		expect(forDefault.params.get("utm_content")).toBe("queue-default");

		const forWork = hrefParts(queueLink(doc, "work"));
		expect(forWork.path).toBe("/queue");
		expect(forWork.params.get("queue")).toBe("work");
		expect(forWork.params.get("utm_source")).toBe("queue-nav");
		expect(forWork.params.get("utm_content")).toBe("queue-work");
	});

	it("should carry the queues toggle onto every queue link so the rail survives the click", () => {
		const doc = renderNav();

		for (const slug of ["default", "work"]) {
			expect(hrefParts(queueLink(doc, slug)).params.get("feature")).toBe("queues");
		}
	});

	it("should open a queue at its own default view rather than carrying the read-state tab and sort", () => {
		const doc = renderNav();

		const { params } = hrefParts(queueLink(doc, "work"));
		expect(params.get("tab")).toBeNull();
		expect(params.get("order")).toBeNull();
		expect(params.get("page")).toBeNull();
	});

	it("should list each queue as its own item so assistive tech announces the set size", () => {
		const doc = renderNav();

		const items = Array.from(doc.querySelectorAll(".queue-nav__list > .queue-nav__item")).map(
			(item) => item.querySelector("[data-test-queue]")?.getAttribute("data-test-queue"),
		);
		expect(items).toEqual(["default", "work"]);
	});

	it("should start a new queue by posting, so the queue exists before it is named", () => {
		const doc = renderNav();

		const form = doc.querySelector("nav.queue-nav > form.queue-nav__new-form");
		assert(form, "the new-queue control must sit beside the queue list, not inside it");
		const control = form.querySelector('[data-test-action="new-queue"]');
		assert(control, "the new-queue control must submit the create form");
		expect({
			method: form.getAttribute("method"),
			action: form.getAttribute("action"),
			type: control.getAttribute("type"),
			label: control.textContent,
		}).toEqual({
			method: "POST",
			action: "/queue/queues?feature=queues",
			type: "submit",
			label: "New queue",
		});
	});

	it("should withhold the new-queue control from a reader who cannot write", () => {
		const doc = renderNav({ canCreate: false });

		expect(doc.querySelector('[data-test-action="new-queue"]')).toBeNull();
		expect(doc.querySelectorAll("[data-test-queue]")).toHaveLength(2);
	});

	it("should offer the queue the reader is on for renaming, in place", () => {
		const doc = renderNav({ activeSlug: WORK.slug });

		const tab = queueLink(doc, "work");
		expect({
			tagName: tab.tagName,
			action: tab.getAttribute("data-queue-rename"),
			field: tab.getAttribute("data-queue-rename-field"),
			max: tab.getAttribute("data-queue-label-max"),
			current: tab.getAttribute("aria-current"),
			queue: hrefParts(tab).params.get("queue"),
		}).toEqual({
			tagName: "A",
			action: "/queue/queues/work/rename?feature=queues",
			field: "label",
			max: String(QUEUE_LABEL_MAX_LENGTH),
			current: "page",
			queue: "work",
		});
	});

	it("should opt the renameable tab out of boosting so the reader's own tap opens the editor", () => {
		const doc = renderNav({ activeSlug: WORK.slug });

		expect(queueLink(doc, "work").getAttribute("hx-boost")).toBe("false");
		expect(queueLink(doc, "default").getAttribute("hx-boost")).toBeNull();
	});

	it("should keep a queue's name in an element of its own, so editing cannot swallow the pencil", () => {
		const doc = renderNav({ activeSlug: WORK.slug });

		const tab = queueLink(doc, "work");
		expect(queueLabel(doc, "work")).toBe("Work Reading");
		expect(tab.querySelectorAll("svg")).toHaveLength(1);
	});

	it("should say what the pencil does for a reader who cannot see it", () => {
		const doc = renderNav({ activeSlug: WORK.slug });

		const tab = queueLink(doc, "work");
		expect(tab.getAttribute("aria-label")).toBe("Rename Work Reading");
		expect(tab.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
	});

	it("should leave every queue the reader is not on a plain link with nothing to rename", () => {
		const doc = renderNav({ activeSlug: WORK.slug });

		expect(renameable(doc)).toEqual(["work"]);
		expect(hrefParts(queueLink(doc, "default")).path).toBe("/queue");
	});

	it("should never offer the built-in queue for renaming, even when the reader is on it", () => {
		const doc = renderNav({ activeSlug: DEFAULT_QUEUE.slug });

		const tab = queueLink(doc, "default");
		expect(renameable(doc)).toEqual([]);
		expect(tab.getAttribute("aria-current")).toBe("page");
		expect(hrefParts(tab).path).toBe("/queue");
	});

	it("should withhold renaming from a reader who cannot write", () => {
		const doc = renderNav({ canCreate: false, activeSlug: WORK.slug });

		expect(renameable(doc)).toEqual([]);
		expect(hrefParts(queueLink(doc, "work")).params.get("queue")).toBe("work");
	});

	it("should name the landmark so it is distinguishable from the page's other navs", () => {
		const doc = renderNav();

		const nav = doc.querySelector("nav.queue-nav");
		assert(nav, "the queue nav must be a navigation landmark");
		expect(nav.getAttribute("aria-label")).toBe("Queues");
	});
});

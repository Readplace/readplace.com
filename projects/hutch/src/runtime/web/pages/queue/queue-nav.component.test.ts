import assert from "node:assert/strict";
import { QueueSlugSchema } from "@packages/domain/queue";
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
		newQueueHref: "/queue?feature=queues&create=1",
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

	it("should offer a way to start a new queue, named for assistive tech and beside the list", () => {
		const doc = renderNav();

		const control = doc.querySelector('nav.queue-nav > [data-test-action="new-queue"]');
		assert(control, "the new-queue control must sit beside the queue list, not inside it");
		expect({ label: control.textContent, href: control.getAttribute("href") }).toEqual({
			label: "New queue",
			href: "/queue?feature=queues&create=1",
		});
	});

	it("should withhold the new-queue control from a reader who cannot write", () => {
		const doc = renderNav({ canCreate: false });

		expect(doc.querySelector('[data-test-action="new-queue"]')).toBeNull();
		expect(doc.querySelectorAll("[data-test-queue]")).toHaveLength(2);
	});

	it("should name the landmark so it is distinguishable from the page's other navs", () => {
		const doc = renderNav();

		const nav = doc.querySelector("nav.queue-nav");
		assert(nav, "the queue nav must be a navigation landmark");
		expect(nav.getAttribute("aria-label")).toBe("Queues");
	});
});

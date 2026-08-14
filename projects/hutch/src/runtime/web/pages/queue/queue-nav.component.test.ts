import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { buildQueueNav, renderQueueNav } from "./queue-nav.component";
import { QUEUES, queueTitle } from "./queue.nav";

function renderNav(input: Parameters<typeof buildQueueNav>[0]): Document {
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

describe("queueTitle", () => {
	it("should title the default queue", () => {
		expect(queueTitle("default")).toBe("My Queue");
	});
});

describe("buildQueueNav", () => {
	it("should render one link per queue, in the order the queues are given", () => {
		const doc = renderNav({ queues: QUEUES });

		const rendered = Array.from(doc.querySelectorAll("[data-test-queue]")).map((el) =>
			el.getAttribute("data-test-queue"),
		);
		expect(rendered).toEqual(QUEUES.map((queue) => queue.name));
	});

	it("should title each queue from its definition", () => {
		const doc = renderNav({ queues: QUEUES });

		expect(queueLink(doc, "default").textContent).toBe("My Queue");
	});

	it("should tell assistive tech which queue the reader is on", () => {
		const doc = renderNav({ queues: QUEUES });

		expect(queueLink(doc, "default").getAttribute("aria-current")).toBe("page");
	});

	it("should point each queue at its listing with its own tracking token", () => {
		const doc = renderNav({ queues: QUEUES });

		const { path, params } = hrefParts(queueLink(doc, "default"));
		expect(path).toBe("/queue");
		expect(params.get("utm_source")).toBe("queue-nav");
		expect(params.get("utm_content")).toBe("queue-default");
	});

	it("should open a queue at its own default view rather than carrying the read-state tab and sort", () => {
		const doc = renderNav({ queues: QUEUES });

		const { params } = hrefParts(queueLink(doc, "default"));
		expect(params.get("tab")).toBeNull();
		expect(params.get("order")).toBeNull();
		expect(params.get("page")).toBeNull();
	});

	it("should list each queue as its own item so assistive tech announces the set size", () => {
		const doc = renderNav({ queues: QUEUES });

		const items = Array.from(doc.querySelectorAll(".queue-nav__list > .queue-nav__item")).map(
			(item) => item.querySelector("[data-test-queue]")?.getAttribute("data-test-queue"),
		);
		expect(items).toEqual(QUEUES.map((queue) => queue.name));
	});

	it("should offer a way to start a new queue, named for assistive tech and inert until it does something", () => {
		const doc = renderNav({ queues: QUEUES });

		const control = doc.querySelector('nav.queue-nav > [data-test-action="new-queue"]');
		assert(control, "the new-queue control must sit beside the queue list, not inside it");
		expect({ label: control.textContent, type: control.getAttribute("type") }).toEqual({
			label: "New queue",
			type: "button",
		});
	});

	it("should name the landmark so it is distinguishable from the page's other navs", () => {
		const doc = renderNav({ queues: QUEUES });

		const nav = doc.querySelector("nav.queue-nav");
		assert(nav, "the queue nav must be a navigation landmark");
		expect(nav.getAttribute("aria-label")).toBe("Queues");
	});
});

import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { renderReadlistTabTotal } from "./readlist-tab-total.component";

function countSpan(html: string): Element {
	const span = new JSDOM(html).window.document.querySelector("#readlist-count");
	assert(span, "the count span must render");
	return span;
}

function numberSpan(html: string): Element {
	const number = countSpan(html).querySelector("[data-test-listing-count-number]");
	assert(number, "the number span must render");
	return number;
}

function nounText(html: string): string {
	const noun = countSpan(html).querySelector("[data-test-listing-count-noun]");
	assert(noun, "the noun span must render");
	return noun.textContent ?? "";
}

describe("renderReadlistTabTotal", () => {
	it("names what the To Read tab counts", () => {
		expect(nounText(renderReadlistTabTotal({ tab: "queue", total: 42 }))).toBe("Unread Articles");
	});

	it("names what the Read tab counts", () => {
		expect(nounText(renderReadlistTabTotal({ tab: "done", total: 42 }))).toBe("Read Articles");
	});

	it("uses the singular noun for exactly one article", () => {
		expect(nounText(renderReadlistTabTotal({ tab: "queue", total: 1 }))).toBe("Unread Article");
	});

	it("renders a zero total with the plural noun", () => {
		const html = renderReadlistTabTotal({ tab: "done", total: 0 });
		expect(numberSpan(html).textContent).toBe("0");
		expect(nounText(html)).toBe("Read Articles");
	});

	it("renders an exact number up to the cap", () => {
		expect(numberSpan(renderReadlistTabTotal({ tab: "queue", total: 9999 })).textContent).toBe(
			"9999",
		);
	});

	it("caps a total above the limit", () => {
		expect(numberSpan(renderReadlistTabTotal({ tab: "queue", total: 10000 })).textContent).toBe(
			"9999+",
		);
	});

	it("marks the number known and reads as one label once a total is present", () => {
		const html = renderReadlistTabTotal({ tab: "queue", total: 3 });
		expect(countSpan(html).textContent).toBe("3 Unread Articles");
		expect(numberSpan(html).getAttribute("class")).toBe(
			"readlist__count-value readlist__count-value--known",
		);
	});

	it("leaves the number empty and pending, with the plural noun, while the total is unknown", () => {
		const html = renderReadlistTabTotal({ tab: "queue", total: undefined });
		expect(numberSpan(html).textContent).toBe("");
		expect(numberSpan(html).getAttribute("class")).toBe(
			"readlist__count-value readlist__count-value--pending",
		);
		expect(nounText(html)).toBe("Unread Articles");
	});

	it("reserves the slot for the widest displayable number", () => {
		const number = numberSpan(renderReadlistTabTotal({ tab: "queue", total: 3 }));
		const slot = number.parentElement;
		assert(slot, "the number sits inside the reserving slot");
		expect(slot.getAttribute("data-widest")).toBe("9999+");
	});

	it("omits the out-of-band swap attribute on the page's own render", () => {
		expect(countSpan(renderReadlistTabTotal({ tab: "queue", total: 3 })).getAttribute("hx-swap-oob")).toBeNull();
	});

	it("carries the out-of-band swap attribute for the deferred counts response", () => {
		expect(
			countSpan(renderReadlistTabTotal({ tab: "done", total: 5, oob: true })).getAttribute(
				"hx-swap-oob",
			),
		).toBe("outerHTML");
	});
});

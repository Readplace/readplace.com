import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import type { CrawlRemainingEstimate } from "@packages/domain/article";
import { initCrawlEstimate } from "./crawl-estimate.client";
import { renderCrawlEstimate } from "./crawl-estimate.component";

function createHarness(estimate: CrawlRemainingEstimate | undefined) {
	const dom = new JSDOM(`<!doctype html><html><body><main>${renderCrawlEstimate(estimate)}</main></body></html>`);
	const document = dom.window.document;
	const ticks: (() => void)[] = [];
	initCrawlEstimate({ document, everySecond: (callback) => ticks.push(callback) });

	function estimateElement(): Element {
		const element = document.querySelector("[data-test-crawl-estimate]");
		assert(element, "the crawl estimate must be rendered");
		return element;
	}

	return {
		tick(times: number) {
			for (let i = 0; i < times; i += 1) for (const callback of ticks) callback();
		},
		swapIn(next: CrawlRemainingEstimate) {
			const main = document.querySelector("main");
			assert(main, "the harness page holds a <main>");
			main.innerHTML = renderCrawlEstimate(next);
		},
		state() {
			const element = estimateElement();
			return {
				kind: ["quiet", "counting", "almost-there", "hidden"].find((kind) =>
					element.classList.contains(`crawl-estimate--${kind}`),
				),
				text: element.textContent,
				remaining: element.getAttribute("data-remaining-seconds"),
			};
		},
	};
}

describe("initCrawlEstimate", () => {
	it("counts a shown estimate down one second per tick", () => {
		const harness = createHarness({ kind: "counting", seconds: 120 });

		harness.tick(3);

		expect(harness.state()).toEqual({ kind: "counting", text: "~117 s left", remaining: "117" });
	});

	it("keeps a quiet estimate hidden until its reveal time, then shows the count", () => {
		const harness = createHarness({ kind: "quiet", revealInSeconds: 2, seconds: 158 });

		harness.tick(1);
		const beforeReveal = harness.state();
		harness.tick(1);

		expect([beforeReveal, harness.state()]).toEqual([
			{ kind: "quiet", text: "~157 s left", remaining: "157" },
			{ kind: "counting", text: "~156 s left", remaining: "156" },
		]);
	});

	it("says it is almost there once the count reaches zero, and stops counting", () => {
		const harness = createHarness({ kind: "counting", seconds: 2 });

		harness.tick(2);
		const atZero = harness.state();
		harness.tick(5);

		expect([atZero, harness.state()]).toEqual([
			{ kind: "almost-there", text: "Almost there…", remaining: "0" },
			{ kind: "almost-there", text: "Almost there…", remaining: "0" },
		]);
	});

	it("leaves a card that is not pending untouched", () => {
		const harness = createHarness(undefined);

		harness.tick(4);

		expect(harness.state()).toEqual({ kind: "hidden", text: "Almost there…", remaining: "0" });
	});

	it("counts down an estimate a poll swapped in after the ticker started", () => {
		const harness = createHarness({ kind: "counting", seconds: 120 });
		harness.tick(1);

		harness.swapIn({ kind: "counting", seconds: 16 });
		harness.tick(1);

		expect(harness.state()).toEqual({ kind: "counting", text: "~15 s left", remaining: "15" });
	});
});

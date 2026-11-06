import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import type { CrawlRemainingEstimate } from "@packages/domain/article";
import { initCrawlEstimate } from "./crawl-estimate.client";
import { renderCrawlEstimate } from "./crawl-estimate.component";

const CARD = "a1";

function createHarness(estimate: CrawlRemainingEstimate | undefined) {
	const dom = new JSDOM(
		`<!doctype html><html><body><main>${renderCrawlEstimate({ key: CARD, estimate })}</main></body></html>`,
	);
	const document = dom.window.document;
	const ticks: (() => void)[] = [];
	const pageChanges: (() => void)[] = [];
	initCrawlEstimate({
		document,
		everySecond: (callback) => ticks.push(callback),
		afterPageChange: (callback) => pageChanges.push(callback),
	});

	function estimateElement(key: string): Element {
		const element = document.querySelector(`[data-crawl-estimate-key="${key}"]`);
		assert(element, "the crawl estimate must be rendered");
		return element;
	}

	return {
		tick(times: number) {
			for (let i = 0; i < times; i += 1) for (const callback of ticks) callback();
		},
		swapIn(next: CrawlRemainingEstimate | undefined, key = CARD) {
			const main = document.querySelector("main");
			assert(main, "the harness page holds a <main>");
			main.innerHTML = renderCrawlEstimate({ key, estimate: next });
			for (const callback of pageChanges) callback();
		},
		state(key = CARD) {
			const element = estimateElement(key);
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

	it("reveals a quiet estimate that reaches zero before its reveal time as almost there", () => {
		const harness = createHarness({ kind: "quiet", revealInSeconds: 2, seconds: 1 });

		harness.tick(1);
		const beforeReveal = harness.state();
		harness.tick(1);

		expect([beforeReveal, harness.state()]).toEqual([
			{ kind: "quiet", text: "Almost there…", remaining: "0" },
			{ kind: "almost-there", text: "Almost there…", remaining: "-1" },
		]);
	});

	it("leaves a card that was never given an estimate hidden", () => {
		const harness = createHarness(undefined);

		harness.tick(4);
		harness.swapIn(undefined);

		expect(harness.state()).toEqual({ kind: "hidden", text: "Almost there…", remaining: "0" });
	});

	it("counts down an estimate a poll swapped in after the ticker started", () => {
		const harness = createHarness({ kind: "counting", seconds: 120 });
		harness.tick(1);

		harness.swapIn({ kind: "counting", seconds: 16 });
		harness.tick(1);

		expect(harness.state()).toEqual({ kind: "counting", text: "~15 s left", remaining: "15" });
	});

	it("keeps the count showing when a poll swaps in a card without an estimate", () => {
		const harness = createHarness({ kind: "counting", seconds: 120 });
		harness.tick(2);

		harness.swapIn(undefined);
		const asSwapped = harness.state();
		harness.tick(1);

		expect([asSwapped, harness.state()]).toEqual([
			{ kind: "counting", text: "~118 s left", remaining: "118" },
			{ kind: "counting", text: "~117 s left", remaining: "117" },
		]);
	});

	it("keeps the count a poll swapped in even before the ticker has seen it", () => {
		const harness = createHarness(undefined);

		harness.swapIn({ kind: "counting", seconds: 40 });
		harness.swapIn(undefined);

		expect(harness.state()).toEqual({ kind: "counting", text: "~40 s left", remaining: "40" });
	});

	it("keeps a quiet estimate's reveal schedule across a swap without an estimate", () => {
		const harness = createHarness({ kind: "quiet", revealInSeconds: 3, seconds: 150 });
		harness.tick(1);

		harness.swapIn(undefined);
		const stillQuiet = harness.state();
		harness.tick(2);

		expect([stillQuiet, harness.state()]).toEqual([
			{ kind: "quiet", text: "~149 s left", remaining: "149" },
			{ kind: "counting", text: "~147 s left", remaining: "147" },
		]);
	});

	it("keeps almost there showing when a poll swaps in a card without an estimate", () => {
		const harness = createHarness({ kind: "counting", seconds: 1 });
		harness.tick(1);

		harness.swapIn(undefined);
		harness.tick(3);

		expect(harness.state()).toEqual({ kind: "almost-there", text: "Almost there…", remaining: "0" });
	});

	it("lets a poll that names a new estimate move the count", () => {
		const harness = createHarness({ kind: "counting", seconds: 120 });
		harness.tick(2);

		harness.swapIn({ kind: "counting", seconds: 30 });
		harness.swapIn(undefined);
		harness.tick(1);

		expect(harness.state()).toEqual({ kind: "counting", text: "~29 s left", remaining: "29" });
	});

	it("does not lend one card's count to another card", () => {
		const harness = createHarness({ kind: "counting", seconds: 120 });
		harness.tick(1);

		harness.swapIn(undefined, "a2");

		expect(harness.state("a2")).toEqual({ kind: "hidden", text: "Almost there…", remaining: "0" });
	});
});

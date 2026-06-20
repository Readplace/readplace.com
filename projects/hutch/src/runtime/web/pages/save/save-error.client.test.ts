import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { initSaveErrorCountdown } from "./save-error.client";

function makeDoc(html: string): Document {
	return new JSDOM(`<!doctype html><html><body>${html}</body></html>`).window
		.document;
}

function createFakeTimers() {
	const timers: Array<{ id: number; cb: () => void }> = [];
	let nextId = 1;
	return {
		setIntervalFn(cb: () => void) {
			const id = nextId++;
			timers.push({ id, cb });
			return id;
		},
		clearIntervalFn(id: unknown) {
			const idx = timers.findIndex((t) => t.id === id);
			if (idx !== -1) timers.splice(idx, 1);
		},
		tick(times: number) {
			for (let i = 0; i < times; i++) {
				for (const timer of [...timers]) timer.cb();
			}
		},
		pending() {
			return timers.length;
		},
	};
}

describe("initSaveErrorCountdown", () => {
	it("is a no-op when no .save-error__seconds element is present", () => {
		const doc = makeDoc(`<p>nothing here</p>`);
		const fake = createFakeTimers();
		const controller = initSaveErrorCountdown({
			document: doc,
			setIntervalFn: fake.setIntervalFn,
			clearIntervalFn: fake.clearIntervalFn,
		});
		assert.equal(fake.pending(), 0);
		controller.stop();
	});

	it("is a no-op when the counter element has no data-countdown-seconds attribute", () => {
		const doc = makeDoc(`<span class="save-error__seconds">5</span>`);
		const fake = createFakeTimers();
		const controller = initSaveErrorCountdown({
			document: doc,
			setIntervalFn: fake.setIntervalFn,
			clearIntervalFn: fake.clearIntervalFn,
		});
		assert.equal(fake.pending(), 0);
		controller.stop();
	});

	it("is a no-op when data-countdown-seconds is not a parseable number", () => {
		const doc = makeDoc(
			`<span class="save-error__seconds" data-countdown-seconds="soon">5</span>`,
		);
		const fake = createFakeTimers();
		const controller = initSaveErrorCountdown({
			document: doc,
			setIntervalFn: fake.setIntervalFn,
			clearIntervalFn: fake.clearIntervalFn,
		});
		assert.equal(fake.pending(), 0);
		controller.stop();
	});

	it("decrements the displayed seconds on each tick", () => {
		const doc = makeDoc(
			`<span class="save-error__seconds" data-countdown-seconds="5">5</span>`,
		);
		const fake = createFakeTimers();
		initSaveErrorCountdown({
			document: doc,
			setIntervalFn: fake.setIntervalFn,
			clearIntervalFn: fake.clearIntervalFn,
		});

		fake.tick(1);
		const counter = doc.querySelector(".save-error__seconds");
		assert(counter, "counter must remain in the DOM");
		assert.equal(counter.textContent, "4");

		fake.tick(1);
		assert.equal(counter.textContent, "3");
	});

	it("stops the interval once the countdown reaches zero", () => {
		const doc = makeDoc(
			`<span class="save-error__seconds" data-countdown-seconds="2">2</span>`,
		);
		const fake = createFakeTimers();
		initSaveErrorCountdown({
			document: doc,
			setIntervalFn: fake.setIntervalFn,
			clearIntervalFn: fake.clearIntervalFn,
		});

		fake.tick(2);
		const counter = doc.querySelector(".save-error__seconds");
		assert(counter, "counter must remain in the DOM");
		assert.equal(counter.textContent, "0");
		assert.equal(fake.pending(), 0);
	});

	it("stop() clears the interval so no further ticks fire", () => {
		const doc = makeDoc(
			`<span class="save-error__seconds" data-countdown-seconds="5">5</span>`,
		);
		const fake = createFakeTimers();
		const controller = initSaveErrorCountdown({
			document: doc,
			setIntervalFn: fake.setIntervalFn,
			clearIntervalFn: fake.clearIntervalFn,
		});

		controller.stop();
		assert.equal(fake.pending(), 0);
	});
});

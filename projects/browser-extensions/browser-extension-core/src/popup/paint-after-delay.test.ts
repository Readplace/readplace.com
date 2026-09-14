import assert from "node:assert/strict";
import { initPaintAfterDelay } from "./paint-after-delay";

const INJECTED_DELAY_MS = 275;

function harness() {
	const timers: Array<{ callback: () => void; ms: number }> = [];
	const cleared: number[] = [];
	const paintAfterDelay = initPaintAfterDelay({
		setTimeoutFn: (callback, ms) => {
			timers.push({ callback, ms });
			return timers.length;
		},
		clearTimeoutFn: (id) => cleared.push(id),
		delayMs: INJECTED_DELAY_MS,
	});
	return { timers, cleared, paintAfterDelay };
}

describe("paintAfterDelay", () => {
	it("arms one timer at the injected delay and paints nothing while the load is in flight", async () => {
		const { timers, paintAfterDelay } = harness();
		let painted = 0;
		let release: (value: string) => void = () => {};
		const pending = paintAfterDelay({
			paint: () => {
				painted += 1;
			},
			load: () =>
				new Promise<string>((resolve) => {
					release = resolve;
				}),
		});

		assert.equal(timers.length, 1);
		assert.equal(timers[0]?.ms, INJECTED_DELAY_MS);
		assert.equal(painted, 0);

		release("loaded");
		assert.equal(await pending, "loaded");
	});

	it("paints once when the delay fires before the load resolves", async () => {
		const { timers, paintAfterDelay } = harness();
		let painted = 0;
		let release: (value: string) => void = () => {};
		const pending = paintAfterDelay({
			paint: () => {
				painted += 1;
			},
			load: () =>
				new Promise<string>((resolve) => {
					release = resolve;
				}),
		});

		timers[0]?.callback();
		assert.equal(painted, 1);

		release("loaded");
		assert.equal(await pending, "loaded");
	});

	it("clears the armed timer before handing back the load's value", async () => {
		const { cleared, paintAfterDelay } = harness();
		const value = await paintAfterDelay({
			paint: () => {},
			load: async () => "value",
		});
		assert.equal(value, "value");
		assert.deepEqual(cleared, [1]);
	});

	it("clears the timer and rethrows when the load rejects", async () => {
		const { cleared, paintAfterDelay } = harness();
		await assert.rejects(
			paintAfterDelay({
				paint: () => {},
				load: async () => {
					throw new Error("load failed");
				},
			}),
			/load failed/,
		);
		assert.deepEqual(cleared, [1]);
	});
});

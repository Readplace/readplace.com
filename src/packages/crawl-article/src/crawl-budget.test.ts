import { callerHasGivenUp, createCrawlBudget } from "./crawl-budget";

function settledAbort(signal: AbortSignal, waitMs: number): Promise<Error | undefined> {
	if (signal.aborted) return Promise.resolve(signal.reason);
	return new Promise((resolve) => {
		const timer = setTimeout(() => resolve(undefined), waitMs);
		signal.addEventListener(
			"abort",
			() => {
				clearTimeout(timer);
				resolve(signal.reason);
			},
			{ once: true },
		);
	});
}

describe("createCrawlBudget", () => {
	it("reports the time left shrinking as the clock advances, floored at zero", () => {
		let nowMs = 1000;
		const budget = createCrawlBudget({
			signal: new AbortController().signal,
			totalMs: 30_000,
			now: () => nowMs,
		});

		expect(budget.remainingMs()).toBe(30_000);
		nowMs += 25_000;
		expect(budget.remainingMs()).toBe(5000);
		nowMs += 9000;
		expect(budget.remainingMs()).toBe(0);
	});

	it("ends a leg on its own deadline, naming the milliseconds it was given", async () => {
		const budget = createCrawlBudget({
			signal: new AbortController().signal,
			totalMs: 30_000,
			now: () => Date.now(),
		});

		const lease = budget.leaseLeg(5);
		const reason = await settledAbort(lease.deadline.signal, 200);

		expect(reason?.name).toBe("TimeoutError");
		expect(reason?.message).toBe("leg produced no response within 5ms");
	});

	it("clamps a leg to the time the caller has left rather than what the leg asked for", async () => {
		let nowMs = 1000;
		const budget = createCrawlBudget({
			signal: new AbortController().signal,
			totalMs: 30_000,
			now: () => nowMs,
		});
		nowMs += 29_990;

		const lease = budget.leaseLeg(25_000);
		const reason = await settledAbort(lease.deadline.signal, 200);

		expect(reason?.message).toBe("leg produced no response within 10ms");
	});

	it("ends a live leg when the caller gives up, carrying the caller's reason", async () => {
		const controller = new AbortController();
		const budget = createCrawlBudget({ signal: controller.signal, totalMs: 30_000, now: () => Date.now() });
		const lease = budget.leaseLeg(60_000);

		controller.abort(new Error("caller gave up"));
		const reason = await settledAbort(lease.deadline.signal, 200);

		expect(reason?.message).toBe("caller gave up");
	});

	it("ends a leg leased after the caller has already given up", async () => {
		const controller = new AbortController();
		controller.abort(new Error("caller gave up first"));
		const budget = createCrawlBudget({ signal: controller.signal, totalMs: 30_000, now: () => Date.now() });

		const lease = budget.leaseLeg(60_000);
		const reason = await settledAbort(lease.deadline.signal, 200);

		expect(reason?.message).toBe("caller gave up first");
	});

	it("keeps a released leg alive past its own deadline", async () => {
		const budget = createCrawlBudget({
			signal: new AbortController().signal,
			totalMs: 30_000,
			now: () => Date.now(),
		});

		const lease = budget.leaseLeg(5);
		lease.release();
		const reason = await settledAbort(lease.deadline.signal, 100);

		expect(reason).toBeUndefined();
	});

	it("still ends a released leg when the caller gives up, so a body read can be cancelled", async () => {
		const controller = new AbortController();
		const budget = createCrawlBudget({ signal: controller.signal, totalMs: 30_000, now: () => Date.now() });
		const lease = budget.leaseLeg(60_000);
		lease.release();

		controller.abort(new Error("body budget expired"));
		const reason = await settledAbort(lease.deadline.signal, 200);

		expect(reason?.message).toBe("body budget expired");
	});
});

describe("callerHasGivenUp", () => {
	it("is false while the caller's deadline is live and true once it aborts", () => {
		const controller = new AbortController();
		const budget = createCrawlBudget({ signal: controller.signal, totalMs: 30_000, now: () => Date.now() });

		expect(callerHasGivenUp(budget.deadline)).toBe(false);
		controller.abort(new Error("caller gave up"));
		expect(callerHasGivenUp(budget.deadline)).toBe(true);
	});
});

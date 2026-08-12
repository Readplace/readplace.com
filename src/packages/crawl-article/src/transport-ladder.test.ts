import { createCrawlBudget } from "./crawl-budget";
import { type Leg, type LegAttempt, type LegFetch, runTransportLadder } from "./transport-ladder";

function tarpit(): LegFetch {
	return (_url, init) =>
		new Promise((_resolve, reject) => {
			init.deadline.signal.addEventListener("abort", () => reject(init.deadline.signal.reason), { once: true });
		});
}

function answers(status: number, body = "ok"): LegFetch {
	return async () => new Response(body, { status });
}

function budgetOf(totalMs: number, now: () => number = () => Date.now()) {
	return createCrawlBudget({ signal: new AbortController().signal, totalMs, now });
}

function ladderOf(legs: readonly Leg[], attempts: LegAttempt[]) {
	return runTransportLadder({ legs, logAttempt: (attempt) => attempts.push(attempt), now: () => Date.now() });
}

describe("runTransportLadder", () => {
	it("returns the first leg's answer and never opens a later transport", async () => {
		const h2 = jest.fn<ReturnType<LegFetch>, Parameters<LegFetch>>();
		const curl = jest.fn<ReturnType<LegFetch>, Parameters<LegFetch>>();
		const attempts: LegAttempt[] = [];
		const ladder = ladderOf(
			[
				{ name: "primary", maxRunMs: 50, fetch: answers(200) },
				{ name: "h2", maxRunMs: 20, fetch: h2 },
				{ name: "curl", maxRunMs: 30, fetch: curl },
			],
			attempts,
		);

		const response = await ladder("https://example.com", { headers: {}, budget: budgetOf(500) });

		expect(response.status).toBe(200);
		expect(h2).not.toHaveBeenCalled();
		expect(curl).not.toHaveBeenCalled();
		expect(attempts.map((a) => [a.leg, a.outcome])).toEqual([["primary", "answered"]]);
	});

	it("reaches the last leg when every earlier leg stalls for its whole deadline", async () => {
		const attempts: LegAttempt[] = [];
		const budget = budgetOf(400);
		const ladder = ladderOf(
			[
				{ name: "primary", maxRunMs: 40, fetch: tarpit() },
				{ name: "h2", maxRunMs: 20, fetch: tarpit() },
				{ name: "curl", maxRunMs: 30, fetch: answers(200, "rescued") },
			],
			attempts,
		);

		const startedAt = Date.now();
		const response = await ladder("https://example.com", { headers: {}, budget });

		expect(await response.text()).toBe("rescued");
		expect(attempts.map((a) => [a.leg, a.outcome])).toEqual([
			["primary", "escalated"],
			["h2", "escalated"],
			["curl", "answered"],
		]);
		expect(Date.now() - startedAt).toBeLessThan(400);
	});

	it("gives each leg its declared share of the budget rather than letting the first take it all", async () => {
		const attempts: LegAttempt[] = [];
		const ladder = ladderOf(
			[
				{ name: "primary", maxRunMs: 50, fetch: tarpit() },
				{ name: "h2", maxRunMs: 30, fetch: answers(200) },
				{ name: "curl", maxRunMs: 20, fetch: answers(200) },
			],
			attempts,
		);

		await ladder("https://example.com", { headers: {}, budget: budgetOf(100, () => 1000) });

		expect(attempts[0]?.error).toBe("leg produced no response within 50ms");
	});

	it("still reaches the last leg when the caller's budget is far smaller than the declared legs", async () => {
		const attempts: LegAttempt[] = [];
		const ladder = ladderOf(
			[
				{ name: "primary", maxRunMs: 25_000, fetch: tarpit() },
				{ name: "h2", maxRunMs: 2000, fetch: tarpit() },
				{ name: "curl", maxRunMs: 3000, fetch: answers(200, "rescued") },
			],
			attempts,
		);

		const response = await ladder("https://example.com", { headers: {}, budget: budgetOf(150) });

		expect(await response.text()).toBe("rescued");
		expect(attempts.map((a) => a.leg)).toEqual(["primary", "h2", "curl"]);
	});

	it.each([402, 403])("escalates a block-class %i to the next transport", async (status) => {
		const attempts: LegAttempt[] = [];
		const ladder = ladderOf(
			[
				{ name: "primary", maxRunMs: 50, fetch: answers(status, "challenge") },
				{ name: "h2", maxRunMs: 20, fetch: answers(200, "through") },
			],
			attempts,
		);

		const response = await ladder("https://example.com", { headers: {}, budget: budgetOf(500) });

		expect(await response.text()).toBe("through");
		expect(attempts.map((a) => [a.leg, a.outcome, a.status])).toEqual([
			["primary", "escalated", status],
			["h2", "answered", 200],
		]);
	});

	it("abandons the ladder when the caller gives up mid-leg", async () => {
		const controller = new AbortController();
		const curl = jest.fn<ReturnType<LegFetch>, Parameters<LegFetch>>();
		const attempts: LegAttempt[] = [];
		const budget = createCrawlBudget({ signal: controller.signal, totalMs: 500, now: () => Date.now() });
		const ladder = ladderOf(
			[
				{ name: "primary", maxRunMs: 50, fetch: tarpit() },
				{ name: "curl", maxRunMs: 30, fetch: curl },
			],
			attempts,
		);

		setTimeout(() => controller.abort(new Error("caller gave up")), 5);
		await expect(ladder("https://example.com", { headers: {}, budget })).rejects.toThrow("caller gave up");
		expect(curl).not.toHaveBeenCalled();
		expect(attempts.map((a) => [a.leg, a.outcome])).toEqual([["primary", "abandoned"]]);
	});

	it.each(["ENOTFOUND", "ECONNREFUSED", "EHOSTUNREACH", "ENETUNREACH"])(
		"abandons the ladder on a %s network error instead of retrying the same failure",
		async (code) => {
			const curl = jest.fn<ReturnType<LegFetch>, Parameters<LegFetch>>();
			const attempts: LegAttempt[] = [];
			const ladder = ladderOf(
				[
					{
						name: "primary",
						maxRunMs: 50,
						fetch: async () => {
							throw Object.assign(new Error(`connect ${code}`), { code });
						},
					},
					{ name: "curl", maxRunMs: 30, fetch: curl },
				],
				attempts,
			);

			await expect(ladder("https://example.com", { headers: {}, budget: budgetOf(500) })).rejects.toThrow(code);
			expect(curl).not.toHaveBeenCalled();
			expect(attempts.map((a) => a.outcome)).toEqual(["abandoned"]);
		},
	);

	it("escalates past a non-Error rejection", async () => {
		const attempts: LegAttempt[] = [];
		const ladder = ladderOf(
			[
				{
					name: "primary",
					maxRunMs: 50,
					fetch: async () => {
						throw "string-error";
					},
				},
				{ name: "curl", maxRunMs: 30, fetch: answers(200, "recovered") },
			],
			attempts,
		);

		const response = await ladder("https://example.com", { headers: {}, budget: budgetOf(500) });

		expect(await response.text()).toBe("recovered");
		expect(attempts[0]?.error).toBe("string-error");
	});

	it("hands the last leg's error the earlier leg's failure as its cause", async () => {
		const primaryError = new Error("primary died");
		const curlError = new Error("curl died");
		const attempts: LegAttempt[] = [];
		const ladder = ladderOf(
			[
				{
					name: "primary",
					maxRunMs: 50,
					fetch: async () => {
						throw primaryError;
					},
				},
				{
					name: "curl",
					maxRunMs: 30,
					fetch: async () => {
						throw curlError;
					},
				},
			],
			attempts,
		);

		await expect(ladder("https://example.com", { headers: {}, budget: budgetOf(500) })).rejects.toBe(curlError);
		expect(curlError.cause).toBe(primaryError);
	});

	it("opens no transport at all when the caller has already given up", async () => {
		const controller = new AbortController();
		controller.abort(new Error("caller gave up first"));
		const primary = jest.fn<ReturnType<LegFetch>, Parameters<LegFetch>>();
		const attempts: LegAttempt[] = [];
		const budget = createCrawlBudget({ signal: controller.signal, totalMs: 500, now: () => Date.now() });
		const ladder = ladderOf([{ name: "primary", maxRunMs: 50, fetch: primary }], attempts);

		await expect(ladder("https://example.com", { headers: {}, budget })).rejects.toThrow("caller gave up first");
		expect(primary).not.toHaveBeenCalled();
		expect(attempts).toEqual([]);
	});

	it("returns the last block-class response when every leg is blocked", async () => {
		const attempts: LegAttempt[] = [];
		const ladder = ladderOf(
			[
				{ name: "primary", maxRunMs: 50, fetch: answers(403, "first") },
				{ name: "curl", maxRunMs: 30, fetch: answers(429, "last") },
			],
			attempts,
		);

		const response = await ladder("https://example.com", { headers: {}, budget: budgetOf(500) });

		expect(response.status).toBe(429);
		expect(attempts.map((a) => a.outcome)).toEqual(["escalated", "escalated"]);
	});

	it("returns an earlier leg's block-class response when every later leg only times out", async () => {
		const attempts: LegAttempt[] = [];
		const ladder = ladderOf(
			[
				{ name: "primary", maxRunMs: 50, fetch: answers(403, "challenge") },
				{ name: "h2", maxRunMs: 20, fetch: tarpit() },
				{ name: "curl", maxRunMs: 20, fetch: tarpit() },
			],
			attempts,
		);

		const response = await ladder("https://example.com", { headers: {}, budget: budgetOf(500) });

		expect(response.status).toBe(403);
		expect(attempts.map((a) => [a.leg, a.status])).toEqual([
			["primary", 403],
			["h2", undefined],
			["curl", undefined],
		]);
	});

	it("returns a later leg's block-class response when an earlier leg times out", async () => {
		const attempts: LegAttempt[] = [];
		const ladder = ladderOf(
			[
				{ name: "primary", maxRunMs: 20, fetch: tarpit() },
				{ name: "curl", maxRunMs: 50, fetch: answers(429, "slow down") },
			],
			attempts,
		);

		const response = await ladder("https://example.com", { headers: {}, budget: budgetOf(500) });

		expect(response.status).toBe(429);
		expect(attempts.map((a) => [a.leg, a.status])).toEqual([
			["primary", undefined],
			["curl", 429],
		]);
	});
});

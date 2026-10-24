import { createCrawlBudget } from "./crawl-budget";
import { type Leg, type LegAttempt, type LegFetch, runTransportLadder } from "./transport-ladder";
import { TransportLadderFailure } from "./transport-ladder-failure";

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

	it.each([402, 403, 419])("escalates a block-class %i to the next transport", async (status) => {
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

	it.each([
		{ status: 202, action: "challenge" },
		{ status: 200, action: "challenge" },
		{ status: 202, action: "captcha" },
		{ status: 200, action: "captcha" },
	])("escalates an AWS WAF $action served as HTTP $status", async ({ status, action }) => {
		const challenged = new Response("verification required", {
			status,
			headers: { "x-amzn-waf-action": action },
		});
		const drainedBeforeRecovery: boolean[] = [];
		const attempts: LegAttempt[] = [];
		const ladder = ladderOf(
			[
				{ name: "primary", maxRunMs: 50, fetch: async () => challenged },
				{
					name: "h2",
					maxRunMs: 20,
					fetch: async () => {
						drainedBeforeRecovery.push(challenged.bodyUsed);
						return new Response("article", { status: 200 });
					},
				},
			],
			attempts,
		);

		const response = await ladder("https://example.com", { headers: {}, budget: budgetOf(500) });

		expect(await response.text()).toBe("article");
		expect(drainedBeforeRecovery).toEqual([true]);
		expect(attempts.map((attempt) => [attempt.leg, attempt.outcome, attempt.status])).toEqual([
			["primary", "escalated", status],
			["h2", "answered", 200],
		]);
	});

	it("returns an exhausted AWS WAF response with its final URL, headers and body", async () => {
		const challenge = new Response("verification required", {
			status: 202,
			headers: { "x-amzn-waf-action": "challenge" },
		});
		Object.defineProperty(challenge, "url", { value: "https://publisher.example/article" });
		const attempts: LegAttempt[] = [];
		const ladder = ladderOf([{ name: "primary", maxRunMs: 50, fetch: async () => challenge }], attempts);

		const response = await ladder("https://wrapper.example/link", { headers: {}, budget: budgetOf(500) });

		expect(response.status).toBe(202);
		expect(response.url).toBe("https://publisher.example/article");
		expect(response.headers.get("x-amzn-waf-action")).toBe("challenge");
		expect(await response.text()).toBe("verification required");
		expect(attempts.map((attempt) => attempt.outcome)).toEqual(["escalated"]);
	});

	it("returns an ordinary HTTP 202 without opening another transport", async () => {
		const attempts: LegAttempt[] = [];
		const ladder = ladderOf(
			[
				{ name: "primary", maxRunMs: 50, fetch: answers(202, "accepted article") },
				{ name: "h2", maxRunMs: 20, fetch: answers(200, "other article") },
			],
			attempts,
		);

		const response = await ladder("https://example.com", { headers: {}, budget: budgetOf(500) });

		expect(response.status).toBe(202);
		expect(await response.text()).toBe("accepted article");
		expect(attempts.map((attempt) => [attempt.leg, attempt.outcome])).toEqual([["primary", "answered"]]);
	});

	it("answers a 401 from the first leg and never opens a later transport", async () => {
		const h2 = jest.fn<ReturnType<LegFetch>, Parameters<LegFetch>>();
		const curl = jest.fn<ReturnType<LegFetch>, Parameters<LegFetch>>();
		const attempts: LegAttempt[] = [];
		const ladder = ladderOf(
			[
				{ name: "primary", maxRunMs: 50, fetch: answers(401, "sign in") },
				{ name: "h2", maxRunMs: 20, fetch: h2 },
				{ name: "curl", maxRunMs: 30, fetch: curl },
			],
			attempts,
		);

		const response = await ladder("https://example.com", { headers: {}, budget: budgetOf(500) });

		expect(response.status).toBe(401);
		expect(h2).not.toHaveBeenCalled();
		expect(curl).not.toHaveBeenCalled();
		expect(attempts.map((a) => [a.leg, a.outcome, a.status])).toEqual([["primary", "answered", 401]]);
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

	it("keeps original errors separate from previous transport attempts", async () => {
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

		await expect(ladder("https://example.com", { headers: {}, budget: budgetOf(500) })).rejects.toMatchObject({
			cause: curlError, previousErrors: [primaryError], retryDisposition: "unclassified",
		});
		expect(curlError.cause).toBeUndefined();
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

	it("returns the blocked answer with its body, status, headers and url still readable", async () => {
		const captcha = new Response("<title>CAPTCHA</title>", { status: 429, headers: { "content-type": "text/html" } });
		Object.defineProperty(captcha, "url", { value: "https://archive.li/abc" });
		const ladder = ladderOf([{ name: "primary", maxRunMs: 50, fetch: async () => captcha }], []);

		const response = await ladder("https://archive.ph/abc", { headers: {}, budget: budgetOf(500) });

		expect(response.status).toBe(429);
		expect(response.headers.get("content-type")).toBe("text/html");
		expect(response.url).toBe("https://archive.li/abc");
		expect(await response.text()).toBe("<title>CAPTCHA</title>");
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

	it("quotes the unlocker's error codes on the attempt it logged, so a discarded gateway answer stays attributable", async () => {
		const attempts: LegAttempt[] = [];
		const refused: LegFetch = async () =>
			new Response("Navigation failed", {
				status: 502,
				headers: { "x-brd-err-code": "policy_20050", "x-brd-error-code": "net_err_tunnel" },
			});
		const ladder = ladderOf([{ name: "primary", maxRunMs: 50, fetch: refused }], attempts);

		const response = await ladder("https://example.com", { headers: {}, budget: budgetOf(500) });

		expect(response.status).toBe(502);
		expect(attempts.map((a) => [a.outcome, a.status, a.unlockerError])).toEqual([
			["answered", 502, { "x-brd-err-code": "policy_20050", "x-brd-error-code": "net_err_tunnel" }],
		]);
	});
});

it("continues beyond a connection refusal after receiving a 429", async () => {
	const attempts: LegAttempt[] = [];
	const ladder = ladderOf([
		{ name: "primary", maxRunMs: 50, fetch: answers(429, "slow down") },
		{ name: "h2", maxRunMs: 20, fetch: async () => { throw Object.assign(new Error("connection refused"), { code: "ECONNREFUSED" }); } },
		{ name: "curl", maxRunMs: 30, fetch: answers(200, "recovered article") },
	], attempts);
	expect(await (await ladder("https://example.com", { headers: {}, budget: budgetOf(500) })).text()).toBe("recovered article");
	expect(attempts.map(({ leg, outcome }) => [leg, outcome])).toEqual([["primary", "escalated"], ["h2", "escalated"], ["curl", "answered"]]);
});

it.each([
	Object.assign(new Error("connection refused"), { code: "ECONNREFUSED" }),
	Object.assign(new Error("connection timed out"), { code: "UND_ERR_CONNECT_TIMEOUT" }),
	Object.assign(new Error("leg timed out"), { name: "TimeoutError" }),
	new Error("HTTP/2 RST_STREAM INTERNAL_ERROR"),
])("classifies a transport's own operational failure as recoverable: %s", async (error) => {
	const ladder = ladderOf([{ name: "primary", maxRunMs: 50, fetch: async () => { throw error; } }], []);
	await expect(ladder("https://example.com", { headers: {}, budget: budgetOf(500) })).rejects.toMatchObject({
		cause: error, previousErrors: [], retryDisposition: "recoverable",
	});
});

it.each([true, false])("keeps mixed unknown/network failures unclassified (unknown first: %s)", async (unknownFirst) => {
	const unknown = new Error("programming failure");
	const network = new TypeError("fetch failed", { cause: Object.assign(new Error("connection refused"), { code: "ECONNREFUSED" }) });
	const errors = unknownFirst ? [unknown, network] : [network, unknown];
	const ladder = ladderOf(errors.map((error) => ({ name: "primary", maxRunMs: 50, fetch: async () => { throw error; } })), []);
	await expect(ladder("https://example.com", { headers: {}, budget: budgetOf(500) })).rejects.toMatchObject({
		retryDisposition: "unclassified", cause: errors[1], previousErrors: [errors[0]],
	});
	expect(unknown.cause).toBeUndefined();
});

it("does not preserve a 429 when an earlier unknown failure precedes a terminal network failure", async () => {
	const ladder = ladderOf([
		{ name: "primary", maxRunMs: 50, fetch: async () => { throw new Error("programming failure"); } },
		{ name: "h2", maxRunMs: 20, fetch: answers(429) },
		{ name: "curl", maxRunMs: 30, fetch: async () => { throw Object.assign(new Error("refused"), { code: "ECONNREFUSED" }); } },
	], []);
	await expect(ladder("https://example.com", { headers: {}, budget: budgetOf(500) })).rejects.toMatchObject({ retryDisposition: "unclassified" });
});

it("does not hide an unknown failure behind a later block response after receiving a 429", async () => {
	const ladder = ladderOf([
		{ name: "primary", maxRunMs: 50, fetch: answers(429) },
		{ name: "h2", maxRunMs: 20, fetch: answers(403) },
		{ name: "curl", maxRunMs: 30, fetch: async () => { throw new Error("programming failure"); } },
	], []);
	await expect(ladder("https://example.com", { headers: {}, budget: budgetOf(500) })).rejects.toMatchObject({ retryDisposition: "unclassified" });
});

it("marks a non-Error exhausted rejection unclassified", async () => {
	const ladder = ladderOf([{ name: "primary", maxRunMs: 50, fetch: async () => { throw "broken transport"; } }], []);
	await expect(ladder("https://example.com", { headers: {}, budget: budgetOf(500) })).rejects.toMatchObject({
		message: "broken transport", cause: "broken transport", retryDisposition: "unclassified",
	});
});

it("propagates an explicit abort even when it carries a block signature", async () => {
	const aborted = Object.assign(new Error("RST_STREAM cancelled"), { name: "AbortError" });
	const ladder = ladderOf([{ name: "primary", maxRunMs: 50, fetch: async () => { throw aborted; } }], []);
	await expect(ladder("https://example.com", { headers: {}, budget: budgetOf(500) })).rejects.toBe(aborted);
});

it("exposes a typed failure without modifying a reused error's cause", async () => {
	const root = Object.assign(new Error("refused"), { code: "ECONNREFUSED" });
	const reused = new Error("wrapped refusal", { cause: root });
	const ladder = ladderOf([
		{ name: "primary", maxRunMs: 50, fetch: async () => { throw reused; } },
		{ name: "curl", maxRunMs: 20, fetch: async () => { throw reused; } },
	], []);
	for (let i = 0; i < 2; i++) {
		await expect(ladder("https://example.com", { headers: {}, budget: budgetOf(500) })).rejects.toBeInstanceOf(TransportLadderFailure);
	}
	expect(reused.cause).toBe(root);
});

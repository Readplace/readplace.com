import { createCrawlBudget } from "./crawl-budget";
import { withRateLimitRetry } from "./rate-limit-retry";
import { TransportLadderFailure } from "./transport-ladder-failure";

function budgetFrom(signal: AbortSignal) {
	return createCrawlBudget({ signal, totalMs: 30_000, now: () => Date.now() });
}

function request(signal: AbortSignal = new AbortController().signal) {
	return { headers: {}, budget: budgetFrom(signal) };
}

describe("withRateLimitRetry", () => {
	it("returns a non-429 response without retrying", async () => {
		const innerFetch = jest.fn().mockResolvedValue(new Response("ok", { status: 200 }));
		const fetchWithRetry = withRateLimitRetry(innerFetch, { delaysMs: [1] });

		const response = await fetchWithRetry("https://example.com", request());

		expect(response.status).toBe(200);
		expect(innerFetch).toHaveBeenCalledTimes(1);
	});

	it("retries a rate-limited fetch and returns the recovered response", async () => {
		const innerFetch = jest
			.fn()
			.mockResolvedValueOnce(new Response("slow down", { status: 429 }))
			.mockResolvedValueOnce(new Response("ok", { status: 200 }));
		const fetchWithRetry = withRateLimitRetry(innerFetch, { delaysMs: [1] });

		const response = await fetchWithRetry("https://example.com", request());

		expect(response.status).toBe(200);
		expect(await response.text()).toBe("ok");
		expect(innerFetch).toHaveBeenCalledTimes(2);
	});

	it("returns the last 429 with a readable body when every attempt is rate-limited", async () => {
		const innerFetch = jest
			.fn()
			.mockResolvedValueOnce(new Response("first", { status: 429 }))
			.mockResolvedValueOnce(new Response("second", { status: 429 }))
			.mockResolvedValueOnce(new Response("third", { status: 429 }));
		const fetchWithRetry = withRateLimitRetry(innerFetch, { delaysMs: [1, 1] });

		const response = await fetchWithRetry("https://example.com", request());

		expect(response.status).toBe(429);
		expect(await response.text()).toBe("third");
		expect(innerFetch).toHaveBeenCalledTimes(3);
	});

	it("does not retry when the caller has already given up", async () => {
		const controller = new AbortController();
		const innerFetch = jest.fn().mockImplementation(async () => {
			controller.abort(new Error("caller gave up"));
			return new Response("slow down", { status: 429 });
		});
		const fetchWithRetry = withRateLimitRetry(innerFetch, { delaysMs: [1] });

		await expect(fetchWithRetry("https://example.com", request(controller.signal))).rejects.toThrow("caller gave up");
		expect(innerFetch).toHaveBeenCalledTimes(1);
	});

	it("wakes from the retry delay as soon as the caller gives up", async () => {
		const controller = new AbortController();
		const innerFetch = jest.fn().mockResolvedValue(new Response("slow down", { status: 429 }));
		const fetchWithRetry = withRateLimitRetry(innerFetch, { delaysMs: [60_000] });

		setTimeout(() => controller.abort(new Error("caller gave up")), 5);
		await expect(fetchWithRetry("https://example.com", request(controller.signal))).rejects.toThrow("caller gave up");
		expect(innerFetch).toHaveBeenCalledTimes(1);
	});
});

it.each(["recoverable", "unclassified"] as const)("handles a %s retry failure after the latest 429", async (retryDisposition) => {
	const error = new TransportLadderFailure({ error: new Error("connection failed"), previousErrors: [], retryDisposition });
	const innerFetch = jest.fn()
		.mockResolvedValueOnce(new Response("old 429", { status: 429 }))
		.mockResolvedValueOnce(new Response("latest 429", { status: 429, headers: { "retry-after": "60" } }))
		.mockRejectedValueOnce(error);
	const retry = withRateLimitRetry(innerFetch, { delaysMs: [0, 0] });
	const promise = retry("https://example.com", request());
	if (retryDisposition === "recoverable") {
		const response = await promise;
		expect(response.status).toBe(429);
		expect(response.headers.get("retry-after")).toBe("60");
		expect(await response.text()).toBe("latest 429");
	} else {
		await expect(promise).rejects.toBe(error);
	}
});

it("propagates an unclassified raw rejection after a 429", async () => {
	const error = new Error("programming failure");
	const innerFetch = jest.fn().mockResolvedValueOnce(new Response("slow down", { status: 429 })).mockRejectedValueOnce(error);
	await expect(withRateLimitRetry(innerFetch, { delaysMs: [0] })("https://example.com", request())).rejects.toBe(error);
});

import { withRateLimitRetry } from "./rate-limit-retry";

describe("withRateLimitRetry", () => {
	it("returns a non-429 response without retrying", async () => {
		const innerFetch = jest.fn().mockResolvedValue(new Response("ok", { status: 200 }));
		const fetchWithRetry = withRateLimitRetry(innerFetch, { delaysMs: [1] });

		const response = await fetchWithRetry("https://example.com");

		expect(response.status).toBe(200);
		expect(innerFetch).toHaveBeenCalledTimes(1);
	});

	it("retries a rate-limited fetch and returns the recovered response", async () => {
		const innerFetch = jest
			.fn()
			.mockResolvedValueOnce(new Response("slow down", { status: 429 }))
			.mockResolvedValueOnce(new Response("ok", { status: 200 }));
		const fetchWithRetry = withRateLimitRetry(innerFetch, { delaysMs: [1] });

		const response = await fetchWithRetry("https://example.com");

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

		const response = await fetchWithRetry("https://example.com");

		expect(response.status).toBe(429);
		expect(await response.text()).toBe("third");
		expect(innerFetch).toHaveBeenCalledTimes(3);
	});

	it("retries while an unaborted signal is present", async () => {
		const controller = new AbortController();
		const innerFetch = jest
			.fn()
			.mockResolvedValueOnce(new Response("slow down", { status: 429 }))
			.mockResolvedValueOnce(new Response("ok", { status: 200 }));
		const fetchWithRetry = withRateLimitRetry(innerFetch, { delaysMs: [1] });

		const response = await fetchWithRetry("https://example.com", { signal: controller.signal });

		expect(response.status).toBe(200);
		expect(innerFetch).toHaveBeenCalledTimes(2);
	});

	it("does not retry when the caller's signal is already aborted", async () => {
		const controller = new AbortController();
		const innerFetch = jest.fn().mockImplementation(async () => {
			controller.abort(new Error("caller gave up"));
			return new Response("slow down", { status: 429 });
		});
		const fetchWithRetry = withRateLimitRetry(innerFetch, { delaysMs: [1] });

		const response = await fetchWithRetry("https://example.com", { signal: controller.signal });

		expect(response.status).toBe(429);
		expect(await response.text()).toBe("slow down");
		expect(innerFetch).toHaveBeenCalledTimes(1);
	});

	it("wakes from the retry delay as soon as the caller's signal aborts", async () => {
		const controller = new AbortController();
		const innerFetch = jest.fn().mockResolvedValue(new Response("slow down", { status: 429 }));
		const fetchWithRetry = withRateLimitRetry(innerFetch, { delaysMs: [60_000] });

		setTimeout(() => controller.abort(new Error("caller gave up")), 5);
		const response = await fetchWithRetry("https://example.com", { signal: controller.signal });

		expect(response.status).toBe(429);
		expect(innerFetch).toHaveBeenCalledTimes(1);
	});
});

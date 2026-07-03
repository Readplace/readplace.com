export const RATE_LIMIT_RETRY_DELAYS_MS: readonly number[] = [10_000];

function sleepUnlessAborted(ms: number, signal: AbortSignal | undefined): Promise<void> {
	return new Promise((resolve) => {
		if (signal?.aborted) {
			resolve();
			return;
		}
		const onAbort = () => {
			clearTimeout(timer);
			resolve();
		};
		const timer = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}

export function withRateLimitRetry(
	innerFetch: typeof fetch,
	options: { delaysMs: readonly number[] },
): typeof fetch {
	return async (input, init) => {
		let response = await innerFetch(input, init);
		for (const delayMs of options.delaysMs) {
			if (response.status !== 429) return response;
			await sleepUnlessAborted(delayMs, init?.signal ?? undefined);
			if (init?.signal?.aborted) return response;
			await response.text();
			response = await innerFetch(input, init);
		}
		return response;
	};
}

import { callerHasGivenUp } from "./crawl-budget";
import type { LadderFetch } from "./transport-ladder";

export const RATE_LIMIT_RETRY_DELAYS_MS: readonly number[] = [10_000];

function sleepUnlessAborted(ms: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve) => {
		if (signal.aborted) {
			resolve();
			return;
		}
		const onAbort = () => {
			clearTimeout(timer);
			resolve();
		};
		const timer = setTimeout(() => {
			signal.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		signal.addEventListener("abort", onAbort, { once: true });
	});
}

export function withRateLimitRetry(
	innerFetch: LadderFetch,
	options: { delaysMs: readonly number[] },
): LadderFetch {
	return async (url, init) => {
		let response = await innerFetch(url, init);
		for (const delayMs of options.delaysMs) {
			if (response.status !== 429) return response;
			await sleepUnlessAborted(delayMs, init.budget.deadline.signal);
			if (callerHasGivenUp(init.budget.deadline)) return response;
			response = await innerFetch(url, init);
		}
		return response;
	};
}

import type { LadderFetch } from "./transport-ladder";
import { TransportLadderFailure } from "./transport-ladder-failure";

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
			init.budget.deadline.signal.throwIfAborted();
			try {
				response = await innerFetch(url, init);
			} catch (error) {
				init.budget.deadline.signal.throwIfAborted();
				if (!(error instanceof TransportLadderFailure) || error.retryDisposition !== "recoverable") throw error;
				return response;
			}
		}
		return response;
	};
}

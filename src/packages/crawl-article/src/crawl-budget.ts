export type CallerDeadline = { readonly scope: "caller"; readonly signal: AbortSignal };

export type LegDeadline = { readonly scope: "leg"; readonly signal: AbortSignal };

type LegLease = { readonly deadline: LegDeadline; readonly release: () => void };

export type CrawlBudget = {
	readonly deadline: CallerDeadline;
	readonly remainingMs: () => number;
	readonly leaseLeg: (maxMs: number) => LegLease;
};

export function deadlineReason(message: string): Error {
	const reason = new Error(message);
	reason.name = "TimeoutError";
	return reason;
}

export function callerHasGivenUp(deadline: CallerDeadline): boolean {
	return deadline.signal.aborted;
}

export function createCrawlBudget(params: {
	signal: AbortSignal;
	totalMs: number;
	now: () => number;
}): CrawlBudget {
	const { signal, totalMs, now } = params;
	const startedAt = now();
	const deadline: CallerDeadline = { scope: "caller", signal };
	const remainingMs = () => Math.max(0, totalMs - (now() - startedAt));
	return {
		deadline,
		remainingMs,
		leaseLeg: (maxMs) => {
			const controller = new AbortController();
			const legMs = Math.min(maxMs, remainingMs());
			const timer = setTimeout(() => {
				controller.abort(deadlineReason(`leg produced no response within ${legMs}ms`));
			}, legMs);
			const forwardCallerAbort = () => {
				clearTimeout(timer);
				controller.abort(signal.reason);
			};
			if (signal.aborted) forwardCallerAbort();
			else signal.addEventListener("abort", forwardCallerAbort, { once: true });
			return {
				deadline: { scope: "leg", signal: controller.signal },
				release: () => clearTimeout(timer),
			};
		},
	};
}

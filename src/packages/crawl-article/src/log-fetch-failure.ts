/**
 * Origin responses that no retry, persona change, or code fix can turn into a
 * successful crawl (blocked, removed, content-negotiation refused, rate
 * limited). These log at info so the error dashboard only surfaces failures
 * that are actionable; everything else stays at error.
 */
const NON_RECOVERABLE_FETCH_STATUSES: ReadonlySet<number> = new Set([403, 404, 406, 429, 498]);

export type LogFetchFailure = (params: { status: number; message: string }) => void;

export function initLogFetchFailure(deps: {
	logError: (message: string, error?: Error) => void;
	logInfo: (message: string) => void;
}): LogFetchFailure {
	const { logError, logInfo } = deps;
	return ({ status, message }) => {
		if (NON_RECOVERABLE_FETCH_STATUSES.has(status)) {
			logInfo(message);
		} else {
			logError(message);
		}
	};
}

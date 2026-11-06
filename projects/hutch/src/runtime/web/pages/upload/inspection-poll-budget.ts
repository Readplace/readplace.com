export const INSPECTION_POLL_INTERVAL_SECONDS = 3;
const MAX_RECEIVE_COUNT = 2;
const VISIBILITY_TIMEOUT_FACTOR = 2;
const DLQ_ROUTER_TIMEOUT_SECONDS = 30;

export function inspectionPollBudget(params: { lambdaTimeoutSeconds: number; marginSeconds: number }): number {
	const exhaustedSeconds =
		MAX_RECEIVE_COUNT * VISIBILITY_TIMEOUT_FACTOR * params.lambdaTimeoutSeconds +
		DLQ_ROUTER_TIMEOUT_SECONDS +
		params.marginSeconds;
	return Math.ceil(exhaustedSeconds / INSPECTION_POLL_INTERVAL_SECONDS);
}

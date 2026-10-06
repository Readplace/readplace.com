export function initPrepareStarterSnapshot(deps: {
	startObservation: (input: {
		now: Date;
		deploymentSha: string;
		excludedUserIds: string[];
	}) => Promise<unknown>;
	prepareSnapshot: () => Promise<void>;
	deploymentSha: string;
	excludedUserIds: string[];
	now: () => Date;
}): () => Promise<void> {
	return async () => {
		await deps.startObservation({
			now: deps.now(),
			deploymentSha: deps.deploymentSha,
			excludedUserIds: deps.excludedUserIds,
		});
		await deps.prepareSnapshot();
	};
}

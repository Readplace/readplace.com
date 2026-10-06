import type { UserId } from "@packages/domain/user";
import type { RecordEngagementActivity } from "@packages/provider-contracts/engagement-starter";

export function initRecordImportRequest<T extends { userId: UserId | undefined }, R>(deps: {
	request: (input: T) => Promise<R>;
	recordEngagementActivity: RecordEngagementActivity;
	now: () => Date;
}): (input: T) => Promise<R> {
	return async (input) => {
		const result = await deps.request(input);
		if (input.userId !== undefined) {
			await deps.recordEngagementActivity({
				userId: input.userId,
				kind: "import-request",
				at: deps.now(),
			});
		}
		return result;
	};
}

import { READLIST_MAX_PER_USER } from "@packages/domain/readlist";
import type { CreateReadlistDefinition } from "@packages/provider-contracts/article-store";
import { READLIST_CAP_APPROACHED_EVENT, type ReadlistCapApproachedLine } from "./events";

export function initReportReadlistCap(deps: {
	createReadlistDefinition: CreateReadlistDefinition;
	metricLog: (line: ReadlistCapApproachedLine) => void;
}): CreateReadlistDefinition {
	return async (params) => {
		const result = await deps.createReadlistDefinition(params);
		if (result.created && result.ownedCount === READLIST_MAX_PER_USER - 1) {
			deps.metricLog({
				event: READLIST_CAP_APPROACHED_EVENT,
				count: result.ownedCount,
				limit: READLIST_MAX_PER_USER,
				userId: params.userId,
			});
		}
		return result;
	};
}

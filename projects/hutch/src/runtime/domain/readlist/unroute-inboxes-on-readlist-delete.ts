import type { InboxAddressStore } from "@packages/domain/inbox";
import type { DeleteReadlistDefinition } from "@packages/provider-contracts/article-store";

export function initUnrouteInboxesOnReadlistDelete(deps: {
	deleteReadlistDefinition: DeleteReadlistDefinition;
	clearReadlistFromAddresses: InboxAddressStore["clearReadlistFromAddresses"];
}): DeleteReadlistDefinition {
	return async (params) => {
		await deps.clearReadlistFromAddresses({ userId: params.userId, readlist: params.slug });
		return deps.deleteReadlistDefinition(params);
	};
}

import type { ReadlistContext } from "./readlist-context";
import type { ReadlistRailViewModel } from "./readlist.component";
import { readlistErrorFlashMapping } from "./readlist.error";
import { READLIST_CREATE_PATH, readlistReturnQuery } from "./readlist.url";

export function buildReadlistRail(input: {
	query: Record<string, unknown>;
	context: ReadlistContext;
	accessIsReadOnly: boolean;
}): ReadlistRailViewModel {
	return {
		readlists: input.context.readlists,
		activeReadlist: input.context.activeReadlist,
		newReadlistAction: `${READLIST_CREATE_PATH}${readlistReturnQuery(input.context.state)}`,
		canCreate: !input.accessIsReadOnly,
		errorFlash: readlistErrorFlashMapping(input.query),
	};
}

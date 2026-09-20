import type { ReadlistContext } from "./readlist-context";
import type { Readlist } from "./readlist.nav";
import { readlistErrorFlashMapping } from "./readlist.error";
import { READLIST_CREATE_PATH, readlistReturnQuery } from "./readlist.url";

export interface ReadlistRailViewModel {
	readlists: readonly Readlist[];
	activeReadlist: Readlist;
	newReadlistAction: string;
	canCreate: boolean;
	errorFlash?: string;
}

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

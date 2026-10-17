import { DEFAULT_READLIST_SLUG, READLIST_MAX_PER_USER, type ReadlistSlug } from "@packages/domain/readlist";
import type { ReadlistContext } from "./readlist-context";
import type { Readlist } from "./readlist.nav";
import { READLIST_ERROR_LIMIT } from "./readlist.error";
import { READLIST_CREATE_PATH, buildReadlistUrl, readlistReturnQuery } from "./readlist.url";

export interface ReadlistRailViewModel {
	readlists: readonly Readlist[];
	activeReadlist: Readlist;
	newReadlistAction: string;
	limitAlertHref: string;
	canEdit: boolean;
	canCreate: boolean;
	nonEmptyReadlists: readonly ReadlistSlug[];
}

export function buildReadlistRail(input: {
	context: ReadlistContext;
	accessIsReadOnly: boolean;
	nonEmptyReadlists: readonly ReadlistSlug[];
}): ReadlistRailViewModel {
	const canEdit = !input.accessIsReadOnly;
	const custom = input.context.readlists.filter((readlist) => readlist.slug !== DEFAULT_READLIST_SLUG);
	return {
		readlists: input.context.readlists,
		activeReadlist: input.context.activeReadlist,
		newReadlistAction: `${READLIST_CREATE_PATH}${readlistReturnQuery(input.context.state)}`,
		limitAlertHref: buildReadlistUrl(input.context.state, [["queue_error", READLIST_ERROR_LIMIT]]),
		canEdit,
		canCreate: canEdit && custom.length < READLIST_MAX_PER_USER,
		nonEmptyReadlists: input.nonEmptyReadlists,
	};
}

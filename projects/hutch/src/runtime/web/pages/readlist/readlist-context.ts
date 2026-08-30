import { DEFAULT_READLIST_SLUG } from "@packages/domain/readlist";
import type { UserId } from "@packages/domain/user";
import type {
	ListReadlistDefinitions,
	ReadlistDefinitionData,
} from "@packages/provider-contracts/article-store";
import { DEFAULT_READLIST, type Readlist } from "./readlist.nav";
import { type ReadlistUrlState, parseReadlistUrl } from "./readlist.url";

export interface ReadlistContext {
	state: ReadlistUrlState;
	activeReadlist: Readlist;
	readlists: readonly Readlist[];
}

const MAINLINE_READLISTS: readonly Readlist[] = [DEFAULT_READLIST];

export function readerReadlists(definitions: readonly ReadlistDefinitionData[]): readonly Readlist[] {
	return [DEFAULT_READLIST, ...definitions.map(({ slug, label }) => ({ slug, label }))];
}

export function mainlineReadlistContext(query: Record<string, unknown>): ReadlistContext {
	return {
		state: { ...parseReadlistUrl(query), readlist: DEFAULT_READLIST_SLUG },
		activeReadlist: DEFAULT_READLIST,
		readlists: MAINLINE_READLISTS,
	};
}

export function initResolveReadlistContext(deps: {
	listReadlistDefinitions: ListReadlistDefinitions;
}): (req: { query: Record<string, unknown> }, userId: UserId) => Promise<ReadlistContext> {
	return async (req, userId) => {
		const readlists = readerReadlists(await deps.listReadlistDefinitions(userId));
		const requested = parseReadlistUrl(req.query);
		const activeReadlist = readlists.find((readlist) => readlist.slug === requested.readlist) ?? DEFAULT_READLIST;
		return {
			state: { ...requested, readlist: activeReadlist.slug },
			activeReadlist,
			readlists,
		};
	};
}

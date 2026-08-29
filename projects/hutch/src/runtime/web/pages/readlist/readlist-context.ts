import { DEFAULT_READLIST_SLUG } from "@packages/domain/readlist";
import type { UserId } from "@packages/domain/user";
import type {
	ListReadlistDefinitions,
	ReadlistDefinitionData,
} from "@packages/provider-contracts/article-store";
import type { FeatureToggleSource, QuerystringFeatureToggle } from "@packages/web-shell";
import { DEFAULT_READLIST, type Readlist } from "./readlist.nav";
import { type LinkParams, type ReadlistUrlState, parseReadlistUrl } from "./readlist.url";

export const READLISTS_FEATURE = "queues";

const READLISTS_LINK_PARAMS: LinkParams = [["feature", READLISTS_FEATURE]];

export interface ReadlistContext {
	state: ReadlistUrlState;
	activeReadlist: Readlist;
	readlists: readonly Readlist[];
	linkParams: LinkParams;
	railed: boolean;
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
		linkParams: [],
		railed: false,
	};
}

export function initResolveReadlistContext(deps: {
	listReadlistDefinitions: ListReadlistDefinitions;
	featureToggle: QuerystringFeatureToggle;
}): (
	req: FeatureToggleSource & { query: Record<string, unknown> },
	userId: UserId,
) => Promise<ReadlistContext> {
	return async (req, userId) => {
		const flagged = deps.featureToggle.isEnabled(req, READLISTS_FEATURE);
		const definitions = await deps.listReadlistDefinitions(userId);
		if (!flagged && definitions.length === 0) {
			return mainlineReadlistContext(req.query);
		}
		const readlists = readerReadlists(definitions);
		const requested = parseReadlistUrl(req.query);
		const activeReadlist = readlists.find((readlist) => readlist.slug === requested.readlist) ?? DEFAULT_READLIST;
		return {
			state: { ...requested, readlist: activeReadlist.slug },
			activeReadlist,
			readlists,
			linkParams: flagged ? READLISTS_LINK_PARAMS : [],
			railed: true,
		};
	};
}

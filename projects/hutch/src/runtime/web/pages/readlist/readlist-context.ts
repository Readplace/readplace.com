import { HAND_PICKED, HAND_PICKED_SCOPE, isBuiltInReadlist } from "./built-in-readlists";
import {
	DEFAULT_READLIST_SLUG,
	pinnedReadlistSlugs,
	readerReadlists,
	type ReadlistSlug,
} from "@packages/domain/readlist";
import type { ReadlistFilter } from "@packages/domain/article";
import type { UserId } from "@packages/domain/user";
import type { ListReadlistDefinitions } from "@packages/provider-contracts/article-store";
import type { FindSessionReadlistFilter } from "@packages/provider-contracts/auth";
import { SESSION_COOKIE_NAME, readCookie } from "@packages/web-session";
import type { HomeReadlistPreference } from "@packages/provider-contracts/auth";
import { homeEntryReadlistOf, homeReadlistOf, homeReadlistTargets } from "./readlist-home";
import { DEFAULT_READLIST, type Readlist } from "./readlist.nav";
import { type ReadlistUrlState, parseReadlistUrl } from "./readlist.url";

export { readerReadlists };

export interface ReadlistContext {
	definitions: Awaited<ReturnType<ListReadlistDefinitions>>;
	state: ReadlistUrlState;
	activeReadlist: Readlist;
	readlists: readonly Readlist[];
	activePurpose: string | undefined;
	pinnedReadlists: readonly ReadlistSlug[];
	home?: { slug: ReadlistSlug; entry: ReadlistSlug; targets: ReadonlyMap<ReadlistSlug, HomeReadlistPreference> };
}

const MAINLINE_READLISTS: readonly Readlist[] = [DEFAULT_READLIST];

export function readlistToFileInto(context: ReadlistContext): ReadlistSlug | undefined {
	const { slug } = context.activeReadlist;
	return isBuiltInReadlist(slug) ? undefined : slug;
}

export function mainlineReadlistContext(query: Record<string, unknown>): ReadlistContext {
	return {
		definitions: [],
		state: { ...parseReadlistUrl(query), readlist: DEFAULT_READLIST_SLUG },
		activeReadlist: DEFAULT_READLIST,
		readlists: MAINLINE_READLISTS,
		activePurpose: undefined,
		pinnedReadlists: [],
	};
}

export interface ReadlistRequest {
	query: Record<string, unknown>;
	headers: { cookie?: string; authorization?: string };
}

export function sessionIdOf(req: ReadlistRequest): string | undefined {
	if (req.headers.authorization !== undefined) return undefined;
	return readCookie(req.headers.cookie, SESSION_COOKIE_NAME);
}

function withRememberedFilter(state: ReadlistUrlState, remembered: ReadlistFilter | undefined): ReadlistUrlState {
	if (remembered === undefined) return state;
	const urlTicksChips = state.discovery !== undefined && state.discovery.time.length + state.discovery.saved.length > 0;
	if (urlTicksChips) return state;
	return { ...state, discovery: { q: state.discovery?.q, ...remembered } };
}

export function initResolveReadlistContext(deps: {
	bulkEnabled?: boolean;
	listReadlistDefinitions: ListReadlistDefinitions;
	findSessionReadlistFilter: FindSessionReadlistFilter;
}): (req: ReadlistRequest, userId: UserId, home?: {
	preference: HomeReadlistPreference | undefined;
	open: boolean;
}) => Promise<ReadlistContext> {
	const rememberedFilterOf = async (req: ReadlistRequest): Promise<ReadlistFilter | undefined> => {
		const sessionId = sessionIdOf(req);
		return sessionId === undefined ? undefined : deps.findSessionReadlistFilter(sessionId);
	};
	return async (req, userId, home) => {
		const [definitions, remembered] = await Promise.all([
			deps.listReadlistDefinitions(userId),
			rememberedFilterOf(req),
		]);
		const readlists = readerReadlists(definitions);
		const homeSlug = homeReadlistOf(home?.preference, definitions);
		const { source: _source, sender: _sender, ...plainQuery } = req.query;
		const parsed = parseReadlistUrl(deps.bulkEnabled === false ? plainQuery : req.query);
		const requested = withRememberedFilter({ ...parsed, readlist: home?.open && homeSlug === home.preference?.slug ? homeSlug : parsed.readlist }, remembered);
		const activeReadlist = requested.readlist === HAND_PICKED_SCOPE ? HAND_PICKED : readlists.find((readlist) => readlist.slug === requested.readlist) ?? DEFAULT_READLIST;
		return {
			definitions,
			state: { ...requested, readlist: activeReadlist.slug },
			activeReadlist,
			readlists,
			activePurpose: definitions.find((definition) => definition.slug === activeReadlist.slug)?.purpose,
			pinnedReadlists: pinnedReadlistSlugs(definitions),
			...(home ? { home: { slug: homeSlug, entry: homeEntryReadlistOf(home.preference, definitions), targets: homeReadlistTargets(homeSlug, definitions) } } : {}),
		};
	};
}

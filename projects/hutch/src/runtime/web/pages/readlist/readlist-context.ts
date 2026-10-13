import {
	DEFAULT_READLIST_SLUG,
	readerReadlists,
	type ReadlistSlug,
} from "@packages/domain/readlist";
import type { ReadlistFilter } from "@packages/domain/article";
import type { UserId } from "@packages/domain/user";
import type { ListReadlistDefinitions } from "@packages/provider-contracts/article-store";
import type { FindSessionReadlistFilter } from "@packages/provider-contracts/auth";
import { SESSION_COOKIE_NAME, readCookie } from "@packages/web-session";
import { DEFAULT_READLIST, type Readlist } from "./readlist.nav";
import { type ReadlistUrlState, parseReadlistUrl } from "./readlist.url";

export { readerReadlists };

export interface ReadlistContext {
	state: ReadlistUrlState;
	activeReadlist: Readlist;
	readlists: readonly Readlist[];
}

const MAINLINE_READLISTS: readonly Readlist[] = [DEFAULT_READLIST];

export function readlistToFileInto(context: ReadlistContext): ReadlistSlug | undefined {
	const { slug } = context.activeReadlist;
	return slug === DEFAULT_READLIST_SLUG ? undefined : slug;
}

export function mainlineReadlistContext(query: Record<string, unknown>): ReadlistContext {
	return {
		state: { ...parseReadlistUrl(query), readlist: DEFAULT_READLIST_SLUG },
		activeReadlist: DEFAULT_READLIST,
		readlists: MAINLINE_READLISTS,
	};
}

interface ReadlistRequest {
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
	listReadlistDefinitions: ListReadlistDefinitions;
	findSessionReadlistFilter: FindSessionReadlistFilter;
}): (req: ReadlistRequest, userId: UserId) => Promise<ReadlistContext> {
	const rememberedFilterOf = async (req: ReadlistRequest): Promise<ReadlistFilter | undefined> => {
		const sessionId = sessionIdOf(req);
		return sessionId === undefined ? undefined : deps.findSessionReadlistFilter(sessionId);
	};
	return async (req, userId) => {
		const [definitions, remembered] = await Promise.all([
			deps.listReadlistDefinitions(userId),
			rememberedFilterOf(req),
		]);
		const readlists = readerReadlists(definitions);
		const requested = withRememberedFilter(parseReadlistUrl(req.query), remembered);
		const activeReadlist = readlists.find((readlist) => readlist.slug === requested.readlist) ?? DEFAULT_READLIST;
		return {
			state: { ...requested, readlist: activeReadlist.slug },
			activeReadlist,
			readlists,
		};
	};
}

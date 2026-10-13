import type { ReadlistFilter } from "@packages/domain/article";
import { DEFAULT_READLIST_SLUG, ReadlistSlugSchema } from "@packages/domain/readlist";
import { UserIdSchema } from "@packages/domain/user";
import { initResolveReadlistContext, readlistToFileInto } from "./readlist-context";
import { DEFAULT_READLIST } from "./readlist.nav";

const WORK = { slug: ReadlistSlugSchema.parse("work"), label: "Work" };

describe("readlistToFileInto", () => {
	it("names the readlist a save must be filed into when the reader addressed one of their own", () => {
		expect(
			readlistToFileInto({
				state: { readlist: WORK.slug, tab: "queue", page: 1 },
				activeReadlist: WORK,
				readlists: [DEFAULT_READLIST, WORK],
			}),
		).toEqual(WORK.slug);
	});

	it("names no readlist for the default one, whose save is the mainline write the caller already made", () => {
		expect(
			readlistToFileInto({
				state: { readlist: DEFAULT_READLIST_SLUG, tab: "queue", page: 1 },
				activeReadlist: DEFAULT_READLIST,
				readlists: [DEFAULT_READLIST, WORK],
			}),
		).toEqual(undefined);
	});
});

describe("initResolveReadlistContext", () => {
	const READER = UserIdSchema.parse("reader-1");

	function discoveryFor(input: {
		query: Record<string, unknown>;
		cookie?: string;
		authorization?: string;
		remembered?: ReadlistFilter;
	}) {
		const asked: string[] = [];
		const resolve = initResolveReadlistContext({
			listReadlistDefinitions: async () => [],
			findSessionReadlistFilter: async (sessionId) => {
				asked.push(sessionId);
				return input.remembered;
			},
		});
		return resolve({ query: input.query, headers: { cookie: input.cookie, authorization: input.authorization } }, READER).then((context) => ({
			discovery: context.state.discovery,
			asked,
		}));
	}

	it("applies the session's remembered filter to a link that names none, beside the link's search", async () => {
		const { discovery, asked } = await discoveryFor({
			query: { q: "focus" },
			cookie: "hutch_sid=session-1",
			remembered: { time: ["5-10"], saved: ["week"] },
		});

		expect(discovery).toEqual({ q: "focus", time: ["5-10"], saved: ["week"] });
		expect(asked).toEqual(["session-1"]);
	});

	it("lets the filters a link names win over the remembered ones", async () => {
		const { discovery } = await discoveryFor({
			query: { saved: "older" },
			cookie: "hutch_sid=session-1",
			remembered: { time: ["5-10"], saved: [] },
		});

		expect(discovery).toEqual({ q: undefined, time: [], saved: ["older"] });
	});

	it("leaves the link as it is when the session remembers no filter", async () => {
		const { discovery } = await discoveryFor({ query: {}, cookie: "hutch_sid=session-1" });

		expect(discovery).toBe(undefined);
	});

	it("asks for no remembered filter when the request carries no session", async () => {
		const { discovery, asked } = await discoveryFor({ query: {}, remembered: { time: ["5-10"], saved: [] } });

		expect(discovery).toBe(undefined);
		expect(asked).toEqual([]);
	});

	it("keeps the remembered filter away from a token-authenticated client, even one that also sends the session cookie", async () => {
		const { discovery, asked } = await discoveryFor({
			query: {},
			cookie: "hutch_sid=session-1",
			authorization: "Bearer token",
			remembered: { time: ["5-10"], saved: [] },
		});

		expect(discovery).toBe(undefined);
		expect(asked).toEqual([]);
	});
});

import { DEFAULT_READLIST_SLUG, ReadlistSlugSchema } from "@packages/domain/readlist";
import { readlistToFileInto } from "./readlist-context";
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

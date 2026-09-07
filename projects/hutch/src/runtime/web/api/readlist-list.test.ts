import { DEFAULT_READLIST_SLUG, ReadlistSlugSchema } from "@packages/domain/readlist";
import type { ReadlistSlug } from "@packages/domain/readlist";
import { buildReadlistList } from "./readlist-list";

const WORK = ReadlistSlugSchema.parse("work");
const LATER = ReadlistSlugSchema.parse("later");

const readlists = [
	{ slug: DEFAULT_READLIST_SLUG, label: "All" },
	{ slug: WORK, label: "Work" },
	{ slug: LATER, label: "Later" },
];

const hrefForReadlist = (readlist: ReadlistSlug) => `/queue?queue=${readlist}`;

describe("buildReadlistList", () => {
	it("marks the addressed readlist current, every other one a readlist, and keeps the given order", () => {
		expect(buildReadlistList({ readlists, currentReadlist: WORK, hrefForReadlist })).toEqual([
			{ label: "All", rel: "readlist", href: "/queue?queue=default" },
			{ label: "Work", rel: "current", href: "/queue?queue=work" },
			{ label: "Later", rel: "readlist", href: "/queue?queue=later" },
		]);
	});

	it("marks the default readlist current when the collection addressed it", () => {
		expect(
			buildReadlistList({ readlists, currentReadlist: DEFAULT_READLIST_SLUG, hrefForReadlist }),
		).toEqual([
			{ label: "All", rel: "current", href: "/queue?queue=default" },
			{ label: "Work", rel: "readlist", href: "/queue?queue=work" },
			{ label: "Later", rel: "readlist", href: "/queue?queue=later" },
		]);
	});

	it("takes each href from the caller so readlist URLs stay server-built", () => {
		const entries = buildReadlistList({
			readlists,
			currentReadlist: WORK,
			hrefForReadlist: (readlist) => `/queue?queue=${readlist}&status=unread`,
		});

		expect(entries.map((entry) => entry.href)).toEqual([
			"/queue?queue=default&status=unread",
			"/queue?queue=work&status=unread",
			"/queue?queue=later&status=unread",
		]);
	});
});

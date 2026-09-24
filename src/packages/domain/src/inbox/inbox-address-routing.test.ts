import assert from "node:assert/strict";
import { DEFAULT_READLIST_SLUG, ReadlistSlugSchema } from "../readlist/readlist-name.schema";
import { UserIdSchema } from "../user";
import { decideInboxRouting } from "./inbox-address-routing";
import {
	AliasNameSchema,
	InboxAddressSchema,
	type InboxAddressPurpose,
	InboxTokenSchema,
} from "./inbox-address.schema";
import type { InboxAddressEntry } from "./inbox-address.types";

const slug = (value: string) => ReadlistSlugSchema.parse(value);
const WORK = slug("a1b2c3d4");
const readlists = [{ slug: DEFAULT_READLIST_SLUG }, { slug: WORK }, { slug: slug("e5f6a7b8") }];

function inbox(input: {
	address: string;
	purpose?: InboxAddressPurpose;
	disabledAt?: string;
}): InboxAddressEntry {
	const address = InboxAddressSchema.parse(input.address);
	const localPart = address.slice(0, address.indexOf("@"));
	return {
		address,
		userId: UserIdSchema.parse("user-1"),
		name: AliasNameSchema.parse(localPart.slice(0, localPart.lastIndexOf("-"))),
		token: InboxTokenSchema.parse(localPart.slice(localPart.lastIndexOf("-") + 1)),
		createdAt: "2026-09-01T00:00:00.000Z",
		disabledAt: input.disabledAt,
		purpose: input.purpose ?? "user-alias",
		readlist: undefined,
	};
}

const inboxes = [
	inbox({ address: "news-abc123@read.place" }),
	inbox({ address: "gmail-def456@read.place", purpose: "gmail-forwarding" }),
	inbox({ address: "substack-ghi789@read.place", purpose: "gmail-mapped" }),
	inbox({ address: "old-jkl012@read.place", disabledAt: "2026-09-02T00:00:00.000Z" }),
];

describe("decideInboxRouting", () => {
	it("routes a live inbox to the readlist whose preferences submitted it", () => {
		assert.deepEqual(
			decideInboxRouting({
				slug: WORK,
				address: "news-abc123@read.place",
				destination: "a1b2c3d4",
				inboxes,
				readlists,
			}),
			{ ok: true, address: "news-abc123@read.place", readlist: WORK },
		);
	});

	it("sends an inbox back to All by clearing its readlist", () => {
		assert.deepEqual(
			decideInboxRouting({
				slug: WORK,
				address: "news-abc123@read.place",
				destination: "default",
				inboxes,
				readlists,
			}),
			{ ok: true, address: "news-abc123@read.place", readlist: undefined },
		);
	});

	it("routes a Gmail-mapped inbox like any other", () => {
		assert.deepEqual(
			decideInboxRouting({
				slug: WORK,
				address: "substack-ghi789@read.place",
				destination: "a1b2c3d4",
				inboxes,
				readlists,
			}),
			{ ok: true, address: "substack-ghi789@read.place", readlist: WORK },
		);
	});

	it("refuses to route into All, which has no preferences of its own", () => {
		assert.deepEqual(
			decideInboxRouting({
				slug: DEFAULT_READLIST_SLUG,
				address: "news-abc123@read.place",
				destination: "default",
				inboxes,
				readlists,
			}),
			{ ok: false, reason: "unknown-readlist" },
		);
	});

	it("refuses a readlist the reader does not have", () => {
		assert.deepEqual(
			decideInboxRouting({
				slug: slug("ffffffff"),
				address: "news-abc123@read.place",
				destination: "ffffffff",
				inboxes,
				readlists,
			}),
			{ ok: false, reason: "unknown-readlist" },
		);
	});

	it("refuses a value that is not an inbox address", () => {
		assert.deepEqual(
			decideInboxRouting({
				slug: WORK,
				address: "not an address",
				destination: "a1b2c3d4",
				inboxes,
				readlists,
			}),
			{ ok: false, reason: "unknown-inbox" },
		);
	});

	it("refuses an address the reader does not own", () => {
		assert.deepEqual(
			decideInboxRouting({
				slug: WORK,
				address: "news-zzz999@read.place",
				destination: "a1b2c3d4",
				inboxes,
				readlists,
			}),
			{ ok: false, reason: "unknown-inbox" },
		);
	});

	it("refuses the hidden Gmail forwarding gateway", () => {
		assert.deepEqual(
			decideInboxRouting({
				slug: WORK,
				address: "gmail-def456@read.place",
				destination: "a1b2c3d4",
				inboxes,
				readlists,
			}),
			{ ok: false, reason: "unknown-inbox" },
		);
	});

	it("refuses a disabled inbox", () => {
		assert.deepEqual(
			decideInboxRouting({
				slug: WORK,
				address: "old-jkl012@read.place",
				destination: "a1b2c3d4",
				inboxes,
				readlists,
			}),
			{ ok: false, reason: "unknown-inbox" },
		);
	});

	it("refuses a destination other than this readlist or All", () => {
		assert.deepEqual(
			decideInboxRouting({
				slug: WORK,
				address: "news-abc123@read.place",
				destination: "e5f6a7b8",
				inboxes,
				readlists,
			}),
			{ ok: false, reason: "invalid-destination" },
		);
	});
});

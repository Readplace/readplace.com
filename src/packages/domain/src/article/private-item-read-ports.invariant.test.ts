import { UserIdSchema } from "../user/user.schema";
import { storedArticleBody } from "./article-body";
import { ANONYMOUS_VIEWER, type Viewer, viewerFor } from "./private-item-access";
import { shownSummary } from "./shown-summary";

const PRIVATE_URL = "https://uploads.readplace.invalid/0123456789abcdef0123456789abcdef";
const OWNER = UserIdSchema.parse("owner-user");
const STORED_BODY_SENTINEL = "stored-body-sentinel-7f3a";
const STORED_SUMMARY_SENTINEL = "stored-summary-sentinel-2c9e";

const NON_OWNER_VIEWERS: ReadonlyArray<{ name: string; viewer: Viewer }> = [
	{ name: "a signed-out viewer", viewer: ANONYMOUS_VIEWER },
	{ name: "another reader", viewer: viewerFor(UserIdSchema.parse("other-reader")) },
];

const PRIVATE_ITEM_READ_PORTS: ReadonlyArray<{ name: string; read: (viewer: Viewer) => unknown; sentinel: string }> = [
	{
		name: "storedArticleBody",
		read: (viewer) =>
			storedArticleBody({ url: PRIVATE_URL, html: `<p>${STORED_BODY_SENTINEL}</p>`, viewer, ownerUserId: OWNER }),
		sentinel: STORED_BODY_SENTINEL,
	},
	{
		name: "shownSummary",
		read: (viewer) =>
			shownSummary({
				url: PRIVATE_URL,
				summary: { status: "ready", summary: STORED_SUMMARY_SENTINEL, excerpt: STORED_SUMMARY_SENTINEL },
				viewer,
				ownerUserId: OWNER,
			}),
		sentinel: STORED_SUMMARY_SENTINEL,
	},
];

describe("a private upload's read ports", () => {
	describe.each(PRIVATE_ITEM_READ_PORTS)("$name", ({ read, sentinel }) => {
		it.each(NON_OWNER_VIEWERS)("give $name none of the stored text", ({ viewer }) => {
			expect(JSON.stringify(read(viewer))).not.toContain(sentinel);
		});

		it("give the owner the stored text", () => {
			expect(JSON.stringify(read(viewerFor(OWNER)))).toContain(sentinel);
		});
	});
});

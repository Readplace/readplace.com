import { UserIdSchema } from "../user/user.schema";
import { storedArticleBody } from "./article-body";
import { ANONYMOUS_VIEWER, type Viewer, viewerFor } from "./private-item-access";

const PRIVATE_URL = "https://uploads.readplace.invalid/0123456789abcdef0123456789abcdef";
const OWNER = UserIdSchema.parse("owner-user");
const STORED_BODY_SENTINEL = "stored-body-sentinel-7f3a";

const NON_OWNER_VIEWERS: ReadonlyArray<{ name: string; viewer: Viewer }> = [
	{ name: "a signed-out viewer", viewer: ANONYMOUS_VIEWER },
	{ name: "another reader", viewer: viewerFor(UserIdSchema.parse("other-reader")) },
];

const PRIVATE_ITEM_READ_PORTS: ReadonlyArray<{ name: string; read: (viewer: Viewer) => unknown }> = [
	{
		name: "storedArticleBody",
		read: (viewer) =>
			storedArticleBody({ url: PRIVATE_URL, html: `<p>${STORED_BODY_SENTINEL}</p>`, viewer, ownerUserId: OWNER }),
	},
];

describe("a private upload's read ports", () => {
	describe.each(PRIVATE_ITEM_READ_PORTS)("$name", ({ read }) => {
		it.each(NON_OWNER_VIEWERS)("give $name none of the stored text", ({ viewer }) => {
			expect(JSON.stringify(read(viewer))).not.toContain(STORED_BODY_SENTINEL);
		});

		it("give the owner the stored text", () => {
			expect(JSON.stringify(read(viewerFor(OWNER)))).toContain(STORED_BODY_SENTINEL);
		});
	});
});

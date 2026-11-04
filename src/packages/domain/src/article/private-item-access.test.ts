import assert from "node:assert/strict";
import { mintPrivateItemUrl, UploadIdSchema } from "@packages/media-contracts";
import { UserIdSchema } from "../user/user.schema";
import {
	ANONYMOUS_VIEWER,
	isPrivateItemUrl,
	isPubliclyWithheld,
	mayReadItem,
	type Viewer,
	viewerFor,
} from "./private-item-access";

const PRIVATE_URL = mintPrivateItemUrl(UploadIdSchema.parse("0123456789abcdef0123456789abcdef"));
const PUBLIC_URL = "https://example.com/a";
const OWNER = UserIdSchema.parse("owner-user");
const OTHER_READER = UserIdSchema.parse("other-user");

describe("viewerFor", () => {
	it("is the anonymous viewer when nobody is signed in", () => {
		assert.deepEqual(viewerFor(undefined), ANONYMOUS_VIEWER);
	});

	it("is a reader carrying the signed-in user's id", () => {
		assert.deepEqual(viewerFor(OWNER), { kind: "reader", userId: OWNER });
	});
});

describe("isPrivateItemUrl", () => {
	it("is true for a minted private item identity", () => {
		assert.equal(isPrivateItemUrl(PRIVATE_URL), true);
	});

	it("is false for an ordinary article URL", () => {
		assert.equal(isPrivateItemUrl(PUBLIC_URL), false);
	});
});

describe("mayReadItem", () => {
	const viewers: ReadonlyArray<{ name: string; viewer: Viewer }> = [
		{ name: "anonymous", viewer: ANONYMOUS_VIEWER },
		{ name: "owner", viewer: viewerFor(OWNER) },
		{ name: "other reader", viewer: viewerFor(OTHER_READER) },
	];
	const owners = [OWNER, undefined];

	for (const { name, viewer } of viewers) {
		for (const ownerUserId of owners) {
			it(`lets the ${name} read a public URL when the row's owner is ${ownerUserId ?? "unset"}`, () => {
				assert.equal(mayReadItem({ url: PUBLIC_URL, viewer, ownerUserId }), true);
			});
		}
	}

	it("lets the owner read their private item", () => {
		assert.equal(mayReadItem({ url: PRIVATE_URL, viewer: viewerFor(OWNER), ownerUserId: OWNER }), true);
	});

	it("refuses an anonymous viewer a private item", () => {
		assert.equal(mayReadItem({ url: PRIVATE_URL, viewer: ANONYMOUS_VIEWER, ownerUserId: OWNER }), false);
	});

	it("refuses another reader a private item", () => {
		assert.equal(mayReadItem({ url: PRIVATE_URL, viewer: viewerFor(OTHER_READER), ownerUserId: OWNER }), false);
	});

	for (const { name, viewer } of viewers) {
		it(`refuses the ${name} a private item whose row has no owner`, () => {
			assert.equal(mayReadItem({ url: PRIVATE_URL, viewer, ownerUserId: undefined }), false);
		});
	}
});

describe("isPubliclyWithheld", () => {
	it("withholds a webmail page", () => {
		assert.equal(isPubliclyWithheld("https://mail.google.com/mail/u/0/"), true);
	});

	it("withholds a private item identity", () => {
		assert.equal(isPubliclyWithheld(PRIVATE_URL), true);
	});

	it("does not withhold an ordinary article URL", () => {
		assert.equal(isPubliclyWithheld(PUBLIC_URL), false);
	});
});

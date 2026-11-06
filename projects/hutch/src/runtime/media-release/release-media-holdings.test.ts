import assert from "node:assert/strict";
import { UserIdSchema } from "@packages/domain/user";
import { UploadIdSchema } from "@packages/media-contracts";
import { initPrivateItemReleaseSteps, initReleasePrivateItem } from "./private-item-release-steps";

const AUDIO_UPLOAD_ID = "0123456789abcdef0123456789abcdef";
const AUDIO_URL = `https://uploads.readplace.invalid/${AUDIO_UPLOAD_ID}`;
const BOOK_UPLOAD_ID = "fedcba9876543210fedcba9876543210";
const BOOK_URL = `https://uploads.readplace.invalid/${BOOK_UPLOAD_ID}`;
const OWNER = UserIdSchema.parse("a".repeat(32));

function buildSubject(url: string) {
	const calls: string[] = [];
	const owners = new Map([[url, OWNER]]);
	const links = new Set([url]);
	const holds = new Map([[UploadIdSchema.parse(AUDIO_UPLOAD_ID), ["sha-of-the-audio"]]]);
	const failures = { unrefAllOnce: false };
	const releasePrivateItem = initReleasePrivateItem({
		findItemOwner: async (itemUrl) => owners.get(itemUrl),
		steps: initPrivateItemReleaseSteps({
			purgeArticleContent: async () => {},
			deleteMediaObjects: async () => {},
			listMediaKeys: async () => [],
			deleteArticleRow: async (itemUrl) => {
				calls.push("row");
				owners.delete(itemUrl);
			},
			mediaObjects: {
				unrefAll: async ({ uploadId }) => {
					calls.push(`unrefAll:${uploadId}`);
					if (failures.unrefAllOnce) {
						failures.unrefAllOnce = false;
						throw new Error("simulated unrefAll failure");
					}
					holds.delete(uploadId);
				},
			},
			deleteUserArticleLinks: async (itemUrl) => {
				calls.push("links");
				links.delete(itemUrl);
			},
		}),
	});
	return { calls, links, holds, failures, releasePrivateItem };
}

describe("releasing an item's media holdings", () => {
	it("unrefs an audio item's holdings after its row is deleted and before its links are", async () => {
		const { calls, holds, releasePrivateItem } = buildSubject(AUDIO_URL);

		const outcome = await releasePrivateItem({ url: AUDIO_URL, userId: OWNER });

		assert.equal(outcome, "released");
		assert.deepEqual(calls, ["row", `unrefAll:${AUDIO_UPLOAD_ID}`, "links"]);
		assert.equal(holds.size, 0);
	});

	it("keeps the links when unrefAll rejects, so the redelivered run passes the owner check on the deleted row and unrefs again", async () => {
		const { calls, links, holds, failures, releasePrivateItem } = buildSubject(AUDIO_URL);
		failures.unrefAllOnce = true;

		await assert.rejects(releasePrivateItem({ url: AUDIO_URL, userId: OWNER }), /simulated unrefAll failure/);
		assert.deepEqual([...links], [AUDIO_URL]);

		const outcome = await releasePrivateItem({ url: AUDIO_URL, userId: OWNER });

		assert.equal(outcome, "released");
		assert.deepEqual(calls, ["row", `unrefAll:${AUDIO_UPLOAD_ID}`, "row", `unrefAll:${AUDIO_UPLOAD_ID}`, "links"]);
		assert.deepEqual([...links], []);
		assert.equal(holds.size, 0);
	});

	it("unrefs a book item's upload, which holds nothing, and still releases its links", async () => {
		const { calls, links, holds, releasePrivateItem } = buildSubject(BOOK_URL);

		const outcome = await releasePrivateItem({ url: BOOK_URL, userId: OWNER });

		assert.equal(outcome, "released");
		assert.deepEqual(calls, ["row", `unrefAll:${BOOK_UPLOAD_ID}`, "links"]);
		assert.deepEqual([...links], []);
		assert.deepEqual([...holds.keys()], [AUDIO_UPLOAD_ID]);
	});
});

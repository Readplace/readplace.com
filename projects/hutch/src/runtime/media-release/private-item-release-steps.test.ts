import assert from "node:assert/strict";
import { UserIdSchema } from "@packages/domain/user";
import { initPrivateItemReleaseSteps, initReleasePrivateItem, type ReleaseStep } from "./private-item-release-steps";

const UPLOAD_ID = "0123456789abcdef0123456789abcdef";
const PRIVATE_URL = `https://uploads.readplace.invalid/${UPLOAD_ID}`;
const OWNER = UserIdSchema.parse("a".repeat(32));
const OTHER = UserIdSchema.parse("b".repeat(32));

function recordingSteps(calls: string[]): ReleaseStep[] {
	return ["first", "second"].map((name) => async ({ url }) => {
		calls.push(`${name}:${url}`);
	});
}

describe("initReleasePrivateItem", () => {
	it("runs every step in order when the owner releases the item", async () => {
		const calls: string[] = [];
		const releasePrivateItem = initReleasePrivateItem({ findItemOwner: async () => OWNER, steps: recordingSteps(calls) });

		const outcome = await releasePrivateItem({ url: PRIVATE_URL, userId: OWNER });

		assert.equal(outcome, "released");
		assert.deepEqual(calls, [`first:${PRIVATE_URL}`, `second:${PRIVATE_URL}`]);
	});

	it("returns not-owner and runs no step when another user releases the item", async () => {
		const calls: string[] = [];
		const releasePrivateItem = initReleasePrivateItem({ findItemOwner: async () => OWNER, steps: recordingSteps(calls) });

		const outcome = await releasePrivateItem({ url: PRIVATE_URL, userId: OTHER });

		assert.equal(outcome, "not-owner");
		assert.deepEqual(calls, []);
	});

	it("runs every step when the row is already gone, so a replay converges", async () => {
		const calls: string[] = [];
		const releasePrivateItem = initReleasePrivateItem({ findItemOwner: async () => undefined, steps: recordingSteps(calls) });

		const outcome = await releasePrivateItem({ url: PRIVATE_URL, userId: OWNER });

		assert.equal(outcome, "released");
		assert.deepEqual(calls, [`first:${PRIVATE_URL}`, `second:${PRIVATE_URL}`]);
	});
});

describe("initPrivateItemReleaseSteps", () => {
	it("releases the content, the pending original, the row, then the links", async () => {
		const calls: string[] = [];
		const steps = initPrivateItemReleaseSteps({
			purgeArticleContent: async (url) => {
				calls.push(`content:${url}`);
			},
			deleteMediaObjects: async (keys) => {
				calls.push(`media:${keys.join(",")}`);
			},
			deleteArticleRow: async (url) => {
				calls.push(`row:${url}`);
			},
			deleteUserArticleLinks: async (url) => {
				calls.push(`links:${url}`);
			},
		});

		for (const step of steps) {
			await step({ url: PRIVATE_URL });
		}

		assert.deepEqual(calls, [
			`content:${PRIVATE_URL}`,
			`media:pending/${UPLOAD_ID}/original`,
			`row:${PRIVATE_URL}`,
			`links:${PRIVATE_URL}`,
		]);
	});
});

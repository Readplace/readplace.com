import assert from "node:assert/strict";
import { calculateReadTime } from "@packages/domain/article";
import { UserIdSchema } from "@packages/domain/user";
import { HutchLogger, noopLogger } from "@packages/hutch-logger";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import { initInMemoryArticleStore } from "@packages/test-fixtures/providers/article-store";
import { buildSqsEvent } from "@packages/test-fixtures/sqs";
import { initMediaReleaseHandler } from "./media-release-handler";
import { initPrivateItemReleaseSteps, initReleasePrivateItem } from "./private-item-release-steps";

const UPLOAD_ID = "0123456789abcdef0123456789abcdef";
const PRIVATE_URL = `https://uploads.readplace.invalid/${UPLOAD_ID}`;
const OWNER = UserIdSchema.parse("a".repeat(32));
const OTHER = UserIdSchema.parse("b".repeat(32));

async function buildSubject(overrides: { failRowDelete?: boolean } = {}) {
	const store = initInMemoryArticleStore();
	await store.saveArticle({
		userId: OWNER,
		url: PRIVATE_URL,
		metadata: { title: "A private book", siteName: "Private press", excerpt: "", wordCount: 3 },
		estimatedReadTime: calculateReadTime(3),
		provenance: { kind: "web" },
		savedAt: new Date("2026-09-01T00:00:00.000Z"),
	});
	await store.recordItemOwner({ url: PRIVATE_URL, ownerUserId: OWNER });
	const calls: string[] = [];
	const steps = initPrivateItemReleaseSteps({
		purgeArticleContent: async (url) => {
			calls.push(`content:${url}`);
		},
		deleteMediaObjects: async (keys) => {
			calls.push(`media:${keys.join(",")}`);
		},
		deleteArticleRow: async (url) => {
			if (overrides.failRowDelete) throw new Error("DeleteItem failed");
			calls.push(`row:${url}`);
		},
		deleteUserArticleLinks: async (url) => {
			calls.push(`links:${url}`);
		},
	});
	const handler = initMediaReleaseHandler({
		releasePrivateItem: initReleasePrivateItem({ findItemOwner: store.findItemOwner, steps }),
		logger: HutchLogger.from(noopLogger),
	});
	return { calls, handler };
}

function dequeued(userId: string) {
	return buildSqsEvent([{ messageId: "m1", body: JSON.stringify({ detail: { url: PRIVATE_URL, userId } }) }]);
}

describe("initMediaReleaseHandler", () => {
	it("releases the owner's item: content, pending original, row, then links", async () => {
		const { calls, handler } = await buildSubject();

		const result = await handler(dequeued(OWNER), buildLambdaContext(), () => {});

		assert.deepEqual(result, { batchItemFailures: [] });
		assert.deepEqual(calls, [
			`content:${PRIVATE_URL}`,
			`media:pending/${UPLOAD_ID}/original`,
			`row:${PRIVATE_URL}`,
			`links:${PRIVATE_URL}`,
		]);
	});

	it("runs no release step when a non-owner who holds the private url dequeues it", async () => {
		const { calls, handler } = await buildSubject();

		const result = await handler(dequeued(OTHER), buildLambdaContext(), () => {});

		assert.deepEqual(result, { batchItemFailures: [] });
		assert.deepEqual(calls, []);
	});

	it("fails the record when a step throws, so SQS retries it", async () => {
		const { calls, handler } = await buildSubject({ failRowDelete: true });

		const result = await handler(dequeued(OWNER), buildLambdaContext(), () => {});

		assert.deepEqual(result, { batchItemFailures: [{ itemIdentifier: "m1" }] });
		assert.deepEqual(calls, [`content:${PRIVATE_URL}`, `media:pending/${UPLOAD_ID}/original`]);
	});
});

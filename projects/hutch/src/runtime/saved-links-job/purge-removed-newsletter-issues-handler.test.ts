import assert from "node:assert/strict";
import { MinutesSchema } from "@packages/domain/article";
import { emailIssueArticleUrl, emailImageS3KeyPrefix, InboxAddressSchema, MessageIdSchema } from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";
import type { PublishEvent } from "@packages/infra-components/runtime";
import { Logger, noopLogger } from "@packages/logger";
import { initInMemoryArticleStore } from "@packages/test-fixtures/providers/article-store";
import { initInMemoryInboxEmail } from "@packages/test-fixtures/providers/inbox-email";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import { buildSqsEvent } from "@packages/test-fixtures/sqs";
import { initPurgeRemovedNewsletterIssuesHandler } from "./purge-removed-newsletter-issues-handler";

const READER = UserIdSchema.parse("reader-1");
const NOW = new Date("2027-01-01T12:00:00.000Z");
const DUE = new Date("2026-12-02T00:00:00.000Z");
const RECENT = new Date("2026-12-20T00:00:00.000Z");

function setup() {
	const inbox = initInMemoryInboxEmail();
	const store = initInMemoryArticleStore();
	const calls: string[] = [];
	const published: { detailType: string; detail: unknown }[] = [];
	const publishEvent: PublishEvent = async (definition, detail) => {
		published.push({ detailType: definition.detailType, detail });
	};
	const record = (name: string) => async (value: unknown) => {
		calls.push(`${name} ${JSON.stringify(value)}`);
	};
	const handler = initPurgeRemovedNewsletterIssuesHandler({
		forEachRemovableEmailPage: inbox.forEachRemovableEmailPage,
		clearEmailRemoval: inbox.clearEmailRemoval,
		deleteEmail: async (key) => {
			calls.push(`deleteEmail ${key.receivedAtMessageId}`);
			await inbox.deleteEmail(key);
		},
		findKeysInAll: store.findKeysInAll,
		deleteRawEmailObjects: record("raw"),
		deleteEmailContentObjects: record("body"),
		deleteEmailImageObjects: record("images"),
		deleteLinksByEmails: async (_userId, receivedAtMessageIds) => {
			calls.push(`links ${JSON.stringify(receivedAtMessageIds)}`);
		},
		deleteIdentitiesByEmails: async ({ receivedAtMessageIds }) => {
			calls.push(`identities ${JSON.stringify(receivedAtMessageIds)}`);
		},
		purgeArticleContent: record("purge"),
		tombstoneArticle: async ({ url, at }) => {
			calls.push(`tombstone ${url} ${at.toISOString()}`);
		},
		publishEvent,
		logger: Logger.from(noopLogger),
		now: () => NOW,
	});
	const receive = async (params: { id: string; removedAt?: Date; bodyS3Key?: string }) => {
		const receivedAtMessageId = `2026-11-20T00:00:00.000Z#<${params.id}@x>`;
		await inbox.putEmail({
			userId: READER,
			receivedAtMessageId,
			messageId: MessageIdSchema.parse(`<${params.id}@x>`),
			recipientAddress: InboxAddressSchema.parse("in-3f9a2c@read.place"),
			senderEmail: "dan@tldr.tech",
			subject: "Issue",
			status: "received",
			receivedAt: "2026-11-20T00:00:00.000Z",
			rawEmailS3Key: `inbound/${params.id}`,
			bodyS3Key: params.bodyS3Key,
			linkCounts: undefined,
		});
		if (params.removedAt) {
			await inbox.markEmailRemoved({ userId: READER, receivedAtMessageId, jobId: "job-1", at: params.removedAt });
		}
		return { userId: READER, receivedAtMessageId };
	};
	const run = async () => {
		const event = buildSqsEvent([
			{
				messageId: "m-1",
				body: JSON.stringify({
					source: "hutch.saved-links-job",
					"detail-type": "PurgeRemovedNewsletterIssuesCommand",
					detail: { userId: READER },
				}),
			},
		]);
		const result = await handler(event, buildLambdaContext(), () => {});
		assert(result, "the batch handler answers");
		return result.batchItemFailures.length;
	};
	return { inbox, store, calls, published, receive, run };
}

describe("purging removed newsletter issues", () => {
	it("deletes everything stored for an issue removed 30 days ago, the email row last", async () => {
		const { inbox, calls, published, receive, run } = setup();
		const gone = await receive({ id: "gone", removedAt: DUE, bodyS3Key: "content/gone.html" });

		assert.equal(await run(), 0);

		const url = emailIssueArticleUrl(gone);
		assert.deepEqual(calls, [
			`raw ${JSON.stringify(["inbound/gone"])}`,
			`body ${JSON.stringify(["content/gone.html"])}`,
			`images ${JSON.stringify([emailImageS3KeyPrefix(gone)])}`,
			`links ${JSON.stringify([gone.receivedAtMessageId])}`,
			`identities ${JSON.stringify([gone.receivedAtMessageId])}`,
			`purge ${JSON.stringify(url)}`,
			`tombstone ${url} ${NOW.toISOString()}`,
			`deleteEmail ${gone.receivedAtMessageId}`,
		]);
		assert.equal(await inbox.getEmail(gone), undefined);
		assert.deepEqual(published, [
			{ detailType: "RemovedNewsletterIssuesPurged", detail: { userId: READER, deleted: 1, restored: 0, purgedAt: NOW.toISOString() } },
		]);
	});

	it("keeps an email shown or removed less than 30 days ago, and shows again one whose issue is back in All", async () => {
		const { inbox, store, published, receive, run } = setup();
		const shown = await receive({ id: "shown" });
		const recent = await receive({ id: "recent", removedAt: RECENT });
		const back = await receive({ id: "back", removedAt: DUE });
		await store.saveArticle({
			userId: READER,
			url: emailIssueArticleUrl(back),
			metadata: { title: "Issue", siteName: "tldr.tech", excerpt: "", wordCount: 100 },
			estimatedReadTime: MinutesSchema.parse(1),
			provenance: { kind: "email", senderEmail: "dan@tldr.tech" },
			savedAt: DUE,
			saveTrigger: "automatic",
		});

		assert.equal(await run(), 0);

		assert.equal((await inbox.getEmail(shown))?.removedAt, undefined);
		assert.equal((await inbox.getEmail(recent))?.removedAt, RECENT.toISOString());
		assert.equal((await inbox.getEmail(back))?.removedAt, undefined);
		assert.deepEqual(published.at(-1)?.detail, { userId: READER, deleted: 0, restored: 1, purgedAt: NOW.toISOString() });
	});
});

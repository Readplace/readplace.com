import assert from "node:assert/strict";
import { MinutesSchema } from "@packages/domain/article";
import { hashPassword, type UserId, UserIdSchema, verifyPassword } from "@packages/domain/user";
import { Logger, noopLogger } from "@packages/logger";
import type { FindQueueRowKeys, QueueRowKey } from "@packages/provider-contracts/article-store";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import { initInMemoryArticleStore } from "@packages/test-fixtures/providers/article-store";
import { initInMemoryAuth, initInMemoryIsAccountLive } from "@packages/test-fixtures/providers/auth";
import {
	initInMemoryInboxSavedLink,
	initInMemoryMarkLinkSavedWhileQueued,
} from "@packages/test-fixtures/providers/inbox-email";
import { buildSqsEvent } from "@packages/test-fixtures/sqs";
import { ReadlistSlugSchema } from "@packages/domain/readlist";
import { initFindLinkQueueRowKeys } from "./find-link-queue-row-keys";
import { initRecordFailedLink } from "./record-failed-link";
import { initRecordLinkQueuedHandler } from "./record-link-queued-handler";
import { initRecordQueuedLink } from "./record-queued-link";

const POST_URL = "https://example.com/post";
const ORIGINAL = "https://publisher.example/article";
const ALIAS_TARGET = "https://publisher.example/canonical";
const TRACKER = "https://javascriptweekly.com/link/100000/rss";
const WORK = ReadlistSlugSchema.parse("work");
const NOW = new Date("2026-11-03T10:00:00.000Z");

const outboundTo = (url: string) => `https://archive.ph/o/Ab1cD/${url}`;

function queuedBody(params: { url: string; userId: UserId }): string {
	return JSON.stringify({ "detail-type": "LinkQueued", detail: params });
}

function failedBody(params: { url: string; userId: UserId }): string {
	return JSON.stringify({
		"detail-type": "LinkQueueFailed",
		detail: { ...params, reason: "accept-retries-exhausted", receiveCount: 3 },
	});
}

function dequeuedBody(params: { url: string; userId: UserId }): string {
	return JSON.stringify({ "detail-type": "LinkDequeued", detail: params });
}

type LoggedLine = { message: unknown; details: unknown };

async function createHandler(options: {
	beforeTransaction?: (key: QueueRowKey) => Promise<void>;
	findQueueRowKeys?: (inner: FindQueueRowKeys) => FindQueueRowKeys;
} = {}) {
	const store = initInMemoryInboxSavedLink();
	const articles = initInMemoryArticleStore();
	const auth = initInMemoryAuth({ hashPassword, verifyPassword, now: () => NOW });
	const created = await auth.createUser({ email: "reader@example.com", password: "password123" });
	assert(created.ok, "the reader must sign up");
	const userId = created.userId;
	const lines: LoggedLine[] = [];
	const logger = Logger.from({
		...noopLogger,
		info: (message, details) => lines.push({ message, details }),
	});
	const findLinkQueueRowKeys = initFindLinkQueueRowKeys({
		findIdentityRow: articles.findIdentityRow,
		findQueueRowKeys: articles.findQueueRowKeys,
	});
	const markWhileQueued = initInMemoryMarkLinkSavedWhileQueued({
		hasQueueRow: articles.hasQueueRow,
		inboxSavedLinkStore: store,
	});
	const markLinkSavedWhileQueued: typeof markWhileQueued = async (input) => {
		await options.beforeTransaction?.(input.queueRowKey);
		await markWhileQueued(input);
	};
	const handler = initRecordLinkQueuedHandler({
		recordQueuedLink: initRecordQueuedLink({ findLinkQueueRowKeys, markLinkSavedWhileQueued }),
		recordFailedLink: initRecordFailedLink({
			findLinkQueueRowKeys,
			markLinkSavedWhileQueued,
			isAccountLive: initInMemoryIsAccountLive({ findUserById: auth.findUserById }),
			markLinkSaveFailed: store.markLinkSaveFailed,
		}),
		retractLinkSaved: store.retractLinkSaved,
		findQueueRowKeys: options.findQueueRowKeys?.(articles.findQueueRowKeys) ?? articles.findQueueRowKeys,
		logger,
	});
	const run = (bodies: string[]) =>
		handler(
			buildSqsEvent(bodies.map((body, index) => ({ messageId: `m-${index}`, body }))),
			buildLambdaContext(),
			() => {},
		);
	const saveParams = (url: string) => ({
		userId,
		url,
		metadata: { title: "T", siteName: "example.com", excerpt: "", wordCount: 0 },
		estimatedReadTime: MinutesSchema.parse(0),
		provenance: { kind: "web" } as const,
		savedAt: NOW,
	});
	const queue = async (url: string) => {
		const { saved } = await articles.saveArticle(saveParams(url));
		return { remove: () => articles.deleteArticle(saved.id, userId) };
	};
	const queueInReadlist = (url: string) => articles.saveReadlistArticle({ ...saveParams(url), readlist: WORK });
	const stateOf = async (url: string) => (await store.findSavedLinks({ userId, urls: [url] })).get(url);
	return { store, articles, auth, userId, lines, run, queue, queueInReadlist, stateOf };
}

describe("recordLinkQueuedHandler", () => {
	it("records an accepted save and acknowledges the record", async () => {
		const { userId, run, queue, stateOf } = await createHandler();
		await queue(POST_URL);

		const result = await run([queuedBody({ url: POST_URL, userId })]);

		expect(result).toEqual({ batchItemFailures: [] });
		expect(await stateOf(POST_URL)).toBe("saved");
	});

	it("records a save failure from the failure fact", async () => {
		const { userId, run, stateOf } = await createHandler();

		await run([failedBody({ url: POST_URL, userId })]);

		expect(await stateOf(POST_URL)).toBe("failed");
	});

	it("keeps the link saved when the command dead-letters after the queue row was written", async () => {
		const { userId, run, queue, stateOf } = await createHandler();
		await queue(POST_URL);

		await run([queuedBody({ url: POST_URL, userId })]);
		await run([failedBody({ url: POST_URL, userId })]);

		expect(await stateOf(POST_URL)).toBe("saved");
	});

	it("converges when the same fact is redelivered", async () => {
		const { userId, run, queue, stateOf } = await createHandler();
		await queue(POST_URL);

		await run([queuedBody({ url: POST_URL, userId }), queuedBody({ url: POST_URL, userId })]);

		expect(await stateOf(POST_URL)).toBe("saved");
	});

	it("fails a malformed detail to the DLQ without writing", async () => {
		const { run, queue, stateOf } = await createHandler();
		await queue(POST_URL);

		const result = await run([JSON.stringify({ "detail-type": "LinkQueued", detail: { url: POST_URL } })]);

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "m-0" }] });
		expect(await stateOf(POST_URL)).toBeUndefined();
	});

	it("fails a body that is not JSON to the DLQ", async () => {
		const { run } = await createHandler();

		const result = await run(["not json at all"]);

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "m-0" }] });
	});

	it("fails the record when the store write throws", async () => {
		const handler = initRecordLinkQueuedHandler({
			recordQueuedLink: async () => {
				throw new Error("dynamo unavailable");
			},
			recordFailedLink: async () => "save failed",
			retractLinkSaved: async () => {},
			findQueueRowKeys: async () => [],
			logger: Logger.from(noopLogger),
		});

		const result = await handler(
			buildSqsEvent([{ messageId: "m-0", body: queuedBody({ url: POST_URL, userId: UserIdSchema.parse("user-1") }) }]),
			buildLambdaContext(),
			() => {},
		);

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "m-0" }] });
	});

	it("fails a record whose url cannot be keyed", async () => {
		const { userId, run } = await createHandler();

		const result = await run([queuedBody({ url: "not a url", userId })]);

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "m-0" }] });
	});
});

describe("recordLinkQueuedHandler retraction", () => {
	it("stops reading saved once the reader deletes the queue row", async () => {
		const { userId, run, queue, stateOf } = await createHandler();
		const save = await queue(POST_URL);

		await run([queuedBody({ url: POST_URL, userId })]);
		await save.remove();
		const result = await run([dequeuedBody({ url: POST_URL, userId })]);

		expect(result).toEqual({ batchItemFailures: [] });
		expect(await stateOf(POST_URL)).toBeUndefined();
	});

	it("re-reads saved when the reader saves the link again after deleting it", async () => {
		const { userId, run, queue, stateOf } = await createHandler();
		const save = await queue(POST_URL);

		await run([queuedBody({ url: POST_URL, userId })]);
		await save.remove();
		await run([dequeuedBody({ url: POST_URL, userId })]);
		await queue(POST_URL);
		await run([queuedBody({ url: POST_URL, userId })]);

		expect(await stateOf(POST_URL)).toBe("saved");
	});

	it("converges when the deletion fact is redelivered", async () => {
		const { userId, run, queue, stateOf } = await createHandler();
		const save = await queue(POST_URL);

		await run([queuedBody({ url: POST_URL, userId })]);
		await save.remove();
		const result = await run([dequeuedBody({ url: POST_URL, userId }), dequeuedBody({ url: POST_URL, userId })]);

		expect(result).toEqual({ batchItemFailures: [] });
		expect(await stateOf(POST_URL)).toBeUndefined();
	});

	it("acknowledges a deletion for a link this reader never saved from here", async () => {
		const { userId, run, stateOf } = await createHandler();

		const result = await run([dequeuedBody({ url: "https://example.com/never-saved", userId })]);

		expect(result).toEqual({ batchItemFailures: [] });
		expect(await stateOf(POST_URL)).toBeUndefined();
	});

	it("fails a fact whose detail-type no rule delivers, leaving the record saved", async () => {
		const { userId, run, queue, stateOf } = await createHandler();
		await queue(POST_URL);

		await run([queuedBody({ url: POST_URL, userId })]);
		const result = await run([JSON.stringify({ "detail-type": "LinkSomethingElse", detail: { url: POST_URL, userId } })]);

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "m-0" }] });
		expect(await stateOf(POST_URL)).toBe("saved");
	});
});

describe("recordLinkQueuedHandler — a tweet linked on twitter.com and saved as x.com", () => {
	const TWEET_ON_TWITTER = "https://twitter.com/jack/status/20";
	const TWEET_ON_X = "https://x.com/jack/status/20";

	it("reads the emailed twitter.com link as saved once its x.com save is queued", async () => {
		const { userId, run, queue, stateOf } = await createHandler();
		await queue(TWEET_ON_X);

		await run([queuedBody({ url: TWEET_ON_X, userId })]);

		expect(await stateOf(TWEET_ON_TWITTER)).toBe("saved");
	});

	it("keeps the link saved when the emailed twitter.com command dead-letters after its x.com save was queued", async () => {
		const { userId, run, queue, stateOf } = await createHandler();
		await queue(TWEET_ON_X);

		await run([queuedBody({ url: TWEET_ON_X, userId })]);
		await run([failedBody({ url: TWEET_ON_TWITTER, userId })]);

		expect(await stateOf(TWEET_ON_TWITTER)).toBe("saved");
	});

	it("reads a twitter.com link whose save failed before anything was queued as failed", async () => {
		const { userId, run, stateOf } = await createHandler();

		await run([failedBody({ url: TWEET_ON_TWITTER, userId })]);

		expect(await stateOf(TWEET_ON_TWITTER)).toBe("failed");
	});

	it("keeps a legacy twitter.com save standing when the new x.com article is deleted", async () => {
		const { userId, run, queue, stateOf } = await createHandler();
		await queue(TWEET_ON_TWITTER);
		const xSave = await queue(TWEET_ON_X);

		await run([queuedBody({ url: TWEET_ON_TWITTER, userId }), queuedBody({ url: TWEET_ON_X, userId })]);
		await xSave.remove();
		await run([dequeuedBody({ url: TWEET_ON_X, userId })]);

		expect(await stateOf(TWEET_ON_TWITTER)).toBe("saved");
		expect(await stateOf(TWEET_ON_X)).toBe("saved");
	});

	it("reads the tweet as unsaved once both its articles are deleted", async () => {
		const { store, userId, run, queue } = await createHandler();
		const twitterSave = await queue(TWEET_ON_TWITTER);
		const xSave = await queue(TWEET_ON_X);

		await run([queuedBody({ url: TWEET_ON_TWITTER, userId }), queuedBody({ url: TWEET_ON_X, userId })]);
		await xSave.remove();
		await twitterSave.remove();
		await run([dequeuedBody({ url: TWEET_ON_X, userId }), dequeuedBody({ url: TWEET_ON_TWITTER, userId })]);

		expect((await store.findSavedLinks({ userId, urls: [TWEET_ON_TWITTER, TWEET_ON_X] })).size).toBe(0);
	});

	it("a legacy twitter.com queue row keeps an x.com fact saved", async () => {
		const { userId, run, queue, stateOf } = await createHandler();
		await queue(TWEET_ON_TWITTER);

		await run([queuedBody({ url: TWEET_ON_X, userId })]);

		expect(await stateOf(TWEET_ON_X)).toBe("saved");
	});
});

describe("recordLinkQueuedHandler — redriven facts and conflicting later facts", () => {
	it("a redriven LinkQueued after the reader deleted the link leaves no saved row", async () => {
		const { userId, run, queue, stateOf } = await createHandler();
		const save = await queue(POST_URL);
		await save.remove();

		const result = await run([queuedBody({ url: POST_URL, userId })]);

		expect(result).toEqual({ batchItemFailures: [] });
		expect(await stateOf(POST_URL)).toBeUndefined();
	});

	it("a redriven LinkQueued run twice with the link still queued ends saved", async () => {
		const { userId, run, queue, stateOf } = await createHandler();
		await queue(POST_URL);

		await run([queuedBody({ url: POST_URL, userId })]);
		await run([queuedBody({ url: POST_URL, userId })]);

		expect(await stateOf(POST_URL)).toBe("saved");
	});

	it("a redriven LinkQueued run twice after a delete ends with no row, and the message is consumed both times", async () => {
		const { userId, run, queue, stateOf } = await createHandler();
		const save = await queue(POST_URL);
		await save.remove();

		const first = await run([queuedBody({ url: POST_URL, userId })]);
		const second = await run([queuedBody({ url: POST_URL, userId })]);

		expect([first, second]).toEqual([{ batchItemFailures: [] }, { batchItemFailures: [] }]);
		expect(await stateOf(POST_URL)).toBeUndefined();
	});

	it("a redriven LinkQueued after delete then re-save ends saved", async () => {
		const { userId, run, queue, stateOf } = await createHandler();
		const save = await queue(POST_URL);
		await save.remove();
		await queue(POST_URL);

		await run([queuedBody({ url: POST_URL, userId })]);

		expect(await stateOf(POST_URL)).toBe("saved");
	});

	it("a redriven LinkQueued for a deleted account leaves no row", async () => {
		const { articles, auth, userId, run, queue, stateOf } = await createHandler();
		await queue(POST_URL);
		await auth.markAccountDeleted({ userId, at: NOW.toISOString() });
		await articles.deleteAllUserArticles(userId);

		await run([queuedBody({ url: POST_URL, userId })]);

		expect(await stateOf(POST_URL)).toBeUndefined();
	});

	it("a redriven LinkQueued over a failed row with the link queued ends saved", async () => {
		const { userId, run, queue, stateOf } = await createHandler();
		await run([failedBody({ url: POST_URL, userId })]);
		await queue(POST_URL);

		await run([queuedBody({ url: POST_URL, userId })]);

		expect(await stateOf(POST_URL)).toBe("saved");
	});

	it("a redriven LinkQueueFailed after the account is marked deleted and its queue rows are gone leaves no row", async () => {
		const { articles, auth, userId, run, queue, stateOf } = await createHandler();
		await queue(POST_URL);
		await auth.markAccountDeleted({ userId, at: NOW.toISOString() });
		await articles.deleteAllUserArticles(userId);

		await run([failedBody({ url: POST_URL, userId })]);

		expect(await stateOf(POST_URL)).toBeUndefined();
	});

	it("a redriven LinkQueueFailed when no users row exists leaves no row", async () => {
		const { store, run } = await createHandler();
		const unknownReader = UserIdSchema.parse("never-signed-up");

		await run([failedBody({ url: POST_URL, userId: unknownReader })]);

		expect((await store.findSavedLinks({ userId: unknownReader, urls: [POST_URL] })).size).toBe(0);
	});

	it("a redriven LinkQueueFailed with no queue row over a saved row keeps saved", async () => {
		const { store, userId, run, stateOf } = await createHandler();
		await store.markLinkSaved({ userId, url: POST_URL });

		await run([failedBody({ url: POST_URL, userId })]);

		expect(await stateOf(POST_URL)).toBe("saved");
	});

	it("a redriven LinkQueueFailed with no queue row run twice ends failed", async () => {
		const { userId, run, stateOf } = await createHandler();

		await run([failedBody({ url: POST_URL, userId })]);
		await run([failedBody({ url: POST_URL, userId })]);

		expect(await stateOf(POST_URL)).toBe("failed");
	});

	it("a LinkQueueFailed from a save that threw after its row committed, with no LinkQueued ever delivered, ends saved", async () => {
		const { userId, run, queue, stateOf } = await createHandler();
		await queue(POST_URL);

		await run([failedBody({ url: POST_URL, userId })]);

		expect(await stateOf(POST_URL)).toBe("saved");
	});

	it("a LinkQueueFailed with the link queued over a failed row ends saved", async () => {
		const { userId, run, queue, stateOf } = await createHandler();
		await run([failedBody({ url: POST_URL, userId })]);
		await queue(POST_URL);

		await run([failedBody({ url: POST_URL, userId })]);

		expect(await stateOf(POST_URL)).toBe("saved");
	});

	it("a LinkQueueFailed with the link queued only in a readlist partition ends saved", async () => {
		const { userId, run, queueInReadlist, stateOf } = await createHandler();
		await queueInReadlist(POST_URL);

		await run([failedBody({ url: POST_URL, userId })]);

		expect(await stateOf(POST_URL)).toBe("saved");
	});

	it("a LinkQueueFailed naming the command's raw URL ends saved when the queue row sits under the prepared URL", async () => {
		const { userId, run, queue, stateOf } = await createHandler();
		const raw = "https://www.linkedin.com/comm/feed/update/urn:li:activity:7000000000000000001";
		await queue("https://www.linkedin.com/feed/update/urn:li:activity:7000000000000000001/");

		await run([failedBody({ url: raw, userId })]);

		expect(await stateOf(raw)).toBe("saved");
	});

	it("a transaction failure on a LinkQueueFailed fails the record, and the next receive with the row gone ends failed", async () => {
		let removeQueueRow = async () => {};
		const { userId, run, queue, stateOf } = await createHandler({
			beforeTransaction: async () => removeQueueRow(),
		});
		const save = await queue(POST_URL);
		removeQueueRow = async () => {
			await save.remove();
		};

		const first = await run([failedBody({ url: POST_URL, userId })]);
		const second = await run([failedBody({ url: POST_URL, userId })]);

		expect(first).toEqual({ batchItemFailures: [{ itemIdentifier: "m-0" }] });
		expect(second).toEqual({ batchItemFailures: [] });
		expect(await stateOf(POST_URL)).toBe("failed");
	});

	it.each([
		["LinkQueued first", ["queued", "failed"]],
		["LinkQueueFailed first", ["failed", "queued"]],
	])("a save that threw after publishing LinkQueued, with both facts redriven in either order, ends saved (%s)", async (_, order) => {
		const { userId, run, queue, stateOf } = await createHandler();
		await queue(POST_URL);
		const bodyOf = (fact: string) => (fact === "queued" ? queuedBody : failedBody)({ url: POST_URL, userId });

		for (const fact of order) await run([bodyOf(fact)]);

		expect(await stateOf(POST_URL)).toBe("saved");
	});

	it.each([
		["LinkQueued first", ["queued", "failed"]],
		["LinkQueueFailed first", ["failed", "queued"]],
	])("a save that threw after publishing LinkQueued, with the link deleted and both facts redriven in either order, ends failed (%s)", async (_, order) => {
		const { userId, run, queue, stateOf } = await createHandler();
		const save = await queue(POST_URL);
		await save.remove();
		const bodyOf = (fact: string) => (fact === "queued" ? queuedBody : failedBody)({ url: POST_URL, userId });

		for (const fact of order) await run([bodyOf(fact)]);

		expect(await stateOf(POST_URL)).toBe("failed");
	});

	it("a LinkQueueFailed after delete on a live account ends failed", async () => {
		const { userId, run, queue, stateOf } = await createHandler();
		const save = await queue(POST_URL);
		await run([queuedBody({ url: POST_URL, userId })]);
		await save.remove();
		await run([dequeuedBody({ url: POST_URL, userId })]);

		await run([failedBody({ url: POST_URL, userId })]);

		expect(await stateOf(POST_URL)).toBe("failed");
	});
});

describe("recordLinkQueuedHandler — finding the queue row the save wrote", () => {
	it("records saved when the queue row is only in a readlist partition", async () => {
		const { userId, run, queueInReadlist, stateOf } = await createHandler();
		await queueInReadlist(POST_URL);

		await run([queuedBody({ url: POST_URL, userId })]);

		expect(await stateOf(POST_URL)).toBe("saved");
	});

	it("records saved under the submitted key when the queue row sits under the alias target", async () => {
		const { articles, userId, run, queue, stateOf } = await createHandler();
		await articles.claimAlias({ aliasUrl: ORIGINAL, targetOriginalUrl: ALIAS_TARGET, now: NOW });
		await queue(ALIAS_TARGET);

		await run([queuedBody({ url: ORIGINAL, userId })]);

		expect(await stateOf(ORIGINAL)).toBe("saved");
	});

	it("records saved when a wrapper URL was unwrapped before the save", async () => {
		const { userId, run, queue, stateOf } = await createHandler();
		await queue(ORIGINAL);

		await run([queuedBody({ url: outboundTo(ORIGINAL), userId })]);

		expect(await stateOf(outboundTo(ORIGINAL))).toBe("saved");
	});

	it("records saved when the URL still has its own article row and the queue row sits under the unwrapped URL", async () => {
		const { articles, userId, run, queue, stateOf } = await createHandler();
		await articles.saveArticleGlobally({ ...wrapperRow(outboundTo(ORIGINAL)) });
		await queue(ORIGINAL);

		await run([queuedBody({ url: outboundTo(ORIGINAL), userId })]);

		expect(await stateOf(outboundTo(ORIGINAL))).toBe("saved");
	});

	it("records saved when a wrapper with its own article row unwraps to an alias, with the queue row under the alias target", async () => {
		const { articles, userId, run, queue, stateOf } = await createHandler();
		await articles.saveArticleGlobally({ ...wrapperRow(outboundTo(ORIGINAL)) });
		await articles.claimAlias({ aliasUrl: ORIGINAL, targetOriginalUrl: ALIAS_TARGET, now: NOW });
		await queue(ALIAS_TARGET);

		await run([queuedBody({ url: outboundTo(ORIGINAL), userId })]);

		expect(await stateOf(outboundTo(ORIGINAL))).toBe("saved");
	});

	it("records saved when a wrapper row's stored binding leads to the URL holding the queue row", async () => {
		const { articles, userId, run, queue, stateOf } = await createHandler();
		await articles.claimAlias({
			aliasUrl: TRACKER,
			targetOriginalUrl: ORIGINAL,
			sourceBinding: { contentSourceUrl: TRACKER, sourceOriginalUrl: ORIGINAL },
			now: NOW,
		});
		await queue(ORIGINAL);

		await run([queuedBody({ url: TRACKER, userId })]);

		expect(await stateOf(TRACKER)).toBe("saved");
	});

	it("records saved when a stored binding's URL is itself an alias, with the queue row under the alias target", async () => {
		const { articles, userId, run, queue, stateOf } = await createHandler();
		await articles.claimAlias({
			aliasUrl: TRACKER,
			targetOriginalUrl: ORIGINAL,
			sourceBinding: { contentSourceUrl: TRACKER, sourceOriginalUrl: ORIGINAL },
			now: NOW,
		});
		await articles.claimAlias({ aliasUrl: ORIGINAL, targetOriginalUrl: ALIAS_TARGET, now: NOW });
		await queue(ALIAS_TARGET);

		await run([queuedBody({ url: TRACKER, userId })]);

		expect(await stateOf(TRACKER)).toBe("saved");
	});

	it("records saved when a wrapper around a LinkedIn email link has its own article row and the queue row sits under the prepared post URL", async () => {
		const { articles, userId, run, queue, stateOf } = await createHandler();
		const wrapper = outboundTo("https://www.linkedin.com/comm/feed/update/urn:li:activity:7000000000000000001");
		await articles.saveArticleGlobally({ ...wrapperRow(wrapper) });
		await queue("https://www.linkedin.com/feed/update/urn:li:activity:7000000000000000001/");

		await run([queuedBody({ url: wrapper, userId })]);

		expect(await stateOf(wrapper)).toBe("saved");
	});

	it("replaying the save's derivation writes no alias row", async () => {
		const { articles, userId, run, queue } = await createHandler();
		await articles.claimAlias({ aliasUrl: ORIGINAL, targetOriginalUrl: ALIAS_TARGET, now: NOW });
		await queue(ALIAS_TARGET);

		await run([queuedBody({ url: outboundTo(ORIGINAL), userId })]);

		expect(await articles.findIdentityRow(outboundTo(ORIGINAL))).toEqual({ kind: "absent" });
	});

	it("a tracker with no stored binding whose save followed the network to another URL records no row", async () => {
		const { userId, run, queue, stateOf } = await createHandler();
		await queue(ORIGINAL);

		await run([queuedBody({ url: TRACKER, userId })]);

		expect(await stateOf(TRACKER)).toBeUndefined();
	});

	it("a transaction failure fails the record, and the next receive with the row gone consumes it with no row written", async () => {
		let removeQueueRow = async () => {};
		const { userId, run, queue, stateOf } = await createHandler({
			beforeTransaction: async () => removeQueueRow(),
		});
		const save = await queue(POST_URL);
		removeQueueRow = async () => {
			await save.remove();
		};

		const first = await run([queuedBody({ url: POST_URL, userId })]);
		const second = await run([queuedBody({ url: POST_URL, userId })]);

		expect(first).toEqual({ batchItemFailures: [{ itemIdentifier: "m-0" }] });
		expect(second).toEqual({ batchItemFailures: [] });
		expect(await stateOf(POST_URL)).toBeUndefined();
	});

	it("records saved when a wrapper's own key is over 1,024 bytes and it unwraps to the URL holding the queue row", async () => {
		const { userId, run, queue, stateOf } = await createHandler();
		const longWrapper = `https://archive.ph/o/${"a".repeat(1100)}/${ORIGINAL}`;
		await queue(ORIGINAL);

		await run([queuedBody({ url: longWrapper, userId })]);

		expect(await stateOf(longWrapper)).toBe("saved");
	});

	it("a LinkQueueFailed whose URL key is over 1,024 bytes ends failed", async () => {
		const { userId, run, stateOf } = await createHandler();
		const longUrl = `${POST_URL}/${"a".repeat(1100)}`;

		await run([failedBody({ url: longUrl, userId })]);

		expect(await stateOf(longUrl)).toBe("failed");
	});

	it("a LinkQueueFailed whose URL key is over 2,048 bytes ends failed", async () => {
		const { userId, run, stateOf } = await createHandler();
		const longUrl = `${POST_URL}/${"a".repeat(2100)}`;

		const result = await run([failedBody({ url: longUrl, userId })]);

		expect(result).toEqual({ batchItemFailures: [] });
		expect(await stateOf(longUrl)).toBe("failed");
	});

	it("recovers an oversized tracker's failed inbox state after its destination is saved and keeps it saved on a late failure fact", async () => {
		const { userId, run, queue, stateOf, articles } = await createHandler();
		const tracker = `https://link.mail.beehiiv.com/ss/c/u001.${"a".repeat(2800)}`;
		expect(await run([failedBody({ url: tracker, userId })])).toEqual({ batchItemFailures: [] });
		expect(await stateOf(tracker)).toBe("failed");
		await queue(ORIGINAL);
		await articles.claimAlias({
			aliasUrl: tracker,
			targetOriginalUrl: ORIGINAL,
			sourceBinding: { contentSourceUrl: tracker, sourceOriginalUrl: ORIGINAL },
			now: NOW,
		});

		expect(await run([queuedBody({ url: tracker, userId })])).toEqual({ batchItemFailures: [] });
		expect(await stateOf(tracker)).toBe("saved");
		expect(await run([failedBody({ url: tracker, userId })])).toEqual({ batchItemFailures: [] });
		expect(await stateOf(tracker)).toBe("saved");
	});

	it("records saved when the fact's URL has a fragment and tracking parameters the queue row's key does not", async () => {
		const { userId, run, queue, stateOf } = await createHandler();
		const factUrl = `${POST_URL}?utm_source=newsletter#comments`;
		await queue(POST_URL);

		await run([queuedBody({ url: factUrl, userId })]);

		expect(await stateOf(factUrl)).toBe("saved");
	});
});

describe("recordLinkQueuedHandler — a redriven or late deletion fact", () => {
	it("keeps the link saved when a late deletion fact arrives after the reader saved it again", async () => {
		const { store, userId, run, queue, stateOf } = await createHandler();
		await store.markLinkSaved({ userId, url: POST_URL });
		await queue(POST_URL);

		const result = await run([dequeuedBody({ url: POST_URL, userId })]);

		expect(result).toEqual({ batchItemFailures: [] });
		expect(await stateOf(POST_URL)).toBe("saved");
	});

	it("keeps the link saved when the same late deletion fact is redriven twice", async () => {
		const { store, userId, run, queue, stateOf } = await createHandler();
		await store.markLinkSaved({ userId, url: POST_URL });
		await queue(POST_URL);

		const first = await run([dequeuedBody({ url: POST_URL, userId })]);
		const second = await run([dequeuedBody({ url: POST_URL, userId })]);

		expect(first).toEqual({ batchItemFailures: [] });
		expect(second).toEqual({ batchItemFailures: [] });
		expect(await stateOf(POST_URL)).toBe("saved");
	});

	it("keeps the link saved while the reader still holds it in another readlist", async () => {
		const { store, articles, userId, run, queueInReadlist, stateOf } = await createHandler();
		await store.markLinkSaved({ userId, url: POST_URL });
		await articles.createReadlistDefinition({ userId, slug: WORK, label: "Work", createdAt: NOW });
		await queueInReadlist(POST_URL);

		await run([dequeuedBody({ url: POST_URL, userId })]);

		expect(await stateOf(POST_URL)).toBe("saved");
	});

	it("retracts when the queue no longer holds the link", async () => {
		const { store, userId, run, stateOf } = await createHandler();
		await store.markLinkSaved({ userId, url: POST_URL });

		const result = await run([dequeuedBody({ url: POST_URL, userId })]);

		expect(result).toEqual({ batchItemFailures: [] });
		expect(await stateOf(POST_URL)).toBeUndefined();
	});

	it("clears a failed row when the queue holds nothing", async () => {
		const { store, userId, run, stateOf } = await createHandler();
		await store.markLinkSaveFailed({ userId, url: POST_URL });

		await run([dequeuedBody({ url: POST_URL, userId })]);

		expect(await stateOf(POST_URL)).toBeUndefined();
	});

	it("leaves a failed row when the queue holds the link", async () => {
		const { store, userId, run, queue, stateOf } = await createHandler();
		await store.markLinkSaveFailed({ userId, url: POST_URL });
		await queue(POST_URL);

		await run([dequeuedBody({ url: POST_URL, userId })]);

		expect(await stateOf(POST_URL)).toBe("failed");
	});

	it("creates no row for an account already erased", async () => {
		const { store, run } = await createHandler();
		const erased = UserIdSchema.parse("erased-reader");

		const result = await run([dequeuedBody({ url: POST_URL, userId: erased })]);

		expect(result).toEqual({ batchItemFailures: [] });
		expect((await store.findSavedLinks({ userId: erased, urls: [POST_URL] })).size).toBe(0);
	});

	it("an old deletion redriven after a later re-save and a later delete retracts", async () => {
		const { store, userId, run, queue, stateOf } = await createHandler();
		await store.markLinkSaved({ userId, url: POST_URL });
		const save = await queue(POST_URL);
		await save.remove();

		await run([dequeuedBody({ url: POST_URL, userId })]);
		await run([dequeuedBody({ url: POST_URL, userId })]);

		expect(await stateOf(POST_URL)).toBeUndefined();
	});

	it("a later re-save survives an old deletion and a later retraction still works", async () => {
		const { store, userId, run, queue, stateOf } = await createHandler();
		await store.markLinkSaved({ userId, url: POST_URL });
		const save = await queue(POST_URL);

		await run([dequeuedBody({ url: POST_URL, userId })]);
		expect(await stateOf(POST_URL)).toBe("saved");
		await save.remove();
		await run([dequeuedBody({ url: POST_URL, userId })]);

		expect(await stateOf(POST_URL)).toBeUndefined();
	});

	it("fails the record and keeps the row when the queue read throws", async () => {
		const { store, userId, run, stateOf } = await createHandler({
			findQueueRowKeys: () => async () => {
				throw new Error("dynamo unavailable");
			},
		});
		await store.markLinkSaved({ userId, url: POST_URL });

		const result = await run([dequeuedBody({ url: POST_URL, userId })]);

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "m-0" }] });
		expect(await stateOf(POST_URL)).toBe("saved");
	});

	it("a re-stamped row, then the deletion, ends absent", async () => {
		const { store, userId, run, stateOf } = await createHandler();
		await store.markLinkSaved({ userId, url: POST_URL });
		await run([dequeuedBody({ url: POST_URL, userId })]);
		await store.markLinkSaved({ userId, url: POST_URL });

		await run([dequeuedBody({ url: POST_URL, userId })]);

		expect(await stateOf(POST_URL)).toBeUndefined();
	});

	it("keeps the link saved when the fact's URL normalises to the queue row", async () => {
		const { store, userId, run, queue, stateOf } = await createHandler();
		const factUrl = `${POST_URL}?utm_source=x`;
		await store.markLinkSaved({ userId, url: factUrl });
		await queue(POST_URL);

		await run([dequeuedBody({ url: factUrl, userId })]);

		expect(await stateOf(factUrl)).toBe("saved");
	});

	it("writes no row when a deletion fact arrives for a queued link that has no row yet", async () => {
		const { store, userId, run, queue } = await createHandler();
		await queue(POST_URL);

		const result = await run([dequeuedBody({ url: POST_URL, userId })]);

		expect(result).toEqual({ batchItemFailures: [] });
		expect((await store.findSavedLinks({ userId, urls: [POST_URL] })).size).toBe(0);
	});
});

describe("recordLinkQueuedHandler — log lines", () => {
	it("a save not recorded line names the url, userId and messageId", async () => {
		const { userId, lines, run } = await createHandler();

		await run([queuedBody({ url: POST_URL, userId })]);

		expect(lines).toEqual([
			{ message: "[record-link-queued] save not recorded: no-queue-row", details: { url: POST_URL, userId, messageId: "m-0" } },
		]);
	});

	it("a failure not recorded line names the url, userId and messageId", async () => {
		const { lines, run } = await createHandler();
		const closedReader = UserIdSchema.parse("closed-reader");

		await run([failedBody({ url: POST_URL, userId: closedReader })]);

		expect(lines).toEqual([
			{
				message: "[record-link-queued] failure not recorded: account-closed",
				details: { url: POST_URL, userId: closedReader, messageId: "m-0" },
			},
		]);
	});

	it("a skipped retraction logs the url, userId and messageId", async () => {
		const { store, userId, lines, run, queue, stateOf } = await createHandler();
		await store.markLinkSaved({ userId, url: POST_URL });
		await queue(POST_URL);

		await run([dequeuedBody({ url: POST_URL, userId })]);

		expect(await stateOf(POST_URL)).toBe("saved");
		expect(lines).toEqual([
			{
				message: "[record-link-queued] retraction skipped: link still in queue",
				details: { url: POST_URL, userId, messageId: "m-0" },
			},
		]);
	});

	it("a failure superseded line names the url, userId and messageId", async () => {
		const { userId, lines, run, queue } = await createHandler();
		await queue(POST_URL);

		await run([failedBody({ url: POST_URL, userId })]);

		expect(lines).toEqual([
			{ message: "[record-link-queued] failure superseded: link-queued", details: { url: POST_URL, userId, messageId: "m-0" } },
		]);
	});
});

function wrapperRow(url: string) {
	return {
		url,
		metadata: { title: "T", siteName: "archive.ph", excerpt: "", wordCount: 0 },
		estimatedReadTime: MinutesSchema.parse(0),
		savedAt: NOW,
	};
}

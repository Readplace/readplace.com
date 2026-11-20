import assert from "node:assert/strict";
import { SavedLinksJobIdSchema } from "@packages/domain/article";
import { UserIdSchema } from "@packages/domain/user";
import { type DynamoDBDocumentClient, TransactionCanceledException } from "@packages/storage-client";
import { initDynamoDbRemovedLinks } from "./dynamodb-removed-links";

type Item = Record<string, unknown>;
type Sent = { name: string; input: Item };
type Reply = (input: Item) => unknown;

const TABLE = "user-articles";
const ARTICLES = "articles";
const READER = UserIdSchema.parse("reader-1");
const HOLD = `${READER}#removed`;
const JOB = SavedLinksJobIdSchema.parse("2026-11-20T10:00:00.000Z-job");
const CUTOFF = new Date("2026-12-01T00:00:00.000Z");
const NOW = new Date("2026-12-02T00:00:00.000Z");
const STORED_KEY = "example.com/post";
const HELD_KEY = "readplace:removed/job/abc";

function createScriptedClient(script: Record<string, Reply[]>) {
	const sent: Sent[] = [];
	const send = async (command: { constructor: { name: string }; input: Item }) => {
		const name = command.constructor.name;
		sent.push({ name, input: command.input });
		const reply = script[name]?.shift();
		assert(reply, `no scripted reply left for ${name}`);
		return reply(command.input);
	};
	const removedLinks = initDynamoDbRemovedLinks({
		client: { send } as unknown as DynamoDBDocumentClient,
		userArticlesTableName: TABLE,
		articlesTableName: ARTICLES,
	});
	return { removedLinks, sent };
}

function emailLink(overrides: Item = {}): Item {
	return {
		userId: READER,
		url: STORED_KEY,
		status: "unread",
		savedAt: "2026-11-20T00:00:00.000Z",
		provenance: { kind: "email", senderEmail: "dan@tldr.tech" },
		title: "A post",
		...overrides,
	};
}

function heldRow(overrides: Item = {}): Item {
	return {
		...emailLink(),
		userId: HOLD,
		url: HELD_KEY,
		removedUrl: STORED_KEY,
		removedByJobId: JOB,
		removedAt: "2026-11-30T00:00:00.000Z",
		expiresAt: Math.floor(new Date("2026-12-30T00:00:00.000Z").getTime() / 1000),
		...overrides,
	};
}

const found = (item: Item | undefined): Reply => () => ({ Item: item });
const written: Reply = () => ({});
const cancelled =
	(...codes: string[]): Reply =>
	() => {
		throw new TransactionCanceledException({
			$metadata: {},
			message: "transaction cancelled",
			CancellationReasons: codes.map((Code) => ({ Code })),
		});
	};

const moveParams = { userId: READER, jobId: JOB, storedKey: STORED_KEY, cutoff: CUTOFF, senders: { kind: "all" as const }, now: NOW };

function transactItems(sent: Sent[]): Item[] {
	const transaction = sent.find((s) => s.name === "TransactWriteCommand");
	assert(transaction);
	return Object(transaction.input).TransactItems;
}

describe("moveNewsletterLinkToHold", () => {
	it("copies every attribute into the holding partition and deletes the All row under the selection's conditions", async () => {
		const { removedLinks, sent } = createScriptedClient({ GetCommand: [found(emailLink())], TransactWriteCommand: [written] });

		assert.deepEqual(await removedLinks.moveNewsletterLinkToHold(moveParams), { outcome: "held" });

		assert.equal(sent[0].input.ConsistentRead, true);
		const [put, remove] = transactItems(sent);
		const heldItem = Object(put).Put.Item;
		assert.equal(heldItem.userId, HOLD);
		assert.match(heldItem.url, /^readplace:removed\/2026-11-20T10:00:00.000Z-job\//);
		assert.equal(heldItem.title, "A post");
		assert.equal(heldItem.removedUrl, STORED_KEY);
		assert.equal(heldItem.removedByJobId, JOB);
		assert.equal(heldItem.removedAt, NOW.toISOString());
		assert.equal(heldItem.expiresAt, Math.floor(new Date("2027-01-01T00:00:00.000Z").getTime() / 1000));
		const deletion = Object(remove).Delete;
		assert.deepEqual(deletion.Key, { userId: READER, url: STORED_KEY });
		assert.match(deletion.ConditionExpression, /savedAt = :readSavedAt AND savedAt <= :cutoff AND #status = :unread/);
		assert.match(deletion.ConditionExpression, /attribute_not_exists\(lastSummaryOpenedAt\)/);
		assert.equal(deletion.ExpressionAttributeValues[":readSavedAt"], "2026-11-20T00:00:00.000Z");
		assert.equal(deletion.ExpressionAttributeValues[":cutoff"], CUTOFF.toISOString());
	});

	it("does not select an absent row or one from a sender the reader did not choose", async () => {
		const { removedLinks, sent } = createScriptedClient({ GetCommand: [found(undefined), found(emailLink())] });

		assert.deepEqual(await removedLinks.moveNewsletterLinkToHold(moveParams), { outcome: "not-selected" });
		const chosen = { ...moveParams, senders: { kind: "chosen" as const, senderEmails: ["other@news.com"] } };
		assert.deepEqual(await removedLinks.moveNewsletterLinkToHold(chosen), { outcome: "not-selected" });
		assert.equal(sent.length, 2);
	});

	it("skips an opened link and an unreadable row without writing", async () => {
		const { removedLinks, sent } = createScriptedClient({
			GetCommand: [found(emailLink({ lastSummaryOpenedAt: "2026-11-21T00:00:00.000Z" })), found(emailLink({ savedAt: 42 }))],
		});

		assert.deepEqual(await removedLinks.moveNewsletterLinkToHold(moveParams), { outcome: "skipped", reason: "opened" });
		assert.deepEqual(await removedLinks.moveNewsletterLinkToHold(moveParams), { outcome: "skipped", reason: "unreadable" });
		assert.equal(sent.length, 2);
	});

	it("holds a link restored before the cutoff and skips one restored since", async () => {
		const { removedLinks } = createScriptedClient({
			GetCommand: [
				found(emailLink({ restoredAt: "2026-11-25T00:00:00.000Z" })),
				found(emailLink({ restoredAt: CUTOFF.toISOString() })),
			],
			TransactWriteCommand: [written],
		});

		assert.deepEqual(await removedLinks.moveNewsletterLinkToHold(moveParams), { outcome: "held" });
		assert.deepEqual(await removedLinks.moveNewsletterLinkToHold(moveParams), { outcome: "skipped", reason: "changed" });
	});

	it("reports a row that changed between the read and the delete as changed", async () => {
		const { removedLinks } = createScriptedClient({
			GetCommand: [found(emailLink()), found(emailLink({ savedAt: "2026-11-21T00:00:00.000Z" }))],
			TransactWriteCommand: [cancelled("None", "ConditionalCheckFailed")],
		});

		assert.deepEqual(await removedLinks.moveNewsletterLinkToHold(moveParams), { outcome: "skipped", reason: "changed" });
	});

	it("reports what the re-read row now is when it no longer qualifies", async () => {
		const { removedLinks } = createScriptedClient({
			GetCommand: [found(emailLink()), found(emailLink({ status: "read" }))],
			TransactWriteCommand: [cancelled("None", "ConditionalCheckFailed")],
		});

		assert.deepEqual(await removedLinks.moveNewsletterLinkToHold(moveParams), { outcome: "skipped", reason: "read" });
	});

	it("retries a transaction conflict and holds once it goes through", async () => {
		const { removedLinks, sent } = createScriptedClient({
			GetCommand: [found(emailLink())],
			TransactWriteCommand: [cancelled("TransactionConflict", "None"), cancelled("None", "ThrottlingError"), written],
		});

		assert.deepEqual(await removedLinks.moveNewsletterLinkToHold(moveParams), { outcome: "held" });
		assert.equal(sent.filter((s) => s.name === "TransactWriteCommand").length, 3);
	});

	it("throws after five conflicted attempts", async () => {
		const conflict = cancelled("TransactionConflict", "None");
		const { removedLinks } = createScriptedClient({
			GetCommand: [found(emailLink())],
			TransactWriteCommand: [conflict, conflict, conflict, conflict, conflict],
		});

		await assert.rejects(removedLinks.moveNewsletterLinkToHold(moveParams), TransactionCanceledException);
	});

	it("throws a cancellation that is not retried, and any other failure", async () => {
		const { removedLinks } = createScriptedClient({
			GetCommand: [found(emailLink()), found(emailLink())],
			TransactWriteCommand: [
				cancelled("ValidationError", "None"),
				() => {
					throw new Error("network down");
				},
			],
		});

		await assert.rejects(removedLinks.moveNewsletterLinkToHold(moveParams), TransactionCanceledException);
		await assert.rejects(removedLinks.moveNewsletterLinkToHold(moveParams), /network down/);
	});
});

describe("restoreHeldLink", () => {
	const restoreParams = { userId: READER, heldKey: HELD_KEY, now: NOW };

	it("is gone when the held row no longer exists", async () => {
		const { removedLinks } = createScriptedClient({ GetCommand: [found(undefined)] });

		assert.deepEqual(await removedLinks.restoreHeldLink(restoreParams), { outcome: "gone" });
	});

	it("leaves a link held when its shared article is absent or purged", async () => {
		const { removedLinks, sent } = createScriptedClient({
			GetCommand: [found(heldRow()), found(undefined), found(heldRow()), found({ purgedAt: "2026-12-01T00:00:00.000Z" })],
		});

		assert.deepEqual(await removedLinks.restoreHeldLink(restoreParams), { outcome: "unrestorable" });
		assert.deepEqual(await removedLinks.restoreHeldLink(restoreParams), { outcome: "unrestorable" });
		assert.equal(sent[1].input.TableName, ARTICLES);
		assert.deepEqual(sent[1].input.Key, { url: STORED_KEY });
		assert.equal(sent.some((s) => s.name === "TransactWriteCommand"), false);
	});

	it("puts the row back into All without the hold fields and marks when it was restored", async () => {
		const { removedLinks, sent } = createScriptedClient({
			GetCommand: [found(heldRow()), found({})],
			TransactWriteCommand: [written],
		});

		assert.deepEqual(await removedLinks.restoreHeldLink(restoreParams), { outcome: "restored" });
		const [put, remove] = transactItems(sent);
		assert.deepEqual(Object(put).Put.Item, { ...emailLink(), restoredAt: NOW.toISOString() });
		assert.equal(Object(put).Put.ConditionExpression, "attribute_not_exists(#url)");
		assert.deepEqual(Object(remove).Delete.Key, { userId: HOLD, url: HELD_KEY });
	});

	it("is already in All when the reader saved the link again, and gone when another restore took it", async () => {
		const { removedLinks } = createScriptedClient({
			GetCommand: [found(heldRow()), found({}), found(heldRow()), found({})],
			TransactWriteCommand: [cancelled("ConditionalCheckFailed", "None"), cancelled("None", "ConditionalCheckFailed")],
		});

		assert.deepEqual(await removedLinks.restoreHeldLink(restoreParams), { outcome: "already-in-all" });
		assert.deepEqual(await removedLinks.restoreHeldLink(restoreParams), { outcome: "gone" });
	});
});

describe("reading held links", () => {
	const expired = heldRow({ url: "readplace:removed/old/abc", expiresAt: Math.floor(NOW.getTime() / 1000) });

	it("pages the holding partition and leaves out links past their expiry", async () => {
		const { removedLinks, sent } = createScriptedClient({ QueryCommand: [() => ({ Items: [heldRow(), expired] })] });
		const pages: unknown[] = [];

		await removedLinks.forEachHeldLinkPage({ userId: READER, now: NOW, onPage: async (links) => void pages.push(links) });

		assert.equal(sent[0].input.TableName, TABLE);
		assert.equal(sent[0].input.IndexName, undefined);
		assert.deepEqual(Object(sent[0].input.ExpressionAttributeValues)[":userId"], HOLD);
		assert.deepEqual(pages, [
			[
				{
					heldKey: HELD_KEY,
					storedKey: STORED_KEY,
					jobId: JOB,
					removedAt: new Date("2026-11-30T00:00:00.000Z"),
					expiresAt: new Date("2026-12-30T00:00:00.000Z"),
					senderEmail: "dan@tldr.tech",
				},
			],
		]);
	});

	it("has held links only when the newest one is still live", async () => {
		const { removedLinks, sent } = createScriptedClient({
			QueryCommand: [() => ({ Items: [heldRow()] }), () => ({ Items: [expired] }), () => ({ Items: [] })],
		});

		assert.equal(await removedLinks.hasHeldLinks({ userId: READER, now: NOW }), true);
		assert.equal(await removedLinks.hasHeldLinks({ userId: READER, now: NOW }), false);
		assert.equal(await removedLinks.hasHeldLinks({ userId: READER, now: NOW }), false);
		assert.equal(sent[0].input.ScanIndexForward, false);
		assert.equal(sent[0].input.Limit, 1);
	});

	it("finds the live held copy of a stored key", async () => {
		const { removedLinks, sent } = createScriptedClient({
			QueryCommand: [() => ({ Items: [expired, heldRow()] }), () => ({ Items: [expired] })],
		});

		const link = await removedLinks.findHeldLink({ userId: READER, storedKey: STORED_KEY, now: NOW });
		assert.equal(link?.heldKey, HELD_KEY);
		assert.equal(await removedLinks.findHeldLink({ userId: READER, storedKey: STORED_KEY, now: NOW }), undefined);
		assert.equal(sent[0].input.FilterExpression, "#removedUrl = :storedKey");
		assert.equal(Object(sent[0].input.ExpressionAttributeNames)["#removedUrl"], "removedUrl");
		assert.equal(Object(sent[0].input.ExpressionAttributeValues)[":storedKey"], STORED_KEY);
	});
});

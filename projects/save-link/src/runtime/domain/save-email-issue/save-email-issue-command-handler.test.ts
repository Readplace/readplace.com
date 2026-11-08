import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import { ReadlistSlugSchema } from "@packages/domain/readlist";
import { EmailIssueSaveSkippedEvent, EmailOutputSavedToAllEvent, TierContentExtractedEvent } from "@packages/infra-components";
import type { Logger } from "@packages/logger";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import { buildSqsEvent } from "@packages/test-fixtures/sqs";
import type { PutTierSource } from "@packages/tier-source";
import type { EmailIssueFiling, SaveEmailIssue } from "./save-email-issue";
import { initSaveEmailIssueCommandHandler } from "./save-email-issue-command-handler";

const READER = "00000000000000000000000000000001";
const RECEIVED_AT_MESSAGE_ID = "2026-06-24T09:00:00.000Z#<m@x>";
const ISSUE_URL = "email://inbox/00000000000000000000000000000001/2026-06-24T09%3A00%3A00.000Z%23%3Cm%40x%3E";
const INBOX_PAGE = "https://readplace.com/inbox/2026-06-24T09%3A00%3A00.000Z%23%3Cm%40x%3E";
const BODY = "<table><tr><td><h1>Employee #1</h1><p>Yahoo's first employee looks back.</p></td></tr></table>";
const NOW = new Date("2026-06-24T09:05:00.000Z");
const TIME = "2026-11-03T10:00:00Z";
const EMAIL_OUTPUT = { receivedAtMessageId: RECEIVED_AT_MESSAGE_ID, outputKey: "issue" };

const SAVE_ATTEMPT_ID = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b";

const COMMAND = {
	userId: READER,
	saveAttemptId: SAVE_ATTEMPT_ID,
	receivedAtMessageId: RECEIVED_AT_MESSAGE_ID,
	subject: "Employee #1: Yahoo",
	senderEmail: "dan@tldr.tech",
	senderName: "TLDR",
	issueUrl: INBOX_PAGE,
	readlists: ["work"],
};

function makeHarness(opts: {
	body?: string;
	contentPending?: boolean;
	kind?: "saved" | "removed-by-reader" | "write-access-lapsed";
	filings?: EmailIssueFiling[];
	readEmailBodyFails?: boolean;
	recordInboxArticleQueued?: () => Promise<void>;
}) {
	const reads: string[] = [];
	const saves: Omit<Parameters<SaveEmailIssue>[0], "onSavedToAll" | "requestedAt">[] = [];
	const requests: Date[] = [];
	const tierSources: Parameters<PutTierSource>[0][] = [];
	const published: { detailType: string; detail: unknown }[] = [];
	const onboarding: string[] = [];
	const logged: { level: string; message: string; context: unknown }[] = [];
	const log = (level: string) => (message: unknown, context?: unknown) => {
		logged.push({ level, message: String(message), context });
	};
	const logger: Logger = { info: log("info"), warn: log("warn"), error: log("error"), debug: log("debug") };
	const handler = initSaveEmailIssueCommandHandler({
		readEmailBody: async (id: ArticleResourceUniqueId) => {
			reads.push(id.value);
			if (opts.readEmailBodyFails) throw new Error("S3 throttled");
			return "body" in opts ? opts.body : BODY;
		},
		saveEmailIssue: async ({ onSavedToAll, requestedAt, ...params }) => {
			saves.push(params);
			requests.push(requestedAt);
			const kind = opts.kind ?? "saved";
			const contentPending = opts.contentPending ?? true;
			if (kind === "write-access-lapsed") return { kind };
			await onSavedToAll();
			if (kind === "removed-by-reader") return { kind, contentPending };
			return { kind, contentPending, filings: opts.filings ?? [] };
		},
		putTierSource: async (params) => {
			tierSources.push(params);
			return params.metadata;
		},
		recordInboxArticleQueued:
			opts.recordInboxArticleQueued ??
			(async ({ userId }) => {
				onboarding.push(userId);
			}),
		publishEvent: async (event, detail) => {
			published.push({ detailType: event.detailType, detail });
		},
		now: () => NOW,
		logger,
	});
	const runBody = (body: unknown) =>
		handler(buildSqsEvent([{ messageId: "rec-1", body: JSON.stringify(body) }]), buildLambdaContext(), () => {});
	const run = (detail: unknown) => runBody({ detail, time: TIME });
	return { reads, saves, requests, tierSources, published, onboarding, logged, run, runBody };
}

describe("initSaveEmailIssueCommandHandler", () => {
	it("confirms an email output in All as soon as the issue is saved, before handing its body to content selection", async () => {
		const harness = makeHarness({});

		await harness.run({ ...COMMAND, emailOutput: EMAIL_OUTPUT });

		assert.deepEqual(
			harness.published.map(({ detailType }) => detailType),
			[EmailOutputSavedToAllEvent.detailType, TierContentExtractedEvent.detailType],
		);
		assert.deepEqual(harness.published[0]?.detail, { userId: READER, receivedAtMessageId: RECEIVED_AT_MESSAGE_ID, outputKey: "issue" });
	});

	it("confirms nothing for an issue saved without an email output", async () => {
		const harness = makeHarness({ contentPending: false });

		await harness.run(COMMAND);

		assert.deepEqual(harness.published, []);
	});

	it("saves the issue from the email's stored body into All and its readlists", async () => {
		const harness = makeHarness({});

		const result = await harness.run(COMMAND);

		assert.deepEqual(result, { batchItemFailures: [] });
		assert.deepEqual(harness.saves, [
			{
				userId: READER,
				url: ISSUE_URL,
				displayUrl: INBOX_PAGE,
				metadata: {
					title: "Employee #1: Yahoo",
					siteName: "TLDR",
					excerpt: "Employee #1 Yahoo's first employee looks back.",
					wordCount: 7,
					publishedOn: "2026-06-24",
				},
				estimatedReadTime: 1,
				provenance: { kind: "email", senderEmail: "dan@tldr.tech" },
				readlists: ["work"],
			},
		]);
		assert.deepEqual(harness.onboarding, [READER]);
	});

	it("hands the stored body to content selection as the issue's own tier-0 source", async () => {
		const harness = makeHarness({});

		await harness.run(COMMAND);

		const candidateId = harness.tierSources[0]?.metadata.id;
		assert.deepEqual(harness.tierSources, [
			{
				url: ISSUE_URL,
				tier: "tier-0",
				html: BODY,
				metadata: {
					title: "Employee #1: Yahoo",
					siteName: "TLDR",
					excerpt: "Employee #1 Yahoo's first employee looks back.",
					wordCount: 7,
					estimatedReadTime: 1,
					publishedOn: "2026-06-24",
					id: candidateId,
					attemptId: SAVE_ATTEMPT_ID,
					contentHash: createHash("sha256").update(BODY).digest("hex"),
					originalUrl: INBOX_PAGE,
					sourceUrl: ISSUE_URL,
					kind: "extension",
					fetchedAt: NOW.toISOString(),
					httpStatus: undefined,
					captureTrigger: undefined,
				},
			},
		]);
		assert.deepEqual(harness.published, [
			{
				detailType: TierContentExtractedEvent.detailType,
				detail: {
					url: ISSUE_URL,
					userId: READER,
					saveAttemptId: SAVE_ATTEMPT_ID,
					candidates: [{ id: candidateId, tier: "tier-0" }],
					extractedAt: NOW.toISOString(),
				},
			},
		]);
	});

	it("stages no content again for an issue whose content is already ready", async () => {
		const harness = makeHarness({ contentPending: false });

		await harness.run(COMMAND);

		assert.deepEqual([harness.tierSources, harness.published], [[], []]);
	});

	it("finishes the record without confirming the email output when the email's body is gone", async () => {
		const harness = makeHarness({ body: undefined });

		const result = await harness.run({ ...COMMAND, emailOutput: EMAIL_OUTPUT });

		assert.deepEqual(result, { batchItemFailures: [] });
		assert.deepEqual(harness.reads, [ArticleResourceUniqueId.parse(ISSUE_URL).value]);
		assert.deepEqual(harness.saves, []);
		assert.deepEqual(harness.onboarding, []);
		assert.deepEqual(harness.published, [
			{
				detailType: EmailIssueSaveSkippedEvent.detailType,
				detail: { userId: READER, receivedAtMessageId: RECEIVED_AT_MESSAGE_ID, reason: "body-gone" },
			},
		]);
		assert.deepEqual(
			harness.logged.filter(({ level }) => level === "warn").map(({ context }) => context),
			[{ receivedAtMessageId: RECEIVED_AT_MESSAGE_ID }],
		);
	});

	it("retries when the stored body cannot be read for another reason", async () => {
		const harness = makeHarness({ readEmailBodyFails: true });

		const result = await harness.run(COMMAND);

		assert.deepEqual(result, { batchItemFailures: [{ itemIdentifier: "rec-1" }] });
		assert.deepEqual(harness.saves, []);
	});

	it("passes the envelope time to the save as the request time", async () => {
		const harness = makeHarness({});

		await harness.run(COMMAND);

		assert.deepEqual(harness.requests, [new Date(TIME)]);
	});

	it("fails a record whose body carries no envelope time", async () => {
		const harness = makeHarness({});

		const result = await harness.runBody({ detail: COMMAND });

		assert.deepEqual(result, { batchItemFailures: [{ itemIdentifier: "rec-1" }] });
		assert.deepEqual(harness.saves, []);
	});

	it("logs each filing the save refused, naming the readlist and no URL", async () => {
		const slug = (value: string) => ReadlistSlugSchema.parse(value);
		const harness = makeHarness({
			filings: [
				{ readlist: slug("one"), outcome: "filed" },
				{ readlist: slug("two"), outcome: "already-filed" },
				{ readlist: slug("three"), outcome: "newer-row-won" },
				{ readlist: slug("four"), outcome: "removed-after-request" },
				{ readlist: slug("five"), outcome: "readlist-gone" },
				{ readlist: slug("six"), outcome: "not-in-all" },
			],
		});

		const result = await harness.run(COMMAND);

		assert.deepEqual(result, { batchItemFailures: [] });
		const skipped = harness.logged.filter(({ message }) => message === "[save-email-issue] filing skipped");
		assert.deepEqual(
			skipped.map(({ level, context }) => ({ level, context })),
			[
				["four", "removed-after-request"],
				["five", "readlist-gone"],
				["six", "not-in-all"],
			].map(([readlist, reason]) => ({
				level: "info",
				context: { userId: READER, readlist, receivedAtMessageId: RECEIVED_AT_MESSAGE_ID, messageId: "rec-1", reason },
			})),
		);
	});

	it("records a skipped save and still confirms the email output and stages content when the reader removed the issue", async () => {
		const harness = makeHarness({ kind: "removed-by-reader" });

		await harness.run({ ...COMMAND, emailOutput: EMAIL_OUTPUT });

		assert.deepEqual(
			harness.published.map(({ detailType }) => detailType),
			[EmailOutputSavedToAllEvent.detailType, TierContentExtractedEvent.detailType, EmailIssueSaveSkippedEvent.detailType],
		);
		assert.deepEqual(harness.published[2]?.detail, {
			userId: READER,
			receivedAtMessageId: RECEIVED_AT_MESSAGE_ID,
			reason: "removed-by-reader",
		});
	});

	it("records a skipped save with no content staged when a removed issue's content is ready", async () => {
		const harness = makeHarness({ kind: "removed-by-reader", contentPending: false });

		await harness.run(COMMAND);

		assert.deepEqual(harness.tierSources, []);
		assert.deepEqual(harness.published.map(({ detailType }) => detailType), [EmailIssueSaveSkippedEvent.detailType]);
	});

	it("records a refused save and confirms nothing when the reader's write access has lapsed", async () => {
		const harness = makeHarness({ kind: "write-access-lapsed" });

		const result = await harness.run({ ...COMMAND, emailOutput: EMAIL_OUTPUT });

		assert.deepEqual(result, { batchItemFailures: [] });
		assert.deepEqual(harness.tierSources, []);
		assert.deepEqual(harness.onboarding, []);
		assert.deepEqual(harness.published, [
			{
				detailType: EmailIssueSaveSkippedEvent.detailType,
				detail: { userId: READER, receivedAtMessageId: RECEIVED_AT_MESSAGE_ID, reason: "write-access-lapsed" },
			},
		]);
		assert.deepEqual(
			harness.logged.filter(({ message }) => message === "[save-email-issue] save refused"),
			[
				{
					level: "warn",
					message: "[save-email-issue] save refused",
					context: {
						userId: READER,
						receivedAtMessageId: RECEIVED_AT_MESSAGE_ID,
						messageId: "rec-1",
						reason: "write-access-lapsed",
					},
				},
			],
		);
	});

	it("keeps the save when the onboarding stamp fails", async () => {
		const harness = makeHarness({
			recordInboxArticleQueued: async () => {
				throw new Error("onboarding table unavailable");
			},
		});

		const result = await harness.run(COMMAND);

		assert.deepEqual(result, { batchItemFailures: [] });
		assert.deepEqual(
			harness.logged.filter(({ level }) => level === "warn").map(({ message }) => message),
			["[SaveEmailIssueCommand] inbox onboarding stamp failed — continuing"],
		);
	});
});

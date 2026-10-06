import assert from "node:assert/strict";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import { TierContentExtractedEvent } from "@packages/hutch-infra-components";
import type { HutchLogger } from "@packages/hutch-logger";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import { buildSqsEvent } from "@packages/test-fixtures/sqs";
import type { PutTierSource } from "../../providers/article-store/put-tier-source";
import type { SaveEmailIssue } from "./save-email-issue";
import { initSaveEmailIssueCommandHandler } from "./save-email-issue-command-handler";

const READER = "00000000000000000000000000000001";
const RECEIVED_AT_MESSAGE_ID = "2026-06-24T09:00:00.000Z#<m@x>";
const ISSUE_URL = "email://inbox/00000000000000000000000000000001/2026-06-24T09%3A00%3A00.000Z%23%3Cm%40x%3E";
const INBOX_PAGE = "https://readplace.com/inbox/2026-06-24T09%3A00%3A00.000Z%23%3Cm%40x%3E";
const BODY = "<table><tr><td><h1>Employee #1</h1><p>Yahoo's first employee looks back.</p></td></tr></table>";
const NOW = new Date("2026-06-24T09:05:00.000Z");

const COMMAND = {
	userId: READER,
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
	recordInboxArticleQueued?: () => Promise<void>;
}) {
	const reads: string[] = [];
	const saves: Parameters<SaveEmailIssue>[0][] = [];
	const tierSources: Parameters<PutTierSource>[0][] = [];
	const published: { detailType: string; detail: unknown }[] = [];
	const onboarding: string[] = [];
	const logged: { level: string; message: string }[] = [];
	const log = (level: string) => (message: unknown) => {
		logged.push({ level, message: String(message) });
	};
	const logger: HutchLogger = { info: log("info"), warn: log("warn"), error: log("error"), debug: log("debug") };
	const handler = initSaveEmailIssueCommandHandler({
		readEmailBody: async (id: ArticleResourceUniqueId) => {
			reads.push(id.value);
			return "body" in opts ? opts.body : BODY;
		},
		saveEmailIssue: async (params) => {
			saves.push(params);
			return { contentPending: opts.contentPending ?? true };
		},
		putTierSource: async (params) => {
			tierSources.push(params);
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
	const run = (detail: unknown) =>
		handler(buildSqsEvent([{ messageId: "rec-1", body: JSON.stringify({ detail }) }]), buildLambdaContext(), () => {});
	return { reads, saves, tierSources, published, onboarding, logged, run };
}

describe("initSaveEmailIssueCommandHandler", () => {
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
				},
			},
		]);
		assert.deepEqual(harness.published, [
			{
				detailType: TierContentExtractedEvent.detailType,
				detail: { url: ISSUE_URL, tier: "tier-0", userId: READER, extractedAt: NOW.toISOString() },
			},
		]);
	});

	it("stages no content again for an issue whose content is already ready", async () => {
		const harness = makeHarness({ contentPending: false });

		await harness.run(COMMAND);

		assert.deepEqual([harness.tierSources, harness.published], [[], []]);
	});

	it("retries an issue whose stored body cannot be read yet", async () => {
		const harness = makeHarness({ body: undefined });

		const result = await harness.run(COMMAND);

		assert.deepEqual(result, { batchItemFailures: [{ itemIdentifier: "rec-1" }] });
		assert.deepEqual(harness.reads, [ArticleResourceUniqueId.parse(ISSUE_URL).value]);
		assert.deepEqual(harness.saves, []);
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

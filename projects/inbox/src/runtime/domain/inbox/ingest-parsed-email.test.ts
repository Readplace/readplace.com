import assert from "node:assert/strict";
import {
	InboxAddressSchema,
	MessageIdSchema,
	type ParsedEmail,
} from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";
import { EmailReceivedEvent } from "@packages/hutch-infra-components";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import { HutchLogger, noopLogger } from "@packages/hutch-logger";
import { initInMemoryInboxEmail } from "@packages/test-fixtures/providers/inbox-email";
import { initIngestParsedEmail } from "./ingest-parsed-email";
import type { StoreEmailBody } from "./store-email-body";

const READER = UserIdSchema.parse("00000000000000000000000000000001");
const READLIST_ADDRESS = InboxAddressSchema.parse("gmail-abc123@read.place");
const RECEIVED_AT = "2026-09-20T07:30:00.000Z";
const ROW_ID = `${RECEIVED_AT}#<issue-42@tldr.tech>`;

const tldrIssue: ParsedEmail = {
	from: "dan@tldr.tech",
	fromName: "TLDR",
	subject: "TLDR 2026-09-20",
	text: "",
	html: "<p>https://example.com/story</p>",
	messageId: MessageIdSchema.parse("<issue-42@tldr.tech>"),
	receivedAt: RECEIVED_AT,
	inlineImages: [],
	listUnsubscribeUrls: [],
	googleAddressConfirmation: undefined,
};

function makeIngest(storeBody: StoreEmailBody) {
	const emails = initInMemoryInboxEmail();
	const published: { event: unknown; detail: unknown }[] = [];
	const ingest = initIngestParsedEmail({
		storeBody,
		putEmail: emails.putEmail,
		getEmail: emails.getEmail,
		publishEvent: (async (event, detail) => {
			published.push({ event, detail });
		}) as PublishEvent,
		logger: HutchLogger.from(noopLogger),
	});
	const ingestIssue = () =>
		ingest({
			userId: READER,
			destination: READLIST_ADDRESS,
			email: tldrIssue,
			receivedAt: RECEIVED_AT,
			rawEmailS3Key: "gmail-import/reader/job/18c2f0a1b2c3d4e5.eml",
			receivedAtMessageId: ROW_ID,
			downloadedImages: [],
			origin: "gmail-import",
			routing: { kind: "inbox" },
		});
	return { emails, published, ingestIssue, ingest };
}

describe("initIngestParsedEmail", () => {
	it("stores the body and a received row at the destination, then announces it with its origin", async () => {
		const { emails, published, ingestIssue } = makeIngest(
			async () => "content/issue-42/content.html",
		);

		const outcome = await ingestIssue();

		assert.equal(outcome, "stored");
		assert.deepEqual(
			await emails.getEmail({ userId: READER, receivedAtMessageId: ROW_ID }),
			{
				userId: READER,
				receivedAtMessageId: ROW_ID,
				messageId: tldrIssue.messageId,
				recipientAddress: READLIST_ADDRESS,
				senderEmail: "dan@tldr.tech",
				subject: "TLDR 2026-09-20",
				status: "received",
				receivedAt: RECEIVED_AT,
				rawEmailS3Key: "gmail-import/reader/job/18c2f0a1b2c3d4e5.eml",
				bodyS3Key: "content/issue-42/content.html",
				linkCounts: undefined,
			},
		);
		assert.deepEqual(published, [
			{
				event: EmailReceivedEvent,
				detail: {
					userId: READER,
					receivedAtMessageId: ROW_ID,
					recipientAddress: READLIST_ADDRESS,
					origin: "gmail-import",
					routing: { kind: "inbox" },
				},
			},
		]);
	});

	it("republishes the announcement when a retry finds the row already written", async () => {
		const { published, ingestIssue } = makeIngest(
			async () => "content/issue-42/content.html",
		);

		await ingestIssue();
		const outcome = await ingestIssue();

		assert.equal(outcome, "duplicate");
		assert.equal(published.length, 2);
		assert.deepEqual(published[1], published[0]);
	});

	it("keeps a body that sanitizes to nothing as an unparsed row and announces nothing", async () => {
		const { emails, published, ingestIssue } = makeIngest(
			async () => undefined,
		);

		const outcome = await ingestIssue();

		assert.equal(outcome, "unparsed");
		const row = await emails.getEmail({
			userId: READER,
			receivedAtMessageId: ROW_ID,
		});
		assert.equal(row?.status, "unparsed");
		assert.equal(row?.bodyS3Key, undefined);
		assert.deepEqual(published, []);
	});
});

it("reuses the first accepted Gmail destination and delivery snapshot after a mapping changes", async () => {
	const { published, ingest } = makeIngest(
		async () => "content/issue-42/content.html",
	);
	const original = [
		READLIST_ADDRESS,
		InboxAddressSchema.parse("science-def456@read.place"),
	];
	const deliver = (secondary: string, deliveryMode: "links" | "issue") =>
		ingest({
			userId: READER,
			destination: READLIST_ADDRESS,
			email: tldrIssue,
			receivedAt: RECEIVED_AT,
			rawEmailS3Key: "gmail-import/raw",
			receivedAtMessageId: ROW_ID,
			downloadedImages: [],
			origin: "gmail-import",
			routing: {
				kind: "gmail",
				destinationAddresses: [READLIST_ADDRESS, secondary],
				deliveryMode,
			},
		});
	await deliver(original[1], "issue");
	await deliver("other-112233@read.place", "links");
	assert.deepEqual(
		published.map(({ detail }) => detail),
		[
			{
				userId: READER,
				receivedAtMessageId: ROW_ID,
				recipientAddress: READLIST_ADDRESS,
				origin: "gmail-import",
				routing: { kind: "gmail", destinationAddresses: original, deliveryMode: "issue" },
			},
			{
				userId: READER,
				receivedAtMessageId: ROW_ID,
				recipientAddress: READLIST_ADDRESS,
				origin: "gmail-import",
				routing: { kind: "gmail", destinationAddresses: original, deliveryMode: "issue" },
			},
		],
	);
});

import assert from "node:assert/strict";
import { HutchLogger, noopLogger } from "@packages/hutch-logger";
import {
	DEFAULT_INBOX_ALIAS,
	type InboxEmailStore,
	MessageIdSchema,
	type ParseEmailResult,
} from "@packages/domain/inbox";
import { type UserId, UserIdSchema } from "@packages/domain/user";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import { initInMemoryInboxAddress } from "@packages/test-fixtures/providers/inbox-address";
import { initInMemoryInboxEmail } from "@packages/test-fixtures/providers/inbox-email";
import { buildSqsEvent } from "@packages/test-fixtures/sqs";
import { initReceiveEmailHandler } from "./receive-email-handler";
import type { StoreEmailBody } from "./store-email-body";

const OWNER = UserIdSchema.parse("00000000000000000000000000000001");
const SECOND = UserIdSchema.parse("00000000000000000000000000000002");
const UNROUTED = UserIdSchema.parse("__unrouted__");
const RECEIVED_AT = "2026-06-24T09:00:00.000Z";
const RAW_KEY = "inbound/ses-msg-1";

function sesNotification(recipients: string[]): string {
	return JSON.stringify({
		mail: { messageId: "ses-msg-1" },
		receipt: {
			timestamp: RECEIVED_AT,
			recipients,
			action: { objectKey: RAW_KEY },
		},
	});
}

function parsedOk(): ParseEmailResult {
	return {
		ok: true,
		email: {
			from: "news@example.com",
			subject: "Digest",
			text: "text",
			html: "<p>hi</p>",
			messageId: MessageIdSchema.parse("<real@x>"),
			receivedAt: RECEIVED_AT,
			inlineImages: [],
			listUnsubscribeUrls: [],
		},
	};
}

function makeHarness(opts?: {
	parseEmail?: () => Promise<ParseEmailResult>;
	storeBody?: StoreEmailBody;
	maxEmailBytes?: number;
}) {
	const addressStore = initInMemoryInboxAddress({ now: () => new Date() });
	const emailStore = initInMemoryInboxEmail();
	const rawMap = new Map<string, Buffer>();
	const published: { detail: { receivedAtMessageId: string; userId: string } }[] = [];
	const imageDownloadCalls: { html: string }[] = [];

	const handler = initReceiveEmailHandler({
		readRawEmail: async (key) => rawMap.get(key),
		findByAddress: addressStore.findByAddress,
		putEmail: emailStore.putEmail,
		parseEmail: opts?.parseEmail ?? (async () => parsedOk()),
		downloadEmailImages: async ({ html }) => {
			imageDownloadCalls.push({ html });
			return [];
		},
		storeBody: opts?.storeBody ?? (async () => "content/email/content.html"),
		publishEvent: async (_event, detail) => {
			published.push({ detail: detail as { receivedAtMessageId: string; userId: string } });
		},
		logger: HutchLogger.from(noopLogger),
		maxEmailBytes: opts?.maxEmailBytes ?? 20 * 1024 * 1024,
	});

	const runMany = (recipients: string[]) =>
		handler(
			buildSqsEvent([{ messageId: "rec-1", body: sesNotification(recipients) }]),
			buildLambdaContext(),
			() => {},
		);
	const run = (recipient: string) => runMany([recipient]);

	return { addressStore, emailStore, rawMap, published, imageDownloadCalls, handler, run, runMany };
}

async function listEmails(emailStore: InboxEmailStore, userId: UserId) {
	const { emails } = await emailStore.listEmailsByUserId({ userId, page: 1, pageSize: 100 });
	return emails;
}

async function mintAddress(addressStore: ReturnType<typeof initInMemoryInboxAddress>) {
	const entry = await addressStore.createAddress({
		userId: OWNER,
		domain: "read.place",
		name: DEFAULT_INBOX_ALIAS,
	});
	return entry.address;
}

describe("initReceiveEmailHandler", () => {
	it("fails the record for a structurally invalid SES notification, writing no row", async () => {
		const { emailStore, published, handler } = makeHarness();

		const result = await handler(
			buildSqsEvent([{ messageId: "rec-1", body: JSON.stringify({ wrong: "shape" }) }]),
			buildLambdaContext(),
			() => {},
		);

		assert(result);
		expect(result.batchItemFailures).toHaveLength(1);
		expect(await listEmails(emailStore, OWNER)).toHaveLength(0);
		expect(published).toHaveLength(0);
	});

	it("retries (no row) when the raw .eml is not yet readable", async () => {
		const { addressStore, emailStore, published, run } = makeHarness();
		const address = await mintAddress(addressStore);

		const result = await run(address);

		assert(result);
		expect(result.batchItemFailures).toHaveLength(1);
		expect(await listEmails(emailStore, OWNER)).toHaveLength(0);
		expect(published).toHaveLength(0);
	});

	it("ACKs a non-forwarding recipient (raw kept, no row, no operator page)", async () => {
		const { emailStore, rawMap, published, run } = makeHarness();
		rawMap.set(RAW_KEY, Buffer.from("raw"));

		const result = await run("postmaster@read.place");

		assert(result);
		// Expected on a public catch-all MX — ACK rather than page the operator.
		expect(result.batchItemFailures).toHaveLength(0);
		expect(await listEmails(emailStore, OWNER)).toHaveLength(0);
		expect(published).toHaveLength(0);
	});

	it("rejects an oversize email with an audit row under the owner and a DLQ failure", async () => {
		const { addressStore, emailStore, rawMap, published, run } = makeHarness({ maxEmailBytes: 8 });
		const address = await mintAddress(addressStore);
		rawMap.set(RAW_KEY, Buffer.from("this is definitely longer than eight bytes"));

		const result = await run(address);

		assert(result);
		expect(result.batchItemFailures).toHaveLength(1);
		const [row] = await listEmails(emailStore, OWNER);
		expect(row.status).toBe("rejected");
		expect(row.bodyS3Key).toBeUndefined();
		expect(published).toHaveLength(0);
	});

	it("ACKs an oversize email addressed only to unknown recipients (no page)", async () => {
		const { emailStore, rawMap, published, run } = makeHarness({ maxEmailBytes: 8 });
		rawMap.set(RAW_KEY, Buffer.from("this is definitely longer than eight bytes"));

		const result = await run("in-zzzzzz@read.place");

		assert(result);
		// Oversize spam to a guessed address on the public MX has no victim — audit
		// under the unrouted partition and ACK rather than page the operator.
		expect(result.batchItemFailures).toHaveLength(0);
		const [row] = await listEmails(emailStore, UNROUTED);
		expect(row.status).toBe("rejected");
		expect(published).toHaveLength(0);
	});

	it("records an unknown recipient under the unrouted partition and ACKs (no page)", async () => {
		const { emailStore, rawMap, published, imageDownloadCalls, run } = makeHarness();
		rawMap.set(RAW_KEY, Buffer.from("raw"));

		const result = await run("in-zzzzzz@read.place");

		assert(result);
		// A guessed/mistyped address is expected on a public MX — audit, don't page.
		expect(result.batchItemFailures).toHaveLength(0);
		expect(await listEmails(emailStore, OWNER)).toHaveLength(0);
		const [row] = await listEmails(emailStore, UNROUTED);
		expect(row.status).toBe("rejected");
		expect(published).toHaveLength(0);
		// Spam to a guessed address must not get to trigger outbound image fetches.
		expect(imageDownloadCalls).toHaveLength(0);
	});

	it("records a disabled recipient under the unrouted partition and ACKs (no page)", async () => {
		const { addressStore, emailStore, rawMap, published, run } = makeHarness();
		const address = await mintAddress(addressStore);
		await addressStore.disableAddress({ userId: OWNER, address });
		rawMap.set(RAW_KEY, Buffer.from("raw"));

		const result = await run(address);

		assert(result);
		// Mail to a turned-off address recurs while senders still have it — audit,
		// don't page. The owner opted out, so the row lands under the unrouted
		// partition rather than cluttering their list with "Rejected" rows.
		expect(result.batchItemFailures).toHaveLength(0);
		expect(await listEmails(emailStore, OWNER)).toHaveLength(0);
		const [row] = await listEmails(emailStore, UNROUTED);
		expect(row.status).toBe("rejected");
		expect(row.recipientAddress).toBe(address);
		expect(published).toHaveLength(0);
	});

	it("records an unparseable email as status=unparsed and fails to the DLQ", async () => {
		const { addressStore, emailStore, rawMap, published, run } = makeHarness({
			parseEmail: async () => ({ ok: false, reason: "unparseable" }),
		});
		const address = await mintAddress(addressStore);
		rawMap.set(RAW_KEY, Buffer.from("raw"));

		const result = await run(address);

		assert(result);
		expect(result.batchItemFailures).toHaveLength(1);
		const [row] = await listEmails(emailStore, OWNER);
		expect(row.status).toBe("unparsed");
		expect(row.bodyS3Key).toBeUndefined();
		expect(published).toHaveLength(0);
	});

	it("ACKs an unparseable email addressed only to unknown recipients (no page)", async () => {
		const { emailStore, rawMap, published, run } = makeHarness({
			parseEmail: async () => ({ ok: false, reason: "unparseable" }),
		});
		rawMap.set(RAW_KEY, Buffer.from("raw"));

		const result = await run("in-zzzzzz@read.place");

		assert(result);
		// Malformed spam to a guessed address is not a parser gap worth paging on —
		// audit under the unrouted partition and ACK.
		expect(result.batchItemFailures).toHaveLength(0);
		const [row] = await listEmails(emailStore, UNROUTED);
		expect(row.status).toBe("unparsed");
		expect(published).toHaveLength(0);
	});

	it("stores a received email with a body pointer and publishes EmailReceived once", async () => {
		const { addressStore, emailStore, rawMap, published, run } = makeHarness({
			storeBody: async () => "content/email/content.html",
		});
		const address = await mintAddress(addressStore);
		rawMap.set(RAW_KEY, Buffer.from("raw"));

		const result = await run(address);

		assert(result);
		expect(result.batchItemFailures).toHaveLength(0);
		const [row] = await listEmails(emailStore, OWNER);
		expect(row.status).toBe("received");
		expect(row.bodyS3Key).toBe("content/email/content.html");
		expect(row.senderEmail).toBe("news@example.com");
		expect(published).toHaveLength(1);
		expect(published[0].detail.receivedAtMessageId).toBe(`${RECEIVED_AT}#<real@x>`);
		expect(published[0].detail.userId).toBe(OWNER);
	});

	it("matches a recipient case-insensitively when an MTA upper-cases the local part", async () => {
		const { addressStore, emailStore, rawMap, published, run } = makeHarness();
		const address = await mintAddress(addressStore);
		rawMap.set(RAW_KEY, Buffer.from("raw"));

		// Minted addresses are lowercase and the lookup is exact; an MTA that
		// preserves a differently-cased local part must still reach the owner.
		const result = await run(address.toUpperCase());

		assert(result);
		expect(result.batchItemFailures).toHaveLength(0);
		const [row] = await listEmails(emailStore, OWNER);
		expect(row.status).toBe("received");
		expect(published).toHaveLength(1);
	});

	it("persists 'unparsed' (no body, no event) and ACKs when the body sanitizes to nothing", async () => {
		const { addressStore, emailStore, rawMap, published, run } = makeHarness({
			// An all-<style>/<script> newsletter parses fine but the sanitizer strips it
			// to "" — storeBody writes no zero-byte object and reports no body.
			storeBody: async () => undefined,
		});
		const address = await mintAddress(addressStore);
		rawMap.set(RAW_KEY, Buffer.from("raw"));

		const result = await run(address);

		assert(result);
		// The sanitizer did its job (nothing renderable survived) — not a fault, so
		// ACK rather than page; the immutable raw .eml stays the record.
		expect(result.batchItemFailures).toHaveLength(0);
		const [row] = await listEmails(emailStore, OWNER);
		// `unparsed` (not `received`) so the list shows the "Couldn't render" badge and
		// the detail page shows the unavailable panel, never a blank iframe.
		expect(row.status).toBe("unparsed");
		expect(row.bodyS3Key).toBeUndefined();
		// Parsed subject/sender are still recorded; only the body is absent.
		expect(row.subject).toBe("Digest");
		expect(row.senderEmail).toBe("news@example.com");
		// No renderable body and nothing for M3 to extract — publish nothing.
		expect(published).toHaveLength(0);
	});

	it("stores a row and publishes for EVERY forwarding recipient in one envelope", async () => {
		const { addressStore, emailStore, rawMap, published, imageDownloadCalls, runMany } =
			makeHarness();
		const ownerAddress = await mintAddress(addressStore);
		const second = await addressStore.createAddress({
			userId: SECOND,
			domain: "read.place",
			name: DEFAULT_INBOX_ALIAS,
		});
		rawMap.set(RAW_KEY, Buffer.from("raw"));

		const result = await runMany([ownerAddress, second.address]);

		assert(result);
		expect(result.batchItemFailures).toHaveLength(0);
		// Both addressees get their own row under their own partition — neither is
		// silently dropped, and each gets its own delivered event.
		const [ownerRow] = await listEmails(emailStore, OWNER);
		const [secondRow] = await listEmails(emailStore, SECOND);
		expect(ownerRow.status).toBe("received");
		expect(secondRow.status).toBe("received");
		expect(published).toHaveLength(2);
		// The HTML is identical for every co-addressed recipient, so remote images
		// download ONCE per message — per-recipient fetches would multiply the
		// sender-visible requests and the wall time against the Lambda timeout.
		expect(imageDownloadCalls).toHaveLength(1);
	});

	it("collapses an envelope addressed to two of the SAME user's addresses to one row", async () => {
		const { addressStore, emailStore, rawMap, published, runMany } = makeHarness();
		const first = await mintAddress(addressStore);
		const { address: secondOfSameUser } = await addressStore.createAddress({
			userId: OWNER,
			domain: "read.place",
			name: DEFAULT_INBOX_ALIAS,
		});
		rawMap.set(RAW_KEY, Buffer.from("raw"));

		const result = await runMany([first, secondOfSameUser]);

		assert(result);
		expect(result.batchItemFailures).toHaveLength(0);
		// One physical email = one row: the sort key is the (recipient-independent)
		// message id, so the second address's put is a no-op duplicate under the same
		// partition. The event is re-published, which the consumer absorbs idempotently.
		expect(await listEmails(emailStore, OWNER)).toHaveLength(1);
		expect(published).toHaveLength(2);
	});

	it("delivers the known recipient and audits the unknown one, ACKing the batch", async () => {
		const { addressStore, emailStore, rawMap, published, runMany } = makeHarness();
		const ownerAddress = await mintAddress(addressStore);
		rawMap.set(RAW_KEY, Buffer.from("raw"));

		const result = await runMany([ownerAddress, "in-zzzzzz@read.place"]);

		assert(result);
		expect(result.batchItemFailures).toHaveLength(0);
		const [ownerRow] = await listEmails(emailStore, OWNER);
		expect(ownerRow.status).toBe("received");
		const [unrouted] = await listEmails(emailStore, UNROUTED);
		expect(unrouted.status).toBe("rejected");
		// Only the deliverable recipient produces an event.
		expect(published).toHaveLength(1);
	});

	it("collapses an at-least-once redelivery to one row, re-publishing the event", async () => {
		const { addressStore, emailStore, rawMap, published, run } = makeHarness();
		const address = await mintAddress(addressStore);
		rawMap.set(RAW_KEY, Buffer.from("raw"));

		await run(address);
		const second = await run(address);

		assert(second);
		expect(second.batchItemFailures).toHaveLength(0);
		expect(await listEmails(emailStore, OWNER)).toHaveLength(1);
		expect(published).toHaveLength(2);
	});

	it("fails the record to the DLQ when an unexpected error is thrown mid-processing", async () => {
		const { addressStore, rawMap, run } = makeHarness({
			storeBody: async () => {
				throw new Error("S3 down");
			},
		});
		const address = await mintAddress(addressStore);
		rawMap.set(RAW_KEY, Buffer.from("raw"));

		const result = await run(address);

		assert(result);
		expect(result.batchItemFailures).toHaveLength(1);
	});
});

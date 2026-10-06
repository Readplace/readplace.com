import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import { initResumeAcceptedGmailEmail } from "./resume-accepted-gmail-email";
import assert from "node:assert/strict";
import {
	ForwardableSenderSchema,
	GmailAccountEmailSchema,
	GmailHistoryImportJobIdSchema,
	GmailMessageIdSchema,
} from "@packages/domain/gmail";
import {
	AliasNameSchema,
	DEFAULT_INBOX_ALIAS,
	GMAIL_FORWARDING_ALIAS,
	InboxAddressSchema,
	type InboxEmailStore,
	type IngestionAttempt,
	MessageIdSchema,
	messageIdentityKey,
	NormalizedMessageIdSchema,
	type ParseEmailResult,
} from "@packages/domain/inbox";
import { ReadlistSlugSchema } from "@packages/domain/readlist";
import { type UserId, UserIdSchema } from "@packages/domain/user";
import { HutchLogger, noopLogger } from "@packages/hutch-logger";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import { initInMemoryEmailIdentity } from "@packages/test-fixtures/providers/email-identity";
import { initInMemoryInboxAddress } from "@packages/test-fixtures/providers/inbox-address";
import { initInMemoryInboxEmail } from "@packages/test-fixtures/providers/inbox-email";
import { buildSqsEvent } from "@packages/test-fixtures/sqs";
import type { RouteGmailForwardedEmail } from "../gmail/route-gmail-forwarded-email";
import { initIngestParsedEmail } from "./ingest-parsed-email";
import type { InterceptGmailConfirmation } from "./intercept-gmail-confirmation";
import { initReceiveEmailHandler } from "./receive-email-handler";
import { initResolveEmailIdentity } from "./resolve-email-identity";
import type { StoreEmailBody } from "./store-email-body";

const OWNER = UserIdSchema.parse("00000000000000000000000000000001");
const SECOND = UserIdSchema.parse("00000000000000000000000000000002");
const UNROUTED = UserIdSchema.parse("__unrouted__");
const RECEIVED_AT = "2026-06-24T09:00:00.000Z";
const RAW_KEY = "inbound/ses-msg-1";
const IMPORTED_AT = "2026-06-20T08:00:00.000Z";
const IMPORTED_ROW = `${IMPORTED_AT}#<real@x>`;
const MESSAGE_KEY = messageIdentityKey({
	userId: OWNER,
	sender: ForwardableSenderSchema.parse("news@example.com"),
	messageId: NormalizedMessageIdSchema.parse("real@x"),
});
const IMPORT_ATTEMPT: IngestionAttempt = {
	origin: "gmail-import",
	jobId: GmailHistoryImportJobIdSchema.parse(
		"0123456789abcdef0123456789abcdef",
	),
	accountEmail: GmailAccountEmailSchema.parse("reader@gmail.com"),
	gmailMessageId: GmailMessageIdSchema.parse("18c2f0a1b2c3d4e5"),
};

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
			fromName: "Example News",
			subject: "Digest",
			text: "text",
			html: "<p>hi</p>",
			messageId: MessageIdSchema.parse("<real@x>"),
			receivedAt: RECEIVED_AT,
			inlineImages: [],
			listUnsubscribeUrls: [],
			googleAddressConfirmation: undefined,
		},
	};
}

function makeHarness(opts?: {
	parseEmail?: () => Promise<ParseEmailResult>;
	storeBody?: StoreEmailBody;
	maxEmailBytes?: number;
	interceptGmailConfirmation?: InterceptGmailConfirmation;
	routeGmailForwardedEmail?: RouteGmailForwardedEmail;
	publishErrorOnce?: boolean;
}) {
	let publishError = opts?.publishErrorOnce === true;
	const addressStore = initInMemoryInboxAddress({ now: () => new Date() });
	const emailStore = initInMemoryInboxEmail();
	const identities = initInMemoryEmailIdentity();
	const rawMap = new Map<string, Buffer>();
	const published: {
		detail: {
			receivedAtMessageId: string;
			userId: string;
			recipientAddress: string;
		};
	}[] = [];
	const imageDownloadCalls: { html: string }[] = [];
	const interceptions: { recipientCount: number }[] = [];
	const routings: { recipientAddress: string; purpose: string }[] = [];

	const publishEvent: PublishEvent = async (_event, detail) => {
				if (publishError) { publishError = false; throw new Error("EventBridge unavailable"); }
				published.push({
					detail: detail as {
						receivedAtMessageId: string;
						userId: string;
						recipientAddress: string;
					},
				});
			};
	const handler = initReceiveEmailHandler({
		resumeAcceptedGmailEmail: initResumeAcceptedGmailEmail({ getEmail: emailStore.getEmail, publishEvent }),
		readRawEmail: async (key) => rawMap.get(key),
		findByAddress: addressStore.findByAddress,
		putEmail: emailStore.putEmail,
		parseEmail: opts?.parseEmail ?? (async () => parsedOk()),
		downloadEmailImages: async ({ html }) => {
			imageDownloadCalls.push({ html });
			return [];
		},
		resolveIdentity: initResolveEmailIdentity({
			identities,
			findReceivedByMessageId: emailStore.findReceivedByMessageId,
			getEmail: emailStore.getEmail,
			now: () => new Date(RECEIVED_AT),
		}),
		ingest: initIngestParsedEmail({
			storeBody: opts?.storeBody ?? (async () => "content/email/content.html"),
			putEmail: emailStore.putEmail,
			getEmail: emailStore.getEmail,
			publishEvent,
			logger: HutchLogger.from(noopLogger),
		}),
		interceptGmailConfirmation:
			opts?.interceptGmailConfirmation ??
			(async ({ resolvedRecipients }) => {
				interceptions.push({ recipientCount: resolvedRecipients.length });
				return false;
			}),
		routeGmailForwardedEmail:
			opts?.routeGmailForwardedEmail ??
			(async ({ recipientAddress, purpose }) => {
				routings.push({ recipientAddress, purpose });
				return { destinationAddresses: [recipientAddress], deliveryMode: "links" };
			}),
		logger: HutchLogger.from(noopLogger),
		maxEmailBytes: opts?.maxEmailBytes ?? 20 * 1024 * 1024,
	});

	const runMany = (recipients: string[]) =>
		handler(
			buildSqsEvent([
				{ messageId: "rec-1", body: sesNotification(recipients) },
			]),
			buildLambdaContext(),
			() => {},
		);
	const run = (recipient: string) => runMany([recipient]);

	return {
		addressStore,
		emailStore,
		identities,
		rawMap,
		published,
		imageDownloadCalls,
		interceptions,
		routings,
		handler,
		run,
		runMany,
	};
}

async function listEmails(emailStore: InboxEmailStore, userId: UserId) {
	const { emails } = await emailStore.listEmailsByUserId({
		userId,
		cursor: undefined,
		pageSize: 100,
	});
	return emails;
}

async function mintAddress(
	addressStore: ReturnType<typeof initInMemoryInboxAddress>,
) {
	const entry = await addressStore.createAddress({
		userId: OWNER,
		domain: "read.place",
		name: DEFAULT_INBOX_ALIAS,
		purpose: "user-alias",
	});
	return entry.address;
}

async function mintGatewayAddress(
	addressStore: ReturnType<typeof initInMemoryInboxAddress>,
) {
	const entry = await addressStore.createAddress({
		userId: OWNER,
		domain: "read.place",
		name: GMAIL_FORWARDING_ALIAS,
		purpose: "gmail-forwarding",
	});
	return entry.address;
}

describe("initReceiveEmailHandler", () => {
	it("fails the record for a structurally invalid SES notification, writing no row", async () => {
		const { emailStore, published, handler } = makeHarness();

		const result = await handler(
			buildSqsEvent([
				{ messageId: "rec-1", body: JSON.stringify({ wrong: "shape" }) },
			]),
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
		const { addressStore, emailStore, rawMap, published, run } = makeHarness({
			maxEmailBytes: 8,
		});
		const address = await mintAddress(addressStore);
		rawMap.set(
			RAW_KEY,
			Buffer.from("this is definitely longer than eight bytes"),
		);

		const result = await run(address);

		assert(result);
		expect(result.batchItemFailures).toHaveLength(1);
		const [row] = await listEmails(emailStore, OWNER);
		expect(row.status).toBe("rejected");
		expect(row.bodyS3Key).toBeUndefined();
		expect(published).toHaveLength(0);
	});

	it("ACKs an oversize email addressed only to unknown recipients (no page)", async () => {
		const { emailStore, rawMap, published, run } = makeHarness({
			maxEmailBytes: 8,
		});
		rawMap.set(
			RAW_KEY,
			Buffer.from("this is definitely longer than eight bytes"),
		);

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
		const { emailStore, rawMap, published, imageDownloadCalls, run } =
			makeHarness();
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

	it("delivers again to an address that was disabled and then re-enabled", async () => {
		const { addressStore, emailStore, rawMap, published, run } = makeHarness();
		const address = await mintAddress(addressStore);
		await addressStore.disableAddress({ userId: OWNER, address });
		await addressStore.enableAddress({ userId: OWNER, address });
		rawMap.set(RAW_KEY, Buffer.from("raw"));

		const result = await run(address);

		assert(result);
		expect(result.batchItemFailures).toHaveLength(0);
		const [row] = await listEmails(emailStore, OWNER);
		expect(row.status).toBe("received");
		expect(published).toHaveLength(1);
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
		expect(published[0].detail.receivedAtMessageId).toBe(
			`${RECEIVED_AT}#<real@x>`,
		);
		expect(published[0].detail.userId).toBe(OWNER);
	});

	it("hands a Gmail forwarding confirmation to its worker, writing no row and publishing nothing", async () => {
		const {
			addressStore,
			emailStore,
			rawMap,
			published,
			imageDownloadCalls,
			run,
		} = makeHarness({
			interceptGmailConfirmation: async () => true,
		});
		const address = await mintAddress(addressStore);
		rawMap.set(RAW_KEY, Buffer.from("raw"));

		const result = await run(address);

		assert(result);
		expect(result.batchItemFailures).toHaveLength(0);
		expect(await listEmails(emailStore, OWNER)).toHaveLength(0);
		expect(published).toHaveLength(0);
		expect(imageDownloadCalls).toHaveLength(0);
	});

	it("offers every parsed message to the interceptor and lets a declined one flow on unchanged", async () => {
		const { addressStore, rawMap, interceptions, published, run } =
			makeHarness();
		const address = await mintAddress(addressStore);
		rawMap.set(RAW_KEY, Buffer.from("raw"));

		await run(address);

		expect(interceptions).toEqual([{ recipientCount: 1 }]);
		expect(published).toHaveLength(1);
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
		const {
			addressStore,
			emailStore,
			rawMap,
			published,
			imageDownloadCalls,
			runMany,
		} = makeHarness();
		const ownerAddress = await mintAddress(addressStore);
		const second = await addressStore.createAddress({
			userId: SECOND,
			domain: "read.place",
			name: DEFAULT_INBOX_ALIAS,
			purpose: "user-alias",
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
		const { addressStore, emailStore, rawMap, published, runMany } =
			makeHarness();
		const first = await mintAddress(addressStore);
		const { address: secondOfSameUser } = await addressStore.createAddress({
			userId: OWNER,
			domain: "read.place",
			name: DEFAULT_INBOX_ALIAS,
			purpose: "user-alias",
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
		const { addressStore, emailStore, rawMap, published, runMany } =
			makeHarness();
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

	it("delivers gateway mail to the alias the sender is mapped to", async () => {
		let mappedAddress = InboxAddressSchema.parse("tldr-b8c3d0@read.place");
		const { addressStore, emailStore, rawMap, published, routings, run } =
			makeHarness({
				routeGmailForwardedEmail: async () => ({ destinationAddresses: [mappedAddress], deliveryMode: "links" }),
			});
		const gateway = await mintGatewayAddress(addressStore);
		const mapped = await addressStore.createAddress({
			userId: OWNER,
			domain: "read.place",
			name: AliasNameSchema.parse("tldr"),
			purpose: "gmail-mapped",
		});
		mappedAddress = mapped.address;
		rawMap.set(RAW_KEY, Buffer.from("raw"));

		await run(gateway);

		const emails = await listEmails(emailStore, OWNER);
		expect(emails).toHaveLength(1);
		assert.equal(emails[0].recipientAddress, mapped.address);
		assert.equal(published[0].detail.recipientAddress, mapped.address);
		assert.deepEqual(routings, []);
	});

	it("accepts gateway mail with what the reader chose its sender to save", async () => {
		let mappedAddress = InboxAddressSchema.parse("tldr-b8c3d0@read.place");
		const { addressStore, emailStore, rawMap, published, run } = makeHarness({
			routeGmailForwardedEmail: async () => ({ destinationAddresses: [mappedAddress], deliveryMode: "issue" }),
		});
		const gateway = await mintGatewayAddress(addressStore);
		const mapped = await addressStore.createAddress({
			userId: OWNER,
			domain: "read.place",
			name: AliasNameSchema.parse("tldr"),
			purpose: "gmail-mapped",
		});
		mappedAddress = mapped.address;
		rawMap.set(RAW_KEY, Buffer.from("raw"));

		await run(gateway);

		const [email] = await listEmails(emailStore, OWNER);
		assert.equal(email.gmailDeliveryMode, "issue");
		assert.deepEqual(
			published.map(({ detail }) => detail),
			[
				{
					userId: OWNER,
					receivedAtMessageId: `${RECEIVED_AT}#<real@x>`,
					recipientAddress: mapped.address,
					origin: "receive",
					routing: { kind: "gmail", destinationAddresses: [mapped.address], deliveryMode: "issue" },
				},
			],
		);
	});

	it("rejects gateway mail mapped to a disabled inbox and resumes delivery when it is enabled", async () => {
		let mappedAddress = InboxAddressSchema.parse("tldr-b8c3d0@read.place");
		const { addressStore, emailStore, rawMap, published, run } = makeHarness({
			routeGmailForwardedEmail: async () => ({ destinationAddresses: [mappedAddress], deliveryMode: "links" }),
		});
		const gateway = await mintGatewayAddress(addressStore);
		const mapped = await addressStore.createAddress({
			userId: OWNER,
			domain: "read.place",
			name: AliasNameSchema.parse("tldr"),
			purpose: "gmail-mapped",
		});
		mappedAddress = mapped.address;
		await addressStore.disableAddress({
			userId: OWNER,
			address: mapped.address,
		});
		rawMap.set(RAW_KEY, Buffer.from("raw"));

		const result = await run(gateway);

		assert(result);
		expect(result.batchItemFailures).toHaveLength(0);
		const [rejected] = await listEmails(emailStore, UNROUTED);
		expect(rejected.status).toBe("rejected");
		expect(rejected.recipientAddress).toBe(mapped.address);
		expect(await listEmails(emailStore, OWNER)).toHaveLength(0);
		expect(published).toHaveLength(0);

		await addressStore.enableAddress({
			userId: OWNER,
			address: mapped.address,
		});
		await run(gateway);
		const [received] = await listEmails(emailStore, OWNER);
		expect(received.status).toBe("received");
		expect(received.recipientAddress).toBe(mapped.address);
		expect(published).toHaveLength(1);
	});

	it("audits gateway mail whose mapped inbox no longer resolves", async () => {
		const mappedAddress = InboxAddressSchema.parse("tldr-b8c3d0@read.place");
		const { addressStore, emailStore, rawMap, run } = makeHarness({
			routeGmailForwardedEmail: async () => ({ destinationAddresses: [mappedAddress], deliveryMode: "links" }),
		});
		const gateway = await mintGatewayAddress(addressStore);
		rawMap.set(RAW_KEY, Buffer.from("raw"));

		const result = await run(gateway);

		assert(result);
		expect(result.batchItemFailures).toHaveLength(0);
		const [rejected] = await listEmails(emailStore, UNROUTED);
		expect(rejected.status).toBe("rejected");
		expect(rejected.recipientAddress).toBe(mappedAddress);
	});

	it("stores nothing and publishes nothing while a gateway sender is unmapped", async () => {
		const { addressStore, emailStore, rawMap, published, run } = makeHarness({
			routeGmailForwardedEmail: async () => undefined,
		});
		const gateway = await mintGatewayAddress(addressStore);
		rawMap.set(RAW_KEY, Buffer.from("raw"));

		const result = await run(gateway);

		assert(result);
		expect(result.batchItemFailures).toHaveLength(0);
		expect(await listEmails(emailStore, OWNER)).toHaveLength(0);
		expect(published).toHaveLength(0);
	});

	it("never routes mail addressed to an ordinary alias by sender", async () => {
		const { addressStore, rawMap, routings, run } = makeHarness();
		const alias = await mintAddress(addressStore);
		rawMap.set(RAW_KEY, Buffer.from("raw"));

		await run(alias);

		assert.deepEqual(routings, []);
	});

	it("routes mail delivered straight to a named inbox so the sighting is recorded", async () => {
		const { addressStore, emailStore, rawMap, published, routings, run } =
			makeHarness();
		const inbox = await addressStore.createAddress({
			userId: OWNER,
			domain: "read.place",
			name: AliasNameSchema.parse("tech"),
			purpose: "gmail-mapped",
		});
		rawMap.set(RAW_KEY, Buffer.from("raw"));

		await run(inbox.address);

		assert.deepEqual(routings, [
			{ recipientAddress: inbox.address, purpose: "gmail-mapped" },
		]);
		const [row] = await listEmails(emailStore, OWNER);
		expect(row.status).toBe("received");
		expect(published).toHaveLength(1);
	});

	it("drops a forwarded copy of a message the reader already imported: no row, no event, no image fetch", async () => {
		const {
			addressStore,
			emailStore,
			identities,
			rawMap,
			published,
			imageDownloadCalls,
			run,
		} = makeHarness();
		const address = await mintAddress(addressStore);
		await emailStore.putEmail({
			userId: OWNER,
			receivedAtMessageId: IMPORTED_ROW,
			messageId: MessageIdSchema.parse("<real@x>"),
			recipientAddress: address,
			senderEmail: "news@example.com",
			subject: "Digest",
			status: "received",
			receivedAt: IMPORTED_AT,
			rawEmailS3Key: "gmail-import/owner/job/18c2f0a1b2c3d4e5.eml",
			bodyS3Key: "content/imported/content.html",
			linkCounts: undefined,
		});
		await identities.claim({
			key: MESSAGE_KEY,
			userId: OWNER,
			receivedAtMessageId: IMPORTED_ROW,
			attempt: IMPORT_ATTEMPT,
			now: new Date(IMPORTED_AT),
		});
		rawMap.set(RAW_KEY, Buffer.from("raw"));

		const result = await run(address);

		assert(result);
		assert.deepEqual(result.batchItemFailures, []);
		assert.deepEqual(
			(await listEmails(emailStore, OWNER)).map(
				(row) => row.receivedAtMessageId,
			),
			[IMPORTED_ROW],
		);
		assert.deepEqual(published, []);
		assert.deepEqual(imageDownloadCalls, []);
	});

	it("adopts a row stored before identity claims existed instead of storing the copy again", async () => {
		const { addressStore, emailStore, identities, rawMap, published, run } =
			makeHarness();
		const address = await mintAddress(addressStore);
		await emailStore.putEmail({
			userId: OWNER,
			receivedAtMessageId: "2026-06-01T00:00:00.000Z#<real@x>",
			messageId: MessageIdSchema.parse("<real@x>"),
			recipientAddress: address,
			senderEmail: "News@Example.com",
			subject: "Digest",
			status: "received",
			receivedAt: "2026-06-01T00:00:00.000Z",
			rawEmailS3Key: "inbound/earlier",
			bodyS3Key: "content/earlier/content.html",
			linkCounts: undefined,
		});
		rawMap.set(RAW_KEY, Buffer.from("raw"));

		await run(address);

		assert.equal((await listEmails(emailStore, OWNER)).length, 1);
		assert.deepEqual(published, []);
		assert.deepEqual(await identities.find(MESSAGE_KEY), {
			key: MESSAGE_KEY,
			userId: OWNER,
			receivedAtMessageId: "2026-06-01T00:00:00.000Z#<real@x>",
			attempt: { origin: "pre-claim-row" },
			claimedAt: RECEIVED_AT,
		});
	});

	it("takes over an import's claim that never wrote its row, storing under the claimed row id", async () => {
		const { addressStore, emailStore, identities, rawMap, published, run } =
			makeHarness();
		const address = await mintAddress(addressStore);
		await identities.claim({
			key: MESSAGE_KEY,
			userId: OWNER,
			receivedAtMessageId: IMPORTED_ROW,
			attempt: IMPORT_ATTEMPT,
			now: new Date(IMPORTED_AT),
		});
		rawMap.set(RAW_KEY, Buffer.from("raw"));

		await run(address);

		assert.deepEqual(
			(await listEmails(emailStore, OWNER)).map(
				(row) => row.receivedAtMessageId,
			),
			[IMPORTED_ROW],
		);
		assert.deepEqual(
			published.map((entry) => entry.detail.receivedAtMessageId),
			[IMPORTED_ROW],
		);
		assert.deepEqual((await identities.find(MESSAGE_KEY))?.attempt, {
			origin: "receive",
			sesMessageId: "ses-msg-1",
		});
	});

	it("delivers a message without a Message-ID without claiming an identity for it", async () => {
		const { addressStore, emailStore, identities, rawMap, published, run } =
			makeHarness({
				parseEmail: async () => {
					const parsed = parsedOk();
					assert(parsed.ok);
					return {
						ok: true,
						email: {
							...parsed.email,
							messageId: MessageIdSchema.parse(`sha256:${"a".repeat(64)}`),
						},
					};
				},
			});
		const address = await mintAddress(addressStore);
		rawMap.set(RAW_KEY, Buffer.from("raw"));

		await run(address);

		const [row] = await listEmails(emailStore, OWNER);
		assert.equal(
			row.receivedAtMessageId,
			`${RECEIVED_AT}#sha256:${"a".repeat(64)}`,
		);
		assert.equal(published.length, 1);
		assert.equal(await identities.find(MESSAGE_KEY), undefined);
	});

	it("delivers mail sent straight to a readlist address as addressed, without sender routing", async () => {
		const { addressStore, emailStore, rawMap, published, routings, run } =
			makeHarness();
		const readlistAddress = await addressStore.getOrCreateReadlistAddress({
			userId: OWNER,
			domain: "read.place",
			readlist: ReadlistSlugSchema.parse("a1b2c3d4"),
		});
		rawMap.set(RAW_KEY, Buffer.from("raw"));

		await run(readlistAddress.address);

		assert.deepEqual(routings, []);
		const [row] = await listEmails(emailStore, OWNER);
		assert.equal(row.status, "received");
		assert.equal(row.recipientAddress, readlistAddress.address);
		assert.deepEqual(
			published.map((entry) => entry.detail.recipientAddress),
			[readlistAddress.address],
		);
	});
});


for (const change of ["removed", "retired"] as const) {
	it(`finishes an accepted Gmail retry after its mapping was ${change}`, async () => {
		let destinations: Awaited<ReturnType<RouteGmailForwardedEmail>>;
		const { addressStore, emailStore, rawMap, published, run } = makeHarness({ publishErrorOnce: true, routeGmailForwardedEmail: async () => destinations });
		const gateway = await mintGatewayAddress(addressStore);
		const readlist = ReadlistSlugSchema.parse("work");
		const address = (await addressStore.getOrCreateReadlistAddress({ userId: OWNER, domain: "read.place", readlist })).address;
		destinations = { destinationAddresses: [address], deliveryMode: "links" };
		rawMap.set(RAW_KEY, Buffer.from("raw"));
		expect((await run(gateway))?.batchItemFailures).toEqual([{ itemIdentifier: "rec-1" }]);
		if (change === "removed") destinations = undefined;
		else await addressStore.retireReadlistAddress({ userId: OWNER, readlist });
		expect((await run(gateway))?.batchItemFailures).toEqual([]);
		expect(published.map(({ detail }) => detail)).toEqual([{ userId: OWNER, receivedAtMessageId: `${RECEIVED_AT}#<real@x>`, recipientAddress: address, origin: "receive", routing: { kind: "gmail", destinationAddresses: [address], deliveryMode: "links" } }]);
		expect(await listEmails(emailStore, OWNER)).toHaveLength(1);
	});
}

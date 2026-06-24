import assert from "node:assert/strict";
import { HutchLogger, noopLogger } from "@packages/hutch-logger";
import { MessageIdSchema, type ParseEmailResult } from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import { initInMemoryInboxAddress } from "@packages/test-fixtures/providers/inbox-address";
import { initInMemoryInboxEmail } from "@packages/test-fixtures/providers/inbox-email";
import { buildSqsEvent } from "@packages/test-fixtures/sqs";
import { initReceiveEmailHandler } from "./receive-email-handler";
import type { StoreEmailBody } from "./store-email-body";

const OWNER = UserIdSchema.parse("00000000000000000000000000000001");
const UNROUTED = UserIdSchema.parse("__unrouted__");
const RECEIVED_AT = "2026-06-24T09:00:00.000Z";
const RAW_KEY = "inbound/ses-msg-1";

function sesNotification(recipient: string): string {
	return JSON.stringify({
		mail: { messageId: "ses-msg-1" },
		receipt: {
			timestamp: RECEIVED_AT,
			recipients: [recipient],
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

	const handler = initReceiveEmailHandler({
		readRawEmail: async (key) => rawMap.get(key),
		findByAddress: addressStore.findByAddress,
		putEmail: emailStore.putEmail,
		parseEmail: opts?.parseEmail ?? (async () => parsedOk()),
		storeBody: opts?.storeBody ?? (async () => "content/email/content.html"),
		publishEvent: async (_event, detail) => {
			published.push({ detail: detail as { receivedAtMessageId: string; userId: string } });
		},
		logger: HutchLogger.from(noopLogger),
		maxEmailBytes: opts?.maxEmailBytes ?? 20 * 1024 * 1024,
	});

	const run = (recipient: string) =>
		handler(
			buildSqsEvent([{ messageId: "rec-1", body: sesNotification(recipient) }]),
			buildLambdaContext(),
			() => {},
		);

	return { addressStore, emailStore, rawMap, published, handler, run };
}

async function mintAddress(addressStore: ReturnType<typeof initInMemoryInboxAddress>) {
	const entry = await addressStore.createAddress({ userId: OWNER, domain: "read.place" });
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
		expect(await emailStore.listEmailsByUserId(OWNER)).toHaveLength(0);
		expect(published).toHaveLength(0);
	});

	it("retries (no row) when the raw .eml is not yet readable", async () => {
		const { addressStore, emailStore, published, run } = makeHarness();
		const address = await mintAddress(addressStore);

		const result = await run(address);

		assert(result);
		expect(result.batchItemFailures).toHaveLength(1);
		expect(await emailStore.listEmailsByUserId(OWNER)).toHaveLength(0);
		expect(published).toHaveLength(0);
	});

	it("fails the record for a non-forwarding recipient, writing no user row", async () => {
		const { emailStore, rawMap, published, run } = makeHarness();
		rawMap.set(RAW_KEY, Buffer.from("raw"));

		const result = await run("postmaster@read.place");

		assert(result);
		expect(result.batchItemFailures).toHaveLength(1);
		expect(await emailStore.listEmailsByUserId(OWNER)).toHaveLength(0);
		expect(published).toHaveLength(0);
	});

	it("rejects an oversize email with an audit row under the owner and a DLQ failure", async () => {
		const { addressStore, emailStore, rawMap, published, run } = makeHarness({ maxEmailBytes: 8 });
		const address = await mintAddress(addressStore);
		rawMap.set(RAW_KEY, Buffer.from("this is definitely longer than eight bytes"));

		const result = await run(address);

		assert(result);
		expect(result.batchItemFailures).toHaveLength(1);
		const [row] = await emailStore.listEmailsByUserId(OWNER);
		expect(row.status).toBe("rejected");
		expect(row.bodyS3Key).toBeUndefined();
		expect(published).toHaveLength(0);
	});

	it("rejects an unknown recipient under the unrouted partition, never a user list", async () => {
		const { emailStore, rawMap, published, run } = makeHarness();
		rawMap.set(RAW_KEY, Buffer.from("raw"));

		const result = await run("in-zzzzzz@read.place");

		assert(result);
		expect(result.batchItemFailures).toHaveLength(1);
		expect(await emailStore.listEmailsByUserId(OWNER)).toHaveLength(0);
		const [row] = await emailStore.listEmailsByUserId(UNROUTED);
		expect(row.status).toBe("rejected");
		expect(published).toHaveLength(0);
	});

	it("rejects a disabled recipient under the owner with a DLQ failure", async () => {
		const { addressStore, emailStore, rawMap, published, run } = makeHarness();
		const address = await mintAddress(addressStore);
		await addressStore.disableAddress({ userId: OWNER, address });
		rawMap.set(RAW_KEY, Buffer.from("raw"));

		const result = await run(address);

		assert(result);
		expect(result.batchItemFailures).toHaveLength(1);
		const [row] = await emailStore.listEmailsByUserId(OWNER);
		expect(row.status).toBe("rejected");
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
		const [row] = await emailStore.listEmailsByUserId(OWNER);
		expect(row.status).toBe("unparsed");
		expect(row.bodyS3Key).toBeUndefined();
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
		const [row] = await emailStore.listEmailsByUserId(OWNER);
		expect(row.status).toBe("received");
		expect(row.bodyS3Key).toBe("content/email/content.html");
		expect(row.senderEmail).toBe("news@example.com");
		expect(published).toHaveLength(1);
		expect(published[0].detail.receivedAtMessageId).toBe(`${RECEIVED_AT}#<real@x>`);
		expect(published[0].detail.userId).toBe(OWNER);
	});

	it("collapses an at-least-once redelivery to one row, re-publishing the event", async () => {
		const { addressStore, emailStore, rawMap, published, run } = makeHarness();
		const address = await mintAddress(addressStore);
		rawMap.set(RAW_KEY, Buffer.from("raw"));

		await run(address);
		const second = await run(address);

		assert(second);
		expect(second.batchItemFailures).toHaveLength(0);
		expect(await emailStore.listEmailsByUserId(OWNER)).toHaveLength(1);
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

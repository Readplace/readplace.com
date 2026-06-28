import assert from "node:assert/strict";
import { HutchLogger, noopLogger } from "@packages/hutch-logger";
import {
	type EmailLinkOrdinal,
	type InboxEmailEntry,
	InboxAddressSchema,
	MessageIdSchema,
	type ParseEmailResult,
} from "@packages/domain/inbox";
import { type UserId, UserIdSchema } from "@packages/domain/user";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import { initInMemoryInboxEmailLink } from "@packages/test-fixtures/providers/inbox-email";
import { buildSqsEvent } from "@packages/test-fixtures/sqs";
import { initExtractEmailLinksHandler } from "./extract-email-links-handler";

const USER = UserIdSchema.parse("00000000000000000000000000000001");
const RECEIVED_AT = "2026-06-24T09:00:00.000Z";
const RAM = `${RECEIVED_AT}#<m@x>`;
const RAW_KEY = "inbound/ses-msg-1";

function makeEmail(overrides: Partial<InboxEmailEntry> = {}): InboxEmailEntry {
	return {
		userId: USER,
		receivedAtMessageId: RAM,
		messageId: MessageIdSchema.parse("<m@x>"),
		recipientAddress: InboxAddressSchema.parse("in-3f9a2c@read.place"),
		senderEmail: "news@example.com",
		subject: "Digest",
		status: "received",
		receivedAt: RECEIVED_AT,
		rawEmailS3Key: RAW_KEY,
		bodyS3Key: "content/m/content.html",
		...overrides,
	};
}

function parsedOk(html: string): ParseEmailResult {
	return {
		ok: true,
		email: {
			from: "news@example.com",
			subject: "Digest",
			text: "",
			html,
			messageId: MessageIdSchema.parse("<m@x>"),
			receivedAt: RECEIVED_AT,
			inlineImages: [],
		},
	};
}

function eventBody(over: Partial<{ userId: string; receivedAtMessageId: string }> = {}): string {
	return JSON.stringify({
		detail: {
			userId: over.userId ?? USER,
			receivedAtMessageId: over.receivedAtMessageId ?? RAM,
			recipientAddress: "in-3f9a2c@read.place",
		},
	});
}

function makeHarness(opts?: {
	getEmail?: (input: { userId: UserId; receivedAtMessageId: string }) => Promise<InboxEmailEntry | undefined>;
	readRawEmail?: (s3Key: string) => Promise<Buffer | undefined>;
	parseEmail?: () => Promise<ParseEmailResult>;
	derivedHtml?: string;
	maxLinks?: number;
}) {
	const linkStore = initInMemoryInboxEmailLink();
	const published: { ordinal: EmailLinkOrdinal; url: string }[] = [];
	const alerts: { found: number }[] = [];

	const handler = initExtractEmailLinksHandler({
		getEmail: opts?.getEmail ?? (async () => makeEmail()),
		readRawEmail: opts?.readRawEmail ?? (async () => Buffer.from("raw eml")),
		parseEmail: opts?.parseEmail ?? (async () => parsedOk("<p>body</p>")),
		deriveSanitizedBody: () => opts?.derivedHtml ?? "",
		putLink: linkStore.putLink,
		putLinksMeta: linkStore.putLinksMeta,
		publishCrawlPreview: async ({ ordinal, url }) => {
			published.push({ ordinal, url });
		},
		alertTruncated: async ({ found }) => {
			alerts.push({ found });
		},
		logger: HutchLogger.from(noopLogger),
		maxLinks: opts?.maxLinks ?? 200,
	});

	const run = (body: string) =>
		handler(buildSqsEvent([{ messageId: "rec-1", body }]), buildLambdaContext(), () => {});

	return { linkStore, published, alerts, run };
}

describe("initExtractEmailLinksHandler", () => {
	it("writes one pending row per link and fans out a crawl command for each", async () => {
		const harness = makeHarness({
			derivedHtml: "https://a.test/x https://b.test/y https://c.test/z",
		});

		const result = await harness.run(eventBody());

		assert(result);
		expect(result.batchItemFailures).toHaveLength(0);
		const { links, meta } = await harness.linkStore.listLinksByEmail({
			userId: USER,
			receivedAtMessageId: RAM,
		});
		expect(links.map((l) => [l.ordinal, l.url, l.status])).toEqual([
			["0000", "https://a.test/x", "pending"],
			["0001", "https://b.test/y", "pending"],
			["0002", "https://c.test/z", "pending"],
		]);
		expect(meta).toBeUndefined();
		expect(harness.published).toEqual([
			{ ordinal: "0000", url: "https://a.test/x" },
			{ ordinal: "0001", url: "https://b.test/y" },
			{ ordinal: "0002", url: "https://c.test/z" },
		]);
		expect(harness.alerts).toHaveLength(0);
	});

	it("caps the fan-out, writes a truncated meta item, and raises one alert", async () => {
		const harness = makeHarness({
			derivedHtml: "https://a.test/x https://b.test/y https://c.test/z",
			maxLinks: 2,
		});

		const result = await harness.run(eventBody());

		assert(result);
		expect(result.batchItemFailures).toHaveLength(0);
		const { links, meta } = await harness.linkStore.listLinksByEmail({
			userId: USER,
			receivedAtMessageId: RAM,
		});
		expect(links).toHaveLength(2);
		expect(meta).toEqual({ truncated: true });
		expect(harness.published).toHaveLength(2);
		expect(harness.alerts).toEqual([{ found: 3 }]);
	});

	it("skips an email that is not in the received state", async () => {
		const harness = makeHarness({
			getEmail: async () => makeEmail({ status: "unparsed", bodyS3Key: undefined }),
			derivedHtml: "https://a.test/x",
		});

		await harness.run(eventBody());

		const { links } = await harness.linkStore.listLinksByEmail({
			userId: USER,
			receivedAtMessageId: RAM,
		});
		expect(links).toHaveLength(0);
		expect(harness.published).toHaveLength(0);
	});

	it("skips when the email row is not yet visible", async () => {
		const harness = makeHarness({ getEmail: async () => undefined, derivedHtml: "https://a.test/x" });

		const result = await harness.run(eventBody());

		assert(result);
		expect(result.batchItemFailures).toHaveLength(0);
		expect(harness.published).toHaveLength(0);
	});

	it("retries when the raw .eml is not yet readable", async () => {
		const harness = makeHarness({ readRawEmail: async () => undefined });

		const result = await harness.run(eventBody());

		assert(result);
		expect(result.batchItemFailures).toEqual([{ itemIdentifier: "rec-1" }]);
	});

	it("acks (no rows) when the raw no longer parses", async () => {
		const harness = makeHarness({ parseEmail: async () => ({ ok: false, reason: "unparseable" }) });

		const result = await harness.run(eventBody());

		assert(result);
		expect(result.batchItemFailures).toHaveLength(0);
		expect(harness.published).toHaveLength(0);
	});

	it("fails the record for a malformed event envelope", async () => {
		const harness = makeHarness({ derivedHtml: "https://a.test/x" });

		const result = await harness.run(JSON.stringify({ detail: { wrong: "shape" } }));

		assert(result);
		expect(result.batchItemFailures).toEqual([{ itemIdentifier: "rec-1" }]);
	});

	it("is idempotent under re-delivery: no duplicate rows, re-publishes the fan-out", async () => {
		const harness = makeHarness({ derivedHtml: "https://a.test/x https://b.test/y" });

		await harness.run(eventBody());
		await harness.run(eventBody());

		const { links } = await harness.linkStore.listLinksByEmail({
			userId: USER,
			receivedAtMessageId: RAM,
		});
		expect(links).toHaveLength(2);
		expect(harness.published).toHaveLength(4);
	});
});
